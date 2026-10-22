// Racing: a top-down car racing game for the Games tab (shared by the Windows app and the Mac app's web view).
// Three track types (a straight sprint, a curved circuit and a mixed track), three cars with different handling
// (grip, drift and muscle), computer rivals, lap times saved on this computer, and online rooms: one player makes a
// room and shares a 6-letter code, friends join with it and race together over the same live relay Battle uses.
//
//   window.NotchRaceGame.mount(hostElement) → returns a function that stops the game and cleans up.
//   window.NotchRaceGame.key(name, down), .suspend(), .resume()   (the Mac app forwards its keys this way)
(function () {
  'use strict';
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const wrapPi = (a) => { while (a > Math.PI) a -= 2 * Math.PI; while (a < -Math.PI) a += 2 * Math.PI; return a; };
  const KMH = 3.6;

  // ------------------------------------------------------------------ tracks

  /// The three kinds of track. `pts` are control points in metres (x right, y down); a closed track is a loop run for
  /// several laps, an open one is a sprint from the first point to the last.
  const TRACKS = [
    { id: 'sprint', name: 'Straight sprint', kind: 'Straight', closed: false, width: 34, laps: 1, blurb: 'A 1.6 km drag strip. Flat out, one run.',
      pts: [[0, 0], [0, -400], [0, -800], [0, -1200], [0, -1600]] },
    { id: 'circuit', name: 'Curved circuit', kind: 'Curved', closed: true, width: 34, laps: 3, blurb: 'A flowing loop of sweeping bends. Easy to drift.',
      pts: [[0, 0], [300, -30], [520, -180], [560, -420], [400, -600], [100, -640], [-180, -520], [-300, -300], [-220, -80]] },
    { id: 'mixed', name: 'Mixed track', kind: 'Mixed', closed: true, width: 32, laps: 3, blurb: 'Long straights, a hairpin, a chicane and fast sweepers.',
      pts: [[0, 0], [255, 0], [510, 0], [646, -26], [722, -110], [697, -221], [595, -280], [476, -255], [374, -306], [280, -382], [323, -484], [442, -527], [544, -595], [510, -706], [382, -748], [212, -714], [85, -646], [-51, -595], [-153, -493], [-170, -357], [-102, -255], [-119, -136], [-85, -51]] },
  ];

  /// The centre line of a track, sampled about every 4 m: position, direction, the distance along it (s) and its curvature.
  function buildTrack(def) {
    const P = def.pts, n = P.length, closed = def.closed;
    const at = (i) => closed ? P[((i % n) + n) % n] : P[clamp(i, 0, n - 1)];
    const dense = [], segs = closed ? n : n - 1;
    for (let i = 0; i < segs; i++) {
      const p0 = at(i - 1), p1 = at(i), p2 = at(i + 1), p3 = at(i + 2);
      for (let k = 0; k < 24; k++) {
        const t = k / 24, t2 = t * t, t3 = t2 * t;
        dense.push([0, 1].map((a) => 0.5 * ((2 * p1[a]) + (-p0[a] + p2[a]) * t + (2 * p0[a] - 5 * p1[a] + 4 * p2[a] - p3[a]) * t2 + (-p0[a] + 3 * p1[a] - 3 * p2[a] + p3[a]) * t3)));
      }
    }
    if (!closed) dense.push(P[n - 1].slice());
    // Resample at an even spacing.
    const step = 4, out = [dense[0]];
    let carry = 0;
    for (let i = 1; i < dense.length + (closed ? 1 : 0); i++) {
      const a = dense[i - 1], b = dense[i % dense.length];
      let d = Math.hypot(b[0] - a[0], b[1] - a[1]);
      let pos = 0;
      while (carry + (d - pos) >= step) { pos += step - carry; carry = 0; const f = pos / d; out.push([a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f]); }
      carry += d - pos;
    }
    if (closed && Math.hypot(out[out.length - 1][0] - out[0][0], out[out.length - 1][1] - out[0][1]) < step * 0.5) out.pop();
    const m = out.length, S = [];
    for (let i = 0; i < m; i++) {
      const a = out[closed ? (i - 1 + m) % m : Math.max(0, i - 1)], b = out[closed ? (i + 1) % m : Math.min(m - 1, i + 1)];
      const tx = b[0] - a[0], ty = b[1] - a[1], l = Math.hypot(tx, ty) || 1;
      S.push({ x: out[i][0], y: out[i][1], tx: tx / l, ty: ty / l, nx: -ty / l, ny: tx / l, s: i * step, k: 0 });
    }
    for (let i = 0; i < m; i++) {
      const a = S[closed ? (i - 1 + m) % m : Math.max(0, i - 1)], b = S[closed ? (i + 1) % m : Math.min(m - 1, i + 1)];
      S[i].k = wrapPi(Math.atan2(b.ty, b.tx) - Math.atan2(a.ty, a.tx)) / (closed ? 2 * step : (i === 0 || i === m - 1 ? step : 2 * step));
    }
    const length = closed ? m * step : (m - 1) * step;
    let x0 = 1e9, x1 = -1e9, y0 = 1e9, y1 = -1e9;
    for (const q of S) { x0 = Math.min(x0, q.x); x1 = Math.max(x1, q.x); y0 = Math.min(y0, q.y); y1 = Math.max(y1, q.y); }
    return { id: def.id, def, name: def.name, closed, width: def.width, laps: def.laps, S, m, step, length, bounds: [x0, y0, x1, y1] };
  }

  /// Where a point is on the track: the nearest centre-line sample (searched near `hint`, or everywhere if none), the
  /// distance along the track (s, which carries on past the ends of a sprint), and the sideways offset (+ is to the right of travel; with y pointing down the normal (−ty, tx) is the right-hand side).
  function locate(T, x, y, hint) {
    const m = T.m;
    let best = -1, bd = Infinity;
    const test = (i) => { const q = T.S[i], d = (q.x - x) * (q.x - x) + (q.y - y) * (q.y - y); if (d < bd) { bd = d; best = i; } };
    if (hint == null || hint < 0) for (let i = 0; i < m; i++) test(i);
    else for (let o = -30; o <= 30; o++) { const i = T.closed ? ((hint + o) % m + m) % m : hint + o; if (i >= 0 && i < m) test(i); }
    const q = T.S[best], dx = x - q.x, dy = y - q.y;
    return { idx: best, s: q.s + dx * q.tx + dy * q.ty, lat: dx * q.nx + dy * q.ny };
  }

  /// The start grid: row by row behind the line, two cars across.
  function gridSlot(T, slot) {
    const q = T.S[0], row = Math.floor(slot / 2), side = (slot % 2 ? 1 : -1) * T.width * 0.2;
    const back = -(10 + row * 9 + (slot % 2) * 4);
    return { x: q.x + q.tx * back + q.nx * side, y: q.y + q.ty * back + q.ny * side, h: Math.atan2(q.ty, q.tx) };
  }

  // ------------------------------------------------------------------ cars

  /// accel (m/s²), vmax (m/s), grip (sideways m/s² the tyres hold), steer (largest wheel angle, radians), loose (how much
  /// the back end lets go under power while turning).
  const CARS = [
    { id: 'gt', name: 'Street GT', blurb: 'Grippy and forgiving. Fast through the bends.', accel: 15, vmax: 66, grip: 17, steer: 0.52, loose: 0.12, brake: 30, color: '#3aa0ff' },
    { id: 'drift', name: 'Drift King', blurb: 'Lets go easily. Tap Space to slide round corners.', accel: 14, vmax: 62, grip: 12.5, steer: 0.6, loose: 0.42, brake: 26, color: '#ff4d6d' },
    { id: 'muscle', name: 'Muscle', blurb: 'Huge power and top speed. Hard to hold in the bends.', accel: 19, vmax: 74, grip: 13.5, steer: 0.48, loose: 0.3, brake: 28, color: '#ffb703' },
  ];
  const WHEELBASE = 2.8, CAR_LEN = 4.6, CAR_W = 2.0;

  function newCar(spec, x, y, h) {
    return { spec, x, y, h, vx: 0, vy: 0, yaw: 0, steerA: 0, vf: 0, vl: 0, drifting: false, onGrass: false, bump: 0 };
  }

  /// One physics step. `inp` is { throttle 0..1, brake 0..1, steer -1..1 (+ is right), hand 0/1 }. `surf` is 1 on the road, less on grass.
  function stepCar(c, inp, dt, surf = 1) {
    const sp = c.spec;
    let fx = Math.cos(c.h), fy = Math.sin(c.h);
    const vf0 = c.vx * fx + c.vy * fy;
    // Engine, brakes, reversing and drag, all along the body.
    let a = 0;
    if (inp.throttle > 0) a += sp.accel * inp.throttle * clamp(1 - (Math.max(0, vf0) / (sp.vmax * surf)) ** 2, 0, 1) * (vf0 < 0 ? 1.6 : 1);
    if (inp.brake > 0) a += vf0 > 1.5 ? -sp.brake * inp.brake : -sp.accel * 0.55 * inp.brake * clamp(1 + vf0 / 18, 0, 1);
    a -= 0.0002 * vf0 * Math.abs(vf0) + (Math.abs(vf0) > 0.2 ? 0.35 * Math.sign(vf0) : 0);
    if (surf < 1) a -= (1 - surf) * 9 * Math.sign(vf0) * Math.min(1, Math.abs(vf0) / 12);
    if (inp.hand) a -= 7 * Math.sign(vf0) * Math.min(1, Math.abs(vf0) / 8);
    c.vx += fx * a * dt; c.vy += fy * a * dt;
    // Steering: the wheel angle fades with speed. The tyres can only hold so much sideways push, which is what makes
    // the car run wide when you ask too much, and slide when the back lets go (a loose car under power, or the handbrake).
    const target = clamp(inp.steer, -1, 1) * sp.steer / (1 + (vf0 / 26) * (vf0 / 26));
    c.steerA += (target - c.steerA) * (1 - Math.exp(-dt * 9));
    const wd = vf0 * Math.tan(c.steerA) / WHEELBASE;
    const power = inp.throttle * Math.abs(c.steerA) / sp.steer;
    let grip = sp.grip * surf * (1 - sp.loose * 0.5 * power * clamp(Math.abs(vf0) / 30, 0, 1));
    let w;
    const slip = c.vl / Math.max(Math.abs(c.vf), 5);        // how far sideways the car is travelling (last step)
    if (inp.hand) { w = clamp(wd * 1.25, -2, 2); grip *= 0.3; }
    else { const wMax = grip / Math.max(Math.abs(vf0), 6), lim = wMax * (1.2 + 1.5 * sp.loose * power); w = clamp(wd, -lim, lim); }
    // Turning further into a slide is held back (the car does not spin), and with the wheel and the handbrake let go the
    // car straightens itself out along the way it is travelling.
    if (w * slip < 0 && Math.abs(slip) > 0.45) w *= clamp(1 - (Math.abs(slip) - 0.45) / 0.45, 0, 1);
    if (!inp.hand && Math.abs(vf0) > 8) w += clamp(slip, -0.6, 0.6) * 2.5 * (1 - 0.6 * sp.loose);
    c.yaw = w;
    c.h += w * dt;
    fx = Math.cos(c.h); fy = Math.sin(c.h);
    const rx = -fy, ry = fx;
    // The car's velocity stays what it was in the world; the body has turned, so some of it is now sideways.
    let vf = c.vx * fx + c.vy * fy, vl = c.vx * rx + c.vy * ry;
    // The tyres pull the sideways part away, up to their grip. The speed is kept (the velocity swings round towards the way the
    // car points); a little is scrubbed off by the sliding.
    const dv = Math.min(Math.abs(vl), grip * dt * 1.3), sp2 = vf * vf + vl * vl;
    vl -= dv * Math.sign(vl);
    vf = (vf >= 0 ? 1 : -1) * Math.sqrt(Math.max(0, sp2 - vl * vl));
    vf -= (vf >= 0 ? 1 : -1) * dv * 0.15;
    if (Math.abs(vf) < 0.05 && inp.throttle === 0 && inp.brake === 0) vf = 0;
    c.vx = fx * vf + rx * vl; c.vy = fy * vf + ry * vl;
    c.vf = vf; c.vl = vl;
    c.x += c.vx * dt; c.y += c.vy * dt;
    c.drifting = Math.abs(vl) > 3.5 && Math.abs(vf) > 14;
    c.onGrass = surf < 1;
    return c;
  }

  // ------------------------------------------------------------------ computer drivers

  /// What a computer driver does this step: steer towards a point ahead on its line, and brake for the corners it sees.
  function driveAI(T, c, st, dt) {
    const loc = locate(T, c.x, c.y, st.idx); st.idx = loc.idx;
    const speed = Math.hypot(c.vx, c.vy), look = 12 + speed * 0.5;
    const ahead = (d) => { const i = T.closed ? (loc.idx + Math.round(d / T.step)) % T.m : Math.min(T.m - 1, loc.idx + Math.round(d / T.step)); return T.S[i]; };
    const q = ahead(look), off = st.lane * T.width * 0.28;
    const px = q.x + q.nx * off, py = q.y + q.ny * off;
    const want = Math.atan2(py - c.y, px - c.x);
    const err = wrapPi(want - c.h);
    let steer = clamp(err * 2.4, -1, 1);
    // Corner speed: the slowest the road ahead lets it go at what the tyres hold.
    let vt = c.spec.vmax * st.skill;
    const gripA = c.spec.grip * 0.9 * st.skill * st.skill;
    const dec = c.spec.brake * 0.75;
    for (let d = 0; d <= 30 + speed * speed / (2 * dec); d += T.step * 2) {
      const k = Math.abs(ahead(d).k);
      if (k > 0.0005) { const vc = Math.max(14, Math.sqrt(gripA / k)); vt = Math.min(vt, Math.sqrt(vc * vc + 2 * dec * d)); }
    }
    if (loc.s < -6 && !T.closed) vt = c.spec.vmax;
    const vf = c.vf;
    const throttle = vf < vt ? clamp((vt - vf) / 6, 0.15, 1) : 0;
    const brake = vf > vt * 1.12 ? clamp((vf - vt) / 14, 0.1, 1) : 0;
    if (st.stuck > 1.5) { st.rev = 1.2; st.stuck = 0; }
    if (st.rev > 0) { st.rev -= dt; return { throttle: 0, brake: 1, steer: -steer, hand: 0 }; }
    if (speed < 2 && st.go) st.stuck += dt; else st.stuck = 0;
    return { throttle, brake, steer, hand: 0 };
  }

  // ------------------------------------------------------------------ the race

  /// One entry in a race: a car, and where it is in the race.
  function newRacer(id, name, spec, T, slot, extra) {
    const g = gridSlot(T, slot), c = newCar(spec, g.x, g.y, g.h);
    const loc = locate(T, c.x, c.y), L = T.length, sLap = T.closed ? ((loc.s % L) + L) % L : 0;
  return Object.assign({ id, name, car: c, T, lap: T.closed ? -1 : 0, sLap, prog: T.closed ? sLap - L : loc.s, finished: false, finishT: 0, lapStart: 0, lapTimes: [], bestLap: 0, idx: loc.idx, drift: 0, sNow: 0, lat: 0 }, extra || {});
  }

  /// Updates where a racer is on the track (which lap, how far in total) and whether it has finished.
  function progress(R, T, t) {
    const loc = locate(T, R.car.x, R.car.y, R.idx);
    R.idx = loc.idx; R.lat = loc.lat;
    if (T.closed) {
      const L = T.length;
      let s = ((loc.s % L) + L) % L;
      if (R.sLap > L * 0.75 && s < L * 0.25) { R.lap++; if (R.lap >= 1) { const lt = t - R.lapStart; R.lapTimes.push(lt); if (!R.bestLap || lt < R.bestLap) R.bestLap = lt; } R.lapStart = t; }
      else if (R.sLap < L * 0.25 && s > L * 0.75) R.lap--;
      R.sLap = s;
      R.prog = R.lap * L + s;
      R.sNow = s;
      if (!R.finished && R.lap >= T.laps) { R.finished = true; R.finishT = t; }
    } else {
      R.sNow = loc.s; R.prog = loc.s;
      if (!R.finished && loc.s >= T.length) { R.finished = true; R.finishT = t; }
    }
    return loc;
  }

  /// Finishers by time, then everyone else by how far they got.
  function ranking(racers) {
    return racers.slice().sort((a, b) => (a.finished && b.finished) ? a.finishT - b.finishT : a.finished ? -1 : b.finished ? 1 : b.prog - a.prog);
  }

  /// Cars bump each other: pushed apart, and the speed along the push is shared.
  function collide(a, b) {
    const dx = b.x - a.x, dy = b.y - a.y, d = Math.hypot(dx, dy), min = CAR_LEN * 0.62;
    if (d >= min || d < 1e-6) return false;
    const nx = dx / d, ny = dy / d, push = (min - d) / 2;
    a.x -= nx * push; a.y -= ny * push; b.x += nx * push; b.y += ny * push;
    const rv = (b.vx - a.vx) * nx + (b.vy - a.vy) * ny;
    if (rv < 0) { const j = -rv * 0.6; a.vx -= nx * j; a.vy -= ny * j; b.vx += nx * j; b.vy += ny * j; }
    return true;
  }

  const AI_NAMES = ['Rex', 'Nova', 'Blaze', 'Kit', 'Zed', 'Maya', 'Flash', 'Viper'];
  const AI_COLORS = ['#7bd88f', '#c77dff', '#ff9f43', '#4dd0e1', '#f06292', '#cddc39', '#ef5350', '#90a4ae'];
  const LEVELS = { easy: { skill: 0.8, label: 'Easy' }, normal: { skill: 0.9, label: 'Normal' }, hard: { skill: 0.98, label: 'Hard' } };

  // ------------------------------------------------------------------ playing with others

  const RELAY = 'wss://notchapple-rooms.adityajain1225.workers.dev';
  const NET = (() => {
    const CODE_CHARS = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
    const newCode = (rand = Math.random) => Array.from({ length: 6 }, () => CODE_CHARS[Math.floor(rand() * CODE_CHARS.length)]).join('');
    const normCode = (raw) => { const c = String(raw || '').toUpperCase().replace(/[^A-Z0-9]/g, ''); return c.length === 6 && [...c].every((ch) => CODE_CHARS.includes(ch)) ? c : null; };
    async function topicFor(code) {
      const data = new TextEncoder().encode(`notchapple-race-v1|${code}`);
      const h = new Uint8Array(await crypto.subtle.digest('SHA-256', data));
      return `notchapple-v1-${[...h.slice(0, 20)].map((b) => b.toString(16).padStart(2, '0')).join('')}`;
    }
    const r1 = (v) => Math.round(v * 10) / 10, r3 = (v) => Math.round(v * 1000) / 1000;
    const packState = (id, R) => ({ t: 's', id, x: r1(R.car.x), y: r1(R.car.y), h: r3(R.car.h), vx: r1(R.car.vx), vy: r1(R.car.vy), lap: R.lap, pr: r1(R.prog), dr: R.car.drifting ? 1 : 0 });
    class Link {
      constructor(Socket, onMessage, onState) { this.Socket = Socket; this.onMessage = onMessage; this.onState = onState; this.ws = null; this.state = 'off'; this.retry = 0; this.wantOpen = false; }
      async join(code) { this.close(); this.topic = await topicFor(code); this.wantOpen = true; this._open(); }
      _open() {
        if (!this.wantOpen) return;
        this._set('connecting');
        let ws;
        try { ws = new this.Socket(`${RELAY}/${this.topic}/ws`); } catch { this._set('failed'); return; }
        this.ws = ws;
        ws.onmessage = (e) => {
          let m; try { m = JSON.parse(typeof e.data === 'string' ? e.data : ''); } catch { return; }
          if (m && m.event === 'open') { this.retry = 0; this._set('on'); return; }
          if (m && m.t) this.onMessage(m);
        };
        ws.onclose = () => { if (this.ws !== ws) return; this.ws = null; if (!this.wantOpen) return; this._set('connecting'); this.timer = setTimeout(() => this._open(), Math.min(8000, 1000 * 2 ** this.retry++)); };
        ws.onerror = () => { /* onclose follows */ };
      }
      send(obj) { if (this.ws && this.state === 'on') { try { this.ws.send(JSON.stringify(obj)); return true; } catch { return false; } } return false; }
      close() { this.wantOpen = false; clearTimeout(this.timer); if (this.ws) { const ws = this.ws; this.ws = null; try { ws.close(); } catch { /* already closed */ } } this._set('off'); }
      _set(s) { if (this.state !== s) { this.state = s; this.onState && this.onState(s); } }
    }
    return { newCode, normCode, topicFor, packState, Link, CODE_CHARS };
  })();

  // ------------------------------------------------------------------ saved best times

  const store = {
    get(k, d) { try { const v = localStorage.getItem('race.' + k); return v == null ? d : JSON.parse(v); } catch { return d; } },
    set(k, v) { try { localStorage.setItem('race.' + k, JSON.stringify(v)); } catch { /* storage unavailable */ } },
  };
  const fmt = (t) => { if (!(t > 0)) return '–'; const m = Math.floor(t / 60), s = t - m * 60; return `${m}:${s.toFixed(2).padStart(5, '0')}`; };

  // ------------------------------------------------------------------ the game

  const CSS = `
.rc{position:absolute;inset:0;overflow:hidden;background:#173b24;color:#fff;font:600 12px system-ui,sans-serif;outline:none;user-select:none}
.rc canvas{position:absolute;inset:0;width:100%;height:100%;display:block}
.rc-ui{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;pointer-events:none}
.rc-card{pointer-events:auto;background:rgba(10,14,24,.88);border:1px solid rgba(255,255,255,.15);border-radius:12px;padding:12px 14px;max-width:94%;max-height:96%;overflow:auto;backdrop-filter:blur(6px)}
.rc-card h2{margin:0 0 6px;font-size:15px}
.rc-row{display:flex;gap:6px;flex-wrap:wrap;align-items:center;margin:5px 0}
.rc-lab{width:62px;opacity:.7;font-weight:500}
.rc-card button{font:inherit;color:#fff;background:rgba(255,255,255,.1);border:1px solid rgba(255,255,255,.18);border-radius:8px;padding:5px 9px;cursor:pointer}
.rc-card button.on{background:#5b6cff;border-color:#8a96ff}
.rc-card button.go{background:#21b36b;border-color:#4fe09a;font-weight:800}
.rc-card button:hover{filter:brightness(1.2)}
.rc-card input{font:inherit;color:#fff;background:rgba(255,255,255,.08);border:1px solid rgba(255,255,255,.2);border-radius:8px;padding:5px 8px;width:92px;text-transform:uppercase;letter-spacing:2px}
.rc-hint{opacity:.7;font-weight:500;font-size:11px;margin:3px 0}
.rc-tbl{border-collapse:collapse;margin:6px 0;min-width:220px}.rc-tbl td{padding:2px 8px}.rc-tbl tr.me{background:rgba(91,108,255,.35)}
.rc-big{position:absolute;left:0;right:0;top:26%;text-align:center;font-size:64px;font-weight:900;text-shadow:0 3px 14px rgba(0,0,0,.7);pointer-events:none}
`;

  function mount(host) {
    if (!document.getElementById('rc-style')) { const st = document.createElement('style'); st.id = 'rc-style'; st.textContent = CSS; document.head.append(st); }
    const root = document.createElement('div'); root.className = 'rc'; root.tabIndex = 0;
    const cv = document.createElement('canvas'), ui = document.createElement('div'), big = document.createElement('div');
    ui.className = 'rc-ui'; big.className = 'rc-big';
    root.append(cv, ui, big); host.replaceChildren(root);
    const g = cv.getContext('2d');

    // ---- settings kept between visits
    let trackId = store.get('track', 'circuit'), carId = store.get('car', 'gt'), lapsSel = store.get('laps', 3), rivals = store.get('rivals', 3), level = store.get('level', 'normal');
    let myName = store.get('name', ''), myId = Math.random().toString(36).slice(2, 8);
    if (!myName) { myName = 'Driver ' + Math.floor(1000 + Math.random() * 9000); store.set('name', myName); }
    const trackCache = {};
    const getTrack = (id) => trackCache[id] || (trackCache[id] = buildTrack(TRACKS.find((t) => t.id === id) || TRACKS[1]));
    const carSpec = (id) => CARS.find((c) => c.id === id) || CARS[0];

    // ---- state
    let screen = 'menu';                 // menu | lobby | countdown | race | done
    let T = getTrack(trackId), racers = [], me = null, raceLaps = 3, clock = 0, cdLeft = 0, alive = true, paused = false, suspended = false;
    const keys = new Set();
    let skids = [], camX = 0, camY = 0, shake = 0, doneT = 0;
    let net = null;                      // { link, code, host, players: Map, cfg, status }
    const aiState = new Map();

    // ---- menu and lobby screens
    const btn = (label, cls, fn) => { const b = document.createElement('button'); b.textContent = label; if (cls) b.className = cls; b.onclick = fn; return b; };
    const row = (label, ...kids) => { const r = document.createElement('div'); r.className = 'rc-row'; if (label) { const l = document.createElement('span'); l.className = 'rc-lab'; l.textContent = label; r.append(l); } r.append(...kids); return r; };
    const card = (...kids) => { const c = document.createElement('div'); c.className = 'rc-card'; c.append(...kids); ui.replaceChildren(c); return c; };
    const head = (t) => { const h = document.createElement('h2'); h.textContent = t; return h; };
    const hint = (t) => { const p = document.createElement('div'); p.className = 'rc-hint'; p.textContent = t; return p; };
    const pickers = (onChange, withLaps = true) => {
      const tracks = TRACKS.map((t) => btn(t.kind, t.id === trackId ? 'on' : '', () => { trackId = t.id; store.set('track', trackId); T = getTrack(trackId); onChange(); }));
      const cars = CARS.map((c) => btn(c.name, c.id === carId ? 'on' : '', () => { carId = c.id; store.set('car', carId); onChange(); }));
      const out = [row('Track', ...tracks), hint(TRACKS.find((t) => t.id === trackId).blurb), row('Car', ...cars), hint(carSpec(carId).blurb)];
      if (withLaps && T.closed) out.splice(2, 0, row('Laps', ...[1, 3, 5].map((n) => btn(String(n), n === lapsSel ? 'on' : '', () => { lapsSel = n; store.set('laps', n); onChange(); }))));
      return out;
    };
    const bestLine = () => { const b = store.get(`best.${trackId}.${carId}`, null); return hint(b ? `Your best here: ${b.lap ? 'lap ' + fmt(b.lap) + ' · ' : ''}race ${fmt(b.race)}` : 'No time set here yet.'); };

    function showMenu() {
      screen = 'menu'; big.textContent = ''; stopEngine();
      const name = document.createElement('input'); name.value = myName; name.maxLength = 14; name.style.width = '120px'; name.style.textTransform = 'none'; name.style.letterSpacing = '0';
      name.onchange = () => { myName = (name.value || myName).trim().slice(0, 14) || myName; store.set('name', myName); };
      const mk = (n) => btn(String(n), n === rivals ? 'on' : '', () => { rivals = n; store.set('rivals', n); showMenu(); });
      card(head('🏎️ Racing'),
        ...pickers(showMenu),
        row('Rivals', ...[0, 1, 3, 5].map(mk)),
        row('Level', ...Object.entries(LEVELS).map(([id, l]) => btn(l.label, id === level ? 'on' : '', () => { level = id; store.set('level', id); showMenu(); }))),
        bestLine(),
        row('', btn('Start race', 'go', () => startLocalRace())),
        row('Online', btn('Create room', '', () => openRoom(true)), (() => { const i = document.createElement('input'); i.placeholder = 'CODE'; i.maxLength = 8; i.id = 'rc-code'; return i; })(), btn('Join', '', () => { const c = NET.normCode(root.querySelector('#rc-code').value); if (!c) { toast('That code is 6 letters and numbers.'); return; } openRoom(false, c); })),
        row('Name', name),
        hint('↑ W gas · ↓ S brake and reverse · ← → A D steer · Space handbrake (drift) · R restart · P pause · Esc menu'));
    }

    let toastT = null;
    function toast(msg) { big.style.fontSize = '20px'; big.style.top = '8%'; big.textContent = msg; clearTimeout(toastT); toastT = setTimeout(() => { big.textContent = ''; big.style.fontSize = ''; big.style.top = ''; }, 2600); }

    // ---- starting a race
    function setupRace(entries, laps) {
      T = getTrack(trackId); raceLaps = T.closed ? laps : 1; T.laps = raceLaps;
      racers = entries.map((e, slot) => newRacer(e.id, e.name, carSpec(e.car), T, slot, { color: e.color, ai: !!e.ai, remote: !!e.remote, lastMsg: 0 }));
      me = racers.find((r) => r.id === myId) || racers[0];
      aiState.clear();
      racers.forEach((r, i) => { if (r.ai) aiState.set(r.id, { idx: -1, lane: ((i % 5) - 2) * 0.35, skill: LEVELS[level].skill * (0.94 + 0.06 * ((i * 7) % 5) / 4), stuck: 0, rev: 0, go: false }); });
      for (const r of racers) { r.car.vx = r.car.vy = 0; progress(r, T, 0); r.lapStart = 0; }
      skids = []; clock = 0; cdLeft = 3.2; screen = 'countdown'; ui.replaceChildren(); doneT = 0;
      big.style.fontSize = ''; big.style.top = '';
      startEngine();
    }
    function startLocalRace() {
      T = getTrack(trackId);
      const entries = [{ id: myId, name: myName, car: carId, color: carSpec(carId).color }];
      for (let i = 0; i < rivals; i++) entries.push({ id: 'ai' + i, name: AI_NAMES[i % AI_NAMES.length], car: CARS[(i + 1) % CARS.length].id, color: AI_COLORS[i % AI_COLORS.length], ai: true });
      // The player starts at the back of a small field, so there is someone to catch.
      entries.push(entries.shift());
      setupRace(entries, lapsSel);
    }

    // ---- online rooms
    function openRoom(host, code) {
      closeNet();
      const link = new NET.Link(window.WebSocket, onNet, (s) => { if (net) { net.status = s; if (screen === 'lobby') showLobby(); } });
      net = { link, code: code || NET.newCode(), host, players: new Map(), cfg: null, status: 'connecting', seen: new Map() };
      net.players.set(myId, { id: myId, name: myName, car: carId, host });
      link.join(net.code);
      net.hb = setInterval(hello, 2000);
      screen = 'lobby'; showLobby();
    }
    function closeNet() { if (net) { clearInterval(net.hb); net.link.close(); net = null; } }
    function hello() {
      if (!net) return;
      net.link.send({ t: 'hi', id: myId, name: myName, car: carId, host: net.host, tr: trackId, lp: lapsSel });
      const now = performance.now();
      for (const [id, seen] of net.seen) if (now - seen > 7000 && id !== myId) { net.seen.delete(id); net.players.delete(id); if (screen === 'lobby') showLobby(); }
    }
    function onNet(m) {
      if (!net || m.id === myId) return;
      if (m.t === 'hi') {
        const known = net.players.has(m.id);
        net.players.set(m.id, { id: m.id, name: String(m.name || 'Driver').slice(0, 14), car: CARS.some((c) => c.id === m.car) ? m.car : 'gt', host: !!m.host });
        net.seen.set(m.id, performance.now());
        if (m.host && !net.host && TRACKS.some((t) => t.id === m.tr) && screen === 'lobby') { trackId = m.tr; T = getTrack(trackId); lapsSel = [1, 3, 5].includes(m.lp) ? m.lp : lapsSel; }
        if (!known) { hello(); if (screen === 'lobby') showLobby(); }
        else if (screen === 'lobby') showLobby();
      } else if (m.t === 'go' && screen === 'lobby' && Array.isArray(m.order)) {
        if (!TRACKS.some((t) => t.id === m.tr)) return;
        trackId = m.tr; lapsSel = [1, 3, 5].includes(m.lp) ? m.lp : 3;
        const entries = [];
        for (const id of m.order) {
          const p = id === myId ? { id: myId, name: myName, car: carId } : net.players.get(id);
          if (p) entries.push({ id: p.id, name: p.name, car: p.car, color: id === myId ? carSpec(carId).color : AI_COLORS[entries.length % AI_COLORS.length], remote: id !== myId });
        }
        if (entries.some((e) => e.id === myId)) setupRace(entries, lapsSel);
      } else if (m.t === 's' && (screen === 'race' || screen === 'countdown' || screen === 'done')) {
        const r = racers.find((x) => x.id === m.id && x.remote); if (!r) return;
        r.net = { x: m.x, y: m.y, h: m.h, vx: m.vx, vy: m.vy, at: performance.now() };
        r.lap = m.lap; r.prog = m.pr; r.car.drifting = !!m.dr; r.lastMsg = performance.now();
      } else if (m.t === 'fin') {
        const r = racers.find((x) => x.id === m.id && x.remote); if (r && !r.finished) { r.finished = true; r.finishT = Number(m.ft) || clock; }
      }
    }
    function showLobby() {
      if (!net) return;
      const list = [...net.players.values()];
      const tbl = document.createElement('table'); tbl.className = 'rc-tbl';
      list.forEach((p) => { const tr = tbl.insertRow(); tr.className = p.id === myId ? 'me' : ''; tr.insertCell().textContent = p.name + (p.id === myId ? ' (you)' : ''); tr.insertCell().textContent = carSpec(p.car).name; tr.insertCell().textContent = p.host ? 'host' : ''; });
      const status = { connecting: 'Connecting…', on: 'Connected', failed: 'Could not connect', off: 'Offline' }[net.status] || '';
      const nodes = [head('Room ' + net.code), hint(`${status}. Share this code: friends choose Create room → Join and type it.`), tbl];
      if (net.host) { nodes.push(...pickers(showLobby)); nodes.push(row('', btn('Start race', 'go', startOnline))); } else { nodes.push(hint(`Track: ${TRACKS.find((t) => t.id === trackId).name}${T.closed ? ', ' + lapsSel + ' laps' : ''}. Waiting for the host to start.`)); nodes.push(...pickers(showLobby, false).slice(2)); }
      nodes.push(row('', btn('Leave', '', () => { closeNet(); showMenu(); })));
      card(...nodes);
    }
    function startOnline() {
      if (!net || !net.host) return;
      const order = [myId, ...[...net.players.keys()].filter((id) => id !== myId)].slice(0, 8);
      const msg = { t: 'go', id: myId, tr: trackId, lp: lapsSel, order };
      net.link.send(msg); net.link.send(msg);
      onNet({ ...msg, id: 'host' });
    }

    // ---- input
    const KEYMAP = { arrowup: 'up', w: 'up', arrowdown: 'down', s: 'down', arrowleft: 'left', a: 'left', arrowright: 'right', d: 'right', ' ': 'hand' };
    function key(name, down) {
      const k = String(name).toLowerCase();
      if (down) {
        if (k === 'p' && (screen === 'race' || screen === 'countdown')) { paused = !paused; big.textContent = paused ? 'PAUSED' : ''; return; }
        if (k === 'r' && (screen === 'race' || screen === 'done') && !net) { startLocalRace(); return; }
        if (k === 'escape' && screen !== 'menu') { closeNet(); paused = false; showMenu(); return; }
      }
      const m = KEYMAP[k]; if (m) { if (down) keys.add(m); else keys.delete(m); }
    }
    const onKd = (e) => { if (!root.isConnected || (e.target && /^(input|textarea|select)$/i.test(e.target.tagName)) || e.metaKey || e.ctrlKey) return; if (KEYMAP[e.key.toLowerCase()] && (screen === 'race' || screen === 'countdown')) e.preventDefault(); if (!e.repeat) key(e.key, true); };
    const onKu = (e) => key(e.key, false);
    window.addEventListener('keydown', onKd); window.addEventListener('keyup', onKu);
    root.addEventListener('mousedown', () => { if (!/input/i.test(document.activeElement && document.activeElement.tagName)) root.focus(); });
    const playerInput = () => ({ throttle: keys.has('up') ? 1 : 0, brake: keys.has('down') ? 1 : 0, steer: (keys.has('right') ? 1 : 0) - (keys.has('left') ? 1 : 0), hand: keys.has('hand') ? 1 : 0 });

    // ---- sound: a simple engine hum, only after the player has pressed a key (browsers need that)
    let ac = null, osc = null, gain = null;
    function startEngine() {
      try {
        if (!ac) { ac = new (window.AudioContext || window.webkitAudioContext)(); osc = ac.createOscillator(); gain = ac.createGain(); const lp = ac.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 700; osc.type = 'sawtooth'; osc.connect(lp); lp.connect(gain); gain.connect(ac.destination); gain.gain.value = 0; osc.start(); }
        if (ac.state === 'suspended') ac.resume();
      } catch { ac = null; }
    }
    function stopEngine() { if (gain && ac) gain.gain.setTargetAtTime(0, ac.currentTime, 0.1); }
    function engineTick() {
      if (!ac || !gain || !me) return;
      const v = Math.hypot(me.car.vx, me.car.vy), run = screen === 'race' || screen === 'countdown';
      osc.frequency.setTargetAtTime(48 + v * 2.4 + (keys.has('up') ? 22 : 0), ac.currentTime, 0.08);
      gain.gain.setTargetAtTime(run && !paused && !suspended ? 0.035 : 0, ac.currentTime, 0.1);
    }

    // ---- the simulation
    function update(dt) {
      if (screen === 'countdown') {
        cdLeft -= dt;
        big.textContent = cdLeft > 0 ? String(Math.ceil(cdLeft - 0.2 > 0 ? cdLeft - 0.2 : 1)) : 'GO!';
        if (cdLeft <= 0) { screen = 'race'; clock = 0; setTimeout(() => { if (screen === 'race') big.textContent = ''; }, 700); for (const s of aiState.values()) s.go = true; }
        return;
      }
      if (screen !== 'race' && screen !== 'done') return;
      clock += dt;
      for (const r of racers) {
        const c = r.car;
        if (r.remote) {
          // A friend's car glides to where it last said it was, carried on by its speed.
          if (r.net) {
            const age = Math.min(0.4, (performance.now() - r.net.at) / 1000), k = 1 - Math.exp(-dt * 9);
            const gx = r.net.x + r.net.vx * age, gy = r.net.y + r.net.vy * age;
            c.x += (gx - c.x) * k; c.y += (gy - c.y) * k; c.h += wrapPi(r.net.h - c.h) * k; c.vx = r.net.vx; c.vy = r.net.vy;
          }
          continue;
        }
        let inp;
        if (r.ai) { const st = aiState.get(r.id); if (r.finished) st.skill = 0.4; inp = driveAI(T, c, st, dt); }       // after the flag a driver cruises round
        else if (screen === 'done' || r.finished) inp = { throttle: 0, brake: 0.6, steer: 0, hand: 0 };
        else inp = playerInput();
        if (r.ai && !r.finished && me && !net) { const lead = r.prog - me.prog; if (lead < -80) inp.throttle = Math.min(1, inp.throttle * 1.05 + 0.05); }
        const loc = locate(T, c.x, c.y, r.idx);
        const edge = T.width / 2, off = Math.abs(loc.lat);
        const surf = off > edge + 1.5 ? 0.55 : 1;
        stepCar(c, inp, dt, surf);
        // An invisible wall keeps everyone near the track.
        const wall = edge + 26;
        if (off > wall) { const q = T.S[loc.idx], sgn = Math.sign(loc.lat), over = off - wall; c.x -= q.nx * sgn * over; c.y -= q.ny * sgn * over; c.vx *= 0.7; c.vy *= 0.7; if (r === me) shake = 0.5; }
        if (c.drifting && skids.length < 1400) { skids.push([c.x - Math.cos(c.h) * 1.4 - Math.sin(c.h) * 0.8, c.y - Math.sin(c.h) * 1.4 + Math.cos(c.h) * 0.8, c.h], [c.x - Math.cos(c.h) * 1.4 + Math.sin(c.h) * 0.8, c.y - Math.sin(c.h) * 1.4 - Math.cos(c.h) * 0.8, c.h]); }
        if (r === me && c.drifting) r.drift += dt * Math.abs(c.vl);
      }
      if (skids.length > 1300) skids.splice(0, skids.length - 1300);
      for (let i = 0; i < racers.length; i++) for (let j = i + 1; j < racers.length; j++) if (!racers[i].remote && !racers[j].remote) { if (collide(racers[i].car, racers[j].car) && (racers[i] === me || racers[j] === me)) shake = Math.max(shake, 0.25); }
      for (const r of racers) {
        if (r.remote) continue;
        const was = r.finished;
        progress(r, T, clock);
        if (r.finished && !was && net) net.link.send({ t: 'fin', id: myId, ft: Math.round(r.finishT * 100) / 100 });
        if (r.finished && !was && r === me) finishedMe();
      }
      if (net && screen === 'race' && me) { net.sendAcc = (net.sendAcc || 0) + dt; if (net.sendAcc > 0.1) { net.sendAcc = 0; net.link.send(NET.packState(myId, me)); } }
      if (screen === 'race' && racers.every((r) => r.finished) || (screen === 'race' && me && me.finished && racers.filter((r) => !r.remote && !r.ai).every((r) => r.finished) && clock - me.finishT > 6 && !net)) showResults();
      if (screen === 'race' && net && me && me.finished && clock - me.finishT > 14) showResults();
      if (screen === 'race' && me && me.finished && !net && clock - me.finishT > 2.5) showResults();
    }
    function finishedMe() {
      const key = `best.${trackId}.${carId}`, b = store.get(key, null) || {};
      const upd = { lap: b.lap, race: b.race };
      if (me.bestLap && (!upd.lap || me.bestLap < upd.lap)) upd.lap = me.bestLap;
      if (!upd.race || me.finishT < upd.race) { upd.race = me.finishT; me.newBest = true; }
      store.set(key, upd);
    }
    function showResults() {
      if (screen === 'done') return;
      screen = 'done'; doneT = clock; big.textContent = '';
      const order = ranking(racers), tbl = document.createElement('table'); tbl.className = 'rc-tbl';
      order.forEach((r, i) => { const tr = tbl.insertRow(); tr.className = r === me ? 'me' : ''; tr.insertCell().textContent = String(i + 1); tr.insertCell().textContent = r.name; tr.insertCell().textContent = r.finished ? fmt(r.finishT) : 'DNF'; tr.insertCell().textContent = r.bestLap ? 'best lap ' + fmt(r.bestLap) : ''; });
      const mePos = order.indexOf(me) + 1;
      card(head(mePos === 1 ? '🏆 You won!' : `You finished ${mePos}${['st', 'nd', 'rd'][mePos - 1] || 'th'}`), tbl,
        hint(`${me.newBest ? 'New best time! ' : ''}${me.drift > 1 ? 'Drift score ' + Math.round(me.drift * 10) : ''}`),
        row('', ...(net ? [btn('Back to room', 'go', () => { showLobby(); screen = 'lobby'; })] : [btn('Race again', 'go', startLocalRace)]), btn('Menu', '', () => { closeNet(); showMenu(); })));
      if (net) { screen = 'done'; }
    }

    // ---- drawing
    let W = 0, H = 0, dpr = 1;
    function resize() {
      const r = root.getBoundingClientRect(); dpr = Math.min(window.devicePixelRatio || 1, 2);
      const w = Math.max(1, Math.round(r.width * dpr)), h = Math.max(1, Math.round(r.height * dpr));
      if (w !== cv.width || h !== cv.height) { cv.width = w; cv.height = h; }
      W = w; H = h;
    }
    function draw() {
      resize();
      const v = me ? Math.hypot(me.car.vx, me.car.vy) : 0;
      const view = (screen === 'menu' || screen === 'lobby' || !me) ? null : me;
      let cx, cy;
      if (view) { cx = view.car.x + view.car.vx * 0.35; cy = view.car.y + view.car.vy * 0.35; } else { const t = Date.now() / 1000; const q = T.S[Math.floor((t * 12) % T.m)]; cx = q.x; cy = q.y; }
      camX += (cx - camX) * (view ? 0.2 : 0.08); camY += (cy - camY) * (view ? 0.2 : 0.08);
      const sc = Math.min(W, H) / (80 + (view ? 0.9 * v : 20));
      const sx = shake > 0 ? (Math.random() - 0.5) * shake * 8 * dpr : 0, sy = shake > 0 ? (Math.random() - 0.5) * shake * 8 * dpr : 0;
      g.setTransform(1, 0, 0, 1, 0, 0);
      g.fillStyle = '#1e4a2c'; g.fillRect(0, 0, W, H);
      g.setTransform(sc, 0, 0, sc, W / 2 - camX * sc + sx, H / 2 - camY * sc + sy);
      // Grass stripes, so speed shows even off the road.
      g.strokeStyle = 'rgba(255,255,255,.045)'; g.lineWidth = 1 / sc * 1.5;
      const gs = 40, gx0 = Math.floor((camX - W / sc) / gs) * gs, gx1 = camX + W / sc, gy0 = Math.floor((camY - H / sc) / gs) * gs, gy1 = camY + H / sc;
      g.beginPath(); for (let x = gx0; x < gx1; x += gs) { g.moveTo(x, gy0); g.lineTo(x, gy1); } for (let y = gy0; y < gy1; y += gs) { g.moveTo(gx0, y); g.lineTo(gx1, y); } g.stroke();
      // The road.
      const path = () => { g.beginPath(); T.S.forEach((q, i) => i ? g.lineTo(q.x, q.y) : g.moveTo(q.x, q.y)); if (T.closed) g.closePath(); };
      g.lineJoin = 'round'; g.lineCap = 'butt';
      path(); g.strokeStyle = '#e8e8e8'; g.lineWidth = T.width + 3; g.stroke();
      path(); g.strokeStyle = '#3a3d44'; g.lineWidth = T.width; g.stroke();
      path(); g.strokeStyle = 'rgba(255,255,255,.55)'; g.lineWidth = 0.8; g.setLineDash([6, 10]); g.stroke(); g.setLineDash([]);
      // Start / finish line, chequered.
      const drawLine = (s, col) => { const q = T.S[Math.max(0, Math.min(T.m - 1, Math.round(s / T.step)))], n = 8, w = T.width / n; for (let i = 0; i < n; i++) for (let j = 0; j < 2; j++) { g.fillStyle = (i + j) % 2 ? '#111' : col; const o = -T.width / 2 + i * w; g.save(); g.translate(q.x + q.nx * (o + w / 2), q.y + q.ny * (o + w / 2)); g.rotate(Math.atan2(q.ty, q.tx)); g.fillRect(j * 2 - 2, -w / 2, 2, w); g.restore(); } };
      drawLine(0, '#fff'); if (!T.closed) drawLine(T.length, '#fff');
      // Skid marks.
      g.fillStyle = 'rgba(15,15,15,.45)';
      for (const s of skids) { g.save(); g.translate(s[0], s[1]); g.rotate(s[2]); g.fillRect(-0.7, -0.25, 1.6, 0.5); g.restore(); }
      // Cars, the player on top.
      const drawn = racers.slice().sort((a, b) => (a === me) - (b === me));
      for (const r of drawn) {
        const c = r.car; g.save(); g.translate(c.x, c.y); g.rotate(c.h);
        g.fillStyle = 'rgba(0,0,0,.35)'; g.fillRect(-CAR_LEN / 2 + 0.4, -CAR_W / 2 + 0.5, CAR_LEN, CAR_W);
        g.fillStyle = r.color || r.car.spec.color; g.beginPath(); g.roundRect(-CAR_LEN / 2, -CAR_W / 2, CAR_LEN, CAR_W, 0.6); g.fill();
        g.fillStyle = 'rgba(20,28,40,.85)'; g.fillRect(-0.9, -CAR_W / 2 + 0.3, 1.8, CAR_W - 0.6);
        g.fillStyle = '#fff6c2'; g.fillRect(CAR_LEN / 2 - 0.5, -CAR_W / 2 + 0.2, 0.5, 0.45); g.fillRect(CAR_LEN / 2 - 0.5, CAR_W / 2 - 0.65, 0.5, 0.45);
        if (keys.has('down') && r === me) { g.fillStyle = '#ff2b2b'; g.fillRect(-CAR_LEN / 2, -CAR_W / 2 + 0.2, 0.4, 0.5); g.fillRect(-CAR_LEN / 2, CAR_W / 2 - 0.7, 0.4, 0.5); }
        g.restore();
        if (r !== me) { g.fillStyle = '#fff'; g.font = '3.2px system-ui'; g.textAlign = 'center'; g.fillText(r.name, c.x, c.y - 3); }
      }
      g.setTransform(1, 0, 0, 1, 0, 0);
      if (view) drawHud();
    }
    function drawHud() {
      const s = Math.min(W, H) / 400, order = ranking(racers), pos = order.indexOf(me) + 1;
      g.textAlign = 'left'; g.fillStyle = 'rgba(8,12,22,.6)';
      g.beginPath(); g.roundRect(8 * s, 8 * s, 138 * s, 64 * s, 8 * s); g.fill();
      g.fillStyle = '#fff'; g.font = `800 ${24 * s}px system-ui`;
      g.fillText(`${pos}`, 16 * s, 40 * s); g.font = `600 ${11 * s}px system-ui`; g.fillStyle = 'rgba(255,255,255,.7)'; g.fillText(`/ ${racers.length}`, 34 * s, 40 * s);
      g.fillStyle = '#fff'; g.font = `700 ${12 * s}px system-ui`;
      g.fillText(T.closed ? `Lap ${clamp(me.lap + 1, 1, raceLaps)}/${raceLaps}` : `${Math.round(clamp(me.prog, 0, T.length))} / ${Math.round(T.length)} m`, 16 * s, 58 * s);
      g.textAlign = 'right'; g.font = `700 ${13 * s}px system-ui`; g.fillText(screen === 'countdown' ? '0:00.00' : fmt(me.finished ? me.finishT : clock), 138 * s, 28 * s);
      g.font = `500 ${10 * s}px system-ui`; g.fillStyle = 'rgba(255,255,255,.7)'; g.fillText(me.bestLap ? 'best ' + fmt(me.bestLap) : '', 138 * s, 58 * s);
      // Speed.
      const kmh = Math.round(Math.hypot(me.car.vx, me.car.vy) * KMH);
      g.fillStyle = 'rgba(8,12,22,.6)'; g.beginPath(); g.roundRect(W - 120 * s, H - 56 * s, 112 * s, 48 * s, 8 * s); g.fill();
      g.fillStyle = '#fff'; g.textAlign = 'right'; g.font = `800 ${26 * s}px system-ui`; g.fillText(String(kmh), W - 44 * s, H - 22 * s);
      g.font = `600 ${10 * s}px system-ui`; g.fillStyle = 'rgba(255,255,255,.7)'; g.textAlign = 'left'; g.fillText('km/h', W - 40 * s, H - 22 * s);
      if (me.car.drifting) { g.fillStyle = '#ffd166'; g.font = `900 ${14 * s}px system-ui`; g.textAlign = 'center'; g.fillText(`DRIFT  ${Math.round(me.drift * 10)}`, W / 2, H - 16 * s); }
      if (me.car.onGrass) { g.fillStyle = '#ff9f43'; g.font = `800 ${12 * s}px system-ui`; g.textAlign = 'center'; g.fillText('OFF TRACK', W / 2, 24 * s); }
      // Minimap.
      const mw = 96 * s, mh = 96 * s, mx = W - mw - 8 * s, my = 8 * s, [x0, y0, x1, y1] = T.bounds, k = Math.min((mw - 12 * s) / (x1 - x0 || 1), (mh - 12 * s) / (y1 - y0 || 1));
      const mp = (x, y) => [mx + 6 * s + (x - x0) * k + ((mw - 12 * s) - (x1 - x0) * k) / 2, my + 6 * s + (y - y0) * k + ((mh - 12 * s) - (y1 - y0) * k) / 2];
      g.fillStyle = 'rgba(8,12,22,.6)'; g.beginPath(); g.roundRect(mx, my, mw, mh, 8 * s); g.fill();
      g.strokeStyle = 'rgba(255,255,255,.8)'; g.lineWidth = 2 * s; g.beginPath(); T.S.forEach((q, i) => { const p = mp(q.x, q.y); i ? g.lineTo(p[0], p[1]) : g.moveTo(p[0], p[1]); }); if (T.closed) g.closePath(); g.stroke();
      for (const r of racers) { const p = mp(r.car.x, r.car.y); g.fillStyle = r === me ? '#fff' : (r.color || '#aaa'); g.beginPath(); g.arc(p[0], p[1], (r === me ? 3.6 : 2.6) * s, 0, 7); g.fill(); }
    }

    // ---- the loop
    let raf = 0, last = performance.now();
    function frame(t) {
      if (!alive) return;
      raf = requestAnimationFrame(frame);
      const dt = Math.min(0.05, (t - last) / 1000); last = t;
      if (suspended) return;
      if (!paused) { let left = dt; while (left > 1e-4) { const h = Math.min(left, 1 / 120); update(h); left -= h; } if (shake > 0) shake = Math.max(0, shake - dt * 2.5); }
      draw(); engineTick();
    }
    showMenu();
    raf = requestAnimationFrame(frame);

    const api = {
      key, suspend() { suspended = true; stopEngine(); }, resume() { suspended = false; last = performance.now(); },
      _state: () => ({ screen, racers, me, T, clock, net }),
    };
    window.NotchRaceGame.current = api;
    return function stop() {
      alive = false; cancelAnimationFrame(raf); closeNet(); stopEngine();
      window.removeEventListener('keydown', onKd); window.removeEventListener('keyup', onKu);
      try { if (ac) ac.close(); } catch { /* already closed */ }
      if (window.NotchRaceGame.current === api) window.NotchRaceGame.current = null;
      root.remove();
    };
  }

  window.NotchRaceGame = {
    mount,
    key: (k, down) => { const c = window.NotchRaceGame.current; if (c) c.key(k, down); },
    suspend: () => { const c = window.NotchRaceGame.current; if (c) c.suspend(); },
    resume: () => { const c = window.NotchRaceGame.current; if (c) c.resume(); },
    current: null,
    _test: { TRACKS, CARS, buildTrack, locate, gridSlot, newCar, stepCar, driveAI, newRacer, progress, ranking, collide, NET, fmt, LEVELS },
  };
})();
