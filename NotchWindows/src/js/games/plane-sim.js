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

  // ---- ROSTER BEGIN
  // Performance numbers drive the flight model (see Flight): speeds in m/s, rates in rad/s. `cat` groups the planes in the
  // picker. The position fields (span, wingY, wingZ, nose, tail) mark the wingtips, nose and tail for collisions;
  // `wingX`, `tailZ` and `tailX` say where the model splits into fuselage, wings and tail when parts break off.
  const CATS = [['ga', 'Light aircraft'], ['turbo', 'Turboprop'], ['biz', 'Business & regional'], ['liner', 'Airliners'], ['mil', 'Fighter']];
  const PLANES = [
    { id: 'c172', cat: 'ga', name: 'Cessna 172', kind: 'Skyhawk', blurb: 'The classic trainer: slow, stable and forgiving. Lands itself, almost.',
      stall: 24, cruise: 52, max: 78, thrust: 3.3, authority: 0.8, pitch: 1.3, roll: 1.9, yaw: 0.55, stability: 2.6, gear: 1.3, scale: 1, cam: 1,
      span: 5.6, wingY: 1.2, wingZ: -1.1, nose: -3.4, tail: 5.2, gLimit: 5.5, wingX: 1.0, tailZ: 3.7, tailX: 2.4 },
    { id: 'pa28', cat: 'ga', name: 'Piper PA-28', kind: 'Cherokee', blurb: 'A low-wing tourer. A little quicker than the Cessna and just as friendly.',
      stall: 25, cruise: 58, max: 86, thrust: 3.7, authority: 0.85, pitch: 1.4, roll: 2.1, yaw: 0.55, stability: 2.4, gear: 1.3, scale: 1, cam: 1,
      span: 5.4, wingY: -0.36, wingZ: 0.2, nose: -3.3, tail: 5.0, gLimit: 5.5, wingX: 1.15, tailZ: 3.5, tailX: 2.6 },
    { id: 'sr22', cat: 'ga', name: 'Cirrus SR22', kind: 'Composite tourer', blurb: 'Fast, slippery and sporty. Stalls higher than the trainers and needs a lighter touch on the stick.',
      stall: 28, cruise: 68, max: 100, thrust: 4.4, authority: 0.85, pitch: 1.5, roll: 2.3, yaw: 0.55, stability: 2.2, gear: 1.3, scale: 1, cam: 1,
      span: 5.6, wingY: -0.1, wingZ: 0.27, nose: -3.4, tail: 5.05, gLimit: 4.4, wingX: 1.1, tailZ: 3.4, tailX: 2.3 },
    { id: 'pc12', cat: 'turbo', name: 'Pilatus PC-12', kind: 'Turboprop', blurb: 'One big turbine up front. Climbs hard, cruises fast and lands on short strips.',
      stall: 31, cruise: 82, max: 118, thrust: 5.2, authority: 0.8, pitch: 1.2, roll: 1.5, yaw: 0.45, stability: 2.5, gear: 1.4, scale: 1, cam: 1.3,
      span: 5.1, wingY: -0.24, wingZ: -0.14, nose: -4.3, tail: 4.6, gLimit: 5, wingX: 1.0, tailZ: 2.3, tailX: 2.3 },
    { id: 'cit', cat: 'biz', name: 'Cessna Citation', kind: 'Business jet', blurb: 'A small, fast twin jet with a T-tail. Quick to respond, and quick to run out of runway.',
      stall: 46, cruise: 125, max: 190, thrust: 7.2, authority: 0.85, pitch: 1.25, roll: 1.6, yaw: 0.35, stability: 2.3, gear: 1.0, scale: 1, cam: 1.4,
      span: 5.0, wingY: -0.06, wingZ: 2.0, nose: -4.8, tail: 4.8, gLimit: 5.5, wingX: 0.6, tailZ: 1.8, tailX: 2.0 },
    { id: 'e175', cat: 'biz', name: 'Embraer E175', kind: 'Regional jet', blurb: 'A regional twin with its engines on the tail. Light and agile for a jet, with a T-tail.',
      stall: 56, cruise: 130, max: 200, thrust: 7.2, authority: 0.8, pitch: 1.05, roll: 0.95, yaw: 0.28, stability: 2.3, gear: 1.45, scale: 1, cam: 1.7,
      span: 5.2, wingY: -0.01, wingZ: 1.26, nose: -6.35, tail: 6.35, gLimit: 5.2, wingX: 0.7, tailZ: 2.3, tailX: 2.6 },
    { id: 'a220', cat: 'biz', name: 'Airbus A220', kind: 'Airliner', blurb: 'A modern small twin with geared fans. Efficient and nimble, with a big, clean wing.',
      stall: 57, cruise: 138, max: 214, thrust: 7.7, authority: 0.8, pitch: 1.05, roll: 0.92, yaw: 0.26, stability: 2.3, gear: 1.85, scale: 1, cam: 1.9,
      span: 7.0, wingY: 0.17, wingZ: 2.0, nose: -7.7, tail: 7.7, gLimit: 5.2, wingX: 1.1, tailZ: 3.4, tailX: 3.3 },
    { id: 'b737', cat: 'liner', name: 'Boeing 737', kind: 'Airliner', blurb: 'Twin-engine jet. Heavy and calm: turn early and land with flaps.',
      stall: 62, cruise: 140, max: 215, thrust: 7.5, authority: 0.8, pitch: 1.0, roll: 0.75, yaw: 0.25, stability: 2.3, gear: 1.9, scale: 1, cam: 1.9,
      span: 6.85, wingY: 0.27, wingZ: 1.3, nose: -7.8, tail: 7.8, gLimit: 5.2, wingX: 1.1, tailZ: 3.5, tailX: 3.3 },
    { id: 'a320', cat: 'liner', name: 'Airbus A320', kind: 'Airliner', blurb: 'The world’s favourite short-haul twin. Nimble for an airliner, with sharklets.',
      stall: 59, cruise: 136, max: 212, thrust: 7.6, authority: 0.8, pitch: 1.0, roll: 0.85, yaw: 0.25, stability: 2.3, gear: 1.9, scale: 1, cam: 1.9,
      span: 6.8, wingY: 0.14, wingZ: 1.2, nose: -7.5, tail: 7.5, gLimit: 5.2, wingX: 1.1, tailZ: 3.3, tailX: 3.2 },
    { id: 'b787', cat: 'liner', name: 'Boeing 787', kind: 'Dreamliner', blurb: 'Composite wings that flex, raked tips and big windows. Smooth, quiet and long-legged.',
      stall: 65, cruise: 162, max: 242, thrust: 8.0, authority: 0.8, pitch: 0.95, roll: 0.68, yaw: 0.22, stability: 2.3, gear: 2.3, scale: 1, cam: 2.7,
      span: 11.9, wingY: 0.78, wingZ: 6.3, nose: -12.3, tail: 12.3, gLimit: 5.2, wingX: 1.5, tailZ: 5.2, tailX: 5.2 },
    { id: 'a350', cat: 'liner', name: 'Airbus A350', kind: 'Airliner', blurb: 'A modern long-haul twin with curved winglets. Smooth, quiet and efficient.',
      stall: 64, cruise: 158, max: 240, thrust: 8.0, authority: 0.8, pitch: 0.95, roll: 0.7, yaw: 0.22, stability: 2.3, gear: 2.4, scale: 1, cam: 2.8,
      span: 12.9, wingY: 0.4, wingZ: 5.4, nose: -13.4, tail: 13.4, gLimit: 5.2, wingX: 1.5, tailZ: 5.8, tailX: 5.4 },
    { id: 'b777', cat: 'liner', name: 'Boeing 777', kind: 'Airliner', blurb: 'Huge twin-jet with big engines. Powerful, smooth and a little nimbler than the 747.',
      stall: 66, cruise: 160, max: 240, thrust: 8.0, authority: 0.8, pitch: 0.95, roll: 0.65, yaw: 0.22, stability: 2.3, gear: 2.4, scale: 1, cam: 2.8,
      span: 12.2, wingY: 0.42, wingZ: 5.06, nose: -13, tail: 13, gLimit: 5.2, wingX: 1.6, tailZ: 5.0, tailX: 5.3 },
    { id: 'b747', cat: 'liner', name: 'Boeing 747', kind: 'Jumbo', blurb: 'Four engines and a hump. The biggest and slowest to turn: plan well ahead.',
      stall: 68, cruise: 150, max: 225, thrust: 6.8, authority: 0.8, pitch: 0.9, roll: 0.55, yaw: 0.2, stability: 2.4, gear: 2.5, scale: 1, cam: 3.0,
      span: 12.8, wingY: 0.34, wingZ: 6.9, nose: -14, tail: 14, gLimit: 5.2, wingX: 1.7, tailZ: 5.4, tailX: 5.5 },
    { id: 'a380', cat: 'liner', name: 'Airbus A380', kind: 'Superjumbo', blurb: 'Two full decks and four engines. The biggest airliner there is, and it feels it.',
      stall: 70, cruise: 150, max: 226, thrust: 6.9, authority: 0.8, pitch: 0.85, roll: 0.5, yaw: 0.2, stability: 2.4, gear: 2.9, scale: 1, cam: 3.4,
      span: 15.9, wingY: 0.49, wingZ: 8.2, nose: -14.5, tail: 14.5, gLimit: 5.2, wingX: 1.8, tailZ: 5.6, tailX: 6.2 },
    { id: 'f35', cat: 'mil', name: 'F-35 Lightning', kind: 'Stealth fighter', blurb: 'Single engine with afterburner, twin tails and nine G. Fast, nimble and very hungry for fuel.',
      stall: 50, cruise: 190, max: 300, thrust: 10.5, authority: 0.95, pitch: 1.8, roll: 3.8, yaw: 0.6, stability: 1.9, gear: 1.35, scale: 1, cam: 1.3,
      span: 3.6, wingY: -0.16, wingZ: 1.35, nose: -5.3, tail: 4.9, gLimit: 9, wingX: 1.0, tailZ: 2.4, tailX: 2.3 },
  ];

  /// Per-aircraft cockpit data: what kind of engine it has (for the sound and the engine gauge), the speeds painted on its
  /// airspeed indicator (m/s), how its flaps step, how much fuel it carries (seconds at full power) and the ticks it
  /// calls out on take-off. `vr` is the rotation speed. `gpws` says whether it speaks (true: airliner calls and warnings,
  /// false: nothing, 'betty': just "Pull up"); left out, it follows `retract`. `ab` is an afterburner.
  const AIRCRAFT = {
    c172: { tailPitch: 14, engine: 'piston', cyl: 4, rpmIdle: 700, rpmMax: 2700, dial: 'GA', flapNotches: [0, 0.33, 0.67, 1], flapLabels: ['UP', '10°', '20°', '30°'], fuel: 2100, vr: 1.12, vfe: 1.6, vno: 1.25 },
    pa28: { tailPitch: 13, engine: 'piston', cyl: 4, rpmIdle: 650, rpmMax: 2700, dial: 'GA', flapNotches: [0, 0.33, 0.67, 1], flapLabels: ['UP', '10°', '25°', '40°'], fuel: 2400, vr: 1.12, vfe: 1.55, vno: 1.25 },
    sr22: { tailPitch: 13, engine: 'piston', cyl: 6, rpmIdle: 750, rpmMax: 2700, dial: 'GA', flapNotches: [0, 0.5, 1], flapLabels: ['UP', '50%', '100%'], fuel: 2500, vr: 1.15, vfe: 1.55, vno: 1.3 },
    pc12: { retract: true, gearTime: 3.5, tailPitch: 12, engine: 'turboprop', cyl: 8, n1Idle: 26, rpmIdle: 1000, rpmMax: 1700, dial: 'GA', flapNotches: [0, 0.33, 0.67, 1], flapLabels: ['UP', '15°', '30°', '40°'], fuel: 2700, vr: 1.15, vfe: 1.6, vno: 1.25, gpws: false },
    cit: { retract: true, gearTime: 3.5, tailPitch: 11, engine: 'jet', engines: 2, n1Idle: 24, dial: 'AIRLINER', flapNotches: [0, 0.2, 0.5, 1], flapLabels: ['UP', '7°', '15°', '35°'], fuel: 1900, vr: 1.18, vfe: 1.5, vno: 1.25, gpws: true },
    e175: { retract: true, gearTime: 4, tailPitch: 11, engine: 'jet', engines: 2, n1Idle: 23, dial: 'AIRLINER', flapNotches: [0, 0.2, 0.4, 0.6, 0.8, 1], flapLabels: ['0', '1', '2', '3', '4', 'FULL'], fuel: 1600, vr: 1.2, vfe: 1.45, vno: 1.25, gpws: true },
    a220: { retract: true, gearTime: 4, tailPitch: 11.5, engine: 'jet', engines: 2, n1Idle: 22, dial: 'AIRLINER', flapNotches: [0, 0.2, 0.4, 0.6, 0.8, 1], flapLabels: ['0', '1', '2', '3', '4', 'FULL'], fuel: 1700, vr: 1.2, vfe: 1.45, vno: 1.25 },
    b737: { retract: true, gearTime: 4, tailPitch: 11, engine: 'jet', engines: 2, n1Idle: 22, dial: 'AIRLINER', flapNotches: [0, 0.2, 0.4, 0.6, 0.8, 1], flapLabels: ['UP', '1', '5', '15', '30', '40'], fuel: 1700, vr: 1.2, vfe: 1.45, vno: 1.25 },
    b747: { retract: true, gearTime: 6, tailPitch: 10, engine: 'jet', engines: 4, n1Idle: 24, dial: 'AIRLINER', flapNotches: [0, 0.2, 0.4, 0.6, 0.8, 1], flapLabels: ['UP', '1', '5', '10', '20', '30'], fuel: 2000, vr: 1.2, vfe: 1.45, vno: 1.25 },
    a320: { retract: true, gearTime: 4, tailPitch: 11.5, engine: 'jet', engines: 2, n1Idle: 22, dial: 'AIRLINER', flapNotches: [0, 0.2, 0.4, 0.6, 0.8, 1], flapLabels: ['0', '1', '1+F', '2', '3', 'FULL'], fuel: 1700, vr: 1.2, vfe: 1.45, vno: 1.25 },
    a350: { retract: true, gearTime: 5, tailPitch: 10, engine: 'jet', engines: 2, n1Idle: 20, dial: 'AIRLINER', flapNotches: [0, 0.2, 0.4, 0.6, 0.8, 1], flapLabels: ['0', '1', '1+F', '2', '3', 'FULL'], fuel: 2000, vr: 1.2, vfe: 1.45, vno: 1.25 },
    a380: { retract: true, gearTime: 7, tailPitch: 9, engine: 'jet', engines: 4, n1Idle: 24, dial: 'AIRLINER', flapNotches: [0, 0.2, 0.4, 0.6, 0.8, 1], flapLabels: ['0', '1', '2', '3', '4', 'FULL'], fuel: 2200, vr: 1.2, vfe: 1.45, vno: 1.25 },
    b777: { retract: true, gearTime: 5, tailPitch: 9.5, engine: 'jet', engines: 2, n1Idle: 20, dial: 'AIRLINER', flapNotches: [0, 0.2, 0.4, 0.6, 0.8, 1], flapLabels: ['UP', '1', '5', '15', '20', '30'], fuel: 2000, vr: 1.2, vfe: 1.45, vno: 1.25 },
    b787: { retract: true, gearTime: 5, tailPitch: 10, engine: 'jet', engines: 2, n1Idle: 20, dial: 'AIRLINER', flapNotches: [0, 0.2, 0.4, 0.6, 0.8, 1], flapLabels: ['UP', '1', '5', '15', '20', '30'], fuel: 2000, vr: 1.2, vfe: 1.45, vno: 1.25 },
    f35: { retract: true, gearTime: 3, tailPitch: 14, engine: 'jet', engines: 1, n1Idle: 30, ab: true, dial: 'FIGHTER', flapNotches: [0, 0.5, 1], flapLabels: ['UP', 'T/O', 'LAND'], fuel: 1300, vr: 1.2, vfe: 1.9, vno: 1.3, gpws: 'betty' },
  };
  PLANES.forEach((p) => Object.assign(p, AIRCRAFT[p.id]));
  /// Whether this aircraft speaks: true for the airliner calls, 'betty' for just "Pull up" (the fighter), false for nothing.
  const gpwsKind = (p) => (p.gpws === undefined ? !!p.retract : p.gpws);
  // ---- ROSTER END

  // ------------------------------------------------------------------ GPWS and callouts

  /// The radio-altimeter calls an airliner makes on the way down (feet above the ground).
  const RA_CALLS = [[1000, 'One thousand'], [500, 'Five hundred'], [300, 'Approaching minimums'], [200, 'Minimums'], [100, 'One hundred'],
    [50, 'Fifty'], [40, 'Forty'], [30, 'Thirty'], [20, 'Twenty'], [10, 'Ten']];
  /// The call for passing down through a height between two readings, or null.
  function raCallout(prevFt, ft, descending) {
    if (!descending || prevFt == null) return null;
    for (const [h, text] of RA_CALLS) if (prevFt > h && ft <= h) return text;
    return null;
  }
  /// Ground proximity warnings from what the aircraft is doing. `s`: ft (above the ground), sink (feet per minute
  /// down), bank (degrees), gearDown, flapNotch and landingFlaps, terrainSec (seconds to rising terrain ahead, or
  /// null), belowGlide, nearRunway, airborne. Returns [{ text, level, every }], worst first (level 2 is a warning,
  /// 1 a caution; `every` is the least number of seconds between repeats).
  function gpwsWarnings(s) {
    const out = [];
    if (!s.airborne) return out;
    if (s.terrainSec != null) out.push(s.terrainSec <= 6 ? { text: 'Pull up', level: 2, every: 1.4 } : { text: 'Terrain, terrain', level: 1, every: 3 });
    // Sink rate: how fast is too fast grows with height; a very high rate close to the ground is a warning.
    if (s.ft < 2500 && s.ft > 30) {
      const limit = 1100 + s.ft;
      if (s.sink > limit * 1.6) out.push({ text: 'Pull up', level: 2, every: 1.4 });
      else if (s.sink > limit) out.push({ text: 'Sink rate', level: 1, every: 2.6 });
    }
    if (!s.gearDown && s.ft < 500 && s.sink > 150) out.push({ text: s.nearRunway ? 'Too low, gear' : 'Too low, terrain', level: 1, every: 3 });
    if (s.gearDown && s.ft < 200 && s.ft > 50 && s.flapNotch < s.landingFlaps && s.sink > 150) out.push({ text: 'Too low, flaps', level: 1, every: 4 });
    if (s.belowGlide && s.ft < 1000) out.push({ text: 'Glideslope', level: 1, every: 2.6 });
    if (s.bank > 35 && s.ft < 1000) out.push({ text: 'Bank angle', level: 1, every: 2.6 });
    return out.sort((a, b) => b.level - a.level);
  }

  /// The speeds on this aircraft's airspeed indicator, in m/s: flaps-down stall, clean stall, flaps limit, the end of the
  /// green arc, and the never-exceed line.
  const speedsOf = (p) => ({ vs0: p.stall * 0.88, vs1: p.stall, vfe: p.stall * p.vfe, vno: p.cruise * p.vno, vne: p.max, vr: p.stall * p.vr });

  // ---- AIRCRAFT MODELS BEGIN
  // ------------------------------------------------------------------ aircraft models
  // Every aircraft is lofted rather than built from boxes: fuselages are stacks of rounded rings, wings and tails are
  // airfoil sections with real taper, sweep and dihedral, engines are bodies of revolution with fan faces and
  // chevrons. Flaps, ailerons, elevators, rudders and spoilers are separate pieces on hinges that the renderer
  // moves with the controls, the undercarriage is a set of legs that fold into the fuselage, and the lights are
  // little glowing blobs.

  const sgnp = (v, p) => Math.sign(v) * Math.pow(Math.abs(v), p);
  const mix = (a, b, t) => a + (b - a) * t;
  const cmix = (a, b, t) => [mix(a[0], b[0], t), mix(a[1], b[1], t), mix(a[2], b[2], t)];
  const cmul = (c, s) => [c[0] * s, c[1] * s, c[2] * s];

  /// Triangles from a grid of points (rows x columns) with smooth normals. `colAt(row, col)` colours each quad (or
  /// returns null to leave a hole); `closed` joins the last column to the first (a ring), `smoothRows` blends the
  /// normals between rows (a fuselage) instead of keeping each strip flat along its length (a wing).
  function gridMesh(b, P, colAt, o = {}) {
    const R = P.length, C = P[0].length, closed = !!o.closed, nq = closed ? C : C - 1;
    const refs = o.refs || P.map((row) => { const s = [0, 0, 0]; for (const p of row) { s[0] += p[0]; s[1] += p[1]; s[2] += p[2]; } return [s[0] / C, s[1] / C, s[2] / C]; });
    const F = [];
    for (let r = 0; r < R - 1; r++) {
      F[r] = [];
      for (let c = 0; c < nq; c++) {
        const c1 = (c + 1) % C, a = P[r][c], bb = P[r][c1], d = P[r + 1][c], e = P[r + 1][c1];
        let n = norm(cross(sub(e, a), sub(d, bb)));
        const m = mul(add(add(a, bb), add(d, e)), 0.25), rf = mul(add(refs[r], refs[r + 1]), 0.5);
        if (dot(n, sub(m, rf)) < 0) n = mul(n, -1);
        F[r][c] = n;
      }
    }
    const vn = (r, c, strip) => {
      let s = [0, 0, 0];
      const cs = closed ? [(c - 1 + C) % C, c % C] : [c - 1, c];
      for (const rr of o.smoothRows ? [r - 1, r] : [strip]) {
        if (rr < 0 || rr > R - 2) continue;
        for (const cc of cs) if (cc >= 0 && cc < nq) s = add(s, F[rr][cc]);
      }
      return norm(s);
    };
    for (let r = 0; r < R - 1; r++) for (let c = 0; c < nq; c++) {
      const col = typeof colAt === 'function' ? colAt(r, c) : colAt;
      if (!col) continue;
      const c1 = (c + 1) % C, q = [[r, c], [r, c1], [r + 1, c1], [r + 1, c]];
      for (const k of [0, 1, 2, 0, 2, 3]) {
        const [rr, cc] = q[k], p = P[rr][cc], n = vn(rr, cc, r);
        b.d.push(p[0], p[1], p[2], n[0], n[1], n[2], col[0], col[1], col[2]);
      }
    }
  }
  /// A flat polygon (fan from its first point) facing `n`, for badges, stripes and panel lines.
  function polyFan(b, pts, n, col) {
    for (let i = 1; i < pts.length - 1; i++) for (const p of [pts[0], pts[i], pts[i + 1]]) b.d.push(p[0], p[1], p[2], n[0], n[1], n[2], col[0], col[1], col[2]);
  }
  /// A tiny glowing blob (an octahedron) for lights.
  function blob(b, p, r, col = [1, 1, 1]) {
    const X = [[r, 0, 0], [-r, 0, 0]], Y = [[0, r, 0], [0, -r, 0]], Z = [[0, 0, r], [0, 0, -r]];
    for (const x of X) for (const y of Y) for (const z of Z) b.tri(add(p, x), add(p, y), add(p, z), col, p);
  }

  // ---- fuselages: a stack of rings along z (nose first). A ring is { z, w, h, cy, e }: half width, half height, centre
  // height and the squareness of its cross-section (2 is an ellipse, higher is boxier).
  const RING_N = 20;
  function ringPts(rg, n) {
    const pts = [], pw = 2 / (rg.e || 2);
    for (let i = 0; i < n; i++) {
      const th = (i / n) * Math.PI * 2, s = Math.sin(th), c = -Math.cos(th);
      pts.push([sgnp(s, pw) * rg.w, rg.cy + sgnp(c, pw) * rg.h, rg.z]);
    }
    return pts;
  }
  function ringAt(rings, z) {
    let i = 0;
    while (i < rings.length - 2 && rings[i + 1].z < z) i++;
    const a = rings[i], c = rings[i + 1], t = clamp((z - a.z) / ((c.z - a.z) || 1), 0, 1);
    return { z, w: mix(a.w, c.w, t), h: mix(a.h, c.h, t), cy: mix(a.cy, c.cy, t), e: mix(a.e || 2, c.e || 2, t) };
  }
  /// A point on the fuselage skin at z and angle `th` (degrees round from the belly, 90 = right side, 180 = top), moved out by `off`.
  function surfPt(rings, z, th, off = 0) {
    const rg = ringAt(rings, z), a = th * DEG, s = Math.sin(a), c = -Math.cos(a), e = rg.e || 2, pw = 2 / e;
    const x = sgnp(s, pw) * Math.max(rg.w, 1e-4), y = sgnp(c, pw) * Math.max(rg.h, 1e-4);
    let nx = sgnp(x / Math.max(rg.w, 1e-4), e - 1) / Math.max(rg.w, 1e-4), ny = sgnp(y / Math.max(rg.h, 1e-4), e - 1) / Math.max(rg.h, 1e-4);
    const nl = Math.hypot(nx, ny) || 1; nx /= nl; ny /= nl;
    return [x + nx * off, rg.cy + y + ny * off, z];
  }
  function loftRings(b, rings, colAt, n = RING_N) {
    const P = rings.map((rg) => ringPts(rg, n));
    gridMesh(b, P, (r, c) => colAt((rings[r].z + rings[r + 1].z) / 2, ((c + 0.5) / n) * 360, r), { closed: true, smoothRows: true, refs: rings.map((rg) => [0, rg.cy, rg.z]) });
  }
  const ringRefs = (rings, zs) => zs.map((z) => { const rg = ringAt(rings, z); return [0, rg.cy, z]; });
  /// A patch of colour on the fuselage skin: z from z0 to z1, angle th0..th1, hugging the surface.
  function patch(b, rings, z0, z1, th0, th1, col, off = 0.02) {
    const zs = [z0, ...rings.map((rg) => rg.z).filter((z) => z > z0 && z < z1), z1];
    const nt = Math.max(1, Math.ceil(Math.abs(th1 - th0) / 14)), ths = [];
    for (let i = 0; i <= nt; i++) ths.push(mix(th0, th1, i / nt));
    gridMesh(b, zs.map((z) => ths.map((th) => surfPt(rings, z, th, off))), col, { refs: ringRefs(rings, zs) });
  }
  /// A band along the fuselage whose angular edges change with z: keys are [z, th0, th1]. Drawn on both sides.
  function stripe(b, rings, keys, col, off = 0.02) {
    const zl = keys[0][0], zh = keys[keys.length - 1][0];
    const zs = [...new Set([...keys.map((k) => k[0]), ...rings.map((rg) => rg.z).filter((z) => z > zl && z < zh)])].sort((p, q) => p - q);
    const at = (z) => {
      let i = 0;
      while (i < keys.length - 2 && keys[i + 1][0] < z) i++;
      const k0 = keys[i], k1 = keys[i + 1], t = clamp((z - k0[0]) / ((k1[0] - k0[0]) || 1), 0, 1);
      return [mix(k0[1], k1[1], t), mix(k0[2], k1[2], t)];
    };
    for (const m of [1, -1]) {
      const P = zs.map((z) => {
        const [t0, t1] = at(z), nt = Math.max(1, Math.ceil(Math.abs(t1 - t0) / 14)), row = [];
        for (let i = 0; i <= nt; i++) { const th = mix(t0, t1, i / nt); row.push(surfPt(rings, z, m > 0 ? th : 360 - th, off)); }
        return row;
      });
      const wide = Math.max(...P.map((row) => row.length)); if (P.some((row) => row.length !== wide)) { for (const row of P) while (row.length < wide) row.push(row[row.length - 1]); }
      gridMesh(b, P, col, { refs: ringRefs(rings, zs) });
    }
  }
  /// Windows and doors: small patches on both sides.
  function windows(b, rings, z0, z1, pitch, th0, th1, wlen, col, off = 0.022) {
    for (let z = z0; z + wlen <= z1; z += pitch) {
      patch(b, rings, z, z + wlen, th0, th1, col, off);
      patch(b, rings, z, z + wlen, 360 - th1, 360 - th0, col, off);
    }
  }
  function outline(b, rings, z0, z1, th0, th1, col, lw = 0.012) {
    const dth = lw / Math.max(ringAt(rings, (z0 + z1) / 2).w, 0.3) / DEG;
    for (const m of [1, -1]) {
      const T = (a, c) => (m > 0 ? [a, c] : [360 - c, 360 - a]);
      for (const [a, c, za, zb] of [[th0, th1, z0, z0 + lw], [th0, th1, z1 - lw, z1], [th0, th0 + dth, z0, z1], [th1 - dth, th1, z0, z1]]) {
        const [t0, t1] = T(a, c); patch(b, rings, za, zb, t0, t1, col, 0.016);
      }
    }
  }

  // ---- bodies of revolution
  /// Rows [dz, r, colour] stacked along z at centre c; the colour belongs to the strip from that row to the next.
  function revolveZ(b, c, rows, seg = 14, smooth = true) {
    const P = rows.map(([dz, r]) => { const pts = []; for (let i = 0; i < seg; i++) { const a = (i / seg) * Math.PI * 2; pts.push([c[0] + Math.cos(a) * r, c[1] + Math.sin(a) * r, c[2] + dz]); } return pts; });
    gridMesh(b, P, (r) => rows[r][2], { closed: true, smoothRows: smooth, refs: rows.map(([dz]) => [c[0], c[1], c[2] + dz]) });
  }
  /// The same around an axis along x (wheels).
  function revolveX(b, c, rows, seg = 8) {
    const P = rows.map(([dx, r]) => { const pts = []; for (let i = 0; i < seg; i++) { const a = (i / seg) * Math.PI * 2; pts.push([c[0] + dx, c[1] + Math.cos(a) * r, c[2] + Math.sin(a) * r]); } return pts; });
    gridMesh(b, P, (r) => rows[r][2], { closed: true, smoothRows: true, refs: rows.map(([dx]) => [c[0] + dx, c[1], c[2]]) });
  }
  /// A thin round rod between two points.
  function rod(b, p0, p1, r0, r1, col, seg = 6) {
    const d = norm(sub(p1, p0)), up = Math.abs(d[1]) > 0.9 ? [1, 0, 0] : [0, 1, 0], u = norm(cross(d, up)), v = cross(d, u);
    const ring = (p, r) => { const pts = []; for (let i = 0; i < seg; i++) { const a = (i / seg) * Math.PI * 2; pts.push(add(p, add(mul(u, Math.cos(a) * r), mul(v, Math.sin(a) * r)))); } return pts; };
    gridMesh(b, [ring(p0, r0), ring(p1, r1)], col, { closed: true, smoothRows: true, refs: [p0, p1] });
  }
  /// A tyre and hub with its axle along x, standing on the ground at the bottom (centre height = r).
  function wheel(b, x, y, z, r, w) {
    const tyre = [0.1, 0.1, 0.11], hub = [0.62, 0.64, 0.68];
    revolveX(b, [x, y, z], [[-w / 2, 0, hub], [-w / 2, r * 0.58, tyre], [-w * 0.46, r * 0.97, tyre], [w * 0.46, r * 0.97, tyre], [w / 2, r * 0.58, hub], [w / 2, 0, hub]], 9);
  }

  // ---- wings, fins and tail planes
  const FOIL = [0, 0.01, 0.03, 0.07, 0.13, 0.21, 0.31, 0.42, 0.53, 0.64, 0.75, 0.86, 0.94, 1];
  const nacaT = (u) => 5 * (0.2969 * Math.sqrt(u) - 0.126 * u - 0.3516 * u * u + 0.2843 * u * u * u - 0.1036 * u * u * u * u);
  const foilStations = (u0, u1) => [u0, ...FOIL.filter((u) => u > u0 + 1e-6 && u < u1 - 1e-6), u1];
  /// Which part of the broken-up aircraft a piece at (cx, cz) belongs to; the same rule splits the main mesh (see splitPlane).
  const bucketOf = (spec, cx, cz) => (cz >= spec.tailZ && Math.abs(cx) < (spec.tailX || 1e9) ? 'T' : cx < -spec.wingX ? 'L' : cx > spec.wingX ? 'R' : 'F');
  const centroidOf = (bld) => { let x = 0, z = 0, n = bld.d.length / 9; for (let i = 0; i < bld.d.length; i += 9) { x += bld.d[i]; z += bld.d[i + 2]; } return [x / n, z / n]; };
  /// A lofted lifting surface. `f` is its frame { o: origin, S: unit vector along the span, T: unit vector across it
  /// (up for a wing, sideways for a fin) }; `secs` are { s, le, c, th } (distance along the span, leading-edge z, chord,
  /// thickness ratio). Control surfaces `o.cs` ({ kind, s0, s1, c0, h?, side }) become separate pieces on hinges in `W.dyn`; `o.sp`
  /// are spoilers lying on the top skin. Returns helpers to find points on the skin for badges and lights.
  function wingBuild(W, f, secs, o = {}) {
    const col = o.col, colB = o.colB || o.col, cam = o.camber == null ? 0.014 : o.camber;
    const sec = (s) => {
      let i = 0;
      while (i < secs.length - 2 && secs[i + 1].s < s) i++;
      const a = secs[i], c = secs[i + 1], t = clamp((s - a.s) / ((c.s - a.s) || 1), 0, 1);
      return { le: mix(a.le, c.le, t), c: mix(a.c, c.c, t), th: mix(a.th, c.th, t) };
    };
    const pt = (s, u, up, off = 0) => {
      const q = sec(s), tt = up * nacaT(u) * q.th * q.c + cam * q.c * 4 * u * (1 - u) + up * off;
      return [f.o[0] + f.S[0] * s + f.T[0] * tt, f.o[1] + f.S[1] * s + f.T[1] * tt, f.o[2] + q.le + u * q.c];
    };
    const loop = (s, u0, u1) => {
      const U = foilStations(u0, u1), pts = [];
      for (let i = U.length - 1; i >= 0; i--) pts.push(pt(s, U[i], -1));
      for (let i = u0 === 0 ? 1 : 0; i < U.length; i++) pts.push(pt(s, U[i], 1));
      return pts;
    };
    const nLow = (u0, u1) => foilStations(u0, u1).length - 1;
    const cs = o.cs || [];
    const brk = [...new Set([...secs.map((q) => q.s), ...cs.flatMap((c) => [c.s0, c.s1])])].sort((p, q) => p - q);
    const cap = (bld, pts, n, cc) => { const m = pts.reduce((a, p) => add(a, p), [0, 0, 0]); polyFan(bld, [mul(m, 1 / pts.length), ...pts, pts[0]], n, cc); };
    for (let k = 0; k < brk.length - 1; k++) {
      const sa = brk[k], sb = brk[k + 1];
      if (sb - sa < 1e-5) continue;
      const c = cs.find((x) => x.s0 <= sa + 1e-5 && x.s1 >= sb - 1e-5);
      if (!c) {
        const nl = nLow(0, 1);
        gridMesh(W.b, [loop(sa, 0, 1), loop(sb, 0, 1)], (r, i) => (i < nl ? colB : col));
        continue;
      }
      const h = c.h == null ? c.c0 : c.h, cc = c.col || col;
      const nl0 = nLow(0, c.c0);
      if (c.c0 > 0.001) gridMesh(W.b, [loop(sa, 0, c.c0), loop(sb, 0, c.c0)], (r, i) => (i < nl0 ? colB : col));
      const pb = new Builder(), nl1 = nLow(c.c0, 1), A = loop(sa, c.c0, 1), B = loop(sb, c.c0, 1);
      gridMesh(pb, [A, B], (r, i) => (i < nl1 ? (c.colB || colB) : cc));
      gridMesh(pb, [[A[0], A[A.length - 1]], [B[0], B[B.length - 1]]], cc);      // the front face
      cap(pb, A, mul(f.S, -1), cc); cap(pb, B, f.S, cc);
      const hm = (s) => mul(add(pt(s, h, 1), pt(s, h, -1)), 0.5);
      let axis = norm(sub(hm(sb), hm(sa)));
      if (c.axisUp ? axis[1] < 0 : axis[0] < 0) axis = mul(axis, -1);
      const [cx, cz] = centroidOf(pb);
      W.dyn.push({ kind: c.kind, side: c.side || 0, mesh: pb, pivot: hm((sa + sb) / 2), axis, attach: bucketOf(W.spec, cx, cz), span: sb - sa });
    }
    // Tip cap, so the end of a wing is closed.
    if (o.cap !== false) cap(W.b, loop(secs[secs.length - 1].s, 0, 1), f.S, col);
    for (const sp of o.sp || []) {
      const pb = new Builder(), top = (s, u) => pt(s, u, 1, 0.012), bot = (s, u) => pt(s, u, 1, -0.012);
      pb.hexa([bot(sp.s0, sp.u0), bot(sp.s1, sp.u0), bot(sp.s1, sp.u1), bot(sp.s0, sp.u1), top(sp.s0, sp.u0), top(sp.s1, sp.u0), top(sp.s1, sp.u1), top(sp.s0, sp.u1)], cmul(col, 0.88));
      const a = pt(sp.s0, sp.u0, 1), c2 = pt(sp.s1, sp.u0, 1);
      let axis = norm(sub(c2, a)); if (axis[0] < 0) axis = mul(axis, -1);
      const [cx, cz] = centroidOf(pb);
      W.dyn.push({ kind: 'spoiler', side: sp.side || 0, mesh: pb, pivot: mul(add(a, c2), 0.5), axis, attach: bucketOf(W.spec, cx, cz), span: sp.s1 - sp.s0 });
    }
    return { pt, sec };
  }
  /// The frame of a wing half: dihedral `dih` (degrees) and side -1 (left) or +1 (right), starting at (0, y, 0).
  const wingFrame = (side, y, dih, x0 = 0) => ({ o: [side * x0, y, 0], S: [side * Math.cos(dih * DEG), Math.sin(dih * DEG), 0], T: [-side * Math.sin(dih * DEG), Math.cos(dih * DEG), 0] });
  /// A fin: rising from (x, y, 0) tilted `cant` degrees outwards (side ±1).
  const finFrame = (x, y, cant = 0, side = 1) => ({ o: [x, y, 0], S: [side * Math.sin(cant * DEG), Math.cos(cant * DEG), 0], T: [Math.cos(cant * DEG), -side * Math.sin(cant * DEG), 0] });

  /// Lights are collected as { kind, p, attach } and drawn as glowing blobs. kinds: navR, navG, navW, strobe, beacon, land, taxi.
  function addLight(W, kind, p, r) { W.lights.push({ kind, p, r, attach: bucketOf(W.spec, p[0], p[2]) }); }

  // ---- engines
  /// A turbofan pod with its inlet at z = e.z, centred on (e.x, e.y): outer cowl, a rounded lip, the dark inlet, a plug
  /// and nozzle behind; `chev` adds the serrated trailing edge. The fan itself is a separate little mesh that turns.
  function nacelle(W, e) {
    const b = W.b, r = e.d / 2, L = e.len, col = e.col, lip = cmix(col, [0.86, 0.88, 0.9], 0.6), dark = [0.07, 0.07, 0.09], inner = [0.34, 0.35, 0.38], metal = [0.5, 0.5, 0.52];
    const c = [e.x, e.y, e.z];
    const rows = [[L, r * 0.8, col], [0.84 * L, r * 0.9, col], [0.58 * L, r * 0.99, col], [0.28 * L, r * 1.04, col], [0.07 * L, r * 1.0, col],
      [0, r * 0.95, lip], [-0.014 * L, r * 0.9, lip], [0, r * 0.86, inner], [0.1 * L, r * 0.85, dark], [0.115 * L, r * 0.8, dark], [0.115 * L, r * 0.3, dark], [0.115 * L, 0, dark]];
    revolveZ(b, c, rows, 16);
    if (e.chev) {
      // Serrated nozzle edge: a ring whose points alternate fore and aft.
      const P = [0, 1].map((k) => { const pts = []; for (let i = 0; i < 16; i++) { const a = (i / 16) * Math.PI * 2, rr = r * (k ? 0.8 : 0.82); pts.push([c[0] + Math.cos(a) * rr, c[1] + Math.sin(a) * rr, c[2] + L * (k ? 1 + (i % 2 ? 0.075 : -0.0) : 0.93)]); } return pts; });
      gridMesh(b, P, col, { closed: true, refs: [[c[0], c[1], c[2] + L * 0.93], [c[0], c[1], c[2] + L]] });
    }
    // The core nozzle and plug sticking out behind.
    revolveZ(b, c, [[0.74 * L, r * 0.55, metal], [L * 1.0, r * 0.5, metal], [L * 1.14, r * 0.4, [0.38, 0.36, 0.34]], [L * 1.3, r * 0.1, [0.3, 0.29, 0.28]], [L * 1.32, 0, dark]], 12);
    // The fan: pale blades on a spinner.
    const fb = new Builder(), n = 16;
    for (let k = 0; k < n; k++) {
      const a0 = (k / n) * Math.PI * 2, P = (rad, a) => [Math.cos(a) * rad, Math.sin(a) * rad, 0];
      polyFan(fb, [P(r * 0.2, a0), P(r * 0.82, a0 + 0.13), P(r * 0.82, a0 + 0.3), P(r * 0.2, a0 + 0.2)], [0, 0, -1], e.fanCol || [0.66, 0.68, 0.72]);
    }
    revolveZ(fb, [0, 0, 0], [[0.015 * L, r * 0.24, [0.7, 0.72, 0.76]], [-0.04 * L, r * 0.17, [0.8, 0.82, 0.85]], [-0.085 * L, r * 0.05, [0.85, 0.86, 0.9]], [-0.09 * L, 0, [0.85, 0.86, 0.9]]], 10);
    W.fans.push({ mesh: fb, at: [e.x, e.y, e.z + 0.105 * L], attach: bucketOf(W.spec, e.x, e.z), dir: e.dir || 1 });
  }
  /// The pylon joining a pod to the wing's underside (or to the fuselage side if `side` is given).
  function pylon(W, e, topY, z0, z1, col) {
    const t = 0.05, yb = e.y + e.d * 0.38, zb0 = e.z + e.len * 0.12, zb1 = e.z + e.len * 0.86;
    W.b.hexa([[e.x - t, yb, zb0], [e.x + t, yb, zb0], [e.x + t, yb, zb1], [e.x - t, yb, zb1], [e.x - t, topY + 0.04, z0], [e.x + t, topY + 0.04, z0], [e.x + t, topY + 0.04, z1], [e.x - t, topY + 0.04, z1]], col);
  }

  // ---- propellers
  /// A propeller with `n` blades of radius R and a spinner, spinning about z and centred on its own origin, plus a flat
  /// disc for the blur. Blades have a twist, a taper and a bright tip.
  function propMesh(n, R, col, spinCol, o = {}) {
    const p = new Builder(), disc = new Builder(), hub = o.hub || R * 0.1, t = o.thick || R * 0.012, tipCol = o.tip || [0.95, 0.8, 0.15];
    for (let k = 0; k < n; k++) {
      const a = (k / n) * Math.PI * 2, ca = Math.cos(a), sa = Math.sin(a);
      const Pt = (x, y, z) => [x * ca - y * sa, x * sa + y * ca, z];
      const st = [[hub, R * 0.14, 0.5], [R * 0.34, R * 0.15, 0.36], [R * 0.7, R * 0.115, 0.2], [R * 0.9, R * 0.085, 0.12], [R, R * 0.05, 0.08]];
      for (let i = 0; i < st.length - 1; i++) {
        const [ra, ca2, pa] = st[i], [rb, cb, pb] = st[i + 1], q = (rr, cc, ph, sx, sz) => [sx * (cc / 2) * Math.cos(ph), rr, sx * (cc / 2) * Math.sin(ph) + sz * t];
        const A = [q(ra, ca2, pa, -1, -1), q(ra, ca2, pa, 1, -1), q(ra, ca2, pa, 1, 1), q(ra, ca2, pa, -1, 1), q(rb, cb, pb, -1, -1), q(rb, cb, pb, 1, -1), q(rb, cb, pb, 1, 1), q(rb, cb, pb, -1, 1)].map((v) => Pt(v[0], v[1], v[2]));
        p.hexa(A, i === st.length - 2 ? tipCol : [0.1, 0.1, 0.12]);
      }
    }
    const len = o.spinLen || R * 0.34;
    revolveZ(p, [0, 0, 0], [[-len, 0, spinCol], [-len * 0.72, hub * 0.62, spinCol], [-len * 0.3, hub * 0.96, spinCol], [0.02, hub * 1.0, spinCol], [0.1, hub * 0.9, [0.15, 0.15, 0.17]]], 12);
    const ring = []; for (let i = 0; i < 28; i++) ring.push([Math.cos((i / 28) * 6.2832) * R, Math.sin((i / 28) * 6.2832) * R, 0]);
    polyFan(disc, [[0, 0, 0], ...ring, ring[0]], [0, 0, -1], [0.55, 0.55, 0.58]);
    return { prop: p, disc };
  }

  // ---- landing gear. Each leg is its own mesh that folds about a hinge: { mesh, pivot, axis, ang } (ang is the angle when fully raised).
  const LEG = [0.36, 0.38, 0.42], CHROME = [0.78, 0.8, 0.84];
  /// A main leg dropping from (x, y, z) to the ground at y = -gear, on a bogie of `ax` axles (z offsets), each with `per` wheels.
  function mainLeg(W, x, y, z, gear, wr, ww, ax = [0], per = 2, fold = true, sw = 0.05) {
    const lb = new Builder(), wy = -gear + wr, side = Math.sign(x) || 1;
    const top = [x, y, z], mid = [x, mix(y, wy, 0.45), z], bot = [x, wy + (ax.length > 1 ? wr * 0.25 : 0), z];
    rod(lb, top, mid, sw * 1.15, sw * 1.15, LEG); rod(lb, mid, bot, sw * 0.7, sw * 0.7, CHROME);
    // Torque links: two little arms between the sections.
    rod(lb, add(mid, [0, 0.0, 0.0]), add(lerp(mid, bot, 0.5), [0, 0, sw * 2.2]), sw * 0.3, sw * 0.3, LEG, 4);
    rod(lb, add(lerp(mid, bot, 0.5), [0, 0, sw * 2.2]), add(lerp(mid, top, 0.3), [0, 0, 0.0]), sw * 0.3, sw * 0.3, LEG, 4);
    if (ax.length > 1) rod(lb, [x, wy, z + Math.min(...ax)], [x, wy, z + Math.max(...ax)], sw * 0.7, sw * 0.7, LEG);
    for (const dz of ax) {
      if (per === 1) wheel(lb, x, wy, z + dz, wr, ww);
      else for (const k of [-1, 1]) wheel(lb, x + k * ww * 0.62, wy, z + dz, wr, ww);
      rod(lb, [x - (per === 1 ? 0 : ww * 0.62), wy, z + dz], [x + (per === 1 ? 0 : ww * 0.62), wy, z + dz], sw * 0.45, sw * 0.45, LEG, 5);
    }
    W.gears.push({ mesh: lb, pivot: top, axis: [0, 0, 1], ang: fold ? -side * Math.PI / 2 : 0, attach: 'F' });
  }
  /// The nose leg: one strut with twin wheels, a taxi light, retracting forwards.
  function noseLeg(W, x, y, z, gear, wr, ww, per = 2, fold = true, sw = 0.045) {
    const lb = new Builder(), wy = -gear + wr, mid = [x, mix(y, wy, 0.5), z];
    rod(lb, [x, y, z], mid, sw * 1.1, sw * 1.1, LEG); rod(lb, mid, [x, wy, z], sw * 0.7, sw * 0.7, CHROME);
    rod(lb, mid, add(lerp(mid, [x, y, z], 0.5), [0, 0, -sw * 2.5]), sw * 0.3, sw * 0.3, LEG, 4);
    if (per === 1) wheel(lb, x, wy, z, wr, ww); else for (const k of [-1, 1]) wheel(lb, x + k * ww * 0.62, wy, z, wr, ww);
    W.gears.push({ mesh: lb, pivot: [x, y, z], axis: [1, 0, 0], ang: fold ? Math.PI / 2 : 0, attach: 'F', nose: true });
  }

  // ---- jets and airliners
  /// Builds a jet: lofted fuselage with windows and doors, a swept wing with flaps, ailerons and spoilers, a fin with rudder,
  /// tail planes with elevators, engine pods (under the wing or on the rear fuselage), winglets, gear and lights.
  function linerBuild(P, S) {
    const b = new Builder(), W = { b, dyn: [], gears: [], lights: [], fans: [], spec: P };
    const zN = P.nose, zT = P.tail, L = zT - zN, D = S.D, r = D / 2, semi = P.span, C = hex;
    const body = C(S.body), belly = C(S.belly || S.body), trim = C(S.trim), tailc = C(S.tail), accent = C(S.accent || S.trim);
    const glass = [0.06, 0.09, 0.13], eng = C(S.eng || '#e7ebef'), wingc = C(S.wingCol || '#dde2e8'), wingB = C(S.wingBot || '#c2c8d0'), dark = [0.1, 0.11, 0.13], radome = [0.2, 0.22, 0.25];
    const tan = (d) => Math.tan(d * DEG);

    // ---- fuselage
    const nl = S.noseLen * L, tl = S.tailLen * L, tall = S.tall || 1, rings = [];
    const hump = (z) => { const h = S.hump; if (!h) return 0; const f = (z - zN) / L; return h.k * smooth(h.z0, h.zp, f) * (1 - smooth(h.zq, h.z1, f)); };
    const barrel = (z) => { const k = hump(z) + (tall - 1); return { z, w: r, h: r * (1 + k), cy: r * k, e: S.e || 2 }; };
    for (const t of [0.004, 0.025, 0.07, 0.14, 0.24, 0.38, 0.58, 0.8, 1]) {
      const k = Math.sqrt(1 - Math.pow(1 - t, 2.2)), rr = Math.max(k * r, 0.012), up = Math.pow(t, 1.5) * (tall - 1);
      rings.push({ z: zN + nl * t, w: rr, h: rr * (1 + up), cy: -r * S.droop * Math.pow(1 - t, 1.7) + r * up, e: S.e || 2 });
    }
    const nb = 8; for (let i = 1; i <= nb; i++) rings.push(barrel(zN + nl + ((zT - tl - zN - nl) * i) / nb));
    const tb = barrel(zT - tl);
    for (const t of [0.14, 0.3, 0.48, 0.66, 0.82, 0.94, 1]) {
      const k = mix(1, S.tailEnd, Math.pow(t, 1.25));
      rings.push({ z: zT - tl + tl * t, w: Math.max(r * k, 0.02), h: Math.max(tb.h * k * 0.96, 0.02), cy: mix(tb.cy, S.tailUp * r, t * t), e: S.e || 2 });
    }
    loftRings(b, rings, (z, th) => (z < zN + 0.028 * L ? radome : z > zT - 0.018 * L ? dark : th > 304 || th < 56 ? belly : body));

    // Windows, doors, windscreen.
    const wz0 = zN + S.win[0] * L, wz1 = zN + S.win[1] * L;
    windows(b, rings, wz0, wz1, S.winPitch, S.winTh[0], S.winTh[1], S.winPitch * 0.64, glass);
    if (S.win2) windows(b, rings, zN + S.win2[0] * L, zN + S.win2[1] * L, S.winPitch, S.win2[2], S.win2[3], S.winPitch * 0.64, glass);
    for (const [df, dw] of S.doors) outline(b, rings, zN + df * L, zN + df * L + dw, 62, 114, lerp(body, [0.4, 0.43, 0.48], 0.45));
    const wv = zN + nl * 0.74;
    for (const sg of [1, -1]) {
      const T = (a, c) => (sg > 0 ? [a, c] : [360 - c, 360 - a]);
      patch(b, rings, wv, wv + nl * 0.3, ...T(163, 177.5), glass, 0.016);
      patch(b, rings, wv, wv + nl * 0.3, ...T(145, 160), glass, 0.016);
      patch(b, rings, wv + nl * 0.2, wv + nl * 0.5, ...T(112, 140), glass, 0.016);
    }

    // ---- wing
    const le0 = zN + S.wingLE * L, dih = S.dih, tanS = tan(S.sweep), cr = S.cr * L, ck = S.ck * L, ct = S.ct * L, xk = S.xk * semi;
    const wy = -0.3 * D * (S.wingLow == null ? 1 : S.wingLow);
    const secs = [{ s: 0, le: le0, c: cr, th: S.th }, { s: xk, le: le0 + xk * tanS, c: ck, th: S.th * 0.85 }];
    if (S.rake) {
      const sr = semi * S.rake.from, leR = le0 + sr * tanS;
      secs.push({ s: sr, le: leR, c: mix(ck, ct, (sr - xk) / (semi - xk)) * 1.05, th: S.th * 0.7 }, { s: semi, le: leR + (semi - sr) * tan(S.rake.sweep), c: ct * S.rake.tipC, th: S.th * 0.55 });
    } else secs.push({ s: semi, le: le0 + semi * tanS, c: ct, th: S.th * 0.65 });
    const wings = {};
    for (const side of [-1, 1]) {
      const fl = S.flaps || [[0.13, 0.5, 0.74], [0.5, 0.72, 0.76]];
      const cs = [...fl.map(([a, c2, h]) => ({ kind: 'flap', s0: a * semi, s1: c2 * semi, c0: h, side })), { kind: 'aileron', s0: S.ail[0] * semi, s1: S.ail[1] * semi, c0: 0.8, side }];
      const sp = (S.spoil || [[0.3, 0.45], [0.45, 0.6], [0.6, 0.72]]).map(([a, c2]) => ({ s0: a * semi, s1: c2 * semi, u0: 0.6, u1: 0.74, side }));
      wings[side] = wingBuild(W, wingFrame(side, wy, dih), secs, { col: wingc, colB: wingB, cs, sp });
    }
    const wingPt = (side, s, u, up, off) => wings[side].pt(s, u, up, off);
    // Winglets / sharklets.
    const tipTop = {};
    for (const side of [-1, 1]) {
      let top = wingPt(side, semi, 0.5, 1);
      tipTop[side] = top;
      const wg = S.winglet;
      if (wg) {
        const base = mul(add(wingPt(side, semi, 0.0, 1), wingPt(side, semi, 1, 1)), 0.5), leT = wingPt(side, semi, 0, 1)[2], cT = wingPt(side, semi, 1, 1)[2] - leT;
        const ws = [{ s: 0, le: leT, c: cT, th: 0.1 }, { s: wg.h * 0.45, le: leT + wg.h * 0.45 * tan(wg.sweep * 0.7), c: mix(cT, wg.tipC, 0.5), th: 0.09 }, { s: wg.h, le: leT + wg.h * tan(wg.sweep), c: wg.tipC, th: 0.07 }];
        const wl = wingBuild(W, finFrame(base[0], base[1] - 0.02, wg.cant, side), ws, { col: S.wingletCol ? C(S.wingletCol) : wingc, colB: wingc });
        tipTop[side] = wl.pt(wg.h, 0.5, 1);
      }
    }

    // ---- tail
    const f = S.fin, finZ = zN + f.z * L, baseY = tb.cy + r * 0.2, tH = (s) => finZ + s * tan(f.sweep);
    const finSecs = [{ s: 0, le: finZ, c: f.cr, th: 0.1 }, { s: f.h, le: tH(f.h), c: f.ct, th: 0.08 }];
    const fb = wingBuild(W, finFrame(0, baseY, 0, 1), finSecs, { col: tailc, colB: tailc, cs: [{ kind: 'rudder', s0: 0.08 * f.h, s1: 0.97 * f.h, c0: 0.68, axisUp: true }] });
    const finLogo = (polys, col) => { for (const sg of [1, -1]) for (const pg of polys) polyFan(b, pg.map(([v, u]) => fb.pt(v * f.h, u, sg, 0.014)), [sg, 0, 0], col); };
    if (S.dorsal) { const dz = finZ - f.cr * 0.9; wingBuild(W, finFrame(0, baseY + 0.1, 0, 1), [{ s: 0, le: dz, c: f.cr * 0.9 + 0.2, th: 0.07 }, { s: f.h * 0.28, le: finZ + 0.2, c: f.cr * 0.5, th: 0.07 }], { col: tailc, colB: tailc }); }
    const h = S.htail, hy = S.ttail ? baseY + f.h * 0.985 : tb.cy + r * (h.y == null ? 0.1 : h.y), hz = S.ttail ? tH(f.h * 0.985) - h.cr * 0.1 : zN + h.z * L;
    for (const side of [-1, 1]) {
      wingBuild(W, wingFrame(side, hy, h.dih), [{ s: 0, le: hz, c: h.cr, th: 0.09 }, { s: h.semi, le: hz + h.semi * tan(h.sweep), c: h.ct, th: 0.075 }], { col: wingc, colB: wingB, cs: [{ kind: 'elevator', s0: 0.06 * h.semi, s1: 0.96 * h.semi, c0: 0.66, side }] });
    }

    // ---- engines
    for (const e of S.engines) for (const side of e.centre ? [1] : [-1, 1]) {
      const d = e.d, len = e.len;
      if (e.rear) {
        const x = side * e.x, ey = tb.cy + r * e.y, z = zN + e.zf * L;
        nacelle(W, { x, y: ey, z, d, len, col: eng, chev: e.chev });
        const sx = side * r * 0.8, ox = x - side * d * 0.42;
        b.hexa([[sx, ey - 0.07, z + len * 0.2], [sx, ey + 0.07, z + len * 0.2], [sx, ey + 0.07, z + len * 0.85], [sx, ey - 0.07, z + len * 0.85],
          [ox, ey - 0.04, z + len * 0.22], [ox, ey + 0.04, z + len * 0.22], [ox, ey + 0.04, z + len * 0.8], [ox, ey - 0.04, z + len * 0.8]], body);
        continue;
      }
      const sx = e.f * semi, x = side * sx, leAt = wings[side].sec(sx).le, under = wingPt(side, sx, 0.3, -1)[1];
      const ez = leAt - (e.ahead == null ? 1.0 : e.ahead) * d, ey = under - (e.drop == null ? 0.55 : e.drop) * d;
      nacelle(W, { x, y: ey, z: ez, d, len, col: eng, chev: e.chev });
      pylon(W, { x, y: ey, z: ez, d, len }, under, leAt + 0.08 * wings[side].sec(sx).c, leAt + 0.78 * wings[side].sec(sx).c, wingc);
    }

    // ---- undercarriage
    const wr = S.wheelR, ww = S.wheelW, py = (x) => (Math.abs(x) < r * 0.95 ? -r * 0.8 : wingPt(1, Math.abs(x), 0.5, -1)[1] + 0.03);
    for (const lg of S.legs) for (const side of lg.x < 0.01 ? [1] : [-1, 1]) mainLeg(W, side * lg.x, py(lg.x), zN + lg.zf * L, P.gear, wr, ww, lg.ax || [0], 2, true, S.strut || wr * 0.26);
    noseLeg(W, 0, -r * 0.8, zN + S.noseGear * L, P.gear, wr * 0.88, ww * 0.9, 2, true, S.strut ? S.strut * 0.9 : wr * 0.23);
    addLight(W, 'taxi', [0, -r * 0.7, zN + S.noseGear * L - 0.06], D * 0.03);

    // ---- lights
    const lr = D * 0.032 + 0.025;
    for (const side of [-1, 1]) {
      const tp = tipTop[side];
      addLight(W, side < 0 ? 'navR' : 'navG', add(tp, [side * 0.02, 0.03, 0]), lr);
      addLight(W, 'strobe', add(wingPt(side, semi * 0.985, 0.97, 1), [0, 0.03, 0.03]), lr);
      addLight(W, 'land', add(wingPt(side, Math.max(r * 1.1, S.legs[0].x * 0.8), 0.04, -1), [0, -0.02, -0.05]), lr * 1.15);
    }
    addLight(W, 'navW', [0, tb.cy + r * 0.35, zT - 0.02], lr);
    addLight(W, 'strobe', [0, tb.cy + r * 0.3, zT - 0.03], lr);
    addLight(W, 'beacon', [0, r * (1 + 2 * (S.hump ? 0 : 0)) - 0.03 + (tall - 1) * 2 * r * 0.9, zN + 0.52 * L], lr * 1.2);
    addLight(W, 'beacon', [0, -r + 0.02, zN + 0.45 * L], lr * 1.2);

    if (S.paint) S.paint({ b, rings, zN, zT, L, D, r, nl, tl, body, belly, trim, tailc, accent, finLogo, fin: f, glass, dark, tb });
    return { body: b, dyn: W.dyn, gears: W.gears, lights: W.lights, fans: W.fans };
  }

  // ---- the liveries (all invented) and the jets' shapes
  const WHITE = [0.97, 0.97, 0.98], GOLD = [0.93, 0.74, 0.22];
  /// A regular polygon (or star if `inner` is given) on the fin in (height, chord) coordinates; R is in metres. Returns a fan.
  function finShape(K, cv, cu, R, n, rot = 0, inner = 0) {
    const h = K.fin.h, c = (K.fin.cr + K.fin.ct) / 2, pts = [[cv, cu]];
    for (let i = 0; i <= n * (inner ? 2 : 1); i++) {
      const a = rot + (i / (n * (inner ? 2 : 1))) * Math.PI * 2, rr = inner && i % 2 ? R * inner : R;
      pts.push([cv + (Math.sin(a) * rr) / h, cu + (Math.cos(a) * rr) / c]);
    }
    return pts;
  }
  const BAND = (K, v0, u0, v1, u1, w) => [[v0, u0], [v0, u0 + w], [v1, u1 + w], [v1, u1]];   // a slanted band on the fin
  const LINERS = {
    b737: { D: 1.5, noseLen: 0.12, tailLen: 0.27, droop: 0.1, tailUp: 0.5, tailEnd: 0.1, wingLE: 0.36, sweep: 25, cr: 0.2, ck: 0.135, ct: 0.04, xk: 0.33, th: 0.125, dih: 6, ail: [0.77, 0.97],
      body: '#f4f6f8', belly: '#cdd3da', trim: '#1e6bd6', tail: '#1e6bd6', accent: '#ffffff', win: [0.19, 0.72], winPitch: 0.21, winTh: [94, 103], doors: [[0.165, 0.42], [0.69, 0.42]],
      winglet: { h: 0.85, cant: 9, sweep: 44, tipC: 0.2 }, fin: { z: 0.735, cr: 2.2, ct: 0.85, h: 2.55, sweep: 37 }, htail: { z: 0.81, cr: 1.6, ct: 0.55, semi: 2.85, sweep: 32, dih: 7 },
      engines: [{ f: 0.3, d: 0.84, len: 2.0, ahead: 0.95, drop: 0.5 }], legs: [{ x: 1.0, zf: 0.445 }], noseGear: 0.115, wheelR: 0.2, wheelW: 0.11,
      paint(K) {
        const { b, rings, zN, zT, L, tl } = K;
        stripe(b, rings, [[zN + 0.13 * L, 73, 82], [zT - tl, 73, 82], [zT - tl * 0.4, 75, 100], [zT - 0.02 * L, 95, 135]], K.trim);
        stripe(b, rings, [[zN + 0.12 * L, 66, 70.5], [zT - tl, 66, 70.5]], K.accent);
        K.finLogo([BAND(K, 0.2, 0.1, 0.72, 0.62, 0.2)], WHITE); K.finLogo([finShape(K, 0.82, 0.72, 0.22, 10)], WHITE);
      } },
    b747: { D: 2.6, noseLen: 0.105, tailLen: 0.26, droop: 0.08, tailUp: 0.45, tailEnd: 0.08, hump: { k: 0.25, z0: 0.1, zp: 0.17, zq: 0.3, z1: 0.44 }, wingLE: 0.385, sweep: 37, cr: 0.19, ck: 0.125, ct: 0.036, xk: 0.36, th: 0.12, dih: 5, ail: [0.78, 0.97],
      body: '#f4f6f8', belly: '#c7ccd3', trim: '#b5322a', tail: '#b5322a', accent: '#1f2a44', win: [0.17, 0.74], winPitch: 0.3, winTh: [93, 102], win2: [0.11, 0.25, 128, 136], doors: [[0.14, 0.6], [0.31, 0.6], [0.68, 0.6]],
      fin: { z: 0.7, cr: 4.4, ct: 1.5, h: 4.5, sweep: 42 }, htail: { z: 0.78, cr: 3.0, ct: 1.0, semi: 4.6, sweep: 38, dih: 6 }, dorsal: true,
      engines: [{ f: 0.36, d: 1.05, len: 2.6, ahead: 0.9 }, { f: 0.68, d: 1.05, len: 2.6, ahead: 0.9 }], legs: [{ x: 2.1, zf: 0.49, ax: [-0.4, 0.4] }, { x: 0.95, zf: 0.565, ax: [-0.4, 0.4] }], noseGear: 0.1, wheelR: 0.27, wheelW: 0.13,
      paint(K) {
        const { b, rings, zN, zT, L, tl } = K;
        stripe(b, rings, [[zN + 0.1 * L, 72, 84], [zT - tl, 72, 84], [zT - tl * 0.4, 74, 98], [zT - 0.02 * L, 92, 130]], K.trim);
        stripe(b, rings, [[zN + 0.1 * L, 62, 66], [zT - tl, 62, 66]], K.accent);
        K.finLogo([BAND(K, 0.18, 0.18, 0.5, 0.52, 0.17), BAND(K, 0.5, 0.52, 0.82, 0.18, 0.17), BAND(K, 0.52, 0.18, 0.84, 0.5, 0.17)], WHITE);
      } },
    b777: { D: 2.5, noseLen: 0.11, tailLen: 0.27, droop: 0.1, tailUp: 0.5, tailEnd: 0.07, wingLE: 0.385, sweep: 32, cr: 0.185, ck: 0.122, ct: 0.033, xk: 0.34, th: 0.12, dih: 5.5, ail: [0.78, 0.97],
      body: '#f4f6f8', belly: '#c9ced5', trim: '#223a66', tail: '#0b7d63', accent: '#e6c14b', win: [0.15, 0.76], winPitch: 0.3, winTh: [93, 101.5], doors: [[0.135, 0.6], [0.3, 0.6], [0.55, 0.6], [0.72, 0.6]],
      fin: { z: 0.7, cr: 4.2, ct: 1.5, h: 4.1, sweep: 40 }, htail: { z: 0.79, cr: 3.1, ct: 0.9, semi: 4.6, sweep: 36, dih: 6 },
      engines: [{ f: 0.4, d: 1.45, len: 3.0, ahead: 0.85, drop: 0.6 }], legs: [{ x: 2.2, zf: 0.5, ax: [-0.58, 0, 0.58] }], noseGear: 0.1, wheelR: 0.29, wheelW: 0.14,
      paint(K) {
        const { b, rings, zN, zT, L, tl } = K;
        stripe(b, rings, [[zN + 0.1 * L, 74, 83], [zT - tl, 74, 83], [zT - tl * 0.4, 76, 100], [zT - 0.02 * L, 95, 128]], K.trim);
        stripe(b, rings, [[zN + 0.1 * L, 69.5, 72.5], [zT - tl, 69.5, 72.5]], K.accent ? GOLD : K.trim);
        K.finLogo([finShape(K, 0.55, 0.45, 0.62, 5, 0, 0.42)], WHITE);
      } },
    a320: { D: 1.5, noseLen: 0.12, tailLen: 0.28, droop: 0.12, tailUp: 0.55, tailEnd: 0.08, wingLE: 0.35, sweep: 25, cr: 0.205, ck: 0.14, ct: 0.04, xk: 0.31, th: 0.125, dih: 5, ail: [0.77, 0.97],
      body: '#f6f7f9', belly: '#d2d7de', trim: '#0a5bbf', tail: '#0a2f6b', accent: '#7fb6ff', win: [0.17, 0.72], winPitch: 0.21, winTh: [94, 103], doors: [[0.15, 0.42], [0.7, 0.42]],
      winglet: { h: 0.6, cant: 2, sweep: 52, tipC: 0.22 }, fin: { z: 0.73, cr: 2.1, ct: 0.8, h: 2.4, sweep: 36 }, htail: { z: 0.8, cr: 1.55, ct: 0.5, semi: 2.75, sweep: 30, dih: 6 },
      engines: [{ f: 0.3, d: 0.9, len: 2.0, ahead: 0.95, drop: 0.52 }], legs: [{ x: 1.0, zf: 0.43 }], noseGear: 0.11, wheelR: 0.2, wheelW: 0.11,
      paint(K) {
        const { b, rings, zN, zT, L, tl } = K;
        stripe(b, rings, [[zN + 0.62 * L, 100, 122], [zT - tl * 0.5, 100, 140], [zT - 0.02 * L, 100, 160]], K.trim);   // a blue sweep rising up the tail
        K.finLogo([BAND(K, 0.08, 0.1, 0.38, 0.5, 0.35)], hex('#7fb6ff'));
        K.finLogo([[[0.5, 0.45], [0.62, 0.2], [0.72, 0.3], [0.8, 0.12], [0.78, 0.5], [0.62, 0.62]]], WHITE);
      } },
    a350: { D: 2.4, noseLen: 0.115, tailLen: 0.28, droop: 0.1, tailUp: 0.5, tailEnd: 0.07, wingLE: 0.385, sweep: 32, cr: 0.185, ck: 0.125, ct: 0.03, xk: 0.35, th: 0.115, dih: 5, ail: [0.78, 0.97],
      body: '#f6f7f9', belly: '#c9ced5', trim: '#0a2f6b', tail: '#1a56c4', accent: '#9cc7ff', win: [0.14, 0.78], winPitch: 0.3, winTh: [93, 102], doors: [[0.13, 0.6], [0.29, 0.6], [0.55, 0.6], [0.73, 0.6]],
      winglet: { h: 0.95, cant: 28, sweep: 50, tipC: 0.3 }, fin: { z: 0.72, cr: 4.2, ct: 1.4, h: 4.0, sweep: 40 }, htail: { z: 0.78, cr: 3.0, ct: 0.9, semi: 4.7, sweep: 36, dih: 6 },
      engines: [{ f: 0.38, d: 1.4, len: 3.0, ahead: 0.9, drop: 0.6, chev: true }], legs: [{ x: 2.15, zf: 0.5, ax: [-0.56, 0, 0.56] }], noseGear: 0.1, wheelR: 0.28, wheelW: 0.13,
      paint(K) {
        const { b, rings, zN, zT, L, tl } = K;
        stripe(b, rings, [[zN + 0.1 * L, 70, 80], [zT - tl, 70, 80], [zT - tl * 0.3, 72, 100], [zT - 0.02 * L, 90, 140]], K.trim);
        K.finLogo([BAND(K, 0.1, 0.05, 0.6, 0.5, 0.18)], hex('#4f8fe8')); K.finLogo([BAND(K, 0.05, 0.3, 0.45, 0.7, 0.12)], hex('#9cc7ff'));
        K.finLogo([finShape(K, 0.72, 0.4, 0.3, 4, Math.PI / 4)], WHITE);
      } },
    a380: { D: 3.0, noseLen: 0.1, tailLen: 0.27, droop: 0.06, tailUp: 0.5, tailEnd: 0.07, tall: 1.16, wingLE: 0.405, sweep: 33.5, cr: 0.19, ck: 0.13, ct: 0.03, xk: 0.33, th: 0.12, dih: 5, ail: [0.78, 0.97],
      body: '#f6f7f9', belly: '#c4cad2', trim: '#0b3d91', tail: '#0b3d91', accent: '#d8b24a', win: [0.14, 0.76], winPitch: 0.31, winTh: [92, 99], win2: [0.12, 0.78, 124, 131], doors: [[0.13, 0.65], [0.3, 0.65], [0.55, 0.65], [0.72, 0.65]],
      fin: { z: 0.7, cr: 4.8, ct: 1.7, h: 4.8, sweep: 40 }, htail: { z: 0.78, cr: 3.4, ct: 1.0, semi: 5.4, sweep: 38, dih: 6 },
      engines: [{ f: 0.34, d: 1.2, len: 2.8, ahead: 0.9 }, { f: 0.62, d: 1.2, len: 2.8, ahead: 0.9 }], legs: [{ x: 3.0, zf: 0.5, ax: [-0.55, 0, 0.55] }, { x: 1.1, zf: 0.575, ax: [-0.4, 0.4] }], noseGear: 0.1, wheelR: 0.3, wheelW: 0.14,
      paint(K) {
        const { b, rings, zN, zT, L, tl } = K;
        stripe(b, rings, [[zN + 0.1 * L, 66, 72], [zT - tl, 66, 72], [zT - tl * 0.3, 68, 96], [zT - 0.02 * L, 88, 140]], K.trim);
        stripe(b, rings, [[zN + 0.1 * L, 62, 64.5], [zT - tl, 62, 64.5]], hex('#d8b24a'));
        K.finLogo([finShape(K, 0.5, 0.45, 0.85, 14)], hex('#d8b24a')); K.finLogo([finShape(K, 0.5, 0.45, 0.62, 14)], K.tailc); K.finLogo([finShape(K, 0.5, 0.45, 0.4, 5, 0, 0.45)], hex('#d8b24a'));
      } },
    b787: { D: 2.25, noseLen: 0.115, tailLen: 0.28, droop: 0.1, tailUp: 0.5, tailEnd: 0.07, wingLE: 0.385, sweep: 32, cr: 0.18, ck: 0.12, ct: 0.034, xk: 0.34, th: 0.115, dih: 7, ail: [0.77, 0.93], rake: { from: 0.9, sweep: 62, tipC: 0.4 },
      body: '#f4f6f7', belly: '#c6ccd2', trim: '#0f7c86', tail: '#0f7c86', accent: '#7fd3d6', win: [0.15, 0.78], winPitch: 0.3, winTh: [91, 103], doors: [[0.13, 0.55], [0.3, 0.55], [0.55, 0.55], [0.73, 0.55]],
      fin: { z: 0.72, cr: 3.8, ct: 1.3, h: 3.7, sweep: 38 }, htail: { z: 0.78, cr: 2.8, ct: 0.8, semi: 4.5, sweep: 35, dih: 7 },
      engines: [{ f: 0.37, d: 1.3, len: 2.9, ahead: 0.9, drop: 0.6, chev: true }], legs: [{ x: 2.0, zf: 0.5, ax: [-0.55, 0, 0.55] }], noseGear: 0.1, wheelR: 0.27, wheelW: 0.13,
      paint(K) {
        const { b, rings, zN, zT, L, tl } = K;
        stripe(b, rings, [[zN + 0.1 * L, 62, 76], [zT - tl, 66, 78], [zT - tl * 0.35, 72, 100], [zT - 0.02 * L, 92, 145]], K.trim);
        stripe(b, rings, [[zN + 0.1 * L, 58, 61], [zT - tl, 62, 65]], K.accent ? hex('#7fd3d6') : K.trim);
        K.finLogo([BAND(K, 0.12, 0.05, 0.42, 0.6, 0.16)], hex('#7fd3d6')); K.finLogo([BAND(K, 0.32, 0.05, 0.62, 0.62, 0.16)], hex('#bfe9ea')); K.finLogo([BAND(K, 0.52, 0.05, 0.82, 0.64, 0.16)], WHITE);
      } },
    a220: { D: 1.45, noseLen: 0.12, tailLen: 0.27, droop: 0.12, tailUp: 0.5, tailEnd: 0.08, wingLE: 0.41, sweep: 24, cr: 0.2, ck: 0.135, ct: 0.04, xk: 0.32, th: 0.125, dih: 5, ail: [0.78, 0.97],
      body: '#f5f6f8', belly: '#d0d5db', trim: '#e8671b', tail: '#e8671b', accent: '#f6b86e', win: [0.18, 0.74], winPitch: 0.2, winTh: [93, 104], doors: [[0.15, 0.42], [0.72, 0.42]],
      winglet: { h: 0.55, cant: 14, sweep: 46, tipC: 0.18 }, fin: { z: 0.73, cr: 2.3, ct: 0.9, h: 2.5, sweep: 36 }, htail: { z: 0.8, cr: 1.5, ct: 0.5, semi: 2.9, sweep: 30, dih: 6 },
      engines: [{ f: 0.3, d: 0.86, len: 2.0, ahead: 0.55, drop: 0.56, chev: true }], legs: [{ x: 0.98, zf: 0.46 }], noseGear: 0.115, wheelR: 0.19, wheelW: 0.1,
      paint(K) {
        const { b, rings, zN, zT, L, tl } = K;
        stripe(b, rings, [[zN + 0.12 * L, 72, 80], [zT - tl, 72, 80], [zT - tl * 0.3, 74, 104], [zT - 0.02 * L, 94, 150]], K.trim);
        K.finLogo([[[0.15, 0.15], [0.15, 0.35], [0.5, 0.6], [0.85, 0.35], [0.85, 0.15], [0.5, 0.4]]], WHITE);
      } },
    e175: { D: 1.25, noseLen: 0.125, tailLen: 0.3, droop: 0.12, tailUp: 0.55, tailEnd: 0.1, wingLE: 0.4, sweep: 23, cr: 0.21, ck: 0.15, ct: 0.05, xk: 0.32, th: 0.125, dih: 4, ail: [0.78, 0.97], ttail: true,
      body: '#f3f5f7', belly: '#cfd4da', trim: '#2f9e5c', tail: '#2f9e5c', accent: '#1a4f8a', win: [0.2, 0.7], winPitch: 0.18, winTh: [93, 103], doors: [[0.16, 0.38], [0.72, 0.38]],
      winglet: { h: 0.45, cant: 12, sweep: 45, tipC: 0.16 }, fin: { z: 0.69, cr: 1.8, ct: 0.9, h: 2.3, sweep: 40 }, htail: { cr: 1.2, ct: 0.5, semi: 2.2, sweep: 25, dih: 0 },
      engines: [{ x: 1.0, d: 0.72, len: 1.8, rear: true, zf: 0.6, y: 0.2 }], legs: [{ x: 0.82, zf: 0.5 }], noseGear: 0.12, wheelR: 0.17, wheelW: 0.09,
      paint(K) {
        const { b, rings, zN, zT, L, tl } = K;
        stripe(b, rings, [[zN + 0.13 * L, 72, 80], [zT - tl, 72, 80], [zT - tl * 0.3, 74, 100], [zT - 0.02 * L, 94, 135]], K.trim);
        stripe(b, rings, [[zN + 0.13 * L, 64, 68], [zT - tl, 64, 68]], K.accent);
        K.finLogo([BAND(K, 0.15, 0.15, 0.5, 0.5, 0.18), BAND(K, 0.5, 0.15, 0.85, 0.5, 0.18)], WHITE);
      } },
    cit: { D: 1.05, noseLen: 0.15, tailLen: 0.32, droop: 0.14, tailUp: 0.55, tailEnd: 0.1, wingLE: 0.43, sweep: 26, cr: 0.185, ck: 0.13, ct: 0.055, xk: 0.35, th: 0.12, dih: 3, ail: [0.76, 0.97], ttail: true,
      body: '#f7f8fa', belly: '#d3d8de', trim: '#1b2a49', tail: '#f7f8fa', accent: '#c8a24a', win: [0.2, 0.62], winPitch: 0.2, winTh: [94, 106], doors: [[0.17, 0.4]],
      winglet: { h: 0.5, cant: 6, sweep: 45, tipC: 0.18 }, fin: { z: 0.7, cr: 1.5, ct: 0.7, h: 1.7, sweep: 42 }, htail: { cr: 1.0, ct: 0.45, semi: 1.7, sweep: 28, dih: 0 },
      engines: [{ x: 0.86, d: 0.6, len: 1.5, rear: true, zf: 0.63, y: 0.22 }], legs: [{ x: 0.7, zf: 0.52 }], noseGear: 0.14, wheelR: 0.14, wheelW: 0.075,
      paint(K) {
        const { b, rings, zN, zT, L, tl } = K;
        stripe(b, rings, [[zN + 0.12 * L, 70, 80], [zT - tl, 70, 80], [zT - tl * 0.35, 72, 98], [zT - 0.02 * L, 92, 130]], K.trim);
        stripe(b, rings, [[zN + 0.12 * L, 65, 68], [zT - tl, 65, 68]], hex('#c8a24a'));
        K.finLogo([BAND(K, 0.1, 0.12, 0.9, 0.62, 0.14)], hex('#1b2a49')); K.finLogo([BAND(K, 0.1, 0.32, 0.9, 0.82, 0.05)], hex('#c8a24a'));
      } },
  };

  // ---- light aircraft and the turboprop
  function gaBuild(P, S) {
    const b = new Builder(), W = { b, dyn: [], gears: [], lights: [], fans: [], spec: P }, C = hex, tan = (d) => Math.tan(d * DEG);
    const body = C(S.body), belly = C(S.belly || S.body), trim = C(S.trim), accent = C(S.accent || S.trim), glass = [0.07, 0.1, 0.14], dark = [0.12, 0.12, 0.14];
    const rings = S.rings.map(([z, w, h, cy, e]) => ({ z, w, h, cy, e }));
    loftRings(b, rings, (z, th) => (S.colAt ? S.colAt(z, th, { body, belly, trim, accent }) : th > 302 || th < 58 ? belly : body), 18);
    for (const [z0, z1, t0, t1, mirror] of S.glass) {
      patch(b, rings, z0, z1, t0, t1, glass, 0.014);
      if (mirror !== false) patch(b, rings, z0, z1, 360 - t1, 360 - t0, glass, 0.014);
    }
    for (const [z0, z1, t0, t1, col] of S.paintPatches || []) { patch(b, rings, z0, z1, t0, t1, col, 0.012); patch(b, rings, z0, z1, 360 - t1, 360 - t0, col, 0.012); }
    for (const k of S.stripes || []) stripe(b, rings, k.keys, k.col, 0.014);

    // ---- wing
    const w = S.wing, semi = P.span, wcol = C(w.col || S.body), wcolB = C(w.colB || w.col || S.body);
    const secs = w.secs.map(([s, le, c, th]) => ({ s, le, c, th }));
    const wings = {};
    for (const side of [-1, 1]) {
      const cs = [{ kind: 'flap', s0: w.flap[0], s1: w.flap[1], c0: w.flap[2], side, col: wcol }, { kind: 'aileron', s0: w.ail[0], s1: w.ail[1], c0: w.ail[2] || 0.74, side, col: C(w.ailCol || w.col || S.body) }];
      wings[side] = wingBuild(W, wingFrame(side, w.y, w.dih, w.x0 || 0), secs, { col: wcol, colB: wcolB, cs });
    }
    // ---- tail
    const f = S.fin, ft = S.stab, base = f.y;
    const fb = wingBuild(W, finFrame(0, base, 0, 1), [{ s: 0, le: f.z, c: f.cr, th: 0.09 }, { s: f.h, le: f.z + f.h * tan(f.sweep), c: f.ct, th: 0.07 }], { col: C(f.col || S.body), colB: C(f.col || S.body), cs: [{ kind: 'rudder', s0: 0.1 * f.h, s1: 0.97 * f.h, c0: 0.66, axisUp: true }] });
    if (S.dorsal) wingBuild(W, finFrame(0, base + 0.05, 0, 1), [{ s: 0, le: f.z - S.dorsal.len, c: S.dorsal.len + 0.3, th: 0.06 }, { s: S.dorsal.h, le: f.z - 0.05, c: 0.4, th: 0.05 }], { col: C(f.col || S.body), colB: C(f.col || S.body) });
    for (const side of [-1, 1]) {
      const cs = ft.allMoving ? [{ kind: 'stab', s0: 0.0, s1: ft.semi, c0: 0, h: 0.28, side }] : [{ kind: 'elevator', s0: 0.05 * ft.semi, s1: 0.96 * ft.semi, c0: 0.62, side }];
      wingBuild(W, wingFrame(side, ft.y, ft.dih || 0), [{ s: 0, le: ft.z, c: ft.cr, th: 0.09 }, { s: ft.semi, le: ft.z + ft.semi * tan(ft.sweep || 8), c: ft.ct, th: 0.075 }], { col: C(ft.col || S.body), colB: C(ft.col || S.body), cs });
    }
    for (const lg of S.logo || []) for (const sg of [1, -1]) polyFan(b, lg.pts.map(([v, u]) => fb.pt(v * f.h, u, sg, 0.012)), [sg, 0, 0], lg.col);

    // ---- propeller and the rest (struts, exhausts, gear) are the aircraft's own business
    const pr = propMesh(S.prop.n, S.prop.R, [0.1, 0.1, 0.12], C(S.prop.spin || '#c8ccd2'), { tip: S.prop.tip, spinLen: S.prop.spinLen });
    if (S.extra) S.extra(W, { rings, wings, body, trim, accent, dark, wcol });

    // ---- lights
    const lr = 0.05;
    for (const side of [-1, 1]) {
      const tp = wings[side].pt(semi, 0.5, 1);
      addLight(W, side < 0 ? 'navR' : 'navG', add(tp, [side * 0.03, 0.03, 0.02]), lr);
      addLight(W, 'strobe', add(wings[side].pt(semi * 0.995, 0.92, 1), [0, 0.03, 0.04]), lr);
    }
    addLight(W, 'navW', [0, f.y + f.h * 0.94, f.z + f.h * 0.94 * tan(f.sweep) + f.ct * 0.98], lr);
    addLight(W, 'strobe', [0, f.y + f.h * 0.96, f.z + f.h * 0.96 * tan(f.sweep) + f.ct], lr);
    addLight(W, 'beacon', [0, ringAt(rings, S.beaconZ || 1.5).cy + ringAt(rings, S.beaconZ || 1.5).h - 0.03, S.beaconZ || 1.5], lr * 1.1);
    addLight(W, 'land', S.landLight || [0.0, -0.2, S.rings[0][0] + 0.2], lr * 1.3);
    return { body: b, dyn: W.dyn, gears: W.gears, lights: W.lights, fans: [], prop: pr.prop, disc: pr.disc, propAt: S.propAt };
  }

  /// A fixed wheel on a leg: spring-steel leg from the fuselage to the hub, with an optional streamlined fairing.
  function fixedWheel(W, x0, y0, z0, x1, wr, ww, o = {}) {
    const lb = new Builder(), wy = -W.spec.gear + wr, col = o.col || [0.82, 0.84, 0.88];
    rod(lb, [x0, y0, z0], [x1, wy + 0.04, z0 + (o.dz || 0)], o.r || 0.045, o.r || 0.045, o.legCol || LEG, 6);
    wheel(lb, x1, wy, z0 + (o.dz || 0), wr, ww);
    if (o.pant) revolveZ(lb, [x1 + Math.sign(x1) * ww * 0.55, wy + wr * 0.18, z0 + (o.dz || 0)], [[-wr * 2.2, 0, col], [-wr * 1.7, wr * 0.55, col], [-wr * 0.6, wr * 1.0, col], [wr * 0.8, wr * 0.92, col], [wr * 1.9, wr * 0.5, col], [wr * 2.6, 0, col]], 10);
    W.gears.push({ mesh: lb, pivot: [x0, y0, z0], axis: [0, 0, 1], ang: o.fold ? -Math.sign(x1) * Math.PI / 2 : 0, attach: 'F' });
  }
  function fixedNose(W, x, y0, z0, z1, wr, ww, o = {}) {
    const lb = new Builder(), wy = -W.spec.gear + wr;
    rod(lb, [x, y0, z0], [x, wy + 0.04, z1], o.r || 0.045, o.r || 0.04, o.legCol || LEG, 6);
    wheel(lb, x, wy, z1, wr, ww);
    if (o.pant) revolveZ(lb, [x, wy + wr * 0.2, z1], [[-wr * 2, 0, o.col || WHITE], [-wr * 1.4, wr * 0.55, o.col || WHITE], [0, wr * 0.95, o.col || WHITE], [wr * 1.8, wr * 0.5, o.col || WHITE], [wr * 2.5, 0, o.col || WHITE]], 10);
    W.gears.push({ mesh: lb, pivot: [x, y0, z0], axis: [1, 0, 0], ang: o.fold ? Math.PI / 2 : 0, attach: 'F', nose: true });
  }

  const GA = {
    c172: { body: '#f6f7fa', belly: '#f0f2f6', trim: '#1f5fb5', accent: '#1f5fb5',
      rings: [[-3.06, 0.07, 0.09, -0.14, 2], [-2.98, 0.3, 0.3, -0.1, 2.2], [-2.6, 0.5, 0.48, -0.07, 2.3], [-2.2, 0.58, 0.58, -0.03, 2.3], [-1.75, 0.62, 0.66, 0.04, 2.4], [-1.3, 0.66, 0.78, 0.1, 2.4], [-0.3, 0.68, 0.78, 0.12, 2.4], [0.8, 0.6, 0.7, 0.16, 2.3], [1.9, 0.44, 0.58, 0.22, 2.2], [3.0, 0.31, 0.44, 0.3, 2.1], [4.2, 0.2, 0.32, 0.4, 2], [5.1, 0.1, 0.2, 0.5, 2], [5.25, 0.05, 0.12, 0.52, 2]],
      glass: [[-1.82, -1.12, 150, 210, false], [-1.45, 0.55, 98, 132], [0.5, 1.15, 138, 222, false]],
      colAt: (z, th, c) => (z < -2.5 ? c.trim : th > 302 || th < 58 ? c.belly : c.body),
      stripes: [{ keys: [[-1.9, 78, 92], [-0.2, 78, 92], [2.4, 82, 92], [5.15, 90, 96]], col: hex('#1f5fb5') }, { keys: [[-1.9, 96, 100], [2.4, 94, 97]], col: hex('#6aa3e8') }],
      wing: { y: 1.05, dih: 1.5, secs: [[0, -1.78, 1.6, 0.13], [3.6, -1.78, 1.5, 0.12], [5.6, -1.6, 1.0, 0.1]], flap: [0.6, 2.8, 0.72], ail: [3.1, 5.2, 0.74], col: '#f6f7fa', colB: '#e9ecf1' },
      fin: { z: 3.75, cr: 1.5, ct: 0.75, h: 1.5, sweep: 38, y: 0.5, col: '#f6f7fa' }, stab: { z: 3.95, y: 0.52, cr: 1.1, ct: 0.7, semi: 2.0, sweep: 6, dih: 0 },
      logo: [{ pts: [[0.45, 0.2], [0.45, 0.5], [0.82, 0.55], [0.82, 0.3]], col: hex('#1f5fb5') }],
      prop: { n: 2, R: 1.05, spin: '#1f5fb5' }, propAt: [0, -0.11, -3.1], landLight: [0, -0.25, -3.0], beaconZ: 4.0, dorsal: null,
      extra(W, K) {
        // Wing struts from the fuselage to the wing, a jury strut, and the fixed tricycle gear on spring-steel legs.
        for (const sg of [-1, 1]) {
          rod(W.b, [sg * 0.58, -0.4, -0.95], [sg * 2.6, 1.05, -1.0], 0.04, 0.035, [0.9, 0.9, 0.93], 6);
          fixedWheel(W, sg * 0.5, -0.5, -0.78, sg * 1.12, 0.27, 0.16, { pant: true, col: hex('#f0f2f6'), r: 0.05, dz: -0.1 });
        }
        fixedNose(W, 0, -0.45, -2.2, -2.4, 0.23, 0.12, { pant: false });
        revolveZ(W.b, [0, -0.62, -2.9], [[0, 0.05, [0.1, 0.1, 0.12]], [0.25, 0.2, [0.1, 0.1, 0.12]], [0.5, 0.0, [0.1, 0.1, 0.12]]], 8);    // air intake scoop under the cowl
      } },
    pa28: { body: '#f2f3f5', belly: '#e8eaee', trim: '#c0392b', accent: '#c0392b',
      rings: [[-3.0, 0.07, 0.09, -0.12, 2], [-2.92, 0.3, 0.3, -0.1, 2.2], [-2.55, 0.5, 0.46, -0.07, 2.3], [-2.1, 0.56, 0.54, -0.02, 2.3], [-1.6, 0.6, 0.62, 0.05, 2.4], [-1.1, 0.64, 0.7, 0.1, 2.4], [-0.1, 0.64, 0.7, 0.12, 2.4], [1.0, 0.56, 0.62, 0.15, 2.3], [2.0, 0.42, 0.52, 0.2, 2.2], [3.1, 0.3, 0.42, 0.28, 2.1], [4.2, 0.2, 0.32, 0.36, 2], [4.85, 0.1, 0.2, 0.45, 2], [5.0, 0.05, 0.12, 0.47, 2]],
      glass: [[-1.5, -0.85, 148, 212, false], [-1.2, 0.7, 98, 134], [0.55, 1.2, 140, 220, false]],
      colAt: (z, th, c) => (z < -2.4 ? c.trim : th > 302 || th < 58 ? c.belly : c.body),
      stripes: [{ keys: [[-1.8, 76, 92], [-0.2, 76, 92], [2.6, 80, 92], [4.95, 90, 96]], col: hex('#c0392b') }, { keys: [[-1.8, 94, 98], [2.6, 94, 96.5]], col: hex('#2c3e50') }],
      wing: { y: -0.6, dih: 2.5, secs: [[0, -0.55, 1.65, 0.14], [5.4, -0.55, 1.5, 0.11]], flap: [0.7, 2.4, 0.72], ail: [2.7, 5.0, 0.72], col: '#f2f3f5', colB: '#dfe2e7' },
      fin: { z: 3.55, cr: 1.5, ct: 0.7, h: 1.45, sweep: 36, y: 0.35, col: '#f2f3f5' }, stab: { z: 4.0, y: 0.1, cr: 1.0, ct: 0.75, semi: 2.2, sweep: 2, dih: 0, allMoving: true },
      logo: [{ pts: [[0.3, 0.25], [0.3, 0.55], [0.8, 0.5], [0.8, 0.22]], col: hex('#c0392b') }],
      prop: { n: 2, R: 1.0, spin: '#c0392b' }, propAt: [0, -0.1, -3.05], landLight: [0, -0.3, -2.9], beaconZ: 4.0,
      extra(W, K) {
        for (const sg of [-1, 1]) fixedWheel(W, sg * 0.9, -0.85, -0.4, sg * 1.05, 0.27, 0.15, { r: 0.055, legCol: [0.75, 0.77, 0.8] });
        fixedNose(W, 0, -0.55, -2.35, -2.42, 0.22, 0.12, { r: 0.05, legCol: [0.75, 0.77, 0.8] });
      } },
    sr22: { body: '#f4f6f8', belly: '#e1e5ea', trim: '#2a2f38', accent: '#d0402a',
      rings: [[-3.2, 0.06, 0.08, -0.1, 2], [-3.12, 0.28, 0.28, -0.09, 2.1], [-2.7, 0.46, 0.44, -0.06, 2.2], [-2.2, 0.55, 0.54, -0.02, 2.3], [-1.6, 0.6, 0.66, 0.05, 2.3], [-0.9, 0.64, 0.76, 0.1, 2.2], [0.0, 0.62, 0.74, 0.14, 2.2], [1.0, 0.54, 0.62, 0.18, 2.2], [2.1, 0.4, 0.5, 0.24, 2.1], [3.2, 0.28, 0.4, 0.31, 2], [4.2, 0.18, 0.3, 0.38, 2], [4.9, 0.09, 0.19, 0.46, 2], [5.05, 0.04, 0.1, 0.48, 2]],
      glass: [[-1.75, -0.7, 152, 208, false], [-1.4, 0.6, 96, 134], [0.35, 1.05, 142, 218, false]],
      colAt: (z, th, c) => (z < -2.35 ? hex('#2a2f38') : th > 300 || th < 60 ? c.belly : c.body),
      stripes: [{ keys: [[-2.4, 70, 86], [0.2, 70, 86], [2.8, 82, 92], [5.0, 90, 96]], col: hex('#d0402a') }, { keys: [[-2.4, 88, 92], [2.8, 92, 94.5]], col: hex('#2a2f38') }],
      wing: { y: -0.4, dih: 3, secs: [[0, -0.7, 1.55, 0.13], [2.2, -0.62, 1.4, 0.12], [5.6, -0.2, 0.95, 0.09]], flap: [0.7, 2.7, 0.72], ail: [3.0, 5.3, 0.74], col: '#f4f6f8', colB: '#dde1e7' },
      fin: { z: 3.5, cr: 1.55, ct: 0.7, h: 1.6, sweep: 40, y: 0.35, col: '#f4f6f8' }, stab: { z: 3.95, y: 0.2, cr: 1.0, ct: 0.62, semi: 1.95, sweep: 12, dih: 2 },
      logo: [{ pts: [[0.35, 0.15], [0.35, 0.4], [0.8, 0.62], [0.8, 0.36]], col: hex('#d0402a') }, { pts: [[0.12, 0.3], [0.12, 0.5], [0.3, 0.55], [0.3, 0.3]], col: hex('#2a2f38') }],
      prop: { n: 3, R: 0.98, spin: '#2a2f38', tip: [0.85, 0.85, 0.88] }, propAt: [0, -0.1, -3.2], landLight: [0.9, -0.38, -0.65], beaconZ: 4.1,
      extra(W, K) {
        for (const sg of [-1, 1]) fixedWheel(W, sg * 0.45, -0.5, -0.6, sg * 1.15, 0.26, 0.15, { pant: true, col: hex('#f4f6f8'), r: 0.05, dz: 0 });
        fixedNose(W, 0, -0.5, -2.25, -2.35, 0.22, 0.12, { pant: true, col: hex('#f4f6f8') });
      } },
    pc12: { body: '#f5f6f8', belly: '#dfe3e8', trim: '#1c2f58', accent: '#c9a24a',
      rings: [[-4.0, 0.06, 0.08, -0.1, 2], [-3.92, 0.27, 0.27, -0.1, 2.1], [-3.5, 0.42, 0.42, -0.07, 2.2], [-3.0, 0.5, 0.52, -0.03, 2.3], [-2.4, 0.54, 0.6, 0.02, 2.4], [-1.8, 0.56, 0.68, 0.06, 2.5], [-1.1, 0.57, 0.72, 0.08, 2.6], [1.7, 0.57, 0.72, 0.08, 2.6], [2.6, 0.5, 0.64, 0.14, 2.4], [3.5, 0.35, 0.5, 0.26, 2.2], [4.1, 0.2, 0.34, 0.4, 2.1], [4.5, 0.08, 0.2, 0.5, 2], [4.6, 0.04, 0.12, 0.52, 2]],
      glass: [[-1.9, -1.15, 150, 210, false], [-1.6, -1.05, 108, 140], [-0.95, 1.55, 91, 106]],
      colAt: (z, th, c) => (z < -3.3 ? hex('#c0c5cc') : th > 300 || th < 60 ? c.belly : c.body),
      stripes: [{ keys: [[-3.2, 70, 84], [0.0, 70, 84], [2.8, 78, 90], [4.55, 90, 96]], col: hex('#1c2f58') }, { keys: [[-3.2, 85, 88.5], [2.8, 91, 93]], col: hex('#c9a24a') }],
      paintPatches: [[1.8, 2.1, 80, 110, [0.2, 0.22, 0.27]]],
      wing: { y: -0.42, dih: 2, secs: [[0, -0.95, 1.55, 0.14], [1.9, -0.95, 1.5, 0.13], [5.1, -0.62, 0.95, 0.1]], flap: [0.7, 2.6, 0.72], ail: [2.95, 4.9, 0.75], col: '#f5f6f8', colB: '#e0e4e9' },
      fin: { z: 2.4, cr: 2.0, ct: 0.85, h: 2.0, sweep: 40, y: 0.5, col: '#1c2f58' }, stab: { z: 3.1, y: 0.35, cr: 1.0, ct: 0.55, semi: 1.85, sweep: 12, dih: 3 },
      dorsal: { len: 1.5, h: 0.5 }, logo: [{ pts: [[0.25, 0.2], [0.25, 0.5], [0.7, 0.5], [0.7, 0.2]], col: hex('#c9a24a') }],
      prop: { n: 4, R: 1.15, spin: '#c0c5cc', tip: [0.9, 0.9, 0.92] }, propAt: [0, -0.1, -4.02], landLight: [1.4, -0.4, -0.95], beaconZ: 3.0,
      extra(W, K) {
        // Exhaust stubs on the cowl, the intake under the nose, the cargo door and the retractable gear.
        for (const sg of [-1, 1]) { rod(W.b, [sg * 0.52, 0.0, -3.0], [sg * 0.6, 0.12, -2.55], 0.05, 0.04, [0.2, 0.2, 0.22], 6); mainLegPc(W, sg); }
        revolveZ(W.b, [0, -0.5, -3.35], [[0, 0.04, [0.1, 0.1, 0.12]], [0.3, 0.2, [0.25, 0.26, 0.3]], [0.8, 0.24, [0.25, 0.26, 0.3]], [1.1, 0.0, [0.25, 0.26, 0.3]]], 8);
        outline(W.b, K.rings, 1.0, 1.65, 62, 118, [0.45, 0.47, 0.52], 0.014);
        noseLeg(W, 0, -0.55, -2.45, W.spec.gear, 0.2, 0.11, 1, true, 0.045);
      } },
  };
  function mainLegPc(W, sg) { mainLeg(W, sg * 1.05, -0.55, -0.4, W.spec.gear, 0.25, 0.14, [0], 1, true, 0.05); }

  // ---- the stealth fighter: a blended, faceted fuselage, trapezoid wings, twin canted fins and all-moving tail planes
  function fighterBuild(P, S) {
    const b = new Builder(), W = { b, dyn: [], gears: [], lights: [], fans: [], spec: P }, C = hex, tan = (d) => Math.tan(d * DEG);
    const grey = C('#9ba2ad'), grey2 = C('#838a95'), grey3 = C('#6f7681'), radome = C('#555b65'), dark = [0.07, 0.07, 0.08];
    const rings = [[-5.3, 0.03, 0.03, -0.02, 2], [-5.15, 0.2, 0.16, -0.04, 2.4], [-4.5, 0.44, 0.31, -0.05, 2.7], [-3.5, 0.66, 0.45, 0.0, 2.9], [-2.5, 0.82, 0.56, 0.04, 3.1], [-1.1, 0.95, 0.6, 0.07, 3.2],
      [0.6, 0.96, 0.57, 0.08, 3.2], [2.1, 0.84, 0.52, 0.1, 3.0], [3.5, 0.64, 0.44, 0.11, 2.7], [4.4, 0.52, 0.4, 0.11, 2.4], [4.88, 0.47, 0.38, 0.11, 2.1]].map(([z, w, h, cy, e]) => ({ z, w, h, cy, e }));
    loftRings(b, rings, (z, th) => (z < -4.6 ? radome : z > 4.4 ? grey3 : th > 295 || th < 65 ? grey2 : ((Math.floor(z * 1.7) + Math.floor(th / 30)) % 3 === 0 ? grey2 : grey)), 18);
    // Panel lines and the dark inlets on the sides.
    patch(b, rings, -2.85, -1.55, 52, 118, [0.06, 0.06, 0.07], 0.02); patch(b, rings, -2.85, -1.55, 242, 308, [0.06, 0.06, 0.07], 0.02);
    outline(b, rings, -2.9, -1.5, 48, 122, grey3, 0.03);
    for (const [z0, z1, t0, t1] of [[-0.9, 1.4, 150, 172], [-0.9, 1.4, 188, 210], [1.7, 3.2, 160, 200]]) patch(b, rings, z0, z1, t0, t1, grey3, 0.012);
    // Canopy.
    const can = [[-3.35, 0.04, 0.03, 0.5], [-3.0, 0.3, 0.2, 0.6], [-2.4, 0.43, 0.29, 0.66], [-1.5, 0.43, 0.3, 0.66], [-0.8, 0.3, 0.2, 0.6], [-0.4, 0.06, 0.04, 0.53]].map(([z, w, h, cy]) => ({ z, w, h, cy, e: 2 }));
    loftRings(b, can, (z) => (z < -3.2 ? grey3 : [0.26, 0.22, 0.14]), 14);
    // ---- wings: swept, thin, with flaperons and ailerons
    const semi = P.span, wings = {}, wsecs = [{ s: 0, le: -1.65, c: 3.95, th: 0.05 }, { s: semi, le: -1.65 + semi * tan(35), c: 0.9, th: 0.04 }];
    for (const side of [-1, 1]) {
      const cs = [{ kind: 'flaperon', s0: 1.0, s1: 2.15, c0: 0.7, side }, { kind: 'aileron', s0: 2.2, s1: 3.35, c0: 0.72, side }];
      wings[side] = wingBuild(W, wingFrame(side, -0.1, -1), wsecs, { col: grey, colB: grey2, cs, camber: 0.008 });
    }
    // ---- tail: twin canted fins with rudders, all-moving tailplanes
    const fsecs = [{ s: 0, le: 1.9, c: 1.8, th: 0.05 }, { s: 1.6, le: 1.9 + 1.6 * tan(42), c: 0.75, th: 0.04 }];
    for (const side of [-1, 1]) {
      const fb = wingBuild(W, finFrame(side * 0.42, 0.28, 20, side), fsecs, { col: grey, colB: grey, cs: [{ kind: 'rudder', s0: 0.1, s1: 1.55, c0: 0.64, axisUp: true }] });
      polyFan(b, [fb.pt(1.0, 0.25, 1, 0.012), fb.pt(1.0, 0.55, 1, 0.012), fb.pt(1.35, 0.5, 1, 0.012), fb.pt(1.35, 0.22, 1, 0.012)].map((p) => p), [1, 0, 0], C('#d6b13a'));
      polyFan(b, [fb.pt(1.0, 0.25, -1, 0.012), fb.pt(1.0, 0.55, -1, 0.012), fb.pt(1.35, 0.5, -1, 0.012), fb.pt(1.35, 0.22, -1, 0.012)], [-1, 0, 0], C('#d6b13a'));
      wingBuild(W, wingFrame(side, 0.06, -3, 0.5), [{ s: 0, le: 2.75, c: 1.75, th: 0.05 }, { s: 1.55, le: 2.75 + 1.55 * tan(40), c: 0.6, th: 0.04 }], { col: grey, colB: grey2, cs: [{ kind: 'stab', s0: 0, s1: 1.55, c0: 0, h: 0.3, side }], camber: 0.004 });
    }
    // ---- engine nozzle, with a dark, hot-looking bore
    const nz = [0, 0.11, 4.85];
    revolveZ(b, nz, [[-0.45, 0.47, grey3], [-0.1, 0.45, [0.3, 0.3, 0.33]], [0.12, 0.4, [0.2, 0.2, 0.22]], [0.2, 0.37, dark]], 16);
    revolveZ(b, nz, [[0.2, 0.37, dark], [0.0, 0.2, [0.12, 0.08, 0.06]], [-0.15, 0.0, dark]], 12);
    const sP = [0, 1].map((k) => { const pts = []; for (let i = 0; i < 18; i++) { const a = (i / 18) * Math.PI * 2, rr = k ? 0.4 : 0.44; pts.push([Math.cos(a) * rr, nz[1] + Math.sin(a) * rr, nz[2] + (k ? 0.2 + (i % 2 ? 0.12 : 0) : 0.0)]); } return pts; });
    gridMesh(b, sP, [0.28, 0.28, 0.31], { closed: true, refs: [[0, nz[1], nz[2]], [0, nz[1], nz[2] + 0.2]] });
    // ---- undercarriage
    const wr = 0.27, ww = 0.17;
    for (const side of [-1, 1]) mainLeg(W, side * 1.02, -0.35, 0.5, P.gear, wr, ww, [0], 1, true, 0.07);
    noseLeg(W, 0, -0.4, -3.1, P.gear, wr * 0.8, ww * 0.8, 2, true, 0.055);
    // ---- lights
    for (const side of [-1, 1]) {
      addLight(W, side < 0 ? 'navR' : 'navG', add(wings[side].pt(semi, 0.5, 1), [side * 0.03, 0.03, 0]), 0.05);
      addLight(W, 'strobe', add(wings[side].pt(semi, 0.9, 1), [0, 0.04, 0.03]), 0.05);
      addLight(W, 'strobe', [side * 1.0, 1.7, 3.6], 0.045);
    }
    addLight(W, 'navW', [0, 0.52, 4.9], 0.045); addLight(W, 'beacon', [0, 0.72, 1.6], 0.05); addLight(W, 'beacon', [0, -0.5, -1.0], 0.05);
    addLight(W, 'land', [0.0, -0.45, -3.2], 0.06); addLight(W, 'taxi', [0.0, -0.5, -2.9], 0.045);
    // The afterburner: a flame, and the shock diamonds in it.
    const flame = new Builder(), dia = new Builder();
    revolveZ(flame, [0, 0, 0], [[0, 0.4, [1, 0.5, 0.12]], [1.0, 0.33, [1, 0.42, 0.1]], [2.1, 0.2, [1, 0.3, 0.1]], [3.2, 0.0, [1, 0.25, 0.1]]], 12);
    revolveZ(flame, [0, 0, 0], [[0.1, 0.3, [1, 0.85, 0.5]], [1.2, 0.2, [1, 0.8, 0.4]], [2.3, 0.0, [1, 0.7, 0.3]]], 10);
    for (let k = 0; k < 5; k++) revolveZ(dia, [0, 0, 0], [[0.45 + k * 0.5, 0, [1, 1, 1]], [0.65 + k * 0.5, 0.2 - k * 0.025, [0.85, 0.92, 1]], [0.85 + k * 0.5, 0, [1, 1, 1]]], 8);
    return { body: b, dyn: W.dyn, gears: W.gears, lights: W.lights, fans: [], flame: { at: nz[0] === 0 ? [0, nz[1], nz[2] + 0.25] : nz, mesh: flame, diamonds: dia } };
  }

  /// Builds one aircraft's meshes: { body, dyn (control surfaces), gears, lights, fans, prop, disc, propAt, flame }.
  function buildPlane(id) {
    const P = PLANES.find((p) => p.id === id);
    if (LINERS[id]) return linerBuild(P, LINERS[id]);
    if (GA[id]) return gaBuild(P, GA[id]);
    if (id === 'f35') return fighterBuild(P, {});
    return { body: new Builder(), dyn: [], gears: [], lights: [], fans: [] };
  }
  // ---- AIRCRAFT MODELS END




  // ------------------------------------------------------------------ the world

  const RUNWAY = { x: 0, z0: 0, z1: -1400, half: 22 };   // the main runway runs from z = 0 towards -z
  /// A second, shorter strip on a plateau in the hills.
  const RIDGE = { x: -2300, z0: 1250, z1: 550, half: 16, y: 120 };
  /// The ground is a heightfield of TCELL-metre cells cut into TCHUNK x TCHUNK-cell chunks, which are generated, meshed
  /// (at four levels of detail) and planted with trees on demand as the plane flies. Water is the surface at WATER.
  const TCELL = 32, TCHUNK = 32, TCS = TCELL * TCHUNK, WORLD = 12288, WATER = -2;
  const TNC = (WORLD * 2) / TCS, TN = TNC * TCHUNK;        // chunks / cells along one side of the world
  const VALLEY = [0, -700];                                // the middle of the valley the airfield sits in
  const LAKE = { x: -1500, z: -2200, r: 520 };
  /// The river runs from the lake into the mountains, where it has cut a canyon.
  const RIVER = [[-1500, -2200], [-2600, -3400], [-3500, -4700], [-4100, -6400], [-4300, -8800]];
  /// A second, gentle river leaves the lake and winds across the plain to the sea in the south.
  const RIVER2 = [[-1500, -2200], [-1250, -1500], [-1000, -600], [-1150, 400], [-950, 1500], [-1200, 2600], [-900, 3600], [-1000, 4700], [-1050, 6200]];
  const BRIDGE = { x: -2050, z: -2800 };
  /// Places kept perfectly level: [centre x, centre z, half width, half depth] (airfield, town, three villages, the city).
  const FLATS = [[0, -700, 160, 960], [1250, -1350, 450, 550], [600, 1300, 240, 240], [-300, 2800, 240, 240], [2300, -250, 240, 240], [2900, 3100, 560, 560]];
  const CITY = { x: 2900, z: 3100 };
  const ROADS = [
    [[160, -660], [300, -730], [560, -850], [780, -1000], [850, -1100]],                 // airfield to the town
    [[160, -660], [190, -200], [240, 300], [420, 800], [600, 1300]],                     // airfield to the first village
    [[600, 1300], [400, 1900], [100, 2400], [-300, 2800]],                              // on to the second village
    [[1700, -1000], [2000, -700], [2300, -250]],                                         // town to the east village
    [[600, 1300], [1200, 1800], [1900, 2400], [2500, 2900], [2900, 3100]],               // first village to the city
  ];
  /// The sun is mid-morning, south-east; the haze is what distant things fade to and what the sky is at the horizon.
  const SUN = norm([0.5, 0.64, 0.36]), HAZE = [0.72, 0.81, 0.91];

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
  const polyDist = (x, z, P) => { let d = Infinity; for (let i = 0; i < P.length - 1; i++) d = Math.min(d, distSeg(x, z, P[i], P[i + 1])); return d; };
  const riverDist = (x, z) => polyDist(x, z, RIVER);
  const roadDist = (x, z) => { let d = Infinity; for (const r of ROADS) d = Math.min(d, polyDist(x, z, r)); return d; };
  const smin = (a, b, k) => { const h = Math.max(k - Math.abs(a - b), 0); return Math.min(a, b) - h * h / (4 * k); };
  const rectDist = (x, z, f) => Math.hypot(Math.max(Math.abs(x - f[0]) - f[2], 0), Math.max(Math.abs(z - f[1]) - f[3], 0));
  const flatDist = (x, z) => { let d = Infinity; for (const f of FLATS) d = Math.min(d, rectDist(x, z, f)); return d; };

  /// The terrain's shape before it is sampled into the grid: level ground for the airfield, towns and villages; foothills
  /// and ridged, eroded mountains (warped so nothing lines up) rising round the valley; a coastal plain falling to a sea
  /// in the south; a plateau for the second strip; the lake, a canyon river in the mountains and a gentle one to the sea.
  function terrainShape(x, z) {
    const d = Math.hypot(x - VALLEY[0], z - VALLEY[1]);
    const wx = x + (fbm(x / 1300 + 5.2, z / 1300 + 1.3, 3) - 0.5) * 900, wz = z + (fbm(x / 1300 + 8.1, z / 1300 + 4.7, 3) - 0.5) * 900;
    const plain = smooth(150, 1500, z) * smooth(-2700, -1500, x) * (1 - smooth(2700, 4200, x));   // the coastal plain
    let h = (fbm(wx / 1000, wz / 1000, 5) - 0.34) * 300 * smooth(1300, 2300, d) * (1 - plain * 0.8);   // foothills
    h = Math.max(h, 0) + fbm(x / 420 + 20, z / 420 - 9, 3) * 9;                                    // soft undulations
    const mt = smooth(2700, 4600, d) * (1 - plain * 0.85);
    if (mt > 0.002) {                                                                              // the mountains
      h += (ridged(wx / 1700, wz / 1700) + (fbm(wx / 2600 + 3, wz / 2600 + 9, 3) - 0.3) * 0.5) * 1900 * (0.7 + 0.6 * smooth(4600, 8000, d)) * mt;
      const cr = 1 - Math.abs(fbm(wx / 650 + 13, wz / 650 + 2, 4) * 2 - 1);                         // drainage creases
      h -= cr * cr * cr * 170 * mt;
    }
    h = Math.max(h, 0);
    const zc = 4500 + (fbm(x / 2400 + 40, 7.3, 3) - 0.5) * 1500 + (fbm(x / 650 + 3, z / 650, 2) - 0.5) * 260;   // the coast
    const cw = smooth(zc - 2200, zc - 300, z);
    h = Math.max(h + (smin(h, -2 + (zc - z) * 0.02, 10) - h) * cw, -70);
    const pd = Math.hypot(x - RIDGE.x, z - (RIDGE.z0 + RIDGE.z1) / 2);
    h += (RIDGE.y - h) * (1 - smooth(420, 720, pd));                                               // the plateau
    h = Math.min(h, 14 + 4000 * smooth(110, 1600, Math.hypot(x - BRIDGE.x, z - BRIDGE.z)));          // low banks at the bridge
    const ld = Math.hypot(x - LAKE.x, z - LAKE.z) * (1 + (fbm(x / 380 + 50, z / 380, 2) - 0.5) * 0.45);
    h += (-6 - 14 * (1 - smooth(0, LAKE.r, ld)) - h) * (1 - smooth(LAKE.r - 160, LAKE.r + 80, ld));   // the lake
    const rd = riverDist(x, z), wide = 150 + 170 * smooth(2600, 4800, d);                           // the canyon: wide enough to fly
    h += (-10 - h) * (1 - smooth(wide * 0.45, wide, rd));
    if (h > -5) {                                                                                  // the lowland river, with banks
      const r2 = polyDist(x, z, RIVER2) + (vnoise(x / 160, z / 160) - 0.5) * 40;
      h = -5 + (h + 5) * smooth(10, 110, Math.max(r2, 0));
    }
    h *= smooth(0, 220, flatDist(x, z));                                                           // keep the built-up places level
    const edge = Math.max(Math.abs(x), Math.abs(z));
    h += (-45 - h) * smooth(WORLD - 3300, WORLD - 1500, edge);                                      // an island: sea all round
    return Math.max(h, -70);
  }

  // ---- the heightfield, generated chunk by chunk as it is needed

  const chunkOf = (world, ci, cj) => world.chunks[cj * TNC + ci] || (world.chunks[cj * TNC + ci] = {
    ci, cj, x0: -WORLD + ci * TCS, z0: -WORLD + cj * TCS, H: null, lod: [null, null, null, null], obj: false, near: null, far: null, ymin: null, ymax: null });
  /// The (TCHUNK + 1)² grid of heights of one chunk, shared edges included (computed on first use).
  function chunkHeights(world, c) {
    if (!c.H) {
      const row = TCHUNK + 1, H = new Float32Array(row * row);
      for (let j = 0; j < row; j++) for (let i = 0; i < row; i++) H[j * row + i] = terrainShape(c.x0 + i * TCELL, c.z0 + j * TCELL);
      c.H = H;
    }
    return c.H;
  }
  /// The height at a vertex of the global grid (clamped to the world), from the chunk's cache if it has one.
  function gridHeight(world, gi, gj) {
    gi = gi < 0 ? 0 : gi > TN ? TN : gi; gj = gj < 0 ? 0 : gj > TN ? TN : gj;
    const ci = Math.min((gi / TCHUNK) | 0, TNC - 1), cj = Math.min((gj / TCHUNK) | 0, TNC - 1), c = world.chunks[cj * TNC + ci];
    if (c && c.H) return c.H[(gj - cj * TCHUNK) * (TCHUNK + 1) + gi - ci * TCHUNK];
    return terrainShape(-WORLD + gi * TCELL, -WORLD + gj * TCELL);
  }
  /// The unit surface normal of the ground at (x, z).
  function normalAt(world, x, z, e = 8) {
    return norm([terrainAt(world, x - e, z) - terrainAt(world, x + e, z), 2 * e, terrainAt(world, x, z - e) - terrainAt(world, x, z + e)]);
  }
  /// Register a solid box with the coarse grid the plane is tested against.
  function addSolid(world, min, max, kind) {
    const c = { min, max, kind };
    world.colliders.push(c);
    for (let gx = Math.floor(min[0] / 200); gx <= Math.floor(max[0] / 200); gx++) for (let gz = Math.floor(min[2] / 200); gz <= Math.floor(max[2] / 200); gz++) {
      const k = `${gx},${gz}`; if (!world.grid.has(k)) world.grid.set(k, []); world.grid.get(k).push(c);
    }
  }

  // ---- what grows and is painted where

  const GC = { grass: hex('#5b9a3b'), grass2: hex('#78a843'), dry: hex('#aaa55a'), forest: hex('#38632b'), alp: hex('#80905a'), rock: hex('#7d7569'), rock2: hex('#6c7170'),
    sand: hex('#d6c493'), wet: hex('#a8956c'), bed: hex('#7f9a84') };
  const mix3 = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
  /// 1 near the sea, the lake and the rivers (where low ground is beach), 0 inland.
  const shoreNear = (x, z) => Math.max(smooth(3200, 3600, z), 1 - smooth(LAKE.r + 100, LAKE.r + 450, Math.hypot(x - LAKE.x, z - LAKE.z)), 1 - smooth(150, 400, Math.min(riverDist(x, z), polyDist(x, z, RIVER2))));
  /// Trees don't grow on bare ground, steep rock, high up, on the beach or in the water.
  const forestBase = (x, z, y) => smooth(0.46, 0.60, fbm(x / 800 + 11, z / 800 - 7, 3)) * (1 - smooth(480, 760, y + (vnoise(x / 150, z / 150) - 0.5) * 120)) * (0.45 + 0.55 * smooth(6, 40, y));
  const forestP = (x, z, y, ny) => (y < WATER + 1.5 || (y < WATER + 3.8 && shoreNear(x, z) > 0.4) ? 0 : forestBase(x, z, y) * smooth(0.72, 0.86, ny));
  /// Things that keep the trees off: airfields, towns, roads, the bridge, the mast, turbines, pylons, the lighthouse.
  function blocked(world, x, z) {
    if (flatDist(x, z) < 24 || roadDist(x, z) < 14) return true;
    if (Math.hypot(x - RIDGE.x, z - 900) < 470 || Math.hypot(x - BRIDGE.x, z - BRIDGE.z) < 260) return true;
    for (const k of world.keep) if (Math.hypot(x - k[0], z - k[1]) < k[2]) return true;
    return false;
  }
  /// How much of the ground here is patchwork farmland (0..1): flat, low, dry land away from the built-up places.
  function farmAt(world, x, z, y, ny) {
    if (y < WATER + 5 || y > 90 || ny < 0.955) return 0;
    const f = smooth(0.50, 0.60, fbm(x / 1500 + 60, z / 1500 - 30, 3)) * (1 - smooth(25, 90, y));
    return f > 0.01 && !blocked(world, x, z) ? f : 0;
  }
  /// The base colour of the ground at a vertex (snow, fields and fine detail are added per pixel); out = [r, g, b, farmland].
  function groundColour(world, x, y, z, ny, out) {
    const n1 = vnoise(x / 260 + 3, z / 260), moist = fbm(x / 1100 + 70, z / 1100 - 30, 3);
    let c = mix3(GC.grass, GC.grass2, smooth(0.35, 0.7, n1));
    c = mix3(GC.dry, c, smooth(0.30, 0.56, moist));
    c = mix3(c, GC.alp, smooth(450, 900, y + (n1 - 0.5) * 160));
    const f = forestP(x, z, y, ny);
    if (f > 0) c = mix3(c, GC.forest, Math.min(f * 1.3, 1) * 0.85);
    const rk = Math.max(smooth(0.82, 0.66, ny), smooth(900, 1400, y + (n1 - 0.5) * 200) * 0.7);
    c = mix3(c, mix3(GC.rock, GC.rock2, vnoise(x / 140, z / 140)), rk);
    const beach = smooth(WATER + 4.5, WATER + 1.0, y + (vnoise(x / 70, z / 70) - 0.5) * 1.6) * shoreNear(x, z);
    c = mix3(c, mix3(GC.wet, GC.sand, smooth(WATER, WATER + 1.4, y)), beach);
    if (y < WATER) c = mix3(GC.sand, GC.bed, smooth(0, 14, WATER - y));
    out[0] = c[0]; out[1] = c[1]; out[2] = c[2]; out[3] = farmAt(world, x, z, y, ny);
  }

  // ---- ground meshes: four levels of detail per chunk, welded with skirts

  const BORDER = [];
  /// The vertices round the edge of an m x m grid, in order (the skirt hangs from these).
  function borderLoop(m) {
    if (BORDER[m]) return BORDER[m];
    const row = m + 1, loop = [];
    for (let i = 0; i < m; i++) loop.push(i);
    for (let j = 0; j < m; j++) loop.push(j * row + m);
    for (let i = m; i > 0; i--) loop.push(m * row + i);
    for (let j = m; j > 0; j--) loop.push(j * row);
    return (BORDER[m] = loop);
  }
  const LODX = [];
  /// Shared triangle indices for LOD L: the grid (first `grid` indices; these are also the water's) then the skirt.
  function lodIndices(L) {
    if (LODX[L]) return LODX[L];
    const m = TCHUNK >> L, row = m + 1, idx = [], loop = borderLoop(m), V = row * row;
    for (let j = 0; j < m; j++) for (let i = 0; i < m; i++) { const a = j * row + i, b = a + 1, c = a + row, d = c + 1; idx.push(a, b, c, b, d, c); }
    const grid = idx.length;
    for (let t = 0; t < loop.length; t++) { const u = (t + 1) % loop.length; idx.push(loop[t], loop[u], V + t, loop[u], V + u, V + t); }
    return (LODX[L] = { data: new Uint16Array(idx), grid });
  }
  /// Vertex data for one level of detail of one chunk: 20 bytes a vertex (position, packed normal + occlusion, colour + farmland),
  /// then the skirt; and the water sheet over it (x, y, z, depth) when any of the ground is under water.
  function buildChunkMesh(world, c, L) {
    const s = 1 << L, m = TCHUNK >> L, ox = c.ci * TCHUNK, oz = c.cj * TCHUNK, ext = m + 3, row = m + 1;
    if (L === 0) chunkHeights(world, c);
    const hs = new Float32Array(ext * ext);
    for (let jj = 0; jj < ext; jj++) for (let ii = 0; ii < ext; ii++) hs[jj * ext + ii] = gridHeight(world, ox + (ii - 1) * s, oz + (jj - 1) * s);
    const total = row * row + 4 * m, buf = new ArrayBuffer(total * 20), f32 = new Float32Array(buf), u32 = new Uint32Array(buf), i8 = new Int8Array(buf), u8 = new Uint8Array(buf);
    const wbuf = new Float32Array(row * row * 4), out = [0, 0, 0, 0], sp = 2 * s * TCELL;
    let wet = false, ymin = 1e9, ymax = -1e9;
    for (let jj = 0; jj <= m; jj++) for (let ii = 0; ii <= m; ii++) {
      const k = jj * row + ii, q = (jj + 1) * ext + ii + 1, h = hs[q], hE = hs[q + 1], hW = hs[q - 1], hS = hs[q + ext], hN = hs[q - ext];
      const x = -WORLD + (ox + ii * s) * TCELL, z = -WORLD + (oz + jj * s) * TCELL;
      let nx = hW - hE, ny = sp, nz = hN - hS; const nl = Math.hypot(nx, ny, nz); nx /= nl; ny /= nl; nz /= nl;
      const cr = ((hE + hW + hS + hN) / 4 - h) / (s * TCELL);
      const ao = clamp(1 - clamp(cr * 3.2, 0, 0.45) + clamp(-cr * 1.2, 0, 0.1), 0, 1);
      groundColour(world, x, h, z, ny, out);
      const o = k * 20;
      f32[k * 5] = x; f32[k * 5 + 1] = h; f32[k * 5 + 2] = z;
      i8[o + 12] = Math.round(nx * 127); i8[o + 13] = Math.round(ny * 127); i8[o + 14] = Math.round(nz * 127); i8[o + 15] = Math.round(ao * 127);
      u8[o + 16] = Math.round(out[0] * 255); u8[o + 17] = Math.round(out[1] * 255); u8[o + 18] = Math.round(out[2] * 255); u8[o + 19] = Math.round(out[3] * 255);
      wbuf[k * 4] = x; wbuf[k * 4 + 1] = WATER; wbuf[k * 4 + 2] = z; wbuf[k * 4 + 3] = WATER - h;
      if (h < WATER) wet = true;
      if (h < ymin) ymin = h; if (h > ymax) ymax = h;
    }
    const loop = borderLoop(m), depth = s * TCELL * 0.5 + 8;
    for (let t = 0; t < loop.length; t++) {
      const a = loop[t], d = row * row + t;
      for (let w = 0; w < 5; w++) u32[d * 5 + w] = u32[a * 5 + w];
      f32[d * 5 + 1] -= depth;
    }
    return { buf, wbuf: wet ? wbuf : null, ymin, ymax };
  }

  // ---- trees and hedgerows, planted chunk by chunk

  const TREE_COL = { conifer: [hex('#2c5a2e'), hex('#356b34'), hex('#244c2a')], broad: [hex('#4f8a35'), hex('#5e9a3a'), hex('#437a30'), hex('#7a9a38')], bark: hex('#5e4426'), hedge: hex('#3a6a2c') };
  /// A squat double pyramid for the crown of a broadleaf tree.
  function crown(b, cx, cy, cz, rx, ry, col, seg, rot) {
    const top = [cx, cy + ry, cz], bot = [cx, cy - ry * 0.7, cz], ref = [cx, cy, cz];
    for (let i = 0; i < seg; i++) {
      const a0 = rot + (i / seg) * 6.2832, a1 = rot + ((i + 1) / seg) * 6.2832;
      const p = [cx + Math.cos(a0) * rx, cy, cz + Math.sin(a0) * rx], q = [cx + Math.cos(a1) * rx, cy, cz + Math.sin(a1) * rx];
      b.tri(p, q, top, col, ref); b.tri(q, p, bot, col, ref);
    }
  }
  function plantTree(near, far, x, g, z, h, conifer, rr) {
    const pal = conifer ? TREE_COL.conifer : TREE_COL.broad, base = pal[Math.floor(rr() * pal.length)], k = 0.88 + rr() * 0.24;
    const col = [base[0] * k, base[1] * k, base[2] * k];
    if (conifer) {
      near.cone([x, g + 1, z], h * 0.3, 0, h * 0.58, col, 6);
      near.cone([x, g + h * 0.38, z], h * 0.21, 0, h * 0.62, [col[0] * 1.1, col[1] * 1.12, col[2] * 1.05], 6);
      far.cone([x, g + 1, z], h * 0.27, 0, h, col, 3);
    } else {
      near.cone([x, g - 0.5, z], 0.5, 0.32, h * 0.5, TREE_COL.bark, 3);
      crown(near, x, g + h * 0.62, z, h * 0.34, h * 0.36, col, 5, rr() * 6);
      far.cone([x, g + h * 0.28, z], h * 0.36, 0, h * 0.72, col, 3);
    }
  }
  /// Plant a chunk: forests by moisture and altitude (conifers high, broadleaf low), a few lone trees on the plains, and hedges
  /// round the fields. Every tree is also registered as a solid.
  function populateChunk(world, c) {
    c.obj = true;
    const rr = rng((((c.ci + 1) * 73856093) ^ ((c.cj + 1) * 19349663)) + 4242), near = new Builder(), far = new Builder();
    const step = 30, n = Math.floor(TCS / step);
    for (let a = 0; a < n; a++) for (let q = 0; q < n; q++) {
      const x = c.x0 + (a + rr()) * step, z = c.z0 + (q + rr()) * step, roll = rr(), y = terrainAt(world, x, z);
      if (y < WATER + 1.5 || y > 760) continue;
      const fb = forestBase(x, z, y);
      if (!(roll < fb * 0.8 || (fb < 0.12 && roll > 0.994))) continue;
      if (blocked(world, x, z)) continue;
      const nrm = normalAt(world, x, z, 6), fp = forestP(x, z, y, nrm[1]);
      if (!(roll < fp * 0.8 || (nrm[1] > 0.93 && roll > 0.994))) continue;
      const conifer = rr() < smooth(80, 420, y + (vnoise(x / 220, z / 220) - 0.5) * 260) + 0.08, h = conifer ? 12 + rr() * 12 : 9 + rr() * 9, w = h * 0.22;
      plantTree(near, far, x, y, z, h, conifer, rr);
      addSolid(world, [x - w, y - 1, z - w], [x + w, y + h, z + w], 'tree');
    }
    // Hedgerows along the field boundaries drawn by the ground shader (160 x 224 m fields).
    const bush = (x, z) => {
      const y = terrainAt(world, x, z), ny = normalAt(world, x, z, 6)[1];
      if (farmAt(world, x, z, y, ny) > 0.55 && rr() > 0.2) near.cone([x, y - 0.3, z], 2.2 + rr() * 0.8, 0, 2.4 + rr(), TREE_COL.hedge, 4);
    };
    for (let lx = Math.ceil(c.x0 / 160) * 160; lx < c.x0 + TCS; lx += 160) for (let z = c.z0 + rr() * 22; z < c.z0 + TCS; z += 22) bush(lx, z);
    for (let lz = Math.ceil(c.z0 / 224) * 224; lz < c.z0 + TCS; lz += 224) for (let x = c.x0 + rr() * 22; x < c.x0 + TCS; x += 22) bush(x, lz);
    c.near = near.d.length ? new Float32Array(near.d) : null;
    c.far = far.d.length ? new Float32Array(far.d) : null;
  }
  /// Plant every chunk within `rad` metres of (x, z) (hitObject does this for whatever the plane is about to fly into).
  function primeObjects(world, x, z, rad) {
    for (let cj = Math.max(0, Math.floor((z - rad + WORLD) / TCS)); cj <= Math.min(TNC - 1, Math.floor((z + rad + WORLD) / TCS)); cj++) {
      for (let ci = Math.max(0, Math.floor((x - rad + WORLD) / TCS)); ci <= Math.min(TNC - 1, Math.floor((x + rad + WORLD) / TCS)); ci++) {
        const c = chunkOf(world, ci, cj); if (!c.obj) populateChunk(world, c);
      }
    }
  }

  // ---- painted ground: what you would land on

  const PAVED = [[-22, 22, -1440, 40], [51, 65, -1297, -113], [22, 51, -127, -113], [22, 51, -1297, -1283], [22, 38, -707, -693], [38, 90, -460, -210], [38, 104, -760, -560], [RIDGE.x - 16, RIDGE.x + 16, 550, 1250]];
  const onPaved = (x, z) => { for (const p of PAVED) if (x > p[0] && x < p[1] && z > p[2] && z < p[3]) return true; return false; };
  const snowLine = (x, z) => 1180 + (vnoise(x / 430 + 5, z / 430) - 0.5) * 300;
  /// What the ground is made of at (x, z): 'runway' (any paving, the mountain strip too), 'road', 'water', 'sand', 'snow', 'rock', 'forest' or 'grass'.
  function surfaceAt(world, x, z) {
    const y = terrainAt(world, x, z);
    if (y < WATER) return 'water';
    if (onPaved(x, z)) return 'runway';
    if (roadDist(x, z) < 4.5) return 'road';
    const ny = normalAt(world, x, z, 6)[1];
    if (y < WATER + 3.2 && shoreNear(x, z) > 0.4) return 'sand';
    if (y > snowLine(x, z) && ny > 0.6) return 'snow';
    if (ny < 0.72 || y > 1150) return 'rock';
    if (forestP(x, z, y, ny) > 0.45) return 'forest';
    return 'grass';
  }
  const ROUGH = { runway: 0.02, road: 0.04, grass: 0.22, forest: 0.45, sand: 0.35, rock: 0.8, snow: 0.18, water: 0 };
  /// How rough the ground is to roll on, 0 (glass) to 1 (boulders).
  const roughnessAt = (world, x, z) => ROUGH[surfaceAt(world, x, z)];

  // ---- the static scenery: airfields, towns, bridge, wind farm, pylons, lighthouse, clouds

  /// A puffy cloud lump: a flat-bottomed dome with soft shading.
  function cloudPuff(b, cx, cy, cz, rx, ry, rz) {
    const seg = 6, rings = [[0.62, 0.78], [0, 1], [-0.22, 0.8]];
    const V = (a, hh, rad) => {
      const px = cx + Math.cos(a) * rx * rad, py = cy + hh * ry, pz = cz + Math.sin(a) * rz * rad;
      const nn = norm([(px - cx) / (rx * rx), (py - cy) / (ry * ry), (pz - cz) / (rz * rz)]), t = clamp((hh + 0.3) / 1.3, 0, 1);
      return [px, py, pz, nn[0], nn[1], nn[2], 0.78 + 0.22 * t, 0.83 + 0.17 * t, 0.91 + 0.09 * t];
    };
    const T = [cx, cy + ry, cz, 0, 1, 0, 1, 1, 1], B = [cx, cy - 0.3 * ry, cz, 0, -1, 0, 0.77, 0.82, 0.9];
    const ring = (k, i) => V((i / seg) * 6.2832 + k * 0.4, rings[k][0], rings[k][1]);
    const put = (...vs) => { for (const v of vs) b.d.push(...v); };
    for (let i = 0; i < seg; i++) {
      put(T, ring(0, i), ring(0, i + 1));
      for (let k = 0; k < 2; k++) { const a = ring(k, i), bq = ring(k, i + 1), c = ring(k + 1, i), d = ring(k + 1, i + 1); put(a, c, bq, bq, c, d); }
      put(B, ring(2, i + 1), ring(2, i));
    }
  }
  const SEG7 = { 0: 'abcdef', 1: 'bc', 2: 'abged', 3: 'abgcd', 4: 'fgbc', 5: 'afgcd', 6: 'afgedc', 7: 'abc', 8: 'abcdefg', 9: 'abcdfg' };

  function makeWorld() {
    const r = rng(7), b = new Builder(), lights = new Builder(), ground = new Builder(), decal = new Builder(), marks = new Builder(), beacon = new Builder(), lampB = new Builder();
    const world = { chunks: new Array(TNC * TNC), colliders: [], grid: new Map(), turbines: [], keep: [], papi: [], socks: [], wind: null, lighthouse: null };
    const gAt = (x, z) => groundAt(world, x, z);
    const solid = (min, max, kind) => addSolid(world, min, max, kind);
    const block = (c, s, col, kind) => { b.box(c, s, col); if (kind) solid(sub(c, mul(s, 0.5)), add(c, mul(s, 0.5)), kind); };
    const rectQ = (bl, x0, x1, z0, z1, y, col) => bl.quad([x0, y, z0], [x1, y, z0], [x1, y, z1], [x0, y, z1], col, [(x0 + x1) / 2, y - 50, (z0 + z1) / 2]);
    /// A box with any horizontal orientation: u is its half-length vector, v its half-width vector, hh its half-height.
    const obox = (bl, c, u, v, hh, col) => {
      const P = (sx, sy, sz) => [c[0] + v[0] * sx + u[0] * sz, c[1] + v[1] * sx + u[1] * sz + hh * sy, c[2] + v[2] * sx + u[2] * sz];
      bl.hexa([P(-1, -1, -1), P(1, -1, -1), P(1, 1, -1), P(-1, 1, -1), P(-1, -1, 1), P(1, -1, 1), P(1, 1, 1), P(-1, 1, 1)], col);
    };
    /// A gable roof over a w x d building whose walls end at height y; the ridge runs along x or z.
    const gable = (bl, x, y, z, w, d, rh, col, alongX) => {
      const hw = w / 2 + 0.6, hd = d / 2 + 0.6, ref = [x, y + rh * 0.3, z];
      if (alongX) {
        const a = [x - hw, y, z - hd], bq = [x + hw, y, z - hd], c = [x + hw, y, z + hd], d2 = [x - hw, y, z + hd], t0 = [x - hw, y + rh, z], t1 = [x + hw, y + rh, z];
        bl.quad(a, bq, t1, t0, col, ref); bl.quad(d2, c, t1, t0, col, ref); bl.tri(a, d2, t0, col, ref); bl.tri(bq, c, t1, col, ref);
      } else {
        const a = [x - hw, y, z - hd], bq = [x - hw, y, z + hd], c = [x + hw, y, z + hd], d2 = [x + hw, y, z - hd], t0 = [x, y + rh, z - hd], t1 = [x, y + rh, z + hd];
        bl.quad(a, bq, t1, t0, col, ref); bl.quad(d2, c, t1, t0, col, ref); bl.tri(a, d2, t0, col, ref); bl.tri(bq, c, t1, col, ref);
      }
    };
    const house = (x, z, w, d, h, wall, roof) => {
      const y0 = gAt(x, z);
      block([x, y0 + h / 2, z], [w, h, d], wall, 'building');
      gable(b, x, y0 + h, z, w, d, 2.5 + Math.min(w, d) * 0.3, roof, w >= d);
    };
    /// A ribbon laid on the ground along a polyline.
    const ribbon = (bl, pts, w, yo, col) => {
      let prev = null;
      for (let i = 0; i < pts.length - 1; i++) {
        const [ax, az] = pts[i], [bx, bz] = pts[i + 1], L = Math.hypot(bx - ax, bz - az), n = Math.max(1, Math.round(L / 16)), px = -(bz - az) / L * w / 2, pz = (bx - ax) / L * w / 2;
        for (let k = 0; k <= n; k++) {
          const x = ax + (bx - ax) * k / n, z = az + (bz - az) * k / n;
          const cur = [[x + px, gAt(x + px, z + pz) + yo, z + pz], [x - px, gAt(x - px, z - pz) + yo, z - pz]];
          if (k > 0) bl.quad(prev[0], cur[0], cur[1], prev[1], col, [x, -300, z]);
          prev = cur;
        }
      }
    };
    const dashes = (bl, pts, col) => {
      for (let i = 0; i < pts.length - 1; i++) {
        const [ax, az] = pts[i], [bx, bz] = pts[i + 1], L = Math.hypot(bx - ax, bz - az), dx = (bx - ax) / L, dz = (bz - az) / L;
        for (let t = 6; t + 8 < L; t += 22) ribbon(bl, [[ax + dx * t, az + dz * t], [ax + dx * (t + 8), az + dz * (t + 8)]], 0.4, 0.5, col);
      }
    };
    const asphalt = hex('#3a3e44'), shoulder = hex('#4a4f55'), concrete = hex('#979a9d'), paint = hex('#f4f4f1'), yellow = hex('#f1c232'), mown = hex('#5d9a3a'), road = hex('#55595e');

    // ---- the main runway: asphalt, edge lines, centre dashes, thresholds, aiming and touchdown marks, numbers, lights
    rectQ(ground, -110, 160, 80, RUNWAY.z1 - 80, 0.05, mown);
    rectQ(decal, -RUNWAY.half - 6, -RUNWAY.half, 40, RUNWAY.z1 - 40, 0.1, shoulder); rectQ(decal, RUNWAY.half, RUNWAY.half + 6, 40, RUNWAY.z1 - 40, 0.1, shoulder);
    rectQ(decal, -RUNWAY.half, RUNWAY.half, 40, RUNWAY.z1 - 40, 0.1, asphalt);
    const bar = (x0, x1, z0, z1, col = paint) => rectQ(marks, x0, x1, z0, z1, 0.14, col);
    bar(-21.4, -20.7, 0, RUNWAY.z1); bar(20.7, 21.4, 0, RUNWAY.z1);
    for (let z = -70; z > RUNWAY.z1 + 70; z -= 50) bar(-0.45, 0.45, z, z - 30);
    const numeral = (txt, zBase, dir) => {
      const w = 4.2, hgt = 18, t = 1.1, gap = 2.2, total = txt.length * w + (txt.length - 1) * gap;
      const seg = { a: [0, w, hgt - t, hgt], d: [0, w, 0, t], g: [0, w, hgt / 2 - t / 2, hgt / 2 + t / 2], f: [0, t, hgt / 2, hgt], b: [w - t, w, hgt / 2, hgt], e: [0, t, 0, hgt / 2], c: [w - t, w, 0, hgt / 2] };
      [...txt].forEach((ch, idx) => {
        const u0 = -total / 2 + idx * (w + gap);
        for (const key of SEG7[ch]) { const [ua, ub, va, vb] = seg[key]; bar(-dir * (u0 + ua), -dir * (u0 + ub), zBase + dir * va, zBase + dir * vb); }
      });
    };
    const endMarks = (zt, dir, txt) => {
      const at = (d) => zt + dir * d;
      for (const sg of [-1, 1]) {
        for (let k = 0; k < 7; k++) { const x0 = sg * (4 + k * 2.4); bar(x0, x0 + sg * 1.2, at(6), at(36)); }
        bar(sg * 7.5, sg * 11.5, at(300), at(345));
      }
      for (const [d, cnt] of [[150, 3], [450, 2], [600, 2], [750, 1]]) for (const sg of [-1, 1]) for (let k = 0; k < cnt; k++) { const x0 = sg * (4.2 + k * 3.4); bar(x0, x0 + sg * 1.8, at(d), at(d + 22)); }
      numeral(txt, at(48), dir);
    };
    endMarks(0, -1, '36'); endMarks(RUNWAY.z1, 1, '18');
    // Taxiway, connectors and aprons, with a yellow centre line.
    rectQ(decal, 51, 65, -113, -210, 0.1, asphalt); rectQ(decal, 51, 65, -460, -560, 0.1, asphalt); rectQ(decal, 51, 65, -760, -1297, 0.1, asphalt);
    rectQ(decal, 22, 51, -113, -127, 0.1, asphalt); rectQ(decal, 22, 38, -693, -707, 0.1, asphalt); rectQ(decal, 22, 51, -1283, -1297, 0.1, asphalt);
    rectQ(decal, 38, 90, -210, -460, 0.1, concrete); rectQ(decal, 38, 104, -560, -760, 0.1, concrete);
    bar(57.75, 58.25, -113, -1290, yellow); bar(22, 57.75, -119.75, -120.25, yellow); bar(22, 57.75, -699.75, -700.25, yellow); bar(22, 57.75, -1289.75, -1290.25, yellow);
    // Lights: edge lights (amber near each end), green threshold bars, approach lights with two crossbars at both ends.
    const white = hex('#fff4d0'), amber = hex('#ffb347'), green = hex('#35e06a');
    for (let z = 0; z >= RUNWAY.z1; z -= 60) for (const sx of [-1, 1]) lights.box([sx * (RUNWAY.half + 1.3), 0.35, z], [0.7, 0.7, 0.7], Math.min(-z, z - RUNWAY.z1) < 300 ? amber : white);
    for (let x = -20; x <= 20; x += 4) { lights.box([x, 0.35, 1.5], [0.8, 0.7, 0.8], green); lights.box([x, 0.35, RUNWAY.z1 - 1.5], [0.8, 0.7, 0.8], green); }
    for (const [zt, dir] of [[0, 1], [RUNWAY.z1, -1]]) for (let i = 1; i <= 14; i++) {
      const z = zt + dir * 30 * i;
      lights.box([0, 0.9, z], [0.9, 0.9, 0.9], white);
      if (i === 4 || i === 10) for (const x of [-9, -6, -3, 3, 6, 9]) lights.box([x, 0.9, z], [0.8, 0.8, 0.8], white);
    }
    // PAPI: four lamps beside each end, drawn each frame (white or red by the plane's glide angle); the housings are static.
    for (const [z, dir, sx] of [[-300, -1, -1], [RUNWAY.z1 + 300, 1, 1]]) {
      const units = [];
      for (let k = 0; k < 4; k++) { const x = sx * (RUNWAY.half + 12 + k * 9); units.push([x, 1.1, z]); b.box([x, 0.5, z], [3.2, 1, 3.2], hex('#2b2f33')); }
      world.papi.push({ dir, units });
    }
    // Windsocks (poles here, the socks are drawn each frame).
    const sock = (x, z, y = gAt(x, z)) => { b.box([x, y + 4.5, z], [0.3, 9, 0.3], hex('#e8e8e8')); b.box([x, y + 0.4, z], [1.2, 0.8, 1.2], hex('#c0392b')); world.socks.push({ pos: [x, y + 9, z] }); };
    sock(-40, -30);

    // ---- the mountain strip on its plateau
    const ry = RIDGE.y, rx = RIDGE.x, rh = RIDGE.half, gravel = hex('#77644d');
    rectQ(ground, rx - 60, rx + 60, RIDGE.z0 + 60, RIDGE.z1 - 60, ry + 0.05, hex('#6f9a47'));
    rectQ(decal, rx - rh, rx + rh, RIDGE.z0 + 25, RIDGE.z1 - 25, ry + 0.1, gravel);
    for (let z = RIDGE.z0 - 30; z > RIDGE.z1 + 30; z -= 50) rectQ(marks, rx - 0.7, rx + 0.7, z, z - 22, ry + 0.14, paint);
    for (const [zt, dir] of [[RIDGE.z0, -1], [RIDGE.z1, 1]]) for (const sg of [-1, 1]) for (let k = 0; k < 4; k++) { const x0 = rx + sg * (3 + k * 2.2); rectQ(marks, x0, x0 + sg * 1.1, zt + dir * 6, zt + dir * 22, ry + 0.14, paint); }
    for (const sg of [-1, 1]) rectQ(marks, rx + sg * (rh - 1.2), rx + sg * (rh - 0.7), RIDGE.z0, RIDGE.z1, ry + 0.14, paint);
    block([rx + 60, ry + 6, 900], [30, 12, 24], hex('#b5651d'), 'hangar'); gable(b, rx + 60, ry + 12, 900, 30, 24, 4, hex('#7f3f00'), true);
    sock(rx - 26, 1210, ry);

    // ---- airfield buildings: hangars, control tower, terminal
    const steel = hex('#95a5a6'), glass = hex('#5d8fb5');
    for (const [hz, rc] of [[-300, hex('#c0392b')], [-380, hex('#2980b9')]]) {
      b.box([110, 9, hz], [50, 18, 36], steel); solid([85, 0, hz - 18], [135, 21, hz + 18], 'hangar');
      gable(b, 110, 18, hz, 50, 36, 5, rc, false);
      b.box([84.8, 6, hz], [0.5, 12, 26], hex('#2c3e50'));
    }
    block([90, 14, -520], [10, 28, 10], hex('#ecf0f1'), 'tower');
    b.box([90, 7, -520], [10.3, 6, 10.3], hex('#c0392b'));
    solid([83, 28, -527], [97, 34, -513], 'tower');
    b.box([90, 29.2, -520], [14, 2.4, 14], hex('#34495e')); b.box([90, 31.6, -520], [14.4, 2.6, 14.4], glass); b.box([90, 34, -520], [16, 0.8, 16], hex('#2c3e50')); b.box([90, 38, -520], [0.3, 7, 0.3], hex('#bdc3c7'));
    beacon.box([90, 41.8, -520], [0.9, 0.9, 0.9], [1, 0.2, 0.15]);
    block([128, 6, -660], [44, 12, 86], hex('#d9dcdf'), 'building'); b.box([105.7, 5.5, -660], [0.6, 6, 78], glass); b.box([128, 12.5, -660], [48, 0.8, 90], hex('#7f8c8d'));
    b.box([128, 15, -660], [10, 5, 30], hex('#d9dcdf'));

    // ---- the town: gabled houses on a street grid, taller blocks in the middle
    const walls = ['#d5d8dc', '#e8d8c3', '#c39b77', '#aab7b8', '#f5cba7', '#e6b0aa'].map(hex), roofs = ['#a04000', '#7b241c', '#5d6d7e', '#8a4b2a'].map(hex);
    for (let gz = 0; gz < 10; gz++) rectQ(decal, 800, 1690, -900 - gz * 100 + 4.5, -900 - gz * 100 - 4.5, 0.1, road);
    for (let gx = 0; gx < 10; gx++) rectQ(decal, 897.5 + gx * 95 - 4.5, 897.5 + gx * 95 + 4.5, -800, -1800, 0.1, road);
    for (let gx = 0; gx < 9; gx++) for (let gz = 0; gz < 10; gz++) {
      if (r() < 0.2) continue;
      const x = 850 + gx * 95 + (r() - 0.5) * 20, z = -850 - gz * 100 + (r() - 0.5) * 20;
      const centre = Math.hypot(x - 1250, z + 1350) < 250, h = centre ? 30 + r() * 60 : 8 + r() * 14, w = 22 + r() * 20, d = 22 + r() * 20;
      if (centre) { block([x, h / 2, z], [w, h, d], walls[Math.floor(r() * walls.length)], 'building'); b.box([x, h + 1.5, z], [w * 0.5, 3, d * 0.5], hex('#5d6d7e')); }
      else house(x, z, w, d, h, walls[Math.floor(r() * walls.length)], roofs[Math.floor(r() * roofs.length)]);
    }
    // ---- villages along the roads, one with a church
    [[600, 1300, 11, true], [-300, 2800, 12, false], [2300, -250, 13, false]].forEach(([cx, cz, seed, church]) => {
      const rv = rng(seed);
      rectQ(decal, cx - 190, cx + 190, cz - 4, cz + 4, 0.1, road); rectQ(decal, cx - 4, cx + 4, cz - 150, cz + 150, 0.1, road);
      for (let k = -5; k <= 5; k++) for (const sd of [-1, 1]) {
        if (rv() < 0.18 || (church && k === 1 && sd === 1)) continue;
        house(cx + k * 34 + (rv() - 0.5) * 6, cz + sd * (22 + rv() * 8), 12 + rv() * 8, 10 + rv() * 6, 5 + rv() * 4, walls[Math.floor(rv() * walls.length)], roofs[Math.floor(rv() * roofs.length)]);
      }
      for (let k = 2; k <= 4; k++) for (const sd of [-1, 1]) for (const sc of [-1, 1]) if (rv() > 0.3) house(cx + sd * (22 + rv() * 6), cz + sc * k * 30, 11 + rv() * 5, 10 + rv() * 5, 5 + rv() * 3, walls[Math.floor(rv() * walls.length)], roofs[Math.floor(rv() * roofs.length)]);
      if (church) {
        const x = cx + 34, z = cz + 28, y0 = gAt(x, z);
        block([x, y0 + 5, z], [10, 10, 18], hex('#e8e0d0'), 'building'); gable(b, x, y0 + 10, z, 10, 18, 5, hex('#6d4c41'), false);
        block([x, y0 + 12, z + 11], [5, 24, 5], hex('#e8e0d0'), 'building'); b.cone([x, y0 + 24, z + 11], 3.8, 0, 9, hex('#4e5d6c'), 4);
      }
    });
    // ---- the city, a long way off: towers thickest in the middle
    const cityCols = ['#9fb4c7', '#b8c4cf', '#8896a3', '#c9c2b6', '#7f8f9f', '#a7b5a8'].map(hex);
    rectQ(decal, CITY.x - 540, CITY.x + 540, CITY.z - 540, CITY.z + 540, 0.1, road);
    for (let i = -7; i <= 7; i++) for (let j = -7; j <= 7; j++) {
      const dd = Math.hypot(i, j) * 72;
      if (dd > 520 || r() < 0.12) continue;
      const x = CITY.x + i * 72 + (r() - 0.5) * 8, z = CITY.z + j * 72 + (r() - 0.5) * 8;
      const h = 12 + 150 * Math.exp(-((dd / 230) ** 2)) * (0.35 + r() * 0.8) + r() * 14, w = 34 + r() * 20, d = 34 + r() * 20;
      block([x, h / 2, z], [w, h, d], cityCols[Math.floor(r() * cityCols.length)], 'building');
      b.box([x, h + 1.5, z], [w * 0.45, 3, d * 0.45], hex('#59626b'));
      if (h > 90) b.box([x, h + 9, z], [0.5, 12, 0.5], hex('#bdc3c7'));
    }
    // ---- roads between them
    for (const rd of ROADS) { ribbon(decal, rd, 7, 0.35, road); dashes(marks, rd, hex('#e8e0b0')); }

    // ---- the bridge over the river (fly under it!): a slanted deck on piers; the solid boxes are the old stepped ones
    const deckY = 30, rdir = norm([RIVER[1][0] - RIVER[0][0], 0, RIVER[1][1] - RIVER[0][1]]), across = [-rdir[2], 0, rdir[0]];
    for (let k = -6; k <= 6; k++) {
      const c = add([BRIDGE.x, deckY, BRIDGE.z], mul(across, k * 18));
      solid(sub(c, [8, 1.5, 8]), add(c, [8, 1.5, 8]), 'bridge');
      if (Math.abs(k) === 2 || Math.abs(k) === 6) {
        const ph = deckY - 1.5 - WATER;
        block([c[0], WATER + ph / 2, c[2]], [6, ph, 6], hex('#8d8a84'), 'bridge');
        b.box([c[0], deckY - 2.2, c[2]], [11, 1.2, 11], hex('#8d8a84'));
      }
    }
    const dc = [BRIDGE.x, deckY, BRIDGE.z], along = mul(across, 6 * 18 + 8), side = mul(rdir, 7.5);
    obox(b, dc, along, side, 1.5, hex('#a9a69f'));
    for (const sg of [-1, 1]) obox(b, add(dc, [side[0] * sg * 0.96, 2.1, side[2] * sg * 0.96]), along, mul(rdir, 0.3), 0.6, hex('#d8d5cf'));
    {
      const A = add(dc, [0, 1.55, 0]), n = 14;
      for (let k = 0; k < n; k++) {
        const t0 = -1 + (2 * k) / n, t1 = -1 + (2 * (k + 1)) / n, q = (t) => add(A, mul(along, t));
        decal.quad(add(q(t0), mul(rdir, 6.8)), add(q(t1), mul(rdir, 6.8)), add(q(t1), mul(rdir, -6.8)), add(q(t0), mul(rdir, -6.8)), hex('#3d4146'), [A[0], -200, A[2]]);
      }
      for (let t = -0.95; t < 0.95; t += 0.1) { const c0 = add(A, mul(along, t)), c1 = add(A, mul(along, t + 0.05)); marks.quad(add(c0, mul(rdir, 0.25)), add(c1, mul(rdir, 0.25)), add(c1, mul(rdir, -0.25)), add(c0, mul(rdir, -0.25)), paint, [A[0], -200, A[2]]); }
    }
    // A radio mast on a hill, striped red and white, with a red light.
    const mx = -700, mz = 1700, mg = gAt(mx, mz);
    solid([mx - 1.5, mg, mz - 1.5], [mx + 1.5, mg + 220, mz + 1.5], 'mast');
    for (let k = 0; k < 8; k++) b.box([mx, mg + 13.75 + k * 27.5, mz], [3, 27.5, 3], k % 2 ? hex('#f2f2f2') : hex('#c0392b'));
    beacon.box([mx, mg + 222, mz], [3.5, 3, 3.5], [1, 0.2, 0.15]); world.keep.push([mx, mz, 40]);
    // A wind farm on the eastern hills; the blades turn (drawn each frame), and flying into a rotor is a crash.
    for (let k = 0; k < 12; k++) {
      const x = 2500 + (k % 4) * 270 + (r() - 0.5) * 60, z = 450 + Math.floor(k / 4) * 330 + (r() - 0.5) * 60, g = gAt(x, z);
      solid([x - 1.5, g, z - 1.5], [x + 1.5, g + 80, z + 1.5], 'turbine');
      b.cone([x, g, z], 2.1, 1.1, 80, hex('#ecf0f1'), 8);
      b.box([x, g + 80, z + 2], [4, 4, 8], hex('#dfe6e9'));
      world.turbines.push({ hub: [x, g + 80, z - 2.5], phase: r() * 6 });
      solid([x - 26, g + 54, z - 4], [x + 26, g + 106, z - 1], 'turbine'); world.keep.push([x, z, 40]);
    }
    // Pylons stride across the plain from the city to the town, carrying three sagging wires on each side.
    {
      const line = [[2900, 2480], [2550, 1900], [2200, 1300], [2000, 700], [2100, 100], [2000, -500], [1700, -1000]], towers = [];
      let next = 0, done = 0;                                                      // metres along the line to the next pylon
      for (let i = 0; i < line.length - 1; i++) {
        const [ax, az] = line[i], [bx, bz] = line[i + 1], L = Math.hypot(bx - ax, bz - az);
        for (; next <= done + L; next += 230) { const t = (next - done) / L; towers.push([ax + (bx - ax) * t, az + (bz - az) * t, (bx - ax) / L, (bz - az) / L]); }
        done += L;
      }
      const steelC = hex('#6f7a82'), wire = hex('#23272b'), arms = [[27, 11], [32, 8.5], [36.5, 6]];
      const anchors = towers.map(([x, z, dx, dz]) => {
        const g = gAt(x, z), ax = [-dz, 0, dx], pts = [];
        b.cone([x, g - 1, z], 3.4, 0.9, 40, steelC, 4);
        solid([x - 3.4, g - 1, z - 3.4], [x + 3.4, g + 39, z + 3.4], 'mast'); world.keep.push([x, z, 14]);
        for (const [hy, hl] of arms) {
          obox(b, [x, g + hy, z], mul(ax, hl), [dx * 0.35, 0, dz * 0.35], 0.35, steelC);
          for (const sg of [-1, 1]) pts.push([x + ax[0] * hl * sg, g + hy - 1.6, z + ax[2] * hl * sg]);
        }
        return pts;
      });
      for (let i = 0; i < anchors.length - 1; i++) for (let w = 0; w < 6; w++) {
        const p0 = anchors[i][w], p1 = anchors[i + 1][w];
        const q = (t) => [p0[0] + (p1[0] - p0[0]) * t, p0[1] + (p1[1] - p0[1]) * t - 5 * 4 * t * (1 - t), p0[2] + (p1[2] - p0[2]) * t];
        for (let k = 0; k < 5; k++) {
          const a = q(k / 5), c = q((k + 1) / 5);
          b.tri(a, c, add(a, [0, 0.22, 0]), wire); b.tri(c, add(c, [0, 0.22, 0]), add(a, [0, 0.22, 0]), wire);
          b.tri(a, c, add(a, [0.22, 0, 0.22]), wire); b.tri(c, add(c, [0.22, 0, 0.22]), add(a, [0.22, 0, 0.22]), wire);
        }
      }
    }
    // A lighthouse on the coast, striped, with a lamp that flashes.
    {
      const lx = 1100; let lz = 3000;
      while (lz < 7000 && gAt(lx, lz + 20) > 0.6) lz += 20;
      const g = Math.max(gAt(lx, lz), 0.5), bands = 5;
      for (let k = 0; k < bands; k++) b.cone([lx, g + k * 5, lz], 4.6 - k * 0.28, 4.6 - (k + 1) * 0.28, 5, k % 2 ? hex('#f2f2f2') : hex('#c0392b'), 10);
      b.box([lx, g + 25.4, lz], [9, 0.8, 9], hex('#34495e'));
      b.cone([lx, g + 26, lz], 2.6, 2.6, 3.4, hex('#aee3ef'), 8); b.cone([lx, g + 29.4, lz], 3.2, 0, 2.4, hex('#c0392b'), 8);
      lampB.box([lx, g + 27.7, lz], [2.2, 2.2, 2.2], [1, 0.95, 0.7]);
      solid([lx - 4.6, g - 1, lz - 4.6], [lx + 4.6, g + 32, lz + 4.6], 'tower'); world.keep.push([lx, lz, 40]);
      world.lighthouse = { x: lx, z: lz, y: g + 27.7 };
    }

    // ---- clouds: flat-bottomed puffs in the middle layer (kept off the airfield), a thin high layer above
    const cl = new Builder();
    for (let i = 0; i < 90; i++) {
      const x = (r() - 0.5) * 2 * WORLD, z = (r() - 0.5) * 2 * WORLD, y = 650 + r() * 450, n = 3 + Math.floor(r() * 4), sc = 0.7 + r() * 0.8;
      if (Math.hypot(x, z + 700) < 1600) continue;
      for (let k = 0; k < n; k++) cloudPuff(cl, x + (r() - 0.5) * 160 * sc, y + r() * 14, z + (r() - 0.5) * 110 * sc, (45 + r() * 55) * sc, (16 + r() * 20) * sc, (40 + r() * 45) * sc);
    }
    for (let i = 0; i < 24; i++) {
      const x = (r() - 0.5) * 2 * WORLD, z = (r() - 0.5) * 2 * WORLD, y = 1900 + r() * 250;
      for (let k = 0; k < 2; k++) cloudPuff(cl, x + (r() - 0.5) * 500, y + r() * 20, z + (r() - 0.5) * 300, 320 + r() * 280, 14 + r() * 10, 200 + r() * 160);
    }
    Object.assign(world, { world: b, clouds: cl, lights, ground, decal, marks, beacon, lampB });
    primeObjects(world, 0, -300, 1700);
    return world;
  }

  /// Ground height under (x, z), matching the drawn terrain triangles exactly (water counts as the surface).
  function terrainAt(world, x, z) {
    const gx = clamp((x + WORLD) / TCELL, 0, TN - 1e-6), gz = clamp((z + WORLD) / TCELL, 0, TN - 1e-6);
    const i = Math.floor(gx), j = Math.floor(gz), fx = gx - i, fz = gz - j, ci = (i / TCHUNK) | 0, cj = (j / TCHUNK) | 0, row = TCHUNK + 1;
    const H = chunkHeights(world, chunkOf(world, ci, cj)), k = (j - cj * TCHUNK) * row + i - ci * TCHUNK;
    const h00 = H[k], h10 = H[k + 1], h01 = H[k + row], h11 = H[k + row + 1];
    return fx + fz < 1 ? h00 + (h10 - h00) * fx + (h01 - h00) * fz : h11 + (h01 - h11) * (1 - fx) + (h10 - h11) * (1 - fz);
  }
  function groundAt(world, x, z) { return Math.max(terrainAt(world, x, z), WATER); }
  const overWater = (world, x, z) => terrainAt(world, x, z) < WATER;
  /// The solid thing (tree, building, bridge…) a point is inside, if any. Plants the chunk first if it hasn't been yet.
  function hitObject(world, p) {
    const ci = Math.floor((p[0] + WORLD) / TCS), cj = Math.floor((p[2] + WORLD) / TCS);
    if (ci >= 0 && cj >= 0 && ci < TNC && cj < TNC) { const c = chunkOf(world, ci, cj); if (!c.obj) populateChunk(world, c); }
    const list = world.grid.get(`${Math.floor(p[0] / 200)},${Math.floor(p[2] / 200)}`);
    if (!list) return null;
    for (const c of list) if (p[0] > c.min[0] && p[0] < c.max[0] && p[1] > c.min[1] && p[1] < c.max[1] && p[2] > c.min[2] && p[2] < c.max[2]) return c;
    return null;
  }
  const onRunway = (p) => (Math.abs(p[0] - RUNWAY.x) < RUNWAY.half && p[2] < RUNWAY.z0 + 5 && p[2] > RUNWAY.z1 - 5)
    || (Math.abs(p[0] - RIDGE.x) < RIDGE.half && p[2] < RIDGE.z0 + 5 && p[2] > RIDGE.z1 - 5);
  const onRidge = (p) => Math.abs(p[0] - RIDGE.x) < RIDGE.half && p[2] < RIDGE.z0 + 5 && p[2] > RIDGE.z1 - 5;

  // ------------------------------------------------------------------ drawing the world

  const FOG_FAR = 10500;
  /// How much of the haze colour covers something `d` metres (view depth) away; the same curve in every shader.
  const FOG_GLSL = 'float fogAmt(float d, float far) { float x = d / (far * 0.5); return clamp(1.0 - exp(-x * x * 0.9), 0.0, 1.0); }';
  const PREC = '#ifdef GL_FRAGMENT_PRECISION_HIGH\nprecision highp float;\n#else\nprecision mediump float;\n#endif\n';
  const TERRAIN_VS = `attribute vec3 p; attribute vec4 n; attribute vec4 c; uniform mat4 vp;
    varying vec3 wp; varying vec3 wn; varying vec3 wc; varying float wo; varying float wf; varying float vd;
    void main(){ gl_Position = vp * vec4(p, 1.0); vd = gl_Position.w; wp = p; wn = n.xyz; wo = n.w; wc = c.rgb; wf = c.a; }`;
  const TERRAIN_FS = `${PREC}varying vec3 wp; varying vec3 wn; varying vec3 wc; varying float wo; varying float wf; varying float vd;
    uniform sampler2D tx; uniform vec3 fogc; uniform vec3 sun; uniform vec3 cam; uniform float fogFar;
    ${FOG_GLSL}
    float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
    void main(){
      vec3 n = normalize(wn);
      float dist = length(wp - cam);
      vec2 q = wp.xz;
      vec3 t1 = texture2D(tx, q / 6.0).rgb;
      vec3 t2 = texture2D(tx, q / 47.0 + vec2(0.37, 0.11)).rgb;
      vec3 t3 = texture2D(tx, q / 391.0 + vec2(0.71, 0.53)).rgb;
      float f1 = 1.0 - smoothstep(60.0, 700.0, dist);
      float f2 = 1.0 - smoothstep(900.0, 4500.0, dist);
      vec3 col = wc * (1.0 + (t1.r - 0.5) * 0.42 * f1 + (t2.g - 0.5) * 0.36 * f2 + (t3.b - 0.5) * 0.30);
      if (wf > 0.02) {
        vec2 fs = vec2(160.0, 224.0);
        vec2 cell = floor(q / fs), fl = fract(q / fs);
        float h1 = hash(cell), h2 = hash(cell + 7.3);
        vec3 crop = h1 < 0.22 ? vec3(0.78, 0.68, 0.30) : h1 < 0.40 ? vec3(0.42, 0.62, 0.22) : h1 < 0.55 ? vec3(0.52, 0.40, 0.26) : h1 < 0.72 ? vec3(0.35, 0.56, 0.24) : h1 < 0.86 ? vec3(0.66, 0.72, 0.34) : vec3(0.50, 0.66, 0.30);
        float ang = h2 * 3.1416;
        float rows = 0.5 + 0.5 * sin(dot(q, vec2(cos(ang), sin(ang))) * 1.6);
        crop *= (1.0 + (rows - 0.5) * 0.24 * f1) * (0.9 + (t2.r - 0.5) * 0.3 + h2 * 0.12);
        vec2 ed = min(fl, 1.0 - fl) * fs;
        float he = (1.0 - smoothstep(1.2, 3.4, min(ed.x, ed.y))) * (1.0 - smoothstep(1500.0, 5000.0, dist));
        crop = mix(crop, vec3(0.16, 0.30, 0.13) * (0.8 + t1.g * 0.4), he * 0.85);
        col = mix(col, crop, smoothstep(0.02, 0.5, wf));
      }
      float slope = 1.0 - n.y, nl = t3.b - 0.5, nm = t2.g - 0.5;
      vec3 rockc = mix(vec3(0.47, 0.44, 0.40), vec3(0.58, 0.53, 0.46), t2.r) * (0.92 + (t1.r - 0.5) * 0.5 * f1 + nm * 0.4);
      float rk = smoothstep(0.22, 0.40, slope + nl * 0.10) * step(2.0, wp.y);
      col = mix(col, rockc, rk);
      float scree = smoothstep(0.12, 0.24, slope) * (1.0 - rk) * smoothstep(350.0, 700.0, wp.y);
      col = mix(col, vec3(0.58, 0.54, 0.49) * (0.9 + (t1.g - 0.5) * 0.4 * f1), scree * 0.6);
      float sl = 1180.0 + nl * 300.0 + nm * 80.0;
      float sn = smoothstep(sl - 25.0, sl + 40.0, wp.y + (t1.g - 0.5) * 30.0 * f1) * (1.0 - smoothstep(0.26, 0.46, slope + nm * 0.1));
      col = mix(col, vec3(0.93, 0.95, 0.98) * (0.95 + (t1.r - 0.5) * 0.1 * f1), sn);
      vec3 nn = normalize(n + vec3(t1.g - 0.5, 0.0, t1.b - 0.5) * 0.55 * f1 * (1.0 - sn * 0.7) + vec3(t2.r - 0.5, 0.0, t2.b - 0.5) * 0.30 * f2);
      float dif = max(dot(nn, sun), 0.0);
      vec3 amb = mix(vec3(0.26, 0.24, 0.22), vec3(0.34, 0.42, 0.58), n.y * 0.5 + 0.5);
      vec3 lit = (amb * (0.55 + 0.45 * wo) + vec3(1.02, 0.95, 0.84) * dif * (0.45 + 0.55 * wo)) * 0.88;
      col *= lit;
      float f = fogAmt(vd, fogFar) * (1.0 - 0.4 * smoothstep(100.0, 1600.0, wp.y));
      gl_FragColor = vec4(mix(col, fogc, clamp(f, 0.0, 1.0)), 1.0);
    }`;
  const WATER_VS = `attribute vec4 p; uniform mat4 vp; varying vec3 wp; varying float wd; varying float vd;
    void main(){ gl_Position = vp * vec4(p.xyz, 1.0); vd = gl_Position.w; wp = p.xyz; wd = p.w; }`;
  const WATER_FS = `${PREC}varying vec3 wp; varying float wd; varying float vd;
    uniform sampler2D tx; uniform vec3 fogc; uniform vec3 sun; uniform vec3 cam; uniform float fogFar; uniform float time;
    ${FOG_GLSL}
    void main(){
      if (wd <= 0.0) discard;
      vec3 toC = cam - wp; float dist = length(toC); vec3 v = toC / dist;
      vec2 q = wp.xz;
      float nearK = 1.0 - smoothstep(300.0, 3500.0, dist);
      vec2 a = texture2D(tx, q / 41.0 + vec2(time * 0.012, time * 0.008)).ra - 0.5;
      vec2 b = texture2D(tx, q / 13.0 + vec2(-time * 0.021, time * 0.014)).gb - 0.5;
      vec2 c = texture2D(tx, q / 3.7 + vec2(time * 0.06, -time * 0.04)).br - 0.5;
      vec3 n = normalize(vec3(a.x * 0.5 + b.x * 0.5 + c.x * 0.35 * nearK, 1.0, a.y * 0.5 + b.y * 0.5 + c.y * 0.35 * nearK));
      n = normalize(mix(vec3(0.0, 1.0, 0.0), n, 0.3 + 0.7 * nearK));
      float fres = 0.04 + 0.96 * pow(1.0 - clamp(dot(n, v), 0.0, 1.0), 5.0);
      vec3 r = reflect(-v, n);
      vec3 skyc = mix(fogc, vec3(0.36, 0.58, 0.92), smoothstep(0.0, 0.5, r.y));
      vec3 body = mix(vec3(0.14, 0.56, 0.58), vec3(0.03, 0.17, 0.36), smoothstep(0.0, 16.0, wd));
      vec3 col = mix(body, skyc, fres);
      float rs = max(dot(r, sun), 0.0);
      col += vec3(1.0, 0.93, 0.78) * (pow(rs, 380.0) * 5.0 + pow(rs, 40.0) * 0.28);
      float fw = 1.0 - smoothstep(0.0, 0.7, wd);
      float wave = 0.5 + 0.5 * sin(wd * 9.0 - time * 1.6 + a.x * 6.0);
      float foam = smoothstep(0.30, 0.75, fw * (0.4 + 0.6 * wave) + c.x * 0.3 * fw);
      col = mix(col, vec3(0.96, 0.98, 1.0), foam * 0.9);
      float alpha = mix(0.40, 0.94, smoothstep(0.0, 7.0, wd)) * smoothstep(0.0, 0.1, wd);
      alpha = max(alpha, foam * 0.85 * smoothstep(0.0, 0.05, wd));
      float f = fogAmt(vd, fogFar);
      gl_FragColor = vec4(mix(col, fogc, f), mix(alpha, 1.0, f));
    }`;
  const SKY_VS = 'attribute vec2 p; varying vec2 uv; void main(){ uv = p; gl_Position = vec4(p, 1.0, 1.0); }';
  const SKY_FS = `${PREC}varying vec2 uv; uniform vec3 camR; uniform vec3 camU; uniform vec3 camF; uniform vec2 tn; uniform vec3 sun; uniform vec3 haze;
    void main(){
      vec3 d = normalize(camF + camR * (uv.x * tn.x) + camU * (uv.y * tn.y));
      float up = clamp(d.y, 0.0, 1.0);
      vec3 sky = mix(haze, vec3(0.34, 0.58, 0.90), pow(smoothstep(0.0, 0.30, up), 0.8));
      sky = mix(sky, vec3(0.13, 0.33, 0.74), smoothstep(0.12, 0.85, up));
      float cs = max(dot(d, sun), 0.0);
      sky += vec3(1.0, 0.82, 0.55) * (pow(cs, 6.0) * 0.12 + pow(cs, 90.0) * 0.30);
      sky = mix(sky, vec3(1.0, 0.98, 0.92), smoothstep(0.9993, 0.99965, cs));
      if (d.y < 0.0) sky = mix(haze, haze * 0.95, clamp(-d.y * 8.0, 0.0, 1.0));
      gl_FragColor = vec4(sky, 1.0);
    }`;

  /// Everything the plane flies over: sky, level-of-detail ground chunks, trees, painted ground, buildings, lights, clouds, water.
  /// G: the host's GL helpers { prog, U, draw, upload, I, rotorMesh }. Returns { draw(ctx), prime(x, z) }.
  function makeWorldRenderer(gl, W, G) {
    const { prog, U, draw, upload, I, rotorMesh } = G;
    const sh = (type, src) => { const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s); if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) console.error('world shader:', gl.getShaderInfoLog(s)); return s; };
    const mk = (vs, fs) => {
      const p = gl.createProgram(); gl.attachShader(p, sh(gl.VERTEX_SHADER, vs)); gl.attachShader(p, sh(gl.FRAGMENT_SHADER, fs));
      gl.bindAttribLocation(p, 0, 'p'); gl.bindAttribLocation(p, 1, 'n'); gl.bindAttribLocation(p, 2, 'c'); gl.linkProgram(p);
      if (!gl.getProgramParameter(p, gl.LINK_STATUS)) console.error('world program:', gl.getProgramInfoLog(p));
      const cache = {};
      return { p, u: (name) => (name in cache ? cache[name] : (cache[name] = gl.getUniformLocation(p, name))) };
    };
    const T = mk(TERRAIN_VS, TERRAIN_FS), WA = mk(WATER_VS, WATER_FS), SK = mk(SKY_VS, SKY_FS);

    // A small tileable noise texture (four independent channels) for every procedural detail: ground grain, ripples.
    const tex = gl.createTexture();
    {
      const S = 128, data = new Uint8Array(S * S * 4), rg = rng(99), wts = [0.5, 0.3, 0.2];
      const lattice = (per) => { const g = new Float32Array(per * per); for (let i = 0; i < g.length; i++) g[i] = rg(); return g; };
      const at = (g, per, u, v) => {
        const x = u * per, y = v * per, i = Math.floor(x), j = Math.floor(y), fx = x - i, fy = y - j, sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy);
        const i1 = (i + 1) % per, j1 = (j + 1) % per, i0 = i % per, j0 = j % per;
        const a = g[j0 * per + i0], b = g[j0 * per + i1], c = g[j1 * per + i0], d = g[j1 * per + i1];
        return a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy;
      };
      [[16, 32, 64], [8, 16, 32], [4, 8, 16], [12, 24, 48]].forEach((pers, ch) => {
        const ls = pers.map(lattice), out = new Float32Array(S * S);
        let lo = 1e9, hi = -1e9;
        for (let j = 0; j < S; j++) for (let i = 0; i < S; i++) {
          let v = 0; pers.forEach((per, k) => { v += at(ls[k], per, i / S, j / S) * wts[k]; });
          out[j * S + i] = v; if (v < lo) lo = v; if (v > hi) hi = v;
        }
        for (let k = 0; k < S * S; k++) data[k * 4 + ch] = Math.round(((out[k] - lo) / (hi - lo)) * 255);
      });
      gl.activeTexture(gl.TEXTURE3); gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, S, S, 0, gl.RGBA, gl.UNSIGNED_BYTE, data); gl.generateMipmap(gl.TEXTURE_2D);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.REPEAT);
      gl.activeTexture(gl.TEXTURE0);
    }

    // Static meshes, small helper meshes, the shared index buffers.
    const M = { world: upload(W.world), ground: upload(W.ground), decal: upload(W.decal), marks: upload(W.marks), lights: upload(W.lights), beacon: upload(W.beacon), lamp: upload(W.lampB), clouds: upload(W.clouds) };
    const unit = new Builder(); unit.box([0, 0, 0], [1, 1, 1], [1, 1, 1]); const boxMesh = upload(unit);
    const dsc = new Builder(); for (let i = 0; i < 14; i++) { const a0 = (i / 14) * 6.2832, a1 = ((i + 1) / 14) * 6.2832; dsc.tri([0, 0, 0], [Math.cos(a0), 0, Math.sin(a0)], [Math.cos(a1), 0, Math.sin(a1)], [1, 1, 1], [0, -1, 0]); }
    const discMesh = upload(dsc);
    const sk = new Builder(); for (let i = 0; i < 4; i++) sk.cone([0, i * 0.95, 0], 0.62 - i * 0.09, 0.62 - (i + 1) * 0.09, 0.95, i % 2 ? [0.96, 0.96, 0.96] : [1, 0.45, 0.1], 8);
    const sockMesh = upload(sk);
    const idxBuf = [0, 1, 2, 3].map((L) => { const b = gl.createBuffer(); gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, b); gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, lodIndices(L).data, gl.STATIC_DRAW); return b; });
    const quadBuf = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, quadBuf); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, 1, 1, -1, -1, 1, 1, -1, 1]), gl.STATIC_DRAW);
    const sheetBuf = gl.createBuffer();       // sea beyond the edge of the world: four slabs round it
    {
      const E = WORLD + 1, F = 60000, d = [], Q = (x0, x1, z0, z1) => d.push(x0, WATER, z0, 40, x1, WATER, z0, 40, x1, WATER, z1, 40, x0, WATER, z0, 40, x1, WATER, z1, 40, x0, WATER, z1, 40);
      Q(-F, F, -F, -E); Q(-F, F, E, F); Q(-F, -E, -E, E); Q(E, F, -E, E);
      gl.bindBuffer(gl.ARRAY_BUFFER, sheetBuf); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(d), gl.STATIC_DRAW);
    }

    function ensureMesh(c, L) {
      const m = buildChunkMesh(W, c, L);
      const vb = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, vb); gl.bufferData(gl.ARRAY_BUFFER, m.buf, gl.STATIC_DRAW);
      let wb = null;
      if (m.wbuf) { wb = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, wb); gl.bufferData(gl.ARRAY_BUFFER, m.wbuf, gl.STATIC_DRAW); }
      c.lod[L] = { vb, wb };
      c.ymin = c.ymin == null ? m.ymin : Math.min(c.ymin, m.ymin); c.ymax = c.ymax == null ? m.ymax : Math.max(c.ymax, m.ymax);
    }
    function ensureTrees(c) {
      if (!c.obj) populateChunk(W, c);
      c.treesGL = { near: c.near ? upload({ d: c.near }) : null, far: c.far ? upload({ d: c.far }) : null };
    }
    /// Build what is certainly needed first: every chunk coarsely, finer ones near (x, z).
    function prime(x, z) {
      for (let cj = 0; cj < TNC; cj++) for (let ci = 0; ci < TNC; ci++) {
        const c = chunkOf(W, ci, cj), d = Math.hypot(c.x0 + TCS / 2 - x, c.z0 + TCS / 2 - z) - 600;
        if (!c.lod[3]) ensureMesh(c, 3);
        if (d < 6800 && !c.lod[2]) ensureMesh(c, 2);
        if (d < 3600 && !c.lod[1]) ensureMesh(c, 1);
        if (d < 1700 && !c.lod[0]) ensureMesh(c, 0);
        if (d < 2400 && !c.treesGL) ensureTrees(c);
      }
    }
    prime(0, -300);

    const planes = new Float32Array(24);
    function extractPlanes(m) {
      let i = 0;
      for (const k of [0, 1, 2]) for (const s of [1, -1]) {
        const a = m[3] + s * m[k], b = m[7] + s * m[4 + k], c = m[11] + s * m[8 + k], d = m[15] + s * m[12 + k], l = Math.hypot(a, b, c) || 1;
        planes[i++] = a / l; planes[i++] = b / l; planes[i++] = c / l; planes[i++] = d / l;
      }
    }
    const visible = (x, y, z, r) => { for (let i = 0; i < 24; i += 4) if (planes[i] * x + planes[i + 1] * y + planes[i + 2] * z + planes[i + 3] < -r) return false; return true; };

    const windOf = (ctx) => {
      const w = ctx.wind, s = ctx.t / 1000;
      if (Array.isArray(w) && w.length >= 3) return [w[0], w[2]];
      if (Array.isArray(w) && w.length === 2) return [w[0], w[1]];
      if (w && typeof w === 'object') {
        if (w.x != null) return [w.x, w.z ?? 0];
        if (w.speed != null) { const dir = w.dir ?? w.from ?? 0; return [-Math.sin(dir) * w.speed, Math.cos(dir) * w.speed]; }
      }
      const sp = 4.5 + 2 * Math.sin(s / 7) + 1.2 * Math.sin(s / 2.3), a = 0.8 + 0.5 * Math.sin(s / 53);
      return [Math.cos(a) * sp, Math.sin(a) * sp];
    };
    const sockQ = (wx, wz) => {
      const sp = Math.hypot(wx, wz), k = clamp(sp / 6, 0.12, 1), ux = sp > 0.01 ? wx / sp : 1, uz = sp > 0.01 ? wz / sp : 0;
      const d = norm([ux * k, -(1 - k) * 0.9, uz * k]), ax = [d[2], 0, -d[0]], al = Math.hypot(ax[0], ax[2]);
      return al > 1e-4 ? qaxis([ax[0] / al, 0, ax[2] / al], Math.acos(clamp(d[1], -1, 1))) : qaxis([1, 0, 0], Math.PI);
    };

    function drawWorld(ctx) {
      const { eye, t } = ctx, ts = (t / 1000) % 6000;
      extractPlanes(ctx.vp);
      // ---- sky
      gl.disable(gl.DEPTH_TEST);
      gl.useProgram(SK.p);
      const f = norm(sub(ctx.at, eye)), rgt = norm(cross(f, ctx.up)), upv = cross(rgt, f), tf = Math.tan(ctx.fovy / 2);
      gl.uniform3fv(SK.u('camR'), rgt); gl.uniform3fv(SK.u('camU'), upv); gl.uniform3fv(SK.u('camF'), f);
      gl.uniform2f(SK.u('tn'), tf * ctx.aspect, tf); gl.uniform3fv(SK.u('sun'), SUN); gl.uniform3fv(SK.u('haze'), HAZE);
      gl.disableVertexAttribArray(1); gl.disableVertexAttribArray(2);
      gl.bindBuffer(gl.ARRAY_BUFFER, quadBuf); gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
      gl.drawArrays(gl.TRIANGLES, 0, 6);
      gl.enable(gl.DEPTH_TEST);

      // ---- ground chunks
      gl.useProgram(T.p);
      gl.uniformMatrix4fv(T.u('vp'), false, ctx.vp); gl.uniform3fv(T.u('cam'), eye); gl.uniform3fv(T.u('fogc'), HAZE); gl.uniform3fv(T.u('sun'), SUN);
      gl.uniform1f(T.u('fogFar'), FOG_FAR); gl.uniform1i(T.u('tx'), 3);
      for (let k = 0; k < 3; k++) gl.enableVertexAttribArray(k);
      gl.activeTexture(gl.TEXTURE3); gl.bindTexture(gl.TEXTURE_2D, tex); gl.activeTexture(gl.TEXTURE0);
      const need = [], vis = [];
      for (let cj = 0; cj < TNC; cj++) for (let ci = 0; ci < TNC; ci++) {
        const cx = -WORLD + (ci + 0.5) * TCS, cz = -WORLD + (cj + 0.5) * TCS, d = Math.hypot(cx - eye[0], cz - eye[2]) - 600;
        if (d > FOG_FAR + 600) continue;
        const c = chunkOf(W, ci, cj), y0 = (c.ymin ?? -70) - 40, y1 = (c.ymax ?? 1900) + 60;
        if (!visible(cx, (y0 + y1) / 2, cz, Math.hypot(724, (y1 - y0) / 2))) continue;
        const want = d < 1500 ? 0 : d < 3200 ? 1 : d < 6200 ? 2 : 3;
        let L = want;
        if (!c.lod[L]) {
          need.push([d, c, L]);
          L = -1; for (let o = 1; o < 4 && L < 0; o++) { if (want - o >= 0 && c.lod[want - o]) L = want - o; else if (want + o < 4 && c.lod[want + o]) L = want + o; }
          if (L < 0) continue;
        }
        vis.push([c, L, d]);
        const lod = c.lod[L];
        gl.bindBuffer(gl.ARRAY_BUFFER, lod.vb);
        gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 20, 0); gl.vertexAttribPointer(1, 4, gl.BYTE, true, 20, 12); gl.vertexAttribPointer(2, 4, gl.UNSIGNED_BYTE, true, 20, 16);
        gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, idxBuf[L]);
        gl.drawElements(gl.TRIANGLES, lodIndices(L).data.length, gl.UNSIGNED_SHORT, 0);
      }
      // Build what is missing, nearest first, within a few milliseconds a frame.
      {
        const t0 = performance.now(); need.sort((a, b) => a[0] - b[0]);
        for (const [, c, L] of need) { if (performance.now() - t0 > 5) break; if (!c.lod[L]) ensureMesh(c, L); }
        if (performance.now() - t0 < 6) for (const [c, , d] of vis) if (d < 3800 && !c.treesGL) { ensureTrees(c); break; }
      }

      // ---- everything drawn with the ordinary shader
      gl.useProgram(prog);
      gl.uniformMatrix4fv(U.vp, false, ctx.vp);
      gl.enable(gl.POLYGON_OFFSET_FILL);
      gl.polygonOffset(-1, -1); draw(M.ground, I, [1, 1, 1], 0);
      gl.polygonOffset(-2, -2); draw(M.decal, I, [1, 1, 1], 0);
      gl.polygonOffset(-4, -4); draw(M.marks, I, [1, 1, 1], 0);
      gl.disable(gl.POLYGON_OFFSET_FILL);
      draw(M.world);
      for (const [c, , d] of vis) {
        const g = c.treesGL; if (!g) continue;
        if (d < 1700) { draw(g.near); draw(g.far && !g.near ? g.far : null); } else if (d < 4800) draw(g.far);
      }
      draw(M.lights, I, [1, 1, 1], 0.9);
      const blink = Math.sin(t * 0.0063) > 0.3 ? 1 : 0.15;
      draw(M.beacon, I, [1, 1, 1], blink);
      draw(M.lamp, I, [1, 1, 1], 0.2 + 0.9 * Math.pow(Math.max(0, Math.sin(t * 0.0021)), 6));
      for (const tb of W.turbines) draw(rotorMesh, model(qaxis([0, 0, 1], t * 0.0012 + tb.phase), tb.hub));
      // PAPI: red over white by the glide angle (white high, red low), per lamp.
      {
        const P = ctx.planePos, thr = [2.5, 2.83, 3.17, 3.5];
        for (const set of W.papi) {
          const D = (P[2] - set.units[0][2]) * -set.dir, ang = D > 40 && D < 14000 ? Math.atan2(P[1] - 1.5, D) / DEG : 9;
          set.units.forEach((u, k) => draw(boxMesh, model([0, 0, 0, 1], [u[0], u[1], u[2]], 1.7), ang > thr[k] ? [1, 1, 1] : [1, 0.12, 0.08], 1.2));
        }
      }
      // Windsocks.
      {
        const [wx, wz] = windOf(ctx), q = sockQ(wx, wz);
        for (const s of W.socks) draw(sockMesh, model(q, s.pos), [1, 1, 1], 0.1);
      }
      // Clouds drift slowly with the wind.
      draw(M.clouds, model([0, 0, 0, 1], [t * 0.0035, 0, t * 0.0012]), [1, 1, 1], 0.25);
      // A soft shadow under the plane that spreads and fades with height.
      if (ctx.shadow) {
        const P = ctx.planePos, g = groundAt(W, P[0], P[2]), hgt = P[1] - g;
        if (hgt < 700 && g > WATER) {
          const n = normalAt(W, P[0], P[2], 4), ax = [n[2], 0, -n[0]], al = Math.hypot(ax[0], ax[2]);
          const q = al > 1e-4 ? qaxis([ax[0] / al, 0, ax[2] / al], Math.acos(clamp(n[1], -1, 1))) : [0, 0, 0, 1];
          gl.enable(gl.BLEND); gl.depthMask(false); gl.enable(gl.POLYGON_OFFSET_FILL); gl.polygonOffset(-6, -6);
          gl.uniform1f(U.alpha, 0.42 / (1 + hgt / 60));
          draw(discMesh, model(q, [P[0], g + 0.2, P[2]], ctx.shadow * (1.2 + hgt * 0.012)), [0, 0, 0], 0);
          gl.uniform1f(U.alpha, 1); gl.depthMask(true); gl.disable(gl.BLEND); gl.disable(gl.POLYGON_OFFSET_FILL);
        }
      }

      // ---- water, last: translucent, with depth-based colour, glint and shore foam
      gl.useProgram(WA.p);
      gl.uniformMatrix4fv(WA.u('vp'), false, ctx.vp); gl.uniform3fv(WA.u('cam'), eye); gl.uniform3fv(WA.u('fogc'), HAZE); gl.uniform3fv(WA.u('sun'), SUN);
      gl.uniform1f(WA.u('fogFar'), FOG_FAR); gl.uniform1f(WA.u('time'), ts); gl.uniform1i(WA.u('tx'), 3);
      gl.disableVertexAttribArray(1); gl.disableVertexAttribArray(2); gl.enableVertexAttribArray(0);
      gl.enable(gl.BLEND); gl.depthMask(false);
      gl.bindBuffer(gl.ARRAY_BUFFER, sheetBuf); gl.vertexAttribPointer(0, 4, gl.FLOAT, false, 16, 0); gl.drawArrays(gl.TRIANGLES, 0, 24);
      for (const [c, L] of vis) {
        const lod = c.lod[L]; if (!lod.wb) continue;
        gl.bindBuffer(gl.ARRAY_BUFFER, lod.wb); gl.vertexAttribPointer(0, 4, gl.FLOAT, false, 16, 0);
        gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, idxBuf[L]); gl.drawElements(gl.TRIANGLES, lodIndices(L).grid, gl.UNSIGNED_SHORT, 0);
      }
      gl.depthMask(true); gl.disable(gl.BLEND);
      gl.useProgram(prog);
    }
    return { draw: drawWorld, prime };
  }

  // ------------------------------------------------------------------ flight model

  // Not a study sim, but the real ingredients: lift follows the angle of attack up a lift curve and falls away at the
  // stall (with buffet first, then a wing drop, and in light planes a spin); drag is parasitic (speed²), induced (lift²,
  // less in ground effect) and grows with flaps and gear; the air thins with height (so true speed outruns indicated
  // speed and engines lose thrust); wind, gusts and turbulence push the plane about; heavy aircraft answer slowly; too
  // many g or too much speed breaks the wings. On the ground each wheel is a spring and damper, so a hard landing
  // bounces, brakes dip the nose, grass drags and a collapsed leg means a belly slide. Anything worse than that becomes
  // a rigid-body wreck that keeps its momentum, tumbles and slides until it stops.
  const G = 9.81;
  /// Air density relative to sea level at a height in metres.
  const densityAt = (h) => Math.exp(-Math.max(0, h) / 9500);
  /// What the ground is like: a wheel's rolling resistance, tyre grip, and how hard a sliding belly grabs.
  const SURFACES = {
    // `soft` is how readily a nose wheel digs in. The names are the ones surfaceAt gives.
    runway: { roll: 0.02, grip: 1.0, skid: 0.55, soft: 0 },
    road: { roll: 0.03, grip: 0.9, skid: 0.6, soft: 0 },
    grass: { roll: 0.085, grip: 0.7, skid: 0.8, soft: 1 },
    forest: { roll: 0.15, grip: 0.6, skid: 0.9, soft: 1.2 },
    sand: { roll: 0.16, grip: 0.5, skid: 0.9, soft: 1.5 },
    snow: { roll: 0.11, grip: 0.35, skid: 0.4, soft: 0.7 },
    rock: { roll: 0.14, grip: 0.6, skid: 0.95, soft: 1.2 },
  };
  const gauss = () => (Math.random() + Math.random() + Math.random() - 1.5) * 2;
  /// Lift coefficient rounding off smoothly towards its peak `pk`.
  const satCl = (x, pk) => (x < 0.85 * pk ? x : pk - 0.15 * pk * Math.exp(-(x - 0.85 * pk) / (0.15 * pk)));
  const WHAT = { ground: 'Flew into terrain', terrain: 'Hit the hillside', water: 'Ditched in the water', tree: 'Hit a tree',
    building: 'Flew into a building', bridge: 'Hit the bridge', turbine: 'Hit a wind turbine', mast: 'Hit the radio mast',
    hangar: 'Hit a hangar', tower: 'Hit the control tower', flip: 'Flipped over', nose: 'Dived nose-first into the ground', crash: 'Crashed' };

  class Flight {
    constructor(spec) {
      this.s = spec;
      const clMax = 1.35;
      this.k = G / (spec.stall * spec.stall * clMax);          // lift per (v² · CL)
      this.clMax = clMax; this.clSlope = 5.2;                    // per radian
      const clLevel = G / (this.k * spec.max * spec.max);
      this.ki = 0.06;
      this.cd0 = spec.thrust / (this.k * spec.max * spec.max) - this.ki * clLevel * clLevel;
      // Heavy aircraft answer the controls slowly (response rate, 1/s).
      this.agil = 5 - 2 * clamp((spec.stall - 24) / 46, 0, 1);
      this.turb = 1;
      this.buildGear();
      this.reset([0, spec.gear, 0], 0, 0, true, 0);
    }
    /// Contact points (body axes, x right, y up, -z forward): three wheels on springs, and the structure that scrapes
    /// when they fail: wing tips, tail, nose, belly, engine pods and the roof.
    buildGear() {
      const s = this.s, k = s.scale || 1, g = s.gear * k;
      const T = Math.max(0.24, 0.3 * g), x0 = 0.35 * T;                        // travel and static compression
      const mainZ = 0.12 * Math.abs(s.nose) * k, noseZ = 0.62 * s.nose * k;
      const track = Math.max(1.0, s.span * 0.28) * k;
      const wN = mainZ / (mainZ - noseZ), wM = (1 - wN) / 2;                  // share of the weight each wheel carries
      const yW = -(g + x0), belly = (0.45 + 0.1 * s.gear) * k;
      const tailY = (s.tail * k - mainZ) * Math.tan((s.tailPitch || 12) * DEG) + yW;   // so the tail strikes at tailPitch
      const Ct = 0.3 * Math.sqrt(G / x0);                                     // total damper (damping ratio 0.35: a hard landing bounces)
      const wheel = (id, r, share) => ({ id, kind: 'w', r, k: (G * share) / x0, c: Ct * share, on: false, vi: 0, vt: 0, Fn: 0 });
      const hard = (id, kind, r) => ({ id, kind, r, k: 900, c: 55, on: false, vi: 0, vt: 0, Fn: 0 });
      this.pts = [
        wheel('N', [0, yW, noseZ], wN), wheel('ML', [-track, yW, mainZ], wM), wheel('MR', [track, yW, mainZ], wM),
        hard('L', 's', [-s.span * k, s.wingY * k, s.wingZ * k]), hard('R', 's', [s.span * k, s.wingY * k, s.wingZ * k]),
        hard('T', 's', [0, tailY, s.tail * k]), hard('nose', 's', [0, -belly * 0.6, s.nose * k * 0.95]),
        hard('bf', 'b', [0, -belly, s.nose * k * 0.55]), hard('bm', 'b', [0, -belly, mainZ]), hard('ba', 'b', [0, -belly, s.tail * k * 0.6]),
        hard('pL', 'b', [-track * 0.9, -belly - 0.1 * k, mainZ - 0.6 * k]), hard('pR', 'b', [track * 0.9, -belly - 0.1 * k, mainZ - 0.6 * k]),
        hard('rf', 'r', [0, belly * 1.9, s.nose * k * 0.4]), hard('rm', 'r', [0, belly * 1.9, 0]), hard('ra', 'r', [0, belly * 1.9, s.tail * k * 0.6]),
      ];
      this.T = T; this.x0 = x0;
      this.bound = Math.max(...this.pts.map((p) => len(p.r)));
      const L = (s.tail - s.nose) * k;
      this.I = [Math.pow(0.26 * L, 2), Math.pow(0.26 * L, 2), Math.pow(0.5 * s.span * k, 2)];   // pitch, yaw, roll (per unit mass)
      this.gearSink = clamp(6.6 - (s.stall - 24) * 0.025, 5.2, 6.6);            // sink rate (m/s) a wheel can take
      this.brakeMu = 0.55 - 0.1 * clamp((s.stall - 24) / 46, 0, 1);
      this.nrm = [0, 1, 0];
    }
    /// `wind` (m/s) overrides the random steady wind (0 to 5 m/s, from a random direction).
    reset(pos, heading, speed, onGround, wind) {
      this.pos = pos; this.q = qheading(heading, onGround ? 0 : 0.02);
      this.windSpd = wind != null ? wind : Math.random() * 5; this.windFrom = Math.random() * Math.PI * 2;
      const wx = -Math.sin(this.windFrom) * this.windSpd, wz = Math.cos(this.windFrom) * this.windSpd;
      this.wv = [wx, 0, wz]; this.tb = [0, 0, 0]; this.rough = 0; this.roughT = 0; this.gustT = 3 + Math.random() * 8; this.gustPh = -1; this.gustLen = 3; this.gustAmp = 0;
      this.vel = add(mul(qrot(this.q, [0, 0, -1]), speed), onGround ? v3() : [wx, 0, wz]);
      this.w = v3(); this.throttle = onGround ? 0 : 0.7; this.flaps = 0; this.brake = false; this.onGround = onGround;
      this.crashed = false; this.stalled = false; this.aoa = 0; this.beta = 0; this.gload = 1; this.touch = null; this.sinkAtTouch = 0;
      this.ias = speed; this.tas = speed; this.sigma = 1; this.t = 0;
      // What still works: each wing, the engine (and how much power it still makes), the undercarriage, the nose leg, the tyres.
      this.damage = { L: true, R: true, engine: true, power: 1, gear: true, tail: 1, nose: true, tyreL: false, tyreR: false };
      this.fuel = this.s.fuel || 1800; this.tailT = 0; this.flapNotch = 0; this.fuelOut = false;
      // The airliners fold their undercarriage away after take-off (the light aircraft have fixed wheels). Starting in
      // the air, they begin with it up; the Landing challenge makes you put it down.
      const up = !onGround && !!this.s.retract;
      this.gearDown = !up; this.gearPos = up ? 0 : 1; this.gearSpeedT = 0;
      this.events = []; this.stress = 0; this.flutter = 0; this.why = ''; this.impactVel = v3();
      // stall, spin, g and structure
      this.sd = 0; this.stallT = 0; this.stallDir = 1; this.inStall = false; this.stallAgl = 0; this.lastStall = -99; this.buffet = 0;
      this.spin = 0; this.spinAgl = 0; this.spinEnd = -99; this.recT = 0; this.blackout = 0; this.maxG = 1; this.minG = 1; this.structFail = null;
      // ground
      this.noContactT = onGround ? 0 : 1; this.airT = onGround ? 0 : 1; this.everDown = !!onGround; this.surface = SURFACES.runway; this.gGear = 0; this.maxGGear = 1;
      this.scrapeI = 0; this.scrapePos = v3(); this.noseStress = 0; this.gearEvent = null; this.bumpT = 0; this.wet = 0;
      for (const P of this.pts) { P.on = false; P.vi = 0; P.vt = 0; P.Fn = 0; }
      // wreck
      this.info = null; this.report = null; this.breakQ = []; this.wreckT = 0; this.rest = false; this.restT = 0; this.buoy = 1; this.wetT = 0; this.wreckTouch = 0;
    }
    /// The g meter: the wings' load plus whatever the wheels are adding on the runway.
    get gTotal() { return this.gload + this.gGear; }
    axes() { return { f: qrot(this.q, [0, 0, -1]), u: qrot(this.q, [0, 1, 0]), r: qrot(this.q, [1, 0, 0]) }; }
    get speed() { return len(this.vel); }
    get pitchAngle() { return Math.asin(clamp(this.axes().f[1], -1, 1)); }
    get bank() { const a = this.axes(); return Math.atan2(-a.r[1], a.u[1]); }
    get heading() { const f = this.axes().f; return Math.atan2(f[0], -f[2]); }
    get wings() { return (this.damage.L ? 0.5 : 0) + (this.damage.R ? 0.5 : 0); }

    /// The gear lever. Returns what happened: 'up', 'down', or why not ('fixed', 'broken', 'ground').
    toggleGear() {
      if (!this.s.retract) return 'fixed';
      if (!this.damage.gear) return 'broken';
      if (this.onGround) return 'ground';
      this.gearDown = !this.gearDown;
      return this.gearDown ? 'down' : 'up';
    }
    /// 'DOWN' (three greens), 'TRANSIT', 'UP', 'BROKEN' or 'FIXED'.
    get gearState() {
      if (!this.s.retract) return 'FIXED';
      if (!this.damage.gear) return 'BROKEN';
      return this.gearPos > 0.99 ? 'DOWN' : this.gearPos < 0.01 ? 'UP' : 'TRANSIT';
    }

    /// The engine stops (or, partly, runs rough at a fraction of its power).
    failEngine(partial = false) {
      if (!this.damage.engine && !partial) return;
      if (partial) this.damage.power = Math.min(this.damage.power, 0.35);
      else { this.damage.engine = false; this.damage.power = 0; }
    }
    loseWing(side, cause) {
      if (!this.damage[side]) return;
      this.damage[side] = false;
      if (cause === 'overg') this.structFail = { t: this.t, text: `Structural failure: ${Math.abs(this.gload).toFixed(1)} g` };
      else if (cause === 'overspeed') this.structFail = { t: this.t, text: `Structural failure: ${(this.ias * 3.6).toFixed(0)} km/h, over the speed limit` };
      this.events.push({ type: 'wing', side, cause });
    }
    breakTail() {
      if (this.damage.tail <= 0) return;
      this.damage.tail = 0; this.events.push({ type: 'tail', health: 0, sev: 1 });
    }

    /// Steady wind plus gusts plus turbulence, which grows near the ground and over rough country. Sets this.wv.
    windStep(dt, agl, world) {
      this.roughT -= dt;
      if (this.roughT <= 0) {
        this.roughT = 0.6;
        const x = this.pos[0], z = this.pos[2];
        const a = terrainAt(world, x + 90, z), b = terrainAt(world, x - 90, z), c = terrainAt(world, x, z + 90), d = terrainAt(world, x, z - 90);
        this.rough = clamp((Math.max(a, b, c, d) - Math.min(a, b, c, d)) / 60, 0, 1.5);
      }
      const spd = this.windSpd, low = Math.exp(-Math.max(agl, 0) / 260);
      const sig = this.turb * (0.1 + 0.07 * spd + low * (0.35 + 0.55 * this.rough) * (0.6 + 0.1 * spd));
      this.gustT -= dt;
      if (this.gustT <= 0 && this.gustPh < 0) { this.gustPh = 0; this.gustLen = 2 + Math.random() * 3; this.gustAmp = (0.15 + Math.random() * 0.45) * (0.4 + spd * 0.3) * this.turb; }
      let gust = 0;
      if (this.gustPh >= 0) {
        this.gustPh += dt;
        if (this.gustPh >= this.gustLen) { this.gustPh = -1; this.gustT = 5 + Math.random() * 15; }
        else gust = Math.sin(Math.PI * this.gustPh / this.gustLen) * this.gustAmp;
      }
      const a1 = Math.exp(-dt / 1.6), b1 = sig * Math.sqrt(1 - a1 * a1);
      this.tb[0] = this.tb[0] * a1 + b1 * gauss(); this.tb[1] = this.tb[1] * a1 + b1 * gauss(); this.tb[2] = this.tb[2] * a1 + b1 * gauss();
      const bl = 0.45 + 0.55 * (1 - Math.exp(-Math.max(agl, 0) / 40));      // the wind is weaker right at the surface
      const base = (spd + gust) * bl;
      this.wv[0] = -Math.sin(this.windFrom) * base + this.tb[0];
      this.wv[1] = this.onGround ? 0 : this.tb[1] * 0.45;
      this.wv[2] = Math.cos(this.windFrom) * base + this.tb[2];
    }

    step(dt, input, world) {
      if (this.crashed) { this.stepWreck(dt, world); return; }
      const s = this.s, { f, u, r } = this.axes();
      this.t += dt;
      const gh0 = groundAt(world, this.pos[0], this.pos[2]);
      const agl = this.pos[1] - s.gear - gh0;
      const sigma = densityAt(this.pos[1]);
      this.windStep(dt, agl, world);
      // The airflow: the plane's motion through the moving air. V is true airspeed, Vi what the airspeed indicator says.
      const rel = sub(this.vel, this.wv);
      const V = len(rel), Vi = V * Math.sqrt(sigma);
      this.tas = V; this.ias = Vi; this.sigma = sigma;
      const vhat = V > 0.1 ? mul(rel, 1 / V) : f;
      const vb = qrot(qconj(this.q), rel);
      this.aoa = V > 1 ? Math.atan2(-vb[1], -vb[2]) : 0;
      const beta = V > 1 ? Math.atan2(vb[0], -vb[2]) : 0;
      this.beta = beta;
      const flaps = this.flaps, wings = this.wings;

      // ---- lift: a straight line up the lift curve that rounds off at the stall, then drops away; after the stall
      // the wing behaves like a flat plate.
      const stallAoa = (15 + flaps * 3) * DEG, a = this.aoa, aa = Math.abs(a);
      const peak = this.clMax + flaps * 0.35, peakN = this.clMax * 0.9;
      let cl;
      if (aa <= stallAoa) cl = a >= 0 ? satCl(this.clSlope * a + flaps * 0.35, peak) : -satCl(Math.max(0, this.clSlope * aa - flaps * 0.35), peakN);
      else {
        const c0 = a >= 0 ? satCl(this.clSlope * stallAoa + flaps * 0.35, peak) : satCl(Math.max(0, this.clSlope * stallAoa - flaps * 0.35), peakN);
        const m = Math.max(c0 - 5.5 * (aa - stallAoa), 1.05 * Math.sin(2 * Math.min(aa, Math.PI / 2)), 0.2);
        cl = a >= 0 ? m : -m * 0.9;
      }
      // Ground effect: close to the ground the wing sheds less induced drag and carries a little more lift.
      const hGE = Math.max(0, agl), x16 = (16 * hGE) / (2 * s.span * (s.scale || 1)), phi = (x16 * x16) / (1 + x16 * x16);
      cl *= 1 + 0.15 * (1 - phi);
      const kiEff = this.ki * (0.35 + 0.65 * phi);
      // The stall: buffet as the angle nears the limit, then the break (the nose drops and a wing drops).
      const airborne = !this.onGround, stallNow = airborne && Vi > 4 && aa > stallAoa;
      this.stalled = stallNow;
      this.buffet = airborne && Vi > 4 ? clamp((aa - 0.78 * stallAoa) / (0.22 * stallAoa), 0, 1) : 0;
      if (stallNow && !this.inStall) {
        this.inStall = true; this.stallAgl = agl;
        this.stallDir = Math.abs(this.bank) > 3 * DEG ? Math.sign(this.bank) : Math.abs(beta) > 1.5 * DEG ? Math.sign(beta) : input.roll !== 0 ? Math.sign(input.roll) : input.yaw !== 0 ? Math.sign(input.yaw) : (Math.random() < 0.5 ? -1 : 1);
      } else if (!stallNow && aa < stallAoa * 0.85) this.inStall = false;
      if (stallNow) { this.stallT += dt; this.lastStall = this.t; } else this.stallT = Math.max(0, this.stallT - dt * 2);
      const sdT = stallNow ? clamp((aa - stallAoa) / (7 * DEG), 0.15, 1) : 0;
      this.sd += (sdT - this.sd) * (1 - Math.exp(-dt * (sdT > this.sd ? 3 : 2.5)));

      // ---- drag: parasitic (speed²), induced (lift²), flaps, gear, the flat plate after the stall, a dead propeller
      const gearK = s.retract ? 0.92 + 0.22 * this.gearPos : 1;
      let cd = this.cd0 * (1 + flaps * 1.6) * gearK + kiEff * cl * cl * wings + (this.brake && !this.onGround ? 0.06 : 0) + (wings < 1 ? 0.02 : 0);
      if (stallNow) cd += 0.9 * Math.pow(Math.sin(Math.min(aa, Math.PI / 2)), 2);
      if (this.spin) cd += 0.55;
      if (!this.damage.engine && s.engine === 'piston') cd += 0.012;
      const q = this.k * Vi * Vi;
      // Lift is perpendicular to the airflow, in the plane of the wings' "up"; a missing wing takes its half away.
      let liftDir = sub(u, mul(vhat, dot(u, vhat)));
      liftDir = len(liftDir) > 1e-4 ? norm(liftDir) : u;
      const lift = mul(liftDir, q * cl * wings);
      const drag = mul(vhat, -q * cd);
      const side = mul(r, -q * Math.sin(beta) * 0.6);         // the fuselage resists skidding
      // ---- thrust: jets keep their push with speed but lose it with the thin air; propellers lose power and
      // thrust fades faster with speed.
      const power = this.damage.engine ? this.damage.power : 0;
      const jet = s.engine === 'jet', rT = clamp(V / s.max, 0, 1.4);
      const lapse = jet ? Math.pow(sigma, 0.85) : clamp((sigma - 0.12) / 0.88, 0.2, 1);
      const thrust = mul(f, this.throttle * power * s.thrust * (jet ? 1.15 - 0.22 * rT : 1.2 - 0.35 * rT) * lapse * (this.spin ? 0.5 : 1));
      const acc = add(add(add(lift, drag), add(side, thrust)), [0, -G, 0]);
      this.gload = dot(add(acc, [0, G, 0]), u) / G;
      if (this.gload > this.maxG) this.maxG = this.gload;
      if (this.gload < this.minG) this.minG = this.gload;

      // ---- rotation: what you ask for (weaker when slow) plus the aircraft's own stability pulling the nose into the wind.
      const eff = clamp((Vi - s.stall * 0.35) / (s.cruise - s.stall * 0.35), 0.08, 1.25);
      const stab = s.stability * clamp(Vi / s.cruise, 0, 1.5);
      // Pitch asks for an angle of attack (full stick ≈ the plane's limit, near the stall), so it feels the same at
      // every speed: the nose comes round quickly when fast and mushes when slow, and over-pulling still stalls.
      // Hands off, it keeps its current climb or descent, and holds height in a bank (a friendly autotrim). On the
      // wheels there is no trim: the nose only comes up when you pull.
      const stabT = stab * 0.9 + 0.4, path = this.k * sigma * V * this.clSlope * Math.max(wings, 0.05);
      // Fast, the stick stops short of the stall; slow, full back pulls the wing past it.
      const aMax = stallAoa * s.authority * (1 + 0.4 * clamp((1.35 - Vi / s.stall) / 0.35, 0, 1));
      const gamma = Math.asin(clamp(vhat[1], -1, 1));
      const need = G * Math.cos(gamma) / Math.max(Math.cos(this.bank), 0.5);
      const trim = V > 1 && !this.onGround && wings > 0 ? clamp((need / (Math.max(q, 1e-3) * wings) - flaps * 0.35) / this.clSlope, -0.05, aMax * 0.85) : 0;
      const aCmd = input.pitch >= 0 ? trim + input.pitch * (aMax - trim) : trim + input.pitch * (trim + aMax * 0.55);
      const intact = wings === 1;
      const tailF = 0.3 + 0.7 * this.damage.tail;      // a scraped tail makes the elevator and rudder weaker
      const target = [
        clamp(aCmd * (stabT + path) - this.aoa * stabT + (V > 5 && !this.onGround ? this.k * sigma * V * flaps * 0.35 - G * Math.cos(gamma) / V : 0), -s.pitch * 1.6, s.pitch * 1.6),
        -input.yaw * s.yaw * eff - beta * stab,
        -input.roll * s.roll * eff * Math.max(wings, 0.3) * (1 - 0.6 * this.sd),
      ];
      // Adverse yaw (the rising wing drags back) and, on single-engine propeller planes, a little torque and p-factor
      // that pull the nose left under power at low speed.
      if (!this.onGround) target[1] += input.roll * 0.12 * eff;
      if (s.engine === 'piston') target[1] += this.throttle * power * (1 - clamp(Vi / s.cruise, 0, 1)) * (this.onGround ? 0.025 : 0.07);
      if (this.damage.tail < 1) { target[0] *= tailF; target[1] *= tailF; if (this.damage.tail <= 0) target[0] -= 0.3; }
      // Wing leveller: with the roll keys released, the wings roll back to level by themselves (positive roll
      // rate is to the left, and a positive bank is right wing down, so the bank itself is the correction).
      // Only hands off and not upside down, so loops and inverted flight still work.
      if (input.roll === 0 && input.pitch === 0 && Math.abs(this.bank) < 100 * DEG && !this.onGround && intact && this.sd < 0.05 && !this.spin) {
        target[2] += Math.sin(this.bank) * 1.3 * clamp(Vi / s.cruise, 0.3, 1);
      }
      // A missing wing: all the lift is on the other side, so it rolls hard towards the stump.
      if (!intact && wings > 0) target[2] += (this.damage.L ? -1 : 1) * clamp(q * Math.abs(cl) / G, 0.3, 2.5) * 2.2;
      // The break: the nose drops and one wing drops with it (the one already low, or the one the skid or the stick
      // pointed to). A wing drop that is held becomes a spin in the light planes.
      if (this.sd > 0.02) {
        target[0] -= 0.35 * this.sd;
        target[2] -= this.stallDir * 0.9 * this.sd * (1 + 0.6 * Math.abs(input.yaw)) * (wings === 1 ? 1 : 0.4);
      }
      const spinProne = s.spin !== undefined ? s.spin : s.stall < 42;
      if (!this.spin) {
        if (spinProne && stallNow && this.stallT > 1.1 && Vi < s.stall * 1.3 && wings === 1) {
          const cue = (Math.abs(input.yaw) > 0.3 ? Math.sign(input.yaw) : 0) + (Math.abs(input.roll) > 0.6 ? Math.sign(input.roll) * 0.6 : 0) + (Math.abs(beta) > 6 * DEG ? Math.sign(beta) * 0.8 : 0) + (Math.abs(this.bank) > 25 * DEG ? Math.sign(this.bank) * 0.5 : 0);
          if (Math.abs(cue) > 0.45) { this.spin = Math.sign(cue); this.spinAgl = agl; this.recT = 0; this.events.push({ type: 'spin', dir: this.spin }); }
        }
      } else {
        // Autorotation: rolling and yawing the same way, nose well down, flat-plate drag holding it stalled. Recovery:
        // stick forward, and the opposite rudder or aileron.
        // The whole airframe turns about the vertical (so roll and yaw rates follow from the nose-down attitude).
        const sd = this.spin, fh = norm([f[0], 0, f[2]]), rh = cross(fh, [0, 1, 0]), corr = clamp((-0.85 - this.pitchAngle) * 1.5, -0.7, 0.7);
        const wb = qrot(qconj(this.q), [rh[0] * corr, -sd * 2.0, rh[2] * corr]);
        target[0] = wb[0]; target[1] = wb[1]; target[2] = wb[2];
        const anti = (-input.yaw * sd > 0.3) || (-input.roll * sd > 0.3);
        if (input.pitch < -0.25) this.recT += dt * (anti ? 1.6 : 0.7); else this.recT = Math.max(0, this.recT - dt * 0.5);
        if (this.recT > 1.6 || this.onGround) { this.spin = 0; this.spinEnd = this.t; this.stallT = 0; this.events.push({ type: 'spinend' }); }
      }
      if (this.onGround) {
        // The wheels and springs keep the wings level and the nose up or down; the nose wheel steers, less the faster it goes.
        const gs = len(this.vel), sf = clamp(gs / 3, 0, 1), maxYaw = 0.8 * G / Math.max(gs, 5);
        target[2] = 0;
        target[1] = clamp((-input.yaw * 0.6 - input.roll * 0.3) * sf, -maxYaw, maxYaw);
        if (s.engine === 'piston') target[1] += this.throttle * power * (1 - clamp(Vi / s.cruise, 0, 1)) * 0.025;
        if (Vi < s.stall * 0.7) { target[0] = Math.min(target[0], 0); if (this.damage.gear && this.damage.nose) target[0] -= this.pitchAngle * 3; }
      }
      // Heavies answer slowly. On the wheels the springs are free to rock the plane.
      const resp = 1 - Math.exp(-dt * this.agil);
      const rPitch = this.onGround ? 1 - Math.exp(-dt * Math.min(this.agil, 3.5)) : resp, rRoll = this.onGround ? 1 - Math.exp(-dt * 2) : resp;
      this.w[0] += (target[0] - this.w[0]) * rPitch; this.w[1] += (target[1] - this.w[1]) * resp; this.w[2] += (target[2] - this.w[2]) * rRoll;
      if (this.buffet > 0.05 || this.sd > 0.05) { const bf = Math.max(this.buffet * 0.5, this.sd); this.w[2] += (Math.random() - 0.5) * 0.12 * bf; this.w[0] += (Math.random() - 0.5) * 0.07 * bf; }
      const angle = len(this.w) * dt;
      if (angle > 1e-6) this.q = qnorm(qmul(this.q, qaxis(norm(this.w), angle)));

      this.throttle = clamp(this.throttle + input.throttle * dt * 0.6, 0, 1);
      // Fuel: burnt with the throttle, and the engine stops when the tank is dry.
      if (this.damage.engine && power > 0) {
        this.fuel = Math.max(0, this.fuel - this.throttle * dt - 0.04 * dt);
        if (this.fuel <= 0) { this.failEngine(); this.fuelOut = true; this.events.push({ type: 'fuel' }); }
      }
      this.tailT = Math.max(0, this.tailT - dt);
      this.bumpT = Math.max(0, this.bumpT - dt);
      // The undercarriage takes a few seconds to move; the wheels are not "out" until it has finished.
      if (s.retract) {
        const tg = this.gearDown ? 1 : 0;
        if (this.gearPos !== tg) {
          const step = dt / (s.gearTime || 4);
          this.gearPos = clamp(this.gearPos + clamp(tg - this.gearPos, -step, step), 0, 1);
          if (this.gearPos === tg) this.events.push({ type: 'gearmoved', down: this.gearDown });
        }
        if (this.gearPos > 0.05 && Vi > s.stall * 2.3 && !this.gearSpeedT) { this.gearSpeedT = 6; this.events.push({ type: 'gearspeed' }); }
        this.gearSpeedT = Math.max(0, (this.gearSpeedT || 0) - dt);
      }
      this.vel = add(this.vel, mul(acc, dt));
      this.pos = add(this.pos, mul(this.vel, dt));

      // ---- structure: pulling past the limit loads the wings up until one breaks (far past, at once); too fast with
      // big control inputs sets the wings fluttering. And the pilot's blood: blackout for hard pulls, redout for pushes.
      const gp = this.gload > 0 ? this.gload / s.gLimit : -this.gload / (s.gLimit * 0.5);
      if (gp > 1 && intact) {
        this.stress += (gp - 1) * dt * 2.5;
        if (this.stress > 1 || gp > 1.5) this.loseWing(this.bank > 0 ? 'R' : 'L', 'overg');
      } else this.stress = Math.max(0, this.stress - dt * 0.05);
      const stick = Math.max(Math.abs(input.pitch), Math.abs(input.roll));
      if (Vi > s.max * 1.05 && wings > 0) {
        this.flutter += dt * ((Vi / s.max - 1.05) * 8 + stick * 1.5);
        if (this.flutter > 1) { this.loseWing('L', 'overspeed'); this.loseWing('R', 'overspeed'); }
      } else this.flutter = Math.max(0, this.flutter - dt * 0.5);
      const gT = this.gload > 4.2 ? clamp((this.gload - 4.2) / 3, 0, 1) : this.gload < -1 ? -clamp((-1 - this.gload) / 2, 0, 1) : 0;
      this.blackout += clamp(gT - this.blackout, -dt * 0.9, dt * 0.55);

      if (this.collide(world)) return;
      if (this.contacts(dt, world, false)) return;
      if (this.pos[1] > 3000) { this.vel[1] = Math.min(this.vel[1], 0); }                  // ceiling
      const edge = WORLD - 600;
      if (Math.abs(this.pos[0]) > edge || Math.abs(this.pos[2]) > edge) this.pos = [clamp(this.pos[0], -edge, edge), this.pos[1], clamp(this.pos[2], -edge, edge)];
    }

    /// Wingtips, nose and tail against trees, buildings, the bridge and turbines. A wingtip strike tears that wing
    /// off; the nose or tail hitting something solid is the end. (The ground itself is handled by `contacts`.)
    collide(world) {
      const s = this.s, k = s.scale, V = this.speed;
      const pts = [['L', [-s.span * k, s.wingY * k, s.wingZ * k]], ['R', [s.span * k, s.wingY * k, s.wingZ * k]],
        ['N', [0, 0, s.nose * k]], ['T', [0, 0.5 * k, s.tail * k]]];
      for (const [part, local] of pts) {
        if ((part === 'L' || part === 'R') && !this.damage[part]) continue;
        const p = add(this.pos, qrot(this.q, local));
        const obj = hitObject(world, p);
        if (!obj) continue;
        if (part === 'L' || part === 'R') { this.loseWing(part, obj.kind); this.vel = mul(this.vel, 0.8); }
        else {
          const hd = V > 1 ? norm([this.vel[0], 0, this.vel[2]]) : this.axes().f;
          this.crash(obj.kind, { object: true, n: [-hd[0], 0, -hd[2]], vi: V * 0.85, vt: 0 }); return true;
        }
      }
      return false;
    }

    // ---------------------------------------------------------------- contacts: wheels, structure, wreck

    /// Is this contact point part of the airframe right now?
    pointActive(P, wreck) {
      if (P.kind === 'w') return !wreck && this.damage.gear && (!this.s.retract || this.gearPos > 0.9) && (P.id !== 'N' || this.damage.nose);
      if (P.id === 'L' || P.id === 'R') return this.damage[P.id];
      if (P.id === 'T') return this.damage.tail > 0;
      return true;
    }
    /// A force (m/s² for a unit mass) acting at a contact point: changes the velocity and, through the lever arm, the spin.
    applyForce(P, fx, fy, fz, dt) {
      this.vel[0] += fx * dt; this.vel[1] += fy * dt; this.vel[2] += fz * dt;
      const b = qrot(this.qi, [fx, fy, fz]), r = P.r, I = this.I;
      this.w[0] += ((r[1] * b[2] - r[2] * b[1]) / I[0]) * dt;
      this.w[1] += ((r[2] * b[0] - r[0] * b[2]) / I[1]) * dt;
      this.w[2] += ((r[0] * b[1] - r[1] * b[0]) / I[2]) * dt;
    }
    /// The point's velocity through the ground: speed into it (vi), along it (vt, with the components in P.t).
    probe(P, nx, ny, nz) {
      const wr = qrot(this.q, cross(this.w, P.r));
      const vx = this.vel[0] + wr[0], vy = this.vel[1] + wr[1], vz = this.vel[2] + wr[2];
      const vn = vx * nx + vy * ny + vz * nz;
      P.vi = -vn; P.tx = vx - nx * vn; P.ty = vy - ny * vn; P.tz = vz - nz * vn; P.vt = Math.hypot(P.tx, P.ty, P.tz);
    }
    /// A hard point on the surface: stiff spring and damper, and coulomb friction that scrapes.
    pressHard(P, nx, ny, nz, pen, mu, dt, k = P.k, c = P.c) {
      let Fn = Math.min(k * pen + c * Math.max(0, P.vi), 40 * G);
      let fx = nx * Fn, fy = ny * Fn, fz = nz * Fn;
      if (P.vt > 1e-3) { const ff = Math.min(mu * Fn, P.vt / (dt * 2.5)) / P.vt; fx -= P.tx * ff; fy -= P.ty * ff; fz -= P.tz * ff; }
      P.Fn = Fn; this.applyForce(P, fx, fy, fz, dt);
      return Fn;
    }
    /// A wheel: the oleo spring and damper (with a hard stop at the end of its travel), tyre grip across the wheel,
    /// rolling resistance and the brakes along it.
    pressWheel(P, nx, ny, nz, pen, surf, fp, lat, dt) {
      const over = Math.max(0, pen - this.T);
      let Fn = P.k * Math.min(pen, this.T) + P.c * Math.max(0, P.vi) * (over > 0 ? 3 : 1) + P.k * 16 * over;
      Fn = Math.min(Fn, 40 * G);
      const vlong = P.tx * fp[0] + P.ty * fp[1] + P.tz * fp[2], vlat = P.tx * lat[0] + P.ty * lat[1] + P.tz * lat[2];
      P.vlat = vlat;
      const burst = P.id === 'ML' ? this.damage.tyreL : P.id === 'MR' ? this.damage.tyreR : false;
      const lim = surf.grip * (burst ? 0.55 : 1) * Fn;
      const fl = -clamp(vlat * 40, -lim, lim);
      const rr = (surf.roll + (burst ? 0.3 : 0)) * Fn + (P.id !== 'N' && this.brake ? this.brakeMu * Fn : 0);
      const fo = -Math.sign(vlong) * Math.min(rr, Math.abs(vlong) / (dt * 2));
      P.Fn = Fn;
      this.applyForce(P, nx * Fn + fp[0] * fo + lat[0] * fl, ny * Fn + fp[1] * fo + lat[1] * fl, nz * Fn + fp[2] * fo + lat[2] * fl, dt);
      return Fn;
    }
    scrape(P, k) {
      this.scrapeI = Math.max(this.scrapeI, k);
      const rw = qrot(this.q, P.r); this.scrapePos = [this.pos[0] + rw[0], this.pos[1] + rw[1], this.pos[2] + rw[2]];
    }

    /// Ground contact for every active point. Returns true when this step ended the flight in a crash.
    contacts(dt, world, wreck) {
      const pos = this.pos, pts = this.pts;
      const gh0 = groundAt(world, pos[0], pos[2]);
      this.scrapeI = Math.max(0, this.scrapeI - dt * 3);
      if (pos[1] - gh0 > this.bound * 1.5 + 5) {
        for (const P of pts) P.on = false;
        this.wet = 0; this.wreckTouch = 0; this.gGear = 0;
        if (!wreck) { this.noContactT += dt; this.airT += dt; if (this.noContactT > 0.25) this.onGround = false; }
        return false;
      }
      const x = pos[0], z = pos[2];
      const dhx = (groundAt(world, x - 3, z) - groundAt(world, x + 3, z)) / 6, dhz = (groundAt(world, x, z - 3) - groundAt(world, x, z + 3)) / 6;
      const nl = Math.hypot(dhx, 1, dhz), nx = dhx / nl, ny = 1 / nl, nz = dhz / nl;
      this.nrm[0] = nx; this.nrm[1] = ny; this.nrm[2] = nz;
      const surf = SURFACES[surfaceAt(world, pos[0], pos[2])] || SURFACES.grass;
      this.surface = surf;
      this.qi = qconj(this.q);
      const f = qrot(this.q, [0, 0, -1]), fd = f[0] * nx + f[1] * ny + f[2] * nz;
      const fp = norm([f[0] - nx * fd, f[1] - ny * fd, f[2] - nz * fd]), lat = cross(fp, [nx, ny, nz]);
      let touching = 0, wheels = 0, gsum = 0, wet = 0, noseLoad = 0;
      const crashFn = (why, P, extra) => this.crash(why, Object.assign({ n: [nx, ny, nz], vi: P.vi, vt: P.vt, P }, extra));
      for (let i = 0; i < pts.length; i++) {
        const P = pts[i];
        if (!this.pointActive(P, wreck)) { P.on = false; continue; }
        const rw = qrot(this.q, P.r);
        const px = pos[0] + rw[0], py = pos[1] + rw[1], pz = pos[2] + rw[2];
        const th = terrainAt(world, px, pz), isWet = th < WATER, pen = (isWet ? WATER : th) - py;
        const obj = wreck ? hitObject(world, [px, py, pz]) : null;
        if (pen <= 0 && !obj) { P.on = false; continue; }
        const first = !P.on;
        P.on = true; touching++;
        if (obj) {
          // A building, tree or bridge: push out along the shallowest way.
          const dxa = Math.min(px - obj.min[0], obj.max[0] - px), dya = Math.min(py - obj.min[1], obj.max[1] - py), dza = Math.min(pz - obj.min[2], obj.max[2] - pz);
          let on = [0, 0, 0], dep;
          if (dxa <= dya && dxa <= dza) { on[0] = px - obj.min[0] < obj.max[0] - px ? -1 : 1; dep = dxa; }
          else if (dya <= dza) { on[1] = py - obj.min[1] < obj.max[1] - py ? -1 : 1; dep = dya; }
          else { on[2] = pz - obj.min[2] < obj.max[2] - pz ? -1 : 1; dep = dza; }
          this.probe(P, on[0], on[1], on[2]);
          if (P.vi > 0 || dep < 1) this.pressHard(P, on[0], on[1], on[2], Math.min(dep, 1.2), 0.35, dt, 2200, 90);
          if (first && P.vi > 5 && this.bumpT <= 0) { this.bumpT = 0.15; this.events.push({ type: 'bump', vi: P.vi, at: [px, py, pz] }); }
          continue;
        }
        this.probe(P, nx, ny, nz);
        if (isWet) {
          wet++;
          if (!wreck) { crashFn('water', P, { n: [0, 1, 0], vi: Math.max(0, -this.vel[1]), vt: Math.hypot(this.vel[0], this.vel[2]) }); return true; }
          // A wreck in the water: it floats on its buoyancy (less as the tanks flood), the water drags at it, and it
          // is pushed about by waves of its own making.
          const dep = Math.min(pen, 2);
          this.applyForce(P, -this.vel[0] * 0.2, 3.2 * dep * this.buoy - this.vel[1] * 1.2 * Math.min(dep, 1), -this.vel[2] * 0.2, dt);
          this.w[0] *= 1 - dt * 0.8; this.w[1] *= 1 - dt * 0.8; this.w[2] *= 1 - dt * 0.8;
          continue;
        }
        if (P.kind === 'w') {
          wheels++;
          if (first && P.vi > 0.8) this.events.push({ type: 'wheel', vi: P.vi, id: P.id });
          if (first && this.airT > 0.7) {
            // The touchdown: where, and how hard.
            this.sinkAtTouch = P.vi; this.touch = [pos[0], pos[2]]; this.everDown = true;
            if (P.vi > this.gearSink * 0.5) this.gearEvent = { cause: 'hard', vi: P.vi };
          }
          if (first && !this.wheelCheck(P, crashFn, lat)) { if (this.crashed) return true; }
          if (!P.on) continue;
          const Fn = this.pressWheel(P, nx, ny, nz, pen, surf, fp, lat, dt);
          gsum += Fn;
          if (P.id === 'N') noseLoad = Fn;
        } else {
          if (!wreck) { if (this.hitCheck(P, first, pen, crashFn)) return true; }
          else this.wreckCheck(P, first, px, py, pz);
          if (this.crashed && !wreck) return true;
          if (!this.pointActive(P, wreck)) continue;
          const mu = surf.skid * (P.kind === 'r' ? 0.7 : 1);
          this.pressHard(P, nx, ny, nz, pen, mu, dt);
          if (P.vt > 3 && P.Fn > 0.5) this.scrape(P, clamp(P.vt / 25, 0.15, 1));
          gsum += P.Fn * 0.5;
        }
      }
      this.wet = wet;
      this.gGear = Math.min(gsum / G - 1, 12); if (this.gGear < 0) this.gGear = 0;
      if (this.gGear > this.maxGGear) this.maxGGear = this.gGear;
      if (wreck) { this.wreckTouch = touching; return false; }
      // On the ground, or not (the wheels can leave it for a moment in a bounce).
      if (touching > 0) { this.noContactT = 0; this.onGround = true; this.airT = 0; } else { this.noContactT += dt; this.airT += dt; if (this.noContactT > 0.3) this.onGround = false; }
      // A heavily loaded nose wheel digging into soft ground: it collapses and the nose goes down.
      if (wheels > 0 && this.damage.nose && this.damage.gear) {
        const soft = surf.soft;
        const gsp = len(this.vel);
        if (soft && noseLoad > 0.12 * G && gsp > this.s.stall * 0.4) this.noseStress += dt * soft * (gsp / this.s.stall) * (this.brake ? 1.6 : 1) * 0.16;
        else this.noseStress = Math.max(0, this.noseStress - dt * 0.4);
        if (this.noseStress > 1) this.collapseNose('dig', gsp);
      }
      return false;
    }

    /// A wheel touching down (or touching again after a bounce). Returns false when a leg gave way or the flight ended.
    wheelCheck(P, crashFn, lat) {
      const s = this.s, vi = P.vi, gs = this.gearSink * (P.id === 'N' ? 0.8 : 1);
      if (vi > 15) { crashFn(this.nrm[1] < 0.93 ? 'terrain' : 'ground', P); return false; }
      if (vi > gs) {
        if (P.id === 'N') this.collapseNose('hard', vi); else this.collapseGear('hard', vi);
        return false;
      }
      // Sideways at touchdown (crabbing in a crosswind): side load on the wheels.
      if (Math.abs(P.tx * lat[0] + P.ty * lat[1] + P.tz * lat[2]) > 0.3 * s.stall + 1.5 && P.id !== 'N') { this.collapseGear('side', vi); return false; }
      if (P.id !== 'N' && vi > gs * 0.55 && Math.random() < 0.35) this.burstTyre(P.id === 'ML' ? 'tyreL' : 'tyreR');
      return true;
    }
    collapseGear(cause, vi) {
      if (!this.damage.gear) return;
      this.damage.gear = false;
      this.gearEvent = { cause, vi };
      this.events.push({ type: 'gear', cause, vi });
      if (this.vel[1] < 0) this.vel[1] *= 0.5;
      for (const P of this.pts) if (P.kind === 'w') P.on = false;
    }
    collapseNose(cause, vi) {
      if (!this.damage.nose) return;
      this.damage.nose = false;
      this.gearEvent = { cause: 'nose', vi };
      this.events.push({ type: 'gear', cause: 'nose', vi });
      if (this.s.engine === 'piston') this.failEngine(); else this.failEngine(true);
      if (this.vel[1] < 0) this.vel[1] *= 0.6;
      for (const P of this.pts) if (P.id === 'N') P.on = false;
    }
    burstTyre(which) {
      if (this.damage[which]) return;
      this.damage[which] = true; this.events.push({ type: 'tyre', side: which === 'tyreL' ? 'L' : 'R' });
    }
    /// Structure (not wheels) meeting the ground while the plane is still a plane.
    hitCheck(P, first, pen, crashFn) {
      const vi = P.vi, vt = P.vt, V = this.speed;
      switch (P.id) {
        case 'L': case 'R': {
          if (vi + 0.12 * vt > 4.2) { this.loseWing(P.id, 'ground'); this.vel = mul(this.vel, 0.92); if (P.id === 'L') this.w[2] += 0.6; else this.w[2] -= 0.6; }
          else if (P.vt > 3) this.scrape(P, 0.5);
          return false;
        }
        case 'T': {
          if (vi > 12) { crashFn('ground', P); return true; }
          if (vi > 5) { this.breakTail(); return false; }
          this.tailStrike(V, vi);
          return false;
        }
        case 'nose':
          if (first && vi > 5) { crashFn('nose', P); return true; }
          return false;
        case 'rf': case 'rm': case 'ra':
          if (first && vi > 1.5) { crashFn('flip', P); return true; }
          return false;
        default: {   // belly and engine pods
          if (first && vi > (this.s.stall > 40 ? 9 : 10)) { crashFn(this.nrm[1] < 0.93 ? 'terrain' : 'ground', P); return true; }
          if (first && vi > 3 && this.damage.power > 0.4) {
            this.failEngine(true); this.events.push({ type: 'scrape', what: 'engine' });
          }
          if (first && this.damage.gear && this.s.retract && this.gearPos < 0.9) {
            // Landing with the wheels still up: down on its belly, engines scraping.
            this.damage.gear = false; this.gearEvent = { cause: 'up', vi }; this.events.push({ type: 'gear', cause: 'up', vi }); this.failEngine(true);
          }
          return false;
        }
      }
    }
    /// Structure meeting the ground or an obstacle in a wreck: things shear off and thud.
    wreckCheck(P, first, px, py, pz) {
      if ((P.id === 'L' || P.id === 'R') && P.vi + 0.12 * P.vt > 6) this.loseWing(P.id, 'crash');
      else if (P.id === 'T' && P.vi > 6) this.breakTail();
      if (first && P.vi > 3.5 && this.bumpT <= 0) { this.bumpT = 0.12; this.events.push({ type: 'bump', vi: P.vi, at: [px, py, pz] }); }
    }
    /// The tail dragging on the ground: each scrape costs some of its health, faster and harder ones more. At
    /// nothing left the tail breaks off.
    tailStrike(V, vi) {
      if (this.damage.tail <= 0 || this.tailT > 0) return;
      this.tailT = 0.5;
      const excess = Math.max(0, this.pitchAngle - (this.s.tailPitch || 12) * DEG);
      const sev = clamp(0.08 + V / 300 + excess * 1.2 + vi / 25, 0.08, 0.6);
      this.damage.tail = Math.max(0, this.damage.tail - sev);
      this.events.push({ type: 'tail', health: this.damage.tail, sev });
    }

    // ---------------------------------------------------------------- the wreck

    /// After a crash the airframe is a rigid body: it keeps its momentum, tumbles, slides, floats or sinks, and the bits
    /// that touch things shear off, until it comes to rest.
    stepWreck(dt, world) {
      if (this.rest) return;
      this.wreckT += dt;
      while (this.breakQ.length && this.breakQ[0].t <= this.wreckT) { const b = this.breakQ.shift(); if (b.part === 'T') this.breakTail(); else this.loseWing(b.part, 'crash'); }
      this.bumpT = Math.max(0, this.bumpT - dt);
      const V = len(this.vel);
      this.vel[1] -= G * dt;
      this.vel = mul(this.vel, 1 - Math.min(0.2, 0.0012 * V * dt));
      this.pos = add(this.pos, mul(this.vel, dt));
      const wl = len(this.w);
      if (wl * dt > 1e-6) this.q = qnorm(qmul(this.q, qaxis(mul(this.w, 1 / wl), wl * dt)));
      this.w = mul(this.w, Math.exp(-dt * 0.25));
      this.contacts(dt, world, true);
      if (this.wet > 0) { this.wetT += dt; if (this.wetT > 7) this.buoy = Math.max(0.15, 1 - (this.wetT - 7) * 0.05); }
      if (this.pos[1] < WATER - 5) { this.rest = true; this.sunk = true; return; }
      const calm = len(this.vel) < 0.35 && len(this.w) < 0.12 && (this.wreckTouch > 0 || this.wet > 0);
      this.restT = calm && this.wet === 0 ? this.restT + dt : 0;
      if (this.restT > 0.8) { this.rest = true; this.vel = v3(); this.w = v3(); }
    }

    /// The end of the flight: works out how bad it was from the speed into the surface, what broke and how it ends.
    crash(why = 'crash', c = {}) {
      if (this.crashed) return;
      const s = this.s, V = this.speed;
      const vi = Math.max(0, c.vi ?? -this.vel[1]), vt = c.vt ?? 0;
      const ve = c.object ? V * 0.85 : Math.hypot(vi, 0.3 * vt);          // speed that has to be absorbed
      const sev = ve < 8 ? 0 : ve < 16 ? 1 : ve < 30 ? 2 : 3;
      const fuelFrac = clamp(this.fuel / (s.fuel || 1800), 0, 1);
      const fire = why !== 'water' && fuelFrac > 0.03 && (sev >= 3 || (sev === 2 && Math.random() < 0.6) || (sev === 1 && Math.random() < 0.2));
      const crush = 2.5 + 4 * clamp((s.stall - 24) / 46, 0, 1);            // how far the structure crumples
      const gEst = (ve * ve) / (2 * crush * G);
      const surv = gEst < 12 ? 'Survivable' : gEst < 22 ? 'Barely survivable' : 'Not survivable';
      const pitch = this.pitchAngle, bank = this.bank;
      this.info = { why, sev, ve, vi, vt, V, pitch, bank, g: gEst, surv, fire, sink: -this.vel[1], ias: this.ias, at: this.pos.slice() };
      this.why = why; this.crashed = true; this.wreckT = 0; this.impactVel = this.vel.slice();
      // Crumpling takes most of the speed into the surface; the rest becomes tumble.
      const n = c.n;
      if (n) {
        const vn = dot(this.vel, n);
        if (vn < 0) {
          // The normal speed is crushed away (a little bounces back) and the sliding speed is scrubbed off in proportion.
          const vnv = mul(n, vn), vtv = sub(this.vel, vnv);
          this.vel = add(mul(vtv, [0.95, 0.8, 0.6, 0.45][sev]), mul(vnv, -0.1));
        }
        if (c.P) {
          const b = qrot(qconj(this.q), mul(n, Math.max(0, -vn) * 0.5)), r = c.P.r, I = this.I;
          this.w[0] += (r[1] * b[2] - r[2] * b[1]) / I[0]; this.w[1] += (r[2] * b[0] - r[0] * b[2]) / I[1] * 0.5; this.w[2] += (r[0] * b[1] - r[1] * b[0]) / I[2];
        }
      }
      // What comes off, and when.
      this.breakQ = [];
      if (sev >= 3) { this.loseWing('L', 'crash'); this.loseWing('R', 'crash'); this.breakTail(); }
      else if (sev === 2) {
        const first = Math.random() < 0.5 ? 'L' : 'R';
        this.breakQ.push({ t: 0.12, part: 'T' }, { t: 0.2, part: first }, { t: 0.5, part: first === 'L' ? 'R' : 'L' });
      } else if (sev === 1 && Math.random() < 0.5) this.breakQ.push({ t: 0.3, part: Math.random() < 0.5 ? 'L' : 'R' });
      if (sev >= 1) this.damage.gear = false;
      this.failEngine();
      this.report = this.makeReport();
      this.events.push({ type: 'crash', why, info: this.info });
    }

    /// A short honest account of what happened, for the result screen: { title, lines, surv, g }.
    makeReport() {
      const i = this.info;
      const pitch = Math.round(i.pitch / DEG), bank = Math.round(Math.abs(i.bank) / DEG);
      const att = Math.abs(pitch) < 3 ? 'level' : `${Math.abs(pitch)}° nose-${pitch < 0 ? 'down' : 'up'}`;
      const spun = this.spin || this.t - this.spinEnd < 6, stalled = this.stalled || this.t - this.lastStall < 6;
      let cause = null;
      if (this.structFail && this.t - this.structFail.t < 25) cause = this.structFail.text;
      else if (spun) cause = `Spun in from ${Math.max(10, Math.round(this.spinAgl))} m`;
      else if (stalled) cause = `Stalled at ${Math.max(5, Math.round(this.stallAgl))} m`;
      else if (this.fuelOut) cause = 'Ran out of fuel';
      else if (!this.damage.engine && this.t > 5) cause = 'Engine failure';
      const what = WHAT[i.why] || 'Crashed';
      const impact = `impact ${Math.round(i.V)} m/s`;
      let title;
      if (cause) title = `${cause}, ${impact}, ${att}`;
      else if (i.why === 'water') title = `${what} at ${Math.round(i.V)} m/s`;
      else if (i.why === 'flip') title = `${what} on landing at ${Math.round(i.V)} m/s`;
      else title = `${what}, ${impact}, ${att}`;
      const lines = [`Speed ${Math.round(i.V)} m/s · sink ${i.sink.toFixed(1)} m/s · ${att}${bank > 4 ? ` · ${bank}° bank` : ''}`,
        `Impact load about ${Math.round(i.g)} g · ${i.surv}`];
      if (i.fire) lines.push('Fuel fire after the impact');
      return { title, lines, surv: i.surv, g: i.g, crash: true };
    }
    /// For a flight that ended without a crash (a belly slide to a stop): what failed, and whether it was survivable.
    slideReport() {
      const e = this.gearEvent, g = this.maxGGear;
      let title;
      if (!e) title = 'Landed on its belly';
      else if (e.cause === 'up') title = 'Landed with the gear up';
      else if (e.cause === 'nose') title = e.vi > 4 ? `Nose gear collapsed on a hard landing: ${e.vi.toFixed(1)} m/s sink` : 'Nose gear collapsed';
      else if (e.cause === 'dig') title = 'Nose gear dug into the soft ground and collapsed';
      else if (e.cause === 'side') title = 'Gear collapsed under side load';
      else title = `Gear collapsed on a hard landing: ${e.vi.toFixed(1)} m/s sink`;
      return { title, lines: [`Peak load about ${(1 + g).toFixed(1)} g · Survivable`], surv: 'Survivable', g, crash: false };
    }
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
        float l = max(dot(nn, vec3(${SUN.map((v) => v.toFixed(4)).join(', ')})), 0.0); vl = 0.42 + 0.68 * l + glow; vc = c * tint; vd = gl_Position.w; }`;
    const fs = `precision mediump float; varying vec3 vc; varying float vd; varying float vl; uniform vec3 fog; uniform float fogFar; uniform float alpha;
      ${FOG_GLSL}
      void main(){ gl_FragColor = vec4(mix(vc * vl, fog, fogAmt(vd, fogFar)), alpha); }`;
    const sh = (type, src) => { const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s); return s; };
    const prog = gl.createProgram(); gl.attachShader(prog, sh(gl.VERTEX_SHADER, vs)); gl.attachShader(prog, sh(gl.FRAGMENT_SHADER, fs));
    gl.bindAttribLocation(prog, 0, 'p'); gl.bindAttribLocation(prog, 1, 'n'); gl.bindAttribLocation(prog, 2, 'c'); gl.linkProgram(prog); gl.useProgram(prog);
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
    const hoopB = new Builder(); hoopB.torus(14, 1.3, [1, 1, 1]); const hoopMesh = upload(hoopB);
    const arrowB = new Builder(); arrowB.cone([0, 0, 0], 2.2, 0, 5, [1, 1, 1], 8); const arrowMesh = upload(arrowB);
    const smokeB = new Builder(); smokeB.box([0, 0, 0], [1, 1, 1], [1, 1, 1]); const smokeMesh = upload(smokeB);
    // ---- SPLIT BEGIN
    // Each plane is split into its body (F), wings (L, R) and tail (T), each centred on itself, so a part can break
    // off and tumble on its own. A part's `mesh` includes the control surfaces resting in their neutral position (that is
    // what tumbles away); `live` leaves them out, because they are drawn separately, moved by the controls.
    function splitPlane(spec, m) {
      const full = { F: [], L: [], R: [], T: [] }, live = { F: [], L: [], R: [], T: [] };
      const place = (d, alsoLive) => {
        for (let i = 0; i < d.length; i += 27) {
          const cx = (d[i] + d[i + 9] + d[i + 18]) / 3, cz = (d[i + 2] + d[i + 11] + d[i + 20]) / 3, k = bucketOf(spec, cx, cz);
          for (let j = 0; j < 27; j++) { full[k].push(d[i + j]); if (alsoLive) live[k].push(d[i + j]); }
        }
      };
      place(m.body.d, true);
      for (const dy of m.dyn || []) place(dy.mesh.d, false);
      const parts = {};
      for (const [k, arr] of Object.entries(full)) {
        if (!arr.length) continue;
        const c = v3(), n = arr.length / 9;
        for (let i = 0; i < arr.length; i += 9) { c[0] += arr[i] / n; c[1] += arr[i + 1] / n; c[2] += arr[i + 2] / n; }
        const shift = (a) => { for (let i = 0; i < a.length; i += 9) { a[i] -= c[0]; a[i + 1] -= c[1]; a[i + 2] -= c[2]; } };
        shift(arr); shift(live[k]);
        parts[k] = { mesh: upload({ d: arr }), live: upload({ d: live[k] }), center: c };
      }
      // Lights: a glowing core and a faint halo for each kind on each part.
      const groups = new Map();
      for (const l of m.lights || []) {
        const key = `${l.kind}|${l.attach}`;
        if (!groups.has(key)) groups.set(key, { kind: l.kind, attach: l.attach, core: new Builder(), halo: new Builder() });
        const g = groups.get(key);
        blob(g.core, l.p, l.r); blob(g.halo, l.p, l.r * 3.6);
      }
      return {
        parts, prop: upload(m.prop), propAt: m.propAt, disc: upload(m.disc),
        dyn: (m.dyn || []).map((d) => ({ kind: d.kind, side: d.side, attach: d.attach, pivot: d.pivot, axis: d.axis, gl: upload(d.mesh) })),
        gears: (m.gears || []).map((g) => ({ pivot: g.pivot, axis: g.axis, ang: g.ang, nose: !!g.nose, gl: upload(g.mesh) })),
        fans: (m.fans || []).map((f) => ({ at: f.at, attach: f.attach, dir: f.dir, gl: upload(f.mesh) })),
        lights: [...groups.values()].map((g) => ({ kind: g.kind, attach: g.attach, core: upload(g.core), halo: upload(g.halo) })),
        flame: m.flame ? { at: m.flame.at, gl: upload(m.flame.mesh), dia: upload(m.flame.diamonds) } : null,
      };
    }
    // ---- SPLIT END
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
    const WR = makeWorldRenderer(gl, W, { prog, U, draw, upload, I, rotorMesh });
    const ALL_PARTS = ['F', 'L', 'R', 'T', 'P'];

    // ---- state
    let plane = PLANES.find((p) => p.id === read('plane', 'c172')) || PLANES[0];
    let mode = MODES.find((m) => m.id === read('mode', 'hoops')) || MODES[0];
    let screen = 'menu', menuTab = read('menuTab', 'play');
    let flight = new Flight(plane);
    let hoops = [], nextHoop = 0, score = 0, timeLeft = 0, elapsed = 0, streak = 0, hoopsMade = 0;
    let camMode = 0, camPos = [0, 30, 60], paused = false, result = null, propAngle = 0, toastTimer = 0;
    let gpwsOn = read('gpws', true), gpwsText = '', gpwsLevel = 0, gpwsT = 0, gpwsLastFt = null, gpwsAt = {}, hundredCalled = false, wasAirborne = false;
    let gearWarn = false, gearBeepAt = 0, tailScrapeT = 0, rotateCalled = false, v1Called = false, lowFuelWarned = false, flapSoundT = 0;
    let rollAcc = 0, rollT = 0, loopAcc = 0, loopT = 0, lowT = 0, hadTakeoff = false, stoppedT = 0;
    const smoke = [];              // particles: fire, smoke, dust, sparks, spray
    const debris = [];             // parts that have come off and are tumbling on their own
    let attached = new Set(ALL_PARTS);
    let wreckT = 0, failAt = Infinity, hadFailure = false, engineSmokeT = 0, wingLostAt = -1, canyonT = 0;
    let failures = read('failures', 'rare');
    const keys = new Set();
    const mouse = { x: 0, y: 0, in: false, engaged: false };   // the cursor in the steering ring, -1..1 each way
    const done = new Set(read('done', []));
    // invertY false (the default): up climbs, for the mouse and the ↑ key. True: flight-stick style, down climbs.
    let invert = read('invertY', false), mouseOn = read('mouse', true), sens = read('sens', 1), sound = read('sound', true), units = read('units', 'kmh');
    let playerName = read('name', '');

    // ---- sound (Web Audio): engine drone, a chime for hoops, a thud for crashes
    let ac = null, eng = null, engGain = null, snd = null;
    /// Builds the always-running sounds of the flight: a piston engine (firing pulses and a propeller beat), a jet
    /// (spooling roar, whine and rumble), wind noise, the tyres rolling, the stall horn and the overspeed clacker. They
    /// start silent; `updateSound` sets their levels every frame from the engine, the speed and the aircraft.
    function buildSounds(a, out) {
      const nb = a.createBuffer(1, a.sampleRate * 2, a.sampleRate), nd = nb.getChannelData(0);
      for (let i = 0; i < nd.length; i++) nd[i] = Math.random() * 2 - 1;
      const noiseSrc = () => { const n = a.createBufferSource(); n.buffer = nb; n.loop = true; n.start(); return n; };
      const gain = (v = 0) => { const g = a.createGain(); g.gain.value = v; return g; };
      const filt = (type, f, q = 0.7) => { const x = a.createBiquadFilter(); x.type = type; x.frequency.value = f; x.Q.value = q; return x; };
      const osc = (type, f = 100) => { const o = a.createOscillator(); o.type = type; o.frequency.value = f; o.start(); return o; };
      // Piston: three oscillators (the fundamental, a slightly detuned copy and a sub-octave), low-passed, with the
      // propeller's blade beat as a fast tremolo and a little exhaust crackle.
      const p = { o1: osc('sawtooth'), o2: osc('sawtooth'), o3: osc('square'), lp: filt('lowpass', 800, 0.9), am: gain(0.75), lfo: osc('sine', 40), lfoDepth: gain(0.3), out: gain(0),
        crackle: filt('bandpass', 320, 1.2), crackleGain: gain(0) };
      [p.o1, p.o2, p.o3].forEach((o, i) => { const g = gain([0.5, 0.35, 0.3][i]); o.connect(g); g.connect(p.lp); });
      p.lp.connect(p.am); p.am.connect(p.out); p.lfo.connect(p.lfoDepth); p.lfoDepth.connect(p.am.gain); p.out.connect(out);
      noiseSrc().connect(p.crackle); p.crackle.connect(p.crackleGain); p.crackleGain.connect(out);
      // Jet: band-passed noise for the roar, a low rumble, and two close whine tones that beat against each other.
      const j = { roar: filt('bandpass', 900, 0.6), roarGain: gain(0), rumble: filt('lowpass', 220, 0.7), rumbleGain: gain(0),
        w1: osc('triangle', 3000), w2: osc('triangle', 3040), whine: gain(0), n1: 0 };
      const jn = noiseSrc(), jn2 = noiseSrc();
      jn.connect(j.roar); j.roar.connect(j.roarGain); j.roarGain.connect(out);
      jn2.connect(j.rumble); j.rumble.connect(j.rumbleGain); j.rumbleGain.connect(out);
      j.w1.connect(j.whine); j.w2.connect(j.whine); j.whine.connect(out);
      // Wind and tyres.
      const w = { f: filt('bandpass', 500, 0.5), g: gain(0) }; noiseSrc().connect(w.f); w.f.connect(w.g); w.g.connect(out);
      const r = { f: filt('lowpass', 160, 0.8), g: gain(0), scrape: filt('highpass', 1800, 0.7), sg: gain(0) };
      const rn = noiseSrc(); rn.connect(r.f); r.f.connect(r.g); r.g.connect(out); rn.connect(r.scrape); r.scrape.connect(r.sg); r.sg.connect(out);
      // GPWS: what the voice just said, red for a warning and amber for a caution.
      if (gpwsT > 0) {
        h2.font = `900 ${Math.round(18 * s + 4)}px system-ui`; const gt = gpwsText.toUpperCase(), gw = h2.measureText(gt).width + 28;
        h2.fillStyle = gpwsLevel >= 2 ? 'rgba(200,20,20,.88)' : 'rgba(210,140,10,.88)'; h2.beginPath(); h2.roundRect ? h2.roundRect(cx - gw / 2, 98 * s + 2, gw, 30 * s + 6, 9) : h2.rect(cx - gw / 2, 98 * s + 2, gw, 30 * s + 6); h2.fill();
        h2.fillStyle = '#fff'; h2.textAlign = 'center'; h2.fillText(gt, cx, 98 * s + 2 + (30 * s + 6) / 2);
      }
      // Warnings.
      const horn = { o: osc('square', 760), g: gain(0) }; horn.o.connect(horn.g); horn.g.connect(out);
      const clack = { o: osc('square', 480), g: gain(0) }; clack.o.connect(clack.g); clack.g.connect(out);
      return { p, j, w, r, horn, clack };
    }
    function audio() {
      if (!sound) return null;
      if (!ac) {
        try {
          ac = new (window.AudioContext || window.webkitAudioContext)();
          // The master for every looping flight sound: setting its gain to 0 silences them all.
          engGain = ac.createGain(); engGain.gain.value = 1; engGain.connect(ac.destination);
          snd = buildSounds(ac, engGain);
        } catch { ac = null; }
      }
      return ac;
    }
    /// What the engine is doing right now, for the gauges and the sound: rpm (piston) or N1 % (jet), 0..1 of the way up.
    const engState = { rpm: 0, n1: 0, level: 0 };
    function updateEngineState(dt) {
      const run = flight.damage.engine ? (flight.damage.power < 1 ? (Math.random() < 0.15 ? 0.2 : 1) : 1) : 0;
      if (plane.engine === 'jet') {
        // The fans spool up and down slowly.
        const target = run ? plane.n1Idle + (100 - plane.n1Idle) * flight.throttle * (flight.damage.power) : clamp(flight.speed * 0.08, 0, 12);
        engState.n1 += (target - engState.n1) * (1 - Math.exp(-dt * (target > engState.n1 ? 0.8 : 0.5)));
        engState.level = engState.n1 / 100;
      } else {
        const target = run ? plane.rpmIdle + (plane.rpmMax - plane.rpmIdle) * flight.throttle : clamp(flight.speed * 14, 0, 900);
        engState.rpm += (target - engState.rpm) * (1 - Math.exp(-dt * 6));
        engState.level = engState.rpm / plane.rpmMax;
      }
    }
    /// Sets the level of every looping sound from the engine, speed, ground contact and warnings.
    function updateSound() {
      if (!snd || !ac || !sound) return;
      const t = ac.currentTime, set = (param, v, tc = 0.08) => param.setTargetAtTime(v, t, tc);
      const V = flight.speed, run = flight.damage.engine ? 1 : 0, thr = flight.throttle, fast = clamp(V / plane.max, 0, 1.3);
      const piston = plane.engine !== 'jet', jet = !piston;
      // Piston.
      const f0 = Math.max(24, (engState.rpm / 60) * (plane.cyl || 4) / 2);
      set(snd.p.o1.frequency, f0); set(snd.p.o2.frequency, f0 * 1.006); set(snd.p.o3.frequency, f0 / 2);
      set(snd.p.lp.frequency, 450 + engState.level * 1500 + (flight.onGround ? 0 : 200));
      set(snd.p.lfo.frequency, (engState.rpm / 60) * 2); set(snd.p.lfoDepth.gain, 0.25 + 0.2 * (1 - thr));
      set(snd.p.out.gain, piston ? (0.03 + engState.level * 0.075) * (run ? 1 : 0.15) : 0, 0.06);
      set(snd.p.crackleGain.gain, piston && run && thr < 0.3 ? 0.012 : 0, 0.1);
      // Jet.
      const n = clamp(engState.n1 / 100, 0, 1), many = 1 + 0.12 * ((plane.engines || 2) - 1);
      set(snd.j.roar.frequency, 450 + n * 2300); set(snd.j.roar.Q, 0.5 + n * 0.4);
      set(snd.j.roarGain.gain, jet ? (0.015 + 0.2 * Math.pow(n, 1.6)) * many : 0, 0.15);
      set(snd.j.rumbleGain.gain, jet ? (0.04 + 0.16 * n) * many : 0, 0.2);
      set(snd.j.w1.frequency, 1800 + n * 3400); set(snd.j.w2.frequency, 1800 + n * 3400 + 25 + (plane.engines || 2) * 8);
      set(snd.j.whine.gain, jet ? 0.003 + 0.011 * n * n : 0, 0.2);
      // Wind and the wheels.
      set(snd.w.f.frequency, 300 + V * 9); set(snd.w.g.gain, Math.pow(fast, 1.6) * 0.12 + (flight.damage.L && flight.damage.R ? 0 : 0.04 * fast), 0.15);
      const rolling = flight.onGround ? clamp(V / 40, 0, 1) : 0;
      set(snd.r.g.gain, flight.damage.gear ? rolling * 0.08 : 0.04 * rolling, 0.1);
      set(snd.r.sg.gain, !flight.damage.gear && flight.onGround ? clamp(V / 20, 0, 1) * 0.1 : (flight.damage.tail < 1 && tailScrapeT > 0 ? 0.08 : 0), 0.05);
      // Stall horn (pulsing) and the overspeed clacker.
      const stallWarn = !flight.onGround && (flight.stalled || V < plane.stall * 1.06) && V > 3 && !flight.crashed;
      set(snd.horn.g.gain, stallWarn && Math.floor(t * 5) % 2 === 0 ? 0.05 : 0, 0.01);
      const over = V > plane.max * 1.0 && !flight.crashed;
      set(snd.clack.g.gain, over && Math.floor(t * 9) % 2 === 0 ? 0.045 : 0, 0.005);
    }
    function beep(freq, t = 0.18, type = 'sine', vol = 0.18) {
      const a = audio(); if (!a) return;
      const o = a.createOscillator(), g = a.createGain(); o.type = type; o.frequency.value = freq;
      g.gain.setValueAtTime(vol, a.currentTime); g.gain.exponentialRampToValueAtTime(0.001, a.currentTime + t);
      o.connect(g); g.connect(a.destination); o.start(); o.stop(a.currentTime + t);
    }
    // ---- GPWS: the airliner's ground proximity warnings and radio-altimeter calls, spoken (the browser's own voices) and
    // shown on the panel. Off with the switch in Controls; the light aircraft have none, like the real ones.
    let voiceCache = null;
    function pickVoice() {
      if (voiceCache) return voiceCache;
      const list = window.speechSynthesis?.getVoices?.() || [];
      if (!list.length) return null;
      const en = list.filter((v) => /^en/i.test(v.lang));
      voiceCache = en.find((v) => /Samantha|Karen|Moira|Tessa|Zira|Hazel|Susan|Google US English/i.test(v.name)) || en[0] || list[0];
      return voiceCache;
    }
    function speak(text, level) {
      const synth = window.speechSynthesis;
      if (!synth || typeof SpeechSynthesisUtterance === 'undefined') { beep(level >= 2 ? 1100 : 760, 0.25, 'square', 0.1); return; }
      try {
        if (level >= 2) synth.cancel();                         // a warning cuts through whatever is being said
        else if (synth.speaking && synth.pending) return;       // don't pile cautions up
        const u = new SpeechSynthesisUtterance(text);
        u.rate = level >= 2 ? 1.12 : 1.0; u.pitch = 0.9; u.volume = 1;
        const v = pickVoice(); if (v) u.voice = v;
        synth.speak(u);
      } catch { /* no speech on this computer: the panel still shows it */ }
    }
    /// Says (and shows) one call; the same key is not repeated before `every` seconds.
    function say(text, { level = 1, every = 2.5, key = text } = {}) {
      if (gpwsAt[key] != null && elapsed - gpwsAt[key] < every) return;
      gpwsAt[key] = elapsed;
      gpwsText = text; gpwsLevel = level; gpwsT = level >= 2 ? 2 : 1.4;
      if (sound && gpwsOn) speak(text, level);
    }
    const cancelSpeech = () => { try { window.speechSynthesis?.cancel(); } catch { /* ignore */ } };
    /// Looks ahead along the flight path for ground that is rising above you: seconds until it, or null.
    function terrainAhead() {
      const alt = flight.pos[1] - plane.gear, g0 = groundAt(W, flight.pos[0], flight.pos[2]);
      for (const t of [3, 5, 7, 9, 11, 14]) {
        const x = flight.pos[0] + flight.vel[0] * t, z = flight.pos[2] + flight.vel[2] * t, gh = groundAt(W, x, z);
        if (gh - g0 > 12 && gh > alt - 30) return t;
      }
      return null;
    }
    function gpwsTick(dt) {
      if (gpwsT > 0) gpwsT -= dt;
      if (!plane.retract || flight.crashed || !gpwsOn) { gpwsLastFt = null; return; }
      const alt = flight.pos[1] - plane.gear, ft = (alt - groundAt(W, flight.pos[0], flight.pos[2])) * 3.281, sink = -flight.vel[1] * 196.85;
      const airborne = !flight.onGround, arcade = mode.id === 'hoops' || mode.id === 'trial';
      const [x, z] = [flight.pos[0], flight.pos[2]];
      // Take-off: a hundred knots, V1, rotate, positive rate.
      if (flight.onGround && flight.throttle > 0.6) {
        const sp = speedsOf(plane);
        if (!hundredCalled && flight.speed >= 51.4) { hundredCalled = true; say('One hundred knots', { every: 99 }); }
        if (!v1Called && flight.speed >= sp.vr * 0.96) { v1Called = true; say('V one', { every: 99 }); }
        if (!rotateCalled && flight.speed >= sp.vr) { rotateCalled = true; say('Rotate', { every: 99 }); chime(); }
      }
      if (airborne && !wasAirborne && flight.vel[1] > 1) say('Positive rate', { every: 99 });
      wasAirborne = airborne;
      if (airborne) {
        // Radio altimeter calls on the way down, with the gear down (the call-outs a crew hears on an approach).
        if (flight.gearDown) {
          const c = raCallout(gpwsLastFt, ft, flight.vel[1] < -0.3);
          if (c) say(c, { every: 0, key: `ra-${c}` });
          if (ft <= 22 && ft > 4 && flight.vel[1] < -0.3 && flight.throttle > 0.12) say('Retard', { every: 1.6 });
        }
        gpwsLastFt = ft;
        if (!arcade) {
          const glideAlt = z * Math.tan(3 * DEG);
          const s = { airborne, ft, sink, bank: Math.abs(flight.bank) / DEG, gearDown: flight.gearDown, flapNotch: flight.flapNotch, landingFlaps: 3,
            terrainSec: flight.speed > plane.stall * 0.9 ? terrainAhead() : null,
            belowGlide: z > 150 && z < 4500 && Math.abs(x) < 350 && flight.gearDown && alt < glideAlt * 0.6 - 6,
            nearRunway: Math.abs(x) < 500 && z > -1700 && z < 4000 };
          const w = gpwsWarnings(s)[0];
          if (w) say(w.text, { level: w.level, every: w.every });
        }
      } else gpwsLastFt = null;
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
      mouse.engaged = false;   // move the cursor to the middle to take control
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
        flight.throttle = 0.3; flight.flapNotch = Math.min(2, (plane.flapNotches || [0, 1]).length - 1); flight.flaps = (plane.flapNotches || [0, 1])[flight.flapNotch];
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
      rotateCalled = false; hundredCalled = false; v1Called = false; wasAirborne = false; gpwsLastFt = null; gpwsAt = {}; gpwsText = ''; gpwsT = 0; cancelSpeech(); lowFuelWarned = false; tailScrapeT = 0; const up = flight.throttle;
      engState.rpm = plane.engine === 'jet' ? 0 : plane.rpmIdle + (plane.rpmMax - plane.rpmIdle) * up;
      engState.n1 = plane.engine === 'jet' ? plane.n1Idle + (100 - plane.n1Idle) * up : 0;
      screen = 'fly'; renderUI(); root.focus();
      if (audio()?.state === 'suspended') ac.resume();
      if (engGain) engGain.gain.value = 1;
    }

    function finish(kind, value, label) {
      screen = 'result';
      result = { kind, value, label, best: false, rank: 0 };
      if (engGain) engGain.gain.value = 0;
      cancelSpeech();
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
      if (down && e.repeat && keys.has(k)) { if (screen === 'fly') e.preventDefault?.(); return; }   // held keys repeat: toggles fire once
      const typing = e.target && e.target.tagName === 'INPUT' && e.target.type !== 'range';
      if (typing) { if (down && k === 'Enter' && result?.qualifies) saveScore(); return; }
      const game = ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', ' ', 'w', 's', 'a', 'd', 'q', 'e', 'f', 'v', 'b', 'c', 'p', 'r', 'Shift', 'Control', 'g'];
      if (game.includes(k) && screen === 'fly') e.preventDefault?.();
      if (down) {
        if (screen === 'fly') {
          if (k === 'p') { paused = !paused; renderUI(); }
          if (k === 'c') camMode = (camMode + 1) % 3;
          if (k === 'g') {
            const r = flight.toggleGear();
            if (r === 'up' || r === 'down') { toast(r === 'down' ? 'Gear down' : 'Gear up', 1100); noise(1.1, 0.12, 280); }
            else toast(r === 'fixed' ? `The ${plane.name} has fixed wheels: no gear to raise` : r === 'broken' ? 'The undercarriage is broken' : 'Gear can only be raised in the air', 1500);
          }
          if (k === 'f' || k === 'v') {
            const n = plane.flapNotches || [0, 1], to = clamp(flight.flapNotch + (k === 'f' ? 1 : -1), 0, n.length - 1);
            if (to !== flight.flapNotch) {
              flight.flapNotch = to; flight.flaps = n[to];
              toast(`Flaps ${(plane.flapLabels || ['UP', 'DOWN'])[to]}`, 900); noise(0.5, 0.12, 700);
              if (to > 0 && flight.speed > speedsOf(plane).vfe * 1.05) toast('⚠ FLAPS OVERSPEED', 1600);
            }
          }
          if (k === 'r') start();
          if (k === 'm') { mouseOn = !mouseOn; write('mouse', mouseOn); toast(mouseOn ? 'Mouse steering on' : 'Mouse steering off: use the keys', 1400); }
        } else if (screen === 'result' && (k === 'r' || k === ' ')) { e.preventDefault?.(); start(); }
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
    // The mouse steers by where the cursor is inside a small ring in the middle of the view: the ring's edge is full
    // stick, so a short move is enough and the cursor never has to leave the notch. It only takes control once the
    // cursor has been in the middle (a cursor left anywhere after clicking Take off can't bank the plane), and lets
    // go when the cursor leaves the game.
    const ringRadius = () => { const r = root.getBoundingClientRect(); return Math.max(40, Math.min(r.width, r.height) * 0.2) / clamp(sens, 0.3, 2.5); };
    root.addEventListener('pointermove', (e) => {
      const r = root.getBoundingClientRect(), R = ringRadius();
      const dx = (e.clientX - r.left - r.width / 2) / R, dy = (e.clientY - r.top - r.height / 2) / R;
      const d = Math.hypot(dx, dy), k = d > 1 ? 1 / d : 1;
      mouse.x = dx * k; mouse.y = dy * k; mouse.in = true;
      if (d < 0.3) mouse.engaged = true;
    });
    root.addEventListener('pointerleave', () => { mouse.x = 0; mouse.y = 0; mouse.in = false; mouse.engaged = false; });
    root.addEventListener('mousedown', () => { if (document.activeElement?.tagName !== 'INPUT') root.focus(); });

    // A small dead zone in the middle keeps the plane steady, and the curve is gentle near the centre so small moves
    // are fine adjustments. Up climbs (cursor up or ↑) unless Invert is on. The arrow keys always work too.
    const stick = (v) => {
      const dead = 0.1, a = Math.abs(v);
      if (a < dead) return 0;
      return Math.sign(v) * Math.min(1, Math.pow((a - dead) / (1 - dead), 1.3));
    };
    function input() {
      const has = (k) => keys.has(k);
      const m = mouseOn && mouse.in && mouse.engaged;
      let pitch = clamp((has('ArrowUp') ? 1 : 0) - (has('ArrowDown') ? 1 : 0) - (m ? stick(mouse.y) : 0), -1, 1);
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
      // A burning wreck's long black column, foam and bubbles where a wreck is in the water, and torn-up leaves.
      soot: { life: [5, 9], size: [4, 22], col: (k) => [0.1 + k * 0.2, 0.1 + k * 0.2, 0.11 + k * 0.2], glow: 0, rise: 7, grav: 0, a: 0.5 },
      foam: { life: [2, 4], size: [1.5, 5], col: () => [0.92, 0.96, 1], glow: 0.3, rise: 0, grav: 0, a: 0.55 },
      bubble: { life: [1.5, 3], size: [0.3, 0.8], col: () => [0.85, 0.95, 1], glow: 0.5, rise: 2.5, grav: 0, a: 0.5 },
      leaf: { life: [1, 2], size: [0.5, 1.5], col: () => [0.25, 0.5, 0.18], glow: 0, rise: 0, grav: 4, a: 0.9 },
    };
    function puff(kind, p, v = v3()) {
      if (smoke.length > 520) smoke.shift();
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
      ctl = devCtl || inp;
      if (devHold) return;
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
        } else if (ev.type === 'tail') {
          const at = partPos('T');
          for (let i = 0; i < 10; i++) puff('spark', at, add(mul(flight.vel, 0.3), [(Math.random() - 0.5) * 8, 2 + Math.random() * 4, (Math.random() - 0.5) * 8]));
          puff('dust', at, jitter(3));
          noise(0.7, 0.35, 1600); tailScrapeT = 0.7;
          if (ev.health <= 0) {
            detach('T', [0, 2, 3], 5);
            toast('💥 TAIL STRIKE! The tail broke off: you have almost no pitch control', 3000);
          } else toast(`⚠ TAIL STRIKE! Tail ${ev.health < 0.35 ? 'badly ' : ''}damaged (${Math.round(ev.health * 100)}%): weaker elevator and rudder. Keep the nose lower.`, 2800);
        } else if (ev.type === 'fuel') {
          toast('⛽ Out of fuel: the engine has stopped. Glide and land!', 3000);
        } else if (ev.type === 'gearmoved') {
          noise(0.18, 0.28, 130);                 // the gear locks with a thump
          toast(ev.down ? '🛬 Gear down and locked' : 'Gear up and locked', 1200);
        } else if (ev.type === 'gearspeed') {
          toast('⚠ GEAR OVERSPEED: slow down before lowering the gear', 2200); beep(520, 0.25, 'square', 0.1);
        } else if (ev.type === 'gear' && ev.cause === 'up') {
          toast('💥 GEAR UP LANDING! Sliding on the belly, engines scraping…', 3000);
          noise(2.4, 0.4, 600);
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
        // The tyres: a chirp, louder for a harder landing, and a thump of the gear taking the weight.
        noise(0.12, clamp(0.12 + sink * 0.05, 0.12, 0.5), 1500); noise(0.3, clamp(0.1 + sink * 0.04, 0.1, 0.4), 160);
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

      // Engine state (for the gauges), then every flight sound.
      updateEngineState(dt);
      updateSound();
      gpwsTick(dt);
      if (tailScrapeT > 0) tailScrapeT -= dt;
      // Take-off calls, like an airliner: rotate at Vr (and a chime), and a low-fuel warning.
      if (!plane.retract && flight.onGround && !rotateCalled && flight.throttle > 0.6 && flight.speed >= speedsOf(plane).vr) {
        rotateCalled = true; toast('ROTATE', 1400); chime();
      }
      if (!flight.onGround) rotateCalled = true;
      // "Too low, gear": an airliner low and slow with its wheels still up.
      const aglNow = flight.pos[1] - plane.gear - groundAt(W, flight.pos[0], flight.pos[2]);
      gearWarn = !!plane.retract && !flight.onGround && flight.gearPos < 0.99 && !flight.gearDown && aglNow < 200 && flight.speed < plane.stall * 1.8 && flight.throttle < 0.85;
      if (gearWarn && !gpwsOn && elapsed - gearBeepAt > 1.2) { gearBeepAt = elapsed; beep(900, 0.12, 'square', 0.1); setTimeout(() => beep(700, 0.12, 'square', 0.1), 150); }
      if (!lowFuelWarned && flight.fuel < (plane.fuel || 1800) * 0.12 && flight.damage.engine) { lowFuelWarned = true; toast('⛽ LOW FUEL', 2200); beep(660, 0.2, 'square', 0.12); setTimeout(() => beep(660, 0.2, 'square', 0.12), 260); }
    }

    // ---- drawing
    let lastW = 0, lastH = 0;
    function size() {
      const r = root.getBoundingClientRect(), dpr = Math.min(window.devicePixelRatio || 1, 2);
      const w = Math.max(1, Math.round(r.width * dpr)), h = Math.max(1, Math.round(r.height * dpr));
      if (w !== lastW || h !== lastH) { cv.width = hud.width = w; cv.height = hud.height = h; lastW = w; lastH = h; }
      return { w, h, dpr };
    }

    // ---- DRAW AIRCRAFT BEGIN
    // ---- drawing the aircraft: the body in its parts, then the moving surfaces, gear, propeller or fans, lights and flame
    // `ctl` is what the pilot is asking for (set every step); `surf` is where the surfaces actually are, easing towards it.
    let ctl = { pitch: 0, roll: 0, yaw: 0, throttle: 0 }, devCtl = null, devHold = false, devView = null;
    const surf = { ail: 0, elev: 0, rud: 0, flap: 0, spoil: 0, last: 0, fan: 0 };
    const hingeM = (pivot, axis, ang) => { const q = qaxis(axis, ang); return model(q, sub(pivot, qrot(q, pivot)), 1); };
    function drawAircraft(t) {
      const pm = planeMeshes[plane.id], menu = screen === 'menu', parts = menu ? new Set(ALL_PARTS) : attached;
      const dt = clamp((t - surf.last) / 1000, 0, 0.1); surf.last = t;
      const ease = 1 - Math.exp(-dt * 8), fly = !menu && !flight.crashed;
      const tgt = { ail: fly ? ctl.roll : 0, elev: fly ? ctl.pitch : 0, rud: fly ? ctl.yaw : 0, flap: menu ? 0 : flight.flaps || 0, spoil: fly && flight.brake ? (flight.onGround ? 1 : 0.5) : 0 };
      for (const k of Object.keys(tgt)) surf[k] += (tgt[k] - surf[k]) * (k === 'flap' ? ease * 0.35 : ease);
      const M = model(flight.q, flight.pos, plane.scale);
      const flapMax = plane.cat === 'mil' ? 24 : plane.cat === 'ga' || plane.cat === 'turbo' ? 32 : 38;
      for (const k of ['F', 'L', 'R', 'T']) {
        const part = pm.parts[k];
        if (part && parts.has(k)) draw(part.live, model(flight.q, add(flight.pos, qrot(flight.q, mul(part.center, plane.scale))), plane.scale));
      }
      // Control surfaces, each on its hinge. Positive is trailing edge down (or to the right, for a rudder).
      for (const d of pm.dyn) {
        if (!parts.has(d.attach)) continue;
        let a = 0;
        switch (d.kind) {
          case 'aileron': a = (d.side < 0 ? 1 : -1) * surf.ail * 25 * DEG; break;
          case 'flaperon': a = (d.side < 0 ? 1 : -1) * surf.ail * 22 * DEG + surf.flap * flapMax * DEG; break;
          case 'flap': a = surf.flap * flapMax * DEG; break;
          case 'elevator': a = -surf.elev * 24 * DEG; break;
          case 'stab': a = -surf.elev * 20 * DEG + (d.side * surf.ail * -6 * DEG); break;
          case 'rudder': a = surf.rud * 25 * DEG; break;
          case 'spoiler': a = -clamp(surf.spoil + Math.max(0, d.side * surf.ail) * 0.7, 0, 1) * 48 * DEG; break;
        }
        draw(d.gl, Math.abs(a) < 1e-3 ? M : mat4mul(M, hingeM(d.pivot, d.axis, a)));
      }
      // Undercarriage: legs fold about their hinges (inwards, nose leg forwards) and are hidden once up.
      if (parts.has('F') && (menu || flight.damage.gear)) {
        const gp = menu ? 1 : flight.gearPos == null ? 1 : flight.gearPos;
        if (gp > 0.04) for (const g of pm.gears) draw(g.gl, gp > 0.999 ? M : mat4mul(M, hingeM(g.pivot, g.axis, g.ang * (1 - gp))));
      }
      // Propeller: blades that blur into a disc as they speed up.
      if (pm.prop && parts.has('P')) {
        const pq = qmul(flight.q, qaxis([0, 0, 1], propAngle)), pp = model(pq, add(flight.pos, qrot(flight.q, mul(pm.propAt, plane.scale))), plane.scale);
        const fast = clamp((menu ? 40 : flight.damage.engine ? 8 + flight.throttle * 60 * flight.damage.power : flight.speed * 0.12) / 45, 0, 1);
        gl.enable(gl.BLEND); gl.depthMask(false);
        gl.uniform1f(U.alpha, 1 - 0.5 * fast); draw(pm.prop, pp);
        if (pm.disc && fast > 0.15) { gl.uniform1f(U.alpha, 0.2 * fast); draw(pm.disc, model(flight.q, add(flight.pos, qrot(flight.q, mul(pm.propAt, plane.scale))), plane.scale), [0.7, 0.7, 0.72], 0.2); }
        gl.uniform1f(U.alpha, 1); gl.depthMask(true); gl.disable(gl.BLEND);
      }
      // Engine fans turn with the engine.
      const n1 = menu ? 40 : engState.n1;
      surf.fan += dt * (4 + n1 * 0.32);
      for (const f of pm.fans) if (parts.has(f.attach)) draw(f.gl, mat4mul(M, model(qaxis([0, 0, 1], surf.fan * f.dir), f.at, 1)));
      // Lights.
      const ground = !menu && flight.onGround, gearOut = menu || (plane.retract ? (flight.gearPos == null ? 1 : flight.gearPos) > 0.3 : true);
      const agl = menu ? 0 : flight.pos[1] - plane.gear - groundAt(W, flight.pos[0], flight.pos[2]);
      const ph = (t / 1000) % 1.25, strobeOn = ph < 0.06 || (ph > 0.16 && ph < 0.22), beaconOn = (t / 1000) % 1.1 < 0.22;
      const landOn = menu || (ground ? flight.throttle > 0.02 || flight.speed > 2 : plane.retract ? gearOut && agl < 1500 : agl < 400);
      const running = menu || flight.damage.engine || flight.speed > 20, moving = menu || !ground || flight.speed > 2.5;
      for (const lg of pm.lights) {
        if (!parts.has(lg.attach)) continue;
        let tint = [1, 1, 1], glow = 1.6, on = true;
        switch (lg.kind) {
          case 'navR': tint = [1, 0.12, 0.1]; break;
          case 'navG': tint = [0.1, 1, 0.25]; break;
          case 'navW': tint = [1, 1, 1]; glow = 1.2; break;
          case 'strobe': on = strobeOn && moving; glow = 3; break;
          case 'beacon': tint = [1, 0.1, 0.08]; on = beaconOn && running; glow = 2.4; break;
          case 'land': tint = [1, 0.97, 0.86]; on = landOn; glow = 2.6; break;
          case 'taxi': tint = [1, 0.95, 0.8]; on = landOn && (ground || menu); glow = 2; break;
        }
        draw(lg.core, M, on ? tint : cmul(tint, 0.42), on ? glow : 0);
        if (on) {
          gl.enable(gl.BLEND); gl.depthMask(false); gl.uniform1f(U.alpha, lg.kind === 'strobe' ? 0.5 : 0.28);
          draw(lg.halo, M, tint, 1.2);
          gl.uniform1f(U.alpha, 1); gl.depthMask(true); gl.disable(gl.BLEND);
        }
      }
      // Afterburner: a long flame with shock diamonds above 90 % throttle; a short blue plume below that.
      if (pm.flame && parts.has('T') && !menu && flight.damage.engine && flight.throttle > 0.45) {
        const th = flight.throttle, burner = th > 0.9, flick = 1 + 0.12 * Math.sin(t * 0.07) + 0.08 * Math.sin(t * 0.13 + 1);
        const len = burner ? (0.75 + 0.25 * clamp((th - 0.9) / 0.1, 0, 1)) * flick : 0.1 + (th - 0.45) * 0.25;
        const rad = burner ? 1 : 0.7, at = pm.flame.at;
        const S = new Float32Array([rad, 0, 0, 0, 0, rad, 0, 0, 0, 0, len, 0, at[0], at[1], at[2], 1]);
        gl.enable(gl.BLEND); gl.depthMask(false);
        gl.uniform1f(U.alpha, burner ? 0.85 : 0.4); draw(pm.flame.gl, mat4mul(M, S), burner ? [1, 1, 1] : [0.45, 0.6, 1], burner ? 1.1 : 0.9);
        if (burner) { gl.uniform1f(U.alpha, 0.9); draw(pm.flame.dia, mat4mul(M, S), [1, 1, 1], 1.8); }
        gl.uniform1f(U.alpha, 1); gl.depthMask(true); gl.disable(gl.BLEND);
      }
    }

    // ---- DRAW AIRCRAFT END
    function render(t) {
      const { w, h, dpr } = size();
      gl.viewport(0, 0, w, h);
      gl.clearColor(...HAZE, 1); gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
      gl.uniform3fv(U.fog, HAZE); gl.uniform1f(U.fogFar, FOG_FAR); gl.uniform1f(U.alpha, 1);

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
      const fovy = screen === 'menu' ? 45 * DEG : 62 * DEG;
      const proj = persp(fovy, w / h, camMode === 1 ? 0.3 : 1, 14000);
      if (devView) { eye = devView.eye; at = devView.at; up = [0, 1, 0]; }
      const vp = mat4mul(proj, lookAt(eye, at, up));
      gl.uniformMatrix4fv(U.vp, false, vp);

      // Sky, ground, trees, airfield, clouds and water (it leaves the ordinary shader bound).
      WR.draw({ eye, at, up, vp, fovy, aspect: w / h, t, planePos: flight.pos, wind: flight.wind, shadow: screen === 'menu' ? 0 : (plane.span || 5) * 1.1 });

      if (screen !== 'menu') {
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
      }

      if (showPlane) drawAircraft(t);
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
      // Left: an airspeed indicator and an altimeter, round and with needles, like the real thing. The indicator's
      // scale and coloured arcs follow the aircraft: white for the flap range, green for normal flying, yellow
      // for caution and a red line you must not pass. The altimeter reads feet above the runway.
      const DR = Math.round(58 * s + 6), dy = H2 - DR - 16;
      const ring = (cx, cy, r) => {
        const g = h2.createRadialGradient(cx - r * 0.3, cy - r * 0.35, r * 0.1, cx, cy, r);
        g.addColorStop(0, '#1c2029'); g.addColorStop(1, '#07080c');
        h2.fillStyle = g; h2.beginPath(); h2.arc(cx, cy, r, 0, Math.PI * 2); h2.fill();
        h2.strokeStyle = '#5b6372'; h2.lineWidth = 3; h2.stroke();
      };
      const tick = (cx, cy, a, r0, r1, w, col) => {
        h2.strokeStyle = col; h2.lineWidth = w; h2.beginPath();
        h2.moveTo(cx + Math.cos(a) * r0, cy + Math.sin(a) * r0); h2.lineTo(cx + Math.cos(a) * r1, cy + Math.sin(a) * r1); h2.stroke();
      };
      const label = (cx, cy, text, a, r, size = 9, col = '#e8ebf0') => {
        h2.font = `700 ${Math.round(size * s + 2)}px system-ui`; h2.fillStyle = col; h2.textAlign = 'center'; h2.textBaseline = 'middle';
        h2.fillText(text, cx + Math.cos(a) * r, cy + Math.sin(a) * r);
      };
      const arc = (cx, cy, r, a0, a1, col, w) => { h2.strokeStyle = col; h2.lineWidth = w; h2.beginPath(); h2.arc(cx, cy, r, a0, a1); h2.stroke(); };
      const needle = (cx, cy, a, len, w, col, tail = 0.18) => {
        h2.strokeStyle = col; h2.lineWidth = w; h2.lineCap = 'round'; h2.beginPath();
        h2.moveTo(cx - Math.cos(a) * len * tail, cy - Math.sin(a) * len * tail); h2.lineTo(cx + Math.cos(a) * len, cy + Math.sin(a) * len); h2.stroke(); h2.lineCap = 'butt';
      };
      // Airspeed indicator.
      {
        const cx = 8 + DR + 4, cy = dy, sp = speedsOf(plane), unit = kmh ? 3.6 : 1.944;
        const top = plane.max * 1.28 * unit, steps = [10, 20, 25, 40, 50, 100], step = steps.find((x) => top / x <= 11) || 100, vmax = Math.ceil(top / step) * step;
        const A = (v) => (0.75 + 1.5 * clamp(v * unit / vmax, 0, 1)) * Math.PI;
        ring(cx, cy, DR);
        arc(cx, cy, DR * 0.9, A(sp.vs0), A(sp.vfe), '#f2f2f2', 3);                 // white: flaps down
        arc(cx, cy, DR * 0.8, A(sp.vs1), A(sp.vno), '#38d26a', 5);                   // green: normal
        arc(cx, cy, DR * 0.8, A(sp.vno), A(sp.vne), '#ffd23f', 5);                   // yellow: caution
        tick(cx, cy, A(sp.vne), DR * 0.68, DR * 0.95, 3, '#ff3b30');                  // red: never exceed
        for (let v = 0; v <= vmax; v += step / 2) {
          const a = (0.75 + 1.5 * v / vmax) * Math.PI, major = Math.round(v / (step / 2)) % 2 === 0;
          tick(cx, cy, a, DR * (major ? 0.64 : 0.7), DR * 0.76, major ? 1.6 : 1, '#e8ebf0');
          if (major && v > 0 && (vmax / step <= 8 || Math.round(v / step) % 2 === 0)) label(cx, cy, `${v}`, a, DR * 0.5, 8);
        }
        label(cx, cy + DR * 0.66, kmh ? 'KM/H' : 'KNOTS', -Math.PI / 2, 0, 6, '#9aa3b2');
        const live = flight.speed, warn = (live < plane.stall * 1.06 && !flight.onGround) || live > plane.max;
        needle(cx, cy, A(live), DR * 0.82, 2.4, warn ? '#ff6b6b' : '#fff');
        h2.fillStyle = '#2b303b'; h2.beginPath(); h2.arc(cx, cy, 4, 0, Math.PI * 2); h2.fill();
      }
      // Altimeter.
      {
        const cx = 8 + DR * 3 + 14, cy = dy, ft = (flight.pos[1] - plane.gear) * 3.281, mb = 1013;
        ring(cx, cy, DR);
        for (let i = 0; i < 50; i++) {
          const a = -Math.PI / 2 + (i / 50) * Math.PI * 2, major = i % 5 === 0;
          tick(cx, cy, a, DR * (major ? 0.7 : 0.8), DR * 0.88, major ? 1.8 : 0.9, '#e8ebf0');
          if (major) label(cx, cy, `${i / 5}`, a, DR * 0.56, 9);
        }
        label(cx, cy - DR * 0.34, 'ALT', -Math.PI / 2, 0, 6, '#9aa3b2');
        h2.fillStyle = '#0a0c11'; h2.fillRect(cx + DR * 0.18, cy - DR * 0.09, DR * 0.46, DR * 0.18);
        label(cx + DR * 0.41, cy, `${mb}`, 0, 0, 6, '#ffd23f');
        const m = Math.max(0, ft);
        needle(cx, cy, -Math.PI / 2 + ((m % 100000) / 100000) * Math.PI * 2, DR * 0.38, 1.3, '#cfd5df', 0);   // 10,000 ft
        needle(cx, cy, -Math.PI / 2 + ((m % 10000) / 10000) * Math.PI * 2, DR * 0.5, 3.4, '#f4f6fa', 0);      // 1,000 ft (short, fat)
        needle(cx, cy, -Math.PI / 2 + ((m % 1000) / 1000) * Math.PI * 2, DR * 0.8, 2, '#fff', 0.2);           // 100 ft (long)
        h2.fillStyle = '#2b303b'; h2.beginPath(); h2.arc(cx, cy, 3.5, 0, Math.PI * 2); h2.fill();
        h2.font = `700 ${Math.round(8 * s + 2)}px system-ui`; h2.textAlign = 'center'; h2.fillStyle = '#c3cad6'; h2.textBaseline = 'middle';
        const vs = flight.vel[1] * 196.85;   // ft per minute
        h2.fillStyle = vs < -1500 && agl < 300 ? '#ff6b6b' : '#c3cad6';
        h2.fillText(`${Math.round(ft)} ft · ${vs >= 0 ? '+' : ''}${Math.round(vs / 10) * 10} fpm`, cx, cy + DR + 8);
      }
      // Throttle and flaps.
      const tx = W2 - 34, ty = H2 - 96 * s - 10;
      box(tx - 8, ty - 6, 34, 96 * s + 12);
      h2.fillStyle = 'rgba(255,255,255,.15)'; h2.fillRect(tx, ty, 18, 80 * s);
      h2.fillStyle = flight.throttle > 0.95 ? '#ff7e2d' : '#5ee08a'; h2.fillRect(tx, ty + 80 * s * (1 - flight.throttle), 18, 80 * s * flight.throttle);
      h2.fillStyle = '#fff'; h2.textAlign = 'center'; h2.font = `700 ${Math.round(9 * s + 2)}px system-ui`;
      h2.fillText(`${Math.round(flight.throttle * 100)}%`, tx + 9, ty + 80 * s + 9);
      {
        // Flaps position, fuel, and the engine gauge: rpm on a propeller plane, N1 % on a jet.
        const lab = (plane.flapLabels || ['UP', 'DOWN'])[flight.flapNotch] || 'UP';
        h2.textAlign = 'right'; h2.font = `700 ${Math.round(9 * s + 2)}px system-ui`;
        h2.fillStyle = flight.flaps ? '#89c2ff' : '#7c8594'; h2.fillText(`FLAPS ${lab}`, tx - 12, ty + 80 * s + 9);
        {
          const gs = flight.gearState, col = gs === 'DOWN' ? '#5ee08a' : gs === 'TRANSIT' ? '#ffb347' : gs === 'BROKEN' ? '#ff4d4d' : '#7c8594';
          h2.fillStyle = gearWarn && Math.floor(performance.now() / 300) % 2 ? '#ff4d4d' : col;
          h2.fillText(gs === 'FIXED' ? 'GEAR FIXED' : `GEAR ${gs}${gs === 'DOWN' ? ' ▼▼▼' : ''}`, tx - 12, ty + 80 * s - 21);
        }
        const fuelPct = clamp(flight.fuel / (plane.fuel || 1800), 0, 1);
        h2.fillStyle = fuelPct < 0.12 ? '#ff6b6b' : fuelPct < 0.3 ? '#ffd166' : '#7c8594';
        h2.fillText(`FUEL ${Math.round(fuelPct * 100)}%`, tx - 12, ty + 80 * s - 6);
        const jet = plane.engine === 'jet', er = 24 * s + 8, ecx = tx - 24 - er, ecy = ty + 80 * s - er - 22;
        ring(ecx, ecy, er);
        const full = jet ? 100 : plane.rpmMax * 1.1, val = jet ? engState.n1 : engState.rpm, EA = (v) => (0.75 + 1.5 * clamp(v / full, 0, 1)) * Math.PI;
        if (jet) { arc(ecx, ecy, er * 0.8, EA(25), EA(95), '#38d26a', 4); arc(ecx, ecy, er * 0.8, EA(95), EA(100), '#ff3b30', 4); }
        else { arc(ecx, ecy, er * 0.8, EA(plane.rpmMax * 0.78), EA(plane.rpmMax * 0.93), '#38d26a', 4); arc(ecx, ecy, er * 0.8, EA(plane.rpmMax * 0.93), EA(full), '#ff3b30', 4); }
        needle(ecx, ecy, EA(val), er * 0.78, 2, flight.damage.engine ? '#fff' : '#ff6b6b');
        label(ecx, ecy + er * 0.45, jet ? 'N1 %' : 'RPM', -Math.PI / 2, 0, 6, '#9aa3b2');
        label(ecx, ecy + er * 0.2, jet ? `${Math.round(val)}` : `${Math.round(val / 10) * 10}`, -Math.PI / 2, 0, 7, '#e8ebf0');
        h2.textAlign = 'center';
      }
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
      if (mouseOn && !paused) {
        const ax = W2 / 2, ay = H2 / 2, ar = ringRadius();
        h2.lineWidth = 1.2;
        if (mouse.in && mouse.engaged) {
          h2.strokeStyle = 'rgba(255,255,255,.3)'; h2.beginPath(); h2.arc(ax, ay, ar, 0, Math.PI * 2); h2.stroke();
          h2.strokeStyle = 'rgba(255,255,255,.18)'; h2.beginPath(); h2.arc(ax, ay, ar * 0.1, 0, Math.PI * 2); h2.stroke();
          const dx = mouse.x * ar, dy = mouse.y * ar;
          h2.strokeStyle = 'rgba(255,209,102,.6)'; h2.beginPath(); h2.moveTo(ax, ay); h2.lineTo(ax + dx, ay + dy); h2.stroke();
          h2.fillStyle = '#ffd166'; h2.beginPath(); h2.arc(ax + dx, ay + dy, 4.5, 0, Math.PI * 2); h2.fill();
        } else if (screen === 'fly') {
          h2.setLineDash([4, 5]); h2.strokeStyle = 'rgba(255,255,255,.55)'; h2.beginPath(); h2.arc(ax, ay, ar * 0.3, 0, Math.PI * 2); h2.stroke(); h2.setLineDash([]);
          h2.font = `700 ${Math.round(10 * s + 2)}px system-ui`; h2.fillStyle = 'rgba(255,255,255,.8)';
          h2.fillText('Move the cursor here to steer with the mouse', ax, ay + ar * 0.3 + 14);
        }
      }
      // Top: mode status.
      h2.textAlign = 'center'; h2.font = `800 ${Math.round(15 * s + 3)}px system-ui`;
      let status = '';
      if (mode.id === 'hoops') status = `⭕ ${score}    ⏱ ${Math.max(0, Math.ceil(timeLeft))}s`;
      else if (mode.id === 'trial') status = `Hoop ${Math.min(nextHoop + 1, hoops.length)}/${hoops.length}    ⏱ ${elapsed.toFixed(1)}s`;
      else if (mode.id === 'landing') status = 'Land on the runway and stop';
      else status = flight.onGround && !hadTakeoff ? (invert ? 'Hold W for throttle · cursor down or ↓ to lift off' : 'Hold W for throttle · cursor up or ↑ to lift off') : 'Free flight';
      const tw = h2.measureText(status).width + 24;
      box(cx - tw / 2, 8, tw, 26 * s + 6); h2.fillStyle = '#fff'; h2.fillText(status, cx, 8 + (26 * s + 6) / 2);
      // Warnings.
      h2.font = `900 ${Math.round(16 * s + 4)}px system-ui`;
      const blink = Math.floor(performance.now() / 300) % 2;
      if (gearWarn && !gpwsOn && blink) { h2.fillStyle = '#ff4d4d'; h2.fillText('TOO LOW · GEAR', cx, 78 * s + 10); }
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
      if (!dmg.engine || dmg.power < 1 || !dmg.L || !dmg.R || !dmg.gear || dmg.tail < 1) {
        const rows = [['ENGINE', !dmg.engine ? 'FAILED' : dmg.power < 1 ? 'ROUGH' : 'OK', !dmg.engine ? '#ff4d4d' : dmg.power < 1 ? '#ffd166' : '#5ee08a'],
          ['L WING', dmg.L ? 'OK' : 'GONE', dmg.L ? '#5ee08a' : '#ff4d4d'], ['R WING', dmg.R ? 'OK' : 'GONE', dmg.R ? '#5ee08a' : '#ff4d4d'],
          ['GEAR', dmg.gear ? 'OK' : 'BROKEN', dmg.gear ? '#5ee08a' : '#ff4d4d'],
          ['TAIL', dmg.tail >= 1 ? 'OK' : dmg.tail <= 0 ? 'GONE' : `${Math.round(dmg.tail * 100)}%`, dmg.tail >= 1 ? '#5ee08a' : dmg.tail <= 0 ? '#ff4d4d' : '#ffd166']];
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
    /// Draws the menu or the pause / result screen. If one of them ever throws (a saved tab from an older version, a
    /// bad value), it falls back to the first tab instead of leaving a blank blue screen.
    function renderUI() {
      try { renderUIInner(); }
      catch (e) {
        console.error(e);
        if (menuTab !== 'play') {
          menuTab = 'play'; write('menuTab', 'play');
          try { renderUIInner(); return; } catch (e2) { console.error(e2); }
        }
        ui.innerHTML = '<div class="pg-menu"><h1>✈️ Plane</h1><p class="pg-hint">Something went wrong drawing this screen.</p><div class="pg-row"><button data-a="menu">Try again</button></div></div>';
        bind();
      }
    }
    function renderUIInner() {
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
        const climb = invert ? 'down' : 'up';
        body = `<h2>Mouse steering ${mouseOn ? '' : '(off)'}</h2><div class="pg-hint">Move the cursor into the ring in the middle of the view to take control. Then move it
          <b>left / right</b> to roll into a bank and turn, and <b>${climb}</b> to climb (the other way to dive). The edge of the ring is full stick, so small moves are enough;
          bring it back to the middle to fly straight. Let go of everything and the wings roll back to level. Leaving the game view lets go.
          Higher sensitivity makes the ring smaller.</div>
          <div class="pg-row" style="margin-top:6px"><label class="pg-hint">Sensitivity <input type="range" min="0.3" max="2.5" step="0.1" value="${sens}" data-range="sens" style="width:170px;padding:0"> <b data-sensval>${Number(sens).toFixed(1)}×</b></label>
          <button data-a="mouse">${mouseOn ? '✓ ' : ''}Mouse steering</button>
          <button data-a="invert">${invert ? '✓ ' : ''}Invert (down climbs, like a flight stick)</button></div>
          <h2>Keys</h2><div class="pg-hint">
          <kbd>W</kbd> more throttle · <kbd>S</kbd> less throttle · <kbd>↑</kbd> climb · <kbd>↓</kbd> dive · <kbd>←</kbd> <kbd>→</kbd> roll · <kbd>A</kbd> <kbd>D</kbd> rudder (and steering on the ground)<br>
          <kbd>F</kbd> flaps down a notch · <kbd>V</kbd> flaps up · <kbd>G</kbd> gear up / down (airliners; the Cessna and Piper have fixed wheels) · <kbd>Space</kbd> brakes / airbrake · <kbd>C</kbd> camera (chase, cockpit, orbit) · <kbd>P</kbd> pause (and the menu) · <kbd>R</kbd> restart · <kbd>M</kbd> mouse steering on / off</div>
          <h2>Tips</h2><div class="pg-hint">Bank by moving the cursor sideways and ease it ${climb} to turn: the wings turn the plane, the rudder only tidies up. Too slow or pulling too hard
          stalls the wing (STALL): push the nose down and add power. To land: slow down, flaps down, gear down (airliners), line up with the runway, and touch down gently (watch V/S).
          To take off: full throttle (hold W) on the runway, then ease the cursor ${climb} (or hold ${invert ? "↓" : "↑"}) at about ${Math.round(plane.stall * 1.3 * 3.6)} km/h. Airliners turn slowly, so start turns early.</div>
          <h2>Settings</h2><div class="pg-row">
          <button data-a="sound">${sound ? '🔊 Sound on' : '🔇 Sound off'}</button>
          <button data-a="gpws" title="Spoken ground proximity warnings and radio-altimeter calls on the airliners">${gpwsOn ? '✓ ' : ''}GPWS voice (airliners)</button>
          <button data-a="units">${units === 'kmh' ? 'km/h · m' : 'knots · feet'}</button>
          <button data-a="failures">Failures: ${failures === 'off' ? 'off' : failures === 'often' ? 'often (every mode)' : 'rare (Free Flight, Landing)'}</button></div>
          <h2>GPWS (airliners)</h2><div class="pg-hint">Like a real cockpit, the airliners speak: <b>One hundred knots, V one, Rotate, Positive rate</b> on take-off; <b>One thousand, Five hundred, Approaching minimums,
          Minimums, One hundred, Fifty, Forty, Thirty, Twenty, Ten</b> and <b>Retard</b> on the way down with the gear down; and warnings: <b>Sink rate</b>, <b>Terrain, terrain</b> and <b>Pull up</b>, <b>Too low, gear</b>, <b>Too low, terrain</b>,
          <b>Too low, flaps</b>, <b>Glideslope</b> (below the 3° path to the runway) and <b>Bank angle</b>. They use your computer's own voice, and show on the panel too. The Hoop Rush and Time Trial challenges skip the warnings.</div>
          <h2>Damage</h2><div class="pg-hint">Clip a tree, a building or the ground with a wingtip and that wing tears off: the plane rolls hard towards the stump.
          Keep the nose down near the runway: past your aircraft's limit (about 14° in the Cessna, 10° in a 747) the tail scrapes, which damages it and weakens the elevator, and a hard enough scrape breaks it off. Watch the fuel gauge too. Hit something with the nose or tail, or the ground too hard, and it breaks up. Too fast and the wings come off; pulling far too hard snaps one.
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
        else if (a === 'invert') { invert = !invert; write('invertY', invert); renderUI(); }
        else if (a === 'gpws') { gpwsOn = !gpwsOn; write('gpws', gpwsOn); if (!gpwsOn) cancelSpeech(); renderUI(); }
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
      render(t);
      raf = requestAnimationFrame(frame);
    }
    renderUI();
    raf = requestAnimationFrame(frame);
    root.focus();
    // For tests: the live flight state.
    window.NotchPlaneGame.key = (key, down) => onKey({ key, repeat: false, target: null }, down);
    window.NotchPlaneGame._state = () => ({ screen, keys: [...keys], bank: flight.bank, pitch: flight.pitchAngle, pos: flight.pos, w: flight.w, onGround: flight.onGround,
      speed: flight.speed, damage: flight.damage, crashed: flight.crashed, why: flight.why, debris: debris.length, particles: smoke.length });
    window.NotchPlaneGame._poke = { failEngine: (p) => { failAt = elapsed; }, flight: () => flight,
      // Test hooks for looking at the models: a fixed camera, held controls, and freezing the physics.
      view: (v) => { devView = v; }, ctl: (c) => { devCtl = c; }, hold: (h) => { devHold = h; }, plane: () => plane, surf };

    return () => {
      alive = false; cancelAnimationFrame(raf); cancelSpeech();
      window.removeEventListener('keydown', kd); window.removeEventListener('keyup', ku); window.removeEventListener('blur', blur);
      document.removeEventListener('visibilitychange', hidden);
      try { ac?.close(); } catch { /* already closed */ }
      root.remove();
    };
  }

  window.NotchPlaneGame = { mount, PLANES, MODES, CHALLENGES, Flight, _test: { raCallout, gpwsWarnings, groundAt, makeWorld, qheading, qrot, hitObject, terrainAt, surfaceAt, roughnessAt, normalAt } };
})();
