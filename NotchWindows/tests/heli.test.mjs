// The Plane game's helicopters: the rotor lifts along the body's up axis, the collective is the throttle,
// the cyclic is a rate, and each helicopter should hover, climb, and translate without stalling.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

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

test('a pulse of cyclic flies the helicopter forward, and the disc comes back to level', () => {
  for (const h of HELIS) {
    const trim = 1.06 / h.rotorLift;
    const f = new Flight(h);
    f.reset([0, 400, 0], 0, 0, false, null);
    // A pilot pulses the cyclic to tilt the disc, then lets go: the helicopter leans into the acceleration
    // and keeps flying, and the disc returns to level as the trim settlement does its work.
    for (let i = 0; i < Math.round(60 * 1.5); i++) f.step(1 / 60, { ...idle, throttle: trim, pitch: -0.4 }, world);
    for (let i = 0; i < 60 * 12; i++) f.step(1 / 60, { ...idle, throttle: trim }, world);
    assert.ok(f.speed > 4, `${h.id} keeps flying forward (${f.speed.toFixed(1)} m/s)`);
    assert.ok(Math.abs(f.pitchAngle) < 10 * Math.PI / 180, `${h.id} settles level (${(f.pitchAngle * 57.3).toFixed(1)}°)`);
    assert.ok(Math.abs(f.bank) < 12 * Math.PI / 180, `${h.id} settles wings level`);
    assert.ok(Math.abs(f.pos[1] - 400) < 55, `${h.id} stays level within metres while translating (${f.pos[1].toFixed(1)})`);  // the extra translation lift carries it a little higher as it speeds up
    assert.ok(!f.stalled && !f.crashed, `${h.id} never stalls and stays in one piece`);
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
