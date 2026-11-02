// Friends: the cryptography of docs/FRIENDS_PROTOCOL.md, in plain WebCrypto (no DOM, so Node tests and the Windows app share it).
// X25519 + Ed25519 + HKDF-SHA256 + AES-256-GCM. The Mac app implements the same thing in Swift; both check
// server/room-relay/test/friends-vectors.json, so a change here that is not mirrored there fails a test.

const enc = new TextEncoder(), dec = new TextDecoder();
const subtle = globalThis.crypto.subtle;

export const CODE_ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
export const CODE_LENGTH = 10;
const PKCS8_ED = '302e020100300506032b657004220420', PKCS8_X = '302e020100300506032b656e04220420';

// Built in chunks: spreading a large array into fromCharCode overflows the stack (about 120 KB).
const bin = (bytes) => { let s = ''; for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray ? bytes.subarray(i, i + 0x8000) : bytes.slice(i, i + 0x8000)); return s; };
export const b64u = (bytes) => btoa(bin(bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
export const unb64u = (s) => { const t = String(s).replace(/-/g, '+').replace(/_/g, '/'); return Uint8Array.from(atob(t + '==='.slice((t.length + 3) % 4)), (c) => c.charCodeAt(0)); };
const hex = (bytes) => [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
const unhex = (h) => Uint8Array.from(h.match(/../g) || [], (x) => parseInt(x, 16));
const cat = (...parts) => { const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0)); let o = 0; for (const p of parts) { out.set(p, o); o += p.length; } return out; };
export const sha256 = async (bytes) => new Uint8Array(await subtle.digest('SHA-256', typeof bytes === 'string' ? enc.encode(bytes) : bytes));
export const sha256hex = async (bytes) => hex(await sha256(bytes));

// ---- codes

export function newCode() {
  const r = crypto.getRandomValues(new Uint8Array(CODE_LENGTH));
  return Array.from(r, (b) => CODE_ALPHABET[b % 32]).join('');   // 32 divides 256, so every character is equally likely
}
/** What someone typed, as the canonical code, or null. Case, spaces and dashes don't matter; O reads as 0, I and L as 1. */
export function normalizeCode(typed) {
  const s = String(typed || '').toUpperCase().replace(/[\s\-–—]/g, '').replace(/O/g, '0').replace(/[IL]/g, '1');
  return s.length === CODE_LENGTH && [...s].every((c) => CODE_ALPHABET.includes(c)) ? s : null;
}
export const displayCode = (code) => `${code.slice(0, 5)}-${code.slice(5)}`;
/** The server's address for a code: 32 hex characters, so the server never sees the code itself. */
export async function boxOf(code) { return hex((await sha256(`notchapple-friends-v1|box|${code}`)).slice(0, 16)); }

// ---- identity: two key pairs, kept as 32-byte seeds

async function importSeed(seed, kind, extractable = true) {
  const prefix = unhex(kind === 'sign' ? PKCS8_ED : PKCS8_X);
  return subtle.importKey('pkcs8', cat(prefix, seed), { name: kind === 'sign' ? 'Ed25519' : 'X25519' }, extractable, kind === 'sign' ? ['sign'] : ['deriveBits']);
}
async function publicOf(seed, kind) {
  const jwk = await subtle.exportKey('jwk', await importSeed(seed, kind));
  return unb64u(jwk.x);
}
/** A fresh identity: { signSeed, dhSeed } (secret, 32 bytes each) and { signPub, dhPub }. */
export async function newIdentity() {
  const signSeed = crypto.getRandomValues(new Uint8Array(32)), dhSeed = crypto.getRandomValues(new Uint8Array(32));
  return identityFromSeeds(signSeed, dhSeed);
}
export async function identityFromSeeds(signSeed, dhSeed) {
  return { signSeed, dhSeed, signPub: await publicOf(signSeed, 'sign'), dhPub: await publicOf(dhSeed, 'dh') };
}
export const fingerprint = async (signPub, dhPub) => (await sha256(cat(signPub, dhPub))).slice(0, 16);
/** The 60 digits two friends compare out loud: the same on both sides. */
export async function safetyNumber(a, b) {
  const ka = cat(a.signPub, a.dhPub), kb = cat(b.signPub, b.dhPub);
  const first = hex(ka) < hex(kb) ? [ka, kb] : [kb, ka];
  const h1 = await sha256(cat(...first)), bytes = cat(h1, await sha256(h1));
  const groups = [];
  for (let i = 0; i < 12; i++) {
    const n = ((bytes[i * 4] * 256 + bytes[i * 4 + 1]) * 256 + bytes[i * 4 + 2]) * 256 + bytes[i * 4 + 3];   // a big-endian uint32
    groups.push(String(n % 100000).padStart(5, '0'));
  }
  return groups.join(' ');
}

// ---- signing and server auth

export async function sign(id, text) { return b64u(new Uint8Array(await subtle.sign({ name: 'Ed25519' }, await importSeed(id.signSeed, 'sign'), enc.encode(text)))); }
export async function verify(signPub, text, sigB64u) {
  try { return await subtle.verify({ name: 'Ed25519' }, await subtle.importKey('raw', signPub, { name: 'Ed25519' }, false, ['verify']), unb64u(sigB64u), enc.encode(text)); } catch { return false; }
}
/** The `x-nf-auth` header: "<ts>.<sig>" over METHOD, path, ts and the body's hash. */
export async function authHeader(id, method, path, ts, bodyText = '') {
  return `${ts}.${await sign(id, `nf1\n${method}\n${path}\n${ts}\n${await sha256hex(bodyText)}`)}`;
}
export const authMessage = async (method, path, ts, bodyText = '') => `nf1\n${method}\n${path}\n${ts}\n${await sha256hex(bodyText)}`;

// ---- sealing

async function sealKey(shared, recipientBox, ephPub) {
  const ikm = await subtle.importKey('raw', shared, 'HKDF', false, ['deriveKey']);
  return subtle.deriveKey({ name: 'HKDF', hash: 'SHA-256', salt: enc.encode('notchapple-friends-v1'), info: enc.encode(`seal|${recipientBox}|${b64u(ephPub)}`) },
    ikm, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
}
const aadOf = (box, kind) => enc.encode(`${box}|${kind}`);

/** Seals `body` (an object) to a recipient { box, dh }, signed by `id`. `fixed` ({ephSeed, nonce}) is for test vectors only. */
export async function seal(id, recipient, kind, body, fixed = {}) {
  const ephSeed = fixed.ephSeed || crypto.getRandomValues(new Uint8Array(32));
  const ephPub = await publicOf(ephSeed, 'dh');
  const text = JSON.stringify(body);
  const inner = JSON.stringify({ b: text, s: await sign(id, `nf1-inner\n${recipient.box}\n${kind}\n${text}`) });
  const shared = new Uint8Array(await subtle.deriveBits({ name: 'X25519', public: await subtle.importKey('raw', recipient.dh, { name: 'X25519' }, false, []) }, await importSeed(ephSeed, 'dh'), 256));
  const key = await sealKey(shared, recipient.box, ephPub);
  const nonce = fixed.nonce || crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await subtle.encrypt({ name: 'AES-GCM', iv: nonce, additionalData: aadOf(recipient.box, kind) }, key, enc.encode(inner)));
  return b64u(cat(ephPub, nonce, ct));
}

/** Opens a blob addressed to me. Returns { text, sig, body } (body parsed) or null; the caller then checks the signature with the sender's key. */
export async function open(id, myBox, kind, blob) {
  try {
    const raw = unb64u(blob);
    if (raw.length < 32 + 12 + 16) return null;
    const ephPub = raw.slice(0, 32), nonce = raw.slice(32, 44), ct = raw.slice(44);
    const shared = new Uint8Array(await subtle.deriveBits({ name: 'X25519', public: await subtle.importKey('raw', ephPub, { name: 'X25519' }, false, []) }, await importSeed(id.dhSeed, 'dh'), 256));
    const key = await sealKey(shared, myBox, ephPub);
    const inner = JSON.parse(dec.decode(new Uint8Array(await subtle.decrypt({ name: 'AES-GCM', iv: nonce, additionalData: aadOf(myBox, kind) }, key, ct))));
    if (typeof inner.b !== 'string' || typeof inner.s !== 'string') return null;
    return { text: inner.b, sig: inner.s, body: JSON.parse(inner.b) };
  } catch { return null; }
}
/** True when `opened` was signed by `signPub` for this box and kind. */
export const sealedBy = (signPub, myBox, kind, opened) => verify(signPub, `nf1-inner\n${myBox}\n${kind}\n${opened.text}`, opened.sig);

/** A fresh send token (32 random bytes, base64url) and the hash the server stores for it. */
export async function newToken() { const t = b64u(crypto.getRandomValues(new Uint8Array(32))); return { token: t, hash: await tokenHash(t) }; }
export const tokenHash = async (token) => sha256hex(unb64u(token));
