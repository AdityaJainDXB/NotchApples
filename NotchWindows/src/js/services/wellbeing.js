// Break reminders (eyes, water, stretch, posture), the breathing exercise, the bedtime nudge, the daily focus goal and
// date countdowns. The rules are plain functions over numbers and date keys (no clocks), the same as the Mac's
// WellbeingLogic.swift with the same test cases; the service at the bottom runs the reminders in the background.

import { load, save, todayKey } from '../store.js';
import { notify } from '../native.js';
import { provide, refresh } from '../activity.js';

// ---- break reminders ----

export const BREAKS = {
  eyes: { title: 'Rest your eyes', message: 'Look at something 20 feet (6 m) away for 20 seconds.', icon: '👀', every: 20 },
  water: { title: 'Drink some water', message: 'A glass of water keeps you sharp.', icon: '💧', every: 60 },
  stretch: { title: 'Stand up and stretch', message: 'Roll your shoulders and stretch your neck and back.', icon: '🧘', every: 45 },
  posture: { title: 'Check your posture', message: 'Sit tall, relax your shoulders, feet flat.', icon: '🪑', every: 30 },
};
export const KINDS = Object.keys(BREAKS);

/// Is `minuteOfDay` (0..1439) inside the hours you want reminders in? Handles ranges that run past midnight.
export const isActive = (m, from, to) => (from === to ? true : from < to ? m >= from && m < to : m >= from || m < to);

/// The one reminder to show now, or null. `last` is when each was last shown (ms); one never shown starts at `startedMs`.
export function nextDue({ now, startedMs, last = {}, settings, minuteOfDay, from, to, snoozedUntil = 0 }) {
  if (now < snoozedUntil || !isActive(minuteOfDay, from, to)) return null;
  let best = null;
  for (const kind of KINDS) {
    const s = settings[kind];
    if (!s?.on || !(s.every > 0)) continue;
    const overdue = now - (last[kind] ?? startedMs) - s.every * 60000;
    if (overdue >= 0 && (!best || overdue > best.overdue)) best = { kind, overdue };
  }
  return best ? best.kind : null;
}

// ---- breathing ----

export const PATTERNS = {
  box: { name: 'Box 4-4-4-4', short: 'Box', phases: [['Breathe in', 4], ['Hold', 4], ['Breathe out', 4], ['Hold', 4]] },
  calm: { name: 'Calm 4-7-8', short: '4-7-8', phases: [['Breathe in', 4], ['Hold', 7], ['Breathe out', 8]] },
  relax: { name: 'Relax 5-5', short: '5-5', phases: [['Breathe in', 5], ['Breathe out', 5]] },
};
export const cycleLength = (p) => p.phases.reduce((a, [, s]) => a + s, 0);

/// What the circle shows `elapsed` seconds in: the phase, its size (0 small .. 1 full) and a countdown.
export function breath(p, elapsed) {
  const cycle = cycleLength(p), t = Math.max(0, elapsed) % cycle;
  let start = 0, index = 0;
  for (let i = 0; i < p.phases.length; i++) { if (t < start + p.phases[i][1]) { index = i; break; } start += p.phases[i][1]; }
  const [label, seconds] = p.phases[index];
  const within = (t - start) / seconds;
  const size = label === 'Breathe in' ? within : label === 'Breathe out' ? 1 - within : (index > 0 && p.phases[index - 1][0] === 'Breathe in' ? 1 : 0);
  return { label, size, secondsLeft: Math.ceil(seconds - (t - start)), cycles: Math.floor(Math.max(0, elapsed) / cycle) };
}

// ---- bedtime, goals, countdowns ----

/// Time for the wind-down nudge? From `lead` minutes before bedtime until an hour after, once per day.
export function bedtimeDue(m, bedtime, lead, lastDayKey, today) {
  if (lastDayKey === today) return false;
  return isActive(m, (bedtime - lead + 1440) % 1440, (bedtime + 60) % 1440);
}
export const goalFraction = (minutes, goal) => (goal > 0 ? Math.min(1, minutes / goal) : 0);

/// Whole days from one "yyyy-MM-dd" to another (negative once it has passed). null for bad dates.
export function daysBetween(from, to) {
  const day = (s) => {
    const p = String(s).split('-').map(Number);
    if (p.length !== 3 || p.some(Number.isNaN) || p[1] < 1 || p[1] > 12 || p[2] < 1 || p[2] > 31) return null;
    return Math.round(Date.UTC(p[0], p[1] - 1, p[2]) / 86400000);
  };
  const a = day(from), b = day(to);
  return a === null || b === null ? null : b - a;
}
export const countdownLabel = (d) => (d === 0 ? 'Today' : d === 1 ? 'Tomorrow' : d === -1 ? 'Yesterday' : d < 0 ? `${-d} days ago` : `In ${d} days`);

// ---- settings you can change ----

export const config = () => ({
  on: true, from: 540, to: 1080,
  settings: Object.fromEntries(KINDS.map((k) => [k, { on: false, every: BREAKS[k].every }])),
  bedtime: { on: false, at: 1380, lead: 30 },
  ...load('wellbeing.config', {}),
});
export const setConfig = (patch) => save('wellbeing.config', { ...config(), ...patch });
export const snooze = (minutes) => save('wellbeing.snoozedUntil', Date.now() + minutes * 60000);

// ---- the background service ----

let flash = null, started = Date.now();
const minuteOfDay = (d = new Date()) => d.getHours() * 60 + d.getMinutes();

function check() {
  const c = config();
  if (c.on) {
    const last = load('wellbeing.last', {});
    const kind = nextDue({ now: Date.now(), startedMs: started, last, settings: c.settings, minuteOfDay: minuteOfDay(), from: c.from, to: c.to, snoozedUntil: load('wellbeing.snoozedUntil', 0) });
    if (kind) {
      save('wellbeing.last', { ...last, [kind]: Date.now() });
      const b = BREAKS[kind];
      notify(b.title, b.message);
      flash = { until: Date.now() + 8000, activity: { icon: b.icon, label: b.title, priority: 65 } };
      refresh(); setTimeout(refresh, 8100);
    }
  }
  if (c.bedtime?.on && bedtimeDue(minuteOfDay(), c.bedtime.at, c.bedtime.lead, load('wellbeing.bedtimeDay', ''), todayKey())) {
    save('wellbeing.bedtimeDay', todayKey());
    notify('Time to wind down', 'Screens off soon: your bedtime is coming up.');
    flash = { until: Date.now() + 8000, activity: { icon: '🌙', label: 'Wind down', priority: 65 } };
    refresh(); setTimeout(refresh, 8100);
  }
}

export function start() {
  started = Date.now();
  provide('wellbeing', 65, () => (flash && Date.now() < flash.until ? flash.activity : null));
  // "One thing today" on the closed pill, only if you asked for it (it never outranks anything live).
  provide('onething', 6, () => { const v = load('today.oneThing', null); return load('today.onePill', false) && v && v.day === todayKey() && v.text ? { icon: '🎯', label: v.text.slice(0, 22), priority: 6 } : null; });
  setInterval(check, 30000);
}
