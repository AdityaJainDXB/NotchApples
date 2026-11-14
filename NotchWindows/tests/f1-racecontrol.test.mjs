// F1 race control: flags, VSC, Safety Car, red flag, blue, meatball, black and white, black, chequered. Run: node --test NotchWindows/tests
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const R = require('../src/js/games/f1/racecontrol.js');
const L = 4000;
const mk = (extra = {}) => R.create({ trackLength: L, laps: 5, raceSpeed: 70, cars: ['A', 'B', 'C', 'D'], ...extra });
const car = (id, s, lap = 0, speed = 70, extra = {}) => ({ id, s, lap, speed, inPit: false, finished: false, ...extra });
const secLen = L / R.RC.miniSectors;

test('green: overtaking and DRS / active aero are allowed everywhere; a single yellow bans both in that mini-sector only', () => {
  const rc = mk();
  assert.equal(rc.state, 'GREEN'); assert.equal(R.canOvertake(rc, 'A', 100), true); assert.equal(R.wingOpenAllowed(rc, 'A', 100), true);
  R.reportIncident(rc, { sector: 5, kind: 'offtrack', carId: 'B' });
  assert.equal(rc.state, 'GREEN', 'a single yellow is local: the track stays green');
  assert.equal(rc.yellow[5], 1); assert.equal(rc.yellow[4], 0);
  const inY = 5 * secLen + 50, outY = 9 * secLen;
  assert.equal(R.canOvertake(rc, 'A', inY), false); assert.equal(R.wingOpenAllowed(rc, 'A', inY), false);
  assert.equal(R.canOvertake(rc, 'A', outY), true); assert.equal(R.wingOpenAllowed(rc, 'A', outY), true);
  const cap = R.speedCap(rc, 'A', inY); assert.ok(cap && cap.max < 70 && cap.max > 50, `single yellow cap ${cap.max}`);
  assert.equal(R.speedCap(rc, 'A', outY), null);
  R.clearYellow(rc, 5); assert.equal(R.canOvertake(rc, 'A', inY), true);
});

test('a double yellow is stricter: a bigger speed cut, the sector before gets a single yellow, and it never lowers an existing flag', () => {
  const rc = mk();
  R.reportIncident(rc, { sector: 8, kind: 'blocking', carId: 'C' });
  assert.equal(rc.yellow[8], 2); assert.equal(rc.yellow[7], 1);
  const dbl = R.speedCap(rc, 'A', 8 * secLen + 10), sgl = R.speedCap(rc, 'A', 7 * secLen + 10);
  assert.ok(dbl.max < sgl.max && dbl.why === 'double yellow', `double ${dbl.max} single ${sgl.max}`);
  R.setYellow(rc, 8, 1); assert.equal(rc.yellow[8], 2, 'a single does not replace a double');
  const evs = R.drain(rc); assert.ok(evs.some((e) => e.type === 'yellow' && e.level === 2));
});

test('incidents choose their response: a stopped car is the VSC, a barrier crash the Safety Car, a blocked track the red flag, and a stronger state is never lowered', () => {
  let rc = mk(); assert.equal(R.reportIncident(rc, { sector: 3, kind: 'stopped', carId: 'B' }), 'VSC'); assert.equal(rc.state, 'VSC');
  assert.equal(R.reportIncident(rc, { sector: 3, kind: 'offtrack' }), 'YELLOW_SINGLE'); assert.equal(rc.state, 'VSC');
  assert.equal(R.reportIncident(rc, { sector: 3, kind: 'barrier', carId: 'B' }), 'SAFETY_CAR'); assert.equal(rc.state, 'SAFETY_CAR');
  assert.equal(R.reportIncident(rc, { sector: 3, kind: 'stopped', recoverable: true }), 'VSC'); assert.equal(rc.state, 'SAFETY_CAR', 'a VSC call does not replace a Safety Car');
  rc = mk(); R.reportIncident(rc, { sector: 3, kind: 'blocked-track', carId: 'B' }); assert.equal(rc.state, 'RED_FLAG');
  rc = mk(); R.reportIncident(rc, { sector: 2, kind: 'stopped', recoverable: false }); assert.equal(rc.state, 'SAFETY_CAR');
});

