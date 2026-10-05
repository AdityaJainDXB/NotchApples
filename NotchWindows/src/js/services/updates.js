// Updates, like the Mac app's: check GitHub for a newer Windows release at
// startup and every six hours, tell you once per version, and install it from
// Settings → General (the download is checked against GitHub's SHA-256).

import { load, save } from '../store.js';
import { invoke, notify } from '../native.js';
import { provide, refresh } from '../activity.js';
import { pref } from '../prefs.js';

let available = null;
let checkedAt = 0;
let lastError = null;

export const status = () => ({ available, checkedAt, error: lastError });

export async function check() {
  try {
    available = await invoke('update_check');
    lastError = null;
  } catch (e) { lastError = e.message; }
  checkedAt = Date.now();
  if (available && load('updates.notified', '') !== available.version) {
    save('updates.notified', available.version);
    notify('Notch apple update', `Version ${available.version} is ready. Open Settings → General to install it.`);
  }
  refresh();
  return status();
}

export async function install() {
  if (!available) throw new Error('No update to install.');
  await invoke('update_install', { url: available.url, sha256: available.sha256, size: available.size });
}

export function start() {
  setTimeout(() => { if (pref('updates.auto')) check(); }, 30_000);
  setInterval(() => { if (pref('updates.auto')) check(); }, 6 * 3600e3);
  provide('update', 5, () => (available && load('updates.pill', true)
    ? { icon: '⬆', label: 'Update', tab: 'settings', title: `Notch apple ${available.version} is ready` } : null));
}
