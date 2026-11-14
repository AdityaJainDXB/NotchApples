// F1 aero: density, quadratic forces, ground effect and porpoising, dirty air, DRS and active aero, zones. Run: node --test NotchWindows/tests
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const A = require('../src/js/games/f1/aero.js'), E = require('../src/js/games/f1/era.js');
const era25 = E.getEra('2025'), era26 = E.getEra('ERA_2026');

/// Run the car at a constant speed for `secs` and return the last output (and the ride heights along the way).
function run(v, secs, opt = {}, hz = 120) {
  const s = A.createAero(opt.setup || {}), dt = 1 / hz, hs = [];
  let out;
  for (let t = 0; t < secs; t += dt) { out = A.step(s, { v, rho: opt.rho || 1.225, massKg: 800, setup: opt.setup || { rideHeightMm: 34 }, era: opt.era || era25, open: opt.open, gapS: opt.gapS, damage: opt.damage }, dt); hs.push(s.h); }
  return { out, s, hs };
}

test('air density falls with altitude and rises with cold, following the standard atmosphere', () => {
  const sea = A.airDensity(0, 15), mexico = A.airDensity(2240, 20), cold = A.airDensity(0, 0), hot = A.airDensity(0, 40);
  assert.ok(Math.abs(sea - 1.225) < 0.005, `sea level ${sea}`);
  assert.ok(mexico < sea * 0.82 && mexico > sea * 0.72, `Mexico City ${mexico.toFixed(3)}`);
  assert.ok(cold > sea && hot < sea);
});

test('downforce and drag grow with the square of speed and with air density', () => {
  const a = run(40, 3).out, b = run(80, 3).out;
  // the car squats lower at speed so the floor works harder: drag is exactly v squared, downforce a little more than v squared
  assert.ok(Math.abs(b.dragN / a.dragN - 4) < 0.01, `drag ratio ${(b.dragN / a.dragN).toFixed(3)}`);
  assert.ok(b.downforceN / a.downforceN > 3.8 && b.downforceN / a.downforceN < 5.4, `downforce ratio ${(b.downforceN / a.downforceN).toFixed(2)}`);
  const thin = run(80, 3, { rho: A.airDensity(2240, 20) }).out, thick = run(80, 3).out;
  assert.ok(Math.abs(thin.dragN / thick.dragN - A.airDensity(2240, 20) / 1.225) < 0.01, 'drag is proportional to the air density');
  assert.ok(thin.downforceN < thick.downforceN * 0.85);
  // a sensible F1 number: at 80 m/s the car makes about twice its weight in downforce
  assert.ok(thick.downforceN > 1.5 * 800 * 9.81 && thick.downforceN < 2.6 * 800 * 9.81, `downforce at 80 m/s: ${(thick.downforceN / 1000).toFixed(1)} kN`);
});

test('the underbody makes about half the downforce, and a lower floor makes more until it stalls', () => {
  assert.ok(Math.abs(A.AERO.share.floor - 0.55) < 0.06, 'the floor share is 50 to 60 percent');
  const f = A.floorFactor;
  assert.ok(f(28) > f(32) && f(32) > f(36), 'lower is more downforce');
  assert.ok(Math.abs(f(32) - 1) < 1e-9, 'the reference height is 1');
  assert.ok(f(18) < f(24), 'below the critical height the airflow stalls and the downforce falls');
  assert.ok(f(14) < f(21) * 0.9);
});

test('porpoising: a normal ride height is steady, a too low one bounces at speed, and it needs speed', () => {
  const ok = run(85, 6, { setup: { rideHeightMm: 36 } }), low = run(85, 6, { setup: { rideHeightMm: 29 } }), slow = run(40, 6, { setup: { rideHeightMm: 27 } });
  const spread = (r) => { const t = r.hs.slice(Math.floor(r.hs.length / 2)); return Math.max(...t) - Math.min(...t); };
  assert.ok(spread(ok) < 0.6 && ok.out.porpoise < 0.1, `normal height moved ${spread(ok).toFixed(2)} mm`);
  assert.ok(spread(low) > 2 && low.out.porpoise > 0.3, `low height swung ${spread(low).toFixed(2)} mm`);
  assert.ok(slow.out.porpoise < 0.05 && !slow.out.stalled, 'not enough speed to porpoise');
  // the bounce is a vertical oscillation: the height crosses its mean many times
  const t = low.hs.slice(Math.floor(low.hs.length / 2)), mean = t.reduce((a, b) => a + b, 0) / t.length;
  let crossings = 0; for (let i = 1; i < t.length; i++) if ((t[i - 1] - mean) * (t[i] - mean) < 0) crossings++;
  assert.ok(crossings >= 10, `${crossings} crossings in ${(t.length / 120).toFixed(1)} s`);
});

test('the ride-height model is frame-rate independent', () => {
  for (const setup of [{ rideHeightMm: 36 }, { rideHeightMm: 29 }]) {
    const a = run(85, 4, { setup }, 60), b = run(85, 4, { setup }, 120), c = run(85, 4, { setup }, 240);
    assert.ok(Math.abs(a.out.downforceN - b.out.downforceN) / b.out.downforceN < 0.03, `60 vs 120 Hz: ${a.out.downforceN.toFixed(0)} vs ${b.out.downforceN.toFixed(0)}`);
    assert.ok(Math.abs(c.out.downforceN - b.out.downforceN) / b.out.downforceN < 0.03);
  }
});

