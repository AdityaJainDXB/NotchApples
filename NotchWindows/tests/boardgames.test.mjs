// Chess and Checkers between two people: the rules (games/twoplayer-logic.js) through the real session, the wire format and the
// controller. The cases are the Mac's, from NotchAppleTests/BoardGamesTests.swift.
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadModule } from './load.mjs';

const P = await loadModule('games/twoplayer-logic.js');
const a = 'alice', b = 'bob';

function started(kind) {
  let s = P.reduce(null, P.inviteMsg(kind, 'g1'), a);
  s = P.reduce(s, P.acceptMsg(s), b);
  s = P.reduce(s, P.startMsg(s, b, true), a);
  assert.equal(s.status, 'playing');
  return s;
}
/** Plays a move as `who` through the real session rules. */
const go = (s, from, to, who, promotion) => P.reduce(s, P.boardMoveMsg(s, from, to, promotion), who);
const seq = (s, ...moves) => moves.reduce((acc, [f, t, who, p]) => go(acc, f, t, who, p), s);
const put = (pieces) => { const board = Array(64).fill('.'); for (const [sq, ch] of Object.entries(pieces)) board[Number(sq)] = ch; return board; };
const NO_CASTLE = [false, false, false, false];
/** The game without its stash of early messages: an out-of-turn message is kept for later (like the Mac), but must change nothing else. */
const core = (s) => JSON.stringify({ ...s, stash: [] });

// ---- the wire ----

test('Chess and Checkers messages have exactly the Mac field names', () => {
  const s = started('ch');
  assert.deepEqual(P.boardMoveMsg(s, 52, 36), { g: 'ch', op: 'move', gid: 'g1', r: 0, n: 0, a: 52, b: 36 });
  assert.deepEqual(P.boardMoveMsg(s, 8, 0, 'n'), { g: 'ch', op: 'move', gid: 'g1', r: 0, n: 0, a: 8, b: 0, s: 'n' });
  assert.deepEqual(P.boardMoveMsg(started('ck'), 40, 33), { g: 'ck', op: 'move', gid: 'g1', r: 0, n: 0, a: 40, b: 33 });
  assert.deepEqual(P.inviteMsg('ch', 'x'), { g: 'ch', op: 'invite', gid: 'x' });
  assert.deepEqual(P.KINDS.slice(3, 5), ['ch', 'ck']);
  assert.equal(P.TITLES.ch, 'Chess');
  assert.equal(P.TITLES.ck, 'Checkers');
  const wire = JSON.parse('{"g":"ch","op":"move","gid":"abc","r":1,"n":3,"a":52,"b":36}');   // as Swift's JSONEncoder writes it (no nil fields)
  assert.deepEqual(P.parse(wire), wire);
});

test('parse checks the squares, the move number and the promotion piece', () => {
  const base = { g: 'ch', op: 'move', gid: 'g1', r: 0, n: 1 };
  assert.equal(P.parse({ ...base, a: 64, b: 3 }), null, 'squares are 0...63');
  assert.equal(P.parse({ ...base, a: 3, b: -1 }), null);
  assert.equal(P.parse({ ...base, a: 3 }), null, 'a move needs both squares');
  assert.equal(P.parse({ ...base, a: 8, b: 0, s: 'k' }), null, 'a pawn can\'t become a king');
  assert.equal(P.parse({ ...base, a: 8, b: 0, s: 'Q' }), null);
  for (const p of ['q', 'r', 'b', 'n']) assert.ok(P.parse({ ...base, a: 8, b: 0, s: p }), p);
  assert.ok(P.parse({ ...base, a: 8, b: 0, s: null }), 'null is the same as missing');
  assert.ok(P.parse({ ...base, n: 800, a: 8, b: 0 }));
  assert.equal(P.parse({ ...base, n: 801, a: 8, b: 0 }), null, 'n goes to 800');
  assert.equal(P.parse({ ...base, g: 'ck', a: 64, b: 0 }), null, 'Checkers has the same ranges');
  assert.equal(P.parse({ ...base, r: 1001, a: 1, b: 2 }), null);
  assert.equal(P.parse({ ...base, a: '8', b: 0 }), null, 'a string where a number belongs');
  assert.equal(P.parse({ g: 'c4', op: 'move', gid: 'g1', r: 0, n: 0, a: 7 }), null, 'Connect Four is still columns 0...6');
});

