// The Plane game's helicopters: the rotor lifts along the body's up axis, the collective is the throttle,
// the cyclic is a rate, and each helicopter should hover, climb, and translate without stalling.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

// The simulation draws gusts from Math.random; a seeded generator keeps these tests repeatable.
let seed = 20261013;
Math.random = () => { seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
globalThis.window = globalThis;
globalThis.document = { getElementById: () => null };
createRequire(import.meta.url)('../src/js/games/plane-sim.js');
const G = globalThis.NotchPlaneGame;
const { Flight, PLANES } = G;
const T = G._test;
const makeWorld = T.makeWorld;

const HELIS = PLANES.filter((p) => p.rotor);
const world = makeWorld();
const idle = { pitch: 0, roll: 0, yaw: 0, throttle: 0 };
const fly = (p, input, seconds, dt = 1 / 60, y0 = 400) => {
  const f = new Flight(p);
  f.reset([0, y0, 0], 0, 0, false, null);
  for (let t = 0; t < Math.round(seconds / dt); t++) f.step(dt, input, world);
  return f;
};

test('three helicopters are in the roster, in their own category', () => {
  assert.equal(HELIS.length, 3);
  assert.deepEqual(HELIS.map((h) => h.id), ['r44', 'b206', 'ah64']);
  for (const h of HELIS) {
    assert.equal(h.cat, 'rotary');
    assert.ok(h.rotorLift > 1 && h.thrust === 0, `${h.id}: the rotor carries the weight alone`);
    assert.ok(h.nose < 0 && h.tail > 0, `${h.id}: a fuselage from nose to tail`);
  }
});

test('full collective climbs, and partial collective holds the hover: the rotor carries the weight', () => {
  for (const h of HELIS) {
    // Throttle is the collective, and it goes where the key puts it. Climbing is just "more than the hover";
    // the hover itself sits a fraction above one-over-lift because the air is thin and the rotor is quick.
    const climb = fly(h, { ...idle, throttle: 1 }, 12);
    assert.ok(climb.pos[1] > 415, `${h.id} climbs at full collective (+${(climb.pos[1] - 400).toFixed(1)} m)`);
    const hover = fly(h, { ...idle, throttle: 1.06 / h.rotorLift }, 14);
    assert.ok(Math.abs(hover.pos[1] - 400) < 25, `${h.id} holds its height at the hover (${hover.pos[1].toFixed(1)})`);
    assert.ok(Math.abs(hover.vel[1]) < 3, `${h.id} is settled, not still climbing (${hover.vel[1].toFixed(2)} m/s)`);
  }
});

test('holding the cyclic forward flies the helicopter forward at a steady lean, and letting go brings it level', () => {
  for (const h of HELIS) {
    const trim = 1.06 / h.rotorLift;
    const f = new Flight(h);
    f.reset([0, 400, 0], 0, 0, false, null);
    for (let i = 0; i < 60 * 5; i++) f.step(1 / 60, { ...idle, throttle: trim, pitch: -0.6 }, world);
    assert.ok(f.speed > 5, `${h.id} flies forward (${f.speed.toFixed(1)} m/s)`);
    assert.ok(-f.vel[2] > 4, `${h.id} goes towards its nose (the nose points to -z): vz ${f.vel[2].toFixed(1)}`);
    assert.ok(f.pitchAngle < -8 * Math.PI / 180 && f.pitchAngle > -30 * Math.PI / 180, `${h.id} leans steadily, not further and further (${(f.pitchAngle * 57.3).toFixed(1)}°)`);
    for (let i = 0; i < 60 * 14; i++) f.step(1 / 60, { ...idle, throttle: trim }, world);
    assert.ok(Math.abs(f.pitchAngle) < 6 * Math.PI / 180, `${h.id} settles level (${(f.pitchAngle * 57.3).toFixed(1)}°)`);
    assert.ok(Math.abs(f.bank) < 6 * Math.PI / 180, `${h.id} stays wings level`);
    assert.ok(!f.stalled && !f.crashed, `${h.id} never stalls and stays in one piece`);
  }
});

test('the stick leans the right way: roll right banks right and slides right, pedals right turn right', () => {
  for (const h of HELIS) {
    const trim = 1.06 / h.rotorLift;
    const r = fly(h, { ...idle, throttle: trim, roll: 1 }, 3);
    assert.ok(r.bank > 10 * Math.PI / 180, `${h.id} banks right with roll right (bank ${(r.bank * 57.3).toFixed(1)}°)`);
    assert.ok(r.vel[0] > 1, `${h.id} slides to the right (vx ${r.vel[0].toFixed(1)})`);
    const y = fly(h, { ...idle, throttle: trim, yaw: 1 }, 2);
    assert.ok(y.heading > 0.3, `${h.id} turns right with the right pedal`);
    assert.ok(y.heading < 1.6, `${h.id} turns at a controllable rate (${(y.heading * 57.3 / 2).toFixed(0)}°/s)`);
  }
});

test('a collective left where it is holds the height (the rotor damps vertical motion)', () => {
  for (const h of HELIS) {
    const hover = fly(h, { ...idle, throttle: 1.06 / h.rotorLift }, 20);
    assert.ok(Math.abs(hover.vel[1]) < 1.5, `${h.id} holds its height (vy ${hover.vel[1].toFixed(2)})`);
    const up = fly(h, { ...idle, throttle: 1.35 / h.rotorLift }, 8);
    assert.ok(up.vel[1] > 1 && up.vel[1] < 8, `${h.id} climbs at a steady, modest rate (${up.vel[1].toFixed(1)} m/s)`);
  }
});

test('the pedals yaw the tail rotor, and a level helicopter rolls with the cyclic', () => {
  const h = HELIS[0];
  const straight = fly(h, { ...idle, throttle: 0.8 }, 4);
  const yawed = fly(h, { ...idle, throttle: 0.8, yaw: 1 }, 2);
  assert.notEqual(straight.heading, yawed.heading, 'the pedals turn the nose');
  const banked = fly(h, { ...idle, throttle: 0.8 / h.rotorLift, roll: 1 }, 1);
  assert.ok(Math.abs(banked.bank) > 0.1, 'the cyclic banks it');
});

test('every helicopter builds a mesh with two spinning rotors', () => {
  for (const h of HELIS) {
    const m = T.buildPlane(h.id);
    assert.ok(m.body.d.length > 5000, `${h.id} has geometry`);
    assert.equal((m.rotors || []).length, 2, `${h.id} has a main and a tail rotor`);
    for (const r of m.rotors || []) {
      assert.equal(r.axis.length, 3);
      assert.ok(r.mesh.d.length > 100, 'a rotor has blades');
    }
    assert.ok((m.gears || []).length > 0, `${h.id} stands on gear`);
  }
});

test('the emergency landing assist brings every helicopter down gently and then gives the controls back', () => {
  const starts = { hover: () => {}, fast: (f) => { f.vel = [0, 0, -40]; }, sinking: (f) => { f.vel = [0, -6, -20]; } };
  for (const h of HELIS) {
    for (const [name, setup] of Object.entries(starts)) {
      const f = new Flight(h);
      f.reset([0, 300, 0], 0, 0, false, null);
      setup(f);
      assert.ok(f.emergencyOn(), `${h.id}: the assist can be switched on in the air`);
      let touch = null;
      for (let t = 0; t < 60 * 240 && f.emergency && !f.crashed; t++) {
        f.step(1 / 60, { ...idle, throttle: 0.2 }, world);
        if (f.onGround && touch == null) touch = f.vel[1];
      }
      assert.ok(!f.crashed, `${h.id} (${name}) lands in one piece`);
      assert.ok(touch != null && touch > -1.5, `${h.id} (${name}) touches down gently (${touch?.toFixed(2)} m/s)`);
      assert.equal(f.emergency, false, `${h.id} (${name}) hands the controls back once it has stopped`);
      assert.ok(Math.abs(f.pitchAngle) < 10 * Math.PI / 180 && Math.abs(f.bank) < 10 * Math.PI / 180, `${h.id} (${name}) sits level`);
    }
  }
});

test('the assist is for helicopters in the air, and can be cancelled', () => {
  const plane = new Flight(PLANES.find((p) => !p.rotor));
  plane.reset([0, 300, 0], 0, 60, false, null);
  assert.equal(plane.emergencyOn(), false, 'an aeroplane has no such assist');
  const f = new Flight(HELIS[0]);
  f.reset([0, 300, 0], 0, 0, false, null);
  f.emergencyOn(); f.emergencyOff();
  assert.equal(f.emergency, false);
});
