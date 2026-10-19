// Air War: bombs, bullets, missiles and the computer pilots' steering. Run: node --test NotchWindows/tests
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

globalThis.window = globalThis;
globalThis.document = { getElementById: () => null };
createRequire(import.meta.url)('../src/js/games/plane-sim.js');
const { WAR } = globalThis.NotchPlaneGame._test;
const flat = () => 0;
const len = (a) => Math.hypot(a[0], a[1], a[2]);

test('a bomb dropped from 1000 m takes a little longer than a stone and lands short of the straight line', () => {
  const hit = WAR.impactPoint([0, 1000, 0], [0, 0, -120], flat);
  const freeFall = Math.sqrt(2 * 1000 / WAR.G);        // 14.3 s with no air
  assert.ok(hit.t > freeFall - 0.2 && hit.t < freeFall + 2.5, `fall time ${hit.t}`);
  assert.ok(-hit.pos[2] < 120 * hit.t, 'air drag slows its forward travel');
  assert.ok(-hit.pos[2] > 120 * hit.t * 0.8, 'but not by much');
  assert.ok(Math.abs(hit.pos[1]) < 0.5, 'it lands on the ground');
});

test('a bomb falls faster than a plane flies, but never past its terminal speed', () => {
  const b = { pos: [0, 6000, 0], vel: [0, 0, 0], t: 0 };
  let top = 0;
  for (let i = 0; i < 4000 && b.pos[1] > 0; i++) { WAR.bombStep(b, 0.02); top = Math.max(top, len(b.vel)); }
  assert.ok(top > 200 && top < 340, `peak speed ${top}`);
});

test('the bombsight predicts exactly where the bomb then lands, and the wind moves it', () => {
  const pos = [0, 800, 0], vel = [60, -10, -150];
  const predicted = WAR.impactPoint(pos, vel, flat);
  const b = { pos: pos.slice(), vel: vel.slice(), t: 0 };
  while (b.pos[1] > 0) WAR.bombStep(b, 0.05);
  assert.ok(Math.hypot(b.pos[0] - predicted.pos[0], b.pos[2] - predicted.pos[2]) < 12, 'the marker is where it lands');
  const windy = WAR.impactPoint(pos, vel, flat, [20, 0, 0]);
  assert.ok(windy.pos[0] > predicted.pos[0] + 30, 'a wind from the west carries it east');
});

test('a bomb dropped onto a hill lands on the hill, not on the plain below', () => {
  const hill = (x, z) => (z < -400 ? 150 : 0);
  const hit = WAR.impactPoint([0, 600, 0], [0, 0, -100], hill);
  assert.ok(Math.abs(hit.pos[1] - 150) < 1 || hit.pos[2] > -400);
});

test('a blast is full strength at the centre, fades with distance and stops at its edge', () => {
  assert.equal(WAR.blastDamage(0), WAR.BOMB.dmg);
  assert.ok(WAR.blastDamage(10) > WAR.blastDamage(20));
  assert.ok(WAR.blastDamage(20) > WAR.blastDamage(40));
  assert.equal(WAR.blastDamage(WAR.BOMB.R), 0);
  assert.equal(WAR.blastDamage(100), 0);
  // A tank (120 hp) is destroyed by a bomb that lands within about 13 m, but not by one 30 m away.
  assert.ok(WAR.blastDamage(12) >= 120);
  assert.ok(WAR.blastDamage(30) < 120);
});

test('a bullet drops and slows over a long shot', () => {
  const b = { pos: [0, 100, 0], vel: [0, 0, -WAR.GUN.speed], t: 0 };
  for (let i = 0; i < 100; i++) WAR.bulletStep(b, 0.01);        // one second
  assert.ok(b.pos[1] < 100 - 4 && b.pos[1] > 100 - 7, `drop ${100 - b.pos[1]}`);          // about g/2 metres
  assert.ok(-b.vel[2] < WAR.GUN.speed && -b.vel[2] > WAR.GUN.speed * 0.95);
});

