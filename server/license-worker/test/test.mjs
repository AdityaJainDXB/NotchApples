// Sandbox test of the whole license flow, with a throwaway signing key, a fake KV and a fake
// blockchain/price/mail. Run: node server/license-worker/test/test.mjs
// Covers Pro and Ultimate checkout, the Pro → Ultimate upgrade, promo codes, recovery,
// the device limit, revocation and the attacks the unique-amount design is meant to stop.
// It also writes a fixture key that the Swift tests verify, so both sides agree on the format.

import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import worker, { sendReminders, parseKey, verifyKey, verifyToken, mintToken, b32encode, b32decode, AiQuota, cleanAiRequest, PlaneBoard, PlaneRate, PlaneSky, cleanPilotName, cleanPlaneScore } from '../src/worker.js';

const pair = await crypto.subtle.generateKey({ name: 'Ed25519' }, true, ['sign', 'verify']);
const jwk = await crypto.subtle.exportKey('jwk', pair.privateKey);
const pubRaw = new Uint8Array(await crypto.subtle.exportKey('raw', pair.publicKey));

const store = new Map();
const meta = new Map();
const KV = {
  async get(k, type) { if (!store.has(k)) return null; const v = store.get(k); return type === 'arrayBuffer' && v instanceof Uint8Array ? v.buffer.slice(v.byteOffset, v.byteOffset + v.byteLength) : v; },
  async getWithMetadata(k, type) { return { value: await this.get(k, type), metadata: meta.get(k) || null }; },
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

await test('Admin: audit log, device names and per-day stats', async () => {
  const A = { authorization: 'Bearer admin-test' };
  const k = await call('/admin/issue', { tier: 'pro', note: 'audit test' }, A);
  await call('/admin/note', { keyId: k.keyId, note: 'x' }, A);
  await call('/admin/suspend', { keyId: k.keyId, reason: 'testing' }, A);
  const log = await call('/admin/audit', {}, A);
  assert.ok(log.rows.some((r) => r.action === 'suspend' && r.target === k.keyId && r.detail === 'testing'));
  assert.ok(log.rows.some((r) => r.action === 'issue' && r.detail.includes('audit test')));
  assert.ok(!JSON.stringify(log).includes(k.key), 'full keys are never logged');
  assert.equal((await call('/admin/audit', {})).status, 401);
  // Device names: stored when given, added later by a device that did not send one, and removed with the device.
  const k2 = await call('/admin/issue', { tier: 'pro' }, A), dev = 'c'.repeat(64);
  await call('/activate', { key: k2.key, device: dev });
  assert.deepEqual((await call('/admin/get', { keyId: k2.keyId }, A)).deviceNames, {});
  await call('/activate', { key: k2.key, device: dev, name: "Aditya's <b>MacBook</b>\n" });
  assert.equal((await call('/admin/get', { keyId: k2.keyId }, A)).deviceNames[dev], "Aditya's bMacBook/b");
  await call('/admin/devices', { keyId: k2.keyId, device: dev }, A);
  assert.deepEqual((await call('/admin/get', { keyId: k2.keyId }, A)).deviceNames, {});
  const st = await call('/admin/stats', {}, A);
  assert.equal(st.byDay.length, 30);
  assert.ok(st.byDay.at(-1).pro >= 2);
  assert.ok(st.bySource.admin >= 2);
});

// ---- Entitlements and server-held content

const devn = (n) => n.toString(16).padStart(64, '0');
const getAsset = async (id, token) => {
  const r = await worker.fetch(new Request('https://w.test/asset/' + id, { headers: token ? { authorization: 'Bearer ' + token } : {} }), env);
  return { status: r.status, bytes: new Uint8Array(await r.arrayBuffer()), sha: r.headers.get('x-sha256') };
};
const put = async (id, tier, bytes) => {
  const r = await worker.fetch(new Request(`https://w.test/admin/asset-put?id=${id}&tier=${tier}&type=text/plain`, { method: 'POST', body: bytes, headers: { authorization: 'Bearer admin-test' } }), env);
  return { status: r.status, ...(await r.json()) };
};

await test('Entitle: a real key on a device gets a token and an anonymous pass; a fake key or bad device does not', async () => {
  const pro = (await call('/admin/issue', { tier: 'pro' }, { authorization: 'Bearer admin-test' })).key;
  const e = await call('/entitle', { key: pro, device: devn(101) });
  assert.equal(e.status, 200); assert.equal(e.ok, true); assert.equal(e.tier, 'Pro');
  const t = await verifyToken(env, 'ent1', e.token), p = await verifyToken(env, 'pass1', e.pass);
  assert.equal(t.t, 1); assert.equal(p.t, 1);
  assert.equal(p.k, undefined, 'the pass names no key');
  assert.equal(p.d, undefined, 'the pass names no device');
  assert.equal((await call('/entitle', { key: 'NTCH-PRO-AAAAAA', device: devn(101) })).status, 400);
  assert.equal((await call('/entitle', { key: pro, device: 'nope' })).status, 400);
});

await test('Entitle follows the device limit and revocation of /activate', async () => {
  const k = (await call('/admin/issue', { tier: 'pro' }, { authorization: 'Bearer admin-test' })).key;
  for (const n of [1, 2, 3]) assert.equal((await call('/entitle', { key: k, device: devn(200 + n) })).ok, true);
  const over = await call('/entitle', { key: k, device: devn(204) });
  assert.equal(over.ok, false); assert.equal(over.reason, 'limit'); assert.equal(over.token, undefined);
  const id = parseKey(k).keyId;
  await call('/admin/revoke', { keyId: id, reason: 'test' }, { authorization: 'Bearer admin-test' });
  const gone = await call('/entitle', { key: k, device: devn(201) });
  assert.equal(gone.ok, false); assert.equal(gone.reason, 'revoked');
});

await test('Tokens: tampered, expired, the wrong kind and a licence key all fail', async () => {
  const k = (await call('/admin/issue', { tier: 'ultimate' }, { authorization: 'Bearer admin-test' })).key;
  const e = await call('/entitle', { key: k, device: devn(301) });
  assert.ok(await verifyToken(env, 'ent1', e.token));
  const [a, body, sig] = e.token.split('.');
  const forged = btoa(JSON.stringify({ k: 'x', t: 2, d: 'x', iat: 1, exp: 9e9 })).replace(/=+$/, '');
  assert.equal(await verifyToken(env, 'ent1', `${a}.${forged}.${sig}`), null, 'a changed payload');
  assert.equal(await verifyToken(env, 'ent1', e.pass), null, 'a pass is not a token');
  assert.equal(await verifyToken(env, 'pass1', e.token), null, 'a token is not a pass');
  assert.equal(await verifyToken(env, 'ent1', e.token, e.exp + 1), null, 'expired');
  assert.equal(await verifyToken(env, 'ent1', k), null, 'a licence key is not a token');
  assert.equal(await verifyToken(env, 'ent1', ''), null);
});

await test('Assets: only an admin uploads; the right tier downloads; others get nothing', async () => {
  const body = new TextEncoder().encode('premium content');
  assert.equal((await worker.fetch(new Request('https://w.test/admin/asset-put?id=a.txt&tier=1', { method: 'POST', body, headers: { authorization: 'Bearer wrong' } }), env)).status, 401);
  assert.equal((await put('gallery/pro.txt', 1, body)).ok, true);
  assert.equal((await put('gallery/ultimate.txt', 2, body)).ok, true);
  assert.equal((await put('../escape', 1, body)).status, 400);
  assert.equal((await put('bad id', 1, body)).status, 400);
  const pro = (await call('/entitle', { key: (await call('/admin/issue', { tier: 'pro' }, { authorization: 'Bearer admin-test' })).key, device: devn(401) })).token;
  const ult = (await call('/entitle', { key: (await call('/admin/issue', { tier: 'ultimate' }, { authorization: 'Bearer admin-test' })).key, device: devn(402) })).token;
  const ok = await getAsset('gallery/pro.txt', pro);
  assert.equal(ok.status, 200); assert.equal(new TextDecoder().decode(ok.bytes), 'premium content'); assert.equal(ok.sha.length, 64);
  assert.equal((await getAsset('gallery/ultimate.txt', pro)).status, 403, 'Pro cannot get an Ultimate file');
  assert.equal((await getAsset('gallery/ultimate.txt', ult)).status, 200);
  assert.equal((await getAsset('gallery/pro.txt', '')).status, 401, 'no token');
  assert.equal((await getAsset('gallery/pro.txt', 'ent1.x.y')).status, 401, 'junk token');
  assert.equal((await getAsset('gallery/missing.txt', pro)).status, 404);
  assert.equal((await getAsset('..%2Fsecret', pro)).status, 404);
  const list = await call('/admin/asset-list', {}, { authorization: 'Bearer admin-test' });
  assert.ok(list.assets.some((a) => a.id === 'gallery/pro.txt' && a.tier === 1));
});

await test('Assets: a token from a revoked key stops working at once', async () => {
  const k = (await call('/admin/issue', { tier: 'pro' }, { authorization: 'Bearer admin-test' })).key;
  const tok = (await call('/entitle', { key: k, device: devn(501) })).token;
  assert.equal((await getAsset('gallery/pro.txt', tok)).status, 200);
  await call('/admin/revoke', { keyId: parseKey(k).keyId, reason: 'leak' }, { authorization: 'Bearer admin-test' });
  assert.equal((await getAsset('gallery/pro.txt', tok)).status, 403);
});

// ---- Notch Apple AI (hosted)

const quotaObjects = new Map();
env.AI_QUOTA = {
  idFromName: (n) => n,
  get: (id) => { if (!quotaObjects.has(id)) { const m = new Map(); quotaObjects.set(id, new AiQuota({ storage: { get: async (k) => m.get(k), put: async (k, v) => { m.set(k, v); }, delete: async (k) => { m.delete(k); } } })); } const o = quotaObjects.get(id); return { fetch: (url, init) => o.fetch(new Request(url, init)) }; },
};
let upstreamSeen = null, upstreamStatus = 200;
const realFetch = globalThis.fetch;
globalThis.fetch = async (url, init) => {
  if (String(url).includes('ai.test/v1/chat/completions')) {
    upstreamSeen = { url: String(url), headers: init.headers, body: JSON.parse(init.body) };
    if (upstreamStatus !== 200) return new Response('provider says: key AIza-secret over quota', { status: upstreamStatus });
    return new Response(JSON.stringify({ choices: [{ message: { role: 'assistant', content: 'hello from the provider' } }] }), { headers: { 'content-type': 'application/json' } });
  }
  return realFetch(url, init);
};
const aiCall = async (token, body) => {
  const r = await worker.fetch(new Request('https://w.test/ai/v1/chat/completions', { method: 'POST', body: JSON.stringify(body), headers: token ? { authorization: 'Bearer ' + token } : {} }), env);
  return { status: r.status, remaining: r.headers.get('x-ai-remaining'), text: await r.text() };
};
const chatBody = { model: 'evil-model', messages: [{ role: 'user', content: 'hi' }], tools: [{ type: 'function' }], stream: false };

await test('AI is off until the server has its key', async () => {
  assert.equal((await call('/ai/status')).on, false);
  assert.equal((await aiCall('x', chatBody)).status, 503);
});

env.AI_API_KEY = 'server-secret-key'; env.AI_BASE = 'https://ai.test/v1'; env.AI_MODEL = 'server-chosen-model'; env.AI_LIMIT_PRO = '3'; env.AI_LIMIT_ULTIMATE = '5';
const aiToken = async (tier, n) => (await call('/entitle', { key: (await call('/admin/issue', { tier }, { authorization: 'Bearer admin-test' })).key, device: devn(n) })).token;

await test('AI: needs a real token; the server picks the model and key; extra fields are dropped', async () => {
  assert.equal((await call('/ai/status')).on, true);
  assert.equal((await aiCall('', chatBody)).status, 401);
  assert.equal((await aiCall('ent1.x.y', chatBody)).status, 401);
  const tok = await aiToken('pro', 601);
  const r = await aiCall(tok, chatBody);
  assert.equal(r.status, 200); assert.ok(r.text.includes('hello from the provider'));
  assert.equal(upstreamSeen.body.model, 'server-chosen-model', "the app can't pick the model");
  assert.equal(upstreamSeen.body.tools, undefined, 'unknown fields are dropped');
  assert.equal(upstreamSeen.headers.authorization, 'Bearer server-secret-key');
  assert.ok(!r.text.includes('server-secret-key'), 'the provider key is never sent to the app');
  assert.equal(upstreamSeen.url, 'https://ai.test/v1/chat/completions');
});

await test('AI: a daily allowance per key, and Ultimate gets more', async () => {
  const pro = await aiToken('pro', 602), ult = await aiToken('ultimate', 603);
  for (let i = 0; i < 3; i++) assert.equal((await aiCall(pro, chatBody)).status, 200);
  const over = await aiCall(pro, chatBody);
  assert.equal(over.status, 429); assert.ok(over.text.includes("today's 3"));
  for (let i = 0; i < 5; i++) assert.equal((await aiCall(ult, chatBody)).status, 200);
  assert.equal((await aiCall(ult, chatBody)).status, 429);
  const other = await aiToken('pro', 604);
  const r = await aiCall(other, chatBody);
  assert.equal(r.status, 200); assert.equal(r.remaining, '2');
});

await test('AI: refuses odd requests (remote images, empty, huge, bad roles)', async () => {
  const tok = await aiToken('ultimate', 605);
  const bad = (messages) => aiCall(tok, { messages });
  assert.equal((await bad([{ role: 'user', content: [{ type: 'image_url', image_url: { url: 'https://evil.example/x.png' } }] }])).status, 400);
  assert.equal((await bad([])).status, 400);
  assert.equal((await bad([{ role: 'tool', content: 'x' }])).status, 400);
  assert.equal((await bad([{ role: 'user', content: 'x'.repeat(500000) }])).status, 413);
  assert.equal((await bad([{ role: 'user', content: [{ type: 'text', text: 'what is this' }, { type: 'image_url', image_url: { url: 'data:image/jpeg;base64,AAAA' } }] }])).status, 200);
  assert.equal(cleanAiRequest({ messages: [{ role: 'user', content: 'a' }], max_tokens: 999999, temperature: 9 }, env).max_tokens, 4096);
  assert.equal(cleanAiRequest({ messages: [{ role: 'user', content: 'a' }], temperature: 9 }, env).temperature, 2);
});

await test('AI: a revoked key stops at once, and provider trouble is reported without leaking anything', async () => {
  const k = (await call('/admin/issue', { tier: 'pro' }, { authorization: 'Bearer admin-test' })).key;
  const tok = (await call('/entitle', { key: k, device: devn(606) })).token;
  assert.equal((await aiCall(tok, chatBody)).status, 200);
  upstreamStatus = 429;
  const busy = await aiCall(tok, chatBody);
  assert.equal(busy.status, 503); assert.ok(!busy.text.includes('AIza') && !busy.text.includes('provider says'));
  upstreamStatus = 200;
  await call('/admin/revoke', { keyId: parseKey(k).keyId, reason: 'test' }, { authorization: 'Bearer admin-test' });
  assert.equal((await aiCall(tok, chatBody)).status, 403);
});

// ---- The Plane game's world leaderboard

const fakeDO = (Cls) => { const objs = new Map(); return { idFromName: (n) => n, get: (id) => { if (!objs.has(id)) { const m = new Map(); objs.set(id, new Cls({ storage: { get: async (k) => m.get(k), put: async (k, v) => { m.set(k, v); } } })); } const o = objs.get(id); return { fetch: (url, init) => o.fetch(new Request(url, init)) }; } }; };
env.PLANE_BOARD = fakeDO(PlaneBoard); env.PLANE_RATE = fakeDO(PlaneRate);
const post = (body, ip = '1.1.1.1') => call('/plane/score', body, { 'cf-connecting-ip': ip });
const board = async (mode, period = 'all') => (await worker.fetch(new Request(`https://w.test/plane/board?mode=${mode}&period=${period}`), env)).json();

await test('World board: scores are accepted, sorted the right way for each mode and shown top first', async () => {
  for (const [name, score] of [['Ana', 12], ['Ben', 30], ['Cy', 21]]) assert.equal((await post({ mode: 'hoops', name, plane: 'c172', score }, `10.0.0.${score}`)).ok, true);
  const h = (await board('hoops')).entries;
  assert.deepEqual(h.map((e) => e.name), ['Ben', 'Cy', 'Ana']);
  for (const [name, score] of [['Slow', 90.4], ['Fast', 41.25], ['Mid', 60]]) await post({ mode: 'trial', name, plane: 'a320', score }, `10.0.1.${Math.floor(score)}`);
  const t = (await board('trial')).entries;
  assert.deepEqual(t.map((e) => e.name), ['Fast', 'Mid', 'Slow'], 'the fastest time is first');
  assert.equal(t[0].score, 41.3, 'rounded to a tenth');
  assert.equal(t[0].plane, 'Airbus A320');
  const r = await post({ mode: 'landing', name: 'Lee', plane: 'b777', score: 250 }, '10.0.2.1');
  assert.equal(r.rank, 1);
});

await test('World board: impossible scores, unknown modes and planes are refused', async () => {
  assert.equal((await post({ mode: 'hoops', name: 'X', plane: 'c172', score: 5000 }, '10.1.0.1')).status, 400);
  assert.equal((await post({ mode: 'hoops', name: 'X', plane: 'c172', score: 2.5 }, '10.1.0.2')).status, 400);
  assert.equal((await post({ mode: 'trial', name: 'X', plane: 'c172', score: 3 }, '10.1.0.3')).status, 400, 'a time that is too fast');
  assert.equal((await post({ mode: 'trial', name: 'X', plane: 'c172', score: -1 }, '10.1.0.4')).status, 400);
  assert.equal((await post({ mode: 'free', name: 'X', plane: 'c172', score: 5 }, '10.1.0.5')).status, 400);
  assert.equal((await post({ mode: 'hoops', name: 'X', plane: 'nope', score: 5 }, '10.1.0.6')).status, 400);
  assert.equal((await post({ mode: 'hoops', name: 'X', plane: 'c172', score: 'abc' }, '10.1.0.7')).status, 400);
  assert.equal((await worker.fetch(new Request('https://w.test/plane/board?mode=free'), env)).status, 400);
});

await test('World board: names are cleaned, rude ones become Pilot, and nothing else is stored', async () => {
  assert.equal(cleanPilotName('  Aditya <script>alert(1)</script>  '), 'Aditya scriptale');
  assert.equal(cleanPilotName('x'.repeat(40)).length, 16);
  assert.equal(cleanPilotName('f.u.c.k'), 'Pilot'); assert.equal(cleanPilotName('Nazi pilot'), 'Pilot'); assert.equal(cleanPilotName(''), 'Pilot');
  assert.equal(cleanPilotName('Zoë 3'), 'Zoë 3');
  const e = cleanPlaneScore({ mode: 'hoops', name: 'Q', plane: 'c172', score: 4, region: 'London!!', extra: 'x', ip: '1.2.3.4' });
  assert.deepEqual(Object.keys(e).sort(), ['mode', 'name', 'plane', 'region', 'score']);
  assert.equal(e.region, 'ondon', 'letters only');
});

await test('World board: ten posts a minute from one address, then a pause; duplicates are not added twice', async () => {
  let last;
  for (let i = 0; i < 11; i++) last = await post({ mode: 'hoops', name: 'Spam' + i, plane: 'c172', score: 5 }, '9.9.9.9');
  assert.equal(last.status, 429);
  const again = await post({ mode: 'hoops', name: 'Ana', plane: 'c172', score: 12 }, '8.8.8.8');
  assert.equal(again.ok, true);
  assert.equal((await board('hoops')).entries.filter((e) => e.name === 'Ana' && e.score === 12).length, 1, 'the same score twice in an hour is one entry');
});

await test('World board: the weekly board only has recent scores; the admin can clear a board', async () => {
  assert.ok((await board('hoops', 'week')).entries.length > 0);
  assert.equal((await call('/admin/plane-clear', { mode: 'hoops' }, { authorization: 'Bearer admin-test' })).cleared, 'hoops');
  assert.equal((await board('hoops')).entries.length, 0);
  assert.equal((await call('/admin/plane-clear', { mode: 'hoops' }, { authorization: 'Bearer wrong' })).status, 401);
});

const iid = (n) => n.toString(16).padStart(32, '0');
await test('Insights: an opted-in install pings once, the admin sees counts (and no one else can)', async () => {
  const ping = (o) => call('/telemetry/ping', { id: iid(1), v: '2.0.52', os: 'mac', osv: '27.0', tier: 1, ...o });
  assert.equal((await ping()).status, 200);
  assert.equal((await ping({ id: iid(2), os: 'win', v: '1.55.0', osv: '11', tier: 0 })).status, 200);
  assert.equal((await ping({ id: iid(3), v: '2.0.51', tier: 2 })).status, 200);
  assert.equal((await ping()).status, 200);                       // the same install again: no double count
  const d = await call('/admin/insights', {}, { authorization: 'Bearer admin-test' });
  assert.equal(d.status, 200);
  assert.equal(d.total, 3); assert.equal(d.byOs.mac, 2); assert.equal(d.byOs.win, 1);
  assert.equal(d.byVersion['2.0.52'], 1); assert.equal(d.byTier.Ultimate, 1);
  assert.equal(d.dailyActive.at(-1).active, 3);
  assert.equal(d.active1, 3); assert.equal(d.newLast7, 3);
  assert.equal((await call('/admin/insights', {}, { authorization: 'Bearer nope' })).status, 401);
  assert.equal((await call('/admin/insights', {})).status, 401);
});
await test('Insights: bad ids, versions and systems are refused; nothing identifying is stored', async () => {
  assert.equal((await call('/telemetry/ping', { id: 'not-an-id', v: '2.0.52', os: 'mac' })).status, 400);
  assert.equal((await call('/telemetry/ping', { id: iid(9), v: '<script>', os: 'mac' })).status, 400);
  assert.equal((await call('/telemetry/ping', { id: iid(9), v: '2.0.52', os: 'linux' })).status, 400);
  const users = [...store.keys()].filter((k) => k.startsWith('usr:'));
  for (const k of users) assert.ok(!JSON.stringify(meta.get(k)).match(/email|ip|name/i), 'no personal fields');
});
await test('Insights: glitch notes and feedback are stored, rate-limited, trimmed, and listed for the admin', async () => {
  const g = await call('/telemetry/glitch', { id: iid(5), v: '2.0.52', os: 'mac', kind: 'crash', text: 'The notch froze when I dragged a file\u0000.' });
  assert.equal(g.status, 200);
  assert.equal((await call('/telemetry/glitch', { id: iid(5), v: '2.0.52', os: 'mac', text: 'again, too soon' })).status, 429);
  assert.equal((await call('/telemetry/glitch', { id: iid(6), v: '2.0.52', os: 'mac', text: 'x' })).status, 400);
  const f = await call('/feedback', { id: iid(5), v: '2.0.52', os: 'mac', kind: 'idea', text: 'A pomodoro stats page please' });
  assert.equal(f.status, 200);
  assert.equal((await call('/feedback', { id: iid(5), v: '2.0.52', os: 'mac', kind: 'idea', text: 'second one right away' })).status, 429);
  await call('/feedback', { id: iid(7), v: '1.55.0', os: 'win', kind: 'weird-kind', text: 'x'.repeat(1500) });
  const gl = await call('/admin/glitches', {}, { authorization: 'Bearer admin-test' });
  assert.equal(gl.glitches.length, 1); assert.match(gl.glitches[0].text, /^The notch froze/); assert.ok(!gl.glitches[0].text.includes('\u0000'));
  const fb = await call('/admin/feedback', {}, { authorization: 'Bearer admin-test' });
  assert.equal(fb.feedback.length, 2); assert.equal(fb.byKind.idea, 2);
  assert.equal(fb.feedback.find((x) => x.os === 'win').text.length, 1000);
  assert.equal((await call('/admin/feedback', {})).status, 401);
});

// ---- Fly with others

env.PLANE_SKY = fakeDO(PlaneSky);
const sky = (body, ip = '2.2.2.2') => call('/plane/sky', body, { 'cf-connecting-ip': ip });
const pid = (n) => String(n).padStart(32, '0').replace(/0/g, 'a').slice(0, 31) + (n % 10);
const me = (n, x = 0, z = 0) => ({ id: pid(n), cs: 'Ana' + n, plane: 'a320', p: [x, 500, z], h: 0.5, pi: 0.02, b: 0.1, s: 90 });
await test('Fly with others: pilots see each other nearby, not themselves, and not those far away', async () => {
  let r = await sky(me(1, 0, 0), '3.3.3.1'); assert.equal(r.status, 200); assert.deepEqual(r.others, []);
  r = await sky(me(2, 1000, -2000), '3.3.3.2'); assert.equal(r.others.length, 1); assert.equal(r.others[0].cs, 'Ana1'); assert.ok(!('id' in r.others[0]));
  r = await sky(me(3, 19000, 19000), '3.3.3.3'); assert.equal(r.others.length, 0);
  assert.equal((await (await worker.fetch(new Request('https://w.test/plane/sky/count'), env)).json()).pilots, 3);
});
await test('Fly with others: bad ids, positions and callsigns are refused or cleaned; flooding is limited', async () => {
  assert.equal((await sky({ ...me(4), id: 'nope' })).status, 400);
  assert.equal((await sky({ ...me(4), p: [0, 0] })).status, 400);
  assert.equal((await sky({ ...me(4), p: [1e9, 0, 0] })).status, 400);
  assert.equal((await sky({ ...me(4), s: 9999 })).status, 400);
  assert.equal((await sky({ ...me(5), cs: '<script>alert(1)</script>' }, '4.4.4.5')).pilots > 0, true);
  const r = await sky(me(6), '4.4.4.6'); assert.ok(r.others.every((o) => !/[<>]/.test(o.cs)));
  for (let i = 10; i < 13; i++) assert.equal((await sky(me(i), '5.5.5.5')).status, 200);
  assert.equal((await sky(me(13), '5.5.5.5')).status, 429);
  assert.equal((await sky(me(10), '5.5.5.5')).status, 429);   // the same pilot, too soon
});

await test('Fly with others: unknown aircraft are refused, the short id is per session, pilots can leave, the count is rate limited', async () => {
  assert.equal((await sky({ ...me(30), plane: 'toString' }, '6.6.6.1')).status, 400);
  assert.equal((await sky({ ...me(30), plane: 'a320' }, '6.6.6.1')).status, 200);
  const r1 = await sky(me(31, 100, 100), '6.6.6.2'); const k1 = r1.others.find((o) => o.cs === 'Ana30').k;
  assert.match(k1, /^[0-9a-f]{8}$/); assert.ok(!pid(30).startsWith(k1) || k1 !== pid(30).slice(0, 8), 'not a prefix of the persistent id');
  assert.equal((await call('/plane/sky/leave', { id: pid(30) }, { 'cf-connecting-ip': '6.6.6.1' })).ok, true);
  assert.ok(!(await sky(me(32, 100, 100), '6.6.6.3')).others.some((o) => o.cs === 'Ana30'));
  let limited = 0; for (let i = 0; i < 40; i++) { const r = await worker.fetch(new Request('https://w.test/plane/sky/count', { headers: { 'cf-connecting-ip': '7.7.7.7' } }), env); if (r.status === 429) limited++; }
  assert.ok(limited > 0, 'the count is rate limited per address');
});
await test('Battle room code: the same network gets the same code, another network a different one, and it is rate limited', async () => {
  const code = async (ip) => (await (await worker.fetch(new Request('https://w.test/plane/net', { headers: { 'cf-connecting-ip': ip } }), env)).json()).code;
  const a1 = await code('9.9.9.9'), a2 = await code('9.9.9.9'), b1 = await code('9.9.8.8');
  assert.match(a1, /^[A-HJKMNP-Z2-9]{6}$/); assert.equal(a1, a2); assert.notEqual(a1, b1);
  assert.equal(await code('2001:db8:1:2:aaaa:bbbb:cccc:1'), await code('2001:db8:1:2:1111:2222:3333:4'), 'devices in one IPv6 network share a code');
  let limited = 0; for (let i = 0; i < 30; i++) { const r = await worker.fetch(new Request('https://w.test/plane/net', { headers: { 'cf-connecting-ip': '5.5.5.5' } }), env); if (r.status === 429) limited++; }
  assert.ok(limited > 0);
});
await test('Fly with others: pilots only see others flying in the same part of the world', async () => {
  assert.equal((await sky({ ...me(40, 0, 0), rg: 'tokyo' }, '8.8.8.1')).status, 200);
  const same = await sky({ ...me(41, 50, 50), rg: 'tokyo' }, '8.8.8.2'); assert.ok(same.others.some((o) => o.cs === 'Ana40'));
  const other = await sky({ ...me(42, 50, 50), rg: 'paris' }, '8.8.8.3'); assert.ok(!other.others.some((o) => o.cs === 'Ana40'));
  assert.equal((await sky({ ...me(43), rg: '../x' }, '8.8.8.4')).status, 400);
});
await test('Pilot names are normalised (look-alike letters) and cut by characters, not code units', async () => {
  assert.equal(cleanPilotName('𝓐𝓭𝓶𝓲𝓷'), 'Admin');
  assert.equal([...cleanPilotName('😀'.repeat(20) + 'ab')].length <= 16, true);
});

// Fixture for the Swift tests: a Pro and an Ultimate key from this run, with this run's public key.
const far = 4102444800;   // the year 2100, so the fixture never expires under the Swift tests
const fx = { publicKey: btoa(String.fromCharCode(...pubRaw)), pro: leaked, ultimate: (await call('/admin/issue', { tier: 'ultimate' }, { authorization: 'Bearer admin-test' })).key,
  ent: await mintToken(env, 'ent1', { k: '0011223344556677', t: 2, d: 'abcdef0123456789', iat: 1, exp: far }),
  pass: await mintToken(env, 'pass1', { t: 2, exp: far, r: 'abc123' }),
  passPro: await mintToken(env, 'pass1', { t: 1, exp: far, r: 'abc123' }),
  expired: await mintToken(env, 'pass1', { t: 2, exp: 1000, r: 'abc123' }) };
writeFileSync(new URL('./fixture.json', import.meta.url), JSON.stringify(fx, null, 2) + '\n');
await test('reminder emails: opt-in only, day 2 / 4 / 6, a one-time 20% coupon on the last, unsubscribe and a purchase stop them', async () => {
  const day = 86400000, mail = 'maybe@example.com', eh = await (async () => { const d = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode('pepper|' + mail))); return [...d].map((x) => x.toString(16).padStart(2, '0')).join(''); })();
  const leads = () => [...store.keys()].filter((k) => k.startsWith('lead:'));
  const before = leads().length;
  await call('/order', { tier: 'pro', email: 'nobox@example.com' });
  assert.equal(leads().length, before, 'no tick, no reminder');
  const o = await call('/order', { tier: 'pro', email: mail, remind: true });
  assert.ok(o.order && leads().length === before + 1, 'ticked: queued');
  const now = Date.now(); mails.length = 0;
  assert.equal(await sendReminders(env, now + 1 * day), 0, 'nothing on day 1');
  assert.equal(await sendReminders(env, now + 2.1 * day), 1, 'first reminder on day 2');
  assert.equal(await sendReminders(env, now + 2.5 * day), 0, 'not twice');
  assert.equal(await sendReminders(env, now + 4.1 * day), 1, 'second on day 4');
  assert.match(mails[0].text, /unsub\?e=[0-9a-f]{64}&t=/); assert.ok(!/BACK20/.test(mails[0].text + mails[1].text), 'no coupon yet');
  assert.equal(await sendReminders(env, now + 6.1 * day), 1, 'third on day 6');
  const last = mails.at(-1), code = last.text.match(/BACK20-[A-Z2-9]{8}/)?.[0];
  assert.ok(code && /20% off/.test(last.subject), 'the last mail carries the coupon');
  assert.equal(await sendReminders(env, now + 9 * day), 0, 'the sequence is over'); assert.equal(leads().length, before, 'lead removed');
  const full = await call('/order', { tier: 'pro', email: mail }), cut = await call('/order', { tier: 'pro', email: mail, coupon: code });
  assert.ok(Math.abs(cut.usd - full.usd * 0.8) < 0.011, `20% off: ${full.usd} -> ${cut.usd}`);
  const wrong = await call('/order', { tier: 'pro', email: 'someone@else.com', coupon: code }); assert.equal(wrong.status, 400, 'only for that email');
  assert.equal((await call('/order', { tier: 'pro', email: mail, coupon: 'BACK20-AAAAAAAA' })).status, 400, 'made-up code');
  // Paying with it uses it up.
  const pay = cut.litoshi; chain.set(txid(901), { paid: pay, time: Math.floor(Date.now() / 1000) + 5 });
  assert.ok((await call('/claim', { order: cut.order, txid: txid(901) })).key, 'paid');
  assert.equal((await call('/order', { tier: 'pro', email: mail, coupon: code })).status, 400, 'a coupon works once');
});

