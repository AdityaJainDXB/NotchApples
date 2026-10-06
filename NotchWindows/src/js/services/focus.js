// Focus: a Pomodoro timer that keeps running when the notch is closed (and
// across restarts), with the countdown on the pill. It ends at a fixed time
// rather than counting ticks, so it stays exact even if the PC is busy.

import { load, save, todayKey, update } from '../store.js';
import { notify } from '../native.js';
import { provide, refresh } from '../activity.js';
import { canUse } from '../features.js';

const KEY = 'focus.state';
export const DEFAULT_CFG = { focus: 25, short: 5, long: 15, rounds: 4, autoStart: false, block: false };

export const cfg = () => ({ ...DEFAULT_CFG, ...load('focus.settings', {}) });
export const setCfg = (c) => { save('focus.settings', { ...cfg(), ...c }); if (!get().running) reset(); };

const fresh = () => ({ mode: 'focus', running: false, endsAt: 0, remaining: cfg().focus * 60, round: 1 });
export const get = () => ({ ...fresh(), ...load(KEY, {}) });
const set = (s) => { save(KEY, s); refresh(); };

export const lengthOf = (mode) => (mode === 'focus' ? cfg().focus : mode === 'short' ? cfg().short : cfg().long) * 60;

/// Seconds left right now.
export function secondsLeft(s = get()) {
  return s.running ? Math.max(0, Math.round((s.endsAt - Date.now()) / 1000)) : s.remaining;
}

export function startPause() {
  const s = get();
  if (s.running) set({ ...s, running: false, remaining: secondsLeft(s) });
  else set({ ...s, running: true, endsAt: Date.now() + secondsLeft(s) * 1000 });
}
export const toggle = () => { if (canUse('focus')) startPause(); };

export function reset() { set({ ...get(), running: false, remaining: lengthOf(get().mode) }); }

export function skip() { advance(false); }

/// Switch between Focus, Break and Long break (stops the clock, like the Mac's picker).
export function setMode(mode) { const s = get(); set({ ...s, mode, running: false, endsAt: 0, remaining: lengthOf(mode) }); }

/// Minutes focused per day, for the stats.
export const history = () => load('focus.history', {});

function advance(finished) {
  const s = get();
  const c = cfg();
  let { mode, round } = s;
  if (mode === 'focus') {
    if (finished) update('focus.history', {}, (h) => ({ ...h, [todayKey()]: (h[todayKey()] || 0) + Math.round(lengthOf('focus') / 60) }));
    mode = round % c.rounds === 0 ? 'long' : 'short';
  } else {
    mode = 'focus';
    round = s.mode === 'long' ? 1 : round + 1;
  }
  const running = finished && c.autoStart;
  const length = lengthOf(mode);
  set({ mode, round, running, remaining: length, endsAt: running ? Date.now() + length * 1000 : 0 });
  if (finished) {
    notify('Focus', mode === 'focus' ? 'Break over. Back to it.' : `Session done. Take a ${mode === 'long' ? 'long ' : ''}break.`);
    import('../app.js').then((a) => a.playSound('done'));
  }
}

export const sessionsToday = () => Math.round((history()[todayKey()] || 0) / Math.max(1, cfg().focus));

export function start() {
  setInterval(() => {
    const s = get();
    if (s.running && Date.now() >= s.endsAt) advance(true);
    else if (s.running) refresh();
  }, 1000);

  provide('focus', 60, () => {
    const s = get();
    if (!s.running && s.remaining === lengthOf(s.mode)) return null;
    const left = secondsLeft(s);
    const m = Math.floor(left / 60), sec = left % 60;
    return {
      icon: s.mode === 'focus' ? '🎯' : '☕', tab: 'focus',
      label: `${s.running ? '' : '⏸ '}${m}:${String(sec).padStart(2, '0')}`,
      title: s.mode === 'focus' ? 'Focus session' : 'Break',
    };
  });
}

/// True while a focus (not break) session is running; Screen Time blocks apps then.
export const focusing = () => { const s = get(); return s.running && s.mode === 'focus'; };