test('dirty air takes 15 to 35 percent of the front downforce within 1.5 s, more the closer, and nothing beyond it', () => {
  assert.equal(A.dirtyAirLoss(1.6), 0); assert.equal(A.dirtyAirLoss(null), 0);
  for (const gap of [0.05, 0.3, 0.6, 1.0, 1.3]) { const l = A.dirtyAirLoss(gap); assert.ok(l >= 0.15 - 1e-9 && l <= 0.35 + 1e-9, `gap ${gap}: ${l.toFixed(3)}`); }
  assert.ok(A.dirtyAirLoss(0.2) > A.dirtyAirLoss(0.8) && A.dirtyAirLoss(0.8) > A.dirtyAirLoss(1.3), 'monotonic in the gap');
  assert.ok(A.dirtyAirLoss(1.49) < 0.05 && A.dirtyAirLoss(1.5) === 0, 'it fades in, there is no step at the edge');
  const clean = run(70, 2).out, dirty = run(70, 2, { gapS: 0.3 }).out;
  assert.ok(dirty.understeer > clean.understeer + 0.05, 'following a car induces understeer');
  assert.ok(dirty.frontLoss > 0.3 && dirty.frontShare < clean.frontShare, 'the front axle loses load');
  assert.ok(dirty.downforceN < clean.downforceN && dirty.dragN < clean.dragN, 'less downforce and (the slipstream) less drag');
});

test('2025 DRS opens a flap for less drag; 2026 X-mode flattens both wings for much less', () => {
  const closed = run(70, 2, { era: era25 }).out, drs = run(70, 2, { era: era25, open: true }).out;
  const z = run(70, 2, { era: era26 }).out, x = run(70, 2, { era: era26, open: true }).out;
  assert.ok(Math.abs(drs.dragN / closed.dragN - era25.aeroEffect.dragK) < 0.01);
  assert.ok(Math.abs(x.dragN / z.dragN - era26.aeroEffect.dragK) < 0.01);
  assert.ok(x.dragN / z.dragN < drs.dragN / closed.dragN, 'X-mode cuts more drag than DRS');
  assert.ok(x.downK < z.downK && drs.downK < closed.downK, 'less downforce with the wings open');
  // the flap takes a moment
  const s = A.createAero(); const o = A.step(s, { v: 70, rho: 1.225, era: era25, open: true }, 0.05);
  assert.ok(o.flap > 0 && o.flap < 0.5, `flap after 50 ms: ${o.flap}`);
});

test('wing angle trades front downforce for drag, and a broken front wing and floor cost grip and add understeer', () => {
  const base = run(70, 2).out, more = run(70, 2, { setup: { rideHeightMm: 34, frontWing: 5 } }).out, wing = run(70, 2, { damage: { frontWing: 0.8 } }).out, floor = run(70, 2, { damage: { floor: 0.8 } }).out;
  assert.ok(more.dragN > base.dragN && more.frontShare > base.frontShare);
  assert.ok(wing.understeer > base.understeer + 0.2 && wing.downK < base.downK);
  assert.ok(floor.downforceN < base.downforceN * 0.8, 'floor damage is a big downforce loss');
});

test('DRS and active-aero zones are the long straights, and the rules for opening the wings', () => {
  // a stadium: two 800 m straights joined by two bends
  const step = 4, S = []; let s = 0;
  const add = (n, k) => { for (let i = 0; i < n; i++) { S.push({ k, s }); s += step; } };
  add(200, 0); add(80, 0.01); add(200, 0); add(80, 0.01);
  const T = { S, step, length: S.length * step, closed: true };
  const zones = A.findZones(T);
  assert.equal(zones.length, 2, `two straights, got ${zones.length}`);
  assert.ok(zones.every((z) => z.len >= 780 && z.detS >= 0), 'each is the whole straight and has a detection point before it');
  assert.ok(A.inZone(zones, 400) && !A.inZone(zones, 900));
  const ok = { zone: true, inPit: false, flagOk: true, lap: 2, gapAtDetectionS: 0.8 };
  assert.equal(A.drsAllowed(ok), true);
  for (const bad of [{ gapAtDetectionS: 1.2 }, { zone: false }, { flagOk: false }, { inPit: true }, { lap: 0 }, { gapAtDetectionS: null }]) assert.equal(A.drsAllowed({ ...ok, ...bad }), false, JSON.stringify(bad));
  // 2026: any gap is fine, but only in a zone on a green track
  assert.equal(A.activeAeroAllowed({ ...ok, gapAtDetectionS: 9 }), true);
  assert.equal(A.activeAeroAllowed({ ...ok, zone: false }), false);
  assert.equal(A.wingOpenAllowed(era25, { ...ok, gapAtDetectionS: 9 }), false);
  assert.equal(A.wingOpenAllowed(era26, { ...ok, gapAtDetectionS: 9 }), true);
  // an open track: a short straight does not count
  const open = A.findZones({ S: S.slice(0, 120), step, length: 480, closed: false });
  assert.equal(open.length, 1); assert.equal(A.findZones({ S: S.slice(0, 50), step, length: 200, closed: false }).length, 0);
});
