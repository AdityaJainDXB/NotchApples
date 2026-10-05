// Sandbox test of the whole license flow, with a throwaway signing key, a fake KV and a fake
// blockchain/price/mail. Run: node server/license-worker/test/test.mjs
// Covers Pro and Ultimate checkout, the Pro → Ultimate upgrade, promo codes, recovery,
// the device limit, revocation and the attacks the unique-amount design is meant to stop.
// It also writes a fixture key that the Swift tests verify, so both sides agree on the format.

import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import worker, { parseKey, verifyKey, b32encode, b32decode } from '../src/worker.js';

const pair = await crypto.subtle.generateKey({ name: 'Ed25519' }, true, ['sign', 'verify']);
const jwk = await crypto.subtle.exportKey('jwk', pair.privateKey);
const pubRaw = new Uint8Array(await crypto.subtle.exportKey('raw', pair.publicKey));

const store = new Map();
const meta = new Map();
const KV = {
  async get(k) { return store.has(k) ? store.get(k) : null; },
  async put(k, v, o) { store.set(k, v); if (o?.metadata) meta.set(k, o.metadata); },
  async delete(k) { store.delete(k); meta.delete(k); },
  async list({ prefix, cursor, limit = 1000 }) {
    const names = [...store.keys()].filter((k) => k.startsWith(prefix)).sort();
    const from = Number(cursor || 0), page = names.slice(from, from + limit);
    return { keys: page.map((name) => ({ name, metadata: meta.get(name) })), list_complete: from + limit >= names.length, cursor: String(from + limit) };
  },
};
const mails = [];
const env = {
  KV, SIGNING_KEY: JSON.stringify(jwk), ADMIN_TOKEN: 'admin-test', EMAIL_PEPPER: 'pepper',
  WALLET: 'ltc1qtestwallet', NETWORK: 'testnet', ULTIMATE_ON: '1', TEST_LTC_PRICE: '70', MAIL_LOG: mails,
};

// Fake blockchain: txid -> { paid litoshi to our wallet, confirmed? }
const chain = new Map();
globalThis.fetch = async (url) => {
  if (String(url).includes('litecoinblockexplorer')) return new Response('', { status: 400 });
  const m = String(url).match(/\/tx\/([0-9a-f]{64})$/);
  if (m) {
    const tx = chain.get(m[1]);
    if (!tx) return new Response('not found', { status: 404 });
    return new Response(JSON.stringify({ vout: [{ scriptpubkey_address: env.WALLET, value: tx.paid }, { scriptpubkey_address: 'ltc1qchange', value: 5 }],
      status: tx.time ? { confirmed: true, block_time: tx.time } : { confirmed: false } }));
  }
  throw new Error('unexpected fetch ' + url);
};

const call = async (path, body, headers = {}) => {
  const r = await worker.fetch(new Request('https://w.test' + path, body === undefined ? {} : { method: 'POST', body: JSON.stringify(body), headers }), env);
  return { status: r.status, ...(await r.json()) };
};
const txid = (n) => n.toString(16).padStart(64, '0');
let passed = 0;
const test = async (name, fn) => { await fn(); passed++; console.log('  ✓ ' + name); };

console.log('License worker sandbox test');

await test('base32 round trip', () => {
  const bytes = crypto.getRandomValues(new Uint8Array(76));
  assert.deepEqual(b32decode(b32encode(bytes)), bytes);
});

let proKey;
await test('Pro checkout: order, pay the exact amount, claim, key is signed Pro and emailed', async () => {
  const o = await call('/order', { tier: 'pro', email: 'Buyer@Example.com' });
  assert.equal(o.status, 200);
  assert.equal(o.usd, 1);
  assert.ok(o.litoshi > 1428000 && o.litoshi < 1450000, 'about $1 of LTC at $70');
  // Not on the network yet → pending
  const p = await call('/claim', { order: o.order, txid: txid(1) });
  assert.equal(p.pending, true);
  chain.set(txid(1), { paid: o.litoshi });
  const c = await call('/claim', { order: o.order, txid: 'https://litecoinspace.org/tx/' + txid(1) });
  assert.equal(c.status, 200, JSON.stringify(c));
  assert.match(c.key, /^NTCH-PRO-/);
  assert.equal(c.emailed, true);
  assert.equal(mails.at(-1).to, 'Buyer@Example.com');
  assert.ok(mails.at(-1).text.includes(c.key));
  const k = await verifyKey(env, c.key);
  assert.equal(k.tier, 1);
  proKey = c.key;
  // Claiming again with the same order shows the same key (page reloads)
  const again = await call('/claim', { order: o.order, txid: txid(1) });
  assert.equal(again.key, c.key);
});

