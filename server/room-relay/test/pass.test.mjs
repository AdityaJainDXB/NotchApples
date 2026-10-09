// The relay's pass check, against passes signed with a throwaway key. Run: node server/room-relay/test/pass.test.mjs
// The relay holds only the public key, so this test swaps in a throwaway public key and checks that a pass from any
// other key, a changed pass, a Pro pass, an expired pass and a full token are all refused.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const src = readFileSync(new URL('../src/relay.js', import.meta.url), 'utf8');
const pair = await crypto.subtle.generateKey({ name: 'Ed25519' }, true, ['sign', 'verify']);
const raw = btoa(String.fromCharCode(...new Uint8Array(await crypto.subtle.exportKey('raw', pair.publicKey))));
const patched = src.replace(/const PUBLIC_KEY = '[^']+';/, `const PUBLIC_KEY = '${raw}';`);
const { passOk } = await import('data:text/javascript;base64,' + Buffer.from(patched).toString('base64'));

const b64u = (b) => btoa(String.fromCharCode(...b)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const mint = async (payload, kind = 'pass1', key = pair.privateKey) => {
  const body = b64u(new TextEncoder().encode(JSON.stringify(payload)));
  return `${kind}.${body}.${b64u(new Uint8Array(await crypto.subtle.sign({ name: 'Ed25519' }, key, new TextEncoder().encode(`NOTCHAPPLE-${kind}\n${body}`))))}`;
};
const now = Math.floor(Date.now() / 1000);
let n = 0; const ok = (name) => { n++; console.log('  ✓ ' + name); };

assert.equal(await passOk(await mint({ t: 2, exp: now + 3600 })), true); ok('an Ultimate pass is accepted');
assert.equal(await passOk(await mint({ t: 1, exp: now + 3600 })), false); ok('a Pro pass is not enough for Clipboard Link');
assert.equal(await passOk(await mint({ t: 2, exp: now - 5 })), false); ok('an expired pass is refused');
assert.equal(await passOk(await mint({ t: 2, exp: now + 3600 }, 'ent1')), false); ok('a full token is not a pass');
const other = await crypto.subtle.generateKey({ name: 'Ed25519' }, true, ['sign', 'verify']);
assert.equal(await passOk(await mint({ t: 2, exp: now + 3600 }, 'pass1', other.privateKey)), false); ok('a pass signed by another key is refused');
const good = await mint({ t: 2, exp: now + 3600 }), [a, , s] = good.split('.');
assert.equal(await passOk(`${a}.${b64u(new TextEncoder().encode(JSON.stringify({ t: 2, exp: now + 9e6 })))}.${s}`), false); ok('a changed pass is refused');
// And a pass minted by the licence server's own code, with the matching private key, is accepted by the relay.
const { mintToken } = await import('../../license-worker/src/worker.js');
const jwk = await crypto.subtle.exportKey('jwk', pair.privateKey);
const real = await mintToken({ SIGNING_KEY: JSON.stringify(jwk) }, 'pass1', { t: 2, exp: now + 3600, r: 'abc' });
assert.equal(await passOk(real), true); ok('a pass from the licence server is accepted by the relay');
for (const junk of ['', 'x', 'pass1..', 'pass1.a.b', null, undefined]) assert.equal(await passOk(junk), false);
ok('junk is refused');
console.log(`\n${n} passed.`);
