// Rocket League for the Games tab: the rules and physics with no screen, shared by the Mac and Windows apps (the game itself
// is rocket.js) and tested in Node (NotchWindows/tests/rocket.test.mjs). A side-on car soccer game: cars drive, jump, dash
// with a second jump and boost to knock a ball into the other team's goal. Pixels and seconds, x to the right, y down.
// Team 0 is Blue (defends the left goal), team 1 is Orange (defends the right). Cars pass through each other.
(function () {
  'use strict';
  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
  const TAU = Math.PI * 2;

  // ---- the arena
  const W = 1300, H = 800, FLOOR = 740, GOAL_H = 270, GOAL_TOP = FLOOR - GOAL_H, GOAL_DEPTH = 110;
  const BALL = { r: 40, gravity: 980, bounce: 0.78, air: 0.06, roll: 0.35, max: 1500 };
  const CAR = { r: 24, parts: [-30, 0, 30], gravity: 1500, speed: 600, boostSpeed: 960, accel: 1700, brake: 1500, jump: 640, dodge: 640, dodgeUp: 280, spin: 5.2, boostAccel: 2300, boostUse: 32, topSpeed: 1150 };
  const MASS = { ball: 1, car: 3 };
  const MATCH = { time: 180, countdown: 3, celebrate: 2.6 };
  const PADS = [{ x: 130, big: false }, { x: 450, big: false }, { x: 650, big: true }, { x: 850, big: false }, { x: 1170, big: false }].map((p) => ({ ...p, gain: p.big ? 100 : 30, wait: p.big ? 7 : 4 }));

  const kickoffCar = (team, slot) => ({ x: team === 0 ? 340 - slot * 130 : W - 340 + slot * 130, a: team === 0 ? 0 : Math.PI });

  function newCar(spec, slot) {
    const k = kickoffCar(spec.team, slot);
    return { id: spec.id, name: spec.name || 'Player', team: spec.team, bot: !!spec.bot, skill: spec.skill == null ? 0.7 : spec.skill, slot,
             x: k.x, y: FLOOR - CAR.r, vx: 0, vy: 0, a: k.a, dir: spec.team === 0 ? 1 : -1, ground: true, jumps: 0, boost: 34, flip: 0, flipDir: 0,
             held: { j: false }, boosting: false, goals: 0, hits: 0 };
  }

  function newMatch(opts = {}) {
    return { w: W, h: H, time: opts.time || MATCH.time, clock: opts.time || MATCH.time, ball: { x: W / 2, y: 330, vx: 0, vy: 0 }, cars: [], score: [0, 0],
             state: 'countdown', stateT: MATCH.countdown, overtime: false, winner: null, last: null, pads: PADS.map(() => 0), events: [], t: 0 };
  }

  function addCar(m, spec) {
    const slot = m.cars.filter((c) => c.team === spec.team).length;
    const c = newCar(spec, slot);
    m.cars.push(c);
    return c;
  }

  function kickoff(m) {
    m.ball = { x: W / 2, y: 330, vx: 0, vy: 0 };
    const seen = [0, 0];
    for (const c of m.cars) {
      const k = kickoffCar(c.team, seen[c.team]++);
      Object.assign(c, { x: k.x, y: FLOOR - CAR.r, vx: 0, vy: 0, a: k.a, dir: c.team === 0 ? 1 : -1, ground: true, jumps: 0, flip: 0, boosting: false, boost: Math.max(c.boost, 34) });
    }
    m.pads = PADS.map(() => 0);
    m.state = 'countdown'; m.stateT = MATCH.countdown;
  }

  // ---- cars
  const carDir = (c) => ({ x: Math.cos(c.a), y: Math.sin(c.a) });

  function driveCar(m, c, ctl, dt) {
    const want = (ctl.r ? 1 : 0) - (ctl.l ? 1 : 0);
    const press = !!ctl.j && !c.held.j; c.held.j = !!ctl.j;
    const boosting = !!ctl.b && c.boost > 0 && m.state !== 'countdown';
    c.boosting = boosting;
    if (c.ground) {
      if (want) { c.dir = want; c.a = want > 0 ? 0 : Math.PI; }
      const cap = boosting ? CAR.boostSpeed : CAR.speed;
      if (want) {
        const target = want * cap;
        if (Math.sign(c.vx) !== want && Math.abs(c.vx) > 1) c.vx += want * CAR.brake * dt; else c.vx += want * CAR.accel * dt;
        if (Math.abs(c.vx) > Math.abs(target) && Math.sign(c.vx) === want) c.vx = Math.max(Math.abs(target), Math.abs(c.vx) - CAR.brake * dt) * want;
      } else {
        const dec = Math.min(Math.abs(c.vx), 0.8 * CAR.brake * dt);
        c.vx -= Math.sign(c.vx) * dec;
      }
      if (press && m.state !== 'countdown') { c.vy = -CAR.jump; c.ground = false; c.jumps = 1; }
    } else {
      if (want) c.a += want * CAR.spin * dt;
      if (press && c.jumps < 2 && m.state !== 'countdown') {
        c.jumps = 2;
        if (want) { c.vx += want * CAR.dodge; c.vy = -CAR.dodgeUp; c.flip = 0.45; c.flipDir = want; }     // a dash in the direction held
        else c.vy = -CAR.jump * 0.78;
      }
    }
    if (boosting) {
      const d = carDir(c);
      c.vx += d.x * CAR.boostAccel * dt; c.vy += d.y * CAR.boostAccel * dt;
      if (!c.ground || Math.abs(d.y) > 0.2) { /* boosting into the air is allowed */ }
      c.boost = Math.max(0, c.boost - CAR.boostUse * dt);
      const sp = Math.hypot(c.vx, c.vy);
      if (sp > CAR.topSpeed) { c.vx *= CAR.topSpeed / sp; c.vy *= CAR.topSpeed / sp; }
    }
    if (!c.ground) c.vy += CAR.gravity * dt;
    c.x += c.vx * dt; c.y += c.vy * dt;
    c.flip = Math.max(0, c.flip - dt);
    if (c.y >= FLOOR - CAR.r) {
      if (!c.ground) { c.ground = true; c.jumps = 0; c.dir = Math.cos(c.a) >= 0 ? 1 : -1; c.a = c.dir > 0 ? 0 : Math.PI; c.flip = 0; }
      c.y = FLOOR - CAR.r; c.vy = Math.min(0, c.vy);
    } else if (c.y > FLOOR - CAR.r - 2 && c.vy >= 0) { /* resting */ }
    else c.ground = false;
    if (c.y < CAR.r) { c.y = CAR.r; c.vy = Math.max(0, c.vy); }
    if (c.x < CAR.r) { c.x = CAR.r; c.vx = Math.max(0, c.vx); }
    if (c.x > W - CAR.r) { c.x = W - CAR.r; c.vx = Math.min(0, c.vx); }
    // boost pads
    for (let i = 0; i < PADS.length; i++) {
      if (m.pads[i] > 0 || c.boost >= 100) continue;
      if (Math.abs(c.x - PADS[i].x) < 44 && c.y > FLOOR - 70) { c.boost = Math.min(100, c.boost + PADS[i].gain); m.pads[i] = PADS[i].wait; m.events.push({ e: 'pad', id: c.id }); }
    }
  }

  // ---- the ball
  function hitBall(m, c) {
    const b = m.ball, d = carDir(c);
    for (const off of CAR.parts) {
      const px = c.x + d.x * off, py = c.y + d.y * off;
      const dx = b.x - px, dy = b.y - py, dist = Math.hypot(dx, dy), min = BALL.r + CAR.r;
      if (dist >= min || dist === 0) continue;
      const nx = dx / dist, ny = dy / dist;
      b.x += nx * (min - dist); b.y += ny * (min - dist);
      const rvx = b.vx - c.vx, rvy = b.vy - c.vy, vn = rvx * nx + rvy * ny;
      if (vn < 0) {
        const j = -(1 + 0.55) * vn / (1 / MASS.ball + 1 / MASS.car);
        b.vx += nx * j / MASS.ball; b.vy += ny * j / MASS.ball;
        c.vx -= nx * j / MASS.car * 0.35; c.vy -= ny * j / MASS.car * 0.35;
        if (c.boosting) { b.vx += nx * 160; b.vy += ny * 160; }
        // a little of the car's own motion goes into the ball so it never just dribbles off the bumper
        b.vx += c.vx * 0.12; b.vy += c.vy * 0.12;
        const sp = Math.hypot(b.vx, b.vy); if (sp > BALL.max) { b.vx *= BALL.max / sp; b.vy *= BALL.max / sp; }
        c.hits++; m.last = c.id; m.events.push({ e: 'hit', id: c.id, p: clamp(Math.abs(vn) / 900, 0.1, 1) });
      }
    }
  }

  function stepBall(m, dt) {
    const b = m.ball;
    b.vy += BALL.gravity * dt;
    b.vx -= b.vx * BALL.air * dt; b.vy -= b.vy * BALL.air * 0.3 * dt;
    b.x += b.vx * dt; b.y += b.vy * dt;
    const inMouth = b.y + BALL.r > GOAL_TOP;                      // low enough to go into a goal
    const leftEdge = inMouth ? -GOAL_DEPTH : 0, rightEdge = inMouth ? W + GOAL_DEPTH : W;
    if (b.y + BALL.r > FLOOR) { b.y = FLOOR - BALL.r; if (b.vy > 0) b.vy = -b.vy * BALL.bounce; if (Math.abs(b.vy) < 40) b.vy = 0; b.vx -= b.vx * BALL.roll * dt; }
    if (b.y - BALL.r < 0) { b.y = BALL.r; if (b.vy < 0) b.vy = -b.vy * BALL.bounce; }
    // the goal mouths: the walls stop above the crossbar, and the crossbar's end is a corner the ball can hit
    for (const cx of [0, W]) {
      const dx = b.x - cx, dy = b.y - GOAL_TOP, dist = Math.hypot(dx, dy);
      if (dist < BALL.r && dist > 0) {
        const nx = dx / dist, ny = dy / dist, vn = b.vx * nx + b.vy * ny;
        b.x += nx * (BALL.r - dist); b.y += ny * (BALL.r - dist);
        if (vn < 0) { b.vx -= (1 + BALL.bounce) * vn * nx; b.vy -= (1 + BALL.bounce) * vn * ny; }
      }
    }
    if (b.x - BALL.r < leftEdge) { b.x = leftEdge + BALL.r; if (b.vx < 0) b.vx = -b.vx * BALL.bounce; }
    if (b.x + BALL.r > rightEdge) { b.x = rightEdge - BALL.r; if (b.vx > 0) b.vx = -b.vx * BALL.bounce; }
    // above the crossbar the side walls still stop it
    if (!inMouth) { if (b.x - BALL.r < 0) { b.x = BALL.r; b.vx = Math.abs(b.vx) * BALL.bounce; } if (b.x + BALL.r > W) { b.x = W - BALL.r; b.vx = -Math.abs(b.vx) * BALL.bounce; } }
    const sp = Math.hypot(b.vx, b.vy); if (sp > BALL.max) { b.vx *= BALL.max / sp; b.vy *= BALL.max / sp; }
  }

  /** 0 or 1 when the whole ball is over that team's scoring line, else -1. A goal in the left mouth scores for Orange. */
  function goalAt(m) {
    const b = m.ball;
    if (b.y - BALL.r < GOAL_TOP) return -1;
    if (b.x + BALL.r < 0) return 1;
    if (b.x - BALL.r > W) return 0;
    return -1;
  }

  // ---- the computer players
  function think(m, c) {
    const b = m.ball, atk = c.team === 0 ? 1 : -1, ownGoalX = c.team === 0 ? 0 : W;
    const ctl = { l: false, r: false, j: false, b: false };
    const s = c.skill;
    // where the ball will be a moment from now, for anyone good enough to look ahead
    const lead = 0.18 * s;
    const bx = b.x + b.vx * lead, by = b.y + b.vy * lead;
    const toBall = bx - c.x;
    const onWrongSide = (c.x - bx) * atk > 30;                      // past the ball, so driving at it would push it toward its own goal
    const closest = !m.cars.some((o) => o !== c && o.team === c.team && Math.abs(o.x - b.x) < Math.abs(c.x - b.x) - 30);
    let targetX;
    if (!closest) targetX = Math.abs(bx - ownGoalX) < 520 ? bx - atk * 70 : ownGoalX - atk * -330;   // the second car holds the back, and helps when the ball comes close to the goal
    else if (onWrongSide) targetX = bx - atk * 200;                  // go back round behind the ball
    else targetX = bx - atk * 110;                                   // line up behind it
    const dx = targetX - c.x, dead = 26 + (1 - s) * 50;
    if (dx > dead) ctl.r = true; else if (dx < -dead) ctl.l = true;
    if (closest && onWrongSide) {
      // the ball is in the way of the way back: hop over it rather than shove it toward our own goal
      if (c.ground && Math.abs(toBall) < 240 && by > FLOOR - 150 && Math.sign(toBall) === Math.sign(dx) && s > 0.3) ctl.j = true;
    } else if (closest && Math.abs(dx) <= dead + 60) {
      ctl.r = atk > 0; ctl.l = atk < 0;                              // lined up: drive into the ball
    }
    const near = Math.abs(toBall) < 190 && Math.abs(by - c.y) < 200;
    if (near && closest && !onWrongSide && by < c.y - 70 && c.ground && s > 0.4) ctl.j = true;                      // a ball in the air: jump at it
    if (!c.ground && c.jumps === 1 && s > 0.8 && near && by < c.y - 30 && !onWrongSide) ctl.j = true;               // and a hard player dashes at it
    if (!c.ground) { const want = Math.atan2(by - c.y, bx - c.x); const diff = ((want - c.a + Math.PI * 3) % TAU) - Math.PI; ctl.r = diff > 0.2; ctl.l = diff < -0.2; ctl.j = ctl.j && c.jumps === 1; }
    if (c.boost > 15 && closest && !onWrongSide && Math.abs(dx) > 260 && c.ground && Math.sign(dx) === c.dir && s > 0.45) ctl.b = true;
    return ctl;
  }

  // ---- the match
  /** `ctl` maps a car id to its keys { l, r, j, b } (booleans); the computer players choose their own. */
  function step(m, ctl, dt) {
    m.t += dt;
    for (let i = 0; i < m.pads.length; i++) if (m.pads[i] > 0) m.pads[i] = Math.max(0, m.pads[i] - dt);
    if (m.state === 'over') { for (const c of m.cars) driveCar(m, c, {}, dt); stepBall(m, dt); return; }
    const frozen = m.state === 'goal' || m.state === 'countdown';
    for (const c of m.cars) driveCar(m, c, frozen ? {} : (c.bot ? think(m, c) : (ctl && ctl[c.id]) || {}), dt);
    stepBall(m, dt);
    for (const c of m.cars) hitBall(m, c);
    if (m.state === 'countdown') {
      m.stateT -= dt;
      if (m.stateT <= 0) { m.state = 'play'; m.events.push({ e: 'go' }); }
      return;
    }
    if (m.state === 'goal') {
      m.stateT -= dt;
      if (m.stateT <= 0) { if (m.winner != null) { m.state = 'over'; m.events.push({ e: 'over' }); } else kickoff(m); }
      return;
    }
    // play
    if (!m.overtime) m.clock = Math.max(0, m.clock - dt);
    const g = goalAt(m);
    if (g >= 0) {
      m.score[g]++;
      const scorer = m.cars.find((c) => c.id === m.last && c.team === g); if (scorer) scorer.goals++;
      m.events.push({ e: 'goal', team: g, by: scorer ? scorer.id : null });
      m.state = 'goal'; m.stateT = MATCH.celebrate;
      if (m.overtime) m.winner = g;
      return;
    }
    if (!m.overtime && m.clock <= 0) {
      if (m.score[0] !== m.score[1]) { m.winner = m.score[0] > m.score[1] ? 0 : 1; m.state = 'over'; m.events.push({ e: 'over' }); }
      else { m.overtime = true; m.events.push({ e: 'overtime' }); }
    }
  }

  // ---- over the network: the host runs the match and sends these; the other players only draw them
  const r1 = (v) => Math.round(v * 10) / 10;
  function snapshot(m) {
    return { s: m.state, st: r1(m.stateT), cl: Math.ceil(m.clock), ot: m.overtime ? 1 : 0, sc: m.score.slice(), w: m.winner, p: m.pads.map((v) => (v > 0 ? 1 : 0)),
             b: [r1(m.ball.x), r1(m.ball.y), r1(m.ball.vx), r1(m.ball.vy)],
             c: m.cars.map((c) => [c.id, r1(c.x), r1(c.y), r1(c.vx), r1(c.vy), Math.round(c.a * 100) / 100, Math.round(c.boost), c.boosting ? 1 : 0, c.ground ? 1 : 0, c.flip > 0 ? Math.round(c.flip * 100) / 100 : 0, c.flipDir, c.goals]) };
  }
  function applySnapshot(m, s) {
    m.state = s.s; m.stateT = s.st; m.clock = s.cl; m.overtime = !!s.ot; m.score = s.sc.slice(); m.winner = s.w == null ? null : s.w;
    m.pads = s.p.map((v) => (v ? 1 : 0));
    m.ball.x = s.b[0]; m.ball.y = s.b[1]; m.ball.vx = s.b[2]; m.ball.vy = s.b[3];
    for (const q of s.c) {
      const c = m.cars.find((k) => k.id === q[0]); if (!c) continue;
      c.x = q[1]; c.y = q[2]; c.vx = q[3]; c.vy = q[4]; c.a = q[5]; c.boost = q[6]; c.boosting = !!q[7]; c.ground = !!q[8]; c.flip = q[9]; c.flipDir = q[10]; c.goals = q[11];
    }
  }

  const api = { W, H, FLOOR, GOAL_H, GOAL_TOP, GOAL_DEPTH, BALL, CAR, PADS, MATCH, newMatch, addCar, kickoff, step, think, goalAt, snapshot, applySnapshot, carDir };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (typeof window !== 'undefined') window.NotchRocketLogic = api;
})();