// ---- Chess ----

test("fool's mate ends the game with the right winner, and nothing moves afterwards", () => {
  let s = started('ch');
  s = seq(s, [53, 45, a], [12, 28, b], [54, 38, a], [3, 39, b]);
  assert.equal(s.status, 'finished');
  assert.equal(s.chess.outcome, 'checkmate');
  assert.equal(s.winner, b);
  assert.equal(s.chess.check, true);
  assert.equal(go(s, 52, 36, a), s, 'no moves after checkmate');
});

test('turns and illegal moves are refused', () => {
  let s = started('ch');
  const moves = () => s.chess.moves;
  s = go(s, 12, 28, b); assert.equal(moves(), 0, "black can't go first");
  s = go(s, 52, 28, a); assert.equal(moves(), 0, "a pawn can't jump three squares");
  s = go(s, 60, 52, a); assert.equal(moves(), 0, "a king can't take its own pawn");
  s = go(s, 57, 40, a); assert.equal(moves(), 1, 'the knight b1-a3 is fine');
  s = go(s, 40, 25, a); assert.equal(moves(), 1, "alice can't move twice in a row");
  s = go(s, 40, 25, b); assert.equal(moves(), 1, 'bob can\'t move alice\'s knight');
  assert.equal(s.chess.turn, 1);
});

test('a pinned piece cannot move and a king cannot walk into check', () => {
  const c = P.newChess();
  c.board = put({ 60: 'K', 52: 'N', 4: 'r', 0: 'k' });
  c.castle = [...NO_CASTLE];
  assert.deepEqual(P.chessLegalTargets(c, 52), [], 'the knight is pinned to its king by the rook');
  c.board = put({ 60: 'K', 3: 'r', 0: 'k' });
  assert.ok(!P.chessLegalTargets(c, 60).includes(59), 'd1 is covered by the rook on d8');
  assert.ok(P.chessLegalTargets(c, 60).includes(61));
});

test('castling, en passant and promotion', () => {
  // Kingside castling: e4 e5 Nf3 Nc6 Bc4 Nf6, then O-O.
  let s = started('ch');
  s = seq(s, [52, 36, a], [12, 28, b], [62, 45, a], [1, 18, b], [61, 34, a], [6, 21, b], [60, 62, a]);
  assert.equal(s.chess.board[62], 'K');
  assert.equal(s.chess.board[61], 'R');
  assert.equal(s.chess.board[63], '.');
  assert.ok(!s.chess.castle[0] && !s.chess.castle[1]);
  // Queenside for black.
  let q = started('ch');
  q.chess.board = put({ 60: 'K', 4: 'k', 0: 'r', 7: 'r', 52: 'P' });
  q = go(q, 52, 44, a); q = go(q, 4, 2, b);
  assert.equal(q.chess.board[2], 'k');
  assert.equal(q.chess.board[3], 'r');
  assert.equal(q.chess.board[0], '.');
  // En passant: e4 a6 e5 d5, exd6.
  let t = started('ch');
  t = seq(t, [52, 36, a], [8, 16, b], [36, 28, a], [11, 27, b]);
  assert.equal(t.chess.enPassant, 19);
  t = go(t, 28, 19, a);
  assert.equal(t.chess.board[19], 'P');
  assert.equal(t.chess.board[27], '.', 'the passed pawn is taken');
  // The chance is gone a move later.
  let u = started('ch');
  u = seq(u, [52, 36, a], [8, 16, b], [36, 28, a], [11, 27, b], [48, 40, a], [16, 24, b]);
  assert.equal(u.chess.enPassant, null);
  assert.equal(core(go(u, 28, 19, a)), core(u), 'en passant only on the very next move');
  assert.equal(u.chess.board[19], '.');
  // Promotion: a knight when asked, a queen when not, and nothing else.
  const p = started('ch');
  p.chess.board = put({ 8: 'P', 60: 'K', 7: 'k' }); p.chess.castle = [...NO_CASTLE];
  assert.equal(go(p, 8, 0, a, 'n').chess.board[0], 'N');
  assert.equal(go(p, 8, 0, a).chess.board[0], 'Q');
  assert.equal(go(p, 8, 0, a, 'r').chess.board[0], 'R');
  assert.ok(P.chessIsPromotion(p.chess, 8, 0));
  assert.ok(!P.chessIsPromotion(p.chess, 60, 52));
  assert.equal(P.chessPlay(structuredClone(p.chess), 8, 0, 'k'), false, 'the rules refuse a king as well');
  const black = P.newChess();
  black.board = put({ 52: 'p', 60: 'K', 4: 'k' }); black.turn = 1; black.castle = [...NO_CASTLE];
  assert.deepEqual(P.chessLegalTargets(black, 52), [], 'a pawn cannot capture straight ahead');
});

