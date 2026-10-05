// Mic and camera in use, like the Mac's privacy indicator: the native side reads
// the same registry keys Windows uses for its own taskbar icon.

import { load } from '../store.js';
import { invoke, listen } from '../native.js';
import { provide, refresh } from '../activity.js';

let now = { microphone: [], camera: [] };
const subscribers = new Set();
export const state = () => now;
export function subscribe(fn) { subscribers.add(fn); fn(now); return () => subscribers.delete(fn); }

function set(p) {
  now = p || { microphone: [], camera: [] };
  refresh();
  for (const fn of subscribers) fn(now);
}

export function start() {
  invoke('privacy_now').then(set).catch(() => {});
  listen('privacy', set);
  provide('privacy', 25, () => {
    if (!load('privacy.indicator', true)) return null;
    const cam = now.camera.length, mic = now.microphone.length;
    if (!cam && !mic) return null;
    const who = [...new Set([...now.camera, ...now.microphone])].join(', ');
    return { icon: cam ? '📷' : '🎙', label: cam && mic ? 'Cam + mic' : cam ? 'Camera' : 'Mic', tab: 'devices', title: `In use by ${who}` };
  });
}
