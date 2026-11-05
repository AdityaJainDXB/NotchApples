// Messenger → Friends: files and group chats on Windows, mirrored from the Mac's FriendsBook (FriendsLogic.swift) and
// docs/FRIENDS_PROTOCOL.md "Files and groups". Pure rules only (no network, no disk); the sealed size check uses friendscrypto.js.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve, dirname } from 'node:path';
import { loadModule } from './load.mjs';

const L = await loadModule('services/friendslogic.js');
const C = await loadModule('services/friendscrypto.js');
const key = (n) => Buffer.alloc(32, n).toString('base64url');
const person = (n) => ({ box: `box${n}`, sign: key(n), dh: key(n + 100), fp: `fp${n}` });
const ME = 'mybox';
const b64u = (bytes) => Buffer.from(bytes).toString('base64url');

/** A vault where the given people are active friends. */
function vaultWith(...ns) {
  const v = L.newVault();
  for (const n of ns) {
    const p = person(n);
    L.addOutgoing(v, { ...p, myTokenHash: 'h' });
    L.receiveRequest(v, { box: p.box, sign: p.sign, dh: p.dh, token: 't', nick: `P${n}` }, p.fp);
  }
  return v;
}
const invite = (from, g, members, extra = {}) => ({ t: 'grp', from, g, gname: 'Trip', gm: members, ts: 1, ...extra });

// ---- limits and names

test('the limits are the Mac numbers', () => {
  assert.equal(L.CHUNK_SIZE, 8000);
  assert.equal(L.MAX_CHUNKS, 250);
  assert.equal(L.MAX_FILE_BYTES, 2000000);
  assert.equal(L.MAX_FILE_TEXT, '2 MB');
  assert.equal(L.PIECE_GAP_MS, 220);
  assert.equal(L.RATE_WAIT_MS, 8000);
  assert.equal(L.RATE_RETRIES, 8);
  assert.equal(L.MAX_GROUP_MEMBERS, 20);
  assert.equal(L.MAX_GROUPS, 30);
  assert.equal(L.PARTIAL_TTL_MS, 600000);
  assert.equal(L.MAX_PARTIALS, 8);
});

test('plain ids: letters, digits and hyphens, 64 at most (so they are safe in a stored file name)', () => {
  assert.ok(L.isPlainID('3F2504E0-4F89-11D3-9A0C-0305E82C3301'));
  for (const bad of ['', 'a'.repeat(65), 'a/b', '../x', 'a b', 'é', 'a\n', null, 5]) assert.ok(!L.isPlainID(bad), String(bad));
  assert.equal(L.groupKey('X'), 'g:X');
  assert.ok(L.isGroupKey('g:X') && !L.isGroupKey('0123abcd'));
});

test('file names are reduced to the last path component, one line, 80 characters', () => {
  assert.equal(L.cleanFileName('C:\\Users\\me\\Pictures\\cat.png'), 'cat.png');
  assert.equal(L.cleanFileName('../../etc/passwd'), 'passwd');
  assert.equal(L.cleanFileName('dir/'), 'dir');
  assert.equal(L.cleanFileName('  a​b\u202etxt\n '), 'abtxt');
  assert.equal(L.cleanFileName('x'.repeat(200)).length, 80);
  for (const bad of ['', '.', '..', '/', '\\\\', '   ', null, undefined, 5]) assert.equal(L.cleanFileName(bad), null, String(bad));
});

// ---- chunks

const chunkBody = (over = {}) => ({ t: 'chunk', from: 'box1', id: 'F1', fname: 'a.txt', fn: 1, fi: 0, fd: b64u('hello'), ...over });

test('a one-chunk file comes back whole', () => {
  const v = vaultWith(1), parts = new Map();
  const done = L.receiveChunk(v, parts, 'box1', chunkBody());
  assert.equal(done.id, 'F1'); assert.equal(done.name, 'a.txt'); assert.equal(done.group, null);
  assert.equal(Buffer.from(done.bytes).toString(), 'hello');
  assert.equal(parts.size, 0);
});

