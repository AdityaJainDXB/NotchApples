// Voxel Wall on Windows (issue #119): music-reactive voxel worlds as a full-screen screensaver (keeps the PC awake; any key or
// mouse move ends it) or as a music wallpaper window that sits behind your other windows on the desktop. The lyrics play word by
// word (or as lines). The windows are made by the Rust side (voxel_show / voxel_hide); this service sends them what to show.
// The scene follows the real sound the PC plays (a listen-only loopback of the speakers, levels.rs; nothing is recorded), and a
// made-up beat if that can't start or Energy Saver is on.

import { load, save } from '../store.js';
import { invoke, listen } from '../native.js';
import * as M from './media.js';
import { wordsShown, stack } from './voxelwalllogic.js';

const T = window.__TAURI__;
export const settings = () => ({
  scene: load('voxel.scene', 0), palette: load('voxel.palette', 'ocean'), lyricMode: load('voxel.lyrics', 'words'),
  intensity: load('voxel.intensity', 1), speed: load('voxel.speed', 1), energySaver: load('voxel.energySaver', false),
});
export function set(key, value) { save(`voxel.${key}`, value); send(true); }
export const wallpaperOn = () => load('voxel.wallpaper', false);

let saver = false, wallpaper = false, timer = null, levelTimer = null, lines = null, key = '', last = '', awakeWasOn = false;

async function currentWords(m) {
  const k = m ? `${m.artist}\u0001${m.title}` : '';
  if (k !== key) { key = k; lines = null; if (m) { const found = await M.lyrics(m).catch(() => null); if (key === k) lines = found && found[0]?.t !== null ? found : null; } }
  if (!m?.playing || !lines) return [];
  const pos = (m.position ?? 0) + 0.3;
  const i = lines.findLastIndex((l) => l.t <= pos);
  if (i < 0) return [];
  const mode = settings().lyricMode;
  if (mode === 'lines') return [lines[i].line || '♪'];
  const words = String(lines[i].line || '♪').split(/\s+/).filter(Boolean);
  return stack(words, wordsShown(lines[i].t, lines[i + 1]?.t ?? null, pos, words.length));
}

async function send(force = false) {
  if (!T || (!saver && !wallpaper)) return;
  const m = M.now();
  const payload = { ...settings(), playing: !!m?.playing, title: m?.title || '', artist: m?.artist || '', words: await currentWords(m).catch(() => []) };
  const json = JSON.stringify(payload);
  if (force || json !== last) { last = json; T.event.emit('voxel-state', payload).catch(() => {}); }
}
function running() {
  if ((saver || wallpaper) && !timer) {
    timer = setInterval(() => send().catch(() => {}), 250);
    levelTimer = setInterval(async () => {
      if (settings().energySaver) return;
      const l = await invoke('voxel_levels').catch(() => null);
      if (l && T) T.event.emit('voxel-levels', l).catch(() => {});
    }, 33);
  }
  if (!saver && !wallpaper && timer) { clearInterval(timer); clearInterval(levelTimer); timer = null; levelTimer = null; }
}

export async function startScreensaver() {
  if (saver) return;
  saver = true;
  awakeWasOn = load('awake.state', { on: false }).on;
  if (!awakeWasOn) invoke('set_keep_awake', { on: true, display: true }).catch(() => {});
  await invoke('voxel_show', { mode: 'saver' }).catch(() => { saver = false; });
  running(); send(true);
}
export function stopScreensaver() {
  if (!saver) return;
  saver = false;
  invoke('voxel_hide', { mode: 'saver' }).catch(() => {});
  if (!awakeWasOn) invoke('set_keep_awake', { on: false, display: false }).catch(() => {});
  running();
}
export async function setWallpaper(on) {
  save('voxel.wallpaper', !!on);
  if (on && !wallpaper) { wallpaper = true; await invoke('voxel_show', { mode: 'wallpaper' }).catch(() => { wallpaper = false; }); }
  if (!on && wallpaper) { wallpaper = false; invoke('voxel_hide', { mode: 'wallpaper' }).catch(() => {}); }
  running(); send(true);
}

export function start() {
  listen('voxel-exit', () => stopScreensaver()).catch(() => {});
  listen('voxel-ready', () => send(true)).catch(() => {});
  if (wallpaperOn()) setWallpaper(true);
}
