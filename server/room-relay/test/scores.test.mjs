// Friends leaderboards against fake Durable Objects. Run: node server/room-relay/test/scores.test.mjs
import assert from 'node:assert/strict';
import { FriendRate } from '../src/friends.js';
import * as S from '../src/scores.js';
const { Board } = S;

let passed = 0;
const test = async (name, fn) => { await fn(); passed++; console.log('  ✓ ' + name); };

class FakeState {
  constructor() { this.map = new Map(); this.alarm = null;
    this.storage = { get: async (k) => this.map.get(k), put: async (k, v) => { this.map.set(k, structuredClone(v)); }, delete: async (k) => this.map.delete(k),
      list: async ({ prefix }) => new Map([...this.map].filter(([k]) => k.startsWith(prefix)).sort(([a], [b]) => (a < b ? -1 : 1))),
      getAlarm: async () => this.alarm, setAlarm: async (t) => { this.alarm = t; } }; }
}
const boards = new Map(), rates = new Map();
const ns = (cls, store) => ({ idFromName: (n) => n, get: (id) => ({ fetch: (req, init) => (store.get(id) || store.set(id, new cls(new FakeState())).get(id)).fetch(typeof req === 'string' ? new Request(req, init) : req) }) });
const env = { BOARD: ns(Board, boards), FRIEND_RATE: ns(FriendRate, rates) };
let clock = Date.now(); const realNow = Date.now; Date.now = () => clock;

const hash = (c) => Array.from(c).map((ch) => ch.charCodeAt(0).toString(16).padStart(2, '0')).join('').padEnd(64, '0').slice(0, 64);
const B1 = hash('board-one'), B2 = hash('board-two');
let ipn = 0;
const post = async (o, ip) => {
  const res = await S.routeScores(new Request('https://relay.test/s/score', { method: 'POST', headers: { 'cf-connecting-ip': ip || `9.0.0.${++ipn}` }, body: JSON.stringify(o) }), env);
  return { status: res.status, json: await res.json() };
};
const top = async (board, game, ip) => {
  const res = await S.routeScores(new Request(`https://relay.test/s/top?board=${board}&game=${game}`, { headers: { 'cf-connecting-ip': ip || `8.0.0.${++ipn}` } }), env);
  return { status: res.status, json: await res.json() };
};
const dev = (n) => `device-${String(n).padStart(6, '0')}-abcdefgh`;

await test('names are cleaned: markup, control characters and length', () => {
  assert.equal(S.cleanName('  Ada   Lovelace '), 'Ada Lovelace');
  assert.equal(S.cleanName('<script>alert(1)</script>'), 'script alert(1) /scr');
  assert.equal(S.cleanName('a\u0000b‮c\n d'), 'a b c d');
  assert.equal([...S.cleanName('x'.repeat(50))].length, 20);
  assert.equal(S.cleanName('😀'.repeat(30)), '😀'.repeat(20));
  assert.equal(S.cleanName(''), 'Player');
  assert.equal(S.cleanName(null), 'Player');
  assert.equal(S.cleanName('<>"\''), 'Player');
});

await test('only the supported games exist, with a sanity range each', () => {
  for (const g of ['tetris', 'wordle', 'trivia', 'plane:hoops', 'plane:trial', 'plane:landing', 'plane:war', 'racing:spa', 'racing:hoval']) assert.ok(S.gameRules(g), g);
  for (const g of ['chess', 'racing:', 'racing:SPA', 'racing:a/b', 'plane:free', '__proto__', 'constructor', '', null, 5]) assert.equal(S.gameRules(g), null, String(g));
  assert.equal(S.gameRules('racing:spa').better, 'low');
  assert.equal(S.gameRules('tetris').better, 'high');
});

await test('silly values are rejected per game', () => {
  const ok = (game, score) => S.validateScore({ game, board: B1, id: dev(1), name: 'a', score }).ok;
  assert.equal(ok('tetris', 12000), true);
  assert.equal(ok('tetris', 0), false); assert.equal(ok('tetris', -5), false); assert.equal(ok('tetris', 9e9), false);
  assert.equal(ok('tetris', 1.5), false); assert.equal(ok('tetris', NaN), false); assert.equal(ok('tetris', '100'), false);
  assert.equal(ok('racing:spa', 92000), true); assert.equal(ok('racing:spa', 400), false); assert.equal(ok('racing:spa', 5e6), false);
  assert.equal(ok('wordle', 12), true); assert.equal(ok('wordle', 99999), false);
  assert.equal(ok('plane:hoops', 25), true); assert.equal(ok('plane:hoops', 5000), false);
  assert.equal(ok('plane:trial', 60000), true); assert.equal(ok('plane:trial', 100), false);
  assert.equal(S.validateScore({ game: 'tetris', board: 'short', id: dev(1), score: 5 }).ok, false);
  assert.equal(S.validateScore({ game: 'tetris', board: B1, id: 'x', score: 5 }).ok, false);
  assert.equal(S.validateScore(null).ok, false);
});

await test('post then read: best first, one row per device, names cleaned', async () => {
  assert.deepEqual((await top(B1, 'tetris')).json, { top: [] });
  const a = await post({ game: 'tetris', board: B1, id: dev(1), name: 'Ana', score: 5000 });
  assert.equal(a.status, 200); assert.equal(a.json.rank, 1);
  const b = await post({ game: 'tetris', board: B1, id: dev(2), name: '<b>Bo</b>', score: 9000 });
  assert.equal(b.json.rank, 1);
  const t = (await top(B1, 'tetris')).json.top;
  assert.deepEqual(t.map((e) => [e.name, e.score]), [['b Bo /b', 9000], ['Ana', 5000]]);
  assert.match(t[0].at, /^\d{4}-\d{2}-\d{2}$/);
  assert.deepEqual(Object.keys(t[0]).sort(), ['at', 'name', 'score']);   // nothing else is ever returned
});

