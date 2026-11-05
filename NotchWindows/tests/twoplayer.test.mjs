// Connect Four, Rock Paper Scissors and Battleship between two people: the rules (games/twoplayer-logic.js), the automatic side
// (the controller) and the wire format. The rule cases are the Mac's, from NotchAppleTests/PlayGamesTests.swift.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { loadModule } from './load.mjs';

const P = await loadModule('games/twoplayer-logic.js');
const a = 'alice', b = 'bob';

/** A started game between alice (first) and bob. */
function started(kind) {
  let s = P.reduce(null, P.inviteMsg(kind, 'g1'), a);
  s = P.reduce(s, P.acceptMsg(s), b);
  s = P.reduce(s, P.startMsg(s, b, true), a);
  assert.equal(s.status, 'playing');
  return s;
}
const send = (s, m, from) => P.reduce(s, m, from);
/** The game without its stash of early messages: an out-of-turn message is kept for later (like the Mac), but must change nothing else. */
const core = (s) => JSON.stringify({ ...s, stash: [] });

// ---- SHA-256 and the wire ----

test('sha256Hex matches the platform SHA-256 for short, block-sized and long text', () => {
  for (const text of ['', 'abc', '1:salt', 'x'.repeat(55), 'x'.repeat(56), 'x'.repeat(63), 'x'.repeat(64), 'x'.repeat(117), 'é✌️🚢'.repeat(40)]) {
    assert.equal(P.sha256Hex(text), createHash('sha256').update(text, 'utf8').digest('hex'), JSON.stringify(text));
  }
});

test('the commits are SHA-256 of "pick:salt" and "board:salt" (what the Mac computes)', () => {
  assert.equal(P.rpsCommit(1, 'abc'), createHash('sha256').update('1:abc').digest('hex'));
  const board = P.randomFleet();
  assert.equal(P.fleetCommit(board, 'xyz'), createHash('sha256').update(`${board}:xyz`).digest('hex'));
});

test('messages built here have exactly the Mac field names and survive JSON', () => {
  const s = started('rps');
  const m = P.commitMsg(s, 2, 'abc');
  assert.deepEqual(Object.keys(m).sort(), ['g', 'gid', 'h', 'n', 'op', 'r']);
  assert.deepEqual(JSON.parse(JSON.stringify(m)), m);
  assert.deepEqual(P.moveMsg(started('c4'), 3), { g: 'c4', op: 'move', gid: 'g1', r: 0, n: 0, a: 3 });
  assert.deepEqual(P.inviteMsg('bs', 'g9'), { g: 'bs', op: 'invite', gid: 'g9' });
  assert.deepEqual(P.shootMsg(started('bs'), 5), { g: 'bs', op: 'shoot', gid: 'g1', r: 0, n: 0, a: 5 });
  assert.deepEqual(P.resultMsg(started('bs'), 5, 12), { g: 'bs', op: 'result', gid: 'g1', r: 0, n: 0, a: 5, b: 12 });
  const st = P.startMsg(s, b, false);
  assert.deepEqual(st, { g: 'rps', op: 'start', gid: 'g1', x: b, o: a });
});

test('messages as the Mac encodes them are understood; unknown keys are dropped and wrong types rejected', () => {
  // Swift's JSONEncoder leaves out nil fields and writes Ints as plain numbers.
  const wire = JSON.parse('{"g":"c4","op":"move","gid":"abc","r":1,"n":3,"a":4}');
  assert.deepEqual(P.parse(wire), wire);
  assert.deepEqual(P.parse({ ...wire, extra: 'x' }), wire, 'unknown keys are dropped');
  assert.equal(P.parse({ ...wire, a: '4' }), null, 'a string where a number belongs: the Mac cannot decode it either');
  assert.equal(P.parse({ ...wire, a: 4.5 }), null);
  assert.equal(P.parse({ g: 'c4', op: 'move' }), null, 'gid is required');
  assert.equal(P.parse(null), null);
  assert.equal(P.parse('move'), null);
});

