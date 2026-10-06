// Now Playing: the native side reads Windows' media controls (Spotify, browsers,
// Media Player…) and sends a `media` event when anything changes. The cover and
// little music bars show on the pill while something plays. Lyrics (Pro) come
// from lrclib.net, the free lyrics database the Mac app uses.

import { load } from '../store.js';
import { invoke, listen, getJSON, notify } from '../native.js';
import { provide, refresh } from '../activity.js';

let current = null;
let receivedAt = 0;
const subscribers = new Set();

export const now = () => {
  if (!current) return null;
  // Move the position on between updates so progress bars glide.
  const extra = current.playing ? (Date.now() - receivedAt) / 1000 : 0;
  return { ...current, position: Math.min(current.duration || Infinity, current.position + extra) };
};

/// Calls fn(media) on every change. Returns an unsubscribe function.
export function subscribe(fn) { subscribers.add(fn); fn(now()); return () => subscribers.delete(fn); }

function set(media) {
  current = media && media.title ? media : null;
  receivedAt = Date.now();
  refresh();
  for (const fn of subscribers) { try { fn(now()); } catch (e) { console.error(e); } }
}

// ---- sleep timer: pause the music after a while (only if something is playing, so it never starts music) ----
let sleepEnd = 0, sleepTimer = null;
export const sleepLeft = () => (sleepEnd ? Math.max(0, Math.round((sleepEnd - Date.now()) / 1000)) : 0);
export function startSleepTimer(minutes) {
  cancelSleepTimer();
  sleepEnd = Date.now() + minutes * 60000;
  sleepTimer = setTimeout(async () => {
    sleepEnd = 0; sleepTimer = null;
    if (now()?.playing) { await control('toggle'); notify('Music paused', 'Your sleep timer ended.'); }
  }, minutes * 60000);
}
export function cancelSleepTimer() { clearTimeout(sleepTimer); sleepTimer = null; sleepEnd = 0; }

export const control = (action, position) => invoke('media_control', { action, position }).catch(() => {});

/// "Spotify.exe" -> "Spotify", "MSEdge" -> "Microsoft Edge"
export function appName(id = '') {
  const known = { msedge: 'Microsoft Edge', chrome: 'Google Chrome', firefox: 'Firefox', spotify: 'Spotify',
    zunemusic: 'Media Player', 'microsoft.zunemusic': 'Media Player', vlc: 'VLC', brave: 'Brave', opera: 'Opera', applemusic: 'Apple Music' };
  const key = id.toLowerCase().replace(/\.exe$/, '').split(/[!_]/)[0].split('\\').pop();
  for (const [k, v] of Object.entries(known)) if (key.includes(k)) return v;
  return key ? key[0].toUpperCase() + key.slice(1) : '';
}

// ---- lyrics ----

const lyricsCache = new Map();

/// Synced lyrics as [{ t: seconds, line }] (or plain lines with t = null), or null.
export async function lyrics(m) {
  if (!m?.title) return null;
  const key = `${m.artist}\u0001${m.title}`;
  if (lyricsCache.has(key)) return lyricsCache.get(key);
  const q = new URLSearchParams({ artist_name: m.artist || '', track_name: m.title });
  if (m.album) q.set('album_name', m.album);
  if (m.duration) q.set('duration', String(Math.round(m.duration)));
  let found = null;
  try {
    const j = await getJSON(`https://lrclib.net/api/get?${q}`, { timeout: 12000 });
    found = parse(j);
  } catch {
    try {
      const list = await getJSON(`https://lrclib.net/api/search?${new URLSearchParams({ q: `${m.artist} ${m.title}` })}`, { timeout: 12000 });
      found = parse((list || [])[0]);
    } catch { found = null; }
  }
  lyricsCache.set(key, found);
  return found;
}

function parse(j) {
  if (!j) return null;
  if (j.syncedLyrics) {
    const lines = [];
    for (const raw of j.syncedLyrics.split('\n')) {
      const m = raw.match(/^\[(\d+):(\d+(?:\.\d+)?)\]\s?(.*)$/);
      if (m) lines.push({ t: Number(m[1]) * 60 + Number(m[2]), line: m[3] });
    }
    if (lines.length) return lines;
  }
  if (j.plainLyrics) return j.plainLyrics.split('\n').map((line) => ({ t: null, line }));
  return null;
}

export function start() {
  invoke('media_now').then(set).catch(() => {});
  listen('media', set);
  provide('media', 30, () => {
    const m = now();
    if (!m || !m.playing || !load('media.pill', true)) return null;
    return { art: m.art, icon: m.art ? null : '🎵', bars: true, tab: 'nowplaying', title: `${m.title} — ${m.artist}` };
  });
}