test('VSC: everyone is 30 to 40 percent slower, nobody overtakes, and a car that beats the delta time in a mini-sector gets a 5 s penalty', () => {
  const rc = mk(); R.deployVSC(rc, 'debris');
  const pace = R.vscSpeed(rc); assert.ok(pace <= 70 * 0.7 && pace >= 70 * 0.6, `VSC pace ${pace}`);
  assert.equal(R.canOvertake(rc, 'A', 1000), false); assert.equal(R.wingOpenAllowed(rc, 'A', 1000), false);
  assert.equal(R.speedCap(rc, 'A', 1000).max, pace);
  // drive two cars through several mini-sectors: A at the VSC pace, B much faster
  const evs = [];
  let sa = 100, sb = 100; const dt = 0.1;
  for (let t = 0; t < 40; t += dt) {
    sa += pace * 0.98 * dt; sb += 66 * dt;
    evs.push(...R.tick(rc, { cars: [car('A', sa, 0, pace), car('B', sb, 0, 66)] }, dt));
  }
  const pens = evs.filter((e) => e.type === 'penalty'), breaches = evs.filter((e) => e.type === 'vsc-breach');
  assert.equal(pens.length, 1, 'one penalty'); assert.ok(pens[0].carId === 'B' && pens[0].seconds === 5);
  assert.ok(breaches.length >= 3 && breaches.every((e) => e.carId === 'B'), `B breached the delta in ${breaches.length} mini-sectors`);
  assert.ok(!evs.some((e) => e.type === 'vsc-breach' && e.carId === 'A'), 'the car at the delta pace is fine');
  assert.ok(rc.cars.get('A').vscDelta >= -R.RC.vscDeltaTolS && rc.cars.get('B').vscDelta < -R.RC.vscDeltaTolS);
});

test('the VSC ends with "VSC ENDING" for a random 10 to 15 seconds, then every sector goes green at once', () => {
  const secs = [];
  for (const r of [0, 0.5, 0.999]) {
    const rc = mk({ rand: () => r }); R.deployVSC(rc, 'x');
    const s = R.endVSC(rc); secs.push(s); assert.ok(s >= 10 && s <= 15, `shows for ${s.toFixed(2)} s`);
    assert.equal(rc.state, 'VSC'); assert.ok(R.drain(rc).some((e) => e.type === 'vsc-ending' && e.secs === s)); assert.equal(R.endVSC(rc), 0, 'only once');
    for (let t = 0; t < Math.floor(s) - 1; t += 1) R.tick(rc, { cars: [car('A', 100 + t * 30, 0, 10)] }, 1);
    assert.equal(rc.state, 'VSC', 'still VSC during the warning');
    for (let t = 0; t < 3; t += 1) R.tick(rc, { cars: [car('A', 600 + t * 30, 0, 10)] }, 1);
    assert.equal(rc.state, 'GREEN'); assert.equal(R.canOvertake(rc, 'A', 1000), true);
  }
  assert.ok(secs[0] < secs[1] && secs[1] < secs[2], 'the length depends on the random draw');
});

test('VSC delta: the display shows how far ahead of the limit a car is, and a car with a negative delta when the green comes gets a penalty', () => {
  const rc = mk({ rand: () => 0 }); R.deployVSC(rc, 'x'); const pace = R.vscSpeed(rc);
  let a = 100, b = 100; const evs = [];
  for (let t = 0; t < 12; t += 0.1) { a += pace * 0.97 * 0.1; b += pace * 1.5 * 0.1; evs.push(...R.tick(rc, { cars: [car('A', a, 0, pace), car('B', b, 0, pace * 1.5)] }, 0.1)); }
  assert.equal(R.vscDelta(rc, 'A').ok, true); assert.ok(R.vscDelta(rc, 'A').text.startsWith('+'));
  const d = R.vscDelta(rc, 'B'); assert.equal(d.ok, false); assert.ok(d.text.startsWith('−') && d.delta < -0.2, d.text);
  R.drain(rc); R.endVSC(rc, () => 0);                                        // 10 s
  for (let t = 0; t < 10.5; t += 0.1) { a += pace * 0.97 * 0.1; b += pace * 1.5 * 0.1; evs.push(...R.tick(rc, { cars: [car('A', a, 0, pace), car('B', b, 0, pace * 1.5)] }, 0.1)); }
  assert.equal(rc.state, 'GREEN');
  const pens = evs.filter((e) => e.type === 'penalty');
  assert.ok(pens.every((e) => e.carId === 'B'), 'only the fast car'); assert.equal(pens.length, 1);
  assert.deepEqual(R.vscDelta(rc, 'A'), { delta: 0, ok: true, text: '' }, 'no delta once it is green');
});

test('overtaking under the VSC is a 5 s penalty (once), and a car in the pit lane is not counted', () => {
  const rc = mk(); R.deployVSC(rc, 'x'); R.tick(rc, { cars: [car('A', 100), car('B', 90, 0, 40, { inPit: true })] }, 0.1);
  assert.equal(R.vscOvertake(rc, 'A', 'C'), true); assert.equal(R.vscOvertake(rc, 'A', 'D'), false, 'one penalty a VSC period');
  assert.equal(R.vscOvertake(rc, 'B', 'C'), false, 'in the pits');
  const p = R.drain(rc).filter((e) => e.type === 'penalty'); assert.equal(p.length, 1); assert.equal(p[0].seconds, 5); assert.match(p[0].reason, /Virtual Safety Car/);
  assert.equal(R.vscOvertake(mk(), 'A', 'B'), false, 'only under a VSC');
});

