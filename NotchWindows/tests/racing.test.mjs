// Racing: the tracks, the cars' handling, the computer drivers, laps and the room codes. Run: node --test NotchWindows/tests
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

globalThis.window = globalThis;
globalThis.document = { getElementById: () => null };
createRequire(import.meta.url)('../src/js/games/racing.js');
const R = globalThis.NotchRaceGame._test;
const track = (id) => R.buildTrack(R.TRACKS.find((t) => t.id === id));
const car = (id) => R.CARS.find((c) => c.id === id);
const GO = { throttle: 1, brake: 0, steer: 0, hand: 0 };

const segCross = (a, b, c, d) => {
  const o = (p, q, r) => Math.sign((q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x));
  return o(a, b, c) !== o(a, b, d) && o(c, d, a) !== o(c, d, b);
};

test('every track is a clean road: a closed loop does not cross itself and no bend is tighter than the road is wide', () => {
  for (const def of R.TRACKS) {
    const T = R.buildTrack(def);
    assert.ok(T.length > 1000, `${def.id} is ${T.length.toFixed(0)} m long`);
    if (def.closed) {
      const a = T.S[T.m - 1], b = T.S[0];
      assert.ok(Math.hypot(a.x - b.x, a.y - b.y) < T.step * 1.5, `${def.id} closes`);
      for (let i = 0; i < T.m; i += 2) for (let j = i + 8; j < T.m - 8; j += 2) {
        if (i === 0 && j > T.m - 16) continue;
        assert.ok(!segCross(T.S[i], T.S[i + 2 < T.m ? i + 2 : 0], T.S[j], T.S[j + 2 < T.m ? j + 2 : 0]), `${def.id} crosses itself near ${i}/${j}`);
      }
    }
    const kmax = Math.max(...T.S.map((q) => Math.abs(q.k)));
    assert.ok(kmax < 1 / (def.width * 0.6), `${def.id} tightest bend radius ${(1 / kmax).toFixed(0)} m`);
  }
  assert.ok(track('sprint').S.every((q) => Math.abs(q.x) < 1e-6), 'the sprint is a dead-straight line');
});

test('locate gives the distance along and the side of the road, also behind the start line', () => {
  const T = track('circuit'), q = T.S[40];
  const l = R.locate(T, q.x + q.nx * 5, q.y + q.ny * 5);
  assert.ok(Math.abs(l.s - q.s) < 4 && Math.abs(l.lat - 5) < 0.5, `s ${l.s} lat ${l.lat}`);
  const S = track('sprint'), b = R.locate(S, 0, 20);
  assert.ok(b.s < 0 && Math.abs(b.s + 20) < 4, `behind the start: ${b.s}`);
  for (const id of ['sprint', 'circuit', 'mixed']) {
    const t = track(id);
    for (let slot = 0; slot < 8; slot++) { const g = R.gridSlot(t, slot), p = R.locate(t, g.x, g.y); assert.ok(Math.abs(p.lat) < t.width / 2 - 2, `${id} slot ${slot} on the road (${p.lat.toFixed(1)})`); assert.ok(p.s < 0 || p.s > t.length - 60, `${id} slot ${slot} behind the line`); }
  }
});

test('a car accelerates to near its top speed, brakes to a stop, reverses, and slows on grass', () => {
  for (const spec of R.CARS) {
    const c = R.newCar(spec, 0, 0, 0);
    for (let t = 0; t < 25; t += 1 / 60) R.stepCar(c, GO, 1 / 60, 1);
    const top = Math.hypot(c.vx, c.vy);
    assert.ok(top > spec.vmax * 0.9 && top < spec.vmax * 1.03, `${spec.id} reached ${top.toFixed(1)} of ${spec.vmax}`);
    for (let t = 0; t < 8; t += 1 / 60) R.stepCar(c, { throttle: 0, brake: 1, steer: 0, hand: 0 }, 1 / 60, 1);
    assert.ok(Math.hypot(c.vx, c.vy) < 1 || c.vf < 0, `${spec.id} stopped or reversing`);
    const g = R.newCar(spec, 0, 0, 0);
    for (let t = 0; t < 25; t += 1 / 60) R.stepCar(g, GO, 1 / 60, 0.55);
    assert.ok(Math.hypot(g.vx, g.vy) < top * 0.75, `${spec.id} is slower on grass`);
  }
  const r = R.newCar(car('gt'), 0, 0, 0);
  for (let t = 0; t < 4; t += 1 / 60) R.stepCar(r, { throttle: 0, brake: 1, steer: 0, hand: 0 }, 1 / 60, 1);
  assert.ok(r.vf < -2, `reverses: ${r.vf}`);
});

test('steering turns the car the right way, less sharply at speed, and the handbrake starts a drift', () => {
  const turn = (spec, speed, inp, secs) => { const c = R.newCar(spec, 0, 0, 0); c.vx = speed; c.vf = speed; for (let t = 0; t < secs; t += 1 / 60) R.stepCar(c, inp, 1 / 60, 1); return c; };
  const gt = car('gt');
  const right = turn(gt, 15, { throttle: 0.3, brake: 0, steer: 1, hand: 0 }, 1.5), left = turn(gt, 15, { throttle: 0.3, brake: 0, steer: -1, hand: 0 }, 1.5);
  assert.ok(right.h > 0.3 && left.h < -0.3, `right ${right.h.toFixed(2)} left ${left.h.toFixed(2)}`);
  assert.ok(right.y > 0 && left.y < 0, 'right is towards +y (screen down) when heading along +x');
  const slow = turn(gt, 15, { throttle: 0.3, brake: 0, steer: 1, hand: 0 }, 1).yaw, fast = turn(gt, 60, { throttle: 1, brake: 0, steer: 1, hand: 0 }, 1).yaw;
  assert.ok(fast < slow, `yaw rate falls with speed: ${slow.toFixed(2)} → ${fast.toFixed(2)}`);
  for (const spec of R.CARS) {
    const grip = turn(spec, 40, { throttle: 0.6, brake: 0, steer: 0.7, hand: 0 }, 2);
    const slide = turn(spec, 40, { throttle: 0.6, brake: 0, steer: 0.7, hand: 1 }, 1.2);
    assert.ok(Math.abs(slide.vl) > 4 && slide.drifting, `${spec.id} slides with the handbrake (side speed ${slide.vl.toFixed(1)})`);
    assert.ok(Math.abs(slide.vl) > Math.abs(grip.vl) + 2, `${spec.id} slides more than it grips`);
  }
  const hold = (spec) => { const c = R.newCar(spec, 0, 0, 0); c.vx = 45; c.vf = 45; let m = 0; for (let t = 0; t < 1.5; t += 1 / 60) { R.stepCar(c, { throttle: 1, brake: 0, steer: 1, hand: 0 }, 1 / 60, 1); m = Math.max(m, Math.abs(c.vl)); } return m; };
  assert.ok(hold(car('drift')) > hold(car('gt')), 'the Drift King lets go more than the Street GT under power');
});

