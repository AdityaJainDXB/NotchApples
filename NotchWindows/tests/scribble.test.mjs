// Scribble rules and computer players (no screen). Run: node --test NotchWindows/tests/scribble.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const S = createRequire(import.meta.url)('../src/js/games/scribble-logic.js');

/// A small seeded random generator, so the games in these tests are the same every time.
const seeded = (seed) => () => { seed = (seed * 1664525 + 1013904223) % 4294967296; return seed / 4294967296; };
const make = (names, opts = {}) => { const g = S.newGame({ rng: seeded(opts.seed || 7), ...opts }); names.forEach((n, i) => S.addPlayer(g, { id: n.toLowerCase(), name: n, bot: (opts.bots || []).includes(n), skill: 0.8 })); return g; };
const tick = (g, secs, dt = 0.25) => { for (let i = 0; i < secs / dt; i++) S.step(g, dt); };
const toDrawing = (g) => { assert.ok(S.startGame(g)); S.chooseWord(g, g.drawer, g.choices[0]); assert.equal(g.phase, 'drawing'); };

test('the word list is clean and every picture the computer can draw is a word, inside the canvas', () => {
  assert.equal(new Set(S.WORDS).size, S.WORDS.length, 'no repeats');
  assert.ok(S.WORDS.length >= 120);
  for (const w of S.WORDS) assert.match(w, /^[a-z]+( [a-z]+)?$/, w);
  for (const w of S.BOT_WORDS) {
    assert.ok(S.WORDS.includes(w), `${w} is a word`);
    const strokes = S.templateStrokes(w);
    assert.ok(strokes.length >= 1);
    for (const s of strokes) { assert.ok(s.length >= 2); for (const [x, y] of s) assert.ok(x >= 0 && x <= S.W && y >= 0 && y <= S.H && Number.isInteger(x) && Number.isInteger(y), `${w} stays in the canvas`); }
  }
  assert.deepEqual(S.templateStrokes('elephant'), [], 'no picture, no strokes');
});

test('guesses: plurals count, other spellings do not, and "so close" is one letter away', () => {
  assert.ok(S.matches('  CATS! ', 'cat') && S.matches('Cat', 'cat') && S.matches('ice  cream', 'ice cream'));
  assert.ok(!S.matches('dog', 'cat') && !S.matches('', 'cat'));
  assert.ok(S.closeTo('housse', 'house') && S.closeTo('mous', 'mouse'));
  assert.ok(!S.closeTo('cat', 'bat'), 'short words are never "close"');
  assert.ok(!S.closeTo('house', 'house') && !S.closeTo('horse', 'mouse'));
});

test('a game needs two players, picks a drawer who chooses from three words, and shows only underscores at first', () => {
  const g = make(['Ann']);
  assert.equal(S.startGame(g), false);
  S.addPlayer(g, { id: 'bob', name: 'Bob' });
  assert.equal(S.addPlayer(g, { id: 'bob', name: 'Again' }), null, 'no duplicate players');
  assert.ok(S.startGame(g));
  assert.equal(g.phase, 'choosing'); assert.equal(g.choices.length, 3);
  const other = g.drawer === 'ann' ? 'bob' : 'ann';
  assert.equal(S.chooseWord(g, other, g.choices[0]), false, 'only the drawer chooses');
  assert.equal(S.chooseWord(g, g.drawer, 'zebra'), false, 'only one of the three');
  const word = g.choices[1];
  assert.ok(S.chooseWord(g, g.drawer, word));
  assert.equal(g.phase, 'drawing');
  assert.match(S.hintText(g), /^[_ ]+$/);
  assert.equal(S.hintText(g).replace(/ /g, '').length, word.replace(/ /g, '').length);
  assert.equal(S.publicState(g).word, null, 'the word is not in the public state while drawing');
});

test('nobody chooses in time: a word is picked for the drawer', () => {
  const g = make(['Ann', 'Bob']); S.startGame(g);
  tick(g, S.CHOOSE_TIME + 1);
  assert.equal(g.phase, 'drawing'); assert.ok(g.word);
});

