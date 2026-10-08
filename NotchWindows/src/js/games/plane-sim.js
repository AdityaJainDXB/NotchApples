// Plane: a small 3D flight game for the Games tab, shared by the Windows app (games.js imports it) and the Mac app
// (NotchApple/Resources/PlaneGame.html loads it in a web view). One plain script with no dependencies: a tiny WebGL
// renderer, a flight model that is believable without being a chore (lift from angle of attack, stalls, drag, banked
// turns, take-offs and landings), four planes, four modes, challenges and a leaderboard kept on this computer.
//
//   window.NotchPlaneGame.mount(hostElement) → returns a function that stops the game and cleans up.

(function () {
  'use strict';
  if (window.NotchPlaneGame) return;

  // ------------------------------------------------------------------ maths

  const v3 = (x = 0, y = 0, z = 0) => [x, y, z];
  const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
  const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
  const mul = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
  const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  const len = (a) => Math.hypot(a[0], a[1], a[2]);
  const norm = (a) => { const l = len(a) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
  const lerp = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
  const DEG = Math.PI / 180;

  // Quaternions [x, y, z, w]. Body axes: x right, y up, -z forward.
  const qmul = (a, b) => [
    a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1],
    a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0],
    a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3],
    a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2]];
  const qconj = (q) => [-q[0], -q[1], -q[2], q[3]];
  const qnorm = (q) => { const l = Math.hypot(q[0], q[1], q[2], q[3]) || 1; return [q[0] / l, q[1] / l, q[2] / l, q[3] / l]; };
  const qaxis = (axis, ang) => { const s = Math.sin(ang / 2); return [axis[0] * s, axis[1] * s, axis[2] * s, Math.cos(ang / 2)]; };
  const qrot = (q, v) => { const p = qmul(qmul(q, [v[0], v[1], v[2], 0]), qconj(q)); return [p[0], p[1], p[2]]; };
  /// Heading (radians, 0 = towards -z, positive turns right) and pitch → orientation.
  const qheading = (heading, pitch = 0) => qmul(qaxis([0, 1, 0], -heading), qaxis([1, 0, 0], pitch));

  // Column-major 4×4 matrices.
  function persp(fovy, aspect, near, far) {
    const f = 1 / Math.tan(fovy / 2), nf = 1 / (near - far);
    return new Float32Array([f / aspect, 0, 0, 0, 0, f, 0, 0, 0, 0, (far + near) * nf, -1, 0, 0, 2 * far * near * nf, 0]);
  }
  function lookAt(eye, at, up) {
    const z = norm(sub(eye, at)), x = norm(cross(up, z)), y = cross(z, x);
    return new Float32Array([x[0], y[0], z[0], 0, x[1], y[1], z[1], 0, x[2], y[2], z[2], 0, -dot(x, eye), -dot(y, eye), -dot(z, eye), 1]);
  }
  function model(q, p, s = 1) {
    const [x, y, z, w] = q;
    return new Float32Array([
      (1 - 2 * (y * y + z * z)) * s, 2 * (x * y + z * w) * s, 2 * (x * z - y * w) * s, 0,
      2 * (x * y - z * w) * s, (1 - 2 * (x * x + z * z)) * s, 2 * (y * z + x * w) * s, 0,
      2 * (x * z + y * w) * s, 2 * (y * z - x * w) * s, (1 - 2 * (x * x + y * y)) * s, 0,
      p[0], p[1], p[2], 1]);
  }
  function mat4mul(a, b) {
    const o = new Float32Array(16);
    for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) {
      o[c * 4 + r] = a[r] * b[c * 4] + a[4 + r] * b[c * 4 + 1] + a[8 + r] * b[c * 4 + 2] + a[12 + r] * b[c * 4 + 3];
    }
    return o;
  }

  // A small seeded random, so the world and the time-trial course are the same every time.
  function rng(seed) { let s = seed >>> 0; return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; }; }

  // ------------------------------------------------------------------ meshes

  const hex = (h) => [parseInt(h.slice(1, 3), 16) / 255, parseInt(h.slice(3, 5), 16) / 255, parseInt(h.slice(5, 7), 16) / 255];

  class Builder {
    constructor() { this.d = []; }
    /// One flat triangle. `ref` is a point inside the solid: the normal is flipped to face away from it.
    tri(a, b, c, col, ref) {
      let n = norm(cross(sub(b, a), sub(c, a)));
      if (ref) { const m = mul(add(add(a, b), c), 1 / 3); if (dot(n, sub(m, ref)) < 0) n = mul(n, -1); }
      for (const p of [a, b, c]) this.d.push(p[0], p[1], p[2], n[0], n[1], n[2], col[0], col[1], col[2]);
    }
    quad(a, b, c, d, col, ref) { this.tri(a, b, c, col, ref); this.tri(a, c, d, col, ref); }
    /// Any six-sided solid from 8 corners: 0-3 one end, 4-7 the other, in the same winding.
    hexa(p, col) {
      const ref = mul(p.reduce((s, v) => add(s, v), v3()), 1 / 8);
      const f = [[0, 1, 2, 3], [4, 5, 6, 7], [0, 1, 5, 4], [1, 2, 6, 5], [2, 3, 7, 6], [3, 0, 4, 7]];
      for (const [a, b, c, d] of f) this.quad(p[a], p[b], p[c], p[d], col, ref);
    }
    box(c, s, col) {
      const [x, y, z] = c, [w, h, d] = [s[0] / 2, s[1] / 2, s[2] / 2];
      this.hexa([[x - w, y - h, z - d], [x + w, y - h, z - d], [x + w, y + h, z - d], [x - w, y + h, z - d],
        [x - w, y - h, z + d], [x + w, y - h, z + d], [x + w, y + h, z + d], [x - w, y + h, z + d]], col);
    }
    /// A box along z whose cross-section goes from (w0, h0) at z0 to (w1, h1) at z1, centred on (cx, cy).
    taper(cx, cy, z0, w0, h0, z1, w1, h1, col, dy1 = 0) {
      this.hexa([[cx - w0 / 2, cy - h0 / 2, z0], [cx + w0 / 2, cy - h0 / 2, z0], [cx + w0 / 2, cy + h0 / 2, z0], [cx - w0 / 2, cy + h0 / 2, z0],
        [cx - w1 / 2, cy + dy1 - h1 / 2, z1], [cx + w1 / 2, cy + dy1 - h1 / 2, z1], [cx + w1 / 2, cy + dy1 + h1 / 2, z1], [cx - w1 / 2, cy + dy1 + h1 / 2, z1]], col);
    }
    /// A flat wing panel: root chord (z0..z1) at x = xr, tip chord (z2..z3) at x = xt, thickness t, at height y (tip at y + dihedral).
    wing(xr, z0, z1, xt, z2, z3, y, t, col, dihedral = 0) {
      const yt = y + dihedral;
      this.hexa([[xr, y - t / 2, z0], [xt, yt - t / 2, z2], [xt, yt - t / 2, z3], [xr, y - t / 2, z1],
        [xr, y + t / 2, z0], [xt, yt + t / 2, z2], [xt, yt + t / 2, z3], [xr, y + t / 2, z1]], col);
    }
    /// A cone or cylinder standing on the y axis.
    cone(c, r0, r1, h, col, seg = 10) {
      const ref = add(c, [0, h / 2, 0]);
      for (let i = 0; i < seg; i++) {
        const a0 = (i / seg) * Math.PI * 2, a1 = ((i + 1) / seg) * Math.PI * 2;
        const p = (r, a, y) => [c[0] + Math.cos(a) * r, c[1] + y, c[2] + Math.sin(a) * r];
        if (r1 > 0.001) this.quad(p(r0, a0, 0), p(r0, a1, 0), p(r1, a1, h), p(r1, a0, h), col, ref);
        else this.tri(p(r0, a0, 0), p(r0, a1, 0), add(c, [0, h, 0]), col, ref);
        if (r1 > 0.001) this.tri(add(c, [0, h, 0]), p(r1, a0, h), p(r1, a1, h), col, ref);
      }
    }
    /// A ring in the xy plane (facing z), with smooth normals.
    torus(R, r, col, seg = 40, side = 10) {
      const pt = (i, j) => {
        const a = (i / seg) * Math.PI * 2, b = (j / side) * Math.PI * 2;
        const n = [Math.cos(a) * Math.cos(b), Math.sin(a) * Math.cos(b), Math.sin(b)];
        return { p: [Math.cos(a) * (R + r * Math.cos(b)), Math.sin(a) * (R + r * Math.cos(b)), r * Math.sin(b)], n };
      };
      for (let i = 0; i < seg; i++) for (let j = 0; j < side; j++) {
        const q = [pt(i, j), pt(i + 1, j), pt(i + 1, j + 1), pt(i, j + 1)];
        for (const k of [0, 1, 2, 0, 2, 3]) this.d.push(...q[k].p, ...q[k].n, ...col);
      }
    }
  }

  // ------------------------------------------------------------------ planes

  // Performance numbers drive the flight model (see Flight): speeds in m/s, rates in rad/s.
  const PLANES = [
    { id: 'sparrow', name: 'Sparrow', kind: 'Trainer', blurb: 'Gentle, slow and forgiving. Lands itself, almost.',
      stall: 21, cruise: 42, max: 62, thrust: 3.4, authority: 0.8, pitch: 1.3, roll: 1.9, yaw: 0.55, stability: 2.6, gear: 1.3, scale: 1 },
    { id: 'mustang', name: 'Mustang', kind: 'Warbird', blurb: 'Fast and punchy. Lots of power, needs a careful landing.',
      stall: 34, cruise: 75, max: 125, thrust: 6.5, authority: 0.95, pitch: 1.6, roll: 2.6, yaw: 0.5, stability: 2.1, gear: 1.6, scale: 1 },
    { id: 'falcon', name: 'Falcon', kind: 'Jet', blurb: 'Very fast and very slippery. Plan your turns early.',
      stall: 55, cruise: 150, max: 240, thrust: 11, authority: 0.9, pitch: 1.0, roll: 3.4, yaw: 0.35, stability: 1.7, gear: 1.7, scale: 1.1 },
    { id: 'bipe', name: 'Stunt Bipe', kind: 'Aerobatic', blurb: 'Rolls on a coin and loops in no time. Made for hoops.',
      stall: 22, cruise: 48, max: 80, thrust: 5.2, authority: 1.05, pitch: 2.3, roll: 4.2, yaw: 0.9, stability: 2.2, gear: 1.3, scale: 1 },
  ];

  function buildPlane(id) {
    const b = new Builder();
    const prop = new Builder();
    if (id === 'sparrow') {
      const body = hex('#f4c430'), trim = hex('#c0392b'), glass = hex('#2c3e50'), dark = hex('#333333');
      b.taper(0, 0, -3.2, 1.2, 1.3, 0.5, 1.2, 1.5, body);          // nose to cabin
      b.taper(0, 0.1, 0.5, 1.2, 1.5, 5.2, 0.35, 0.5, body, 0.35);  // tail cone
      b.box([0, 0.75, -1.2], [1.1, 0.55, 1.6], glass);             // cabin windows
      b.wing(0, -1.8, -0.4, 5.6, -1.6, -0.6, 1.05, 0.14, body, 0.15); b.wing(0, -1.8, -0.4, -5.6, -1.6, -0.6, 1.05, 0.14, body, 0.15);
      b.box([5.1, 1.2, -1.1], [0.9, 0.16, 1.05], trim); b.box([-5.1, 1.2, -1.1], [0.9, 0.16, 1.05], trim);
      b.wing(0, 4.4, 5.3, 2.0, 4.7, 5.3, 0.4, 0.08, body); b.wing(0, 4.4, 5.3, -2.0, 4.7, 5.3, 0.4, 0.08, body);
      b.taper(0, 0.9, 4.2, 0.1, 0.2, 5.3, 0.1, 1.6, trim, 0.6);   // fin
      b.box([0.8, -1.0, -1.0], [0.12, 0.8, 0.12], dark); b.box([-0.8, -1.0, -1.0], [0.12, 0.8, 0.12], dark);
      b.box([0.8, -1.35, -1.0], [0.2, 0.45, 0.45], dark); b.box([-0.8, -1.35, -1.0], [0.2, 0.45, 0.45], dark);
      b.box([0, -0.95, -2.6], [0.2, 0.7, 0.4], dark);
      b.box([0, 0, -3.3], [0.35, 0.35, 0.3], trim);
      prop.box([0, 0, 0], [0.18, 2.1, 0.06], dark);
      return { body: b, prop, propAt: [0, 0, -3.5] };
    }
    if (id === 'mustang') {
      const body = hex('#b8c2cc'), olive = hex('#3d5a40'), glass = hex('#89c2d9'), yellow = hex('#f1c40f'), dark = hex('#2b2b2b');
      b.taper(0, 0, -4.2, 1.1, 1.1, 0, 1.3, 1.5, body);
      b.taper(0, 0, 0, 1.3, 1.5, 5.6, 0.3, 0.6, body, 0.3);
      b.taper(0, 0.85, -1.4, 0.7, 0.3, 1.0, 0.75, 0.7, glass, 0.1);
      b.wing(0, -1.9, 0.5, 5.8, -0.8, 0.2, -0.35, 0.18, body, 0.35); b.wing(0, -1.9, 0.5, -5.8, -0.8, 0.2, -0.35, 0.18, body, 0.35);
      b.box([5.4, 0.02, -0.35], [0.7, 0.2, 1.0], olive); b.box([-5.4, 0.02, -0.35], [0.7, 0.2, 1.0], olive);
      b.wing(0, 4.8, 5.7, 2.2, 5.2, 5.7, 0.35, 0.1, body); b.wing(0, 4.8, 5.7, -2.2, 5.2, 5.7, 0.35, 0.1, body);
      b.taper(0, 0.8, 4.3, 0.1, 0.2, 5.8, 0.1, 1.8, olive, 0.7);
      b.box([0, -0.85, 0.6], [0.6, 0.4, 1.6], body);            // radiator scoop
      b.box([0, 0, -4.3], [0.6, 0.6, 0.35], yellow);
      b.box([1.6, -1.0, -1.0], [0.14, 1.1, 0.14], dark); b.box([-1.6, -1.0, -1.0], [0.14, 1.1, 0.14], dark);
      b.box([1.6, -1.5, -1.0], [0.22, 0.6, 0.6], dark); b.box([-1.6, -1.5, -1.0], [0.22, 0.6, 0.6], dark);
      prop.box([0, 0, 0], [0.2, 3.0, 0.08], dark); prop.box([0, 0, 0], [3.0, 0.2, 0.08], dark);
      return { body: b, prop, propAt: [0, 0, -4.55] };
    }
    if (id === 'falcon') {
      const body = hex('#7f8c8d'), dark = hex('#4a5459'), glass = hex('#f39c12'), red = hex('#e74c3c'), black = hex('#222222');
      b.taper(0, 0, -6.5, 0.15, 0.15, -3.5, 1.1, 1.0, body);
      b.taper(0, 0, -3.5, 1.1, 1.0, 4.5, 1.5, 1.0, body);
      b.taper(0, 0, 4.5, 1.5, 1.0, 5.6, 1.1, 0.8, black);
      b.taper(0, 0.6, -4.2, 0.4, 0.2, -1.0, 0.75, 0.6, glass, 0.15);
      b.wing(0.6, -1.0, 3.6, 5.2, 2.6, 3.6, -0.1, 0.16, body, -0.15); b.wing(-0.6, -1.0, 3.6, -5.2, 2.6, 3.6, -0.1, 0.16, body, -0.15);
      b.wing(0.6, 3.6, 5.3, 2.8, 4.9, 5.4, 0, 0.1, dark); b.wing(-0.6, 3.6, 5.3, -2.8, 4.9, 5.4, 0, 0.1, dark);
      b.taper(0, 0.7, 2.6, 0.12, 0.3, 5.3, 0.12, 2.6, dark, 1.0);
      b.box([0, 2.3, 5.0], [0.14, 0.3, 0.5], red);
      b.box([1.1, -0.25, -1.5], [0.6, 0.6, 2.2], dark); b.box([-1.1, -0.25, -1.5], [0.6, 0.6, 2.2], dark); // intakes
      b.box([0, -0.9, -3.5], [0.14, 0.9, 0.14], black); b.box([1.2, -0.9, 1.0], [0.14, 0.9, 0.14], black); b.box([-1.2, -0.9, 1.0], [0.14, 0.9, 0.14], black);
      return { body: b, prop: null, propAt: null };
    }
    const red = hex('#d63031'), white = hex('#f5f6fa'), dark = hex('#2d3436'), blue = hex('#0984e3');
    b.taper(0, 0, -2.8, 1.0, 1.0, 0.4, 1.05, 1.1, red);
    b.taper(0, 0.05, 0.4, 1.05, 1.1, 4.4, 0.3, 0.45, red, 0.3);
    b.box([0, 0.6, -0.2], [0.8, 0.3, 0.8], dark);
    b.wing(0, -1.9, -0.6, 4.4, -1.9, -0.7, 1.6, 0.12, white, 0.1); b.wing(0, -1.9, -0.6, -4.4, -1.9, -0.7, 1.6, 0.12, white, 0.1);
    b.wing(0, -1.4, -0.1, 4.2, -1.4, -0.2, -0.45, 0.12, white, 0.25); b.wing(0, -1.4, -0.1, -4.2, -1.4, -0.2, -0.45, 0.12, white, 0.25);
    for (const x of [-3, 3]) { b.box([x, 0.6, -1.0], [0.1, 2.1, 0.1], dark); b.box([x, 0.6, -1.6], [0.1, 2.1, 0.1], dark); }
    b.box([4.0, 1.66, -1.3], [0.7, 0.14, 1.25], blue); b.box([-4.0, 1.66, -1.3], [0.7, 0.14, 1.25], blue);
    b.wing(0, 3.6, 4.4, 1.7, 3.9, 4.4, 0.3, 0.08, white); b.wing(0, 3.6, 4.4, -1.7, 3.9, 4.4, 0.3, 0.08, white);
    b.taper(0, 0.8, 3.5, 0.1, 0.2, 4.5, 0.1, 1.4, blue, 0.55);
    b.box([0.7, -0.95, -1.4], [0.12, 0.8, 0.12], dark); b.box([-0.7, -0.95, -1.4], [0.12, 0.8, 0.12], dark);
    b.box([0.7, -1.3, -1.4], [0.2, 0.45, 0.45], dark); b.box([-0.7, -1.3, -1.4], [0.2, 0.45, 0.45], dark);
    prop.box([0, 0, 0], [0.16, 2.0, 0.06], dark);
    return { body: b, prop, propAt: [0, 0, -2.95] };
  }

  // ------------------------------------------------------------------ the world

  const RUNWAY = { x: 0, z0: 0, z1: -1400, half: 22 };   // the runway runs from z = 0 towards -z
  const WORLD = 9000;

  function makeWorld() {
    const r = rng(7), b = new Builder();
    const mountains = [];
    for (let i = 0; i < 26; i++) {
      const a = (i / 26) * Math.PI * 2 + r() * 0.2, d = 3200 + r() * 1800;
      mountains.push({ x: Math.cos(a) * d, z: Math.sin(a) * d - 700, r: 500 + r() * 500, h: 380 + r() * 700 });
    }
    // A few hills inside the valley make low flying interesting.
    for (let i = 0; i < 6; i++) mountains.push({ x: (r() - 0.5) * 3600, z: -2600 + (r() - 0.5) * 3000, r: 260 + r() * 200, h: 90 + r() * 140 });
    mountains.forEach((m) => { if (Math.abs(m.x) < 260 && m.z > -1700 && m.z < 300) m.x += 700; });

    const lake = { x: -1500, z: -2200, r: 520 };
    // Fields: a patchwork of greens and golds, darker far away.
    const greens = ['#5a8f3c', '#6aa84f', '#4e7d32', '#8bb34a', '#b5a642', '#7c9c3b', '#a1b856', '#c9b458'].map(hex);
    const T = 300;
    for (let x = -WORLD; x < WORLD; x += T) for (let z = -WORLD; z < WORLD; z += T) {
      const c = greens[Math.floor(r() * greens.length)];
      b.quad([x, 0, z], [x + T, 0, z], [x + T, 0, z + T], [x, 0, z + T], c.map((v) => v * (0.92 + r() * 0.1)));
    }
    // Lake.
    const water = hex('#3a7bd5');
    for (let i = 0; i < 28; i++) {
      const a0 = (i / 28) * Math.PI * 2, a1 = ((i + 1) / 28) * Math.PI * 2;
      b.tri([lake.x, 0.25, lake.z], [lake.x + Math.cos(a0) * lake.r, 0.25, lake.z + Math.sin(a0) * lake.r], [lake.x + Math.cos(a1) * lake.r, 0.25, lake.z + Math.sin(a1) * lake.r], water);
    }
    // Runway with centre-line dashes, threshold bars and numbers' stand-ins.
    const asphalt = hex('#3b3f45'), paint = hex('#f2f2f2'), grass = hex('#4b7a2e');
    b.quad([-60, 0.1, 80], [60, 0.1, 80], [60, 0.1, RUNWAY.z1 - 80], [-60, 0.1, RUNWAY.z1 - 80], grass);
    b.quad([-RUNWAY.half, 0.2, RUNWAY.z0], [RUNWAY.half, 0.2, RUNWAY.z0], [RUNWAY.half, 0.2, RUNWAY.z1], [-RUNWAY.half, 0.2, RUNWAY.z1], asphalt);
    for (let z = -40; z > RUNWAY.z1 + 40; z -= 60) b.quad([-0.8, 0.3, z], [0.8, 0.3, z], [0.8, 0.3, z - 30], [-0.8, 0.3, z - 30], paint);
    for (const z0 of [-6, RUNWAY.z1 + 30]) for (let x = -18; x <= 18; x += 4) if (Math.abs(x) > 2) b.quad([x - 1, 0.3, z0], [x + 1, 0.3, z0], [x + 1, 0.3, z0 - 24], [x - 1, 0.3, z0 - 24], paint);
    // Edge lights.
    for (let z = 0; z > RUNWAY.z1; z -= 70) for (const x of [-RUNWAY.half - 1, RUNWAY.half + 1]) b.box([x, 0.5, z], [0.6, 0.8, 0.6], hex('#ffe066'));
    // Airfield: hangars and a tower beside the runway.
    b.box([110, 9, -300], [50, 18, 36], hex('#95a5a6')); b.box([110, 19, -300], [50, 2, 38], hex('#c0392b'));
    b.box([110, 9, -380], [50, 18, 36], hex('#95a5a6')); b.box([110, 19, -380], [50, 2, 38], hex('#2980b9'));
    b.box([90, 14, -520], [10, 28, 10], hex('#ecf0f1')); b.box([90, 31, -520], [14, 6, 14], hex('#34495e'));
    b.box([80, 0.15, -340], [40, 0.2, 200], hex('#555b61'));
    // A little town.
    for (let i = 0; i < 40; i++) {
      const x = 900 + r() * 700, z = -900 - r() * 900, h = 8 + r() * 35;
      b.box([x, h / 2, z], [18 + r() * 20, h, 18 + r() * 20], hex(['#d5d8dc', '#e8d8c3', '#c39b77', '#aab7b8', '#f5cba7'][Math.floor(r() * 5)]));
    }
    // Trees, kept off the runway and the lake.
    const leaf = [hex('#2e6b30'), hex('#3c7d3a'), hex('#285e2a')], bark = hex('#6b4f2a');
    for (let i = 0; i < 700; i++) {
      const x = (r() - 0.5) * 7000, z = (r() - 0.5) * 7000 - 700;
      if (Math.abs(x) < 120 && z < 150 && z > RUNWAY.z1 - 150) continue;
      if (Math.hypot(x - lake.x, z - lake.z) < lake.r + 30) continue;
      if (x > 850 && x < 1650 && z < -850 && z > -1850) continue;
      const h = 10 + r() * 14;
      b.cone([x, 0, z], 0.8, 0.8, h * 0.3, bark, 5);
      b.cone([x, h * 0.25, z], h * 0.35, 0, h * 0.8, leaf[i % 3], 6);
    }
    // Mountains with snow on the tall ones.
    const rock = hex('#7d6b5d'), rock2 = hex('#6e7f80'), snow = hex('#f4f6f7');
    for (const m of mountains) {
      b.cone([m.x, 0, m.z], m.r, 0, m.h, m.h > 300 ? rock2 : hex('#6b8e3a'), 12);
      if (m.h > 600) b.cone([m.x, m.h * 0.72, m.z], m.r * 0.28 + 1, 0, m.h * 0.28 + 1, snow, 12);
      else if (m.h > 300) b.cone([m.x, m.h * 0.5, m.z], m.r * 0.5, 0, m.h * 0.5 + 0.5, rock, 12);
    }
    // A bridge over the river-coloured strip near the lake (fly under it!).
    b.quad([-2600, 0.3, -3200], [-400, 0.3, -1600], [-370, 0.3, -1640], [-2570, 0.3, -3240], water);
    b.box([-1400, 34, -2350], [12, 4, 160], hex('#a04000'));
    b.box([-1400, 17, -2290], [8, 34, 8], hex('#784212')); b.box([-1400, 17, -2410], [8, 34, 8], hex('#784212'));

    // Clouds: flat-bottomed puffs.
    const cl = new Builder();
    for (let i = 0; i < 60; i++) {
      const x = (r() - 0.5) * 9000, z = (r() - 0.5) * 9000, y = 380 + r() * 380;
      for (let k = 0; k < 4; k++) cl.box([x + (r() - 0.5) * 120, y + r() * 20, z + (r() - 0.5) * 120], [60 + r() * 70, 18 + r() * 22, 50 + r() * 60], [1, 1, 1]);
    }
    return { world: b, clouds: cl, mountains, lake };
  }

  /// Ground height under (x, z): flat, except the mountains and hills.
  function groundAt(world, x, z) {
    let h = 0;
    for (const m of world.mountains) {
      const d = Math.hypot(x - m.x, z - m.z);
      if (d < m.r) h = Math.max(h, m.h * (1 - d / m.r));
    }
    return h;
  }
  const onRunway = (p) => Math.abs(p[0] - RUNWAY.x) < RUNWAY.half && p[2] < RUNWAY.z0 + 5 && p[2] > RUNWAY.z1 - 5;

  // ------------------------------------------------------------------ flight model

  // Not a real flight model, but the real ingredients: lift grows with speed² and angle of attack until the wing
  // stalls, induced drag grows with lift, the nose weathervanes into the airflow, banking turns the plane, the
  // controls get mushy when slow, flaps add lift and drag, and the wheels need a gentle touchdown.
  const G = 9.81;
  class Flight {
    constructor(spec) {
      this.s = spec;
      const clMax = 1.35;
      this.k = G / (spec.stall * spec.stall * clMax);          // lift per (v² · CL)
      this.clMax = clMax; this.clSlope = 5.2;                    // per radian
      const clLevel = G / (this.k * spec.max * spec.max);
      this.ki = 0.06;
      this.cd0 = spec.thrust / (this.k * spec.max * spec.max) - this.ki * clLevel * clLevel;
    }
    reset(pos, heading, speed, onGround) {
      this.pos = pos; this.q = qheading(heading, onGround ? 0 : 0.02); this.vel = mul(qrot(this.q, [0, 0, -1]), speed);
      this.w = v3(); this.throttle = onGround ? 0 : 0.7; this.flaps = 0; this.brake = false; this.onGround = onGround;
      this.crashed = false; this.stalled = false; this.aoa = 0; this.gload = 1; this.touch = null; this.sinkAtTouch = 0;
    }
    axes() { return { f: qrot(this.q, [0, 0, -1]), u: qrot(this.q, [0, 1, 0]), r: qrot(this.q, [1, 0, 0]) }; }
    get speed() { return len(this.vel); }
    get pitchAngle() { return Math.asin(clamp(this.axes().f[1], -1, 1)); }
    get bank() { const a = this.axes(); return Math.atan2(-a.r[1], a.u[1]); }
    get heading() { const f = this.axes().f; return Math.atan2(f[0], -f[2]); }

    step(dt, input, world) {
      if (this.crashed) return;
      const s = this.s, { f, u, r } = this.axes();
      const V = this.speed, vhat = V > 0.1 ? mul(this.vel, 1 / V) : f;
      // Airflow in body axes.
      const vb = qrot(qconj(this.q), this.vel);
      this.aoa = V > 1 ? Math.atan2(-vb[1], -vb[2]) : 0;
      const beta = V > 1 ? Math.atan2(vb[0], -vb[2]) : 0;
      const stallAoa = (15 + this.flaps * 3) * DEG;
      let cl = this.clSlope * this.aoa + this.flaps * 0.35;
      this.stalled = !this.onGround && Math.abs(this.aoa) > stallAoa && V > 3;
      if (Math.abs(this.aoa) > stallAoa) cl = Math.sign(this.aoa) * Math.max(0.35, this.clMax + this.flaps * 0.35 - (Math.abs(this.aoa) - stallAoa) * 4);
      cl = clamp(cl, -this.clMax, this.clMax + this.flaps * 0.4);
      const q = this.k * V * V;
      // Lift is perpendicular to the airflow, in the plane of the wings' "up".
      let liftDir = sub(u, mul(vhat, dot(u, vhat)));
      liftDir = len(liftDir) > 1e-4 ? norm(liftDir) : u;
      const lift = mul(liftDir, q * cl);
      const cd = this.cd0 * (1 + this.flaps * 1.6) + this.ki * cl * cl + (this.brake && !this.onGround ? 0.06 : 0);
      const drag = mul(vhat, -q * cd);
      const side = mul(r, -q * Math.sin(beta) * 0.6);         // the fuselage resists skidding
      // Thrust fades a little with speed, like a propeller.
      const thrust = mul(f, this.throttle * s.thrust * (1.15 - 0.3 * clamp(V / s.max, 0, 1)));
      let acc = add(add(add(lift, drag), add(side, thrust)), [0, -G, 0]);
      this.gload = dot(add(acc, [0, G, 0]), u) / G;

      // Rotation: what you ask for (weaker when slow) plus the aircraft's own stability pulling the nose into the wind.
      const eff = clamp((V - s.stall * 0.35) / (s.cruise - s.stall * 0.35), 0.08, 1.25);
      const stab = s.stability * clamp(V / s.cruise, 0, 1.5);
      // Pitch asks for an angle of attack (full stick ≈ the plane's limit, near the stall), so it feels the same at
      // every speed: the nose comes round quickly when fast and mushes when slow, and over-pulling still stalls.
      // Hands off, it keeps its current climb or descent, and holds height in a bank (a friendly autotrim). On the
      // wheels there is no trim: the nose only comes up when you pull.
      const stabT = stab * 0.9 + 0.4, path = this.k * V * this.clSlope;
      const aMax = stallAoa * s.authority;
      const gamma = Math.asin(clamp(vhat[1], -1, 1));
      const need = G * Math.cos(gamma) / Math.max(Math.cos(this.bank), 0.5);
      const trim = V > 1 && !this.onGround ? clamp((need / (this.k * V * V) - this.flaps * 0.35) / this.clSlope, -0.05, aMax * 0.85) : 0;
      const aCmd = input.pitch >= 0 ? trim + input.pitch * (aMax - trim) : trim + input.pitch * (trim + aMax * 0.55);
      const target = [
        clamp(aCmd * (stabT + path) - this.aoa * stabT + (V > 5 && !this.onGround ? this.k * V * this.flaps * 0.35 - G * Math.cos(gamma) / V : 0), -s.pitch * 1.6, s.pitch * 1.6),
        -input.yaw * s.yaw * eff - beta * stab,
        // Dihedral: with the roll keys released the wings drift gently back towards level.
        -input.roll * s.roll * eff + (input.roll === 0 && !this.onGround ? this.bank * 0.3 * clamp(V / s.cruise, 0, 1) : 0),
      ];
      if (this.stalled) { target[0] -= 0.35; target[2] += Math.sin(performance.now() / 300) * 0.4; }
      if (this.onGround) {
        target[2] = this.bank * 4;                              // wheels keep the wings level
        target[1] = -input.yaw * 0.6 - input.roll * 0.3;        // steer with rudder (or the arrows) on the ground
        if (V < s.stall * 0.7) target[0] = Math.min(target[0], 0) - this.pitchAngle * 3;
      }
      const resp = 1 - Math.exp(-dt * 5);
      this.w = add(this.w, mul(sub(target, this.w), resp));
      const angle = len(this.w) * dt;
      if (angle > 1e-6) this.q = qnorm(qmul(this.q, qaxis(norm(this.w), angle)));

      // Throttle, flaps and brakes.
      this.throttle = clamp(this.throttle + input.throttle * dt * 0.6, 0, 1);

      this.vel = add(this.vel, mul(acc, dt));
      this.pos = add(this.pos, mul(this.vel, dt));

      // Ground contact.
      const gh = groundAt(world, this.pos[0], this.pos[2]);
      const bottom = this.pos[1] - s.gear;
      if (bottom <= gh) {
        const sink = -this.vel[1];
        const level = Math.abs(this.bank) < 22 * DEG && this.pitchAngle > -10 * DEG && this.pitchAngle < 22 * DEG;
        const flat = gh < 1.5;                                   // no landing on a mountainside
        if (!this.onGround) {
          if (sink > 7.5 || !level || !flat || V > s.max * 0.9) { this.crash(sink > 7.5 ? 'hard' : !level ? 'attitude' : !flat ? 'terrain' : 'fast'); return; }
          this.onGround = true; this.touch = [this.pos[0], this.pos[2]]; this.sinkAtTouch = sink;
        }
        this.pos[1] = gh + s.gear;
        // Rolling on the wheels: the velocity follows the nose, with rolling friction, and brakes.
        const fh = norm([f[0], 0, f[2]]);
        let along = dot(this.vel, fh);
        const rough = onRunway(this.pos) ? 1 : 3.2;
        const decel = (this.brake ? 7 : 0.25 * rough) * dt;
        along = Math.sign(along) * Math.max(0, Math.abs(along) - decel);
        const up = Math.max(0, this.vel[1]);
        this.vel = add(mul(fh, along), [0, up, 0]);
        if (!onRunway(this.pos) && along > s.stall * 1.6) { this.crash('grass'); return; }   // too fast for the grass
        if (up > 0.5 && this.pos[1] - s.gear > gh + 0.3) this.onGround = false;
      } else if (this.onGround && bottom > gh + 0.6) {
        this.onGround = false;
      }
      if (this.pos[1] > 3000) { this.vel[1] = Math.min(this.vel[1], 0); }                  // ceiling
      const edge = WORLD - 600;
      if (Math.abs(this.pos[0]) > edge || Math.abs(this.pos[2]) > edge) this.pos = [clamp(this.pos[0], -edge, edge), this.pos[1], clamp(this.pos[2], -edge, edge)];
    }
    crash(why = 'crash') { this.why = why; this.crashed = true; this.vel = v3(); this.w = v3(); }
  }

  // ------------------------------------------------------------------ saved data

  const KEY = 'plane.v1.';
  const read = (k, d) => { try { const v = localStorage.getItem(KEY + k); return v == null ? d : JSON.parse(v); } catch { return d; } };
  const write = (k, v) => { try { localStorage.setItem(KEY + k, JSON.stringify(v)); } catch { /* private mode: play on without saving */ } };

  const MODES = [
    { id: 'hoops', name: 'Hoop Rush', icon: '⭕', desc: '90 seconds. Every hoop you fly through is 1 point. Hoops keep coming.', unit: 'hoops', better: 'high' },
    { id: 'trial', name: 'Time Trial', icon: '⏱', desc: '12 hoops in order around the valley. Fastest time wins.', unit: 's', better: 'low' },
    { id: 'landing', name: 'Landing', icon: '🛬', desc: 'You are on final approach. Land softly on the centre line and stop.', unit: 'pts', better: 'high' },
    { id: 'free', name: 'Free Flight', icon: '🌤', desc: 'Start on the runway, take off, and explore. Fly under the bridge!', unit: '', better: 'high' },
  ];

  const CHALLENGES = [
    { id: 'first', name: 'First hoop', desc: 'Fly through a hoop' },
    { id: 'ten', name: 'Hoop hunter', desc: '10 hoops in one Hoop Rush' },
    { id: 'twenty', name: 'Ring master', desc: '20 hoops in one Hoop Rush' },
    { id: 'trial', name: 'Course complete', desc: 'Finish the Time Trial' },
    { id: 'trialfast', name: 'Speed run', desc: 'Time Trial under 2 minutes' },
    { id: 'takeoff', name: 'Wheels up', desc: 'Take off from the runway' },
    { id: 'landed', name: 'Touchdown', desc: 'Land on the runway and stop' },
    { id: 'butter', name: 'Butter', desc: 'Touch down sinking less than 1 m/s' },
    { id: 'loop', name: 'Loop the loop', desc: 'Fly a full loop' },
    { id: 'roll', name: 'Barrel roll', desc: 'Roll all the way round in 4 s' },
    { id: 'bridge', name: 'Daredevil', desc: 'Fly under the bridge' },
    { id: 'low', name: 'Low pass', desc: 'Below 15 m at over 60 m/s for 3 s' },
    { id: 'fast', name: 'Top speed', desc: 'Reach your plane\'s top speed' },
    { id: 'all', name: 'Hangar tour', desc: 'Fly every plane' },
  ];

  // ------------------------------------------------------------------ styles

  const CSS = `
  .pg { position: relative; width: 100%; height: 100%; overflow: hidden; border-radius: 12px; background: #8ec5ff; font-family: -apple-system, "Segoe UI", system-ui, sans-serif; color: #fff; user-select: none; outline: none; }
  .pg canvas { position: absolute; inset: 0; width: 100%; height: 100%; display: block; }
  .pg .pg-ui { position: absolute; inset: 0; display: flex; }
  .pg .pg-menu.pg-side { margin: auto auto auto 10px; width: min(68%, 660px); }
  .pg .pg-menu { margin: auto; width: min(96%, 760px); max-height: 94%; overflow: auto; background: rgba(12, 16, 32, .78); backdrop-filter: blur(10px); border: 1px solid rgba(255,255,255,.14); border-radius: 16px; padding: 12px 14px; box-shadow: 0 10px 40px rgba(0,0,0,.4); }
  .pg h1 { margin: 0; font-size: 20px; font-weight: 800; letter-spacing: -.3px; display: flex; align-items: center; gap: 8px; }
  .pg h2 { margin: 8px 0 4px; font-size: 11px; font-weight: 800; letter-spacing: .8px; text-transform: uppercase; color: rgba(255,255,255,.6); }
  .pg .pg-row { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
  .pg .pg-tabs { display: flex; gap: 4px; margin-left: auto; }
  .pg button { font: inherit; color: #fff; background: rgba(255,255,255,.1); border: 1px solid rgba(255,255,255,.12); border-radius: 9px; padding: 5px 10px; cursor: pointer; font-size: 12px; font-weight: 600; }
  .pg button:hover { background: rgba(255,255,255,.18); }
  .pg button.pg-on { background: linear-gradient(180deg, #ffb347, #ff7e2d); border-color: transparent; color: #1a1205; }
  .pg button.pg-go { background: linear-gradient(180deg, #5ee08a, #22b35a); color: #062b13; border: none; font-size: 14px; padding: 8px 18px; font-weight: 800; }
  .pg .pg-planes { display: grid; grid-template-columns: repeat(4, 1fr); gap: 6px; }
  @media (max-width: 720px) { .pg .pg-planes, .pg .pg-modes { grid-template-columns: repeat(2, 1fr); } }
  .pg .pg-card { background: rgba(255,255,255,.06); border: 1px solid rgba(255,255,255,.1); border-radius: 11px; padding: 7px 8px; cursor: pointer; }
  .pg .pg-card.pg-on { border-color: #ffb347; background: rgba(255,179,71,.14); box-shadow: 0 0 0 1px #ffb347 inset; }
  .pg .pg-card b { font-size: 13px; } .pg .pg-card i { font-style: normal; font-size: 10px; color: rgba(255,255,255,.6); display: block; }
  .pg .pg-stat { display: flex; align-items: center; gap: 4px; font-size: 9px; color: rgba(255,255,255,.65); margin-top: 2px; }
  .pg .pg-stat span { flex: 1; height: 4px; border-radius: 3px; background: rgba(255,255,255,.12); overflow: hidden; } .pg .pg-stat span i { display: block; height: 100%; background: #ffb347; }
  .pg .pg-modes { display: grid; grid-template-columns: repeat(4, 1fr); gap: 6px; }
  .pg .pg-mode { text-align: left; padding: 7px 8px; } .pg .pg-mode small { display: block; font-weight: 500; font-size: 10px; color: rgba(255,255,255,.65); margin-top: 2px; }
  .pg .pg-mode.pg-on small { color: rgba(26,18,5,.75); }
  .pg table { width: 100%; border-collapse: collapse; font-size: 12px; } .pg td, .pg th { padding: 3px 6px; text-align: left; } .pg th { font-size: 10px; color: rgba(255,255,255,.55); }
  .pg tr:nth-child(even) td { background: rgba(255,255,255,.04); } .pg td.pg-n { font-variant-numeric: tabular-nums; text-align: right; }
  .pg .pg-ach { display: grid; grid-template-columns: repeat(2, 1fr); gap: 4px 10px; font-size: 12px; } .pg .pg-ach div { opacity: .5; } .pg .pg-ach div.pg-done { opacity: 1; } .pg .pg-ach small { color: rgba(255,255,255,.6); }
  .pg .pg-hint { font-size: 10.5px; color: rgba(255,255,255,.7); line-height: 1.45; }
  .pg kbd { font: 600 10px/1 inherit; padding: 2px 4px; border-radius: 4px; background: rgba(255,255,255,.16); }
  .pg input { font: inherit; font-size: 12px; color: #fff; background: rgba(255,255,255,.1); border: 1px solid rgba(255,255,255,.2); border-radius: 8px; padding: 5px 8px; width: 120px; }
  .pg .pg-toast { position: absolute; left: 50%; top: 12%; transform: translateX(-50%); background: rgba(10,14,28,.82); border: 1px solid #ffb347; border-radius: 12px; padding: 6px 14px; font-size: 13px; font-weight: 700; pointer-events: none; transition: opacity .3s; white-space: nowrap; }
  .pg .pg-result { text-align: center; } .pg .pg-big { font-size: 34px; font-weight: 900; margin: 4px 0; }
  .pg .pg-pause { position: absolute; inset: 0; display: grid; place-items: center; background: rgba(0,0,0,.35); font-size: 13px; }
  `;

  // ------------------------------------------------------------------ the game

  function mount(host) {
    if (!document.getElementById('pg-style')) {
      const st = document.createElement('style'); st.id = 'pg-style'; st.textContent = CSS; document.head.append(st);
    }
    const root = document.createElement('div'); root.className = 'pg'; root.tabIndex = 0;
    const cv = document.createElement('canvas');
    const hud = document.createElement('canvas');
    const ui = document.createElement('div'); ui.className = 'pg-ui';
    root.append(cv, hud, ui); host.replaceChildren(root);
    const gl = cv.getContext('webgl', { antialias: true }) || cv.getContext('experimental-webgl');
    const h2 = hud.getContext('2d');
    if (!gl) { ui.innerHTML = '<div class="pg-menu"><h1>✈️ Plane</h1><p class="pg-hint">This computer\'s graphics don\'t support WebGL, which the 3D plane game needs.</p></div>'; return () => {}; }

    // ---- GL setup
    const vs = `attribute vec3 p; attribute vec3 n; attribute vec3 c; uniform mat4 vp, m; uniform vec3 tint; uniform float glow;
      varying vec3 vc; varying float vd; varying float vl;
      void main(){ vec4 w = m * vec4(p,1.0); gl_Position = vp * w; vec3 nn = normalize(mat3(m) * n);
        float l = max(dot(nn, normalize(vec3(0.45, 0.85, 0.3))), 0.0); vl = 0.42 + 0.68 * l + glow; vc = c * tint; vd = gl_Position.w; }`;
    const fs = `precision mediump float; varying vec3 vc; varying float vd; varying float vl; uniform vec3 fog; uniform float fogFar;
      void main(){ float f = clamp((vd - fogFar * 0.25) / (fogFar * 0.75), 0.0, 1.0); gl_FragColor = vec4(mix(vc * vl, fog, f * f), 1.0); }`;
    const sh = (type, src) => { const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s); return s; };
    const prog = gl.createProgram(); gl.attachShader(prog, sh(gl.VERTEX_SHADER, vs)); gl.attachShader(prog, sh(gl.FRAGMENT_SHADER, fs)); gl.linkProgram(prog); gl.useProgram(prog);
    const loc = { p: gl.getAttribLocation(prog, 'p'), n: gl.getAttribLocation(prog, 'n'), c: gl.getAttribLocation(prog, 'c') };
    const uni = (name) => gl.getUniformLocation(prog, name);
    const U = { vp: uni('vp'), m: uni('m'), tint: uni('tint'), glow: uni('glow'), fog: uni('fog'), fogFar: uni('fogFar') };
    gl.enable(gl.DEPTH_TEST);
    const upload = (builder) => {
      if (!builder) return null;
      const buf = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, buf); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(builder.d), gl.STATIC_DRAW);
      return { buf, count: builder.d.length / 9 };
    };
    const I = new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
    function draw(mesh, m = I, tint = [1, 1, 1], glow = 0) {
      if (!mesh) return;
      gl.bindBuffer(gl.ARRAY_BUFFER, mesh.buf);
      gl.enableVertexAttribArray(loc.p); gl.vertexAttribPointer(loc.p, 3, gl.FLOAT, false, 36, 0);
      gl.enableVertexAttribArray(loc.n); gl.vertexAttribPointer(loc.n, 3, gl.FLOAT, false, 36, 12);
      gl.enableVertexAttribArray(loc.c); gl.vertexAttribPointer(loc.c, 3, gl.FLOAT, false, 36, 24);
      gl.uniformMatrix4fv(U.m, false, m); gl.uniform3fv(U.tint, tint); gl.uniform1f(U.glow, glow);
      gl.drawArrays(gl.TRIANGLES, 0, mesh.count);
    }

    const W = makeWorld();
    const worldMesh = upload(W.world), cloudMesh = upload(W.clouds);
    const hoopB = new Builder(); hoopB.torus(14, 1.3, [1, 1, 1]); const hoopMesh = upload(hoopB);
    const arrowB = new Builder(); arrowB.cone([0, 0, 0], 2.2, 0, 5, [1, 1, 1], 8); const arrowMesh = upload(arrowB);
    const smokeB = new Builder(); smokeB.box([0, 0, 0], [1, 1, 1], [1, 1, 1]); const smokeMesh = upload(smokeB);
    const planeMeshes = {};
    for (const p of PLANES) { const m = buildPlane(p.id); planeMeshes[p.id] = { body: upload(m.body), prop: upload(m.prop), propAt: m.propAt }; }

    // ---- state
    let plane = PLANES.find((p) => p.id === read('plane', 'sparrow')) || PLANES[0];
    let mode = MODES.find((m) => m.id === read('mode', 'hoops')) || MODES[0];
    let screen = 'menu', menuTab = read('menuTab', 'play');
    let flight = new Flight(plane);
    let hoops = [], nextHoop = 0, score = 0, timeLeft = 0, elapsed = 0, streak = 0, hoopsMade = 0;
    let camMode = 0, camPos = [0, 30, 60], paused = false, result = null, propAngle = 0, toastTimer = 0;
    let rollAcc = 0, rollT = 0, loopAcc = 0, loopT = 0, lowT = 0, hadTakeoff = false, stoppedT = 0;
    const smoke = [];
    const keys = new Set();
    const done = new Set(read('done', []));
    let invert = read('invert', false), sound = read('sound', true), units = read('units', 'kmh');
    let playerName = read('name', '');

    // ---- sound (Web Audio): engine drone, a chime for hoops, a thud for crashes
    let ac = null, eng = null, engGain = null;
    function audio() {
      if (!sound) return null;
      if (!ac) {
        try {
          ac = new (window.AudioContext || window.webkitAudioContext)();
          eng = ac.createOscillator(); eng.type = 'sawtooth';
          const lp = ac.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 500;
          engGain = ac.createGain(); engGain.gain.value = 0;
          eng.connect(lp); lp.connect(engGain); engGain.connect(ac.destination); eng.start();
        } catch { ac = null; }
      }
      return ac;
    }
    function beep(freq, t = 0.18, type = 'sine', vol = 0.18) {
      const a = audio(); if (!a) return;
      const o = a.createOscillator(), g = a.createGain(); o.type = type; o.frequency.value = freq;
      g.gain.setValueAtTime(vol, a.currentTime); g.gain.exponentialRampToValueAtTime(0.001, a.currentTime + t);
      o.connect(g); g.connect(a.destination); o.start(); o.stop(a.currentTime + t);
    }
    const chime = () => { beep(880, 0.15); setTimeout(() => beep(1320, 0.22), 90); };

    // ---- achievements and toasts
    const toastEl = document.createElement('div'); toastEl.className = 'pg-toast'; toastEl.style.opacity = 0; root.append(toastEl);
    function toast(text, ms = 1600) { toastEl.textContent = text; toastEl.style.opacity = 1; toastTimer = ms / 1000; }
    function achieve(id) {
      if (done.has(id)) return;
      done.add(id); write('done', [...done]);
      const c = CHALLENGES.find((x) => x.id === id);
      if (c) { toast(`🏅 Challenge: ${c.name}`, 2600); beep(660, 0.12); setTimeout(() => beep(990, 0.25), 120); }
    }

    // ---- hoops
    function hoopAt(pos, dir) { return { pos, dir: norm(dir), passed: false, side: null }; }
    function spawnHoop(from, dir, r) {
      const turn = (r() - 0.5) * 70 * DEG, d = norm([dir[0], 0, dir[2]]);
      const nd = [d[0] * Math.cos(turn) - d[2] * Math.sin(turn), 0, d[0] * Math.sin(turn) + d[2] * Math.cos(turn)];
      const dist = 260 + r() * 200;
      let p = add(from, mul(nd, dist));
      const gh = groundAt(W, p[0], p[2]);
      p[1] = clamp(from[1] + (r() - 0.5) * 120, gh + 45, gh + 380);
      // Stay inside the valley: past the hills, the next hoop turns back towards the airfield.
      if (Math.hypot(p[0], p[2] + 700) > 2600) {
        const home = norm(sub([0, from[1], -700], from));
        p = add(from, mul([home[0], 0, home[2]], dist));
        const g2 = groundAt(W, p[0], p[2]);
        p[1] = clamp(from[1], g2 + 45, g2 + 380);
      }
      return hoopAt(p, sub(p, from));
    }
    let hoopRand = rng(Date.now() & 0xffff);
    function trialCourse() {
      const r = rng(42), out = [];
      let p = [0, 160, -200], dir = [0, 0, -1];
      for (let i = 0; i < 12; i++) {
        const turn = (i % 4 === 3 ? 80 : (r() - 0.5) * 50) * DEG;
        dir = norm([dir[0] * Math.cos(turn) - dir[2] * Math.sin(turn), 0, dir[0] * Math.sin(turn) + dir[2] * Math.cos(turn)]);
        const next = add(p, mul(dir, 380 + r() * 120));
        next[1] = Math.max(groundAt(W, next[0], next[2]) + 60, 90 + r() * 200);
        out.push(hoopAt(next, sub(next, p))); p = next;
      }
      return out;
    }

    // ---- starting a flight
    function start() {
      flight = new Flight(plane);
      score = 0; elapsed = 0; streak = 0; hoopsMade = 0; result = null; paused = false; smoke.length = 0;
      rollAcc = 0; loopAcc = 0; lowT = 0; stoppedT = 0; hadTakeoff = false;
      hoops = []; nextHoop = 0;
      if (mode.id === 'free') flight.reset([0, plane.gear, -30], 0, 0, true);
      else if (mode.id === 'landing') {
        const dist = 1600 + Math.random() * 400, side = (Math.random() - 0.5) * 120;
        // On the extended centre line behind the threshold, a 3–4° glide slope, at approach speed.
        flight.reset([side, dist * Math.tan(3.5 * DEG) + 4, dist], 0, plane.stall * 1.35, false);
        flight.throttle = 0.3; flight.flaps = 1;
      } else {
        flight.reset([0, 160, -200], 0, plane.cruise, false);
        if (mode.id === 'hoops') {
          timeLeft = 90; hoopRand = rng(Date.now() & 0xffff);
          let from = [0, 160, -200], dir = [0, 0, -1];
          for (let i = 0; i < 4; i++) { const h = spawnHoop(from, dir, hoopRand); hoops.push(h); dir = sub(h.pos, from); from = h.pos; }
        } else hoops = trialCourse();
      }
      const flown = new Set(read('flown', [])); flown.add(plane.id); write('flown', [...flown]);
      if (flown.size >= PLANES.length) achieve('all');
      camPos = add(flight.pos, [0, 12, 40]);
      screen = 'fly'; renderUI(); root.focus();
      if (audio()?.state === 'suspended') ac.resume();
    }

    function finish(kind, value, label) {
      screen = 'result';
      result = { kind, value, label, best: false, rank: 0 };
      if (engGain) engGain.gain.value = 0;
      const board = read(`board.${mode.id}`, []);
      const qualifies = value != null && (board.length < 10 || (mode.better === 'high' ? value > board[board.length - 1].score : value < board[board.length - 1].score));
      result.qualifies = qualifies && mode.id !== 'free' && (mode.id === 'trial' || value > 0);
      renderUI();
    }

    function saveScore() {
      const name = (ui.querySelector('input')?.value || playerName || 'Pilot').trim().slice(0, 16) || 'Pilot';
      playerName = name; write('name', name);
      const board = read(`board.${mode.id}`, []);
      board.push({ name, plane: plane.name, score: result.value, date: new Date().toISOString().slice(0, 10) });
      board.sort((a, b) => (mode.better === 'high' ? b.score - a.score : a.score - b.score));
      write(`board.${mode.id}`, board.slice(0, 10));
      result.rank = board.findIndex((e) => e.name === name && e.score === result.value) + 1;
      result.qualifies = false; result.saved = true;
      renderUI();
    }

    // ---- input
    const onKey = (e, down) => {
      if (!root.isConnected) return;
      const k = e.key.length === 1 ? e.key.toLowerCase() : e.key;
      const typing = e.target && e.target.tagName === 'INPUT';
      if (typing) { if (down && k === 'Enter' && result?.qualifies) saveScore(); return; }
      const game = ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', ' ', 'w', 's', 'a', 'd', 'q', 'e', 'f', 'b', 'c', 'p', 'r', 'Shift', 'Control', 'g'];
      if (game.includes(k) && screen === 'fly') e.preventDefault();
      if (down) {
        if (screen === 'fly') {
          if (k === 'p') { paused = !paused; renderUI(); }
          if (k === 'c') camMode = (camMode + 1) % 3;
          if (k === 'f') { flight.flaps = flight.flaps ? 0 : 1; toast(flight.flaps ? 'Flaps down' : 'Flaps up', 800); }
          if (k === 'r') start();
          if (k === 'm') { screen = 'menu'; renderUI(); }
        } else if (screen === 'result' && (k === 'r' || k === ' ')) { e.preventDefault(); start(); }
        else if (screen === 'menu' && k === 'Enter') start();
        keys.add(k);
      } else keys.delete(k);
    };
    const kd = (e) => onKey(e, true), ku = (e) => onKey(e, false);
    window.addEventListener('keydown', kd); window.addEventListener('keyup', ku);
    const blur = () => keys.clear(); window.addEventListener('blur', blur);
    root.addEventListener('mousedown', () => { if (document.activeElement?.tagName !== 'INPUT') root.focus(); });

    function input() {
      const has = (k) => keys.has(k);
      let pitch = (has('ArrowDown') ? 1 : 0) - (has('ArrowUp') ? 1 : 0);
      if (invert) pitch = -pitch;
      return {
        pitch,
        roll: (has('ArrowRight') ? 1 : 0) - (has('ArrowLeft') ? 1 : 0),
        yaw: (has('d') || has('e') ? 1 : 0) - (has('a') || has('q') ? 1 : 0),
        throttle: (has('w') || has('Shift') ? 1 : 0) - (has('s') || has('Control') ? 1 : 0),
      };
    }

    // ---- per-frame game rules
    function update(dt) {
      if (toastTimer > 0) { toastTimer -= dt; if (toastTimer <= 0) toastEl.style.opacity = 0; }
      if (screen !== 'fly' || paused) return;
      const inp = input();
      flight.brake = keys.has(' ') || keys.has('b');
      const prev = flight.pos.slice();
      const wasGround = flight.onGround;
      flight.step(dt, inp, W);
      elapsed += dt;
      propAngle += dt * (8 + flight.throttle * 60);

      if (flight.crashed) {
        beep(90, 0.6, 'sawtooth', 0.3); beep(60, 0.9, 'square', 0.2);
        for (let i = 0; i < 40; i++) smoke.push({ p: flight.pos.slice(), v: [(Math.random() - 0.5) * 20, Math.random() * 18, (Math.random() - 0.5) * 20], t: 0, life: 2 + Math.random() * 2, fire: i < 20 });
        if (mode.id === 'hoops') finish('crash', score, `Crashed with ${score} hoop${score === 1 ? '' : 's'}`);
        else if (mode.id === 'trial') finish('crash', null, `Crashed at hoop ${nextHoop + 1} of ${hoops.length}`);
        else if (mode.id === 'landing') finish('crash', 0, flight.speed > 0 ? 'Crashed on landing' : 'Crashed');
        else finish('crash', null, 'Crashed');
        return;
      }

      // Hoops: passing through the ring's plane inside its radius.
      hoops.forEach((h, i) => {
        if (h.passed) return;
        const d0 = dot(sub(prev, h.pos), h.dir), d1 = dot(sub(flight.pos, h.pos), h.dir);
        if (d0 < 0 && d1 >= 0) {
          const t = d0 / (d0 - d1), hit = lerp(prev, flight.pos, t);
          const off = len(sub(hit, h.pos));
          const inOrder = mode.id !== 'trial' || i === nextHoop;
          if (off < 13.2 && inOrder) {
            h.passed = true; score++; hoopsMade++; streak++; chime(); achieve('first');
            toast(mode.id === 'trial' ? `Hoop ${i + 1} / ${hoops.length}` : `+1  ·  ${score} hoop${score === 1 ? '' : 's'}${streak >= 3 ? `  ·  streak ${streak}` : ''}`, 900);
            if (mode.id === 'trial') nextHoop = i + 1;
            if (mode.id === 'hoops') {
              if (score >= 10) achieve('ten');
              if (score >= 20) achieve('twenty');
              const last = hoops[hoops.length - 1];
              hoops.push(spawnHoop(last.pos, last.dir, hoopRand));
            }
          } else if (off < 40 && mode.id === 'hoops') { streak = 0; toast('Missed!', 700); beep(220, 0.2, 'triangle'); }
        }
      });
      if (mode.id === 'hoops') {
        // Hoops left far behind are dropped; there are always a few ahead.
        hoops = hoops.filter((h) => !(h.passed && len(sub(h.pos, flight.pos)) > 120));
        const ahead = hoops.filter((h) => !h.passed);
        for (const h of ahead) if (dot(sub(h.pos, flight.pos), flight.axes().f) < -350) { h.passed = true; streak = 0; }
        while (hoops.filter((h) => !h.passed).length < 3) { const last = hoops[hoops.length - 1]; hoops.push(spawnHoop(last ? last.pos : flight.pos, last ? last.dir : flight.axes().f, hoopRand)); }
        timeLeft -= dt;
        if (timeLeft <= 0) { finish('done', score, `${score} hoop${score === 1 ? '' : 's'} in 90 seconds`); return; }
      }
      if (mode.id === 'trial' && nextHoop >= hoops.length) {
        achieve('trial'); if (elapsed < 120) achieve('trialfast');
        finish('done', Math.round(elapsed * 10) / 10, `Course complete in ${elapsed.toFixed(1)} s`); return;
      }

      // Challenges along the way.
      if (wasGround && !flight.onGround && flight.pos[1] - groundAt(W, flight.pos[0], flight.pos[2]) > 2) { hadTakeoff = true; if (onRunway(prev)) achieve('takeoff'); }
      if (!wasGround && flight.onGround) {
        const sink = flight.sinkAtTouch;
        toast(`Touchdown · ${sink.toFixed(1)} m/s${sink < 1 ? ' · butter!' : sink < 2.5 ? ' · nice' : sink < 4.5 ? ' · firm' : ' · ouch'}`, 1500);
        if (sink < 1 && onRunway(flight.pos)) achieve('butter');
      }
      if (flight.onGround && flight.speed < 1.5 && (hadTakeoff || mode.id === 'landing')) {
        stoppedT += dt;
        if (stoppedT > 0.6) {
          const on = onRunway(flight.pos);
          if (on) achieve('landed');
          if (mode.id === 'landing') {
            const sink = flight.sinkAtTouch, centre = Math.abs(flight.touch[0]), zone = Math.abs(flight.touch[1] - (-300));
            const pts = on ? Math.max(0, Math.round(1000 - sink * 140 - centre * 12 - zone * 0.5)) : 0;
            finish('done', pts, on ? `Landed · touchdown ${sink.toFixed(1)} m/s · ${centre.toFixed(1)} m off the centre line` : 'Stopped off the runway');
            return;
          }
          if (mode.id === 'free' && on && stoppedT < 0.7) toast('Landed and stopped. Take off again any time.', 2000);
        }
      } else stoppedT = 0;
      const w = flight.w;
      rollAcc += w[2] * dt; rollT += dt; if (rollT > 4) { rollAcc *= 0.5; rollT = 2; }
      if (Math.abs(rollAcc) > Math.PI * 2) { achieve('roll'); rollAcc = 0; }
      loopAcc += w[0] * dt; loopT += dt; if (loopT > 10) { loopAcc *= 0.5; loopT = 5; }
      if (Math.abs(loopAcc) > Math.PI * 2 && !flight.onGround) { achieve('loop'); loopAcc = 0; }
      const agl = flight.pos[1] - plane.gear - groundAt(W, flight.pos[0], flight.pos[2]);
      if (!flight.onGround && agl < 15 && flight.speed > 60) { lowT += dt; if (lowT > 3) achieve('low'); } else lowT = 0;
      if (flight.speed > plane.max * 0.97) achieve('fast');
      const bp = flight.pos;
      if (Math.abs(bp[0] + 1400) < 8 && Math.abs(bp[2] + 2350) < 75 && bp[1] < 32 && !flight.onGround) achieve('bridge');

      // Engine sound follows the throttle and airspeed.
      if (engGain && ac) {
        eng.frequency.setTargetAtTime(45 + flight.throttle * 70 + flight.speed * 0.25, ac.currentTime, 0.1);
        engGain.gain.setTargetAtTime(sound ? 0.035 + flight.throttle * 0.05 : 0, ac.currentTime, 0.1);
      }
    }

    // ---- drawing
    let lastW = 0, lastH = 0;
    function size() {
      const r = root.getBoundingClientRect(), dpr = Math.min(window.devicePixelRatio || 1, 2);
      const w = Math.max(1, Math.round(r.width * dpr)), h = Math.max(1, Math.round(r.height * dpr));
      if (w !== lastW || h !== lastH) { cv.width = hud.width = w; cv.height = hud.height = h; lastW = w; lastH = h; }
      return { w, h, dpr };
    }

    function render(t) {
      const { w, h, dpr } = size();
      gl.viewport(0, 0, w, h);
      const sky = [0.55, 0.76, 0.96];
      gl.clearColor(...sky, 1); gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
      gl.uniform3fv(U.fog, sky); gl.uniform1f(U.fogFar, 5200);

      // Camera.
      let eye, at, up;
      const showPlane = screen !== 'fly' || camMode !== 1;
      if (screen === 'menu') {
        const a = t * 0.0003;
        flight.pos = [0, plane.gear, 0]; flight.q = qheading(0, 0); flight.crashed = false;
        const r = 15 * plane.scale;
        eye = [Math.sin(a) * r, 4.5, Math.cos(a) * r]; up = [0, 1, 0];
        // Aim left of the plane so it turns in the free space to the right of the menu.
        const side = norm(cross(norm(sub([0, 1.6, 0], eye)), up));
        at = sub([0, 1.6, 0], mul(side, 6.5 * plane.scale));
      } else {
        const { f, u } = flight.axes();
        if (camMode === 1) {
          eye = add(add(flight.pos, mul(u, 1.1)), mul(f, -0.4)); at = add(eye, f); up = u;
        } else if (camMode === 2 || screen === 'result') {
          const a = t * 0.0004;
          eye = add(flight.pos, [Math.sin(a) * 28, 9, Math.cos(a) * 28]); at = flight.pos; up = [0, 1, 0];
        } else {
          const back = 20 * plane.scale, high = 5 * plane.scale;
          const want = add(add(flight.pos, mul(f, -back)), add(mul(u, high * 0.6), [0, high * 0.6, 0]));
          camPos = lerp(camPos, want, 0.12);
          const gh = groundAt(W, camPos[0], camPos[2]) + 1.5; if (camPos[1] < gh) camPos[1] = gh;
          eye = camPos; at = add(flight.pos, mul(f, 12)); up = norm(add(mul(u, 0.35), [0, 1, 0]));
        }
      }
      const proj = persp(screen === 'menu' ? 45 * DEG : 62 * DEG, w / h, camMode === 1 ? 0.3 : 1, 12000);
      const vp = mat4mul(proj, lookAt(eye, at, up));
      gl.uniformMatrix4fv(U.vp, false, vp);

      if (screen !== 'menu') {
        draw(worldMesh);
        draw(cloudMesh, I, [1, 1, 1], 0.25);
        // Hoops: the next one glows gold, the rest orange, passed ones turn green.
        const nextIdx = mode.id === 'trial' ? nextHoop : hoops.findIndex((x) => !x.passed);
        hoops.forEach((hp, i) => {
          if (mode.id === 'trial' && i > nextHoop + 2 && !hp.passed) return;
          const dir = hp.dir, yaw = Math.atan2(dir[0], dir[2]), pitch = -Math.asin(clamp(dir[1], -1, 1));
          const q = qmul(qaxis([0, 1, 0], yaw), qaxis([1, 0, 0], pitch));
          const pulse = 0.25 + 0.25 * Math.sin(t * 0.008);
          const col = hp.passed ? [0.3, 0.95, 0.4] : i === nextIdx ? [1, 0.82, 0.2] : [1, 0.45, 0.15];
          draw(hoopMesh, model(q, hp.pos), col, i === nextIdx ? pulse + 0.2 : 0.1);
        });
      } else {
        // Menu backdrop: a little apron of tarmac under the turning plane.
        draw(worldMesh, model([0, 0, 0, 1], [0, -0.2, 300]));
      }

      if (showPlane && !(flight.crashed && screen === 'result')) {
        const pm = planeMeshes[plane.id];
        const m = model(flight.q, flight.pos, plane.scale);
        draw(pm.body, m);
        if (pm.prop) {
          const pq = qmul(flight.q, qaxis([0, 0, 1], propAngle));
          draw(pm.prop, model(pq, add(flight.pos, qrot(flight.q, mul(pm.propAt, plane.scale))), plane.scale), [1, 1, 1], 0);
        }
      }
      // Smoke and fire after a crash.
      for (const s of smoke) {
        const k = s.t / s.life;
        draw(smokeMesh, model([0, 0, 0, 1], s.p, 2 + k * 8), s.fire && k < 0.4 ? [1, 0.5 - k, 0.1] : [0.3 + k * 0.3, 0.3 + k * 0.3, 0.3 + k * 0.3], s.fire ? 0.6 : 0);
      }
      // A 3D arrow ahead of the plane pointing at the next hoop.
      const target = hoops.find((x, i) => !x.passed && (mode.id !== 'trial' || i === nextHoop));
      if (screen === 'fly' && target && camMode === 0) {
        const { f, u } = flight.axes();
        const base = add(add(flight.pos, mul(f, 16)), mul(u, 5));
        const d = norm(sub(target.pos, base));
        const axis = cross([0, 1, 0], d), ang = Math.acos(clamp(d[1], -1, 1));
        const q = len(axis) > 1e-4 ? qaxis(norm(axis), ang) : [0, 0, 0, 1];
        draw(arrowMesh, model(q, base, 0.5), [1, 0.85, 0.2], 0.5);
      }
      drawHud(w, h, dpr, target);
    }

    function drawHud(w, h, dpr, target) {
      // Hidden rather than only cleared off the flight screen: a canvas whose only change is a clear may not repaint.
      const show = screen === 'fly';
      if (hud.style.visibility !== (show ? 'visible' : 'hidden')) hud.style.visibility = show ? 'visible' : 'hidden';
      h2.setTransform(1, 0, 0, 1, 0, 0); h2.clearRect(0, 0, w, h);
      if (!show) return;
      h2.scale(dpr, dpr);
      const W2 = w / dpr, H2 = h / dpr, s = Math.min(1, W2 / 640);
      const spd = flight.speed, kmh = units === 'kmh';
      const alt = flight.pos[1] - plane.gear;
      const agl = alt - groundAt(W, flight.pos[0], flight.pos[2]);
      h2.font = `700 ${Math.round(12 * s + 2)}px system-ui, sans-serif`; h2.textBaseline = 'middle';
      const box = (x, y, bw, bh) => { h2.fillStyle = 'rgba(8,12,24,.55)'; h2.beginPath(); h2.roundRect ? h2.roundRect(x, y, bw, bh, 8) : h2.rect(x, y, bw, bh); h2.fill(); };
      // Left: speed, altitude, vertical speed.
      box(8, H2 - 76 * s - 10, 128 * s + 20, 76 * s);
      h2.fillStyle = '#fff'; h2.textAlign = 'left';
      const line = (y, label, val, col = '#fff') => { h2.fillStyle = 'rgba(255,255,255,.6)'; h2.fillText(label, 18, y); h2.fillStyle = col; h2.fillText(val, 18 + 54 * s, y); };
      const by = H2 - 76 * s;
      line(by + 4, 'SPD', kmh ? `${Math.round(spd * 3.6)} km/h` : `${Math.round(spd * 1.944)} kt`, spd < plane.stall * 1.1 && !flight.onGround ? '#ff6b6b' : '#fff');
      line(by + 4 + 20 * s, 'ALT', kmh ? `${Math.max(0, Math.round(agl))} m` : `${Math.max(0, Math.round(agl * 3.28))} ft`, agl < 20 && !flight.onGround ? '#ffd166' : '#fff');
      line(by + 4 + 40 * s, 'V/S', `${flight.vel[1] >= 0 ? '+' : ''}${flight.vel[1].toFixed(1)} m/s`);
      // Throttle and flaps.
      const tx = W2 - 34, ty = H2 - 96 * s - 10;
      box(tx - 8, ty - 6, 34, 96 * s + 12);
      h2.fillStyle = 'rgba(255,255,255,.15)'; h2.fillRect(tx, ty, 18, 80 * s);
      h2.fillStyle = flight.throttle > 0.95 ? '#ff7e2d' : '#5ee08a'; h2.fillRect(tx, ty + 80 * s * (1 - flight.throttle), 18, 80 * s * flight.throttle);
      h2.fillStyle = '#fff'; h2.textAlign = 'center'; h2.font = `700 ${Math.round(9 * s + 2)}px system-ui`;
      h2.fillText(`${Math.round(flight.throttle * 100)}%`, tx + 9, ty + 80 * s + 9);
      if (flight.flaps) { h2.fillStyle = '#89c2ff'; h2.fillText('FLAPS', tx - 30, ty + 80 * s + 9); }
      if (flight.brake && flight.onGround) { h2.fillStyle = '#ffd166'; h2.fillText('BRAKE', tx - 30, ty + 80 * s - 8); }
      // Attitude: a little horizon ball.
      const cx = W2 / 2, cy = H2 - 44 * s - 8, R = 34 * s;
      h2.save(); h2.beginPath(); h2.arc(cx, cy, R, 0, Math.PI * 2); h2.clip();
      h2.translate(cx, cy); h2.rotate(-flight.bank);
      const off = clamp(flight.pitchAngle / (40 * DEG), -1.2, 1.2) * R;
      h2.fillStyle = '#4a90d9'; h2.fillRect(-R * 2, -R * 3 + off, R * 4, R * 3);
      h2.fillStyle = '#8a5a2b'; h2.fillRect(-R * 2, off, R * 4, R * 3);
      h2.strokeStyle = '#fff'; h2.lineWidth = 1.2; h2.beginPath(); h2.moveTo(-R, off); h2.lineTo(R, off); h2.stroke();
      h2.restore();
      h2.strokeStyle = '#ffd166'; h2.lineWidth = 2.5; h2.beginPath(); h2.moveTo(cx - R * 0.6, cy); h2.lineTo(cx - R * 0.2, cy); h2.lineTo(cx, cy + 5); h2.lineTo(cx + R * 0.2, cy); h2.lineTo(cx + R * 0.6, cy); h2.stroke();
      h2.strokeStyle = 'rgba(255,255,255,.5)'; h2.lineWidth = 1; h2.beginPath(); h2.arc(cx, cy, R, 0, Math.PI * 2); h2.stroke();
      // Top: mode status.
      h2.textAlign = 'center'; h2.font = `800 ${Math.round(15 * s + 3)}px system-ui`;
      let status = '';
      if (mode.id === 'hoops') status = `⭕ ${score}    ⏱ ${Math.max(0, Math.ceil(timeLeft))}s`;
      else if (mode.id === 'trial') status = `Hoop ${Math.min(nextHoop + 1, hoops.length)}/${hoops.length}    ⏱ ${elapsed.toFixed(1)}s`;
      else if (mode.id === 'landing') status = 'Land on the runway and stop';
      else status = flight.onGround && !hadTakeoff ? 'W for throttle · ↓ to lift off at speed' : 'Free flight';
      const tw = h2.measureText(status).width + 24;
      box(cx - tw / 2, 8, tw, 26 * s + 6); h2.fillStyle = '#fff'; h2.fillText(status, cx, 8 + (26 * s + 6) / 2);
      // Warnings.
      h2.font = `900 ${Math.round(16 * s + 4)}px system-ui`;
      const blink = Math.floor(performance.now() / 300) % 2;
      if (flight.stalled && blink) { h2.fillStyle = '#ff4d4d'; h2.fillText('STALL', cx, 56 * s + 10); }
      else if (!flight.onGround && agl < 40 && flight.vel[1] < -9 && blink) { h2.fillStyle = '#ffd166'; h2.fillText('PULL UP', cx, 56 * s + 10); }
      else if (!flight.onGround && Math.abs(flight.gload) > 5.5) { h2.fillStyle = '#ffd166'; h2.fillText(`${flight.gload.toFixed(1)} G`, cx, 56 * s + 10); }
      // Next hoop distance (and direction when it's off-screen).
      if (target) {
        const d = len(sub(target.pos, flight.pos));
        h2.font = `700 ${Math.round(11 * s + 2)}px system-ui`; h2.fillStyle = '#ffd166';
        h2.fillText(`next hoop ${Math.round(d)} m`, cx, 34 * s + 30);
      }
      if (paused) { h2.fillStyle = 'rgba(0,0,0,.3)'; h2.fillRect(0, 0, W2, H2); }
    }

    // ---- menus (HTML over the canvas)
    function statBar(label, v) { return `<div class="pg-stat">${label}<span><i style="width:${Math.round(clamp(v, 0.05, 1) * 100)}%"></i></span></div>`; }
    function fmtScore(m, v) { return m.id === 'trial' ? `${Number(v).toFixed(1)} s` : m.id === 'hoops' ? `${v}` : `${v}`; }
    function renderUI() {
      if (screen === 'fly') {
        ui.innerHTML = paused ? `<div class="pg-pause"><div class="pg-menu" style="width:auto;text-align:center"><h1 style="justify-content:center">Paused</h1>
          <div class="pg-row" style="justify-content:center;margin-top:8px"><button data-a="resume" class="pg-go">Resume (P)</button><button data-a="restart">Restart (R)</button><button data-a="menu">Menu</button></div></div></div>` : '';
        bind(); return;
      }
      if (screen === 'result') {
        const r = result, m = mode;
        const board = read(`board.${m.id}`, []);
        ui.innerHTML = `<div class="pg-menu pg-result">
          <h1 style="justify-content:center">${r.kind === 'crash' ? '💥 Crashed' : m.id === 'trial' ? '🏁 Finished' : m.id === 'landing' ? '🛬 Landed' : '🎉 Time!'}</h1>
          <div class="pg-hint">${r.label}</div>
          ${r.value != null && m.id !== 'free' ? `<div class="pg-big">${fmtScore(m, r.value)}${m.id === 'hoops' ? ' <span style="font-size:16px">hoops</span>' : m.id === 'landing' ? ' <span style="font-size:16px">points</span>' : ''}</div>` : ''}
          ${r.qualifies ? `<div class="pg-row" style="justify-content:center;margin:6px 0">🏆 New leaderboard score! <input maxlength="16" placeholder="Your name" value="${escapeHtml(playerName)}"><button data-a="save" class="pg-go" style="padding:5px 12px;font-size:12px">Save</button></div>` : ''}
          ${r.saved ? `<div class="pg-hint">Saved at #${r.rank} on the ${m.name} leaderboard.</div>` : ''}
          ${board.length ? `<h2>${m.name} leaderboard</h2>${table(m, board.slice(0, 5))}` : ''}
          <div class="pg-row" style="justify-content:center;margin-top:10px"><button data-a="again" class="pg-go">Fly again (R)</button><button data-a="menu">Menu</button></div>
        </div>`;
        bind(); const inp = ui.querySelector('input'); if (inp) { inp.focus(); inp.select(); }
        return;
      }
      // Main menu.
      const tabs = [['play', 'Fly'], ['board', 'Leaderboard'], ['ach', 'Challenges'], ['help', 'Controls']];
      let body = '';
      if (menuTab === 'play') {
        body = `<h2>1 · Pick your plane</h2><div class="pg-planes">${PLANES.map((p) => `<div class="pg-card ${p === plane ? 'pg-on' : ''}" data-plane="${p.id}">
            <b>${p.name}</b><i>${p.kind}</i>${statBar('Speed', p.max / 240)}${statBar('Agility', p.roll / 4.2)}${statBar('Easy', (p.stability - 1.5) / 1.2)}</div>`).join('')}</div>
          <div class="pg-hint" style="margin-top:4px">${plane.blurb}</div>
          <h2>2 · Pick a challenge</h2><div class="pg-modes">${MODES.map((m) => `<button class="pg-mode ${m === mode ? 'pg-on' : ''}" data-mode="${m.id}">${m.icon} ${m.name}<small>${m.desc}</small></button>`).join('')}</div>
          <div class="pg-row" style="margin-top:10px"><button class="pg-go" data-a="start">✈️ Take off (Enter)</button>
            <span class="pg-hint">Best: ${(() => { const b = read(`board.${mode.id}`, [])[0]; return b && mode.id !== 'free' ? `${fmtScore(mode, b.score)} by ${escapeHtml(b.name)}` : '—'; })()}</span></div>`;
      } else if (menuTab === 'board') {
        body = MODES.filter((m) => m.id !== 'free').map((m) => { const b = read(`board.${m.id}`, []); return `<h2>${m.icon} ${m.name}</h2>${b.length ? table(m, b) : '<div class="pg-hint">No scores yet. Be the first!</div>'}`; }).join('')
          + '<div class="pg-row" style="margin-top:8px"><button data-a="clear">Clear leaderboards</button><span class="pg-hint">Scores are kept on this computer.</span></div>';
      } else if (menuTab === 'ach') {
        body = `<h2>Challenges · ${[...done].filter((d) => CHALLENGES.some((c) => c.id === d)).length} / ${CHALLENGES.length}</h2><div class="pg-ach">${CHALLENGES.map((c) => `<div class="${done.has(c.id) ? 'pg-done' : ''}">${done.has(c.id) ? '🏅' : '🔒'} ${c.name} <small>${c.desc}</small></div>`).join('')}</div>`;
      } else {
        body = `<h2>Flying</h2><div class="pg-hint">
          <kbd>↑</kbd> <kbd>↓</kbd> pitch (${invert ? '↑ pulls up' : '↓ pulls up, like a real stick'}) · <kbd>←</kbd> <kbd>→</kbd> roll · <kbd>A</kbd> <kbd>D</kbd> rudder (and steering on the ground)<br>
          <kbd>W</kbd> <kbd>S</kbd> throttle · <kbd>F</kbd> flaps · <kbd>Space</kbd> brakes / airbrake · <kbd>C</kbd> camera (chase, cockpit, orbit) · <kbd>P</kbd> pause · <kbd>R</kbd> restart · <kbd>M</kbd> menu</div>
          <h2>Tips</h2><div class="pg-hint">Bank with ← → and pull gently to turn: the wings turn the plane, the rudder only tidies up. Too slow or pulling too hard
          stalls the wing (STALL): push the nose down and add power. To land: slow down, flaps down, line up with the runway, and touch down gently (watch V/S).
          To take off: full throttle on the runway, then ${invert ? '↑' : '↓'} at about ${Math.round(plane.stall * 1.3 * 3.6)} km/h.</div>
          <h2>Settings</h2><div class="pg-row">
          <button data-a="invert">${invert ? '✓ ' : ''}↑ pulls up (arcade)</button>
          <button data-a="sound">${sound ? '🔊 Sound on' : '🔇 Sound off'}</button>
          <button data-a="units">${units === 'kmh' ? 'km/h · m' : 'knots · feet'}</button></div>`;
      }
      ui.innerHTML = `<div class="pg-menu pg-side"><div class="pg-row"><h1>✈️ Plane</h1><div class="pg-tabs">${tabs.map(([id, n]) => `<button data-tab="${id}" class="${id === menuTab ? 'pg-on' : ''}">${n}</button>`).join('')}</div></div>${body}</div>`;
      bind();
    }
    const escapeHtml = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    function table(m, rows) {
      return `<table><tr><th>#</th><th>Pilot</th><th>Plane</th><th style="text-align:right">${m.id === 'trial' ? 'Time' : m.id === 'hoops' ? 'Hoops' : 'Points'}</th><th>Date</th></tr>${rows.map((e, i) => `<tr><td>${i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : i + 1}</td><td>${escapeHtml(e.name)}</td><td>${escapeHtml(e.plane)}</td><td class="pg-n">${fmtScore(m, e.score)}</td><td>${e.date}</td></tr>`).join('')}</table>`;
    }
    function bind() {
      ui.querySelectorAll('[data-plane]').forEach((n) => n.onclick = () => { plane = PLANES.find((p) => p.id === n.dataset.plane); write('plane', plane.id); flight = new Flight(plane); renderUI(); });
      ui.querySelectorAll('[data-mode]').forEach((n) => n.onclick = () => { mode = MODES.find((m) => m.id === n.dataset.mode); write('mode', mode.id); renderUI(); });
      ui.querySelectorAll('[data-tab]').forEach((n) => n.onclick = () => { menuTab = n.dataset.tab; write('menuTab', menuTab); renderUI(); });
      ui.querySelectorAll('[data-a]').forEach((n) => n.onclick = () => {
        const a = n.dataset.a;
        if (a === 'start' || a === 'again' || a === 'restart') start();
        else if (a === 'resume') { paused = false; renderUI(); root.focus(); }
        else if (a === 'menu') { screen = 'menu'; paused = false; if (engGain) engGain.gain.value = 0; renderUI(); }
        else if (a === 'save') saveScore();
        else if (a === 'invert') { invert = !invert; write('invert', invert); renderUI(); }
        else if (a === 'sound') { sound = !sound; write('sound', sound); if (!sound && engGain) engGain.gain.value = 0; renderUI(); }
        else if (a === 'units') { units = units === 'kmh' ? 'kt' : 'kmh'; write('units', units); renderUI(); }
        else if (a === 'clear') { if (window.confirm ? window.confirm('Clear every leaderboard on this computer?') : true) { MODES.forEach((m) => write(`board.${m.id}`, [])); renderUI(); } }
      });
    }

    // ---- main loop
    let raf = 0, last = performance.now(), alive = true;
    function frame(t) {
      if (!alive) return;
      const dt = Math.min(0.05, (t - last) / 1000); last = t;
      // Physics in small fixed steps so fast planes stay stable.
      let left = dt; while (left > 1e-4) { const h = Math.min(left, 1 / 120); update(h); left -= h; }
      for (const s of smoke) { s.t += dt; s.p = add(s.p, mul(s.v, dt)); s.v[1] += 2 * dt; }
      for (let i = smoke.length - 1; i >= 0; i--) if (smoke[i].t > smoke[i].life) smoke.splice(i, 1);
      render(t);
      raf = requestAnimationFrame(frame);
    }
    renderUI();
    raf = requestAnimationFrame(frame);
    root.focus();

    return () => {
      alive = false; cancelAnimationFrame(raf);
      window.removeEventListener('keydown', kd); window.removeEventListener('keyup', ku); window.removeEventListener('blur', blur);
      try { ac?.close(); } catch { /* already closed */ }
      root.remove();
    };
  }

  window.NotchPlaneGame = { mount, PLANES, MODES, CHALLENGES, Flight, _test: { groundAt, makeWorld, qheading, qrot } };
})();