const L1 = (rc) => rc.cfg.scLine1S;
test('Safety Car: it waits at the pit exit until the leader crosses Safety Car Line 1, then pulls out directly ahead of him', () => {
  const rc = mk(); R.deploySC(rc, 'crash');
  assert.equal(rc.state, 'SAFETY_CAR'); assert.equal(R.scPhase(rc), 'staging'); assert.ok(R.drain(rc).some((e) => e.type === 'sc-deployed' && e.phase === 'staging'));
  assert.equal(R.canOvertake(rc, 'A', 500), false); assert.equal(R.wingOpenAllowed(rc, 'A', 500), false); assert.equal(R.speedCap(rc, 'A', 500).max, R.scSpeed(rc), 'the field is already slowing');
  const line1 = L1(rc), cars = (ls) => [car('B', ls, 1, 60), car('A', ls - 60, 1, 60), car('C', ls - 120, 1, 60)];
  R.tick(rc, { cars: cars(line1 - 300) }, 0.1); assert.equal(R.scPhase(rc), 'staging');
  R.tick(rc, { cars: cars(line1 - 20) }, 0.1); assert.equal(R.scPhase(rc), 'staging', 'not yet: the leader has not reached the line');
  const evs = R.tick(rc, { cars: cars(line1 + 10) }, 0.1);
  assert.equal(R.scPhase(rc), 'out'); const out = evs.find((e) => e.type === 'sc-out'); assert.ok(out && out.leaderId === 'B', 'the Safety Car is out, ahead of the leader');
  // a track with no staging puts it straight out
  const direct = mk({ scStaging: false }); R.deploySC(direct, 'x'); assert.equal(R.scPhase(direct), 'out');
});

test('Safety Car: a brisk pace (never a crawl), a single-file queue with no overtaking, and the pack bunches up', () => {
  const rc = mk({ raceSpeed: 90 }); R.deploySC(rc, 'x');
  assert.ok(R.scSpeed(rc) >= R.RC.scMinSpeed && R.scSpeed(rc) >= 90 * 0.55, `pace ${R.scSpeed(rc)}`);
  assert.equal(R.scSpeed(mk({ raceSpeed: 50 })), R.RC.scMinSpeed, 'never slower than the speed that keeps tyres and brakes alive');
  const base = R.scSpeed(rc);
  assert.ok(R.scTarget(rc, 'B', 120, base) > base, 'closes up'); assert.ok(R.scTarget(rc, 'B', 5, base) <= base); assert.equal(R.scTarget(rc, 'B', 30, base), base); assert.equal(R.scTarget(rc, 'A', null), base);
  for (const id of ['A', 'B', 'C', 'D']) assert.equal(R.canOvertake(rc, id, 1500), false);
});

test('Safety Car: lapped cars may overtake only once race control says the hazard is clear ("LAPPED CARS MAY NOW OVERTAKE"), and rejoin at the back', () => {
  const rc = mk({ scStaging: false }); R.deploySC(rc, 'x');
  const order = [{ id: 'D', lapsDown: 1, inPit: false }, { id: 'C', lapsDown: 0 }];
  assert.deepEqual(R.waveLapped(rc, order), [], 'the hazard is not clear yet'); assert.equal(R.canOvertake(rc, 'D', 500), false);
  assert.equal(R.hazardCleared(rc), true); assert.equal(R.hazardCleared(rc), false);
  const ids = R.waveLapped(rc, order); assert.deepEqual(ids, ['D']);
  assert.equal(R.drain(rc).find((e) => e.type === 'unlap').text, 'LAPPED CARS MAY NOW OVERTAKE');
  assert.equal(R.canOvertake(rc, 'D', 500), true); assert.equal(R.canOvertake(rc, 'C', 500), false, 'only the lapped cars');
  assert.equal(R.unlapDone(rc, 'D'), true); assert.equal(R.canOvertake(rc, 'D', 500), false, 'rejoined at the back: it may not overtake any more');
  assert.equal(R.unlapDone(rc, 'C'), false);
  const staged = mk(); R.deploySC(staged, 'x'); R.hazardCleared(staged); assert.deepEqual(R.waveLapped(staged, order), [], 'not while the Safety Car is still at the pit exit');
});

test('Safety Car in: called once the hazard is clear; the lights go off in Sector 3, it pits, the leader controls the pace, and the track goes green at Line 1', () => {
  const rc = mk({ scStaging: false }); R.deploySC(rc, 'x');
  assert.equal(R.sendSCIn(rc), false, 'not before the hazard is cleared'); R.hazardCleared(rc);
  assert.equal(R.sendSCIn(rc), true); assert.ok(R.drain(rc).find((e) => e.type === 'sc-in').text === 'SAFETY CAR IN THIS LAP');
  const line1 = L1(rc), s3 = L * R.RC.scSector3From;
  assert.equal(R.scLightsOn(rc, 500), true, 'lights on in Sectors 1 and 2'); assert.equal(R.scLightsOn(rc, s3 + 10), false, 'off in Sector 3');
  const step = (ls, scS, inPit, spd = 50) => R.tick(rc, { cars: [car('B', ls, 1, spd), car('A', ls - 50, 1, spd)], sc: { s: scS, speed: 40, inPit } }, 0.1);
  let evs = step(s3 - 200, s3 - 150, false); assert.ok(!evs.some((e) => e.type === 'sc-lights-off'));
  evs = step(s3 + 100, s3 + 150, false); assert.ok(evs.some((e) => e.type === 'sc-lights-off'), 'lights off in Sector 3');
  evs = step(line1 - 40, line1 - 10, true); assert.ok(evs.some((e) => e.type === 'sc-in-pit'), 'it has pitted');
  assert.equal(rc.state, 'SAFETY_CAR', 'still waiting for the leader to reach the line');
  evs = step(line1 + 5, 0, true); assert.equal(rc.state, 'GREEN'); assert.ok(evs.some((e) => e.type === 'restart' && e.startType === 'safety-car'));
  assert.equal(R.canOvertake(rc, 'B', line1 + 30), true, 'the leader is released at the line'); assert.equal(R.canOvertake(rc, 'A', line1 - 40), false, 'the rest wait until they cross it');
  step(line1 + 60, 0, true); R.tick(rc, { cars: [car('B', line1 + 120, 1, 60), car('A', line1 + 8, 1, 60)] }, 0.1); assert.equal(R.canOvertake(rc, 'A', line1 + 40), true);
});

