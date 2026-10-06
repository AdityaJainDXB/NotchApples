// Streaks for the habit tracker: how many days in a row you've done something, your best run, and the last few days as
// ticks. Days are "yyyy-MM-dd" keys and the arithmetic is done on dates alone (no clocks or time zones), so it behaves
// the same everywhere. The same rules as the Mac's HabitLogic.swift, with the same test cases.

import { load, save, uid, todayKey } from '../store.js';

/// A day key moved by `n` days (negative goes back), or null for a bad key.
export function addDays(key, n) {
  const p = String(key).split('-').map(Number);
  if (p.length !== 3 || p.some(Number.isNaN)) return null;
  const d = new Date(Date.UTC(p[0], p[1] - 1, p[2] + n));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
}

/// The last `count` days ending today, oldest first.
export const lastDays = (count, today) => Array.from({ length: count }, (_, i) => addDays(today, -(count - 1 - i)));

/// Days in a row up to today. If today isn't done yet the run still counts through yesterday, so a streak isn't shown as
/// broken until a whole day has been missed.
export function currentStreak(done, today) {
  let day = done.has(today) ? today : addDays(today, -1), n = 0;
  while (day && done.has(day)) { n++; day = addDays(day, -1); }
  return n;
}

/// The longest run of consecutive days ever.
export function bestStreak(done) {
  let best = 0;
  for (const start of done) {
    if (done.has(addDays(start, -1))) continue;
    let n = 0, day = start;
    while (done.has(day)) { n++; day = addDays(day, 1); }
    best = Math.max(best, n);
  }
  return best;
}

/// How many of the last 7 days (including today) are done.
export const thisWeek = (done, today) => lastDays(7, today).filter((d) => done.has(d)).length;

// ---- your habits (saved on this PC) ----

const KEY = 'habits.items';
export const habits = () => load(KEY, []);
export function addHabit(name) {
  const n = String(name).trim().slice(0, 40);
  const list = habits();
  if (!n || list.length >= 30) return;
  save(KEY, [...list, { id: uid(), name: n, done: [] }]);
}
export function toggle(id, day) {
  save(KEY, habits().map((h) => (h.id !== id ? h : { ...h, done: h.done.includes(day) ? h.done.filter((d) => d !== day) : [...h.done, day] })));
}
export const removeHabit = (id) => save(KEY, habits().filter((h) => h.id !== id));
export { todayKey };