test('chunks in any order are put back together; a message is made only when the file is complete', () => {
  const v = vaultWith(1), parts = new Map();
  const data = Buffer.alloc(20000, 7); data[8000] = 1; data[19999] = 9;
  const bodies = L.chunkBodies('box1', 'F2', 'big.bin', data, null, 5, b64u);
  assert.equal(bodies.length, 3);
  assert.equal(L.receiveChunk(v, parts, 'box1', bodies[2]), null);
  assert.equal(L.receiveChunk(v, parts, 'box1', bodies[0]), null);
  assert.equal(L.receiveChunk(v, parts, 'box1', bodies[0]), null, 'a repeated chunk changes nothing');
  const done = L.receiveChunk(v, parts, 'box1', bodies[1]);
  assert.deepEqual(Buffer.from(done.bytes), data);
  const m = L.receiveFile(v, 'box1', done.group, done.id, done.name, done.bytes.length, 100);
  assert.deepEqual(m.file, { name: 'big.bin', size: 20000 });
  assert.equal(m.text, ''); assert.equal(v.friends[0].unread, 1);
  assert.equal(L.messagesOf(v, 'box1').length, 1);
});

test('the Swift field names are used on the wire: t, from, id, ts, g, fname, fn, fi, fd', () => {
  const [b] = L.chunkBodies('box1', 'F3', 'a.txt', Buffer.from('x'), 'G1', 9, b64u);
  assert.deepEqual(Object.keys(b).sort(), ['fd', 'fi', 'fn', 'fname', 'from', 'g', 'id', 't', 'ts']);
  assert.deepEqual(Object.keys(L.chunkBodies('box1', 'F3', 'a.txt', Buffer.from('x'), null, 9, b64u)[0]).sort(), ['fd', 'fi', 'fn', 'fname', 'from', 'id', 't', 'ts']);
  const g = L.groupInviteBody('mybox', { id: 'G1', name: 'Trip', members: ['b2', 'b1'] }, 9);
  assert.deepEqual(g, { t: 'grp', from: 'mybox', g: 'G1', gname: 'Trip', gm: ['b1', 'b2', 'mybox'], ts: 9 });
  assert.equal(L.chunkBodies('b', 'i', 'n', Buffer.alloc(2000000), null, 1, b64u).length, 250);
});

test('bad chunks are dropped', () => {
  const v = vaultWith(1), parts = new Map();
  for (const over of [{ id: '../x' }, { id: '' }, { fn: 0 }, { fn: 251 }, { fn: 1.5 }, { fi: -1 }, { fi: 1 }, { fi: 'a' }, { fd: 5 }, { fd: 'a'.repeat(16001) },
    { fd: b64u(Buffer.alloc(8001)) }, { fd: 'a b!' }, { fname: '..' }, { fname: null }, { g: 'nogroup' }, { g: 5 }]) {
    assert.equal(L.receiveChunk(v, parts, 'box1', chunkBody(over)), null, JSON.stringify(over));
  }
  assert.equal(parts.size, 0, 'nothing was kept');
  assert.equal(L.receiveChunk(v, parts, 'stranger', chunkBody()), null, 'not a friend');
  assert.equal(L.receiveChunk(L.newVault(), parts, 'box1', chunkBody()), null);
  v.seen.push('F1');
  assert.equal(L.receiveChunk(v, parts, 'box1', chunkBody()), null, 'already received');
});

test('a chunk count that changes mid-file is ignored', () => {
  const v = vaultWith(1), parts = new Map();
  L.receiveChunk(v, parts, 'box1', chunkBody({ fn: 2, fi: 0 }));
  assert.equal(L.receiveChunk(v, parts, 'box1', chunkBody({ fn: 3, fi: 1 })), null);
  assert.equal(parts.get('box1|F1').chunks.size, 1);
});

