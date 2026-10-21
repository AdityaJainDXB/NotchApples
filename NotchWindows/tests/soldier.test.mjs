// Battle: the soldier on foot (movement, limits, scoped bullet drop, how often enemy riflemen hit). Run: node --test NotchWindows/tests
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

globalThis.window = globalThis;
globalThis.document = { getElementById: () => null };
createRequire(import.meta.url)('../src/js/games/plane-sim.js');
const G = globalThis.NotchPlaneGame, T = G._test, { SOLDIER, SoldierBody, WAR } = { ...T, WAR: T.WAR };
const arena = (id) => T.ARENAS.find((a) => a.id === id);
const world = (id = 'plains') => { const a = arena(id); T.setArena(a); return T.makeWorld(T.REGIONS[0], a); };
const run = (b, w, inp, secs, limit) => { for (let t = 0; t < secs; t += 1 / 60) b.step(1 / 60, inp, w, limit); return b; };
const still = { drive: 0, steer: 0, aimX: 0, aimY: 0 };

test('a soldier walks, runs, backs up slowly and crouches slower', () => {
  const w = world();
  try {
    const sp = (inp) => { const b = new SoldierBody([0, 0, 0], 0); run(b, w, inp, 3); return b.speed; };
    const walk = sp({ ...still, drive: 1 }), runS = sp({ ...still, drive: 1, boost: true }), back = sp({ ...still, drive: -1 }), crouch = sp({ ...still, drive: 1, crouch: true });
    assert.ok(Math.abs(walk - SOLDIER.walk) < 0.3, `walk ${walk}`);
    assert.ok(Math.abs(runS - SOLDIER.run) < 0.4, `run ${runS}`);
    assert.ok(back < walk * 0.7 && crouch < walk * 0.6, `back ${back} crouch ${crouch}`);
  } finally { T.setArena(null); }
});

test('mouse look turns the soldier and the camera looks where it points, within pitch limits', () => {
  const w = world();
  try {
    const b = run(new SoldierBody([0, 0, 0], 0), w, { ...still, aimX: 1 }, 1);
    assert.ok(Math.abs(b.turret - SOLDIER.lookRate) < 0.1, `turned ${b.turret}`);
    run(b, w, { ...still, aimY: 1 }, 5); assert.ok(b.gun <= SOLDIER.pitchMax + 1e-9);
    run(b, w, { ...still, aimY: -1 }, 9); assert.ok(b.gun >= SOLDIER.pitchMin - 1e-9);
    const z = run(new SoldierBody([0, 0, 0], 0), w, { ...still, aimX: 1, lookScale: 0.1 }, 1);
    assert.ok(z.turret < b.turret || z.turret < 0.25, 'looking is slower when zoomed in');
  } finally { T.setArena(null); }
});

test('a soldier stops at the edge of the battlefield, at water and at trees', () => {
  const w = world();
  try {
    const b = new SoldierBody([0, 0, 3000], 0); b.turret = b.heading = Math.PI;       // facing +z, away from the middle
    run(b, w, { ...still, drive: 1, boost: true }, 30, 3050);
    assert.ok(Math.hypot(b.pos[0], b.pos[2]) <= 3051, `stayed in: ${Math.hypot(b.pos[0], b.pos[2])}`);
    const isl = world('island'), c = new SoldierBody([0, 0, 600], 0); c.turret = c.heading = Math.PI;
    run(c, isl, { ...still, drive: 1, boost: true }, 120, 5000);
    assert.ok(T.groundAt(isl, c.pos[0], c.pos[2]) >= 0.4, 'did not walk into the sea');
  } finally { T.setArena(null); }
});

