// The To-do list's priority rules, ported from the Mac app (TodoLogic.swift). No DOM and no storage, so Node tests
// them (tests/todologic.test.mjs). Dates are read by the To-do tab itself (parseWhen); this file only does
// priorities and the order of the list.

export const PRIORITIES = ['high', 'medium', 'low'];
export const PRIORITY_RANK = { high: 2, medium: 1, low: 0 };
export const PRIORITY_NAME = { high: 'High', medium: 'Medium', low: 'Low' };
/// Red for high, orange for medium, grey for low.
export const PRIORITY_COLOUR = { high: '#ff5555', medium: '#ff9f43', low: '#9aa0a6' };

/// A task with no priority saved (a list from before priorities existed) reads as Medium.
export const priorityOf = (t) => (t && PRIORITY_RANK[t.priority] !== undefined ? t.priority : 'medium');

/// "Buy milk !!!" → { text: 'Buy milk', priority: 'high' }.
/// "!!!" or "high:" or "urgent:" = high, "!!" or "med:" = medium, "!" or "low:" = low, at the start or the end.
/// Nothing found → priority null, so the caller uses the one chosen in the menu.
export function splitPriority(raw) {
  let text = String(raw ?? '').trim();
  if (!text) return { text: '', priority: null };
  const lower = text.toLowerCase();
  for (const [prefix, p] of [['high:', 'high'], ['urgent:', 'high'], ['medium:', 'medium'], ['med:', 'medium'], ['low:', 'low']]) {
    if (lower.startsWith(prefix)) return { text: text.slice(prefix.length).trim(), priority: p };
  }
  for (const [marks, p] of [['!!!', 'high'], ['!!', 'medium'], ['!', 'low']]) {
    if (text.endsWith(marks) && !text.endsWith(`!${marks}`)) return { text: text.slice(0, -marks.length).trim(), priority: p };
    if (text.startsWith(marks) && !text.startsWith(`${marks}!`)) return { text: text.slice(marks.length).trim(), priority: p };
  }
  return { text, priority: null };
}

/// Open tasks first, then finished ones. With `byPriority` on (the default), high comes first, then medium, then
/// low; ties go to the soonest due date (tasks without one last), then to the newest. With it off the order is
/// the one the list always had: soonest due first, then newest.
export function orderTodos(items, byPriority = true) {
  const dueOf = (t) => t.due || Infinity;
  return [...items].sort((a, b) => {
    if (Boolean(a.done) !== Boolean(b.done)) return Number(Boolean(a.done)) - Number(Boolean(b.done));
    if (a.done && b.done) return (b.doneAt || b.created || 0) - (a.doneAt || a.created || 0);
    if (byPriority) {
      const d = PRIORITY_RANK[priorityOf(b)] - PRIORITY_RANK[priorityOf(a)];
      if (d) return d;
    }
    if (dueOf(a) !== dueOf(b)) return dueOf(a) < dueOf(b) ? -1 : 1;
    return (b.created || 0) - (a.created || 0);
  });
}