test('Safety Car restart: the leader must not brake-check the field, and a Safety Car that misses the pit entry is reported', () => {
  const rc = mk({ scStaging: false }); R.deploySC(rc, 'x'); R.hazardCleared(rc); R.sendSCIn(rc);
  const line1 = L1(rc);
  R.tick(rc, { cars: [car('B', line1 - 400, 1, 60), car('A', line1 - 450, 1, 60)], sc: { s: line1 - 350, speed: 40, inPit: false } }, 0.1);
  const evs = R.tick(rc, { cars: [car('B', line1 - 398, 1, 30), car('A', line1 - 450, 1, 60)], sc: { s: line1 - 340, speed: 40, inPit: false } }, 0.1);
  assert.ok(evs.some((e) => e.type === 'erratic-leader' && e.carId === 'B'), 'slowing 30 m/s in 0.1 s is a brake test');
  const pen = evs.find((e) => e.type === 'penalty'); assert.ok(pen && pen.carId === 'B' && pen.seconds === 5);
  // missed pit entry: the car crosses Line 1 out on the track
  const m = mk({ scStaging: false }); R.deploySC(m, 'x'); R.hazardCleared(m); R.sendSCIn(m);
  R.tick(m, { cars: [car('B', line1 - 80, 1, 50)], sc: { s: line1 - 20, speed: 40, inPit: false } }, 0.1);
  const e2 = R.tick(m, { cars: [car('B', line1 - 60, 1, 50)], sc: { s: line1 + 10, speed: 40, inPit: false } }, 0.1);
  assert.ok(e2.some((e) => e.type === 'sc-missed-pit'));
  assert.equal(m.state, 'SAFETY_CAR', 'and the restart waits for it');
});

