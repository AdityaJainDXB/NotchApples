// Counts the text messages you send in Messenger (rooms, nearby, friends, groups): the monthly limit for your plan and 5 in any
// 10 seconds. Kept on this PC, never sent anywhere. The rules are in messengerquotalogic.js.

import { load, save } from '../store.js';
import { can } from '../license.js';
import * as L from './messengerquotalogic.js';

const KEY = 'messenger.quota';
let recent = [];
export const state = { notice: '', blocked: false };

const tier = () => (can(2) ? 2 : can(1) ? 1 : 0);
export const limit = () => L.monthlyLimit(tier());
export const used = () => L.current(load(KEY, null)).used;
export const summary = () => `${used()} of ${limit()} messages this month`;

/** Counts one message about to go. Returns false (and sets `state.notice`) when a limit stops it. */
export function consume(now = Date.now()) {
  const wait = L.burstWait(recent, now);
  if (wait !== null) { state.blocked = true; state.notice = L.burstMessage(wait); return false; }
  const c = L.current(load(KEY, null));
  if (c.used >= limit()) { state.blocked = true; state.notice = L.limitMessage(tier(), limit()); return false; }
  c.used += 1; save(KEY, c);
  recent = [...recent, now].filter((t) => now - t < L.BURST_WINDOW_MS);
  state.blocked = false;
  state.notice = L.isNearLimit(c, limit()) ? `${L.remaining(c, limit())} messages left this month.` : '';
  return true;
}
