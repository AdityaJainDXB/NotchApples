// Four small guards, all off until you turn them on in Settings → General → On the pill: "unplug at 80%" battery care, a
// low disk space warning, an internet-down alert, and a speed test in the PC Stats tab. The rules are plain functions,
// the same as the Mac's SystemWatchLogic.swift with the same test cases. The internet check fetches Cloudflare's tiny
// captive-portal page every 20 seconds; the speed test downloads about 20 MB from Cloudflare when you press it.

import { load, save } from '../store.js';
import { invoke, http, notify } from '../native.js';
import { provide, refresh } from '../activity.js';

// ---- the rules ----

/// Charging is at or past your limit and you haven't been told yet during this charge.
export const batteryCareDue = (percent, pluggedIn, limit, alreadyAlerted) => pluggedIn && percent >= Math.max(50, Math.min(limit, 100)) && !alreadyAlerted;

/// Low when free space is under `minFreeGB` or under `minFreePercent` of the disk, whichever you hit first.
export function diskLow(free, total, minFreeGB = 10, minFreePercent = 8) {
  if (!(total > 0) || free < 0) return false;
  return free < minFreeGB * 1e9 || (free / total) * 100 < minFreePercent;
}

/// Keeps the last few checks. Three failures in a row is "down"; a median above 500 ms is "slow".
export class Link {
  constructor() { this.failures = 0; this.latencies = []; }
  record(ok, ms = null) {
    if (ok) { this.failures = 0; if (ms !== null) { this.latencies.push(ms); if (this.latencies.length > Link.KEEP) this.latencies.shift(); } } else this.failures++;
  }
  get median() { if (!this.latencies.length) return null; const s = [...this.latencies].sort((a, b) => a - b); return s[Math.floor(s.length / 2)]; }
  get state() { return this.failures >= Link.FAILURES_FOR_DOWN ? 'down' : ((this.median ?? 0) > Link.SLOW_MS ? 'slow' : 'online'); }
}
Link.FAILURES_FOR_DOWN = 3; Link.SLOW_MS = 500; Link.KEEP = 5;

/// What to tell you when the state changes (null for no change).
export function announcement(from, to) {
  if (from === to) return null;
  if (to === 'down') return 'Internet is down';
  if (from === 'down') return to === 'online' ? 'Internet is back' : 'Internet is back, but slow';
  if (to === 'slow') return 'Internet is slow';
  if (from === 'slow' && to === 'online') return 'Internet is back to normal';
  return null;
}

export const megabitsPerSecond = (bytes, seconds) => (seconds > 0 ? (bytes * 8) / seconds / 1e6 : 0);
export const speedText = (mbps) => (mbps >= 100 ? `${mbps.toFixed(0)} Mbps` : `${mbps.toFixed(1)} Mbps`);

/// Apps you may not close from the notch: the system itself and this app.
const PROTECTED = new Set(['system', 'idle', 'registry', 'smss', 'csrss', 'wininit', 'winlogon', 'services', 'lsass', 'svchost', 'dwm', 'fontdrvhost',
  'explorer', 'sihost', 'taskhostw', 'runtimebroker', 'searchhost', 'startmenuexperiencehost', 'shellexperiencehost', 'msmpeng', 'ctfmon', 'notch apple', 'notch-apple', 'notchapple']);
export function closable(name) {
  const n = String(name || '').trim().toLowerCase().replace(/\.exe$/, '');
  // Letters, digits, spaces and . _ - only: the name is put into a command, so nothing that cmd.exe treats specially gets through.
  return /^[a-z0-9 ._-]{1,64}$/.test(n) && !PROTECTED.has(n);
}

// ---- settings ----

export const prefs = () => ({ care: load('watch.batteryCare', false), limit: load('watch.batteryLimit', 80), disk: load('watch.diskLow', false), diskGB: load('watch.diskGB', 10), internet: load('watch.internet', false) });
export const setPref = (k, v) => save(`watch.${k}`, v);

// ---- the service ----

let flash = null, careAlerted = false, diskAlerted = false, tick = 0;
const link = new Link();
export let latency = null, linkState = 'online';
const show = (activity, seconds) => { flash = { until: Date.now() + seconds * 1000, activity }; refresh(); setTimeout(refresh, seconds * 1000 + 60); };

async function checkPower() {
  const p = prefs();
  const s = await invoke('system_stats').catch(() => null);
  if (!s) return;
  if (s.battery_percent != null) {
    if (!s.battery_charging) careAlerted = false;
    else if (p.care && batteryCareDue(s.battery_percent, true, p.limit, careAlerted)) {
      careAlerted = true;
      show({ icon: '🔋', label: `${s.battery_percent}%`, priority: 66 }, 6);
      notify(`Battery at ${s.battery_percent}%`, `You can unplug now: staying under ${p.limit}% is gentler on the battery.`);
    }
  }
  if (p.disk && s.disk_total) {
    const low = diskLow(s.disk_free, s.disk_total, p.diskGB);
    if (low && !diskAlerted) { diskAlerted = true; show({ icon: '💾', label: `${(s.disk_free / 1e9).toFixed(0)} GB`, priority: 66 }, 6); notify('Low disk space', `Only ${(s.disk_free / 1e9).toFixed(1)} GB is free on this PC.`); }
    else if (!low && s.disk_free > p.diskGB * 1.2e9) diskAlerted = false;   // re-arm once it has clearly recovered
  }
}

async function checkInternet() {
  const old = link.state, t0 = performance.now();
  let ok = false;
  try { ok = (await http('https://cp.cloudflare.com/generate_204', { timeout: 4000 })).ok; } catch { ok = false; }
  link.record(ok, ok ? performance.now() - t0 : null);
  latency = link.median; linkState = link.state;
  const text = announcement(old, linkState);
  if (text) {
    show({ icon: linkState === 'down' ? '📵' : '📶', label: linkState === 'down' ? 'Offline' : linkState === 'slow' ? 'Slow' : 'Online', priority: 66 }, 4);
    notify(text, linkState === 'down' ? 'This PC can’t reach the internet.' : 'Your connection changed.');
  }
}

/// One tap, about 20 MB from Cloudflare's public speed test, shown as megabits per second.
export async function speedTest() {
  const size = 20_000_000, t0 = performance.now();
  const r = await fetch(`https://speed.cloudflare.com/__down?bytes=${size}`, { cache: 'no-store' });
  const bytes = (await r.arrayBuffer()).byteLength;
  return speedText(megabitsPerSecond(bytes, (performance.now() - t0) / 1000));
}

export function start() {
  provide('syswatch', 66, () => (flash && Date.now() < flash.until ? flash.activity : null));
  setInterval(() => {
    tick++;
    checkPower();
    if (prefs().internet) checkInternet(); else { latency = null; linkState = 'online'; }
  }, 20000);
}
