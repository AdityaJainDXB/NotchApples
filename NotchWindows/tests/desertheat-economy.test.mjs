// Desert Heat section 5: the economy and GPS routes.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
const require = createRequire(import.meta.url);
const E = require('../src/js/games/desertheat/economy.js');
const N = require('../src/js/games/desertheat/nav.js');
const Lg = require('../src/js/games/desertheat/logic.js');
const here = path.dirname(fileURLToPath(import.meta.url));

test('faster cars cost more, and a tuned engine reaches a higher top speed', () => {
  assert.ok(E.CARS.super.price > E.CARS.coupe.price && E.CARS.coupe.price > E.CARS.saloon.price);
  const base = new Lg.Car().spec;
  const stock = E.specFor(base, 'saloon'), tuned = E.specFor(base, 'saloon', { engine: 3 });
  assert.ok(tuned.topSpeed > stock.topSpeed); assert.ok(tuned.torque[2][1] > stock.torque[2][1]);
  const car = new Lg.Car(); car.spec = E.specFor(base, 'super');
  let t = 0; while (car.speed * 3.6 < 100 && t < 30) { car.step(1 / 120, { throttle: 1 }); t += 1 / 120; }
  assert.ok(t < 6, `the supercar reached 100 in ${t.toFixed(1)} s`);
});

test('tuning and repair prices grow with the car', () => {
  assert.ok(E.tuneCost('engine', 2, 1450000) > E.tuneCost('engine', 2, 62000));
  assert.ok(E.repairCost(100, 1450000) > E.repairCost(100, 62000));
  assert.equal(E.repairCost(0, 62000), 0);
});

test('a smooth ride gets 5 stars and a tip; a rough one does not', () => {
  const good = E.rideFare(8, 12, 0), bad = E.rideFare(8, 12, 9);
  assert.equal(good.rating, 5); assert.ok(good.tip > 0);
  assert.equal(bad.rating, 1); assert.equal(bad.tip, 0);
  assert.ok(good.total > bad.total);
});

test('businesses earn per day, capped at a week; transfers never go negative', () => {
  assert.equal(E.businessIncome(1000, 3.7), 3000); assert.equal(E.businessIncome(1000, 30), 7000);
  const a = { money: 500 }, b = { money: 0 };
  assert.equal(E.transfer(a, b, 900), 500); assert.equal(a.money, 0); assert.equal(b.money, 500);
});

test('a full playthrough can afford one of everything but not all of everything', () => {
  // Rough mission and job income for the whole story (see the prompt's part 18).
  const income = 30 * 45000 + 4 * 3000000;   // missions plus four heists
  const oneOfEach = Object.values(E.CARS).filter((c) => !c.hidden).reduce((a, c) => Math.max(a, c.price), 0) + E.PROPERTY.reduce((a, p) => Math.max(a, p.price), 0) + E.BUSINESSES.reduce((a, b) => Math.max(a, b.price), 0);
  const everything = Object.values(E.CARS).reduce((a, c) => a + c.price, 0) + E.PROPERTY.reduce((a, p) => a + p.price, 0) + E.BUSINESSES.reduce((a, b) => a + b.price, 0);
  assert.ok(income > oneOfEach, 'can afford the top of each'); assert.ok(income < everything, 'cannot buy everything');
});

test('the news reacts to what happened', () => {
  assert.ok(E.headlines({ policeWrecked: 3 })[0].includes('3 police cars'));
  assert.ok(E.headlines({}).length >= 3);
});

test('GPS: a route on a small grid follows the roads and respects one-way streets', () => {
  const roads = [{ p: [0, 0, 100, 0], k: 3 }, { p: [100, 0, 100, 100], k: 3, o: 1 }, { p: [0, 0, 0, 100], k: 3 }, { p: [0, 100, 100, 100], k: 3 }];
  const g = N.buildGraph(roads);
  const r = N.route(g, roads, 0, 0, 100, 100);
  assert.ok(r && Math.abs(r.length - 200) < 1e-6);
  const back = N.route(g, roads, 100, 100, 100, 0);    // cannot go up the one-way road
  assert.ok(Math.abs(back.length - 300) < 1e-6, `went ${back.length}`);
});

test('GPS: Deira to the Marina on the real map', () => {
  let roads = null;
  vm.runInNewContext(fs.readFileSync(path.join(here, '../src/js/games/desertheat/data/roads.js'), 'utf8'), { window: { DesertHeatData: { put: (n, d) => { roads = d.roads; } } } });
  const g = N.buildGraph(roads);
  const o = { lat: 25.17, lon: 55.24 }, m = 111320 * Math.cos(o.lat * Math.PI / 180), xz = (la, lo) => [(lo - o.lon) * m, -(la - o.lat) * 110574];
  const [ax, az] = xz(25.2700, 55.3080), [bx, bz] = xz(25.0805, 55.1405);
  const t0 = Date.now(), r = N.route(g, roads, ax, az, bx, bz), ms = Date.now() - t0;
  assert.ok(r, 'found a route');
  const crow = Math.hypot(bx - ax, bz - az);
  assert.ok(r.length > crow && r.length < crow * 1.8, `route ${Math.round(r.length)} m, straight ${Math.round(crow)} m`);
  assert.ok(ms < 1500, `took ${ms} ms`);
});
