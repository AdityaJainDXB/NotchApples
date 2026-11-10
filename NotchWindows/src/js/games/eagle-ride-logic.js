// Eagle Ride: the rules, with no screen. You are an eagle gliding forward over a valley. Steer left and right, dodge the trees and
// rocks coming at you and grab the gems. Three lives; the world speeds up the longer you last.
// Shared by the Mac and Windows apps (the game itself is eagle-ride.js) and tested in Node (NotchWindows/tests/eagleride.test.mjs).
//
// The play field: x runs -1 (far left) .. 1 (far right). Everything ahead has a depth z: 0 is the eagle's own line, 1 is the horizon.
// Every row of obstacles always leaves a gap you can fly through, and the next gap is never too far from the last one to reach.
(function () {
  'use strict';
  const LIVES = 3;
  const PLAYER_HALF = 0.09;            // half the eagle's width, in x
  const HIT_Z = 0.035;                 // an object whose depth crosses this has reached the eagle
  const OBSTACLE_HALF = { tree: 0.15, rock: 0.12 };
  const GEM_HALF = 0.14;
  const GEM_POINTS = 25;
  const STEER = 2.4;                   // x per second at full stick
  const INVULN = 1.6;                  // seconds of grace after a hit
  const SPEED0 = 0.30, SPEED_MAX = 0.80, SPEED_RAMP = 0.012;   // depth per second: it starts gentle and tops out
  const ROW_SECONDS = 1.05;            // time between rows at the start; shrinks to ROW_MIN
  const ROW_MIN = 0.62;
  const GAP_HALF = 0.30;               // half the clear corridor kept free in every row
  const GAP_STEP = 0.7;                // the next row's corridor is within this of the last one

  // A small seeded random generator so a run can be replayed in tests.
  function rng(seed) {
    let a = (seed >>> 0) || 1;
    return function () {
      a = (a + 0x6D2B79F5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

  function createGame(seed) {
    const g = {
      rand: rng(seed == null ? (Date.now() & 0xffffffff) : seed),
      x: 0, vx: 0,
      dist: 0, gems: 0, lives: LIVES, hits: 0,
      speed: SPEED0, time: 0,
      invuln: 0, over: false,
      objects: [],                       // { k: 'tree'|'rock'|'gem', x, z, size }
      nextRow: 0.4,                      // seconds until the next row appears
      gapC: 0,
      score: 0,
      events: [],                        // 'gem' | 'hit' | 'over', for the screen to play sounds and shake; drained by the caller
    };
    return g;
  }

  function score(g) { return Math.floor(g.dist) + g.gems * GEM_POINTS; }
  function rowSeconds(g) { return Math.max(ROW_MIN, ROW_SECONDS - g.time * 0.008); }

  // Adds one row: a clear corridor around gapC, trees and rocks elsewhere, and now and then a gem in or beside the corridor.
  function spawnRow(g) {
    const r = g.rand;
    g.gapC = clamp(g.gapC + (r() * 2 - 1) * GAP_STEP, -0.7, 0.7);
    const density = Math.min(0.75, 0.35 + g.time * 0.006);
    for (let x = -1; x <= 1.0001; x += 0.3) {
      if (Math.abs(x - g.gapC) < GAP_HALF + 0.15) continue;
      if (r() < density) {
        const rock = r() < 0.3;
        g.objects.push({ k: rock ? 'rock' : 'tree', x: clamp(x + (r() - 0.5) * 0.1, -1, 1), z: 1, size: 0.85 + r() * 0.4 });
      }
    }
    if (r() < 0.55) g.objects.push({ k: 'gem', x: clamp(g.gapC + (r() - 0.5) * 0.5, -0.95, 0.95), z: 1, size: 1 });
  }

  // Advances the game by dt seconds. dir is the steering: -1 (left) .. 1 (right), a number; or null. target (optional, -1..1) is a
  // position the eagle glides towards (the mouse or a finger) and wins over dir when given.
  function step(g, dt, dir, target) {
    if (g.over) return;
    dt = Math.min(dt, 0.05);           // a long frame (the notch was hidden) must not skip through obstacles
    g.time += dt;
    g.speed = Math.min(SPEED_MAX, SPEED0 + g.time * SPEED_RAMP);
    g.dist += g.speed * 60 * dt;       // metres: about 20 per second at the start

    // Steering
    const before = g.x;
    if (typeof target === 'number') {
      const want = clamp(target, -1, 1) - g.x;
      g.x += clamp(want, -STEER * dt, STEER * dt);
    } else if (dir) {
      g.x += clamp(dir, -1, 1) * STEER * dt;
    }
    g.x = clamp(g.x, -1, 1);
    g.vx = dt > 0 ? (g.x - before) / dt : 0;
    if (g.invuln > 0) g.invuln = Math.max(0, g.invuln - dt);

    g.nextRow -= dt;
    if (g.nextRow <= 0) { spawnRow(g); g.nextRow += rowSeconds(g); }

    for (let i = g.objects.length - 1; i >= 0; i--) {
      const o = g.objects[i];
      const prev = o.z;
      o.z -= g.speed * dt;
      if (prev > HIT_Z && o.z <= HIT_Z) {                 // it has just reached the eagle's line
        const half = o.k === 'gem' ? GEM_HALF : OBSTACLE_HALF[o.k] * o.size;
        if (Math.abs(o.x - g.x) < half + PLAYER_HALF) {
          if (o.k === 'gem') { g.gems++; g.events.push('gem'); g.objects.splice(i, 1); continue; }
          if (g.invuln <= 0) {
            g.lives--; g.hits++; g.invuln = INVULN; g.events.push('hit');
            if (g.lives <= 0) { g.over = true; g.events.push('over'); }
            g.objects.splice(i, 1); continue;
          }
        }
      }
      if (o.z < -0.25) g.objects.splice(i, 1);            // well behind us
    }
    g.score = score(g);
  }

  // Which obstacle rows are blocked? Used by the tests (and a demo autopilot): the x of the clear corridor of the nearest row.
  function corridor(g) { return g.gapC; }

  const api = { LIVES, PLAYER_HALF, HIT_Z, OBSTACLE_HALF, GEM_HALF, GEM_POINTS, STEER, INVULN, GAP_HALF, GAP_STEP, SPEED0, SPEED_MAX, rng, createGame, spawnRow, step, score, rowSeconds, corridor };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (typeof window !== 'undefined') window.NotchEagleLogic = api;
})();