await test('reminder emails stop on unsubscribe and when the address already bought', async () => {
  const day = 86400000;
  await call('/order', { tier: 'pro', email: 'quit@example.com', remind: true });
  const eh = [...store.keys()].filter((k) => k.startsWith('lead:')).map((k) => k.slice(5)).find((h) => JSON.parse(store.get('lead:' + h)).email === 'quit@example.com');
  const bad = await worker.fetch(new Request(`https://w.test/unsub?e=${eh}&t=${'0'.repeat(24)}`), env); assert.equal(bad.status, 400);
  mails.length = 0; await sendReminders(env, Date.now() + 2.1 * day); const link = mails.find((m) => m.to === 'quit@example.com').text.match(/unsub\?e=[0-9a-f]{64}&t=[0-9a-f]{24}/)[0];
  const ok = await worker.fetch(new Request('https://w.test/' + link), env); assert.equal(ok.status, 200);
  mails.length = 0; await sendReminders(env, Date.now() + 4.1 * day); assert.ok(!mails.some((m) => m.to === 'quit@example.com'), 'unsubscribed');
  await call('/order', { tier: 'pro', email: 'quit@example.com', remind: true });
  assert.ok(![...store.keys()].some((k) => k.startsWith('lead:') && JSON.parse(store.get(k)).email === 'quit@example.com'), 'not re-added');
});