test('cannot castle out of check or through an attacked square', () => {
  const c = P.newChess();
  c.board = put({ 60: 'K', 63: 'R', 4: 'r', 7: 'k' });
  c.castle = [true, false, false, false];
  c.check = P.chessAttacked(c, 60, 1);
  assert.equal(c.check, true);
  assert.ok(!P.chessLegalTargets(c, 60).includes(62), 'no castling out of check');
  c.board = put({ 60: 'K', 63: 'R', 5: 'r', 7: 'k' });
  c.check = false;
  assert.ok(!P.chessLegalTargets(c, 60).includes(62), 'no castling through an attacked square (f1)');
  c.board = put({ 60: 'K', 63: 'R', 0: 'k' });
  assert.ok(P.chessLegalTargets(c, 60).includes(62), 'castling is there when nothing is in the way');
  c.castle = [...NO_CASTLE];
  assert.ok(!P.chessLegalTargets(c, 60).includes(62), 'and gone once the right is lost');
});

test('moving a rook or a king loses the castling right; taking a rook does too', () => {
  const s = started('ch');
  s.chess.board = put({ 60: 'K', 63: 'R', 56: 'R', 4: 'k', 7: 'r' });
  const n = go(s, 63, 62, a);
  assert.deepEqual(n.chess.castle, [false, true, true, true]);
  const k = go(s, 60, 59, a);
  assert.deepEqual(k.chess.castle, [false, false, true, true]);
  const taken = go(go(s, 56, 48, a), 7, 63, b);   // black's rook takes white's rook on h1
  assert.equal(taken.chess.castle[0], false);
  assert.equal(taken.chess.castle[2], false, 'and black moved that rook');
});

test('stalemate and insufficient material are draws', () => {
  const s = started('ch');
  s.chess.board = put({ 18: 'Q', 63: 'K', 0: 'k' }); s.chess.castle = [...NO_CASTLE];
  const done = go(s, 18, 10, a);
  assert.equal(done.status, 'finished');
  assert.equal(done.chess.outcome, 'stalemate');
  assert.equal(done.winner, null, 'a stalemate is a draw');
  const m = started('ch');
  m.chess.board = put({ 60: 'K', 4: 'k', 36: 'N', 19: 'r' }); m.chess.castle = [...NO_CASTLE];
  const d = go(m, 36, 19, a);   // the knight takes the last rook: king and knight against a king
  assert.equal(d.chess.outcome, 'material');
  assert.equal(d.winner, null);
  assert.equal(d.status, 'finished');
  for (const rest of [{}, { 20: 'B' }, { 20: 'n' }]) assert.ok(P.chessInsufficientMaterial({ board: put({ 60: 'K', 4: 'k', ...rest }) }));
  for (const rest of [{ 20: 'R' }, { 20: 'p' }, { 20: 'N', 21: 'N' }, { 20: 'Q' }]) assert.ok(!P.chessInsufficientMaterial({ board: put({ 60: 'K', 4: 'k', ...rest }) }));
});

