import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const T = createRequire(import.meta.url)('../src/js/games/tetris-logic.js');

const seeded = (s) => () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
const game = (seed = 1) => T.createGame(seeded(seed));
const put = (g, t, r, x, y) => { g.piece = { t, r, x, y }; };
const fillRow = (g, y, gapX = -1) => { for (let x = 0; x < T.W; x++) g.rows[y][x] = x === gapX ? 0 : 'X'; };

test('every piece has four cells in all four rotations, and the spawn shapes are the standard ones', () => {
  for (const t of T.TYPES) for (let r = 0; r < 4; r++) {
    const c = T.SHAPES[t][r];
    assert.equal(c.length, 4, `${t}${r}`);
    assert.equal(new Set(c.map((p) => p.join())).size, 4, `${t}${r} cells distinct`);
  }
  const pic = (t) => { const rows = []; for (const [x, y] of T.SHAPES[t][0]) (rows[y] = rows[y] || new Set()).add(x); return Array.from(rows, (s) => (s ? [...s].sort().join('') : '')); };
  assert.deepEqual(pic('T'), ['1', '012']);
  assert.deepEqual(pic('L'), ['2', '012']);
  assert.deepEqual(pic('J'), ['0', '012']);
  assert.deepEqual(pic('S'), ['12', '01']);
  assert.deepEqual(pic('Z'), ['01', '12']);
  assert.deepEqual(pic('I'), ['', '0123']);
  assert.deepEqual(pic('O'), ['12', '12']);
});

test('four clockwise turns bring a piece back, and O does not change', () => {
  for (const t of T.TYPES) {
    const g = game(); g.rows = g.rows.map((r) => r.map(() => 0)); put(g, t, 0, 3, 5);
    const before = JSON.stringify(g.piece);
    for (let i = 0; i < 4; i++) assert.ok(T.rotate(g, 1));
    assert.equal(JSON.stringify(g.piece), before, t);
  }
  assert.deepEqual(T.SHAPES.O[0], T.SHAPES.O[1]);
});

test('a vertical I against the right wall turns using a wall kick; a boxed-in piece cannot turn', () => {
  const g = game(); put(g, 'I', 1, 7, 5);                // vertical I in column 9 (box x=7 + cell x 2)
  assert.deepEqual(T.cellsOf(g.piece).map((c) => c[0]), [9, 9, 9, 9]);
  assert.ok(T.rotate(g, 1));                             // lying flat needs columns 6..9: the kick shifts it left
  assert.ok(T.cellsOf(g.piece).every(([x]) => x >= 0 && x < T.W));
  const h = game(); put(h, 'T', 0, 3, 10);
  for (const [x, y] of [[3, 10], [5, 10], [3, 11], [4, 11], [5, 11], [4, 12], [3, 12], [5, 12], [2, 10], [2, 11], [6, 10], [6, 11], [4, 9], [3, 9], [5, 9], [2, 9], [6, 9], [2, 12], [6, 12], [4, 13], [3, 13], [5, 13], [2, 13], [6, 13], [4, 8], [3, 8], [5, 8]]) if (!T.cellsOf(h.piece).some(([cx, cy]) => cx === x && cy === y)) h.rows[y][x] = 'X';
  const snap = JSON.stringify(h.piece);
  assert.equal(T.rotate(h, 1), false);
  assert.equal(JSON.stringify(h.piece), snap);
});

test('a T kicks off the left wall (clockwise from state 1 would clip it)', () => {
  const g = game(); put(g, 'T', 1, -1, 5);               // vertical T hugging the left wall (cells at x 0..1)
  assert.ok(T.fits(g, g.piece));
  assert.ok(T.rotate(g, 1));
  assert.ok(T.fits(g, g.piece));
});

test('moves stop at the walls and the ghost lands where a hard drop does', () => {
  const g = game(); put(g, 'O', 0, 3, 0);
  while (T.move(g, -1));
  assert.equal(Math.min(...T.cellsOf(g.piece).map((c) => c[0])), 0);
  while (T.move(g, 1));
  assert.equal(Math.max(...T.cellsOf(g.piece).map((c) => c[0])), 9);
  const gy = T.ghostY(g);
  const t = g.piece.t; const before = g.score;
  T.hardDrop(g);
  assert.equal(g.rows[19][9], t);
  assert.equal(gy, 18);                                   // the O's cells are box rows 0..1, so its box rests at row 18
  assert.equal(g.score - before, 2 * (gy - 0));           // 2 points a row
});

test('soft drop scores one point a row and stops on the floor', () => {
  const g = game(); put(g, 'O', 0, 3, 17);
  assert.equal(T.softDrop(g), true); assert.equal(g.score, 1);
  assert.equal(T.softDrop(g), false); assert.equal(g.score, 1);
  assert.ok(T.grounded(g));
});

test('line clears: single, double, triple and tetris score 100/300/500/800 times the level', () => {
  for (const [n, pts] of [[1, 100], [2, 300], [3, 500], [4, 800]]) {
    const g = game(); g.rows = g.rows.map((r) => r.map(() => 0));
    // rows 16..19 full except column 9; a vertical I in column 9 fills the last n rows' gap
    for (let y = 20 - n; y < 20; y++) fillRow(g, y, 9);
    put(g, 'I', 1, 7, 16);
    const res = T.hardDrop(g);
    assert.equal(res.cleared, n);
    assert.equal(g.lines, n);
    assert.equal(res.points, pts, `${n} lines`);
    assert.equal(g.rows.length, 20);
  }
  const g = game(); g.level = 3; g.rows = g.rows.map((r) => r.map(() => 0)); fillRow(g, 19, 9); fillRow(g, 18, 9);
  put(g, 'I', 1, 7, 16);
  assert.equal(T.hardDrop(g).points, 900);                // double at level 3
});