test('guessing: faster scores more, the first gets a bonus, the drawer scores too, repeats and the drawer are ignored', () => {
  const g = make(['Ann', 'Bob', 'Cy']); toDrawing(g);
  const [x, y] = Object.keys(g.players).filter((id) => id !== g.drawer);
  assert.deepEqual(S.guess(g, g.drawer, g.word), { result: 'ignored', points: 0 }, 'the drawer cannot guess');
  const wrong = S.guess(g, x, 'qqqq'); assert.equal(wrong.result, 'wrong');
  const early = S.guess(g, x, g.word); assert.equal(early.result, 'correct');
  assert.ok(early.points >= 500, `an instant guess scores a lot (${early.points})`);
  assert.equal(S.guess(g, x, g.word).result, 'ignored', 'once only');
  tick(g, 40);
  const late = S.guess(g, y, g.word); assert.equal(late.result, 'correct');
  assert.ok(late.points < early.points - 150, `later is worth less (${early.points} then ${late.points})`);
  assert.equal(g.players[g.drawer].score, Math.round(early.points * 0.4) + Math.round(late.points * 0.4));
  assert.ok(g.players[x].score === early.points && g.players[y].score === late.points);
});

test('a near miss is told apart from a wrong guess and shown to the room as chat', () => {
  const g = make(['Ann', 'Bob']); toDrawing(g);
  const guesser = g.drawer === 'ann' ? 'bob' : 'ann';
  g.word = 'house'; g.mask = [false, false, false, false, false];
  const r = S.guess(g, guesser, 'housse');
  assert.equal(r.result, 'close');
  assert.ok(g.events.some((e) => e.e === 'chat' && e.close && e.text === 'housse'));
});

test('hints appear as time runs out, and never reveal the whole word', () => {
  const g = make(['Ann', 'Bob']); toDrawing(g);
  g.word = 'elephant'; g.mask = [...g.word].map(() => false); g.hintAt = [g.drawTime * 0.45, g.drawTime * 0.75];
  tick(g, g.drawTime * 0.5);
  assert.equal(S.hintText(g).split(' ').filter((c) => c !== '_').length, 1, 'one letter shown by now');
  tick(g, g.drawTime * 0.3);
  const shown = S.hintText(g).split(' ').filter((c) => c !== '_' && c !== '').length;
  assert.equal(shown, 2);
  assert.ok(S.hintText(g).includes('_'));
});

test('the turn ends early when everybody has guessed, then the word is shown and the next player draws', () => {
  const g = make(['Ann', 'Bob', 'Cy']); toDrawing(g);
  const first = g.drawer, word = g.word;
  for (const id of Object.keys(g.players).filter((p) => p !== first)) S.guess(g, id, word);
  S.step(g, 0.25);
  assert.equal(g.phase, 'reveal');
  assert.equal(S.publicState(g).word, word);
  assert.ok(g.events.some((e) => e.e === 'sys' && /Everybody guessed/.test(e.text)));
  tick(g, S.REVEAL_TIME + 0.5);
  assert.equal(g.phase, 'choosing'); assert.notEqual(g.drawer, first);
});

test('a whole game: every player draws once a round, then the highest score wins', () => {
  const g = make(['Ann', 'Bob'], { rounds: 2 });
  S.startGame(g);
  const drew = []; let last = '';
  for (let i = 0; i < 20000 && g.phase !== 'over'; i++) {
    const key = `${g.round}.${g.turn}`;
    if (g.phase === 'choosing' && key !== last) { last = key; drew.push(g.drawer); S.chooseWord(g, g.drawer, g.choices[0]); }
    if (g.phase === 'drawing' && g.drawer === 'ann' && !g.players.bob.got) S.guess(g, 'bob', g.word);   // Bob guesses whenever Ann draws; Ann never guesses
    S.step(g, 0.25); g.events.length = 0;
  }
  assert.equal(g.phase, 'over');
  assert.equal(drew.length, 4, 'two players, two rounds: four turns');
  assert.deepEqual(drew.filter((d) => d === 'ann').length, 2);
  assert.deepEqual(drew.filter((d) => d === 'bob').length, 2);
  assert.equal(g.winner, 'bob', 'Bob guessed every time Ann drew');
  assert.ok(g.players.bob.score > g.players.ann.score);
});