test('fifty moves without a capture or pawn move is a draw', () => {
  const s = started('ch');
  s.chess.board = put({ 60: 'K', 0: 'k', 57: 'R' }); s.chess.castle = [...NO_CASTLE];
  s.chess.quiet = 98;
  const one = go(s, 57, 58, a);
  assert.equal(one.chess.outcome, null);
  const two = go(one, 0, 8, b);
  assert.equal(two.chess.outcome, 'fifty');
  assert.equal(two.status, 'finished');
  assert.equal(two.winner, null);
});

test('the same position three times is a draw', () => {
  let s = started('ch');
  s.chess.board = put({ 60: 'K', 0: 'k', 57: 'R' }); s.chess.castle = [...NO_CASTLE];
  // Rook b1-c1-b1 and king a8-a7-a8: each trip round brings back the start position.
  const loop = [[57, 58, a], [0, 8, b], [58, 57, a], [8, 0, b]];
  s = seq(s, ...loop);
  s = seq(s, ...loop);
  assert.equal(s.chess.outcome, null, 'twice is fine');
  s = seq(s, ...loop);
  assert.equal(s.chess.outcome, 'repetition');
  assert.equal(s.status, 'finished');
  assert.equal(s.winner, null);
});

test('giving check sets the flag and the king must answer it', () => {
  const w = started('ch');
  w.chess.board = put({ 63: 'K', 4: 'k', 56: 'R' }); w.chess.castle = [...NO_CASTLE];
  const x = go(w, 56, 60, a);   // the rook gives check on the e-file
  assert.equal(x.chess.check, true);
  assert.equal(x.chess.turn, 1);
  assert.equal(P.chessKingSquare(x.chess, 1), 4);
  assert.deepEqual(P.chessLegalTargets(x.chess, 4).sort((p, q) => p - q), [3, 5, 11, 13], 'the king steps off the file (e7 is still on it)');
  const y = go(x, 4, 12, b);
  assert.equal(core(y), core(x), 'staying on the e-file is refused');
  const z = go(x, 4, 5, b);
  assert.equal(z.chess.check, false);
  // The rook can't take its own king, and a move that leaves check is refused.
  assert.deepEqual(P.chessLegalTargets(x.chess, 0), []);
});

test('rematch swaps colours and resets the board', () => {
  let s = started('ch');
  s = seq(s, [53, 45, a], [12, 28, b], [54, 38, a], [3, 39, b]);
  s = P.reduce(s, P.rematchMsg(s), a);
  s = P.reduce(s, P.rematchMsg(s), b);
  assert.equal(s.status, 'playing');
  assert.equal(s.p1, b);
  assert.deepEqual(s.chess, P.newChess());
  assert.deepEqual(s.checkers, P.newCheckers());
  s = go(s, 52, 36, a);
  assert.equal(s.chess.moves, 0, 'bob is white now');
  s = go(s, 52, 36, b);
  assert.equal(s.chess.moves, 1);
  assert.equal(s.round, 1);
  assert.equal(P.reduce(s, P.boardMoveMsg({ ...s, round: 0 }, 12, 28), a), s, 'a move from the old round is ignored');
});

test('a move that arrives early waits for the one before it', () => {
  let s = started('ch');
  const first = P.boardMoveMsg(s, 52, 36);
  const ahead = P.reduce(s, first, a);
  const second = P.boardMoveMsg(ahead, 12, 28);
  s = P.reduce(s, second, b);
  assert.equal(s.chess.moves, 0, "black's reply can't be played yet");
  assert.equal(s.stash.length, 1);
  s = P.reduce(s, first, a);
  assert.equal(s.chess.moves, 2, 'once white has moved, the stashed reply is played');
  assert.equal(s.stash.length, 0);
});