test('rows above a cleared row fall down', () => {
  const g = game(); g.rows = g.rows.map((r) => r.map(() => 0));
  fillRow(g, 19, 0); g.rows[18][5] = 'S';
  put(g, 'I', 1, -2, 16);                                 // vertical I in column 0
  T.hardDrop(g);
  assert.equal(g.rows[19][5], 'S');                       // the lone block dropped into the cleared row
  assert.equal(g.rows[19][0], 'I');                       // and the rest of the I (it was 4 tall; one cell went in the cleared row)
});

test('back-to-back tetrises score 1.5 times; a smaller clear breaks the chain', () => {
  const four = (g) => { g.rows = g.rows.map((r) => r.map(() => 0)); for (let y = 16; y < 20; y++) fillRow(g, y, 9); put(g, 'I', 1, 7, 16); return T.hardDrop(g); };
  const g = game();
  assert.equal(four(g).points, 800);
  g.over = false;
  assert.equal(four(g).points, 1200);
  g.rows = g.rows.map((r) => r.map(() => 0)); fillRow(g, 19, 9); put(g, 'I', 1, 7, 16);
  assert.equal(T.hardDrop(g).points, 100 * g.level);
  assert.equal(g.b2b, false);
});

test('level rises every 10 lines and gravity gets faster', () => {
  const g = game(); g.lines = 9; g.rows = g.rows.map((r) => r.map(() => 0)); fillRow(g, 19, 9); put(g, 'I', 1, 7, 16);
  assert.equal(g.level, 1);
  T.hardDrop(g);
  assert.equal(g.lines, 10); assert.equal(g.level, 2);
  assert.equal(T.gravityMs(1), 1000);
  let prev = Infinity;
  for (let l = 1; l <= 15; l++) { const ms = T.gravityMs(l); assert.ok(ms < prev || ms === 16, `level ${l}`); prev = ms; }
  assert.ok(T.gravityMs(30) >= 16);
});

test('7-bag: every group of seven is each piece once, and no piece waits more than 12 draws', () => {
  const rng = seeded(42);
  const g = T.createGame(rng);
  const seq = [g.piece.t];
  for (let i = 1; i < 700; i++) { T.spawn(g); seq.push(g.piece.t); }
  for (let i = 0; i + 7 <= seq.length; i += 7) assert.deepEqual([...seq.slice(i, i + 7)].sort(), [...T.TYPES].sort(), `bag ${i / 7}`);
  const counts = {}; for (const t of seq) counts[t] = (counts[t] || 0) + 1;
  for (const t of T.TYPES) assert.equal(counts[t], 100);
  for (const t of T.TYPES) { let gap = 0, worst = 0; for (const s of seq) { gap = s === t ? 0 : gap + 1; worst = Math.max(worst, gap); } assert.ok(worst <= 12, `${t} gap ${worst}`); }
  assert.notDeepEqual(T.makeBag(seeded(1)), T.makeBag(seeded(2)));
});

test('the preview shows the next three pieces, which are the ones that come', () => {
  const g = game(7);
  const up = T.upcoming(g);
  assert.equal(up.length, 3);
  T.spawn(g); assert.equal(g.piece.t, up[0]);
  T.spawn(g); assert.equal(g.piece.t, up[1]);
  T.spawn(g); assert.equal(g.piece.t, up[2]);
});

test('hold swaps once per piece, and the held piece comes back', () => {
  const g = game(3);
  const first = g.piece.t, second = T.upcoming(g)[0];
  assert.ok(T.holdPiece(g));
  assert.equal(g.hold, first); assert.equal(g.piece.t, second);
  assert.equal(T.holdPiece(g), false);                    // not twice in a row
  T.hardDrop(g);                                          // locking lets you hold again
  assert.ok(g.canHold);
  const cur = g.piece.t;
  assert.ok(T.holdPiece(g));
  assert.equal(g.piece.t, first); assert.equal(g.hold, cur);
});

test('gravity moves the piece down and locks it on the floor', () => {
  const g = game(5); put(g, 'O', 0, 3, 17);
  assert.equal(T.tick(g), 'moved');
  const r = T.tick(g);
  assert.equal(r.cleared, 0);
  assert.equal(g.rows[19][4], 'O');
  assert.ok(!g.over);
});

test('topping out ends the game', () => {
  const g = game(9);
  for (let y = 0; y < 20; y++) fillRow(g, y, y % 10);     // a stack to the top, no full rows
  assert.equal(T.spawn(g), false);
  assert.equal(g.over, true);
  assert.equal(T.move(g, 1), false); assert.equal(T.hardDrop(g), null);
  const h = game(9); h.rows = h.rows.map((r) => r.map(() => 0));
  for (let y = 2; y < 20; y++) fillRow(h, y, y % 10);
  put(h, 'O', 0, 3, 0); T.hardDrop(h);                    // locks at the top without clearing; the next piece has no room
  assert.equal(h.over, true);
});
