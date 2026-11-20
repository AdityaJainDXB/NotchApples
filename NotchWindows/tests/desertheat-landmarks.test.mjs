// Desert Heat section 7: landmarks inside the map, the Metro line along Sheikh Zayed Road, the malls.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
const require = createRequire(import.meta.url);
const LM = require('../src/js/games/desertheat/landmarks.js');
const Lg = require('../src/js/games/desertheat/logic.js');
const here = path.dirname(fileURLToPath(import.meta.url));
let roads = null;
vm.runInNewContext(fs.readFileSync(path.join(here, '../src/js/games/desertheat/data/roads.js'), 'utf8'), { window: { DesertHeatData: { put: (n, d) => { roads = d.roads; } } } });

test('landmarks and malls sit inside the map, and malls have made-up names', () => {
  const box = { w: LM.xz(25.17, 55.10).x, e: LM.xz(25.17, 55.38).x, n: LM.xz(25.30, 55.24).z, s: LM.xz(25.04, 55.24).z };
  for (const p of [...LM.LANDMARKS, ...LM.MALLS]) assert.ok(p.x > box.w && p.x < box.e && p.z > box.n && p.z < box.s, p.name);
  for (const m of LM.MALLS) assert.ok(!/Dubai Mall|Mall of the Emirates/.test(m.name));
});

test('the Metro runs along Sheikh Zayed Road for most of its length and passes near the stations', () => {
  const line = LM.metroLine(roads);
  const len = LM.pathLength(line);
  assert.ok(len > 15000, `line is ${Math.round(len)} m`);
  let nearCount = 0;
  for (const s of LM.METRO_STATIONS) {
    let d = Infinity;
    for (let i = 2; i < line.length; i += 2) d = Math.min(d, Lg.nearestOnSegment(s.x, s.z, line[i - 2], line[i - 1], line[i], line[i + 1]).d);
    if (d < 150) nearCount++;
  }
  assert.ok(nearCount >= LM.METRO_STATIONS.length - 3, `${nearCount} of ${LM.METRO_STATIONS.length} stations on the line`);
});

test('the Burj Khalifa is the tallest landmark', () => {
  const top = LM.LANDMARKS.reduce((a, b) => (b.h > a.h ? b : a));
  assert.equal(top.id, 'burj-khalifa');
});