test('parse limits: ranges, hashes and answers', () => {
  assert.equal(P.parse({ g: 'bs', op: 'result', gid: 'g', r: 0, n: 0, a: 5, b: 7 }), null, 'answers are 0, 1 or 10 + a ship length');
  assert.equal(P.parse({ g: 'bs', op: 'result', gid: 'g', r: 0, n: 0, a: 5, b: 11 }), null);
  assert.equal(P.parse({ g: 'bs', op: 'result', gid: 'g', r: 0, n: 0, a: 5, b: 16 }), null);
  for (const b2 of [0, 1, 12, 13, 14, 15]) assert.ok(P.parse({ g: 'bs', op: 'result', gid: 'g', r: 0, n: 0, a: 5, b: b2 }), `answer ${b2}`);
  assert.ok(P.parse({ g: 'bs', op: 'result', gid: 'g', r: 0, n: 200, a: 5, b: 0 }), 'n goes to 200');
  assert.equal(P.parse({ g: 'bs', op: 'result', gid: 'g', r: 0, n: 201, a: 5, b: 0 }), null);
  assert.ok(P.parse({ g: 'bs', op: 'shoot', gid: 'g', r: 0, n: 200, a: 99 }));
  assert.equal(P.parse({ g: 'bs', op: 'shoot', gid: 'g', r: 0, n: 0, a: 100 }), null);
  assert.equal(P.parse({ g: 'c4', op: 'move', gid: 'g', r: 0, n: 0, a: 9 }), null);
  assert.equal(P.parse({ g: 'c4', op: 'move', gid: 'g', r: 1001, n: 0, a: 1 }), null);
  const hash = P.rpsCommit(0, 's');
  assert.ok(P.parse({ g: 'rps', op: 'commit', gid: 'g', r: 0, n: 0, h: hash }));
  assert.equal(P.parse({ g: 'rps', op: 'commit', gid: 'g', r: 0, n: 0, h: hash.toUpperCase() }), null, 'hashes are lowercase hex');
  assert.equal(P.parse({ g: 'rps', op: 'commit', gid: 'g', r: 0, n: 0, h: hash.slice(1) }), null);
  assert.equal(P.parse({ g: 'rps', op: 'reveal', gid: 'g', r: 0, n: 0, a: 3, s: 'x' }), null, 'a pick is 0, 1 or 2');
  assert.equal(P.parse({ g: 'rps', op: 'reveal', gid: 'g', r: 0, n: 0, a: 1, s: '' }), null, 'a salt is required');
  assert.equal(P.parse({ g: 'bs', op: 'reveal', gid: 'g', r: 0, s: 'x'.repeat(141) }), null);
  assert.ok(P.parse({ g: 'bs', op: 'reveal', gid: 'g', r: 0, s: 'x'.repeat(140) }));
  assert.equal(P.parse({ g: 'bs', op: 'start', gid: 'g', x: 'a', o: 'a' }), null, 'start needs two different players');
  assert.equal(P.parse({ g: 'bs', op: 'nope', gid: 'g' }), null);
  assert.equal(P.parse({ g: 'bs', op: 'invite', gid: '' }), null);
  assert.equal(P.parse({ g: 'bs', op: 'invite', gid: 'x'.repeat(65) }), null);
});

// ---- lobby ----

test('the lobby rules are enforced', () => {
  let s = P.reduce(null, P.inviteMsg('c4', 'g1'), a);
  assert.equal(s.status, 'invited');
  assert.equal(P.reduce(s, P.acceptMsg(s), a), s, "the inviter can't accept their own invite");
  s = P.reduce(s, P.acceptMsg(s), b);
  assert.equal(s.accepted, b);
  const bogus = { g: 'c4', op: 'start', gid: 'g1', x: 'eve', o: b };
  assert.equal(P.reduce(s, bogus, a), s, 'start must name the inviter and the acceptor');
  assert.equal(P.reduce(s, P.startMsg(s, b, true), b), s, 'only the inviter can start');
  assert.equal(P.reduce(s, { g: 'nope', op: 'invite', gid: 'z' }, a), s, 'unknown games are ignored');
  assert.equal(P.reduce(s, { g: 'rps', op: 'cancel', gid: 'g1' }, a), s, 'a message for another kind of game is ignored');
  assert.equal(P.reduce(s, { g: 'c4', op: 'cancel', gid: 'other' }, a), s, 'a message for another game id is ignored');
  assert.equal(P.reduce(s, P.cancelMsg(s), b), s, 'only the inviter can cancel');
  const cancelled = P.reduce(s, P.cancelMsg(s), a);
  assert.equal(cancelled.status, 'cancelled');
  // A second invite while the first is open is ignored; after it finished, a new one replaces it.
  assert.equal(P.reduce(s, P.inviteMsg('bs', 'g2'), b), s);
  assert.equal(P.reduce(cancelled, P.inviteMsg('bs', 'g2'), b).gid, 'g2');
  // The acceptor only counts once: a second accept is ignored.
  assert.equal(P.reduce(s, P.acceptMsg(s), 'carol'), s);
});

test('the input is never changed: an applied message makes a new state, an ignored one returns the same', () => {
  const s = started('c4');
  const frozen = JSON.stringify(s);
  const next = send(s, P.moveMsg(s, 0), a);
  assert.notEqual(next, s);
  assert.equal(JSON.stringify(s), frozen);
  assert.equal(core(send(s, P.moveMsg(s, 0), b)), core(s));
});

test('quit ends a game that is being played, only for its players', () => {
  const s = started('c4');
  assert.equal(send(s, P.quitMsg(s), 'carol'), s);
  const e = send(s, P.quitMsg(s), b);
  assert.equal(e.status, 'ended');
  assert.equal(e.leaver, b);
  assert.equal(send(e, P.moveMsg(e, 0), a), e, 'no moves after a game ended');
});

// ---- Connect Four ----

test('Connect Four takes turns and a vertical four wins', () => {
  let s = started('c4');
  assert.equal(core(send(s, P.moveMsg(s, 0), b)), core(s), "bob can't go first");
  // alice stacks column 0, bob column 1: alice wins on her fourth disc.
  for (let i = 0; i < 3; i++) { s = send(s, P.moveMsg(s, 0), a); s = send(s, P.moveMsg(s, 1), b); }
  s = send(s, P.moveMsg(s, 0), a);
  assert.equal(s.status, 'finished');
  assert.equal(s.winner, a);
  assert.equal(s.c4.line.length, 4);
  assert.equal(send(s, P.moveMsg(s, 2), b), s, 'no moves after the game is over');
});

