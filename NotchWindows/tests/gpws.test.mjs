// The Plane game's GPWS rules and radio-altimeter calls (airliners). Run: node --test NotchWindows/tests
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

globalThis.window = globalThis;
globalThis.document = { getElementById: () => null };
createRequire(import.meta.url)('../src/js/games/plane-sim.js');
const T = globalThis.NotchPlaneGame._test;

const base = { airborne: true, ft: 800, sink: 700, bank: 5, gearDown: true, flapNotch: 3, landingFlaps: 3, terrainSec: null, belowGlide: false, nearRunway: true };
const top = (o) => (T.gpwsWarnings({ ...base, ...o })[0] || {}).text || null;

test('a normal approach is quiet', () => {
  assert.equal(top({}), null);
  assert.equal(top({ ft: 500, sink: 800 }), null);
});
test('sink rate, and a very high rate is a pull-up', () => {
  assert.equal(top({ sink: 2100 }), 'Sink rate');
  assert.equal(top({ sink: 3500 }), 'Pull up');
});
test('the flare below 30 ft is ignored', () => {
  assert.equal(top({ ft: 20, sink: 600 }), null);
  assert.equal(top({ ft: 25, sink: 1500 }), null);
});
test('rising terrain ahead: terrain, then pull up when close', () => {
  assert.equal(top({ terrainSec: 12 }), 'Terrain, terrain');
  assert.equal(top({ terrainSec: 4 }), 'Pull up');
});
test('too low: gear near the runway, terrain elsewhere, flaps', () => {
  assert.equal(top({ gearDown: false, ft: 300, nearRunway: true }), 'Too low, gear');
  assert.equal(top({ gearDown: false, ft: 300, nearRunway: false }), 'Too low, terrain');
  assert.equal(top({ gearDown: false, ft: 900 }), null);
  assert.equal(top({ ft: 150, flapNotch: 1 }), 'Too low, flaps');
  assert.equal(top({ ft: 150, flapNotch: 3 }), null);
});
test('glideslope and bank angle only when low', () => {
  assert.equal(top({ belowGlide: true }), 'Glideslope');
  assert.equal(top({ belowGlide: true, ft: 1500 }), null);
  assert.equal(top({ bank: 40, ft: 500 }), 'Bank angle');
  assert.equal(top({ bank: 40, ft: 1500 }), null);
});
test('warnings outrank cautions, and the ground is silent', () => {
  assert.equal(T.gpwsWarnings({ ...base, sink: 3500, bank: 40 })[0].level, 2);
  assert.equal(T.gpwsWarnings({ ...base, airborne: false, sink: 4000 }).length, 0);
});
test('radio altimeter calls on the way down', () => {
  assert.equal(T.raCallout(1100, 990, true), 'One thousand');
  assert.equal(T.raCallout(520, 480, true), 'Five hundred');
  assert.equal(T.raCallout(310, 290, true), 'Approaching minimums');
  assert.equal(T.raCallout(210, 190, true), 'Minimums');
  assert.equal(T.raCallout(60, 45, true), 'Fifty');
  assert.equal(T.raCallout(15, 8, true), 'Ten');
  assert.equal(T.raCallout(900, 800, true), null);
  assert.equal(T.raCallout(500, 600, false), null);
});
