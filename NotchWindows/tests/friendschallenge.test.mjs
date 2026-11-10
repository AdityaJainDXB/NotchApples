// Messenger → Friends: a game challenge from a friend (issue #58) shows in the chat like a message: a line "X challenged you to <game>",
// the unread count, the friend moving up the list, and the same notification text. Pure rules only.
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadModule } from './load.mjs';

const L = await loadModule('services/friendslogic.js');
const key = (n) => Buffer.alloc(32, n).toString('base64url');
const person = (n) => ({ box: `box${n}`, sign: key(n), dh: key(n + 100), fp: `fp${n}` });
function vaultWith(...ns) {
  const v = L.newVault();
  for (const n of ns) { const p = person(n); L.addOutgoing(v, { ...p, myTokenHash: 'h' }); L.receiveRequest(v, { box: p.box, sign: p.sign, dh: p.dh, token: 't', nick: `Sam${n}` }, p.fp); }
  return v;
}

test('a challenge is a message from the friend: the line names them and the game, and it raises the unread count', () => {
  const v = vaultWith(1);
  const m = L.receiveChallenge(v, 'box1', 'gid42', 'Connect Four', 5000);
  assert.ok(m);
  assert.match(m.text, /^🎮 .+ challenged you to Connect Four/);
  assert.match(m.text, /Accept/);
  assert.equal(m.mine, false);
  assert.equal(L.record(v, 'box1').unread, 1);
  assert.equal(L.totalUnread(v), 1);
  assert.equal(L.record(v, 'box1').lastActivity, 5000);
  assert.equal(L.messagesOf(v, 'box1').length, 1);
});

test('the notification line is the same one the chat shows', () => {
  const v = vaultWith(1);
  const m = L.receiveChallenge(v, 'box1', 'g1', 'Chess');
  assert.ok(m.text.startsWith(L.challengeLine(L.displayName(L.record(v, 'box1')), 'Chess')));
});

test('the same invite arriving twice (both relays) is one line and one unread', () => {
  const v = vaultWith(1);
  assert.ok(L.receiveChallenge(v, 'box1', 'g1', 'Battleship'));
  assert.equal(L.receiveChallenge(v, 'box1', 'g1', 'Battleship'), null);
  assert.equal(L.record(v, 'box1').unread, 1);
  assert.ok(L.receiveChallenge(v, 'box1', 'g2', 'Battleship'), 'a new invite is a new line');
  assert.equal(L.record(v, 'box1').unread, 2);
});

test('only an active friend can challenge, and a bad id is refused', () => {
  const v = vaultWith(1);
  assert.equal(L.receiveChallenge(v, 'nobody', 'g1', 'Chess'), null);
  assert.equal(L.receiveChallenge(v, 'box1', '', 'Chess'), null);
  assert.equal(L.receiveChallenge(v, 'box1', 5, 'Chess'), null);
});

test('opening the chat clears the challenge count like any message', () => {
  const v = vaultWith(1);
  L.receiveChallenge(v, 'box1', 'g1', 'Checkers');
  L.markRead(v, 'box1');
  assert.equal(L.totalUnread(v), 0);
});

test('a challenge sent before the chat was cleared does not come back', () => {
  const v = vaultWith(1);
  L.clearChat(v, 'box1');
  const stale = L.receiveMessage(v, 'box1', 'ch-old', 'x', 1, Date.now(), 0);
  assert.equal(stale, null);
});