test('partial files: expire after 10 minutes, and at most 8 at once', () => {
  const v = vaultWith(1), parts = new Map();
  for (let i = 0; i < 8; i++) L.receiveChunk(v, parts, 'box1', chunkBody({ id: `P${i}`, fn: 2 }), 1000);
  assert.equal(parts.size, 8);
  assert.equal(L.receiveChunk(v, parts, 'box1', chunkBody({ id: 'P8', fn: 2 }), 1000), null);
  assert.equal(parts.size, 8, 'the ninth is refused');
  L.receiveChunk(v, parts, 'box1', chunkBody({ id: 'P8', fn: 2 }), 1000 + L.PARTIAL_TTL_MS - 1);
  assert.equal(parts.size, 8, 'just under 10 minutes: still kept, still full');
  L.receiveChunk(v, parts, 'box1', chunkBody({ id: 'P9', fn: 2 }), 1000 + L.PARTIAL_TTL_MS);
  assert.equal(parts.size, 1, 'the stalled ones are dropped, the new one is kept');
  assert.ok(parts.has('box1|P9'));
});

test('files are never taken from someone who is not an active friend, and a seen id is dropped', () => {
  const v = vaultWith(1);
  assert.equal(L.receiveFile(v, 'nobody', null, 'F9', 'a.txt', 5), null);
  assert.equal(L.receiveFile(v, 'box1', null, 'F9', 'a.txt', 0), null);
  assert.equal(L.receiveFile(v, 'box1', null, 'F9', 'a.txt', 2000001), null);
  assert.equal(L.receiveFile(v, 'box1', null, 'F9', '..', 5), null);
  assert.equal(L.receiveFile(v, 'box1', null, 'bad/id', 'a.txt', 5), null);
  assert.ok(L.receiveFile(v, 'box1', null, 'F9', 'C:\\x\\a.txt', 2000000));
  assert.equal(L.messagesOf(v, 'box1')[0].file.name, 'a.txt');
  assert.equal(L.receiveFile(v, 'box1', null, 'F9', 'a.txt', 5), null, 'same id twice');
});

test('a sealed worst-case chunk stays under the relay blob limit (22000 characters, base64url only)', async () => {
  const limit = Number(/MAX_MSG_BLOB = (\d+)/.exec(readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), '../../server/room-relay/src/friends.js'), 'utf8'))[1]);
  assert.equal(limit, 22000);
  const a = await C.identityFromSeeds(new Uint8Array(32).fill(1), new Uint8Array(32).fill(2));
  const b = await C.identityFromSeeds(new Uint8Array(32).fill(3), new Uint8Array(32).fill(4));
  const to = { box: await C.boxOf('ABCDEFGHJK'), dh: b.dhPub };
  // Full 8,000 bytes of random data (base64 does not shrink), a 64-character id and group id, and an 80-character file name
  // made of characters JSON must escape, which is the largest the body can get.
  const data = crypto.getRandomValues(new Uint8Array(8000));
  const [body] = L.chunkBodies('f'.repeat(32), 'I'.repeat(64), '"'.repeat(80), data, 'G'.repeat(64), Date.now(), b64u);
  const blob = await C.seal(a, to, 'msg', { ...body, fn: 20, fi: 19 });
  assert.match(blob, /^[A-Za-z0-9_-]+$/);
  assert.ok(blob.length < limit, `${blob.length} must be under ${limit}`);
  assert.ok(blob.length < 16000 * 1.2, 'and well inside the ~16 KB the docs promise');
  // And it opens on the other side, with the bytes intact.
  const opened = await C.open(b, to.box, 'msg', blob);
  assert.ok(await C.sealedBy(a.signPub, to.box, 'msg', opened));
  assert.deepEqual(Buffer.from(C.unb64u(opened.body.fd)), Buffer.from(data));
  assert.equal(opened.body.fname, '"'.repeat(80));
});

// ---- groups

