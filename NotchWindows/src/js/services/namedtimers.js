// Reads what you type for a named timer: "Pasta 10m", "Tea 3 min", "Egg 1:30", "Laundry for 45", "1h30m".
// A bare number is minutes. The same rules and test vectors as the Mac's NamedTimerLogic.swift.

export const MAX_SECONDS = 24 * 3600;
export const DEFAULT_NAME = 'Timer';

const BOUNDARY = '(?<![\\p{L}\\p{N}:.])';
const UNIT = '(?:hours?|hrs?|h|minutes?|mins?|m|seconds?|secs?|s)';
const PATTERNS = [
  [new RegExp(`${BOUNDARY}(\\d{1,2}):(\\d{2})(?::(\\d{2}))?$`, 'u'), (m) => (m[3] !== undefined ? +m[1] * 3600 + +m[2] * 60 + +m[3] : +m[1] * 60 + +m[2])],
  [new RegExp(`${BOUNDARY}((?:\\d+(?:\\.\\d+)?\\s*${UNIT}\\s*)+)$`, 'u'), (m) => {
    let total = 0;
    for (const t of m[1].toLowerCase().matchAll(/(\d+(?:\.\d+)?)\s*([a-z]+)/g)) total += parseFloat(t[1]) * (t[2].startsWith('h') ? 3600 : t[2].startsWith('m') ? 60 : 1);
    return Math.round(total);
  }],
  [new RegExp(`${BOUNDARY}(\\d+)$`, 'u'), (m) => +m[1] * 60],
];

/// "Pasta 10m" → { name: 'Pasta', seconds: 600 }. null when there is no usable time (none, zero, or over 24 hours).
export function parse(input) {
  const s = String(input ?? '').trim();
  if (!s) return null;
  for (const [re, toSeconds] of PATTERNS) {
    const m = re.exec(s);
    if (!m) continue;
    const total = toSeconds(m);
    if (!(total > 0) || total > MAX_SECONDS) return null;
    let name = s.slice(0, m.index).trim();
    for (const tail of [' for', ' -', ' –', ':']) if (name.toLowerCase().endsWith(tail)) name = name.slice(0, -tail.length).trim();
    if (name.toLowerCase() === 'for') name = '';
    return { name: (name || DEFAULT_NAME).slice(0, 30), seconds: total };
  }
  return null;
}

/// "2:05", "59:59", "1:02:03"
export function clock(seconds) {
  const s = Math.max(0, Math.floor(seconds));
  const p = (n) => String(n).padStart(2, '0');
  return s >= 3600 ? `${Math.floor(s / 3600)}:${p(Math.floor((s % 3600) / 60))}:${p(s % 60)}` : `${Math.floor(s / 60)}:${p(s % 60)}`;
}
