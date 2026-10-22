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
        R.stepCar(r.car, inp, 1 / 60, Math.abs(loc.lat) > T.width / 2 + 1.5 ? 0.55 : 1);
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