test('a player driving the Safety Car: hold at the pit exit, lead at the target pace, switch the lights off, box this lap, and be warned or penalised for bad driving', () => {
  const rc = mk(); R.deploySC(rc, 'crash');
  const line1 = L1(rc);
  let o = R.scPlayerStep(rc, { s: 0, speed: 0, atPitExit: true, lightsOn: true, leaderS: line1 - 400 }, 0.1);
  assert.equal(o.stage, 'hold'); assert.match(o.prompt, /HOLD AT THE PIT EXIT/); assert.match(o.prompt, /400 m/);
  o = R.scPlayerStep(rc, { s: 0, speed: 20, atPitExit: true, lightsOn: true, leaderS: line1 - 400 }, 0.1); assert.ok(o.warnings.some((w) => /Wait/.test(w)), 'moving off early');
  R.tick(rc, { cars: [car('B', line1 - 20, 1, 60)] }, 0.1); R.tick(rc, { cars: [car('B', line1 + 10, 1, 60)] }, 0.1); assert.equal(R.scPhase(rc), 'out');
  const v = R.scSpeed(rc);
  o = R.scPlayerStep(rc, { s: 100, speed: v, lightsOn: true }, 0.1);
  assert.equal(o.stage, 'lead'); assert.match(o.prompt, new RegExp(String(Math.round(v * 3.6)))); assert.ok(o.target.lo < v && o.target.hi > v); assert.deepEqual(o.warnings, []);
  let slow = null; for (let t = 0; t < 4; t += 0.1) { const r = R.scPlayerStep(rc, { s: 200, speed: v * 0.6, lightsOn: true }, 0.1); if (r.warnings.some((w) => /TOO SLOW/.test(w))) slow = r; }
  assert.ok(slow, 'too slow for 3 s is a warning'); assert.ok(R.scPlayerStep(rc, { s: 200, speed: v, lightsOn: true }, 0.1).score < 0, 'and costs points');
  let fast = null; for (let t = 0; t < 4; t += 0.1) { const r = R.scPlayerStep(rc, { s: 300, speed: v * 1.4, lightsOn: true }, 0.1); if (r.warnings.some((w) => /TOO FAST/.test(w))) fast = r; } assert.ok(fast);
  assert.ok(R.scPlayerStep(rc, { s: 300, speed: v, decel: 9, lightsOn: true }, 0.1).warnings.some((w) => /braking too hard/.test(w)));
  assert.ok(R.scPlayerStep(rc, { s: 300, speed: v, offTrack: true, lightsOn: true }, 0.1).warnings.some((w) => /off the road/.test(w)));
  // clear, in this lap
  R.hazardCleared(rc); R.sendSCIn(rc);
  o = R.scPlayerStep(rc, { s: 500, speed: v, lightsOn: true }, 0.1); assert.equal(o.stage, 'in'); assert.match(o.prompt, /IN THIS LAP/);
  o = R.scPlayerStep(rc, { s: L * 0.8, speed: v, lightsOn: true }, 0.1); assert.ok(o.warnings.some((w) => /lights off/i.test(w)), 'lights still on in Sector 3');
  o = R.scPlayerStep(rc, { s: L * 0.8, speed: v, lightsOn: false }, 0.1); assert.match(o.prompt, /lights off, now box/);
  R.tick(rc, { cars: [car('B', line1 - 100, 1, 50)], sc: { s: line1 - 50, speed: 40, inPit: true } }, 0.1);
  o = R.scPlayerStep(rc, { s: line1 - 50, speed: 30, inPit: true, lightsOn: false }, 0.1); assert.equal(o.stage, 'box'); assert.ok(o.events.some((e) => e.type === 'sc-done' && e.score === 150));
  const m = mk({ scStaging: false }); R.deploySC(m, 'x'); R.hazardCleared(m); R.sendSCIn(m);
  R.tick(m, { cars: [car('B', line1 - 80, 1, 50)], sc: { s: line1 - 20, speed: 40, inPit: false } }, 0.1); R.tick(m, { cars: [car('B', line1 - 60, 1, 50)], sc: { s: line1 + 10, speed: 40, inPit: false } }, 0.1);
  const mo = R.scPlayerStep(m, { s: line1 + 10, speed: 40, lightsOn: false }, 0.1); assert.ok(mo.warnings.some((w) => /missed the pit entry/.test(w)) && mo.events.some((e) => e.score === -100));
  assert.equal(R.scPlayerStep(mk(), { s: 0, speed: 0 }, 0.1).stage, 'off');
});

test('Medical Car: on lap 1 it follows the pack through Sector 1 and pits at the end of the lap if all is clear', () => {
  const rc = mk(); R.mcLap1(rc);
  assert.equal(rc.mc.phase, 'follow'); assert.ok(R.drain(rc).some((e) => e.type === 'mc-dispatched' && e.kind === 'lap1'));
  assert.equal(R.mcObjectives(rc, { s: 100 }).stage, 'follow');
  let evs = R.mcStep(rc, { s: 500, speed: 40, lap: 0 }, 1); assert.equal(rc.mc.phase, 'follow'); assert.ok(rc.mc.passedS1 === false || rc.mc.passedS1 === undefined);
  R.mcStep(rc, { s: 3000, speed: 40, lap: 0 }, 1); assert.equal(rc.mc.phase, 'follow'); assert.ok(rc.mc.passedS1);
  evs = R.mcStep(rc, { s: 50, speed: 40, lap: 1 }, 1); assert.equal(rc.mc.phase, 'returning'); assert.ok(evs.some((e) => e.type === 'mc-returning'));
  R.mcStep(rc, { s: 3900, speed: 20, lap: 1, inPit: true }, 1); assert.equal(rc.mc.phase, 'in-pit');
});