test('Connect Four horizontal, both diagonals and a full board draw', () => {
  const play = (cols, who = [a, b]) => { let s = started('c4'); cols.forEach((c, i) => { s = send(s, P.moveMsg(s, c), who[i % 2]); }); return s; };
  // horizontal: alice 0,1,2,3 on the bottom row; bob on the row above.
  let s = play([0, 0, 1, 1, 2, 2, 3]);
  assert.equal(s.winner, a);
  assert.deepEqual(s.c4.line, [35, 36, 37, 38]);
  // diagonal rising to the right for alice: bottom of col 0, col 1 on a bob disc, ...
  s = play([0, 1, 1, 2, 2, 3, 2, 3, 3, 6, 3]);
  assert.equal(s.winner, a, 'rising diagonal');
  s = play([6, 5, 5, 4, 4, 3, 4, 3, 3, 0, 3]);
  assert.equal(s.winner, a, 'falling diagonal');
  // A full board with no four in a row is a draw (a 42-move sequence found by search, checked here move by move).
  let d = started('c4');
  const seq = [4, 6, 1, 4, 6, 1, 1, 2, 4, 6, 6, 4, 4, 1, 2, 5, 1, 2, 5, 4, 5, 5, 3, 6, 1, 3, 3, 0, 2, 5, 5, 6, 3, 3, 3, 2, 2, 0, 0, 0, 0, 0];
  seq.forEach((c, k) => {
    assert.equal(d.status, 'playing', `move ${k}`);
    d = send(d, P.moveMsg(d, c), k % 2 === 0 ? a : b);
    assert.equal(d.c4.moves, k + 1);
  });
  assert.equal(d.status, 'finished');
  assert.equal(d.winner, null, 'a full board is a draw');
  assert.equal(d.c4.line, null);
});

test('Connect Four: a full column is closed, and a move that overtakes an earlier one waits for it', () => {
  let s = started('c4');
  for (let i = 0; i < 6; i++) s = send(s, P.moveMsg(s, 0), i % 2 === 0 ? a : b);
  assert.equal(P.lowestEmptyRow(s.c4, 0), null);
  assert.equal(P.canDrop(s, a, 0), false);
  assert.equal(P.canDrop(s, a, 1), true);
  assert.equal(P.canDrop(s, b, 1), false, "not bob's turn");
  const n = s.c4.moves;
  assert.equal(core(send(s, P.moveMsg(s, 0), a)), core(s));
  assert.equal(s.c4.moves, n);
  // Out of order: bob's reply (move number 1) arrives before alice's move (number 0).
  let t = started('c4');
  const first = P.moveMsg(t, 3);
  const t2 = send(t, first, a);
  const second = P.moveMsg(t2, 4);
  t = send(t, second, b);
  assert.equal(t.c4.moves, 0);
  assert.equal(t.stash.length, 1);
  t = send(t, first, a);
  assert.equal(t.c4.moves, 2, 'the early move is applied once its predecessor arrives');
  assert.equal(t.stash.length, 0);
  // Repeats change nothing.
  assert.equal(core(send(t, first, a)), core(t), 'a repeated move is not applied twice');
});

test('the stash keeps at most 12 early messages and no duplicates', () => {
  let s = started('c4');
  const early = (n, col) => ({ g: 'c4', op: 'move', gid: 'g1', r: 0, n, a: col });
  for (let n = 2; n < 40; n++) s = send(s, early(n, n % 7), n % 2 === 0 ? a : b);
  assert.equal(s.stash.length, 12);
  const same = send(s, early(2, 2), a);
  assert.equal(same, s, 'a message already kept is not kept twice');
});

test('a rematch swaps who goes first and starts clean', () => {
  let s = started('c4');
  for (let i = 0; i < 3; i++) { s = send(s, P.moveMsg(s, 0), a); s = send(s, P.moveMsg(s, 1), b); }
  s = send(s, P.moveMsg(s, 0), a);
  assert.equal(s.status, 'finished');
  s = send(s, P.rematchMsg(s), a);
  assert.equal(s.status, 'finished', 'one person asking is not enough');
  assert.equal(send(s, P.rematchMsg(s), a), s, 'asking twice does not count twice');
  assert.equal(send(s, P.rematchMsg(s), 'carol'), s);
  s = send(s, P.rematchMsg(s), b);
  assert.equal(s.status, 'playing');
  assert.equal(s.p1, b);
  assert.equal(s.round, 1);
  assert.equal(s.c4.moves, 0);
  assert.equal(s.winner, null);
  // Moves of the old round are stale now; moves of the new round need bob first.
  assert.equal(send(s, { g: 'c4', op: 'move', gid: 'g1', r: 0, n: 0, a: 0 }, b), s);
  assert.equal(core(send(s, P.moveMsg(s, 0), a)), core(s));
  assert.equal(send(s, P.moveMsg(s, 0), b).c4.moves, 1);
});

// ---- Rock Paper Scissors ----

