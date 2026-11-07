// Messenger → Friends: "Clear chat" on Windows, the same rules as the Mac's FriendsTests (testClear…) and docs/FRIENDS_PROTOCOL.md
// "Clear chat". Pure rules only: two vaults stand in for two people and a list stands in for the relay's queue.
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadModule } from './load.mjs';

const L = await loadModule('services/friendslogic.js');
const C = await loadModule('services/friendscrypto.js');
const key = (n) => Buffer.alloc(32, n).toString('base64url');
const person = (n) => ({ box: `box${n}`, sign: key(n), dh: key(n + 100), fp: `fp${n}` });

function vaultWith(...ns) {
  const v = L.newVault();
  for (const n of ns) { const p = person(n); L.addOutgoing(v, { ...p, myTokenHash: 'h' }); L.receiveRequest(v, { box: p.box, sign: p.sign, dh: p.dh, token: 't', nick: `P${n}` }, p.fp); }
  return v;
}
const texts = (v, k) => (v.messages[k] || []).filter((m) => !m.kind).map((m) => m.text);
const clr = (epoch, extra = {}) => ({ t: 'clr', from: 'x', ts: Date.now(), ce: epoch, ...extra });

test('clearing locally wipes the history, counts and files, keeps the friend, and leaves no text behind', () => {
  const v = vaultWith(1);
  L.receiveMessage(v, 'box1', 'm1', 'secret words', undefined);
  L.addMine(v, 'box1', 'm2', 'my private words');
  L.receiveFile(v, 'box1', null, 'f1', 'photo.png', 10);
  L.addMineFile(v, 'box1', 'f2', { name: 'mine.png', size: 5 });
  assert.equal(L.record(v, 'box1').unread, 2);
  const out = L.clearChat(v, 'box1');
  assert.deepEqual(new Set(out.files), new Set(['f1', 'f2']), 'the caller deletes these saved files');
  assert.equal(out.epoch, 1);
  assert.deepEqual(v.messages.box1.map((m) => m.text), ['You cleared this chat']);
  assert.equal(L.record(v, 'box1').unread, 0);
  assert.equal(L.record(v, 'box1').status, 'active', 'clearing never unfriends');
  assert.equal(L.totalUnread(v), 0);
  const json = JSON.stringify(v);
  for (const gone of ['secret words', 'private words', 'photo.png', 'mine.png']) assert.ok(!json.includes(gone), `${gone} is nowhere in the vault`);
  assert.equal(L.clearChat(v, 'g:nothing'), null);
  assert.equal(L.clearChat(v, 'box99'), null, 'only an existing, active chat can be cleared');
});

test('a clear arriving while online wipes the old chat and leaves one line; the same clear twice does nothing more', () => {
  const v = vaultWith(1);
  L.receiveMessage(v, 'box1', 'm1', 'old', undefined, Date.now(), 0);
  L.addMine(v, 'box1', 'm2', 'old mine');
  L.receiveFile(v, 'box1', null, 'f1', 'x.png', 10);
  const out = L.receiveClear(v, 'box1', clr(1));
  assert.deepEqual(out.files, ['f1']);
  assert.deepEqual(v.messages.box1.map((m) => m.text), ['P1 cleared this chat']);
  assert.equal(L.record(v, 'box1').unread, 0);
  assert.equal(L.receiveClear(v, 'box1', clr(1)), null);
  assert.equal(v.messages.box1.length, 1);
});

test('a clear that waited offline on the relay: what was sent before goes, what came after stays', () => {
  const v = vaultWith(1);
  // while I was away the friend sent two messages, cleared, then sent one more (epoch 1); the relay hands them over in order
  L.receiveMessage(v, 'box1', 'm1', 'before 1', undefined, Date.now(), 0);
  L.receiveMessage(v, 'box1', 'm2', 'before 2', undefined, Date.now(), 0);
  assert.ok(L.receiveClear(v, 'box1', clr(1)));
  assert.ok(L.receiveMessage(v, 'box1', 'm3', 'after', undefined, Date.now(), 1));
  assert.deepEqual(texts(v, 'box1'), ['after']);
  assert.equal(L.record(v, 'box1').unread, 1);
});

