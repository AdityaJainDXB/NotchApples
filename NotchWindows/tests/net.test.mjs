// Battle over the network: room codes, the link to the relay, state messages and votes. Run: node --test NotchWindows/tests
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

globalThis.window = globalThis;
globalThis.document = { getElementById: () => null };
createRequire(import.meta.url)('../src/js/games/plane-sim.js');
const { NET } = globalThis.NotchPlaneGame._test;

/// A pretend relay: every frame one socket sends goes to the others in the same room, as the real one does.
function fakeRelay() {
  const rooms = new Map();
  class Socket {
    constructor(url) {
      this.url = url; this.topic = url.split('/').slice(-2)[0]; this.closed = false;
      if (!rooms.has(this.topic)) rooms.set(this.topic, new Set());
      rooms.get(this.topic).add(this);
      queueMicrotask(() => { if (!this.closed) this.onmessage && this.onmessage({ data: JSON.stringify({ event: 'open' }) }); });
    }
    send(data) { for (const p of rooms.get(this.topic)) if (p !== this && !p.closed) queueMicrotask(() => p.onmessage && p.onmessage({ data })); }
    close() { this.closed = true; rooms.get(this.topic).delete(this); queueMicrotask(() => this.onclose && this.onclose()); }
  }
  return { Socket, rooms };
}
const tick = () => new Promise((r) => setTimeout(r, 5));

test('room codes are six easy characters, and typed codes are tidied up', () => {
  const c = NET.newCode();
  assert.match(c, /^[A-HJKMNP-Z2-9]{6}$/);
  assert.equal(NET.normCode(' k7pd-2m '), 'K7PD2M');
  assert.equal(NET.normCode('K7PD2'), null, 'too short');
  assert.equal(NET.normCode('K7PD20'), null, '0 is not used');
  assert.equal(NET.normCode(''), null);
  assert.equal(NET.normCode(null), null);
});

test('a room code becomes a relay topic that hides the code, and the same code always gives the same topic', async () => {
  const a = await NET.topicFor('K7PD2M'), b = await NET.topicFor('K7PD2M'), c = await NET.topicFor('K7PD2N');
  assert.equal(a, b);
  assert.notEqual(a, c);
  assert.match(a, /^notchapple-v1-[0-9a-f]{40}$/);          // the shape the relay accepts
  assert.ok(!a.includes('K7PD2M'.toLowerCase()));
});

test('two players in the same room hear each other, and a stranger in another room does not', async () => {
  const { Socket } = fakeRelay();
  const got = { a: [], b: [], c: [] };
  const mk = (name) => new NET.Link(Socket, (m) => got[name].push(m), () => {});
  const a = mk('a'), b = mk('b'), c = mk('c');
  await a.join('K7PD2M'); await b.join('K7PD2M'); await c.join('ZZZZZZ'.replace(/Z/g, 'X'));
  await tick();
  assert.equal(a.state, 'on'); assert.equal(b.state, 'on');
  assert.ok(a.send({ t: 'hi', id: 'a' }));
  await tick();
  assert.deepEqual(got.b.map((m) => m.id), ['a']);
  assert.equal(got.a.length, 0, 'you do not hear yourself');
  assert.equal(got.c.length, 0, 'another room hears nothing');
});

test('a link that was never opened or has been closed sends nothing, and bad frames are ignored', async () => {
  const { Socket } = fakeRelay();
  const link = new NET.Link(Socket, () => { throw new Error('should not be called'); }, () => {});
  assert.equal(link.send({ t: 'x' }), false);
  await link.join('K7PD2M'); await tick();
  link.ws.onmessage({ data: 'not json' });
  link.ws.onmessage({ data: JSON.stringify({ hello: 1 }) });         // no message type: ignored
  link.close();
  assert.equal(link.state, 'off');
  assert.equal(link.send({ t: 'x' }), false);
});

test('a link comes back by itself when the connection drops', async () => {
  const { Socket, rooms } = fakeRelay();
  const states = [];
  const link = new NET.Link(Socket, () => {}, (s) => states.push(s));
  await link.join('K7PD2M'); await tick();
  const sock = link.ws;
  sock.onclose();                                                    // the connection drops
  assert.equal(link.state, 'connecting');
  await new Promise((r) => setTimeout(r, 1100));
  await tick();
  assert.equal(link.state, 'on', `states: ${states.join(' ')}`);
  assert.notEqual(link.ws, sock);
  link.close();
});

test('state messages are small and survive the trip', () => {
  const s = { kind: 'tank', pos: [123.456, 9.04, -2000.99], q: [0.1234567, 0, -0.5, 0.8], vel: [3.14159, 0, -12.7], hp: 187.6, turret: 1.23456, gun: 0.2, firing: true, alive: true };
  const m = NET.packState('abc', s);
  assert.ok(JSON.stringify(m).length < 190, `a message is ${JSON.stringify(m).length} bytes`);
  const back = NET.unpackState(JSON.parse(JSON.stringify(m)));
  assert.equal(back.kind, 'tank'); assert.equal(back.hp, 188); assert.equal(back.firing, true); assert.equal(back.alive, true);
  assert.ok(Math.abs(back.pos[0] - 123.5) < 0.06); assert.ok(Math.abs(back.turret - 1.235) < 0.001);
  assert.equal(NET.unpackState(NET.packState('x', { ...s, alive: false })).alive, false);
});

test('a remote vehicle glides to where it is reported, carried on by its speed, without jumping', () => {
  const report = { pos: [0, 100, 0], vel: [0, 0, -100] };
  const first = NET.glide(null, report, 0, 1 / 60);
  assert.deepEqual(first, [0, 100, 0]);
  const later = NET.glide(first, report, 0.2, 1 / 60);             // 0.2 s on, it should be heading to z = -20
  assert.ok(later[2] < 0 && later[2] > -20, 'it moves towards the carried-on place, not all the way at once');
  let p = first;
  for (let i = 0; i < 120; i++) p = NET.glide(p, report, 0.2, 1 / 60);
  assert.ok(Math.abs(p[2] + 20) < 0.5, 'and settles on it');
  assert.ok(NET.glide(first, report, 5, 1 / 60)[2] > -50, 'a report that is seconds old is only carried on a little way');
});

test('a vote passes with more than half of the players', () => {
  const ids = ['a', 'b', 'c'];
  const opts = ['coop', 'versus'];
  let r = NET.tally(ids, { a: { side: 'versus' } }, 'side', 'coop', opts);
  assert.equal(r.passed, null); assert.equal(r.need, 2);
  r = NET.tally(ids, { a: { side: 'versus' }, b: { side: 'versus' } }, 'side', 'coop', opts);
  assert.equal(r.passed, 'versus');
  r = NET.tally(ids, { a: { side: 'coop' }, b: { side: 'coop' } }, 'side', 'coop', opts);
  assert.equal(r.passed, null, 'voting for what it already is changes nothing');
  r = NET.tally(['a', 'b'], { a: { side: 'versus' } }, 'side', 'coop', opts);
  assert.equal(r.passed, null, 'one of two is not more than half');
  r = NET.tally(['a'], { a: { side: 'versus' } }, 'side', 'coop', opts);
  assert.equal(r.passed, 'versus', 'alone, your own vote is enough');
  r = NET.tally(ids, { a: { side: 'nonsense' }, b: { side: 'nonsense' } }, 'side', 'coop', opts);
  assert.equal(r.passed, null, 'only real choices count');
});

test('players start in different places', () => {
  const spots = new Set(Array.from({ length: 8 }, (_, i) => NET.slotOffset(i).join(',')));
  assert.equal(spots.size, 8);
});
