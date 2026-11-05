// Big files in an anonymous room: cutting into pieces and putting them back together. The cases are the Mac's, from RoomFileTests in
// NotchAppleTests/BoardGamesTests.swift (rules in services/roomfileslogic.js, a port of FileChunks.swift).
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadModule } from './load.mjs';

const R = await loadModule('services/roomfileslogic.js');
const bytes = (n) => Uint8Array.from({ length: n }, (_, i) => i % 251);

test('the limits are the Mac numbers', () => {
  assert.equal(R.CHUNK_SIZE, 8000);
  assert.equal(R.MAX_BYTES, 2_000_000);
  assert.equal(R.MAX_CHUNKS, 250);
  assert.equal(R.MAX_PARTS, 6);
  assert.equal(R.PATIENCE_MS, 180_000);
  assert.equal(R.PIECE_GAP_MS, 30);
});

test('a file is cut into pieces that rebuild it, even arriving back to front', () => {
  const data = bytes(2_000_000);
  const pieces = R.split(data);
  assert.equal(pieces.length, 250);
  assert.ok(pieces.every((p) => p.length <= R.CHUNK_SIZE));
  const asm = R.createAssembly();
  let done = null;
  for (let i = pieces.length - 1; i >= 0; i--) done = asm.add('a|f', 'big.bin', pieces.length, i, pieces[i]) || done;
  assert.deepEqual(done.data, data);
  assert.equal(done.name, 'big.bin');
  assert.equal(asm.parts.size, 0, 'a finished file is forgotten');
  assert.equal(R.split(bytes(8001)).length, 2);
  assert.equal(R.split(bytes(8000)).length, 1);
  assert.equal(R.split(bytes(0)).length, 0);
});

test('bad pieces are refused', () => {
  const asm = R.createAssembly();
  assert.equal(asm.add('k', 'x', 251, 0, bytes(8000)), null, 'more pieces than the limit');
  assert.equal(asm.add('k', 'x', 3, 3, bytes(8000)), null, 'piece number out of range');
  assert.equal(asm.add('k', 'x', 3, -1, bytes(8000)), null);
  assert.equal(asm.add('k', 'x', 3, 0, bytes(8001)), null, 'piece too big');
  assert.equal(asm.add('k', 'x', 3, 0, bytes(100)), null, 'only the last piece may be short');
  assert.equal(asm.add('k', 'x', 3, 0, bytes(0)), null, 'an empty piece');
  assert.equal(asm.add('k', 'x', 1, 0, bytes(10)), null, 'one piece is just a normal message');
  assert.equal(asm.add('k', 'x', 3.5, 0, bytes(8000)), null);
  assert.equal(asm.parts.size, 0);
  asm.add('k', 'x', 3, 0, bytes(8000));
  assert.equal(asm.add('k', 'x', 4, 1, bytes(8000)), null, 'a piece that disagrees on the count is ignored');
  assert.equal(asm.parts.get('k').chunks.size, 1);
  // The last piece may be short, and a repeated piece does not complete the file.
  assert.equal(asm.add('k', 'x', 3, 0, bytes(8000)), null);
  assert.equal(asm.parts.get('k').chunks.size, 1);
  assert.equal(asm.add('k', 'x', 3, 1, bytes(8000)), null);
  assert.equal(asm.add('k', 'x', 3, 2, bytes(5)).data.length, 16005);
});

