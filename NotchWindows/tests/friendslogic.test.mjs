// Messenger → Friends rules, mirrored from the Mac's FriendsTests.swift (the request / accept flow, blocking, key changes,
// message states, duplicates, the 2000-character limit and clean names) plus the link parser and the JSON round trip.
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadModule } from './load.mjs';

const L = await loadModule('services/friendslogic.js');
const key = (n) => Buffer.alloc(32, n).toString('base64url');          // a 32-byte key, base64url
const person = (n) => ({ box: `box${n}`, sign: key(n), dh: key(n + 100), fp: `fp${n}` });
const request = (p, extra = {}) => ({ t: 'req', box: p.box, sign: p.sign, dh: p.dh, nick: 'Ali', token: 'tok', ts: 1, ...extra });

test('codes and links', () => {
  assert.equal(L.normalizeCode(' abcde-fghjk '), 'ABCDEFGHJK');
  assert.equal(L.normalizeCode('oiL0123456'), '0110123456');
  assert.equal(L.normalizeCode('ABCDEFGHIU'), null);
  assert.equal(L.displayCode('ABCDEFGHJK'), 'ABCDE-FGHJK');
  const link = L.friendLink('ABCDEFGHJK', 'opzQcucP9GyEZpf_waJibQ');
  assert.deepEqual(L.parseFriend(link), { code: 'ABCDEFGHJK', fingerprint: 'opzQcucP9GyEZpf_waJibQ' });
  assert.deepEqual(L.parseFriend('ABCDE-FGHJK'), { code: 'ABCDEFGHJK', fingerprint: null });
  assert.equal(L.parseFriend('notchapple://friend?c=nope'), null);
  assert.equal(L.parseFriend('https://example.com'), null);
});

test('the code rules are the same as friendscrypto.js (no drift between the two copies)', async () => {
  const C = await loadModule('services/friendscrypto.js');
  for (const t of ['abcde-fghjk', 'oiL0123456', 'ABCDEFGHIU', 'short', '0123456789', ' zzzzz zzzzz ', '']) assert.equal(L.normalizeCode(t), C.normalizeCode(t), t);
  assert.equal(L.CODE_ALPHABET, C.CODE_ALPHABET);
  assert.equal(L.CODE_LENGTH, C.CODE_LENGTH);
});

test('names are cleaned: control and invisible characters go, 32 characters at most, blank is nothing', () => {
  assert.equal(L.clean('  Ana‮\n  '), 'Ana');
  assert.equal(L.clean('x'.repeat(100)).length, 32);
  assert.equal(L.clean('   '), null);
  assert.equal(L.clean(null), null);
  assert.equal(L.clean('Zoë 🙂'), 'Zoë 🙂');
  assert.equal(L.clean('a​b'), 'ab', 'zero-width characters are dropped');
});

test('request → accept → messages', () => {
  const alice = person(1), v = L.newVault();
  const r = L.receiveRequest(v, request(alice), alice.fp);
  assert.equal(r.kind, 'added'); assert.equal(r.record.status, 'incoming');
  assert.equal(L.receiveMessage(v, alice.box, 'm0', 'too early', null), null, 'no messages before both sides agree');
  assert.equal(L.receiveRequest(v, request(alice), alice.fp).kind, 'ignored', 'a repeated request is not shown twice');
  const f = L.accept(v, alice.box, 'myhash');
  assert.equal(f.status, 'active'); assert.equal(f.sendToken, 'tok'); assert.equal(f.myTokenHash, 'myhash'); assert.equal(f.pendingToken, null);
  const m = L.receiveMessage(v, alice.box, 'm1', 'hello', 1_790_000_000_000);
  assert.equal(m.text, 'hello'); assert.equal(m.state, 'delivered'); assert.equal(L.record(v, alice.box).unread, 1);
  assert.equal(L.receiveMessage(v, alice.box, 'm1', 'hello', null), null, 'the same id twice is dropped');
  assert.equal(L.receiveMessage(v, 'stranger', 'm2', 'hi', null), null);
  assert.equal(L.receiveMessage(v, alice.box, 'm3', 'x'.repeat(2001), null), null, 'more than 2000 characters is refused');
  assert.ok(L.receiveMessage(v, alice.box, 'm4', 'x'.repeat(2000), null), 'exactly 2000 is fine');
  assert.equal(L.receiveMessage(v, alice.box, 'm5', '', null), null);
  assert.equal(L.receiveMessage(v, alice.box, '', 'text', null), null);
  assert.equal(L.totalUnread(v), 2);
  L.markRead(v, alice.box); assert.equal(L.record(v, alice.box).unread, 0);
});

test('2000 characters are counted as people count them, as the Mac does', () => {
  const v = L.newVault(), a = person(1);
  L.receiveRequest(v, request(a), a.fp); L.accept(v, a.box, 'h');
  assert.ok(L.receiveMessage(v, a.box, 'e1', '👨‍👩‍👧'.repeat(2000), null), 'a family emoji is one character');
  assert.equal(L.receiveMessage(v, a.box, 'e2', '👨‍👩‍👧'.repeat(2001), null), null);
});

