// Klick (Pro), like the Mac's: every key you type on this PC plays a mechanical keyboard sound. The Rust side
// (klick.rs) only says that a key went down or up and whether it was the space bar or Enter; nothing you type is
// read. Sounds are the same small WAV files the Mac app uses (scripts/klick_sounds.py), played with Web Audio.

import { load, save } from '../store.js';
import { invoke, listen } from '../native.js';
import { canUse } from '../features.js';
import { download } from './entitle.js';
import { parsePack } from './entitlelogic.js';

export const PACKS = [
  { id: 'mechanical', name: 'Mechanical', blurb: 'The classic clacky keyboard: a sharp click, a hard clack and a crisp release.', icon: '⌨️' },
  { id: 'cream', name: 'Cream', blurb: 'Deep, smooth thock. Linear, like NovelKeys Creams.', icon: '💧' },
  { id: 'holypanda', name: 'Holy Panda', blurb: 'Bassy and tactile, with a bump on the way down.', icon: '🐼' },
  { id: 'blue', name: 'Blue', blurb: "Loud and clicky. Everyone will know you're typing.", icon: '⚡' },
  { id: 'red', name: 'Red', blurb: 'Light, quick and linear. Higher and softer.', icon: '🔥' },
  { id: 'brown', name: 'Brown', blurb: 'A gentle tactile bump, quieter than Blue.', icon: '🍂' },
  { id: 'topre', name: 'Topre', blurb: 'Muted, rounded thock of rubber domes.', icon: '⚫' },
  { id: 'typewriter', name: 'Typewriter', blurb: 'Metal clack, and a bell on Enter.', icon: '📜' },
  { id: 'bubble', name: 'Bubble', blurb: 'Playful pops. Not a real switch, just fun.', icon: '🫧' },
  // Premium sounds are not in the app: they download from the licence server with a real key, and are kept on this PC.
  { id: 'cherryblack', name: 'Cherry MX Black', blurb: 'Deep, heavy linear. A smooth, low thock.', icon: '☁️', remote: true },
  { id: 'gateronink', name: 'Gateron Ink', blurb: 'Creamy and rounded, a softer thock than Cream.', icon: '☁️', remote: true },
  { id: 'alps', name: 'Alps', blurb: 'Crisp and clicky, with a bright snap.', icon: '☁️', remote: true },
  { id: 'modelm', name: 'Buckling spring', blurb: 'The loud, ringing click of an old IBM keyboard.', icon: '☁️', remote: true },
];

// ---- premium packs
const b64 = (u8) => { let s = ''; for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode(...u8.subarray(i, i + 0x8000)); return btoa(s); };
const unb64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
export const isRemote = (id) => !!PACKS.find((p) => p.id === id)?.remote;
export const available = (id) => !isRemote(id) || !!load(`klick.remote.${id}`, null);
const downloading = new Set(), problems = {};
export const isDownloading = (id) => downloading.has(id);
export const problem = (id) => problems[id] || '';

/// Downloads a premium pack (the server gives it only to a real key). Resolves true when it is on this PC.
export async function fetchRemote(id) {
  if (available(id)) return true;
  if (downloading.has(id)) return false;
  downloading.add(id); delete problems[id]; changed();
  try {
    const files = parsePack(await download(`klick/${id}.pack`));
    if (!files || !files.some((f) => f.name === 'down1.wav')) throw new Error('The download was damaged. Try again.');
    save(`klick.remote.${id}`, Object.fromEntries(files.map((f) => [f.name, b64(f.data)])));
    buffers.forEach((_, key) => { if (key.startsWith(`${id}/`)) buffers.delete(key); });
    return true;
  } catch (e) { problems[id] = e.message; return false; }
  finally { downloading.delete(id); changed(); }
}

const listeners = new Set();
export const onChange = (fn) => { listeners.add(fn); return () => listeners.delete(fn); };
const changed = () => listeners.forEach((fn) => { try { fn(); } catch {} });

export const isOn = () => load('klick.on', false);
export const packId = () => { const id = load('klick.pack', 'cream'); return PACKS.some((p) => p.id === id) && available(id) ? id : 'cream'; };
export const keyUp = () => load('klick.keyUp', true);
export const volume = (id) => load('klick.volumes', {})[id] ?? 0.6;
export function setVolume(id, v) { save('klick.volumes', { ...load('klick.volumes', {}), [id]: Math.min(1, Math.max(0, v)) }); }
export function setKeyUp(on) { save('klick.keyUp', on); }
export let lastKey = 0;

// ---- audio
let ctx = null;
const buffers = new Map();   // "pack/name" → AudioBuffer
async function buffer(pack, name) {
  const key = `${pack}/${name}`;
  if (buffers.has(key)) return buffers.get(key);
  const p = (async () => {
    ctx ??= new AudioContext();
    if (isRemote(pack)) {
      const data = load(`klick.remote.${pack}`, {})[`${name}.wav`];
      if (!data) return null;
      const bytes = unb64(data);
      return ctx.decodeAudioData(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
    }
    const res = await fetch(`sounds/klick/${pack}/${name}.wav`);
    return ctx.decodeAudioData(await res.arrayBuffer());
  })().catch(() => null);
  buffers.set(key, p);
  return p;
}
async function preload(pack) { await Promise.all(['down1', 'down2', 'down3', 'up', 'space', 'enter'].map((n) => buffer(pack, n))); }

let variant = 0;
/// Plays one of the current pack's sounds: "key" (one of three key-downs), "up", "space" or "enter".
export async function play(kind, pack = packId()) {
  let name = kind;
  if (kind === 'key') { variant = (variant + 1 + Math.floor(Math.random() * 2)) % 3; name = `down${variant + 1}`; }
  const b = await buffer(pack, name);
  if (!b || !ctx) return;
  if (ctx.state === 'suspended') ctx.resume().catch(() => {});
  const src = ctx.createBufferSource(), g = ctx.createGain();
  src.buffer = b; g.gain.value = volume(pack);
  src.connect(g); g.connect(ctx.destination); src.start();
  if (kind !== 'up') { lastKey = performance.now(); changed(); }
}

/// A few keys of a pack, to hear it before choosing it.
export async function preview(id) {
  if (isRemote(id) && !available(id)) { if (!(await fetchRemote(id))) return; }
  save('klick.pack', id); preload(id); changed();
  ['key', 'key', 'up', 'key', 'space'].forEach((k, i) => setTimeout(() => play(k, id), i * 110));
}

// ---- on and off
let unlisten = null;
export async function apply() {
  const want = isOn() && canUse('klick');
  invoke('klick_set', { on: want }).catch(() => {});
  if (want && !unlisten) {
    preload(packId());
    unlisten = await listen('klick', (e) => { if (e.down) play(e.kind); else if (keyUp()) play('up'); });
  } else if (!want && unlisten) { unlisten(); unlisten = null; }
  changed();
}
export function setOn(on) { save('klick.on', on); apply(); }

export async function start() {
  // New in 1.37.0: show the tab once for people who already chose their tabs (it explains Pro until unlocked).
  if (!load('klick.introduced', false)) {
    save('klick.introduced', true);
    const enabled = load('modules.enabled', null);
    if (Array.isArray(enabled) && !enabled.includes('klick')) (await import('../app.js')).setEnabled('klick', true);
  }
  apply();
  // Unlocking or losing Pro switches it on or off without a restart.
  addEventListener('tierchange', () => apply());
}
