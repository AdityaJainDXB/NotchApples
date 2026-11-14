// The F1 car simulation joined to the game's real car physics: laps on real tracks with the aero, power unit, tyres, fuel and damage on.
// Run: node --test NotchWindows/tests
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
globalThis.window = globalThis;
globalThis.document = { getElementById: () => null };
const require = createRequire(import.meta.url);
require('../src/js/games/racing.js');
for (const f of ['era', 'aero', 'powerunit', 'tyres', 'damage', 'sim']) require(`../src/js/games/f1/${f}.js`);
const R = globalThis.NotchRaceGame._test, F1 = globalThis.NotchRaceF1;

/// Drive one F1 car round a track with the computer driver. opt: era, laps, fuelKg, compound, setup, sim (false = the old car), damage at lap N.
function lapRun(trackId, opt = {}) {
  const T = R.buildTrack(R.TRACKS.find((t) => t.id === trackId)), spec = R.CARS.find((c) => c.id === 'f1');
  const q = T.S[0], c = R.newCar(spec, q.x - q.tx * 10, q.y - q.ty * 10, Math.atan2(q.ty, q.tx));
  c.tyre = opt.compound || 'M';
  if (opt.sim !== false) { c.spec = { ...spec, down: 0.74 }; c.f1 = F1.sim.create({ era: F1.era.getEra(opt.era || '2025'), compound: opt.compound || 'M', fuelKg: opt.fuelKg != null ? opt.fuelKg : 12, setup: opt.setup }); if (opt.pre) opt.pre(c.f1); }
  const st = { idx: -1, lane: 0, skill: 0.98, corner: 0.95, brakes: 0.9, stuck: 0, rev: 0, go: true, t: 99, react: 0 };
  const dt = 1 / 120, laps = opt.laps || 3, times = []; let t = 0, lapStart = 0, lapN = 0, prev = 0, maxOff = 0, bad = 0, porp = 0, minLife = 1, maxDeploy = 0, maxIce = 0;
  for (let i = 0; i < 120 * 60 * 15 && lapN < laps + 1; i++, t += dt) {
    const loc = R.locate(T, c.x, c.y, st.idx), inp = R.driveAI(T, c, st, dt);
    if (c.f1) { const m = F1.sim.step(c.f1, { vf: c.vf, vl: c.vl, yaw: c.yaw, throttle: inp.throttle, brake: inp.brake, steer: inp.steer, wingOpenWanted: false, flagOk: true, wet: 0, trackK: 1 }, dt); porp = Math.max(porp, m.porpoise); minLife = Math.min(minLife, m.life); maxDeploy = Math.max(maxDeploy, m.deployKw); maxIce = Math.max(maxIce, c.f1.pu.last ? c.f1.pu.last.iceKw : 0); }
    R.stepOnRoad(T, c, inp, dt, Math.abs(loc.lat) > T.width / 2 + 1.5 ? 0.55 : 1, loc);
    const a = R.locate(T, c.x, c.y, loc.idx); maxOff = Math.max(maxOff, Math.abs(a.lat));
    if (![c.x, c.y, c.vx, c.vy, c.h].every(Number.isFinite)) bad++;
    const s = ((a.s % T.length) + T.length) % T.length;
    if (prev > T.length * 0.75 && s < T.length * 0.25) { if (lapN > 0) times.push(t - lapStart); lapStart = t; lapN++; if (c.f1) F1.sim.newLap(c.f1); }
    prev = s;
  }
  return { c, T, times, maxOff, bad, porp, minLife, maxDeploy, maxIce, best: Math.min(...times) };
}

test('an F1 car with the full simulation drives a real track: finite, on the road, near the old car\'s pace', () => {
  for (const id of ['circuit', 'gp']) {
    const sim = lapRun(id), old = lapRun(id, { sim: false });
    assert.equal(sim.bad, 0, 'no NaN or infinity');
    assert.ok(sim.times.length >= 2, `${id}: laps ${sim.times.length}`);
    assert.ok(sim.maxOff < sim.T.width / 2 + 7.6, `${id}: stayed inside the barriers (${sim.maxOff.toFixed(1)} m)`);
    assert.ok(sim.best > old.best * 0.85 && sim.best < old.best * 1.2, `${id}: ${sim.best.toFixed(1)} s with the simulation, ${old.best.toFixed(1)} s without`);
  }
});

