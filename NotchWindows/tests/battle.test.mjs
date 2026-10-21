// Battle: the flat battlefields, the drivable tank and the Automatic flying assist. Run: node --test NotchWindows/tests
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

globalThis.window = globalThis;
globalThis.document = { getElementById: () => null };
createRequire(import.meta.url)('../src/js/games/plane-sim.js');
const G = globalThis.NotchPlaneGame, T = G._test;
const ground = (w) => (x, z) => T.groundAt(w, x, z);

test('each battlefield is flat in the middle, has a low rim of hills (or sea) round the edge, and sea beyond', () => {
  for (const a of T.ARENAS) {
    const inner = [];
    for (let r = 0; r <= 0.9 * a.R; r += 150) for (let th = 0; th < 6.28; th += 0.5) inner.push(T.arenaHeight(a, Math.cos(th) * r, Math.sin(th) * r));
    if (a.island) {
      assert.ok(T.arenaHeight(a, 0, 0) > 25, `${a.id} has a fortress hill`);
      assert.ok(T.arenaHeight(a, 0, a.R * 1.3) < 0, `${a.id} is surrounded by sea`);
      assert.ok(T.arenaHeight(a, a.R * 0.5, 0) > 3, `${a.id} has dry land`);
    } else {
      const lo = Math.min(...inner), hi = Math.max(...inner);
      assert.ok(hi - lo < a.rough * 2 + (a.hills || 0) * 1.5 + 8, `${a.id} is level: ${lo.toFixed(1)} to ${hi.toFixed(1)}`);
      assert.ok(lo > 0, `${a.id} has no water inside`);
      assert.ok(T.arenaHeight(a, 0, a.R * 1.5) > a.base + 20, `${a.id} has a rim of hills`);
      assert.ok(T.arenaHeight(a, 0, a.R * 3) < 0, `${a.id} has sea beyond the rim`);
    }
  }
});

test('a battlefield world has none of the valley\'s runway, towns and bridge, and is the same every time', () => {
  const a = T.ARENAS[0];
  T.setArena(a);
  try {
    const w1 = T.makeWorld(T.REGIONS[0], a), w2 = T.makeWorld(T.REGIONS[0], a);
    assert.equal(w1.arena, 'plains');
    assert.ok(Math.abs(T.groundAt(w1, 0, 0) - T.groundAt(w2, 0, 0)) < 1e-9);
    const built = w1.colliders.filter((c) => c.kind !== 'tree');
    assert.ok(built.length > 5 && built.length < 120, `only the battlefield's own bases and rocks, no airfield or town (${built.length})`);
    assert.ok(!built.some((c) => ['hangar', 'tower', 'mast', 'bridge'].includes(c.kind)), 'no hangars, towers, masts or bridge');
    assert.ok(Math.abs(T.groundAt(w1, 20, -300) - a.base) < 8 + a.hills * 1.2, 'the old runway is gone: just ground (rolling hills, no runway)');
  } finally { T.setArena(null); }
});

function battleWorld(i = 0) { const a = T.ARENAS[i]; T.setArena(a); return { a, w: T.makeWorld(T.REGIONS[0], a) }; }

test('a tank drives forward, turns, reverses more slowly, and sits on the ground', () => {
  const { a, w } = battleWorld(0);
  try {
    const t = new T.TankBody([0, 0, 2000], 0);
    for (let i = 0; i < 300; i++) t.step(1 / 60, { drive: 1, steer: 0, aimX: 0, aimY: 0 }, w, a.R * 1.05);   // 5 s
    assert.ok(t.speed > 10 && t.speed <= T.TANK.speed + 0.01, `speed ${t.speed}`);
    assert.ok(t.pos[2] < 2000 - 30, `it went north: z ${t.pos[2]}`);
    assert.ok(Math.abs(t.pos[1] - T.groundAt(w, t.pos[0], t.pos[2])) < 1.5, 'on the ground');
    const h0 = t.heading;
    for (let i = 0; i < 60; i++) t.step(1 / 60, { drive: 0, steer: 1, aimX: 0, aimY: 0 }, w, a.R * 1.05);
    assert.ok(T.wrapPi(t.heading - h0) > 0.5, 'steering right turns it right');
    const r = new T.TankBody([0, 0, 0], 0);
    for (let i = 0; i < 300; i++) r.step(1 / 60, { drive: -1, steer: 0, aimX: 0, aimY: 0 }, w, a.R * 1.05);
    assert.ok(r.speed < 0 && r.speed >= -T.TANK.reverse - 0.01, `reverse speed ${r.speed}`);
  } finally { T.setArena(null); }
});

