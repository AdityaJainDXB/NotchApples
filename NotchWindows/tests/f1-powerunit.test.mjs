// F1 power unit: the 2025 and 2026 splits, battery energy, harvesting, deployment taper, Overtake Mode and fuel. Run: node --test NotchWindows/tests
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const P = require('../src/js/games/f1/powerunit.js'), E = require('../src/js/games/f1/era.js');
const e25 = E.getEra('2025'), e26 = E.getEra('2026');

/// A lap profile: [seconds, speed m/s, throttle, brake].
const LAP = [[8, 70, 1, 0], [6, 92, 1, 0], [3, 70, 0, 0.9], [8, 45, 0.6, 0], [4, 80, 0, 0], [8, 60, 1, 0], [5, 90, 1, 0], [3, 40, 0, 1], [10, 50, 0.7, 0]];
function lap(era, s, hz = 120, mode, extra = {}) {
  const dt = 1 / hz, tot = { harvest: 0, deploy: 0, minSoc: 1e9, maxSoc: -1 };
  if (mode) s.mode = mode;
  for (const [secs, v, thr, brk] of LAP) for (let t = 0; t < secs; t += dt) {
    const o = P.step(s, { era, v, throttle: thr, brake: brk, ...extra }, dt);
    tot.harvest += o.harvestKw * dt / 1000; tot.deploy += o.deployKw * dt / 1000;
    tot.minSoc = Math.min(tot.minSoc, s.soc); tot.maxSoc = Math.max(tot.maxSoc, s.soc);
  }
  return tot;
}

test('the eras split the power as specified: 2025 about 560 + 120 kW, 2026 about 400 + 350 kW with a 8.5 MJ harvest cap', () => {
  assert.equal(e25.iceKw, 560); assert.equal(e25.mguKw, 120); assert.equal(e26.iceKw, 400); assert.equal(e26.mguKw, 350);
  assert.equal(e26.harvestCapMJ, 8.5); assert.equal(e25.overtakeMode, false); assert.equal(e26.overtakeMode, true);
  const a = P.createPU(e25), b = P.createPU(e26);
  const full = (era, s) => P.step(s, { era, v: 60, throttle: 1, brake: 0 }, 0.01);
  const o25 = full(e25, a), o26 = full(e26, b);
  assert.ok(Math.abs(o25.iceKw - 560) < 1 && Math.abs(o26.iceKw - 400) < 1);
  assert.ok(o26.deployKw / o26.iceKw > 0.6 && o25.deployKw / o25.iceKw < 0.2, '2026 leans on the electric motor, 2025 does not');
});

test('the battery never goes below empty or above full, and energy is accounted for', () => {
  for (const era of [e25, e26]) {
    const s = P.createPU(era), soc0 = s.soc;
    let harvested = 0, deployed = 0;
    for (let i = 0; i < 6; i++) { const t = lap(era, s, 120, 'HIGH'); harvested += t.harvest; deployed += t.deploy; assert.ok(t.minSoc >= -1e-9 && t.maxSoc <= era.batteryMJ + 1e-9, `${era.id}: SoC range ${t.minSoc} to ${t.maxSoc}`); }
    // soc change = harvested kW integrated x efficiency - deployed (harvest numbers are the motor's side, the battery gets storeEff of it)
    assert.ok(Math.abs((s.soc - soc0) - (harvested * P.PU.storeEff - deployed)) < 0.02, `${era.id}: energy balance ${(s.soc - soc0).toFixed(3)} vs ${(harvested * P.PU.storeEff - deployed).toFixed(3)}`);
  }
});

