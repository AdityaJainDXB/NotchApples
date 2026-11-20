// Desert Heat online: the code is in the game but must stay switched off in releases ("Coming soon").
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const O = require('../src/js/games/desertheat/multiplayer.js');

test('online play is switched off in this release and says Coming soon', () => {
  assert.equal(O.ENABLED, false, 'multiplayer must not be enabled until the owner approves it');
  assert.equal(O.STATUS, 'Coming soon');
  let made = 0;
  const s = new O.Session('wss://example.invalid', { WebSocket: function () { made++; } });
  const r = s.connect('Fareej');
  assert.equal(r.ok, false); assert.equal(made, 0, 'no connection is ever opened');
});

test('room codes are four capital letters', () => {
  assert.ok(O.validRoom(O.newRoom())); assert.equal(O.validRoom('ab12'), false);
});

test('remote players move smoothly between updates', () => {
  const g = new O.Ghost('a');
  g.push(1.0, { x: 0, y: 0, z: 0, h: 0 }); g.push(1.1, { x: 10, y: 0, z: 0, h: 0 });
  const p = g.at(1.15);
  assert.ok(Math.abs(p.x - 5) < 1e-6);
});

test('the session ignores its own echo and caps the room size', () => {
  const s = new O.Session('x'); s.id = 'me';
  s.receive({ t: 'state', id: 'me', x: 1 }, 0); assert.equal(s.ghosts.size, 0);
  for (let i = 0; i < 20; i++) s.receive({ t: 'state', id: 'p' + i, x: i, y: 0, z: 0, h: 0 }, 0);
  assert.equal(s.ghosts.size, O.MAX_PLAYERS - 1);
});
