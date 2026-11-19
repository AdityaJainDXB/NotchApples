// Desert Heat section 4: weapons, damage and the wanted level.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const K = require('../src/js/games/desertheat/combat.js');

test('a pistol fires its magazine, reloads from the reserve, then runs dry', () => {
  const a = new K.Arsenal(['fists']); a.give('pistol', 1); a.select('pistol'); a.cool = 0;
  let shots = 0;
  for (let t = 0; t < 10; t += 0.01) { a.step(0.01); if (a.fire()) shots++; }
  assert.equal(shots, 15, 'one magazine, no spare');
  a.give('pistol', 1);
  for (let t = 0; t < 10; t += 0.01) { a.step(0.01); if (a.fire()) shots++; }
  assert.equal(shots, 30);
});

test('rate of fire is respected and moving widens the spread', () => {
  const a = new K.Arsenal(); a.give('smg', 3); a.select('smg'); a.cool = 0;
  let n = 0; for (let t = 0; t < 1; t += 0.001) { a.step(0.001); if (a.fire()) n++; }
  assert.ok(n >= 11 && n <= 13, `${n} shots in a second`);
  const b = new K.Arsenal(); b.give('rifle'); b.select('rifle'); b.cool = 0;
  const still = b.fire(0).spread; b.cool = 0; const run = b.fire(1).spread;
  assert.ok(run > still * 2);
  b.cool = 0; assert.ok(b.fire(0, true).spread < still, 'Focus steadies the aim');
});

test('the shotgun fires pellets, a grenade is used up', () => {
  const a = new K.Arsenal(); a.give('shotgun'); a.select('shotgun'); a.cool = 0;
  assert.equal(a.fire().pellets, 8);
  a.give('grenade', 1); a.select('grenade'); a.cool = 0;
  assert.equal(a.fire().kind, 'throw');
  assert.equal(a.has('grenade'), false); assert.equal(a.cur, 'fists');
});

test('cycling skips weapons you do not own; saves round-trip', () => {
  const a = new K.Arsenal(); a.give('pistol'); a.give('rifle');
  a.cycle(1); assert.equal(a.cur, 'pistol'); a.cycle(1); assert.equal(a.cur, 'rifle'); a.cycle(1); assert.equal(a.cur, 'fists');
  const b = K.Arsenal.from(JSON.parse(JSON.stringify(a)));
  assert.ok(b.has('rifle') && b.has('fists'));
});

test('armour takes two thirds of the damage and cover cuts it', () => {
  const p = { health: 100, armour: 50 };
  K.damage(p, 30); assert.equal(p.armour, 30); assert.equal(p.health, 90);
  const q = { health: 100, armour: 0 }; K.damage(q, 50, true); assert.equal(q.health, 85);
  assert.equal(K.damage({ health: 10, armour: 0 }, 20), true);
});

test('police aim gets worse with distance, speed and cover', () => {
  assert.ok(K.hitChance(5, 0, false) > K.hitChance(50, 0, false));
  assert.ok(K.hitChance(10, 0, false) > K.hitChance(10, 20, false));
  assert.ok(K.hitChance(10, 0, false) > K.hitChance(10, 0, true));
});

test('crimes raise the stars and never lower them', () => {
  const w = new K.Wanted();
  w.crime('shotsFired', 0, 0); assert.equal(w.level, 2);
  w.crime('ramCop', 0, 0); assert.equal(w.level, 2);
  w.crime('hitPerson', 0, 0); assert.equal(w.level, 3);
  w.crime('killCop', 0, 0); assert.equal(w.level, 4);
  assert.equal(w.helicopter, true); assert.equal(w.units, 7);
});

test('escaping needs time out of sight and outside the search circle; hiding inside is slow', () => {
  const w = new K.Wanted(); w.crime('shotsFired', 0, 0);
  for (let t = 0; t < 30; t += 0.1) w.step(0.1, 50, 0, false);
  assert.equal(w.level, 2, 'still inside the circle after 30 s');
  for (let t = 0; t < 19; t += 0.1) w.step(0.1, 1000, 0, false);
  assert.equal(w.level, 0, 'escaped after leaving the circle');
  const v = new K.Wanted(); v.crime('shotsFired', 0, 0);
  for (let t = 0; t < 17; t += 0.1) { v.step(0.1, 1000, 0, false); }
  v.step(0.1, 1000, 0, true); assert.equal(v.unseen, 0, 'being seen resets the timer');
});

test('busted and wasted cost what the prompt says', () => {
  assert.equal(K.busted(20000), 2000); assert.equal(K.busted(900000), 5000);
  assert.equal(K.wasted(10000), 1000);
});
