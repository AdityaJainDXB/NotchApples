// Server-held content: token checks and the pack format, with tokens from the licence server's own sandbox test
// (server/license-worker/test/fixture.json). Run: node --test NotchWindows/tests
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { loadModule } from './load.mjs';

const E = await loadModule('services/entitlelogic.js');
const fx = JSON.parse(readFileSync(new URL('../../server/license-worker/test/fixture.json', import.meta.url), 'utf8'));
const verifyWith = (publicKeyB64) => async (sig, msg) => {
  const key = await crypto.subtle.importKey('raw', Buffer.from(publicKeyB64, 'base64'), { name: 'Ed25519' }, false, ['verify']);
  return crypto.subtle.verify('Ed25519', key, sig, msg);
};
const verifySig = verifyWith(fx.publicKey);

test('genuine tokens verify', async () => {
  assert.equal((await E.verifyToken(fx.ent, 'ent1', verifySig)).tier, 2);
  assert.equal((await E.verifyToken(fx.pass, 'pass1', verifySig)).tier, 2);
  assert.equal((await E.verifyToken(fx.passPro, 'pass1', verifySig)).tier, 1);
});

test('the wrong kind, expired, changed and foreign-signed tokens fail', async () => {
  assert.equal(await E.verifyToken(fx.pass, 'ent1', verifySig), null);
  assert.equal(await E.verifyToken(fx.ent, 'pass1', verifySig), null);
  assert.equal(await E.verifyToken(fx.expired, 'pass1', verifySig), null);
  const [a, b, c] = fx.pass.split('.');
  assert.equal(await E.verifyToken(`${a}.${b.slice(0, -2)}AA.${c}`, 'pass1', verifySig), null);
  assert.equal(await E.verifyToken('', 'pass1', verifySig), null);
  assert.equal(await E.verifyToken('pass1.a.b', 'pass1', verifySig), null);
  const other = await crypto.subtle.generateKey({ name: 'Ed25519' }, true, ['sign', 'verify']);
  const otherPub = Buffer.from(await crypto.subtle.exportKey('raw', other.publicKey)).toString('base64');
  assert.equal(await E.verifyToken(fx.pass, 'pass1', verifyWith(otherPub)), null);
});

test('renewal happens well before expiry', () => {
  const now = 1_800_000_000;
  assert.equal(E.needsRenewal(0, now), true);
  assert.equal(E.needsRenewal(now + 3600, now), true);
  assert.equal(E.needsRenewal(now + 48 * 3600, now), false);
});

const pack = (files) => {
  const parts = [Buffer.from('NKP1'), Buffer.from([files.length >> 8, files.length & 255])];
  for (const [name, bytes] of files) { const n = Buffer.from(name), h = Buffer.alloc(1 + n.length + 4); h[0] = n.length; n.copy(h, 1); h.writeUInt32BE(bytes.length, 1 + n.length); parts.push(h, Buffer.from(bytes)); }
  return new Uint8Array(Buffer.concat(parts));
};

test('pack files round trip', () => {
  const files = E.parsePack(pack([['down1.wav', [1, 2, 3]], ['up.wav', []], ['space.wav', new Array(300).fill(9)]]));
  assert.deepEqual(files.map((f) => f.name), ['down1.wav', 'up.wav', 'space.wav']);
  assert.deepEqual([...files[0].data], [1, 2, 3]); assert.equal(files[1].data.length, 0); assert.equal(files[2].data.length, 300);
});

test('bad packs are refused', () => {
  assert.equal(E.parsePack(new Uint8Array()), null);
  assert.equal(E.parsePack(new TextEncoder().encode('NOPE1234')), null);
  assert.equal(E.parsePack(pack([['../escape.wav', [1]]])), null);
  assert.equal(E.parsePack(pack([['a/b.wav', [1]]])), null);
  assert.equal(E.parsePack(pack([['.hidden', [1]]])), null);
  assert.equal(E.parsePack(pack([['ok.wav', [1, 2, 3]]]).slice(0, -1)), null);
  assert.equal(E.parsePack(new Uint8Array([...pack([['ok.wav', [1]]]), 0])), null);
});
