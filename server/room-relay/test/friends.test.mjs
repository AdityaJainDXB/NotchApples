// Friends mailboxes against fake Durable Objects and the real client crypto. Run: node server/room-relay/test/friends.test.mjs
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { loadModule } from '../../../NotchWindows/tests/load.mjs';
import { Mailbox, FriendRate, routeFriends } from '../src/friends.js';

const F = await loadModule('services/friendscrypto.js');
let passed = 0;
const test = async (name, fn) => { await fn(); passed++; console.log('  ✓ ' + name); };

// ---- fakes: storage, sockets, namespaces

class FakeState {
  constructor() { this.map = new Map(); this.sockets = []; this.alarm = null;
    this.storage = { get: async (k) => this.map.get(k), put: async (k, v) => { this.map.set(k, structuredClone(v)); }, delete: async (k) => this.map.delete(k),
      list: async ({ prefix }) => new Map([...this.map].filter(([k]) => k.startsWith(prefix)).sort(([a], [b]) => (a < b ? -1 : 1))),
      deleteAll: async () => this.map.clear(), getAlarm: async () => this.alarm, setAlarm: async (t) => { this.alarm = t; } }; }
  getWebSockets() { return this.sockets; }
  acceptWebSocket(ws) { this.sockets.push(ws); }
}
const fakeWs = () => ({ sent: [], closed: null, send(m) { this.sent.push(JSON.parse(m)); }, close(code) { this.closed = code; } });
const R = Response;
globalThis.Response = class extends R { constructor(b, i = {}) { if (i.status === 101) { super(null, { ...i, status: 200 }); this.socket = i.webSocket; } else super(b, i); } };
globalThis.WebSocketPair = class { constructor() { this[0] = {}; this[1] = fakeWs(); } };

const states = new Map(), mailboxes = new Map(), rates = new Map();
const ns = (cls, store) => ({ idFromName: (n) => n, get: (id) => ({ fetch: (req, init) => (store.get(id) || store.set(id, new cls(new FakeState())).get(id)).fetch(typeof req === 'string' ? new Request(req, init) : req) }) });
const env = { MAILBOX: ns(Mailbox, mailboxes), FRIEND_RATE: ns(FriendRate, rates) };
const box = (name) => mailboxes.get(name);

let clock = Date.now();
const realNow = Date.now; Date.now = () => clock;
const tick = (ms = 1000) => { clock += ms; return clock; };

const call = async (method, path, { body, as, boxId, ip = '1.2.3.4', auth = true } = {}) => {
  const text = body === undefined ? '' : JSON.stringify(body);
  const headers = { 'cf-connecting-ip': ip };
  if (boxId) headers['x-nf-box'] = boxId;
  if (as && auth) headers['x-nf-auth'] = await F.authHeader(as, method, path, tick(), text);
  const res = await routeFriends(new Request(`https://relay.test${path}`, { method, headers, body: body === undefined ? undefined : text }), env);
  return { status: res.status, json: await res.json().catch(() => null), res };
};

// ---- people

const alice = await F.newIdentity(), bob = await F.newIdentity(), mallory = await F.newIdentity();
const codeA = F.newCode(), codeB = F.newCode(), codeM = F.newCode();
const boxA = await F.boxOf(codeA), boxB = await F.boxOf(codeB), boxM = await F.boxOf(codeM);
let n = 0;
const claim = (id, b) => call('POST', '/f/claim', { body: { box: b, sign: F.b64u(id.signPub), dh: F.b64u(id.dhPub) }, as: id, ip: `20.0.0.${++n}` });

await test('a code is 10 clean characters and its box never contains the code', async () => {
  assert.equal(codeA.length, 10);
  assert.match(codeA, /^[0-9A-HJKMNP-TV-Z]+$/);
  assert.equal(F.normalizeCode(` ${codeA.slice(0, 5).toLowerCase()}-${codeA.slice(5)} `), codeA);
  assert.equal(F.normalizeCode('oiL0123456'), '0110123456');
  assert.equal(F.normalizeCode('short'), null);
  assert.match(boxA, /^[0-9a-f]{32}$/);
  assert.ok(!boxA.includes(codeA.toLowerCase()));
});

