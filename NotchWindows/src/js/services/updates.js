// Updates, like the Mac app's: check GitHub for a newer Windows release at
// startup and every six hours, tell you once per version, and install it from
// Settings → Updates (the download is checked against GitHub's SHA-256).
// Like the Mac: a notification once per version, an Update button in the open notch (Not now hides it for
// that version), and Install and restart in Settings → Updates.

import { load, save } from '../store.js';
import { invoke, notify } from '../native.js';
import { provide, refresh } from '../activity.js';
import { pref } from '../prefs.js';
import { mayAnnounce, nextOffer } from './updatecadence.js';

let available = null;
let checkedAt = 0;
let lastError = null;

export const status = () => ({ available, checkedAt, error: lastError });

/// May the newest release be announced now? Always yes unless "Update at most once a week" is on.
export const announce = () => !!available && mayAnnounce({
  weekly: pref('updates.weekly'), lastOffer: load('updates.lastOfferedAt', 0), offeredVersion: load('updates.weeklyOfferedVersion', ''),
  version: available.version, now: Date.now(), required: /\[required-update\]/i.test(available.notes || '') });
export const nextAnnouncement = () => nextOffer(load('updates.lastOfferedAt', 0));
const noteAnnounced = () => { save('updates.lastOfferedAt', Date.now()); save('updates.weeklyOfferedVersion', available.version); };

export async function check() {
  try {
    available = await invoke('update_check');
    lastError = null;
  } catch (e) { lastError = e.message; }
  checkedAt = Date.now();
  if (available && load('updates.notified', '') !== available.version && announce()) {
    save('updates.notified', available.version);
    noteAnnounced();
    notify('Notch apple update', `Version ${available.version} is ready. Open Settings → Updates to install it.`);
  }
  document.dispatchEvent(new CustomEvent('update-available', { detail: available ? { version: available.version, announce: announce() } : null }));
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
  provide('update', 5, () => (available && pref('updates.pill') && announce()
    ? { icon: '⬆', label: 'Update', tab: 'settings', title: `Notch apple ${available.version} is ready` } : null));
}