test('Rock Paper Scissors: commit then reveal, a changed pick is refused, first to two wins', () => {
  let s = started('rps');
  const salt1 = 's1', salt2 = 's2';
  s = send(s, P.commitMsg(s, 1, salt1), a);                      // alice: paper
  s = send(s, P.commitMsg(s, 0, salt2), b);                      // bob: rock
  // Bob tries to change his pick after seeing alice's: the hash doesn't match, so it is not accepted (it is only kept).
  const cheat = s;
  const lie = P.revealMsg(s, 2, salt2);
  s = send(s, lie, b);
  assert.equal(s.rps.reveal[1], null, 'a changed pick is not accepted');
  assert.deepEqual(s.rps.score, [0, 0]);
  s = cheat;
  s = send(s, P.revealMsg(s, 1, salt1), a);
  assert.equal(s.rps.reveal[0], 1);
  assert.equal(s.rps.last, null, 'nothing is scored until both are in');
  s = send(s, P.revealMsg(s, 0, salt2), b);
  assert.deepEqual(s.rps.score, [1, 0]);
  assert.deepEqual(s.rps.last, [1, 0]);
  assert.equal(s.rps.lastWinner, 0);
  assert.equal(s.rps.n, 1);
  assert.deepEqual(s.rps.commit, [null, null]);
  // Alice wins the second game too: first to two.
  s = send(s, P.commitMsg(s, 2, 'x'), a);
  s = send(s, P.commitMsg(s, 1, 'y'), b);
  s = send(s, P.revealMsg(s, 2, 'x'), a);
  s = send(s, P.revealMsg(s, 1, 'y'), b);
  assert.equal(s.status, 'finished');
  assert.equal(s.winner, a);
  assert.deepEqual(s.rps.score, [2, 0]);
});

test('Rock Paper Scissors: every pairing is scored right', () => {
  // rock(0) < paper(1) < scissors(2) < rock
  const results = { '0,1': 1, '1,2': 1, '2,0': 1, '1,0': 0, '2,1': 0, '0,2': 0 };
  for (const [key, winner] of Object.entries(results)) {
    const [pa, pb] = key.split(',').map(Number);
    let s = started('rps');
    s = send(s, P.commitMsg(s, pa, 'p'), a); s = send(s, P.commitMsg(s, pb, 'q'), b);
    s = send(s, P.revealMsg(s, pa, 'p'), a); s = send(s, P.revealMsg(s, pb, 'q'), b);
    assert.equal(s.rps.lastWinner, winner, key);
    assert.equal(s.rps.score[winner], 1, key);
  }
});

test('Rock Paper Scissors: ties score nothing and early reveals wait for the commit', () => {
  let s = started('rps');
  s = send(s, P.revealMsg(s, 0, 'p'), a);                         // before her own commit: kept, not applied
  assert.equal(s.rps.reveal[0], null);
  assert.equal(s.stash.length, 1);
  s = send(s, P.commitMsg(s, 0, 'p'), a);
  assert.equal(s.rps.reveal[0], 0, 'the early reveal is applied once the commit is in');
  assert.equal(s.stash.length, 0);
  s = send(s, P.commitMsg(s, 0, 'q'), b);
  s = send(s, P.revealMsg(s, 0, 'q'), b);
  assert.deepEqual(s.rps.score, [0, 0], 'a tie scores nothing');
  assert.equal(s.rps.lastWinner, null);
  assert.equal(s.rps.n, 1);
  assert.equal(s.status, 'playing');
});

test('Rock Paper Scissors: a second commit is ignored, and so is one for another game of the match', () => {
  let s = started('rps');
  s = send(s, P.commitMsg(s, 0, 'p'), a);
  const again = send(s, P.commitMsg(s, 2, 'z'), a);
  assert.equal(again.rps.commit[0], P.rpsCommit(0, 'p'), 'the first commit stands');
  assert.equal(send(s, { ...P.commitMsg(s, 1, 'q'), n: 4 }, b).rps.commit[1], null, 'a commit for a later game waits');
});

// ---- Battleship ----

test('fleets are legal and answers are right', () => {
  for (let i = 0; i < 50; i++) assert.ok(P.isLegalFleet(P.randomFleet()));
  assert.equal(P.isLegalFleet('0'.repeat(100)), false);
  assert.equal(P.isLegalFleet('0'.repeat(99)), false);
  assert.equal(P.isLegalFleet(null), false);
  // A fleet in the top-left corner, row by row: A on row 0, B row 1, ...
  const rows = Array(100).fill('0');
  P.BS.fleet.forEach((f, i) => { for (let c = 0; c < f.length; c++) rows[i * 10 + c] = f.id; });
  const board = rows.join('');
  assert.ok(P.isLegalFleet(board));
  // A broken shape (one cell of ship A moved away from the others) is not a legal fleet.
  const broken = [...board]; broken[4] = '0'; broken[99] = 'A';
  assert.equal(P.isLegalFleet(broken.join('')), false);
  const diagonal = [...board]; diagonal[0] = '0'; diagonal[11 + 0] = 'A'; diagonal[11] = 'A';
  assert.equal(P.isLegalFleet(diagonal.join('')), false);
  assert.equal(P.answer(board, new Set([0]), 0), 1);
  assert.equal(P.answer(board, new Set([99]), 99), 0);
  assert.equal(P.answer(board, new Set([40, 41]), 41), 12, 'sinking the 2-long ship answers 10 + 2');
  assert.equal(P.answer(board, new Set([0, 1, 2, 3, 4]), 4), 15, 'sinking the 5-long ship');
  assert.equal(P.answer(board, new Set([20, 21]), 21), 1, 'a hit that does not sink');
});

