// Desktop widgets: the pure rules, the same as the Mac's DesktopWidgetLogic.swift (the Swift tests are the specification).

export const KINDS = ['clock', 'todo', 'nowplaying'];
export const TITLES = { clock: 'Clock', todo: 'To-do', nowplaying: 'Now Playing' };

/// Only widgets the user switched on, in the fixed order of KINDS.
export const enabled = (raw) => { const set = new Set(Array.isArray(raw) ? raw : []); return KINDS.filter((k) => set.has(k)); };

/// Open tasks only, in the order given, at most `limit`, plus how many more there are.
export function todoLines(items, limit = 5) {
  const open = (Array.isArray(items) ? items : []).filter((t) => t && !t.done);
  return { shown: open.slice(0, limit), more: Math.max(0, open.length - limit) };
}

/// What the Now Playing widget says. Nothing playing is a calm message, not an empty box.
export function nowPlayingText(title, artist, playing) {
  if (!title || !String(title).trim()) return { line1: 'Nothing playing', line2: '' };
  const a = String(artist || '').trim();
  return { line1: title, line2: playing ? a : (a ? `${a} \u00b7 paused` : 'Paused') };
}

/// A saved position that is still on a screen is kept (a window that is mostly off every screen is not).
export function positionOnScreen(x, y, w, h, screens) {
  if (!Number.isFinite(x) || !Number.isFinite(y)) return false;
  return screens.some((s) => x + Math.min(w, 60) <= s.x + s.w && x + w - Math.min(w, 60) >= s.x && y >= s.y && y + Math.min(h, 40) <= s.y + s.h);
}
