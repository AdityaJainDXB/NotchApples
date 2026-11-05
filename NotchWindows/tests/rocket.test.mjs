// Rocket League rules and bots (no screen). Run: node --test NotchWindows/tests/rocket.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const R = createRequire(import.meta.url)('../src/js/games/rocket-logic.js');

const DT = 1 / 60;
const run = (m, secs, ctl = {}) => { for (let i = 0; i < secs * 60; i++) R.step(m, typeof ctl === 'function' ? ctl(m) : ctl, DT); };
const live = (cars = [{ id: 'a', team: 0 }, { id: 'b', team: 1 }]) => { const m = R.newMatch(); for (const c of cars) R.addCar(m, { name: c.id, ...c }); run(m, R.MATCH.countdown + 0.1); assert.equal(m.state, 'play'); return m; };

test('a match starts with a countdown, then play, and nobody moves during the countdown', () => {
  const m = R.newMatch(); R.addCar(m, { id: 'a', team: 0 });
  assert.equal(m.state, 'countdown');
  run(m, 1, { a: { r: true, j: true } });
  assert.equal(m.cars[0].x, 340, 'held at the kickoff spot');
  run(m, 2.2);
  assert.equal(m.state, 'play');
});

test('the ball falls, bounces and settles on the floor', () => {
  const m = live([]); m.ball.y = 100;
  run(m, 25);
  assert.ok(Math.abs(m.ball.y - (R.FLOOR - R.BALL.r)) < 1.5, 'resting on the floor');
  assert.ok(Math.abs(m.ball.vy) < 60);
});

test('a car drives, turns, jumps, dashes with a second jump and lands', () => {
  const m = live(); const c = m.cars[0];
  run(m, 1, { a: { r: true } });
  assert.ok(c.vx > 300 && c.dir === 1);
  run(m, 1, { a: { l: true } });
  assert.equal(c.dir, -1, 'turned round');
  // jump
  c.vx = 0; const y0 = c.y;
  R.step(m, { a: { j: true } }, DT); R.step(m, { a: { j: true } }, DT);
  assert.ok(c.y < y0 && !c.ground, 'in the air');
  R.step(m, { a: {} }, DT);
  R.step(m, { a: { j: true, r: true } }, DT);              // second press, holding right: a dash
  assert.equal(c.jumps, 2);
  assert.ok(c.vx > 300, 'dashed right');
  run(m, 3);
  assert.ok(c.ground && c.jumps === 0, 'landed');
  assert.ok(Math.abs(c.a) < 1e-9 || Math.abs(Math.abs(c.a) - Math.PI) < 1e-9, 'upright after landing');
});

test('a car cannot jump a third time and holding jump does not repeat', () => {
  const m = live(); const c = m.cars[0];
  run(m, 0.2, { a: { j: true } });
  assert.equal(c.jumps, 1, 'holding is one jump');
  for (let i = 0; i < 3; i++) { R.step(m, { a: {} }, DT); R.step(m, { a: { j: true } }, DT); }
  assert.equal(c.jumps, 2);
});

test('boost speeds a car up, uses up the boost, and a pad refills it', () => {
  const m = live(); const c = m.cars[0]; c.boost = 40; m.pads = m.pads.map(() => 99);       // pads out of the way
  run(m, 0.6, { a: { r: true, b: true } });
  assert.ok(c.vx > R.CAR.speed + 50, 'faster than driving alone can go');
  assert.ok(c.boost < 40 - 15, 'boost was used');
  m.pads = m.pads.map(() => 0); c.boost = 0; c.x = R.PADS[2].x; c.vx = 0;
  R.step(m, { a: {} }, DT);
  assert.equal(c.boost, 100, 'the big middle pad gives a full tank');
  assert.ok(m.pads[2] > 0, 'and is used up for a few seconds');
  const before = c.boost; c.boost = 10; R.step(m, { a: {} }, DT);
  assert.equal(c.boost, 10, 'a used pad gives nothing');
  void before;
});

test('a car hits the ball and sends it away', () => {
  const m = live([{ id: 'a', team: 0 }]); const c = m.cars[0];
  c.x = 700; c.vx = 500; m.ball.x = 790; m.ball.y = R.FLOOR - R.BALL.r; m.ball.vx = 0; m.ball.vy = 0;
  run(m, 0.6, { a: { r: true } });
  assert.ok(m.ball.vx > 300, 'the ball was knocked forwards');
  assert.ok(c.hits > 0 && m.last === 'a');
});

test('the ball in the right goal scores for Blue and in the left goal for Orange; the walls above the goal are solid', () => {
  let m = live(); m.ball.x = R.W + 5; m.ball.y = R.FLOOR - 60; m.ball.vx = 400; m.ball.vy = 0; m.last = 'a';
  run(m, 0.5);
  assert.deepEqual(m.score, [1, 0]); assert.equal(m.state, 'goal'); assert.equal(m.cars[0].goals, 1);
  m = live(); m.ball.x = -5; m.ball.y = R.FLOOR - 60; m.ball.vx = -400; m.ball.vy = 0;
  run(m, 0.5);
  assert.deepEqual(m.score, [0, 1]);
  m = live(); m.ball.x = 30; m.ball.y = R.GOAL_TOP - 200; m.ball.vx = -900; m.ball.vy = 0;
  run(m, 1.5);
  assert.deepEqual(m.score, [0, 0], 'it hit the wall above the goal');
  assert.ok(m.ball.x >= R.BALL.r - 1);
});