test('Medical Car: a severe crash sends it straight to the site, it stops off the racing line for a 10 to 15 s check, race control clears it, and it returns to the pits', () => {
  for (const r of [0, 1]) {
    const rc = mk({ rand: () => r, halfWidth: 17 });
    R.reportIncident(rc, { kind: 'barrier', sector: 6, s: 1000, carId: 'C', highG: true });
    assert.equal(rc.state, 'SAFETY_CAR'); assert.equal(rc.mc.phase, 'responding'); assert.equal(rc.mc.site.s, 1000); assert.deepEqual(rc.mc.site.carIds, ['C']);
    const o = R.mcObjectives(rc, { s: 400 }); assert.equal(o.stage, 'respond'); assert.equal(o.target.distance, 600); assert.match(o.prompt, /Sector 1|Sector 2/);
    // arrives but on the racing line: no check
    R.mcStep(rc, { s: 1000, speed: 0, lat: 0, lap: 1 }, 1); assert.equal(rc.mc.phase, 'responding', 'it must be off the racing line');
    R.mcStep(rc, { s: 1020, speed: 0, lat: 15, lap: 1 }, 1); assert.equal(rc.mc.phase, 'assessing');
    const total = rc.mc.assessTotal; assert.ok(total >= 10 && total <= 15, `check of ${total} s`);
    assert.equal(R.mcObjectives(rc, { s: 1020 }).stage, 'assess'); assert.ok(R.mcObjectives(rc, { s: 1020 }).timer.total === total);
    // moving off interrupts the check and starts it again
    R.mcStep(rc, { s: 1020, speed: 0, lat: 15, lap: 1 }, 3); const left = rc.mc.assessLeft; assert.ok(left < total);
    R.mcStep(rc, { s: 1100, speed: 12, lat: 15, lap: 1 }, 0.1); assert.equal(rc.mc.phase, 'responding'); assert.equal(rc.mc.assessLeft, total); assert.equal(rc.mc.interrupted, 1);
    R.mcStep(rc, { s: 1010, speed: 0, lat: 15, lap: 1 }, 0.1); assert.equal(rc.mc.phase, 'assessing');
    let evs = []; for (let t = 0; t < total + 1; t += 0.5) evs.push(...R.mcStep(rc, { s: 1010, speed: 0, lat: 15, lap: 1 }, 0.5));
    assert.ok(evs.some((e) => e.type === 'mc-assessed')); assert.equal(rc.mc.phase, 'cleared'); assert.equal(R.mcObjectives(rc, { s: 1010 }).stage, 'cleared');
    assert.equal(R.clearMedical(rc), true); assert.equal(rc.mc.phase, 'returning'); assert.equal(R.mcObjectives(rc, { s: 1010, pitEntryS: 3860 }).target.distance, 2850);
    R.mcStep(rc, { s: 3900, speed: 15, lat: 0, lap: 1, inPit: true }, 1); assert.equal(rc.mc.phase, 'in-pit'); assert.equal(R.mcObjectives(rc, { s: 3900 }).stage, 'done');
  }
  assert.equal(R.clearMedical(mk()), false); assert.equal(R.mcObjectives(mk(), { s: 0 }).stage, 'idle');
});

test('Medical Car: a crash redirects a lap-1 follow, and a minor yellow does not send it', () => {
  const rc = mk(); R.mcLap1(rc); R.reportIncident(rc, { kind: 'barrier', sector: 3, s: 600, carId: 'B' });
  assert.equal(rc.mc.kind, 'crash'); assert.equal(rc.mc.phase, 'responding');
  const minor = mk(); R.reportIncident(minor, { kind: 'offtrack', sector: 3, carId: 'B' }); assert.equal(minor.mc, null);
  const first = mk(); R.reportIncident(first, { kind: 'barrier', sector: 3, s: 600 }); const m1 = first.mc; R.reportIncident(first, { kind: 'barrier', sector: 9, s: 1800 }); assert.equal(first.mc, m1, 'already on its way');
  const rf = mk(); R.reportIncident(rf, { kind: 'blocked-track', sector: 4, s: 700 }); assert.equal(rf.state, 'RED_FLAG');
});

// timing loops: [car, loop index, time]
const loops = (rc, rows) => rows.forEach(([id, idx, t]) => R.recordLoop(rc, id, idx, t));

test('red flag freezes the order from the last timing loop crossed by all cars, not the live positions', () => {
  const rc = mk();
  // everybody crossed loops 1..4 in the order A B C D; at loop 5 only A and B had crossed (and C and D were about to swap)
  for (let i = 1; i <= 4; i++) loops(rc, [['A', i, i * 10], ['B', i, i * 10 + 1], ['C', i, i * 10 + 2], ['D', i, i * 10 + 3]]);
  loops(rc, [['A', 5, 50], ['B', 5, 51], ['D', 5, 52.5]]);             // D got to loop 5 before C: C is not past it
  R.redFlag(rc, 'barrier', null);
  assert.deepEqual(rc.frozen, ['A', 'B', 'C', 'D'], 'order at loop 4, the last loop everyone crossed');
  assert.equal(rc.state, 'RED_FLAG');
  assert.ok(rc.log.some((e) => e.type === 'classification-frozen'));
  assert.equal(R.canOvertake(rc, 'A', 100), false); assert.equal(R.speedCap(rc, 'A', 100).max, 0);
  // a swap between loops does count if it happened at the common loop
  const r2 = mk();
  loops(r2, [['A', 3, 30], ['B', 3, 29], ['C', 3, 31], ['D', 3, 32]]); R.redFlag(r2, 'x');
  assert.deepEqual(r2.frozen, ['B', 'A', 'C', 'D']);
});

test('a car that caused the red flag and did not get back is classified by its own last loop', () => {
  const rc = mk();
  for (let i = 1; i <= 3; i++) loops(rc, [['A', i, i * 10], ['B', i, i * 10 + 1], ['C', i, i * 10 + 2], ['D', i, i * 10 + 3]]);
  loops(rc, [['A', 4, 40], ['B', 4, 41], ['D', 4, 43]]);               // C crashed before loop 4 and caused the stoppage
  R.redFlag(rc, 'crash', 'C');
  assert.deepEqual(rc.frozen, ['A', 'B', 'C', 'D'], 'C stays where it was at loop 3, ahead of D');
});

