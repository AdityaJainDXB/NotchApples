// Timer and stopwatch, from the Mac's Timer add-on. Both keep running when the
// notch is closed or the app restarts; the time left shows on the pill.

import { load, save, fmtClock, uid } from '../store.js';
import * as NT from './namedtimers.js';
import { notify } from '../native.js';
import { provide, refresh } from '../activity.js';

const T = 'timer.state';
const S = 'stopwatch.state';

// ---- countdown ----
export const timer = () => ({ running: false, endsAt: 0, remaining: 0, total: 0, label: '', ...load(T, {}) });
const setTimer = (t) => { save(T, t); refresh(); };

export function timerLeft(t = timer()) {
  return t.running ? Math.max(0, Math.ceil((t.endsAt - Date.now()) / 1000)) : t.remaining;
}

export function startTimer(seconds, label = '') {
  if (!(seconds > 0)) return;
  setTimer({ running: true, endsAt: Date.now() + seconds * 1000, remaining: seconds, total: seconds, label, doneAt: 0 });
}
export function pauseTimer() {
  const t = timer();
  if (t.running) setTimer({ ...t, running: false, remaining: timerLeft(t) });
  else if (t.remaining > 0) setTimer({ ...t, running: true, endsAt: Date.now() + t.remaining * 1000 });
}
export function addTime(seconds) {
  const t = timer();
  if (t.running) setTimer({ ...t, endsAt: t.endsAt + seconds * 1000, total: t.total + seconds });
  else setTimer({ ...t, remaining: Math.max(0, t.remaining + seconds), total: t.total + seconds });
}
export const cancelTimer = () => setTimer({ running: false, endsAt: 0, remaining: 0, total: 0, label: '', doneAt: 0 });

// ---- stopwatch ----
export const stopwatch = () => ({ running: false, startedAt: 0, before: 0, laps: [], ...load(S, {}) });
const setWatch = (w) => { save(S, w); refresh(); };
export const elapsed = (w = stopwatch()) => w.before + (w.running ? Date.now() - w.startedAt : 0);
export function startStop() {
  const w = stopwatch();
  if (w.running) setWatch({ ...w, running: false, before: elapsed(w) });
  else setWatch({ ...w, running: true, startedAt: Date.now() });
}
export function lap() { const w = stopwatch(); if (w.running) setWatch({ ...w, laps: [elapsed(w), ...w.laps].slice(0, 99) }); }
export const resetWatch = () => setWatch({ running: false, startedAt: 0, before: 0, laps: [] });

export const fmtMs = (ms) => {
  const cs = Math.floor((ms % 1000) / 10);
  return `${fmtClock(Math.floor(ms / 1000))}.${String(cs).padStart(2, '0')}`;
};

// ---- named timers (Pro): several at once, each ending at a fixed time ----
export const MAX_NAMED = 8;
export const named = () => load('timer.named', []);
const setNamed = (list) => { save('timer.named', list); refresh(); };
export const namedLeft = (t) => (t.done ? 0 : Math.max(0, Math.ceil((t.endsAt - Date.now()) / 1000)));
/// Adds a timer from text like "Pasta 10m". Returns an explanation when it can't, otherwise null.
export function addNamed(input) {
  const p = NT.parse(input);
  if (!p) return 'Add a time: “Pasta 10m”, “Egg 1:30” or “Tea 3 min”.';
  const list = named();
  if (list.filter((t) => !t.done).length >= MAX_NAMED) return `That's ${MAX_NAMED} running. Remove one first.`;
  setNamed([...list, { id: uid(), name: p.name, seconds: p.seconds, endsAt: Date.now() + p.seconds * 1000, done: false }]);
  return null;
}
export const removeNamed = (id) => setNamed(named().filter((t) => t.id !== id));
export const clearDoneNamed = () => setNamed(named().filter((t) => !t.done));

export function start() {
  setInterval(() => {
    const due = named().filter((t) => !t.done && t.endsAt <= Date.now());
    if (due.length) {
      setNamed(named().map((t) => (due.some((d) => d.id === t.id) ? { ...t, done: true, doneAt: Date.now() } : t)));
      for (const t of due) notify(`${t.name} is done`, `Your ${NT.clock(t.seconds)} timer has finished.`);
      import('../app.js').then((a) => a.playSound('done'));
    }
    const t = timer();
    if (t.running && Date.now() >= t.endsAt) {
      setTimer({ ...t, running: false, remaining: 0, doneAt: Date.now() });
      notify('Timer', t.label ? `${t.label}: time's up.` : "Time's up.");
      import('../app.js').then((a) => a.playSound('done'));
    } else if (t.running || stopwatch().running) refresh();
  }, 500);

  provide('timer', 70, () => {
    const t = timer();
    if (t.doneAt && Date.now() - t.doneAt < 60_000) return { icon: '⏰', label: 'Done', live: true, tab: 'timer' };
    if (!t.running && !t.remaining) return null;
    return { icon: '⏱', label: `${t.running ? '' : '⏸ '}${fmtClock(timerLeft(t))}`, tab: 'timer', title: t.label || 'Timer' };
  });
  provide('namedtimers', 60, () => {
    const list = named(), fresh = list.find((t) => t.done && t.doneAt && Date.now() - t.doneAt < 30_000);
    if (fresh) return { icon: '🔔', label: fresh.name.slice(0, 12), live: true, tab: 'timer', title: `${fresh.name} is done` };
    const next = list.filter((t) => !t.done).sort((a, b) => a.endsAt - b.endsAt)[0];
    return next ? { icon: '⏲', label: `${next.name.slice(0, 8)} ${NT.clock(namedLeft(next))}`, tab: 'timer', title: `${next.name} (${list.filter((t) => !t.done).length} running)` } : null;
  });
  provide('stopwatch', 40, () => {
    const w = stopwatch();
    if (!w.running) return null;
    return { icon: '⏱', label: fmtClock(Math.floor(elapsed(w) / 1000)), tab: 'timer', title: 'Stopwatch' };
  });
}