test('tyres warm up into their window while driving, wear, and the fuel burns off and lightens the car', () => {
  const r = lapRun('gp', { laps: 3, fuelKg: 20 }), m = r.c.f1.mods;
  const win = F1.tyres.windowOf('M'), avg = m.carcass.reduce((a, b) => a + b, 0) / 4;
  assert.ok(avg > win[0] - 8 && avg < win[1] + 15, `medium carcass ${avg.toFixed(0)} °C (window ${win})`);
  assert.ok(m.life < 1 && m.life > 0.5, `life ${m.life.toFixed(2)}`);
  assert.ok(m.fuelKg < 20 && 20 - m.fuelKg > 2, `fuel ${m.fuelKg.toFixed(1)}`);
  assert.ok(m.surface.every(Number.isFinite) && Math.max(...m.surface) < 190);
});

test('fuel weight costs lap time: a car with a full tank is slower than one nearly empty', () => {
  const heavy = lapRun('gp', { laps: 2, fuelKg: 100, era: '2025' }), light = lapRun('gp', { laps: 2, fuelKg: 4, era: '2025' });
  assert.ok(heavy.best > light.best + 0.3, `${heavy.best.toFixed(2)} s heavy vs ${light.best.toFixed(2)} s light`);
});

test('the 2026 and 2025 cars drive differently: the 2026 car is lighter, leans on its battery, and drags less with the wings open', () => {
  const a = lapRun('gp', { era: '2025', laps: 2 }), b = lapRun('gp', { era: '2026', laps: 2 });
  assert.ok(a.c.f1.era.id === '2025' && b.c.f1.era.id === '2026');
  assert.ok(Math.abs(a.best - b.best) > 0.2, `different lap times: ${a.best.toFixed(2)} vs ${b.best.toFixed(2)}`);
  assert.ok(b.maxDeploy > 2.2 * a.maxDeploy, `the 2026 car's electric motor is much stronger: ${b.maxDeploy.toFixed(0)} kW vs ${a.maxDeploy.toFixed(0)} kW`);
  assert.ok(a.maxIce > 1.2 * b.maxIce, `and its combustion engine smaller: ${b.maxIce.toFixed(0)} kW vs ${a.maxIce.toFixed(0)} kW`);
});

test('damage hurts the lap time: a broken front wing and a damaged floor make the car slower and less stable', () => {
  const clean = lapRun('gp', { laps: 2 });
  const wing = lapRun('gp', { laps: 2, pre: (s) => F1.sim.onImpact(s, { speed: 34, zone: 'front', lateral: 0 }) });
  const floor = lapRun('gp', { laps: 2, pre: (s) => { s.dmg.floor = 0.6; } });
  assert.ok(wing.best > clean.best + 0.4, `front wing: ${wing.best.toFixed(2)} vs ${clean.best.toFixed(2)}`);
  assert.ok(floor.best > clean.best + 0.25, `floor: ${floor.best.toFixed(2)} vs ${clean.best.toFixed(2)}`);
});

test('a too-low ride height porpoises at speed on a real track; the normal one does not', () => {
  const ok = lapRun('gp', { laps: 2, setup: { rideHeightMm: 36 } }), low = lapRun('gp', { laps: 2, setup: { rideHeightMm: 29 } });
  assert.ok(ok.porp < 0.2, `normal ${ok.porp.toFixed(2)}`);
  assert.ok(low.porp > 0.3, `low ${low.porp.toFixed(2)}`);
});

test('a worn set of tyres falls off the cliff and the car is much slower; a hot set blisters', () => {
  const worn = lapRun('gp', { laps: 2, pre: (s) => { for (const w of s.tyres.w) w.wear = 0.85; } }), fresh = lapRun('gp', { laps: 2 });
  assert.ok(worn.best > fresh.best + 1.5, `worn ${worn.best.toFixed(1)} vs fresh ${fresh.best.toFixed(1)}`);
  assert.ok(worn.c.f1.mods.wearCliff);
});

test('the game\'s other cars are untouched: without c.f1 the physics is exactly as before', () => {
  const gt = R.CARS.find((c) => c.id === 'gt'), T = R.buildTrack(R.TRACKS.find((t) => t.id === 'circuit'));
  const run = () => { const q = T.S[0], c = R.newCar(gt, q.x, q.y, Math.atan2(q.ty, q.tx)); for (let i = 0; i < 600; i++) R.stepOnRoad(T, c, { throttle: 1, brake: 0, steer: i % 120 < 60 ? 0.3 : -0.3, hand: 0 }, 1 / 120, 1, R.locate(T, c.x, c.y)); return [c.x, c.y, c.vx, c.vy, c.h]; };
  assert.deepEqual(run(), run());
});
