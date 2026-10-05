// Screen Time (Pro): the native side counts how long each app is in front (only
// while you're at the PC). Daily limits warn you, and optionally minimise the
// app; during a Focus session, apps you choose are minimised straight away.

import { load, todayKey } from '../store.js';
import { invoke, listen, notify } from '../native.js';
import { canUse } from '../features.js';

export const limits = () => load('screentime.limits', {}); // app name -> minutes
export const blockList = () => load('screentime.block', []); // app names blocked during Focus

export const usage = () => invoke('screen_time').catch(() => ({}));

const warned = new Set();

async function check(fg) {
  if (!canUse('screenTime') || !fg?.name) return;
  const name = fg.name;
  // Focus blocking.
  const focus = await import('./focus.js');
  if (focus.focusing() && blockList().some((a) => a.toLowerCase() === name.toLowerCase())) {
    invoke('minimize_external').catch(() => {});
    notify('Focus', `${name} is blocked until your focus session ends.`);
    return;
  }
  // Daily limits.
  const limit = limits()[name];
  if (!limit) return;
  const today = (await usage())[todayKey()] || {};
  const used = Math.round((today[name] || 0) / 60);
  const key = `${todayKey()}|${name}`;
  if (used >= limit) {
    if (!warned.has(key)) { warned.add(key); notify('Screen Time', `You've used ${name} for ${used} min today (limit ${limit} min).`); }
    if (load('screentime.enforce', false)) invoke('minimize_external').catch(() => {});
  } else if (used >= limit - 5 && !warned.has(`${key}|soon`)) {
    warned.add(`${key}|soon`);
    notify('Screen Time', `5 minutes left on ${name} today.`);
  }
}

export function start() {
  let current = null;
  listen('foreground', (fg) => { current = fg; check(fg); });
  setInterval(() => current && check(current), 60_000);
}
