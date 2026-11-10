import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

// privategame.js reads its settings from the browser's storage: give it a small one.
const mem = new Map();
globalThis.window = globalThis;
globalThis.localStorage = { getItem: (k) => (mem.has(k) ? mem.get(k) : null), setItem: (k, v) => mem.set(k, String(v)), removeItem: (k) => mem.delete(k) };
globalThis.document = { addEventListener() {}, querySelector: () => null, documentElement: { style: {}, dataset: {} } };

const L = await import('../src/js/modules/gameslogic.js');
const P = await import('../src/js/services/privategame.js');

test('the catalog is sound: unique ids, known filters, one private locked game', () => {
  assert.equal(new Set(L.GAMES.map((g) => g.id)).size, L.GAMES.length);
  const cats = new Set(L.CATEGORIES.map((c) => c.id));
  for (const g of L.GAMES) {
    assert.ok(g.cats.length > 0 && g.cats.every((c) => cats.has(c) && c !== 'all'), g.name);
    assert.equal(g.art.length, 2, g.name);
  }
  const priv = L.GAMES.filter((g) => g.cats.includes('private'));
  assert.deepEqual(priv.map((g) => g.id), ['fe']);
  assert.equal(priv[0].locked, true);
  assert.deepEqual(L.GAMES.filter((g) => g.locked).map((g) => g.id), ['fe']);
});

test('search and filters narrow the games down, and the counts add up', () => {
  assert.equal(L.filterGames(L.GAMES, {}).length, L.GAMES.length);
  assert.deepEqual(L.filterGames(L.GAMES, { q: 'tet' }).map((g) => g.id), ['tetris']);
  assert.deepEqual(L.filterGames(L.GAMES, { q: '  DAILY ' }).map((g) => g.id), ['wordle', 'trivia']);
  assert.deepEqual(L.filterGames(L.GAMES, { cat: 'private' }).map((g) => g.id), ['fe']);
  assert.deepEqual(L.filterGames(L.GAMES, { q: 'chess', cat: 'online' }).map((g) => g.id), ['chess']);
  assert.deepEqual(L.filterGames(L.GAMES, { q: 'chess', cat: 'arcade' }), []);
  const n = L.counts(L.GAMES);
  assert.equal(n.all, L.GAMES.length);
  assert.equal(n.online, L.filterGames(L.GAMES, { cat: 'online' }).length);
  assert.equal(n.daily, 2);
});

test('"Jump back in" keeps the newest first, no repeats, at most three, only real games', () => {
  assert.deepEqual(L.recordRecent([], 'snake'), ['snake']);
  assert.deepEqual(L.recordRecent(['snake', 'tetris'], 'tetris'), ['tetris', 'snake']);
  assert.deepEqual(L.recordRecent(['a', 'snake', 'tetris', 'plane'], 'chess'), ['chess', 'snake', 'tetris']);
  assert.deepEqual(L.recordRecent('nonsense', 'snake'), ['snake']);
});

test('every ordinary game in the menu is something the Games page can open', () => {
  const src = fs.readFileSync(new URL('../src/js/modules/games.js', import.meta.url), 'utf8');
  const map = src.slice(src.indexOf('stop = ({'), src.indexOf('})[g](board)'));
  const keys = new Set(map.split(/[\s,:{}()=]+/));
  for (const g of L.GAMES.filter((x) => !x.locked)) assert.ok(keys.has(g.id), `${g.name} (${g.id}) is not in the games.js list`);
});

test('access codes are cleaned and shown in blocks of four', () => {
  assert.equal(P.cleanCode('abcd-efgh-jkmn'), 'ABCDEFGHJKMN');
  assert.equal(P.cleanCode(' abcd efgh jkmn '), 'ABCDEFGHJKMN');
  assert.equal(P.cleanCode('too-short'), '');
  assert.equal(P.cleanCode('abcdefghjkmnp'), '');
  assert.equal(P.prettyCode('abcdefghjkmn'), 'ABCD-EFGH-JKMN');
  assert.equal(P.prettyCode('abcdefg'), 'ABCD-EFG');
  assert.equal(P.prettyCode('abcdefghjkmnqqq'), 'ABCD-EFGH-JKMN');
  assert.equal(P.isUnlocked(), false);
});

test('the Mac list in GamesMenuLogic.swift is the same list', () => {
  // A line marked "// Mac only" is a game the Windows app does not have (FNAF 1 plays a web page, and Windows blocks frames).
  const swift = fs.readFileSync(new URL('../../NotchApple/Modules/Games/GamesMenuLogic.swift', import.meta.url), 'utf8')
    .split('\n').filter((line) => !line.includes('// Mac only')).join('\n');
  const mac = [...swift.matchAll(/\.init\(id: "(\w+)", name: "([^"]+)", cats: \[([^\]]*)\], tags: \[([^\]]*)\]/g)]
    .map((m) => [m[1], m[2], m[3].match(/"(\w+)"/g)?.map((s) => s.slice(1, -1)) || [], m[4].match(/"([^"]+)"/g)?.map((s) => s.slice(1, -1)) || []]);
  assert.deepEqual(mac, L.GAMES.map((g) => [g.id, g.name, g.cats, g.tags]));
  const cats = [...swift.matchAll(/\("(\w+)", "([^"]+)"\)/g)].map((m) => [m[1], m[2]]);
  assert.deepEqual(cats, L.CATEGORIES.map((c) => [c.id, c.name]));
});