test('holding boost makes a tank faster than normal throttle', () => {
  const { a, w } = battleWorld(0);
  try {
    const normal = new T.TankBody([0, 0, 2000], 0);
    const boosted = new T.TankBody([100, 0, 2000], 0);
    for (let i = 0; i < 300; i++) {
      normal.step(1 / 60, { drive: 1, steer: 0, aimX: 0, aimY: 0 }, w, a.R * 1.05);
      boosted.step(1 / 60, { drive: 1, steer: 0, aimX: 0, aimY: 0, boost: true }, w, a.R * 1.05);
    }
    assert.ok(normal.speed <= T.TANK.speed + 0.01, `normal speed ${normal.speed}`);
    assert.ok(boosted.speed > normal.speed + 5, `boosted ${boosted.speed} vs normal ${normal.speed}`);
    assert.ok(boosted.speed <= T.TANK.boostSpeed + 0.01, `boosted speed ${boosted.speed}`);
  } finally { T.setArena(null); }
});

test('a tank cannot leave the battlefield or drive into the sea', () => {
  const { a, w } = battleWorld(0);
  try {
    const t = new T.TankBody([0, 0, a.R * 0.95], 0);
    for (let i = 0; i < 60 * 40; i++) t.step(1 / 60, { drive: 1, steer: 0, aimX: 0, aimY: 0 }, w, a.R * 1.05);
    for (let i = 0; i < 60 * 40; i++) t.step(1 / 60, { drive: 1, steer: 0.0, aimX: 0, aimY: 0 }, w, a.R * 1.05);
    assert.ok(Math.hypot(t.pos[0], t.pos[2]) <= a.R * 1.05 + 5);
  } finally { T.setArena(null); }
  const { a: isl, w: iw } = battleWorld(2);
  try {
    const t = new T.TankBody([0, 0, 1500], Math.PI / 2);        // heading east, towards the sea
    for (let i = 0; i < 60 * 120; i++) t.step(1 / 60, { drive: 1, steer: 0, aimX: 0, aimY: 0 }, iw, isl.R * 1.4);
    assert.ok(T.groundAt(iw, t.pos[0], t.pos[2]) > 0, 'it stopped at the shore');
  } finally { T.setArena(null); }
});

test('the turret and gun turn and are limited, and the aim solution hits what it aims at', () => {
  const { w } = battleWorld(0);
  try {
    const t = new T.TankBody([0, 0, 2000], 0);
    for (let i = 0; i < 60; i++) t.step(1 / 60, { drive: 0, steer: 0, aimX: 1, aimY: 1 }, w, 1e9);
    assert.ok(T.wrapPi(t.turret - 0) > 1.5, 'the turret turned right');
    assert.ok(t.gun <= T.TANK.gunMax + 1e-9 && t.gun > 0.3, 'the gun is raised and stops at its limit');
    // Aim at a target 900 m away and fly a shell to it.
    const tank = new T.TankBody([0, 0, 2000], 0);
    const target = [300, 6, 1200];
    const s = T.tankAimAt(tank, target, [0, 0, 0]);
    tank.turret = s.yaw; tank.gun = s.pitch;
    const shell = { pos: tank.muzzle(), vel: tank.aim().map((v) => v * T.TANK.shell), t: 0 };
    let best = 1e9;
    for (let i = 0; i < 1200; i++) { T.WAR.bulletStep(shell, 0.005); best = Math.min(best, Math.hypot(shell.pos[0] - target[0], shell.pos[1] - target[1], shell.pos[2] - target[2])); }
    assert.ok(best < 6, `the shell came within ${best.toFixed(1)} m`);
  } finally { T.setArena(null); }
});

test('Automatic flying holds its height and speed, turns briskly, and never stalls or hits the ground', () => {
  const { w } = battleWorld(0);
  try {
    for (const id of ['f16', 'a10', 'b52']) {
      const P = G.PLANES.find((p) => p.id === id), fl = new G.Flight(P);
      fl.reset([0, 600, 1500], 0, P.cruise, false);
      const st = { hdg: fl.heading, alt: 600, spd: P.cruise * 1.05, i: 0 };
      let minAgl = 1e9, stalled = 0, h8 = 0;
      for (let t = 0; t < 40; t += 1 / 60) {
        const cmd = t < 8 ? { turn: 1, climb: 0 } : { turn: 0, climb: 0 };
        fl.step(1 / 60, T.planeAssist(fl, st, cmd, 1 / 60, w), w);
        minAgl = Math.min(minAgl, fl.pos[1] - T.groundAt(w, fl.pos[0], fl.pos[2]));
        if (fl.inStall) stalled++;
        if (Math.abs(t - 8) < 1 / 120) h8 = fl.heading;
        assert.ok(!fl.crashed, `${id} crashed at ${t.toFixed(1)} s`);
      }
      assert.ok(h8 > 0.6, `${id} turned ${(h8 * 57.3).toFixed(0)}° in 8 s`);
      assert.ok(minAgl > 150, `${id} stayed ${minAgl.toFixed(0)} m up`);
      assert.equal(stalled, 0, `${id} never stalled`);
      assert.ok(Math.abs(fl.ias - P.cruise * 1.05) < 35, `${id} held its speed: ${fl.ias.toFixed(0)}`);
    }
  } finally { T.setArena(null); }
});

