// A short code (4 to 8 digits) that unlocks Messenger, as an alternative to Windows Hello. Only a salted hash is kept, on this PC.
// It is a convenience lock for the notch, not a vault. The same rules as the Mac app (LockCodeLogic.swift). No imports, so it is tested alone.

export const MIN = 4;
export const MAX = 8;
/// Wrong tries allowed before the code field waits.
export const FREE_TRIES = 5;

/// Digits only, 4 to 8 of them.
export const isValid = (code) => /^[0-9]{4,8}$/.test(String(code));

/// What the field keeps while you type: digits only, no more than 8.
export const cleaned = (typed) => String(typed).replace(/[^0-9]/g, '').slice(0, MAX);

export const makeSalt = () => [...globalThis.crypto.getRandomValues(new Uint8Array(16))].map((b) => b.toString(16).padStart(2, '0')).join('');

export async function hash(code, salt) {
  const digest = await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(`${salt}:${code}`));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export const matches = async (code, salt, expected) => (await hash(code, salt)) === expected;

/// Seconds to wait after this many wrong tries in a row: none for the first five, then 30, 60, 120 … up to 15 minutes.
export const lockoutSeconds = (failures) => (failures < FREE_TRIES ? 0 : Math.min(900, 30 * 2 ** Math.min(failures - FREE_TRIES, 5)));

/// Where the code lives: a salt and a hash in the given storage (localStorage in the app).
export function createStore(storage = globalThis.localStorage) {
  const K = { salt: 'lock.code.salt', hash: 'lock.code.hash', fails: 'lock.code.failures', until: 'lock.code.waitUntil' };
  const get = (k) => { try { return storage.getItem(k); } catch { return null; } };
  const put = (k, v) => { try { storage.setItem(k, String(v)); } catch { /* storage unavailable */ } };
  const del = (k) => { try { storage.removeItem(k); } catch { /* storage unavailable */ } };
  const waitRemaining = (now = Date.now()) => { const until = Number(get(K.until) || 0); return until > now ? Math.ceil((until - now) / 1000) : 0; };
  return {
    isSet: () => get(K.hash) !== null,
    /// False when the code isn't valid.
    async set(code) {
      if (!isValid(code)) return false;
      const salt = makeSalt();
      put(K.salt, salt); put(K.hash, await hash(code, salt)); del(K.fails); del(K.until);
      return true;
    },
    clear() { Object.values(K).forEach(del); },
    waitRemaining,
    /// True when this is the right code. Counts nothing either way, so a half-typed code is not a wrong try.
    async isRight(code, now = Date.now()) {
      const salt = get(K.salt), stored = get(K.hash);
      return waitRemaining(now) === 0 && salt !== null && stored !== null && matches(code, salt, stored);
    },
    /// Checks a typed code. A wrong one counts toward the wait; a right one resets it. Nothing is checked while waiting.
    async check(code, now = Date.now()) {
      const salt = get(K.salt), stored = get(K.hash);
      if (waitRemaining(now) > 0 || salt === null || stored === null) return false;
      if (await matches(code, salt, stored)) { del(K.fails); del(K.until); return true; }
      const failures = Number(get(K.fails) || 0) + 1;
      put(K.fails, failures);
      const wait = lockoutSeconds(failures);
      if (wait > 0) put(K.until, now + wait * 1000);
      return false;
    },
  };
}