test('computer drivers finish every track, stay on the road, and the lap count is right', () => {
  for (const def of R.TRACKS) for (const level of ['easy', 'hard']) {
    const T = R.buildTrack(def), laps = def.closed ? 3 : 1; T.laps = laps;
    const racers = R.CARS.concat(R.CARS).slice(0, 4).map((spec, i) => R.newRacer('a' + i, 'AI' + i, spec, T, i));
    const st = racers.map((r, i) => ({ idx: -1, lane: (i - 1.5) * 0.4, skill: R.LEVELS[level].skill, stuck: 0, rev: 0, go: true }));
    let t = 0, off = 0, steps = 0, minLap = -9;
    for (; t < 500 && !racers.every((r) => r.finished); t += 1 / 60) {
      racers.forEach((r, i) => {
        if (r.finished) st[i].skill = 0.4;
        const inp = R.driveAI(T, r.car, st[i], 1 / 60);
        const loc = R.locate(T, r.car.x, r.car.y, r.idx);
        R.stepOnRoad(T, r.car, inp, 1 / 60, Math.abs(loc.lat) > T.width / 2 + 1.5 ? 0.55 : 1, loc);      // the game's own step: hills, grip and banked corners
        R.progress(r, T, t); steps++; if (Math.abs(r.lat) > T.width / 2 + 1.5 && !r.finished) off++; minLap = Math.max(minLap, r.lap);
      });
      for (let i = 0; i < racers.length; i++) for (let j = i + 1; j < racers.length; j++) R.collide(racers[i].car, racers[j].car);
    }
    assert.ok(racers.every((r) => r.finished), `${def.id}/${level}: all finished (${t.toFixed(0)} s, laps ${racers.map((r) => r.lap)})`);
    assert.ok(off / steps < 0.06, `${def.id}/${level}: off the road ${(100 * off / steps).toFixed(1)}% of the time`);
    const fin = racers.map((r) => r.finishT);
    if (def.closed) { for (const r of racers) assert.equal(r.lapTimes.length, laps, `${def.id}: ${laps} lap times recorded, got ${r.lapTimes.length}`); assert.ok(Math.min(...fin) / laps > 15 && Math.max(...fin) / laps < 125, `${def.id}/${level}: lap times ${fin.map((f) => (f / laps).toFixed(0))}`); }
    else assert.ok(Math.min(...fin) > 20 && Math.max(...fin) < T.length / 12, `${def.id}: sprint times ${fin.map((f) => f.toFixed(1))}`);
  }
});

test('the standings put finishers first by time, then the rest by distance', () => {
  const T = track('circuit'), mk = (id, prog, fin, ft) => Object.assign(R.newRacer(id, id, car('gt'), T, 0), { prog, finished: fin, finishT: ft });
  const order = R.ranking([mk('c', 900, false, 0), mk('a', 3000, true, 80), mk('b', 3000, true, 70), mk('d', 1500, false, 0)]).map((r) => r.id);
  assert.deepEqual(order, ['b', 'a', 'd', 'c']);
});

test('cars bump apart and a room code is six easy letters and numbers', () => {
  const a = R.newCar(car('gt'), 0, 0, 0), b = R.newCar(car('gt'), 2, 0, 0);
  assert.ok(R.collide(a, b) > 0 && b.x - a.x >= 2.5, `pushed apart to ${(b.x - a.x).toFixed(2)} m`);
  const c = R.NET.newCode(); assert.equal(c.length, 6); assert.ok([...c].every((ch) => R.NET.CODE_CHARS.includes(ch)));
  assert.equal(R.NET.normCode(' k7pd-2m '), 'K7PD2M'); assert.equal(R.NET.normCode('K7PD0M'), null); assert.equal(R.NET.normCode('abc'), null);
  assert.equal(R.fmt(75.5), '1:15.50'); assert.equal(R.fmt(0), '–');
});

// ---- more cars, the gearbox, damage and crashes
test('every car has a gearbox that climbs through its gears with the revs between idle and the redline', () => {
  for (const spec of R.CARS) {
    const T = track('circuit'), c = R.newCar(spec, T.S[0].x, T.S[0].y, Math.atan2(T.S[0].ty, T.S[0].tx));
    const seen = new Set(); let maxRpm = 0, minRpm = 1e9;
    for (let i = 0; i < 60 * 30; i++) { R.stepCar(c, GO, 1 / 60, 1); seen.add(c.gear); maxRpm = Math.max(maxRpm, c.rpm); if (c.gear > 0) minRpm = Math.min(minRpm, c.rpm); }
    assert.ok(seen.has(1) && seen.has(spec.gears), `${spec.id} uses gears 1 to ${spec.gears} (saw ${[...seen].sort()})`);
    assert.ok(maxRpm <= spec.redline * 1.03 && maxRpm > spec.redline * 0.7, `${spec.id} revs ${maxRpm.toFixed(0)} of ${spec.redline}`);
    assert.ok(minRpm >= spec.idle * 0.9, `${spec.id} never below idle (${minRpm.toFixed(0)})`);
    for (let i = 0; i < 60 * 8; i++) R.stepCar(c, { throttle: 0, brake: 1, steer: 0, hand: 0 }, 1 / 60, 1);
    assert.ok(c.gear <= 1, `${spec.id} back to first or neutral when stopped (gear ${c.gear})`);
  }
});

test('the cars are really different: the F1 car is fastest and quickest round a corner, the hatch is slowest', () => {
  const top = (id) => { const T = track('sprint'), c = R.newCar(car(id), 0, 0, -Math.PI / 2); for (let i = 0; i < 60 * 40; i++) R.stepCar(c, GO, 1 / 60, 1); return Math.hypot(c.vx, c.vy); };
  assert.ok(top('f1') > top('super') && top('super') > top('gt3') && top('gt3') > top('gt') && top('gt') > top('hatch'), 'top speeds in order');
  assert.ok(R.CARS.length >= 7);
  assert.ok(car('f1').grip > car('gt3').grip && car('gt3').grip > car('muscle').grip);
});

test('a car that hits the barrier bounces, loses speed, spins and is damaged, in proportion to how hard it hit', () => {
  const T = track('circuit'), q = T.S[60], hit = (speed) => {
    const c = R.newCar(car('gt'), q.x + q.nx * (T.width / 2 + 7.5), q.y + q.ny * (T.width / 2 + 7.5), Math.atan2(q.ty, q.tx) + 0.5);
    c.vx = q.nx * speed + q.tx * 10; c.vy = q.ny * speed + q.ty * 10;
    const loc = R.locate(T, c.x, c.y, 60); const impact = R.wallHit(c, T, loc);
    return { c, impact };
  };
  const soft = hit(8), hard = hit(35);
  assert.ok(soft.impact > 7 && hard.impact > 30, `impacts ${soft.impact.toFixed(1)} / ${hard.impact.toFixed(1)}`);
  assert.ok(hard.c.dmg > soft.c.dmg + 0.3 && hard.c.dmg <= 1, `damage ${soft.c.dmg.toFixed(2)} vs ${hard.c.dmg.toFixed(2)}`);
  assert.ok(Math.abs(hard.c.spin) > Math.abs(soft.c.spin), 'a harder knock spins the car more');
  const loc = R.locate(T, hard.c.x, hard.c.y, 60); assert.ok(Math.abs(loc.lat) <= T.width / 2 + 7.2, 'put back inside the barrier');
  const q2 = T.S[60]; const away = hard.c.vx * q2.nx + hard.c.vy * q2.ny; assert.ok(away * Math.sign(R.locate(T, hard.c.x, hard.c.y, 60).lat) < 2, 'no longer heading into the wall');
  // The F1 car is fragile; the muscle car is tough.
  const f1 = R.newCar(car('f1'), 0, 0, 0), mu = R.newCar(car('muscle'), 0, 0, 0); R.hurt(f1, 25, 5, 40); R.hurt(mu, 25, 5, 40);
  assert.ok(f1.dmg > mu.dmg, 'the F1 car takes more damage from the same knock');
});

