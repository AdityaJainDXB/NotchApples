// F1 weekend: session flows, knockout qualifying, the 107 % rule, parc fermé, tyre allocation, the compound rule, component pool and grid. Run: node --test NotchWindows/tests
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const W = require('../src/js/games/f1/weekend.js');
const ids = (n) => Array.from({ length: n }, (_, i) => 'D' + String(i + 1).padStart(2, '0'));

test('the standard weekend is FP1 FP2 FP3 Q1 Q2 Q3 GP, with the session lengths of the rules', () => {
  const s = W.sessionsOf('standard');
  assert.deepEqual(s.map((x) => x.id), ['FP1', 'FP2', 'FP3', 'Q1', 'Q2', 'Q3', 'GP']);
  assert.deepEqual(s.filter((x) => x.kind === 'practice').map((x) => x.minutes), [60, 60, 60]);
  assert.deepEqual(['Q1', 'Q2', 'Q3'].map((id) => s.find((x) => x.id === id).minutes), [18, 15, 12]);
});

test('the sprint weekend is FP1 SQ1 SQ2 SQ3 Sprint, Grand Prix qualifying, Grand Prix, with no mandatory stop in the sprint', () => {
  const s = W.sessionsOf('sprint');
  assert.deepEqual(s.map((x) => x.id), ['FP1', 'SQ1', 'SQ2', 'SQ3', 'SPR', 'Q1', 'Q2', 'Q3', 'GP']);
  assert.ok(s.find((x) => x.id === 'SPR').noMandatoryStop); assert.equal(s.find((x) => x.id === 'SPR').km, 100);
  assert.ok(s.find((x) => x.id === 'SQ1').sprint);
  const w = W.create({ flow: 'sprint', cars: ids(4) }); assert.equal(W.current(w).id, 'FP1'); W.next(w); assert.equal(W.current(w).id, 'SQ1');
  assert.equal(W.create({ flow: 'nonsense', cars: [] }).flow, 'standard');
  assert.ok(W.lapsFor({ minutes: 18 }) > W.lapsFor({ minutes: 12 }) && W.lapsFor({ minutes: 12 }) >= 2);
});

test('knockout qualifying: 22 cars, the slowest 6 out after Q1 (P17 to P22), the slowest 6 after Q2 (P11 to P16), ten in Q3', () => {
  assert.deepEqual(W.knockoutSizes(22), [22, 16, 10]); assert.deepEqual(W.knockoutSizes(20), [20, 15, 10]);
  const cars = ids(22), w = W.create({ flow: 'standard', cars });
  const times = (list, base) => list.map((id, i) => ({ id, best: base + i * 0.1, at: i }));
  // true pace order is D01..D22
  const q1 = W.finishQuali(w, 0, times(cars, 80));
  assert.deepEqual(q1.out, cars.slice(16)); assert.equal(q1.through.length, 16);
  const q2 = W.finishQuali(w, 1, times(q1.through, 79.5));
  assert.deepEqual(q2.out, cars.slice(10, 16)); assert.equal(q2.through.length, 10);
  const q3 = W.finishQuali(w, 2, times(q2.through, 79));
  assert.deepEqual(q3.order, cars.slice(0, 10));
  const g = W.buildGrid(w); assert.deepEqual(g.order, cars, 'P1 to P10 from Q3, P11 to P16 from Q2, P17 to P22 from Q1');
});

test('qualifying order: the fastest lap, the earlier time wins a tie, and a car with no time is last', () => {
  const o = W.qualiOrder([{ id: 'C', best: 0 }, { id: 'B', best: 80.1, at: 50 }, { id: 'A', best: 80.1, at: 20 }, { id: 'D', best: 79.9, at: 90 }]);
  assert.deepEqual(o.map((r) => r.id), ['D', 'A', 'B', 'C']);
});

