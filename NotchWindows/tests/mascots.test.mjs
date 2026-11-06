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
  assert.deepEqual(M.ids, ['notchy', 'pomo', 'wisp', 'mochi', 'orbit', 'pip', 'f1lights', 'f1lap', 'f1pit']);
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
  const mac = [...swift.slice(0, swift.indexOf('static let teams')).matchAll(/\("(\w+)", "([^"]+)", "([^"]+)"\)/g)].map((m) => [m[1], m[2], m[3]]);
  assert.deepEqual(mac, M.list.map((m) => [m.id, m.name, m.how]));
});

test('F1 cars are painted in the team\'s colours, found by id or by any name F1 uses, and the three lists of teams agree', () => {
  assert.equal(M.teamOf('ferrari').c1, '#e8002d');
  assert.equal(M.teamOf('Scuderia Ferrari').id, 'ferrari');
  assert.equal(M.teamOf('Mercedes').c1, '#27f4d2');
  assert.equal(M.teamOf('Red Bull Racing').id, 'redbull');
  assert.equal(M.teamOf('McLaren').id, 'mclaren');
  assert.equal(M.teamOf('').id, 'notch');
  assert.equal(M.teamOf('no such team').id, 'notch');
  assert.match(M.svg('f1lap', { team: 'ferrari' }), /#e8002d/);
  assert.match(M.svg('f1lap', { team: 'mercedes' }), /#27f4d2/);
  assert.doesNotMatch(M.svg('f1lap', { team: 'mercedes' }), /#e8002d/);
  for (const id of ['f1lights', 'f1lap', 'f1pit']) { assert.match(M.scene(id, { team: 'ferrari' }), /^<svg viewBox="0 0 420 144"/); assert.match(M.greetingFor(id, 'Ada'), /Ada/); }
  assert.equal(M.greetingFor('pip', 'Ada'), 'Hello, Ada!');
  assert.deepEqual(G.TEAMS.map((t) => t[0]), M.teams.map((t) => t.id));
  const swift = fs.readFileSync(new URL('../../NotchApple/UI/MascotGreeting.swift', import.meta.url), 'utf8');
  const block = swift.slice(swift.indexOf('static let teams'), swift.indexOf('static let teamKey'));
  assert.deepEqual([...block.matchAll(/\("(\w+)", "([^"]+)"\)/g)].map((m) => m[1]), M.teams.map((t) => t.id));
});

test('the settings remember the F1 team and send it with the character', () => {
  mem.set('hello.team', JSON.stringify('ferrari'));
  assert.equal(G.team(), 'ferrari');
  mem.set('hello.team', JSON.stringify('nope'));
  assert.equal(G.team(), '');
});

test('an unknown or missing character falls back to the handwritten hello', () => {
  mem.set('hello.character', JSON.stringify('nope'));
  assert.equal(G.character(), 'hello');
  mem.set('hello.character', JSON.stringify('pip'));
  assert.equal(G.character(), 'pip');
  assert.equal(G.isOn(), true);
});

test('the picker draws a small picture for every choice, the handwriting and the F1 cars included', () => {
  assert.equal(typeof M.picker, 'function');
  for (const id of ['hello', ...M.ids]) {
    const pic = M.thumb(id, 'ferrari');
    assert.match(pic, /^<svg /, id);
    assert.match(pic.match(/^<svg [^>]*>/)[0], /width="100%" height="100%"/, `${id}: the picture scales to its tile`);
  }
});