test('making a group: only active friends, 20 people at most (me included), sorted members, a name', () => {
  const v = vaultWith(1, 2, 3);
  const pend = person(9); L.addOutgoing(v, { ...pend, myTokenHash: 'h' });
  const g = L.createGroup(v, ' Trip\nHome ', ['box2', 'box1', 'box1', pend.box, 'stranger'], 'G1', 10);
  assert.deepEqual(g.members, ['box1', 'box2']);
  assert.equal(g.name, 'Trip Home'); assert.equal(g.creator, null); assert.equal(g.unread, 0);
  assert.equal(L.createGroup(v, '', ['box3'], 'G2').name, 'Group');
  assert.equal(L.createGroup(v, 'x', [], 'G3'), null);
  assert.equal(L.createGroup(v, 'x', ['stranger'], 'G3'), null);
  assert.equal(L.createGroup(v, 'x', ['box1'], 'bad id'), null);
  assert.equal(v.groups.length, 2);
  const big = vaultWith(...Array.from({ length: 21 }, (_, i) => i + 1));
  const boxes = big.friends.map((f) => f.box);
  assert.ok(L.createGroup(big, 'x', boxes.slice(0, 19), 'A'), '19 friends and me is 20');
  assert.equal(L.createGroup(big, 'x', boxes.slice(0, 20), 'B'), null, '20 friends and me is 21');
});

test('at most 30 groups', () => {
  const v = vaultWith(1);
  for (let i = 0; i < 30; i++) assert.ok(L.createGroup(v, 'g', ['box1'], `G${i}`));
  assert.equal(L.createGroup(v, 'g', ['box1'], 'G30'), null);
  assert.equal(L.receiveGroup(v, 'box1', invite('box1', 'Z', ['box1', ME]), ME), null);
});

test('an invite must come from an active friend, list me and the sender, and have 20 members at most', () => {
  const v = vaultWith(1, 2), pend = person(9); L.addOutgoing(v, { ...pend, myTokenHash: 'h' });
  assert.equal(L.receiveGroup(v, 'stranger', invite('stranger', 'G', ['stranger', ME]), ME), null);
  assert.equal(L.receiveGroup(v, pend.box, invite(pend.box, 'G', [pend.box, ME]), ME), null, 'not active yet');
  assert.equal(L.receiveGroup(v, 'box1', invite('box1', 'G', ['box1', 'box2']), ME), null, 'does not list me');
  assert.equal(L.receiveGroup(v, 'box1', invite('box1', 'G', ['box2', ME]), ME), null, 'does not list the sender');
  assert.equal(L.receiveGroup(v, 'box1', invite('box1', 'bad/id', ['box1', ME]), ME), null);
  assert.equal(L.receiveGroup(v, 'box1', invite('box1', 'G', ['box1', ME, '']), ME), null);
  assert.equal(L.receiveGroup(v, 'box1', invite('box1', 'G', ['box1', ME, 5]), ME), null);
  assert.equal(L.receiveGroup(v, 'box1', { ...invite('box1', 'G', ['box1', ME]), gm: 'box1' }, ME), null);
  const many = ['box1', ME, ...Array.from({ length: 19 }, (_, i) => `m${i}`)];
  assert.equal(many.length, 21);
  assert.equal(L.receiveGroup(v, 'box1', invite('box1', 'G', many), ME), null);
  const g = L.receiveGroup(v, 'box1', invite('box1', 'G', ['box2', ME, 'box1', 'box1'], { gname: '  Trip‮ ' }), ME, 50);
  assert.deepEqual(g.members, ['box1', 'box2'], 'not me, no duplicates');
  assert.equal(g.creator, 'box1'); assert.equal(g.name, 'Trip');
});

test('only whoever made the group can change it', () => {
  const v = vaultWith(1, 2);
  L.receiveGroup(v, 'box1', invite('box1', 'G', ['box1', 'box2', ME]), ME);
  assert.equal(L.receiveGroup(v, 'box2', invite('box2', 'G', ['box2', ME], { gname: 'Mine now' }), ME), null);
  assert.equal(L.group(v, 'g:G').name, 'Trip');
  const g = L.receiveGroup(v, 'box1', invite('box1', 'G', ['box1', ME], { gname: 'Renamed' }), ME);
  assert.equal(g.name, 'Renamed'); assert.deepEqual(g.members, ['box1']);
  assert.equal(v.groups.length, 1);
  // A group I made is never changed by someone else's invite with the same id.
  const mine = L.createGroup(v, 'Mine', ['box2'], 'H');
  assert.equal(L.receiveGroup(v, 'box2', invite('box2', 'H', ['box2', ME]), ME), null);
  assert.equal(mine.members.length, 1);
});

