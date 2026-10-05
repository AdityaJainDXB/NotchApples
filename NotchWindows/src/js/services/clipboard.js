// Clipboard history. The native side watches the clipboard all the time and
// sends a `clipboard` event for each copy; this keeps the list, its limit and
// pins, and skips apps you've chosen to ignore (Pro).

import { load, save, uid } from '../store.js';
import { invoke, listen } from '../native.js';
import { canUse } from '../features.js';

const KEY = 'clipboard.items';
export const FREE_LIMITS = [50, 100, 200, 500, 1000];
export const PRO_LIMITS = [2500, 5000];

export const items = () => load(KEY, []);
export const limit = () => {
  const n = load('clipboard.limit', 200);
  return PRO_LIMITS.includes(n) && !canUse('clipboardUnlimited') ? 1000 : n;
};

let lastApp = '';

export function start() {
  // The app in front when something was copied (for "copied from" and the ignore list).
  listen('foreground', (fg) => { lastApp = fg?.name || ''; });
  invoke('foreground_now').then((fg) => { lastApp = fg?.name || ''; }).catch(() => {});
  invoke('clipboard_pause', { paused: load('clipboard.paused', false) }).catch(() => {});

  listen('clipboard', (clip) => {
    const ignored = canUse('clipboardUnlimited') ? load('clipboard.ignoreApps', []) : [];
    if (lastApp && ignored.some((a) => a.toLowerCase() === lastApp.toLowerCase())) return;
    add({ ...clip, app: lastApp });
  });
}

function sameContent(a, b) {
  if (a.kind !== b.kind) return false;
  if (a.kind === 'text') return a.text === b.text;
  if (a.kind === 'image') return a.image === b.image;
  return JSON.stringify(a.files) === JSON.stringify(b.files);
}

export function add(clip) {
  // Very long copies are kept up to 20,000 characters so storage can't fill up.
  const text = clip.text && clip.text.length > 20000 ? clip.text.slice(0, 20000) : clip.text;
  const now = { id: uid(), at: Date.now(), pinned: false, ...clip, text, truncated: !!(clip.text && clip.text.length > 20000) };
  const list = items();
  const existing = list.find((i) => sameContent(i, now));
  if (existing) { now.pinned = existing.pinned; now.id = existing.id; }
  // Pinned items never count towards the limit.
  const max = limit();
  const out = [], dropped = [];
  let kept = 0;
  for (const i of [now, ...list.filter((x) => !sameContent(x, now))]) {
    if (i.pinned) out.push(i);
    else if (kept < max) { out.push(i); kept++; }
    else dropped.push(i);
  }
  save(KEY, out);
  for (const d of dropped) if (d.image) invoke('clipboard_forget', { path: d.image }).catch(() => {});
}

export function removeItem(id) {
  const list = items();
  const gone = list.find((i) => i.id === id);
  save(KEY, list.filter((i) => i.id !== id));
  if (gone?.image) invoke('clipboard_forget', { path: gone.image }).catch(() => {});
}

export function togglePin(id) {
  save(KEY, items().map((i) => (i.id === id ? { ...i, pinned: !i.pinned } : i)));
}

export function clearAll({ keepPinned = true } = {}) {
  const list = items();
  for (const i of list) if (i.image && !(keepPinned && i.pinned)) invoke('clipboard_forget', { path: i.image }).catch(() => {});
  save(KEY, keepPinned ? list.filter((i) => i.pinned) : []);
}

export function setPaused(paused) {
  save('clipboard.paused', paused);
  return invoke('clipboard_pause', { paused });
}

/// Puts an item back on the clipboard.
export async function copy(item) {
  if (item.kind === 'image') return invoke('clipboard_copy_image', { path: item.image });
  if (item.kind === 'files') return invoke('clipboard_copy_text', { text: item.files.join('\r\n') });
  return invoke('clipboard_copy_text', { text: item.text });
}

/// Copies it and pastes it into the app you were using.
export async function paste(item) {
  const { collapse } = await import('../app.js');
  await collapse();
  if (item.kind === 'image') { await copy(item); return invoke('paste_now'); }
  return invoke('paste_text', { text: item.kind === 'files' ? item.files.join('\r\n') : item.text });
}
