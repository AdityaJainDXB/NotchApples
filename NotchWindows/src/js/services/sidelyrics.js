// Lyrics on the side of your screen (Pro): a small click-through overlay window ("lyrics-overlay", created by
// the Rust side) shows the current line of the song with the line before and the next two. This service drives
// it in the background, whether or not the Now Playing tab is open: it watches the song, finds the lyrics
// (services/media.js, lrclib.net) and sends the page `lyrics-overlay` events whenever the current line changes.

import { load, save } from '../store.js';
import { invoke, listen } from '../native.js';
import { canUse } from '../features.js';
import * as M from './media.js';

const listeners = new Set();
export const onChange = (fn) => { listeners.add(fn); return () => listeners.delete(fn); };
const changed = () => { listeners.forEach((fn) => { try { fn(); } catch {} }); tick(); };

export const isOn = () => load('lyrics.side', false);
export const side = () => (load('lyrics.sideSide', 'left') === 'right' ? 'right' : 'left');
export function setOn(on) { save('lyrics.side', !!on); changed(); }
export function setSide(s) { save('lyrics.sideSide', s === 'right' ? 'right' : 'left'); changed(); }

let shown = null;      // the side the overlay window is on, or null when it is closed
let lines = null;      // synced lines of the current song, or null
let key = '';
let last = '';         // the last payload sent, as JSON
let lastPayload = { prev: '', current: '', next: [], playing: false, side: 'left' };

const T = window.__TAURI__;
function send(payload) {
  lastPayload = payload;
  if (T) T.event.emit('lyrics-overlay', payload).catch(() => {});
  else window.__mock?.emit('lyrics-overlay', payload);   // dev page: no second window, but the event is observable
}
const text = (l) => (l ? l.line || '♪' : '');

async function tick() {
  const want = isOn() && canUse('lyrics');
  if (!want) {
    if (shown) { shown = null; last = ''; invoke('lyrics_overlay_hide').catch(() => {}); }
    return;
  }
  if (shown !== side()) { shown = side(); invoke('lyrics_overlay_show', { side: shown }).catch(() => {}); }

  const m = M.now();
  const k = m ? `${m.artist}\u0001${m.title}` : '';
  if (k !== key) {
    key = k; lines = null;
    if (m) {
      const found = await M.lyrics(m).catch(() => null);
      if (key !== k) return;
      lines = found && found[0]?.t !== null ? found : null;
    }
  }
  let payload = { prev: '', current: '', next: [], playing: false, side: side() };
  if (m?.playing && lines) {
    const pos = (m.position ?? 0) + 0.3;
    const i = lines.findLastIndex((l) => l.t <= pos);
    payload = { prev: text(lines[i - 1]), current: i >= 0 ? text(lines[i]) : '', next: [lines[i + 1], lines[i + 2]].filter(Boolean).map(text), playing: true, side: side() };
  }
  const json = JSON.stringify(payload);
  if (json !== last) { last = json; send(payload); }
}

export function start() {
  // A freshly opened overlay page asks for the current state, so it never starts blank.
  listen('lyrics-overlay-ready', () => send(lastPayload)).catch(() => {});
  setInterval(() => tick().catch(() => {}), 400);
  tick().catch(() => {});
}
