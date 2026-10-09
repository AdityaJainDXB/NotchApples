// Server-held paid content, the rules (the same as the Mac's EntitlementLogic.swift, with the same test vectors): checking
// that a token from the licence server is genuine and unexpired, when to renew it, and the pack format that carries a
// few small files in one download. No network here, so it is tested on its own (tests/entitle.test.mjs).

const b64uDecode = (s) => {
  const t = String(s).replace(/-/g, '+').replace(/_/g, '/');
  return Uint8Array.from(atob(t + '==='.slice((t.length + 3) % 4)), (c) => c.charCodeAt(0));
};

/// A token is "<kind>.<payload>.<signature>", signed over "NOTCHAPPLE-<kind>\n<payload>". `verifySig(sig, msg)` checks an
/// Ed25519 signature against the licence public key. Returns { tier, exp } (exp in seconds) or null.
export async function verifyToken(token, kind, verifySig, nowSec = Math.floor(Date.now() / 1000)) {
  const parts = String(token || '').split('.');
  if (parts.length !== 3 || parts[0] !== kind) return null;
  try {
    const msg = new TextEncoder().encode(`NOTCHAPPLE-${kind}\n${parts[1]}`);
    if (!(await verifySig(b64uDecode(parts[2]), msg))) return null;
    const p = JSON.parse(new TextDecoder().decode(b64uDecode(parts[1])));
    if (![1, 2].includes(p.t) || !(Number(p.exp) > nowSec)) return null;
    return { tier: p.t, exp: Number(p.exp) };
  } catch { return null; }
}

/// Renew when less than 12 hours are left, so a token is never used in its last hours.
export const needsRenewal = (expSec, nowSec = Math.floor(Date.now() / 1000)) => !expSec || expSec - nowSec < 12 * 3600;

/// NKP1: 'NKP1', file count (u16), then per file: name length (u8), name, data length (u32), data. Big-endian.
/// Names are plain file names. Returns [{ name, data }] or null if the pack is damaged.
export function parsePack(bytes) {
  const b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  if (b.length < 6 || b[0] !== 0x4E || b[1] !== 0x4B || b[2] !== 0x50 || b[3] !== 0x31) return null;
  const count = (b[4] << 8) | b[5], out = [];
  let i = 6;
  for (let f = 0; f < count; f++) {
    if (i >= b.length) return null;
    const n = b[i++];
    if (i + n + 4 > b.length) return null;
    const name = new TextDecoder().decode(b.slice(i, i + n)); i += n;
    const len = ((b[i] * 2 ** 24) + (b[i + 1] << 16) + (b[i + 2] << 8) + b[i + 3]); i += 4;
    if (i + len > b.length) return null;
    if (!/^[A-Za-z0-9._-]+$/.test(name) || name.startsWith('.')) return null;
    out.push({ name, data: b.slice(i, i + len) }); i += len;
  }
  return i === b.length ? out : null;
}
