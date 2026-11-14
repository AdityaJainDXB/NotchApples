// The F1 MFD: pages, settings with limits, parc fermé checks, strategy plans, the timing rows. Run: node --test NotchWindows/tests
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const M = require('../src/js/games/f1/mfd.js'), Wk = require('../src/js/games/f1/weekend.js'), Sim = (globalThis.window = globalThis, require('../src/js/games/f1/sim.js'));

test('the MFD has the pages of the wheel, and you move between pages and rows', () => {
  const m = M.create();
  assert.deepEqual(M.MFD.pages.map((p) => p.id), ['setup', 'energy', 'tyres', 'strategy', 'timing']);
  assert.equal(M.selected(m), 'brakeBias'); assert.equal(M.navigate(m, 'down'), 'diffOnThrottle'); assert.equal(M.navigate(m, 'up'), 'brakeBias'); assert.equal(M.navigate(m, 'up'), 'frontWing', 'rows wrap');
  assert.equal(M.navigate(m, 'next'), 'ersMode'); assert.equal(M.pageOf(m).id, 'energy'); M.navigate(m, 'prev'); assert.equal(M.pageOf(m).id, 'setup');
  M.navigate(m, 'next'); M.navigate(m, 'next'); M.navigate(m, 'next'); M.navigate(m, 'next'); assert.equal(M.pageOf(m).id, 'timing'); assert.equal(M.selected(m), null); assert.equal(M.navigate(m, 'next'), 'brakeBias', 'pages wrap');
});

test('settings move in steps and stop at their limits: brake bias, differentials, front wing, tyre pressures', () => {
  const m = M.create();
  assert.equal(M.adjust(m, 'brakeBias', 1).value, 56.5); assert.equal(M.adjust(m, 'brakeBias', -1).value, 56); 
  for (let i = 0; i < 40; i++) M.adjust(m, 'brakeBias', 1); assert.equal(m.values.brakeBias, 62); assert.equal(M.adjust(m, 'brakeBias', 1).unchanged, true);
  for (let i = 0; i < 40; i++) M.adjust(m, 'diffOnThrottle', -1); assert.equal(m.values.diffOnThrottle, 50);
  for (let i = 0; i < 40; i++) M.adjust(m, 'frontWing', 1); assert.equal(m.values.frontWing, 5);
  for (let i = 0; i < 40; i++) M.adjust(m, 'pressureFront', -1); assert.equal(m.values.pressureFront, -2);
  assert.equal(M.adjust(m, 'nonsense', 1).ok, false);
  assert.equal(M.rows(m)[0].value, '62 % front'); assert.ok(M.fmtValue('frontWing', 3).startsWith('+3'));
});

test('ERS mode, fuel mixture and the pit strategy are chosen from a list', () => {
  const m = M.create();
  assert.equal(M.adjust(m, 'ersMode', 1).value, 'HIGH'); assert.equal(M.adjust(m, 'ersMode', 1).unchanged, true); assert.equal(M.adjust(m, 'ersMode', -1).value, 'MEDIUM'); assert.equal(M.adjust(m, 'mix', 1).value, 'RICH');
  assert.equal(M.adjust(m, 'plan', 1).ok, false, 'no strategies yet');
  const plans = M.makePlans(20); M.setPlans(m, plans);
  assert.ok(plans.length >= 3 && plans.every((p) => p.stops.length && p.stops[0].lap >= 2 && p.stops[0].lap < 20));
  assert.equal(m.values.plan, 'M-H'); assert.equal(M.adjust(m, 'plan', 1).value, 'S-M'); assert.equal(M.planOf(m).id, 'S-M');
  assert.equal(M.makePlans(20, { noStops: true })[0].id, 'none'); assert.deepEqual(M.makePlans(20, { wet: true }).map((p) => p.id), ['I', 'W']);
  assert.ok(M.makePlans(3).length === 3 && M.makePlans(12).some((p) => p.stops.length === 2));
});

test('in parc fermé the MFD allows what the rules allow and refuses or flags the rest', () => {
  const w = Wk.create({ flow: 'standard', cars: ['A'] }); w.index = 3; Wk.carLeftPits(w, 'A', {});
  const m = M.create(); const ctx = { parc: (k, v) => Wk.parcAdjust(w, 'A', k, v) };
  assert.equal(M.adjust(m, 'frontWing', 1, ctx).ok, true); assert.equal(M.adjust(m, 'brakeBias', 1, ctx).violation, false);
  const low = M.adjust(m, 'pressureRear', -1, ctx); assert.equal(low.ok, true, 'a step down to -0.5 is above the minimum');
  for (let i = 0; i < 6; i++) M.adjust(m, 'pressureRear', -1, ctx); assert.ok(m.values.pressureRear >= Wk.WK.minPressureOffset, 'never below the Pirelli minimum');
  assert.ok(m.flash && /minimum/.test(m.flash.text));
});

test('the settings are written into a car simulation, and the timing page shows sector deltas and tyre temperatures', () => {
  const sim = Sim.create({}), m = M.create({ values: { brakeBias: 58, ersMode: 'HIGH' } });
  M.adjust(m, 'frontWing', 1); M.applyToSim(m, sim);
  assert.equal(sim.setup.brakeBias, 58); assert.equal(sim.setup.ersMode, 'HIGH'); assert.equal(sim.setup.frontWing, 1);
  const rows = M.timingRows({ sectors: [-0.123, 0.2, null], lapDelta: -0.04, surface: [95, 98, 105, 150], carcass: [100, 101, 99, 125], window: [100, 120], flag: 'GREEN' });
  assert.equal(rows[0].value, '−0.123'); assert.equal(rows[0].good, true); assert.equal(rows[1].good, false); assert.equal(rows[2].value, '–');
  const t = rows.filter((r) => r.label.startsWith('Tyre')); assert.deepEqual(t.map((r) => r.state), ['ok', 'ok', 'cold', 'hot']);
});
