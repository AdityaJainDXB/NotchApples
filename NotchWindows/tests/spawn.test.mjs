// Every aircraft must sit down on the runway cleanly when a flight starts: no impact, no damage, no bounce. (The bigger
// fighters used to be placed too high, because the spawn height ignored the model's scale, and hit the runway on spawn.)
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

let seed = 99;
Math.random = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
globalThis.window = globalThis;
globalThis.document = { getElementById: () => null };
createRequire(import.meta.url)('../src/js/games/plane-sim.js');
const G = globalThis.NotchPlaneGame;
const { Flight, PLANES } = G;
const T = G._test;
const world = T.makeWorld();

test('every fixed-wing aircraft settles on the runway with no impact, damage or bounce', () => {
  for (const p of PLANES.filter((x) => !x.rotor)) {
    const f = new Flight(p);
    const gy = T.groundAt(world, 0, 0);
    f.reset([0, gy + p.gear * (p.scale || 1), -30], 0, 0, true, null);
    for (let i = 0; i < 6 * 60; i++) f.step(1 / 60, { pitch: 0, roll: 0, yaw: 0, throttle: 0 }, world);
    assert.equal(f.crashed, false, `${p.id} did not crash`);
    assert.equal(f.events.length, 0, `${p.id} had no impact events (${f.events.map((e) => e.type)})`);
    assert.ok(f.damage.gear && f.damage.nose && f.damage.L && f.damage.R && f.damage.tail === 1, `${p.id} undamaged`);
    assert.ok(f.onGround, `${p.id} is on the ground`);
    assert.ok(Math.abs(f.pitchAngle) < 1.2 * Math.PI / 180, `${p.id} sits level (${(f.pitchAngle * 57.3).toFixed(1)}°)`);
    assert.ok(f.speed < 0.3, `${p.id} stays put`);
  }
});

test('every helicopter settles on its helipad too', () => {
  for (const p of PLANES.filter((x) => x.rotor)) {
    const f = new Flight(p);
    const gy = T.groundAt(world, -75, -170);
    f.reset([-75, gy + p.gear * (p.scale || 1) + 0.05, -170], 0, 0, true, null);
    for (let i = 0; i < 5 * 60; i++) { f.brake = true; f.step(1 / 60, { pitch: 0, roll: 0, yaw: 0, throttle: 0 }, world); f.park(); }   // the game holds the brake while the collective is down
    assert.equal(f.crashed, false, `${p.id} did not crash`);
    assert.equal(f.events.length, 0, `${p.id} had no impact events`);
    assert.ok(f.onGround && f.speed < 0.5, `${p.id} sits still`);
  }
});

test('every apron is paved, so the nose wheel never digs in there', () => {
  for (const r of T.APRONS) assert.equal(T.surfaceAt(world, (r[0] + r[1]) / 2, (r[2] + r[3]) / 2), 'runway');
});

test('the autopilot turns to a new heading and holds a new height', () => {
  for (const id of ['c172', 'a320']) {
    const p = PLANES.find((q) => q.id === id), f = new Flight(p);
    f.reset([2000, 1500, 11000], 0, p.cruise, false, 0);
    for (let i = 0; i < 20 * 60; i++) f.step(1 / 60, { pitch: 0, roll: 0, yaw: 0, throttle: 0.7 }, world);
    assert.ok(f.apEngage(), 'engages in the air');
    f.ap.hdg += 0.5; f.ap.alt += 100;
    for (let i = 0; i < 60 * 60; i++) f.step(1 / 60, { pitch: 0, roll: 0, yaw: 0, throttle: 0.7 }, world);
    const he = Math.atan2(Math.sin(f.ap.hdg - f.heading), Math.cos(f.ap.hdg - f.heading));
    assert.ok(!f.crashed && Math.abs(he) < 0.06, `${id} heading held (${he})`);
    assert.ok(Math.abs(f.ap.alt - f.pos[1]) < 25, `${id} height held`);
  }
});

test('the ILS approach mode brings an aircraft down the glideslope onto the runway centre line', () => {
  for (const id of ['c172', 'a320']) {
    const p = PLANES.find((q) => q.id === id), f = new Flight(p);
    // 9 km out from the home runway's south threshold, 250 m left of the course, 560 m up (a bit above the 3 degree slope).
    f.reset([-250, 560, 9000], 0, p.stall * 1.5, false, 0);
    for (let i = 0; i < 5 * 60; i++) f.step(1 / 60, { pitch: 0, roll: 0, yaw: 0, throttle: 0.5 }, world);
    assert.ok(T.ilsAt(world, f.pos, p.gear), `${id} sees the ILS`);
    assert.ok(f.apApproach(world), `${id} arms the approach`);
    let done = false;
    for (let i = 0; i < 300 * 60 && !f.crashed; i++) {
      f.step(1 / 60, { pitch: 0, roll: 0, yaw: 0, throttle: 0.5 }, world);
      if (f.events.some((e) => e.type === 'apils' && e.done)) { done = true; break; }
      f.events.length = 0;
    }
    assert.ok(done && !f.crashed, `${id} reached the hand-over`);
    assert.ok(Math.abs(f.pos[0]) < 25, `${id} on the centre line (x=${f.pos[0].toFixed(0)})`);
    assert.ok(f.pos[2] > -100 && f.pos[2] < 1800, `${id} short of the runway end (z=${f.pos[2].toFixed(0)})`);
  }
});