/** Plays two simulated players (each with their own fleet) to the end through the rules, the way the app does. */
function playBattleship({ cheat }) {
  let s = started('bs');
  const fa = P.randomFleet(), fb = P.randomFleet();
  s = send(s, P.readyMsg(s, fa, 'sa'), a);
  s = send(s, P.readyMsg(s, fb, 'sb'), b);
  assert.ok(P.bothReady(s.bs));
  const shotAtA = new Set(), shotAtB = new Set();
  const shuffled = () => Array.from({ length: 100 }, (_, i) => i).sort(() => Math.random() - 0.5);
  const order = shuffled(), order2 = shuffled();
  let guard = 0;
  while (s.status === 'playing' && guard++ < 300) {
    const aMoves = s.bs.moves % 2 === 0;                      // alice is player 1
    const shooterId = aMoves ? a : b, target = aMoves ? b : a;
    const cell = aMoves ? order.pop() : order2.pop();
    assert.ok(P.canShoot(s, shooterId, cell));
    s = send(s, P.shootMsg(s, cell), shooterId);
    assert.equal(s.bs.pendingCell, cell);
    assert.equal(P.canShoot(s, shooterId, (cell + 1) % 100), false, 'no second shot before the answer');
    if (aMoves) shotAtB.add(cell); else shotAtA.add(cell);
    let code = P.answer(aMoves ? fb : fa, aMoves ? shotAtB : shotAtA, cell);
    if (cheat && code === 1 && target === b && Math.random() < 0.5) code = 0;     // bob lies about a hit
    s = send(s, P.resultMsg(s, cell, code), target);
  }
  assert.equal(s.status, 'finished');
  s = send(s, P.revealFleetMsg(s, fa, 'sa'), a);
  s = send(s, P.revealFleetMsg(s, fb, 'sb'), b);
  return s;
}

test('an honest Battleship game ends and both fleets check out', () => {
  const s = playBattleship({ cheat: false });
  assert.ok(s.winner);
  assert.deepEqual(s.bs.revealed, [true, true]);
  const loser = s.winner === a ? 1 : 0;
  assert.equal(s.bs.hits[loser], 17);
  assert.equal(s.bs.sunk[loser].reduce((x, y) => x + y, 0), 17, 'all five ships sank');
  assert.equal(s.bs.sunk[loser].length, 5);
});

test('a lying opponent is caught at the reveal', () => {
  let caught = false;
  for (let i = 0; i < 8 && !caught; i++) {                      // bob lies at random, so give it a few games
    const s = playBattleship({ cheat: true });
    if (s.bs.revealed[1] === false) caught = true;
    assert.equal(s.bs.revealed[0], true, 'the honest player is never flagged');
  }
  assert.ok(caught, "a fleet that doesn't match its answers is flagged");
});

test('a fleet revealed with the wrong salt, a different fleet or garbage is flagged, and only once', () => {
  const finishedWith = (revealB) => {
    let s = started('bs');
    const fa = P.randomFleet(), fb = P.randomFleet();
    s = send(s, P.readyMsg(s, fa, 'sa'), a); s = send(s, P.readyMsg(s, fb, 'sb'), b);
    s.status = 'finished'; s.winner = a;                          // (the game itself is covered above)
    s = send(s, P.revealFleetMsg(s, fa, 'sa'), a);
    return send(s, revealB(s, fb), b);
  };
  assert.equal(finishedWith((s, fb) => P.revealFleetMsg(s, fb, 'sb')).bs.revealed[1], true);
  assert.equal(finishedWith((s, fb) => P.revealFleetMsg(s, fb, 'other')).bs.revealed[1], false, 'wrong salt');
  assert.equal(finishedWith((s) => P.revealFleetMsg(s, P.randomFleet(), 'sb')).bs.revealed[1], false, 'a different fleet');
  assert.equal(finishedWith((s) => ({ ...P.revealFleetMsg(s, 'x', 'y') })).bs.revealed[1], false, 'garbage');
  assert.equal(finishedWith((s) => ({ ...P.revealFleetMsg(s, 'x', 'y'), s: 'nocolon' })).bs.revealed[1], false);
  const done = finishedWith((s, fb) => P.revealFleetMsg(s, fb, 'sb'));
  assert.equal(send(done, P.revealFleetMsg(done, 'z', 'z'), b), done, 'a second reveal changes nothing');
});

test('an illegal fleet that matches its own hash is still flagged', () => {
  let s = started('bs');
  const bad = '0'.repeat(100), fa = P.randomFleet();
  s = send(s, P.readyMsg(s, fa, 'sa'), a); s = send(s, P.readyMsg(s, bad, 'sb'), b);
  s.status = 'finished';
  s = send(s, P.revealFleetMsg(s, bad, 'sb'), b);
  assert.equal(s.bs.revealed[1], false);
});