console.log(`\n${passed} passed. Wrote test/fixture.json for the Swift tests.`);

// ---- Bitcoin, Ethereum and Solana checkout (a fake chain for each, no network)
{
  const W = { btc: 'bc1qtestbtcwallet', eth: '0x7CB03e86d62939C6BB743529Ba19E665a31dbCc5', sol: '8Ri5sCbpdPRVz8rmrirJWH6hv7ZAKLcdb7AgJFfekpFC' };
  Object.assign(env, { WALLET_BTC: W.btc, WALLET_ETH: W.eth, WALLET_SOL: W.sol, TEST_COINS: '1', TEST_BTC_PRICE: '100000', TEST_ETH_PRICE: '4000', TEST_SOL_PRICE: '200' });
  const btcTx = new Map(), ethTx = new Map(), solTx = new Map(); let ethHead = 1000;
  const ltcFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    const u = String(url);
    if (/mempool\.space|blockstream\.info/.test(u)) {
      const m = u.match(/\/tx\/([0-9a-f]{64})$/); const tx = m && btcTx.get(m[1]); if (!tx) return new Response('nf', { status: 404 });
      return new Response(JSON.stringify({ vout: [{ scriptpubkey_address: W.btc, value: tx.paid }, { scriptpubkey_address: 'bc1qchange', value: 7 }], status: tx.time ? { confirmed: true, block_time: tx.time } : { confirmed: false } }));
    }
    if (/publicnode\.com\/?$|llamarpc|ankr/.test(u) && u.includes('ethereum') || /eth\.llamarpc|rpc\.ankr\.com\/eth/.test(u)) {
      const req = JSON.parse(init.body), [p0] = req.params, ok = (result) => new Response(JSON.stringify({ jsonrpc: '2.0', id: 1, result }));
      if (req.method === 'eth_blockNumber') return ok('0x' + ethHead.toString(16));
      const tx = ethTx.get(p0); 
      if (req.method === 'eth_getTransactionByHash') return ok(tx ? { to: tx.to, value: '0x' + BigInt(tx.value).toString(16), input: tx.input || '0x', blockNumber: tx.block == null ? null : '0x' + tx.block.toString(16) } : null);
      if (req.method === 'eth_getTransactionReceipt') return ok(tx && tx.block != null ? { status: tx.failed ? '0x0' : '0x1' } : null);
      if (req.method === 'eth_getBlockByNumber') return ok({ timestamp: '0x' + Math.floor(Date.now() / 1000).toString(16) });
    }
    if (/solana/.test(u)) {
      const req = JSON.parse(init.body), tx = solTx.get(req.params[0]);
      if (!tx) return new Response(JSON.stringify({ jsonrpc: '2.0', id: 1, result: null }));
      return new Response(JSON.stringify({ jsonrpc: '2.0', id: 1, result: { blockTime: Math.floor(Date.now() / 1000), meta: { err: tx.err || null, preBalances: [5000000, 1000], postBalances: [5000000 - tx.paid, 1000 + tx.paid] }, transaction: { message: { accountKeys: ['someoneelse', W.sol] } } } }));
    }
    return ltcFetch(url, init);
  };
  const hexid = (n) => n.toString(16).padStart(64, '0');
  const ethid = (n) => '0x' + hexid(n), solid = (n) => ('A' + String(n).padStart(2, '1') + '1'.repeat(80)).slice(0, 84);
  await test('Checkout in Bitcoin, Ethereum and Solana: /config lists them and the order asks for an exact unique amount', async () => {
    const cfg = await call('/config'); assert.deepEqual(cfg.coins.map((c) => c.id), ['ltc', 'btc', 'eth', 'sol']); assert.equal(cfg.coins[1].wallet, W.btc);
    const b = await call('/order', { tier: 'pro', email: 'b@example.com', coin: 'btc' }), e = await call('/order', { tier: 'pro', email: 'e@example.com', coin: 'eth' }), s = await call('/order', { tier: 'ultimate', email: 's@example.com', coin: 'sol' });
    assert.equal(b.symbol, 'BTC'); assert.ok(Number(b.units) >= 1000 && Number(b.units) < 1000 + 200, `$1 of bitcoin at $100k is about 1000 sats (${b.units})`); assert.equal(b.wallet, W.btc); assert.match(b.uri, /^bitcoin:bc1qtestbtcwallet\?amount=0\.0000\d+$/);
    assert.ok(BigInt(e.units) >= 250000000000000n && BigInt(e.units) < 250000000000000n + 2n * 10n ** 12n, `$1 of ether at $4000 (${e.units})`); assert.equal(e.uri, `ethereum:${W.eth}?value=${e.units}`);
    assert.ok(Number(s.units) >= 25000000 && Number(s.units) < 25000000 + 200000, `$5 of SOL at $200 is 0.025 SOL (${s.units})`);
    const again = await call('/order', { tier: 'pro', email: 'b2@example.com', coin: 'btc' }); assert.notEqual(again.units, b.units, 'every open order has its own amount');
    assert.equal((await call('/order', { tier: 'pro', email: 'x@example.com', coin: 'doge' })).status, 400);
  });
  await test('Bitcoin: a confirmed exact payment issues a key; wrong amount, unconfirmed, replayed and other people\'s payments do not', async () => {
    const o = await call('/order', { tier: 'pro', email: 'btcbuyer@example.com', coin: 'btc' });
    assert.equal((await call('/claim', { order: o.order, txid: hexid(1) })).pending, true, 'not on the network yet');
    btcTx.set(hexid(1), { paid: Number(o.units), time: null });
    const wait = await call('/claim', { order: o.order, txid: hexid(1) }); assert.equal(wait.pending, true); assert.match(wait.message, /confirmed/);
    btcTx.set(hexid(1), { paid: Number(o.units), time: Math.floor(Date.now() / 1000) });
    const ok = await call('/claim', { order: o.order, txid: 'https://mempool.space/tx/' + hexid(1) });
    assert.equal(ok.tier, 'Pro'); assert.ok(ok.key); assert.ok(mails.some((m) => m.to === 'btcbuyer@example.com'));
    const thief = await call('/order', { tier: 'pro', email: 'thief@example.com', coin: 'btc' });
    assert.equal((await call('/claim', { order: thief.order, txid: hexid(1) })).status, 409, 'the same payment cannot buy a second key');
    btcTx.set(hexid(2), { paid: Number(thief.units) - 1, time: Math.floor(Date.now() / 1000) });
    const short = await call('/claim', { order: thief.order, txid: hexid(2) }); assert.equal(short.status, 400); assert.match(short.error, /needs exactly/);
    btcTx.set(hexid(3), { paid: Number(thief.units), time: Math.floor(Date.now() / 1000) - 7200 });
    assert.equal((await call('/claim', { order: thief.order, txid: hexid(3) })).status, 400, 'a payment from before the order does not count');
  });
  await test('Ethereum: a plain transfer with enough confirmations works; a contract call, a failed transaction or too few confirmations do not', async () => {
    const o = await call('/order', { tier: 'pro', email: 'ethbuyer@example.com', coin: 'eth' });
    ethHead = 1000; ethTx.set(ethid(1), { to: W.eth.toLowerCase(), value: o.units, block: 999 });          // 2 confirmations
    const few = await call('/claim', { order: o.order, txid: ethid(1) }); assert.equal(few.pending, true);
    ethHead = 1002;
    const ok = await call('/claim', { order: o.order, txid: ethid(1) }); assert.equal(ok.tier, 'Pro'); assert.ok(ok.key);
    const o2 = await call('/order', { tier: 'pro', email: 'eth2@example.com', coin: 'eth' });
    ethTx.set(ethid(2), { to: W.eth, value: o2.units, block: 900, input: '0xa9059cbb0000' });             // a token transfer, not Ether
    assert.equal((await call('/claim', { order: o2.order, txid: ethid(2) })).status, 400);
    ethTx.set(ethid(3), { to: W.eth, value: o2.units, block: 900, failed: true });
    assert.equal((await call('/claim', { order: o2.order, txid: ethid(3) })).status, 400);
    ethTx.set(ethid(4), { to: '0x0000000000000000000000000000000000000001', value: o2.units, block: 900 });
    assert.equal((await call('/claim', { order: o2.order, txid: ethid(4) })).status, 400, 'paid someone else');
    assert.equal((await call('/claim', { order: o2.order, txid: 'not-a-tx' })).status, 400);
  });
  await test('Solana: the amount that reached our address is what counts, and a failed transaction does not', async () => {
    const o = await call('/order', { tier: 'ultimate', email: 'solbuyer@example.com', coin: 'sol' });
    assert.equal((await call('/claim', { order: o.order, txid: solid(1) })).pending, true);
    solTx.set(solid(1), { paid: Number(o.units) });
    const ok = await call('/claim', { order: o.order, txid: solid(1) }); assert.equal(ok.tier, 'Ultimate'); assert.ok(ok.key);
    const o2 = await call('/order', { tier: 'pro', email: 'sol2@example.com', coin: 'sol' });
    solTx.set(solid(2), { paid: Number(o2.units) - 5 }); const short = await call('/claim', { order: o2.order, txid: solid(2) }); assert.equal(short.status, 400); assert.match(short.error, /needs exactly/);
    solTx.set(solid(3), { paid: Number(o2.units), err: { InstructionError: [0, 'Custom'] } }); assert.equal((await call('/claim', { order: o2.order, txid: solid(3) })).status, 400);
  });
  await test('Without an address set, a coin is not offered', async () => {
    const keep = env.WALLET_SOL; delete env.WALLET_SOL;
    assert.ok(!(await call('/config')).coins.some((c) => c.id === 'sol')); assert.equal((await call('/order', { tier: 'pro', email: 'n@example.com', coin: 'sol' })).status, 400);
    env.WALLET_SOL = keep;
  });
  globalThis.fetch = ltcFetch;
}

