// The Bambu Lab tab's engine: the printers the user added, one live connection each (opened by Rust, which streams
// every report back as an event), the latest snapshot per printer, sounds and Windows notifications when a print
// pauses, finishes or fails, the thermal warning, and what the closed pill shows. Rules live in bambulogic.js.

import { load, save } from '../store.js';
import { invoke, listen, notify } from '../native.js';
import { provide, refresh } from '../activity.js';
import { canUse } from '../features.js';
import * as L from './bambulogic.js';

const subs = new Set();
const snaps = new Map();    // printer id -> snapshot
const failures = new Map(); // printer id -> plain-language reason
const alerts = new Map();   // printer id -> thermal alert
const connecting = new Set();
const retry = new Map();
let wired = false;
const RETRY_MS = 12_000;

export const onChange = (fn) => { subs.add(fn); return () => subs.delete(fn); };
const changed = () => { subs.forEach((f) => { try { f(); } catch (e) { console.error(e); } }); refresh(); };

export const printers = () => load('bambu.printers', []);
const savePrinters = (list) => save('bambu.printers', list);
export const isOn = () => load('bambu.on', false);
export const sounds = () => load('bambu.sounds', true);
export const thermal = () => load('bambu.thermal', true);
export const setSounds = (v) => save('bambu.sounds', !!v);
export const setThermal = (v) => { save('bambu.thermal', !!v); if (!v) { alerts.clear(); changed(); } };
export const snapshot = (id) => snaps.get(id) || (id ? L.waiting() : L.emptySnapshot());
export const failure = (id) => failures.get(id) || null;
export const alertFor = (id) => alerts.get(id) || null;
export const isConnecting = (id) => connecting.has(id);
export const canAdd = () => printers().length < L.FREE_PRINTERS || canUse('bambuMulti');

const byId = (id) => printers().find((p) => p.id === id);
const bySerial = (serial) => printers().find((p) => (p.serial || '').trim() === serial);

/// Adds a printer. Returns null on success or the reason it wasn't.
export function add(p) {
  const bad = L.problem(p, {});
  if (bad) return bad;
  if (!canAdd()) return 'Another printer needs Notch Apple Pro (More Bambu Lab printers).';
  const clean = { ...p, host: p.host.trim(), accessCode: p.accessCode.trim(), serial: p.serial.trim() };
  savePrinters([...printers(), clean]);
  if (isOn()) connect(clean);
  changed();
  return null;
}

export function remove(id) {
  const p0 = byId(id);
  clearTimeout(retry.get(id)); retry.delete(id);
  savePrinters(printers().filter((p) => p.id !== id));
  snaps.delete(id); failures.delete(id); alerts.delete(id); connecting.delete(id);
  invoke('bambu_stop', { serial: p0?.serial?.trim() }).catch(() => {});   // only this printer: the others keep their connection
  changed();
}

/// Forget the remembered certificate (after a firmware update or reset) and connect again.
export async function trustNewCertificate(id) {
  const p = byId(id); if (!p) return;
  await invoke('bambu_trust_new', { serial: p.serial.trim() }).catch(() => {});
  if (isOn()) connect(p);   // when monitoring is off, the next time it is switched on remembers the new certificate
}

export function enable() {
  save('bambu.on', true);
  wire();
  printers().forEach(connect);
  changed();
}

export function disable() {
  save('bambu.on', false);
  clearTimeout(startTimer);
  retry.forEach((t) => clearTimeout(t)); retry.clear();
  invoke('bambu_stop').catch(() => {});
  printers().forEach((p) => snaps.set(p.id, L.offline(null)));
  connecting.clear(); alerts.clear();
  changed();
}

async function connect(p) {
  const bad = L.problem(p, {});
  if (bad) { snaps.set(p.id, L.offline(bad)); failures.set(p.id, bad); changed(); return; }
  clearTimeout(retry.get(p.id));
  connecting.add(p.id); changed();
  try {
    await invoke('bambu_start', { config: { host: p.host.trim(), access_code: p.accessCode.trim(), serial: p.serial.trim() } });
    if (!isOn() || !byId(p.id)) { invoke('bambu_stop', { serial: p.serial.trim() }).catch(() => {}); return; }   // switched off or removed while connecting
    connecting.delete(p.id);
    if (!snaps.has(p.id) || snaps.get(p.id).phase === 'offline') snaps.set(p.id, L.waiting());
  } catch (e) {
    if (isOn() && byId(p.id)) fail(p, String(e));
  }
}