await test('claiming a mailbox: signed, repeatable with the same keys, refused for someone else', async () => {
  assert.equal((await claim(alice, boxA)).status, 200);
  assert.equal((await claim(bob, boxB)).status, 200);
  assert.equal((await claim(alice, boxA)).status, 200, 'the same keys can claim again');
  assert.equal((await claim(mallory, boxA)).status, 409, 'squatting on a claimed mailbox fails');
  const noSig = await call('POST', '/f/claim', { body: { box: boxM, sign: F.b64u(mallory.signPub), dh: F.b64u(mallory.dhPub) }, as: mallory, auth: false, ip: '20.1.0.1' });
  assert.equal(noSig.status, 401, 'an unsigned claim is refused');
  const wrong = await call('POST', '/f/claim', { body: { box: boxM, sign: F.b64u(mallory.signPub), dh: F.b64u(mallory.dhPub) }, as: alice, ip: '20.1.0.2' });
  assert.equal(wrong.status, 401, 'a claim signed by a different key is refused');
});

await test('key lookup works for a claimed mailbox and says 404 otherwise', async () => {
  const k = await call('GET', `/f/key/${boxA}`);
  assert.equal(k.status, 200); assert.equal(k.json.sign, F.b64u(alice.signPub)); assert.equal(k.json.dh, F.b64u(alice.dhPub));
  assert.equal((await call('GET', `/f/key/${'0'.repeat(32)}`)).status, 404);
  assert.equal((await call('GET', '/f/key/notabox')).status, 400);
});

await test('the owner-signed calls refuse replays, old clocks and other people', async () => {
  const path = '/f/allow', body = JSON.stringify({ hash: 'a'.repeat(64) });
  const ts = tick();
  const header = await F.authHeader(alice, 'PUT', path, ts, body);
  const send = (h) => routeFriends(new Request(`https://relay.test${path}`, { method: 'PUT', headers: { 'x-nf-box': boxA, 'x-nf-auth': h, 'cf-connecting-ip': '9.9.9.9' }, body }), env);
  assert.equal((await send(header)).status, 200);
  assert.equal((await send(header)).status, 401, 'the same signed request twice is a replay');
  const stale = await F.authHeader(alice, 'PUT', path, clock - 6 * 60 * 1000, body);
  assert.equal((await send(stale)).status, 401, 'a clock more than 5 minutes off is refused');
  const forged = await F.authHeader(bob, 'PUT', path, tick(), body);
  assert.equal((await send(forged)).status, 401, "another person's key can't act on my mailbox");
  await call('DELETE', `/f/allow/${'a'.repeat(64)}`, { as: alice, boxId: boxA });
});

// ---- the friend flow

const tokenA = await F.newToken(), tokenB = await F.newToken();
const seen = {};