test('the 107 % rule: a Q1 time slower than 107 % of the fastest fails to qualify, unless the stewards allow it', () => {
  const cars = ids(6), w = W.create({ flow: 'standard', cars });
  const rows = [{ id: 'D01', best: 80 }, { id: 'D02', best: 80.5 }, { id: 'D03', best: 85.6 }, { id: 'D04', best: 85.61 }, { id: 'D05', best: 90, at: 1 }, { id: 'D06', best: 0 }];
  const c = W.check107(rows);
  assert.ok(Math.abs(c.limit - 85.6) < 1e-9); assert.deepEqual(c.failed, ['D04', 'D05', 'D06']);
  W.allow107(w, 'D05', 'good practice pace');
  const r = W.finishQuali(w, 0, rows);
  assert.deepEqual(r.failed107, ['D04', 'D06']); 
  W.finishQuali(w, 1, rows.slice(0, 4)); W.finishQuali(w, 2, rows.slice(0, 3));
  const grid = W.buildGrid(w).order;
  assert.ok(!grid.includes('D04') && !grid.includes('D06') && grid.includes('D05'), `grid ${grid}`);
});

test('parc fermé: the setup locks when a car first leaves the pits in Q1; wing angle, brake bias, differential and tyre pressure may change, suspension and gears may not (pit lane start)', () => {
  const cars = ids(4), w = W.create({ flow: 'standard', cars });
  assert.equal(W.parcAdjust(w, 'D01', 'rideHeightMm', 30).violation, undefined, 'before qualifying anything goes');
  w.index = 3;                                         // Q1
  assert.equal(W.carLeftPits(w, 'D01', { rideHeightMm: 34 }), true);
  for (const k of ['frontWing', 'brakeBias', 'diffOnThrottle', 'pressureFront']) assert.equal(W.parcAdjust(w, 'D01', k, 0).ok, true, k);
  assert.equal(W.parcAdjust(w, 'D01', 'pressureRear', -3).ok, false, 'below the minimum tyre pressure');
  const bad = W.parcAdjust(w, 'D01', 'rideHeightMm', 28);
  assert.equal(bad.violation, true); assert.match(bad.why, /pit lane start/);
  assert.ok(w.pitLaneStart.has('D01'));
  assert.equal(W.parcAdjust(w, 'D02', 'gearRatios', 1).violation, undefined, 'a car that has not left the pits is not locked yet');
  const g = W.buildGrid(w); assert.equal(g.pitLane[0], 'D01'); assert.equal(g.order[g.order.length - 1], 'D01');
});

test('on a sprint weekend parc fermé re-opens between the Sprint and Grand Prix qualifying', () => {
  const w = W.create({ flow: 'sprint', cars: ids(3) }); w.index = 1;                 // SQ1
  W.carLeftPits(w, 'D01', { rideHeightMm: 34 });
  assert.equal(W.parcAdjust(w, 'D01', 'gearRatios', 1).violation, true);
  const w2 = W.create({ flow: 'sprint', cars: ids(3) }); w2.index = 1; W.carLeftPits(w2, 'D01', {});
  assert.equal(W.reopenParc(w2), true); assert.equal(W.parcAdjust(w2, 'D01', 'rideHeightMm', 30).violation, undefined);
  assert.equal(W.reopenParc(W.create({ flow: 'standard', cars: [] })), false);
});

test('tyre allocation: 13 dry sets (2 Hard, 3 Medium, 8 Soft), one Soft kept for Q3, plus inters and wets', () => {
  assert.equal(W.dryTotal(), 13); const t = W.WK.tyres; assert.equal(t.H, 2); assert.equal(t.M, 3); assert.equal(t.S, 8); assert.ok(t.I > 0 && t.W > 0);
  const w = W.create({ flow: 'standard', cars: ['A'] });
  assert.equal(W.setsLeft(w, 'A', 'S', 'FP1'), 7, 'seven Softs outside Q3'); assert.equal(W.setsLeft(w, 'A', 'S', 'Q3'), 8);
  for (let i = 0; i < 7; i++) assert.equal(W.useSet(w, 'A', 'S', 'FP2').ok, true);
  const r = W.useSet(w, 'A', 'S', 'Q1'); assert.equal(r.ok, false); assert.match(r.why, /Q3/);
  assert.equal(W.useSet(w, 'A', 'S', 'Q3').ok, true, 'the reserved set can be used in Q3');
  assert.equal(W.useSet(w, 'A', 'S', 'Q3').ok, false, 'and there is no ninth');
  for (let i = 0; i < 2; i++) assert.equal(W.useSet(w, 'A', 'H', 'GP').ok, true); assert.equal(W.useSet(w, 'A', 'H', 'GP').ok, false);
  assert.equal(W.useSet(w, 'A', 'X', 'GP').ok, false);
});