test('the harvest in a lap is capped: 8.5 MJ in 2026, 4 MJ in 2025', () => {
  for (const era of [e25, e26]) {
    const s = P.createPU(era, { soc: 0 });
    let harvested = 0;
    // brake hard and long, over and over: far more than the cap could be harvested
    for (let t = 0; t < 400; t += 1 / 60) harvested += P.step(s, { era, v: 80, throttle: 0, brake: 1 }, 1 / 60).harvestKw / 60 / 1000 * P.PU.storeEff;
    assert.ok(s.lapHarvest <= era.harvestCapMJ + 1e-9, `${era.id}: ${s.lapHarvest}`);
    assert.ok(s.lapHarvest >= Math.min(era.harvestCapMJ, era.batteryMJ) - 1e-6 || s.soc >= era.batteryMJ - 1e-6, 'it harvests right up to the cap (or the top of the battery)');
    const before = s.lapHarvest, o = P.step(s, { era, v: 80, throttle: 0, brake: 1 }, 0.1);
    assert.ok(!o.regenAvailable || s.lapHarvest === before);
    P.newLap(s); s.soc = 0;
    assert.ok(P.step(s, { era, v: 80, throttle: 0, brake: 1 }, 0.1).harvestKw > 0, 'a new lap starts the allowance again');
  }
});

test('lift and coast and super clipping both harvest, and clipping costs power at the end of a straight', () => {
  const s = P.createPU(e26, { soc: 0.3 });
  const coast = P.step(s, { era: e26, v: 70, throttle: 0, brake: 0 }, 0.1);
  assert.ok(coast.harvestKw > 0 && !coast.clipping, 'lifting off harvests');
  const clip = P.step(P.createPU(e26, { soc: 0.3 }), { era: e26, v: 92, throttle: 1, brake: 0 }, 0.1);
  assert.ok(clip.clipping && clip.harvestKw > 0, 'full throttle at the end of a straight harvests');
  const noclip = P.step(Object.assign(P.createPU(e26, { soc: 0.3 }), { mode: 'HIGH' }), { era: e26, v: 92, throttle: 1, brake: 0 }, 0.1);
  assert.ok(!noclip.clipping && noclip.netFullKw > clip.netFullKw, 'the HIGH mode keeps deploying instead of clipping, and is faster');
  const full = P.step(P.createPU(e26, { soc: 1 }), { era: e26, v: 92, throttle: 1, brake: 0 }, 0.1);
  assert.ok(!full.clipping, 'a full battery has nothing to gain from clipping');
});

test('2026 deployment tapers above 290 km/h to nothing at 345 km/h, and Overtake Mode lifts the taper for a car within 1.0 s', () => {
  const k = (v) => v / 3.6;
  assert.equal(P.deployTaper(e26, k(250), false), 1); assert.equal(P.deployTaper(e26, k(290), false), 1);
  assert.ok(Math.abs(P.deployTaper(e26, k(317.5), false) - 0.5) < 0.01); assert.equal(P.deployTaper(e26, k(345), false), 0); assert.equal(P.deployTaper(e26, k(360), false), 0);
  assert.ok(P.deployTaper(e26, k(317.5), true) > 0.8, 'Overtake Mode keeps the electric power up where the car in front fades');
  assert.equal(P.deployTaper(e25, k(340), false), 1, 'no taper in 2025');
  const mk = () => P.createPU(e26, { soc: 0.9 });
  const lead = P.step(mk(), { era: e26, v: k(320), throttle: 1, brake: 0, gapAheadS: null }, 0.05);
  const chase = P.step(mk(), { era: e26, v: k(320), throttle: 1, brake: 0, gapAheadS: 0.6, overtakeWanted: true }, 0.05);
  assert.ok(chase.overtakeActive && chase.deployKw > 2.5 * Math.max(1, lead.deployKw), `chase ${chase.deployKw.toFixed(0)} kW vs lead ${lead.deployKw.toFixed(0)} kW`);
  assert.ok(chase.netFullKw > lead.netFullKw && chase.vmaxK > lead.vmaxK);
  const far = P.step(mk(), { era: e26, v: k(320), throttle: 1, brake: 0, gapAheadS: 1.4, overtakeWanted: true }, 0.05);
  assert.ok(!far.overtakeActive, 'more than 1.0 s back: not allowed');
  const old = P.step(P.createPU(e25, { soc: 0.9 }), { era: e25, v: k(320), throttle: 1, brake: 0, gapAheadS: 0.5, overtakeWanted: true }, 0.05);
  assert.ok(!old.overtakeActive, 'no Overtake Mode in 2025');
});

