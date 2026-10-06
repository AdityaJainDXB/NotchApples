// Repeating to-dos: when one is ticked off, the next one is made. Pure date maths, no storage,
// so it can be tested. Times are local; the time of day stays the same across clock changes.

export const RULES = [
  { value: 'daily', label: 'Every day' },
  { value: 'weekdays', label: 'Every weekday' },
  { value: 'weekly', label: 'Every week' },
  { value: 'monthly', label: 'Every month' },
];

const lastDayOf = (y, m) => new Date(y, m + 1, 0).getDate();

/// One step after `ms` (a due time), by `rule`. `anchorDay` keeps "the 31st" meaning the last day of short months.
export function step(ms, rule, anchorDay) {
  const d = new Date(ms);
  if (rule === 'monthly') {
    const day = anchorDay || d.getDate();
    const y = d.getFullYear(), m = d.getMonth() + 1;
    const ty = y + Math.floor(m / 12), tm = m % 12;
    return new Date(ty, tm, Math.min(day, lastDayOf(ty, tm)), d.getHours(), d.getMinutes(), d.getSeconds()).getTime();
  }
  const n = new Date(d.getFullYear(), d.getMonth(), d.getDate() + (rule === 'weekly' ? 7 : 1), d.getHours(), d.getMinutes(), d.getSeconds());
  if (rule === 'weekdays') while (n.getDay() === 0 || n.getDay() === 6) n.setDate(n.getDate() + 1);
  return n.getTime();
}

/// The next due time that is still ahead of `now` (a missed day is skipped, not piled up). null for an unknown rule.
export function nextDue(ms, rule, now = Date.now(), anchorDay) {
  if (!RULES.some((r) => r.value === rule) || !Number.isFinite(ms)) return null;
  let next = step(ms, rule, anchorDay);
  for (let i = 0; next <= now && i < 2000; i++) next = step(next, rule, anchorDay);
  return next;
}

export const ruleLabel = (rule) => (RULES.find((r) => r.value === rule) || {}).label || '';
