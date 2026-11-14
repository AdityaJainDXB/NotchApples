// F1 tyres: two temperature zones, compound windows, graining, blistering, the wear cliff. Run: node --test NotchWindows/tests
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const Ty = require('../src/js/games/f1/tyres.js');

// A lap: [seconds, speed, lateral g, steer, brake, throttle, slip]
const LAP = [[12, 85, 0, 0, 0, 1, 0], [3, 70, 0.5, 0, 1, 0, 0.2], [5, 35, 3.2, 1, 0.1, 0.4, 0.8], [5, 55, 2.2, 1, 0, 1, 0.6], [10, 75, 3.8, -1, 0, 0.9, 0.5], [10, 88, 0, 0, 0, 1, 0], [3, 75, 0.6, 0, 1, 0, 0.2], [6, 40, 3.0, 1, 0, 0.5, 0.7], [6, 60, 2.5, -1, 0, 1, 0.6], [10, 80, 3.2, 1, 0, 1, 0.4], [10, 85, 0.5, 0, 0, 1, 0]];
function drive(compound, laps, effort = 1, hz = 60, opt = {}) {
  const s = Ty.createSet(compound, opt.set), dt = 1 / hz; let carcass = 0, n = 0, out;
  for (let lap = 1; lap <= laps; lap++) for (const [secs, v, g, st, br, th, sl] of LAP) for (let t = 0; t < secs; t += dt) {
    out = Ty.step(s, { v, latG: g * effort, steer: st, brake: br, throttle: th, slip: sl * effort, ambientC: 28, trackC: 40, wet: 0, ...(opt.p || {}) }, dt);
    if (lap >= 3) { carcass += out.carcass; n++; }
  }
  return { s, out, meanCarcass: carcass / Math.max(1, n) };
}

test('each compound has its carcass window: Soft 90 to 110, Medium 100 to 120, Hard 110 to 135 degrees', () => {
  assert.deepEqual(Ty.windowOf('S'), [90, 110]); assert.deepEqual(Ty.windowOf('M'), [100, 120]); assert.deepEqual(Ty.windowOf('H'), [110, 135]);
});

test('driven hard, every dry compound settles inside its window; driven gently the carcass stays cold and the grip suffers', () => {
  for (const c of ['S', 'M', 'H']) {
    const [lo, hi] = Ty.windowOf(c), push = drive(c, 5, 1), easy = drive(c, 5, 0.6);
    assert.ok(push.meanCarcass >= lo - 1 && push.meanCarcass <= hi + 1, `${c} pushed: ${push.meanCarcass.toFixed(0)} not in ${lo}-${hi}`);
    assert.ok(easy.meanCarcass < lo - 4 && easy.out.state === 'cold', `${c} cruising: ${easy.meanCarcass.toFixed(0)}`);
    assert.ok(Ty.gripFromCarcass(c, easy.meanCarcass) < 0.95, 'a cold tyre grains and loses grip');
  }
});

test('the surface temperature changes quickly and the carcass slowly', () => {
  const s = Ty.createSet('M', { startC: 60 });
  const base = { v: 60, latG: 3.5, steer: 1, brake: 0, throttle: 0.6, slip: 0.8, ambientC: 28, trackC: 40, wet: 0 };
  let ts5 = 0, tc5 = 0;
  for (let t = 0; t < 2; t += 1 / 60) Ty.step(s, base, 1 / 60);
  ts5 = s.w[0].Ts - 60; tc5 = s.w[0].Tc - 60;
  assert.ok(ts5 > 20 && ts5 > 3 * tc5, `after 2 s: surface +${ts5.toFixed(1)}, carcass +${tc5.toFixed(1)}`);
  for (let t = 0; t < 3; t += 1 / 60) Ty.step(s, base, 1 / 60);
  // on a straight at speed the surface cools back down quickly, the carcass hardly moves
  const sc0 = s.w[0].Tc;
  for (let t = 0; t < 6; t += 1 / 60) Ty.step(s, { ...base, latG: 0, steer: 0, slip: 0, throttle: 1 }, 1 / 60);
  assert.ok(s.w[0].Ts < s.w[0].Tc + 10 && Math.abs(s.w[0].Tc - sc0) < 8, 'the surface cooled and the carcass held its heat');
});

test('overheating: far past the window the grip falls, the surface blisters (and the blisters stay), and the rear snaps loose', () => {
  const hot = drive('S', 6, 1.9);
  assert.ok(hot.out.state === 'hot' && hot.out.blistering > 0.3, `state ${hot.out.state}, blistering ${hot.out.blistering.toFixed(2)}`);
  assert.ok(hot.out.snap > 0 || hot.out.blistering > 0.6, 'snap oversteer comes with a blistered rear');
  assert.ok(hot.out.grip < drive('S', 6, 1).out.grip - 0.1, 'a blistered, overheated tyre has much less grip');
  const b = hot.out.blistering, s = hot.s;
  for (let t = 0; t < 60; t += 1 / 60) Ty.step(s, { v: 30, latG: 0, steer: 0, brake: 0, throttle: 0.2, slip: 0, ambientC: 20, trackC: 25, wet: 0 }, 1 / 60);
  assert.ok(s.last.blistering >= b - 1e-9, 'blisters do not heal when the tyre cools');
  assert.ok(Ty.gripFromCarcass('S', 150) < Ty.gripFromCarcass('S', 112));
});

