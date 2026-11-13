// Desktop widgets (Ultimate): small windows on the desktop for the clock, your to-dos and Now Playing, created by the
// Rust side (widget_show). This service opens the ones the user switched on in Settings, closes the others (or all of
// them if Ultimate lapses), remembers where each was dragged to, and sends the to-do and song pages what they show.

import { load, save } from '../store.js';
import { invoke, listen } from '../native.js';
import { canUse } from '../features.js';
import { enabled, KINDS } from './desktopwidgetlogic.js';
import * as M from './media.js';
import * as R from './reminders.js';

const T = window.__TAURI__;
const shown = new Set();
let last = '';

export const isOn = (kind) => load('widgets.on', []).includes(kind);
export function setOn(kind, on) {
  const set = new Set(load('widgets.on', []));
  if (on) set.add(kind); else set.delete(kind);
  save('widgets.on', KINDS.filter((k) => set.has(k)));
  tick();
}

function send() {
  if (!T) return;
  const m = M.now();
  const payload = { todo: R.todos().map((t) => ({ text: t.text, done: !!t.done })), media: m ? { title: m.title, artist: m.artist, playing: !!m.playing } : null };
  const json = JSON.stringify(payload);
  if (json !== last) { last = json; T.event.emit('widget-data', payload).catch(() => {}); }
}

function tick() {
  const want = canUse('desktopWidgets') ? enabled(load('widgets.on', [])) : [];
  want.forEach((kind, index) => {
    if (shown.has(kind)) return;
    shown.add(kind);
    const pos = load(`widgets.pos.${kind}`, null);
    invoke('widget_show', { kind, index, x: pos?.x ?? null, y: pos?.y ?? null }).catch(() => shown.delete(kind));
  });
  for (const kind of [...shown]) if (!want.includes(kind)) { shown.delete(kind); invoke('widget_hide', { kind }).catch(() => {}); }
  if (shown.size) send();
}

export function start() {
  // A freshly opened widget asks for the current state, so it never starts blank.
  listen('widget-ready', () => { last = ''; send(); }).catch(() => {});
  setInterval(tick, 1000);
  tick();
}