test('a dry race needs two different dry compounds; intermediates or wets waive it; a red flag tyre change counts', () => {
  assert.equal(W.compoundRule(['M']).ok, false); assert.match(W.compoundRule(['M', 'M']).why, /two different/);
  assert.equal(W.compoundRule(['M', 'H']).ok, true); assert.equal(W.compoundRule(['S', 'M', 'S']).ok, true);
  const wet = W.compoundRule(['M', 'I']); assert.equal(wet.ok, true); assert.equal(wet.waived, true);
  assert.equal(W.compoundRule(['M', 'W']).ok, true); assert.equal(W.compoundRule(['M'], { waived: true }).ok, true, 'a sprint has no mandatory stop');
  assert.equal(W.compoundRule(['H']).ok, false);
  assert.equal(W.compoundRule(W.compoundsWithRed(['M'], ['H'])).ok, true, 'tyres changed under the red flag count');
});

test('component pool: ICE, TC and MGU-K 4, ES and CE 2, exhausts 8; the first extra one is a 10-place penalty, later ones 5', () => {
  assert.deepEqual(W.WK.components, { ice: 4, tc: 4, mguk: 4, es: 2, ce: 2, exhaust: 8 });
  const pool = W.createPool(); const places = [];
  for (let i = 0; i < 6; i++) places.push(W.fitComponent(pool, 'ice').places);       // the pool starts with one in use: fits 2..6
  assert.deepEqual(places, [0, 0, 0, 10, 5, 5]);
  assert.equal(W.fitComponent(pool, 'es').places, 0); assert.equal(W.fitComponent(pool, 'es').places, 10, 'the second spare Energy Store is over: 10 for the first extra of that kind');
  assert.equal(W.fitComponent(pool, 'exhaust').places, 0);
  assert.equal(W.fitComponent(pool, 'nonsense').over, false);
  assert.equal(W.placesFor([{ places: 10 }, { places: 5 }]), 15); assert.equal(W.placesFor([{ places: 10 }, { places: 10 }, { places: 10 }]), 22, 'capped at the size of the grid');
  const again = W.loadPool(W.serializePool(pool)); assert.deepEqual(again, pool); assert.deepEqual(W.loadPool('garbage'), W.createPool());
});

test('grid penalties move a car down and everyone it passes up one place; pit lane starters go behind the grid', () => {
  const order = ['A', 'B', 'C', 'D', 'E', 'F'];
  assert.deepEqual(W.applyGridPenalties(order, { A: 3 }).order, ['B', 'C', 'D', 'A', 'E', 'F']);
  assert.deepEqual(W.applyGridPenalties(order, { B: 10 }).order, ['A', 'C', 'D', 'E', 'F', 'B'], 'a penalty bigger than the field puts him last');
  const g = W.applyGridPenalties(order, { A: 2 }, ['C']); assert.deepEqual(g.order, ['B', 'D', 'A', 'E', 'F', 'C']); assert.deepEqual(g.pitLane, ['C']);
  assert.deepEqual(W.applyGridPenalties(order, {}).order, order);
  const w = W.create({ flow: 'standard', cars: order }); W.finishQuali(w, 0, order.map((id, i) => ({ id, best: 80 + i }))); w.penalties = { A: 10 };
  assert.equal(W.buildGrid(w).order[5], 'A');
});