test('a message that overtakes the clear survives it, and an old one cannot come back afterwards', () => {
  const v = vaultWith(1);
  L.receiveMessage(v, 'box1', 'old', 'old', undefined, Date.now(), 0);
  assert.ok(L.receiveMessage(v, 'box1', 'new', 'new', undefined, Date.now(), 1), 'sent after the clear, arrives before it');
  L.receiveClear(v, 'box1', clr(1));
  assert.deepEqual(texts(v, 'box1'), ['new']);
  // now I clear too, then late copies arrive: a relay retry, a message the friend sent before they heard
  const mine = L.clearChat(v, 'box1');
  assert.equal(mine.epoch, 2, 'above everything already seen');
  assert.equal(L.receiveMessage(v, 'box1', 'old', 'old', undefined, Date.now(), 0), null);
  assert.equal(L.receiveMessage(v, 'box1', 'crossing', 'sent before they heard', undefined, Date.now(), 1), null);
  assert.equal(L.receiveFile(v, 'box1', null, 'f9', 'x.png', 4, Date.now(), 0), null);
  assert.ok(L.receiveMessage(v, 'box1', 'fresh', 'after', undefined, Date.now(), 2));
  L.addMine(v, 'box1', 'mine2', 'new');
  assert.equal(v.messages.box1.at(-1).ce, 2, 'what I send now carries the new epoch');
  assert.equal(L.receiveClear(v, 'box1', clr(1)), null, 'an older clear arriving late does nothing');
});

test('two people clearing at once end up clean', () => {
  const v = vaultWith(1);
  L.addMine(v, 'box1', 'm1', 'x');
  const mine = L.clearChat(v, 'box1');
  assert.equal(L.receiveClear(v, 'box1', clr(mine.epoch)), null, 'their clear has the same epoch: already applied');
  assert.equal(v.messages.box1.length, 1);
  assert.ok(L.receiveClear(v, 'box1', clr(2)));
  assert.equal(L.epochOf(v, 'box1'), 2);
});

test('clears are checked like everything else', () => {
  const v = vaultWith(1, 2);
  L.receiveMessage(v, 'box1', 'm1', 'keep me', undefined);
  for (const bad of [clr(0), clr(-4), clr(1.5), clr(L.MAX_EPOCH + 1), clr('1'), { ...clr(1), t: 'msg' }, { ...clr(1), ce: undefined }, clr(1, { g: 'nope' }), clr(1, { g: '../x' })]) {
    assert.equal(L.receiveClear(v, 'box1', bad), null);
  }
  assert.equal(L.receiveClear(v, 'stranger', clr(1)), null, 'only a friend can clear');
  assert.equal(L.receiveClear(v, 'box1', null), null);
  assert.deepEqual(texts(v, 'box1'), ['keep me'], 'nothing was wiped by any of those');
  L.receiveMessage(v, 'box2', 'b1', 'b', undefined);
  assert.ok(L.receiveClear(v, 'box1', clr(1)));
  assert.deepEqual(texts(v, 'box2'), ['b'], 'a friend can only clear their own chat with me');
});

test('clearing a group wipes it for everyone, keeps the group, and only members may do it', () => {
  const v = vaultWith(1, 2, 3);
  const g = L.createGroup(v, 'G', ['box1', 'box2'], 'GRP1');
  const key = L.groupKey(g.id);
  L.receiveGroupMessage(v, 'box1', 'GRP1', 'g1', 'hello', undefined);
  L.addMineToGroup(v, key, 'g2', 'mine');
  L.receiveFile(v, 'box2', 'GRP1', 'gf', 'x.png', 3);
  assert.equal(L.receiveClear(v, 'box3', clr(1, { g: 'GRP1' })), null, 'a friend who is not in the group cannot');
  const out = L.receiveClear(v, 'box2', clr(1, { g: 'GRP1' }));
  assert.deepEqual(out.files, ['gf']);
  assert.ok(L.group(v, key), 'the group stays');
  assert.equal(L.group(v, key).unread, 0);
  assert.equal(v.messages[key].length, 1);
  assert.equal(L.receiveGroupMessage(v, 'box1', 'GRP1', 'g3', 'late old', undefined, Date.now(), 0), null);
  assert.ok(L.receiveGroupMessage(v, 'box1', 'GRP1', 'g4', 'new', undefined, Date.now(), 1));
  const mine = L.clearChat(v, key);
  assert.equal(mine.epoch, 2);
  assert.equal(v.messages[key].length, 1);
  assert.deepEqual(L.clearBody('me', key, 2, 5), { t: 'clr', from: 'me', ts: 5, ce: 2, g: 'GRP1' });
  assert.deepEqual(L.clearBody('me', 'box1', 1, 5), { t: 'clr', from: 'me', ts: 5, ce: 1 });
  assert.ok(!L.leaveGroup(v, key).length && !v.clears[key], 'leaving forgets the clear bookkeeping');
});

