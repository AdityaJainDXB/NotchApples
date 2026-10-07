// Small things that appear on the closed pill for a few seconds, like the Mac's live activities:
//  • a low-battery warning at 20% and 10% (when not charging), with a notification
//  • a volume gauge when the volume changes (off by default: Windows shows its own flyout)
//  • a brightness gauge when the screen brightness changes (laptop screens; off by default for the same reason)

import { load, save } from '../store.js';
import { invoke, notify } from '../native.js';
import { provide, refresh } from '../activity.js';

export const batteryWarn = () => load('hud.battery', true);
export const volumeGauge = () => load('hud.volume', false);
export const brightnessGauge = () => load('hud.brightness', false);

let flash = null;                 // { until, activity }
let warned = { 20: false, 10: false };
let lastVolume = null;
let lastBrightness = null;
let brightnessMissing = 0;   // when the PC has no controllable screen, ask again only now and then

/// Which warning (if any) applies. Pure, so it can be tested.
export function batteryLevel(percent, charging) {
  if (percent == null || charging) return null;
  return percent <= 10 ? 10 : percent <= 20 ? 20 : null;
}

export function show(activity, seconds) {
  flash = { until: Date.now() + seconds * 1000, activity };
  refresh();
  setTimeout(refresh, seconds * 1000 + 60);
}

async function checkBattery() {
  clearTimeout(checkBattery.t);
  checkBattery.t = setTimeout(checkBattery, 60_000);
  if (!batteryWarn()) return;
  const s = await invoke('system_stats').catch(() => null);
  if (!s || s.battery_percent == null) return;
  const level = batteryLevel(s.battery_percent, s.battery_charging);
  if (s.battery_charging || s.battery_percent > 25) warned = { 20: false, 10: false };
  if (level && !warned[level]) {
    warned[level] = true; if (level === 10) warned[20] = true;
    show({ icon: '🪫', label: `${s.battery_percent}%`, priority: 80 }, 10);
    notify('Battery low', `${s.battery_percent}% left. Plug in soon.`);
  }
}

async function checkVolume() {
  clearTimeout(checkVolume.t);
  checkVolume.t = setTimeout(checkVolume, 1000);
  if (!volumeGauge()) { lastVolume = null; return; }
  const a = await invoke('audio_state').catch(() => null);
  if (!a?.available) return;
  const v = a.muted ? 0 : a.volume;
  if (lastVolume !== null && Math.abs(v - lastVolume) > 0.004) show({ icon: v === 0 ? '🔇' : '🔊', gauge: v, priority: 95 }, 2);
  lastVolume = v;
}

async function checkBrightness() {
  clearTimeout(checkBrightness.t);
  checkBrightness.t = setTimeout(checkBrightness, brightnessMissing ? 30_000 : 1000);
  if (!brightnessGauge()) { lastBrightness = null; brightnessMissing = 0; return; }
  const b = await invoke('brightness_state').catch(() => null);
  if (!b?.available) { brightnessMissing = 1; return; }
  brightnessMissing = 0;
  if (lastBrightness !== null && Math.abs(b.level - lastBrightness) > 0.004) show({ icon: '☀️', gauge: b.level, priority: 95 }, 2);
  lastBrightness = b.level;
}

/// Is there a screen this PC lets us read the brightness of? (Laptop panels; most desktop monitors say no.)
export async function brightnessAvailable() {
  const b = await invoke('brightness_state').catch(() => null);
  return !!b?.available;
}

export function start() {
  provide('hud', 80, () => (flash && Date.now() < flash.until ? flash.activity : null));
  checkBattery();
  checkVolume();
  checkBrightness();
}
export const setBatteryWarn = (v) => save('hud.battery', v);
export const setVolumeGauge = (v) => { save('hud.volume', v); lastVolume = null; };
export const setBrightnessGauge = (v) => { save('hud.brightness', v); lastBrightness = null; brightnessMissing = 0; };
