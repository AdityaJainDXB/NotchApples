// Notification peek (opt-in): the newest Windows notification flashes beside the pill for a few seconds.
// The native side reads Windows' own notification list (read-only). The first look only finds out where "now" is,
// so old notifications never flash. Nothing is stored (the last few are kept in memory for Settings) or sent.
import { load, save } from '../store.js';
import { invoke } from '../native.js';
import { show } from './hud.js';

export const enabled = () => load('notif.peek', false);

let since = null, timer = null, status = { available: null, reason: '' };
const recent = [];
const subs = new Set();
export const state = () => ({ ...status, recent: [...recent] });
export const subscribe = (fn) => { subs.add(fn); return () => subs.delete(fn); };

const shorten = (t, n) => (t.length > n ? `${t.slice(0, n - 1)}…` : t);

function handle(n) {
  if (/notch/i.test(n.app)) return;   // never echo our own notifications
  recent.unshift(n);
  recent.length = Math.min(recent.length, 10);
  subs.forEach((fn) => fn());
  show({ icon: '🔔', label: shorten(n.title || n.app, 22), title: `${n.app}: ${n.title}${n.body ? ` — ${n.body}` : ''}`, priority: 90 }, 5);
}

async function poll() {
  clearTimeout(timer);
  if (!enabled()) { since = null; return; }
  timer = setTimeout(poll, 4000);
  const r = await invoke('notifications_recent', { since }).catch(() => null);
  if (!r) return;
  status = { available: !!r.available, reason: r.reason || '' };
  subs.forEach((fn) => fn());
  if (!r.available) return;
  if (since === null) { since = r.latest; return; }
  for (const n of r.items) { since = Math.max(since, n.id); handle(n); }
  if (!r.items.length) since = Math.max(since, r.latest);
}

/// Turns the peek on or off. Returns what the first look found, so Settings can say why it can't work.
export async function setEnabled(on) {
  save('notif.peek', on);
  since = null; recent.length = 0;
  if (!on) { clearTimeout(timer); status = { available: null, reason: '' }; return status; }
  await poll();
  if (status.available === false) save('notif.peek', false);   // don't keep trying where it can't work
  return state();
}

export function start() { poll(); }
