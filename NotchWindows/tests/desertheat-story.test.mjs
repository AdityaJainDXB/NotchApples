// Desert Heat section 2: switching rules, activities, the chase timer and the "Night Fare" mission order.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const S = require('../src/js/games/desertheat/story.js');

const game = (over = {}) => ({ active: 'fareej', chars: { fareej: S.newCharacter('fareej'), fatimah: S.newCharacter('fatimah') }, unlocked: { fatimah: true }, mission: null, ...over });

test('switching is allowed in free roam and refused while wanted, locked or mid-mission', () => {
  assert.equal(S.canSwitch(game()).ok, true);
  const g = game(); g.chars.fareej.wanted = 2; assert.equal(S.canSwitch(g).ok, false);
  assert.equal(S.canSwitch(game({ unlocked: {} })).ok, false);
  assert.equal(S.canSwitch(game({ mission: { allowSwitch: false } })).ok, false);
  assert.equal(S.canSwitch(game({ mission: { allowSwitch: true } })).ok, true);
});

test('each character keeps separate money and health', () => {
  const g = game(); g.chars.fareej.money -= 100;
  assert.notEqual(g.chars.fareej.money, g.chars.fatimah.money);
});

test('the activity picker always finds something, at every minute of the day', () => {
  for (const id of ['fareej', 'fatimah']) for (let h = -1; h < 25; h += 0.25) assert.ok(S.activityFor(id, h).length > 5);
});

test('the chaser gives up after 10 seconds unseen, and seeing you resets the timer', () => {
  const p = new S.Pursuit();
  for (let i = 0; i < 90; i++) p.step(0.1, false);
  assert.equal(p.lost, false);
  p.step(0.1, true); assert.equal(p.unseen, 0);
  for (let i = 0; i < 101; i++) p.step(0.1, false);
  assert.equal(p.lost, true);
  assert.equal(S.chaserSees(50, true), true); assert.equal(S.chaserSees(150, true), false); assert.equal(S.chaserSees(300, false), false);
});

test('Night Fare runs its parts in order, fails and retries from the checkpoint', () => {
  const m = new S.Mission(S.NIGHT_FARE);
  const P = S.PLACES;
  const ctx = { inCar: true, car: { x: 0, z: 0 }, carSpeed: 10, active: 'fareej' };
  const run = (secs, c) => { for (let t = 0; t < secs; t += 0.1) m.update(0.1, c); };
  run(8, ctx); assert.equal(m.step.id, 'pickup');
  run(2, ctx); assert.equal(m.step.id, 'pickup', 'not picked up while far away');
  run(0.2, { ...ctx, car: P.pickup, carSpeed: 0 }); assert.equal(m.step.id, 'passenger');
  run(23, ctx); assert.equal(m.step.id, 'chase');
  run(1, { ...ctx, wrecked: true }); assert.ok(m.failed);
  assert.equal(m.retry(), 'chase');
  run(0.2, { ...ctx, pursuitLost: true }); assert.equal(m.step.id, 'tomarina');
  run(0.2, { ...ctx, car: P.marinaGarage, carSpeed: 0 }); assert.equal(m.step.id, 'switch');
  assert.ok(m.step.forceSwitch);
  run(0.2, { ...ctx, active: 'fatimah', atLift: true }); assert.equal(m.step.id, 'apartment');
  run(9, ctx); assert.equal(m.step.id, 'end');
  run(8, ctx); assert.equal(m.done, true);
  assert.deepEqual(m.log, ['intro', 'pickup', 'passenger', 'chase', 'chase', 'tomarina', 'switch', 'apartment', 'end']);
});

test('the guard seeing Fatimah restarts at the car park', () => {
  const m = new S.Mission(S.NIGHT_FARE);
  while (m.step.id !== 'switch') m.next();
  m.checkpoint = m.i;
  m.update(0.1, { guardSaw: true }); assert.equal(m.failed, 'He saw you.');
  assert.equal(m.retry(), 'switch');
});

test('the fare is 38 dirhams plus 2 a kilometre', () => { assert.equal(S.fareFor(10), 58); });
