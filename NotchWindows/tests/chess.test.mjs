import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const C = createRequire(import.meta.url)('../src/js/games/chess-logic.js');

test('perft from the start position matches the known counts', () => {
  const g = C.newGame();
  assert.equal(C.perft(g, 1), 20);
  assert.equal(C.perft(g, 2), 400);
  assert.equal(C.perft(g, 3), 8902);
});
test('perft on kiwipete (castling, en passant, pins)', () => {
  const g = C.newGame('r3k2r/p1ppqpb1/bn2pnp1/3PN3/1p2P3/2N2Q1p/PPPBBPPP/R3K2R w KQkq - 0 1');
  assert.equal(C.perft(g, 1), 48);
  assert.equal(C.perft(g, 2), 2039);
});
test('perft on an endgame with promotions and en passant', () => {
  const g = C.newGame('8/2p5/3p4/KP5r/1R3p1k/8/4P1P1/8 w - - 0 1');
  assert.equal(C.perft(g, 3), 2812);
  const h = C.newGame('r3k2r/Pppp1ppp/1b3nbN/nP6/BBP1P3/q4N2/Pp1P2PP/R2Q1RK1 w kq - 0 1');
  assert.equal(C.perft(h, 2), 264);
});
test('fool\'s mate is checkmate', () => {
  let g = C.newGame();
  for (const t of ['f2f3', 'e7e5', 'g2g4', 'd8h4']) { const m = C.findMove(g, t); assert.ok(m, t); g = C.apply(g, m); }
  const s = C.status(g);
  assert.equal(s.reason, 'checkmate'); assert.equal(s.result, 'black');
});
test('stalemate and bare kings are draws', () => {
  assert.equal(C.status(C.newGame('7k/5Q2/6K1/8/8/8/8/8 b - - 0 1')).reason, 'stalemate');
  assert.equal(C.status(C.newGame('8/8/4k3/8/8/3K4/8/8 w - - 0 1')).result, 'draw');
});
test('san names moves, disambiguates, and marks check and mate', () => {
  let g = C.newGame();
  assert.equal(C.san(g, C.findMove(g, 'g1f3')), 'Nf3');
  g = C.newGame('4k3/8/8/8/8/8/8/R3K2R w KQ - 0 1');
  assert.equal(C.san(g, C.findMove(g, 'e1g1')), 'O-O');
  assert.equal(C.san(g, C.findMove(g, 'e1c1')), 'O-O-O');
  g = C.newGame('4k3/8/8/8/8/8/8/R3R1K1 w - - 0 1');
  assert.equal(C.san(g, C.findMove(g, 'a1a8')), 'Ra8+');
});
test('en passant, promotion and castling rights', () => {
  let g = C.newGame('4k3/8/8/3pP3/8/8/8/4K3 w - d6 0 1');
  const ep = C.findMove(g, 'e5d6'); assert.ok(ep && ep.ep);
  g = C.apply(g, ep); assert.equal(g.b[C.sqFrom('d5')], '.');
  const p = C.newGame('8/P6k/8/8/8/8/8/4K3 w - - 0 1');
  assert.ok(C.findMove(p, 'a7a8q') && C.findMove(p, 'a7a8n'));
  let r = C.newGame('r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1');
  r = C.apply(r, C.findMove(r, 'e1g1')); assert.equal(r.cast, 'kq');
});
test('FEN round trip', () => {
  const f = 'r3k2r/p1ppqpb1/bn2pnp1/3PN3/1p2P3/2N2Q1p/PPPBBPPP/R3K2R w KQkq - 0 1';
  assert.equal(C.toFen(C.newGame(f)), f);
});
test('the computer finds mate in one and does not blunder its queen', () => {
  const g = C.newGame('6k1/5ppp/8/8/8/8/5PPP/R5K1 w - - 0 1');
  for (const lvl of [2, 3, 4]) assert.equal(C.moveText(C.bestMove(g, lvl)), 'a1a8', `level ${lvl}`);
  // a hanging queen: Black's queen on d4 is attacked by a pawn, so every level takes it
  const h = C.newGame('4k3/8/8/8/3q4/2P5/8/4K3 w - - 0 1');
  for (const lvl of [2, 3, 4]) assert.equal(C.moveText(C.bestMove(h, lvl)), 'c3d4', `level ${lvl}`);
});
test('level 1 always plays a legal move; a full game vs itself ends', () => {
  let g = C.newGame(), n = 0;
  while (!C.status(g).over && n < 300) { const m = C.bestMove(g, n % 2 ? 1 : 2, Math.random); assert.ok(C.findMove(g, C.moveText(m))); g = C.apply(g, m); n++; }
  assert.ok(n > 4);
});