test('a message with the wrong move number, or a repeat, changes nothing', () => {
  const s = started('ch');
  const next = go(s, 52, 36, a);
  assert.equal(go(next, 12, 28, b).chess.moves, 2);
  assert.equal(core(P.reduce(next, P.boardMoveMsg(s, 52, 36), a)), core(next), 'a repeat of move 0');
  const stale = { ...P.boardMoveMsg(next, 12, 28, undefined), n: 7 };
  assert.equal(core(P.reduce(next, stale, b)), core(next));
});

test('the opening position and the rules from the start', () => {
  const c = P.newChess();
  assert.equal(c.board.join(''), 'rnbqkbnrpppppppp' + '.'.repeat(32) + 'PPPPPPPPRNBQKBNR');
  assert.deepEqual(P.chessLegalTargets(c, 52).sort((x, y) => x - y), [36, 44]);
  assert.deepEqual(P.chessLegalTargets(c, 57).sort((x, y) => x - y), [40, 42]);
  assert.deepEqual(P.chessLegalTargets(c, 60), []);
  assert.deepEqual(P.chessLegalTargets(c, 12), [], 'black pieces cannot move on white\'s turn');
  let total = 0;
  for (let sq = 0; sq < 64; sq++) total += P.chessLegalTargets(c, sq).length;
  assert.equal(total, 20, 'twenty legal moves at the start');
});

test('perft: the move counts from the start position match chess', () => {
  const count = (c, depth) => {
    if (depth === 0) return 1;
    let n = 0;
    for (let from = 0; from < 64; from++) {
      for (const to of P.chessLegalTargets(c, from)) {
        const promos = P.chessIsPromotion(c, from, to) ? ['q', 'r', 'b', 'n'] : [undefined];
        for (const p of promos) { const copy = structuredClone(c); assert.ok(P.chessPlay(copy, from, to, p)); n += count(copy, depth - 1); }
      }
    }
    return n;
  };
  const start = P.newChess();
  assert.equal(count(start, 1), 20);
  assert.equal(count(start, 2), 400);
  assert.equal(count(start, 3), 8902);
});

test('perft: a position full of castling, pins, en passant and promotion ("Kiwipete")', () => {
  // r3k2r/p1ppqpb1/bn2pnp1/3PN3/1p2P3/2N2Q1p/PPPBBPPP/R3K2R w KQkq -
  const fen = 'r3k2r/p1ppqpb1/bn2pnp1/3PN3/1p2P3/2N2Q1p/PPPBBPPP/R3K2R';
  const board = [];
  for (const row of fen.split('/')) for (const ch of row) { if (/\d/.test(ch)) board.push(...Array(Number(ch)).fill('.')); else board.push(ch); }
  const c = P.newChess();
  c.board = board;
  const count = (st, depth) => {
    if (depth === 0) return 1;
    let n = 0;
    for (let from = 0; from < 64; from++) {
      for (const to of P.chessLegalTargets(st, from)) {
        const promos = P.chessIsPromotion(st, from, to) ? ['q', 'r', 'b', 'n'] : [undefined];
        for (const p of promos) { const copy = structuredClone(st); P.chessPlay(copy, from, to, p); n += count(copy, depth - 1); }
      }
    }
    return n;
  };
  assert.equal(count(c, 1), 48);
  assert.equal(count(c, 2), 2039);
});

// ---- Checkers ----

test('Checkers: the opening position, moves and turns', () => {
  let s = started('ck');
  assert.equal(s.checkers.board.filter((x) => x === 'a').length, 12);
  assert.equal(s.checkers.board.filter((x) => x === 'b').length, 12);
  s = go(s, 17, 24, b); assert.equal(s.checkers.moves, 0, 'the second player can\'t go first');
  s = go(s, 40, 32, a); assert.equal(s.checkers.moves, 0, 'pieces move diagonally');
  s = go(s, 40, 33, a); assert.equal(s.checkers.moves, 1);
  assert.equal(s.checkers.turn, 1);
  s = go(s, 33, 24, a); assert.equal(s.checkers.moves, 1, 'not alice\'s turn');
  s = go(s, 17, 24, b); assert.equal(s.checkers.moves, 2, 'bob moves down the board');
  assert.deepEqual(s.checkers.last, [17, 24]);
});

