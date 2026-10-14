// The rules for the anonymous, opt-in usage count and the feedback box (same as the Mac). Pure, so it is tested.
//   * Nothing is sent unless the person said yes, or presses Send on a note they wrote.
//   * A random install id, the app version, "win", the Windows version and the plan: no name, email, licence or address.
//   * The feedback card is offered two weeks after first use, then every three to four weeks; "Not now" skips it.

export const DAY = 86_400_000;
export const KINDS = ['idea', 'problem', 'praise'];
export const KIND_TITLE = { idea: 'Idea', problem: 'Problem', praise: 'Praise' };
export const KIND_PROMPT = { idea: 'What would you like Notch Apple to do?', problem: 'What went wrong? What were you doing?', praise: 'What do you like?' };

/// 32 lowercase hex characters from a random source (crypto when there is one).
export function newId(rand = () => Math.random()) {
  const bytes = new Uint8Array(16);
  if (globalThis.crypto?.getRandomValues) globalThis.crypto.getRandomValues(bytes); else for (let i = 0; i < 16; i++) bytes[i] = Math.floor(rand() * 256);
  return [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export const validId = (s) => /^[0-9a-f]{32}$/.test(String(s || ''));

/// When the next card is due: the first one two weeks after first use, then every 21 to 28 days.
export const firstDue = (now) => now + 14 * DAY;
export const nextDue = (now, rand = () => Math.random()) => now + (21 + Math.floor(rand() * 8)) * DAY;
export const isDue = (now, dueAt) => dueAt > 0 && now >= dueAt;

/// A ping is due at most every six hours.
export const pingDue = (now, last) => now - last > 6 * 3_600_000;

export function pingBody({ id, version, osVersion, tier }) {
  return { id, v: String(version), os: 'win', osv: String(osVersion || '').replace(/[^0-9A-Za-z. _-]/g, '').slice(0, 24), tier: String(tier ?? 0) };
}

export function noteBody({ id, version, kind, text }) {
  return { id, v: String(version), os: 'win', kind: KINDS.includes(kind) ? kind : 'idea', text: String(text || '').trim().slice(0, 1000) };
}

/// The Windows version from the user agent ("Windows NT 10.0" covers 10 and 11), or ''.
export const windowsVersion = (ua) => (String(ua || '').match(/Windows NT ([0-9.]+)/) || [])[1] || '';

/// Problems go to /telemetry/glitch, ideas and praise to /feedback.
export const endpointFor = (kind) => (kind === 'problem' ? '/telemetry/glitch' : '/feedback');