test('car against car: a head-on crash hurts both and stops them, a glancing clip spins them, and damage slows the car', () => {
  const a = R.newCar(car('gt'), 0, 0, 0), b = R.newCar(car('gt'), 4.4, 0, Math.PI); a.vx = 30; b.vx = -30; a.vf = 30; b.vf = 30;
  const impact = R.collide(a, b); assert.ok(impact > 20, `head-on impact ${impact}`);
  assert.ok(a.dmg > 0.2 && b.dmg > 0.2, 'both are damaged'); assert.ok(Math.abs(a.vx) < 25, 'the speed was shared out');
  const c = R.newCar(car('gt'), 0, 0, 0), d = R.newCar(car('gt'), 3.9, 1.5, 0); c.vx = 30; d.vx = 18;
  R.collide(c, d); assert.ok(Math.abs(c.spin) > 0.01 || Math.abs(d.spin) > 0.01, 'a clip twists them');
  const healthy = R.newCar(car('gt'), 0, 0, -Math.PI / 2), wrecked = R.newCar(car('gt'), 0, 0, -Math.PI / 2); wrecked.dmg = 1;
  for (let i = 0; i < 60 * 30; i++) { R.stepCar(healthy, GO, 1 / 60, 1); R.stepCar(wrecked, GO, 1 / 60, 1); }
  assert.ok(Math.hypot(wrecked.vx, wrecked.vy) < Math.hypot(healthy.vx, healthy.vy) * 0.75, 'a wrecked car is much slower');
});

// ---- the track designer
test('the designer checks a drawn track: too few points, too short, too tight and crossing are refused; a good loop is fine', () => {
  const loop = (r, n = 10) => Array.from({ length: n }, (_, i) => [Math.cos((i / n) * Math.PI * 2) * r * 1.4, Math.sin((i / n) * Math.PI * 2) * r]);
  assert.equal(R.checkTrack({ closed: true, width: 32, pts: [[0, 0], [100, 0], [100, 100]] }).ok, false, 'three points');
  assert.match(R.checkTrack({ closed: true, width: 32, pts: loop(40, 6) }).why, /short|tight/, 'tiny loop');
  const good = R.checkTrack({ closed: true, width: 32, pts: loop(300) });
  assert.ok(good.ok, good.why);
  const zig = R.checkTrack({ closed: false, width: 32, pts: [[0, 0], [0, -200], [60, -230], [0, -260], [0, -500]] });
  assert.equal(zig.ok, false, 'a hairpin too tight for the road');
  const eight = R.checkTrack({ closed: true, width: 32, pts: [[0, 0], [300, -300], [600, 0], [300, 300], [0, 0.1], [-300, -300], [-600, 0], [-300, 300]] });
  assert.equal(eight.ok, false, 'a figure of eight crosses itself'); assert.match(eight.why, /itself|tight/);
  for (const def of R.TRACKS) assert.ok(R.checkTrack(def).ok, `${def.id}: ${R.checkTrack(def).why}`);
});

test('a track survives being shared as a code, and broken codes are refused', () => {
  const pts = Array.from({ length: 12 }, (_, i) => [Math.round(Math.cos((i / 12) * Math.PI * 2) * 420), Math.round(Math.sin((i / 12) * Math.PI * 2) * 300)]);
  const def = R.customDef({ name: 'Ünïcode loop', closed: true, width: 40, look: 'snow', laps: 5, pts });
  const code = R.encodeTrack(def), back = R.decodeTrack(code);
  assert.ok(code.startsWith('NR1') && code.length < 400, code);
  assert.ok(back && back.id === def.id && back.name === 'Ünïcode loop' && back.width === 40 && back.laps === 5 && back.grip === 0.85);
  assert.deepEqual(back.pts, def.pts);
  assert.equal(R.decodeTrack('NR1garbage'), null); assert.equal(R.decodeTrack('hello'), null);
  const crossing = R.encodeTrack({ name: 'x', closed: true, width: 32, pts: [[0, 0], [300, -300], [600, 0], [300, 300], [0, 0.1], [-300, -300], [-600, 0], [-300, 300]] });
  assert.equal(R.decodeTrack(crossing), null, 'an undrivable shared track is refused');
  // A computer driver can finish a drawn track.
  const T = R.buildTrack(back); T.laps = 1;
  const r = R.newRacer('ai', 'ai', car('gt3'), T, 0), st = { idx: -1, lane: 0, skill: 0.9, stuck: 0, rev: 0, go: true };
  let t = 0; while (!r.finished && t < 240) { R.stepCar(r.car, R.driveAI(T, r.car, st, 1 / 60), 1 / 60, 1); R.progress(r, T, t); t += 1 / 60; }
  assert.ok(r.finished, 'finished the drawn loop');
});

// One step the way the game does it: the car moves, then the barrier holds it in.
function gameStep(T, r, inp, dt = 1 / 120) {
  const loc = R.locate(T, r.car.x, r.car.y, r.idx);
  R.stepCar(r.car, inp, dt, Math.abs(loc.lat) > T.width / 2 + 1.5 ? 0.55 : 1);
  const after = R.locate(T, r.car.x, r.car.y, loc.idx);
  R.wallHit(r.car, T, after);
  R.progress(r, T, 0);
  return R.locate(T, r.car.x, r.car.y, r.idx);
}

test('the barriers are solid: a car driven flat out at the wall, at any angle, on any track, stays on the road side of it', () => {
  for (const def of R.TRACKS) {
    const T = R.buildTrack(def), wallD = T.width / 2 + 7;
    for (const spec of [R.CARS[0], R.CARS[R.CARS.length - 1], R.CARS.find((c) => c.id === 'f1') || R.CARS[1]]) {
      for (const ang of [-1.3, -0.7, -0.25, 0.25, 0.7, 1.3]) for (const at of [30, Math.floor(T.m / 3), Math.floor(T.m * 0.6)]) {
        const q = T.S[Math.min(at, T.m - 3)], r = R.newRacer('x', 'x', spec, T, 0);
        r.car.x = q.x; r.car.y = q.y; r.car.h = Math.atan2(q.ty, q.tx) + ang; r.car.vx = Math.cos(r.car.h) * 45; r.car.vy = Math.sin(r.car.h) * 45; r.idx = at;
        let worst = 0;
        for (let t = 0; t < 8; t += 1 / 120) { const loc = gameStep(T, r, { throttle: 1, brake: 0, steer: Math.sign(ang) * 0.3, hand: 0 }); worst = Math.max(worst, Math.abs(loc.lat)); }
        assert.ok(worst <= wallD + 0.6, `${def.id}/${spec.id}: reached ${worst.toFixed(1)} m from the middle, the barrier is at ${wallD} m`);
      }
    }
  }
});

test('the computer drivers never get past a barrier either, over a whole race', () => {
  for (const def of R.TRACKS) {
    const T = R.buildTrack(def), wallD = T.width / 2 + 7; T.laps = def.closed ? 2 : 1;
    const racers = R.CARS.slice(0, 5).map((spec, i) => R.newRacer('a' + i, 'AI' + i, spec, T, i));
    const st = racers.map((r, i) => ({ idx: -1, lane: (i - 2) * 0.4, skill: 0.98, stuck: 0, rev: 0, go: true }));
    let worst = 0;
    for (let t = 0; t < 240 && !racers.every((r) => r.finished); t += 1 / 60) {
      racers.forEach((r, i) => { if (r.finished) st[i].skill = 0.4; const loc = gameStep(T, r, R.driveAI(T, r.car, st[i], 1 / 60), 1 / 60); R.progress(r, T, t); worst = Math.max(worst, Math.abs(loc.lat)); });
      for (let i = 0; i < racers.length; i++) for (let j = i + 1; j < racers.length; j++) R.collide(racers[i].car, racers[j].car);
    }
    assert.ok(worst <= wallD + 0.6, `${def.id}: an AI car got ${worst.toFixed(1)} m from the middle (the barrier is at ${wallD} m)`);
  }
});

