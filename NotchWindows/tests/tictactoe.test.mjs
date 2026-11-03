// Tic-tac-toe in a Messenger room: win, draw, illegal moves, turn order, duplicates, out-of-order and foreign messages,
// rematch and leaving. The same cases are in NotchAppleTests/TicTacToeTests.swift.
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadModule } from './load.mjs';

const G = await loadModule('games/tictactoe-logic.js');
const A = 'ALICE', B = 'BOB', C = 'CAROL';

// Alice invites as X, Bob accepts, Alice starts the game. Everyone runs the same reduce, as in the app.
function started(mark = 'X') {
  let s = G.reduce(null, G.inviteMsg('g1', mark), A);
  s = G.reduce(s, G.acceptMsg('g1'), B);
  s = G.reduce(s, G.startMsg(s, B), A);
  return s;
}
// Plays cells in turn from the right player and returns the final state (every move must be accepted).
function play(s, cells) {
  for (const cell of cells) {
    const who = G.turnPlayer(s);
    const next = G.reduce(s, G.moveMsg(s, cell), who);
    assert.notEqual(next, s, `move ${cell} by ${who} should be legal`);
    s = next;
  }
  return s;
}

test('the inviter decides who is X and who is O', () => {
  const x = started('X');
  assert.deepEqual([x.status, x.x, x.o], ['playing', A, B]);
  const o = started('O');
  assert.deepEqual([o.status, o.x, o.o], ['playing', B, A]);
  assert.equal(G.turnPlayer(o), B);   // X always starts
});

test('the first player to accept is the one who plays', () => {
  let s = G.reduce(null, G.inviteMsg('g1', 'X'), A);
  s = G.reduce(s, G.acceptMsg('g1'), B);
  const again = G.reduce(s, G.acceptMsg('g1'), C);
  assert.equal(again, s);                                         // a second accept is ignored
  assert.equal(G.reduce(s, G.acceptMsg('g1'), A), s);             // the inviter can't accept their own invite
});

test('start only counts from the inviter and must include them with the mark they chose', () => {
  let s = G.reduce(null, G.inviteMsg('g1', 'X'), A);
  assert.equal(G.reduce(s, { g: 'ttt', op: 'start', gid: 'g1', x: B, o: C }, B), s);   // sent by someone else
  assert.equal(G.reduce(s, { g: 'ttt', op: 'start', gid: 'g1', x: B, o: C }, A), s);   // the inviter isn't playing
  assert.equal(G.reduce(s, { g: 'ttt', op: 'start', gid: 'g1', x: B, o: A }, A), s);   // wrong mark for the inviter
});

test('X wins on a row, a column and a diagonal', () => {
  let s = play(started(), [0, 3, 1, 4, 2]);                 // X: 0 1 2
  assert.deepEqual([s.status, s.winner, s.line], ['won', 'X', [0, 1, 2]]);
  s = play(started(), [0, 1, 3, 2, 6]);                     // X: 0 3 6
  assert.deepEqual([s.status, s.winner, s.line], ['won', 'X', [0, 3, 6]]);
  s = play(started(), [0, 1, 4, 2, 8]);                     // X: 0 4 8
  assert.deepEqual([s.status, s.winner, s.line], ['won', 'X', [0, 4, 8]]);
});

test('O can win too', () => {
  const s = play(started(), [0, 3, 1, 4, 8, 5]);           // O: 3 4 5
  assert.deepEqual([s.status, s.winner], ['won', 'O']);
});

test('a full board with no line is a draw', () => {
  const s = play(started(), [0, 1, 2, 4, 3, 5, 7, 6, 8]);
  assert.deepEqual([s.status, s.winner, s.line], ['draw', 'draw', null]);
  assert.equal(s.moves, 9);
});

test('a win on the last move is a win, not a draw', () => {
  const s = play(started(), [0, 2, 1, 3, 5, 6, 4, 7, 8]);        // X completes 0-4-8 on the ninth move
  assert.equal(s.moves, 9);
  assert.equal(s.status, 'won');
  assert.equal(s.winner, 'X');
});

test('illegal moves are ignored: occupied cell, out of range, wrong turn, not a player, after the end', () => {
  let s = play(started(), [4]);
  assert.equal(G.reduce(s, G.moveMsg(s, 4), B), s);                       // occupied
  assert.equal(G.reduce(s, { ...G.moveMsg(s, 9) }, B), s);                // off the board
  assert.equal(G.reduce(s, { ...G.moveMsg(s, -1) }, B), s);
  assert.equal(G.reduce(s, { ...G.moveMsg(s, 1.5) }, B), s);
  assert.equal(G.reduce(s, { ...G.moveMsg(s, '1') }, B), s);
  assert.equal(G.reduce(s, G.moveMsg(s, 0), A), s);                       // Alice (X) moving again on O's turn
  assert.equal(G.reduce(s, G.moveMsg(s, 0), C), s);                       // Carol isn't in the game
  const over = play(started(), [0, 3, 1, 4, 2]);
  assert.equal(G.reduce(over, { g: 'ttt', op: 'move', gid: 'g1', r: 0, n: 5, cell: 8 }, B), over);
});

