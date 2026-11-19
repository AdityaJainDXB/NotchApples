// Desert Heat: tests for the pure rules in games/desertheat/logic.js (car model, bridges, polylines, the sun).
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const L = require('../src/js/games/desertheat/logic.js');

const run = (car, secs, input) => { for (let t = 0; t < secs; t += 1 / 120) car.step(1 / 120, input); };

test('the saloon reaches 100 km/h in a believable time and tops out', () => {
  const car = new L.Car();
  let t = 0;
  while (car.speed * 3.6 < 100 && t < 30) { car.step(1 / 120, { throttle: 1 }); t += 1 / 120; }
  assert.ok(t > 7 && t < 14, `0-100 took ${t.toFixed(1)} s`);
  run(car, 60, { throttle: 1 });
  const top = car.speed * 3.6;
  assert.ok(top > 170 && top < 220, `top speed ${top.toFixed(0)} km/h`);
  assert.ok(car.gear >= 5, 'shifted up through the gears');
});

test('steering right turns the car clockwise (towards the east when facing north)', () => {
  const car = new L.Car();
  run(car, 3, { throttle: 0.5 });
  run(car, 2, { throttle: 0.3, steer: 1 });
  assert.ok(car.heading > 0.3, `heading ${car.heading}`);
  assert.ok(car.x > 0, 'moved east');
});

test('braking stops the car and does not roll it backwards; holding brake then reverses', () => {
  const car = new L.Car();
  run(car, 4, { throttle: 1 });
  let lowest = Infinity;
  for (let t = 0; t < 8 && car.gear !== -1; t += 1 / 120) { car.step(1 / 120, { brake: 1 }); lowest = Math.min(lowest, car.speed); }
  assert.ok(lowest > -0.6, `rolled backwards to ${lowest} before reverse engaged`);
  run(car, 3, { brake: 1 });
  assert.equal(car.gear, -1);
  assert.ok(car.speed < -1, `reversing at ${car.speed}`);
  run(car, 3, { throttle: 1 });
  assert.equal(car.gear, 1);
});

test('the hand brake makes the rear slide in a turn', () => {
  const a = new L.Car(), b = new L.Car();
  run(a, 5, { throttle: 1 }); run(b, 5, { throttle: 1 });
  run(a, 0.8, { steer: 1 }); run(b, 0.8, { steer: 1, handbrake: true });
  assert.ok(Math.abs(b.slipRear) > Math.abs(a.slipRear), 'more rear slip with the hand brake');
});

test('a wall stops the car going through it', () => {
  const car = new L.Car();
  car.vz = -20;
  const hit = car.hit(0, 1, 0.5);
  assert.ok(hit > 19);
  assert.ok(car.vz > 0, 'bounced back');
});

test('bridges ramp up from the ground and stay level where they join another bridge', () => {
  const p = []; for (let i = 0; i <= 40; i++) p.push(i * 10, 0);
  const free = L.bridgeHeights(p, 1, false, false);
  assert.equal(free[0], 0); assert.equal(free[40], 0);
  assert.ok(Math.abs(free[20] - L.DECK) < 1e-6);
  const joined = L.bridgeHeights(p, 1, true, false);
  assert.ok(Math.abs(joined[0] - L.DECK) < 1e-6); assert.equal(joined[40], 0);
  assert.equal(L.bridgeHeights(p, 0, false, false)[20], 0);
});

test('offset moves a north-bound line to the east when going right', () => {
  const o = L.offset([0, 0, 0, -10, 0, -20], 3);
  assert.ok(Math.abs(o[0] - 3) < 1e-9 && Math.abs(o[2] - 3) < 1e-9);
  const corner = L.offset([0, 0, 0, -10, 10, -10], 2);   // north then east: the corner point is pushed out diagonally
  assert.ok(corner[2] > 1.9 && corner[3] > -10);
});

test('pointAt walks along a polyline', () => {
  const p = [0, 0, 10, 0, 10, 10];
  const c = L.cumulative(p);
  const q = L.pointAt(p, c, 15);
  assert.ok(Math.abs(q.x - 10) < 1e-9 && Math.abs(q.z - 5) < 1e-9);
  assert.ok(Math.abs(q.dz - 1) < 1e-9);
});

test('the grid finds segments near a point', () => {
  const g = new L.Grid(50);
  g.addSegment(0, 0, 200, 0, 'a', 5);
  assert.deepEqual(g.query(120, 2), ['a']);
  assert.equal(g.query(120, 300).length, 0);
});

test('the sun is up at noon in the south, rises in the east and sets in the west', () => {
  const noon = L.sunAt(12, 323);
  assert.ok(noon.elevation > 35 && noon.elevation < 50, `noon elevation ${noon.elevation}`);
  assert.ok(noon.z > 0.5, 'south at noon');
  const morning = L.sunAt(7.5, 323), evening = L.sunAt(16.5, 323);
  assert.ok(morning.x > 0.5 && evening.x < -0.5, 'east in the morning, west in the evening');
  assert.ok(L.sunAt(0, 323).elevation < -30, 'down at midnight');
});
