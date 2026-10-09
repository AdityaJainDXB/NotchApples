// "Update at most once a week", the same rules as the Mac app's UpdateCadenceLogic.swift (and the same test vectors).
// Off by default. With it on, the notification, the Update button and the pill appear for the newest version once a
// week instead of for every release. A required (security) release is always announced, and the version already
// on offer stays visible until it is installed or skipped.

export const WEEK = 7 * 86_400_000;

/// May this release be announced now? `lastOffer` is a timestamp in ms (0 or null = never).
export function mayAnnounce({ weekly, lastOffer, offeredVersion, version, now, required = false }) {
  if (required || !weekly) return true;
  if (version === offeredVersion) return true;
  if (!lastOffer) return true;
  return now - lastOffer >= WEEK;
}

/// When the next announcement can happen with the switch on (a timestamp in ms), or null.
export const nextOffer = (lastOffer) => (lastOffer ? lastOffer + WEEK : null);
