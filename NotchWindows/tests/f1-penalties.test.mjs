// F1 stewards: track limits, pit speeding, unsafe release, serving and the 3-lap window, final times. Run: node --test NotchWindows/tests
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const P = require('../src/js/games/f1/penalties.js');
const race = (extra = {}) => P.create({ session: 'race', lapsTotal: 20, ...extra });

test('track limits in a race: warnings, then the black and white flag, then +5 s, then +10 s, then the count starts again', () => {
  const s = race(); const acts = [];
  for (let i = 0; i < 7; i++) acts.push(P.trackLimit(s, 'A', { lap: 2 }));
  assert.deepEqual(acts.map((r) => r.action), ['warning', 'warning', 'black-white', 'plus5', 'plus10', 'warning', 'warning']);
  assert.deepEqual(acts.map((r) => r.strike), [1, 2, 3, 4, 5, 1, 2], 'the counter resets after the fifth');
  const pens = P.list(s, 'A'); assert.deepEqual(pens.map((p) => p.seconds), [5, 10]); assert.ok(pens.every((p) => p.kind === 'time'));
  assert.equal(P.strikesOf(s, 'A'), 2); assert.equal(P.strikesOf(s, 'B'), 0, 'every driver has his own count');
});

test('track limits in qualifying and practice delete the lap, and the third strike shows the black and white flag; no time is added', () => {
  const s = P.create({ session: 'quali' });
  const r = [1, 2, 3, 4].map(() => P.trackLimit(s, 'A'));
  assert.deepEqual(r.map((x) => x.action), ['lap-deleted', 'lap-deleted', 'black-white', 'lap-deleted']);
  assert.ok(r.every((x) => x.lapDeleted)); assert.equal(P.list(s).length, 0);
  const f = P.create({ session: 'practice' }); assert.equal(P.issue(f, { carId: 'A', kind: 'time', seconds: 5, reason: 'x' }), null, 'a fine, not seconds');
});

test('pit lane speeding: 80 km/h normally, 60 on a street circuit; a little over is 5 s, well over is 10 s', () => {
  assert.equal(P.pitLimitKmh(race()), 80); assert.equal(P.pitLimitKmh(race({ street: true })), 60);
  const s = race();
  assert.equal(P.pitSpeed(s, 'A', 80), null); assert.equal(P.pitSpeed(s, 'A', 70), null);
  assert.equal(P.pitSpeed(s, 'A', 84).seconds, 5); assert.equal(P.pitSpeed(s, 'B', 95).seconds, 10);
  const st = race({ street: true }); assert.equal(P.pitSpeed(st, 'A', 75).seconds, 10, '75 km/h is far over 60');
  assert.equal(P.pitSpeed(st, 'B', 59), null);
});

test('an unsafe release is 5 s, or 10 s if there was a collision', () => {
  const s = race(); assert.equal(P.unsafeRelease(s, 'A', false).seconds, 5); assert.equal(P.unsafeRelease(s, 'B', true).seconds, 10);
});

test('5 s and 10 s penalties are served stationary in the box before the mechanics touch the car', () => {
  const s = race();
  P.issue(s, { carId: 'A', kind: 'time', seconds: 5, reason: 'a', lap: 3 }); P.issue(s, { carId: 'A', kind: 'time', seconds: 10, reason: 'b', lap: 4 });
  assert.equal(P.stationarySecs(s, 'A'), 15);
  assert.equal(P.mechanicsMayWork(s, 'A', 4.9), false); assert.equal(P.mechanicsMayWork(s, 'A', 15), true); assert.equal(P.mechanicsMayWork(s, 'B', 0), true);
  let r = P.pitStop(s, 'A', { standing: 8, lap: 5 });
  assert.equal(r.served.length, 0); assert.equal(r.failed.length, 2, 'standing only 8 s of 15 serves nothing');
  r = P.pitStop(s, 'A', { standing: 15, lap: 6 });
  assert.equal(r.served.length, 2); assert.equal(P.stationarySecs(s, 'A'), 0);
  assert.ok(P.drain(s).some((e) => e.type === 'penalty-served'));
});