await test('Attack: someone else cannot claim a payment they saw on the blockchain', async () => {
  const theirs = await call('/order', { tier: 'pro', email: 'thief@example.com' });
  const r = await call('/claim', { order: theirs.order, txid: txid(1) });
  assert.equal(r.status, 409);
});

await test('Attack: a payment of a different amount is refused (no tolerance)', async () => {
  const o = await call('/order', { tier: 'pro', email: 'x@example.com' });
  chain.set(txid(2), { paid: o.litoshi + 100 });
  const r = await call('/claim', { order: o.order, txid: txid(2) });
  assert.equal(r.status, 400);
  assert.match(r.error, /needs exactly/);
});

await test('Attack: a payment made before the order is refused', async () => {
  const o = await call('/order', { tier: 'pro', email: 'x@example.com' });
  chain.set(txid(3), { paid: o.litoshi, time: Math.floor(Date.now() / 1000) - 7200 });
  const r = await call('/claim', { order: o.order, txid: txid(3) });
  assert.equal(r.status, 400);
});

await test('Every open order gets its own amount', async () => {
  const seen = new Set();
  for (let i = 0; i < 30; i++) {
    const o = await call('/order', { tier: 'pro', email: 'many@example.com' });
    assert.ok(!seen.has(o.litoshi)); seen.add(o.litoshi);
  }
});

await test('Test payments: only for an order the admin marked, and only with the zeros ID', async () => {
  const zeros = '0'.repeat(64);
  const o = await call('/order', { tier: 'pro', email: 'tester@example.com' });
  assert.equal((await call('/claim', { order: o.order, txid: zeros })).status, 400, 'nobody can claim with zeros by themselves');
  assert.equal((await call('/admin/test-payment', { order: o.order }, { authorization: 'Bearer wrong' })).status, 401);
  assert.equal((await call('/admin/test-payment', { order: o.order }, { authorization: 'Bearer admin-test' })).ok, true);
  const c = await call('/claim', { order: o.order, txid: zeros });
  assert.match(c.key, /^NTCH-PRO-/);
  const other = await call('/order', { tier: 'ultimate', email: 'tester@example.com' });
  assert.equal((await call('/claim', { order: other.order, txid: zeros })).status, 400, 'marking one order never unlocks another');
});

await test('Ultimate checkout gives a signed Ultimate key', async () => {
  const o = await call('/order', { tier: 'ultimate', email: 'ult@example.com' });
  assert.equal(o.usd, 5);
  chain.set(txid(4), { paid: o.litoshi });
  const c = await call('/claim', { order: o.order, txid: txid(4) });
  assert.match(c.key, /^NTCH-ULTM-/);
  assert.equal((await verifyKey(env, c.key)).tier, 2);
});

await test('An optional tip is added to the price and capped', async () => {
  const o = await call('/order', { tier: 'ultimate', email: 'fan@example.com', tip: 3 });
  assert.equal(o.usd, 8);
  const big = await call('/order', { tier: 'pro', email: 'fan@example.com', tip: 500 });
  assert.equal(big.usd, 51);
  const bad = await call('/order', { tier: 'pro', email: 'fan@example.com', tip: -4 });
  assert.equal(bad.usd, 1);
});

await test('Ultimate is refused while not on sale', async () => {
  env.ULTIMATE_ON = '0';
  const o = await call('/order', { tier: 'ultimate', email: 'ult@example.com' });
  assert.equal(o.status, 403);
  env.ULTIMATE_ON = '1';
});

await test('Pro → Ultimate upgrade charges $4 and the old Pro key still verifies', async () => {
  const o = await call('/order', { tier: 'ultimate', email: 'Buyer@Example.com', upgradeFrom: proKey });
  assert.equal(o.usd, 4);
  chain.set(txid(5), { paid: o.litoshi });
  const c = await call('/claim', { order: o.order, txid: txid(5) });
  assert.match(c.key, /^NTCH-ULTM-/);
  assert.ok(await verifyKey(env, proKey));
  const old = JSON.parse(store.get('key:' + parseKey(proKey).keyId));
  assert.equal(old.upgradedTo, parseKey(c.key).keyId);
});

await test('Upgrade needs a real Pro key', async () => {
  const fake = proKey.slice(0, -3) + (proKey.endsWith('AAA') ? 'BBB' : 'AAA');
  const o = await call('/order', { tier: 'ultimate', email: 'b@example.com', upgradeFrom: fake });
  assert.equal(o.status, 400);
});

await test('Tampered keys and keys with the wrong tier label fail', async () => {
  const k = parseKey(proKey);
  assert.ok(k);
  const swapped = proKey.replace('NTCH-PRO-', 'NTCH-ULTM-');
  assert.equal(parseKey(swapped), null);
  const chars = proKey.split('');
  const i = 20; chars[i] = chars[i] === 'A' ? 'B' : 'A';
  assert.equal(await verifyKey(env, chars.join('')), null);
});