test('Battleship order and turn rules', () => {
  let s = started('bs');
  s = send(s, P.shootMsg(s, 9), b);
  assert.equal(s.bs.pendingCell, null, 'no shooting before both fleets are ready');
  s = send(s, P.readyMsg(s, P.randomFleet(), 'x'), a);
  assert.equal(P.canShoot(s, a, 5), false, 'one fleet is not enough');
  assert.equal(core(send(s, P.readyMsg(s, P.randomFleet(), 'x2'), a)), core(s), 'a second Ready from the same player is ignored');
  s = send(s, P.readyMsg(s, P.randomFleet(), 'y'), b);
  assert.equal(s.bs.pendingCell, null, "bob isn't first, so his early shot is not played");
  s = send(s, P.shootMsg(s, 5), a);
  assert.equal(s.bs.pendingCell, 5);
  s = send(s, P.resultMsg(s, 6, 0), b);
  assert.equal(s.bs.moves, 0, 'an answer for a different cell is ignored');
  assert.equal(core(send(s, P.resultMsg(s, 5, 0), a)), core(s), 'only the player shot at can answer');
  s = send(s, P.resultMsg(s, 5, 0), b);
  assert.equal(s.bs.moves, 1);
  assert.equal(s.bs.shots[1][5], 1);
  assert.equal(P.shooter(s.bs), 1, "now it's bob's turn");
  assert.equal(core(send(s, P.shootMsg(s, 5), a)), core(s), 'alice cannot shoot twice in a row');
  s = send(s, P.shootMsg(s, 9), b);
  assert.equal(s.bs.pendingCell, 9);
  // Alice already shot cell 5 on bob's board: bob's board is shots[1]; alice shooting there again is refused.
  s = send(s, P.resultMsg(s, 9, 0), a);
  assert.equal(s.bs.moves, 2);
  assert.equal(P.canShoot(s, a, 5), false, 'a cell already shot is closed');
  assert.equal(core(send(s, P.shootMsg(s, 5), a)), core(s), '…and the rules refuse it too');
});

test('Battleship: a shot that overtakes the answer before it waits, then is played', () => {
  let s = started('bs');
  s = send(s, P.readyMsg(s, P.randomFleet(), 'x'), a);
  s = send(s, P.readyMsg(s, P.randomFleet(), 'y'), b);
  const shot0 = P.shootMsg(s, 5);
  let after0 = send(s, shot0, a);
  const answer0 = P.resultMsg(after0, 5, 0);
  const after1 = send(after0, answer0, b);
  const shot1 = P.shootMsg(after1, 8);
  // On a third machine the messages arrive reversed: shot 1, then answer 0, then shot 0.
  let t = s;
  t = send(t, shot1, b);
  assert.equal(t.bs.moves, 0);
  t = send(t, answer0, b);
  assert.equal(t.bs.moves, 0);
  t = send(t, shot0, a);
  assert.equal(t.bs.moves, 1, 'the answer and then the second shot follow the first shot');
  assert.equal(t.bs.pendingCell, 8);
});

// ---- the controller: two machines, each with its own state, secrets and automatic answers ----

/** Two controllers joined by a delivery queue; `deliver` hands over queued messages in order (or shuffled) until none are left. */
function pair({ shuffle = false, random = undefined } = {}) {
  const queue = [], events = { [a]: [], [b]: [] };
  const mk = (me, other) => P.createPlayController({
    myID: me, name: (id) => (id === me ? 'You' : id || 'Someone'), random,
    transport: (m) => queue.push({ to: other, from: me, m: JSON.parse(JSON.stringify(m)) }),   // across the wire as JSON
    onEvent: (t) => events[me].push(t),
  });
  const A = mk(a, b), B = mk(b, a), by = { [a]: A, [b]: B };
  function deliver() {
    let guard = 0;
    while (queue.length && guard++ < 5000) {
      const i = shuffle ? Math.floor(Math.random() * queue.length) : 0;
      const [item] = queue.splice(i, 1);
      by[item.to].receive(item.m, item.from);
    }
    assert.ok(guard < 5000, 'the messages must settle');
  }
  return { A, B, deliver, events, queue };
}

function startGame(p, kind) {
  p.A.invite(kind); p.deliver();
  assert.equal(p.B.session.status, 'invited');
  p.B.accept(); p.deliver();
  assert.equal(p.A.session.status, 'playing', 'the inviter starts the game when the acceptor says yes');
  assert.equal(p.B.session.status, 'playing');
  assert.deepEqual([p.A.session.p1, p.A.session.p2], [p.B.session.p1, p.B.session.p2]);
}

test('controllers: invite, accept and the automatic start give both sides the same game', () => {
  const p = pair();
  assert.equal(p.A.isActive, false);
  p.A.invite('c4');
  p.A.invite('rps');                                            // a second invite while one is open is ignored
  p.deliver();
  assert.equal(p.A.session.kind, 'c4');
  assert.equal(p.B.session.kind, 'c4');
  assert.match(p.events[b][0], /invited you to play Connect Four/);
  assert.equal(p.events[a].length, 0, 'you are not told about your own invite');
  p.B.accept(); p.deliver();
  assert.equal(p.A.session.status, 'playing');
  assert.equal(p.A.session.p1 === a || p.A.session.p1 === b, true);
  assert.deepEqual(p.A.session, p.B.session);
});

test('controllers: cancelling an invite closes it for both', () => {
  const p = pair();
  p.A.invite('bs'); p.deliver();
  p.A.cancelInvite(); p.deliver();
  assert.equal(p.B.session.status, 'cancelled');
  p.B.close();
  assert.equal(p.B.session, null);
  assert.equal(p.A.isActive, false);
});