test('a drawer who leaves skips the turn, and the game ends when fewer than two remain', () => {
  const g = make(['Ann', 'Bob', 'Cy']); toDrawing(g);
  const gone = g.drawer;
  S.removePlayer(g, gone);
  assert.equal(g.phase, 'reveal');
  tick(g, S.REVEAL_TIME + 0.5);
  assert.ok(g.phase === 'choosing'); assert.notEqual(g.drawer, gone);
  S.removePlayer(g, g.drawer);
  const rest = Object.keys(g.players);
  assert.equal(rest.length, 1);
  assert.equal(g.phase, 'over');
});

test('a computer player draws its whole picture, and the picture is of the word', () => {
  let g;
  for (let seed = 1; seed < 60; seed++) { g = make(['Ann', 'Rex'], { bots: ['Rex'], seed }); S.startGame(g); if (g.drawer === 'rex') break; }
  assert.equal(g.drawer, 'rex', 'a computer player is drawing');
  assert.ok(g.choices.every((w) => S.BOT_WORDS.includes(w)), 'it only offers itself words it can draw');
  tick(g, 2);
  assert.equal(g.phase, 'drawing');
  const word = g.word, pic = S.templateStrokes(word);
  const ink = [];
  for (let i = 0; i < (g.drawTime * 0.8) / 0.25 && g.phase === 'drawing'; i++) { S.step(g, 0.25); for (const e of g.events) if (e.e === 'ink') ink.push(e); g.events.length = 0; }
  assert.ok(ink.length > 5, 'it draws in many small pieces over time');
  assert.equal(new Set(ink.map((e) => e.sid)).size, pic.length, 'every stroke of the picture is drawn');
  const points = ink.reduce((n, e) => n + e.pts.length - (e.cont ? 1 : 0), 0);
  assert.ok(points >= pic.reduce((n, s2) => n + s2.length, 0) - pic.length, 'and all of its points');
});

test('a computer guesser works only from the clue: the right length, the letters shown, never a word that cannot fit', () => {
  const g = make(['Ann', 'Rex'], { bots: ['Rex'] }); toDrawing(g);
  g.word = 'rocket'; g.mask = [true, false, false, false, false, true];
  const bot = g.players.rex;
  for (let i = 0; i < 30; i++) {
    const w = S.botGuess(g, bot);
    if (!w) break;
    assert.equal(w.length, 6); assert.ok(w[0] === 'r' && w[5] === 't', `${w} fits r????t`);
  }
  g.word = 'ice cream'; g.mask = [...g.word].map((c) => c === ' ');
  const w = S.botGuess(g, { tried: [], skill: 1 });
  assert.equal(w.length, 9); assert.equal(w[3], ' ', 'a two-word clue gets a two-word guess');
});

test('computer players solve a good share of drawings, but not all of them', () => {
  let solved = 0, games = 0;
  for (let seed = 1; seed <= 80; seed++) {
    const g = make(['Ann', 'Rex', 'Mia', 'Kai'], { bots: ['Rex', 'Mia', 'Kai'], seed }); toDrawing(g);
    if (g.players[g.drawer].bot) continue;
    games++;
    for (let i = 0; i < 2000 && g.phase === 'drawing'; i++) S.step(g, 0.25);
    solved += Object.values(g.players).filter((p) => p.bot && p.got).length;
  }
  assert.ok(games > 10);
  const rate = solved / (games * 3);
  assert.ok(rate > 0.4, `the computer guessed in ${Math.round(rate * 100)}% of turns`);
  assert.ok(rate < 0.98, 'but not every time');
});

test('a game of only computer players and one quiet person runs from start to finish', () => {
  const g = make(['Ann', 'Rex', 'Mia'], { bots: ['Rex', 'Mia'], rounds: 3 }); S.startGame(g);
  for (let i = 0; i < (60 * 60) / 0.25 && g.phase !== 'over'; i++) {
    if (g.phase === 'choosing' && g.drawer === 'ann') S.chooseWord(g, 'ann', g.choices[0]);
    S.step(g, 0.25); g.events.length = 0;
  }
  assert.equal(g.phase, 'over');
  assert.ok(Object.values(g.players).every((p) => Number.isFinite(p.score)));
  assert.ok(g.winner && g.players[g.winner]);
});

test('the public state never carries the word while a turn is being drawn', () => {
  const g = make(['Ann', 'Bob']); toDrawing(g);
  const wire = JSON.stringify(S.publicState(g));
  assert.ok(!wire.includes(`"${g.word}"`));
  assert.ok(wire.length < 600, 'small enough to send often');
});