await test('Promo code gives one Pro key, once; unknown codes are refused', async () => {
  const code = 'PROMO-TEST-TEST-TEST';
  assert.equal((await call('/promo', { code, email: 'p@example.com' })).status, 400);
  const h = [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode('PROMOTESTTESTTEST')))].map((x) => x.toString(16).padStart(2, '0')).join('');
  env.TEST_PROMOS = h;
  const r = await call('/promo', { code, email: 'p@example.com' });
  assert.match(r.key, /^NTCH-PRO-/);
  assert.equal(r.emailed, true);
  assert.equal((await call('/promo', { code, email: 'other@example.com' })).status, 409);
});

await test('Lost my key: by email sends every key bought with it; by transaction too; unknown emails get the same answer', async () => {
  mails.length = 0;
  const r = await call('/recover', { email: 'buyer@example.com' });
  assert.equal(r.ok, true);
  assert.equal(mails.length, 1);
  assert.ok(mails[0].text.includes(proKey));
  assert.ok(mails[0].text.includes('NTCH-ULTM-'));
  mails.length = 0;
  await call('/recover', { email: 'buyer@example.com', txid: txid(1) });
  assert.equal(mails.length, 1);
  mails.length = 0;
  // Right txid, wrong email: nothing is sent, same answer
  const wrong = await call('/recover', { email: 'thief@example.com', txid: txid(1) });
  assert.equal(wrong.ok, true);
  assert.equal(mails.length, 0);
});

const dev = (n) => n.toString(16).padStart(64, 'a');
await test('Device limit: 3 Macs, the same Mac again is fine, deactivating frees a slot', async () => {
  for (let i = 1; i <= 3; i++) assert.equal((await call('/activate', { key: proKey, device: dev(i) })).ok, true);
  assert.equal((await call('/activate', { key: proKey, device: dev(1) })).ok, true);
  const fourth = await call('/activate', { key: proKey, device: dev(4) });
  assert.equal(fourth.ok, false); assert.equal(fourth.reason, 'limit');
  await call('/deactivate', { key: proKey, device: dev(2) });
  assert.equal((await call('/activate', { key: proKey, device: dev(4) })).ok, true);
});

let leaked;
await test('Leaked key: revoke and reissue to the real buyer; other keys unaffected; signed revocation list', async () => {
  const unauth = await call('/admin/revoke', { key: proKey }, { authorization: 'Bearer nope' });
  assert.equal(unauth.status, 401);
  const r = await call('/admin/reissue', { key: proKey, email: 'buyer@example.com', reason: 'shared publicly' }, { authorization: 'Bearer admin-test' });
  assert.match(r.key, /^NTCH-PRO-/);
  leaked = proKey;
  assert.equal((await call('/activate', { key: leaked, device: dev(9) })).reason, 'revoked');
  assert.equal((await call('/activate', { key: r.key, device: dev(9) })).ok, true);
  const list = await (await worker.fetch(new Request('https://w.test/revoked'), env)).json();
  const sig = Uint8Array.from(atob(list.sig), (c) => c.charCodeAt(0));
  assert.ok(await crypto.subtle.verify({ name: 'Ed25519' }, pair.publicKey, sig, new TextEncoder().encode(list.list)));
  assert.deepEqual(JSON.parse(list.list).ids, [parseKey(leaked).keyId]);
  // Recovery no longer sends the revoked key
  mails.length = 0;
  await call('/recover', { email: 'buyer@example.com' });
  assert.ok(!mails[0].text.includes(leaked));
});

await test('Admin can issue a key for a donor (grandfathering)', async () => {
  const r = await call('/admin/issue', { tier: 'ultimate', note: 'donor' }, { authorization: 'Bearer admin-test' });
  assert.match(r.key, /^NTCH-ULTM-/);
});

await test('Nothing stores a plain email once an order is paid', async () => {
  for (const [k, v] of store) if (k.startsWith('order:') && JSON.parse(v).status === 'paid') assert.ok(!v.includes('@'));
  for (const [k, v] of store) if (k.startsWith('key:') || k.startsWith('email:')) assert.ok(!v.includes('@'), k);
});

await test('Three personal access codes sign in (only their hashes are stored); a wrong code does not', async () => {
  const sha = async (t) => [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(t)))].map((b) => b.toString(16).padStart(2, '0')).join('');
  const codes = ['NA-ADMIN-AAAA-1111', 'NA-ADMIN-BBBB-2222', 'NA-ADMIN-CCCC-3333'];
  env.ADMIN_TOKENS = (await Promise.all(codes.map(sha))).join(',');
  for (const c of codes) assert.equal((await call('/admin/stats', {}, { authorization: 'Bearer ' + c })).status, 200, c);
  assert.equal((await call('/admin/stats', {}, { authorization: 'Bearer NA-ADMIN-ZZZZ-9999', 'cf-connecting-ip': '9.9.9.9' })).status, 401);
  assert.equal((await call('/admin/stats', {}, { authorization: 'Bearer ' + env.ADMIN_TOKENS.split(',')[0], 'cf-connecting-ip': '9.9.9.9' })).status, 401, 'the hash itself is not a code');
});