test('controllers: Connect Four through the controllers, with a rematch', () => {
  const p = pair();
  startGame(p, 'c4');
  const first = p.A.session.p1 === a ? p.A : p.B, second = first === p.A ? p.B : p.A;
  second.drop(0); p.deliver();
  assert.equal(p.A.session.c4.moves, 0, "the second player's move is refused before it is sent");
  assert.equal(p.queue.length, 0, 'an illegal move is not sent');
  for (let i = 0; i < 3; i++) { first.drop(0); p.deliver(); second.drop(1); p.deliver(); }
  first.drop(0); p.deliver();
  for (const c of [p.A, p.B]) { assert.equal(c.session.status, 'finished'); assert.equal(c.session.winner, first.myID); }
  assert.match(p.events[first.myID].at(-1), /won/);
  first.rematch(); p.deliver();
  assert.equal(first.session.status, 'finished');
  second.rematch(); p.deliver();
  for (const c of [p.A, p.B]) { assert.equal(c.session.status, 'playing'); assert.equal(c.session.round, 1); assert.equal(c.session.p1, second.myID); }
});

test('controllers: leaving ends the game for both; a vanished opponent ends it too', () => {
  let p = pair();
  startGame(p, 'rps');
  p.B.leave(); p.deliver();
  assert.equal(p.A.session.status, 'ended');
  assert.match(p.events[a].at(-1), /left the game/);
  p = pair();
  startGame(p, 'bs');
  p.A.playerGone(b);                                            // the room says bob left
  assert.equal(p.A.session.status, 'ended');
  p.A.playerGone('carol');
  assert.equal(p.A.session.status, 'ended');
});

test('controllers: Rock Paper Scissors plays itself out, in order and shuffled', () => {
  for (const shuffle of [false, true]) {
    for (let round = 0; round < 6; round++) {
      const p = pair({ shuffle });
      startGame(p, 'rps');
      let games = 0;
      while (p.A.session.status === 'playing' && games++ < 30) {
        // Both press at once, so the commits cross; the reveals follow by themselves.
        p.A.pick(Math.floor(Math.random() * 3));
        p.B.pick(Math.floor(Math.random() * 3));
        p.deliver();
      }
      for (const c of [p.A, p.B]) assert.equal(c.session.status, 'finished', `shuffle ${shuffle}`);
      assert.deepEqual(p.A.session.rps.score, p.B.session.rps.score);
      assert.ok(p.A.session.rps.score.includes(2));
      assert.equal(p.A.session.winner, p.B.session.winner);
    }
  }
});

test('controllers: a pick is locked once made, and the opponent never sees it before both are in', () => {
  const p = pair();
  startGame(p, 'rps');
  p.A.pick(1); p.deliver();
  assert.equal(p.A.myPick, 1);
  assert.equal(p.B.session.rps.commit[p.B.session.p1 === a ? 0 : 1] !== null, true, 'bob has seen only the hash');
  assert.equal(p.B.session.rps.reveal.every((x) => x === null), true);
  assert.equal(JSON.stringify(p.queue), '[]');
  p.A.pick(2);                                                  // changing your mind is refused
  assert.equal(p.A.myPick, 1);
  p.B.pick(0); p.deliver();
  assert.equal(p.A.session.rps.n, 1);
  assert.equal(p.A.myPick, null, 'the pick is cleared for the next game');
  const last = p.A.session.rps.last, ia = p.A.session.p1 === a ? 0 : 1;
  assert.equal(last[ia], 1);
  assert.equal(last[1 - ia], 0);
});

test('controllers: a full Battleship game plays itself with automatic answers and a clean reveal', () => {
  for (const shuffle of [false, true]) {
    const p = pair({ shuffle });
    startGame(p, 'bs');
    assert.ok(P.isLegalFleet(p.A.fleet) && P.isLegalFleet(p.B.fleet));
    const fleetA = p.A.fleet;
    p.A.shuffleFleet();                                          // new placement before Ready
    assert.ok(P.isLegalFleet(p.A.fleet));
    p.A.readyFleet(); p.B.readyFleet(); p.deliver();
    assert.equal(p.A.iCommittedFleet, true);
    p.A.shuffleFleet();
    const committed = p.A.fleet;
    p.A.shuffleFleet();
    assert.equal(p.A.fleet, committed, 'the fleet is fixed once Ready');
    assert.ok(fleetA);
    let guard = 0;
    const tried = { [a]: new Set(), [b]: new Set() };
    while (p.A.session.status === 'playing' && guard++ < 300) {
      const me = P.shooter(p.A.session.bs) === (p.A.session.p1 === a ? 0 : 1) ? p.A : p.B;
      let cell; do { cell = Math.floor(Math.random() * 100); } while (tried[me.myID].has(cell));
      tried[me.myID].add(cell);
      me.fire(cell); p.deliver();
    }
    for (const c of [p.A, p.B]) {
      assert.equal(c.session.status, 'finished', `shuffle ${shuffle}`);
      assert.deepEqual(c.session.bs.revealed, [true, true], 'both fleets matched every answer');
    }
    assert.deepEqual(p.A.session, p.B.session);
  }
});

