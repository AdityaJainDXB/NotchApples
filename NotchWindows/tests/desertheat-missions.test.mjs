// Desert Heat Act 1: missions unlock in order, every step can complete, and failures restart at a checkpoint.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const S = require('../src/js/games/desertheat/story.js');
const M = require('../src/js/games/desertheat/missions.js');

test('Act 1 unlocks one mission at a time after Night Fare', () => {
  const done = ['night-fare']; const order = [];
  for (let m; (m = M.nextMission(done));) { order.push(m.id); done.push(m.id); }
  assert.deepEqual(order, ['the-files', 'debts', 'clean-hands', 'chop-shop', 'same-name']);
  assert.equal(M.nextMission([]), null);
});

test('every mission has places that exist and a first gun in mission 3', () => {
  for (const m of M.MISSIONS) {
    assert.ok(M.PLACES[m.start], `${m.id} start`);
    for (const s of m.steps) if (s.target) assert.ok(M.PLACES[s.target], `${m.id}/${s.id} target`);
  }
  const debts = M.byId('debts');
  assert.ok(debts.steps.some((s) => s.setup && s.setup.give && s.setup.give.weapon === 'pistol'));
});

// A perfect player: report being at each step's target, in the mission car, unseen, unwanted.
function perfect(step) {
  const p = step.target ? M.PLACES[step.target] : { x: 0, z: 0 };
  return { pos: p, inCar: !!(step.check.toString().includes('inMissionCar') || step.check.toString().includes('speed')), inMissionCar: true, speed: 0, wanted: 0, atLift: true, active: step.who, missionCarDamage: 0 };
}

test('each mission can be played from start to end', () => {
  for (const def of M.MISSIONS) {
    const m = new S.Mission(def);
    for (let guard = 0; !m.done && guard < 2000; guard++) {
      const ctx = perfect(m.step);
      if (/!c\.inCar/.test(m.step.check.toString())) ctx.inCar = false;
      m.update(0.1, ctx);
      assert.equal(m.failed, null, `${def.id} failed at ${m.step && m.step.id}`);
    }
    assert.ok(m.done, `${def.id} finished`);
  }
});

test('Chop Shop: wrecking the car fails, and retry restarts at losing the police', () => {
  const m = new S.Mission(M.byId('chop-shop'));
  while (m.step.id !== 'alarm') m.next();
  m.checkpoint = m.i;
  m.update(0.1, { inMissionCar: true, wanted: 2, missionCarDamage: 300 });
  assert.ok(m.failed);
  assert.equal(m.retry(), 'alarm');
});

test('Debts: delivering while wanted does not count', () => {
  const m = new S.Mission(M.byId('debts'));
  while (m.step.id !== 'drive') m.next();
  m.update(0.1, { inMissionCar: true, pos: M.PLACES.kiran, speed: 0, wanted: 1, missionCarDamage: 0 });
  assert.equal(m.step.id, 'drive');
  m.update(0.1, { inMissionCar: true, pos: M.PLACES.kiran, speed: 0, wanted: 0, missionCarDamage: 0 });
  assert.equal(m.step.id, 'kiran');
});