test('at most six files in flight, and a stalled file is dropped after 180 seconds', () => {
  const asm = R.createAssembly();
  const start = 1_000_000;
  for (let k = 0; k < R.MAX_PARTS; k++) asm.add(`s${k}`, `f${k}`, 3, 0, bytes(8000), start);
  assert.equal(asm.add('extra', 'e', 3, 0, bytes(8000), start), null);
  assert.equal(asm.parts.size, R.MAX_PARTS, 'a seventh file is not started');
  assert.deepEqual(asm.expire(start + 10_000), []);
  assert.deepEqual(asm.expire(start + 180_000), [], 'exactly 180 s is not yet over (the Mac says "more than")');
  const gone = asm.expire(start + 180_001);
  assert.equal(gone.length, R.MAX_PARTS);
  assert.deepEqual(gone.sort(), ['f0', 'f1', 'f2', 'f3', 'f4', 'f5']);
  assert.equal(asm.parts.size, 0);
  // After that a new file can start again; reset() drops everything.
  asm.add('again', 'a', 2, 0, bytes(8000), start);
  assert.equal(asm.parts.size, 1);
  asm.reset();
  assert.equal(asm.parts.size, 0);
});

test('two senders can send a file with the same id at once', () => {
  const asm = R.createAssembly();
  asm.add('alice|f', 'a.bin', 2, 0, bytes(8000));
  asm.add('bob|f', 'b.bin', 2, 0, bytes(8000));
  assert.equal(asm.parts.size, 2);
  assert.equal(asm.add('bob|f', 'b.bin', 2, 1, bytes(1)).name, 'b.bin');
  assert.equal(asm.add('alice|f', 'a.bin', 2, 1, bytes(2)).data.length, 8002);
});

test('file names are made safe', () => {
  assert.equal(R.cleanName('../../etc/passwd'), 'passwd');
  assert.equal(R.cleanName('a/b/photo.png'), 'photo.png');
  assert.equal(R.cleanName('C:\\Users\\me\\evil.exe'), 'evil.exe', 'a Windows path too');
  assert.equal(R.cleanName('folder/'), 'folder');
  assert.equal(R.cleanName('..'), null);
  assert.equal(R.cleanName('.'), null);
  assert.equal(R.cleanName('a/..'), null);
  assert.equal(R.cleanName(''), null);
  assert.equal(R.cleanName('   '), null);
  assert.equal(R.cleanName(null), null);
  assert.equal(R.cleanName(undefined), null);
  assert.equal(R.cleanName(5), null);
  assert.equal(R.cleanName('  my\u0000 pho\u0007to\n.png  '), 'my photo.png');
  assert.equal(Array.from(R.cleanName('n'.repeat(300))).length, 100);
  assert.equal(R.cleanName('é✌️🚢'.repeat(60)).length > 0, true);
});

test('base64 is the standard kind with padding, and bad text is refused', () => {
  const data = bytes(8000);
  const text = R.toBase64(data);
  assert.equal(text, Buffer.from(data).toString('base64'));
  assert.equal(text.length, 10668);
  assert.deepEqual(R.fromBase64(text), data);
  assert.deepEqual(R.fromBase64(''), new Uint8Array(0));
  for (const bad of ['a', 'abc', 'ab$d', 'ab=d', '====', 'a'.repeat(20_004), 5, null, undefined, 'ab-_']) assert.equal(R.fromBase64(bad), null, String(bad));
  assert.equal(R.toBase64(bytes(100000)).length, Math.ceil(100000 / 3) * 4, 'large inputs are fine');
});

test('a sealed piece fits the relay frame: a full 8,000-byte piece is about 14,700 characters', () => {
  // Envelope as the Mac writes it (JSON), sealed = nonce 12 + ciphertext + tag 16, then base64, inside {"event":"message","message":"…"}.
  const env = { v: 2, kind: 'chunk', id: 'A'.repeat(36), senderID: 'B'.repeat(36), sender: 'x'.repeat(32), fileData: R.toBase64(bytes(8000)), fileName: 'n'.repeat(100), fid: 'C'.repeat(36), fi: 249, fn: 250, ts: 123456789.123 };
  const sealedBytes = JSON.stringify(env).length + 12 + 16;
  const frame = `{"event":"message","message":"${'x'.repeat(Math.ceil(sealedBytes / 3) * 4)}"}`;
  assert.ok(Math.ceil(sealedBytes / 3) * 4 < 15_000);
  assert.ok(frame.length < 16 * 1024, `${frame.length}`);
});