test('a message dated in the future is shown as now', () => {
  const v = L.newVault(), a = person(1);
  L.receiveRequest(v, request(a), a.fp); L.accept(v, a.box, 'h');
  assert.equal(L.receiveMessage(v, a.box, 'f1', 'hi', 9_999_999_999_999, 5000).date, 5000);
});

test('an outgoing request becomes active only on an acceptance with the keys I pinned', () => {
  const bob = person(2), other = person(3), v = L.newVault();
  L.addOutgoing(v, { box: bob.box, sign: bob.sign, dh: bob.dh, fp: bob.fp, myTokenHash: 'h' });
  assert.equal(L.receiveMessage(v, bob.box, 'x', 'hi', null), null, 'not friends yet');
  assert.equal(L.receiveAcceptance(v, { t: 'acc', box: bob.box, sign: other.sign, dh: bob.dh, token: 't' }), null, 'keys that differ from the pinned ones are refused');
  assert.equal(L.receiveAcceptance(v, { t: 'acc', box: 'unknown', sign: bob.sign, dh: bob.dh, token: 't' }), null);
  const r = L.receiveAcceptance(v, { t: 'acc', box: bob.box, sign: bob.sign, dh: bob.dh, token: 't', nick: 'Bobby' });
  assert.equal(r.status, 'active'); assert.equal(r.sendToken, 't'); assert.equal(r.nick, 'Bobby');
  assert.ok(L.receiveMessage(v, bob.box, 'y', 'hi', null));
  assert.equal(L.receiveAcceptance(v, { t: 'acc', box: bob.box, sign: bob.sign, dh: bob.dh, token: 'again' }), null, 'only while still waiting');
});

test('two requests at once make friends', () => {
  const bob = person(2), v = L.newVault();
  L.addOutgoing(v, { box: bob.box, sign: bob.sign, dh: bob.dh, fp: bob.fp, myTokenHash: 'h' });
  const out = L.receiveRequest(v, request(bob, { token: 'theirs' }), bob.fp);
  assert.equal(out.kind, 'mutual'); assert.equal(out.record.status, 'active'); assert.equal(out.record.sendToken, 'theirs');
});

test('blocked people are ignored; the same address with other keys is never accepted over a friend', () => {
  const alice = person(1), carol = person(3), v = L.newVault();
  L.receiveRequest(v, request(alice), alice.fp);
  L.block(v, alice.box);
  assert.equal(L.record(v, alice.box), null); assert.deepEqual(v.blocked, [alice.fp]);
  assert.equal(L.receiveRequest(v, request(alice), alice.fp).kind, 'ignored', 'a blocked person is dropped silently');
  L.receiveRequest(v, request(carol), carol.fp);
  assert.equal(L.receiveRequest(v, request(carol, { sign: key(77) }), 'someotherfp').kind, 'ignored');
  assert.equal(L.receiveRequest(v, request(carol, { dh: key(78) }), 'someotherfp').kind, 'ignored');
  L.accept(v, carol.box, 'h');
  assert.equal(L.receiveRequest(v, request(carol, { sign: key(77) }), 'someotherfp').kind, 'ignored', 'also once they are friends');
  assert.equal(L.record(v, carol.box).sign, carol.sign);
  L.remove(v, carol.box); assert.equal(L.record(v, carol.box), null);
  L.unblockAll(v); assert.deepEqual(v.blocked, []);
});

test('malformed requests are ignored', () => {
  const a = person(1), v = L.newVault();
  for (const bad of [{}, request(a, { token: undefined }), request(a, { box: '' }), request(a, { sign: 'short' }), request(a, { dh: 5 }), null]) {
    assert.equal(L.receiveRequest(v, bad, a.fp).kind, 'ignored');
  }
  assert.equal(v.friends.length, 0);
});

test('blocking deletes the conversation and removes the person', () => {
  const a = person(1), v = L.newVault();
  L.receiveRequest(v, request(a), a.fp); L.accept(v, a.box, 'h');
  L.receiveMessage(v, a.box, '1', 'hi', null);
  L.block(v, a.box);
  assert.equal(v.friends.length, 0); assert.equal(v.messages[a.box], undefined);
});

test('message states only move forward', () => {
  const v = L.newVault();
  L.addMine(v, 'b', '1', 'x');
  L.setState(v, 'b', '1', 'sent'); L.setState(v, 'b', '1', 'read'); L.setState(v, 'b', '1', 'delivered');
  assert.equal(v.messages.b[0].state, 'read');
  L.setState(v, 'b', '1', 'failed');
  assert.equal(v.messages.b[0].state, 'read', 'a delivered message can\'t become failed');
  L.addMine(v, 'b', '2', 'y'); L.setState(v, 'b', '2', 'failed');
  assert.equal(v.messages.b[1].state, 'failed');
  assert.ok(L.retryState(v, 'b', '2')); assert.equal(v.messages.b[1].state, 'sending');
  L.setState(v, 'b', '2', 'sent'); assert.equal(v.messages.b[1].state, 'sent');
  assert.equal(L.setState(v, 'b', 'nope', 'sent'), false);
});