test('capturing is compulsory and a jump goes on with the same piece (every hop is a move)', () => {
  let s = started('ck');
  s.checkers.board = put({ 49: 'a', 33: 'a', 42: 'b', 28: 'b', 8: 'b', 26: 'b' });
  assert.equal(P.checkersMustCapture(s.checkers, 0), true);
  s = go(s, 33, 24, a); assert.equal(s.checkers.moves, 0, 'a plain move is refused while a jump exists');
  s = go(s, 49, 35, a);               // jumps the piece on 42
  assert.equal(s.checkers.moves, 1);
  assert.equal(s.checkers.turn, 0, 'the same piece must keep jumping');
  assert.equal(s.checkers.chain, 35);
  assert.equal(s.checkers.board[42], '.');
  const stuck = go(s, 33, 24, a); assert.equal(stuck.checkers.moves, 1, 'another piece can\'t move in the middle of a jump');
  assert.equal(core(go(s, 35, 42, a)), core(s), 'and the same piece can\'t step back');
  assert.equal(P.reduce(s, P.boardMoveMsg(s, 8, 17, undefined), b).checkers.moves, 1, 'the opponent has to wait');
  s = go(s, 35, 21, a);               // jumps the piece on 28
  assert.equal(s.checkers.moves, 2, 'the move number counts every hop');
  assert.equal(s.checkers.turn, 1);
  assert.equal(s.checkers.chain, null);
  assert.equal(s.checkers.board.filter((x) => x === 'b').length, 2);
});

test('crowning ends the jump and kings move backwards', () => {
  let s = started('ck');
  s.checkers.board = put({ 17: 'a', 10: 'b', 5: 'b' });
  s = go(s, 17, 3, a);                // jumps 10 and lands on the back row: crowned, and the turn ends there
  assert.equal(s.checkers.board[3], 'A');
  assert.equal(s.checkers.turn, 1);
  s = go(s, 5, 14, b);
  assert.equal(s.checkers.turn, 0);
  assert.ok(P.checkersLegalTargets(s.checkers, 3).includes(12), 'a king may move backwards (down the board)');
  assert.ok(P.checkersLegalTargets(s.checkers, 3).includes(10));
});

test('a crowned piece cannot keep jumping even when another capture is open', () => {
  let s = started('ck');
  // alice jumps b on 10 from 17 to 3 and would then have a jump over 12 (as a king) to 21 if it could go on.
  s.checkers.board = put({ 17: 'a', 10: 'b', 12: 'b', 21: '.', 63: 'b' });
  s = go(s, 17, 3, a);
  assert.equal(s.checkers.board[3], 'A');
  assert.equal(s.checkers.chain, null);
  assert.equal(s.checkers.turn, 1);
});

test('Checkers is won when the opponent cannot move, and a blocked piece stays put', () => {
  let s = started('ck');
  s.checkers.board = put({ 33: 'a', 26: 'b' });
  s = go(s, 33, 19, a);               // hmm: 33 jumps 26 to 19
  assert.equal(s.status, 'finished');
  assert.equal(s.winner, a);
  assert.equal(s.checkers.over, true);
  assert.equal(go(s, 19, 10, a), s, 'no moves after the end');
  const t = started('ck');
  t.checkers.board = put({ 40: 'a', 33: 'b', 26: 'b', 5: 'b' });   // alice's last piece has nowhere to go
  const t2 = go(t, 40, 33, a);
  assert.equal(t2.checkers.moves, 0, '40 can only go to 33 and that is taken, with no jump either');
});