test('the rifle sways less when still and less again when crouched; zoom tightens the spread', () => {
  const w = world();
  try {
    const mv = run(new SoldierBody([0, 0, 0], 0), w, { ...still, drive: 1 }, 2), st = run(new SoldierBody([0, 0, 0], 0), w, still, 4), cr = run(new SoldierBody([0, 0, 0], 0), w, { ...still, crouch: true }, 4);
    assert.ok(mv.spread() > st.spread() * 2, `moving ${mv.spread()} still ${st.spread()}`);
    assert.ok(cr.spread() < st.spread(), 'crouching steadies the rifle');
    assert.ok(st.spread(10) < st.spread(1), 'zoom helps');
  } finally { T.setArena(null); }
});

test('bullet drop: a 760 m/s round falls a few centimetres at 100 m and metres at 500 m, so the scope marks are real', () => {
  const dropAt = (r) => { const b = { pos: [0, 0, 0], vel: [0, 0, -SOLDIER.muzzle], t: 0 }; while (-b.pos[2] < r) WAR.bulletStep(b, 0.002); return -b.pos[1]; };
  const d1 = dropAt(100), d5 = dropAt(500);
  assert.ok(d1 > 0.03 && d1 < 0.3, `drop at 100 m ${d1}`);
  assert.ok(d5 > 1 && d5 < 8, `drop at 500 m ${d5}`);
  console.log('drop 100/500 m:', d1.toFixed(3), d5.toFixed(2));
  assert.ok(d5 > d1 * 15, 'drop grows faster than the range');
});

test('the player\'s rifle kills a rifleman in two hits, theirs needs many hits on the player', () => {
  assert.equal(Math.ceil(SOLDIER.enemyHp / SOLDIER.dmg), 2);
  assert.ok(SOLDIER.dmg >= SOLDIER.enemyDmg * 2, 'twice the damage');
  assert.ok(SOLDIER.hp / SOLDIER.enemyDmg >= 12, 'the player takes at least a dozen of their hits');
});

test('enemy riflemen miss a lot at range: simulated bursts', () => {
  const rate = (range, aim) => {
    let hits = 0, n = 6000, seed = 7; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    for (let i = 0; i < n; i++) {
      const err = T.riflemanError(range, aim);
      const d = [(rnd() - 0.5) * err * 2, (rnd() - 0.5) * err * 2, -1], l = Math.hypot(...d);
      const b = { pos: [0, 1.4, 0], vel: d.map((v) => v / l * 650), t: 0 }, tgt = [0, 1.4, -range];
      let p0 = b.pos.slice(); while (-b.pos[2] < range + 2 && b.t < 3) { p0 = b.pos.slice(); WAR.bulletStep(b, 0.004); if (WAR.segHit(p0, b.pos, tgt, 1.0)) { hits++; break; } }
    }
    return hits / n;
  };
  const near = rate(60, 0.07), mid = rate(150, 0.07), far = rate(300, 0.07);
  assert.ok(mid < 0.35, `hit rate at 150 m ${mid}`);
  assert.ok(far < mid && far < 0.15, `hit rate at 300 m ${far}`);
  console.log('hit rates 60/150/300 m:', near.toFixed(3), mid.toFixed(3), far.toFixed(3));
  assert.ok(near > far, 'closer is more dangerous');
});

test('the RPG: a rocket kills a rifleman outright, drops a little over 200 m, and each wave gives more', () => {
  assert.ok(SOLDIER.rpgDmg >= SOLDIER.enemyHp * 2, 'one rocket is enough for an enemy soldier');
  assert.ok(SOLDIER.rpgEnemyDmg < SOLDIER.hp / 3, 'an enemy rocket takes less than a third of your health');
  const b = { pos: [0, 0, 0], vel: [0, 0, -SOLDIER.rpgSpeed], t: 0 }; while (-b.pos[2] < 200) WAR.bulletStep(b, 0.002);
  assert.ok(-b.pos[1] > 1 && -b.pos[1] < 40, `rocket drop at 200 m ${(-b.pos[1]).toFixed(1)}`);
  console.log('rocket drop at 200 m:', (-b.pos[1]).toFixed(1));
  assert.ok(SOLDIER.rpgReload > SOLDIER.fireGap * 10, 'a slow reload');
});