test('turn order: the same player can not move twice, even with the right move number', () => {
  let s = play(started(), [0]);
  const sneaky = { g: 'ttt', op: 'move', gid: 'g1', r: 0, n: 1, cell: 1 };
  assert.equal(G.reduce(s, sneaky, A).board[1], null);
  assert.equal(G.reduce(s, sneaky, B).board[1], 'O');
});

test('a message that arrives twice changes nothing the second time', () => {
  let s = started();
  const m = G.moveMsg(s, 4);
  const once = G.reduce(s, m, A);
  const twice = G.reduce(once, m, A);
  assert.equal(twice, once);
  assert.equal(once.moves, 1);
  assert.equal(G.reduce(once, G.inviteMsg('g1', 'X'), A), once);            // a repeated invite while playing
  assert.equal(G.reduce(once, G.inviteMsg('g2', 'O'), C), once);            // but an invite never replaces a running game
  assert.equal(G.reduce(once, G.startMsg(once, B), A), once);               // nor a repeated start
});

test('moves that arrive out of order are held and applied in order', () => {
  const s0 = started();
  const m0 = G.moveMsg(s0, 4);                                  // X plays the middle
  const m1 = { g: 'ttt', op: 'move', gid: 'g1', r: 0, n: 1, cell: 0 };   // O replies
  const m2 = { g: 'ttt', op: 'move', gid: 'g1', r: 0, n: 2, cell: 8 };   // X again
  let s = G.reduce(s0, m2, A);                                  // the third move shows up first
  assert.equal(s.moves, 0);
  s = G.reduce(s, m1, B);
  assert.equal(s.moves, 0);
  s = G.reduce(s, m0, A);                                       // now all three apply
  assert.equal(s.moves, 3);
  assert.deepEqual(s.board.filter(Boolean).length, 3);
  assert.deepEqual([s.board[4], s.board[0], s.board[8]], ['X', 'O', 'X']);
});

test('a bogus early move from a stranger does not block the real one', () => {
  const s0 = started();
  let s = G.reduce(s0, { g: 'ttt', op: 'move', gid: 'g1', r: 0, n: 0, cell: 4 }, C);   // Carol isn't playing
  assert.equal(s, s0);
  s = G.reduce(s0, { g: 'ttt', op: 'move', gid: 'g1', r: 0, n: 1, cell: 4 }, A);       // Alice sends O's move number: held, never legal
  s = G.reduce(s, G.moveMsg(s0, 0), A);
  assert.equal(s.moves, 1);
  assert.equal(s.board[0], 'X');
});

test('a move that beats the start message is applied when the start arrives', () => {
  let s = G.reduce(null, G.inviteMsg('g1', 'X'), A);
  s = G.reduce(s, G.acceptMsg('g1'), B);
  const start = G.startMsg(s, B);
  s = G.reduce(s, { g: 'ttt', op: 'move', gid: 'g1', r: 0, n: 0, cell: 4 }, A);       // too early
  assert.equal(s.moves, 0);
  s = G.reduce(s, start, A);
  assert.equal(s.moves, 1);
  assert.equal(s.board[4], 'X');
});

test('messages for another game, or with a nonsense shape, are ignored', () => {
  const s = started();
  assert.equal(G.reduce(s, { g: 'ttt', op: 'move', gid: 'other', r: 0, n: 0, cell: 0 }, A), s);
  assert.equal(G.reduce(s, { g: 'chess', op: 'move', gid: 'g1', r: 0, n: 0, cell: 0 }, A), s);
  assert.equal(G.reduce(s, { g: 'ttt', op: 'explode', gid: 'g1' }, A), s);
  assert.equal(G.reduce(s, null, A), s);
  assert.equal(G.reduce(s, 'move', A), s);
  assert.equal(G.reduce(s, G.moveMsg(s, 0), ''), s);
  assert.equal(G.reduce(null, G.moveMsg(s, 0), A), null);
  assert.equal(G.reduce(s, { g: 'ttt', op: 'move', gid: 'g1', r: 0, n: 99, cell: 0 }, A), s);
});