test('an empty battery costs a lot of power in 2026, and the ERS modes spend the battery at different rates', () => {
  const full = P.step(P.createPU(e26, { soc: 0.9 }), { era: e26, v: 60, throttle: 1, brake: 0 }, 0.05), empty = P.step(P.createPU(e26, { soc: 0 }), { era: e26, v: 60, throttle: 1, brake: 0 }, 0.05);
  assert.ok(empty.accelK < full.accelK * 0.75, `empty ${empty.accelK.toFixed(2)} vs charged ${full.accelK.toFixed(2)}`);
  const spent = (mode) => { const s = P.createPU(e26, { soc: 1, mode }); for (let t = 0; t < 5; t += 0.05) P.step(s, { era: e26, v: 60, throttle: 1, brake: 0 }, 0.05); return e26.batteryMJ - s.soc; };
  assert.ok(spent('HIGH') > spent('MEDIUM') && spent('MEDIUM') > spent('LOW'));
});

test('energy results do not depend on the frame rate', () => {
  for (const era of [e25, e26]) {
    const a = P.createPU(era), b = P.createPU(era), c = P.createPU(era);
    lap(era, a, 60, 'MEDIUM'); lap(era, b, 120, 'MEDIUM'); lap(era, c, 30, 'MEDIUM');
    assert.ok(Math.abs(a.soc - b.soc) < 0.03 && Math.abs(c.soc - b.soc) < 0.05, `${era.id}: ${a.soc.toFixed(3)} ${b.soc.toFixed(3)} ${c.soc.toFixed(3)}`);
    assert.ok(Math.abs(a.fuel - b.fuel) < 0.005);
  }
});

test('fuel burns with throttle, adds weight, and the engineer can say how many laps of fuel are spare', () => {
  const s = P.createPU(e25, { fuelKg: 50 });
  const heavy = P.step(s, { era: e25, v: 60, throttle: 1, brake: 0 }, 0.01);
  const burn = 50 - s.fuel;
  assert.ok(burn > 0 && Math.abs(burn / 0.01 - 560 * 0.0000496) < 1e-6, 'about 100 kg per hour at full power');
  const light = P.step(P.createPU(e25, { fuelKg: 5 }), { era: e25, v: 60, throttle: 1, brake: 0 }, 0.01);
  assert.ok(light.accelK > heavy.accelK && light.massKg < heavy.massKg, 'a light car accelerates harder');
  const idle = P.createPU(e25, { fuelKg: 50 }); P.step(idle, { era: e25, v: 20, throttle: 0, brake: 0 }, 1);
  assert.equal(idle.fuel, 50, 'no throttle, no fuel');
  const kg = P.fuelFor(e25, 50, 90, 0.62);
  assert.ok(kg > 70 && kg <= e25.fuelStartKg, `${kg.toFixed(0)} kg for a 50-lap race`);
  assert.equal(P.fuelDeltaLaps(10, 4, 2), 1); assert.equal(P.fuelDeltaLaps(6, 4, 2), -1);
  const rich = P.createPU(e25, { fuelKg: 50, mix: 'RICH' }), lean = P.createPU(e25, { fuelKg: 50, mix: 'LEAN' });
  const r = P.step(rich, { era: e25, v: 60, throttle: 1, brake: 0 }, 1), l = P.step(lean, { era: e25, v: 60, throttle: 1, brake: 0 }, 1);
  assert.ok(r.netFullKw > l.netFullKw && 50 - rich.fuel > 50 - lean.fuel, 'rich mixture: more power, more fuel');
});
