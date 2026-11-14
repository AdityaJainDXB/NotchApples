// F1 track evolution and weather: rubbering in, washing, drying, kerbs, the weather timeline and the radar. Run: node --test NotchWindows/tests
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const V = require('../src/js/games/f1/evolution.js');
const L = 4000, W = 14;

/// Drive `laps` laps of a line at lateral offset `lat` at 70 m/s.
function drive(E, laps, lat = 0, opt = {}) { const dt = 0.1; for (let lap = 0; lap < laps; lap++) for (let s = 0; s < L; s += 70 * dt) V.deposit(E, s, lat + (opt.wobble ? Math.sin(s / 300) * opt.wobble : 0), 70, dt, opt); }

test('a green track is slow, and rubber laid on the racing line adds 3 to 5 percent of grip as the laps go by', () => {
  const E = V.create(L, W), green = V.gripAt(E, 1000, 0).trackK;
  assert.ok(green < 1.0 && green > 0.94, `green ${green.toFixed(3)}`);
  const after = [];
  for (let i = 0; i < 4; i++) { drive(E, 40, 0, { wobble: 1.2 }); after.push(V.gripAt(E, 1000, 0).trackK); }      // (many cars' laps)
  assert.ok(after.every((g, i) => i === 0 || g > after[i - 1]), `it keeps improving: ${after.map((g) => g.toFixed(3))}`);
  const gain = after[3] - green;
  assert.ok(gain >= 0.03 && gain <= 0.055, `the racing line gained ${(gain * 100).toFixed(1)} %`);
  const off = V.gripAt(E, 1000, 6.2).trackK;
  assert.ok(off < after[3] - 0.03, `the dusty edge is much slower than the line: ${off.toFixed(3)} vs ${after[3].toFixed(3)}`);
  assert.ok(V.summary(E).rubber > 0.05 && V.summary(E).lineRubber > 0.2);
});

test('rubber is laid only by fast cars on a dry track, and sliding lays more', () => {
  const slow = V.create(L, W), fast = V.create(L, W), slide = V.create(L, W);
  for (let s = 0; s < L; s += 2) V.deposit(slow, s, 0, 10, 0.1);
  drive(fast, 10, 0); drive(slide, 10, 0, { slide: true });
  assert.equal(V.summary(slow).rubber, 0); assert.ok(V.summary(slide).rubber > V.summary(fast).rubber);
  const wet = V.create(L, W); V.step(wet, 30, 1); drive(wet, 5, 0); assert.ok(V.summary(wet).rubber < 0.001, 'nothing is laid on a wet track');
});

test('rain washes the rubber away and leaves a wet track, wetter off the racing line; the line dries first', () => {
  const E = V.create(L, W); drive(E, 160, 0, { wobble: 0.4 });
  const rubbered = V.summary(E).lineRubber; assert.ok(rubbered > 0.3);
  for (let t = 0; t < 600; t += 1) V.step(E, 1, 1);
  const washed = V.summary(E).lineRubber;
  assert.ok(washed < rubbered * 0.2, `rubber ${rubbered.toFixed(2)} -> ${washed.toFixed(2)}`);
  const line = V.gripAt(E, 1000, 0), edge = V.gripAt(E, 1000, 6.2);
  assert.ok(line.wet > 0.8 && edge.wet >= line.wet, `wet on the line ${line.wet.toFixed(2)}, off it ${edge.wet.toFixed(2)}`);
  // dry again: the racing line (with rubber) dries sooner than the off-line puddles
  const D = V.create(L, W); drive(D, 160, 0, { wobble: 0.4 }); for (let t = 0; t < 40; t++) V.step(D, 1, 0.5);
  for (const c of [0]) for (let k = 0; k < D.wet.length; k++) D.wet[k] = Math.max(D.wet[k], 0.7);
  for (let t = 0; t < 200; t++) V.step(D, 1, 0);
  const l2 = V.gripAt(D, 1000, 0).wet, e2 = V.gripAt(D, 1000, 6.2).wet;
  assert.ok(l2 < e2, `the line dried first: ${l2.toFixed(2)} vs ${e2.toFixed(2)}`);
  for (let t = 0; t < 4000; t++) V.step(D, 1, 0); assert.ok(V.summary(D).wet < 0.01, 'and in the end it is dry');
});

test('kerbs turn slick in the wet and are normal in the dry', () => {
  const E = V.create(L, W);
  assert.equal(V.gripAt(E, 500, 7.2, { kerb: true }).kerb, 1);
  for (let t = 0; t < 120; t++) V.step(E, 1, 0.8);
  const k = V.gripAt(E, 500, 7.2, { kerb: true }), road = V.gripAt(E, 500, 7.2);
  assert.ok(k.kerb < 0.6 && k.trackK < road.trackK * 0.6, `kerb ${k.trackK.toFixed(2)} vs road ${road.trackK.toFixed(2)}`);
});

test('the track state can be saved and restored, and a different track discards it', () => {
  const E = V.create(L, W); drive(E, 10, 0);
  const R = V.load(V.serialize(E), L, W); assert.ok(Math.abs(V.summary(R).rubber - V.summary(E).rubber) < 0.01);
  assert.equal(V.summary(V.load(V.serialize(E), 5000, W)).rubber, 0); assert.equal(V.summary(V.load('garbage', L, W)).rubber, 0);
});

test('the weather is repeatable from a seed: dry has no rain, wet rains most of the time, mixed has showers that ease in and out', () => {
  assert.deepEqual(V.makeWeather(7, 3000, 'mixed'), V.makeWeather(7, 3000, 'mixed')); assert.notDeepEqual(V.makeWeather(7, 3000, 'mixed'), V.makeWeather(8, 3000, 'mixed'));
  const dry = V.makeWeather(1, 3000, 'dry'); for (let t = 0; t < 3000; t += 50) assert.equal(V.rainAt(dry, t), 0);
  const wet = V.makeWeather(3, 3000, 'wet'); let wetT = 0; for (let t = 0; t < 3000; t += 10) if (V.rainAt(wet, t) > 0.2) wetT++; assert.ok(wetT > 150, `wet ${wetT}/300`);
  const mixed = V.makeWeather(11, 6000, 'mixed'); const rains = mixed.filter((s) => s.rain > 0); assert.ok(rains.length >= 1 && mixed.some((s) => s.rain === 0));
  const s = rains[0]; assert.ok(V.rainAt(mixed, s.from + 1) < V.rainAt(mixed, s.from + 30), 'it eases in');
});

test('the radar tells the engineer about rain minutes ahead, with an error that grows with the horizon', () => {
  const tl = [{ from: 0, to: 300, rain: 0 }, { from: 300, to: 900, rain: 0.8 }, { from: 900, to: 2000, rain: 0 }];
  const nr = V.nextRain(tl, 0); assert.ok(nr >= 300 && nr <= 330, `rain forecast from ${nr}`); assert.equal(V.nextRain(tl, 1000), null);
  const near = V.radar(tl, 280, 60, 5), far = V.radar(tl, 0, 280, 5);
  assert.ok(near.raining && near.rain > 0.5, `rain in a minute: ${near.rain.toFixed(2)}`);
  assert.equal(V.radar(tl, 0, 60, 5).raining, false);
  for (let seed = 1; seed < 30; seed++) assert.ok(Math.abs(V.radar(tl, 400, 10, seed).rain - 0.8) <= V.EVO.radarError * 0.1 + 1e-9, 'a short-range radar is accurate');
  assert.deepEqual(V.radar(tl, 50, 100, 9), V.radar(tl, 50, 100, 9));
});