test('after a goal there is a celebration, then a new kickoff with the ball and cars back in place', () => {
  const m = live(); m.ball.x = R.W + 5; m.ball.y = R.FLOOR - 60; m.ball.vx = 400; m.cars[0].x = 900;
  run(m, 0.3); assert.equal(m.state, 'goal');
  run(m, R.MATCH.celebrate + 0.1);
  assert.equal(m.state, 'countdown');
  assert.equal(m.ball.x, R.W / 2); assert.equal(m.cars[0].x, 340); assert.equal(m.cars[1].x, R.W - 340);
  assert.deepEqual(m.score, [1, 0], 'the score stays');
});

test('the match ends at time up with the higher score, or goes to a golden goal when level', () => {
  let m = R.newMatch({ time: 5 }); R.addCar(m, { id: 'a', team: 0 }); R.addCar(m, { id: 'b', team: 1 }); m.score = [2, 1];
  run(m, 10); assert.equal(m.state, 'over'); assert.equal(m.winner, 0);
  m = R.newMatch({ time: 5 }); R.addCar(m, { id: 'a', team: 0 }); R.addCar(m, { id: 'b', team: 1 });
  run(m, 9); assert.equal(m.overtime, true); assert.equal(m.state, 'play', 'still going');
  m.ball.x = -5; m.ball.y = R.FLOOR - 60; m.ball.vx = -400;
  run(m, 0.5); assert.equal(m.winner, 1); run(m, 3); assert.equal(m.state, 'over');
});

test('computer players score on an idle opponent, and each bot team behaves', () => {
  let scored = 0;
  for (const skill of [0.5, 0.75, 1]) {
    const m = R.newMatch({ time: 120 }); R.addCar(m, { id: 'bot', team: 0, bot: true, skill }); R.addCar(m, { id: 'idle', team: 1 });
    run(m, 120); scored += m.score[0];
    for (const c of m.cars) { assert.ok(c.x >= 0 && c.x <= R.W && c.y >= 0 && c.y <= R.FLOOR); assert.ok(Number.isFinite(c.vx + c.vy + c.boost)); }
    assert.ok(Number.isFinite(m.ball.x + m.ball.y));
  }
  assert.ok(scored >= 3, `bots scored ${scored} goals in three two-minute games against nobody`);
});

test('a bot match stays sane for ten minutes: two against two, the ball never leaves the arena', () => {
  const m = R.newMatch({ time: 600 });
  R.addCar(m, { id: 'b1', team: 0, bot: true, skill: 0.8 }); R.addCar(m, { id: 'b2', team: 0, bot: true, skill: 0.8 });
  R.addCar(m, { id: 'o1', team: 1, bot: true, skill: 0.8 }); R.addCar(m, { id: 'o2', team: 1, bot: true, skill: 0.8 });
  for (let i = 0; i < 600 * 60; i++) {
    R.step(m, {}, DT);
    assert.ok(m.ball.x > -R.GOAL_DEPTH - 1 && m.ball.x < R.W + R.GOAL_DEPTH + 1 && m.ball.y > -1 && m.ball.y < R.H, `ball in bounds at ${i}`);
  }
  assert.ok(m.score[0] + m.score[1] > 0, 'someone scored');
});

test('a snapshot rebuilds the same picture on another machine', () => {
  const host = live(); host.score = [1, 2]; host.cars[0].boost = 55; host.ball.x = 321.4;
  run(host, 1, { a: { r: true } });
  const wire = JSON.parse(JSON.stringify(R.snapshot(host)));
  assert.ok(JSON.stringify(wire).length < 600, 'small enough to send 30 times a second');
  const guest = R.newMatch(); R.addCar(guest, { id: 'a', team: 0 }); R.addCar(guest, { id: 'b', team: 1 });
  R.applySnapshot(guest, wire);
  assert.deepEqual(guest.score, [1, 2]);
  assert.ok(Math.abs(guest.ball.x - host.ball.x) < 0.06 && Math.abs(guest.cars[0].x - host.cars[0].x) < 0.06);
  assert.equal(guest.cars[0].boost, Math.round(host.cars[0].boost));
  assert.equal(guest.state, host.state);
});

test('the same inputs always give the same match', () => {
  const play = () => { const m = live(); const ctl = (mm) => ({ a: { r: true, j: Math.floor(mm.t * 2) % 3 === 0, b: true } }); run(m, 20, ctl); return JSON.stringify(R.snapshot(m)); };
  assert.equal(play(), play());
});
