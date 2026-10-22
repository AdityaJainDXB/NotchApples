// Capture the Flag: the rules and the computer players, with no screen. The arena, movement and collisions, shooting,
// flags (pick up, carry, drop, return, capture), and bots that attack, defend and fight. Shared by the Mac and Windows apps
// (the game itself is ctf.js) and tested in Node (NotchWindows/tests/ctf.test.mjs).
//
// Metres and seconds; x to the right, y down the screen. Team 0 is Blue (starts on the left), team 1 is Red (on the right).
(function () {
  'use strict';
  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
  const TAU = Math.PI * 2;
  const wrap = (a) => { a %= TAU; if (a > Math.PI) a -= TAU; if (a < -Math.PI) a += TAU; return a; };

  // ---- the arena
  const ARENA = { w: 200, h: 120 };                        // x from -100 to 100, y from -60 to 60
  const BASE_X = 84, CAPTURE_R = 5, PICKUP_R = 2.6, RETURN_AFTER = 14;
  const SPAWN = (team, i, n) => ({ x: (team === 0 ? -1 : 1) * (BASE_X + 6), y: (i - (n - 1) / 2) * 7 });
  const STAND = (team) => ({ x: (team === 0 ? -1 : 1) * BASE_X, y: 0 });
  /// Walls and crates (x, y of the top left corner, then width and height), the same on both sides of the middle.
  const HALF = [[-8, -8, 16, 16], [-46, -30, 10, 10], [-46, 20, 10, 10], [-62, -8, 4, 16], [-76, -34, 3, 20], [-76, 14, 3, 20], [-30, -5, 4, 10]];
  const WALLS = (() => {
    const w = [];
    for (const [x, y, ww, hh] of HALF) { w.push({ x, y, w: ww, h: hh }); if (!(x === -8 && y === -8)) w.push({ x: -x - ww, y, w: ww, h: hh }); }
    return w;
  })();

  const PLAYER = { r: 1.1, hp: 100, speed: 11.5, carrySpeed: 12.6, fireGap: 0.12, dmg: 8, bullet: 88, range: 78, spread: 0.035, respawn: 4, shield: 2 };

  // ---- collision
  /// Pushes a circle out of the walls and the arena edge; returns the new position.
  function slide(x, y, r) {
    x = clamp(x, -ARENA.w / 2 + r, ARENA.w / 2 - r); y = clamp(y, -ARENA.h / 2 + r, ARENA.h / 2 - r);
    for (const b of WALLS) {
      const cx = clamp(x, b.x, b.x + b.w), cy = clamp(y, b.y, b.y + b.h), dx = x - cx, dy = y - cy, d2 = dx * dx + dy * dy;
      if (d2 < r * r) {
        if (d2 > 1e-9) { const d = Math.sqrt(d2), k = (r - d) / d; x += dx * k; y += dy * k; }
        else { const l = x - b.x, rr = b.x + b.w - x, t = y - b.y, bb = b.y + b.h - y, m = Math.min(l, rr, t, bb); if (m === l) x = b.x - r; else if (m === rr) x = b.x + b.w + r; else if (m === t) y = b.y - r; else y = b.y + b.h + r; }
      }
    }
    return { x, y };
  }
  /// Whether a straight line from a to b is clear of the walls (for seeing someone, and for a bullet's flight).
  function clear(ax, ay, bx, by) {
    const dx = bx - ax, dy = by - ay;
    for (const b of WALLS) {
      let t0 = 0, t1 = 1;
      for (const [p, q, lo, hi] of [[dx, ax, b.x, b.x + b.w], [dy, ay, b.y, b.y + b.h]]) {
        if (Math.abs(p) < 1e-9) { if (q < lo || q > hi) { t0 = 2; break; } }
        else { let a = (lo - q) / p, c = (hi - q) / p; if (a > c) [a, c] = [c, a]; t0 = Math.max(t0, a); t1 = Math.min(t1, c); if (t0 > t1) break; }
      }
      if (t0 <= t1 && t0 <= 1) return false;
    }
    return true;
  }
  /// How far a bullet fired from (x, y) along (dx, dy) goes before it hits a wall (or `max`).
  function rayLength(x, y, dx, dy, max) {
    let best = max;
    for (const b of WALLS) {
      let t0 = 0, t1 = max, miss = false;
      for (const [p, q, lo, hi] of [[dx, x, b.x, b.x + b.w], [dy, y, b.y, b.y + b.h]]) {
        if (Math.abs(p) < 1e-9) { if (q < lo || q > hi) { miss = true; break; } }
        else { let a = (lo - q) / p, c = (hi - q) / p; if (a > c) [a, c] = [c, a]; t0 = Math.max(t0, a); t1 = Math.min(t1, c); if (t0 > t1) { miss = true; break; } }
      }
      if (!miss && t0 < best) best = t0;
    }
    return best;
  }

  // ---- paths: a coarse grid with A*, so the computer players get round the walls
  const CELL = 3, GW = Math.ceil(ARENA.w / CELL), GH = Math.ceil(ARENA.h / CELL);
  const cellOf = (x, y) => [clamp(Math.floor((x + ARENA.w / 2) / CELL), 0, GW - 1), clamp(Math.floor((y + ARENA.h / 2) / CELL), 0, GH - 1)];
  const centre = (cx, cy) => ({ x: cx * CELL - ARENA.w / 2 + CELL / 2, y: cy * CELL - ARENA.h / 2 + CELL / 2 });
  const BLOCKED = (() => {
    const g = new Uint8Array(GW * GH);
    for (let cy = 0; cy < GH; cy++) for (let cx = 0; cx < GW; cx++) { const c = centre(cx, cy), s = slide(c.x, c.y, 1.7); if (Math.hypot(s.x - c.x, s.y - c.y) > 0.2) g[cy * GW + cx] = 1; }
    return g;
  })();
  /// A list of points to walk through from (sx, sy) to (tx, ty), or an empty list if there is no way.
  function findPath(sx, sy, tx, ty) {
    if (clear(sx, sy, tx, ty) && !blockedLine(sx, sy, tx, ty)) return [{ x: tx, y: ty }];
    const [s0x, s0y] = cellOf(sx, sy), [t0x, t0y] = cellOf(tx, ty);
    const start = nearestFree(s0x, s0y), goal = nearestFree(t0x, t0y);
    if (!start || !goal) return [];
    const idx = (x, y) => y * GW + x, open = [[0, idx(start[0], start[1])]], came = new Map(), g = new Map([[idx(start[0], start[1]), 0]]), seen = new Set();
    const h = (x, y) => Math.hypot(x - goal[0], y - goal[1]);
    let found = false;
    while (open.length) {
      let bi = 0; for (let i = 1; i < open.length; i++) if (open[i][0] < open[bi][0]) bi = i;
      const [, cur] = open.splice(bi, 1)[0]; if (seen.has(cur)) continue; seen.add(cur);
      const cx = cur % GW, cy = (cur - cx) / GW;
      if (cx === goal[0] && cy === goal[1]) { found = true; break; }
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        if (!dx && !dy) continue; const nx = cx + dx, ny = cy + dy; if (nx < 0 || ny < 0 || nx >= GW || ny >= GH || BLOCKED[idx(nx, ny)]) continue;
        if (dx && dy && (BLOCKED[idx(cx + dx, cy)] || BLOCKED[idx(cx, cy + dy)])) continue;
        const ng = g.get(cur) + (dx && dy ? 1.414 : 1); const ni = idx(nx, ny);
        if (ng < (g.has(ni) ? g.get(ni) : Infinity)) { g.set(ni, ng); came.set(ni, cur); open.push([ng + h(nx, ny), ni]); }
      }
    }
    if (!found) return [];
    const cells = []; for (let c = idx(goal[0], goal[1]); c !== undefined; c = came.get(c)) cells.push(c);
    cells.reverse();
    // Keep every fourth point and the end, then try to cut corners.
    const pts = cells.map((c) => centre(c % GW, Math.floor(c / GW)));
    const out = []; let from = { x: sx, y: sy }, i = 0;
    while (i < pts.length) { let j = pts.length - 1; while (j > i && (blockedLine(from.x, from.y, pts[j].x, pts[j].y) || !clear(from.x, from.y, pts[j].x, pts[j].y))) j--; out.push(pts[j]); from = pts[j]; i = j + 1; }
    if (out.length) out[out.length - 1] = { x: tx, y: ty };
    return out;
  }
  function blockedLine(ax, ay, bx, by) {
    const n = Math.ceil(Math.hypot(bx - ax, by - ay) / 1.5);
    for (let i = 0; i <= n; i++) { const t = n ? i / n : 0, [cx, cy] = cellOf(ax + (bx - ax) * t, ay + (by - ay) * t); if (BLOCKED[cy * GW + cx]) return true; }
    return false;
  }
  function nearestFree(cx, cy) {
    if (!BLOCKED[cy * GW + cx]) return [cx, cy];
    for (let r = 1; r < 8; r++) for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) { const x = cx + dx, y = cy + dy; if (x >= 0 && y >= 0 && x < GW && y < GH && !BLOCKED[y * GW + x]) return [x, y]; }
    return null;
  }

  // ---- the match
  function newMatch(opts = {}) {
    const m = { t: 0, score: [0, 0], to: opts.to || 3, limit: opts.limit || 300, winner: -1, over: false, players: [], bullets: [], feed: [], events: [],
      flags: [0, 1].map((team) => ({ team, state: 'home', x: STAND(team).x, y: STAND(team).y, carrier: null, droppedAt: 0 })), nextBullet: 1 };
    return m;
  }
  function addPlayer(m, o) {
    const team = o.team, mates = m.players.filter((p) => p.team === team).length;
    const p = { id: o.id, name: o.name || 'Player', team, bot: !!o.bot, x: 0, y: 0, a: team === 0 ? 0 : Math.PI, vx: 0, vy: 0, hp: PLAYER.hp, alive: true, respawnT: 0, shield: 0, fireT: 0, carrying: -1, kills: 0, deaths: 0, caps: 0, skill: o.skill == null ? 0.6 : o.skill, lane: Math.random() < 0.5 ? -44 : 44, role: o.role || (mates % 2 === 0 ? 'attack' : 'defend'),
      path: [], pathT: 0, think: Math.random(), strafe: Math.random() < 0.5 ? 1 : -1, strafeT: 0, firing: false };
    m.players.push(p); spawn(m, p, mates, mates + 1); return p;
  }
  function spawn(m, p, i = 0, n = 1) {
    const s = SPAWN(p.team, i % 6, Math.max(n, Math.min(6, m.players.filter((q) => q.team === p.team).length)));
    p.x = s.x; p.y = s.y + (Math.random() - 0.5) * 3; p.hp = PLAYER.hp; p.alive = true; p.shield = PLAYER.shield; p.respawnT = 0; p.carrying = -1; p.a = p.team === 0 ? 0 : Math.PI; p.vx = p.vy = 0;
  }
  const other = (team) => 1 - team;
  /// A player moves: `dir` is a wish (-1..1 each way), and the speed is lower while carrying the flag.
  function move(m, p, dx, dy, dt) {
    const len = Math.hypot(dx, dy); if (len > 1) { dx /= len; dy /= len; }
    const sp = p.carrying >= 0 ? PLAYER.carrySpeed : PLAYER.speed;
    const k = Math.min(1, dt * 14); p.vx += (dx * sp - p.vx) * k; p.vy += (dy * sp - p.vy) * k;
    const s = slide(p.x + p.vx * dt, p.y + p.vy * dt, PLAYER.r); p.x = s.x; p.y = s.y;
  }
  /// One shot from a player. Returns the bullet (or null when it is too soon).
  function fire(m, p, aim) {
    if (!p.alive || p.fireT > 0) return null;
    p.fireT = PLAYER.fireGap;
    const a = (aim == null ? p.a : aim) + (Math.random() - 0.5) * 2 * (PLAYER.spread + Math.hypot(p.vx, p.vy) * 0.0016);
    const b = { id: m.nextBullet++, owner: p.id, team: p.team, x: p.x + Math.cos(a) * 1.4, y: p.y + Math.sin(a) * 1.4, dx: Math.cos(a), dy: Math.sin(a), t: 0, life: PLAYER.range / PLAYER.bullet, dmg: PLAYER.dmg };
    m.bullets.push(b); return b;
  }
  function stepBullets(m, dt, onHit) {
    for (const b of m.bullets) {
      const nx = b.x + b.dx * PLAYER.bullet * dt, ny = b.y + b.dy * PLAYER.bullet * dt;
      if (!clear(b.x, b.y, nx, ny) || Math.abs(nx) > ARENA.w / 2 || Math.abs(ny) > ARENA.h / 2) { b.dead = true; continue; }
      for (const p of m.players) {
        if (!p.alive || p.team === b.team || p.shield > 0) continue;
        // The closest the bullet's path gets to the player this step.
        const sx = nx - b.x, sy = ny - b.y, l2 = sx * sx + sy * sy || 1e-9, t = clamp(((p.x - b.x) * sx + (p.y - b.y) * sy) / l2, 0, 1), cx = b.x + sx * t, cy = b.y + sy * t;
        if (Math.hypot(p.x - cx, p.y - cy) < PLAYER.r + 0.25) { b.dead = true; onHit && onHit(b, p); break; }
      }
      b.x = nx; b.y = ny; b.t += dt; if (b.t > b.life) b.dead = true;
    }
    m.bullets = m.bullets.filter((b) => !b.dead);
  }
  /// A player is hit: damage, and if it kills, a drop of the flag, the score of kills and a respawn.
  function damage(m, p, amount, by) {
    if (!p.alive || p.shield > 0) return false;
    p.hp -= p.carrying >= 0 ? amount * 0.55 : amount;      // the flag is heavy but so is the guard round it: a carrier takes less damage
    if (p.hp > 0) return false;
    p.alive = false; p.hp = 0; p.deaths++; p.respawnT = PLAYER.respawn;
    const killer = m.players.find((q) => q.id === by); if (killer && killer.team !== p.team) killer.kills++;
    if (p.carrying >= 0) dropFlag(m, p);
    m.feed.unshift({ t: m.t, text: `${killer ? killer.name : 'Someone'} ▸ ${p.name}`, team: killer ? killer.team : -1 }); m.feed.length = Math.min(m.feed.length, 5);
    m.events.push({ k: 'kill', victim: p.id, by });
    return true;
  }
  function dropFlag(m, p) {
    const f = m.flags[p.carrying]; f.state = 'dropped'; f.carrier = null; f.x = p.x; f.y = p.y; f.droppedAt = m.t; p.carrying = -1;
    m.events.push({ k: 'drop', team: f.team, by: p.id });
  }
  const returnFlag = (m, f, by) => { f.state = 'home'; f.carrier = null; f.x = STAND(f.team).x; f.y = STAND(f.team).y; m.events.push({ k: 'return', team: f.team, by }); };
  /// The flags: picking up, capturing, returning. Run by whoever runs the match (the host, or a solo game).
  function stepFlags(m) {
    for (const p of m.players) {
      if (!p.alive) continue;
      const mine = m.flags[p.team], theirs = m.flags[other(p.team)];
      // Take the other team's flag.
      if (theirs.state !== 'carried' && p.carrying < 0 && Math.hypot(p.x - theirs.x, p.y - theirs.y) < PICKUP_R) { theirs.state = 'carried'; theirs.carrier = p.id; p.carrying = theirs.team; m.events.push({ k: 'take', team: theirs.team, by: p.id }); }
      // Touch your own dropped flag: it goes home.
      if (mine.state === 'dropped' && Math.hypot(p.x - mine.x, p.y - mine.y) < PICKUP_R) returnFlag(m, mine, p.id);
      // Bring the enemy flag to your own stand, with your own flag at home.
      if (p.carrying >= 0 && mine.state === 'home' && Math.hypot(p.x - STAND(p.team).x, p.y - STAND(p.team).y) < CAPTURE_R) {
        const f = m.flags[p.carrying]; returnFlag(m, f, p.id); p.carrying = -1; p.caps++; m.score[p.team]++;
        m.events.push({ k: 'capture', team: p.team, by: p.id }); m.feed.unshift({ t: m.t, text: `${p.name} captured the flag!`, team: p.team }); m.feed.length = Math.min(m.feed.length, 5);
        if (m.score[p.team] >= m.to) { m.over = true; m.winner = p.team; m.events.push({ k: 'end', winner: p.team }); }
      }
    }
    for (const f of m.flags) {
      if (f.state === 'carried') { const c = m.players.find((q) => q.id === f.carrier); if (!c || !c.alive) { if (c && c.carrying >= 0) dropFlag(m, c); else returnFlag(m, f, null); } else { f.x = c.x; f.y = c.y; } }
      else if (f.state === 'dropped' && m.t - f.droppedAt > RETURN_AFTER) returnFlag(m, f, null);
    }
  }
  /// Time passes in the match: timers, respawns, the end by time.
  /// `o.client` is for a player who is not running the match (an online guest): timers only, the host decides the flags and the end.
  function tick(m, dt, o = {}) {
    if (m.over) return;
    m.t += dt;
    for (const p of m.players) {
      if (o.only && p !== o.only && !p.bot) continue;
      p.fireT = Math.max(0, p.fireT - dt); p.shield = Math.max(0, p.shield - dt);
      if (!p.alive) { p.respawnT -= dt; if (p.respawnT <= 0) { spawn(m, p); if (o.onSpawn) o.onSpawn(p); } }
    }
    if (o.client) return;
    stepFlags(m);
    if (!m.over && m.t >= m.limit) { m.over = true; m.winner = m.score[0] === m.score[1] ? -1 : m.score[0] > m.score[1] ? 0 : 1; m.events.push({ k: 'end', winner: m.winner }); }
  }

  // ---- the computer players
  /// What a bot does this step: it moves, aims and fires. Returns { dx, dy, aim, shoot }.
  function think(m, p, dt) {
    const enemies = m.players.filter((q) => q.alive && q.team !== p.team), mine = m.flags[p.team], theirs = m.flags[other(p.team)];
    p.think -= dt; p.strafeT -= dt; p.pathT -= dt;
    // Who to shoot: the closest enemy it can see (the one carrying the flag counts for more).
    let target = null, bestD = 60;
    for (const q of enemies) { const d = Math.hypot(q.x - p.x, q.y - p.y) - (q.carrying >= 0 ? 20 : 0); if (d < bestD && clear(p.x, p.y, q.x, q.y)) { bestD = d; target = q; } }
    // Where to go.
    let goal;
    if (p.carrying >= 0) {
      goal = STAND(p.team);
      const farSide = p.team === 0 ? p.x > 14 : p.x < -14;
      if (farSide) goal = { x: 0, y: p.lane };            // home by the side, away from the middle
    }
    else if (mine.state === 'carried') { const c = m.players.find((q) => q.id === mine.carrier); goal = c ? { x: c.x, y: c.y } : STAND(p.team); }                  // chase the thief
    else if (mine.state === 'dropped' && (p.role === 'defend' || Math.hypot(mine.x - p.x, mine.y - p.y) < 40)) goal = { x: mine.x, y: mine.y };
    else if (p.role === 'attack') {
      goal = theirs.state === 'carried' && theirs.carrier !== p.id ? STAND(other(p.team)) : { x: theirs.x, y: theirs.y };
      // Go round the sides rather than through the middle where the fighting is.
      const ownSide = p.team === 0 ? p.x < -14 : p.x > 14, farSide = p.team === 0 ? goal.x > 14 : goal.x < -14;
      if (ownSide && farSide) goal = { x: 0, y: p.lane };
    }
    else goal = { x: STAND(p.team).x + (p.team === 0 ? 20 : -20), y: Math.sin(m.t * 0.5 + p.name.length) * 22 };                       // guard: patrol near the stand
    if (target && p.carrying < 0 && p.role === 'defend' && bestD < 40) goal = { x: target.x, y: target.y };
    if (p.pathT <= 0 || !p.path.length) { p.path = findPath(p.x, p.y, goal.x, goal.y); p.pathT = 0.5 + Math.random() * 0.3; }
    while (p.path.length && Math.hypot(p.path[0].x - p.x, p.path[0].y - p.y) < 2.2) p.path.shift();
    let dx = 0, dy = 0;
    if (p.path.length) { const t = p.path[0], d = Math.hypot(t.x - p.x, t.y - p.y) || 1; dx = (t.x - p.x) / d; dy = (t.y - p.y) / d; }
    // Fighting: face the target, strafe a little, and stop moving in close if defending.
    let aim = p.path.length ? Math.atan2(dy, dx) : p.a, shoot = false;
    if (target) {
      const lead = Math.hypot(target.x - p.x, target.y - p.y) / PLAYER.bullet;
      const tx = target.x + target.vx * lead * 0.8, ty = target.y + target.vy * lead * 0.8;
      aim = Math.atan2(ty - p.y, tx - p.x) + (Math.random() - 0.5) * (1.05 - p.skill) * 0.9 * (0.7 + Math.hypot(target.x - p.x, target.y - p.y) / 35);
      shoot = Math.abs(wrap(aim - p.a)) < 0.7 && (p.carrying < 0 || bestD < 12);      // a carrier runs rather than stops to shoot
      if (p.strafeT <= 0) { p.strafe = -p.strafe; p.strafeT = 0.5 + Math.random(); }
      if (p.carrying < 0) { dx += Math.cos(aim + Math.PI / 2) * p.strafe * 0.7; dy += Math.sin(aim + Math.PI / 2) * p.strafe * 0.7; }
      if (p.role === 'defend' && bestD < 14) { dx *= 0.2; dy *= 0.2; }
    }
    // Turn towards the aim at a human sort of speed.
    p.a = wrap(p.a + clamp(wrap(aim - p.a), -1, 1) * Math.min(1, dt * (5 + 6 * p.skill)));
    return { dx, dy, aim: p.a, shoot };
  }
  /// One step for a whole match with its computer players (used by solo games and by the host of an online one).
  function step(m, dt) {
    for (const p of m.players) {
      if (!p.alive || !p.bot) continue;
      const a = think(m, p, dt); move(m, p, a.dx, a.dy, dt);
      p.firing = a.shoot && p.skill > 0.2; if (p.firing && fire(m, p, p.a)) p.fireT = 0.34 - 0.12 * p.skill;       // computer players fire slower than a person can
    }
    stepBullets(m, dt, (b, v) => damage(m, v, b.dmg, b.owner));
    tick(m, dt);
  }

  const api = { ARENA, WALLS, PLAYER, BASE_X, CAPTURE_R, PICKUP_R, RETURN_AFTER, STAND, SPAWN, slide, clear, rayLength, findPath, newMatch, addPlayer, spawn, move, fire, stepBullets, damage, stepFlags, tick, think, step, wrap, other, blockedAt: (x, y) => { const [cx, cy] = cellOf(x, y); return !!BLOCKED[cy * GW + cx]; } };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (typeof window !== 'undefined') window.NotchCtfLogic = api;
})();
