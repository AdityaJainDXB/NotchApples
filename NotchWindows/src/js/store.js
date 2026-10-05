// Saved settings and data (localStorage, which WebView2 keeps in the app's own
// data folder), a way to react when a value changes, and small DOM/format helpers.

const watchers = new Map();

export function load(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw === null ? fallback : JSON.parse(raw);
  } catch { return fallback; }
}

export function save(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* storage full or unavailable */ }
  for (const fn of watchers.get(key) || []) { try { fn(value); } catch (e) { console.error(e); } }
}

export function remove(key) {
  try { localStorage.removeItem(key); } catch {}
  for (const fn of watchers.get(key) || []) { try { fn(undefined); } catch {} }
}

/// Read, change and save in one go: update('todo.items', [], (list) => [...list, item]).
export function update(key, fallback, change) {
  const next = change(load(key, fallback));
  save(key, next);
  return next;
}

/// Calls `fn(value)` whenever `key` is saved. Returns a function that stops watching.
export function watch(key, fn) {
  if (!watchers.has(key)) watchers.set(key, new Set());
  watchers.get(key).add(fn);
  return () => watchers.get(key)?.delete(fn);
}

// ---- DOM ----

const PROPS = new Set(['value', 'checked', 'disabled', 'selected', 'indeterminate', 'muted', 'volume']);

/// Builds an element: el('div', { class: 'card', onclick: fn }, child, 'text').
/// Form properties (value, checked, disabled, selected) are set as properties, so
/// `checked: false` really unticks a box.
export function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (PROPS.has(k)) { node[k] = v; continue; }
    if (v === undefined || v === null || v === false) continue;
    if (k === 'class') node.className = v;
    else if (k === 'style' && typeof v === 'object') Object.assign(node.style, v);
    else if (k === 'dataset') Object.assign(node.dataset, v);
    else if (k === 'html') node.innerHTML = v;
    else if (k.startsWith('on') && typeof v === 'function') node.addEventListener(k.slice(2), v);
    else node.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat(Infinity)) {
    if (c === null || c === undefined || c === false) continue;
    node.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return node;
}

export const uid = () => (crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`);

export function debounce(fn, ms) {
  let t;
  return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
}

export const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

// ---- formatting ----

export const fmtBytes = (n) => {
  if (!n && n !== 0) return '—';
  const u = ['B', 'KB', 'MB', 'GB', 'TB'];
  let i = 0, v = Number(n);
  while (v >= 1024 && i < u.length - 1) { v /= 1024; i++; }
  return `${v < 10 && i > 0 ? v.toFixed(1) : Math.round(v)} ${u[i]}`;
};

export const fmtSpeed = (bytesPerSec) => {
  const kb = (bytesPerSec || 0) / 1024;
  return kb < 1000 ? `${Math.round(kb)} KB/s` : `${(kb / 1024).toFixed(1)} MB/s`;
};

/// 75 -> "1:15", 3725 -> "1:02:05"
export function fmtClock(seconds) {
  const s = Math.max(0, Math.floor(seconds || 0));
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), r = s % 60;
  return h ? `${h}:${String(m).padStart(2, '0')}:${String(r).padStart(2, '0')}` : `${m}:${String(r).padStart(2, '0')}`;
}

/// 5400 -> "1 h 30 min"
export function fmtDuration(seconds) {
  const s = Math.max(0, Math.round(seconds || 0));
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60);
  if (h) return m ? `${h} h ${m} min` : `${h} h`;
  if (m) return `${m} min`;
  return `${s} s`;
}

export function timeAgo(ts) {
  const d = (Date.now() - ts) / 1000;
  if (d < 45) return 'just now';
  if (d < 3600) return `${Math.round(d / 60)} min ago`;
  if (d < 86400) return `${Math.round(d / 3600)} h ago`;
  if (d < 7 * 86400) return `${Math.round(d / 86400)} d ago`;
  return new Date(ts).toLocaleDateString([], { day: 'numeric', month: 'short' });
}

export function dayLabel(date) {
  const d = new Date(date), today = new Date();
  const same = (a, b) => a.toDateString() === b.toDateString();
  if (same(d, today)) return 'Today';
  if (same(d, new Date(Date.now() + 864e5))) return 'Tomorrow';
  if (same(d, new Date(Date.now() - 864e5))) return 'Yesterday';
  return d.toLocaleDateString([], { weekday: 'long', day: 'numeric', month: 'short' });
}

export const fmtTime = (d) => new Date(d).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

/// "2026-10-05" in local time.
export const todayKey = (d = new Date()) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
