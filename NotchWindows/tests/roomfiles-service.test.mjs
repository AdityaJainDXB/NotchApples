// The room service (services/messenger.js) end to end with a fake relay: two connections (ntfy and Notch Apple's own relay), the Mac's
// sealed envelopes coming in (pieces of a file, out of order, twice), and files going out as pieces. The app's files are copied to a temp
// folder so the real source is not touched, and the page-only imports are stood in for.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, cpSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const tmp = mkdtempSync(join(tmpdir(), 'notch-rooms-'));
cpSync(resolve(here, '../src/js'), join(tmp, 'js'), { recursive: true });
writeFileSync(join(tmp, 'package.json'), '{"type":"module"}');
writeFileSync(join(tmp, 'js', 'app.js'), 'export const isExpanded = () => false; export const activeTab = () => "home";\n');

// ---- the page, stood in for ----
const calls = [];                       // every native call: { cmd, args }
let readFile = null;                    // what read_file_base64 answers
const store = new Map();
globalThis.localStorage = { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)), removeItem: (k) => store.delete(k) };
globalThis.requestAnimationFrame = (fn) => setTimeout(fn, 0);
globalThis.window = {
  __TAURI__: {
    core: {
      invoke: async (cmd, args) => {
        calls.push({ cmd, args });
        if (cmd === 'http') return { status: 200, ok: true, body: '', headers: {} };
        if (cmd === 'read_file_base64') return readFile;
        if (cmd === 'friends_stage_file') return 'C:\\Temp\\NotchApple\\friends\\abc\\' + args.name;
        return null;
      },
    },
    event: { listen: async () => () => {} },
  },
};
class FakeSocket {
  static all = [];
  constructor(url) { this.url = url; this.readyState = 0; this.sent = []; FakeSocket.all.push(this); }
  send(data) { this.sent.push(data); }
  close() { this.readyState = 3; }
  open() { this.readyState = 1; return this.onmessage({ data: '{"event":"open"}' }); }
  deliver(sealed) { return this.onmessage({ data: JSON.stringify({ event: 'message', message: sealed }) }); }
}
globalThis.WebSocket = FakeSocket;

const MS = await import(pathToFileURL(join(tmp, 'js', 'services', 'messenger.js')).href);
const RF = await import(pathToFileURL(join(tmp, 'js', 'services', 'roomfileslogic.js')).href);
test.after(() => { MS.leave(); rmSync(tmp, { recursive: true, force: true }); });

// ---- a peer that seals the way the Mac does ----
const ROOM = 'chess-club-test';
const enc = new TextEncoder();
const sha = async (t) => new Uint8Array(await crypto.subtle.digest('SHA-256', enc.encode(t)));
const hex = (b) => [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
const aes = await crypto.subtle.importKey('raw', await sha(`notchapple-room-key|${ROOM}`), 'AES-GCM', false, ['encrypt', 'decrypt']);
const TOPIC = `notchapple-v1-${hex(await sha(`notchapple-room-topic|${ROOM}`)).slice(0, 40)}`;
const SWIFT = 978307200;
const sealEnv = async (obj) => {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, aes, enc.encode(JSON.stringify(obj))));
  return Buffer.concat([iv, ct]).toString('base64');
};
const openFrame = async (frame) => {
  const { message } = JSON.parse(frame);
  const bytes = Buffer.from(message, 'base64');
  return JSON.parse(new TextDecoder().decode(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: bytes.subarray(0, 12) }, aes, bytes.subarray(12))));
};
const peer = (extra) => ({ v: 2, id: crypto.randomUUID().toUpperCase(), senderID: 'MAC-PEER', sender: 'CobaltOtter#101', ts: Date.now() / 1000 - SWIFT, ...extra });
const bytes = (n, seed = 0) => Uint8Array.from({ length: n }, (_, i) => (i * 7 + seed) % 251);
const tick = (ms = 20) => new Promise((r) => setTimeout(r, ms));

let own, ntfy;
test('joining a room opens both relays and works when only the own relay is up', async () => {
  await MS.join(ROOM);
  assert.equal(FakeSocket.all.length, 2);
  own = FakeSocket.all.find((s) => s.url === `wss://notchapple-rooms.adityajain1225.workers.dev/${TOPIC}/ws`);
  ntfy = FakeSocket.all.find((s) => s.url === `wss://ntfy.sh/${TOPIC}/ws`);
  assert.ok(own && ntfy, FakeSocket.all.map((s) => s.url).join(' '));
  assert.equal(MS.state().state, 'connecting');
  assert.equal(MS.canSendFiles(), false);
  await own.open();
  await tick(40);
  assert.equal(MS.state().state, 'joined');
  assert.equal(MS.canSendFiles(), true);
  const hello = await openFrame(own.sent[0]);
  assert.equal(hello.kind, 'presence');
  assert.equal(hello.sender, MS.identity().handle);
  assert.deepEqual(JSON.parse(own.sent[0]).event, 'message');
});

