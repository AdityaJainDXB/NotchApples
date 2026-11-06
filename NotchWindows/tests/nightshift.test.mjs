// Night Shift's rules: the clock, power, doors, the toys' moves, Grin's sprint and the blackout. Run: node --test NotchWindows/tests
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const N = createRequire(import.meta.url)('../src/js/games/nightshift-logic.js');
const run = (s, secs, rng = () => 0.99, dt = 0.1) => { const ev = []; for (let t = 0; t < secs && !s.over; t += dt) { N.step(s, dt, rng); ev.push(...s.events); } return ev; };

test('night 1 lasts six hours of one minute each and ends at 6 AM', () => {
  const s = N.newNight(1);
  const ev = run(s, 400);                       // rolls of 0.99 never let a toy move
  assert.deepEqual(s.over, { win: true });
  assert.ok(ev.some((e) => e.type === 'six'));
  assert.equal(ev.filter((e) => e.type === 'hour').length, 5);
  assert.equal(N.clock(0), '12 AM'); assert.equal(N.clock(5), '5 AM');
  assert.ok(s.power > 55 && s.power < 70, 'one bar all night uses about 37%: ' + s.power.toFixed(1));
});

test('doors, lights and the cameras use power; both doors shut all night runs it out', () => {
  const s = N.newNight(1);
  assert.equal(N.usage(s), 1);
  N.toggleDoor(s, 'left'); N.toggleDoor(s, 'right'); N.setCams(s, true);
  assert.equal(N.usage(s), 4);
  N.toggleLight(s, 'left');
  assert.equal(s.lights.left, false, 'the cameras switch the lights off');
  N.setCams(s, false); N.toggleLight(s, 'left'); N.toggleLight(s, 'right');
  assert.deepEqual(s.lights, { left: false, right: true }, 'one light at a time');
  N.toggleLight(s, 'right');
  const ev = run(s, 400);
  assert.ok(ev.some((e) => e.type === 'blackout'), 'two doors shut all night run the power out');
  assert.equal(s.doors.left, false); assert.equal(s.doors.right, false);
  assert.equal(N.toggleDoor(s, 'left'), false, 'no doors without power');
});

test('a toy at a shut door goes back; at an open door it comes in, jams that side and jumps when the cameras go down', () => {
  const s = N.newNight(1);
  s.bots.clank.ai = 20; s.bots.clank.room = 'westCorner';
  s.bots.clank.timer = 0.05;
  N.step(s, 0.1, () => 0);                      // rng 0: always moves, takes the first way (leftDoor)
  assert.equal(s.bots.clank.room, 'leftDoor');
  assert.deepEqual(N.at(s, 'leftDoor'), ['clank']);
  N.toggleDoor(s, 'left');
  s.bots.clank.timer = 0.05; N.step(s, 0.1, () => 0);
  assert.equal(s.bots.clank.room, 'dining', 'the shut door sends it back');

  s.bots.clank.room = 'leftDoor'; N.toggleDoor(s, 'left');   // door open again
  N.setCams(s, true);
  s.bots.clank.timer = 0.05; N.step(s, 0.1, () => 0);
  assert.equal(s.bots.clank.inOffice, true);
  assert.equal(N.toggleDoor(s, 'left'), false, 'the left door is jammed');
  run(s, 3, () => 0.99);
  assert.equal(s.over, null, 'nothing happens while the cameras are up');
  N.setCams(s, false);
  run(s, 2, () => 0.99);
  assert.deepEqual(s.over, { win: false, by: 'clank' });
});

test('with the cameras up for too long the toy in the office pulls them down', () => {
  const s = N.newNight(1);
  s.bots.petunia.room = 'office'; s.bots.petunia.inOffice = true;
  N.setCams(s, true);
  const ev = run(s, 25, () => 0.99);
  assert.ok(ev.some((e) => e.type === 'cams' && e.forced));
  assert.deepEqual(s.over, { win: false, by: 'petunia' });
});

test('Grin only creeps out while the cameras are down, then sprints: a shut door makes it bang (power), an open one ends the night', () => {
  const s = N.newNight(1);
  s.bots.grin.ai = 20;
  N.setCams(s, true);
  run(s, 20, () => 0);
  assert.equal(s.bots.grin.stage, 0, 'watching the cameras keeps it in its box');
  N.setCams(s, false);
  for (let t = 0; t < 30 && !s.bots.grin.running; t += 0.1) N.step(s, 0.1, () => 0);
  assert.equal(s.bots.grin.running, true, 'out of its box after three chances');
  N.toggleDoor(s, 'left');
  const before = s.power;
  const ev = run(s, 3, () => 0.99);
  assert.ok(ev.some((e) => e.type === 'bang' && e.cost === 1));
  assert.ok(s.power < before - 0.9);
  assert.equal(s.bots.grin.running, false);
  assert.equal(s.over, null);

  const t = N.newNight(1); t.bots.grin.running = true;
  run(t, 3, () => 0.99);
  assert.deepEqual(t.over, { win: false, by: 'grin' });
});

test('the blackout: the music plays, then the dark, then the Conductor, unless 6 AM comes first', () => {
  const s = N.newNight(1); s.power = 0.01;
  const ev = run(s, 60, () => 0.1);
  assert.ok(ev.some((e) => e.type === 'blackout'));
  assert.ok(ev.some((e) => e.type === 'music'));
  assert.deepEqual(s.over, { win: false, by: 'conductor' });

  const w = N.newNight(1); w.t = N.HOUR * 6 - 2; w.hour = 5; w.power = 0.01;
  run(w, 5, () => 0.99);
  assert.deepEqual(w.over, { win: true }, '6 AM saves you in the dark');
});

test('night 2 is busier than night 1 from the start, and Grin is awake', () => {
  const a = N.newNight(1), b = N.newNight(2);
  for (const id of ['clank', 'petunia', 'grin']) assert.ok(b.bots[id].ai > a.bots[id].ai, id);
  assert.equal(b.bots.conductor.ai, 0, 'the Conductor still only comes in a blackout');
  assert.equal(b.night, 2);
  const s = N.newNight(2); const ev = run(s, 400, () => 0.99);
  assert.deepEqual(s.over, { win: true }, 'with no moves it still ends at 6 AM'); assert.ok(ev.some((e) => e.type === 'six'));
});

test('every room on a path exists, and every path leads to a doorway', () => {
  for (const id of Object.keys(N.PATHS)) for (const [from, to] of Object.entries(N.PATHS[id])) {
    assert.ok(N.ROOMS[from], from);
    for (const r of to) assert.ok(N.ROOMS[r] || /Door$/.test(r), r);
  }
  assert.equal(N.LAST_NIGHT, 2);
  assert.equal(N.newNight(1).bots.grin.room, 'prize');
});