test('red flag: line up in the pit lane in race order, change tyres and the front wing (not the engine), then restart behind the Safety Car', () => {
  const rc = mk();
  for (let i = 1; i <= 2; i++) loops(rc, [['B', i, i * 10], ['A', i, i * 10 + 1], ['C', i, i * 10 + 2], ['D', i, i * 10 + 3]]);
  R.redFlag(rc, 'rain');
  const line = R.redFlagLineup(rc); assert.deepEqual(line.map((x) => x.id), ['B', 'A', 'C', 'D']); assert.deepEqual(line.map((x) => x.slot), [0, 1, 2, 3]);
  const t = R.redFlagWork(rc, 'A', 'tyres', { compound: 'H' }); assert.equal(t.ok, true); assert.equal(t.countsCompound, true);
  assert.equal(R.redFlagWork(rc, 'A', 'frontWing').ok, true); assert.equal(R.redFlagWork(rc, 'A', 'wingAngle').ok, true); assert.equal(R.redFlagWork(rc, 'A', 'repair').ok, true);
  const no = R.redFlagWork(rc, 'A', 'engine'); assert.equal(no.ok, false); assert.match(no.why, /not allowed/);
  assert.equal(R.redFlagWork(mk(), 'A', 'tyres').ok, false, 'no work unless under a red flag');
  const r = R.restartFromRed(rc);
  assert.equal(r.startType, 'standing'); assert.equal(r.formationLaps, 1); assert.deepEqual(r.order, ['B', 'A', 'C', 'D']);
  assert.equal(R.redFlagWork(rc, 'C', 'tyres').ok, false, 'the cars have left the pit lane');
  assert.equal(R.startAfterRed(rc), true); assert.equal(rc.state, 'GREEN'); assert.equal(rc.red, null);
  assert.ok(rc.log.some((e) => e.type === 'restart' && e.startType === 'standing'));
  // a wet race restarts with a rolling start
  const wet = mk({ wet: true }); loops(wet, [['A', 1, 1], ['B', 1, 2], ['C', 1, 3], ['D', 1, 4]]); R.redFlag(wet, 'storm'); assert.equal(R.restartFromRed(wet).startType, 'rolling');
});

test('blue flag: a lapping car within 1.2 s behind a backmarker; he must let it by within 3 marshal posts or take a 5 s penalty', () => {
  const rc = mk();
  const run = (backS, backSpeed, steps, fastLap = 2, backLap = 1, startGap = 60) => {
    let fast = backS - startGap, back = backS; const evs = [];
    for (let i = 0; i < steps; i++) { fast += 75 * 0.1; back += backSpeed * 0.1; evs.push(...R.tick(rc, { cars: [car('F', fast, fastLap, 75), car('S', back, backLap, backSpeed)] }, 0.1)); }
    return evs;
  };
  let evs = run(1000, 60, 3);
  assert.ok(evs.some((e) => e.type === 'blue' && e.carId === 'S' && e.from === 'F'), 'the backmarker is shown blue');
  // F passes him: cleared
  const rc2 = mk(); let f = 960, b = 1000; evs = [];
  for (let i = 0; i < 80; i++) { f += 80 * 0.1; b += 55 * 0.1; evs.push(...R.tick(rc2, { cars: [car('F', f, 2, 80), car('S', b, 1, 55)] }, 0.1)); }
  assert.ok(evs.some((e) => e.type === 'blue') && evs.some((e) => e.type === 'blue-cleared'), 'blue shown, then cleared when he let the car by');
  assert.ok(!evs.some((e) => e.type === 'penalty'));
  // a driver who ignores it: stays ahead, speeding up, for more than 3 posts
  const rc3 = mk(); f = 960; b = 1000; evs = [];
  for (let i = 0; i < 260; i++) { const sv = i < 10 ? 60 : 78; f += 75 * 0.1; b += sv * 0.1; evs.push(...R.tick(rc3, { cars: [car('F', f, 2, 75), car('S', b, 1, sv)] }, 0.1)); }
  const pens = evs.filter((e) => e.type === 'penalty'); assert.equal(pens.length, 1, 'one penalty'); assert.equal(pens[0].seconds, 5); assert.equal(pens[0].carId, 'S'); assert.match(pens[0].reason, /blue/);
  // same lap, or too far behind: no flag
  const rc4 = mk(); evs = [];
  for (let i = 0; i < 10; i++) evs.push(...R.tick(rc4, { cars: [car('F', 1000 + i, 1, 75), car('S', 1030 + i, 1, 60)] }, 0.1));
  for (let i = 0; i < 10; i++) evs.push(...R.tick(rc4, { cars: [car('F', 500 + i, 2, 75), car('S', 1030 + i, 1, 60)] }, 0.1));
  assert.ok(!evs.some((e) => e.type === 'blue'));
  // no blue under a yellow-flag state change like VSC
  const rc5 = mk(); R.deployVSC(rc5, 'x'); evs = R.tick(rc5, { cars: [car('F', 1000, 2, 40), car('S', 1030, 1, 38)] }, 0.1); assert.ok(!evs.some((e) => e.type === 'blue'));
});

