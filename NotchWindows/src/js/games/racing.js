// Racing: a car racing game for the Games tab (shared by the Windows app and the Mac app's web view).
// Twelve premade tracks and your own from the track designer (draw it with the mouse, drive it at once, save it, share it as a
// code), seven cars from a hot hatch to a Formula One car (each with its own gearbox, engine note, grip and toughness), three
// views (top-down, chase and the cockpit with a turning wheel, shift lights and gears), crashes with damage, spins, sparks,
// smoke and flames, computer rivals, best times saved on this computer, and online rooms: one player makes a room and shares a
// 6-letter code, friends join with it and race together (also on a drawn track) over the same live relay Battle uses.
//
//   window.NotchRaceGame.mount(hostElement) → returns a function that stops the game and cleans up.
//   window.NotchRaceGame.key(name, down), .suspend(), .resume(), .setSoundEnabled(on)   (the Mac app uses these)
(function () {
  'use strict';
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const wrapPi = (a) => { while (a > Math.PI) a -= 2 * Math.PI; while (a < -Math.PI) a += 2 * Math.PI; return a; };
  const KMH = 3.6;

  // ------------------------------------------------------------------ tracks

  /// The three kinds of track. `pts` are control points in metres (x right, y down); a closed track is a loop run for
  /// several laps, an open one is a sprint from the first point to the last.
  /// A rounded-ends oval (two straights joined by half circles), as control points.
  const stadium = (L, R, n = 7) => {
    const pts = [], mid = (x0, x1, y) => { const k = Math.max(1, Math.round(Math.abs(x1 - x0) / 170)); for (let i = 1; i < k; i++) pts.push([x0 + ((x1 - x0) * i) / k, y]); };
    for (let i = 0; i <= n; i++) { const a = -Math.PI / 2 + (Math.PI * i) / n; pts.push([L + Math.cos(a) * R, Math.sin(a) * R]); }
    mid(L, -L, R);
    for (let i = 0; i <= n; i++) { const a = Math.PI / 2 + (Math.PI * i) / n; pts.push([-L + Math.cos(a) * R, Math.sin(a) * R]); }
    mid(-L, L, -R);
    return pts;
  };
  /// A loop whose distance from the middle wobbles (always a clean loop, full of bends).
  const wobble = (n, r0, amps, ph, sx = 1.3, sy = 0.85) => Array.from({ length: n }, (_, i) => { const t = (i / n) * Math.PI * 2; let r = r0; amps.forEach((a, k) => { r += a * Math.sin((k * 2 + 3) * t + ph[k]); }); return [Math.cos(t) * r * sx, Math.sin(t) * r * sy]; });
  const GROUND = { green: '#1e4a2c', desert: '#a9824a', snow: '#9fb4c4', autumn: '#4a5a24', night: '#14201c' };

  /// The tracks. `pts` are control points in metres (x right, y down); a closed track is a loop run for several laps, an
  /// open one is a sprint from the first point to the last. `ground` is the colour round the road, `scenery` what stands along it.
  const TRACKS = [
    { id: 'sprint', name: 'Straight sprint', kind: 'Straight', closed: false, width: 34, laps: 1, blurb: 'A 1.6 km drag strip. Flat out, one run.', ground: GROUND.green, scenery: 'none',
      pts: [[0, 0], [0, -400], [0, -800], [0, -1200], [0, -1600]] },
    { id: 'circuit', name: 'Curved circuit', kind: 'Curved', closed: true, width: 34, laps: 3, blurb: 'A flowing loop of sweeping bends. Easy to drift.', ground: GROUND.green, scenery: 'trees',
      pts: [[0, 0], [300, -30], [520, -180], [560, -420], [400, -600], [100, -640], [-180, -520], [-300, -300], [-220, -80]] },
    { id: 'mixed', name: 'Mixed track', kind: 'Mixed', closed: true, width: 32, laps: 3, blurb: 'Long straights, a hairpin, a chicane and fast sweepers.', ground: GROUND.green, scenery: 'trees',
      pts: [[0, 0], [255, 0], [510, 0], [646, -26], [722, -110], [697, -221], [595, -280], [476, -255], [374, -306], [280, -382], [323, -484], [442, -527], [544, -595], [510, -706], [382, -748], [212, -714], [85, -646], [-26, -535], [-136, -442], [-255, -433], [-374, -484], [-451, -391], [-425, -255], [-306, -187], [-187, -119], [-76, -42]] },
    { id: 'gp', name: 'Grand Prix', kind: 'Circuit', closed: true, width: 34, laps: 3, blurb: 'A full circuit: a long start straight, a hairpin, fast esses and a back straight into a chicane.', ground: GROUND.green, scenery: 'trees',
      pts: [[0, 0], [380, 0], [760, 0], [960, -90], [980, -250], [860, -340], [700, -330], [600, -430], [640, -580], [560, -720], [380, -760], [220, -690], [90, -580], [-70, -530], [-210, -610], [-440, -650], [-640, -540], [-690, -340], [-560, -190], [-330, -110], [-130, -50]] },
    { id: 'oval', name: 'Speedway oval', kind: 'Oval', closed: true, width: 40, laps: 5, blurb: 'A banked-feel oval: two long straights and flat-out turns. Top speed wins.', ground: GROUND.green, scenery: 'none',
      pts: stadium(520, 230) },
    { id: 'street', name: 'City streets', kind: 'Street', closed: true, width: 26, laps: 3, blurb: 'Tight, narrow city streets: hard corners, short straights, no room for mistakes.', ground: '#3b3f46', scenery: 'blocks',
      pts: [[0, 0], [260, 0], [420, 0], [520, -50], [540, -170], [480, -250], [340, -270], [250, -330], [270, -430], [380, -480], [520, -500], [600, -590], [570, -720], [440, -790], [250, -770], [120, -700], [30, -600], [-70, -520], [-90, -380], [-200, -300], [-330, -330], [-410, -240], [-390, -110], [-270, -50]] },
    { id: 'alpine', name: 'Mountain pass', kind: 'Alpine', closed: true, width: 30, laps: 3, blurb: 'Bend after bend through the hills. Never a moment to rest.', ground: GROUND.autumn, scenery: 'pines',
      pts: wobble(20, 470, [120, 80, 45], [0.6, 2.1, 4.4], 1.25, 0.9) },
    { id: 'hairpins', name: 'Hairpin hill', kind: 'Hairpins', closed: false, width: 28, laps: 1, blurb: 'A climb of six hairpins stacked up the hill. Brake late, turn in early.', ground: GROUND.autumn, scenery: 'pines',
      pts: [[0, 0], [0, -60], [6, -100], [26, -123], [60, -130], [75, -130], [150, -130], [225, -130], [300, -130], [339, -146], [355, -185], [339, -224], [300, -240], [225, -240], [150, -240], [75, -240], [0, -240], [-39, -256], [-55, -295], [-39, -334], [0, -350], [75, -350], [150, -350], [225, -350], [300, -350], [339, -366], [355, -405], [339, -444], [300, -460], [225, -460], [150, -460], [75, -460], [0, -460], [-39, -476], [-55, -515], [-39, -554], [0, -570], [75, -570], [150, -570], [225, -570], [300, -570], [339, -586], [355, -625], [339, -664], [300, -680], [225, -680], [150, -680], [75, -680], [0, -680], [-39, -696], [-55, -735], [-39, -774], [0, -790], [100, -790], [220, -790], [340, -800], [460, -830]] },
    { id: 'desert', name: 'Desert run', kind: 'Desert', closed: false, width: 36, laps: 1, blurb: 'Two kilometres of open desert road with long flowing bends. Hold it flat.', ground: GROUND.desert, scenery: 'cacti',
      pts: [[0, 0], [60, -300], [20, -700], [-160, -1080], [-120, -1480], [100, -1790], [440, -2010], [820, -2150]] },
    { id: 'coast', name: 'Coast road', kind: 'Coast', closed: true, width: 34, laps: 3, blurb: 'Long sweepers along the cliffs and one tight hairpin at the end.', ground: GROUND.green, scenery: 'trees',
      pts: [[0, 0], [420, -40], [780, -170], [980, -420], [940, -700], [700, -880], [380, -900], [150, -780], [-60, -820], [-300, -720], [-420, -480], [-340, -240], [-170, -80]] },
    { id: 'snow', name: 'Frozen lake', kind: 'Snow', closed: true, width: 40, laps: 3, blurb: 'A wide loop on a frozen lake. Plenty of room, not much grip.', ground: GROUND.snow, scenery: 'pines', grip: 0.85,
      pts: wobble(14, 520, [90, 50, 25], [1.9, 0.3, 3.3], 1.2, 0.85) },
    { id: 'kart', name: 'Kart track', kind: 'Kart', closed: true, width: 24, laps: 5, blurb: 'A small, tight, twisty kart track. Short laps, quick fun.', ground: GROUND.green, scenery: 'tyres',
      pts: [[0, 0], [150, 0], [250, -50], [270, -150], [200, -220], [100, -200], [30, -280], [60, -370], [160, -410], [260, -390], [330, -460], [300, -560], [190, -590], [60, -560], [-60, -480], [-120, -360], [-100, -220], [-70, -90]] },
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
    return { id: def.id, def, name: def.name, closed, width: def.width, laps: def.laps, S, m, step, length, bounds: [x0, y0, x1, y1], ground: def.ground || GROUND.green, scenery: def.scenery || 'trees', grip: def.grip || 1 };
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

  /// Is a drawn track drivable? Returns { ok, why, T }: enough points, long enough, no bend tighter than the road is wide,
  /// and no two parts of the road on top of each other (a crossing or a near miss).
  function checkTrack(def) {
    const n = (def.pts || []).length;
    if (n < (def.closed ? 4 : 2)) return { ok: false, why: def.closed ? 'Click at least 4 points for a loop.' : 'Click at least 2 points.' };
    if (n > 60) return { ok: false, why: 'Too many points (60 at most).' };
    let T;
    try { T = buildTrack(def); } catch { return { ok: false, why: 'That shape does not make a road.' }; }
    if (!(T.m > 4)) return { ok: false, why: 'Too short.' };
    if (T.length < (def.closed ? 500 : 300)) return { ok: false, why: `Too short: ${Math.round(T.length)} m (at least ${def.closed ? 500 : 300} m).`, T };
    if (T.length > 12000) return { ok: false, why: 'Too long (12 km at most).', T };
    let kmax = 0, at = 0;
    T.S.forEach((q, i) => { if (Math.abs(q.k) > kmax) { kmax = Math.abs(q.k); at = i; } });
    if (kmax >= 1 / (def.width * 0.6)) return { ok: false, why: 'A bend is too tight for the road. Move the points round it further apart.', T, bad: at };
    const gap = def.width * 1.0, skip = Math.ceil((def.width * 3) / T.step);
    for (let i = 0; i < T.m; i += 2) for (let j = i + skip; j < T.m; j += 2) {
      if (T.closed && T.m - j + i < skip) continue;
      const a = T.S[i], b = T.S[j];
      if (Math.abs(a.x - b.x) < gap && Math.abs(a.y - b.y) < gap && Math.hypot(a.x - b.x, a.y - b.y) < gap) return { ok: false, why: 'The road runs into itself. Move it apart (no crossings).', T, bad: i };
    }
    return { ok: true, why: '', T };
  }

  /// A track as a short text code (to share with friends): its shape, width, ground and name. And back again.
  const GROUNDS = { green: { ground: GROUND.green, scenery: 'trees', label: 'Grass' }, desert: { ground: GROUND.desert, scenery: 'cacti', label: 'Desert' }, snow: { ground: GROUND.snow, scenery: 'pines', label: 'Snow', grip: 0.85 }, autumn: { ground: GROUND.autumn, scenery: 'pines', label: 'Hills' }, city: { ground: '#3b3f46', scenery: 'blocks', label: 'City' } };
  const b64e = (str) => (typeof btoa === 'function' ? btoa(unescape(encodeURIComponent(str))) : Buffer.from(str, 'utf8').toString('base64')).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  const b64d = (str) => { const t = str.replace(/-/g, '+').replace(/_/g, '/'); return typeof atob === 'function' ? decodeURIComponent(escape(atob(t))) : Buffer.from(t, 'base64').toString('utf8'); };
  function encodeTrack(def) {
    return 'NR1' + b64e(JSON.stringify({ n: String(def.name || 'My track').slice(0, 24), c: def.closed ? 1 : 0, w: def.width, g: def.look || 'green', l: def.laps || 3, p: def.pts.flatMap((p) => [Math.round(p[0]), Math.round(p[1])]) }));
  }
  const hashStr = (str) => { let h = 2166136261; for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); } return (h >>> 0).toString(36); };
  /// A track from a code, or null if the code is not a valid, drivable track.
  function decodeTrack(code) {
    try {
      const raw = String(code || '').trim().replace(/\s+/g, '');
      if (!raw.startsWith('NR1') || raw.length > 2400) return null;
      const o = JSON.parse(b64d(raw.slice(3)));
      if (!o || !Array.isArray(o.p) || o.p.length % 2 || o.p.length > 120) return null;
      const pts = []; for (let i = 0; i < o.p.length; i += 2) { const x = Number(o.p[i]), y = Number(o.p[i + 1]); if (!isFinite(x) || !isFinite(y) || Math.abs(x) > 6000 || Math.abs(y) > 6000) return null; pts.push([x, y]); }
      return customDef({ name: String(o.n || 'Shared track').slice(0, 24), closed: !!o.c, width: [26, 32, 40].includes(o.w) ? o.w : 32, look: GROUNDS[o.g] ? o.g : 'green', laps: [1, 3, 5].includes(o.l) ? o.l : 3, pts }, true);
    } catch { return null; }
  }
  /// A full track definition from what the designer keeps. Returns null if it is not drivable (when `check` is set).
  function customDef(d, check) {
    const look = GROUNDS[d.look] ? d.look : 'green', gr = GROUNDS[look];
    const def = { id: 'c-' + hashStr(JSON.stringify([d.closed ? 1 : 0, d.width, look, d.pts])), name: d.name || 'My track', kind: '★ ' + (d.name || 'Mine').slice(0, 12), custom: true, closed: !!d.closed, width: d.width || 32, laps: d.closed ? (d.laps || 3) : 1, look, blurb: `Your own ${d.closed ? 'circuit' : 'sprint'}.`, ground: gr.ground, scenery: gr.scenery, grip: gr.grip, pts: d.pts.map((p) => [p[0] + 0, p[1] + 0]) };
    if (check && !checkTrack(def).ok) return null;
    return def;
  }

  // ------------------------------------------------------------------ cars

  /// accel (m/s²), vmax (m/s), grip (sideways m/s² the tyres hold), steer (largest wheel angle, radians), loose (how much
  /// the back end lets go under power while turning), brake (m/s²). down: extra grip from downforce at top speed (a fraction).
  /// gears, idle and redline (rpm) drive the gearbox, the dashboard and the engine sound; cyl is the engine's cylinder count
  /// and tone its character (the sound); tough is how well the body takes a knock (1 is a normal road car).
  const CARS = [
    { id: 'gt', name: 'Street GT', blurb: 'Grippy and forgiving. Fast through the bends.', accel: 15, vmax: 66, grip: 17, steer: 0.52, loose: 0.12, brake: 30, color: '#3aa0ff', down: 0.05, gears: 6, idle: 900, redline: 7500, cyl: 6, tone: 'gt', tough: 1 },
    { id: 'drift', name: 'Drift King', blurb: 'Lets go easily. Tap Space to slide round corners.', accel: 14, vmax: 62, grip: 12.5, steer: 0.6, loose: 0.42, brake: 26, color: '#ff4d6d', down: 0, gears: 6, idle: 850, redline: 8000, cyl: 4, tone: 'hatch', tough: 1 },
    { id: 'muscle', name: 'Muscle', blurb: 'Huge power and top speed. Hard to hold in the bends.', accel: 19, vmax: 74, grip: 13.5, steer: 0.48, loose: 0.3, brake: 28, color: '#ffb703', down: 0, gears: 5, idle: 700, redline: 6500, cyl: 8, tone: 'v8', tough: 1.15 },
    { id: 'hatch', name: 'Hot Hatch', blurb: 'Small, light and playful. Great in tight corners.', accel: 13, vmax: 56, grip: 15, steer: 0.58, loose: 0.2, brake: 27, color: '#2ec4b6', down: 0, gears: 6, idle: 950, redline: 7200, cyl: 4, tone: 'hatch', tough: 0.85 },
    { id: 'gt3', name: 'GT3 Racer', blurb: 'A proper race car: strong brakes, huge grip, rewards a clean line.', accel: 19, vmax: 78, grip: 22, steer: 0.5, loose: 0.14, brake: 40, color: '#e63946', down: 0.22, gears: 6, idle: 1000, redline: 8600, cyl: 6, tone: 'gt', tough: 1.1 },
    { id: 'super', name: 'Supercar V10', blurb: 'Screaming V10 power and a very high top speed. A handful when you rush it.', accel: 22, vmax: 88, grip: 18, steer: 0.5, loose: 0.26, brake: 36, color: '#b6ff3b', down: 0.12, gears: 7, idle: 1000, redline: 8700, cyl: 10, tone: 'v10', tough: 1 },
    { id: 'f1', name: 'Formula One', blurb: 'The fastest thing here. Downforce glues it to the road: brake late, turn in hard. Fragile.', accel: 27, vmax: 94, grip: 30, steer: 0.42, loose: 0.08, brake: 58, color: '#f4f4f4', down: 0.55, gears: 8, idle: 4000, redline: 15000, cyl: 10, tone: 'f1', tough: 0.65 },
  ];
  const WHEELBASE = 2.8, CAR_LEN = 4.6, CAR_W = 2.0;

  /// Which gear the car is in and how fast the engine is turning, from its speed. A gear gives a share of the top speed;
  /// the box changes up near the redline and down well below it, with a short pause (shiftT) in which the revs drop.
  function gearbox(c, dt, throttle) {
    const sp = c.spec, v = Math.abs(c.vf), top = (n) => sp.vmax * 1.04 * Math.pow(n / sp.gears, 0.88);
    if (c.shiftT > 0) c.shiftT = Math.max(0, c.shiftT - dt);
    if (c.vf < -0.5) { c.gear = -1; }
    else if (v < 0.8 && throttle === 0) { c.gear = 0; }
    else {
      if (c.gear < 1) c.gear = 1;
      if (c.gear < sp.gears && v > top(c.gear) * 0.95 && c.shiftT === 0) { c.gear++; c.shiftT = 0.16; c.shifted = (c.shifted || 0) + 1; }
      else if (c.gear > 1 && v < top(c.gear - 1) * 0.6 && c.shiftT === 0) { c.gear--; c.shiftT = 0.1; c.shifted = (c.shifted || 0) + 1; }
    }
    const lo = c.gear > 1 ? top(c.gear - 1) * 0.6 : 0, hi = c.gear > 0 ? top(c.gear) : 1;
    let k = c.gear <= 0 ? 0 : clamp((v - lo) / Math.max(1, hi - lo), 0, 1.02);
    const want = sp.idle + (sp.redline - sp.idle) * (c.gear === -1 ? clamp(v / 12, 0, 0.5) : (0.18 + 0.82 * k) * (0.78 + 0.22 * Math.max(throttle, 0.25)));
    const drop = c.shiftT > 0 ? 0.72 : 1;
    c.rpm += (Math.max(sp.idle, want * drop) - c.rpm) * (1 - Math.exp(-dt * (c.shiftT > 0 ? 16 : 8)));
    return c;
  }

  function newCar(spec, x, y, h) {
    return { spec, x, y, h, vx: 0, vy: 0, yaw: 0, steerA: 0, vf: 0, vl: 0, drifting: false, onGrass: false, bump: 0, gear: 0, rpm: spec.idle || 900, shiftT: 0, dmg: 0, spin: 0, pull: 0, hit: 0 };
  }

  /// One physics step. `inp` is { throttle 0..1, brake 0..1, steer -1..1 (+ is right), hand 0/1 }. `surf` is 1 on the road, less on grass.
  function stepCar(c, inp, dt, surf = 1) {
    const sp0 = c.spec, dmgK = 1 - 0.4 * c.dmg;        // a damaged car is slower, and its steering pulls to one side
    const sp = c.dmg > 0 ? { ...sp0, vmax: sp0.vmax * dmgK, accel: sp0.accel * (1 - 0.25 * c.dmg), grip: sp0.grip * (1 - 0.15 * c.dmg) } : sp0;
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
    const target = clamp(clamp(inp.steer, -1, 1) + c.pull * c.dmg, -1, 1) * sp.steer / (1 + (vf0 / 26) * (vf0 / 26));
    c.steerA += (target - c.steerA) * (1 - Math.exp(-dt * 9));
    const wd = vf0 * Math.tan(c.steerA) / WHEELBASE;
    const power = inp.throttle * Math.abs(c.steerA) / sp.steer;
    let grip = sp.grip * surf * (1 + (sp.down || 0) * (vf0 * vf0) / (sp.vmax * sp.vmax)) * (1 - sp.loose * 0.5 * power * clamp(Math.abs(vf0) / 30, 0, 1));
    let w;
    const slip = c.vl / Math.max(Math.abs(c.vf), 5);        // how far sideways the car is travelling (last step)
    if (inp.hand) { w = clamp(wd * 1.25, -2, 2); grip *= 0.3; }
    else { const wMax = grip / Math.max(Math.abs(vf0), 6), lim = wMax * (1.2 + 1.5 * sp.loose * power); w = clamp(wd, -lim, lim); }
    // Turning further into a slide is held back (the car does not spin), and with the wheel and the handbrake let go the
    // car straightens itself out along the way it is travelling.
    if (w * slip < 0 && Math.abs(slip) > 0.45) w *= clamp(1 - (Math.abs(slip) - 0.45) / 0.45, 0, 1);
    if (!inp.hand && Math.abs(vf0) > 8) w += clamp(slip, -0.6, 0.6) * 2.5 * (1 - 0.6 * sp.loose);
    c.yaw = w + c.spin;
    c.h += (w + c.spin) * dt;
    c.spin *= Math.exp(-dt * 2.6);        // a spin from a knock dies away as the tyres bite
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
    c.hit = Math.max(0, c.hit - dt * 3);
    gearbox(c, dt, inp.throttle);
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

  /// A solid barrier a little way past the edge of the road. A car that reaches it bounces off, scrapes along it, is twisted
  /// round by the knock, and is damaged by how hard it hit. Returns the impact speed (m/s), or 0 when nothing was touched.
  function wallHit(c, T, loc) {
    const wallD = T.width / 2 + 7, off = Math.abs(loc.lat);
    if (off <= wallD) return 0;
    const q = T.S[loc.idx], sg = Math.sign(loc.lat) || 1, nx = q.nx * sg, ny = q.ny * sg, over = off - wallD;       // (nx, ny) points out, at the wall
    c.x -= nx * over; c.y -= ny * over;
    const vn = c.vx * nx + c.vy * ny;
    if (vn <= 0) return 0;
    c.vx -= 1.22 * vn * nx; c.vy -= 1.22 * vn * ny;                        // bounce
    const tx = -ny, ty = nx, vt = c.vx * tx + c.vy * ty, fr = clamp(0.1 + vn * 0.012, 0.1, 0.45);
    c.vx -= vt * fr * tx; c.vy -= vt * fr * ty;                            // scrape: the wall rubs the speed off
    const hx = Math.cos(c.h), hy = Math.sin(c.h), cross = hx * ny - hy * nx, into = hx * nx + hy * ny;
    c.spin += -(Math.sign(cross) || 1) * clamp(vn * 0.045, 0, 1.5) * clamp(Math.abs(cross) + 0.2, 0, 1) * (into > -0.2 ? 1 : 0.4);
    hurt(c, vn, 5, 40);
    return vn;
  }
  /// Damage from an impact of `speed` m/s: nothing below `from`, all of it at `from + span` (and the car's toughness divides it).
  function hurt(c, speed, from, span) {
    c.dmg = clamp(c.dmg + clamp((speed - from) / span, 0, 0.55) / (c.spec.tough || 1), 0, 1);
    if (!c.pull) c.pull = (Math.random() < 0.5 ? -1 : 1) * 0.1;
    c.hit = 1;
  }
  /// Cars hit each other. Each is two overlapping circles (nose and tail), so a corner clips and a side swipe is different from a
  /// head-on crash: the cars are pushed apart, trade speed and are twisted round by where they were hit, and both take damage.
  /// Returns the impact speed (m/s), or 0 when they did not touch.
  function collide(a, b) {
    if (Math.hypot(b.x - a.x, b.y - a.y) > CAR_LEN * 1.3) return 0;
    const R = 1.0, pts = (c) => { const ca = Math.cos(c.h), sa = Math.sin(c.h); return [[c.x + ca * 1.3, c.y + sa * 1.3], [c.x - ca * 1.3, c.y - sa * 1.3]]; };
    let best = null;
    for (const pa of pts(a)) for (const pb of pts(b)) { const d = Math.hypot(pb[0] - pa[0], pb[1] - pa[1]); if (d < 2 * R && (!best || d < best.d)) best = { d, pa, pb }; }
    if (!best) return 0;
    const dx = best.pb[0] - best.pa[0], dy = best.pb[1] - best.pa[1], d = Math.max(best.d, 1e-4);
    let nx = dx / d, ny = dy / d;
    if (best.d < 1e-3) { const l = Math.hypot(b.x - a.x, b.y - a.y) || 1; nx = (b.x - a.x) / l; ny = (b.y - a.y) / l; }
    if (nx * (b.x - a.x) + ny * (b.y - a.y) < 0) { nx = -nx; ny = -ny; }        // deep overlap: always push a away from b
    const push = (2 * R - d) / 2 + 0.02;
    a.x -= nx * push; a.y -= ny * push; b.x += nx * push; b.y += ny * push;
    const cx = (best.pa[0] + best.pb[0]) / 2, cy = (best.pa[1] + best.pb[1]) / 2;
    const rax = cx - a.x, ray = cy - a.y, rbx = cx - b.x, rby = cy - b.y;
    // Velocity of each car at the contact point includes its spin.
    const vax = a.vx - (a.spin || 0) * ray, vay = a.vy + (a.spin || 0) * rax, vbx = b.vx - (b.spin || 0) * rby, vby = b.vy + (b.spin || 0) * rbx;
    const rv = (vbx - vax) * nx + (vby - vay) * ny;
    if (rv >= 0) return 0.01;                  // overlapping but already moving apart: just separated
    const j = -(1 + 0.32) * rv / 2;
    a.vx -= nx * j; a.vy -= ny * j; b.vx += nx * j; b.vy += ny * j;
    a.spin = (a.spin || 0) + clamp((rax * -ny - ray * -nx) * j * 0.05 / 1.4, -2, 2); b.spin = (b.spin || 0) + clamp((rbx * ny - rby * nx) * j * 0.05 / 1.4, -2, 2);
    hurt(a, -rv, 4, 45); hurt(b, -rv, 4, 45);
    return Math.max(0.01, -rv);
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
    const packState = (id, R) => ({ t: 's', id, x: r1(R.car.x), y: r1(R.car.y), h: r3(R.car.h), vx: r1(R.car.vx), vy: r1(R.car.vy), lap: R.lap, pr: r1(R.prog), dr: R.car.drifting ? 1 : 0, dm: Math.round(R.car.dmg * 100) / 100 });
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
.rc>canvas{position:absolute;inset:0;width:100%;height:100%;display:block}
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
.rc-ui.rc-side{justify-content:flex-start;align-items:stretch;padding:8px}.rc-ui.rc-side .rc-card{max-width:200px;font-size:11px}.rc-ui.rc-side .rc-row{margin:3px 0}
.rc-pair{display:flex;gap:10px;align-items:center;margin:4px 0}.rc-prev{border-radius:8px;flex:none}
.rc-stats{min-width:170px}.rc-stats div{display:flex;align-items:center;gap:6px;font-size:10px;font-weight:500}.rc-stats span{width:56px;opacity:.75}.rc-stats i{flex:1;height:6px;border-radius:3px;background:rgba(255,255,255,.12);overflow:hidden}.rc-stats b{display:block;height:100%}
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
    let viewMode = store.get('view', 'chase');          // top | chase | cockpit
    const hostSound = () => (typeof window.NotchHostSound === 'boolean' ? window.NotchHostSound : null);
    let soundOn = hostSound() ?? store.get('sound', true);
    // Tracks drawn in the designer (kept on this computer), and ones only borrowed for now (a friend's, or a test drive).
    const customs = () => (store.get('custom', []) || []).map((d) => customDef(d)).filter(Boolean);
    const tempDefs = {};
    const findDef = (id) => TRACKS.find((t) => t.id === id) || customs().find((t) => t.id === id) || tempDefs[id] || null;
    const trackCache = {};
    const getTrack = (id) => { const d = findDef(id) || TRACKS[1]; return trackCache[d.id] || (trackCache[d.id] = buildTrack(d)); };
    /// A track id from a message: a built-in one, one of ours, or a friend's drawn track sent along as a code.
    const resolveTrack = (id, code) => { if (findDef(id)) return id; const d = code && decodeTrack(code); if (d && d.id === id) { tempDefs[id] = d; return id; } return null; };
    if (!findDef(trackId)) trackId = 'circuit';
    const carSpec = (id) => CARS.find((c) => c.id === id) || CARS[0];

    // ---- state
    let screen = 'menu';                 // menu | lobby | countdown | race | done
    let T = getTrack(trackId), racers = [], me = null, raceLaps = 3, clock = 0, cdLeft = 0, alive = true, paused = false, suspended = false;
    const keys = new Set();
    let skids = [], parts = [], camX = 0, camY = 0, shake = 0, doneT = 0, chaseYaw = 0, backToDesign = false, ds = null, lastShift = 0, paddle = 0;
    let net = null;                      // { link, code, host, players: Map, cfg, status }
    const aiState = new Map();

    // ---- menu and lobby screens
    const btn = (label, cls, fn) => { const b = document.createElement('button'); b.textContent = label; if (cls) b.className = cls; b.onclick = fn; return b; };
    const row = (label, ...kids) => { const r = document.createElement('div'); r.className = 'rc-row'; if (label) { const l = document.createElement('span'); l.className = 'rc-lab'; l.textContent = label; r.append(l); } r.append(...kids); return r; };
    const card = (...kids) => { const c = document.createElement('div'); c.className = 'rc-card'; c.append(...kids); ui.replaceChildren(c); return c; };
    const head = (t) => { const h = document.createElement('h2'); h.textContent = t; return h; };
    const hint = (t) => { const p = document.createElement('div'); p.className = 'rc-hint'; p.textContent = t; return p; };
    /// A little drawing of a track's shape.
    const preview = (def, w = 150, h = 84) => {
      const c = document.createElement('canvas'); c.width = w * 2; c.height = h * 2; c.style.width = w + 'px'; c.style.height = h + 'px'; c.className = 'rc-prev';
      const x = c.getContext('2d'), Tt = getTrack(def.id), [x0, y0, x1, y1] = Tt.bounds, k = Math.min((w * 2 - 24) / (x1 - x0 || 1), (h * 2 - 24) / (y1 - y0 || 1));
      const mp = (q) => [12 + (q.x - x0) * k + ((w * 2 - 24) - (x1 - x0) * k) / 2, 12 + (q.y - y0) * k + ((h * 2 - 24) - (y1 - y0) * k) / 2];
      x.fillStyle = def.ground || GROUND.green; x.globalAlpha = 0.55; x.fillRect(0, 0, w * 2, h * 2); x.globalAlpha = 1;
      x.lineJoin = 'round'; x.strokeStyle = '#d8d8d8'; x.lineWidth = 7; x.beginPath(); Tt.S.forEach((q, i) => { const p = mp(q); i ? x.lineTo(...p) : x.moveTo(...p); }); if (Tt.closed) x.closePath(); x.stroke();
      x.strokeStyle = '#33363d'; x.lineWidth = 4; x.stroke();
      const st = mp(Tt.S[0]); x.fillStyle = '#21d07a'; x.beginPath(); x.arc(st[0], st[1], 6, 0, 7); x.fill();
      return c;
    };
    const STATS = [['Top speed', (c) => c.vmax / 94], ['Accel', (c) => c.accel / 27], ['Grip', (c) => c.grip / 30], ['Brakes', (c) => c.brake / 58], ['Tough', (c) => (c.tough || 1) / 1.15]];
    const stats = (spec) => { const box = document.createElement('div'); box.className = 'rc-stats'; for (const [n, f] of STATS) { const r = document.createElement('div'); r.innerHTML = `<span>${n}</span><i><b style="width:${Math.round(clamp(f(spec), 0.05, 1) * 100)}%;background:${spec.color}"></b></i>`; box.append(r); } const g = document.createElement('div'); g.className = 'rc-hint'; g.textContent = `${spec.gears} gears · ${spec.cyl}-cylinder · ${Math.round(spec.vmax * KMH)} km/h`; box.append(g); return box; };
    const pickers = (onChange, withLaps = true) => {
      const all = [...TRACKS, ...customs()];
      if (tempDefs[trackId] && !all.some((t) => t.id === trackId)) all.push(tempDefs[trackId]);
      const def = findDef(trackId) || TRACKS[1];
      const tracks = all.map((t) => btn(t.kind, t.id === trackId ? 'on' : '', () => { trackId = t.id; store.set('track', trackId); T = getTrack(trackId); onChange(); }));
      const cars = CARS.map((c) => btn(c.name, c.id === carId ? 'on' : '', () => { carId = c.id; store.set('car', carId); onChange(); }));
      const tInfo = document.createElement('div'); tInfo.className = 'rc-pair'; const tTxt = document.createElement('div'); tTxt.append(hint(`${def.name} · ${(getTrack(def.id).length / 1000).toFixed(1)} km · ${def.closed ? 'circuit' : 'sprint'}`), hint(def.blurb || '')); tInfo.append(preview(def), tTxt);
      const cInfo = document.createElement('div'); cInfo.className = 'rc-pair'; const cTxt = document.createElement('div'); cTxt.append(hint(carSpec(carId).blurb)); cInfo.append(stats(carSpec(carId)), cTxt);
      const out = [row('Track', ...tracks), tInfo, row('Car', ...cars), cInfo];
      if (withLaps && getTrack(trackId).closed) out.splice(2, 0, row('Laps', ...[1, 3, 5].map((n) => btn(String(n), n === lapsSel ? 'on' : '', () => { lapsSel = n; store.set('laps', n); onChange(); }))));
      return out;
    };
    const bestLine = () => { const b = store.get(`best.${trackId}.${carId}`, null); return hint(b ? `Your best here: ${b.lap ? 'lap ' + fmt(b.lap) + ' · ' : ''}race ${fmt(b.race)}` : 'No time set here yet.'); };

    function showMenu() {
      screen = 'menu'; big.textContent = ''; ui.classList.remove('rc-side');
      const name = document.createElement('input'); name.value = myName; name.maxLength = 14; name.style.width = '120px'; name.style.textTransform = 'none'; name.style.letterSpacing = '0';
      name.onchange = () => { myName = (name.value || myName).trim().slice(0, 14) || myName; store.set('name', myName); };
      const mk = (n) => btn(String(n), n === rivals ? 'on' : '', () => { rivals = n; store.set('rivals', n); showMenu(); });
      card(head('🏎️ Racing'),
        ...pickers(showMenu),
        row('Rivals', ...[0, 1, 3, 5].map(mk)),
        row('Level', ...Object.entries(LEVELS).map(([id, l]) => btn(l.label, id === level ? 'on' : '', () => { level = id; store.set('level', id); showMenu(); }))),
        bestLine(),
        row('View', ...[['top', 'Top-down'], ['chase', 'Chase'], ['cockpit', 'Cockpit']].map(([id, l]) => btn(l, id === viewMode ? 'on' : '', () => { viewMode = id; store.set('view', id); showMenu(); })), btn(soundOn ? '🔊 Sound' : '🔇 Sound off', '', () => { setSound(!soundOn); showMenu(); })),
        row('', btn('Start race', 'go', () => { backToDesign = false; startLocalRace(); }), btn('✏️ Track designer', '', () => openDesigner(findDef(trackId) && findDef(trackId).custom ? findDef(trackId) : null))),
        row('Online', btn('Create room', '', () => openRoom(true)), (() => { const i = document.createElement('input'); i.placeholder = 'CODE'; i.maxLength = 8; i.id = 'rc-code'; return i; })(), btn('Join', '', () => { const c = NET.normCode(root.querySelector('#rc-code').value); if (!c) { toast('That code is 6 letters and numbers.'); return; } openRoom(false, c); })),
        row('Name', name),
        hint('↑ W gas · ↓ S brake and reverse · ← → A D steer · Space handbrake (drift) · V view (top, chase, cockpit) · M sound · R restart · P pause · Esc menu'));
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
      parts = []; audioUp();
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
      const d = findDef(trackId); net.link.send({ t: 'hi', id: myId, name: myName, car: carId, host: net.host, tr: trackId, lp: lapsSel, td: d && d.custom ? encodeTrack(d) : undefined });
      const now = performance.now();
      for (const [id, seen] of net.seen) if (now - seen > 7000 && id !== myId) { net.seen.delete(id); net.players.delete(id); if (screen === 'lobby') showLobby(); }
    }
    function onNet(m) {
      if (!net || m.id === myId) return;
      if (m.t === 'hi') {
        const known = net.players.has(m.id);
        net.players.set(m.id, { id: m.id, name: String(m.name || 'Driver').slice(0, 14), car: CARS.some((c) => c.id === m.car) ? m.car : 'gt', host: !!m.host });
        net.seen.set(m.id, performance.now());
        if (m.host && !net.host && screen === 'lobby' && resolveTrack(m.tr, m.td)) { trackId = m.tr; T = getTrack(trackId); lapsSel = [1, 3, 5].includes(m.lp) ? m.lp : lapsSel; }
        if (!known) { hello(); if (screen === 'lobby') showLobby(); }
        else if (screen === 'lobby') showLobby();
      } else if (m.t === 'go' && screen === 'lobby' && Array.isArray(m.order)) {
        if (!resolveTrack(m.tr, m.td)) return;
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
        r.lap = m.lap; r.prog = m.pr; r.car.drifting = !!m.dr; r.car.dmg = clamp(Number(m.dm) || 0, 0, 1); r.lastMsg = performance.now();
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
      if (net.host) { nodes.push(...pickers(showLobby)); nodes.push(row('', btn('Start race', 'go', startOnline))); } else { nodes.push(hint(`Track: ${(findDef(trackId) || TRACKS[1]).name}${T.closed ? ', ' + lapsSel + ' laps' : ''}. Waiting for the host to start.`)); nodes.push(...pickers(showLobby, false).slice(2)); }
      nodes.push(row('', btn('Leave', '', () => { closeNet(); showMenu(); })));
      card(...nodes);
    }
    function startOnline() {
      if (!net || !net.host) return;
      const order = [myId, ...[...net.players.keys()].filter((id) => id !== myId)].slice(0, 8);
      const d = findDef(trackId), msg = { t: 'go', id: myId, tr: trackId, lp: lapsSel, order, td: d && d.custom ? encodeTrack(d) : undefined };
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
        if (screen === 'design') { if (k === 'escape') showMenu(); else if (k === 'z') designUndo(); return; }
        if (k === 'escape' && screen !== 'menu') { closeNet(); paused = false; if (backToDesign && ds) { screen = 'design'; designUI(); } else showMenu(); return; }
        if (k === 'v' && screen !== 'menu' && screen !== 'lobby') { viewMode = { top: 'chase', chase: 'cockpit', cockpit: 'top' }[viewMode] || 'chase'; store.set('view', viewMode); toast({ top: 'Top-down view', chase: 'Chase view', cockpit: 'Cockpit view' }[viewMode]); return; }
        if (k === 'm') { setSound(!soundOn); toast(soundOn ? 'Sound on' : 'Sound off'); if (screen === 'menu') showMenu(); return; }
      }
      const m = KEYMAP[k]; if (m) { if (down) keys.add(m); else keys.delete(m); }
    }
    const onKd = (e) => { if (!root.isConnected || (e.target && /^(input|textarea|select)$/i.test(e.target.tagName)) || e.metaKey || e.ctrlKey) return; if (KEYMAP[e.key.toLowerCase()] && (screen === 'race' || screen === 'countdown')) e.preventDefault(); if (!e.repeat) key(e.key, true); };
    const onKu = (e) => key(e.key, false);
    window.addEventListener('keydown', onKd); window.addEventListener('keyup', onKu);
    root.addEventListener('mousedown', () => { if (!/input/i.test(document.activeElement && document.activeElement.tagName)) root.focus(); });
    const playerInput = () => ({ throttle: keys.has('up') ? 1 : 0, brake: keys.has('down') ? 1 : 0, steer: (keys.has('right') ? 1 : 0) - (keys.has('left') ? 1 : 0), hand: keys.has('hand') ? 1 : 0 });

    // ---- sound: an engine built from the car's real revs and cylinder count (its firing note, an octave below for body and one
    // above for rasp, through a growl and a filter that opens with the throttle), tyres that squeal in a slide, wind, the
    // rumble of the grass, a dip in the note at each gear change, and crashes. Only after a key press (browsers need that),
    // and never while the sound is off (the M key, or the app's own Sound switch): then the audio engine is closed outright.
    let ac = null, au = null;
    const TONES = { gt: [0.5, 0.28, 0.16, 1], hatch: [0.42, 0.12, 0.3, 1.2], v8: [0.45, 0.6, 0.07, 0.72], v10: [0.38, 0.2, 0.42, 1.35], f1: [0.32, 0.1, 0.55, 1.7] };
    function audioKill() { if (ac) { const a = ac; ac = null; au = null; try { a.close().catch(() => {}); } catch { /* already closed */ } } }
    function setSound(on) { soundOn = !!on; store.set('sound', soundOn); if (hostSound() !== null) window.NotchHostSound = soundOn; if (!soundOn) audioKill(); }
    function audioUp() {
      if (!soundOn || suspended || !alive) return null;
      if (ac) { if (ac.state === 'suspended') ac.resume().catch(() => {}); return ac; }
      try {
        ac = new (window.AudioContext || window.webkitAudioContext)();
        const comp = ac.createDynamicsCompressor(); comp.connect(ac.destination);
        const nb = ac.createBuffer(1, ac.sampleRate * 2, ac.sampleRate), nd = nb.getChannelData(0); for (let i = 0; i < nd.length; i++) nd[i] = Math.random() * 2 - 1;
        const noise = (type, f, q) => { const sr = ac.createBufferSource(); sr.buffer = nb; sr.loop = true; const fl = ac.createBiquadFilter(); fl.type = type; fl.frequency.value = f; fl.Q.value = q; const gg = ac.createGain(); gg.gain.value = 0; sr.connect(fl); fl.connect(gg); gg.connect(comp); sr.start(); return { fl, g: gg }; };
        const shaper = ac.createWaveShaper(), curve = new Float32Array(1024); for (let i = 0; i < 1024; i++) { const x = i / 511.5 - 1; curve[i] = Math.tanh(2.6 * x); } shaper.curve = curve;
        const lp = ac.createBiquadFilter(); lp.type = 'lowpass'; lp.Q.value = 2.5; const eng = ac.createGain(); eng.gain.value = 0;
        const o = ['sawtooth', 'square', 'sawtooth'].map((type) => { const x = ac.createOscillator(); x.type = type; const gg = ac.createGain(); gg.gain.value = 0; x.connect(gg); gg.connect(shaper); x.start(); return { x, g: gg }; });
        shaper.connect(lp); lp.connect(eng); eng.connect(comp);
        au = { comp, nb, eng, lp, o, squeal: noise('bandpass', 1900, 7), wind: noise('lowpass', 500, 0.7), rumble: noise('lowpass', 150, 1) };
      } catch { ac = null; au = null; }
      return ac;
    }
    function soundTick() {
      const run = me && (screen === 'race' || screen === 'countdown' || screen === 'done') && !paused && !suspended;
      if (!run || !soundOn) { if (au) { const t = ac.currentTime; au.eng.gain.setTargetAtTime(0, t, 0.05); for (const n of [au.squeal, au.wind, au.rumble]) n.g.gain.setTargetAtTime(0, t, 0.05); } return; }
      if (!audioUp() || !au) return;
      const c = me.car, sp = c.spec, t = ac.currentTime, tone = TONES[sp.tone] || TONES.gt;
      const thr = keys.has('up') && !me.finished && screen !== 'done' ? 1 : 0, rr = clamp((c.rpm - sp.idle) / (sp.redline - sp.idle), 0, 1);
      const f = Math.max(18, (c.rpm / 60) * (sp.cyl || 6) / 2);
      au.o[0].x.frequency.setTargetAtTime(f, t, 0.015); au.o[1].x.frequency.setTargetAtTime(f / 2, t, 0.015); au.o[2].x.frequency.setTargetAtTime(f * 2.006, t, 0.015);
      au.o.forEach((o, i) => o.g.gain.setTargetAtTime(tone[i], t, 0.05));
      au.lp.frequency.setTargetAtTime((260 + 900 * rr + 1700 * thr * (0.45 + rr)) * tone[3], t, 0.03);
      au.eng.gain.setTargetAtTime((0.045 + 0.065 * thr + 0.03 * rr) * (c.shiftT > 0 ? 0.35 : 1) * (1 - 0.3 * c.dmg), t, 0.025);
      const v = Math.hypot(c.vx, c.vy), slide = c.drifting || (keys.has('down') && v > 12 && Math.abs(c.vl) > 2) || (keys.has('hand') && v > 8);
      au.squeal.g.gain.setTargetAtTime(slide ? clamp(Math.abs(c.vl) / 12, 0.04, 0.12) : 0, t, 0.04); au.squeal.fl.frequency.setTargetAtTime(1500 + Math.abs(c.vl) * 30, t, 0.05);
      au.wind.g.gain.setTargetAtTime(clamp(v / 90, 0, 1) * 0.05, t, 0.1);
      au.rumble.g.gain.setTargetAtTime(c.onGrass && v > 3 ? clamp(v / 40, 0.05, 0.25) : 0, t, 0.05);
    }
    /// A crash: a burst of noise (how bright and loud by how hard) and a metal thump. `power` 0..1.
    function crashSound(power) {
      if (!au || !ac || !soundOn) return;
      const t = ac.currentTime, sr = ac.createBufferSource(), fl = ac.createBiquadFilter(), gg = ac.createGain();
      sr.buffer = au.nb; fl.type = 'lowpass'; fl.frequency.value = 500 + 2600 * power;
      gg.gain.setValueAtTime(0.08 + 0.5 * power, t); gg.gain.exponentialRampToValueAtTime(0.001, t + 0.25 + 0.5 * power);
      sr.connect(fl); fl.connect(gg); gg.connect(au.comp); sr.start(t, Math.random()); sr.stop(t + 0.9);
      const o = ac.createOscillator(), og = ac.createGain(); o.type = 'triangle'; o.frequency.setValueAtTime(120 + Math.random() * 140, t); o.frequency.exponentialRampToValueAtTime(55, t + 0.3);
      og.gain.setValueAtTime(0.28 * power, t); og.gain.exponentialRampToValueAtTime(0.001, t + 0.35); o.connect(og); og.connect(au.comp); o.start(t); o.stop(t + 0.4);
    }
    const stopEngine = () => audioKill();

    // ---- crashes you can see: sparks, flying bits of bodywork, smoke from a hurt car, flames from a wreck, tyre smoke
    function crash(r, x, y, speed, col) {
      const power = clamp(speed / 35, 0, 1), n = Math.min(70, 8 + speed * 1.6);
      for (let i = 0; i < n; i++) { const a = Math.random() * 6.283, v = 4 + Math.random() * (6 + speed * 0.5); parts.push({ k: 'spark', x, y, z: 0.5, vx: Math.cos(a) * v + r.car.vx * 0.3, vy: Math.sin(a) * v + r.car.vy * 0.3, vz: 2 + Math.random() * 6, life: 0.25 + Math.random() * 0.45, size: 0.18 }); }
      if (speed > 11) for (let i = 0; i < Math.min(16, speed / 2.5); i++) { const a = Math.random() * 6.283, v = 3 + Math.random() * speed * 0.35; parts.push({ k: 'debris', x, y, z: 0.6, vx: Math.cos(a) * v + r.car.vx * 0.4, vy: Math.sin(a) * v + r.car.vy * 0.4, vz: 2 + Math.random() * 7, life: 2 + Math.random() * 2.5, size: 0.25 + Math.random() * 0.55, col: Math.random() < 0.6 ? (r.color || r.car.spec.color) : col || '#222', rot: Math.random() * 6, vr: (Math.random() - 0.5) * 18 }); }
      for (let i = 0; i < 3 + power * 6; i++) parts.push({ k: 'smoke', x: x + (Math.random() - 0.5) * 2, y: y + (Math.random() - 0.5) * 2, z: 0.5, vx: (Math.random() - 0.5) * 3, vy: (Math.random() - 0.5) * 3, vz: 1, life: 1 + Math.random(), size: 1 + power * 2, dark: 0.35 });
      const near = me && Math.hypot(me.car.x - x, me.car.y - y);
      if (r === me) shake = Math.max(shake, clamp(speed / 22, 0.2, 1.4));
      if (near != null && near < 140) crashSound(power * (r === me ? 1 : clamp(1 - near / 140, 0.1, 0.6)));
      if (parts.length > 900) parts.splice(0, parts.length - 900);
    }
    /// What a car gives off each step: smoke when it is hurt (black and with flames when it is wrecked), and tyre smoke in a slide.
    function emit(r, dt) {
      const c = r.car, bx = c.x - Math.cos(c.h) * 1.8, by = c.y - Math.sin(c.h) * 1.8;
      if (c.dmg > 0.4 && Math.random() < c.dmg * dt * 16) parts.push({ k: 'smoke', x: c.x + Math.cos(c.h) * 1.4, y: c.y + Math.sin(c.h) * 1.4, z: 1, vx: c.vx * 0.2 + (Math.random() - 0.5), vy: c.vy * 0.2 + (Math.random() - 0.5), vz: 1.6, life: 1.4 + Math.random(), size: 0.8 + c.dmg, dark: c.dmg > 0.75 ? 0.15 : 0.45 });
      if (c.dmg > 0.92 && Math.random() < dt * 30) parts.push({ k: 'fire', x: c.x + Math.cos(c.h) * 1.2 + (Math.random() - 0.5), y: c.y + Math.sin(c.h) * 1.2 + (Math.random() - 0.5), z: 0.8, vx: c.vx * 0.5, vy: c.vy * 0.5, vz: 2.5, life: 0.35 + Math.random() * 0.3, size: 0.7 });
      if ((c.drifting || (c.onGrass && Math.hypot(c.vx, c.vy) > 10)) && Math.random() < dt * 26) parts.push({ k: 'smoke', x: bx + (Math.random() - 0.5) * 1.6, y: by + (Math.random() - 0.5) * 1.6, z: 0.3, vx: (Math.random() - 0.5) * 1.5, vy: (Math.random() - 0.5) * 1.5, vz: 0.7, life: 0.8 + Math.random() * 0.6, size: 0.7, dark: c.onGrass ? 0.55 : 0.85, dust: c.onGrass });
    }
    function remoteSmoke(dt) { for (const r of racers) if (r.remote) emit(r, dt); return false; }
    function stepParts(dt) {
      for (const p of parts) {
        p.life -= dt; p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt;
        if (p.k === 'spark' || p.k === 'debris') { p.vz -= 9.8 * dt; if (p.z < 0) { p.z = 0; p.vz *= -0.3; p.vx *= 0.55; p.vy *= 0.55; if (p.vr) p.vr *= 0.5; } }
        else { p.size += dt * (p.k === 'fire' ? -0.6 : 1.6); p.vx *= 1 - dt; p.vy *= 1 - dt; }
        if (p.rot != null) p.rot += p.vr * dt;
      }
      if (parts.some((p) => p.life <= 0)) parts = parts.filter((p) => p.life > 0);
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
        // The barrier: a real wall a little way past the run-off. Hitting it bounces, scrapes, spins and damages the car.
        const after = locate(T, c.x, c.y, loc.idx), imp = wallHit(c, T, after);
        if (imp > 3) { const q = T.S[after.idx], sg = Math.sign(after.lat) || 1; crash(r, c.x + q.nx * sg * 1.1, c.y + q.ny * sg * 1.1, imp, '#d8d8d8'); }
        emit(r, dt);
        if (c.drifting && skids.length < 1400) { skids.push([c.x - Math.cos(c.h) * 1.4 - Math.sin(c.h) * 0.8, c.y - Math.sin(c.h) * 1.4 + Math.cos(c.h) * 0.8, c.h], [c.x - Math.cos(c.h) * 1.4 + Math.sin(c.h) * 0.8, c.y - Math.sin(c.h) * 1.4 - Math.cos(c.h) * 0.8, c.h]); }
        if (r === me && c.drifting) r.drift += dt * Math.abs(c.vl);
      }
      if (skids.length > 1300) skids.splice(0, skids.length - 1300);
      for (let i = 0; i < racers.length; i++) for (let j = i + 1; j < racers.length; j++) {
        const A = racers[i], B = racers[j];
        if (A.remote && B.remote) continue;
        if (A.remote || B.remote) {
          // A friend's car moves itself: only the local car is pushed off it (against a stand-in that is thrown away).
          const mine = A.remote ? B : A, other = A.remote ? A : B, ghost = { ...other.car, spin: 0, dmg: 0, pull: 0 };
          const hit = collide(mine.car, ghost); if (hit > 3) crash(mine, (mine.car.x + other.car.x) / 2, (mine.car.y + other.car.y) / 2, hit, other.color || other.car.spec.color);
          continue;
        }
        const hit = collide(A.car, B.car);
        if (hit > 3) crash(A === me ? A : B, (A.car.x + B.car.x) / 2, (A.car.y + B.car.y) / 2, hit, (A === me ? B : A).color || B.car.spec.color);
      }
      stepParts(dt);
      if (remoteSmoke(dt)) { /* smoke from friends' damaged cars */ }
      for (const r of racers) {
        if (r.remote) continue;
        const was = r.finished;
        progress(r, T, clock);
        if (r.finished && !was && net) net.link.send({ t: 'fin', id: myId, ft: Math.round(r.finishT * 100) / 100 });
        if (r.finished && !was && r === me) finishedMe();
      }
      if (me && me.car.shifted !== lastShift) { lastShift = me.car.shifted; paddle = 0.18; }
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
        row('', ...(net ? [btn('Back to room', 'go', () => { showLobby(); screen = 'lobby'; })] : [btn('Race again', 'go', startLocalRace)]), ...(backToDesign && ds ? [btn('✏️ Back to designer', '', () => { screen = 'design'; designUI(); })] : []), btn('Menu', '', () => { closeNet(); backToDesign = false; showMenu(); })));
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
      if (screen === 'design') { drawDesign(); return; }
      if (me && viewMode !== 'top' && screen !== 'menu' && screen !== 'lobby') { draw3D(viewMode); drawHud(); return; }
      const v = me ? Math.hypot(me.car.vx, me.car.vy) : 0;
      const view = (screen === 'menu' || screen === 'lobby' || !me) ? null : me;
      let cx, cy;
      if (view) { cx = view.car.x + view.car.vx * 0.35; cy = view.car.y + view.car.vy * 0.35; } else { const t = Date.now() / 1000; const q = T.S[Math.floor((t * 12) % T.m)]; cx = q.x; cy = q.y; }
      camX += (cx - camX) * (view ? 0.2 : 0.08); camY += (cy - camY) * (view ? 0.2 : 0.08);
      const sc = Math.min(W, H) / (80 + (view ? 0.9 * v : 20));
      const sx = shake > 0 ? (Math.random() - 0.5) * shake * 8 * dpr : 0, sy = shake > 0 ? (Math.random() - 0.5) * shake * 8 * dpr : 0;
      g.setTransform(1, 0, 0, 1, 0, 0);
      g.fillStyle = T.ground || '#1e4a2c'; g.fillRect(0, 0, W, H);
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
      // The barriers each side.
      for (const sg of [-1, 1]) { const o = sg * (T.width / 2 + 7); g.beginPath(); T.S.forEach((q, i) => { const x = q.x + q.nx * o, y = q.y + q.ny * o; i ? g.lineTo(x, y) : g.moveTo(x, y); }); if (T.closed) g.closePath(); g.strokeStyle = '#c9ccd2'; g.lineWidth = 1; g.stroke(); }
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
        if (c.dmg > 0.3) { g.save(); g.translate(c.x, c.y); g.rotate(c.h); g.fillStyle = `rgba(0,0,0,${c.dmg * 0.45})`; g.beginPath(); g.roundRect(-CAR_LEN / 2, -CAR_W / 2, CAR_LEN, CAR_W, 0.6); g.fill(); g.restore(); }
        if (r !== me) { g.fillStyle = '#fff'; g.font = '3.2px system-ui'; g.textAlign = 'center'; g.fillText(r.name, c.x, c.y - 3); }
      }
      for (const p of parts) {
        if (p.k === 'smoke') { g.fillStyle = p.dust ? `rgba(150,120,80,${clamp(p.life, 0, 1) * 0.35})` : `rgba(${p.dark * 255 | 0},${p.dark * 255 | 0},${p.dark * 255 | 0},${clamp(p.life, 0, 1) * 0.4})`; g.beginPath(); g.arc(p.x, p.y, p.size, 0, 7); g.fill(); }
        else if (p.k === 'fire') { g.fillStyle = `rgba(255,${120 + Math.random() * 100 | 0},30,${clamp(p.life * 2, 0, 1)})`; g.beginPath(); g.arc(p.x, p.y, p.size, 0, 7); g.fill(); }
        else if (p.k === 'spark') { g.fillStyle = '#ffd36b'; g.fillRect(p.x - 0.15, p.y - 0.15, 0.3, 0.3); }
        else { g.save(); g.translate(p.x, p.y); g.rotate(p.rot); g.fillStyle = p.col; g.fillRect(-p.size / 2, -p.size / 3, p.size, p.size * 0.66); g.restore(); }
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
      // Speed, gear, revs and damage (the cockpit has its own on the wheel).
      const kmh = Math.round(Math.hypot(me.car.vx, me.car.vy) * KMH), c = me.car, rr = clamp((c.rpm - c.spec.idle) / (c.spec.redline - c.spec.idle), 0, 1);
      if (viewMode !== 'cockpit') {
        g.fillStyle = 'rgba(8,12,22,.6)'; g.beginPath(); g.roundRect(W - 150 * s, H - 64 * s, 142 * s, 56 * s, 8 * s); g.fill();
        g.fillStyle = '#fff'; g.textAlign = 'right'; g.font = `800 ${26 * s}px system-ui`; g.fillText(String(kmh), W - 44 * s, H - 26 * s);
        g.font = `600 ${10 * s}px system-ui`; g.fillStyle = 'rgba(255,255,255,.7)'; g.textAlign = 'left'; g.fillText('km/h', W - 40 * s, H - 26 * s);
        g.font = `900 ${24 * s}px system-ui`; g.fillStyle = rr > 0.92 ? '#ff4d4d' : '#ffd166'; g.fillText(gearName(c), W - 142 * s, H - 26 * s);
        g.fillStyle = 'rgba(255,255,255,.15)'; g.fillRect(W - 142 * s, H - 18 * s, 126 * s, 5 * s);
        g.fillStyle = rr > 0.92 ? '#ff4d4d' : rr > 0.75 ? '#ffd166' : '#4fe09a'; g.fillRect(W - 142 * s, H - 18 * s, 126 * s * rr, 5 * s);
      }
      if (c.dmg > 0.03) { g.textAlign = 'left'; g.font = `800 ${10 * s}px system-ui`; g.fillStyle = c.dmg > 0.75 ? '#ff4d4d' : c.dmg > 0.4 ? '#ff9f43' : '#ffd166'; g.fillText(c.dmg >= 1 ? 'WRECKED: limping home' : `DAMAGE ${Math.round(c.dmg * 100)}%`, 16 * s, 86 * s); }
      if (me.car.drifting) { g.fillStyle = '#ffd166'; g.font = `900 ${14 * s}px system-ui`; g.textAlign = 'center'; g.fillText(`DRIFT  ${Math.round(me.drift * 10)}`, W / 2, H - 16 * s); }
      if (me.car.onGrass) { g.fillStyle = '#ff9f43'; g.font = `800 ${12 * s}px system-ui`; g.textAlign = 'center'; g.fillText('OFF TRACK', W / 2, viewMode === 'cockpit' ? H * 0.2 : 24 * s); }
      if (me.car.hit > 0.6 && viewMode !== 'top') { g.fillStyle = `rgba(255,40,40,${(me.car.hit - 0.6) * 0.3})`; g.fillRect(0, 0, W, H); }
      // Minimap.
      const mw = 96 * s, mh = 96 * s, mx = W - mw - 8 * s, my = 8 * s, [x0, y0, x1, y1] = T.bounds, k = Math.min((mw - 12 * s) / (x1 - x0 || 1), (mh - 12 * s) / (y1 - y0 || 1));
      const mp = (x, y) => [mx + 6 * s + (x - x0) * k + ((mw - 12 * s) - (x1 - x0) * k) / 2, my + 6 * s + (y - y0) * k + ((mh - 12 * s) - (y1 - y0) * k) / 2];
      g.fillStyle = 'rgba(8,12,22,.6)'; g.beginPath(); g.roundRect(mx, my, mw, mh, 8 * s); g.fill();
      g.strokeStyle = 'rgba(255,255,255,.8)'; g.lineWidth = 2 * s; g.beginPath(); T.S.forEach((q, i) => { const p = mp(q.x, q.y); i ? g.lineTo(p[0], p[1]) : g.moveTo(p[0], p[1]); }); if (T.closed) g.closePath(); g.stroke();
      for (const r of racers) { const p = mp(r.car.x, r.car.y); g.fillStyle = r === me ? '#fff' : (r.color || '#aaa'); g.beginPath(); g.arc(p[0], p[1], (r === me ? 3.6 : 2.6) * s, 0, 7); g.fill(); }
    }

    // ---- the 3D views: a chase camera behind the car, or the driver's seat with the wheel, the gears and the revs.
    const gearName = (c) => (c.gear < 0 ? 'R' : c.gear === 0 ? 'N' : String(c.gear));
    const shade = (hex, k) => { const n = parseInt(hex.slice(1), 16); const f = (v) => clamp(Math.round(v * k), 0, 255); return `rgb(${f(n >> 16)},${f((n >> 8) & 255)},${f(n & 255)})`; };
    const hash01 = (i, salt = 0) => { let h = Math.imul((i + 1) * 374761393 + salt * 668265263, 1274126177); h ^= h >>> 13; h = Math.imul(h, 1103515245); return ((h ^ (h >>> 16)) >>> 0) / 4294967296; };
    function draw3D(mode) {
      const c = me.car, sp = c.spec, cock = mode === 'cockpit';
      if (!cock) chaseYaw += wrapPi(c.h - chaseYaw) * 0.14; else chaseYaw = c.h;
      const yaw = cock ? c.h : chaseYaw, cs = Math.cos(yaw), sn = Math.sin(yaw);
      const jx = shake > 0 ? (Math.random() - 0.5) * shake * 0.5 : 0, jz = shake > 0 ? (Math.random() - 0.5) * shake * 0.3 : 0;
      const ex = (cock ? c.x - Math.cos(c.h) * 0.3 : c.x - cs * 8.5) + jx, ey = (cock ? c.y - Math.sin(c.h) * 0.3 : c.y - sn * 8.5) + jx;
      const ez = (cock ? (sp.id === 'f1' ? 0.78 : 1.12) : 3.1) + jz;
      const F = (W / 2) / Math.tan((cock ? 1.3 : 1.12) / 2), hy = H * (cock ? 0.44 : 0.36), NEAR = 0.35;
      const cam = (x, y, z) => { const dx = x - ex, dy = y - ey; return [dx * cs + dy * sn, -dx * sn + dy * cs, z - ez]; };
      const scr = (p) => [W / 2 + (p[1] / p[0]) * F, hy - (p[2] / p[0]) * F];
      const poly = (pts, fill) => {
        const out = [];
        for (let i = 0; i < pts.length; i++) {
          const a = pts[i], b = pts[(i + 1) % pts.length], ai = a[0] >= NEAR, bi = b[0] >= NEAR;
          if (ai) out.push(a);
          if (ai !== bi) { const t = (NEAR - a[0]) / (b[0] - a[0]); out.push([NEAR, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]); }
        }
        if (out.length < 3) return;
        g.beginPath(); out.forEach((p, i) => { const q = scr(p); i ? g.lineTo(q[0], q[1]) : g.moveTo(q[0], q[1]); }); g.closePath(); g.fillStyle = fill; g.fill();
      };
      // A strip along the road from offset o0 to o1 (metres, + is right), at height z0..z1 when it stands up (a barrier).
      const strip = (a, b, o0, o1, fill, z0 = 0, z1 = 0) => {
        if (z1 > z0) poly([cam(a.x + a.nx * o0, a.y + a.ny * o0, z0), cam(b.x + b.nx * o0, b.y + b.ny * o0, z0), cam(b.x + b.nx * o0, b.y + b.ny * o0, z1), cam(a.x + a.nx * o0, a.y + a.ny * o0, z1)], fill);
        else poly([cam(a.x + a.nx * o0, a.y + a.ny * o0, z0), cam(b.x + b.nx * o0, b.y + b.ny * o0, z0), cam(b.x + b.nx * o1, b.y + b.ny * o1, z0), cam(a.x + a.nx * o1, a.y + a.ny * o1, z0)], fill);
      };
      const box = (x, y, h, z0, L, Wd, Hh, col) => {
        const ca = Math.cos(h), sa = Math.sin(h), pt = (u, v, z) => cam(x + ca * u - sa * v, y + sa * u + ca * v, z);
        const c4 = [[L / 2, -Wd / 2], [L / 2, Wd / 2], [-L / 2, Wd / 2], [-L / 2, -Wd / 2]];
        const faces = [];
        for (let i = 0; i < 4; i++) { const p = c4[i], q = c4[(i + 1) % 4]; faces.push({ v: [pt(p[0], p[1], z0), pt(q[0], q[1], z0), pt(q[0], q[1], z0 + Hh), pt(p[0], p[1], z0 + Hh)], col: shade(col, i % 2 ? 0.62 : 0.8) }); }
        faces.push({ v: c4.map((p) => pt(p[0], p[1], z0 + Hh)), col: shade(col, 1) });
        for (const f of faces) f.d = f.v.reduce((m, p) => m + p[0], 0) / f.v.length;
        faces.sort((a, b) => b.d - a.d).forEach((f) => poly(f.v, f.col));
      };
      const carModel = (r) => {
        const k = r.car, col = r.color || k.spec.color, dm = 1 - k.dmg * 0.4, body = k.dmg > 0.2 ? shade(col, dm) : col;
        if (k.spec.id === 'f1') {
          box(k.x, k.y, k.h, 0.12, 4.8, 0.9, 0.5, body); box(k.x - Math.cos(k.h) * 2.2, k.y - Math.sin(k.h) * 2.2, k.h, 0.7, 0.5, 1.9, 0.12, '#1a1a1a');
          box(k.x + Math.cos(k.h) * 2.3, k.y + Math.sin(k.h) * 2.3, k.h, 0.08, 0.4, 1.9, 0.08, '#1a1a1a');
          for (const [u, v] of [[1.6, 0.95], [1.6, -0.95], [-1.5, 0.95], [-1.5, -0.95]]) box(k.x + Math.cos(k.h) * u - Math.sin(k.h) * v, k.y + Math.sin(k.h) * u + Math.cos(k.h) * v, k.h, 0, 0.7, 0.45, 0.65, '#151515');
        } else {
          box(k.x, k.y, k.h, 0.22, CAR_LEN, CAR_W, 0.7, body);
          box(k.x - Math.cos(k.h) * 0.3, k.y - Math.sin(k.h) * 0.3, k.h, 0.92, 2.1, 1.65, 0.5, '#1d2533');
          if (k.spec.id === 'gt3') box(k.x - Math.cos(k.h) * 2.1, k.y - Math.sin(k.h) * 2.1, k.h, 1.15, 0.35, 1.9, 0.08, '#111');
        }
      };
      // Sky and ground.
      const night = T.ground === GROUND.night, sky = g.createLinearGradient(0, 0, 0, hy);
      sky.addColorStop(0, night ? '#05070d' : '#3d86d1'); sky.addColorStop(1, night ? '#1a2235' : '#cfe4f4');
      g.setTransform(1, 0, 0, 1, 0, 0); g.fillStyle = sky; g.fillRect(0, 0, W, hy + 2); g.fillStyle = T.ground; g.fillRect(0, hy, W, H - hy);
      g.fillStyle = shade(T.ground, 0.8); g.fillRect(0, hy, W, Math.max(2, H * 0.01));
      // The road, from far to near, with whatever stands by it in between.
      const N = Math.min(150, T.closed ? T.m - 4 : 150), back = cock ? 1 : 4, idx0 = me.idx, wd = T.width / 2, wall = wd + 7;
      const bucket = new Map(), put = (k, f) => { if (!bucket.has(k)) bucket.set(k, []); bucket.get(k).push(f); };
      for (const r of racers) {
        if (r === me && cock) continue;
        let kk = r.idx - idx0; if (T.closed) { if (kk > T.m / 2) kk -= T.m; if (kk < -T.m / 2) kk += T.m; }
        if (kk >= -back && kk <= N) put(kk, () => carModel(r));
      }
      const ground = T.ground, road = '#3a3d44';
      for (let k = N; k >= -back; k--) {
        let i = idx0 + k;
        if (T.closed) i = ((i % T.m) + T.m) % T.m; else if (i < 0 || i >= T.m - 1) continue;
        const a = T.S[i], b = T.S[T.closed ? (i + 1) % T.m : i + 1], band = Math.floor(a.s / 12) % 2;
        strip(a, b, -wall - 60, -wd - 1.2, shade(ground, band ? 0.93 : 1.04)); strip(a, b, wd + 1.2, wall + 60, shade(ground, band ? 0.93 : 1.04));
        strip(a, b, -wd, wd, band ? '#383b42' : road);
        const kerb = Math.floor(a.s / 4) % 2 ? '#e8e8e8' : '#d63a3a', curvy = Math.abs(a.k) > 0.004;
        strip(a, b, -wd - 1.2, -wd, curvy ? kerb : '#e8e8e8'); strip(a, b, wd, wd + 1.2, curvy ? kerb : '#e8e8e8');
        if (Math.floor(a.s / 8) % 2 === 0) strip(a, b, -0.18, 0.18, 'rgba(255,255,255,.75)');
        if (i === 0 || (!T.closed && i >= T.m - 3)) for (let q = 0; q < 8; q++) strip(a, b, -wd + (q * T.width) / 8, -wd + ((q + 1) * T.width) / 8, q % 2 ? '#111' : '#fff');
        // Scenery: deterministic from the sample number, so it is always in the same place.
        const h1 = hash01(i, 3);
        if (T.scenery !== 'none' && h1 < 0.18) {
          const side = hash01(i, 5) < 0.5 ? -1 : 1, off = side * (wall + 6 + hash01(i, 7) * 34), x = a.x + a.nx * off, y = a.y + a.ny * off;
          if (T.scenery === 'blocks') box(x, y, Math.atan2(a.ty, a.tx), 0, 16, 12, 8 + hash01(i, 9) * 26, ['#7d8590', '#9a8f84', '#6f7e8c', '#a3a3a3'][Math.floor(hash01(i, 11) * 4)]);
          else if (T.scenery === 'tyres') box(x, y, 0, 0, 1.4, 1.4, 1.2, '#1b1b1b');
          else {
            const p = cam(x, y, 0);
            if (p[0] > NEAR) {
              const [sx, sy] = scr(p), u = F / p[0], hgt = (T.scenery === 'cacti' ? 4 : 9 + hash01(i, 13) * 6) * u;
              if (T.scenery === 'pines') { g.fillStyle = '#5a3d22'; g.fillRect(sx - 0.25 * u, sy - hgt * 0.25, 0.5 * u, hgt * 0.25); g.fillStyle = T.ground === GROUND.snow ? '#2f5a44' : '#244d2c'; g.beginPath(); g.moveTo(sx, sy - hgt); g.lineTo(sx - 2.4 * u, sy - hgt * 0.2); g.lineTo(sx + 2.4 * u, sy - hgt * 0.2); g.fill(); }
              else if (T.scenery === 'cacti') { g.fillStyle = '#3f7a3a'; g.fillRect(sx - 0.35 * u, sy - hgt, 0.7 * u, hgt); g.fillRect(sx - 1.2 * u, sy - hgt * 0.7, 0.85 * u, 0.4 * u); g.fillRect(sx - 1.2 * u, sy - hgt * 0.95, 0.4 * u, hgt * 0.3); }
              else { g.fillStyle = '#5a3d22'; g.fillRect(sx - 0.3 * u, sy - hgt * 0.45, 0.6 * u, hgt * 0.45); g.fillStyle = '#2f6b33'; g.beginPath(); g.arc(sx, sy - hgt * 0.62, 2.6 * u, 0, 7); g.fill(); }
            }
          }
        }
        // Barriers: armco on poles, red and white blocks round the bends.
        const bc = curvy ? (Math.floor(a.s / 4) % 2 ? '#e8e8e8' : '#c0392b') : '#b9bec6';
        strip(a, b, -wall, -wall, bc, 0, 0.95); strip(a, b, wall, wall, bc, 0, 0.95);
        const items = bucket.get(k); if (items) items.forEach((f) => f());
      }
      // Smoke, flames, sparks and bits of car, far to near.
      const ps = parts.map((p) => ({ p, c: cam(p.x, p.y, p.z) })).filter((o) => o.c[0] > NEAR && o.c[0] < 300).sort((a, b) => b.c[0] - a.c[0]);
      for (const { p, c: pc } of ps) {
        const [sx, sy] = scr(pc), u = F / pc[0];
        if (p.k === 'smoke') { const v = p.dark * 255 | 0; g.fillStyle = p.dust ? `rgba(150,120,80,${clamp(p.life, 0, 1) * 0.35})` : `rgba(${v},${v},${v},${clamp(p.life, 0, 1) * 0.42})`; g.beginPath(); g.arc(sx, sy, p.size * u, 0, 7); g.fill(); }
        else if (p.k === 'fire') { g.fillStyle = `rgba(255,${120 + Math.random() * 110 | 0},30,${clamp(p.life * 2, 0, 1)})`; g.beginPath(); g.arc(sx, sy, p.size * u, 0, 7); g.fill(); }
        else if (p.k === 'spark') { g.fillStyle = '#ffe08a'; const z = Math.max(1.5, 0.25 * u); g.fillRect(sx - z / 2, sy - z / 2, z, z); }
        else { g.save(); g.translate(sx, sy); g.rotate(p.rot); g.fillStyle = p.col; g.fillRect(-p.size * u / 2, -p.size * u / 3, p.size * u, p.size * u * 0.66); g.restore(); }
      }
      if (cock) drawCockpit();
    }
    /// The driver's view: the car's nose (or an F1 car's halo), the dashboard, the shift lights and a steering wheel that turns
    /// with the front wheels, showing the gear and the speed; the paddles flash at each change.
    function drawCockpit() {
      const c = me.car, sp = c.spec, s = Math.min(W, H) / 400, f1 = sp.id === 'f1', rr = clamp((c.rpm - sp.idle) / (sp.redline - sp.idle), 0, 1);
      g.setTransform(1, 0, 0, 1, 0, 0);
      if (f1) {
        g.fillStyle = shade(sp.color, 0.85); g.beginPath(); g.moveTo(W / 2 - 40 * s, H); g.lineTo(W / 2 - 9 * s, H * 0.6); g.lineTo(W / 2 + 9 * s, H * 0.6); g.lineTo(W / 2 + 40 * s, H); g.fill();
        g.fillStyle = '#111'; g.fillRect(W / 2 - 5 * s, 0, 10 * s, H * 0.5); g.beginPath(); g.moveTo(0, H * 0.22); g.quadraticCurveTo(W / 2, -H * 0.02, W, H * 0.22); g.lineTo(W, H * 0.16); g.quadraticCurveTo(W / 2, -H * 0.08, 0, H * 0.16); g.fill();
        g.fillStyle = '#0c0d10'; g.beginPath(); g.moveTo(0, H); g.lineTo(0, H * 0.74); g.quadraticCurveTo(W * 0.2, H * 0.7, W * 0.32, H * 0.8); g.lineTo(W * 0.68, H * 0.8); g.quadraticCurveTo(W * 0.8, H * 0.7, W, H * 0.74); g.lineTo(W, H); g.fill();
      } else {
        g.fillStyle = '#0c0d10';
        g.beginPath(); g.moveTo(0, 0); g.lineTo(W * 0.07, 0); g.lineTo(W * 0.02, H * 0.72); g.lineTo(0, H * 0.75); g.fill();
        g.beginPath(); g.moveTo(W, 0); g.lineTo(W * 0.93, 0); g.lineTo(W * 0.98, H * 0.72); g.lineTo(W, H * 0.75); g.fill();
        g.fillRect(0, 0, W, H * 0.035);
        g.beginPath(); g.moveTo(0, H); g.lineTo(0, H * 0.72); g.quadraticCurveTo(W / 2, H * 0.62, W, H * 0.72); g.lineTo(W, H); g.fill();
        g.fillStyle = '#181a20'; g.beginPath(); g.moveTo(W * 0.3, H); g.lineTo(W * 0.33, H * 0.72); g.quadraticCurveTo(W / 2, H * 0.66, W * 0.67, H * 0.72); g.lineTo(W * 0.7, H); g.fill();
        // The rear-view mirror shows the nearest car behind.
        g.fillStyle = '#222'; g.beginPath(); g.roundRect(W / 2 - 52 * s, H * 0.045, 104 * s, 22 * s, 5 * s); g.fill();
        g.fillStyle = '#9fb6c8'; g.beginPath(); g.roundRect(W / 2 - 48 * s, H * 0.045 + 3 * s, 96 * s, 16 * s, 4 * s); g.fill();
        const behind = racers.filter((r) => r !== me && r.prog < me.prog && me.prog - r.prog < 80).sort((a, b) => b.prog - a.prog)[0];
        if (behind) { const d = me.prog - behind.prog, w = clamp(40 / Math.max(d, 4), 3, 30) * s; g.fillStyle = behind.color || behind.car.spec.color; g.fillRect(W / 2 - w / 2 - clamp(behind.lat - me.lat, -10, 10) * 2 * s, H * 0.045 + 11 * s - w * 0.25, w, w * 0.5); }
      }
      // Shift lights.
      const n = 10, lw = 9 * s, top = H * (f1 ? 0.7 : 0.66);
      for (let i = 0; i < n; i++) { const on = rr > i / n, col = i < 4 ? '#29d36b' : i < 7 ? '#ffcc33' : '#ff3b3b'; g.fillStyle = on ? (rr > 0.95 && (Date.now() / 70 | 0) % 2 ? '#5aa8ff' : col) : 'rgba(255,255,255,.08)'; g.beginPath(); g.arc(W / 2 + (i - (n - 1) / 2) * lw * 1.3, top, lw / 2, 0, 7); g.fill(); }
      // The wheel turns with the front wheels (about a quarter turn either way).
      const ang = (c.steerA / sp.steer) * 1.7, R0 = 78 * s;
      g.save(); g.translate(W / 2, H * 0.97); g.rotate(ang);
      const kmh = Math.round(Math.hypot(c.vx, c.vy) * KMH);
      if (f1) {
        g.fillStyle = '#16171b'; g.beginPath(); g.roundRect(-R0 * 1.25, -R0 * 0.95, R0 * 2.5, R0 * 0.95, 18 * s); g.fill();
        g.fillStyle = '#2a2c33'; g.fillRect(-R0 * 1.25, -R0 * 0.95, R0 * 0.35, R0 * 0.95); g.fillRect(R0 * 0.9, -R0 * 0.95, R0 * 0.35, R0 * 0.95);
        g.fillStyle = '#06210f'; g.beginPath(); g.roundRect(-R0 * 0.5, -R0 * 0.82, R0, R0 * 0.48, 6 * s); g.fill();
        g.fillStyle = paddle > 0 ? '#ffd166' : '#3a3d46'; g.fillRect(-R0 * 1.15, -R0 * 1.15, R0 * 0.5, 8 * s); g.fillRect(R0 * 0.65, -R0 * 1.15, R0 * 0.5, 8 * s);
        g.fillStyle = '#4fe09a'; g.textAlign = 'center'; g.font = `900 ${28 * s}px system-ui`; g.fillText(gearName(c), 0, -R0 * 0.44);
        g.font = `700 ${9 * s}px system-ui`; g.fillStyle = '#fff'; g.fillText(`${kmh}`, -R0 * 0.36, -R0 * 0.62); g.fillText('km/h', -R0 * 0.36, -R0 * 0.48); g.fillText(`${(c.rpm / 1000).toFixed(1)}k`, R0 * 0.36, -R0 * 0.62); g.fillText('rpm', R0 * 0.36, -R0 * 0.48);
        for (const sx of [-1, 1]) { g.fillStyle = '#222'; g.beginPath(); g.ellipse(sx * R0 * 1.08, -R0 * 0.45, 16 * s, 26 * s, 0, 0, 7); g.fill(); }
      } else {
        g.lineWidth = 13 * s; g.strokeStyle = '#18191d'; g.beginPath(); g.arc(0, -R0, R0, 0, 7); g.stroke();
        g.lineWidth = 3 * s; g.strokeStyle = '#ffd166'; g.beginPath(); g.arc(0, -R0, R0, -Math.PI / 2 - 0.08, -Math.PI / 2 + 0.08); g.stroke();
        g.fillStyle = '#18191d'; g.fillRect(-R0, -R0 - 7 * s, R0 * 2, 14 * s); g.fillRect(-7 * s, -R0, 14 * s, R0 * 0.9);
        g.fillStyle = '#26282f'; g.beginPath(); g.arc(0, -R0, 28 * s, 0, 7); g.fill();
        g.fillStyle = shade(sp.color, 1); g.beginPath(); g.arc(0, -R0, 9 * s, 0, 7); g.fill();
        g.fillStyle = paddle > 0 ? '#ffd166' : '#3a3d46'; g.fillRect(-R0 - 10 * s, -R0 - 30 * s, 9 * s, 24 * s); g.fillRect(R0 + 1 * s, -R0 - 30 * s, 9 * s, 24 * s);
        for (const sx of [-1, 1]) { g.fillStyle = '#222'; g.beginPath(); g.ellipse(sx * R0, -R0 + 4 * s, 14 * s, 22 * s, sx * 0.3, 0, 7); g.fill(); }
      }
      g.restore();
      if (!f1) {
        // Dials on the dashboard: speed and revs, and the gear between them.
        const dial = (x, v, max, label, red) => { const y = H * 0.79, r = 30 * s; g.fillStyle = '#08090c'; g.beginPath(); g.arc(x, y, r, 0, 7); g.fill(); g.strokeStyle = 'rgba(255,255,255,.25)'; g.lineWidth = 2 * s; g.beginPath(); g.arc(x, y, r - 4 * s, Math.PI * 0.75, Math.PI * 2.25); g.stroke(); if (red) { g.strokeStyle = '#ff3b3b'; g.beginPath(); g.arc(x, y, r - 4 * s, Math.PI * 0.75 + Math.PI * 1.5 * red, Math.PI * 2.25); g.stroke(); } const a = Math.PI * 0.75 + Math.PI * 1.5 * clamp(v / max, 0, 1); g.strokeStyle = '#ff7a1a'; g.lineWidth = 2.5 * s; g.beginPath(); g.moveTo(x, y); g.lineTo(x + Math.cos(a) * (r - 6 * s), y + Math.sin(a) * (r - 6 * s)); g.stroke(); g.fillStyle = 'rgba(255,255,255,.7)'; g.font = `600 ${7 * s}px system-ui`; g.textAlign = 'center'; g.fillText(label, x, y + 16 * s); };
        dial(W / 2 - 120 * s, kmh, Math.ceil(sp.vmax * KMH / 50) * 50 + 50, `${kmh} km/h`, 0);
        dial(W / 2 + 120 * s, c.rpm, sp.redline * 1.05, `${Math.round(c.rpm / 100) * 100} rpm`, 0.86);
        g.fillStyle = rr > 0.92 ? '#ff4d4d' : '#ffd166'; g.font = `900 ${20 * s}px system-ui`; g.textAlign = 'center'; g.fillText(gearName(c), W / 2 + 120 * s, H * 0.79 - 6 * s);
      }
      if (c.dmg > 0.5) { g.strokeStyle = 'rgba(255,255,255,.35)'; g.lineWidth = 1.2 * s; g.beginPath(); for (let i = 0; i < 6 * c.dmg; i++) { const x0 = W * (0.25 + hash01(i, 21) * 0.5), y0 = H * (0.1 + hash01(i, 23) * 0.3); g.moveTo(x0, y0); g.lineTo(x0 + (hash01(i, 25) - 0.5) * 120 * s, y0 + (hash01(i, 27) - 0.5) * 80 * s); } g.stroke(); }
    }

    // ---- the track designer: click to put points down, drag them about, right-click (or double-click) to take one away.
    // The road follows the points as a smooth curve and is checked as you go; drive it at once, save it, or share it as a code.
    function openDesigner(def) {
      closeNet(); paused = false;
      ds = { name: def ? def.name : 'My track', closed: def ? def.closed : true, width: def ? def.width : 32, look: def ? def.look || 'green' : 'green', laps: def ? def.laps || 3 : 3, pts: def ? def.pts.map((p) => p.slice()) : [], hist: [], drag: -1, hover: -1, view: null, code: '' };
      designFit(); screen = 'design'; designUI();
    }
    const designDef = () => customDef({ name: ds.name, closed: ds.closed, width: ds.width, look: ds.look, laps: ds.laps, pts: ds.pts });
    function designFit() {
      if (ds.pts.length < 2) { ds.view = { cx: 0, cy: -350, span: 2400 }; return; }
      let x0 = 1e9, x1 = -1e9, y0 = 1e9, y1 = -1e9; for (const [x, y] of ds.pts) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); }
      ds.view = { cx: (x0 + x1) / 2, cy: (y0 + y1) / 2, span: Math.max(900, (x1 - x0) * 1.35, (y1 - y0) * 1.35 * 1.5) };
    }
    function designCheck() { const d = designDef(); ds.check = checkTrack(d); return ds.check; }
    function designEdit(fn) { ds.hist.push(JSON.stringify([ds.pts, ds.closed, ds.width])); if (ds.hist.length > 80) ds.hist.shift(); fn(); designCheck(); designUI(); }
    function designUndo() { const h = ds && ds.hist.pop(); if (!h) return; [ds.pts, ds.closed, ds.width] = JSON.parse(h); designCheck(); designUI(); }
    function designUI() {
      if (!ds) return;
      ui.classList.add('rc-side');
      const ck = ds.check || designCheck();
      const name = document.createElement('input'); name.value = ds.name; name.maxLength = 24; name.style.cssText = 'width:150px;text-transform:none;letter-spacing:0';
      name.oninput = () => { ds.name = name.value.trim() || 'My track'; };
      const code = document.createElement('input'); code.placeholder = 'Paste a track code'; code.value = ds.code || ''; code.style.cssText = 'width:150px;text-transform:none;letter-spacing:0;font-size:10px';
      const mine = customs();
      const status = hint(ck.ok ? `✓ Drivable: ${(ck.T.length / 1000).toFixed(2)} km` : ck.why); status.style.color = ck.ok ? '#4fe09a' : '#ffb35c'; status.style.opacity = '1';
      card(head('✏️ Track designer'),
        row('', name),
        row('', ...[[true, 'Loop'], [false, 'Sprint']].map(([v, l]) => btn(l, ds.closed === v ? 'on' : '', () => designEdit(() => { ds.closed = v; })))),
        row('', ...[[26, 'Narrow'], [32, 'Normal'], [40, 'Wide']].map(([v, l]) => btn(l, ds.width === v ? 'on' : '', () => designEdit(() => { ds.width = v; })))),
        row('', ...Object.entries(GROUNDS).map(([id, gr]) => btn(gr.label, ds.look === id ? 'on' : '', () => { ds.look = id; designUI(); }))),
        ...(ds.closed ? [row('Laps', ...[1, 3, 5].map((n) => btn(String(n), ds.laps === n ? 'on' : '', () => { ds.laps = n; designUI(); })))] : []),
        status,
        row('', btn('Test drive', 'go', designDrive), btn('Save', '', designSave)),
        row('', btn('Share code', '', designShare), btn('Undo', '', designUndo), btn('Clear', '', () => designEdit(() => { ds.pts = []; }))),
        row('', code, btn('Load', '', () => { const d = decodeTrack(code.value); if (!d) { ds.code = code.value; toast('That code is not a valid track.'); designUI(); return; } designEdit(() => { Object.assign(ds, { name: d.name, closed: d.closed, width: d.width, look: d.look, laps: d.laps, pts: d.pts.map((p) => p.slice()), code: '' }); }); designFit(); })),
        ...(mine.length ? [hint('My tracks'), ...mine.slice(0, 12).map((d) => row('', btn(d.name, '', () => { ds.hist.push(JSON.stringify([ds.pts, ds.closed, ds.width])); Object.assign(ds, { name: d.name, closed: d.closed, width: d.width, look: d.look, laps: d.laps, pts: d.pts.map((p) => p.slice()) }); designFit(); designCheck(); designUI(); }), btn('✕', '', () => { store.set('custom', (store.get('custom', []) || []).filter((x) => customDef(x).id !== d.id)); designUI(); })))] : []),
        row('', btn('Back', '', () => { ds = null; showMenu(); })),
        hint('Click to add points · drag to move · right-click or double-click to remove · Z undo · the green dot is the start'));
    }
    function designDrive() {
      const ck = designCheck(); if (!ck.ok) { toast(ck.why); return; }
      const d = designDef(); tempDefs[d.id] = d; delete trackCache[d.id];
      trackId = d.id; lapsSel = d.closed ? ds.laps : 1; T = getTrack(trackId); backToDesign = true; ui.classList.remove('rc-side'); startLocalRace();
    }
    function designSave() {
      const ck = designCheck(); if (!ck.ok) { toast(ck.why); return; }
      const d = designDef(), list = (store.get('custom', []) || []).filter((x) => customDef(x).id !== d.id && x.name !== d.name);
      list.unshift({ name: d.name, closed: d.closed, width: d.width, look: d.look, laps: d.laps, pts: d.pts }); store.set('custom', list.slice(0, 20));
      trackId = d.id; store.set('track', trackId); toast(`Saved "${d.name}": it is in the Track list now.`); designUI();
    }
    function designShare() {
      const ck = designCheck(); if (!ck.ok) { toast(ck.why); return; }
      ds.code = encodeTrack(designDef()); designUI();
      try { navigator.clipboard.writeText(ds.code).then(() => toast('Code copied. Friends paste it in Load.'), () => toast('Copy the code from the box.')); } catch { toast('Copy the code from the box.'); }
    }
    // Screen <-> world for the designer (the panel on the left is left clear).
    const dsArea = () => { const pw = (ui.firstElementChild && ui.firstElementChild.getBoundingClientRect().width || 0) * dpr + 16 * dpr; return { x0: pw, w: Math.max(50, W - pw), h: H }; };
    const dsScale = () => { const a = dsArea(); return Math.min(a.w / ds.view.span, a.h / (ds.view.span / 1.5)); };
    const dsToScreen = (x, y) => { const a = dsArea(), k = dsScale(); return [a.x0 + a.w / 2 + (x - ds.view.cx) * k, a.h / 2 + (y - ds.view.cy) * k]; };
    const dsToWorld = (px, py) => { const a = dsArea(), k = dsScale(); return [ds.view.cx + (px - a.x0 - a.w / 2) / k, ds.view.cy + (py - a.h / 2) / k]; };
    const evPos = (e) => { const r = cv.getBoundingClientRect(); return [(e.clientX - r.left) * dpr, (e.clientY - r.top) * dpr]; };
    const nearPoint = (px, py) => { let best = -1, bd = 14 * dpr; ds.pts.forEach((p, i) => { const q = dsToScreen(p[0], p[1]), d = Math.hypot(q[0] - px, q[1] - py); if (d < bd) { bd = d; best = i; } }); return best; };
    const snap = (v) => Math.round(v / 10) * 10;
    cv.addEventListener('contextmenu', (e) => { if (screen === 'design') e.preventDefault(); });
    cv.addEventListener('pointerdown', (e) => {
      if (screen !== 'design' || !ds) return;
      const [px, py] = evPos(e), i = nearPoint(px, py);
      if (e.button === 2) { if (i >= 0) designEdit(() => ds.pts.splice(i, 1)); return; }
      if (i >= 0) { ds.hist.push(JSON.stringify([ds.pts, ds.closed, ds.width])); ds.drag = i; cv.setPointerCapture(e.pointerId); return; }
      const [wx, wy] = dsToWorld(px, py), p = [snap(wx), snap(wy)];
      // On (or next to) the road between two points: put the new one in there; anywhere else it goes on the end.
      let ins = -1, bd = 16 * dpr; const n = ds.pts.length;
      for (let j = 0; j < (ds.closed ? n : n - 1) && n >= 2; j++) {
        const a = dsToScreen(...ds.pts[j]), b = dsToScreen(...ds.pts[(j + 1) % n]), dx = b[0] - a[0], dy = b[1] - a[1], l2 = dx * dx + dy * dy || 1, t = clamp(((px - a[0]) * dx + (py - a[1]) * dy) / l2, 0, 1), d = Math.hypot(a[0] + dx * t - px, a[1] + dy * t - py);
        if (d < bd && t > 0.05 && t < 0.95) { bd = d; ins = j + 1; }
      }
      designEdit(() => { if (ins >= 0) ds.pts.splice(ins, 0, p); else ds.pts.push(p); });
    });
    cv.addEventListener('pointermove', (e) => {
      if (screen !== 'design' || !ds) return;
      const [px, py] = evPos(e);
      if (ds.drag >= 0) { const [wx, wy] = dsToWorld(px, py); ds.pts[ds.drag] = [snap(wx), snap(wy)]; ds.check = null; }
      else ds.hover = nearPoint(px, py);
    });
    const dragEnd = () => { if (ds && ds.drag >= 0) { ds.drag = -1; designCheck(); designUI(); } };
    cv.addEventListener('pointerup', dragEnd); cv.addEventListener('pointercancel', dragEnd);
    cv.addEventListener('dblclick', (e) => { if (screen !== 'design' || !ds) return; const [px, py] = evPos(e), i = nearPoint(px, py); if (i >= 0) designEdit(() => ds.pts.splice(i, 1)); });
    cv.addEventListener('wheel', (e) => { if (screen !== 'design' || !ds) return; e.preventDefault(); ds.view.span = clamp(ds.view.span * (e.deltaY > 0 ? 1.12 : 0.89), 400, 9000); }, { passive: false });
    function drawDesign() {
      g.setTransform(1, 0, 0, 1, 0, 0);
      const gr = GROUNDS[ds.look] || GROUNDS.green; g.fillStyle = shade(gr.ground, 0.75); g.fillRect(0, 0, W, H);
      const k = dsScale(), step = k * 100 < 18 * dpr ? 500 : 100;
      const [wx0, wy0] = dsToWorld(0, 0), [wx1, wy1] = dsToWorld(W, H);
      g.strokeStyle = 'rgba(255,255,255,.07)'; g.lineWidth = 1; g.beginPath();
      for (let x = Math.floor(wx0 / step) * step; x < wx1; x += step) { const [sx] = dsToScreen(x, 0); g.moveTo(sx, 0); g.lineTo(sx, H); }
      for (let y = Math.floor(wy0 / step) * step; y < wy1; y += step) { const [, sy] = dsToScreen(0, y); g.moveTo(0, sy); g.lineTo(W, sy); }
      g.stroke();
      const ck = ds.check || (ds.drag >= 0 ? (ds.check = designCheck()) : designCheck());
      let Tt = ck.T; if (!Tt && ds.pts.length >= 2) { try { Tt = buildTrack(designDef()); } catch { Tt = null; } }
      if (Tt) {
        const path = () => { g.beginPath(); Tt.S.forEach((q, i) => { const p = dsToScreen(q.x, q.y); i ? g.lineTo(p[0], p[1]) : g.moveTo(p[0], p[1]); }); if (Tt.closed) g.closePath(); };
        g.lineJoin = 'round'; path(); g.strokeStyle = ck.ok ? '#e6e6e6' : '#ff8a5c'; g.lineWidth = Math.max(3, (ds.width + 3) * k); g.stroke();
        path(); g.strokeStyle = '#3a3d44'; g.lineWidth = Math.max(2, ds.width * k); g.stroke();
        if (!ck.ok && ck.bad != null && Tt.S[ck.bad]) { const p = dsToScreen(Tt.S[ck.bad].x, Tt.S[ck.bad].y); g.strokeStyle = '#ff3b3b'; g.lineWidth = 3 * dpr; g.beginPath(); g.arc(p[0], p[1], Math.max(14 * dpr, ds.width * k), 0, 7); g.stroke(); }
        const q0 = Tt.S[0], p0 = dsToScreen(q0.x, q0.y), p1 = dsToScreen(q0.x + q0.tx * 60, q0.y + q0.ty * 60);
        g.strokeStyle = '#21d07a'; g.lineWidth = 3 * dpr; g.beginPath(); g.moveTo(p0[0], p0[1]); g.lineTo(p1[0], p1[1]); g.stroke();
      }
      ds.pts.forEach((p, i) => {
        const [sx, sy] = dsToScreen(p[0], p[1]);
        g.fillStyle = i === 0 ? '#21d07a' : (!ds.closed && i === ds.pts.length - 1) ? '#fff' : i === ds.hover || i === ds.drag ? '#ffd166' : '#5b6cff';
        g.beginPath(); g.arc(sx, sy, (i === ds.hover || i === ds.drag ? 8 : 6) * dpr, 0, 7); g.fill();
        g.fillStyle = '#fff'; g.font = `700 ${9 * dpr}px system-ui`; g.textAlign = 'center'; g.fillText(String(i + 1), sx, sy - 10 * dpr);
      });
      const a = dsArea(); g.fillStyle = 'rgba(255,255,255,.8)'; g.font = `600 ${10 * dpr}px system-ui`; g.textAlign = 'left';
      g.fillRect(a.x0 + 12 * dpr, H - 18 * dpr, 100 * k, 2 * dpr); g.fillText('100 m', a.x0 + 12 * dpr, H - 24 * dpr);
      if (!ds.pts.length) { g.textAlign = 'center'; g.font = `700 ${14 * dpr}px system-ui`; g.fillText('Click to put down the first point of your track', a.x0 + a.w / 2, H / 2); }
    }

    // ---- the loop
    let raf = 0, last = performance.now();
    function frame(t) {
      if (!alive) return;
      raf = requestAnimationFrame(frame);
      const dt = Math.min(0.05, (t - last) / 1000); last = t;
      const hs = hostSound(); if (hs !== null && hs !== soundOn) setSound(hs);     // the app's Sound switch wins
      if (suspended) return;
      if (!paused) { let left = dt; while (left > 1e-4) { const h = Math.min(left, 1 / 120); update(h); left -= h; } if (shake > 0) shake = Math.max(0, shake - dt * 2.5); if (paddle > 0) paddle -= dt; }
      draw(); soundTick();
    }
    showMenu();
    raf = requestAnimationFrame(frame);

    const api = {
      key, suspend() { suspended = true; keys.clear(); audioKill(); }, resume() { suspended = false; last = performance.now(); }, setSoundEnabled(on) { setSound(on); },
      _state: () => ({ screen, racers, me, T, clock, net }),
    };
    window.NotchRaceGame.current = api;
    return function stop() {
      alive = false; cancelAnimationFrame(raf); closeNet(); audioKill();
      window.removeEventListener('keydown', onKd); window.removeEventListener('keyup', onKu);
      if (window.NotchRaceGame.current === api) window.NotchRaceGame.current = null;
      root.remove();
    };
  }

  window.NotchRaceGame = {
    mount,
    key: (k, down) => { const c = window.NotchRaceGame.current; if (c) c.key(k, down); },
    suspend: () => { const c = window.NotchRaceGame.current; if (c) c.suspend(); },
    setSoundEnabled: (on) => { window.NotchHostSound = !!on; const c = window.NotchRaceGame.current; if (c) c.setSoundEnabled(on); },
    resume: () => { const c = window.NotchRaceGame.current; if (c) c.resume(); },
    current: null,
    _test: { checkTrack, encodeTrack, decodeTrack, customDef, GROUNDS, TRACKS, CARS, buildTrack, locate, gridSlot, newCar, stepCar, driveAI, newRacer, progress, ranking, collide, wallHit, hurt, gearbox, NET, fmt, LEVELS },
  };
})();
