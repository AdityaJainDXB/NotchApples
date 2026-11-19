// Desert Heat section 9: the E11 to Abu Dhabi joins the real map, dunes stay off the roads, laps, boats.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
const require = createRequire(import.meta.url);
const R = require('../src/js/games/desertheat/region.js');
const N = require('../src/js/games/desertheat/nav.js');
const here = path.dirname(fileURLToPath(import.meta.url));
let roads = null;
vm.runInNewContext(fs.readFileSync(path.join(here, '../src/js/games/desertheat/data/roads.js'), 'utf8'), { window: { DesertHeatData: { put: (n, d) => { roads = d.roads; } } } });

test('the generated E11 starts where the real Sheikh Zayed Road ends', () => {
  const end = R.findE11End(roads);
  const gen = R.roads(end);
  const sw = gen.find((r) => r.r === 'E11');
  assert.ok(Math.hypot(sw.p[0] - end.x, sw.p[1] - end.z) < 20, 'the south-west carriageway starts at the data\'s end');
  assert.ok(gen.length > 15);
});

test('GPS can route from the Marina to Abu Dhabi over the joined network', () => {
  const end = R.findE11End(roads), gen = R.roads(end), all = roads.concat(gen);
  // join the generated carriageways to the real road by snapping their ends to the nearest real motorway point
  const g = N.buildGraph(all);
  const Lo = R.layout(end), ad = Lo.abuDhabi;
  const o = { lat: 25.17, lon: 55.24 }, m = 111320 * Math.cos(o.lat * Math.PI / 180);
  const marina = { x: (55.1405 - o.lon) * m, z: -(25.0805 - o.lat) * 110574 };
  const r = N.route(g, all, marina.x, marina.z, ad.x, ad.z);
  assert.ok(r, 'found a route'); assert.ok(r.length > 15000, `route ${Math.round(r.length)} m`);
});

test('dunes are flat on the motorway and the camp, and rise in the desert', () => {
  const end = R.findE11End(roads), Lo = R.layout(end), D = R.makeDunes(end);
  for (let s = 0; s < R.E11_LEN; s += 500) { const p = Lo.at(s, 0); assert.equal(D.height(p.x, p.z), 0); }
  assert.equal(D.height(Lo.camp.x, Lo.camp.z), 0);
  let max = 0; for (let s = 3000; s < 14000; s += 97) for (let d = 1500; d < 8000; d += 131) { const p = Lo.at(s, d); max = Math.max(max, D.height(p.x, p.z)); }
  assert.ok(max > 12, `tallest dune ${max.toFixed(1)} m`);
});

test('a race counts laps only through the checkpoints in order', () => {
  const loop = R.circuit({ x: 0, z: 0 });
  const race = new R.Race(loop, 2, 6);
  // drive the loop twice
  for (let lap = 0; lap < 2; lap++) for (let i = 0; i < loop.length; i += 2) for (let k = 0; k < 4; k++) race.update(0.5, loop[i], loop[i + 1]);
  assert.equal(race.done, true); assert.ok(race.best > 0);
  const cheat = new R.Race(loop, 1, 6); cheat.update(1, loop[0], loop[1]); assert.equal(cheat.lap, 0);
});

test('a jet ski is faster than a boat and needs speed to turn', () => {
  const j = new R.Boat('jetski'), b = new R.Boat('boat');
  for (let t = 0; t < 20; t += 0.05) { j.step(0.05, { throttle: 1 }); b.step(0.05, { throttle: 1 }); }
  assert.ok(j.speed > b.speed && j.speed > 20);
  const still = new R.Boat(); for (let t = 0; t < 2; t += 0.05) still.step(0.05, { steer: 1 });
  assert.ok(Math.abs(still.heading) < 0.05);
});

test('Abu Dhabi has its land, towers on the Corniche and the mosque as a no-weapons zone', () => {
  const end = R.findE11End(roads), Lo = R.layout(end);
  const rings = R.land(end); assert.ok(R.pointInRing(Lo.abuDhabi.x, Lo.abuDhabi.z, rings[0]));
  const b = R.buildings(end); assert.ok(b.length > 100); assert.ok(b.some((x) => x[0] > 150));
  assert.ok(R.LANDMARKS(end).find((l) => l.id === 'grand-mosque').safe > 0);
});

test('the helicopter spins up, climbs, flies forward when tilted and lands', async () => {
  const { createRequire } = await import('node:module');
  const A = createRequire(import.meta.url)('../src/js/games/desertheat/air.js');
  const h = new A.Heli();
  for (let t = 0; t < 6; t += 0.02) h.step(0.02, { up: true });
  assert.ok(h.y > 15, `climbed to ${h.y.toFixed(1)} m`);
  for (let t = 0; t < 8; t += 0.02) h.step(0.02, { forward: 1 });
  assert.ok(h.speed > 25, `flying at ${h.speed.toFixed(1)} m/s`);
  for (let t = 0; t < 20; t += 0.02) h.step(0.02, { down: true, forward: -0.3 });
  for (let t = 0; t < 6; t += 0.02) h.step(0.02, { down: true });
  assert.ok(h.landed, 'landed');
});
