// Capture the Flag rules and bots (no screen). Run: node --test NotchWindows/tests/ctf.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const C = createRequire(import.meta.url)('../src/js/games/ctf-logic.js');

const match = (n = 3, skill = 0.8, to = 3) => {
  const m = C.newMatch({ to, limit: 600 });
  for (let i = 0; i < n; i++) { C.addPlayer(m, { id: 'b' + i, name: 'Blue' + i, team: 0, bot: true, skill }); C.addPlayer(m, { id: 'r' + i, name: 'Red' + i, team: 1, bot: true, skill }); }
  return m;
};

test('walls stop circles and bullets, and the arena is the same both ways round', () => {
  const s = C.slide(0, 0, 1.1); assert.ok(Math.hypot(s.x, s.y) > 1, 'pushed out of the middle block');
  assert.equal(C.clear(-30, 0, 30, 0), false, 'the middle block is in the way');
  assert.equal(C.clear(-95, 50, -60, 50), true);
  for (const w of C.WALLS) assert.ok(C.WALLS.some((v) => Math.abs((v.x + v.w) + w.x) < 1e-9 && v.y === w.y && v.w === w.w && v.h === w.h), 'mirrored');
  const edge = C.slide(1000, 1000, 1); assert.ok(edge.x < 100 && edge.y < 60);
});

test('there is a path from every base to the other, and the bots follow it round the walls', () => {
  const a = C.STAND(0), b = C.STAND(1), p = C.findPath(a.x, a.y, b.x, b.y);
  assert.ok(p.length > 0, 'a path exists');
  let x = a.x, y = a.y; for (const q of p) { assert.ok(C.clear(x, y, q.x, q.y), 'each leg is clear'); x = q.x; y = q.y; }
});

test('taking, carrying, dropping, returning and capturing a flag', () => {
  const m = C.newMatch({ to: 2 }); const bl = C.addPlayer(m, { id: 'a', team: 0 }), rd = C.addPlayer(m, { id: 'b', team: 1 });
  // Blue walks to the red flag and takes it.
  bl.x = C.STAND(1).x - 1; bl.y = 0; C.tick(m, 0.016);
  assert.equal(m.flags[1].state, 'carried'); assert.equal(bl.carrying, 1);
  // Red kills the carrier: the flag drops where they died.
  bl.shield = 0; bl.x = 30; bl.y = 40; C.damage(m, bl, 200, 'b');
  assert.equal(m.flags[1].state, 'dropped'); assert.equal(bl.carrying, -1); assert.ok(Math.abs(m.flags[1].x - 30) < 1e-9);
  // Red touches its own dropped flag: home again.
  rd.x = 30; rd.y = 40; C.tick(m, 0.016); assert.equal(m.flags[1].state, 'home');
  // Blue takes it again and brings it back: a capture.
  C.spawn(m, bl); bl.x = C.STAND(1).x - 1; bl.y = 0; C.tick(m, 0.016); assert.equal(bl.carrying, 1);
  bl.x = C.STAND(0).x + 1; bl.y = 0; C.tick(m, 0.016);
  assert.equal(m.score[0], 1); assert.equal(m.flags[1].state, 'home'); assert.equal(bl.carrying, -1);
});

test('you cannot capture while your own flag is away, and a dropped flag returns by itself', () => {
  const m = C.newMatch(); const bl = C.addPlayer(m, { id: 'a', team: 0 }), rd = C.addPlayer(m, { id: 'b', team: 1 });
  rd.x = C.STAND(0).x + 0.5; rd.y = 0; C.tick(m, 0.016);           // red takes blue's flag
  assert.equal(m.flags[0].state, 'carried');
  bl.x = C.STAND(1).x - 1; bl.y = 0; C.tick(m, 0.016); assert.equal(bl.carrying, 1);
  bl.x = C.STAND(0).x + 1; bl.y = 0; C.tick(m, 0.016);
  assert.equal(m.score[0], 0, 'no capture while blue\'s own flag is out');
  rd.carrying = -1; m.flags[0].state = 'dropped'; m.flags[0].carrier = null; m.flags[0].x = 0; m.flags[0].y = -55; m.flags[0].droppedAt = m.t;
  bl.x = 50; bl.y = 50; C.tick(m, C.RETURN_AFTER + 1); assert.equal(m.flags[0].state, 'home');
});

test('shooting hurts the other team only, respawns come back with a shield, and kills are counted', () => {
  const m = C.newMatch(); const a = C.addPlayer(m, { id: 'a', team: 0 }), b = C.addPlayer(m, { id: 'b', team: 1 }), c = C.addPlayer(m, { id: 'c', team: 0 });
  a.shield = b.shield = c.shield = 0; a.x = -20; a.y = -50; b.x = 20; b.y = -50; c.x = 0; c.y = -50;
  a.a = 0; const rnd = Math.random; Math.random = () => 0.5;      // no spread: the shot goes straight at the enemy
  const bu = C.fire(m, a, 0); Math.random = rnd; assert.ok(bu);
  for (let i = 0; i < 60; i++) C.stepBullets(m, 1 / 60, (bb, v) => C.damage(m, v, bb.dmg, bb.owner));
  assert.ok(c.hp === 100, 'a team mate is not hurt'); assert.ok(b.hp < 100, 'the enemy is');
  C.damage(m, b, 500, 'a'); assert.equal(b.alive, false); assert.equal(a.kills, 1);
  C.tick(m, C.PLAYER.respawn + 0.1); assert.equal(b.alive, true); assert.ok(b.shield > 0);
});

test('the bots play a whole match: they fight, take flags and score, and it ends', () => {
  let totalCaps = 0, ended = 0, kills = 0;
  for (let game = 0; game < 6; game++) {
    const m = match(3, 0.55, 2);
    for (let i = 0; i < 60 * 620 && !m.over; i++) C.step(m, 1 / 60);
    totalCaps += m.score[0] + m.score[1]; if (m.over) ended++; kills += m.players.reduce((s, p) => s + p.kills, 0);
    for (const p of m.players) assert.ok(Math.abs(p.x) <= 100 && Math.abs(p.y) <= 60, 'stays in the arena');
  }
  console.log('bots: captures', totalCaps, 'kills', kills, 'ended', ended);
  assert.equal(ended, 6, 'every match ends (by captures or by time)');
  assert.ok(kills >= 8, `the bots fight (${kills} kills)`);
  assert.ok(totalCaps >= 1, `the bots capture flags (${totalCaps} captures in 6 matches)`);
});

test('a match ends by time with the leader winning', () => {
  const m = C.newMatch({ to: 99, limit: 10 }); C.addPlayer(m, { id: 'a', team: 0 }); C.addPlayer(m, { id: 'b', team: 1 }); m.score[1] = 1;
  C.tick(m, 11); assert.equal(m.over, true); assert.equal(m.winner, 1);
});