test('a penalty that is never served in the pits is added to the race time, and one that was served is not', () => {
  const s = race();
  P.issue(s, { carId: 'A', kind: 'time', seconds: 5, lap: 3 }); P.issue(s, { carId: 'B', kind: 'time', seconds: 10, lap: 3 });
  P.pitStop(s, 'B', { standing: 10, lap: 5 });
  const res = P.finalise(s, [{ id: 'A', time: 1000, laps: 20 }, { id: 'B', time: 1003, laps: 20 }, { id: 'C', time: 1004, laps: 20 }]);
  assert.deepEqual(res.order, ['B', 'C', 'A'], 'A is 5 s slower, B kept his time');
  assert.equal(res.rows.find((r) => r.id === 'A').added, 5); assert.equal(res.rows.find((r) => r.id === 'B').added, 0);
  assert.deepEqual(P.finalise(s, [{ id: 'A', time: 1000, laps: 20 }]).rows[0].added, 0, 'it is not added twice');
});

test('a drive-through must be served by driving through the pit lane without stopping, within 3 laps, or it is a black flag', () => {
  const s = race();
  const p = P.issue(s, { carId: 'A', kind: 'driveThrough', reason: 'causing a collision', lap: 5 });
  assert.equal(p.status, 'pending');
  assert.deepEqual(P.lapDone(s, 'A', 6), []); assert.deepEqual(P.lapDone(s, 'A', 7), []);
  const r = P.pitStop(s, 'A', { passedThrough: true, lap: 7 });
  assert.equal(r.served.length, 1); assert.equal(p.status, 'served'); assert.deepEqual(P.lapDone(s, 'A', 9), []);
  const q = P.issue(s, { carId: 'B', kind: 'driveThrough', reason: 'x', lap: 5 });
  assert.equal(P.lapDone(s, 'B', 8).length, 1, 'three laps later: not served'); assert.equal(q.status, 'ignored');
  assert.ok(P.drain(s).some((e) => e.type === 'black-flag' && e.carId === 'B'));
  const res = P.finalise(s, [{ id: 'B', time: 900, laps: 20 }, { id: 'C', time: 950, laps: 20 }]); assert.deepEqual(res.order, ['C', 'B'], 'the disqualified car is classified last');
});

test('a 10 s stop-go: stand still for 10 s with no work done, within 3 laps; a tyre change in it does not count', () => {
  const s = race();
  const p = P.issue(s, { carId: 'A', kind: 'stopGo', seconds: 10, reason: 'x', lap: 4 });
  let r = P.pitStop(s, 'A', { stoppedSecs: 10, tyresChanged: true, workDone: true, lap: 5 });
  assert.equal(r.served.length, 0); assert.equal(r.failed.length, 1); assert.equal(p.status, 'pending');
  r = P.pitStop(s, 'A', { stoppedSecs: 6, lap: 6 }); assert.equal(r.served.length, 0, 'not long enough');
  r = P.pitStop(s, 'A', { stoppedSecs: 10.2, lap: 6 }); assert.equal(r.served.length, 1); assert.equal(p.status, 'served');
});

test('a drive-through or stop-go given with too few laps left becomes time after the race', () => {
  const s = race({ lapsTotal: 20 });
  const a = P.issue(s, { carId: 'A', kind: 'driveThrough', reason: 'x', lap: 19 }), b = P.issue(s, { carId: 'B', kind: 'stopGo', seconds: 10, reason: 'x', lap: 18 });
  assert.equal(a.kind, 'time'); assert.equal(a.seconds, 20); assert.equal(b.kind, 'time'); assert.equal(b.seconds, 30);
  assert.equal(P.issue(s, { carId: 'C', kind: 'driveThrough', reason: 'x', lap: 10 }).kind, 'driveThrough');
});

test('race control\'s requests (blue flag, VSC delta) become penalties, and disqualification is final', () => {
  const s = race();
  P.issue(s, { carId: 'A', kind: 'time', seconds: 5, reason: 'ignoring blue flags', lap: 6 }); assert.equal(P.stationarySecs(s, 'A'), 5);
  P.disqualify(s, 'B', 'tyre compound rule');
  const res = P.finalise(s, [{ id: 'B', time: 800, laps: 20 }, { id: 'A', time: 810, laps: 20 }]); assert.deepEqual(res.order, ['A', 'B']); assert.equal(res.rows.find((r) => r.id === 'B').dsq, 'tyre compound rule');
});