test('group messages: only from a member who is an active friend; duplicates dropped; no receipts, unread counts', () => {
  const v = vaultWith(1, 2, 3);
  L.receiveGroup(v, 'box1', invite('box1', 'G', ['box1', 'box2', ME]), ME);
  assert.equal(L.receiveGroupMessage(v, 'box3', 'G', 'm1', 'hi', 1), null, 'friend but not a member');
  assert.equal(L.receiveGroupMessage(v, 'box2', 'nope', 'm1', 'hi', 1), null, 'no such group');
  assert.equal(L.receiveGroupMessage(v, 'box2', 'G', 'bad/id', 'hi', 1), null);
  assert.equal(L.receiveGroupMessage(v, 'box2', 'G', 'm1', '', 1), null);
  assert.equal(L.receiveGroupMessage(v, 'box2', 'G', 'm1', 'x'.repeat(2001), 1), null);
  const m = L.receiveGroupMessage(v, 'box2', 'G', 'm1', 'hi', 5, 100);
  assert.deepEqual(m, { id: 'm1', mine: false, text: 'hi', date: 5, state: 'delivered', by: 'box2' });
  assert.equal(L.receiveGroupMessage(v, 'box2', 'G', 'm1', 'again', 5), null, 'same id');
  assert.equal(L.receiveGroupMessage(v, 'box1', 'G', 'm1', 'again', 5), null, 'same id from another member');
  assert.equal(L.receiveGroupMessage(v, 'box1', 'G', 'm2', 'future', 10 ** 15, 200).date, 200, 'a future time is clamped');
  assert.equal(L.group(v, 'g:G').unread, 2);
  assert.equal(L.totalUnread(v), 2, 'group unread counts on the badge');
  assert.equal(L.messagesOf(v, 'g:G').length, 2);
  assert.equal(L.messagesOf(v, 'box2').length, 0, 'not in the one-to-one chat');
  L.markGroupRead(v, 'g:G');
  assert.equal(L.totalUnread(v), 0);
  // A friend who was removed can no longer send into the group.
  L.remove(v, 'box2');
  assert.equal(L.receiveGroupMessage(v, 'box2', 'G', 'm3', 'hi', 1), null);
});

test('a group file needs a group I am in and a member sender; it lands in the group history', () => {
  const v = vaultWith(1, 3);
  L.receiveGroup(v, 'box1', invite('box1', 'G', ['box1', ME]), ME);
  assert.equal(L.receiveFile(v, 'box3', 'G', 'F1', 'a.txt', 5), null, 'not a member');
  assert.equal(L.receiveFile(v, 'box1', 'nope', 'F1', 'a.txt', 5), null);
  assert.equal(v.seen.includes('F1'), false, 'a refused file is not remembered');
  const m = L.receiveFile(v, 'box1', 'G', 'F1', 'a.txt', 5, 7);
  assert.equal(m.by, 'box1'); assert.deepEqual(m.file, { name: 'a.txt', size: 5 });
  assert.equal(L.group(v, 'g:G').unread, 1); assert.equal(v.friends[0].unread, 0);
  assert.deepEqual(L.fileIds(v, 'g:G'), ['F1']);
  // And a chunk for a group needs the same.
  const parts = new Map();
  assert.equal(L.receiveChunk(v, parts, 'box3', chunkBody({ from: 'box3', id: 'F2', g: 'G' })), null);
  assert.equal(L.receiveChunk(v, parts, 'box1', chunkBody({ id: 'F2', g: 'G' })).group, 'G');
});