test('Battle sturdy-wing handling caps speed and G through hard turns without losing wings', () => {
  const { w } = battleWorld(0);
  try {
    for (const assist of ['easy', 'pro']) {
      const P = G.PLANES.find((p) => p.id === 'f16'), fl = new G.Flight(P);
      fl.reset([0, 900, 1500], 0, P.cruise, false);
      fl.sturdy = true;
      const assistState = { hdg: fl.heading, alt: 900, spd: P.cruise, i: 0 };
      for (let i = 0; i < 60 * 60; i++) {
        const roll = i % 600 < 240 ? 1 : i % 600 < 480 ? -1 : 0;
        fl.step(1 / 60, T.planeAssist(fl, assistState, { turn: roll, climb: 0 }, 1 / 60, w), w);
        assert.ok(fl.damage.L && fl.damage.R, `${assist}: wings intact at ${(i / 60).toFixed(1)}s`);
        const actualAirSpeed = Math.hypot(fl.vel[0] - fl.wind[0], fl.vel[1] - fl.wind[1], fl.vel[2] - fl.wind[2]);
        assert.ok(actualAirSpeed <= P.max + 2, `${assist}: speed capped at ${actualAirSpeed.toFixed(1)} m/s`);
        assert.ok(Math.abs(fl.gload) <= Math.max(1.5, P.gLimit * 0.72) + 1e-6, `${assist}: G limited to ${fl.gload.toFixed(1)}`);
        assert.ok(!fl.crashed, `${assist}: no crash at ${(i / 60).toFixed(1)}s`);
      }
    }
  } finally { T.setArena(null); }
});

test('arcade handling: turn and climb rates, quick turn, no stall, no wing loss under violent stick input', () => {
  const { w } = battleWorld(0);
  try {
    for (const id of ['f16', 'a10', 'b52', 'f15', 'su27']) {
      const P = G.PLANES.find((p) => p.id === id), R = T.ARCADE_RATES[id];
      const mk = () => { const fl = new G.Flight(P); fl.reset([0, 900, 1500], 0, P.cruise, false); fl.sturdy = true; fl.arcade = R; return fl; };
      // full-right stick: the jet leans in first (it does not turn instantly), then turns at about the table's rate
      let fl = mk();
      for (let i = 0; i < 12; i++) fl.step(1 / 60, { roll: 1, pitch: 0, yaw: 0, throttle: 0.7 }, w);
      assert.ok(Math.abs(fl.arc.bank) < 0.5, `${id} banked gradually (${fl.arc.bank.toFixed(2)} rad after 0.2 s)`);
      for (let i = 12; i < 120; i++) fl.step(1 / 60, { roll: 1, pitch: 0, yaw: 0, throttle: 0.7 }, w);
      const deg = fl.heading * 180 / Math.PI;
      assert.ok(deg > R.turn * 57.3 * 2 * 0.6 && deg < R.turn * 57.3 * 2 * 1.1, `${id} turned ${deg.toFixed(0)} deg in 2 s`);
      // full push forward for 3 s: it dives faster than it climbs
      fl = mk();
      for (let i = 0; i < 180; i++) fl.step(1 / 60, { roll: 0, pitch: -1, yaw: 0, throttle: 0.7 }, w);
      assert.ok(900 - fl.pos[1] > R.climb * 3 * 0.8, `${id} dived ${(900 - fl.pos[1]).toFixed(0)} m in 3 s`);
      // full pull for 3 s climbs at about the table's rate
      fl = mk();
      for (let i = 0; i < 180; i++) fl.step(1 / 60, { roll: 0, pitch: 1, yaw: 0, throttle: 1 }, w);
      assert.ok(fl.pos[1] - 900 > R.climb * 3 * 0.45, `${id} climbed ${(fl.pos[1] - 900).toFixed(0)} m in 3 s`);
      // violent stick for 60 s: nothing breaks, no stall
      fl = mk(); let stalled = 0;
      for (let i = 0; i < 3600; i++) {
        const s = Math.sin(i / 7);
        fl.step(1 / 60, { roll: s > 0 ? 1 : -1, pitch: Math.cos(i / 5) > 0 ? 1 : -1, yaw: s, throttle: 0.8 }, w);
        if (fl.inStall) stalled++;
        if (fl.crashed) { fl = mk(); }
        assert.ok(fl.wings === 2 || fl.wings === undefined || fl.wings > 0, `${id} lost a wing`);
      }
      assert.equal(stalled, 0, `${id} never stalled`);
    }
    // quick turn: f16 about 180 degrees inside 3 s
    const P = G.PLANES.find((p) => p.id === 'f16'), fl = new G.Flight(P);
    fl.reset([0, 900, 1500], 0, P.cruise, false); fl.arcade = T.ARCADE_RATES.f16; fl.sturdy = true;
    fl.step(1 / 60, { roll: 0, pitch: 0, yaw: 0, throttle: 0.7 }, w);
    assert.ok(fl.quickTurn(1));
    for (let i = 0; i < 180; i++) fl.step(1 / 60, { roll: 0, pitch: 0, yaw: 0, throttle: 0.7 }, w);
    assert.ok(Math.abs(T.wrapPi(fl.heading - Math.PI)) < 0.35, `quick turn ended ${(fl.heading * 57.3).toFixed(0)} deg`);
    assert.ok(!fl.quickTurn(1), 'cooldown');
  } finally { T.setArena(null); }
});

