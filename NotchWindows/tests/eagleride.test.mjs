// Eagle Ride's rules: steering, the rows always leaving a gap, gems, lives, the grace after a hit and the speed ramp.
// Run: node --test NotchWindows/tests
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const E = createRequire(import.meta.url)('../src/js/games/eagle-ride-logic.js');

const run = (g, seconds, dir, target) => { for (let t = 0; t < seconds; t += 1 / 60) E.step(g, 1 / 60, dir, target); };

test('a new game starts with three lives, no score and the eagle in the middle', () => {
  const g = E.createGame(1);
  assert.equal(g.lives, 3); assert.equal(g.x, 0); assert.equal(E.score(g), 0); assert.equal(g.over, false);
});

test('steering moves the eagle and it stops at the edges', () => {
  const g = E.createGame(2);
  E.step(g, 0.05, 1); assert.ok(Math.abs(g.x - 0.12) < 1e-9);
  run(g, 3, 1); assert.equal(g.x, 1);
  run(g, 3, -1); assert.equal(g.x, -1);
});

test('gliding towards a target (the mouse) arrives and stays', () => {
  const g = E.createGame(3);
  run(g, 2, 0, 0.5); assert.ok(Math.abs(g.x - 0.5) < 1e-9);
  run(g, 1, 0, 9); assert.equal(g.x, 1);                      // a target outside the field is clamped
});

test('a long frame does not skip through obstacles: time per step is capped', () => {
  const g = E.createGame(4);
  E.step(g, 5, 0); assert.ok(g.time <= 0.05 + 1e-9);
});

test('the same seed plays out the same way', () => {
  const a = E.createGame(7), b = E.createGame(7);
  run(a, 8, 0); run(b, 8, 0);
  assert.deepEqual(a.objects, b.objects);
});

test('every row leaves a clear corridor the eagle fits through, and the corridors can be followed', () => {
  for (let seed = 1; seed <= 40; seed++) {
    const g = E.createGame(seed);
    let prev = 0;
    for (let i = 0; i < 60; i++) {
      g.time = i * 2;                                           // densest rows
      const before = g.objects.length;
      E.spawnRow(g);
      const row = g.objects.slice(before).filter((o) => o.k !== 'gem');
      const gap = E.corridor(g);
      for (const o of row) assert.ok(Math.abs(o.x - gap) >= E.OBSTACLE_HALF[o.k] * o.size + E.PLAYER_HALF + 0.05, `seed ${seed} row ${i}`);
      assert.ok(Math.abs(gap - prev) <= E.GAP_STEP + 1e-9);
      assert.ok(gap >= -0.7 - 1e-9 && gap <= 0.7 + 1e-9);
      prev = gap;
    }
  }
});

test('an autopilot that follows the corridor never gets hit, however long it flies', () => {
  for (let seed = 1; seed <= 12; seed++) {
    const g = E.createGame(seed);
    for (let t = 0; t < 180; t += 1 / 60) {
      // aim for the corridor of the nearest row still ahead
      const ahead = g.objects.filter((o) => o.k !== 'gem' && o.z > E.HIT_Z).sort((a, b) => a.z - b.z)[0];
      let aim = 0;
      if (ahead) { const row = g.objects.filter((o) => o.k !== 'gem' && Math.abs(o.z - ahead.z) < 1e-6).map((o) => o.x); aim = corridorOf(row); }
      E.step(g, 1 / 60, 0, aim);
    }
    assert.equal(g.hits, 0, `seed ${seed}`);
    assert.ok(g.dist > 3000);
  }
});
// the middle of the widest free span among a row's obstacle positions (a stand-in for what a player sees)
function corridorOf(xs) {
  const pts = [-1.2, ...xs.slice().sort((a, b) => a - b), 1.2];
  let best = 0, bw = -1;
  for (let i = 0; i + 1 < pts.length; i++) { const w = pts[i + 1] - pts[i]; if (w > bw) { bw = w; best = (pts[i] + pts[i + 1]) / 2; } }
  return best;
}

test('flying into a tree costs a life, then you are safe for a moment', () => {
  const g = E.createGame(5);
  g.objects.push({ k: 'tree', x: 0, z: 0.05, size: 1 }, { k: 'tree', x: 0, z: 0.06, size: 1 });
  run(g, 0.2, 0);
  assert.equal(g.lives, 2); assert.ok(g.invuln > 0); assert.ok(g.events.includes('hit'));
  assert.equal(g.objects.filter((o) => o.k === 'tree' && o.z < 0.07 && o.z > -0.3).length, 1);   // the second one passed through harmlessly
});

test('an obstacle beside the eagle misses', () => {
  const g = E.createGame(6);
  g.objects.push({ k: 'rock', x: 0.6, z: 0.05, size: 1 });
  run(g, 0.3, 0); assert.equal(g.lives, 3);
});

test('gems score points and make a sound event', () => {
  const g = E.createGame(8);
  g.nextRow = 99;
  g.objects.push({ k: 'gem', x: 0.02, z: 0.05, size: 1 });
  run(g, 0.3, 0);
  assert.equal(g.gems, 1); assert.ok(g.events.includes('gem'));
  assert.equal(E.score(g), Math.floor(g.dist) + E.GEM_POINTS);
});

test('the third hit ends the game and nothing moves after that', () => {
  const g = E.createGame(9);
  g.nextRow = 99;
  for (let i = 0; i < 3; i++) { g.invuln = 0; g.objects.push({ k: 'tree', x: g.x, z: 0.04, size: 1 }); run(g, 0.1, 0); }
  assert.equal(g.lives, 0); assert.equal(g.over, true); assert.ok(g.events.includes('over'));
  const d = g.dist; run(g, 1, 1); assert.equal(g.dist, d);
});

test('the world speeds up, but never past the top speed, and rows come faster', () => {
  const g = E.createGame(10);
  g.nextRow = 1e9;
  const s0 = g.speed, r0 = E.rowSeconds(g);
  run(g, 20, 0); assert.ok(g.speed > s0);
  run(g, 120, 0); assert.equal(g.speed, E.SPEED_MAX);
  assert.ok(E.rowSeconds(g) < r0);
});

test('objects behind the eagle are dropped so a long run does not grow without end', () => {
  const g = E.createGame(11);
  g.invuln = 1e9;
  run(g, 120, 0);
  assert.ok(g.objects.length < 60);
});