test('a half-received file from before the clear is dropped, one from after it is kept', () => {
  const v = vaultWith(1);
  const partials = new Map();
  const piece = (id, fi, ce) => ({ id, fn: 2, fi, fd: Buffer.from('abc').toString('base64url'), fname: 'a.bin', ts: Date.now(), ce });
  assert.equal(L.receiveChunk(v, partials, 'box1', piece('F1', 0, 0)), null);
  assert.equal(partials.size, 1);
  L.clearChat(v, 'box1');
  // The caller drops the partials of the chat (friends.js does); and even if a late piece arrives, it is refused.
  assert.equal(L.receiveChunk(v, partials, 'box1', piece('F1', 1, 0)), null);
  assert.equal(L.receiveChunk(v, partials, 'box1', piece('F2', 0, 1)), null);
  const done = L.receiveChunk(v, partials, 'box1', piece('F2', 1, 1));
  assert.equal(done.id, 'F2'); assert.equal(done.ce, 1);
  assert.ok(L.receiveFile(v, 'box1', null, done.id, done.name, done.bytes.length, Date.now(), done.ce, done.ts));
  const bodies = L.chunkBodies('me', 'F3', 'a.bin', new Uint8Array(10), null, 1, (b) => Buffer.from(b).toString('base64url'), 3);
  assert.equal(bodies[0].ce, 3);
});

test('messages from an app that knows nothing about clearing are judged by the time of the clear', () => {
  const v = vaultWith(1);
  const clearedAt = 1_800_000_000_000;
  L.clearChat(v, 'box1', clearedAt);
  assert.equal(L.receiveMessage(v, 'box1', 'o1', 'sent before', clearedAt - 5000, clearedAt + 60_000), null, 'no epoch, older than the clear');
  assert.ok(L.receiveMessage(v, 'box1', 'o2', 'sent after', clearedAt + 5000, clearedAt + 60_000));
  // and when the clear arrives from someone else, their old-version messages stored without an epoch go too
  const w = vaultWith(1);
  L.receiveMessage(w, 'box1', 'a', 'legacy before', clearedAt - 9000, clearedAt - 1000);
  L.receiveMessage(w, 'box1', 'b', 'legacy after', clearedAt + 9000, clearedAt + 9000);
  L.receiveClear(w, 'box1', clr(1, { ts: clearedAt }), clearedAt + 10_000);
  assert.deepEqual(texts(w, 'box1'), ['legacy after']);
});

test('an app that does not know the clear type ignores it safely (it falls through to "ignore")', () => {
  // What Windows 2.2.42 and earlier, and the Mac before it, handle. Anything else hits the default branch of their switch.
  const known = ['req', 'acc', 'msg', 'rcpt', 'typing', 'gone', 'grp', 'gmsg', 'gleave', 'chunk', 'game', 'play'];
  assert.ok(!known.includes(L.clearBody('me', 'box1', 1, 5).t));
  // The old app's dispatch, reduced to what matters here: it acts only on types it knows and does nothing for the rest.
  const oldApp = (vault, body) => {
    if (body.t === 'msg') L.receiveMessage(vault, body.from, body.id, body.text, body.ts);
    else if (!known.includes(body.t)) return 'ignored';
    return 'handled';
  };
  const v = vaultWith(1);
  L.receiveMessage(v, 'box1', 'm1', 'still here', undefined);
  const before = JSON.stringify(v);
  assert.equal(oldApp(v, { ...L.clearBody('box1', 'box1', 1, Date.now()) }), 'ignored');
  assert.equal(JSON.stringify(v), before, 'the old app keeps its history and carries on, which is why the docs say both sides need the new version');
  // Those apps also read a message that carries the epoch as the plain message it is (the extra key is just not looked at).
  assert.equal(oldApp(v, { t: 'msg', from: 'box1', id: 'i', text: 'hi', ts: 1, ce: 2 }), 'handled');
  assert.deepEqual(texts(v, 'box1'), ['still here', 'hi']);
});

