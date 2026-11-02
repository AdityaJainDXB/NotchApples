import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const W = require('../src/js/games/wordle-logic.js');
const { answers, valid } = require('../src/js/games/wordle-words.js');
const s = (g, a) => W.score(g, a).join('');

test('scoring: all green, all grey, and a mix', () => {
  assert.equal(s('crane', 'crane'), 'ggggg');
  assert.equal(s('fuzzy', 'crane'), 'xxxxx');
  assert.equal(s('react', 'crane'), 'yygyx');
  assert.equal(s('plate', 'crane'), 'xxgxg');
});

test('scoring: duplicate letters in the guess are only coloured as often as the answer has them', () => {
  assert.equal(s('speed', 'abide'), 'xxyxy');         // abide has one e: the first e is yellow, the second is grey
  assert.equal(s('llama', 'blast'), 'xggxx');         // one l and one a, both already green: the others are grey
  assert.equal(s('hello', 'world'), 'xxxgy');         // one l in world, and it is the green one
  assert.equal(s('eerie', 'eagle'), 'gxxxg');         // eagle has two e, both matched in place
  assert.equal(s('geese', 'where'), 'xxgxg');         // greens take both e of where, so the first e is grey
});

test('scoring: a green takes the letter before a yellow does, wherever it is in the word', () => {
  assert.equal(s('babes', 'abbey'), 'yyggx');         // the later b is green, so only one b is left for the first
  assert.equal(s('speed', 'erase'), 'yxyyx');         // erase has two e: both e of speed are yellow
  assert.equal(s('mamma', 'llama'), 'xyxgg');
});

test('scoring never marks a letter more often than the answer holds it', () => {
  const words = answers.slice(0, 120);
  for (const a of words) for (const g of words.slice(0, 40)) {
    const r = W.score(g, a), count = {};
    r.forEach((c, i) => { if (c !== 'x') count[g[i]] = (count[g[i]] || 0) + 1; });
    for (const [ch, n] of Object.entries(count)) assert.ok(n <= [...a].filter((x) => x === ch).length, `${g} vs ${a}`);
    r.forEach((c, i) => assert.equal(c === 'g', g[i] === a[i]));
  }
});

test('the daily word is the same for the same day and does not repeat for a full cycle', () => {
  assert.equal(W.dailyWord(answers, '2026-11-02'), W.dailyWord(answers, '2026-11-02'));
  assert.ok(answers.includes(W.dailyWord(answers, '2026-11-02')));
  assert.notEqual(W.dailyWord(answers, '2026-11-02'), W.dailyWord(answers, '2026-11-03'));
  const seen = new Set(); let key = '2026-01-01';
  for (let i = 0; i < answers.length; i++) { seen.add(W.dailyWord(answers, key)); const [y, m, d] = key.split('-').map(Number); key = W.dateKey(new Date(y, m - 1, d + 1)); }
  assert.equal(seen.size, answers.length);              // every answer once before any repeats
});

test('the daily word depends only on the local calendar date, not the time of day', () => {
  const morning = W.dateKey(new Date(2026, 10, 2, 0, 5)), night = W.dateKey(new Date(2026, 10, 2, 23, 55));
  assert.equal(morning, '2026-11-02'); assert.equal(night, '2026-11-02');
  assert.equal(W.dailyWord(answers, morning), W.dailyWord(answers, night));
  assert.equal(W.prevKey('2026-03-01'), '2026-02-28'); assert.equal(W.prevKey('2024-03-01'), '2024-02-29'); assert.equal(W.prevKey('2027-01-01'), '2026-12-31');
});

test('the step is coprime with the number of answers', () => {
  const gcd = (a, b) => (b ? gcd(b, a % b) : a);
  assert.equal(gcd(W.STEP, answers.length), 1);
});

