// End-to-end against a running relay (real Durable Objects and WebSockets), as two people would use it:
//   cd server/room-relay && npx wrangler dev --port 8799 --local      (in another terminal)
//   node server/room-relay/test/e2e.mjs http://localhost:8799
import assert from 'node:assert/strict';
import { loadModule } from '../../../NotchWindows/tests/load.mjs';

const F = await loadModule('services/friendscrypto.js');
const base = process.argv[2] || 'http://localhost:8799';
const call = async (method, path, { body, as, box } = {}) => {
  const text = body === undefined ? '' : JSON.stringify(body);
  const headers = { 'content-type': 'application/json' };
  if (box) headers['x-nf-box'] = box;
  if (as) headers['x-nf-auth'] = await F.authHeader(as, method, path, Date.now(), text);
  const r = await fetch(base + path, { method, headers, body: body === undefined ? undefined : text });
  return { status: r.status, json: await r.json().catch(() => ({})) };
};
const listen = async (id, box) => {
  const path = `/f/ws/${box}`;
  const ws = new WebSocket(base.replace('http', 'ws') + path + '?a=' + encodeURIComponent(await F.authHeader(id, 'GET', path, Date.now(), '')));
  const inbox = []; let wake;
  ws.onmessage = (e) => { if (e.data === 'pong') return; inbox.push(JSON.parse(e.data)); wake?.(); };
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = () => rej(new Error('socket failed')); });
  const next = async (type) => { for (let i = 0; i < 100; i++) { const k = inbox.findIndex((m) => m.type === type); if (k >= 0) return inbox.splice(k, 1)[0]; await new Promise((r) => { wake = r; setTimeout(r, 100); }); } throw new Error('no ' + type); };
  return { ws, next };
};

const alice = await F.newIdentity(), bob = await F.newIdentity();
const boxA = await F.boxOf(F.newCode()), boxB = await F.boxOf(F.newCode());
for (const [id, box] of [[alice, boxA], [bob, boxB]]) assert.equal((await call('POST', '/f/claim', { body: { box, sign: F.b64u(id.signPub), dh: F.b64u(id.dhPub) }, as: id })).status, 200);
const key = await call('GET', `/f/key/${boxB}`); assert.equal(key.json.dh, F.b64u(bob.dhPub));

// Alice asks Bob. Bob is online and sees it at once.
const bobSock = await listen(bob, boxB); await bobSock.next('hello');
const tokenA = await F.newToken();
await call('PUT', '/f/allow', { body: { hash: tokenA.hash }, as: alice, box: boxA });
const req = await F.seal(alice, { box: boxB, dh: bob.dhPub }, 'req', { t: 'req', box: boxA, sign: F.b64u(alice.signPub), dh: F.b64u(alice.dhPub), nick: 'Alice', token: tokenA.token, ts: Date.now() });
assert.equal((await call('POST', '/f/req', { body: { to: boxB, blob: req } })).status, 202);
const gotReq = await bobSock.next('req');
const opened = await F.open(bob, boxB, 'req', gotReq.blob);
assert.equal(opened.body.nick, 'Alice'); assert.equal(await F.sealedBy(alice.signPub, boxB, 'req', opened), true);
bobSock.ws.send(JSON.stringify({ ack: [gotReq.id] }));

// Bob accepts: allows his own token and sends `acc` with Alice's token. Alice is OFFLINE: it waits for her.
const tokenB = await F.newToken();
await call('PUT', '/f/allow', { body: { hash: tokenB.hash }, as: bob, box: boxB });
const acc = await F.seal(bob, { box: boxA, dh: alice.dhPub }, 'msg', { t: 'acc', box: boxB, sign: F.b64u(bob.signPub), dh: F.b64u(bob.dhPub), token: tokenB.token, ts: Date.now() });
assert.equal((await call('POST', '/f/send', { body: { to: boxA, token: opened.body.token, blob: acc } })).status, 200);
const aliceSock = await listen(alice, boxA);
const hello = await aliceSock.next('hello');
assert.equal(hello.queue.length, 1, 'the accept waited for Alice');
const accOpened = await F.open(alice, boxA, 'msg', hello.queue[0].blob);
assert.equal(accOpened.body.t, 'acc'); assert.equal(await F.sealedBy(bob.signPub, boxA, 'msg', accOpened), true);
aliceSock.ws.send(JSON.stringify({ ack: [hello.queue[0].id] }));

// Chat both ways, live.
const msg = await F.seal(alice, { box: boxB, dh: bob.dhPub }, 'msg', { t: 'msg', from: boxA, id: '1', text: 'hi Bob', ts: Date.now() });
assert.equal((await call('POST', '/f/send', { body: { to: boxB, token: accOpened.body.token, blob: msg } })).status, 200);
const live = await bobSock.next('msg');
assert.equal((await F.open(bob, boxB, 'msg', live.blob)).body.text, 'hi Bob');
const typing = await F.seal(bob, { box: boxA, dh: alice.dhPub }, 'msg', { t: 'typing', from: boxB });
assert.equal((await call('POST', '/f/send', { body: { to: boxA, token: opened.body.token, blob: typing, live: true } })).json.delivered, true);
assert.equal((await F.open(alice, boxA, 'msg', (await aliceSock.next('live')).blob)).body.t, 'typing');

// Acks delete; a removed friend is shut out at once; a wipe clears the mailbox.
bobSock.ws.send(JSON.stringify({ ack: [live.id] }));
await call('DELETE', `/f/allow/${tokenB.hash}`, { as: bob, box: boxB });
assert.equal((await call('POST', '/f/send', { body: { to: boxB, token: accOpened.body.token, blob: msg } })).status, 403);
assert.equal((await call('POST', '/f/wipe', { body: {}, as: alice, box: boxA })).status, 200);
assert.equal((await call('POST', '/f/wipe', { body: {}, as: bob, box: boxB })).status, 200);
assert.equal((await call('GET', `/f/key/${boxA}`)).status, 404);
bobSock.ws.close(); aliceSock.ws.close();
console.log('end-to-end: ok');
process.exit(0);
