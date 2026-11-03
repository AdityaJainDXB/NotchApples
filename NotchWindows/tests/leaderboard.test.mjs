import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

// A tiny localStorage and a recording fetch, installed before the module runs.
const mem = new Map();
globalThis.localStorage = { getItem: (k) => (mem.has(k) ? mem.get(k) : null), setItem: (k, v) => mem.set(k, String(v)), removeItem: (k) => mem.delete(k) };
const calls = [];
globalThis.fetch = async (url, init = {}) => { calls.push({ url, init }); return { ok: true, status: 200, json: async () => ({ ok: true, rank: 1, top: [] }) }; };
const LB = createRequire(import.meta.url)('../src/js/games/leaderboard.js');
const T = LB._t;
const settle = () => new Promise((r) => setTimeout(r, 20));
const reset = () => { mem.clear(); calls.length = 0; };

test('board codes are 6 clean characters, and typed codes are tidied', () => {
  const c = T.newCode();
  assert.match(c, /^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{6}$/);
  assert.equal(T.normalizeCode(' k7m-2qx '), 'K7M2QX');
  for (const bad of ['', 'K7M2Q', 'K7M2QXX', 'K7M2Q0', 'K7M2QO', 'K7M2QI', null, 'K7M2Q!']) assert.equal(T.normalizeCode(bad), null, String(bad));
});

test('the board is identified by a hash; the code itself is never sent', async () => {
  const h = await T.boardHash('K7M2QX');
  assert.match(h, /^[0-9a-f]{64}$/);
  assert.notEqual(h, await T.boardHash('K7M2QY'));
  assert.equal(h, await T.boardHash('K7M2QX'));
});

test('names are cleaned to 20 characters without markup', () => {
  assert.equal(T.cleanName('  <b>Ada</b>   L  '), 'b Ada /b L');
  assert.equal(T.cleanName('x'.repeat(40)).length, 20);
  assert.equal(T.cleanName(null), '');
});

test('scores are shown the right way', () => {
  assert.equal(T.fmtScore(92345, 'time'), '1:32.345');
  assert.equal(T.fmtScore(5000, 'time'), '0:05.000');
  assert.equal(T.fmtScore(1, 'days'), '1 day');
  assert.equal(T.fmtScore(12, 'days'), '12 days');
  assert.equal(T.fmtScore(1234567, 'points'), '1,234,567');
});

test('nothing is sent by default', async () => {
  reset();
  LB.submit('tetris', 5000); await settle();
  assert.equal(calls.length, 0);
});

test('nothing is sent when sharing is on but no board is joined, or a board is joined but sharing is off', async () => {
  reset(); mem.set('lb.on', 'true'); LB.submit('tetris', 5000); await settle(); assert.equal(calls.length, 0);
  reset(); mem.set('lb.code', JSON.stringify('K7M2QX')); LB.submit('tetris', 5000); await settle(); assert.equal(calls.length, 0);
});

test('opted in and joined: exactly the game, score, name, board hash and a random id are sent', async () => {
  reset();
  mem.set('lb.on', 'true'); mem.set('lb.code', JSON.stringify('K7M2QX')); mem.set('lb.name', JSON.stringify('Ada'));
  LB.submit('racing:spa', 91500); await settle();
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, 'https://notchapple-rooms.adityajain1225.workers.dev/s/score');
  assert.equal(calls[0].init.method, 'POST');
  assert.equal(calls[0].init.credentials, 'omit');
  const body = JSON.parse(calls[0].init.body);
  assert.deepEqual(Object.keys(body).sort(), ['board', 'game', 'id', 'name', 'score']);
  assert.equal(body.game, 'racing:spa'); assert.equal(body.score, 91500); assert.equal(body.name, 'Ada');
  assert.equal(body.board, await T.boardHash('K7M2QX'));
  assert.match(body.id, /^[0-9a-f]{32}$/);
  assert.ok(!JSON.stringify(body).includes('K7M2QX'));
  LB.submit('tetris', 10); await settle();
  assert.equal(JSON.parse(calls[1].init.body).id, body.id);   // the same random id every time
});

test('silly scores are not sent, and a network failure never throws into the game', async () => {
  reset(); mem.set('lb.on', 'true'); mem.set('lb.code', JSON.stringify('K7M2QX'));
  for (const bad of [0, -3, 1.5, NaN, '10', null]) LB.submit('tetris', bad);
  await settle(); assert.equal(calls.length, 0);
  globalThis.fetch = async () => { throw new Error('offline'); };
  assert.doesNotThrow(() => LB.submit('tetris', 100)); await settle();
});