await test('a friend request reaches the mailbox sealed, and asking about a missing mailbox looks the same', async () => {
  await call('PUT', '/f/allow', { body: { hash: tokenA.hash }, as: alice, boxId: boxA });
  const req = await F.seal(alice, { box: boxB, dh: bob.dhPub }, 'req', { t: 'req', box: boxA, sign: F.b64u(alice.signPub), dh: F.b64u(alice.dhPub), nick: 'Ali', token: tokenA.token, ts: clock });
  const ok = await call('POST', '/f/req', { body: { to: boxB, blob: req } });
  assert.equal(ok.status, 202);
  const ghost = await call('POST', '/f/req', { body: { to: 'f'.repeat(32), blob: req }, ip: '5.5.5.5' });
  assert.equal(ghost.status, 202, 'same answer for a mailbox that does not exist');
  assert.deepEqual(ghost.json, ok.json);
  const stored = [...box(boxB).state.map.keys()].filter((k) => k.startsWith('r:'));
  assert.equal(stored.length, 1);
  const item = box(boxB).state.map.get(stored[0]);
  assert.ok(!JSON.stringify(item).includes('Ali') && !JSON.stringify(item).includes(boxA), 'the server stored only ciphertext');
  const opened = await F.open(bob, boxB, 'req', item.blob);
  assert.equal(opened.body.nick, 'Ali');
  assert.equal(await F.sealedBy(alice.signPub, boxB, 'req', opened), true, 'the signature checks out');
  assert.equal(await F.sealedBy(mallory.signPub, boxB, 'req', opened), false, 'and not for anyone else');
  seen.req = opened.body;
});

await test('messages need a send token the owner approved: a code alone does nothing', async () => {
  const blob = await F.seal(mallory, { box: boxB, dh: bob.dhPub }, 'msg', { t: 'msg', id: '1', ts: clock, text: 'spam' });
  assert.equal((await call('POST', '/f/send', { body: { to: boxB, token: tokenA.token, blob } })).status, 403, 'no token approved yet');
  assert.equal((await call('POST', '/f/send', { body: { to: boxB, token: F.b64u(crypto.getRandomValues(new Uint8Array(32))), blob } })).status, 403, 'a guessed token');
});

await test('accepting: Bob approves Alice\'s token holder path both ways and messages flow', async () => {
  // Bob accepts: he allows tokenB on his box (Alice will use it) and sends `acc` to Alice with tokenA from the request.
  await call('PUT', '/f/allow', { body: { hash: tokenB.hash }, as: bob, boxId: boxB });
  const acc = await F.seal(bob, { box: boxA, dh: alice.dhPub }, 'msg', { t: 'acc', box: boxB, sign: F.b64u(bob.signPub), dh: F.b64u(bob.dhPub), token: tokenB.token, ts: clock });
  assert.equal((await call('POST', '/f/send', { body: { to: boxA, token: seen.req.token, blob: acc } })).status, 200);
  const toBob = await F.seal(alice, { box: boxB, dh: bob.dhPub }, 'msg', { t: 'msg', id: 'm1', ts: clock, text: 'hello bob' });
  const sent = await call('POST', '/f/send', { body: { to: boxB, token: tokenB.token, blob: toBob } });
  assert.equal(sent.status, 200);
  const q = [...box(boxB).state.map].filter(([k]) => k.startsWith('q:'));
  assert.equal(q.length, 1);
  const opened = await F.open(bob, boxB, 'msg', q[0][1].blob);
  assert.equal(opened.body.text, 'hello bob');
  assert.equal(await F.sealedBy(alice.signPub, boxB, 'msg', opened), true);
  assert.equal(await F.open(alice, boxB, 'msg', q[0][1].blob), null, "Alice's own key can't open a message sealed to Bob");
  assert.equal(await F.open(bob, boxA, 'msg', q[0][1].blob), null, 'and a blob only opens for the box it was sealed for');
  const flipped = q[0][1].blob.slice(0, -4) + (q[0][1].blob.endsWith('AAAA') ? 'BBBB' : 'AAAA');
  assert.equal(await F.open(bob, boxB, 'msg', flipped), null, 'a changed blob is refused');
  seen.id = Number(q[0][0].slice(2));
});

