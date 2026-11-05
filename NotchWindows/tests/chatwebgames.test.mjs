// Rocket League and Scribble in Windows friend chats and rooms: the lobby is in the session (games/twoplayer-logic.js, the Mac's "rl" and "sk"),
// the game itself is the live web game. The cases are the Mac's, from BoardGamesTests.swift. Run: node --test NotchWindows/tests/chatwebgames.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadModule } from './load.mjs';

const P = await loadModule('games/twoplayer-logic.js');
const a = 'alice', b = 'bob';
function started(kind, gid = 'abcdefghjkmn') {
  let s = P.reduce(null, P.inviteMsg(kind, gid), a);
  s = P.reduce(s, P.acceptMsg(s), b);
  s = P.reduce(s, P.startMsg(s, b, true), a);
  assert.equal(s.status, 'playing');
  return s;
}

test('both games are in the Games menu with the Mac ids, names and pictures', () => {
  assert.ok(P.KINDS.includes('rl') && P.KINDS.includes('sk'));
  assert.equal(P.TITLES.rl, 'Rocket League'); assert.equal(P.TITLES.sk, 'Scribble');
  assert.equal(P.EMOJI.rl, '🚀'); assert.equal(P.EMOJI.sk, '✏️');
  assert.equal(P.inviteMsg('rl', 'g1').g, 'rl'); assert.equal(P.inviteMsg('sk', 'g1').g, 'sk');
  assert.ok(P.WEB_GAMES.rl.files.length === 2 && P.WEB_GAMES.sk.files.length === 2);
});

test('the lobby works like the other games: invite, accept, start, and either player can leave', () => {
  for (const kind of ['rl', 'sk']) {
    let s = started(kind);
    assert.equal(s.p1, a); assert.equal(s.p2, b);
    s = P.reduce(s, P.quitMsg(s), b);
    assert.equal(s.status, 'ended'); assert.equal(s.leaver, b);
  }
});

test('there are no moves in the session: a stray move changes nothing', () => {
  for (const kind of ['rl', 'sk']) {
    const s = started(kind);
    const after = P.reduce(s, { g: kind, op: 'move', gid: s.gid, r: 0, n: 0, a: 3 }, a);
    assert.equal(JSON.stringify({ ...after, stash: [] }), JSON.stringify({ ...s, stash: [] }));
    assert.equal(after.status, 'playing');
  }
});

test('an invite from the Mac is understood, and an unknown game still is not', () => {
  const m = P.parse({ g: 'sk', op: 'invite', gid: 'abcdefghjkmn' });
  assert.equal(m && m.g, 'sk');
  assert.equal(P.parse({ g: 'zz', op: 'invite', gid: 'abcdefghjkmn' }), null);
});

test('any game id gives a valid six-character room code, the same on both sides', () => {
  const alphabet = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  for (let i = 0; i < 300; i++) {
    const code = P.roomCodeOf(P.newGameId());
    assert.equal(code.length, 6);
    assert.ok([...code].every((c) => alphabet.includes(c)), code);
  }
  assert.equal(P.roomCodeOf('abcdefghjkmn'), 'ABCDEF', 'what the Mac derives from the same id');
});