test('black and orange: a car with loose bodywork must pit and cannot be cleared until repaired; ignoring it for 3 laps is a black flag', () => {
  const rc = mk(); R.meatball(rc, 'B', 'front wing endplate');
  assert.ok(rc.cars.get('B').flags.meatball); assert.ok(R.drain(rc).some((e) => e.type === 'meatball'));
  for (let lap = 1; lap <= 3; lap++) R.tick(rc, { cars: [car('B', 100, lap)] }, 1);
  assert.equal(rc.cars.get('B').flags.black, null, 'three laps are allowed');
  R.tick(rc, { cars: [car('B', 100, 4)] }, 1);
  assert.ok(rc.cars.get('B').flags.black && rc.cars.get('B').dnf, 'the fourth lap: black flag');
  const ok = mk(); R.meatball(ok, 'A', 'floor'); assert.equal(R.clearMeatball(ok, 'A'), true); assert.equal(ok.cars.get('A').flags.meatball, null); assert.equal(R.clearMeatball(ok, 'A'), false);
});

test('black and white is a warning, black is a disqualification', () => {
  const rc = mk();
  assert.equal(R.blackWhite(rc, 'C', 'third track limits strike'), true); assert.equal(R.blackWhite(rc, 'C', 'again'), false, 'it is shown once');
  assert.equal(rc.cars.get('C').flags.bw.why, 'third track limits strike'); assert.equal(rc.cars.get('C').dnf, false);
  assert.equal(R.blackFlag(rc, 'C', 'ignored a stop-go'), true); assert.equal(rc.cars.get('C').dnf, true); assert.equal(rc.cars.get('C').flags.black.why, 'ignored a stop-go');
  assert.ok(rc.log.filter((e) => e.type === 'black-white' || e.type === 'black').length === 2);
});

test('chequered flag: the leader takes it at race distance, the others at their next line crossing, lapped cars last; then the session is over', () => {
  const rc = mk({ laps: 3 });
  let evs = R.tick(rc, { cars: [car('A', 100, 2), car('B', 3900, 1), car('C', 3000, 1), car('D', 300, 0)] }, 1);
  assert.ok(!evs.some((e) => e.type === 'chequered'));
  evs = R.tick(rc, { cars: [car('A', 10, 3), car('B', 3950, 2), car('C', 3100, 1), car('D', 400, 0)] }, 1);
  assert.ok(evs.some((e) => e.type === 'chequered-out')); assert.ok(evs.some((e) => e.type === 'chequered' && e.carId === 'A' && e.position === 1));
  evs = R.tick(rc, { cars: [car('A', 500, 3, 50, { finished: true }), car('B', 20, 3), car('C', 3500, 1), car('D', 800, 0)] }, 1);
  assert.ok(evs.some((e) => e.type === 'chequered' && e.carId === 'B' && e.position === 2), 'B finished when it crossed the line');
  assert.equal(rc.state, 'GREEN');
  R.tick(rc, { cars: [car('A', 500, 3, 50, { finished: true }), car('B', 600, 3, 50, { finished: true }), car('C', 10, 2), car('D', 1000, 0)] }, 1);
  evs = R.tick(rc, { cars: [car('A', 500, 3, 50, { finished: true }), car('B', 600, 3, 50, { finished: true }), car('C', 100, 2), car('D', 20, 1)] }, 1);
  assert.deepEqual(rc.finishOrder, ['A', 'B', 'C', 'D']);
  assert.equal(rc.state, 'CHEQUERED'); assert.equal(rc.sessionOver, true);
});

test('chequered flag in a timed session: when the timer ends each car finishes the lap it is on', () => {
  const rc = R.create({ trackLength: L, laps: 0, sessionSecs: 100, session: 'quali', cars: ['A', 'B'] });
  let evs = R.tick(rc, { cars: [car('A', 1000, 3), car('B', 2000, 2)] }, 99); assert.ok(!evs.some((e) => e.type.startsWith('chequered')));
  evs = R.tick(rc, { cars: [car('A', 1100, 3), car('B', 2100, 2)] }, 2);
  assert.ok(evs.some((e) => e.type === 'chequered-out'), 'timer over');
  assert.ok(!evs.some((e) => e.type === 'chequered'), 'nobody finishes mid-lap');
  evs = R.tick(rc, { cars: [car('A', 50, 4), car('B', 2500, 2)] }, 5); assert.ok(evs.some((e) => e.type === 'chequered' && e.carId === 'A'));
  evs = R.tick(rc, { cars: [car('A', 800, 4, 50, { finished: true }), car('B', 30, 3)] }, 5); assert.ok(evs.some((e) => e.type === 'chequered' && e.carId === 'B'));
  assert.equal(rc.state, 'CHEQUERED');
});

test('a retired car is left out of the classification and the finish', () => {
  const rc = mk(); R.retire(rc, 'D', 'suspension');
  for (let i = 1; i <= 2; i++) loops(rc, [['A', i, i * 10], ['B', i, i * 10 + 1], ['C', i, i * 10 + 2]]);
  R.redFlag(rc, 'x'); assert.deepEqual(rc.frozen, ['A', 'B', 'C']);
});