await test('the live socket gets the waiting items first, then new ones; an ack deletes; one socket per owner', async () => {
  const ts = tick(), path = `/f/ws/${boxB}`;
  const res = await box(boxB).fetch(new Request(`https://relay.test${path}`, { headers: { Upgrade: 'websocket', 'x-nf-auth': await F.authHeader(bob, 'GET', path, ts, '') } }));
  assert.equal(res.status, 200);
  const ws = box(boxB).state.sockets[0];
  assert.equal(ws, res.socket ? ws : ws);
  assert.equal(ws.sent[0].type, 'hello'); assert.equal(ws.sent[0].requests.length, 1); assert.equal(ws.sent[0].queue.length, 1);
  const blob = await F.seal(alice, { box: boxB, dh: bob.dhPub }, 'msg', { t: 'msg', id: 'm2', ts: clock, text: 'live one' });
  await call('POST', '/f/send', { body: { to: boxB, token: tokenB.token, blob } });
  assert.equal(ws.sent.at(-1).type, 'msg');
  const typing = await call('POST', '/f/send', { body: { to: boxB, token: tokenB.token, blob, live: true } });
  assert.equal(typing.json.delivered, true); assert.equal(ws.sent.at(-1).type, 'live');
  assert.equal([...box(boxB).state.map.keys()].filter((k) => k.startsWith('q:')).length, 2, 'typing is never stored');
  await box(boxB).onMessage(ws, JSON.stringify({ ack: [seen.id] }));
  assert.equal([...box(boxB).state.map.keys()].filter((k) => k.startsWith('q:')).length, 1, 'an ack deletes the item');
  assert.equal(await box(boxB).state.storage.get('qCount'), 1);
  const ts2 = tick();
  await box(boxB).fetch(new Request(`https://relay.test${path}`, { headers: { Upgrade: 'websocket', 'x-nf-auth': await F.authHeader(bob, 'GET', path, ts2, '') } }));
  assert.equal(ws.closed, 4000, 'the older socket is replaced');
  const strangerSocket = await box(boxB).fetch(new Request(`https://relay.test${path}`, { headers: { Upgrade: 'websocket', 'x-nf-auth': await F.authHeader(mallory, 'GET', path, tick(), '') } }));
  assert.equal(strangerSocket.status, 401, 'only the owner can listen');
});

await test('typing for someone who is offline is dropped, not stored', async () => {
  box(boxA).state.sockets.length = 0;
  const blob = await F.seal(bob, { box: boxA, dh: alice.dhPub }, 'msg', { t: 'typing' });
  const r = await call('POST', '/f/send', { body: { to: boxA, token: seen.req.token, blob, live: true } });
  assert.equal(r.json.delivered, false);
  assert.equal([...box(boxA).state.map.keys()].filter((k) => k.startsWith('q:')).length, 1, 'only the earlier accept is waiting');
});

await test('revoking a token stops that person at once (remove friend, block)', async () => {
  await call('DELETE', `/f/allow/${tokenB.hash}`, { as: bob, boxId: boxB });
  const blob = await F.seal(alice, { box: boxB, dh: bob.dhPub }, 'msg', { t: 'msg', id: 'm3', ts: clock, text: 'still there?' });
  assert.equal((await call('POST', '/f/send', { body: { to: boxB, token: tokenB.token, blob } })).status, 403);
});