test('this app keeps working with a body from a future version that adds fields', () => {
  const v = vaultWith(1);
  L.receiveMessage(v, 'box1', 'm1', 'x', undefined);
  assert.ok(L.receiveClear(v, 'box1', { ...clr(1), v: 2, extra: { nested: true }, cv: 9 }));
});

test('a vault saved before clearing loads, and a clear and the clear still waiting to be sent survive a restart', () => {
  const v = vaultWith(1);
  L.receiveMessage(v, 'box1', 'm1', 'x', undefined);
  const old = JSON.parse(JSON.stringify(v)); delete old.clears; delete old.pendingClears;
  const loaded = L.normalizeVault(old);
  assert.equal(loaded.friends.length, 2 - 1); assert.deepEqual(loaded.clears, {}); assert.deepEqual(loaded.pendingClears, {});
  const out = L.clearChat(v, 'box1');
  L.queueClear(v, 'box1', out.epoch, out.at, ['box1']);
  const back = L.normalizeVault(JSON.parse(JSON.stringify(v)));
  assert.equal(L.epochOf(back, 'box1'), 1);
  assert.deepEqual(back.pendingClears.box1.to, ['box1']);
  assert.equal(L.receiveMessage(back, 'box1', 'late', 'old', undefined, Date.now(), 0), null);
  L.clearDelivered(back, 'box1', out.epoch, 'box1');
  assert.equal(back.pendingClears.box1, undefined, 'once everyone has it nothing is left to send');
  assert.deepEqual(L.normalizeVault({ friends: [], clears: { a: { epoch: 'x', at: 1 }, b: 7 }, pendingClears: { c: { epoch: 1 } } }).clears, {}, 'junk is ignored');
});

test('pending clears merge, and the newer one wins', () => {
  const v = L.newVault();
  L.queueClear(v, 'k', 1, 10, ['a', 'b']); L.queueClear(v, 'k', 1, 10, ['b', 'c']);
  assert.deepEqual(v.pendingClears.k.to, ['a', 'b', 'c']);
  L.queueClear(v, 'k', 2, 20, ['a']);
  assert.deepEqual(v.pendingClears.k, { epoch: 2, at: 20, to: ['a'] });
  L.queueClear(v, 'k', 1, 10, ['z']);
  assert.equal(v.pendingClears.k.epoch, 2, 'an older one never overrides');
  L.clearDelivered(v, 'k', 1, 'a');
  assert.deepEqual(v.pendingClears.k.to, ['a']);
});

test('removing a friend forgets their clear bookkeeping', () => {
  const v = vaultWith(1);
  const out = L.clearChat(v, 'box1'); L.queueClear(v, 'box1', out.epoch, out.at, ['box1']);
  L.remove(v, 'box1');
  assert.deepEqual(v.clears, {}); assert.deepEqual(v.pendingClears, {});
});

test('relay tags are opaque and differ per friend link and per chat (and match the Mac for the same inputs)', async () => {
  const t = await L.chatTag(C.sha256hex, 'tokenA', 'chat1');
  assert.match(t, /^[0-9a-f]{32}$/);
  assert.equal(t, await L.chatTag(C.sha256hex, 'tokenA', 'chat1'));
  assert.notEqual(t, await L.chatTag(C.sha256hex, 'tokenB', 'chat1'), "two mailboxes can't tell a group's messages belong together");
  assert.notEqual(t, await L.chatTag(C.sha256hex, 'tokenA', 'chat2'));
  assert.ok(!t.includes('chat1'));
});
