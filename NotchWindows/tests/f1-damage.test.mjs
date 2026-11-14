// F1 damage: front-wing endplates, floor edge, sidepod blockage and engine heat, suspension. Run: node --test NotchWindows/tests
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const D = require('../src/js/games/f1/damage.js');

test('a scrape does nothing; a nose hit breaks the front wing endplate away, with understeer, drag and a pull to one side', () => {
  const s = D.create();
  assert.deepEqual(D.impact(s, { speed: 5, zone: 'front' }), []);
  assert.equal(D.effects(s).aero.frontWing, 0);
  const evs = D.impact(s, { speed: 22, zone: 'front', lateral: 0.8 });       // a hit on the right of the nose
  assert.ok(evs.some((e) => e.type === 'endplate' && e.side === 'R'), 'the right endplate came off');
  const fx = D.effects(s);
  assert.ok(fx.aero.frontWing > 0.5, `front wing damage for the aero: ${fx.aero.frontWing.toFixed(2)}`);
  assert.ok(fx.pull > 0 && Math.abs(fx.pull) <= 0.4, `the car pulls towards the damaged (right) side: ${fx.pull}`);
  assert.equal(fx.needsPit, true); assert.match(fx.meatballWhy, /endplate/);
  const bigger = D.create(); D.impact(bigger, { speed: 40, zone: 'front' });
  assert.ok(D.effects(bigger).aero.frontWing > fx.aero.frontWing - 1e-9 && bigger.endplateL === false && bigger.endplateR === false, 'a harder hit takes both');
});

test('the floor edge: hard kerb strikes at speed wear it, and floor damage is a critical loss of downforce that needs a stop', () => {
  const s = D.create();
  assert.equal(D.kerb(s, 20), 0, 'a slow kerb does nothing');
  for (let i = 0; i < 20; i++) D.kerb(s, 80, 1);
  assert.ok(s.floor > 0.25 && s.floor < 0.6, `floor after 20 kerbs: ${s.floor.toFixed(2)}`);
  for (let i = 0; i < 30; i++) D.kerb(s, 80, 1);
  assert.ok(D.effects(s).needsPit && /floor/.test(D.effects(s).meatballWhy), 'a badly damaged floor is loose bodywork');
  assert.equal(D.effects(s).aero.floor, s.floor);
  const w = D.create(); D.impact(w, { speed: 45, zone: 'left', wall: true });
  assert.ok(w.floor > 0.3, 'a wall hit hurts the floor');
});

test('debris in the sidepod runs the engine hotter, then takes power, then kills it', () => {
  const run = (blockage, secs = 240) => { const s = D.create(); if (blockage) D.debris(s, blockage / D.DMG.debrisBlock); const hist = []; for (let t = 0; t < secs; t += 0.1) { D.step(s, { v: 60, iceFraction: 1 }, 0.1); if (blockage) s.sidepod = blockage; hist.push(s.engineC); } return { s, fx: D.effects(s) }; };
  const clean = run(0), some = run(0.5), lots = run(0.9);
  assert.ok(Math.abs(clean.s.engineC - D.DMG.nominalC) < 6, `a clean car runs at ${clean.s.engineC.toFixed(0)} °C`);
  assert.ok(some.s.engineC > D.DMG.derateFrom && some.fx.derate < 1 && !some.s.dnf, `half blocked: ${some.s.engineC.toFixed(0)} °C, power ${some.fx.derate.toFixed(2)}`);
  assert.ok(lots.s.dnf === 'engine' && lots.fx.derate === 0 && lots.fx.dnf === 'engine', 'a nearly blocked sidepod cooks the engine');
  assert.ok(some.fx.needsPit, 'debris in the sidepod needs a stop to clear');
  // debris blows clear at speed, slowly
  const s = D.create(); D.debris(s, 3); const b0 = s.sidepod;
  for (let t = 0; t < 30; t += 0.1) D.step(s, { v: 80, iceFraction: 0.5 }, 0.1);
  assert.ok(s.sidepod < b0, 'it blows clear');
  const slow = D.create(); D.debris(slow, 3); for (let t = 0; t < 30; t += 0.1) D.step(slow, { v: 5, iceFraction: 0.5 }, 0.1);
  assert.ok(slow.sidepod > s.sidepod, 'but slower when going slowly');
});

test('a hard wheel hit breaks a wishbone, which is terminal; smaller hits only damage it', () => {
  const s = D.create();
  D.impact(s, { speed: 20, zone: 'front', wheel: 1 });
  assert.ok(s.susp[1] > 0 && s.susp[1] < 1 && !s.dnf);
  const t = D.create(); const evs = D.impact(t, { speed: 60, zone: 'right', wheel: 3, wall: true });
  assert.equal(t.dnf, 'suspension'); assert.ok(evs.some((e) => e.type === 'dnf'));
  assert.equal(D.effects(t).dnf, 'suspension'); assert.equal(D.effects(t).needsPit, false, 'a car that has failed is out, not called in');
  const again = D.create(); for (let i = 0; i < 4; i++) D.impact(again, { speed: 26, zone: 'front', wheel: 0 });
  assert.ok(again.dnf === 'suspension' || again.susp[0] > 0.7, 'repeated hits add up');
});

test('repairs: a stop fixes the wing, floor and sidepod but not a failed suspension, and takes time in proportion', () => {
  const s = D.create(); D.impact(s, { speed: 30, zone: 'front' }); D.debris(s, 2); s.floor = 0.5;
  const t = D.repairTime(s);
  assert.ok(t > 8, `repair time ${t.toFixed(1)} s`);
  assert.equal(D.repair(s), true);
  const fx = D.effects(s);
  assert.equal(fx.aero.frontWing, 0); assert.equal(s.floor, 0); assert.equal(s.sidepod, 0); assert.equal(fx.needsPit, false); assert.equal(D.repairTime(s), 0);
  const dead = D.create(); D.impact(dead, { speed: 70, zone: 'front', wheel: 0, wall: true });
  assert.equal(D.repair(dead), false, 'a broken wishbone cannot be fixed');
});

test('tougher cars take less damage, and events can be drained once', () => {
  const a = D.create(), b = D.create({ tough: 2 });
  D.impact(a, { speed: 22, zone: 'front' }); D.impact(b, { speed: 22, zone: 'front' });
  assert.ok(b.wingL < a.wingL);
  assert.ok(D.drainEvents(a).length >= 0 && D.drainEvents(a).length === 0);
});