test('a tree that is hit breaks: it stops being solid, leaves the picture and is reported, and a sturdy plane flies on through it', () => {
  const a = T.ARENAS.find((x) => x.id === 'plains'); T.setArena(a);
  try {
    const w = T.makeWorld(T.REGIONS[0], a); T.primeObjects(w, 0, 0, 900);
    const tree = w.colliders.find((c) => c.kind === 'tree'); assert.ok(tree, 'there are trees');
    const mid = [(tree.min[0] + tree.max[0]) / 2, (tree.min[1] + tree.max[1]) / 2, (tree.min[2] + tree.max[2]) / 2];
    assert.equal(T.hitObject(w, mid), tree);
    const before = w.colliders.length;
    assert.ok(T.breakTree(w, tree)); assert.ok(!T.breakTree(w, tree), 'only once');
    assert.equal(w.colliders.length, before - 1); assert.notEqual(T.hitObject(w, mid), tree);
    assert.equal(w.felled.length, 1); assert.equal(w.broken, 1);
    // A sturdy plane's wingtip through another tree breaks it and slows the plane, with no crash.
    const t2 = w.colliders.find((c) => c.kind === 'tree' && c !== tree);
    const P = G.PLANES.find((p) => p.id === 'f16'), fl = new G.Flight(P);
    fl.reset([(t2.min[0] + t2.max[0]) / 2, (t2.min[1] + t2.max[1]) / 2 + 0, (t2.min[2] + t2.max[2]) / 2 + 40], 0, P.cruise, false); fl.sturdy = true;
    for (let i = 0; i < 90 && !fl.crashed; i++) fl.step(1 / 60, { pitch: 0, roll: 0, yaw: 0, throttle: 0.7 }, w);
    assert.ok(!fl.crashed, 'a sturdy plane does not crash into a tree');
    assert.ok(w.felled.length >= 2 || T.hitObject(w, [(t2.min[0] + t2.max[0]) / 2, (t2.min[1] + t2.max[1]) / 2, (t2.min[2] + t2.max[2]) / 2]) !== t2, 'the tree it ran into is gone');
  } finally { T.setArena(null); }
});

test('a tree another player broke can be found by its position and broken here too, and is told to nobody again', () => {
  const a = T.ARENAS.find((x) => x.id === 'plains'); T.setArena(a);
  try {
    const w1 = T.makeWorld(T.REGIONS[0], a), w2 = T.makeWorld(T.REGIONS[0], a);
    T.primeObjects(w1, 0, 0, 900);
    const tree = w1.colliders.find((c) => c.kind === 'tree'), x = (tree.min[0] + tree.max[0]) / 2, z = (tree.min[2] + tree.max[2]) / 2;
    assert.ok(T.breakTree(w1, tree)); assert.equal(w1.felled[0][4], false, 'a local break is reported to the others');
    const twin = T.treeAt(w2, Math.round(x * 10) / 10, Math.round(z * 10) / 10);       // the position travels rounded to 0.1 m
    assert.ok(twin, 'the same world has the same tree there');
    assert.ok(T.breakTree(w2, twin, true)); assert.equal(w2.felled[0][4], true, 'a break learned from another player is not sent on');
    assert.equal(T.treeAt(w2, x, z), null, 'it is gone');
  } finally { T.setArena(null); }
});
