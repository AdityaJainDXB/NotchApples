// Messenger → Friends cryptography against the shared vectors (server/room-relay/test/friends-vectors.json), the same file the
// Mac (FriendsTests.swift) and the relay's own tests check, so all three agree byte for byte.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve, dirname } from 'node:path';
import { loadModule } from './load.mjs';

const C = await loadModule('services/friendscrypto.js');
const V = JSON.parse(readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), '../../server/room-relay/test/friends-vectors.json'), 'utf8'));
const ident = (i) => C.identityFromSeeds(C.unb64u(V.identities[i].signSeed), C.unb64u(V.identities[i].dhSeed));

test('codes: alphabet, normalising, box addresses from the vectors', async () => {
  const code = C.newCode();
  assert.equal(code.length, 10);
  assert.ok([...code].every((c) => C.CODE_ALPHABET.includes(c)));
  assert.equal(C.normalizeCode(` ${code.slice(0, 5).toLowerCase()}-${code.slice(5)} `), code);
  assert.equal(C.normalizeCode('oiL0123456'), '0110123456');
  assert.equal(C.normalizeCode('short'), null);
  assert.equal(C.normalizeCode('ABCDEFGHIU'), null);   // U is not in the alphabet
  assert.equal(C.displayCode('ABCDEFGHJK'), 'ABCDE-FGHJK');
  assert.equal(new Set(Array.from({ length: 200 }, () => C.newCode())).size, 200);
  for (const c of V.codes) assert.equal(await C.boxOf(c.code), c.box);
});

test('identities: public keys and fingerprints match the vectors', async () => {
  for (let i = 0; i < 2; i++) {
    const id = await ident(i);
    assert.equal(C.b64u(id.signPub), V.identities[i].signPub);
    assert.equal(C.b64u(id.dhPub), V.identities[i].dhPub);
    assert.equal(C.b64u(await C.fingerprint(id.signPub, id.dhPub)), V.identities[i].fingerprint);
  }
});

test('server authentication: the message, the header and a signature the Mac made all verify', async () => {
  const a = await ident(0), au = V.auth;
  assert.equal(await C.authMessage(au.method, au.path, au.ts, au.body), au.message);
  assert.equal(await C.authHeader(a, au.method, au.path, au.ts, au.body), au.header);   // Ed25519 is deterministic
  assert.ok(await C.verify(a.signPub, au.message, au.header.split('.')[1]));
  assert.ok(!(await C.verify(a.signPub, au.message + 'x', au.header.split('.')[1])));
});

test('send tokens: the hash is the vector, and new tokens are random', async () => {
  assert.equal(await C.tokenHash(V.tokenHash.token), V.tokenHash.hash);
  const t = await C.newToken();
  assert.equal(C.unb64u(t.token).length, 32);
  assert.equal(t.hash, await C.tokenHash(t.token));
});

test('safety number: the vector, the same from both sides, 12 groups of 5 digits', async () => {
  const a = await ident(0), b = await ident(1);
  assert.equal(await C.safetyNumber(a, b), V.safetyNumber);
  assert.equal(await C.safetyNumber(b, a), V.safetyNumber);
  assert.match(V.safetyNumber, /^(\d{5} ){11}\d{5}$/);
});

test('sealing: the blob made by the other clients opens, the kind and the box are authenticated, and a flipped bit is refused', async () => {
  const s = V.seal, a = await ident(s.sender), b = await ident(s.recipient);
  const opened = await C.open(b, s.recipientBox, s.kind, s.blob);
  assert.equal(opened.text, s.bodyText);
  assert.deepEqual(opened.body, s.body);
  assert.ok(await C.sealedBy(a.signPub, s.recipientBox, s.kind, opened));
  assert.ok(!(await C.sealedBy(b.signPub, s.recipientBox, s.kind, opened)), 'only the sender signed it');
  assert.equal(await C.open(b, s.recipientBox, 'req', s.blob), null, 'the kind is authenticated');
  assert.equal(await C.open(b, await C.boxOf('ZZZZZZZZZZ'), s.kind, s.blob), null, 'so is the box');
  assert.equal(await C.open(a, s.recipientBox, s.kind, s.blob), null, 'the wrong key cannot open it');
  const raw = C.unb64u(s.blob); raw[raw.length - 3] ^= 1;
  assert.equal(await C.open(b, s.recipientBox, s.kind, C.b64u(raw)), null);
});

test('sealing with the vector\'s fixed inputs gives the vector\'s bytes, and a fresh seal round-trips', async () => {
  const s = V.seal, a = await ident(s.sender), b = await ident(s.recipient);
  const mine = await C.seal(a, { box: s.recipientBox, dh: b.dhPub }, s.kind, s.body, { ephSeed: C.unb64u(s.ephSeed), nonce: C.unb64u(s.nonce) });
  assert.equal(mine, s.blob);
  const fresh = await C.seal(a, { box: s.recipientBox, dh: b.dhPub }, 'msg', { t: 'msg', id: '1', text: 'héllo ✓ "quoted" \\ /' });
  assert.notEqual(fresh, await C.seal(a, { box: s.recipientBox, dh: b.dhPub }, 'msg', { t: 'msg', id: '1', text: 'héllo ✓ "quoted" \\ /' }), 'a fresh ephemeral key every time');
  const back = await C.open(b, s.recipientBox, 'msg', fresh);
  assert.equal(back.body.text, 'héllo ✓ "quoted" \\ /');
  assert.ok(await C.sealedBy(a.signPub, s.recipientBox, 'msg', back));
});