test('leaving: a member leaving is dropped from the list; me leaving removes the group, its history and returns its file ids', () => {
  const v = vaultWith(1, 2);
  L.receiveGroup(v, 'box1', invite('box1', 'G', ['box1', 'box2', ME]), ME);
  L.receiveGroupMessage(v, 'box1', 'G', 'm1', 'hi', 1);
  L.receiveFile(v, 'box2', 'G', 'F1', 'a.txt', 5);
  L.addMineToGroup(v, 'g:G', 'mine1', 'x');
  L.addMineToGroup(v, 'g:G', 'F2', '', { name: 'b.txt', size: 3 });
  assert.equal(L.messagesOf(v, 'g:G').length, 4);
  L.receiveLeave(v, 'box2', 'G'); L.receiveLeave(v, 'box2', 'unknown');
  assert.deepEqual(L.group(v, 'g:G').members, ['box1']);
  assert.equal(L.receiveGroupMessage(v, 'box2', 'G', 'm9', 'hi', 1), null, 'someone who left cannot send');
  assert.deepEqual(L.leaveGroup(v, 'g:G'), ['F1', 'F2']);
  assert.equal(v.groups.length, 0); assert.equal(v.messages['g:G'], undefined);
  assert.deepEqual(L.leaveGroup(v, 'g:G'), []);
});

test('my own group messages and files, and their state (it works for group keys too)', () => {
  const v = vaultWith(1);
  L.createGroup(v, 'T', ['box1'], 'G', 10);
  L.addMineToGroup(v, 'g:G', 'a', 'hello', null, 20);
  L.addMineToGroup(v, 'g:nope', 'z', 'lost');
  assert.equal(v.messages['g:nope'], undefined);
  assert.equal(L.group(v, 'g:G').lastActivity, 20);
  assert.ok(L.setState(v, 'g:G', 'a', 'sent'));
  assert.ok(!L.setState(v, 'g:G', 'a', 'sending'));
  L.addMineFile(v, 'box1', 'F', { name: 'a.txt', size: 1 }, 30);
  assert.equal(L.messagesOf(v, 'box1')[0].state, 'sending');
  assert.equal(v.friends[0].lastActivity, 30);
  assert.ok(L.setState(v, 'box1', 'F', 'failed') && L.retryState(v, 'box1', 'F'));
  assert.deepEqual(L.groupsSorted(v).map((g) => g.id), ['G']);
  assert.equal(L.unreachable(v, L.group(v, 'g:G')), 0);
  L.remove(v, 'box1');
  assert.equal(L.unreachable(v, L.group(v, 'g:G')), 1, 'a member who is no longer my friend cannot be reached');
});

// ---- the saved vault

test('a vault saved before groups existed still loads, with every friend and message kept', () => {
  const old = { friends: [{ box: 'b1', status: 'active', sign: key(1), dh: key(2), fp: 'x', unread: 2 }], messages: { b1: [{ id: 'm', mine: true, text: 'hi', date: 1, state: 'read' }] }, blocked: ['f'], seen: ['m'] };
  const v = L.normalizeVault(JSON.parse(JSON.stringify(old)));
  assert.equal(v.friends.length, 1); assert.equal(v.messages.b1.length, 1);
  assert.deepEqual(v.blocked, ['f']); assert.deepEqual(v.seen, ['m']);
  assert.deepEqual(v.groups, []);
  assert.equal(L.totalUnread(v), 2);
  assert.deepEqual(L.newVault().groups, []);
});

test('groups, group history and files survive the JSON round trip; junk groups are dropped', () => {
  const v = vaultWith(1);
  L.createGroup(v, 'T', ['box1'], 'G', 10);
  L.receiveGroupMessage(v, 'box1', 'G', 'm1', 'hi', 5);
  L.addMineToGroup(v, 'g:G', 'F', '', { name: 'a.txt', size: 4 });
  const back = L.normalizeVault(JSON.parse(JSON.stringify(v)));
  assert.deepEqual(back, v);
  assert.equal(back.messages['g:G'][1].file.name, 'a.txt');
  const messy = L.normalizeVault({ friends: [], groups: [null, 5, { id: 1 }, { id: 'ok', name: 'n', members: [] }, { id: 'x', members: 'no' }] });
  assert.deepEqual(messy.groups.map((g) => g.id), ['ok']);
  assert.deepEqual(L.normalizeVault({ groups: 'junk' }).groups, []);
  assert.deepEqual(L.normalizeVault(null).groups, []);
});

