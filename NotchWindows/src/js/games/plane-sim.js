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
    { id: 'c172', name: 'Cessna 172', kind: 'Skyhawk', blurb: 'The classic trainer: slow, stable and forgiving. Lands itself, almost.',
      stall: 24, cruise: 52, max: 78, thrust: 3.3, authority: 0.8, pitch: 1.3, roll: 1.9, yaw: 0.55, stability: 2.6, gear: 1.3, scale: 1, cam: 1,
      span: 5.6, wingY: 1.1, wingZ: -1.1, nose: -3.4, tail: 5.2, gLimit: 5.5, wingX: 1.0, tailZ: 3.9 },
    { id: 'pa28', name: 'Piper PA-28', kind: 'Cherokee', blurb: 'A low-wing tourer. A little quicker than the Cessna and just as friendly.',
      stall: 25, cruise: 58, max: 86, thrust: 3.7, authority: 0.85, pitch: 1.4, roll: 2.1, yaw: 0.55, stability: 2.4, gear: 1.3, scale: 1, cam: 1,
      span: 5.4, wingY: -0.6, wingZ: 0.2, nose: -3.3, tail: 5.0, gLimit: 5.5, wingX: 1.15, tailZ: 3.6 },
    { id: 'b737', name: 'Boeing 737', kind: 'Airliner', blurb: 'Twin-engine jet. Heavy and calm: turn early and land with flaps.',
      stall: 62, cruise: 140, max: 215, thrust: 7.5, authority: 0.8, pitch: 1.0, roll: 0.75, yaw: 0.25, stability: 2.3, gear: 1.9, scale: 1, cam: 1.9,
      span: 6.85, wingY: 0.0, wingZ: 1.8, nose: -7.8, tail: 7.8, gLimit: 5.2, wingX: 1.1, tailZ: 5.0 },
    { id: 'b747', name: 'Boeing 747', kind: 'Jumbo', blurb: 'Four engines and a hump. The biggest and slowest to turn: plan well ahead.',
      stall: 68, cruise: 150, max: 225, thrust: 6.8, authority: 0.8, pitch: 0.9, roll: 0.55, yaw: 0.2, stability: 2.4, gear: 2.5, scale: 1, cam: 3.0,
      span: 12.8, wingY: 0.1, wingZ: 4.1, nose: -14, tail: 14, gLimit: 5.2, wingX: 1.7, tailZ: 9.2 },
    { id: 'b777', name: 'Boeing 777', kind: 'Airliner', blurb: 'Huge twin-jet with big engines. Powerful, smooth and a little nimbler than the 747.',
      stall: 66, cruise: 160, max: 240, thrust: 8.0, authority: 0.8, pitch: 0.95, roll: 0.65, yaw: 0.22, stability: 2.3, gear: 2.4, scale: 1, cam: 2.8,
      span: 12.2, wingY: -0.15, wingZ: 3.15, nose: -13, tail: 13, gLimit: 5.2, wingX: 1.6, tailZ: 8.5 },
  ];

  /// A simple airliner built from boxes, nose towards -z. Sizes are about 40% of the real aircraft so the game's
  /// hoops and runway still suit it.
  function airliner(c) {
    const b = new Builder();
    const L = c.L, D = c.D, h = L / 2;
    const hull = hex(c.body), trim = hex(c.trim), tailc = hex(c.tail), dark = hex('#2a2f36'), glass = hex('#24313f'), eng = hex(c.engine || '#aeb6bf');
    const zNose = -h, zA = -h + L * 0.13, zB = h - L * 0.27, zT = h;
    b.taper(0, 0, zNose, D * 0.3, D * 0.3, zA, D, D, hull);                         // nose
    b.taper(0, 0, zA, D, D, zB, D, D, hull);                                         // barrel
    b.taper(0, 0, zB, D, D, zT, D * 0.22, D * 0.28, hull, D * 0.28);                 // tail cone
    b.taper(0, -D * 0.3, zA, D * 1.02, D * 0.4, zB, D * 1.02, D * 0.4, trim);        // belly colour
    b.box([0, D * 0.42, zA - L * 0.035], [D * 0.5, D * 0.1, L * 0.05], glass);       // cockpit windows
    for (const sx of [-1, 1]) b.box([sx * (D / 2 + 0.02), D * 0.14, (zA + zB) / 2], [0.05, D * 0.1, zB - zA - L * 0.03], glass);
    if (c.hump) b.taper(0, D * 0.52, zA - L * 0.01, D * 0.66, D * 0.4, zA + L * 0.24, D * 0.5, D * 0.2, hull);   // the 747's upper deck
    // Wings: swept, low, with the engines slung underneath.
    const wz = c.wingZ, wy = -D * 0.3;
    for (const sx of [-1, 1]) {
      b.wing(0, wz, wz + c.root, sx * c.span / 2, wz + c.sweep, wz + c.sweep + c.tip, wy, D * 0.09, hull, c.dihedral);
      if (c.winglets) b.box([sx * c.span / 2, wy + c.dihedral + 0.35, wz + c.sweep + c.tip * 0.5], [0.06, 0.8, c.tip * 0.9], trim);
    }
    for (const e of c.engines) {
      const ey = wy - e.d * 0.55 + c.dihedral * Math.abs(e.x) / (c.span / 2);
      b.taper(e.x, ey, e.z, e.d, e.d, e.z + e.len, e.d * 0.82, e.d * 0.82, eng);
      b.box([e.x, ey, e.z - 0.02], [e.d * 0.7, e.d * 0.7, 0.06], dark);
    }
    // Tail.
    const finH = c.fin;
    b.taper(0, D * 0.45 + finH * 0.5, zT - L * 0.2, 0.22, finH, zT - 0.03, 0.12, finH * 0.7, tailc, finH * 0.3);
    for (const sx of [-1, 1]) b.wing(0, zT - L * 0.16, zT - L * 0.05, sx * L * 0.2, zT - L * 0.09, zT - 0.02, D * 0.1, D * 0.06, hull, 0.15);
    // Landing gear: two main legs under the wing roots and a nose leg.
    const gb = -D / 2, gh = c.gearH;
    for (const sx of [-1, 1]) {
      b.box([sx * D * 0.55, gb - gh / 2, wz + c.root * 1.1], [0.14, gh, 0.14], dark);
      b.box([sx * D * 0.55, gb - gh + 0.25, wz + c.root * 1.1], [0.42, 0.5, 1.0], dark);
    }
    b.box([0, gb - gh / 2, zNose + L * 0.11], [0.12, gh, 0.12], dark);
    b.box([0, gb - gh + 0.25, zNose + L * 0.11], [0.32, 0.5, 0.5], dark);
    return { body: b, prop: null, propAt: null };
  }

  function buildPlane(id) {
    const b = new Builder();
    const prop = new Builder();
    if (id === 'c172') {
      const body = hex('#f5f6fa'), trim = hex('#1f5fb5'), glass = hex('#2c3e50'), dark = hex('#333333');
      b.taper(0, 0, -3.2, 1.2, 1.3, 0.5, 1.2, 1.5, body);          // nose to cabin
      b.taper(0, 0.1, 0.5, 1.2, 1.5, 5.2, 0.35, 0.5, body, 0.35);  // tail cone
      b.box([0, 0.75, -1.2], [1.1, 0.55, 1.6], glass);             // cabin windows
      b.taper(0, -0.2, -2.0, 1.22, 0.16, 4.6, 0.4, 0.14, trim);     // stripe along the side
      b.wing(0, -1.8, -0.4, 5.6, -1.6, -0.6, 1.05, 0.14, body, 0.15); b.wing(0, -1.8, -0.4, -5.6, -1.6, -0.6, 1.05, 0.14, body, 0.15);
      b.box([5.5, 1.2, -1.1], [0.5, 0.16, 1.05], trim); b.box([-5.5, 1.2, -1.1], [0.5, 0.16, 1.05], trim);
      b.box([2.3, 0.15, -0.95], [0.09, 1.7, 0.12], dark); b.box([-2.3, 0.15, -0.95], [0.09, 1.7, 0.12], dark);   // wing struts
      b.wing(0, 4.4, 5.3, 2.0, 4.7, 5.3, 0.4, 0.08, body); b.wing(0, 4.4, 5.3, -2.0, 4.7, 5.3, 0.4, 0.08, body);
      b.taper(0, 0.9, 4.2, 0.1, 0.2, 5.3, 0.1, 1.6, trim, 0.6);   // fin
      b.box([0.8, -1.0, -1.0], [0.12, 0.8, 0.12], dark); b.box([-0.8, -1.0, -1.0], [0.12, 0.8, 0.12], dark);
      b.box([0.8, -1.35, -1.0], [0.2, 0.45, 0.45], dark); b.box([-0.8, -1.35, -1.0], [0.2, 0.45, 0.45], dark);
      b.box([0, -0.95, -2.6], [0.2, 0.7, 0.4], dark);
      b.box([0, 0, -3.3], [0.35, 0.35, 0.3], trim);
      prop.box([0, 0, 0], [0.18, 2.1, 0.06], dark);
      return { body: b, prop, propAt: [0, 0, -3.5] };
    }
    if (id === 'pa28') {
      const body = hex('#f2f3f5'), trim = hex('#c0392b'), glass = hex('#34495e'), dark = hex('#2d3436');
      b.taper(0, 0, -3.0, 1.15, 1.25, 0.6, 1.15, 1.4, body);
      b.taper(0, 0.05, 0.6, 1.15, 1.4, 4.9, 0.3, 0.45, body, 0.25);
      b.box([0, 0.72, -0.9], [1.0, 0.45, 1.5], glass);
      b.taper(0, -0.15, -2.0, 1.17, 0.14, 4.3, 0.34, 0.12, trim);
      b.wing(0, -0.5, 0.9, 5.4, -0.5, 0.9, -0.75, 0.15, body, 0.35); b.wing(0, -0.5, 0.9, -5.4, -0.5, 0.9, -0.75, 0.15, body, 0.35);
      b.box([5.3, -0.45, 0.2], [0.5, 0.17, 1.3], trim); b.box([-5.3, -0.45, 0.2], [0.5, 0.17, 1.3], trim);
      b.wing(0, 4.1, 5.1, 2.2, 4.3, 5.1, 0.1, 0.1, body); b.wing(0, 4.1, 5.1, -2.2, 4.3, 5.1, 0.1, 0.1, body);   // stabilator
      b.taper(0, 0.8, 3.6, 0.12, 0.2, 5.0, 0.1, 1.5, trim, 0.7);                                                // fin
      for (const x of [-1.0, 1.0]) { b.box([x, -0.95, -0.4], [0.1, 0.7, 0.1], dark); b.box([x, -1.05, -0.4], [0.22, 0.5, 0.5], dark); }
      b.box([0, -0.9, -2.3], [0.1, 0.7, 0.1], dark); b.box([0, -1.05, -2.3], [0.2, 0.5, 0.45], dark);
      b.box([0, 0, -3.05], [0.4, 0.4, 0.3], trim);
      prop.box([0, 0, 0], [0.18, 2.0, 0.06], dark);
      return { body: b, prop, propAt: [0, 0, -3.3] };
    }
    if (id === 'b737') return airliner({ L: 15.6, D: 1.5, span: 13.7, wingZ: -1.1, root: 2.3, tip: 0.6, sweep: 2.6, dihedral: 0.5, winglets: true, fin: 2.4, gearH: 1.15,
      body: '#f4f6f8', trim: '#1e6bd6', tail: '#1e6bd6', engines: [-1, 1].map((sx) => ({ x: sx * 3.0, z: -2.0, d: 0.85, len: 1.9 })) });
    if (id === 'b747') return airliner({ L: 28, D: 2.6, span: 25.6, wingZ: -2.0, root: 3.9, tip: 1.0, sweep: 5.6, dihedral: 0.9, hump: true, fin: 4.2, gearH: 1.9,
      body: '#f4f6f8', trim: '#b5322a', tail: '#b5322a', engines: [-1, 1].flatMap((sx) => [{ x: sx * 4.4, z: -3.0, d: 1.0, len: 2.4 }, { x: sx * 8.4, z: -1.1, d: 1.0, len: 2.4 }]) });
    if (id === 'b777') return airliner({ L: 26, D: 2.5, span: 24.4, wingZ: -2.0, root: 3.9, tip: 0.9, sweep: 4.7, dihedral: 0.6, fin: 3.7, gearH: 1.8,
      body: '#f4f6f8', trim: '#223a66', tail: '#0b7d63', engines: [-1, 1].map((sx) => ({ x: sx * 4.9, z: -3.0, d: 1.45, len: 3.0 })) });
    return { body: b, prop: null, propAt: null };
  }

  // ------------------------------------------------------------------ the world

  const RUNWAY = { x: 0, z0: 0, z1: -1400, half: 22 };   // the main runway runs from z = 0 towards -z
  /// A second, shorter strip on a plateau in the hills.
  const RIDGE = { x: -2300, z0: 1250, z1: 550, half: 16, y: 120 };
  const WORLD = 9000, WATER = -2;
  const VALLEY = [0, -700];                                // the middle of the valley the airfield sits in
  const LAKE = { x: -1500, z: -2200, r: 520 };
  /// The river runs from the lake into the mountains, where it has cut a canyon.
  const RIVER = [[-1500, -2200], [-2600, -3400], [-3500, -4700], [-4100, -6400], [-4300, -8800]];
  const BRIDGE = { x: -2050, z: -2800 };

  // Smooth value noise for the hills and the mountain ridges.
  function hash2(i, j) { let h = (Math.imul(i, 374761393) + Math.imul(j, 668265263)) | 0; h = Math.imul(h ^ (h >>> 13), 1274126177); return ((h ^ (h >>> 16)) >>> 0) / 4294967296; }
  function vnoise(x, z) {
    const i = Math.floor(x), j = Math.floor(z), fx = x - i, fz = z - j, u = fx * fx * (3 - 2 * fx), v = fz * fz * (3 - 2 * fz);
    const a = hash2(i, j), b = hash2(i + 1, j), c = hash2(i, j + 1), d = hash2(i + 1, j + 1);
    return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
  }
  const fbm = (x, z, oct = 4) => { let s = 0, a = 0.5, f = 1; for (let k = 0; k < oct; k++) { s += vnoise(x * f, z * f) * a; f *= 2.03; a *= 0.5; } return s; };
  const ridged = (x, z) => { let s = 0, a = 0.55, f = 1; for (let k = 0; k < 4; k++) { const n = 1 - Math.abs(vnoise(x * f, z * f) * 2 - 1); s += n * n * a; f *= 2.1; a *= 0.5; } return s; };
  const smooth = (e0, e1, x) => { const t = clamp((x - e0) / (e1 - e0), 0, 1); return t * t * (3 - 2 * t); };
  function distSeg(px, pz, a, b) {
    const dx = b[0] - a[0], dz = b[1] - a[1], t = clamp(((px - a[0]) * dx + (pz - a[1]) * dz) / (dx * dx + dz * dz), 0, 1);
    return Math.hypot(px - a[0] - dx * t, pz - a[1] - dz * t);
  }
  const riverDist = (x, z) => { let d = Infinity; for (let i = 0; i < RIVER.length - 1; i++) d = Math.min(d, distSeg(x, z, RIVER[i], RIVER[i + 1])); return d; };

  /// The terrain's shape before it is sampled into the grid: a flat valley for the airfield and the town, rolling
  /// hills around it, a ring of ridged mountains, a plateau for the second strip, the lake and the river's canyon.
  function terrainShape(x, z) {
    const d = Math.hypot(x - VALLEY[0], z - VALLEY[1]);
    let h = (fbm(x / 900, z / 900) - 0.32) * 260 * smooth(1300, 2300, d);                 // rolling hills
    h += ridged(x / 1500, z / 1500) * 1150 * smooth(2900, 4600, d);                        // the mountains
    h = Math.max(h, 0);
    const pd = Math.hypot(x - RIDGE.x, z - (RIDGE.z0 + RIDGE.z1) / 2);
    h += (RIDGE.y - h) * (1 - smooth(420, 720, pd));                                       // the plateau
    const ld = Math.hypot(x - LAKE.x, z - LAKE.z);
    h += (-14 - h) * (1 - smooth(LAKE.r - 160, LAKE.r + 80, ld));                           // the lake
    const rd = riverDist(x, z), wide = 150 + 170 * smooth(2600, 4800, d);                    // the river: a canyon wide enough to fly
    h += (-10 - h) * (1 - smooth(wide * 0.45, wide, rd));
    // Keep the airfield and the town perfectly flat.
    const air = Math.max(Math.abs(x) - 160, 0) + Math.max(z - 260, RUNWAY.z1 - 260 - z, 0);
    const town = Math.hypot(Math.max(Math.abs(x - 1250) - 450, 0), Math.max(Math.abs(z + 1350) - 550, 0));
    h *= smooth(0, 220, Math.min(air, town));
    return h;
  }

  function makeWorld() {
    const r = rng(7), b = new Builder();
    // ---- terrain grid (the ground the plane collides with is exactly these triangles)
    const N = 240, CELL = (WORLD * 2) / N;
    const H = new Float32Array((N + 1) * (N + 1));
    for (let j = 0; j <= N; j++) for (let i = 0; i <= N; i++) H[j * (N + 1) + i] = terrainShape(-WORLD + i * CELL, -WORLD + j * CELL);
    const world = { N, CELL, H, colliders: [], grid: new Map(), turbines: [] };
    const fields = ['#5a8f3c', '#6aa84f', '#4e7d32', '#8bb34a', '#b5a642', '#7c9c3b', '#a1b856', '#c9b458'].map(hex);
    const rock = hex('#7a7266'), rock2 = hex('#6e7f80'), snow = hex('#f4f6f7'), sand = hex('#c2b280'), forest = hex('#3f6b2c');
    const colour = (x, y, z, slope) => {
      if (y < WATER + 1) return sand;
      if (y > 760 - vnoise(x / 300, z / 300) * 140) return snow;
      if (slope > 0.9 || y > 420) return y > 300 ? rock2 : rock;
      if (y > 40) return vnoise(x / 400, z / 400) > 0.55 ? forest : hex('#5f8a3a');
      return fields[Math.floor(hash2(Math.floor(x / 260), Math.floor(z / 260)) * fields.length)];
    };
    const P = (i, j) => [-WORLD + i * CELL, H[j * (N + 1) + i], -WORLD + j * CELL];
    for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
      const a = P(i, j), c = P(i + 1, j), e = P(i, j + 1), f = P(i + 1, j + 1);
      for (const [p, q, t] of [[a, c, e], [c, f, e]]) {
        const n = norm(cross(sub(t, p), sub(q, p)));
        const m = mul(add(add(p, q), t), 1 / 3);
        const col = colour(m[0], m[1], m[2], 1 - Math.abs(n[1]));
        b.tri(p, q, t, col.map((v) => v * (0.94 + hash2(i * 7 + j, j * 3 - i) * 0.08)), add(m, [0, -10, 0]));
      }
    }
    // Water: one sheet at the water level; the dry land sits above it.
    const water = hex('#3a7bd5');
    b.quad([-WORLD, WATER, -WORLD], [WORLD, WATER, -WORLD], [WORLD, WATER, WORLD], [-WORLD, WATER, WORLD], water, [0, -100, 0]);

    // ---- solid things: drawn, and added to a coarse grid of boxes the plane can hit
    const solid = (min, max, kind) => {
      const c = { min, max, kind };
      world.colliders.push(c);
      for (let gx = Math.floor(min[0] / 200); gx <= Math.floor(max[0] / 200); gx++) for (let gz = Math.floor(min[2] / 200); gz <= Math.floor(max[2] / 200); gz++) {
        const k = `${gx},${gz}`; if (!world.grid.has(k)) world.grid.set(k, []); world.grid.get(k).push(c);
      }
    };
    const block = (c, s, col, kind) => { b.box(c, s, col); if (kind) solid(sub(c, mul(s, 0.5)), add(c, mul(s, 0.5)), kind); };
    const gAt = (x, z) => groundAt(world, x, z);

    // Main runway with centre-line dashes, threshold bars and edge lights.
    const asphalt = hex('#3b3f45'), paint = hex('#f2f2f2'), grass = hex('#4b7a2e');
    b.quad([-60, 0.1, 80], [60, 0.1, 80], [60, 0.1, RUNWAY.z1 - 80], [-60, 0.1, RUNWAY.z1 - 80], grass);
    b.quad([-RUNWAY.half, 0.2, RUNWAY.z0], [RUNWAY.half, 0.2, RUNWAY.z0], [RUNWAY.half, 0.2, RUNWAY.z1], [-RUNWAY.half, 0.2, RUNWAY.z1], asphalt);
    for (let z = -40; z > RUNWAY.z1 + 40; z -= 60) b.quad([-0.8, 0.3, z], [0.8, 0.3, z], [0.8, 0.3, z - 30], [-0.8, 0.3, z - 30], paint);
    for (const z0 of [-6, RUNWAY.z1 + 30]) for (let x = -18; x <= 18; x += 4) if (Math.abs(x) > 2) b.quad([x - 1, 0.3, z0], [x + 1, 0.3, z0], [x + 1, 0.3, z0 - 24], [x - 1, 0.3, z0 - 24], paint);
    for (let z = 0; z > RUNWAY.z1; z -= 70) for (const x of [-RUNWAY.half - 1, RUNWAY.half + 1]) b.box([x, 0.5, z], [0.6, 0.8, 0.6], hex('#ffe066'));
    // The mountain strip on its plateau.
    const ry = RIDGE.y;
    b.quad([RIDGE.x - RIDGE.half, ry + 0.2, RIDGE.z0], [RIDGE.x + RIDGE.half, ry + 0.2, RIDGE.z0], [RIDGE.x + RIDGE.half, ry + 0.2, RIDGE.z1], [RIDGE.x - RIDGE.half, ry + 0.2, RIDGE.z1], hex('#6d5a46'));
    for (let z = RIDGE.z0 - 30; z > RIDGE.z1 + 30; z -= 50) b.quad([RIDGE.x - 0.7, ry + 0.3, z], [RIDGE.x + 0.7, ry + 0.3, z], [RIDGE.x + 0.7, ry + 0.3, z - 22], [RIDGE.x - 0.7, ry + 0.3, z - 22], paint);
    block([RIDGE.x + 60, ry + 6, 900], [30, 12, 24], hex('#b5651d'), 'hangar');
    block([RIDGE.x + 60, ry + 13, 900], [32, 2, 26], hex('#7f3f00'));
    // Airfield buildings.
    block([110, 9, -300], [50, 18, 36], hex('#95a5a6'), 'hangar'); b.box([110, 19, -300], [50, 2, 38], hex('#c0392b'));
    block([110, 9, -380], [50, 18, 36], hex('#95a5a6'), 'hangar'); b.box([110, 19, -380], [50, 2, 38], hex('#2980b9'));
    block([90, 14, -520], [10, 28, 10], hex('#ecf0f1'), 'tower'); block([90, 31, -520], [14, 6, 14], hex('#34495e'), 'tower');
    b.box([80, 0.15, -340], [40, 0.2, 200], hex('#555b61'));
    // The town: streets of houses and a few taller blocks in the middle.
    const walls = ['#d5d8dc', '#e8d8c3', '#c39b77', '#aab7b8', '#f5cba7', '#e6b0aa'].map(hex), roofs = ['#a04000', '#7b241c', '#5d6d7e'].map(hex);
    for (let gx = 0; gx < 9; gx++) for (let gz = 0; gz < 10; gz++) {
      if (r() < 0.2) continue;
      const x = 850 + gx * 95 + (r() - 0.5) * 20, z = -850 - gz * 100 + (r() - 0.5) * 20;
      const centre = Math.hypot(x - 1250, z + 1350) < 250, h = centre ? 30 + r() * 60 : 8 + r() * 14;
      const w = 22 + r() * 22, d = 22 + r() * 22;
      block([x, h / 2, z], [w, h, d], walls[Math.floor(r() * walls.length)], 'building');
      if (!centre) b.cone([x, h, z], Math.min(w, d) * 0.62, 0, 6 + r() * 4, roofs[Math.floor(r() * roofs.length)], 4);
    }
    // The bridge over the river (fly under it!).
    const deckY = 30, rdir = norm([RIVER[1][0] - RIVER[0][0], 0, RIVER[1][1] - RIVER[0][1]]), across = [-rdir[2], 0, rdir[0]];
    for (let k = -6; k <= 6; k++) {
      const c = add([BRIDGE.x, deckY, BRIDGE.z], mul(across, k * 18));
      block(c, [16, 3, 16], hex('#a04000'), 'bridge');
      if (Math.abs(k) === 2 || Math.abs(k) === 6) block([c[0], (deckY - 1.5 + WATER) / 2, c[2]], [6, deckY - WATER, 6], hex('#784212'), 'bridge');
    }
    // A radio mast on a hill, with a red light.
    const mx = -700, mz = 1700, mg = gAt(mx, mz);
    block([mx, mg + 110, mz], [3, 220, 3], hex('#c0392b'), 'mast'); b.box([mx, mg + 221, mz], [4, 3, 4], hex('#ff3b30'));
    // A wind farm on the eastern hills; the blades turn (drawn each frame), and flying into a rotor is a crash.
    for (let k = 0; k < 7; k++) {
      const x = 2500 + (k % 4) * 260 + (r() - 0.5) * 60, z = 500 + Math.floor(k / 4) * 380 + (r() - 0.5) * 60, g = gAt(x, z);
      block([x, g + 40, z], [3, 80, 3], hex('#ecf0f1'), 'turbine');
      b.box([x, g + 80, z + 2], [4, 4, 8], hex('#dfe6e9'));
      world.turbines.push({ hub: [x, g + 80, z - 2.5], phase: r() * 6 });
      solid([x - 26, g + 54, z - 4], [x + 26, g + 106, z - 1], 'turbine');
    }
    // Forests on the hills, single trees in the valley; none on runways, roads, water or bare rock.
    const leaf = [hex('#2e6b30'), hex('#3c7d3a'), hex('#285e2a')], bark = hex('#6b4f2a');
    for (let i = 0; i < 1800; i++) {
      const x = (r() - 0.5) * 9000, z = (r() - 0.5) * 9000 - 700;
      const g = gAt(x, z);
      if (g < WATER + 2 || g > 380) continue;
      if (g < 1 && r() < 0.65) continue;                                            // fewer trees in the flat valley
      if (Math.abs(x) < 140 && z < 200 && z > RUNWAY.z1 - 200) continue;
      if (Math.hypot(x - RIDGE.x, z - (RIDGE.z0 + RIDGE.z1) / 2) < 450) continue;
      if (x > 780 && x < 1720 && z < -780 && z > -1900) continue;
      if (Math.abs(x - 110) < 90 && z < -200 && z > -600) continue;
      const h = 10 + r() * 14;
      b.cone([x, g - 1, z], 0.8, 0.8, h * 0.3 + 1, bark, 5);
      b.cone([x, g + h * 0.25, z], h * 0.35, 0, h * 0.8, leaf[i % 3], 6);
      solid([x - h * 0.22, g - 1, z - h * 0.22], [x + h * 0.22, g + h, z + h * 0.22], 'tree');
    }

    // Clouds: flat-bottomed puffs.
    const cl = new Builder();
    for (let i = 0; i < 70; i++) {
      const x = (r() - 0.5) * 12000, z = (r() - 0.5) * 12000, y = 520 + r() * 520;
      for (let k = 0; k < 4; k++) cl.box([x + (r() - 0.5) * 120, y + r() * 20, z + (r() - 0.5) * 120], [60 + r() * 70, 18 + r() * 22, 50 + r() * 60], [1, 1, 1]);
    }
    return Object.assign(world, { world: b, clouds: cl });
  }

  /// Ground height under (x, z), matching the drawn terrain triangles exactly (water counts as the surface).
  function terrainAt(world, x, z) {
    const { N, CELL, H } = world;
    const gx = clamp((x + WORLD) / CELL, 0, N - 1e-6), gz = clamp((z + WORLD) / CELL, 0, N - 1e-6);
    const i = Math.floor(gx), j = Math.floor(gz), fx = gx - i, fz = gz - j, row = N + 1;
    const h00 = H[j * row + i], h10 = H[j * row + i + 1], h01 = H[(j + 1) * row + i], h11 = H[(j + 1) * row + i + 1];
    return fx + fz < 1 ? h00 + (h10 - h00) * fx + (h01 - h00) * fz : h11 + (h01 - h11) * (1 - fx) + (h10 - h11) * (1 - fz);
  }
  function groundAt(world, x, z) { return Math.max(terrainAt(world, x, z), WATER); }
  const overWater = (world, x, z) => terrainAt(world, x, z) < WATER;
  /// The solid thing (tree, building, bridge…) a point is inside, if any.
  function hitObject(world, p) {
    const list = world.grid.get(`${Math.floor(p[0] / 200)},${Math.floor(p[2] / 200)}`);
    if (!list) return null;
    for (const c of list) if (p[0] > c.min[0] && p[0] < c.max[0] && p[1] > c.min[1] && p[1] < c.max[1] && p[2] > c.min[2] && p[2] < c.max[2]) return c;
    return null;
  }
  const onRunway = (p) => (Math.abs(p[0] - RUNWAY.x) < RUNWAY.half && p[2] < RUNWAY.z0 + 5 && p[2] > RUNWAY.z1 - 5)
    || (Math.abs(p[0] - RIDGE.x) < RIDGE.half && p[2] < RIDGE.z0 + 5 && p[2] > RIDGE.z1 - 5);
  const onRidge = (p) => Math.abs(p[0] - RIDGE.x) < RIDGE.half && p[2] < RIDGE.z0 + 5 && p[2] > RIDGE.z1 - 5;

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
      // What still works: each wing, the engine (and how much power it still makes), the undercarriage.
      this.damage = { L: true, R: true, engine: true, power: 1, gear: true };
      this.events = []; this.overT = 0; this.ogT = 0; this.why = ''; this.impactVel = v3();
    }
    axes() { return { f: qrot(this.q, [0, 0, -1]), u: qrot(this.q, [0, 1, 0]), r: qrot(this.q, [1, 0, 0]) }; }
    get speed() { return len(this.vel); }
    get pitchAngle() { return Math.asin(clamp(this.axes().f[1], -1, 1)); }
    get bank() { const a = this.axes(); return Math.atan2(-a.r[1], a.u[1]); }
    get heading() { const f = this.axes().f; return Math.atan2(f[0], -f[2]); }
    get wings() { return (this.damage.L ? 0.5 : 0) + (this.damage.R ? 0.5 : 0); }

    /// The engine stops (or, partly, runs rough at a fraction of its power).
    failEngine(partial = false) {
      if (!this.damage.engine && !partial) return;
      if (partial) this.damage.power = Math.min(this.damage.power, 0.35);
      else { this.damage.engine = false; this.damage.power = 0; }
    }
    loseWing(side, cause) {
      if (!this.damage[side]) return;
      this.damage[side] = false;
      this.events.push({ type: 'wing', side, cause });
    }

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
      const wings = this.wings;
      // Lift is perpendicular to the airflow, in the plane of the wings' "up"; a missing wing takes its half away.
      let liftDir = sub(u, mul(vhat, dot(u, vhat)));
      liftDir = len(liftDir) > 1e-4 ? norm(liftDir) : u;
      const lift = mul(liftDir, q * cl * wings);
      const cd = this.cd0 * (1 + this.flaps * 1.6) + this.ki * cl * cl * wings + (this.brake && !this.onGround ? 0.06 : 0) + (wings < 1 ? 0.02 : 0);
      const drag = mul(vhat, -q * cd);
      const side = mul(r, -q * Math.sin(beta) * 0.6);         // the fuselage resists skidding
      // Thrust fades a little with speed, like a propeller; a failed engine gives none.
      const power = this.damage.engine ? this.damage.power : 0;
      const thrust = mul(f, this.throttle * power * s.thrust * (1.15 - 0.3 * clamp(V / s.max, 0, 1)));
      const acc = add(add(add(lift, drag), add(side, thrust)), [0, -G, 0]);
      this.gload = dot(add(acc, [0, G, 0]), u) / G;

      // Rotation: what you ask for (weaker when slow) plus the aircraft's own stability pulling the nose into the wind.
      const eff = clamp((V - s.stall * 0.35) / (s.cruise - s.stall * 0.35), 0.08, 1.25);
      const stab = s.stability * clamp(V / s.cruise, 0, 1.5);
      // Pitch asks for an angle of attack (full stick ≈ the plane's limit, near the stall), so it feels the same at
      // every speed: the nose comes round quickly when fast and mushes when slow, and over-pulling still stalls.
      // Hands off, it keeps its current climb or descent, and holds height in a bank (a friendly autotrim). On the
      // wheels there is no trim: the nose only comes up when you pull.
      const stabT = stab * 0.9 + 0.4, path = this.k * V * this.clSlope * Math.max(wings, 0.05);
      const aMax = stallAoa * s.authority;
      const gamma = Math.asin(clamp(vhat[1], -1, 1));
      const need = G * Math.cos(gamma) / Math.max(Math.cos(this.bank), 0.5);
      const trim = V > 1 && !this.onGround && wings > 0 ? clamp((need / (this.k * V * V * wings) - this.flaps * 0.35) / this.clSlope, -0.05, aMax * 0.85) : 0;
      const aCmd = input.pitch >= 0 ? trim + input.pitch * (aMax - trim) : trim + input.pitch * (trim + aMax * 0.55);
      const intact = wings === 1;
      const target = [
        clamp(aCmd * (stabT + path) - this.aoa * stabT + (V > 5 && !this.onGround ? this.k * V * this.flaps * 0.35 - G * Math.cos(gamma) / V : 0), -s.pitch * 1.6, s.pitch * 1.6),
        -input.yaw * s.yaw * eff - beta * stab,
        -input.roll * s.roll * eff * Math.max(wings, 0.3),
      ];
      // Wing leveller: with the roll keys released, the wings roll back to level by themselves (positive roll
      // rate is to the left, and a positive bank is right wing down, so the bank itself is the correction).
      // Only hands off and not upside down, so loops and inverted flight still work.
      if (input.roll === 0 && input.pitch === 0 && Math.abs(this.bank) < 100 * DEG && !this.onGround && intact && !this.stalled) {
        target[2] += Math.sin(this.bank) * 1.3 * clamp(V / s.cruise, 0.3, 1);
      }
      // A missing wing: all the lift is on the other side, so it rolls hard towards the stump.
      if (!intact && wings > 0) target[2] += (this.damage.L ? -1 : 1) * clamp(q * Math.abs(cl) / G, 0.3, 2.5) * 2.2;
      // A stall drops the nose, and whichever wing is already low drops further (never a random roll).
      if (this.stalled) { target[0] -= 0.35; target[2] += this.bank * 0.6; }
      if (this.onGround) {
        target[2] = this.bank * 4;                              // wheels keep the wings level
        target[1] = -input.yaw * 0.6 - input.roll * 0.3;        // steer with rudder (or the arrows) on the ground
        if (V < s.stall * 0.7) target[0] = Math.min(target[0], 0) - this.pitchAngle * 3;
      }
      const resp = 1 - Math.exp(-dt * 5);
      this.w = add(this.w, mul(sub(target, this.w), resp));
      const angle = len(this.w) * dt;
      if (angle > 1e-6) this.q = qnorm(qmul(this.q, qaxis(norm(this.w), angle)));

      this.throttle = clamp(this.throttle + input.throttle * dt * 0.6, 0, 1);
      this.vel = add(this.vel, mul(acc, dt));
      this.pos = add(this.pos, mul(this.vel, dt));

      // Structure: too fast, and the wings come off; pulling far past the limit breaks one.
      if (V > s.max * 1.22 && wings > 0) { this.overT += dt; if (this.overT > 0.4) { this.loseWing('L', 'overspeed'); this.loseWing('R', 'overspeed'); } } else this.overT = 0;
      if ((this.gload > s.gLimit || this.gload < -s.gLimit * 0.5) && intact) {
        this.ogT += dt;
        if (this.ogT > 0.25) this.loseWing(this.bank > 0 ? 'R' : 'L', 'overg');
      } else this.ogT = 0;

      if (this.collide(world, V)) return;

      // Wheels on the ground.
      const gh = groundAt(world, this.pos[0], this.pos[2]);
      const gear = this.damage.gear ? s.gear : 0.55;
      const bottom = this.pos[1] - gear;
      if (bottom <= gh) {
        const sink = -this.vel[1];
        if (overWater(world, this.pos[0], this.pos[2])) { this.crash('water'); return; }
        const level = Math.abs(this.bank) < 22 * DEG && this.pitchAngle > -10 * DEG && this.pitchAngle < 22 * DEG;
        const slope = Math.abs(terrainAt(world, this.pos[0] + 4, this.pos[2]) - terrainAt(world, this.pos[0] - 4, this.pos[2]))
          + Math.abs(terrainAt(world, this.pos[0], this.pos[2] + 4) - terrainAt(world, this.pos[0], this.pos[2] - 4));
        const flat = slope < 1.2;                                 // no landing on a hillside
        if (!this.onGround) {
          if (sink > 12 || !level || !flat || V > s.max * 0.9 || wings < 1) { this.crash(!flat ? 'terrain' : 'ground'); return; }
          this.onGround = true; this.touch = [this.pos[0], this.pos[2]]; this.sinkAtTouch = sink;
          // Hard, but not fatal: the undercarriage gives way and it slides on its belly.
          if (sink > 7.5 && this.damage.gear) { this.damage.gear = false; this.events.push({ type: 'gear' }); }
        }
        this.pos[1] = gh + gear;
        // Rolling on the wheels: the velocity follows the nose, with rolling friction, and brakes. On the belly
        // it scrapes to a stop.
        const fh = norm([f[0], 0, f[2]]);
        let along = dot(this.vel, fh);
        const rough = onRunway(this.pos) ? 1 : 3.2;
        const decel = (!this.damage.gear ? 4.5 : this.brake ? 7 : 0.25 * rough) * dt;
        along = Math.sign(along) * Math.max(0, Math.abs(along) - decel);
        const up = this.damage.gear ? Math.max(0, this.vel[1]) : 0;
        this.vel = add(mul(fh, along), [0, up, 0]);
        if (this.damage.gear && !onRunway(this.pos) && along > s.stall * 1.6) { this.damage.gear = false; this.events.push({ type: 'gear' }); }
        if (up > 0.5 && this.pos[1] - gear > gh + 0.3) this.onGround = false;
      } else if (this.onGround && bottom > gh + 0.6) {
        this.onGround = false;
      }
      if (this.pos[1] > 3000) { this.vel[1] = Math.min(this.vel[1], 0); }                  // ceiling
      const edge = WORLD - 600;
      if (Math.abs(this.pos[0]) > edge || Math.abs(this.pos[2]) > edge) this.pos = [clamp(this.pos[0], -edge, edge), this.pos[1], clamp(this.pos[2], -edge, edge)];
    }

    /// Wingtips, nose and tail against trees, buildings, the bridge, turbines and the ground. A wingtip strike
    /// tears that wing off; the nose or tail hitting something solid is the end.
    collide(world, V) {
      const s = this.s, k = s.scale;
      const pts = [['L', [-s.span * k, s.wingY * k, s.wingZ * k]], ['R', [s.span * k, s.wingY * k, s.wingZ * k]],
        ['N', [0, 0, s.nose * k]], ['T', [0, 0.5 * k, s.tail * k]]];
      for (const [part, local] of pts) {
        if ((part === 'L' || part === 'R') && !this.damage[part]) continue;
        const p = add(this.pos, qrot(this.q, local));
        const obj = hitObject(world, p);
        const under = p[1] < groundAt(world, p[0], p[2]) - 0.05;
        if (!obj && !under) continue;
        const what = obj ? obj.kind : overWater(world, p[0], p[2]) ? 'water' : 'ground';
        if (part === 'L' || part === 'R') {
          if (obj || V > 14) { this.loseWing(part, what); this.vel = mul(this.vel, obj ? 0.8 : 0.9); }
        } else if (obj || !this.onGround) {
          // Scraping the tail on take-off is fine; hitting anything at speed is not.
          if (!obj && part === 'T' && -this.vel[1] < 3) continue;
          this.crash(what); return true;
        }
      }
      return false;
    }
    crash(why = 'crash') { this.why = why; this.crashed = true; this.impactVel = this.vel.slice(); this.events.push({ type: 'crash', why }); this.vel = v3(); this.w = v3(); }
  }

  // ------------------------------------------------------------------ saved data

  const KEY = 'plane.v1.';
  const read = (k, d) => { try { const v = localStorage.getItem(KEY + k); return v == null ? d : JSON.parse(v); } catch { return d; } };
  const write = (k, v) => { try { localStorage.setItem(KEY + k, JSON.stringify(v)); } catch { /* private mode: play on without saving */ } };

  const MODES = [
    { id: 'hoops', name: 'Hoop Rush', icon: '⭕', desc: '90 seconds. Every hoop you fly through is 1 point. Hoops keep coming.', unit: 'hoops', better: 'high' },
    { id: 'trial', name: 'Time Trial', icon: '⏱', desc: '12 hoops in order around the valley. Fastest time wins.', unit: 's', better: 'low' },
    { id: 'landing', name: 'Landing', icon: '🛬', desc: 'You are on final approach. Land softly on the centre line and stop.', unit: 'pts', better: 'high' },
    { id: 'free', name: 'Free Flight', icon: '🌤', desc: 'Take off and explore: hills, a canyon, a mountain strip. Watch for engine failures!', unit: '', better: 'high' },
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
    { id: 'canyon', name: 'Canyon run', desc: 'Fly down the river canyon in the mountains for 4 s' },
    { id: 'ridge', name: 'Mountain strip', desc: 'Land and stop on the plateau strip' },
    { id: 'glider', name: 'Glider pilot', desc: 'Land on a runway after an engine failure' },
    { id: 'onewing', name: 'One-winged', desc: 'Keep flying 10 s after losing a wing' },
    { id: 'survivor', name: 'Walked away', desc: 'Survive a belly landing' },
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
  .pg .pg-planes { display: grid; grid-template-columns: repeat(5, 1fr); gap: 6px; }
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
    const fs = `precision mediump float; varying vec3 vc; varying float vd; varying float vl; uniform vec3 fog; uniform float fogFar; uniform float alpha;
      void main(){ float f = clamp((vd - fogFar * 0.25) / (fogFar * 0.75), 0.0, 1.0); gl_FragColor = vec4(mix(vc * vl, fog, f * f), alpha); }`;
    const sh = (type, src) => { const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s); return s; };
    const prog = gl.createProgram(); gl.attachShader(prog, sh(gl.VERTEX_SHADER, vs)); gl.attachShader(prog, sh(gl.FRAGMENT_SHADER, fs)); gl.linkProgram(prog); gl.useProgram(prog);
    const loc = { p: gl.getAttribLocation(prog, 'p'), n: gl.getAttribLocation(prog, 'n'), c: gl.getAttribLocation(prog, 'c') };
    const uni = (name) => gl.getUniformLocation(prog, name);
    const U = { vp: uni('vp'), m: uni('m'), tint: uni('tint'), glow: uni('glow'), fog: uni('fog'), fogFar: uni('fogFar'), alpha: uni('alpha') };
    gl.enable(gl.DEPTH_TEST);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
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
    // Each plane is split into its body (F), wings (L, R) and tail (T), each centred on itself, so a part can break
    // off and tumble on its own.
    function splitPlane(spec, m) {
      const d = m.body.d, buckets = { F: [], L: [], R: [], T: [] };
      for (let i = 0; i < d.length; i += 27) {
        const cx = (d[i] + d[i + 9] + d[i + 18]) / 3, cz = (d[i + 2] + d[i + 11] + d[i + 20]) / 3;
        const k = cz >= spec.tailZ ? 'T' : cx < -spec.wingX ? 'L' : cx > spec.wingX ? 'R' : 'F';
        for (let j = 0; j < 27; j++) buckets[k].push(d[i + j]);
      }
      const parts = {};
      for (const [k, arr] of Object.entries(buckets)) {
        if (!arr.length) continue;
        const c = v3(), n = arr.length / 9;
        for (let i = 0; i < arr.length; i += 9) { c[0] += arr[i] / n; c[1] += arr[i + 1] / n; c[2] += arr[i + 2] / n; }
        for (let i = 0; i < arr.length; i += 9) { arr[i] -= c[0]; arr[i + 1] -= c[1]; arr[i + 2] -= c[2]; }
        parts[k] = { mesh: upload({ d: arr }), center: c };
      }
      return { parts, prop: upload(m.prop), propAt: m.propAt };
    }
    const planeMeshes = {};
    for (const p of PLANES) planeMeshes[p.id] = splitPlane(p, buildPlane(p.id));
    // Wind-turbine rotor: three blades round the hub, turning about z.
    const rotorB = new Builder();
    for (let k = 0; k < 3; k++) {
      const a = (k / 3) * Math.PI * 2, ca = Math.cos(a), sa = Math.sin(a);
      const P = (x, y, z) => [x * ca - y * sa, x * sa + y * ca, z];
      rotorB.hexa([P(-1.2, 1, -0.3), P(1.2, 1, -0.3), P(0.5, 26, -0.3), P(-0.5, 26, -0.3), P(-1.2, 1, 0.3), P(1.2, 1, 0.3), P(0.5, 26, 0.3), P(-0.5, 26, 0.3)], [0.94, 0.95, 0.96]);
    }
    const rotorMesh = upload(rotorB);
    const ALL_PARTS = ['F', 'L', 'R', 'T', 'P'];

    // ---- state
    let plane = PLANES.find((p) => p.id === read('plane', 'c172')) || PLANES[0];
    let mode = MODES.find((m) => m.id === read('mode', 'hoops')) || MODES[0];
    let screen = 'menu', menuTab = read('menuTab', 'play');
    let flight = new Flight(plane);
    let hoops = [], nextHoop = 0, score = 0, timeLeft = 0, elapsed = 0, streak = 0, hoopsMade = 0;
    let camMode = 0, camPos = [0, 30, 60], paused = false, result = null, propAngle = 0, toastTimer = 0;
    let rollAcc = 0, rollT = 0, loopAcc = 0, loopT = 0, lowT = 0, hadTakeoff = false, stoppedT = 0;
    const smoke = [];              // particles: fire, smoke, dust, sparks, spray
    const debris = [];             // parts that have come off and are tumbling on their own
    let attached = new Set(ALL_PARTS);
    let wreckT = 0, failAt = Infinity, hadFailure = false, engineSmokeT = 0, wingLostAt = -1, canyonT = 0;
    let failures = read('failures', 'rare');
    const keys = new Set();
    const mouse = { x: 0, y: 0, in: false, movedAt: 0 };   // the mouse stick, -1..1 each way; it centres itself
    const done = new Set(read('done', []));
    let invert = read('invert', false), mouseOn = read('mouse', true), sens = read('sens', 1), sound = read('sound', true), units = read('units', 'kmh');
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
    /// Filtered noise: a boom (low), a crack (high), a scrape (long, middling).
    function noise(t = 0.8, vol = 0.4, freq = 400) {
      const a = audio(); if (!a) return;
      const buf = a.createBuffer(1, Math.floor(a.sampleRate * t), a.sampleRate), d = buf.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / d.length, 2);
      const src = a.createBufferSource(), f = a.createBiquadFilter(), g = a.createGain();
      src.buffer = buf; f.type = 'lowpass'; f.frequency.value = freq; g.gain.value = vol;
      src.connect(f); f.connect(g); g.connect(a.destination); src.start();
    }

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
      mouse.x = 0; mouse.y = 0; mouse.movedAt = 0;
      debris.length = 0; attached = new Set(ALL_PARTS); wreckT = 0; hadFailure = false; engineSmokeT = 0; wingLostAt = -1; canyonT = 0;
      // Random failures (Settings): mostly in Free Flight and Landing; "often" means every mode.
      const rate = failures === 'often' ? 1 / 75 : failures === 'rare' ? 1 / 360 : 0;
      const applies = failures === 'often' || mode.id === 'free' || mode.id === 'landing';
      failAt = rate && applies ? (mode.id === 'landing' ? 20 + Math.random() * 40 : -Math.log(Math.random()) / rate + 20) : Infinity;
      if (mode.id === 'landing' && failures === 'rare' && Math.random() > 0.25) failAt = Infinity;
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
      const typing = e.target && e.target.tagName === 'INPUT' && e.target.type !== 'range';
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
    // Forget held keys whenever the game loses the keyboard: a key released while focus was elsewhere never sends
    // its key-up here, and would otherwise stay "held" (a plane that keeps rolling by itself).
    const blur = () => keys.clear(); window.addEventListener('blur', blur);
    root.addEventListener('focusout', (e) => { if (!root.contains(e.relatedTarget)) keys.clear(); });
    const hidden = () => { if (document.hidden) keys.clear(); }; document.addEventListener('visibilitychange', hidden);
    // The mouse is a stick that centres itself: moving it deflects the stick, and it springs back to the middle when
    // the mouse stops. (Steering by where the cursor rests kept the plane banking whenever it sat off-centre.)
    root.addEventListener('pointermove', (e) => {
      if (screen !== 'fly' || paused) return;
      const r = root.getBoundingClientRect();
      mouse.x = clamp(mouse.x + (e.movementX || 0) / (r.width * 0.25), -1, 1);
      mouse.y = clamp(mouse.y + (e.movementY || 0) / (r.height * 0.25), -1, 1);
      mouse.in = true; mouse.movedAt = performance.now();
    });
    root.addEventListener('pointerleave', () => { mouse.x = 0; mouse.y = 0; mouse.in = false; });
    root.addEventListener('mousedown', () => { if (document.activeElement?.tagName !== 'INPUT') root.focus(); });

    // The cursor's distance from the centre of the view steers: left and right bank, down pulls the nose up, up pushes
    // it down (like a stick). A small dead zone in the middle keeps the plane steady, and the curve is gentle near the
    // centre so small moves are fine adjustments. The arrow keys still work too.
    const stick = (v) => {
      const dead = 0.06, a = Math.abs(v);
      if (a < dead) return 0;
      return Math.sign(v) * Math.min(1, Math.pow((a - dead) / (1 - dead), 1.25) * sens * 1.5);
    };
    function input() {
      const has = (k) => keys.has(k);
      const m = mouseOn && mouse.in;
      let pitch = clamp((has('ArrowDown') ? 1 : 0) - (has('ArrowUp') ? 1 : 0) + (m ? stick(mouse.y) : 0), -1, 1);
      if (invert) pitch = -pitch;
      return {
        pitch,
        roll: clamp((has('ArrowRight') ? 1 : 0) - (has('ArrowLeft') ? 1 : 0) + (m ? stick(mouse.x) : 0), -1, 1),
        yaw: (has('d') || has('e') ? 1 : 0) - (has('a') || has('q') ? 1 : 0),
        throttle: (has('w') || has('Shift') ? 1 : 0) - (has('s') || has('Control') ? 1 : 0),
      };
    }

    // ---- per-frame game rules
    // ---- particles: fire, smoke, engine smoke, dust, sparks and spray
    const PUFF = {
      fire: { life: [0.6, 1.4], size: [2, 5], col: (k) => [1, 0.55 - k * 0.4, 0.1], glow: 0.7, rise: 6, grav: 0, a: 0.85 },
      smoke: { life: [3, 6], size: [3, 14], col: (k) => [0.3 + k * 0.35, 0.3 + k * 0.35, 0.31 + k * 0.35], glow: 0, rise: 4, grav: 0, a: 0.55 },
      dark: { life: [0.8, 1.4], size: [0.7, 2.6], col: (k) => [0.1 + k * 0.35, 0.1 + k * 0.35, 0.11 + k * 0.35], glow: 0, rise: 1, grav: 0, a: 0.6 },
      haze: { life: [0.6, 1.1], size: [0.5, 1.8], col: () => [0.75, 0.75, 0.75], glow: 0.2, rise: 0.5, grav: 0, a: 0.35 },
      dust: { life: [1, 2.5], size: [2, 7], col: () => [0.55, 0.45, 0.32], glow: 0, rise: 1, grav: 0, a: 0.5 },
      spark: { life: [0.3, 0.8], size: [0.3, 0.1], col: () => [1, 0.85, 0.3], glow: 1, rise: 0, grav: 9.8 },
      spray: { life: [0.8, 1.6], size: [1.5, 3], col: () => [0.85, 0.92, 1], glow: 0.3, rise: 0, grav: 9.8, a: 0.7 },
    };
    function puff(kind, p, v = v3()) {
      if (smoke.length > 450) smoke.shift();
      const k = PUFF[kind];
      smoke.push({ kind, p: p.slice(), v: v.slice(), t: 0, life: k.life[0] + Math.random() * (k.life[1] - k.life[0]),
        q: qnorm([Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5, Math.random()]) });
    }
    const jitter = (s) => [(Math.random() - 0.5) * s, (Math.random() - 0.5) * s, (Math.random() - 0.5) * s];
    /// Where a part of the plane is right now (its centre, in the world).
    function partPos(k) {
      const pm = planeMeshes[plane.id];
      const c = k === 'P' ? pm.propAt : pm.parts[k]?.center;
      return c ? add(flight.pos, qrot(flight.q, mul(c, plane.scale))) : flight.pos;
    }
    /// A part breaks off and flies on by itself.
    function detach(k, push = v3(), spin = 3) {
      if (!attached.has(k)) return;
      attached.delete(k);
      const pm = planeMeshes[plane.id], mesh = k === 'P' ? pm.prop : pm.parts[k]?.mesh;
      if (!mesh) return;
      const base = flight.crashed ? flight.impactVel : flight.vel;
      debris.push({ mesh, part: k, pos: partPos(k), q: flight.q.slice(), vel: add(mul(base, k === 'F' ? 0.5 : 0.7), push),
        w: jitter(spin * 2), fire: k === 'F' ? 14 : 0, rest: false, sink: 0 });
    }
    const CRASH_TEXT = { ground: 'Flew into the ground', terrain: 'Hit the hillside', water: 'Ditched in the water', tree: 'Hit a tree',
      building: 'Flew into a building', bridge: 'Hit the bridge', turbine: 'Flew into a wind turbine', mast: 'Hit the radio mast',
      hangar: 'Hit a hangar', tower: 'Hit the control tower' };
    const WING_TEXT = { overspeed: 'Overspeed!', overg: 'Over-G!', ground: 'Wingtip hit the ground!', water: 'Wingtip in the water!',
      tree: 'Clipped a tree!', building: 'Clipped a building!', bridge: 'Clipped the bridge!', turbine: 'Hit a turbine blade!',
      mast: 'Hit the radio mast!', hangar: 'Clipped a hangar!', tower: 'Clipped the tower!' };
    function crashEffects(why) {
      const at = flight.pos.slice(), v = flight.impactVel;
      for (const k of ALL_PARTS) detach(k, add(jitter(14), [0, 4 + Math.random() * 6, 0]), 5);
      if (why === 'water') {
        for (let i = 0; i < 60; i++) puff('spray', add(at, jitter(4)), add(mul(v, 0.2), [(Math.random() - 0.5) * 16, 6 + Math.random() * 14, (Math.random() - 0.5) * 16]));
        noise(1.2, 0.35, 900);
      } else {
        for (let i = 0; i < 45; i++) puff('fire', add(at, jitter(4)), add(mul(v, 0.15), jitter(18)));
        for (let i = 0; i < 25; i++) puff('smoke', add(at, jitter(6)), add(mul(v, 0.1), jitter(8)));
        for (let i = 0; i < 30; i++) puff('spark', at, add(mul(v, 0.3), [(Math.random() - 0.5) * 30, Math.random() * 20, (Math.random() - 0.5) * 30]));
        noise(1.6, 0.6, 260); beep(60, 0.9, 'sawtooth', 0.25);
      }
      if (engGain) engGain.gain.value = 0;
    }
    function crashResult() {
      const why = CRASH_TEXT[flight.why] || 'Crashed';
      if (mode.id === 'hoops') finish('crash', score, `${why} with ${score} hoop${score === 1 ? '' : 's'}`);
      else if (mode.id === 'trial') finish('crash', null, `${why} at hoop ${nextHoop + 1} of ${hoops.length}`);
      else if (mode.id === 'landing') finish('crash', 0, why);
      else finish('crash', null, why);
    }

    function update(dt) {
      if (toastTimer > 0) { toastTimer -= dt; if (toastTimer <= 0) toastEl.style.opacity = 0; }
      if (screen !== 'fly' || paused) return;
      const inp = input();
      flight.brake = keys.has(' ') || keys.has('b');
      const prev = flight.pos.slice();
      const wasGround = flight.onGround;
      flight.step(dt, inp, W);
      elapsed += dt;
      // A dead engine's propeller only windmills in the airflow.
      propAngle += dt * (flight.damage.engine ? 8 + flight.throttle * 60 * flight.damage.power : flight.speed * 0.12);

      // What broke this step.
      for (const ev of flight.events.splice(0)) {
        if (ev.type === 'wing') {
          const { r } = flight.axes(), out = ev.side === 'L' ? -1 : 1;
          const at = partPos(ev.side);
          detach(ev.side, add(mul(r, out * (5 + Math.random() * 4)), [0, 3, 0]), 4);
          for (let i = 0; i < 14; i++) puff(ev.cause === 'water' ? 'spray' : 'dust', at, add(mul(flight.vel, 0.4), jitter(10)));
          for (let i = 0; i < 10; i++) puff('spark', at, add(mul(flight.vel, 0.5), jitter(16)));
          toast(`💥 ${WING_TEXT[ev.cause] || 'Damage!'} ${ev.side === 'L' ? 'Left' : 'Right'} wing torn off`, 2600);
          noise(0.35, 0.5, 2200); wingLostAt = elapsed;
        } else if (ev.type === 'gear') {
          toast('💥 The undercarriage collapsed! Sliding on the belly…', 2400);
          noise(2.2, 0.3, 700);
        } else if (ev.type === 'crash') {
          crashEffects(ev.why);
        }
      }
      if (flight.crashed) {
        // Let the wreck tumble and burn for a few seconds before the result.
        wreckT += dt;
        if (wreckT > 3.2) crashResult();
        return;
      }

      // Random engine trouble: a full failure, or a bird strike that leaves it running rough.
      if (elapsed > failAt && flight.damage.engine && !flight.onGround) {
        const partial = Math.random() < 0.3;
        flight.failEngine(partial);
        hadFailure = true; failAt = Infinity; engineSmokeT = partial ? 25 : 12;
        toast(partial ? '🐦 Bird strike! The engine is running rough' : '⚠️ ENGINE FAILURE! Pick a field and glide down', 3200);
        noise(0.5, 0.4, 500); beep(140, 0.4, 'square', 0.15);
      }
      // Engine smoke, and sparks from a belly slide.
      if (engineSmokeT > 0 && attached.has('F')) {
        engineSmokeT -= dt;
        if (Math.random() < dt * 10) puff(flight.damage.engine ? 'haze' : 'dark', add(partPos('F'), qrot(flight.q, [0, 0.4, plane.nose * 0.6])), add(mul(flight.vel, 0.92), jitter(1.2)));
      }
      if (flight.onGround && !flight.damage.gear && flight.speed > 3 && Math.random() < dt * 40) {
        puff('spark', add(flight.pos, [0, -0.4, 0]), add(mul(flight.vel, 0.5), [(Math.random() - 0.5) * 6, 2 + Math.random() * 3, (Math.random() - 0.5) * 6]));
        if (Math.random() < 0.3) puff('dust', flight.pos, jitter(3));
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
      if (flight.onGround && flight.speed < 1.5 && !flight.damage.gear) {
        stoppedT += dt;
        if (stoppedT > 0.8) { achieve('survivor'); finish('crash', mode.id === 'landing' ? 0 : mode.id === 'hoops' ? score : null, 'Belly landing · the plane is scrap, but you walked away'); return; }
      } else if (flight.onGround && flight.speed < 1.5 && (hadTakeoff || mode.id === 'landing')) {
        stoppedT += dt;
        if (stoppedT > 0.6) {
          const on = onRunway(flight.pos);
          if (on && stoppedT < 0.7) { achieve('landed'); if (onRidge(flight.pos)) achieve('ridge'); if (hadFailure) achieve('glider'); }
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
      if (Math.hypot(bp[0] - BRIDGE.x, bp[2] - BRIDGE.z) < 30 && bp[1] < 27 && bp[1] > WATER && !flight.onGround) achieve('bridge');
      if (flight.wings === 0.5 && !flight.onGround && wingLostAt >= 0 && elapsed - wingLostAt > 10) achieve('onewing');
      // The canyon: down by the river in the mountains, with rock higher than you on both sides.
      if (!flight.onGround && Math.hypot(bp[0] - VALLEY[0], bp[2] - VALLEY[1]) > 3300 && riverDist(bp[0], bp[2]) < 90) {
        const walls = [[220, 0], [-220, 0], [0, 220], [0, -220]].filter(([dx, dz]) => groundAt(W, bp[0] + dx, bp[2] + dz) > bp[1]).length;
        if (walls >= 2) { canyonT += dt; if (canyonT > 4) achieve('canyon'); } else canyonT = Math.max(0, canyonT - dt);
      }

      // Engine sound follows the throttle and airspeed.
      if (engGain && ac) {
        const run = flight.damage.engine ? (flight.damage.power < 1 ? (Math.random() < 0.15 ? 0.2 : 1) : 1) : 0;
        eng.frequency.setTargetAtTime(45 + flight.throttle * 70 * run + flight.speed * 0.25, ac.currentTime, 0.1);
        engGain.gain.setTargetAtTime(sound ? (0.035 + flight.throttle * 0.05) * run : 0, ac.currentTime, 0.05);
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
      gl.uniform3fv(U.fog, sky); gl.uniform1f(U.fogFar, 7500); gl.uniform1f(U.alpha, 1);

      // Camera.
      let eye, at, up;
      const showPlane = screen !== 'fly' || camMode !== 1;
      if (screen === 'menu') {
        const a = t * 0.0003;
        flight.pos = [0, plane.gear, 0]; flight.q = qheading(0, 0); flight.crashed = false;
        const r = 15 * (plane.cam || plane.scale);
        eye = [Math.sin(a) * r, 4.5, Math.cos(a) * r]; up = [0, 1, 0];
        // Aim left of the plane so it turns in the free space to the right of the menu.
        const side = norm(cross(norm(sub([0, 1.6, 0], eye)), up));
        at = sub([0, 1.6, 0], mul(side, 6.5 * (plane.cam || plane.scale)));
      } else {
        const { f, u } = flight.axes();
        if (camMode === 1) {
          eye = add(add(flight.pos, mul(u, 1.1)), mul(f, -0.4)); at = add(eye, f); up = u;
        } else if (camMode === 2 || screen === 'result' || flight.crashed) {
          // Orbit the plane, or after a crash the wreck (the fuselage, wherever it ended up).
          const a = t * 0.0004, wreck = debris.find((d) => d.part === 'F'), c = flight.crashed && wreck ? wreck.pos : flight.pos;
          const r = flight.crashed ? 38 : 28;
          eye = [c[0] + Math.sin(a) * r, Math.max(c[1] + 12, groundAt(W, c[0] + Math.sin(a) * r, c[2] + Math.cos(a) * r) + 4), c[2] + Math.cos(a) * r];
          at = c; up = [0, 1, 0];
        } else {
          const back = 20 * (plane.cam || plane.scale), high = 5 * (plane.cam || plane.scale);
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
        for (const tb of W.turbines) draw(rotorMesh, model(qaxis([0, 0, 1], t * 0.0012 + tb.phase), tb.hub));
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

      if (showPlane) {
        const pm = planeMeshes[plane.id], parts = screen === 'menu' ? new Set(ALL_PARTS) : attached;
        for (const k of ['F', 'L', 'R', 'T']) {
          const part = pm.parts[k];
          if (part && parts.has(k)) draw(part.mesh, model(flight.q, add(flight.pos, qrot(flight.q, mul(part.center, plane.scale))), plane.scale));
        }
        if (pm.prop && parts.has('P')) {
          const pq = qmul(flight.q, qaxis([0, 0, 1], propAngle));
          draw(pm.prop, model(pq, add(flight.pos, qrot(flight.q, mul(pm.propAt, plane.scale))), plane.scale), [1, 1, 1], 0);
        }
      }
      // Broken-off parts; the burnt ones darker.
      for (const d of debris) draw(d.mesh, model(d.q, d.pos, plane.scale), d.part === 'F' && flight.crashed && flight.why !== 'water' ? [0.45, 0.42, 0.4] : [1, 1, 1]);
      // Fire, smoke, dust, sparks and spray.
      gl.enable(gl.BLEND); gl.depthMask(false);
      for (const p of smoke) {
        const k = p.t / p.life, def = PUFF[p.kind];
        gl.uniform1f(U.alpha, (def.a ?? 1) * (1 - k * k));
        draw(smokeMesh, model(p.q, p.p, def.size[0] + (def.size[1] - def.size[0]) * k), def.col(k), def.glow);
      }
      gl.uniform1f(U.alpha, 1); gl.depthMask(true); gl.disable(gl.BLEND);
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
      // Mouse steering: a ring for the centre and a dot where the cursor is.
      if (mouseOn && mouse.in && !paused) {
        const ax = W2 / 2, ay = H2 / 2, ar = 22 * s + 6;
        h2.strokeStyle = 'rgba(255,255,255,.35)'; h2.lineWidth = 1.2; h2.beginPath(); h2.arc(ax, ay, ar, 0, Math.PI * 2); h2.stroke();
        const dx = mouse.x * ar * 2.4, dy = mouse.y * ar * 2.4;
        h2.fillStyle = 'rgba(255,255,255,.8)'; h2.beginPath(); h2.arc(ax + dx, ay + dy, 4, 0, Math.PI * 2); h2.fill();
        h2.strokeStyle = 'rgba(255,209,102,.55)'; h2.beginPath(); h2.moveTo(ax, ay); h2.lineTo(ax + dx, ay + dy); h2.stroke();
      }
      // Top: mode status.
      h2.textAlign = 'center'; h2.font = `800 ${Math.round(15 * s + 3)}px system-ui`;
      let status = '';
      if (mode.id === 'hoops') status = `⭕ ${score}    ⏱ ${Math.max(0, Math.ceil(timeLeft))}s`;
      else if (mode.id === 'trial') status = `Hoop ${Math.min(nextHoop + 1, hoops.length)}/${hoops.length}    ⏱ ${elapsed.toFixed(1)}s`;
      else if (mode.id === 'landing') status = 'Land on the runway and stop';
      else status = flight.onGround && !hadTakeoff ? 'Hold W for throttle · cursor down to lift off at speed' : 'Free flight';
      const tw = h2.measureText(status).width + 24;
      box(cx - tw / 2, 8, tw, 26 * s + 6); h2.fillStyle = '#fff'; h2.fillText(status, cx, 8 + (26 * s + 6) / 2);
      // Warnings.
      h2.font = `900 ${Math.round(16 * s + 4)}px system-ui`;
      const blink = Math.floor(performance.now() / 300) % 2;
      if (!flight.damage.engine && blink) { h2.fillStyle = '#ff4d4d'; h2.fillText('ENGINE FAILURE', cx, 56 * s + 10); }
      else if (flight.wings < 1 && blink) { h2.fillStyle = '#ff4d4d'; h2.fillText(flight.wings === 0 ? 'NO WINGS' : 'WING LOST', cx, 56 * s + 10); }
      else if (flight.stalled && blink) { h2.fillStyle = '#ff4d4d'; h2.fillText('STALL', cx, 56 * s + 10); }
      else if (!flight.onGround && agl < 40 && flight.vel[1] < -9 && blink) { h2.fillStyle = '#ffd166'; h2.fillText('PULL UP', cx, 56 * s + 10); }
      else if (!flight.onGround && Math.abs(flight.gload) > 5.5) { h2.fillStyle = '#ffd166'; h2.fillText(`${flight.gload.toFixed(1)} G`, cx, 56 * s + 10); }
      // Next hoop distance (and direction when it's off-screen).
      if (target) {
        const d = len(sub(target.pos, flight.pos));
        h2.font = `700 ${Math.round(11 * s + 2)}px system-ui`; h2.fillStyle = '#ffd166';
        h2.fillText(`next hoop ${Math.round(d)} m`, cx, 34 * s + 30);
      }
      // Damage panel (top right) once anything is wrong.
      const dmg = flight.damage;
      if (!dmg.engine || dmg.power < 1 || !dmg.L || !dmg.R || !dmg.gear) {
        const rows = [['ENGINE', !dmg.engine ? 'FAILED' : dmg.power < 1 ? 'ROUGH' : 'OK', !dmg.engine ? '#ff4d4d' : dmg.power < 1 ? '#ffd166' : '#5ee08a'],
          ['L WING', dmg.L ? 'OK' : 'GONE', dmg.L ? '#5ee08a' : '#ff4d4d'], ['R WING', dmg.R ? 'OK' : 'GONE', dmg.R ? '#5ee08a' : '#ff4d4d'],
          ['GEAR', dmg.gear ? 'OK' : 'BROKEN', dmg.gear ? '#5ee08a' : '#ff4d4d']];
        const bw = 120 * s + 14, bx = W2 - bw - 8, by0 = 8;
        box(bx, by0, bw, rows.length * 16 * s + 12);
        h2.font = `700 ${Math.round(9 * s + 2)}px system-ui`; h2.textAlign = 'left';
        rows.forEach(([n, v, c], i) => { const y = by0 + 12 + i * 16 * s; h2.fillStyle = 'rgba(255,255,255,.65)'; h2.fillText(n, bx + 8, y); h2.fillStyle = c; h2.fillText(v, bx + 8 + 62 * s, y); });
        h2.textAlign = 'center';
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
        const pull = invert ? 'up' : 'down';
        body = `<h2>Mouse steering ${mouseOn ? '' : '(off)'}</h2><div class="pg-hint">The mouse is a stick that centres itself: move it <b>left / right</b> to roll the plane into a bank (it then turns),
          <b>${pull}</b> to pull the nose up and the other way to push it down. Stop moving and the stick springs back to the middle;
          let go of everything and the wings roll back to level by themselves. Leaving the game view lets go of the stick.</div>
          <div class="pg-row" style="margin-top:6px"><label class="pg-hint">Sensitivity <input type="range" min="0.3" max="2.5" step="0.1" value="${sens}" data-range="sens" style="width:170px;padding:0"> <b data-sensval>${Number(sens).toFixed(1)}×</b></label>
          <button data-a="mouse">${mouseOn ? '✓ ' : ''}Mouse steering</button>
          <button data-a="invert">${invert ? '✓ ' : ''}Invert Y (cursor up pulls up)</button></div>
          <h2>Keys</h2><div class="pg-hint">
          <kbd>W</kbd> more throttle · <kbd>S</kbd> less throttle · <kbd>←</kbd> <kbd>→</kbd> <kbd>↑</kbd> <kbd>↓</kbd> steer without the mouse · <kbd>A</kbd> <kbd>D</kbd> rudder (and steering on the ground)<br>
          <kbd>F</kbd> flaps · <kbd>Space</kbd> brakes / airbrake · <kbd>C</kbd> camera (chase, cockpit, orbit) · <kbd>P</kbd> pause · <kbd>R</kbd> restart · <kbd>M</kbd> menu</div>
          <h2>Tips</h2><div class="pg-hint">Bank by moving the cursor sideways and ease it ${pull === 'down' ? 'down' : 'up'} to turn: the wings turn the plane, the rudder only tidies up. Too slow or pulling too hard
          stalls the wing (STALL): push the nose down and add power. To land: slow down, flaps down, line up with the runway, and touch down gently (watch V/S).
          To take off: full throttle (hold W) on the runway, then ease the cursor ${pull} at about ${Math.round(plane.stall * 1.3 * 3.6)} km/h. Airliners turn slowly, so start turns early.</div>
          <h2>Settings</h2><div class="pg-row">
          <button data-a="sound">${sound ? '🔊 Sound on' : '🔇 Sound off'}</button>
          <button data-a="units">${units === 'kmh' ? 'km/h · m' : 'knots · feet'}</button>
          <button data-a="failures">Failures: ${failures === 'off' ? 'off' : failures === 'often' ? 'often (every mode)' : 'rare (Free Flight, Landing)'}</button></div>
          <h2>Damage</h2><div class="pg-hint">Clip a tree, a building or the ground with a wingtip and that wing tears off: the plane rolls hard towards the stump.
          Hit something with the nose or tail, or the ground too hard, and it breaks up. Too fast and the wings come off; pulling far too hard snaps one.
          A hard landing can collapse the undercarriage into a belly slide. With failures on, the engine can quit (glide to a field) or run rough after a bird strike.</div>`;
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
      ui.querySelectorAll('[data-range]').forEach((n) => {
        n.oninput = () => { sens = Number(n.value); write('sens', sens); const v = ui.querySelector('[data-sensval]'); if (v) v.textContent = `${sens.toFixed(1)}×`; };
        n.onchange = () => root.focus();
      });
      ui.querySelectorAll('[data-mode]').forEach((n) => n.onclick = () => { mode = MODES.find((m) => m.id === n.dataset.mode); write('mode', mode.id); renderUI(); });
      ui.querySelectorAll('[data-tab]').forEach((n) => n.onclick = () => { menuTab = n.dataset.tab; write('menuTab', menuTab); renderUI(); });
      ui.querySelectorAll('[data-a]').forEach((n) => n.onclick = () => {
        const a = n.dataset.a;
        if (a === 'start' || a === 'again' || a === 'restart') start();
        else if (a === 'resume') { paused = false; renderUI(); root.focus(); }
        else if (a === 'menu') { screen = 'menu'; paused = false; if (engGain) engGain.gain.value = 0; renderUI(); }
        else if (a === 'save') saveScore();
        else if (a === 'invert') { invert = !invert; write('invert', invert); renderUI(); }
        else if (a === 'mouse') { mouseOn = !mouseOn; write('mouse', mouseOn); renderUI(); }
        else if (a === 'sound') { sound = !sound; write('sound', sound); if (!sound && engGain) engGain.gain.value = 0; renderUI(); }
        else if (a === 'units') { units = units === 'kmh' ? 'kt' : 'kmh'; write('units', units); renderUI(); }
        else if (a === 'failures') { failures = failures === 'rare' ? 'often' : failures === 'often' ? 'off' : 'rare'; write('failures', failures); renderUI(); }
        else if (a === 'clear') { if (window.confirm ? window.confirm('Clear every leaderboard on this computer?') : true) { MODES.forEach((m) => write(`board.${m.id}`, [])); renderUI(); } }
      });
    }

    // ---- particles and debris, every frame (also while the wreck settles and on the result screen)
    function stepParticles(dt) {
      for (const p of smoke) {
        const def = PUFF[p.kind];
        p.t += dt; p.v[1] += (def.rise - def.grav) * dt; p.v = mul(p.v, 1 - Math.min(1, dt * (def.grav ? 0.2 : 1.2)));
        p.p = add(p.p, mul(p.v, dt));
        const g = groundAt(W, p.p[0], p.p[2]);
        if (p.p[1] < g) { p.p[1] = g; p.v = mul(p.v, 0.3); }
      }
      for (let i = smoke.length - 1; i >= 0; i--) if (smoke[i].t > smoke[i].life) smoke.splice(i, 1);
    }
    /// Broken parts: gravity, air drag, tumbling, bouncing and scraping along the ground, floating then sinking in water.
    function stepDebris(dt) {
      for (const d of debris) {
        if (d.fire > 0) {
          d.fire -= dt;
          if (Math.random() < dt * 25) puff('fire', add(d.pos, jitter(3)), [0, 2, 0]);
          if (Math.random() < dt * 12) puff('smoke', add(d.pos, jitter(3)), [0, 3, 0]);
        }
        if (d.rest) continue;
        const sp = len(d.vel);
        d.vel[1] -= G * dt;
        d.vel = mul(d.vel, 1 - Math.min(0.5, 0.0025 * sp * dt));
        d.pos = add(d.pos, mul(d.vel, dt));
        const ang = len(d.w) * dt;
        if (ang > 1e-6) d.q = qnorm(qmul(d.q, qaxis(norm(d.w), ang)));
        const water = overWater(W, d.pos[0], d.pos[2]), g = groundAt(W, d.pos[0], d.pos[2]) + 0.5 - d.sink;
        if (d.pos[1] < g) {
          const impact = -d.vel[1];
          d.pos[1] = g;
          if (water) {
            if (impact > 4) for (let i = 0; i < 6; i++) puff('spray', d.pos, [(Math.random() - 0.5) * 8, 4 + Math.random() * 6, (Math.random() - 0.5) * 8]);
            d.vel = [d.vel[0] * 0.9, 0, d.vel[2] * 0.9]; d.w = mul(d.w, 0.9); d.fire = 0;
            d.sink += dt * 0.25;                                   // slowly goes under
          } else {
            d.vel[1] = impact * 0.3; d.vel[0] *= 0.72; d.vel[2] *= 0.72; d.w = mul(d.w, 0.65);
            if (impact > 5) {
              noise(0.25, Math.min(0.35, impact * 0.02), 300);
              for (let i = 0; i < 4; i++) puff('dust', d.pos, [(Math.random() - 0.5) * 6, 1 + Math.random() * 3, (Math.random() - 0.5) * 6]);
              for (let i = 0; i < 5; i++) puff('spark', d.pos, add(mul(d.vel, 0.5), jitter(10)));
            }
          }
          if (len(d.vel) < 0.8 && !water) { d.rest = true; d.vel = v3(); }
          if (d.sink > 6) d.rest = true;
        }
      }
    }

    // ---- main loop
    let raf = 0, last = performance.now(), alive = true;
    function frame(t) {
      if (!alive) return;
      const dt = Math.min(0.05, (t - last) / 1000); last = t;
      // Physics in small fixed steps so fast planes stay stable.
      let left = dt; while (left > 1e-4) { const h = Math.min(left, 1 / 120); update(h); left -= h; }
      if (!paused) { stepParticles(dt); stepDebris(dt); }
      // The mouse stick springs back to the middle once the mouse has been still for a moment.
      if (t - mouse.movedAt > 120) { const k = Math.exp(-dt * 3.5); mouse.x *= k; mouse.y *= k; }
      render(t);
      raf = requestAnimationFrame(frame);
    }
    renderUI();
    raf = requestAnimationFrame(frame);
    root.focus();
    // For tests: the live flight state.
    window.NotchPlaneGame._state = () => ({ screen, keys: [...keys], bank: flight.bank, pitch: flight.pitchAngle, pos: flight.pos, w: flight.w, onGround: flight.onGround,
      speed: flight.speed, damage: flight.damage, crashed: flight.crashed, why: flight.why, debris: debris.length, particles: smoke.length });
    window.NotchPlaneGame._poke = { failEngine: (p) => { failAt = elapsed; }, flight: () => flight };

    return () => {
      alive = false; cancelAnimationFrame(raf);
      window.removeEventListener('keydown', kd); window.removeEventListener('keyup', ku); window.removeEventListener('blur', blur);
      document.removeEventListener('visibilitychange', hidden);
      try { ac?.close(); } catch { /* already closed */ }
      root.remove();
    };
  }

  window.NotchPlaneGame = { mount, PLANES, MODES, CHALLENGES, Flight, _test: { groundAt, makeWorld, qheading, qrot, hitObject, terrainAt } };
})();
