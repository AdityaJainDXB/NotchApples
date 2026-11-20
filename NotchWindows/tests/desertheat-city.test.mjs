// Desert Heat section 3: the 15% enterable rule over the real map data, signals, density, fuel, tolls and fines.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
const require = createRequire(import.meta.url);
const C = require('../src/js/games/desertheat/city.js');
const here = path.dirname(fileURLToPath(import.meta.url));
const TILES = path.join(here, '../src/js/games/desertheat/data/tiles');

function loadTile(file) {
  let got = null;
  vm.runInNewContext(fs.readFileSync(file, 'utf8'), { window: { DesertHeatData: { put: (n, d) => { got = d; } } } });
  return got;
}

test('at least 15% of all shops are enterable, and every district reaches 10%', () => {
  const byDistrict = {};
  let all = 0, ent = 0;
  for (const f of fs.readdirSync(TILES)) {
    const key = f.replace(/\.js$/, '');
    for (const s of C.shopsForTile(loadTile(path.join(TILES, f)).b, key)) {
      all++; if (s.enterable) ent++;
      const d = byDistrict[s.district] || (byDistrict[s.district] = [0, 0]); d[0]++; if (s.enterable) d[1]++;
    }
  }
  assert.ok(all > 3000, `only ${all} shops`);
  assert.ok(ent / all >= 0.15, `${(ent / all * 100).toFixed(1)}% enterable`);
  for (const [d, [n, e]] of Object.entries(byDistrict)) if (n >= 10) assert.ok(e / n >= 0.10, `${d}: ${e}/${n}`);
});

test('every enterable shop type has something to buy', () => {
  for (const t of Object.keys(C.SHOP_TYPES)) assert.ok(C.MENUS[t] && C.MENUS[t].length, t);
});

test('shops are stable: the same tile gives the same shops', () => {
  const b = [[8, 0, 0, 20, 0, 20, 12, 0, 12]];
  assert.deepEqual(C.shopsForTile(b, 'a'), C.shopsForTile(b, 'a'));
});

test('the gold souk sells gold, Business Bay does not', () => {
  assert.ok(C.MIX.deira.gold > 0); assert.equal(C.MIX.businessbay.gold, undefined);
});

test('a signal gives each phase its green in turn and never both', () => {
  for (let t = 0; t < C.CYCLE * 2; t += 0.5) {
    const a = C.signal(0, t), b = C.signal(1, t);
    assert.ok(!(a === 'green' && b === 'green'), `both green at ${t}`);
  }
  assert.equal(C.signal(0, 1), 'green'); assert.equal(C.signal(1, 1), 'red');
  assert.equal(C.signal(1, C.CYCLE / 2 + 1), 'green');
  assert.equal(C.phaseOf(0, 0), 0); assert.equal(C.phaseOf(Math.PI, 0), 0); assert.equal(C.phaseOf(Math.PI / 2, 0), 1);
});

test('rush hour is busier than 4 am, and the midday heat empties the streets', () => {
  assert.ok(C.trafficDensity(8) > C.trafficDensity(4) * 2);
  assert.ok(C.trafficDensity(18.5) > C.trafficDensity(13));
  assert.ok(C.crowdDensity(13, 'deira') < C.crowdDensity(20, 'deira'));
});

test('fuel burns with distance and a fill costs the missing litres', () => {
  const l = C.burn(64, 10000, 0.5, 600);
  assert.ok(l < 64 && l > 60, `${l}`);
  assert.equal(C.fillCost(C.FUEL.tank), 0);
  assert.ok(C.fillCost(14) > 130);
});

test('Salik: 6 AED at weekday peaks, 4 otherwise, free late at night', () => {
  assert.equal(C.salikFee(8), 6); assert.equal(C.salikFee(12), 4); assert.equal(C.salikFee(3), 0); assert.equal(C.salikFee(8, false), 4);
});

test('speed fines follow the UAE bands', () => {
  assert.equal(C.speedFine(115, 100), 0); assert.equal(C.speedFine(125, 100), 300); assert.equal(C.speedFine(145, 100), 700);
  assert.equal(C.speedFine(170, 100), 2000); assert.equal(C.speedFine(200, 100), 3000);
});

test('districts: the Marina and Deira are named from their coordinates', () => {
  const m = C.xz(25.08, 55.14), d = C.xz(25.27, 55.31);
  assert.equal(C.districtAt(m.x, m.z).id, 'marina'); assert.equal(C.districtAt(d.x, d.z).id, 'deira');
});