test('a fast bullet is caught by a segment test even when it jumps over the target in one step', () => {
  assert.ok(WAR.segHit([0, 0, 0], [0, 0, -9], [0.5, 0, -4.5], 1));
  assert.ok(!WAR.segHit([0, 0, 0], [0, 0, -9], [5, 0, -4.5], 1));
  assert.ok(!WAR.segHit([0, 0, 0], [0, 0, -9], [0, 0, -12], 1));
});

test('the lead point puts a shot where a moving target will be', () => {
  const lead = WAR.leadPoint([0, 0, 0], [0, 0, 0], [800, 0, 0], [0, 0, -200], 900);
  assert.ok(lead && lead.t > 0.8 && lead.t < 1.3);
  assert.ok(Math.abs(len(lead.point) - 900 * lead.t) < 1, 'the shot arrives as the target does');
  assert.ok(lead.point[2] < -150, 'ahead of the target, not at it');
  assert.equal(WAR.leadPoint([0, 0, 0], [0, 0, 0], [800, 0, 0], [2000, 0, 0], 900), null, 'a target that outruns the shot cannot be led');
});

function fly(m, target, secs, step = 0.01) {
  let best = Infinity;
  for (let i = 0; i < secs / step; i++) {
    if (target.vel) target.pos = [target.pos[0] + target.vel[0] * step, target.pos[1] + target.vel[1] * step, target.pos[2] + target.vel[2] * step];
    WAR.missileStep(m, target, step);
    best = Math.min(best, len([m.pos[0] - target.pos[0], m.pos[1] - target.pos[1], m.pos[2] - target.pos[2]]));
  }
  return best;
}

test('a missile finds a target that is sitting still, off to one side', () => {
  const m = { pos: [0, 0, 0], vel: [0, 0, -250], t: 0 };
  assert.ok(fly(m, { pos: [900, 60, -3000], vel: [0, 0, 0] }, 14) < 15);
});

test('a missile finds an aircraft crossing in front of it', () => {
  const m = { pos: [0, 0, 0], vel: [0, 0, -250], t: 0 };
  assert.ok(fly(m, { pos: [-1200, 80, -2600], vel: [200, 0, 0] }, 14) < 20);
});

test('a missile with no target flies straight', () => {
  const m = { pos: [0, 0, 0], vel: [0, 0, -250], t: 0 };
  for (let i = 0; i < 200; i++) WAR.missileStep(m, null, 0.01);
  assert.ok(Math.abs(m.pos[0]) < 1e-6 && Math.abs(m.pos[1]) < 1e-6 && m.pos[2] < -500);
});

test('a computer pilot turns the short way round and does not turn faster than it can', () => {
  const a = { pos: [0, 500, 0], heading: 0, pitch: 0, speed: 200, bank: 0, vel: [0, 0, 0] };
  WAR.steer(a, [1, 0, 0], 0.5, 1);                        // want due east: a right turn
  assert.ok(a.heading > 0.45 && a.heading <= 0.5 + 1e-9, `turned ${a.heading}`);
  const b = { pos: [0, 500, 0], heading: 3.0, pitch: 0, speed: 200, bank: 0, vel: [0, 0, 0] };
  WAR.steer(b, [-1, 0, -0.01], 0.5, 1);                    // want west from a southerly heading: round the left
  assert.ok(Math.abs(WAR.wrap(b.heading - 3.0)) > 0.4, 'it moved');
});

test('a pilot chasing a target ends up pointing at it', () => {
  const a = { pos: [0, 800, 0], heading: 0, pitch: 0, speed: 200, bank: 0, vel: [0, 0, 0] };
  const tgt = [3000, 900, 2000];
  for (let i = 0; i < 400; i++) {
    const want = [tgt[0] - a.pos[0], tgt[1] - a.pos[1], tgt[2] - a.pos[2]];
    WAR.steer(a, want, 0.02, 0.9);
  }
  assert.ok(WAR.offBore(a, tgt) < 0.1);
});