test('practice words are random answers and differ from the last one', () => {
  let i = 0; const rng = () => [0.0, 0.0, 0.5][i++ % 3];
  const a = W.randomWord(answers, rng, null), b = W.randomWord(answers, rng, a);
  assert.ok(answers.includes(a) && answers.includes(b)); assert.notEqual(a, b);
});

test('keyboard colours keep the best result for each letter', () => {
  const m = W.letterStates(['slate', 'crane'], 'crane');
  assert.equal(m.c, 'g'); assert.equal(m.r, 'g'); assert.equal(m.a, 'g'); assert.equal(m.e, 'g'); assert.equal(m.n, 'g');
  assert.equal(m.s, 'x'); assert.equal(m.l, 'x'); assert.equal(m.t, 'x');
  const y = W.letterStates(['arose'], 'crane');           // a: yellow, r: green, o: grey, s: grey, e: green
  assert.equal(y.a, 'y'); assert.equal(y.r, 'g'); assert.equal(y.e, 'g'); assert.equal(y.o, 'x');
  const up = W.letterStates(['eagle', 'crane'], 'crane'); // a yellow then green: green wins
  assert.equal(up.a, 'g');
});

test('streak: consecutive wins grow it, a gap or a loss resets it, the same day counts once', () => {
  let st = W.newStats();
  st = W.record(st, '2026-11-01', true, 3); assert.equal(st.streak, 1);
  st = W.record(st, '2026-11-02', true, 4); assert.equal(st.streak, 2);
  const again = W.record(st, '2026-11-02', true, 4); assert.equal(again.played, st.played); assert.equal(again.streak, 2);
  assert.equal(W.currentStreak(st, '2026-11-02'), 2);
  assert.equal(W.currentStreak(st, '2026-11-03'), 2);     // yesterday's win keeps it alive today
  assert.equal(W.currentStreak(st, '2026-11-04'), 0);     // a missed day ends it
  st = W.record(st, '2026-11-05', true, 2); assert.equal(st.streak, 1); assert.equal(st.best, 2);
  st = W.record(st, '2026-11-06', false, 6); assert.equal(st.streak, 0); assert.equal(st.best, 2);
  assert.equal(st.played, 4); assert.equal(st.won, 3);
  assert.deepEqual(st.dist, [0, 1, 1, 1, 0, 0]);
  assert.equal(W.record(W.newStats(), '2026-12-31', true, 1).streak, 1);
  const across = W.record(W.record(W.newStats(), '2026-12-31', true, 1), '2027-01-01', true, 1); assert.equal(across.streak, 2);
});

test('share text has squares and no letters', () => {
  const t = W.shareText('2026-11-02', ['slate', 'crane'], 'crane', false);
  assert.equal(t.split('\n')[0], 'Daily Word 2026-11-02 2/6');
  const rows = t.split('\n').slice(2);
  assert.equal(rows.length, 2);
  assert.equal(rows[1], '🟩🟩🟩🟩🟩');
  assert.ok(!/[a-z]{3,}/.test(rows.join('')));
  assert.match(W.shareText('2026-11-02', ['slate', 'plate', 'crate', 'trace', 'brace', 'grace'], 'crane', false), /X\/6/);
  assert.match(W.shareText('2026-11-02', ['crane'], 'crane', true), /practice 1\/6/);
});

test('word lists: five lowercase letters, no duplicates, answers are valid guesses', () => {
  for (const [name, list] of [['answers', answers], ['valid', valid]]) {
    assert.equal(new Set(list).size, list.length, `${name} has duplicates`);
    for (const w of list) assert.match(w, /^[a-z]{5}$/, `${name}: ${w}`);
  }
  const v = new Set(valid);
  for (const w of answers) assert.ok(v.has(w), `answer ${w} is not a valid guess`);
  assert.ok(answers.length >= 800 && answers.length <= 1100, `answers: ${answers.length}`);
  assert.ok(valid.length >= 3000, `valid: ${valid.length}`);
  assert.deepEqual([...answers], [...answers].sort()); assert.deepEqual([...valid], [...valid].sort());
});
