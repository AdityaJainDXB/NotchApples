// Flight Radar's rules, with the same vectors as the Mac app's RadarLogicTests. Run: node --test NotchWindows/tests
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadModule } from './load.mjs';

const R = await loadModule('services/radarlogic.js');
const near = (a, b, e) => assert.ok(Math.abs(a - b) <= e, `${a} is not within ${e} of ${b}`);

test('distance and bearing', () => {
  near(R.distanceNM(25.2048, 55.2708, 24.4539, 54.3773), 66.4, 1.5);
  near(R.bearing(25.2048, 55.2708, 24.4539, 54.3773), 227.2, 2);
  near(R.bearing(0, 0, 1, 0), 0, 0.01);
  near(R.bearing(0, 0, 0, 1), 90, 0.01);
  near(R.distanceNM(10, 10, 10, 10), 0, 0.0001);
});

test('the feed is read nearest first and aircraft without a position are skipped', () => {
  const json = { ac: [
    { hex: '4ca123', flight: 'EZY123  ', t: 'A320', r: 'G-EZAB', alt_baro: 35000, gs: 450.4, track: 87.2, baro_rate: -64, lat: 25.30, lon: 55.40 },
    { hex: 'aabbcc', flight: '', r: 'N12345', t: 'C172', alt_baro: 'ground', gs: 0, lat: 25.21, lon: 55.28 },
    { hex: 'deadbe', flight: 'NOPOS' }] };
  const l = R.parse(json, 25.2048, 55.2708);
  assert.equal(l.length, 2);
  assert.equal(l[0].id, 'aabbcc'); assert.equal(l[0].onGround, true); assert.equal(l[0].altitudeFt, null); assert.equal(l[0].callsign, 'N12345');
  assert.equal(l[1].callsign, 'EZY123'); assert.equal(l[1].altitudeFt, 35000); assert.equal(l[1].speedKt, 450); assert.equal(l[1].climbFpm, -64);
  assert.equal(R.parse(null, 0, 0).length, 0); assert.equal(R.parse({}, 0, 0).length, 0);
});

test('radar position puts north up', () => {
  const n = R.position(50, 0, 100), e = R.position(100, 90, 100);
  near(n.x, 0, 1e-9); near(n.y, -0.5, 1e-9); near(e.x, 1, 1e-9); near(e.y, 0, 1e-9);
  near(R.position(500, 180, 100).y, 1.05, 1e-9);
});

test('height, type and compass words', () => {
  assert.equal(R.altitudeLabel(35000, false), 'FL350'); assert.equal(R.altitudeLabel(18000, false), 'FL180');
  assert.equal(R.altitudeLabel(4500, false), '4,500 ft'); assert.equal(R.altitudeLabel(null, true), 'ground');
  assert.equal(R.band(null, true), 'ground'); assert.equal(R.band(3000, false), 'low'); assert.equal(R.band(12000, false), 'mid'); assert.equal(R.band(35000, false), 'high');
  assert.equal(R.typeName('a388'), 'Airbus A380-800'); assert.equal(R.typeName('ZZZZ'), 'ZZZZ'); assert.equal(R.typeName(''), 'Unknown type');
  assert.equal(R.compass(0), 'N'); assert.equal(R.compass(95), 'E'); assert.equal(R.compass(227), 'SW'); assert.equal(R.compass(359), 'N');
});

test('the request is rounded to about a kilometre and capped', () => {
  assert.equal(R.url(25.204812, 55.270839, 400), 'https://api.adsb.lol/v2/point/25.20/55.27/250');
  assert.equal(R.url(-33.8688, 151.2093, 50), 'https://api.adsb.lol/v2/point/-33.87/151.21/50');
});