test('a file in pieces from the Mac arrives whole, from either relay, in any order, once', async () => {
  const data = bytes(20_000, 3), pieces = RF.split(data), fid = 'F-1';
  const envs = pieces.map((p, i) => peer({ kind: 'chunk', fid, fi: i, fn: pieces.length, fileData: Buffer.from(p).toString('base64'), fileName: '../../Photos/holiday.png' }));
  await ntfy.open();
  await own.deliver(await sealEnv(envs[2]));
  await ntfy.deliver(await sealEnv(envs[0]));
  await ntfy.deliver(await sealEnv(envs[0]));          // the same piece again (one copy per relay)
  assert.equal(MS.state().messages.filter((m) => m.file).length, 0, 'not whole yet');
  assert.ok(MS.state().messages.some((m) => m.notice && /CobaltOtter#101 is sending "holiday.png"/.test(m.text)), 'says a file is on its way');
  await own.deliver(await sealEnv(envs[1]));
  const files = MS.state().messages.filter((m) => m.file);
  assert.equal(files.length, 1);
  assert.equal(files[0].file.name, 'holiday.png', 'the folder part of the name is dropped');
  assert.equal(files[0].file.size, 20_000);
  assert.equal(files[0].sender, 'CobaltOtter#101');
  assert.equal(files[0].mine, false);
  // Opening it hands the bytes to the same staging command as Friends and shows it in Explorer.
  calls.length = 0;
  assert.equal(await MS.revealFile(files[0].id), null);
  const stage = calls.find((c) => c.cmd === 'friends_stage_file');
  assert.equal(stage.args.name, 'holiday.png');
  assert.deepEqual(Buffer.from(stage.args.base64, 'base64'), Buffer.from(data));
  assert.ok(calls.some((c) => c.cmd === 'reveal_path' && /holiday\.png$/.test(c.args.path)));
  // A late copy of a piece after the file is complete starts nothing new (the ID was seen).
  await own.deliver(await sealEnv(envs[1]));
  assert.equal(MS.state().messages.filter((m) => m.file).length, 1);
});

test('bad pieces are ignored and a small file in a normal message is shown', async () => {
  const before = MS.state().messages.length;
  const full = Buffer.from(bytes(8000)).toString('base64');
  await own.deliver(await sealEnv(peer({ kind: 'chunk', fid: 'X', fi: 0, fn: 1, fileData: full, fileName: 'x.bin' })));           // one piece is not a chunked file
  await own.deliver(await sealEnv(peer({ kind: 'chunk', fid: 'X', fi: 0, fn: 251, fileData: full, fileName: 'x.bin' })));         // too many pieces
  await own.deliver(await sealEnv(peer({ kind: 'chunk', fid: 'X', fi: 0, fn: 3, fileData: Buffer.from(bytes(100)).toString('base64'), fileName: 'x.bin' })));   // short piece that is not last
  await own.deliver(await sealEnv(peer({ kind: 'chunk', fid: 'X', fi: 0, fn: 3, fileData: 'not base64!', fileName: 'x.bin' })));
  await own.deliver(await sealEnv(peer({ kind: 'chunk', fid: 'X', fi: 0, fn: 3, fileData: full, fileName: '..' })));
  await own.deliver(await sealEnv(peer({ kind: 'chunk', fi: 0, fn: 3, fileData: full, fileName: 'x.bin' })));                      // no file id
  assert.equal(MS.state().messages.length, before, 'nothing was added, not even a notice');
  await own.deliver(await sealEnv(peer({ kind: 'message', fileData: Buffer.from(bytes(5000)).toString('base64'), fileName: 'small.txt' })));
  const small = MS.state().messages.filter((m) => m.file && m.file.name === 'small.txt');
  assert.equal(small.length, 1);
  assert.equal(small[0].file.size, 5000);
  await own.deliver(await sealEnv(peer({ kind: 'message', text: 'hello from the Mac' })));
  assert.ok(MS.state().messages.some((m) => m.text === 'hello from the Mac'));
});

test('sending a file cuts it into 8,000-byte pieces on the own relay only, each under the 16 KB frame', async () => {
  readFile = { name: 'C:\\Users\\me\\report.pdf', data: Buffer.from(bytes(20_000, 9)).toString('base64'), size: 20_000, mime: 'application/pdf' };
  own.sent.length = 0; ntfy.sent.length = 0; calls.length = 0;
  assert.equal(await MS.sendFile('C:\\Users\\me\\report.pdf'), null);
  const frames = own.sent.filter((f) => f !== 'ping');
  assert.equal(frames.length, 3);
  assert.ok(frames.every((f) => f.length < 16 * 1024), frames.map((f) => f.length).join(','));
  assert.ok(frames[0].length > 14_000 && frames[0].length < 15_500, `a full piece is about 14,700 characters (${frames[0].length})`);
  const envs = [];
  for (const f of frames) envs.push(await openFrame(f));
  assert.deepEqual(envs.map((e) => [e.kind, e.fi, e.fn]), [['chunk', 0, 3], ['chunk', 1, 3], ['chunk', 2, 3]]);
  assert.equal(new Set(envs.map((e) => e.fid)).size, 1);
  assert.ok(envs.every((e) => e.fileName === 'report.pdf' && e.senderID === MS.identity().senderID && typeof e.ts === 'number' && typeof e.id === 'string'));
  assert.deepEqual(envs.map((e) => Buffer.from(e.fileData, 'base64').length), [8000, 8000, 4000]);
  assert.deepEqual(Buffer.concat(envs.map((e) => Buffer.from(e.fileData, 'base64'))), Buffer.from(bytes(20_000, 9)), 'the pieces rebuild the file');
  assert.equal(ntfy.sent.length, 0);
  assert.equal(calls.filter((c) => c.cmd === 'http' && c.args.req.method === 'POST').length, 0, 'no piece goes to ntfy');
  // The sender sees the file in their own chat at once, and the Mac's receiver would put it back together the same way.
  const mine = MS.state().messages.filter((m) => m.mine && m.file);
  assert.equal(mine.length, 1);
  assert.equal(mine[0].file.name, 'report.pdf');
  assert.equal(mine[0].progress, undefined, 'done sending');
  const asm = RF.createAssembly();
  let whole = null;
  for (const e of envs) whole = asm.add('me|' + e.fid, e.fileName, e.fn, e.fi, new Uint8Array(Buffer.from(e.fileData, 'base64'))) || whole;
  assert.equal(whole.data.length, 20_000);
});

test('a file of 8,000 bytes or less is one normal message with fileData and fileName; too big is refused', async () => {
  readFile = { name: 'tiny.txt', data: Buffer.from(bytes(8000)).toString('base64'), size: 8000, mime: 'text/plain' };
  own.sent.length = 0;
  assert.equal(await MS.sendFile('tiny.txt'), null);
  const frames = own.sent.filter((f) => f !== 'ping');
  assert.equal(frames.length, 1);
  assert.ok(frames[0].length < 16 * 1024);
  const e = await openFrame(frames[0]);
  assert.equal(e.kind, 'message');
  assert.equal(e.fileName, 'tiny.txt');
  assert.equal(Buffer.from(e.fileData, 'base64').length, 8000);
  assert.equal(e.fid, undefined);
  readFile = { name: 'huge.bin', data: Buffer.alloc(2_000_001, 1).toString('base64'), size: 2_000_001, mime: '' };
  own.sent.length = 0;
  const problem = await MS.sendFile('huge.bin');
  assert.match(problem, /up to 2 MB/);
  assert.equal(own.sent.length, 0);
  readFile = { name: 'empty.txt', data: '', size: 0, mime: '' };
  assert.match(await MS.sendFile('empty.txt'), /Couldn't read/);
});

test('without the own relay there is no file sending (ntfy cannot carry it) but the room still works', async () => {
  own.readyState = 3; await own.onclose();             // the own relay goes away
  assert.equal(MS.state().state, 'joined', 'ntfy is still joined');
  assert.equal(MS.canSendFiles(), false);
  readFile = { name: 'a.txt', data: Buffer.from('hi').toString('base64'), size: 2, mime: '' };
  calls.length = 0;
  const problem = await MS.sendFile('a.txt');
  assert.match(problem, /own relay/);
  assert.equal(calls.filter((c) => c.cmd === 'http' && c.args.req.method === 'POST').length, 0);
  await MS.send('still chatting');                     // text goes through ntfy
  assert.ok(calls.some((c) => c.cmd === 'http' && c.args.req.url === `https://ntfy.sh/${TOPIC}`));
});

test('leaving says goodbye on the own relay before it closes', async () => {
  // Bring the own relay back first (a reconnect makes a new socket).
  await new Promise((r) => setTimeout(r, 2100));
  const again = FakeSocket.all.filter((s) => s.url.startsWith('wss://notchapple-rooms')).at(-1);
  assert.notEqual(again, own);
  await again.open();
  again.sent.length = 0;
  MS.leave();
  await tick(60);
  const leave = (await Promise.all(again.sent.filter((f) => f !== 'ping').map(openFrame))).find((e) => e.kind === 'leave');
  assert.ok(leave, 'a leave envelope was sent');
  assert.equal(again.readyState, 3, 'and then the socket is closed');
  assert.equal(MS.state().state, 'idle');
});