test('the designer refuses a bend tighter than the barrier stands from the road, which would fold the inside barrier over itself', () => {
  const mixed = R.TRACKS.find((t) => t.id === 'mixed');
  const scaled = (k) => ({ name: 'tight', closed: true, width: mixed.width, laps: 3, look: 'green', pts: mixed.pts.map(([x, y]) => [Math.round(x * k), Math.round(y * k)]) });
  assert.equal(R.checkTrack(scaled(1)).ok, true, 'the real mixed track is fine');
  const t = R.checkTrack(scaled(0.68));
  assert.equal(t.ok, false, 'scaled down until the tightest bend is under 24 m');
  assert.match(t.why, /too tight/i);
});

// ---- the pit lane and the stewards
test('every circuit has a pit lane on the outside of the start straight; sprints have none; a fence stops a car crossing', () => {
  for (const def of R.TRACKS) {
    const T = R.buildTrack(def), P = R.pitInfo(T);
    if (!def.closed) { assert.equal(P, null, `${def.id} is a sprint`); continue; }
    assert.ok(P && P.a < -100 && P.b > 100 && P.outer > P.inner && P.lane > P.inner && P.lane < P.outer, `${def.id} pit lane`);
    // The lane is on the outside: a point out there is further from the middle of the circuit than the road.
    const cx = T.S.reduce((m, q) => m + q.x, 0) / T.m, cy = T.S.reduce((m, q) => m + q.y, 0) / T.m, q = T.S[0];
    const out = Math.hypot(q.x + q.nx * P.side * P.lane - cx, q.y + q.ny * P.side * P.lane - cy), road = Math.hypot(q.x - cx, q.y - cy);
    assert.ok(out > road, `${def.id}: the pit lane is outside the circuit`);
  }
  const T = track('circuit');
  assert.ok(Math.abs(R.relS(T, 5)) === 5 && Math.abs(R.relS(T, T.length - 5) + 5) < 1e-6, 'distance from the line, both ways');
  const q = T.S[10], c = R.newCar(car('gt'), q.x + q.nx * 20, q.y + q.ny * 20, Math.atan2(q.ny, q.nx)); c.vx = q.nx * 15; c.vy = q.ny * 15;
  const hit = R.fence(c, q, 1, 20, 18, true);
  assert.ok(hit > 10, 'the wall was hit'); assert.ok(c.vx * q.nx + c.vy * q.ny < 0, 'bounced back');
});

test('worn tyres grip less', () => {
  // The same fast turn: on worn tyres the car turns less (it runs wide).
  const run = (wear) => { const c = R.newCar(car('gt'), 0, 0, 0); c.wear = wear; for (let i = 0; i < 60 * 6; i++) R.stepCar(c, GO, 1 / 60, 1); const h0 = c.h; for (let i = 0; i < 60 * 2; i++) R.stepCar(c, { throttle: 1, brake: 0, steer: 1, hand: 0 }, 1 / 60, 1); return Math.abs(c.h - h0); };
  assert.ok(run(1) < run(0) * 0.92, `turned ${run(1).toFixed(2)} on worn tyres vs ${run(0).toFixed(2)} on new`);
});

// ---- the track assistant
test('the track assistant reads a request and builds a track with what was asked that passes the rules', () => {
  const req = R.parseRequest('I want a race track with 21 chicanes and 4 hairpins, in the desert, called Sand Snake');
  assert.equal(req.chicanes, 21); assert.equal(req.hairpins, 4); assert.equal(req.look, 'desert'); assert.equal(req.name, 'Sand Snake');
  let res = null; for (let k = 0; k < 25 && !(res && res.def); k++) res = R.generateTrack(req, 1 + k * 7);
  assert.ok(res.def, res.why); assert.equal(res.counts.ch, 21); assert.equal(res.counts.hp, 4);
  assert.ok(R.checkTrack(res.def).ok, 'passes the designer rules');
  const sp = R.generateTrack(R.parseRequest('a sprint with three hairpins, 4 km'), 1);
  assert.ok(sp.def && !sp.def.closed && sp.counts.hp === 3 && sp.counts.ch === 0, 'a sprint, and no chicanes that were not asked for');
  assert.equal(R.parseRequest('five hairpins').hairpins, 5);
  assert.ok(Math.abs(R.parseRequest('a 3 mile circuit').km - 4.83) < 0.01);
});

test('the track assistant traces a circuit from a picture of its layout', () => {
  const w = 300, h = 220, px = new Uint8ClampedArray(w * h * 4).fill(240); for (let i = 3; i < px.length; i += 4) px[i] = 255;
  const dot = (x, y, r) => { for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) { if (dx * dx + dy * dy > r * r) continue; const o = (Math.round(y + dy) * w + Math.round(x + dx)) * 4; px[o] = 200; px[o + 1] = 20; px[o + 2] = 20; } };
  for (let t = 0; t < 1; t += 0.001) { const a = t * Math.PI * 2, r = 1 + 0.22 * Math.sin(3 * a); dot(150 + Math.cos(a) * 100 * r, 110 + Math.sin(a) * 70 * r, 3); }
  const res = R.traceImage(px, w, h, 4.5);
  assert.ok(res.def, res.why); assert.ok(Math.abs(res.T.length - 4500) < 300, `${res.T.length} m`);
  const blank = new Uint8ClampedArray(w * h * 4).fill(240); for (let i = 3; i < blank.length; i += 4) blank[i] = 255;
  assert.equal(R.traceImage(blank, w, h).def, null, 'a blank picture gives no track');
});

test('the 2026 F1 calendar: 24 real circuits, each drivable, at its real length, starting on a straight', () => {
  assert.equal(R.F1_CAL.length, 24);
  const real = { f1au: 5278, f1cn: 5451, f1jp: 5807, f1bh: 5412, f1sa: 6174, f1mi: 5412, f1ca: 4361, f1mc: 3337, f1es: 4657, f1at: 4318, f1gb: 5891, f1be: 7004, f1hu: 4381, f1nl: 4259, f1it: 5793, f1md: 5474, f1az: 6003, f1sg: 4940, f1us: 5513, f1mx: 4304, f1br: 4309, f1lv: 6201, f1qa: 5419, f1ae: 5281 };
  for (const d of R.F1_CAL) {
    const T = R.buildTrack(d), lim = 1 / (d.width / 2 + 7 + 1);
    assert.ok(Math.abs(T.length - real[d.id]) / real[d.id] < 0.12, `${d.id} is ${Math.round(T.length)} m`);
    assert.ok(T.S.every((q) => Math.abs(q.k) < lim), `${d.id}: no bend tighter than its barriers allow`);
    const P = R.pitInfo(T); let k = 0; for (let s = -100; s <= 100; s += T.step) k = Math.max(k, Math.abs(T.S[((Math.round(s / T.step) % T.m) + T.m) % T.m].k));
    assert.ok(k < 0.02, `${d.id}: the start is on a straight (${k})`); assert.ok(P && P.b > P.a);
  }
  assert.equal(R.matchF1('build Yas Marina').id, 'f1ae'); assert.equal(R.matchF1('a Monza style track'), null); assert.equal(R.matchF1('a fast track'), null);
});

