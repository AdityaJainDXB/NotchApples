// The rules behind Messenger's limits, the same as NotchApple/Core/MessengerQuotaLogic.swift (the Swift tests are the specification):
// 500, 1,000 and 5,000 text messages a month for Free, Pro and Ultimate, and at most 5 in any 10 seconds. Pure functions, no storage.

export const BURST_MAX = 5;
export const BURST_WINDOW_MS = 10000;

/** Messages a month for a tier (0 Free, 1 Pro, 2 Ultimate). */
export const monthlyLimit = (tier) => (tier >= 2 ? 5000 : tier === 1 ? 1000 : 500);

/** "2026-11": the month a count belongs to (local time). */
export const monthKey = (date = new Date()) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;

/** The count for `now`: nothing stored, or a count from an earlier month, starts again at zero. */
export function current(stored, now = new Date()) {
  const month = monthKey(now);
  return stored && stored.month === month && Number.isFinite(stored.used) ? { month, used: stored.used } : { month, used: 0 };
}

export const remaining = (count, limit) => Math.max(0, limit - count.used);
export const isNearLimit = (count, limit) => count.used >= Math.floor(limit * 0.8) && count.used < limit;

/** Seconds to wait before another message may go, or null when one may go now. `recent` holds the times (ms) of the last sends. */
export function burstWait(recent, nowMs) {
  const inWindow = recent.filter((t) => nowMs - t < BURST_WINDOW_MS).sort((a, b) => a - b);
  if (inWindow.length < BURST_MAX) return null;
  const free = inWindow[inWindow.length - BURST_MAX] + BURST_WINDOW_MS;
  return Math.max(1, Math.ceil((free - nowMs) / 1000));
}

export function limitMessage(tier, limit) {
  const base = `You have used all ${limit} messages for this month. They start again on the 1st`;
  return tier >= 2 ? `${base}.` : tier === 1 ? `${base}, or Ultimate gives you 5,000 a month.` : `${base}, or Pro gives you 1,000 a month.`;
}

export const burstMessage = (wait) => `Slow down: 5 messages every 10 seconds. Try again in ${wait} second${wait === 1 ? '' : 's'}.`;