test('rematch needs both players, swaps X and O, and ignores repeats and strangers', () => {
  let s = play(started(), [0, 3, 1, 4, 2]);                      // Alice (X) won
  assert.equal(G.reduce(s, G.rematchMsg(s), C), s);              // a stranger
  s = G.reduce(s, G.rematchMsg(s), A);
  assert.equal(s.status, 'won');                                 // waiting for Bob
  assert.equal(G.reduce(s, G.rematchMsg(s), A), s);              // asked twice
  s = G.reduce(s, G.rematchMsg(s), B);
  assert.deepEqual([s.status, s.round, s.moves, s.x, s.o], ['playing', 1, 0, B, A]);
  assert.ok(s.board.every((c) => c === null));
  assert.equal(G.turnPlayer(s), B);                              // Bob is X now and starts
  s = play(s, [4, 0]);
  assert.deepEqual([s.board[4], s.board[0]], ['X', 'O']);
});

test('rematch messages from an old round are ignored and early round-1 moves are kept', () => {
  let s = play(started(), [0, 3, 1, 4, 2]);
  const stale = { g: 'ttt', op: 'rematch', gid: 'g1', r: 5 };
  assert.equal(G.reduce(s, stale, A), s);
  const early = { g: 'ttt', op: 'move', gid: 'g1', r: 1, n: 0, cell: 4 };   // Bob (the new X) moves before Alice sees his rematch
  s = G.reduce(s, G.rematchMsg(s), A);
  s = G.reduce(s, early, B);
  assert.equal(s.moves, 5);                                      // still the finished board; the move is held
  s = G.reduce(s, { g: 'ttt', op: 'rematch', gid: 'g1', r: 0 }, B);
  assert.deepEqual([s.status, s.round, s.moves, s.board[4]], ['playing', 1, 1, 'X']);
});

test('a duplicate move from the old round does not touch the new one', () => {
  let s = play(started(), [0, 3, 1, 4, 2]);
  const old = { g: 'ttt', op: 'move', gid: 'g1', r: 0, n: 0, cell: 8 };
  s = G.reduce(s, G.rematchMsg(s), A);
  s = G.reduce(s, G.rematchMsg(s), B);
  assert.equal(G.reduce(s, old, B), s);
  assert.equal(G.reduce(s, old, A), s);
});

test('a player who leaves ends the game; a stranger leaving does not', () => {
  const s = play(started(), [0, 3]);
  assert.equal(G.reduce(s, G.quitMsg('g1'), C), s);
  const ended = G.reduce(s, G.quitMsg('g1'), B);
  assert.deepEqual([ended.status, ended.leaver], ['ended', B]);
  assert.equal(G.reduce(ended, G.moveMsg(s, 8), A), ended);                  // no more moves
  assert.equal(G.reduce(ended, G.rematchMsg(ended), A), ended);              // and no rematch
  const done = play(started(), [0, 3, 1, 4, 2]);
  assert.equal(G.reduce(done, G.quitMsg('g1'), B).status, 'ended');          // leaving after the game also closes it
});

test('an invite can be cancelled by the inviter only, and a new invite can follow a finished game', () => {
  let s = G.reduce(null, G.inviteMsg('g1', 'X'), A);
  assert.equal(G.reduce(s, G.cancelMsg('g1'), B), s);
  assert.equal(G.reduce(s, G.quitMsg('g1'), B), s);
  const cancelled = G.reduce(s, G.cancelMsg('g1'), A);
  assert.equal(cancelled.status, 'cancelled');
  assert.equal(G.reduce(cancelled, G.acceptMsg('g1'), B), cancelled);
  const next = G.reduce(cancelled, G.inviteMsg('g2', 'O'), B);
  assert.deepEqual([next.gid, next.inviter, next.status], ['g2', B, 'invited']);
  const done = play(started(), [0, 3, 1, 4, 2]);
  assert.equal(G.reduce(done, G.inviteMsg('g3', 'X'), C).gid, 'g3');
});

test('the inviter leaving withdraws the invite', () => {
  const s = G.reduce(null, G.inviteMsg('g1', 'X'), A);
  assert.equal(G.reduce(s, G.quitMsg('g1'), A).status, 'cancelled');
});

test('parse drops unknown fields and rejects bad values', () => {
  assert.deepEqual(G.parse({ g: 'ttt', op: 'accept', gid: 'g1', junk: 1 }), { g: 'ttt', op: 'accept', gid: 'g1' });
  assert.equal(G.parse({ g: 'ttt', op: 'invite', gid: 'g1', mark: 'Z' }), null);
  assert.equal(G.parse({ g: 'ttt', op: 'accept', gid: 'x'.repeat(65) }), null);
  assert.equal(G.parse({ g: 'ttt', op: 'start', gid: 'g1', x: A, o: A }), null);
});

test('canMove and outcome', () => {
  const s = started();
  assert.ok(G.canMove(s, A, 0));
  assert.ok(!G.canMove(s, B, 0));
  assert.ok(!G.canMove(null, A, 0));
  assert.equal(G.outcome(Array(9).fill(null)), null);
  assert.equal(G.outcome(['X', 'X', 'X', null, null, null, null, null, null]).winner, 'X');
});