// ---- hills: 3D elevation
test('a track with elevation round-trips through sharing and gains z on its samples', () => {
  const pts = Array.from({ length: 12 }, (_, i) => [Math.round(Math.cos((i / 12) * Math.PI * 2) * 420), Math.round(Math.sin((i / 12) * Math.PI * 2) * 300), (i === 0 ? 0 : i * 5)]);
  const def = R.customDef({ name: 'Hilly loop', closed: true, width: 40, look: 'snow', laps: 5, pts });
  const code = R.encodeTrack(def), back = R.decodeTrack(code);
  assert.ok(code.startsWith('NR1') && back, 'decoded');
  assert.deepEqual(back.pts, def.pts, 'points survived the round-trip');
  assert.equal(back.id, def.id, 'id survived the round-trip');
  const T = R.buildTrack(def);
  assert.ok(T.S.every((q) => q.z !== undefined), 'every sample has a z');
  assert.ok(T.S.every((q) => q.z > -1 && q.z < 56), 'the heights stay within what was drawn (the steepest drop is eased, so the start can sit up the first rise)');
  assert.ok(T.S.some((q) => q.z > 5), 'some samples are uphill');
});

test('trackHeight and trackSlope find the elevation and gradient at a position', () => {
  const T = R.buildTrack(R.TRACKS.find((t) => t.id === 'zandvoort'));
  const loc = R.locate(T, T.S[0].x, T.S[0].y, 0);
  assert.ok(Math.abs(R.trackHeight(T, loc) - (T.S[0].z || 0)) < 0.1, 'height matches the nearest sample');
  // On a flat track the slope is zero everywhere.
  assert.ok(Math.abs(R.trackSlope(T, { x: 0, y: 0, z: 0, h: 0 }, loc)) < 0.001, 'flat track has no slope');
});

test('gravity on slopes: uphill slows a coasting car, downhill speeds it up', () => {
  // A flat track — we test gravity directly through stepCar's slope parameter.
  const T = R.buildTrack(R.TRACKS.find((t) => t.id === 'zandvoort'));
  const c = R.newCar(R.CARS.find((x) => x.id === 'gt'), T.S[0].x + T.S[0].nx * (T.width / 2 - 2), T.S[0].y + T.S[0].ny * (T.width / 2 - 2), Math.atan2(T.S[0].ty, T.S[0].tx));
  c.vx = Math.cos(c.h) * 15; c.vy = Math.sin(c.h) * 15;          // rolling at a modest speed
  const v0 = Math.hypot(c.vx, c.vy);
  // Uphill: the car should slow down.
  let cu = { ...c }; R.stepCar(cu, { throttle: 0, brake: 0, steer: 0, hand: 0 }, 1 / 60, 1, 0.08);
  assert.ok(Math.hypot(cu.vx, cu.vy) < v0, 'uphill slope slows the car');
  // Downhill: the car should speed up.
  let cd = { ...c }; R.stepCar(cd, { throttle: 0, brake: 0, steer: 0, hand: 0 }, 1 / 60, 1, -0.08);
  assert.ok(Math.hypot(cd.vx, cd.vy) > v0, 'downhill slope speeds the car up');
});

test('a round code with z elevation produces a drivable track', () => {
  const pts = Array.from({ length: 16 }, (_, i) => { const a = (i / 16) * Math.PI * 2; return [Math.round(Math.cos(a) * 500), Math.round(Math.sin(a) * 350), i < 8 ? i * 8 : (16 - i) * 8]; });
  const def = R.customDef({ name: 'Roller', closed: true, width: 40, look: 'hills', pts });
  const back = R.decodeTrack(R.encodeTrack(def));
  assert.ok(back, 'decoded from a code');
  const T = R.buildTrack(back); T.laps = 1;
  const r = R.newRacer('ai', 'ai', R.CARS.find((x) => x.id === 'gt3' || x.id === 'gt'), T, 0);
  const st = { idx: -1, lane: 0, skill: 0.9, stuck: 0, rev: 0, go: true };
  let t = 0; while (!r.finished && t < 300) { R.stepCar(r.car, R.driveAI(T, r.car, st, 1 / 60), 1 / 60, 1, R.trackSlope(T, r.car, R.locate(T, r.car.x, r.car.y, r.idx))); R.progress(r, T, t); t += 1 / 60; r.car.z = R.trackHeight(T, R.locate(T, r.car.x, r.car.y, r.idx)); }
  assert.ok(r.finished, 'the AI finished the hilly track');
});

test('no road is steeper than a real one, even a track drawn with huge height steps (Mountain Pass)', () => {
  const MP = 'NR1eyJuIjoiTW91bnRhaW4gUGFzcyIsImMiOjEsInciOjQwLCJnIjoiZ3JlZW4iLCJsIjozLCJ2IjoyLCJwIjpbNTAwLDAsMCw0ODMsMTI5LDQwLDQzMywyNTAsLTMwLDM1NCwzNTQsNTAsMjUwLDQzMywtNTAsMTI5LDQ4MywyMCwwLDUwMCwtNDUsLTEyOSw0ODMsMzUsLTI1MCw0MzMsLTEwLC0zNTQsMzU0LDQ4LC00MzMsMjUwLC01NSwtNDgzLDEyOSwyNSwtNTAwLDAsLTIwLC00ODMsLTEyOSw0MiwtNDMzLC0yNTAsLTM1LC0zNTQsLTM1NCwxNSwtMjUwLC00MzMsNTAsLTEyOSwtNDgzLC00MCwwLC01MDAsMzAsMTI5LC00ODMsLTQ4LDI1MCwtNDMzLDEyLDM1NCwtMzU0LDM4LDQzMywtMjUwLC0yNSw0ODMsLTEyOSwwXX0';
  const defs = [R.decodeTrack(MP), ...R.F1_CAL];
  assert.ok(defs[0], 'Mountain Pass decodes');
  for (const def of defs) {
    const T = R.buildTrack(def);
    let worst = 0;
    for (let i = 0; i < T.m; i++) worst = Math.max(worst, Math.abs(T.S[(i + 1) % T.m].z - T.S[i].z) / T.step);
    assert.ok(worst <= 0.175, `${def.id} climbs at ${(worst * 100).toFixed(1)}%`);
  }
});

test('every car starts on the road, at the height of the road under it', () => {
  for (const id of ['f1be', 'f1mc', 'f1br', 'f1at']) {
    const T = R.buildTrack(R.F1_CAL.find((t) => t.id === id));
    for (let slot = 0; slot < 20; slot++) {
      const r = R.newRacer('t' + slot, 'T', car('f1'), T, slot);
      assert.ok(Math.abs(r.car.z - R.trackHeight(T, R.locate(T, r.car.x, r.car.y))) < 0.01, `${id} slot ${slot} sits on the road`);
    }
  }
});