test('only my own messages take a receipt', () => {
  const v = L.newVault(), a = person(1);
  L.receiveRequest(v, request(a), a.fp); L.accept(v, a.box, 'h'); L.receiveMessage(v, a.box, 'theirs', 'hi', null);
  assert.equal(L.setState(v, a.box, 'theirs', 'read'), false);
});

test('names: nickname beats their name beats the key-fingerprint fallback', () => {
  const a = person(1), v = L.newVault();
  L.receiveRequest(v, request(a, { nick: '' }), 'ab12cdef');
  const f = L.record(v, a.box);
  assert.equal(L.displayName(f), 'Friend AB12');
  f.nick = 'Ali'; assert.equal(L.displayName(f), 'Ali');
  L.setAlias(v, a.box, '  Mum  '); assert.equal(L.displayName(f), 'Mum');
  L.setAlias(v, a.box, '   '); assert.equal(L.displayName(f), 'Ali');
});

test('the list helpers and the seen-id limit', () => {
  const v = L.newVault(), a = person(1), b = person(2), c = person(3);
  L.receiveRequest(v, request(a), a.fp);
  L.addOutgoing(v, { box: b.box, sign: b.sign, dh: b.dh, fp: b.fp, myTokenHash: 'h' });
  L.receiveRequest(v, request(c), c.fp); L.accept(v, c.box, 'h');
  assert.deepEqual([L.incoming(v).length, L.pending(v).length, L.active(v).length], [1, 1, 1]);
  assert.equal(L.totalUnread(v), 1, 'a waiting request counts as one');
  for (let i = 0; i < 600; i++) L.receiveMessage(v, c.box, `id${i}`, 'x', null);
  assert.equal(v.seen.length, 500);
  assert.equal(L.receiveMessage(v, c.box, 'id599', 'x', null), null);
});

test('the vault survives JSON, and a damaged one becomes an empty one', () => {
  const v = L.newVault(), a = person(1);
  L.receiveRequest(v, request(a), a.fp); L.accept(v, a.box, 'h'); L.receiveMessage(v, a.box, '1', 'hi', 5);
  assert.deepEqual(L.normalizeVault(JSON.parse(JSON.stringify(v))), v);
  assert.deepEqual(L.normalizeVault(null), L.newVault());
  assert.deepEqual(L.normalizeVault({ friends: 5, messages: [], blocked: 'x' }).friends, []);
});

test('the safety number is shown as three rows of four groups', () => {
  const rows = L.safetyRows('15339 92774 60316 35367 16261 21826 25653 63881 36886 95197 57797 31678');
  assert.deepEqual(rows, ['15339  92774  60316  35367', '16261  21826  25653  63881', '36886  95197  57797  31678']);
});

test('a blocked person can be unblocked on their own, and then reaches you again', () => {
  const alice = person(1), bob = person(2), v = L.newVault();
  L.receiveRequest(v, request(alice), alice.fp); L.receiveRequest(v, request(bob), bob.fp);
  L.setAlias(v, alice.box, 'Alice from school');
  L.block(v, alice.box); L.block(v, bob.box);
  assert.deepEqual(L.blockedPeople(v).map((b) => b.name), ['Alice from school', L.blockedPeople(v)[1].name]);
  assert.ok(L.blockedPeople(v)[1].name.startsWith('Friend') || L.blockedPeople(v)[1].name.length > 0);
  L.unblock(v, alice.fp);
  assert.deepEqual(v.blocked, [bob.fp], 'only Alice is unblocked');
  assert.equal(v.blockedNames[alice.fp], undefined);
  assert.equal(L.receiveRequest(v, request(bob), bob.fp).kind, 'ignored', 'Bob is still blocked');
  assert.notEqual(L.receiveRequest(v, request(alice), alice.fp).kind, 'ignored', 'Alice can send a request again');
  L.unblock(v, 'not-in-the-list'); assert.deepEqual(v.blocked, [bob.fp], 'an unknown fingerprint changes nothing');
  L.unblockAll(v); assert.deepEqual(v.blocked, []); assert.deepEqual(v.blockedNames, {});
});

test('a vault saved before the blocked list had names still loads, and shows a short code', () => {
  const v = L.normalizeVault({ friends: [], blocked: ['abcd1234'] });
  assert.deepEqual(v.blockedNames, {});
  assert.equal(L.blockedPeople(v)[0].name, 'Someone you blocked (ABCD)');
  const w = L.normalizeVault({ blocked: ['f1'], blockedNames: { f1: 'Sam', other: 'Not blocked', f2: 5 } });
  assert.deepEqual(w.blockedNames, { f1: 'Sam' }, 'only names of blocked people, only strings');
});