await test('Promo codes made in the panel: create, redeem once, see them used, delete unused', async () => {
  const H = { authorization: 'Bearer admin-test' };
  const made = await call('/admin/promo-create', { count: 2, note: 'giveaway' }, H);
  assert.equal(made.codes.length, 2);
  assert.match(made.codes[0], /^PROMO-[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}$/);
  const r = await call('/promo', { code: made.codes[0], email: 'winner@example.com' });
  assert.equal(r.status, 200); assert.equal(r.tier, 'Pro');
  assert.equal((await call('/promo', { code: made.codes[0], email: 'again@example.com' })).status, 409, 'only once');
  const list = await call('/admin/promo-list', {}, H);
  assert.equal(list.rows.length >= 2, true);
  assert.equal(list.rows.filter((x) => x.used).length >= 1, true);
  const unused = list.rows.find((x) => !x.used);
  assert.equal((await call('/admin/promo-delete', { hash: unused.hash }, H)).deleted, true);
  assert.equal((await call('/promo', { code: made.codes[1], email: 'late@example.com' })).status, 400, 'a deleted code no longer works');
  assert.equal((await call('/admin/promo-create', { count: 1 })).status, 401);
});

await test('Admin panel: batch issue, list, suspend, unsuspend, notes, devices, lockout', async () => {
  const A = { authorization: 'Bearer admin-test' };
  const page = await worker.fetch(new Request('https://x/admin'), env);
  assert.equal(page.status, 200);
  assert.match(page.headers.get('content-security-policy'), /frame-ancestors 'none'/);
  const batch = await call('/admin/issue', { tier: 'pro', count: 5, note: 'cash batch' }, A);
  assert.equal(batch.keys.length, 5);
  assert.equal((await call('/admin/issue', { tier: 'pro', count: 2, email: 'a@b.co' }, A)).status, 400);
  const list = await call('/admin/list', {}, A);
  assert.ok(list.rows.filter((r) => r.note === 'cash batch').length === 5);
  const id = batch.keys[0].keyId, key = batch.keys[0].key;
  // A device activates, then the admin suspends for non-payment.
  assert.equal((await call('/activate', { key, device: 'a'.repeat(64) })).ok, true);
  assert.equal((await call('/admin/get', { keyId: id }, A)).devices.length, 1);
  await call('/admin/suspend', { keyId: id, reason: 'did not pay' }, A);
  assert.equal((await call('/activate', { key, device: 'b'.repeat(64) })).reason, 'revoked');
  const rl = await call('/revoked');
  assert.ok(JSON.parse(rl.list).ids.includes(id));
  assert.equal((await call('/admin/get', { key }, A)).suspended, true);
  // Paid after all: unsuspend makes it work again.
  await call('/admin/unsuspend', { keyId: id }, A);
  assert.ok(!JSON.parse((await call('/revoked')).list).ids.includes(id));
  assert.equal((await call('/activate', { key, device: 'b'.repeat(64) })).ok, true);
  await call('/admin/note', { keyId: id, note: 'paid late' }, A);
  assert.equal((await call('/admin/list', {}, A)).rows.find((r) => r.keyId === id).note, 'paid late');
  await call('/admin/devices', { keyId: id, device: 'a'.repeat(64) }, A);
  assert.deepEqual((await call('/admin/get', { keyId: id }, A)).devices, ['b'.repeat(64)]);
  const st = await call('/admin/stats', {}, A);
  assert.ok(st.total >= 5 && st.pro + st.ultimate === st.total);
  // Wrong tokens lock the address out after 10 tries, even for the right token.
  const ip = { 'cf-connecting-ip': '203.0.113.9' };
  for (let i = 0; i < 10; i++) assert.equal((await call('/admin/stats', {}, { ...ip, authorization: 'Bearer guess' + i })).status, 401);
  assert.equal((await call('/admin/stats', {}, { ...ip, ...A })).status, 429);
});

// Fixture for the Swift tests: a Pro and an Ultimate key from this run, with this run's public key.
const fx = { publicKey: btoa(String.fromCharCode(...pubRaw)), pro: leaked, ultimate: (await call('/admin/issue', { tier: 'ultimate' }, { authorization: 'Bearer admin-test' })).key };
writeFileSync(new URL('./fixture.json', import.meta.url), JSON.stringify(fx, null, 2) + '\n');
console.log(`\n${passed} passed. Wrote test/fixture.json for the Swift tests.`);
