// F1 strategy and the race engineer: pit decisions, undercut, compound choice, the radio calls. Run: node --test NotchWindows/tests
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const S = require('../src/js/games/f1/strategy.js');
const base = { lap: 5, lapsTotal: 20, life: 0.8, lifePerLap: 0.04, compound: 'M', used: ['M'], wetness: 0, forecastRain: 0, flag: 'GREEN', gapAheadS: null, gapBehindS: null };

test('laps to the cliff come from the observed wear', () => {
  assert.ok(Math.abs(S.lapsToCliff(0.8, 0.05) - 10) < 1e-9); assert.equal(S.lapsToCliff(0.2, 0.05), 0); assert.equal(S.lapsToCliff(0.8, 0), Infinity);
  assert.ok(Math.abs(S.lapsToEnd(0.5, 0.05) - 10) < 1e-9);
});

test('a driver pits for damage, for rain on slicks, and when the cliff is near; otherwise he stays out', () => {
  assert.equal(S.shouldPit({ ...base }).pit, false);
  const dmg = S.shouldPit({ ...base, needsPit: true }); assert.ok(dmg.pit && dmg.urgent && dmg.reason === 'damage');
  const rain = S.shouldPit({ ...base, wetness: 0.5 }); assert.ok(rain.pit && rain.urgent && rain.compound === 'I', `got ${rain.compound}`);
  assert.equal(S.shouldPit({ ...base, wetness: 0.8 }).compound, 'W');
  const cliff = S.shouldPit({ ...base, life: 0.34, lifePerLap: 0.04 }); assert.ok(cliff.pit && /cliff/.test(cliff.reason));
  assert.equal(S.shouldPit({ ...base, life: 0.9, lifePerLap: 0.04 }).pit, false);
  assert.equal(S.shouldPit({ ...base, life: 0.34, lap: 19, used: ['M', 'H'] }).pit, false, 'no stop on the last lap');
  const dry = S.shouldPit({ ...base, compound: 'I', used: ['M', 'I'], wetness: 0.02, forecastRain: 0 }); assert.ok(dry.pit && /dry/.test(dry.reason) && 'SMH'.includes(dry.compound));
  const soon = S.shouldPit({ ...base, wetness: 0.2, forecastRain: 0.7 }); assert.ok(soon.pit && /rain/.test(soon.reason));
});

test('the two-compound rule forces a stop in a dry race that is still on one compound near the end, but not in a sprint', () => {
  const late = S.shouldPit({ ...base, lap: 17, life: 0.7, lifePerLap: 0.01 }); assert.ok(late.pit && late.reason === 'two-compound rule', JSON.stringify(late));
  assert.notEqual(late.compound, 'M', 'a different compound');
  assert.equal(S.shouldPit({ ...base, lap: 17, life: 0.7, lifePerLap: 0.01, noStopsAllowed: true }).pit, false);
  assert.equal(S.shouldPit({ ...base, lap: 17, life: 0.7, lifePerLap: 0.01, used: ['M', 'H'] }).pit, false);
});

test('under a VSC or Safety Car a driver on worn tyres makes the cheap stop; a stop costs less under the flag', () => {
  assert.ok(S.pitLoss('SAFETY_CAR') < S.pitLoss('VSC') && S.pitLoss('VSC') < S.pitLoss('GREEN'));
  const sc = S.shouldPit({ ...base, flag: 'SAFETY_CAR', life: 0.5 }); assert.ok(sc.pit && /Safety Car/.test(sc.reason));
  assert.equal(S.shouldPit({ ...base, flag: 'SAFETY_CAR', life: 0.9 }).pit, false, 'good tyres stay out');
  assert.equal(S.shouldPit({ ...base, flag: 'VSC', life: 0.5, lap: 18, used: ['M', 'H'] }).pit, false, 'too few laps left');
});

test('the undercut window: a close car ahead, tyres that are worn but not dead, and no car behind to jump us', () => {
  const ok = S.undercut({ gapAheadS: 1.4, gapBehindS: 30, life: 0.6, lapsLeft: 12 });
  assert.ok(ok.viable && ok.advantageS > 0, JSON.stringify(ok));
  assert.equal(S.undercut({ gapAheadS: 4, gapBehindS: 30, life: 0.6, lapsLeft: 12 }).viable, false);
  const jump = S.undercut({ gapAheadS: 1.2, gapBehindS: 5, life: 0.6, lapsLeft: 12 }); assert.equal(jump.viable, false); assert.match(jump.why, /behind/);
  assert.equal(S.undercut({ gapAheadS: 1, gapBehindS: 30, life: 0.95, lapsLeft: 12 }).viable, false);
  assert.equal(S.undercut({ gapAheadS: 1, gapBehindS: 30, life: 0.6, lapsLeft: 2 }).viable, false);
  assert.equal(S.undercut({ gapAheadS: null }).viable, false);
  assert.equal(S.overcut({ aheadPitting: true, life: 0.7, gapAheadS: 1.5 }).viable, true); assert.equal(S.overcut({ aheadPitting: false, life: 0.7 }).viable, false);
  const u = S.shouldPit({ ...base, life: 0.6, lifePerLap: 0.03, gapAheadS: 1.2, gapBehindS: 40 }); assert.ok(u.pit && u.reason === 'undercut');
});

