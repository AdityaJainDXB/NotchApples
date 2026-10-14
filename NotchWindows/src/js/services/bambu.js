// The Bambu Lab tab's engine: the printers the user added, one live connection each (opened by Rust, which streams
// every report back as an event), the latest snapshot per printer, sounds and Windows notifications when a print
// pauses, finishes or fails, the thermal warning, and what the closed pill shows. Rules live in bambulogic.js.

import { load, save } from '../store.js';
import { invoke, listen, notify, http } from '../native.js';
import { provide, refresh } from '../activity.js';
import { canUse } from '../features.js';
import * as L from './bambulogic.js';
import * as C from './bambucloudlogic.js';

const subs = new Set();
const snaps = new Map();    // printer id -> snapshot
const failures = new Map(); // printer id -> plain-language reason
const alerts = new Map();   // printer id -> thermal alert
const connecting = new Set();
const retry = new Map();
let wired = false;
const RETRY_MS = 12_000;
const attempts = new Map();   // printer id -> failed tries in a row, so a printer that keeps failing is tried less and less often

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
  if (!canAdd()) return 'Another printer needs Notch Apple Pro (More printers).';
  const clean = { ...p, host: p.host.trim(), accessCode: p.accessCode.trim(), serial: p.serial.trim() };
  savePrinters([...printers(), clean]);
  if (isOn()) connect(clean);
  changed();
  return null;
}

// ---- Bambu account (printers watched through Bambu Cloud, so LAN Mode can stay off) ----
// The password is used once, in memory, by bambucloudlogic.js and goes only to Bambu. Rust keeps the token Bambu returns in
// the app's private data folder; this file never sees it again and only remembers which region is signed in.
const CLOUD_KEY = 'bambu.cloud';
export const cloudRegion = () => load(CLOUD_KEY, null)?.region || null;
export const cloudSignIn = (region, account, password) => C.signIn(http, region, account, password);
export const cloudSendCode = (region, account) => C.sendCode(http, region, account);
export const cloudWithCode = (region, account, code) => C.signInWithCode(http, region, account, code);
export const cloudWithTfa = (region, tfaKey, code) => C.signInWithTfa(http, region, tfaKey, code);

/// With a token in hand: looks up the account and the printers on it, and keeps the sign-in. Returns { ok, devices } or { ok: false, message }.
export async function cloudFinish(region, token) {
  const a = await C.fetchAccount(http, region, token);
  if (!a.ok) return a;
  try { await invoke('bambu_cloud_save', { region, uid: a.uid, token }); } catch (e) { return { ok: false, message: String(e) }; }
  save(CLOUD_KEY, { region });
  changed();
  return { ok: true, devices: a.devices };
}

/// Lists the printers on the signed-in account again, with the sign-in Rust keeps (the token never comes here).
export const cloudDevices = () => C.accountVia((what) => invoke('bambu_cloud_get', { what }));

/// Adds the chosen printers from the account. Returns how many were added and the reason it stopped early, if it did.
export function cloudAdd(devices, region) {
  let added = 0, stopped = null;
  for (const d of devices) {
    if (printers().some((p) => (p.serial || '').trim() === d.serial)) continue;
    if (!canAdd()) { stopped = 'Another printer needs Notch Apple Pro (More printers).'; break; }
    const p = C.cloudPrinter(d, region);
    savePrinters([...printers(), p]); added++;
    if (isOn()) connect(p);
  }
  changed();
  return { added, stopped };
}

/// Signs out: the saved token is deleted, and the printers that were reached through the account are removed.
export async function cloudSignOut() {
  const mine = printers().filter((p) => p.cloud);
  try { await invoke('bambu_cloud_clear', { serials: mine.map((p) => p.serial.trim()) }); }
  catch (e) { return { ok: false, message: `Couldn’t delete the saved sign-in (${String(e)}). You are still signed in: close other programs using the file and try again.` }; }
  mine.forEach((p) => { clearTimeout(retry.get(p.id)); retry.delete(p.id); snaps.delete(p.id); failures.delete(p.id); alerts.delete(p.id); connecting.delete(p.id); });
  savePrinters(printers().filter((p) => !p.cloud));
  save(CLOUD_KEY, null);
  changed();
  return { ok: true };
}

export function remove(id) {
  const p0 = byId(id);
  clearTimeout(retry.get(id)); retry.delete(id);
  savePrinters(printers().filter((p) => p.id !== id));
  snaps.delete(id); failures.delete(id); alerts.delete(id); connecting.delete(id);
  if (p0?.serial) invoke('bambu_stop', { serial: p0.serial.trim() }).catch(() => {});   // only this printer: the others keep their connection
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
    await invoke('bambu_start', { config: { host: (p.host || '').trim(), access_code: (p.accessCode || '').trim(), serial: p.serial.trim(), cloud: p.cloud || null } });
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
  if (isOn() && !String(message).toLowerCase().includes(L.PIN_MISMATCH_HINT) && !/sign in again/i.test(String(message))) {
    const n = (attempts.get(p.id) || 0) + 1; attempts.set(p.id, n);
    retry.set(p.id, setTimeout(() => { const cur = byId(p.id); if (cur && isOn()) connect(cur); }, Math.min(300_000, RETRY_MS * 2 ** Math.min(n - 1, 5))));
  }
  changed();
}

function wire() {
  if (wired) return; wired = true;
  listen('bambu:report', ({ serial, payload }) => {
    if (!isOn()) return;
    const p = bySerial(serial); if (!p) return;
    let root; try { root = JSON.parse(payload); } catch { return; }
    connecting.delete(p.id); failures.delete(p.id); attempts.delete(p.id);
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