await test('a device keeps its best score; a worse one is ignored; a new name applies', async () => {
  const w = await post({ game: 'tetris', board: B1, id: dev(1), name: 'Ana', score: 100 });
  assert.equal(w.json.changed, false); assert.equal(w.json.rank, 2);
  assert.equal((await top(B1, 'tetris')).json.top.find((e) => e.name === 'Ana').score, 5000);
  const r = await post({ game: 'tetris', board: B1, id: dev(1), name: 'Anna', score: 100 });
  assert.equal(r.json.changed, true);
  assert.ok((await top(B1, 'tetris')).json.top.some((e) => e.name === 'Anna' && e.score === 5000));
  assert.equal((await post({ game: 'tetris', board: B1, id: dev(1), name: 'Anna', score: 20000 })).json.rank, 1);
  assert.equal((await top(B1, 'tetris')).json.top.filter((e) => e.name === 'Anna').length, 1);
});

await test('lower is better for lap times, and games and boards are separate', async () => {
  await post({ game: 'racing:spa', board: B1, id: dev(1), name: 'Ana', score: 95000 });
  await post({ game: 'racing:spa', board: B1, id: dev(2), name: 'Bo', score: 91500 });
  await post({ game: 'racing:monza', board: B1, id: dev(2), name: 'Bo', score: 80000 });
  const t = (await top(B1, 'racing:spa')).json.top;
  assert.deepEqual(t.map((e) => e.name), ['Bo', 'Ana']);
  assert.equal((await top(B1, 'racing:monza')).json.top.length, 1);
  assert.deepEqual((await top(B2, 'racing:spa')).json.top, []);
  await post({ game: 'racing:spa', board: B1, id: dev(1), name: 'Ana', score: 90000 });   // improves
  assert.equal((await top(B1, 'racing:spa')).json.top[0].name, 'Ana');
});

await test('the top list is 20 long and a full game only admits better scores', async () => {
  for (let i = 0; i < S.MAX_PER_GAME; i++) await post({ game: 'wordle', board: B2, id: dev(100 + i), name: `P${i}`, score: 10 + i });
  assert.equal((await top(B2, 'wordle')).json.top.length, S.TOP_N);
  assert.equal((await top(B2, 'wordle')).json.top[0].score, 10 + S.MAX_PER_GAME - 1);
  const low = await post({ game: 'wordle', board: B2, id: dev(900), name: 'Low', score: 1 });
  assert.equal(low.status, 409);
  const hi = await post({ game: 'wordle', board: B2, id: dev(901), name: 'High', score: 3000 });
  assert.equal(hi.status, 200); assert.equal(hi.json.rank, 1);
  const state = boards.get(B2).state.map;
  assert.equal([...state.keys()].filter((k) => k.startsWith('e:wordle:')).length, S.MAX_PER_GAME);
});

await test('scores older than 90 days disappear', async () => {
  clock += 91 * 24 * 3600 * 1000;
  assert.deepEqual((await top(B1, 'tetris')).json, { top: [] });
  await boards.get(B1).alarm();
  assert.equal([...boards.get(B1).state.map.keys()].filter((k) => k.startsWith('e:')).length, 0);
});

await test('bad requests are refused, with CORS for the apps', async () => {
  assert.equal((await post({ game: 'chess', board: B1, id: dev(1), name: 'x', score: 5 })).status, 400);
  assert.equal((await post({ game: 'tetris', board: 'nope', id: dev(1), name: 'x', score: 5 })).status, 400);
  assert.equal((await top('zz', 'tetris')).status, 400);
  assert.equal((await top(B1, 'nothing')).status, 400);
  const nf = await S.routeScores(new Request('https://relay.test/s/other'), env); assert.equal(nf.status, 404);
  const big = await S.routeScores(new Request('https://relay.test/s/score', { method: 'POST', body: 'x'.repeat(2000) }), env); assert.equal(big.status, 413);
  const bad = await S.routeScores(new Request('https://relay.test/s/score', { method: 'POST', body: '{nope' }), env); assert.equal(bad.status, 400);
  const pre = await S.routeScores(new Request('https://relay.test/s/score', { method: 'OPTIONS' }), env);
  assert.equal(pre.headers.get('access-control-allow-origin'), '*');
  assert.equal(nf.headers.get('access-control-allow-origin'), '*');
});

await test('one address is rate limited, and nothing stored holds an address or the raw id', async () => {
  const ip = '7.7.7.7'; let last;
  for (let i = 0; i < 31; i++) last = await post({ game: 'tetris', board: B1, id: dev(5000 + i), name: 'r', score: 10 + i }, ip);
  assert.equal(last.status, 429);
  for (let i = 0; i < 121; i++) last = await top(B1, 'tetris', '6.6.6.6');
  assert.equal(last.status, 429);
  const dump = JSON.stringify([...boards.values()].map((b) => [...b.state.map])) + JSON.stringify([...rates.values()].map((b) => [...b.state.map]));
  assert.ok(!dump.includes('7.7.7.7') && !dump.includes('6.6.6.6') && !dump.includes('device-'));
});

Date.now = realNow;
console.log(`\n${passed} leaderboard tests passed`);