test('grip falls slowly with wear down to 30 percent life, then drops off a cliff', () => {
  const g = Ty.gripFromLife;
  assert.equal(g(1), 1);
  for (let l = 1; l > 0.01; l -= 0.01) assert.ok(g(l - 0.01) <= g(l) + 1e-12, `monotonic at ${l.toFixed(2)}`);
  assert.ok(Math.abs(g(0.30) - 0.90) < 0.01, `at the cliff edge ${g(0.3)}`);
  const slowSlope = (g(0.6) - g(0.4)) / 0.2, cliffSlope = (g(0.2) - g(0.1)) / 0.1;
  assert.ok(cliffSlope > 4 * slowSlope, `slope before ${slowSlope.toFixed(2)}, after ${cliffSlope.toFixed(2)}`);
  assert.ok(g(0) < 0.5 && g(0.31) > 0.89, 'worn out is a very slow car; just before the cliff it is fine');
  // and in use: a set driven to its end passes the cliff and says so
  const worn = drive('S', 12, 1);
  assert.ok(worn.out.life < 0.3 && worn.out.cliff, `life ${worn.out.life.toFixed(2)}`);
  assert.ok(worn.out.grip < drive('S', 3, 1).out.grip - 0.15);
});

test('softer rubber wears faster, wear never reverses, and the compounds compare as expected', () => {
  const life = (c) => drive(c, 4, 1).out.life;
  assert.ok(life('S') < life('M') && life('M') < life('H'), `S ${life('S').toFixed(2)} M ${life('M').toFixed(2)} H ${life('H').toFixed(2)}`);
  const s = Ty.createSet('M'); let last = 1;
  for (let t = 0; t < 120; t += 1 / 30) { const o = Ty.step(s, { v: 70, latG: 2, steer: 1, brake: 0, throttle: 0.5, slip: 0.5, ambientC: 25, wet: 0 }, 1 / 30); assert.ok(o.life <= last + 1e-12); last = o.life; }
  assert.ok(Ty.TYRE.compounds.S.grip > Ty.TYRE.compounds.M.grip && Ty.TYRE.compounds.M.grip > Ty.TYRE.compounds.H.grip);
  assert.ok(Ty.lifeOf(s) <= s.last.life + 1e-12, 'the most worn wheel is the one to watch');
});

test('rain: slicks lose most of their grip on a wet track, intermediates and wets keep it', () => {
  for (const wet of [0.5, 0.9]) assert.ok(Ty.wetGrip('S', wet) < Ty.wetGrip('I', wet) || wet < 0.3, `wet ${wet}`);
  assert.ok(Ty.wetGrip('S', 1) < 0.5 * Ty.wetGrip('S', 0));
  assert.ok(Ty.wetGrip('W', 1) > Ty.wetGrip('S', 1) && Ty.wetGrip('I', 0.5) > Ty.wetGrip('S', 0.5));
  assert.ok(Ty.wetGrip('I', 0) < Ty.wetGrip('S', 0), 'on a dry track the inter is slower');
  const dry = drive('S', 1, 1, 60, { p: { wet: 0 } }).meanCarcass || 0, wetR = drive('S', 3, 1, 60, { p: { wet: 1 } });
  assert.ok(wetR.out.surface < drive('S', 3, 1).out.surface, 'rain cools the surface');
});

test('dirty air heats the front tyres more than the rear', () => {
  const clean = drive('M', 2, 1, 60, { p: { dirty: 0 } }), dirty = drive('M', 2, 1, 60, { p: { dirty: 1 } });
  const front = (r) => (r.s.w[0].Ts + r.s.w[1].Ts) / 2, rear = (r) => (r.s.w[2].Ts + r.s.w[3].Ts) / 2;
  assert.ok(front(dirty) > front(clean) + 5 && Math.abs(rear(dirty) - rear(clean)) < 2, `front ${front(clean).toFixed(0)} -> ${front(dirty).toFixed(0)}`);
});

test('tyre results do not depend on the frame rate', () => {
  const a = drive('M', 4, 1, 30), b = drive('M', 4, 1, 60), c = drive('M', 4, 1, 120);
  for (const [x, y] of [[a, b], [c, b]]) { assert.ok(Math.abs(x.out.carcass - y.out.carcass) < 2.5 && Math.abs(x.out.life - y.out.life) < 0.01 && Math.abs(x.out.grip - y.out.grip) < 0.02, `${x.out.carcass.toFixed(1)} vs ${y.out.carcass.toFixed(1)}`); }
});