function fail(p, message) {
  connecting.delete(p.id);
  snaps.set(p.id, L.offline(message)); failures.set(p.id, message); alerts.delete(p.id);
  clearTimeout(retry.get(p.id));
  if (isOn() && !String(message).toLowerCase().includes(L.PIN_MISMATCH_HINT)) {
    retry.set(p.id, setTimeout(() => { const cur = byId(p.id); if (cur && isOn()) connect(cur); }, RETRY_MS));
  }
  changed();
}

function wire() {
  if (wired) return; wired = true;
  listen('bambu:report', ({ serial, payload }) => {
    if (!isOn()) return;
    const p = bySerial(serial); if (!p) return;
    let root; try { root = JSON.parse(payload); } catch { return; }
    connecting.delete(p.id); failures.delete(p.id);
    const old = snapshot(p.id);
    const next = L.apply(root, old.phase === 'offline' ? L.waiting() : old);
    snaps.set(p.id, next);
    react(p, old, next);
    changed();
  }).catch(() => {});
  listen('bambu:state', ({ serial, state, message }) => {
    if (!isOn()) return;
    const p = bySerial(serial); if (!p) return;
    if (state === 'failed') fail(p, message || 'Couldn’t reach the printer.');
    else if (state === 'dropped') fail(p, 'Lost connection to the printer. Retrying…');
  }).catch(() => {});
}

// ---- alerts: a tone, a notification, and the pill ----
let ctx = null;
function tone(freqs) {
  if (!sounds()) return;
  try {
    ctx ??= new AudioContext();
    if (ctx.state === 'suspended') ctx.resume().catch(() => {});
    freqs.forEach((f, i) => {
      const o = ctx.createOscillator(), g = ctx.createGain(), t = ctx.currentTime + i * 0.16;
      o.frequency.value = f; o.type = 'sine';
      g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.18, t + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.3);
      o.connect(g).connect(ctx.destination); o.start(t); o.stop(t + 0.32);
    });
  } catch { /* no audio device: stay quiet */ }
}
let flash = null;
const flashPill = (a, ms) => { flash = a; refresh(); setTimeout(() => { if (flash === a) { flash = null; refresh(); } }, ms); };

function react(p, old, now) {
  const name = L.printerName(p);
  const alert = thermal() ? L.thermalAlert(old, now) : null;
  const had = alerts.get(p.id);
  if ((alert?.kind || null) !== (had?.kind || null)) {
    if (alert) { alerts.set(p.id, alert); notify(`${name} is running hot`, alert.message); tone([220, 165]); } else alerts.delete(p.id);
  } else if (alert) alerts.set(p.id, alert);
  const ev = L.printEvent(old, now);
  if (ev === 'paused') { tone([660]); flashPill({ icon: '⏸', label: 'Paused', dot: L.COLOURS.paused, tab: 'bambu' }, 6000); }
  if (ev === 'finished') { tone([523, 784]); notify(`${name}: print finished`, now.filename ? `${now.filename} is done.` : 'Your print is done.'); flashPill({ icon: '✅', label: 'Print done', tab: 'bambu' }, 8000); }
  if (ev === 'failed') { tone([220, 165]); notify(`${name}: print failed`, now.filename ? `${now.filename} stopped with an error.` : 'The print stopped with an error.'); flashPill({ icon: '⚠️', label: 'Print failed', tab: 'bambu' }, 8000); }
}

provide('bambu', 55, () => {
  if (!isOn()) return null;
  const hot = [...alerts.values()][0];
  if (hot) return { icon: '🌡️', label: `${hot.value}°`, live: true, tab: 'bambu', title: hot.message };
  if (flash) return flash;
  const live = printers().map((p) => ({ p, s: snaps.get(p.id) })).filter((x) => x.s && (x.s.phase === 'printing' || x.s.phase === 'paused'));
  const x = live.find((y) => y.s.phase === 'printing') || live[0];
  if (!x) return null;
  return { icon: '🖨️', label: L.pillText(x.s), dot: L.phaseColour(x.s), tab: 'bambu', title: L.printerName(x.p) };
});

/// Called once at launch by the service loader: reconnects only if the user switched monitoring on.
let startTimer = 0;
export function start() {
  if (!isOn()) return;
  wire();
  startTimer = setTimeout(() => printers().forEach(connect), 1500);
}