await test('support without a GitHub account: a public report becomes an issue with its labels, a private one only goes to the inbox, bots are refused', async () => {
  const posts = []; const prevFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => { if (String(url).startsWith('https://api.github.com/')) { posts.push({ url: String(url), body: JSON.parse(init.body) }); return new Response(JSON.stringify({ html_url: 'https://github.com/AdityaJainDXB/NotchApples/issues/99', number: 99 }), { status: 201 }); } return prevFetch(url, init); };
  env.GITHUB_TOKEN = 'test'; mails.length = 0;
  const r = await call('/support', { kind: 'mac', title: 'Notch flickers', text: 'It flickers when I open Safari full screen.', email: 'user@example.com', version: '2.1.37', system: 'macOS 26', t: Date.now() - 20000 });
  assert.equal(r.url, 'https://github.com/AdityaJainDXB/NotchApples/issues/99');
  assert.deepEqual(posts[0].body.labels, ['bug', 'mac', 'from-website']); assert.match(posts[0].body.title, /^\[Mac\] Notch flickers/);
  assert.ok(!posts[0].body.body.includes('user@example.com'), 'the email is never published');
  assert.ok(mails.some((m) => m.to === 'user@example.com') && mails.some((m) => m.to === 'notchapple.support@gmail.com'), 'the sender gets a receipt and the inbox a copy');
  posts.length = 0; mails.length = 0;
  const p = await call('/support', { kind: 'support', title: 'Key not working', text: 'My Pro key says invalid after I moved Macs.', email: 'buyer@example.com', t: Date.now() - 20000 });
  assert.equal(p.url, null); assert.equal(posts.length, 0, 'licence questions are never posted publicly'); assert.ok(mails.some((m) => m.to === 'notchapple.support@gmail.com' && m.text.includes('buyer@example.com')));
  assert.equal((await call('/support', { kind: 'support', title: 'Key not working', text: 'No email given here at all.', t: Date.now() - 20000 })).status, 400, 'a private question needs an email');
  assert.equal((await call('/support', { kind: 'mac', title: 'x', text: 'short', t: Date.now() - 20000 })).status, 400);
  const bot = await call('/support', { kind: 'mac', title: 'Buy cheap pills', text: 'spam spam spam spam spam', website: 'http://spam', t: Date.now() - 20000 });
  assert.equal(bot.url, null); assert.equal(posts.length, 0, 'the trap field stops bots');
  delete env.GITHUB_TOKEN; globalThis.fetch = prevFetch;
});