await test('limits: request cap, mailbox size, request rate, lookups, size of one blob', async () => {
  // 20 pending requests per mailbox
  const m = await F.newIdentity(), c = F.newCode(), b = await F.boxOf(c);
  await claim(m, b);
  const blob = await F.seal(alice, { box: b, dh: m.dhPub }, 'req', { t: 'req', n: 0 });
  for (let i = 0; i < 25; i++) await call('POST', '/f/req', { body: { to: b, blob }, ip: `10.0.${i}.1` });
  assert.equal([...box(b).state.map.keys()].filter((k) => k.startsWith('r:')).length, 20);
  // a full mailbox answers 507
  const t = await F.newToken();
  await call('PUT', '/f/allow', { body: { hash: t.hash }, as: m, boxId: b });
  let last = 200;
  for (let i = 0; i < 701 && last === 200; i++) last = (await call('POST', '/f/send', { body: { to: b, token: t.token, blob: 'AAAA' }, ip: `11.0.${i % 250}.${Math.floor(i / 250)}` })).status;
  assert.equal(last, 507);
  // 3 requests a minute per address and mailbox
  const codes = await F.boxOf('RATELIMIT1');
  const statuses = [];
  for (let i = 0; i < 5; i++) statuses.push((await call('POST', '/f/req', { body: { to: codes, blob }, ip: '7.7.7.7' })).status);
  assert.deepEqual(statuses, [202, 202, 202, 429, 429]);
  // 30 key lookups a minute
  const lookups = [];
  for (let i = 0; i < 32; i++) lookups.push((await call('GET', `/f/key/${boxA}`, { ip: '8.8.8.8' })).status);
  assert.equal(lookups.filter((s) => s === 429).length, 2);
  // a blob that is too big
  assert.equal((await call('POST', '/f/req', { body: { to: b, blob: 'A'.repeat(6000) }, ip: '6.6.6.6' })).status, 400);
  assert.equal((await call('POST', '/f/send', { body: { to: b, token: t.token, blob: '!!' }, ip: '6.6.6.7' })).status, 400, 'junk is refused');
});

await test('items older than 14 days are dropped', async () => {
  const s = box(boxB).state;
  await s.storage.put('q:000000009999', { blob: 'AAAA', at: clock - 15 * 24 * 3600 * 1000 }); await s.storage.put('qCount', 5);
  const items = await box(boxB).items('q:');
  assert.ok(!items.some((i) => i.id === 9999));
  assert.equal(s.map.has('q:000000009999'), false);
});

await test('wiping removes everything and closes the socket', async () => {
  const ws = fakeWs(); box(boxA).state.sockets.push(ws);
  assert.equal((await call('POST', '/f/wipe', { body: {}, as: alice, boxId: boxA })).status, 200);
  assert.equal(box(boxA).state.map.size, 0); assert.equal(ws.closed, 4001);
  assert.equal((await call('GET', `/f/key/${boxA}`)).status, 404);
});

await test('the shared vectors still match the client crypto (the Swift app checks the same file)', async () => {
  const v = JSON.parse(readFileSync(new URL('./friends-vectors.json', import.meta.url), 'utf8'));
  for (const c of v.codes) assert.equal(await F.boxOf(c.code), c.box);
  const [a, b] = await Promise.all(v.identities.map((i) => F.identityFromSeeds(F.unb64u(i.signSeed), F.unb64u(i.dhSeed))));
  assert.equal(F.b64u(a.signPub), v.identities[0].signPub); assert.equal(F.b64u(b.dhPub), v.identities[1].dhPub);
  assert.equal(F.b64u(await F.fingerprint(a.signPub, a.dhPub)), v.identities[0].fingerprint);
  assert.equal(await F.authMessage(v.auth.method, v.auth.path, v.auth.ts, v.auth.body), v.auth.message);
  assert.equal(await F.authHeader(a, v.auth.method, v.auth.path, v.auth.ts, v.auth.body), v.auth.header);
  assert.equal(await F.tokenHash(v.tokenHash.token), v.tokenHash.hash);
  assert.equal(await F.safetyNumber(a, b), v.safetyNumber); assert.equal(await F.safetyNumber(b, a), v.safetyNumber, 'both sides see the same number');
  const sealed = await F.seal(a, { box: v.seal.recipientBox, dh: b.dhPub }, v.seal.kind, v.seal.body, { ephSeed: F.unb64u(v.seal.ephSeed), nonce: F.unb64u(v.seal.nonce) });
  assert.equal(sealed, v.seal.blob);
  const opened = await F.open(b, v.seal.recipientBox, v.seal.kind, v.seal.blob);
  assert.deepEqual(opened.body, v.seal.body);
  assert.equal(await F.sealedBy(a.signPub, v.seal.recipientBox, v.seal.kind, opened), true);
});

Date.now = realNow;
console.log(`\n${passed} passed.`);
