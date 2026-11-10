import test from 'node:test';
import assert from 'node:assert/strict';
import { loadModule } from './load.mjs';

const L = await loadModule('services/lockcodelogic.js');
const memory = () => { const m = new Map(); return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k) }; };

test('a code is 4 to 8 digits', () => {
  assert.equal(L.isValid('1234'), true); assert.equal(L.isValid('12345678'), true);
  assert.equal(L.isValid('123'), false); assert.equal(L.isValid('123456789'), false); assert.equal(L.isValid('12a4'), false); assert.equal(L.isValid(''), false);
  assert.equal(L.cleaned('1a2-3 4567890'), '12345678');
});

test('the hash is salted and repeatable, and matches only the right code', async () => {
  assert.equal(await L.hash('1234', 'aa'), await L.hash('1234', 'aa'));
  assert.notEqual(await L.hash('1234', 'aa'), await L.hash('1234', 'bb'));
  assert.notEqual(await L.hash('1234', 'aa'), await L.hash('1235', 'aa'));
  assert.equal((await L.hash('1234', 'aa')).length, 64);
  assert.equal(await L.matches('1234', 'aa', await L.hash('1234', 'aa')), true);
  assert.equal(await L.matches('0000', 'aa', await L.hash('1234', 'aa')), false);
  assert.notEqual(L.makeSalt(), L.makeSalt());
});

test('the wait grows after five wrong tries, up to 15 minutes', () => {
  assert.deepEqual([0, 4, 5, 6, 7, 8, 9, 10, 20].map(L.lockoutSeconds), [0, 0, 30, 60, 120, 240, 480, 900, 900]);
});

test('the store keeps a hash, counts wrong tries and waits', async () => {
  const s = L.createStore(memory());
  assert.equal(s.isSet(), false);
  assert.equal(await s.set('12'), false);
  assert.equal(await s.set('2468'), true);
  assert.equal(s.isSet(), true);
  const t0 = 1_000_000;
  assert.equal(await s.isRight('2468', t0), true);
  assert.equal(await s.isRight('2469', t0), false);
  for (let i = 0; i < 4; i++) assert.equal(await s.check('0000', t0), false);
  assert.equal(s.waitRemaining(t0), 0);
  assert.equal(await s.check('0000', t0), false);            // the fifth wrong try starts a 30 second wait
  assert.equal(s.waitRemaining(t0), 30);
  assert.equal(await s.check('2468', t0 + 1000), false);     // nothing is checked while waiting
  assert.equal(await s.check('2468', t0 + 31_000), true);    // and a right code after it resets everything
  assert.equal(s.waitRemaining(t0 + 31_000), 0);
  s.clear();
  assert.equal(s.isSet(), false);
});