test('controllers: a Battleship player who lies is caught by the other app', () => {
  // The honest controller is alice; bob's answers are rewritten on the way (every hit becomes a miss until the end).
  let caught = false;
  for (let game = 0; game < 6 && !caught; game++) {
    const queue = [];
    const A = P.createPlayController({ myID: a, transport: (m) => queue.push({ to: 'B', from: a, m }) });
    const B = P.createPlayController({
      myID: b,
      transport: (m) => queue.push({ to: 'A', from: b, m: m.op === 'result' && m.b !== 0 && Math.random() < 0.4 ? { ...m, b: 0 } : m }),
    });
    // (B's own state records the truth; only the wire message is a lie, so A's view differs from B's.)
    const by = { A, B };
    const flush = () => { let g = 0; while (queue.length && g++ < 2000) { const it = queue.shift(); by[it.to].receive(JSON.parse(JSON.stringify(it.m)), it.from); } };
    A.invite('bs'); flush(); B.accept(); flush(); A.readyFleet(); B.readyFleet(); flush();
    const tried = new Set();
    let g = 0;
    while (A.session.status === 'playing' && g++ < 400) {
      const aShoots = P.shooter(A.session.bs) === (A.session.p1 === a ? 0 : 1);
      if (!aShoots) {
        const sB = B.session; if (!sB || P.shooter(sB.bs) === null) break;
        let cell; do { cell = Math.floor(Math.random() * 100); } while (new Set(sB.bs.shots[(sB.p1 === b ? 1 : 0)].map((v, i) => (v ? i : -1))).has(cell));
        B.fire(cell);
      } else {
        let cell; do { cell = Math.floor(Math.random() * 100); } while (tried.has(cell));
        tried.add(cell); A.fire(cell);
      }
      flush();
      if (A.session.status !== 'playing') break;
    }
    flush();
    const meA = A.session.p1 === a ? 0 : 1;
    if (A.session.bs.revealed[1 - meA] === false) caught = true;
  }
  assert.ok(caught, 'alice flags a fleet that does not match the answers she was given');
});

test('controllers: early and repeated messages from the network are harmless', () => {
  const p = pair();
  startGame(p, 'c4');
  const before = JSON.stringify(p.A.session);
  assert.equal(p.A.receive({ g: 'c4', op: 'move', gid: 'other', r: 0, n: 0, a: 1 }, b), false, 'another game id');
  assert.equal(p.A.receive({ g: 'c4', op: 'move', gid: p.A.session.gid, r: 0, n: 0, a: 99 }, b), false, 'a column out of range');
  assert.equal(p.A.receive({ g: 'c4', op: 'move', gid: p.A.session.gid, r: 0, n: 0, a: 1 }, 'eve'), false, 'someone who is not playing');
  assert.equal(p.A.receive(null, b), false);
  assert.equal(p.A.receive('hello', b), false);
  assert.equal(JSON.stringify(p.A.session), before);
});

test('controllers: reset forgets everything and calls onChange', () => {
  let changes = 0;
  const c = P.createPlayController({ myID: a, onChange: () => { changes++; } });
  c.invite('c4');
  assert.ok(c.isActive);
  const n = changes;
  c.reset();
  assert.equal(c.session, null);
  assert.equal(c.isActive, false);
  assert.ok(changes > n);
});

test('controllers: salts, fleets and game ids come from the injected random when one is given', () => {
  let i = 0;
  const rand = () => ((i++ * 0.37) % 1);
  const gid = P.newGameId(rand);
  assert.equal(gid.length, 12);
  assert.match(gid, /^[a-hjkmnp-z2-9]+$/);
  assert.ok(P.isLegalFleet(P.randomFleet(rand)));
  assert.match(P.newGameId(), /^[a-hjkmnp-z2-9]{12}$/);
});

test('a controller can be given a function for its ID (a room only knows its ID once it is needed)', () => {
  let id = 'later';
  const c = P.createPlayController({ myID: () => id });
  assert.equal(c.myID, 'later');
  id = 'now';
  assert.equal(c.myID, 'now');
  c.invite('rps');
  assert.equal(c.session.inviter, 'now');
});

// ---- Friends bodies and the room envelope ----

const L = await loadModule('services/friendslogic.js');

test('friend chat bodies: t "play" with a play object, t "game" with a ttt object (the Mac FriendBody)', () => {
  const play = P.moveMsg(started('c4'), 2);
  const body = L.playBody('boxA', play, 1234);
  assert.deepEqual(body, { t: 'play', from: 'boxA', ts: 1234, play });
  assert.deepEqual(JSON.parse(JSON.stringify(body)), body);
  const ttt = { g: 'ttt', op: 'invite', gid: 'g1', mark: 'X' };
  assert.deepEqual(L.tttBody('boxA', ttt, 5), { t: 'game', from: 'boxA', ts: 5, ttt });
  // A body as the Mac writes it (sorted keys, no nil fields) is read back into a message the rules accept.
  const fromMac = JSON.parse('{"from":"boxB","play":{"a":3,"g":"c4","gid":"abc","n":0,"op":"move","r":0},"t":"play","ts":1700000000000}');
  assert.deepEqual(P.parse(fromMac.play), fromMac.play);
});

test('the same rules run for two friends identified by mailbox, with a Mac-shaped invite in the middle', () => {
  const A = 'a'.repeat(32), B = 'b'.repeat(32);
  const mac = JSON.parse('{"g":"bs","op":"invite","gid":"k3m9x2p7q4wz"}');      // what the Mac sends (a friend chat or a room)
  let s = P.reduce(null, mac, B);
  assert.equal(s.status, 'invited');
  assert.equal(s.inviter, B);
  s = P.reduce(s, P.acceptMsg(s), A);
  s = P.reduce(s, JSON.parse('{"g":"bs","op":"start","gid":"k3m9x2p7q4wz","o":"' + A + '","x":"' + B + '"}'), B);
  assert.equal(s.status, 'playing');
  assert.equal(s.p1, B);
});