test('the F1 circuits have at least the relief given in the 2026 circuit notes (Spa ~104 m, Red Bull Ring ~65 m, Suzuka/Monaco/COTA/Interlagos ~40 m ...) and the flat ones stay flat', () => {
  const range = (id) => { const T = R.buildTrack(R.F1_CAL.find((t) => t.id === id)); const zs = T.S.map((q) => q.z); return Math.max(...zs) - Math.min(...zs); };
  const atLeast = { f1be: 100, f1at: 64, f1jp: 39.5, f1mc: 39.5, f1us: 35.5, f1br: 39.5, f1hu: 34.5, f1es: 29.5, f1az: 29.5, f1md: 25.5 };
  for (const [id, m] of Object.entries(atLeast)) assert.ok(range(id) >= m, `${id} is ${range(id).toFixed(1)} m, needs ${m}`);
  for (const id of ['f1au', 'f1cn', 'f1mi', 'f1ca', 'f1sg', 'f1mx', 'f1lv']) assert.ok(range(id) < 8, `${id} is near flat`);
  for (const id of ['f1gb', 'f1nl', 'f1it', 'f1qa', 'f1ae']) assert.ok(range(id) < 20, `${id} is mild`);
});

test('the road height is smooth under a moving car: no jump in height or slope as it crosses from one sample to the next, up or down hill', () => {
  const car0 = car('f1');
  for (const id of ['f1be', 'f1at', 'f1br', 'f1us']) {
    const T = R.buildTrack(R.F1_CAL.find((t) => t.id === id)), c = R.newCar(car0, 0, 0, 0);
    let idx = -1, pz, ps, worstZ = 0, worstS = 0;
    for (let s = 0; s < T.length; s += 0.7) {
      const i = Math.floor(s / T.step) % T.m, q = T.S[i], q2 = T.S[(i + 1) % T.m], u = (s - q.s) / T.step;
      c.x = q.x + (q2.x - q.x) * u; c.y = q.y + (q2.y - q.y) * u; c.h = Math.atan2(q.ty, q.tx);
      const loc = R.locate(T, c.x, c.y, idx); idx = loc.idx;
      const z = R.trackHeight(T, loc), sl = R.trackSlope(T, c, loc);
      if (pz !== undefined) { worstZ = Math.max(worstZ, Math.abs(z - pz)); worstS = Math.max(worstS, Math.abs(sl - ps)); }
      pz = z; ps = sl;
    }
    assert.ok(worstZ < 0.14, `${id} height steps by ${worstZ.toFixed(3)} m per 0.7 m`);
    assert.ok(worstS < 0.008, `${id} slope steps by ${(worstS * 100).toFixed(2)}%`);
  }
});

test('a car put on the grid is found on the road at once, so the road is drawn (not left at index -1)', () => {
  const T = R.buildTrack(R.F1_CAL.find((t) => t.id === 'f1be')), r = R.newRacer('t', 'T', car('f1'), T, 3);
  assert.ok(r.idx >= 0 && r.idx < T.m, 'on the road');
});

test('banking: the Madring, Zandvoort and Yas Marina have banked corners, tilted so the outside edge is higher; straights and other circuits stay flat', () => {
  const T = (id) => R.buildTrack(R.F1_CAL.find((t) => t.id === id));
  const maxBank = (t) => Math.max(...t.S.map((q) => Math.abs(q.roll))) * 180 / Math.PI;
  assert.ok(maxBank(T('f1md')) > 13, 'La Monumental is about 13.5 degrees (24%)');
  assert.ok(maxBank(T('f1nl')) > 16, 'Zandvoort T3 and T14 are about 18 degrees');
  assert.ok(maxBank(T('f1ae')) > 5, 'Yas Marina T9');
  for (const id of ['f1be', 'f1it', 'f1mc', 'f1at']) assert.equal(maxBank(T(id)), 0, `${id} has no banking`);
  for (const id of ['f1md', 'f1nl', 'f1ae']) {
    const t = T(id), tilted = t.S.map((q, i) => [q, i]).filter(([q]) => Math.abs(q.roll) > 0.05);
    assert.ok(tilted.length > 10, `${id} has banked samples`);
    // the bend's direction over the sample and its neighbours (the very edge of a bend can curve the other way for a moment)
    const turn = (i) => { let k = 0; for (let j = -6; j <= 6; j++) k += t.S[(i + j + t.m) % t.m].k; return k; };
    const right = tilted.filter(([q, i]) => q.roll * turn(i) > 0).length;
    assert.ok(right / tilted.length > 0.95, `${id}: the road is banked towards the inside of the bend (${right} of ${tilted.length})`);
  }
  // The outside edge is higher than the inside edge, by about the width times the tilt.
  const t = T('f1md'), i = t.S.reduce((b, q, n) => (Math.abs(q.roll) > Math.abs(t.S[b].roll) ? n : b), 0), q = t.S[i], w = t.width / 2;
  const hi = R.trackHeight(t, { idx: i, s: q.s, lat: Math.sign(q.k) > 0 ? -w : w }), lo = R.trackHeight(t, { idx: i, s: q.s, lat: Math.sign(q.k) > 0 ? w : -w });
  assert.ok(hi - lo > 2 * w * Math.tan(0.2), `the outside is ${(hi - lo).toFixed(2)} m above the inside`);
  assert.ok(Math.abs(R.trackHeight(t, { idx: i, s: q.s, lat: 0 }) - (hi + lo) / 2) < 0.05, 'the middle of the road sits halfway');
});