test('Checkers: a long stretch of king moves is a draw', () => {
  let s = started('ck');
  s.checkers.board = put({ 56: 'A', 7: 'B' });
  s.checkers.quiet = 78;
  s = go(s, 56, 49, a);
  assert.equal(s.checkers.over, false);
  s = go(s, 7, 14, b);
  assert.equal(s.checkers.over, true);
  assert.equal(s.checkers.winnerIndex, null);
  assert.equal(s.status, 'finished');
  assert.equal(s.winner, null);
});

test('Checkers rematch: new board, first mover swaps; the loser of the match can ask too', () => {
  let s = started('ck');
  s.checkers.board = put({ 33: 'a', 26: 'b' });
  s = go(s, 33, 19, a);
  assert.equal(s.status, 'finished');
  s = P.reduce(s, P.rematchMsg(s), b);
  s = P.reduce(s, P.rematchMsg(s), a);
  assert.equal(s.status, 'playing');
  assert.equal(s.p1, b);
  assert.deepEqual(s.checkers, P.newCheckers());
  s = go(s, 40, 33, b);
  assert.equal(s.checkers.moves, 1);
});

test('boardTargets: only the player to move gets squares, and only for their own pieces', () => {
  const s = started('ch');
  assert.deepEqual(P.boardTargets(s, a, 52).sort((x, y) => x - y), [36, 44]);
  assert.deepEqual(P.boardTargets(s, b, 12), [], 'not bob\'s turn');
  assert.deepEqual(P.boardTargets(s, a, 12), [], 'not alice\'s piece');
  assert.deepEqual(P.boardTargets(s, 'carol', 52), [], 'a watcher');
  assert.deepEqual(P.boardTargets(null, a, 52), []);
  const k = started('ck');
  assert.deepEqual(P.boardTargets(k, a, 42).sort((x, y) => x - y), [33, 35]);
  assert.deepEqual(P.boardTargets(k, a, 40), [33], 'a man on the edge has one way to go');
  assert.deepEqual(P.boardTargets(started('c4'), a, 0), []);
});

// ---- the controller ----

test('the controller plays Chess from both sides and ends with checkmate', () => {
  const wire = [];
  const mk = (id) => P.createPlayController({ myID: id, transport: (m) => wire.push([id, m]) });
  const A = mk(a), B = mk(b);
  const pump = () => { while (wire.length) { const [from, m] = wire.shift(); (from === a ? B : A).receive(m, from); } };
  A.invite('ch'); pump();
  B.accept(); pump();
  assert.equal(A.session.status, 'playing');
  assert.equal(A.session.p1, A.session.p1);
  const white = A.session.p1 === a ? A : B, black = white === A ? B : A;
  white.move(53, 45); pump(); black.move(12, 28); pump(); white.move(54, 38); pump(); black.move(3, 39); pump();
  assert.equal(A.session.status, 'finished');
  assert.equal(B.session.chess.outcome, 'checkmate');
  assert.equal(A.session.winner, black.myID);
  white.move(52, 36); pump();
  assert.equal(white.session.chess.moves, 4, 'an illegal move is not sent');
  assert.equal(wire.length, 0);
  A.rematch(); B.rematch(); pump();
  assert.equal(A.session.status, 'playing');
  assert.deepEqual(A.session.chess, P.newChess());
});

test('the controller plays Checkers and an illegal move is never sent', () => {
  const wire = [];
  const mk = (id) => P.createPlayController({ myID: id, transport: (m) => wire.push([id, m]) });
  const A = mk(a), B = mk(b);
  const pump = () => { while (wire.length) { const [from, m] = wire.shift(); (from === a ? B : A).receive(m, from); } };
  A.invite('ck'); pump(); B.accept(); pump();
  const first = A.session.p1 === a ? A : B, second = first === A ? B : A;
  second.move(17, 24); assert.equal(wire.length, 0, 'not their turn');
  first.move(40, 32); assert.equal(wire.length, 0, 'not diagonal');
  first.move(40, 33); pump();
  assert.equal(A.session.checkers.moves, 1);
  assert.deepEqual(B.session.checkers.board, A.session.checkers.board);
  assert.equal(B.session.checkers.turn, 1);
});