test('compound choice: wets and inters in the wet, otherwise the one that lasts to the flag', () => {
  assert.equal(S.chooseCompound({ lapsLeft: 10, wetness: 0.8 }), 'W'); assert.equal(S.chooseCompound({ lapsLeft: 10, wetness: 0.4 }), 'I');
  assert.equal(S.chooseCompound({ lapsLeft: 30, used: ['S'] }), 'H'); assert.equal(S.chooseCompound({ lapsLeft: 5, used: ['M'] }), 'S');
  assert.equal(S.chooseCompound({ lapsLeft: 12, used: ['H'] }), 'M');
});

test('the engineer reports fuel, battery, tyres, weather, strategy, flags and penalties, most important first, without repeating himself', () => {
  const st = { fuelDeltaLaps: -0.8, socFraction: 0.1, ersMode: 'MEDIUM', tyre: { state: 'cold', life: 0.9, carcass: 80, window: [100, 120], compound: 'M' }, flag: 'GREEN', lap: 3, penaltySecs: 5 };
  const mem = {};
  let calls = S.engineerCalls(st, mem, 100, 5);
  const ids = calls.map((c) => c.id);
  assert.ok(ids.includes('fuel-short') && ids.includes('ers-low') && ids.includes('tyre-cold') && ids.includes('penalty'), ids.join());
  assert.ok(calls.every((c, i) => i === 0 || calls[i - 1].priority <= c.priority), 'sorted by importance');
  assert.match(calls.find((c) => c.id === 'tyre-cold').text, /100/);
  assert.deepEqual(S.engineerCalls(st, mem, 110, 5), [], 'nothing again within the quiet time');
  assert.ok(S.engineerCalls(st, mem, 400, 5).length > 0, 'later he repeats a warning that still applies');
  assert.equal(S.engineerCalls(st, {}, 0, 2).length, 2, 'at most as many as asked');
});

test('the engineer\'s strategy calls: undercut, rain, cliff, damage, overtake mode, Safety Car, engine heat', () => {
  const t = (o) => S.engineerCalls({ lap: 4, tyre: { compound: 'M', life: 0.8, state: 'ok' }, flag: 'GREEN', ...o }, {}, 0, 9).map((c) => c.id);
  assert.ok(t({ undercut: { viable: true }, ahead: { name: 'Norris', gapS: 1.2 } }).includes('undercut'));
  assert.match(S.engineerCalls({ lap: 4, tyre: { compound: 'M', life: 0.8 }, undercut: { viable: true }, ahead: { name: 'Norris', gapS: 1 } }, {}, 0, 5)[0].text, /undercut Norris.*plus two on the front wing/i);
  assert.ok(t({ rain: { raining: true } }).includes('rain-now')); assert.ok(t({ rain: { nextRainInS: 200 } }).includes('rain-soon')); assert.ok(!t({ rain: { nextRainInS: 900 } }).includes('rain-soon'));
  assert.ok(t({ tyre: { compound: 'M', life: 0.2, cliff: true } }).includes('tyre-cliff'));
  assert.ok(t({ needsPit: true, damageWhy: 'a broken front wing endplate' }).includes('damage'));
  assert.ok(t({ overtakeEligible: true, ahead: { name: 'Leclerc', gapS: 0.8 } }).includes('overtake'));
  assert.ok(t({ flag: 'SAFETY_CAR' }).includes('flag-sc')); assert.ok(t({ flag: 'VSC' }).includes('flag-vsc')); assert.ok(t({ flag: 'RED_FLAG' }).includes('flag-red'));
  assert.ok(t({ engineC: 130 }).includes('engine-hot')); assert.ok(t({ socFraction: 0.99, ersMode: 'LOW' }).includes('ers-full'));
  assert.ok(t({ tyre: { compound: 'M', life: 0.8, state: 'hot', carcass: 128, window: [100, 120] } }).includes('tyre-hot'));
  assert.ok(t({ fuelDeltaLaps: 2.2, lap: 5 }).includes('fuel-spare'));
  assert.equal(S.STRAT.engineer, 'Marc');
});
