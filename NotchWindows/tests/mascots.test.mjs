import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createRequire } from 'node:module';

// greeting.js reads its settings from the browser's storage: give it a small one.
const mem = new Map();
globalThis.window = globalThis;
globalThis.localStorage = { getItem: (k) => (mem.has(k) ? mem.get(k) : null), setItem: (k, v) => mem.set(k, String(v)), removeItem: (k) => mem.delete(k) };
globalThis.document = { addEventListener() {}, querySelector: () => null, documentElement: { style: {}, dataset: {} } };

const M = createRequire(import.meta.url)('../src/js/mascots.js');
const G = await import('../src/js/services/greeting.js');

test('every mascot has a drawing and the greeting text is right', () => {
  assert.deepEqual(M.ids, ['notchy', 'pomo', 'wisp', 'mochi', 'orbit', 'pip']);
  for (const id of M.ids) assert.match(M.svg(id), /^<svg viewBox="-95 -105 190 210"/, id);
  assert.equal(M.greeting('Aditya'), 'Hello, Aditya!');
  assert.equal(M.greeting('  '), 'Hello!');
  assert.equal(M.helloPath.length, 2);
});

test('the Windows settings list is the mascot list plus the handwriting', () => {
  assert.deepEqual(G.CHARACTERS.map((c) => c.id), ['hello', ...M.list.map((m) => m.id)]);
  assert.deepEqual(G.CHARACTERS.slice(1).map((c) => [c.name, c.how]), M.list.map((m) => [m.name, m.how]));
});

test('the Mac list in MascotGreeting.swift is the same list', () => {
  const swift = fs.readFileSync(new URL('../../NotchApple/UI/MascotGreeting.swift', import.meta.url), 'utf8');
  const mac = [...swift.matchAll(/\("(\w+)", "([^"]+)", "([^"]+)"\)/g)].map((m) => [m[1], m[2], m[3]]);
  assert.deepEqual(mac, M.list.map((m) => [m.id, m.name, m.how]));
});

test('an unknown or missing character falls back to the handwritten hello', () => {
  mem.set('hello.character', JSON.stringify('nope'));
  assert.equal(G.character(), 'hello');
  mem.set('hello.character', JSON.stringify('pip'));
  assert.equal(G.character(), 'pip');
  assert.equal(G.isOn(), true);
});
