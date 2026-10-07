// Focus minutes by project (Pro). The same rules as the Mac's ProjectFocusLogic.swift and the same test
// vectors. The log is { "2026-10-07|Website": minutes }, kept next to the ordinary focus history.

export const MAX_NAME = 24;

/// Trimmed, single-spaced, at most 24 characters. Empty means "no project".
export const clean = (name) => String(name ?? '').split(/\s+/).filter(Boolean).join(' ').slice(0, MAX_NAME).trim();

export const key = (day, project) => `${day}|${clean(project)}`;

/// Adds minutes to a project's day. Nothing is logged when there is no project or no minutes.
export function add(log, day, project, minutes) {
  const p = clean(project);
  if (!p || !(minutes > 0)) return log;
  const k = key(day, p);
  return { ...log, [k]: (log[k] || 0) + minutes };
}

/// Totals per project over the given days, biggest first, ties by name.
export function totals(log, days) {
  const wanted = new Set(days), sums = {};
  for (const [k, v] of Object.entries(log)) {
    const bar = k.indexOf('|');
    if (bar < 0 || !wanted.has(k.slice(0, bar))) continue;
    const p = k.slice(bar + 1);
    sums[p] = (sums[p] || 0) + v;
  }
  return Object.entries(sums).map(([project, minutes]) => ({ project, minutes }))
    .sort((a, b) => b.minutes - a.minutes || (a.project < b.project ? -1 : a.project > b.project ? 1 : 0));
}

/// Drops entries older than `cutoff` (an ISO date).
export const prune = (log, cutoff) => Object.fromEntries(Object.entries(log).filter(([k]) => k.split('|')[0] >= cutoff));

export const names = (log) => [...new Set(Object.keys(log).filter((k) => k.includes('|')).map((k) => k.slice(k.indexOf('|') + 1)))].sort();