test('a 2 MB file is 250 pieces that come back whole, in any order, even from a 20-piece-era sender', () => {
  const v = vaultWith(1), parts = new Map();
  const data = Buffer.alloc(2000000, 7); data[0] = 1; data[1999999] = 9;
  const bodies = L.chunkBodies('box1', 'BIG', 'big.bin', data, null, 5, b64u);
  assert.equal(bodies.length, 250);
  assert.ok(bodies.every((b) => b.fn === 250 && b.fd.length <= 10667));
  let done = null;
  for (const i of [...bodies.keys()].reverse()) done = L.receiveChunk(v, parts, 'box1', bodies[i]) || done;
  assert.equal(done.bytes.length, 2000000);
  assert.equal(done.bytes[0], 1);
  assert.equal(done.bytes[1999999], 9);
  assert.equal(parts.size, 0);
  // One byte more than the limit is 251 pieces: refused on arrival.
  assert.equal(L.receiveChunk(v, new Map(), 'box1', { ...bodies[0], id: 'BIG2', fn: 251 }), null);
  // Small files still work.
  assert.equal(L.chunkBodies('b', 'i', 'n', Buffer.alloc(8000), null, 1, b64u).length, 1);
  assert.equal(L.chunkBodies('b', 'i', 'n', Buffer.alloc(8001), null, 1, b64u).length, 2);
});

test('sendPieces paces a big file and retries the same piece after a 429', async () => {
  const bodies = Array.from({ length: 4 }, (_, i) => ({ i }));
  const log = [], sleeps = [];
  let limited = 2;   // piece 1 is refused twice, then goes through
  const post = async (b) => { log.push(b.i); if (b.i === 1 && limited > 0) { limited--; return { status: 429 }; } return { status: 200 }; };
  const sleep = async (ms) => { sleeps.push(ms); };
  const r = await L.sendPieces(bodies, post, sleep);
  assert.deepEqual(r, { ok: true, status: 200 });
  assert.deepEqual(log, [0, 1, 1, 1, 2, 3], 'the same piece again, never skipped');
  assert.deepEqual(sleeps, [220, 8000, 8000, 220, 220, 220], '220 ms between pieces, 8 s after a 429');
});

test('sendPieces gives up after 8 waits on one piece, and on any other failure', async () => {
  const sleeps = [];
  const sleep = async (ms) => { sleeps.push(ms); };
  let calls = 0;
  const always429 = async () => { calls++; return { status: 429 }; };
  assert.deepEqual(await L.sendPieces([{}, {}], always429, sleep), { ok: false, status: 429 });
  assert.equal(calls, 9, 'one try and eight retries');
  assert.equal(sleeps.filter((ms) => ms === 8000).length, 8);
  const log = [];
  const r = await L.sendPieces([{ i: 0 }, { i: 1 }, { i: 2 }], async (b) => { log.push(b.i); return { status: b.i === 1 ? 403 : 200 }; }, async () => {});
  assert.deepEqual(r, { ok: false, status: 403 });
  assert.deepEqual(log, [0, 1], 'stops at the first failure and does not retry it');
  // A one-piece file has nothing to pace.
  const s2 = [];
  assert.deepEqual(await L.sendPieces([{}], async () => ({ status: 200 }), async (ms) => { s2.push(ms); }), { ok: true, status: 200 });
  assert.deepEqual(s2, []);
});

test('the sealed size of a full 8,000-byte piece still fits the relay (about 16 KB)', async () => {
  // (the existing size test covers the sealed blob; this checks the biggest body of a 250-piece file)
  const bodies = L.chunkBodies('box1', 'BIG', 'big.bin', Buffer.alloc(2000000, 255), null, 5, b64u);
  assert.ok(JSON.stringify(bodies[249]).length < 11000);
});