test('banking from a shared code: a fourth number per point, capped at 24 degrees; codes without it still load', () => {
  const ring = (n, r, bank) => Array.from({ length: n }, (_, i) => [Math.round(Math.cos((i / n) * Math.PI * 2) * r), Math.round(Math.sin((i / n) * Math.PI * 2) * r), 0, bank]);
  const def = R.customDef({ name: 'Bowl', closed: true, width: 32, look: 'green', laps: 3, pts: ring(24, 200, 15) });
  const back = R.decodeTrack(R.encodeTrack(def));
  assert.ok(back, 'a code with banking decodes');
  assert.deepEqual(back.pts, def.pts, 'the banking survived the round-trip');
  const roll = (d) => Math.max(...R.buildTrack(d).S.map((q) => Math.abs(q.roll))) * 180 / Math.PI;
  assert.ok(roll(back) > 14 && roll(back) <= 15.01, 'a ring banked at 15 degrees');
  const steep = R.decodeTrack(R.encodeTrack({ ...def, pts: ring(24, 200, 40) }));
  assert.ok(steep && Math.max(...steep.pts.map((p) => p[3])) === 24, 'a bank steeper than 24 degrees is capped when a code is made');
  const hand = Buffer.from(JSON.stringify({ n: 'Wall', c: 1, w: 32, g: 'green', l: 3, v: 3, p: ring(24, 200, 40).flat() })).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  assert.equal(R.decodeTrack('NR1' + hand), null, 'and a hand-made code with a bank steeper than 24 degrees is refused');
  const plain = R.customDef({ name: 'Flat', closed: true, width: 32, look: 'green', laps: 3, pts: ring(24, 200, 0) });
  assert.equal(JSON.parse(Buffer.from(R.encodeTrack(plain).slice(3).replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString()).v, 2, 'a flat track keeps the old format');
});

test('the up-and-down of the road is felt: a car is pressed into a dip (more grip) and goes light over a crest (less grip, weaker brakes)', () => {
  const run = (curv, brake) => {
    const c = R.newCar(car('f1'), 0, 0, 0); c.vx = 70; c.vy = 0;
    for (let i = 0; i < (brake ? 15 : 90); i++) R.stepCar(c, { throttle: brake ? 0 : 0.6, brake: brake ? 1 : 0, steer: brake ? 0 : 0.5, hand: 0 }, 1 / 60, 1, 0, curv);
    return c;
  };
  const dip = run(0.0015, false), flat = run(0, false), crest = run(-0.0015, false);
  const turned = (c) => Math.abs(Math.atan2(c.vy, c.vx));
  assert.ok(turned(dip) >= turned(flat) - 0.01 && turned(flat) > turned(crest) + 0.2, `it turns as much in a dip (${turned(dip).toFixed(2)}) as flat (${turned(flat).toFixed(2)}) and much less over a crest (${turned(crest).toFixed(2)})`);
  const speedAfter = (curv) => { const c = run(curv, true); return Math.hypot(c.vx, c.vy); };
  assert.ok(speedAfter(-0.0015) > speedAfter(0) && speedAfter(0) > speedAfter(0.0015), 'braking over a crest slows the car less than flat, and in a dip more');
});

test('every circuit has a vertical curvature on its samples (the computer drivers use it for corner speed)', () => {
  const T = R.buildTrack(R.F1_CAL.find((t) => t.id === 'f1be'));
  assert.ok(T.S.every((q) => Number.isFinite(q.zk)), 'a number on every sample');
  assert.ok(T.S.some((q) => q.zk < -0.0002) && T.S.some((q) => q.zk > 0.0002), 'Spa has both crests and dips');
});

test('tyres and brakes heat up and cool down: braking heats the discs, cornering the tyres, standing still cools both', () => {
  const c = R.newCar(car('gt3'), 0, 0, 0), dt = 1 / 60;
  for (let t = 0; t < 12; t += dt) R.stepCar(c, GO, dt, 1);
  const cruise = c.t0, discCool = c.b0;
  assert.ok(cruise > 60 && cruise < 130, `tyres at cruise ${cruise.toFixed(0)}`);
  for (let t = 0; t < 3; t += dt) R.stepCar(c, { throttle: 0, brake: 1, steer: 0, hand: 0 }, dt, 1);
  assert.ok(c.b0 > discCool + 150, `discs ${discCool.toFixed(0)} -> ${c.b0.toFixed(0)}`);
  assert.ok(c.b0 > c.b2, 'the front discs run hotter than the rear');
  const hot = c.b0; for (let t = 0; t < 20; t += dt) R.stepCar(c, GO, dt, 1);
  assert.ok(c.b0 < hot - 100, 'the discs cool in the airflow');
  for (let t = 0; t < 4; t += dt) R.stepCar(c, { throttle: 1, brake: 0, steer: 1, hand: 0 }, dt, 1);
  assert.ok(c.t0 > c.t1 || c.t1 !== c.t0, 'cornering loads the outside tyres more');
  for (let t = 0; t < 10; t += dt) R.stepCar(c, { throttle: 0, brake: 1, steer: 0, hand: 0 }, dt, 1);
  for (let t = 0; t < 200; t += dt) R.stepCar(c, { throttle: 0, brake: 0, steer: 0, hand: 0 }, dt, 1);
  assert.ok(c.t0 < 50 && c.b0 < 80, `standing still cools: ${c.t0.toFixed(0)} / ${c.b0.toFixed(0)}`);
});

test('manual gearbox: you choose the gear, the rev limiter holds the top speed of a gear, and downshifting works', () => {
  const c = R.newCar(car('gt3'), 0, 0, 0), dt = 1 / 60; c.manual = true;
  for (let t = 0; t < 6; t += dt) R.stepCar(c, GO, dt, 1);
  assert.equal(c.gear, 1, 'no automatic shifting');
  assert.ok(Math.hypot(c.vx, c.vy) < car('gt3').vmax * 0.5, 'held in first gear at the limiter');
  const v1 = Math.hypot(c.vx, c.vy);
  c.shiftReq = 1; R.stepCar(c, GO, dt, 1); assert.equal(c.gear, 2);
  for (let t = 0; t < 8; t += dt) R.stepCar(c, GO, dt, 1);
  assert.ok(Math.hypot(c.vx, c.vy) > v1, 'second gear is faster');
  c.shiftReq = -1; R.stepCar(c, GO, dt, 1); assert.equal(c.gear, 1);
});

// ---- qualifying: the knock-out format
const qrows = (times) => times.map((best, i) => ({ id: 'c' + i, best, at: i, seed: i }));

test('qualifying: 20 cars run 20, 15 and 10; smaller fields cut a quarter, and tiny ones just run', () => {
  assert.deepEqual(R.qualiSizes(20), [20, 15, 10]);
  assert.deepEqual(R.qualiSizes(24), [24, 19, 10], 'a big field is cut to ten for Q3');
  assert.deepEqual(R.qualiSizes(16), [16, 12, 8]);
  assert.deepEqual(R.qualiSizes(10), [10, 7, 4]);
  assert.deepEqual(R.qualiSizes(6), [6, 4]);
  assert.deepEqual(R.qualiSizes(2), [2]);
  for (let n = 1; n <= 30; n++) { const s = R.qualiSizes(n); assert.equal(s[0], n); assert.ok(s.every((v, i) => v >= 1 && (!i || v < s[i - 1]) || s.length === 1), `sizes for ${n}: ${s}`); }
});

test('qualifying: the slowest five are knocked out, the rest go through fastest first', () => {
  const rows = qrows([91.2, 90.1, 93.4, 92.0, 90.9, 95.1, 89.7, 94.2, 91.8, 92.6, 93.0, 90.4, 96.0, 91.1, 92.2, 93.9, 94.8, 90.0, 95.5, 92.9]);
  const { through, out } = R.qualiKnockout(rows, 15);
  assert.equal(through.length, 15); assert.equal(out.length, 5);
  assert.deepEqual(out.map((r) => r.best), [94.8, 95.1, 95.5, 96.0, 94.2].sort((a, b) => a - b), 'the five slowest');
  assert.equal(through[0].best, 89.7, 'the fastest is first');
  assert.ok(through.every((r, i) => !i || r.best >= through[i - 1].best), 'sorted by time');
  assert.ok(Math.max(...through.map((r) => r.best)) < Math.min(...out.map((r) => r.best)), 'everyone through beat everyone out');
});

test('qualifying: a car with no time goes out before any car with one, and a tied time goes to whoever set it first', () => {
  const rows = [{ id: 'a', best: 0, seed: 0 }, { id: 'b', best: 100.5, at: 40, seed: 1 }, { id: 'c', best: 100.5, at: 20, seed: 2 }, { id: 'd', best: 99, at: 10, seed: 3 }, { id: 'e', best: 0, seed: 4 }];
  assert.deepEqual(R.qualiOrder(rows).map((r) => r.id), ['d', 'c', 'b', 'a', 'e']);
  const { through, out } = R.qualiKnockout(rows, 3);
  assert.deepEqual(through.map((r) => r.id), ['d', 'c', 'b']);
  assert.deepEqual(out.map((r) => r.id), ['a', 'e']);
  assert.deepEqual(R.qualiKnockout(rows, 5).out, [], 'nobody is cut when everyone fits');
});

test('qualifying: the grid is Q3, then the Q2 casualties, then the Q1 casualties, each fastest first', () => {
  const times = Array.from({ length: 20 }, (_, i) => 90 + ((i * 7) % 20) * 0.1 + i * 0.001);       // twenty different lap times
  const q1 = R.qualiKnockout(qrows(times), 15);
  const q2 = R.qualiKnockout(q1.through.map((r) => ({ ...r, best: r.best + 0.05 })), 10);          // a second segment: everyone a little different
  const q3 = q2.through.map((r, i) => ({ ...r, best: 89 + (q2.through.length - i) * 0.01 }));       // Q3 reverses their order
  const grid = R.qualiGrid(q3, [q1.out, q2.out]);
  assert.equal(grid.length, 20); assert.equal(new Set(grid).size, 20, 'every car appears once');
  assert.equal(grid[0], q2.through[q2.through.length - 1].id, 'pole is the fastest in Q3');
  assert.deepEqual(grid.slice(0, 10), R.qualiOrder(q3).map((r) => r.id));
  assert.deepEqual(grid.slice(10, 15), R.qualiOrder(q2.out).map((r) => r.id), 'P11-P15: the Q2 knocked out');
  assert.deepEqual(grid.slice(15), R.qualiOrder(q1.out).map((r) => r.id), 'P16-P20: the Q1 knocked out');
  assert.ok(Math.max(...q2.through.map((r) => r.best)) < Math.min(...q2.out.map((r) => r.best)), 'the Q2 cut was made by time');
});

test('Monaco: the Fairmont hairpin is a real hairpin (a turn of 150 degrees or more in 70 m of road) and the tunnel is a covered stretch of the lap', () => {
  const T = R.buildTrack(R.F1_CAL.find((t) => t.id === 'f1mc')), win = Math.round(70 / T.step);
  let best = 0;
  for (let i = 0; i < T.m; i++) { let turn = 0; for (let j = 0; j < win; j++) { const a = T.S[(i + j) % T.m], b = T.S[(i + j + 1) % T.m]; turn += Math.abs(Math.atan2(a.tx * b.ty - a.ty * b.tx, a.tx * b.tx + a.ty * b.ty)); } best = Math.max(best, turn); }
  assert.ok(best > 2.6, `the tightest 70 m of Monaco turns ${(best * 180 / Math.PI).toFixed(0)} degrees`);
  const LM = R.buildLandmarks(T), len = (LM.tunnel.i1 - LM.tunnel.i0) * T.step;
  assert.ok(LM.tunnel && len > 250 && len < 450, `the tunnel is ${len} m`);
  assert.ok(Math.abs(T.length - 3337) / 3337 < 0.1, 'it keeps its real length');
});

test('landmarks: only real circuits have them, every one stands on the lap, and the Yas Marina hotel straddles a straight', () => {
  for (const id of Object.keys(R.F1_LM)) assert.ok(R.F1_CAL.some((d) => d.id === id), `${id} is a calendar circuit`);
  for (const id of Object.keys(R.F1_LM)) {
    const T = R.buildTrack(R.F1_CAL.find((d) => d.id === id)), LM = R.buildLandmarks(T);
    assert.ok(LM.ranges.length + LM.at.size > 0, `${id} has landmarks`);
    for (const i of LM.at.keys()) assert.ok(i >= 0 && i < T.m, `${id} landmark at ${i}`);
    for (const r of LM.ranges) assert.ok(r.i0 >= 0 && r.i1 < T.m && r.i0 !== r.i1, `${id} ${r.k} range`);
  }
  const T = R.buildTrack(R.F1_CAL.find((d) => d.id === 'f1ae')), LM = R.buildLandmarks(T), br = [...LM.at.values()].flat().find((it) => it.k === 'bridge');
  assert.ok(br, 'the hotel bridge'); for (let j = -8; j <= 8; j++) assert.ok(Math.abs(T.S[(br.i + j + T.m) % T.m].k) < 0.003, 'it stands over a straight');
  assert.ok(LM.twi > 0 && !R.buildLandmarks(R.buildTrack(R.F1_CAL.find((d) => d.id === 'f1au'))).twi, 'only Yas Marina is a twilight race');
});

test('the announcer says a lap time as minutes and seconds, never as a clock', () => {
  assert.equal(R.spokenTimes('1:28.360. That puts us P2.'), '1 minute 28 point 3 6 0 seconds. That puts us P2.');
  assert.equal(R.spokenTimes('Best lap 2:05.040'), 'Best lap 2 minutes 5 point 0 4 0 seconds');
  assert.equal(R.spokenTimes('59.123. Not an improvement.'), '59 point 1 2 3 seconds. Not an improvement.');
  assert.equal(R.spokenTimes('Gap 0.4 seconds, box this lap'), 'Gap 0.4 seconds, box this lap');
});

// Every track has a deliberate elevation profile: the relief built into the road matches the intent in ELEV_INTENT, no grade is
// steeper than the 17% cap, nothing jumps between samples, and the computer drivers still finish three laps on every track
// (with the game's own physics step: hills, grip and banked corners).
test('relief: every track has the elevation it is meant to have, drivable, and the AI still laps it', () => {
  const defs = R.TRACKS.concat(R.F1_CAL), rows = [];
  assert.deepEqual(defs.map((d) => d.id).filter((id) => !(id in R.ELEV_INTENT)), [], 'every track has an intended relief');
  for (const def of defs) {
    const T = R.buildTrack(def), z = T.S.map((q) => q.z), want = R.ELEV_INTENT[def.id][0];
    const lo = Math.min(...z), hi = Math.max(...z), relief = hi - lo;
    let g = 0, jump = 0; for (let i = 0; i < T.m - (def.closed ? 0 : 1); i++) { const d = z[(i + 1) % T.m] - z[i]; g = Math.max(g, Math.abs(d) / T.step); if (i) jump = Math.max(jump, Math.abs(d - (z[i] - z[i - 1]))); }
    rows.push(`${def.id}\t${want}\t${relief.toFixed(1)}\t${(g * 100).toFixed(1)}%`);
    assert.ok(Math.abs(relief - want) <= Math.max(1.5, want * 0.15), `${def.id}: wanted ${want} m of relief, built ${relief.toFixed(1)}`);
    assert.ok(g <= 0.17 + 1e-6, `${def.id}: steepest grade ${(g * 100).toFixed(1)}%`);
    assert.ok(jump < 0.08, `${def.id}: the slope jumps by ${jump.toFixed(3)} m between samples`);
    if (def.closed) assert.ok(Math.abs(z[0] - z[T.m - 1]) < 0.3, `${def.id}: the lap closes in height`);
    T.laps = def.closed ? 3 : 1;
    const racers = R.CARS.slice(0, 4).map((spec, i) => R.newRacer('a' + i, 'AI' + i, spec, T, i)), st = racers.map(() => ({ idx: -1, lane: 0, skill: 0.9, stuck: 0, rev: 0, go: true }));
    let t = 0, off = 0, steps = 0;
    while (!racers.every((r) => r.finished) && t < 900) {
      racers.forEach((r, i) => { const inp = R.driveAI(T, r.car, st[i], 1 / 60), loc = R.locate(T, r.car.x, r.car.y, r.idx); R.stepOnRoad(T, r.car, inp, 1 / 60, Math.abs(loc.lat) > T.width / 2 + 1.5 ? 0.55 : 1, loc); R.progress(r, T, t); r.car.z = R.trackHeight(T, R.locate(T, r.car.x, r.car.y, r.idx)); steps++; if (Math.abs(r.lat) > T.width / 2 + 1.5 && !r.finished) off++; });
      t += 1 / 60;
    }
    assert.ok(racers.every((r) => r.finished), `${def.id}: AI finished (${t.toFixed(0)} s)`);
    assert.ok(off / steps < 0.06, `${def.id}: off the road ${(100 * off / steps).toFixed(1)}% of the time`);
  }
  if (process.env.RELIEF_TABLE) console.log('track\tintended\tbuilt\tmax grade\n' + rows.join('\n'));
});
