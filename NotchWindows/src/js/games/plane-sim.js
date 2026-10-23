// Plane: a small 3D flight game for the Games tab, shared by the Windows app (games.js imports it) and the Mac app
// (NotchApple/Resources/PlaneGame.html loads it in a web view). One plain script with no dependencies: a tiny WebGL
// renderer, a flight model that is believable without being a chore (lift from angle of attack, stalls, drag, banked
// turns, take-offs and landings), eighteen aircraft (light planes, a turboprop, business and regional jets, airliners, fighters and helicopters), four modes, challenges and a leaderboard kept on this computer.
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
      // Plain numbers, no temporary arrays: a chunk of scenery builds thousands of these.
      const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2], vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
      let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
      const l = Math.hypot(nx, ny, nz) || 1; nx /= l; ny /= l; nz /= l;
      if (ref && nx * ((a[0] + b[0] + c[0]) / 3 - ref[0]) + ny * ((a[1] + b[1] + c[1]) / 3 - ref[1]) + nz * ((a[2] + b[2] + c[2]) / 3 - ref[2]) < 0) { nx = -nx; ny = -ny; nz = -nz; }
      const d = this.d, c0 = col[0], c1 = col[1], c2 = col[2];
      d.push(a[0], a[1], a[2], nx, ny, nz, c0, c1, c2, b[0], b[1], b[2], nx, ny, nz, c0, c1, c2, c[0], c[1], c[2], nx, ny, nz, c0, c1, c2);
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
  const CATS = [['ga', 'Light aircraft'], ['turbo', 'Turboprop'], ['biz', 'Business & regional'], ['liner', 'Airliners'], ['mil', 'Military: fighters, bombers & gunships'], ['rotary', 'Helicopters']];
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
      stall: 31, cruise: 82, max: 118, thrust: 5.2, authority: 0.8, pitch: 1.2, roll: 1.5, yaw: 0.45, stability: 2.5, gear: 1.4, scale: 1, cam: 1.1,
      span: 5.1, wingY: -0.24, wingZ: -0.14, nose: -4.3, tail: 4.6, gLimit: 5, wingX: 1.0, tailZ: 2.3, tailX: 2.3 },
    { id: 'cit', cat: 'biz', name: 'Cessna Citation', kind: 'Business jet', blurb: 'A small, fast twin jet with a T-tail. Quick to respond, and quick to run out of runway.',
      stall: 46, cruise: 125, max: 190, thrust: 7.2, authority: 0.85, pitch: 1.25, roll: 1.6, yaw: 0.35, stability: 2.3, gear: 1.0, scale: 1, cam: 1.05,
      span: 5.0, wingY: -0.06, wingZ: 2.0, nose: -4.8, tail: 4.8, gLimit: 5.5, wingX: 0.6, tailZ: 1.8, tailX: 2.0 },
    { id: 'e175', cat: 'biz', name: 'Embraer E175', kind: 'Regional jet', blurb: 'A regional twin with its engines on the tail. Light and agile for a jet, with a T-tail.',
      stall: 56, cruise: 130, max: 200, thrust: 7.2, authority: 0.8, pitch: 1.05, roll: 0.95, yaw: 0.28, stability: 2.3, gear: 1.45, scale: 1, cam: 1.4,
      span: 5.2, wingY: -0.01, wingZ: 1.26, nose: -6.35, tail: 6.35, gLimit: 5.2, wingX: 0.7, tailZ: 2.3, tailX: 2.6 },
    { id: 'a220', cat: 'biz', name: 'Airbus A220', kind: 'Airliner', blurb: 'A modern small twin with geared fans. Efficient and nimble, with a big, clean wing.',
      stall: 57, cruise: 138, max: 214, thrust: 7.7, authority: 0.8, pitch: 1.05, roll: 0.92, yaw: 0.26, stability: 2.3, gear: 1.85, scale: 1, cam: 1.85,
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
      stall: 50, cruise: 190, max: 300, thrust: 10.5, authority: 0.95, pitch: 1.8, roll: 3.8, yaw: 0.6, stability: 1.9, gear: 1.35, scale: 1, cam: 1.2,
      span: 3.6, wingY: -0.16, wingZ: 1.35, nose: -5.3, tail: 4.9, gLimit: 9, wingX: 1.0, tailZ: 2.4, tailX: 2.3 },
    { id: 'f16', cat: 'mil', name: 'F-16 Falcon', kind: 'Fighter', blurb: 'A light, agile single-engine fighter with one big tail. Quick to roll, quick to climb and forgiving to land.',
      stall: 49, cruise: 190, max: 310, thrust: 10.5, authority: 0.95, pitch: 1.9, roll: 4.0, yaw: 0.6, stability: 1.8, gear: 1.35, scale: 0.95, cam: 1.15,
      span: 3.4, wingY: -0.16, wingZ: 1.35, nose: -5.3, tail: 4.9, gLimit: 9, wingX: 1.0, tailZ: 2.4, tailX: 2.3 },
    { id: 'f15', cat: 'mil', name: 'F-15 Eagle', kind: 'Fighter', blurb: 'A big twin-engine air-superiority fighter with twin tails. Fast and powerful, a little heavier to turn.',
      stall: 56, cruise: 205, max: 335, thrust: 12.5, authority: 0.9, pitch: 1.6, roll: 3.2, yaw: 0.55, stability: 2.0, gear: 1.35, scale: 1.2, cam: 1.3,
      span: 3.9, wingY: -0.16, wingZ: 1.35, nose: -5.3, tail: 4.9, gLimit: 9, wingX: 1.0, tailZ: 2.4, tailX: 2.3 },
    { id: 'f18', cat: 'mil', name: 'F/A-18 Hornet', kind: 'Carrier fighter', blurb: 'A carrier fighter built to be flown slow. Stable on approach, with a forgiving stall and strong low-speed control.',
      stall: 45, cruise: 180, max: 305, thrust: 10.5, authority: 1.0, pitch: 1.8, roll: 3.5, yaw: 0.6, stability: 2.1, gear: 1.35, scale: 1.05, cam: 1.2,
      span: 3.7, wingY: -0.16, wingZ: 1.35, nose: -5.3, tail: 4.9, gLimit: 7.5, wingX: 1.0, tailZ: 2.4, tailX: 2.3 },
    { id: 'typhoon', cat: 'mil', name: 'Eurofighter Typhoon', kind: 'Delta-canard fighter', blurb: 'A delta wing with canards and a single fin. Very agile and very quick off the mark.',
      stall: 52, cruise: 195, max: 325, thrust: 12, authority: 1.0, pitch: 2.1, roll: 3.8, yaw: 0.55, stability: 1.5, gear: 1.35, scale: 1.0, cam: 1.2,
      span: 3.3, wingY: -0.16, wingZ: 1.35, nose: -5.3, tail: 4.9, gLimit: 9, wingX: 1.0, tailZ: 2.4, tailX: 2.3 },
    { id: 'f22', cat: 'mil', name: 'F-22 Raptor', kind: 'Stealth fighter', blurb: 'A stealth fighter with huge thrust and twin canted tails. The most powerful and nimble jet here.',
      stall: 54, cruise: 215, max: 350, thrust: 14.5, authority: 1.0, pitch: 2.1, roll: 4.0, yaw: 0.6, stability: 1.6, gear: 1.35, scale: 1.15, cam: 1.25,
      span: 3.7, wingY: -0.16, wingZ: 1.35, nose: -5.3, tail: 4.9, gLimit: 9, wingX: 1.0, tailZ: 2.4, tailX: 2.3 },
    { id: 'su27', cat: 'mil', name: 'Sukhoi Su-27', kind: 'Fighter', blurb: 'A large, very manoeuvrable twin-engine fighter with twin tails. Loves tight turns.',
      stall: 54, cruise: 200, max: 330, thrust: 12, authority: 1.0, pitch: 1.9, roll: 3.3, yaw: 0.55, stability: 1.8, gear: 1.35, scale: 1.3, cam: 1.35,
      span: 3.9, wingY: -0.16, wingZ: 1.35, nose: -5.3, tail: 4.9, gLimit: 9, wingX: 1.0, tailZ: 2.4, tailX: 2.3 },
    { id: 'a10', cat: 'mil', name: 'A-10 Warthog', kind: 'Gunship', blurb: 'A slow, tough tank-buster: straight wings, two engines on pods and a huge cannon. Best flown low in Air War, where it carries the most ammunition and shrugs off hits.',
      stall: 44, cruise: 125, max: 190, thrust: 8, authority: 1.0, pitch: 1.5, roll: 2.4, yaw: 0.6, stability: 2.0, gear: 1.4, scale: 1.25, cam: 1.3,
      span: 5.6, wingY: -0.16, wingZ: 1.35, nose: -5.3, tail: 4.9, gLimit: 7, wingX: 1.0, tailZ: 2.4, tailX: 2.3 },
    { id: 'b52', cat: 'mil', name: 'B-52 Stratofortress', kind: 'Heavy bomber', blurb: 'A huge swept high wing, four engines and a bomb bay for forty bombs, with gunners who shoot back at fighters. Slow to turn: line up every run early.',
      stall: 62, cruise: 165, max: 245, thrust: 7.2, authority: 0.75, pitch: 0.8, roll: 0.45, yaw: 0.18, stability: 2.5, gear: 2.4, scale: 1, cam: 3.0,
      span: 15, wingY: 0.7, wingZ: 0.8, nose: -14, tail: 14.5, gLimit: 3.5, wingX: 1.7, tailZ: 5.6, tailX: 5.5 },
    // Helicopters: the rotor does the lifting (`rotor`), so the wing numbers are only for show. `rotorLift` is the
    // disc's thrust in g at full collective (1.25 is enough to climb out of ground effect), `rotorR` the blade
    // length used for ground effect, and thrust stays 0: the engine only drives the rotor. Lift comes from the
    // disc along the body's up axis, so pitching or banking tilts it and the helicopter flies like the real thing.
    { id: 'r44', cat: 'rotary', name: 'Robinson R44', kind: 'Light helicopter', blurb: 'A four-seat piston helicopter with a skidded gear, light on the controls. Hover, then tilt the disc to fly.',
      rotor: true, rotorLift: 1.9, rotorR: 5.05,
      stall: 44, cruise: 45, max: 65, thrust: 0, authority: 1, pitch: 0.85, roll: 0.95, yaw: 0.7, stability: 0.55, gear: 1.35, scale: 1, cam: 1,
      span: 0.6, wingY: -0.5, wingZ: -2.2, nose: -2.6, tail: 5.6, gLimit: 3.5, wingX: 0.5, tailZ: 4.6, tailX: 0.6 },
    { id: 'b206', cat: 'rotary', name: 'Bell 206 JetRanger', kind: 'Utility helicopter', blurb: 'The classic turbine light helicopter: quick on the pedals, with a teetering two-blade rotor. Carries slung loads in its day.',
      rotor: true, rotorLift: 1.95, rotorR: 5.2,
      stall: 46, cruise: 52, max: 72, thrust: 0, authority: 1, pitch: 0.85, roll: 1.0, yaw: 0.75, stability: 0.5, gear: 1.45, scale: 1, cam: 1,
      span: 0.7, wingY: -0.55, wingZ: -2.4, nose: -2.7, tail: 5.9, gLimit: 3.5, wingX: 0.55, tailZ: 4.9, tailX: 0.6 },
    { id: 'ah64', cat: 'rotary', name: 'AH-64 Apache', kind: 'Attack helicopter', blurb: 'A twin-engine gunship on wheels: heavy, twin-rotor scream, and the fuselage barely moves when you pull the collective.',
      rotor: true, rotorLift: 1.85, rotorR: 7.3,
      stall: 48, cruise: 55, max: 76, thrust: 0, authority: 1, pitch: 0.75, roll: 0.8, yaw: 0.65, stability: 0.6, gear: 1.2, scale: 1, cam: 1,
      span: 0.9, wingY: -0.6, wingZ: -2.6, nose: -3.4, tail: 6.4, gLimit: 3.5, wingX: 0.6, tailZ: 5.4, tailX: 0.7 },
  ];

  /// Per-aircraft cockpit data: what kind of engine it has (for the sound and the engine gauge), the speeds painted on its
  /// airspeed indicator (m/s), how its flaps step, how much fuel it carries (seconds at full power) and the ticks it
  /// calls out on take-off. `vr` is the rotation speed. `gpws` says whether it speaks (true: airliner calls and warnings,
  /// false: nothing, 'betty': just "Pull up"); left out, it follows `retract`. `ab` is an afterburner.
  const AIRCRAFT = {
    c172: { tailPitch: 14, engine: 'piston', cyl: 4, rpmIdle: 700, rpmMax: 2700, dial: 'GA', flapNotches: [0, 0.33, 0.67, 1], flapLabels: ['UP', '10°', '20°', '30°'], fuel: 2100, vr: 1.12, vfe: 1.6, vno: 1.25 },
    pa28: { tailPitch: 13, engine: 'piston', cyl: 4, rpmIdle: 650, rpmMax: 2700, dial: 'GA', flapNotches: [0, 0.33, 0.67, 1], flapLabels: ['UP', '10°', '25°', '40°'], fuel: 2400, vr: 1.12, vfe: 1.55, vno: 1.25 },
    sr22: { tailPitch: 13, engine: 'piston', cyl: 6, rpmIdle: 750, rpmMax: 2700, dial: 'GA', flapNotches: [0, 0.5, 1], flapLabels: ['UP', '50%', '100%'], fuel: 2500, vr: 1.15, vfe: 1.55, vno: 1.3 },
    pc12: { retract: true, gearTime: 3.5, tailPitch: 12, engine: 'turboprop', engines: 1, cyl: 8, n1Idle: 26, rpmIdle: 1000, rpmMax: 1700, dial: 'GA', flapNotches: [0, 0.33, 0.67, 1], flapLabels: ['UP', '15°', '30°', '40°'], fuel: 2700, vr: 1.15, vfe: 1.6, vno: 1.25, gpws: false },
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
    f16: { retract: true, gearTime: 3, tailPitch: 14, engine: 'jet', engines: 1, n1Idle: 30, ab: true, dial: 'FIGHTER', flapNotches: [0, 0.5, 1], flapLabels: ['UP', 'T/O', 'LAND'], fuel: 1200, vr: 1.2, vfe: 1.9, vno: 1.3, gpws: 'betty' },
    f15: { retract: true, gearTime: 3, tailPitch: 14, engine: 'jet', engines: 2, n1Idle: 30, ab: true, dial: 'FIGHTER', flapNotches: [0, 0.5, 1], flapLabels: ['UP', 'T/O', 'LAND'], fuel: 1500, vr: 1.2, vfe: 1.9, vno: 1.3, gpws: 'betty' },
    f18: { retract: true, gearTime: 3, tailPitch: 14, engine: 'jet', engines: 2, n1Idle: 30, ab: true, dial: 'FIGHTER', flapNotches: [0, 0.5, 1], flapLabels: ['UP', 'T/O', 'LAND'], fuel: 1300, vr: 1.2, vfe: 1.9, vno: 1.3, gpws: 'betty' },
    typhoon: { retract: true, gearTime: 3, tailPitch: 14, engine: 'jet', engines: 2, n1Idle: 30, ab: true, dial: 'FIGHTER', flapNotches: [0, 0.5, 1], flapLabels: ['UP', 'T/O', 'LAND'], fuel: 1300, vr: 1.2, vfe: 1.9, vno: 1.3, gpws: 'betty' },
    f22: { retract: true, gearTime: 3, tailPitch: 14, engine: 'jet', engines: 2, n1Idle: 30, ab: true, dial: 'FIGHTER', flapNotches: [0, 0.5, 1], flapLabels: ['UP', 'T/O', 'LAND'], fuel: 1500, vr: 1.2, vfe: 1.9, vno: 1.3, gpws: 'betty' },
    a10: { retract: true, gearTime: 3, tailPitch: 12, engine: 'jet', engines: 2, n1Idle: 28, dial: 'FIGHTER', flapNotches: [0, 0.5, 1], flapLabels: ['UP', 'T/O', 'LAND'], fuel: 1800, vr: 1.2, vfe: 1.9, vno: 1.3, gpws: 'betty' },
    b52: { retract: true, gearTime: 6, tailPitch: 8, engine: 'jet', engines: 4, n1Idle: 26, dial: 'AIRLINER', flapNotches: [0, 0.3, 0.6, 1], flapLabels: ['UP', '1', '2', 'FULL'], fuel: 2200, vr: 1.2, vfe: 1.5, vno: 1.3, gpws: 'betty' },
    su27: { retract: true, gearTime: 3, tailPitch: 14, engine: 'jet', engines: 2, n1Idle: 30, ab: true, dial: 'FIGHTER', flapNotches: [0, 0.5, 1], flapLabels: ['UP', 'T/O', 'LAND'], fuel: 1600, vr: 1.2, vfe: 1.9, vno: 1.3, gpws: 'betty' },
    // Helicopters: `turboshaft` drives the rotor (its own gauge, spool and sound), and the throttle is the
    // collective. No flaps (the flap field is only cosmetic here); the tail rotor is the yaw control.
    r44: { tailPitch: 10, engine: 'turboshaft', engines: 1, cyl: 4, n1Idle: 55, rpmIdle: 2500, rpmMax: 2900, dial: 'GA', flapNotches: [0], flapLabels: ['UP'], fuel: 2300, vr: 0, vfe: 1.5, vno: 1.25, gpws: false },
    b206: { tailPitch: 10, engine: 'turboshaft', engines: 1, n1Idle: 55, rpmIdle: 6000, rpmMax: 6600, dial: 'GA', flapNotches: [0], flapLabels: ['UP'], fuel: 2400, vr: 0, vfe: 1.5, vno: 1.25, gpws: false },
    ah64: { tailPitch: 9, engine: 'turboshaft', engines: 2, n1Idle: 58, rpmIdle: 2200, rpmMax: 2600, dial: 'GA', flapNotches: [0], flapLabels: ['UP'], fuel: 1700, vr: 0, vfe: 1.5, vno: 1.3, gpws: 'betty' },
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

  /// A rounded glow (a little sphere) for light halos.
  function orb(b, p, r) { revolveZ(b, p, [[-r, 0, [1, 1, 1]], [-0.75 * r, 0.66 * r, [1, 1, 1]], [0, r, [1, 1, 1]], [0.75 * r, 0.66 * r, [1, 1, 1]], [r, 0, [1, 1, 1]]], 9); }

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
    // A faint panel-to-panel tone variation, so painted metal does not look like one flat colour.
    gridMesh(b, P, (r, c) => { const col = colAt((rings[r].z + rings[r + 1].z) / 2, ((c + 0.5) / n) * 360, r); return col && cmul(col, 0.968 + 0.032 * hash2(r * 7 + 3, c * 5 + 1)); }, { closed: true, smoothRows: true, refs: rings.map((rg) => [0, rg.cy, rg.z]) });
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
  /// Which separable section a point belongs to: the tail group (T), the wings (L, R) and their outer panels (Lo, Ro), the
  /// nose and cockpit section (N) and the rest of the fuselage (F). (Engines are picked out by their own position.)
  const bucketOf = (spec, cx, cz) => {
    if (cz >= spec.tailZ && Math.abs(cx) < (spec.tailX || 1e9)) return 'T';
    const out = spec.span * (spec.scale || 1) * 0.58;
    if (cx < -spec.wingX) return cx < -out ? 'Lo' : 'L';
    if (cx > spec.wingX) return cx > out ? 'Ro' : 'R';
    return cz < spec.nose * (spec.scale || 1) * 0.5 ? 'N' : 'F';
  };
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
      if (c.c0 > 0.001) {
        gridMesh(W.b, [loop(sa, 0, c.c0), loop(sb, 0, c.c0)], (r, i) => (i < nl0 ? colB : col));
        // A dark seam along the hinge, top and bottom.
        const mid = (s) => mul(add(pt(s, c.c0, 1), pt(s, c.c0, -1)), 0.5), seam = cmul(col, 0.6);
        for (const sgn of [1, -1]) gridMesh(W.b, [[pt(sa, c.c0 - 0.016, sgn, 0.003), pt(sa, c.c0, sgn, 0.003)], [pt(sb, c.c0 - 0.016, sgn, 0.003), pt(sb, c.c0, sgn, 0.003)]], seam, { refs: [mid(sa), mid(sb)] });
      }
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
    if (W.engs) W.engs.push({ x: e.x, y: e.y, z: e.z, r: r * 1.12, len: L * 1.33 });
    W.fans.push({ mesh: fb, at: [e.x, e.y, e.z + 0.105 * L], attach: W.engs ? 'E' + (W.engs.length - 1) : bucketOf(W.spec, e.x, e.z), dir: e.dir || 1 });
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
    const b = new Builder(), W = { b, dyn: [], gears: [], lights: [], fans: [], engs: [], spec: P };
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
    loftRings(b, rings, (z, th) => (z < zN + 0.01 * L ? radome : z > zT - 0.018 * L ? dark : th > 304 || th < 56 ? belly : body));

    // Windows, doors, windscreen.
    const wz0 = zN + S.win[0] * L, wz1 = zN + S.win[1] * L;
    windows(b, rings, wz0, wz1, S.winPitch, S.winTh[0], S.winTh[1], S.winPitch * 0.64, glass);
    if (S.win2) windows(b, rings, zN + S.win2[0] * L, zN + S.win2[1] * L, S.winPitch, S.win2[2], S.win2[3], S.winPitch * 0.64, glass);
    for (const [df, dw] of S.doors) outline(b, rings, zN + df * L, zN + df * L + dw, 62, 114, lerp(body, [0.4, 0.43, 0.48], 0.45));
    // Cockpit: four windscreen panes across the upper nose and a side window each side.
    const wv = zN + nl * 0.7, wl = nl * 0.33, gl2 = [0.09, 0.14, 0.2];
    for (const [t0, t1] of [[150, 177], [183, 210], [124, 146], [214, 236]]) patch(b, rings, wv, wv + wl, t0, t1, gl2, 0.016);
    for (const sg of [1, -1]) patch(b, rings, wv + wl * 0.5, wv + wl * 1.5, ...(sg > 0 ? [100, 118] : [242, 260]), gl2, 0.016);

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
    return { body: b, dyn: W.dyn, gears: W.gears, lights: W.lights, fans: W.fans, engs: W.engs };
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
    // A heavy bomber: a long slim fuselage with a high, swept wing (negative wingLow), four engines and no windows.
    b52: { D: 2.1, noseLen: 0.1, tailLen: 0.3, droop: 0.05, tailUp: 0.5, tailEnd: 0.12, wingLE: 0.3, sweep: 35, cr: 0.17, ck: 0.1, ct: 0.04, xk: 0.4, th: 0.1, dih: -2, ail: [0.78, 0.97], wingLow: -1.0,
      body: '#a3a9b0', belly: '#868d94', trim: '#2c3138', tail: '#9aa1a8', accent: '#2c3138', eng: '#6e757c', wingCol: '#979ea5', wingBot: '#80878e',
      win: [0.13, 0.1305], winPitch: 0.3, winTh: [94, 100], doors: [],
      fin: { z: 0.72, cr: 5.0, ct: 1.8, h: 5.5, sweep: 40 }, htail: { z: 0.86, cr: 3.2, ct: 1.0, semi: 5.2, sweep: 30, dih: 0, y: 0.5 },
      engines: [{ f: 0.2, d: 0.95, len: 2.8, ahead: 1.1, drop: 0.5 }, { f: 0.42, d: 0.95, len: 2.8, ahead: 1.1, drop: 0.5 }], legs: [{ x: 0.0, zf: 0.52, ax: [-0.45, 0.45] }], noseGear: 0.12, wheelR: 0.3, wheelW: 0.14 },
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

  // ---- helicopters
  /// A rotor: `n` blades on a hub, authored in the disc plane. `axis` 'y' gives the main rotor (blades in the
  /// horizontal XZ plane, spinning about y); 'x' gives a tail rotor (blades in the vertical XY plane, spinning
  /// about x). Each blade is a tapered plate from the hub out to `R`. The blur disc is drawn by the renderer
  /// when the rotor is fast.
  function rotorMesh(n, R, axis, o = {}) {
    const b = new Builder(), C = hex(o.col || '#23272e');
    const cR = o.chordR || 0.46, cT = cR * 0.56, th = o.th || 0.028, sw = o.sweep || 0, hub = o.hub || 0.14;
    const spin = (p, a) => axis === 'y'
      ? [p[0] * Math.cos(a) + p[2] * Math.sin(a), p[1], -p[0] * Math.sin(a) + p[2] * Math.cos(a)]
      : [p[0], p[1] * Math.cos(a) - p[2] * Math.sin(a), p[1] * Math.sin(a) + p[2] * Math.cos(a)];
    for (let k = 0; k < n; k++) {
      const a = (k / n) * Math.PI * 2;
      // A blade lies flat in the disc: along the radius, with its chord across it and its thin side facing the axis.
      // Main rotor (axis y): radius along x, chord along z, thickness along y. Tail rotor (axis x): radius along y,
      // chord along z, thickness along x.
      const P = (r, c, t) => axis === 'y' ? spin([r, t, c], a) : spin([t, r, c], a);
      const q = (s) => [P(0, s * cR / 2, -th), P(R, s * cT / 2 + sw, -th), P(R, s * cT / 2 + sw, th), P(0, s * cR / 2, th)];
      b.hexa([...q(-1), ...q(1)], C);
    }
    // Hub: a small sphere where the blades meet, and a ring hugging them.
    blob(b, [0, 0, 0], hub * R / 5.4, C);
    const ring = []; for (let i = 0; i < 24; i++) { const t = (i / 24) * Math.PI * 2; ring.push(axis === 'y' ? [Math.cos(t) * hub * R / 5.4, 0, Math.sin(t) * hub * R / 5.4] : [Math.cos(t) * hub * R / 5.4, Math.sin(t) * hub * R / 5.4, 0]); }
    for (let i = 1; i < ring.length - 1; i++) b.tri(ring[0], ring[i], ring[i + 1], C, [0, 0, 0]);
    // The blur disc: a flat plate the renderer fades in as the rotor speeds up.
    const disc = new Builder();
    // The disc lies in the same plane as the blades (flat for the main rotor, upright for the tail rotor).
    const rr = []; for (let i = 0; i < 28; i++) { const t = (i / 28) * Math.PI * 2; rr.push(axis === 'y' ? [Math.cos(t) * R, 0, Math.sin(t) * R] : [0, Math.cos(t) * R, Math.sin(t) * R]); }
    polyFan(disc, [axis === 'y' ? [0, 0, 0] : [0, 0, 0], ...rr, rr[0]], axis === 'y' ? [0, -1, 0] : [-1, 0, 0], [0.6, 0.6, 0.63]);
    return { mesh: b, disc };
  }

  /// Builds a helicopter: lofted cabin and tail boom, stub wings, a fin and stabilisers, the main rotor on its
  /// mast over the cabin, the tail rotor on the fin, and gear (skids or wheels). Returns the same shape as the
  /// other builders, plus `rotors` (the spinning parts).
  function heliBuild(P, S) {
    const b = new Builder(), W = { b, dyn: [], gears: [], lights: [], fans: [], spec: P }, C = hex, tan = (d) => Math.tan(d * DEG);
    const body = C(S.body), belly = C(S.belly || S.body), trim = C(S.trim), glass = [0.07, 0.1, 0.14], dark = [0.12, 0.12, 0.14];
    const rings = S.rings.map(([z, w, h, cy, e]) => ({ z, w, h, cy, e }));
    loftRings(b, rings, (z, th) => (S.colAt ? S.colAt(z, th, { body, belly, trim }) : th > 302 || th < 58 ? belly : body), 18);
    for (const [z0, z1, t0, t1, mirror] of S.glass) {
      patch(b, rings, z0, z1, t0, t1, glass, 0.014);
      if (mirror !== false) patch(b, rings, z0, z1, 360 - t1, 360 - t0, glass, 0.014);
    }
    for (const [z0, z1, t0, t1, col] of S.paintPatches || []) { patch(b, rings, z0, z1, t0, t1, col, 0.012); patch(b, rings, z0, z1, 360 - t1, 360 - t0, col, 0.012); }
    for (const k of S.stripes || []) stripe(b, rings, k.keys, k.col, 0.014);

    // Stub wings: on a helicopter they are mostly for stores, but they give the silhouette.
    const w = S.wing, semi = P.span, wcol = C(w.col || S.body), wcolB = C(w.colB || w.col || S.body);
    for (const side of [-1, 1]) {
      const secs = w.secs.map(([s, le, c, th]) => ({ s, le, c, th }));
      wingBuild(W, wingFrame(side, w.y, w.dih || 0, w.x0 || 0), secs, { col: wcol, colB: wcolB, cs: [{ kind: 'aileron', s0: semi * 0.45, s1: semi * 0.95, c0: 0.7, side }] });
    }
    // The tail boom extends past the cabin; the fin and stabilisers sit at its end.
    for (const sg of [1, -1]) rod(b, [sg * w.y * 0.9, -0.02, S.boomZ], [sg * w.y * 0.66, 0.05, P.tail - 0.35], 0.11, 0.065, C('#2b2f36'), 6);
    const f = S.fin, fb = wingBuild(W, finFrame(0, f.y, 0, 1), [{ s: 0, le: f.z, c: f.cr, th: 0.1 }, { s: f.h, le: f.z + f.h * tan(f.sweep), c: f.ct, th: 0.08 }], { col: C(f.col || S.body), colB: C(f.col || S.body), cs: [{ kind: 'rudder', s0: 0.1 * f.h, s1: 0.97 * f.h, c0: 0.6, axisUp: true }] });
    for (const side of [-1, 1]) {
      const ft = S.stab;
      wingBuild(W, wingFrame(side, ft.y, ft.dih || 0), [{ s: 0, le: ft.z, c: ft.cr, th: 0.09 }, { s: ft.semi, le: ft.z + ft.semi * tan(ft.sweep || 8), c: ft.ct, th: 0.075 }], { col: C(ft.col || S.body), colB: C(ft.col || S.body), cs: [{ kind: 'elevator', s0: 0.05 * ft.semi, s1: 0.96 * ft.semi, c0: 0.6, side }] });
    }
    for (const lg of S.logo || []) for (const sg of [1, -1]) polyFan(b, lg.pts.map(([v, u]) => fb.pt(v * f.h, u, sg, 0.012)), [sg, 0, 0], lg.col);

    // The mast, the main rotor over the cabin and the tail rotor on the side of the fin.
    rod(b, [0, S.mastY, S.mastZ], [0, S.mastY + S.mastH, S.mastZ], 0.07, 0.055, CHROME, 6);
    const main = rotorMesh(S.rotorN, S.rotorR, 'y', { col: S.rotorCol, chordR: S.rotorChord, th: S.rotorTH, hub: S.rotorHub, sweep: S.rotorSweep });
    const tail = rotorMesh(S.tailRotorN, S.tailRotorR, 'x', { col: S.rotorCol, chordR: S.tailRotorChord, th: S.rotorTH, hub: S.tailRotorHub });
    rod(b, [S.tailXY * 0.2, S.tailY + S.tailRotorR * 0.1, S.tailZ + 0.03], [S.tailXY, S.tailY, S.tailZ + 0.03], 0.05, 0.04, CHROME, 5);

    // Gear: skids (two tubes with pads) for the light helicopters, wheels for the military ones.
    for (const lg of S.legs || []) {
      const lb = new Builder();
      rod(lb, [lg.x, lg.y, lg.z0], [lg.x, -P.gear + lg.drop, lg.z1], lg.r, lg.r, lg.col || LEG, 6);
      if (lg.pad) for (const z of [lg.z0 + lg.pad, lg.z1 - lg.pad]) rod(lb, [lg.x - 0.09, -P.gear, z], [lg.x + 0.09, -P.gear, z], 0.045, 0.045, C(lg.padCol || '#20242a'), 5);
      W.gears.push({ mesh: lb, pivot: [lg.x, lg.y, lg.z0], axis: [1, 0, 0], ang: 0, attach: lg.attach || 'F' });
    }
    for (const o of S.wheels || []) fixedWheel(W, o[0], o[1], o[2], o[3], o[4] || 0.2, o[5] || 0.1, { pant: true, col: o[6] ? C(o[6]) : undefined, r: 0.05, dz: o[7] || 0 });

    // Lights: beacon on the tail boom, navs on the stub wings, a landing light under the nose.
    const lr = 0.05;
    for (const side of [-1, 1]) {
      addLight(W, 'navR', [side * semi * 0.98, w.y, w.secs[0][1] + w.secs[0][2] * 0.5], lr);
      addLight(W, 'strobe', [side * semi * 0.98, w.y, w.secs[0][1] + 0.02], lr);
    }
    addLight(W, 'navW', [0, f.y + f.h * 0.94, f.z + f.h * 0.94 * tan(f.sweep) + f.ct], lr);
    addLight(W, 'beacon', [0, S.beaconY || 0.1, S.beaconZ], lr * 1.1);
    addLight(W, 'land', S.landLight || [0, -0.25, rings[0][0] + 0.15], lr * 1.3);

    return {
      body: b, dyn: W.dyn, gears: W.gears, lights: W.lights, fans: [],
      rotors: [
        { at: [0, S.mastY + S.mastH, S.mastZ], axis: [0, 1, 0], mesh: main.mesh, disc: main.disc },
        { at: [S.tailXY, S.tailY, S.tailZ], axis: [1, 0, 0], mesh: tail.mesh, disc: tail.disc },
      ],
    };
  }

  /// A fixed wheel on a leg: spring-steel leg from the fuselage to the hub, with an optional streamlined fairing.
  function fixedWheel(W, x0, y0, z0, x1, wr, ww, o = {}) {
    const lb = new Builder(), wy = -W.spec.gear + wr, col = o.col || [0.82, 0.84, 0.88];
    rod(lb, [x0, y0, z0], [x1, wy + 0.04, z0 + (o.dz || 0)], (o.r || 0.045) * 1.3, (o.r || 0.045) * 1.15, o.legCol || LEG, 6);
    wheel(lb, x1, wy, z0 + (o.dz || 0), wr, ww);
    if (o.pant) revolveZ(lb, [x1 + Math.sign(x1) * ww * 0.5, wy - 0.01, z0 + (o.dz || 0)], [[-wr * 1.9, 0, col], [-wr * 1.4, wr * 0.52, col], [-wr * 0.5, wr * 0.86, col], [wr * 0.8, wr * 0.84, col], [wr * 1.6, wr * 0.45, col], [wr * 2.1, 0, col]], 10);
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
      colAt: (z, th, c) => (z < -2.35 ? hex('#4a5262') : th > 300 || th < 60 ? c.belly : c.body),
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
  const HELI = {
    r44: { body: '#f2f3f5', belly: '#d9dde3', trim: '#c0392b', rotorCol: '#23272e', rotorChord: 0.5, rotorTH: 0.03, rotorHub: 0.16,
      rings: [[-2.3, 0.07, 0.09, -0.16, 2], [-2.2, 0.34, 0.36, -0.12, 2.2], [-1.9, 0.52, 0.56, -0.05, 2.2], [-1.4, 0.6, 0.68, 0.02, 2.3], [-0.7, 0.62, 0.72, 0.1, 2.4], [0.1, 0.58, 0.66, 0.14, 2.4], [0.9, 0.46, 0.52, 0.16, 2.3], [1.7, 0.34, 0.38, 0.18, 2.2], [2.6, 0.24, 0.28, 0.2, 2.1], [3.6, 0.17, 0.2, 0.24, 2], [4.7, 0.12, 0.14, 0.3, 2], [5.5, 0.09, 0.1, 0.36, 2]],
      glass: [[-1.75, -0.6, 96, 138], [-1.2, 0.2, 140, 222, false], [0.4, 0.95, 118, 150]],
      paintPatches: [[-1.5, -0.1, 20, 40, hex('#c0392b')], [-1.5, 0.4, 320, 340, hex('#c0392b')]],
      colAt: (z, th, c) => (z < -2.1 ? c.trim : th > 302 || th < 58 ? c.belly : c.body),
      wing: { y: -0.5, dih: 0, secs: [[0, -2.2, 1.35, 0.12], [0.6, -1.95, 0.5, 0.09]], col: '#e8eaee' },
      boomZ: 0.9, fin: { z: 3.95, cr: 1.2, ct: 0.62, h: 1.15, sweep: 26, y: 0.28, col: '#f2f3f5' },
      stab: { z: 4.6, y: 0.42, cr: 0.55, ct: 0.3, semi: 0.62, sweep: 10, dih: 0, col: '#e8eaee' },
      mastY: 0.5, mastH: 0.55, mastZ: -0.5, rotorN: 2, rotorR: 5.05, rotorSweep: -0.12,
      tailRotorN: 2, tailRotorR: 1.35, tailXY: -0.55, tailY: 0.75, tailZ: 4.55, tailRotorChord: 0.34, tailRotorHub: 0.18,
      beaconZ: 4.9, beaconY: 0.3, landLight: [0, -0.3, -2.35],
      legs: [{ x: -0.62, y: -0.2, z0: -1.5, z1: 1.3, r: 0.055, pad: 0.4 }, { x: 0.62, y: -0.2, z0: -1.5, z1: 1.3, r: 0.055, pad: 0.4 }],
      logo: [{ pts: [[0.35, 0.2], [0.35, 0.55], [0.62, 0.55], [0.62, 0.25]], col: hex('#c0392b') }] },
    b206: { body: '#e9edf0', belly: '#d3d9de', trim: '#1f5f3f', rotorCol: '#23272e', rotorChord: 0.5, rotorTH: 0.03, rotorHub: 0.18,
      rings: [[-2.4, 0.08, 0.1, -0.16, 2], [-2.3, 0.36, 0.38, -0.12, 2.2], [-2.0, 0.54, 0.58, -0.04, 2.2], [-1.5, 0.62, 0.7, 0.03, 2.3], [-0.8, 0.66, 0.76, 0.12, 2.4], [0.0, 0.62, 0.7, 0.15, 2.4], [1.0, 0.48, 0.54, 0.17, 2.3], [1.9, 0.35, 0.39, 0.19, 2.2], [2.9, 0.25, 0.28, 0.21, 2.1], [4.0, 0.17, 0.2, 0.25, 2], [5.1, 0.12, 0.14, 0.31, 2], [5.85, 0.1, 0.11, 0.36, 2]],
      glass: [[-1.9, -0.7, 96, 140], [-1.3, 0.25, 142, 224, false], [0.45, 1.05, 118, 152]],
      paintPatches: [[-1.6, -0.15, 20, 42, hex('#1f5f3f')], [-1.6, 0.5, 316, 340, hex('#1f5f3f')], [2.2, 5.6, 60, 120, hex('#3b6f56')]],
      colAt: (z, th, c) => (z < -2.2 ? c.trim : z > 1.6 ? hex('#3b6f56') : th > 302 || th < 58 ? c.belly : c.body),
      wing: { y: -0.55, dih: 0, secs: [[0, -2.3, 1.4, 0.12], [0.7, -2.0, 0.55, 0.09]], col: '#e2e7ea' },
      boomZ: 1.0, fin: { z: 4.2, cr: 1.25, ct: 0.62, h: 1.2, sweep: 28, y: 0.3, col: '#e9edf0' },
      stab: { z: 4.9, y: 0.44, cr: 0.6, ct: 0.32, semi: 0.7, sweep: 10, dih: 0, col: '#e2e7ea' },
      mastY: 0.52, mastH: 0.58, mastZ: -0.5, rotorN: 2, rotorR: 5.2, rotorSweep: -0.14,
      tailRotorN: 2, tailRotorR: 1.42, tailXY: 0.58, tailY: 0.8, tailZ: 4.85, tailRotorChord: 0.36, tailRotorHub: 0.18,
      beaconZ: 5.2, beaconY: 0.32, landLight: [0, -0.3, -2.45],
      legs: [{ x: -0.68, y: -0.22, z0: -1.6, z1: 1.4, r: 0.06, pad: 0.42 }, { x: 0.68, y: -0.22, z0: -1.6, z1: 1.4, r: 0.06, pad: 0.42 }],
      logo: [{ pts: [[0.4, 0.15], [0.4, 0.5], [0.68, 0.5], [0.68, 0.2]], col: hex('#1f5f3f') }] },
    ah64: { body: '#3f444a', belly: '#2c3136', trim: '#6b7280', rotorCol: '#23272e', rotorChord: 0.62, rotorTH: 0.05, rotorHub: 0.22,
      rings: [[-3.1, 0.09, 0.1, -0.2, 2.2], [-2.95, 0.34, 0.36, -0.14, 2.1], [-2.6, 0.52, 0.5, -0.06, 2.1], [-2.1, 0.6, 0.56, 0.0, 2.2], [-1.5, 0.62, 0.54, 0.04, 2.2], [-0.8, 0.6, 0.52, 0.06, 2.2], [-0.1, 0.66, 0.58, 0.08, 2.3], [0.7, 0.78, 0.66, 0.02, 2.2], [1.5, 0.66, 0.56, -0.04, 2.2], [2.4, 0.5, 0.46, -0.08, 2.1], [3.4, 0.36, 0.36, -0.1, 2], [4.5, 0.26, 0.28, -0.1, 2], [5.6, 0.18, 0.2, -0.08, 2], [6.35, 0.13, 0.15, -0.05, 2]],
      glass: [[-2.75, -1.9, 108, 150], [-1.4, 0.55, 120, 166], [0.9, 1.6, 140, 210, false]],
      paintPatches: [[-0.2, 2.1, 20, 60, hex('#4d545c')], [4.0, 6.3, 60, 300, hex('#5b636c')]],
      colAt: (z, th, c) => (z < -2.85 ? c.trim : th > 302 || th < 58 ? c.belly : c.body),
      wing: { y: -0.62, dih: 2, secs: [[0, -3.2, 1.6, 0.13], [0.9, -2.8, 0.7, 0.1]], col: '#3a4046' },
      boomZ: 2.6, fin: { z: 5.0, cr: 1.4, ct: 0.7, h: 1.5, sweep: 22, y: 0.2, col: '#3f444a' },
      stab: { z: 5.45, y: 0.24, cr: 0.7, ct: 0.3, semi: 0.78, sweep: 8, dih: 0, col: '#3a4046' },
      mastY: 0.34, mastH: 0.5, mastZ: -0.9, rotorN: 4, rotorR: 7.3, rotorSweep: -0.3,
      tailRotorN: 2, tailRotorR: 1.6, tailXY: -0.72, tailY: 0.75, tailZ: 5.2, tailRotorChord: 0.6, tailRotorHub: 0.3,
      beaconZ: 6.0, beaconY: 0.24, landLight: [0, -0.5, -3.3],
      wheels: [[-0.66, -0.3, -1.7, -0.7, 0.24, 0.13, '#23272e'], [0.66, -0.3, -1.7, 0.7, 0.24, 0.13, '#23272e']],
      logo: [{ pts: [[0.3, 0.25], [0.3, 0.55], [0.62, 0.55], [0.62, 0.3]], col: hex('#c9a227') }] },
  };

  // ---- the stealth fighter: a blended, faceted fuselage, trapezoid wings, twin canted fins and all-moving tail planes
  function fighterBuild(P, S) {
    const b = new Builder(), W = { b, dyn: [], gears: [], lights: [], fans: [], spec: P }, C = hex, tan = (d) => Math.tan(d * DEG);
    const grey = C(S.c1 || '#9ba2ad'), grey2 = C(S.c2 || '#838a95'), grey3 = C(S.c3 || '#6f7681'), radome = C('#555b65'), dark = [0.07, 0.07, 0.08];
    const rings = [[-5.3, 0.03, 0.03, -0.02, 2], [-5.15, 0.2, 0.17, -0.04, 2.4], [-4.5, 0.5, 0.34, -0.04, 2.7], [-3.5, 0.76, 0.5, 0.0, 2.9], [-2.5, 0.92, 0.62, 0.04, 3.1], [-1.1, 1.05, 0.66, 0.07, 3.2],
      [0.6, 1.05, 0.62, 0.08, 3.2], [2.1, 0.92, 0.56, 0.1, 3.0], [3.5, 0.7, 0.48, 0.11, 2.7], [4.4, 0.56, 0.43, 0.11, 2.4], [4.88, 0.5, 0.4, 0.11, 2.1]].map(([z, w, h, cy, e]) => ({ z, w, h, cy, e }));
    loftRings(b, rings, (z, th) => (z < -4.6 ? radome : z > 4.4 ? grey3 : th > 295 || th < 65 ? grey2 : ((Math.floor(z * 1.7) + Math.floor(th / 30)) % 3 === 0 ? grey2 : grey)), 18);
    // Panel lines and the dark inlets on the sides.
    patch(b, rings, -2.6, -1.75, 66, 106, [0.05, 0.05, 0.06], 0.02); patch(b, rings, -2.6, -1.75, 254, 294, [0.05, 0.05, 0.06], 0.02);
    outline(b, rings, -2.7, -1.65, 60, 112, grey3, 0.04);
    for (const [z0, z1, t0, t1] of [[-0.9, 1.4, 150, 172], [-0.9, 1.4, 188, 210], [1.7, 3.2, 160, 200]]) patch(b, rings, z0, z1, t0, t1, grey3, 0.012);
    // Canopy.
    const can = [[-3.35, 0.04, 0.03, 0.5], [-3.0, 0.3, 0.2, 0.6], [-2.4, 0.43, 0.29, 0.66], [-1.5, 0.43, 0.3, 0.66], [-0.8, 0.3, 0.2, 0.6], [-0.4, 0.06, 0.04, 0.53]].map(([z, w, h, cy]) => ({ z, w, h, cy, e: 2 }));
    loftRings(b, can, (z) => (z < -3.2 ? grey3 : [0.26, 0.22, 0.14]), 14);
    // ---- wings: swept, thin, with flaperons and ailerons
    const semi = P.span, wings = {}, wsecs = [{ s: 0, le: -1.65 - ((S.rootC || 3.95) - 3.95) * 0.45, c: S.rootC || 3.95, th: 0.07 }, { s: semi, le: -1.65 - ((S.rootC || 3.95) - 3.95) * 0.45 + semi * tan(S.sweep || 35), c: S.tipC || 0.9, th: 0.05 }];
    for (const side of [-1, 1]) {
      const cs = [{ kind: 'flaperon', s0: semi * 0.28, s1: semi * 0.6, c0: 0.7, side }, { kind: 'aileron', s0: semi * 0.61, s1: semi * 0.93, c0: 0.72, side }];
      wings[side] = wingBuild(W, wingFrame(side, -0.1, -1), wsecs, { col: grey, colB: grey2, cs, camber: 0.008 });
    }
    // ---- tail: twin canted fins with rudders, all-moving tailplanes
    const fsecs = [{ s: 0, le: 1.9, c: 1.8, th: 0.05 }, { s: 1.6, le: 1.9 + 1.6 * tan(42), c: 0.75, th: 0.04 }];
    const finStyle = S.fins || 'canted', finSides = finStyle === 'single' ? [1] : [-1, 1];
    const finHt = finStyle === 'single' ? 2.3 : finStyle === 'twin' ? 1.9 : 1.6;
    const fsecs2 = [{ s: 0, le: 1.9, c: finStyle === 'single' ? 2.4 : 1.8, th: 0.05 }, { s: finHt, le: 1.9 + finHt * tan(finStyle === 'single' ? 38 : 42), c: 0.75, th: 0.04 }];
    for (const side of [-1, 1]) {
      if (finSides.includes(side)) {
      const fb = wingBuild(W, finFrame(finStyle === 'single' ? 0 : side * (finStyle === 'twin' ? 0.62 : 0.42), 0.28, finStyle === 'canted' ? 20 : finStyle === 'twin' ? 6 : 0, side), fsecs2, { col: grey, colB: grey, cs: [{ kind: 'rudder', s0: 0.1, s1: finHt - 0.05, c0: 0.64, axisUp: true }] });
      if (S.stripes !== false) polyFan(b, [fb.pt(1.0, 0.25, 1, 0.012), fb.pt(1.0, 0.55, 1, 0.012), fb.pt(1.35, 0.5, 1, 0.012), fb.pt(1.35, 0.22, 1, 0.012)].map((p) => p), [1, 0, 0], C('#d6b13a'));
      if (S.stripes !== false) polyFan(b, [fb.pt(1.0, 0.25, -1, 0.012), fb.pt(1.0, 0.55, -1, 0.012), fb.pt(1.35, 0.5, -1, 0.012), fb.pt(1.35, 0.22, -1, 0.012)], [-1, 0, 0], C('#d6b13a'));
      }
      wingBuild(W, wingFrame(side, 0.06, -3, 0.5), [{ s: 0, le: 2.75, c: 1.75, th: 0.05 }, { s: 1.55, le: 2.75 + 1.55 * tan(40), c: 0.6, th: 0.04 }], { col: grey, colB: grey2, cs: [{ kind: 'stab', s0: 0, s1: 1.55, c0: 0, h: 0.3, side }], camber: 0.004 });
    }
    if (S.canard) for (const side of [-1, 1]) wingBuild(W, wingFrame(side, 0.12, 0, 0.3), [{ s: 0, le: -2.5, c: 1.3, th: 0.04 }, { s: 1.3, le: -2.5 + 1.3 * tan(45), c: 0.5, th: 0.03 }], { col: grey, colB: grey2, cs: [{ kind: 'stab', s0: 0, s1: 1.3, c0: 0, h: 0.2, side }], camber: 0.004 });
    // Speed brake: two panels on the spine that pop up when the brakes are used.
    for (const sx of [-0.32, 0.32]) {
      const pb = new Builder();
      pb.hexa([[sx - 0.22, 0.62, 1.75], [sx + 0.22, 0.62, 1.75], [sx + 0.22, 0.62, 2.45], [sx - 0.22, 0.62, 2.45], [sx - 0.22, 0.665, 1.75], [sx + 0.22, 0.665, 1.75], [sx + 0.22, 0.665, 2.45], [sx - 0.22, 0.665, 2.45]], grey3);
      W.dyn.push({ kind: 'spoiler', side: 0, mesh: pb, pivot: [sx, 0.64, 1.75], axis: [1, 0, 0], attach: bucketOf(P, sx, 2.1), span: 0.44 });
    }
    // ---- engine nozzle, with a dark, hot-looking bore
    const nz = [0, 0.11, 4.85];
    if (S.twin) {   // two engines: two smaller nozzles side by side
      for (const sx of [-0.27, 0.27]) {
        const n2 = [sx, nz[1], nz[2]];
        revolveZ(b, n2, [[-0.45, 0.27, grey3], [-0.1, 0.26, [0.3, 0.3, 0.33]], [0.12, 0.23, [0.2, 0.2, 0.22]], [0.2, 0.21, dark]], 14);
        revolveZ(b, n2, [[0.2, 0.21, dark], [0.0, 0.12, [0.12, 0.08, 0.06]], [-0.15, 0.0, dark]], 10);
      }
    } else {
    revolveZ(b, nz, [[-0.45, 0.47, grey3], [-0.1, 0.45, [0.3, 0.3, 0.33]], [0.12, 0.4, [0.2, 0.2, 0.22]], [0.2, 0.37, dark]], 16);
    revolveZ(b, nz, [[0.2, 0.37, dark], [0.0, 0.2, [0.12, 0.08, 0.06]], [-0.15, 0.0, dark]], 12);
    }
    if (!S.twin) {
        const sP = [0, 1].map((k) => { const pts = []; for (let i = 0; i < 18; i++) { const a = (i / 18) * Math.PI * 2, rr = k ? 0.4 : 0.44; pts.push([Math.cos(a) * rr, nz[1] + Math.sin(a) * rr, nz[2] + (k ? 0.2 + (i % 2 ? 0.12 : 0) : 0.0)]); } return pts; });
        gridMesh(b, sP, [0.28, 0.28, 0.31], { closed: true, refs: [[0, nz[1], nz[2]], [0, nz[1], nz[2] + 0.2]] });
    }
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
    if (id === 'a10') {
      const m = fighterBuild(P, { c1: '#7a8269', c2: '#6a7259', c3: '#5a6149', sweep: 5, rootC: 3.6, tipC: 2.0, fins: 'twin', stripes: false, twin: true });
      // The two engines sit on pods on top of the rear fuselage.
      for (const sx of [-1, 1]) {
        revolveZ(m.body, [sx * 0.78, 0.82, 2.2], [[-1.5, 0.12, [0.32, 0.34, 0.28]], [-1.1, 0.4, [0.33, 0.36, 0.29]], [0, 0.44, [0.4, 0.43, 0.36]], [1.5, 0.4, [0.38, 0.4, 0.34]], [2.1, 0.3, [0.18, 0.18, 0.2]]], 12);
        rod(m.body, [sx * 0.78, 0.6, 1.4], [sx * 0.5, 0.2, 1.4], 0.16, 0.16, [0.4, 0.43, 0.36], 6);
      }
      return m;
    }
    if (id === 'f35') return fighterBuild(P, {});
    if (id === 'f16') return fighterBuild(P, { c1: '#8a96a3', c2: '#78848f', c3: '#66707b', sweep: 40, rootC: 4.3, tipC: 0.7, fins: 'single', stripes: false });
    if (id === 'f15') return fighterBuild(P, { c1: '#7f8a97', c2: '#6d7884', c3: '#5c6670', sweep: 33, rootC: 4.0, tipC: 1.1, fins: 'twin', stripes: false, twin: true });
    if (id === 'f18') return fighterBuild(P, { c1: '#79838e', c2: '#68717b', c3: '#575f69', sweep: 28, rootC: 4.0, tipC: 1.0, fins: 'canted', stripes: false, twin: true });
    if (id === 'typhoon') return fighterBuild(P, { c1: '#a0a9b3', c2: '#8d97a2', c3: '#7a848f', sweep: 56, rootC: 5.6, tipC: 0.5, fins: 'single', canard: true, stripes: false, twin: true });
    if (id === 'f22') return fighterBuild(P, { c1: '#69727d', c2: '#5c646e', c3: '#4e565f', sweep: 42, rootC: 4.4, tipC: 0.95, fins: 'canted', stripes: false, twin: true });
    if (id === 'su27') return fighterBuild(P, { c1: '#7f9bb5', c2: '#6d889f', c3: '#5b7389', sweep: 42, rootC: 4.6, tipC: 0.9, fins: 'twin', stripes: false, twin: true });
    if (HELI[id]) return heliBuild(P, HELI[id]);

    return { body: new Builder(), dyn: [], gears: [], lights: [], fans: [] };
  }
  // ---- AIRCRAFT MODELS END














  // ------------------------------------------------------------------ the world

  const RUNWAY = { x: 0, z0: 0, z1: -1400, half: 22 };   // the main runway runs from z = 0 towards -z
  /// A second, shorter strip on a plateau in the hills.
  const RIDGE = { x: -2300, z0: 1250, z1: 550, half: 16, y: 120 };
  /// Helipads: a square of concrete with an H. Helicopters start on the first one; the second is on the mountain plateau.
  /// More airfields: one on the southern plain and three on islands in the southern sea. Each has a north-south runway
  /// (take off towards -z), an apron with a hangar, a windsock and a helipad. `island` raises a hilly island round it.
  const AIRFIELDS = [
    { id: 'seaside', name: 'Seaside', x: -1900, z: 3000, len: 1100, half: 18 },
    { id: 'coral', name: 'Coral Island', x: -3200, z: 7000, len: 1000, half: 16, island: { r: 1800, peak: 55 } },
    { id: 'palm', name: 'Palm Atoll', x: 3600, z: 8000, len: 900, half: 16, island: { r: 1700, peak: 45 } },
    { id: 'cay', name: 'Lighthouse Cay', x: 200, z: 8700, len: 700, half: 14, island: { r: 1500, peak: 35 } },
  ];
  const HELIPADS = [
    { id: 'home', name: 'Airfield helipad', x: -75, z: -170, half: 14 },
    { id: 'ridge', name: 'Mountain helipad', x: RIDGE.x + 70, z: 900, half: 14 },
    ...AIRFIELDS.map((a) => ({ id: a.id, name: `${a.name} helipad`, x: a.x + a.half + 30, z: a.z + 35, half: 14 })),
  ];
  /// Where a flight can start: the home airfield first, then each new one (the runway's southern end, facing north).
  const STARTS = [{ id: 'home', name: 'Home airfield', pos: [0, 0, -30], pad: HELIPADS[0] },
    { id: 'gate', name: 'Home gate (apron)', pos: [62, 0, -640], pad: HELIPADS[0], gate: true },
    ...AIRFIELDS.map((a) => ({ id: a.id, name: a.name, pos: [a.x, 0, a.z + a.len / 2 - 40], pad: HELIPADS.find((h) => h.id === a.id) }))];
  /// Aprons, where the ground crew works: the home airfield's two and one beside each new runway.
  const APRONS = [[38, 104, -760, -560], [38, 90, -460, -210], ...AIRFIELDS.map((a) => [a.x + a.half + 8, a.x + a.half + 60, a.z - 55, a.z + 55])];
  /// Every runway end with an instrument landing system: x, the threshold's z, the way the landing runs along z (+1 or -1), length.
  const RUNWAY_ENDS = [];
  {
    const add = (name, x, zStart, zEnd) => {
      const dir = Math.sign(zEnd - zStart);
      RUNWAY_ENDS.push({ name: `${name} ${dir < 0 ? '36' : '18'}`, x, zt: zStart, dir, len: Math.abs(zEnd - zStart), hdg: dir < 0 ? 0 : Math.PI, gs: 3 * Math.PI / 180 });
    };
    add('Home', 0, 0, -1400); add('Home', 0, -1400, 0);
    for (const a of AIRFIELDS) { add(a.name, a.x, a.z + a.len / 2, a.z - a.len / 2); add(a.name, a.x, a.z - a.len / 2, a.z + a.len / 2); }
    add('Mountain strip', RIDGE.x, 1250, 550); add('Mountain strip', RIDGE.x, 550, 1250);
    RUNWAY_ENDS[RUNWAY_ENDS.length - 1].gs = RUNWAY_ENDS[RUNWAY_ENDS.length - 2].gs = 4 * Math.PI / 180;
  }
  /// The best localiser and glideslope signal at a position: the runway end whose approach course the aircraft is on, or null.
  /// `loc` is how far right of the course it is (radians seen from the threshold), `gsDev` how far above the slope (radians).
  function ilsAt(world, pos, gear = 0) {
    let best = null;
    for (const e of RUNWAY_ENDS) {
      const dist = (e.zt - pos[2]) * e.dir;
      if (dist < 300 || dist > 30000) continue;
      const lat = (pos[0] - e.x) * (e.dir < 0 ? 1 : -1), loc = Math.atan2(lat, dist);
      if (Math.abs(loc) > 0.3) continue;
      if (!best || Math.abs(loc) < Math.abs(best.loc)) best = { rwy: e, dist, loc, lat };
    }
    if (!best) return null;
    const elev = groundAt(world, best.rwy.x, best.rwy.zt), ang = Math.atan2(pos[1] - gear - elev, best.dist);
    best.gsDev = ang - best.rwy.gs; best.elev = elev; best.high = pos[1] - gear - elev;
    return best;
  }
  const onApron = (p) => APRONS.some((r) => p[0] > r[0] && p[0] < r[1] && p[2] > r[2] && p[2] < r[3]);
  const onAirfield = (p) => AIRFIELDS.some((a) => Math.abs(p[0] - a.x) < a.half && Math.abs(p[2] - a.z) < a.len / 2 + 5);
  /// Air traffic control: the call that fits what the aircraft is doing now, or null. `st` is { cs, said: Set } and remembers
  /// what has been said (each call is made once per approach or departure).
  const atcWindText = (f) => `${String(Math.round((((f.windFrom || 0) / DEG) % 360 + 360) % 360 / 10) * 10 || 360).padStart(3, '0')} at ${Math.round((f.windSpd || 0) / KT)}`;
  function atcStep(st, f, world) {
    if (f.crashed || f.s.rotor) return null;
    const say = (key, text) => { if (st.said.has(key)) return null; st.said.add(key); return text; };
    const gear = f.s.gear * (f.s.scale || 1), agl = f.pos[1] - gear - groundAt(world, f.pos[0], f.pos[2]), cs = st.cs;
    const num = (e) => e.name.split(' ').pop(), field = (e) => e.name.slice(0, e.name.lastIndexOf(' '));
    // A finished approach or departure is forgotten, so the next circuit gets its calls again.
    if (agl > 120 && st.touched) { for (const k of [...st.said]) if (k.startsWith('app:') || k.startsWith('land:') || k.startsWith('line:') || k === 'vacate') st.said.delete(k); st.touched = false; st.landed = null; }
    if (f.onGround) {
      if (st.cleared && f.speed > 5) { st.landed = st.cleared; st.touched = true; }
      if (f.speed < 1 && onApron(f.pos) && f.engRun && f.t > 2 && !st.said.has('took')) {
        const m = say('push', `Ground, ${cs}: push-back and engine start approved. Taxi to the runway and hold short.`); if (m) return m;
      }
      if (f.speed < 4 && f.engRun) {
        for (const e of RUNWAY_ENDS) {
          const along = (f.pos[2] - e.zt) * e.dir, lat = Math.abs(f.pos[0] - e.x);
          let dh = Math.abs(((f.heading - e.hdg + Math.PI * 3) % (Math.PI * 2)) - Math.PI);
          if (along > -60 && along < 220 && lat < 40 && dh < 0.5 && true) {
            const m = say('line:' + e.name, `Tower, ${cs}: runway ${num(e)}, wind ${atcWindText(f)}. Cleared for take-off.`); if (m) { st.said.add('took'); return m; }
          }
        }
      }
      if (f.speed < 40 && st.landed && st.touched) {
        const m = say('vacate', `Tower, ${cs}: welcome to ${st.landed}. Vacate the runway when able and taxi to the apron.`); if (m) return m;
      }
    } else {
      if (agl > 120 && st.said.has('took')) { const m = say('dep', `Departure, ${cs}: radar contact. Climb at your discretion. Have a good flight.`); if (m) return m; }
      const il = agl > 40 ? ilsAt(world, f.pos, gear) : null;
      if (il && il.dist < 14000) {
        const m = say('app:' + il.rwy.name, `Approach, ${cs}: ${Math.round(il.dist / 1000)} kilometres from runway ${num(il.rwy)}, wind ${atcWindText(f)}. Cleared I L S approach.`); if (m) return m;
        if (il.dist < 3800 && agl < 400) {
          const m2 = say('land:' + il.rwy.name, `Tower, ${cs}: runway ${num(il.rwy)}, wind ${atcWindText(f)}. Cleared to land.`);
          if (m2) { st.cleared = field(il.rwy); return m2; }
        }
      }
    }
    return null;
  }
  /// The step-by-step procedure for what the aircraft is doing now: { title, steps: [{ t, ok }], cur } or null (helicopters,
  /// the cruise). Each step ticks itself off when it is done; `cur` is the first one still to do.
  function procedure(f, world, ctx = {}) {
    const s = f.s;
    if (s.rotor || f.crashed) return null;
    const liner = ['liner', 'biz', 'turbo'].includes(s.cat) && (s.flapNotches || []).length > 2, sp = speedsOf(s);
    const gear = s.gear * (s.scale || 1), agl = f.pos[1] - gear - groundAt(world, f.pos[0], f.pos[2]);
    const kt = (v) => Math.round(v / KT);
    let title, steps = [];
    const il = !f.onGround && agl > 20 ? ilsAt(world, f.pos, gear) : null;
    if (f.onGround && !ctx.took) {
      title = 'BEFORE TAKE-OFF';
      let on = false;
      for (const e of RUNWAY_ENDS) {
        const along = (f.pos[2] - e.zt) * e.dir, lat = Math.abs(f.pos[0] - e.x), dh = Math.abs(((f.heading - e.hdg + Math.PI * 3) % (Math.PI * 2)) - Math.PI);
        if (along > -80 && along < e.len * 0.6 && lat < 30 && dh < 0.4) on = true;
      }
      steps = [['Fuel on board', f.fuel > (s.fuel || 1800) * 0.2], ['Battery on  (Y)', f.battery !== false], ['Beacon on  (O)', f.beaconSw !== false], ['Throttle to idle  (S)', f.engRun || f.throttle < 0.08], ['Start the engine  (I)', f.engRun]];
      if (liner) steps.push(['Flaps for take-off  (F)', f.flapNotch >= 1]);
      if (s.retract) steps.push(['Gear down  (G)', f.gearDown]);
      steps.push(['Release the brake  (Space)', !f.brake], ['Line up on the runway', on], ['Full throttle  (W)', f.throttle > 0.9], [`Rotate at ${kt(sp.vr)} kt  (pull back)`, f.ias >= sp.vr]);
    } else if (il && il.dist < 14000) {
      title = 'APPROACH';
      steps = [[`Slow to ${kt(s.stall * 1.6)} kt`, f.ias <= s.stall * 1.65]];
      if (liner) steps.push(['Flaps for landing  (F)', f.flapNotch >= 2]);
      if (s.retract) steps.push(['Gear down  (G)', f.gearDown]);
      steps.push(['Intercept the ILS  (J lets the autopilot fly it)', Math.abs(il.loc) < 0.012 && Math.abs(il.gsDev) < 0.006], ['Over the threshold: throttle idle, flare', agl < 12 && f.throttle < 0.15]);
    } else if (!f.onGround && ctx.took && agl < 450) {
      title = 'CLIMB-OUT';
      steps = [['Positive rate: pitch for the climb', f.vel[1] > 2]];
      if (s.retract) steps.push(['Gear up  (G)', !f.gearDown]);
      if (liner) steps.push(['Flaps up  (V)', f.flapNotch === 0]);
      steps.push(['Climb away', agl > 300]);
    } else if (f.onGround && ctx.took && f.speed > 3) {
      title = 'LANDING ROLL';
      steps = [['Throttle idle  (S)', f.throttle < 0.1], [s.engine === 'piston' ? 'Brake  (Space)' : 'Brake and reverse thrust  (Space, X)', f.speed < 25 || f.brake], ['Slow to taxi speed', f.speed < 8]];
    } else return null;
    const out = steps.map(([t, ok]) => ({ t, ok: !!ok })), cur = out.findIndex((x) => !x.ok);
    return { title, steps: out, cur };
  }
  /// The orientation of an aircraft from its heading, pitch and bank (what other pilots send).
  const attitudeQ = (h, pi, b) => qmul(qheading(h, pi), qaxis([0, 0, 1], -b));
  const padAt = (p) => HELIPADS.find((h) => Math.abs(p[0] - h.x) < h.half && Math.abs(p[2] - h.z) < h.half) || null;
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
  const FLATS = [[0, -700, 160, 960], [1250, -1350, 450, 550], [600, 1300, 240, 240], [-300, 2800, 240, 240], [2300, -250, 240, 240], [2900, 3100, 560, 560], [520, -1050, 420, 330], ...AIRFIELDS.map((a) => [a.x + 12, a.z, a.half + 70, a.len / 2 + 70])];
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
  /// Time of day and visibility: the sun, the haze colour at the horizon, a light multiplier for everything lit, and stars.
  const TODS = {
    day: { name: 'Day', sun: norm([0.5, 0.64, 0.36]), haze: [0.72, 0.81, 0.91], lum: [1, 1, 1], stars: 0 },
    dawn: { name: 'Dawn', sun: norm([0.82, 0.14, 0.3]), haze: [0.86, 0.66, 0.56], lum: [0.86, 0.74, 0.7], stars: 0.2 },
    dusk: { name: 'Dusk', sun: norm([-0.82, 0.12, 0.3]), haze: [0.78, 0.5, 0.44], lum: [0.78, 0.6, 0.62], stars: 0.35 },
    night: { name: 'Night', sun: norm([0.3, -0.3, 0.2]), haze: [0.06, 0.08, 0.15], lum: [0.2, 0.24, 0.38], stars: 1 },
    cycle: { name: 'Day/night cycle', sun: norm([0.5, 0.64, 0.36]), haze: [0.72, 0.81, 0.91], lum: [1, 1, 1], stars: 0 },
  };
  const DAY_SECONDS = 16 * 60;      // one whole day and night in the cycle
  const VISIBILITY = { clear: { name: 'Clear', fog: 1 }, haze: { name: 'Haze', fog: 0.45 }, fog: { name: 'Fog', fog: 0.14 } };
  const ENV = { tod: 'day', vis: 'clear', lum: [1, 1, 1], stars: 0, fogMul: 1 };
  /// Sets the time of day and visibility (the arrays the shaders read are changed in place).
  function applyEnv(tod, vis) {
    const t = tod === 'cycle' ? cycleLight(ENV.clock ?? 0.35) : TODS[tod] || TODS.day, v = VISIBILITY[vis] || VISIBILITY.clear;
    ENV.tod = TODS[tod] ? tod : 'cycle'; ENV.vis = VISIBILITY[vis] ? vis : 'clear';
    for (let i = 0; i < 3; i++) { SUN[i] = t.sun[i]; ENV.lum[i] = t.lum[i]; }
    const grey = (t.haze[0] + t.haze[1] + t.haze[2]) / 3, k = 1 - v.fog;
    for (let i = 0; i < 3; i++) HAZE[i] = t.haze[i] * (1 - 0.55 * k) + grey * 0.55 * k * 1.08;
    ENV.stars = t.stars * (1 - 0.7 * k); ENV.fogMul = v.fog;
    return ENV;
  }

  /// The light at a moment of the day (0 midnight, 0.25 sunrise, 0.5 noon, 0.75 sunset): the sun climbs in the east and sets in
  /// the west, dawn and dusk colour the sky, and at night it is moonlit with stars.
  function cycleLight(phase) {
    const a = phase * Math.PI * 2 - Math.PI / 2, e = Math.sin(a), rising = Math.cos(a) > 0;
    const D = TODS.day, N = TODS.night, Tw = rising ? TODS.dawn : TODS.dusk, mix = (A, B, k) => A.map((x, i) => x + (B[i] - x) * k);
    let haze, lum, stars;
    if (e >= 0.25) { haze = D.haze; lum = D.lum; stars = 0; }
    else if (e >= 0) { const k = e / 0.25; haze = mix(Tw.haze, D.haze, k); lum = mix(Tw.lum, D.lum, k); stars = Tw.stars * (1 - k); }
    else if (e > -0.15) { const k = (e + 0.15) / 0.15; haze = mix(N.haze, Tw.haze, k); lum = mix(N.lum, Tw.lum, k); stars = 1 - k * (1 - Tw.stars); }
    else { haze = N.haze; lum = N.lum; stars = 1; }
    const sun = e > -0.05 ? norm([Math.cos(a) * 0.85, Math.max(0.04, e), 0.32]) : N.sun;
    return { sun, haze, lum, stars };
  }
  /// Moves the cycle on by dt seconds (when the time of day is the cycle).
  function stepCycle(dt) { if (ENV.tod !== 'cycle') return; ENV.clock = ((ENV.clock ?? 0.35) + dt / DAY_SECONDS) % 1; applyEnv('cycle', ENV.vis); }

  // Smooth value noise for the hills and the mountain ridges.
  function hash2(i, j) { let h = (Math.imul(i, 374761393) + Math.imul(j, 668265263)) | 0; h = Math.imul(h ^ (h >>> 13), 1274126177); return ((h ^ (h >>> 16)) >>> 0) / 4294967296; }
  function vnoise(x, z) {
    const i = Math.floor(x), j = Math.floor(z), fx = x - i, fz = z - j, u = fx * fx * (3 - 2 * fx), v = fz * fz * (3 - 2 * fz);
    const a = hash2(i, j), b = hash2(i + 1, j), c = hash2(i, j + 1), d = hash2(i + 1, j + 1);
    return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
  }
  const fbm = (x, z, oct = 4) => { let s = 0, a = 0.5, f = 1; for (let k = 0; k < oct; k++) { s += vnoise(x * f, z * f) * a; f *= 2.03; a *= 0.5; } return s; };
  /// Ridged noise with rounded crests (no knife edges): the mountains' mass.
  const ridged = (x, z) => { let s = 0, a = 0.55, f = 1; for (let k = 0; k < 4; k++) { const d = vnoise(x * f, z * f) * 2 - 1, n = Math.max(1.2 - Math.sqrt(d * d + 0.05), 0); s += n * n * a; f *= 2.1; a *= 0.46; } return s; };
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
  // ---- battlefields: flat, open, purpose-made places to fight in. The ordinary world is a mountain valley, which is too hard
  // to fight in, so a battlefield replaces all of its ground. Everything is centred on (0, 0); the players' side is the
  // south (+z) and the enemy's the north (-z).
  const ARENAS = [
    { id: 'plains', name: 'Green Plains', blurb: 'Open grassland with gentle rolling hills and a few woods. The easiest place to fly and to drive.', R: 5600, base: 30, rough: 3, hills: 34, rim: 130, journey: true, desert: false },
    { id: 'dunes', name: 'Desert Dunes', blurb: 'Rolling sand dunes and rocks. Tanks hide behind the dunes; planes get a clear view.', R: 5600, base: 26, rough: 15, hills: 22, rim: 180, journey: true, desert: true },
    { id: 'island', name: 'Island Fortress', blurb: 'A round island with a fortress on the hill in the middle, in open sea.', R: 5600, base: 14, rough: 4, hills: 14, rim: 0, desert: false, island: true },
    { id: 'sea', name: 'Open Sea', blurb: 'A chain of small islands in open sea: enemy warships, island bases, and your carrier to land on and rearm.', R: 5600, base: 10, rough: 4, hills: 18, rim: 0, desert: false, island: true, archipelago: [[0, -1800, 900], [-2600, -600, 650], [2400, -2600, 700], [1500, 600, 520], [-1400, -3300, 600]] },
  ];
  let ARENA = null;
  /// Where the front of wave `n` is: the battle travels along a long road, `step` metres further each wave: north, then east, then south,
  /// then back west to the start, round a big square that fits the map, so it is always a journey onwards and never leaves the map.
  /// Wave 1 is at the start (0, 0). Every player works out the same place.
  function journeyCenter(n, step, side = 8000) {
    if (n <= 1) return [0, 0];
    const s = (n - 1) * step, u = s % (4 * side), sway = Math.sin(s / 3500) * 700;
    if (u < side) return [sway, -u];
    if (u < 2 * side) return [u - side, -side + sway];
    if (u < 3 * side) return [side + sway, -side + (u - 2 * side)];
    return [side - (u - 3 * side), sway];
  }
  function arenaHeight(a, x, z) {
    const d = Math.hypot(x, z);
    if (a.island) {
      const wob = (fbm(x / 520 + 7, z / 520 + 2, 2) - 0.5) * 340;
      // Open sea: several small islands instead of one big one.
      const land = a.archipelago ? Math.max(...a.archipelago.map(([ix, iz, ir]) => 1 - smooth(ir * 0.7, ir, Math.hypot(x - ix, z - iz) + wob * ir / 1400))) : 1 - smooth(a.R * 0.84, a.R * 1.02, d + wob);
      const hill = 44 * (1 - smooth(100, 700, d));
      const h = Math.max(a.base + hill + (fbm(x / 260 + 1, z / 260 + 5, 2) - 0.5) * a.rough + (a.hills ? (fbm(x / 600 + 5, z / 600 + 3, 3) - 0.5) * a.hills * 1.4 : 0), 4);
      return -45 + (h + 45) * land;
    }
    const wave = a.desert ? (Math.sin(x / 170 + fbm(x / 420, z / 420, 2) * 5) * Math.cos(z / 210 + 1) * 0.55 + fbm(x / 250, z / 250, 3) - 0.4) * a.rough
      : (fbm(x / 600 + 3, z / 600 + 9, 3) - 0.45) * a.rough;
    const ring = a.journey ? 0 : smooth(a.R * 1.04, a.R * 1.55, d) * a.rim * (0.6 + 0.8 * fbm(x / 800 + 4, z / 800 + 1, 3));   // a low rim of hills round the edge
    const rolling = a.hills ? (fbm(x / 950 + 11, z / 950 + 5, 3) - 0.5) * a.hills * 1.6 + (fbm(x / 380 + 2, z / 380 + 8, 2) - 0.5) * a.hills * 0.5 : 0;      // long, gentle rolling hills
    const h = a.base + wave + rolling + ring;
    const sea = a.journey ? 0 : smooth(a.R * 2.1, a.R * 2.8, d);
    return h + (-45 - h) * sea;
  }
  /// The ground height at (x, z): a battlefield's if one is chosen, otherwise the mountain valley's.
  function terrainShape(x, z) { return ARENA ? arenaHeight(ARENA, x, z) : terrainNatural(x, z); }
  function terrainNatural(x, z) {
    const d = Math.hypot(x - VALLEY[0], z - VALLEY[1]);
    const wx = x + (fbm(x / 1300 + 5.2, z / 1300 + 1.3, 3) - 0.5) * 900, wz = z + (fbm(x / 1300 + 8.1, z / 1300 + 4.7, 3) - 0.5) * 900;
    const plain = smooth(150, 1500, z) * smooth(-2700, -1500, x) * (1 - smooth(2700, 4200, x));   // the coastal plain
    let h = (fbm(wx / 1000, wz / 1000, 5) - 0.34) * 300 * smooth(1300, 2300, d) * (1 - plain * 0.8);   // foothills
    h = Math.max(h, 0) + fbm(x / 420 + 20, z / 420 - 9, 3) * 9;                                    // soft undulations
    const mt = smooth(2700, 4600, d) * (1 - plain * 0.85);
    if (mt > 0.002) {                                                                              // the mountains
      h += (ridged(wx / 1700, wz / 1700) + (fbm(wx / 2600 + 3, wz / 2600 + 9, 3) - 0.3) * 0.5) * 1700 * (0.7 + 0.6 * smooth(4600, 8000, d)) * mt;
      const cr = 1 - Math.abs(fbm(wx / 650 + 13, wz / 650 + 2, 4) * 2 - 1);                         // drainage creases
      h -= cr * cr * 110 * mt;
    }
    h = Math.max(h, 0);
    const zc = 4500 + (fbm(x / 2400 + 40, 7.3, 3) - 0.5) * 1500 + (fbm(x / 650 + 3, z / 650, 2) - 0.5) * 260;   // the coast
    const cw = smooth(zc - 2200, zc - 300, z);
    h = Math.max(h + (smin(h, -2 + (zc - z) * 0.02, 10) - h) * cw, -70);
    for (const a of AIRFIELDS) {                                                                   // islands in the southern sea
      if (!a.island) continue;
      const dd = Math.hypot(x - a.x, z - a.z) * (1 + (fbm(x / 300 + a.x / 50, z / 300, 2) - 0.5) * 0.5), t = 1 - smooth(0.2 * a.island.r, a.island.r, dd);
      if (t <= 0) continue;
      const ih = -62 + (62 + a.island.peak) * t + (fbm(x / 180 + a.z / 40, z / 180, 3) - 0.4) * 30 * t;
      if (ih > h) h = ih;
    }
    const pd = Math.hypot(x - RIDGE.x, z - (RIDGE.z0 + RIDGE.z1) / 2);
    h += (RIDGE.y - h) * (1 - smooth(420, 720, pd));                                               // the plateau
    h = Math.min(h, 14 + 4000 * smooth(110, 1600, Math.hypot(x - BRIDGE.x, z - BRIDGE.z)));          // low banks at the bridge
    const ld = Math.hypot(x - LAKE.x, z - LAKE.z) * (1 + (fbm(x / 380 + 50, z / 380, 2) - 0.5) * 0.45);
    h += (-6 - 14 * (1 - smooth(0, LAKE.r, ld)) - h) * (1 - smooth(LAKE.r - 160, LAKE.r + 80, ld));   // the lake
    const rd = riverDist(x, z), wide = 150 + 170 * smooth(2600, 4800, d);                           // the canyon: wide enough to fly
    h += (-10 - h) * (1 - smooth(wide * 0.4, wide * 1.8, rd));
    if (h > -5) {                                                                                  // the lowland river, with banks
      const r2 = polyDist(x, z, RIVER2) + (vnoise(x / 160, z / 160) - 0.5) * 40;
      h = -5 + (h + 5) * smooth(10, 110, Math.max(r2, 0));
    }
    h *= smooth(0, 220, flatDist(x, z));                                                           // keep the built-up places level
    const edge = Math.max(Math.abs(x), Math.abs(z));
    h += (-45 - h) * smooth(WORLD - 3300, WORLD - 1500, edge);                                      // an island: sea all round
    return Math.max(h, -70);
  }

  // ------------------------------------------------------------------ places
  // The valley is always the same shape; a place adds its famous landmark beside the runway (and the desert, for the
  // dry ones). `cc` is the country code used to match what someone types or where they are.
  const LM = [420, -1050];
  const stepTower = (ctx, x, z, tiers, col) => {   // stacked blocks that narrow as they climb
    let y = ctx.g(x, z);
    for (const [w, h] of tiers) { ctx.block([x, y + h / 2, z], [w, h, w], col, 'landmark'); y += h; }
    return y;
  };
  const frustum = (ctx, x, z, r0, r1, h, y0, col, seg = 4) => {   // a solid cone-ish tier, with a box collider
    ctx.b.cone([x, y0, z], r0, r1, h, col, seg);
    const k = (r0 + r1) / 2 * 0.72;
    ctx.solid([x - k, y0, z - k], [x + k, y0 + h, z + k], 'landmark');
    return y0 + h;
  };
  const LANDMARKS = {
    dubai(ctx) {   // Burj Khalifa and two neighbours
      const [x, z] = LM, c = ctx.hex('#a9c4d8'), c2 = ctx.hex('#7f9db5');
      const top = stepTower(ctx, x, z, [[44, 90], [38, 80], [32, 70], [26, 60], [20, 50], [15, 40]], c);
      ctx.b.cone([x, top, z], 3, 0.4, 70, c2, 6);
      ctx.solid([x - 1.5, top, z - 1.5], [x + 1.5, top + 70, z + 1.5], 'landmark');
      stepTower(ctx, x + 120, z - 60, [[34, 120], [28, 40]], c2);
      stepTower(ctx, x - 110, z + 50, [[30, 100], [24, 50]], c);
    },
    london(ctx) {   // Tower Bridge over the Thames, and the Elizabeth Tower
      const [x, z] = LM, stone = ctx.hex('#8d99a5'), blue = ctx.hex('#3d79c4'), roof = ctx.hex('#3b5b7a');
      ctx.b.quad([x - 80, 0.35, z - 240], [x + 80, 0.35, z - 240], [x + 80, 0.35, z + 240], [x - 80, 0.35, z + 240], blue);
      for (const dx of [-45, 45]) { const t = stepTower(ctx, x + dx, z, [[24, 62]], stone); ctx.b.cone([x + dx, t, z], 15, 0, 22, roof, 4); }
      ctx.block([x, 24, z], [70, 3, 12], ctx.hex('#2f5d8c'), 'landmark');
      ctx.block([x, 62, z], [66, 3, 8], blue, 'landmark');
      const bx = x - 160, bz = z + 150, bt = stepTower(ctx, bx, bz, [[16, 80]], ctx.hex('#c9b48a'));
      ctx.b.cone([bx, bt, bz], 10, 0, 26, ctx.hex('#4f6b5d'), 4);
    },
    paris(ctx) {   // the Eiffel Tower
      const [x, z] = LM, iron = ctx.hex('#6b5b4b'), g = ctx.g(x, z);
      let y = frustum(ctx, x, z, 62, 26, 110, g, iron);
      y = frustum(ctx, x, z, 26, 11, 90, y, iron);
      y = frustum(ctx, x, z, 11, 3, 80, y, iron);
      ctx.b.cone([x, y, z], 1.6, 0.2, 40, iron, 5);
      ctx.b.cone([x, g + 108, z], 40, 40, 4, ctx.hex('#7d6e5d'), 4);
    },
    newyork(ctx) {   // the Empire State Building among the towers
      const [x, z] = LM, st = ctx.hex('#b8bfc6'), glass = ctx.hex('#8fa6b8'), r = ctx.r;
      const top = stepTower(ctx, x, z, [[64, 110], [52, 70], [38, 50], [26, 40], [14, 26]], st);
      ctx.b.cone([x, top, z], 3, 0.3, 55, ctx.hex('#9aa3ab'), 6);
      ctx.solid([x - 1.5, top, z - 1.5], [x + 1.5, top + 55, z + 1.5], 'landmark');
      for (let i = 0; i < 9; i++) {
        const a = i * 0.7, d = 140 + (i % 3) * 40, h = 90 + r() * 140;
        ctx.block([x + Math.cos(a) * d, ctx.g(x, z) + h / 2, z + Math.sin(a) * d], [34 + r() * 20, h, 34 + r() * 20], i % 2 ? glass : st, 'landmark');
      }
    },
    tokyo(ctx) {   // Tokyo Tower, red and white
      const [x, z] = LM, red = ctx.hex('#e2402a'), white = ctx.hex('#f2f2f2'), g = ctx.g(x, z);
      let y = frustum(ctx, x, z, 50, 22, 100, g, red);
      y = frustum(ctx, x, z, 22, 12, 70, y, white);
      y = frustum(ctx, x, z, 12, 6, 70, y, red);
      ctx.b.cone([x, y, z], 3, 0.3, 60, white, 5);
      ctx.b.cone([x, g + 98, z], 34, 34, 4, red, 4);
    },
    sydney(ctx) {   // the Opera House sails and the Harbour Bridge
      const [x, z] = LM, sail = ctx.hex('#f4f1ea'), g = ctx.g(x, z);
      ctx.b.quad([x - 200, 0.35, z - 260], [x + 200, 0.35, z - 260], [x + 200, 0.35, z + 260], [x - 200, 0.35, z + 260], ctx.hex('#2f8fd6'));
      ctx.block([x, 4, z], [120, 8, 80], ctx.hex('#d9d2c2'), 'landmark');
      for (let i = 0; i < 5; i++) {
        const sx = x - 44 + i * 22, h = 46 - Math.abs(i - 2) * 7;
        ctx.b.cone([sx, g + 8, z - 10 + (i % 2) * 8], 15, 0, h, sail, 3);
      }
      for (let k = -9; k <= 9; k++) {
        const bx = x + 40, bz = z + 150 + k * 16, arch = 78 * (1 - (k / 9) ** 2) + 26;
        ctx.block([bx, g + arch, bz], [10, 4, 17], ctx.hex('#7f8a93'), 'landmark');
        if (k % 3 === 0) ctx.b.box([bx, g + (arch + 26) / 2, bz], [2, arch - 26, 2], ctx.hex('#7f8a93'));
        ctx.block([bx, g + 24, bz], [18, 3, 17], ctx.hex('#4a4f55'), 'landmark');
      }
    },
    cairo(ctx) {   // the pyramids of Giza
      const [x, z] = LM, gold = ctx.hex('#d8b66a'), gold2 = ctx.hex('#caa55a');
      for (const [dx, dz, r0, h, col] of [[0, 0, 125, 150, gold], [220, 130, 115, 138, gold2], [400, 250, 58, 70, gold]]) {
        const px = x + dx, pz = z + dz, g = ctx.g(px, pz);
        ctx.b.cone([px, g, pz], r0, 0, h, col, 4);
        for (let k = 0; k < 5; k++) {   // the box colliders follow the slope
          const f = 1 - k / 5, rr = r0 * f * 0.7;
          ctx.solid([px - rr, g + h * k / 5, pz - rr], [px + rr, g + h * (k + 1) / 5, pz + rr], 'landmark');
        }
      }
    },
    sanfrancisco(ctx) {   // the Golden Gate Bridge
      const [x, z] = LM, red = ctx.hex('#c0392b'), g = ctx.g(x, z);
      ctx.b.quad([x - 330, 0.35, z - 130], [x + 330, 0.35, z - 130], [x + 330, 0.35, z + 130], [x - 330, 0.35, z + 130], ctx.hex('#2a74c0'));
      for (const dx of [-170, 170]) {
        for (const o of [-9, 9]) ctx.block([x + dx, g + 80, z + o], [7, 160, 7], red, 'landmark');
        ctx.b.box([x + dx, g + 110, z], [8, 5, 28], red); ctx.b.box([x + dx, g + 70, z], [8, 5, 28], red);
      }
      for (let k = -20; k <= 20; k++) {
        const bx = x + k * 16;
        ctx.block([bx, g + 42, z], [17, 3, 20], red, 'landmark');
        if (Math.abs(k * 16) <= 170) ctx.b.box([bx, g + 42 + (160 - 42) * (1 - ((k * 16) / 170) ** 2) * 0.55 + 14, z + 9], [17, 1.6, 1.6], red);
      }
    },
  };
  const REGIONS = [
    { id: '', name: 'Home valley', lm: 'the hills and the airfield', lat: 0, lon: 0, aliases: ['home', 'valley', 'default'] },
    { id: 'dubai', name: 'Dubai', lm: 'Burj Khalifa', lat: 25.2, lon: 55.27, cc: 'AE', desert: true, aliases: ['uae', 'united arab emirates', 'abu dhabi', 'sharjah', 'emirates'] },
    { id: 'london', name: 'London', lm: 'Tower Bridge', lat: 51.51, lon: -0.12, cc: 'GB', aliases: ['uk', 'united kingdom', 'england', 'britain', 'great britain', 'scotland', 'wales', 'manchester', 'birmingham'] },
    { id: 'paris', name: 'Paris', lm: 'the Eiffel Tower', lat: 48.86, lon: 2.35, cc: 'FR', aliases: ['france'] },
    { id: 'newyork', name: 'New York', lm: 'the Empire State Building', lat: 40.71, lon: -74.0, cc: 'US', aliases: ['nyc', 'usa', 'united states', 'america', 'new york city', 'manhattan'] },
    { id: 'tokyo', name: 'Tokyo', lm: 'Tokyo Tower', lat: 35.68, lon: 139.69, cc: 'JP', aliases: ['japan', 'osaka', 'kyoto'] },
    { id: 'sydney', name: 'Sydney', lm: 'the Opera House and Harbour Bridge', lat: -33.87, lon: 151.21, cc: 'AU', aliases: ['australia', 'melbourne', 'brisbane'] },
    { id: 'cairo', name: 'Cairo', lm: 'the pyramids of Giza', lat: 30.04, lon: 31.24, cc: 'EG', desert: true, aliases: ['egypt', 'giza', 'pyramids'] },
    { id: 'sanfrancisco', name: 'San Francisco', lm: 'the Golden Gate Bridge', lat: 37.77, lon: -122.42, cc: 'US', aliases: ['sf', 'california', 'golden gate', 'los angeles', 'la'] },
  ];
  const regionOf = (id) => REGIONS.find((x) => x.id === id) || REGIONS[0];
  const haversine = (a, b, c, d) => {
    const R = Math.PI / 180, x = Math.sin((c - a) * R / 2) ** 2 + Math.cos(a * R) * Math.cos(c * R) * Math.sin((d - b) * R / 2) ** 2;
    return 12742 * Math.asin(Math.sqrt(x));
  };
  /// The scenery for a place: the country's own landmark if there is one (the nearer of the two for the US), else the nearest.
  function nearestRegion(lat, lon, cc) {
    const list = REGIONS.filter((x) => x.id);
    const same = cc ? list.filter((x) => x.cc === cc) : [];
    const pool = same.length ? same : list;
    return pool.reduce((best, x) => (haversine(lat, lon, x.lat, x.lon) < haversine(lat, lon, best.lat, best.lon) ? x : best));
  }
  /// Matches typed text against the catalogue (names, countries, nicknames); null if it isn't one we know.
  function matchRegion(text) {
    const t = String(text || '').trim().toLowerCase();
    if (!t) return null;
    return REGIONS.find((x) => x.name.toLowerCase() === t || x.id === t || (x.aliases || []).includes(t)) || null;
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
    c.cb = null;
    world.colliders.push(c);
    for (let gx = Math.floor(min[0] / 200); gx <= Math.floor(max[0] / 200); gx++) for (let gz = Math.floor(min[2] / 200); gz <= Math.floor(max[2] / 200); gz++) {
      const k = `${gx},${gz}`; if (!world.grid.has(k)) world.grid.set(k, []); world.grid.get(k).push(c);
    }
    return c;
  }

  // ---- what grows and is painted where

  const GC = { grass: hex('#5b9a3b'), grass2: hex('#78a843'), dry: hex('#9aa755'), forest: hex('#38632b'), alp: hex('#80905a'), rock: hex('#7d7569'), rock2: hex('#6c7170'),
    sand: hex("#e3d2a4"), wet: hex("#b8a47a"), bed: hex('#7f9a84') };
  const DUNE = ['#d9c08a', '#cfb57c', '#e0c993', '#c9ad74'].map(hex);
  const mix3 = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
  /// 1 near the sea, the lake and the rivers (where low ground is beach), 0 inland.
  const shoreNear = (x, z) => Math.max(smooth(3200, 3600, z), 1 - smooth(LAKE.r + 100, LAKE.r + 450, Math.hypot(x - LAKE.x, z - LAKE.z)), 1 - smooth(150, 400, Math.min(riverDist(x, z), polyDist(x, z, RIVER2))));
  /// Trees don't grow on bare ground, steep rock, high up, on the beach or in the water.
  const forestBase = (x, z, y) => smooth(0.40, 0.55, fbm(x / 800 + 11, z / 800 - 7, 3)) * (1 - smooth(480, 760, y + (vnoise(x / 150, z / 150) - 0.5) * 120)) * (0.45 + 0.55 * smooth(6, 40, y));
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
    if (world.desert || world.arena || y < WATER + 5 || y > 90 || ny < 0.955) return 0;       // (a battlefield is plain grass, not a patchwork of fields)
    const f = smooth(0.50, 0.60, fbm(x / 1500 + 60, z / 1500 - 30, 3)) * (1 - smooth(25, 90, y));
    return f > 0.01 && !blocked(world, x, z) ? f : 0;
  }
  /// The base colour of the ground at a vertex (snow, fields and fine detail are added per pixel); out = [r, g, b, farmland].
  function groundColour(world, x, y, z, ny, out) {
    const n1 = vnoise(x / 260 + 3, z / 260), moist = fbm(x / 1100 + 70, z / 1100 - 30, 3);
    let c = mix3(GC.grass, GC.grass2, smooth(0.35, 0.7, n1));
    c = mix3(GC.dry, c, smooth(0.30, 0.56, moist));
    c = mix3(c, GC.alp, smooth(450, 900, y + (n1 - 0.5) * 160));
    const f = world.desert ? 0 : forestP(x, z, y, ny);
    if (world.desert && y < 90) c = mix3(c, DUNE[Math.floor(hash2(Math.floor(x / 220), Math.floor(z / 220)) * DUNE.length)], 0.9 * (1 - smooth(60, 90, y)));
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
    const step = 26, n = Math.floor(TCS / step);
    c.treeList = []; c.bushList = [];
    for (let a = 0; a < n; a++) for (let q = 0; q < n; q++) {
      const x = c.x0 + (a + rr()) * step, z = c.z0 + (q + rr()) * step, roll = rr(), y = terrainAt(world, x, z);
      if (y < WATER + 1.5 || y > 760) continue;
      const fb = forestBase(x, z, y) * (world.desert && y < 80 ? 0.06 : 1);
      if (!(roll < fb * 0.8 || (fb < 0.12 && roll > 0.994))) continue;
      if (blocked(world, x, z)) continue;
      const nrm = normalAt(world, x, z, 6), fp = forestP(x, z, y, nrm[1]) * (world.desert && y < 80 ? 0.06 : 1);
      if (!(roll < fp * 0.8 || (nrm[1] > 0.93 && roll > 0.994))) continue;
      if (world.noTrees && world.noTrees.some((r) => x > r[0] && x < r[1] && z > r[2] && z < r[3])) continue;     // a cleared airstrip stays clear
      const conifer = rr() < smooth(80, 420, y + (vnoise(x / 220, z / 220) - 0.5) * 260) + 0.08, h = conifer ? 12 + rr() * 12 : 9 + rr() * 9, w = h * 0.22;
      const seed = Math.floor(rr() * 4294967296);
      plantTree(near, far, x, y, z, h, conifer, rng(seed));
      c.treeList.push({ x, y, z, h, conifer, seed, solid: addSolid(world, [x - w, y - 1, z - w], [x + w, y + h, z + w], 'tree') });
    }
    // Hedgerows along the field boundaries drawn by the ground shader (160 x 224 m fields).
    const bush = (x, z) => {
      const y = terrainAt(world, x, z), ny = normalAt(world, x, z, 6)[1];
      if (farmAt(world, x, z, y, ny) > 0.55 && rr() > 0.2) { const br = 2.2 + rr() * 0.8, bh = 2.4 + rr(); c.bushList.push([x, y - 0.3, z, br, bh]); near.cone([x, y - 0.3, z], br, 0, bh, TREE_COL.hedge, 4); }
    };
    for (let lx = Math.ceil(c.x0 / 160) * 160; lx < c.x0 + TCS; lx += 160) for (let z = c.z0 + rr() * 22; z < c.z0 + TCS; z += 22) bush(lx, z);
    for (let lz = Math.ceil(c.z0 / 224) * 224; lz < c.z0 + TCS; lz += 224) for (let x = c.x0 + rr() * 22; x < c.x0 + TCS; x += 22) bush(x, lz);
    c.near = near.d.length ? new Float32Array(near.d) : null;
    c.far = far.d.length ? new Float32Array(far.d) : null;
  }
  /// A tree that is hit (by a plane, a tank or a van) breaks: it stops being solid and disappears from the picture, and the game
  /// is told where it stood (world.felled) to throw leaves and make the crack.
  function breakTree(world, solid, remote = false) {
    if (!solid || solid.broken || solid.kind !== 'tree') return false;
    solid.broken = true; world.broken++;
    world.colliders = world.colliders.filter((q) => q !== solid);
    for (let gx = Math.floor(solid.min[0] / 200); gx <= Math.floor(solid.max[0] / 200); gx++) for (let gz = Math.floor(solid.min[2] / 200); gz <= Math.floor(solid.max[2] / 200); gz++) {
      const l = world.grid.get(`${gx},${gz}`); if (l) { const i = l.indexOf(solid); if (i >= 0) l.splice(i, 1); }
    }
    const cx = (solid.min[0] + solid.max[0]) / 2, cz = (solid.min[2] + solid.max[2]) / 2;
    const ci = Math.floor((cx + WORLD) / TCS), cj = Math.floor((cz + WORLD) / TCS);
    const c = ci >= 0 && cj >= 0 && ci < TNC && cj < TNC ? chunkOf(world, ci, cj) : null;
    if (c && c.treeList) {
      const i = c.treeList.findIndex((t) => t.solid === solid), t = c.treeList[i];
      if (i >= 0) { c.treeList.splice(i, 1); world.felled.push([t.x, t.y, t.z, t.h, remote]); }
      const near = new Builder(), far = new Builder();
      for (const q of c.treeList) plantTree(near, far, q.x, q.y, q.z, q.h, q.conifer, rng(q.seed));
      for (const b of c.bushList) near.cone([b[0], b[1], b[2]], b[3], 0, b[4], TREE_COL.hedge, 4);
      c.near = near.d.length ? new Float32Array(near.d) : null; c.far = far.d.length ? new Float32Array(far.d) : null;
      c.treesDirty = true;
    }
    return true;
  }
  /// Clears every tree out of a rectangle (an airstrip): they vanish, nothing falls, and each chunk is rebuilt once.
  function clearTrees(world, x0, x1, z0, z1) {
    (world.noTrees || (world.noTrees = [])).push([x0, x1, z0, z1]);
    const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2, touched = new Set();
    for (const t of treesNear(world, cx, cz, Math.hypot(x1 - x0, z1 - z0) / 2 + 10)) {
      if (t.cx < x0 || t.cx > x1 || t.cz < z0 || t.cz > z1) continue;
      const solid = t.tree; solid.broken = true;
      world.colliders = world.colliders.filter((q) => q !== solid);
      for (let gx = Math.floor(solid.min[0] / 200); gx <= Math.floor(solid.max[0] / 200); gx++) for (let gz = Math.floor(solid.min[2] / 200); gz <= Math.floor(solid.max[2] / 200); gz++) { const l = world.grid.get(`${gx},${gz}`); if (l) { const i = l.indexOf(solid); if (i >= 0) l.splice(i, 1); } }
      const ci = Math.floor((t.cx + WORLD) / TCS), cj = Math.floor((t.cz + WORLD) / TCS);
      if (ci < 0 || cj < 0 || ci >= TNC || cj >= TNC) continue;
      const c = chunkOf(world, ci, cj); if (!c.treeList) continue;
      const i = c.treeList.findIndex((q) => q.solid === solid); if (i >= 0) { c.treeList.splice(i, 1); touched.add(c); }
    }
    for (const c of touched) {
      const near = new Builder(), far = new Builder();
      for (const q of c.treeList) plantTree(near, far, q.x, q.y, q.z, q.h, q.conifer, rng(q.seed));
      for (const b of c.bushList) near.cone([b[0], b[1], b[2]], b[3], 0, b[4], TREE_COL.hedge, 4);
      c.near = near.d.length ? new Float32Array(near.d) : null; c.far = far.d.length ? new Float32Array(far.d) : null; c.treesDirty = true;
    }
  }
  /// The tree standing at (x, z), if there is one (for a break that another player reported).
  function treeAt(world, x, z) {
    primeObjects(world, x, z, 60);
    const list = world.grid.get(`${Math.floor(x / 200)},${Math.floor(z / 200)}`) || [];
    return list.find((c) => c.kind === 'tree' && !c.broken && Math.abs((c.min[0] + c.max[0]) / 2 - x) < 1.6 && Math.abs((c.min[2] + c.max[2]) / 2 - z) < 1.6) || null;
  }
  const hash01 = (x, z, s = 0) => { const v = Math.sin(x * 12.9898 + z * 78.233 + s * 37.719) * 43758.5453; return v - Math.floor(v); };
  /// Every standing tree within `r` metres of (x, z).
  function treesNear(world, x, z, r) {
    primeObjects(world, x, z, r);
    const seen = new Set(), out = [];
    for (let gx = Math.floor((x - r) / 200); gx <= Math.floor((x + r) / 200); gx++) for (let gz = Math.floor((z - r) / 200); gz <= Math.floor((z + r) / 200); gz++) {
      for (const c of world.grid.get(`${gx},${gz}`) || []) {
        if (c.kind !== 'tree' || c.broken || seen.has(c)) continue; seen.add(c);
        const cx = (c.min[0] + c.max[0]) / 2, cz = (c.min[2] + c.max[2]) / 2, d = Math.hypot(cx - x, cz - z);
        if (d < r) out.push({ tree: c, cx, cz, d });
      }
    }
    return out.sort((a, b) => a.d - b.d);
  }
  /// What a blast does to the trees: the ones near the middle are thrown into the air, the ones further out catch fire.
  /// It depends only on where the blast and the trees are, so every player's game picks the same ones.
  function blastTrees(world, p, R, salt = 0) {
    const fly = [], burn = [], core = R * 0.5;
    for (const t of treesNear(world, p[0], p[2], R)) {
      const rnd = hash01(t.cx, t.cz, salt);
      if (t.d < core && rnd < 0.95) fly.push(t); else if (rnd < 0.95 * (1 - 0.6 * t.d / R) + 0.1) burn.push(t);
    }
    return { fly: fly.slice(0, 14), burn: burn.slice(0, 30) };
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

  const PAVED = [[-22, 22, -1440, 40], [44, 72, -1305, -105], [22, 46, -135, -105], [22, 46, -1305, -1275], [22, 46, -715, -685], [38, 90, -460, -210], [38, 104, -760, -560], [RIDGE.x - 16, RIDGE.x + 16, 550, 1250], ...HELIPADS.map((h) => [h.x - h.half, h.x + h.half, h.z - h.half, h.z + h.half]), ...AIRFIELDS.map((a) => [a.x - a.half, a.x + a.half, a.z - a.len / 2, a.z + a.len / 2]), ...APRONS];
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

  function makeWorld(region = REGIONS[0], arena = null) {
    const r = rng(7), b = new Builder(), lights = new Builder(), lightHalo = new Builder(), ground = new Builder(), decal = new Builder(), marks = new Builder(), beacon = new Builder(), lampB = new Builder();
    { const lbox = lights.box.bind(lights); lights.box = (c, sz, col) => { lbox(c, sz, col); blob(lightHalo, c, 2.3, col); }; }   // every light gets a soft halo that shows at night
    const world = { chunks: new Array(TNC * TNC), colliders: [], grid: new Map(), felled: [], broken: 0, turbines: [], keep: [[LM[0], LM[1], 460]], papi: [], socks: [], wind: null, lighthouse: null, region: region.id, desert: !!region.desert || !!(arena && arena.desert), arena: arena ? arena.id : '' };
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
    /// A battlefield's scenery: a base at each end (the players' to the south, the enemy's to the north), rocks for cover,
    /// and on the island a ring of walls round the fortress hill.
    const arenaProps = (a) => {
      const rr = rng(91), conc = hex('#9a9da0'), dark = hex('#6b6f73'), padc = hex('#5d6165');
      const flag = (x, z, col) => { const y = gAt(x, z); b.box([x, y + 7, z], [0.4, 14, 0.4], hex('#d8d8d8')); b.box([x + 2.6, y + 12.2, z], [5, 3, 0.2], col); };
      for (const [bz, col] of [[a.R * 0.78, hex('#2f7fe0')], [-a.R * 0.78, hex('#d8453a')]]) {
        rectQ(decal, -70, 70, bz - 70, bz + 70, 0.12, padc);
        for (const [dx, dz, w, d, h] of [[-48, 0, 26, 18, 10], [48, 0, 26, 18, 10], [0, bz > 0 ? 44 : -44, 36, 14, 8]]) block([dx, gAt(dx, bz + dz) + h / 2, bz + dz], [w, h, d], conc, 'building');
        flag(0, bz, col);
      }
      const n = a.island ? 22 : 46;
      for (let i = 0; i < n; i++) {
        const th = rr() * Math.PI * 2, rad = (a.island ? 0.15 : 0.1) * a.R + rr() * a.R * (a.island ? 0.62 : 0.85), x = Math.cos(th) * rad, z = Math.sin(th) * rad;
        if (Math.hypot(x, Math.abs(z) - a.R * 0.78) < 140 || gAt(x, z) < 2) continue;
        const w = 5 + rr() * 11, h = 2 + rr() * 5, d = 5 + rr() * 11;
        block([x, gAt(x, z) + h / 2 - 0.6, z], [w, h, d], a.desert ? hex('#b69b6a') : dark, 'rock');
      }
      if (a.island) for (let k = 0; k < 16; k++) {
        const th = (k / 16) * Math.PI * 2; if (k % 4 === 0) continue;      // four gates
        const x = Math.cos(th) * 300, z = Math.sin(th) * 300;
        block([x, gAt(x, z) + 4, z], [58, 8, 6], conc, 'building');
      }
    };
    if (!arena) {
    const asphalt = hex('#3a3e44'), shoulder = hex('#4a4f55'), concrete = hex('#979a9d'), paint = hex('#f4f4f1'), yellow = hex('#f1c232'), mown = hex('#5d9a3a'), road = hex('#55595e');

    // ---- the main runway: asphalt, edge lines, centre dashes, thresholds, aiming and touchdown marks, numbers, lights
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
    rectQ(decal, 44, 72, -105, -210, 0.1, asphalt); rectQ(decal, 44, 72, -460, -560, 0.1, asphalt); rectQ(decal, 44, 72, -760, -1305, 0.1, asphalt);
    rectQ(decal, 22, 46, -105, -135, 0.1, asphalt); rectQ(decal, 22, 46, -685, -715, 0.1, asphalt); rectQ(decal, 22, 46, -1275, -1305, 0.1, asphalt);
    rectQ(decal, 38, 90, -210, -460, 0.1, concrete); rectQ(decal, 38, 104, -560, -760, 0.1, concrete);
    bar(57.75, 58.25, -105, -1290, yellow); bar(22, 57.75, -119.75, -120.25, yellow); bar(22, 57.75, -699.75, -700.25, yellow); bar(22, 57.75, -1289.75, -1290.25, yellow);
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
    rectQ(decal, rx - rh, rx + rh, RIDGE.z0 + 25, RIDGE.z1 - 25, ry + 0.1, gravel);
    for (let z = RIDGE.z0 - 30; z > RIDGE.z1 + 30; z -= 50) rectQ(marks, rx - 0.7, rx + 0.7, z, z - 22, ry + 0.14, paint);
    for (const [zt, dir] of [[RIDGE.z0, -1], [RIDGE.z1, 1]]) for (const sg of [-1, 1]) for (let k = 0; k < 4; k++) { const x0 = rx + sg * (3 + k * 2.2); rectQ(marks, x0, x0 + sg * 1.1, zt + dir * 6, zt + dir * 22, ry + 0.14, paint); }
    for (const sg of [-1, 1]) rectQ(marks, rx + sg * (rh - 1.2), rx + sg * (rh - 0.7), RIDGE.z0, RIDGE.z1, ry + 0.14, paint);
    block([rx + 60, ry + 6, 900], [30, 12, 24], hex('#b5651d'), 'hangar'); gable(b, rx + 60, ry + 12, 900, 30, 24, 4, hex('#7f3f00'), true);
    sock(rx - 26, 1210, ry);
    const white2 = hex('#fff4d0'), amber2 = hex('#ffb347');
    // The new airfields: asphalt, centre dashes, threshold bars, edge lights, an apron with a hangar and a windsock.
    for (const a of AIRFIELDS) {
      const y = gAt(a.x, a.z) + 0.1, z0 = a.z - a.len / 2, z1 = a.z + a.len / 2;
      rectQ(decal, a.x - a.half, a.x + a.half, z0, z1, y, asphalt);
      for (let z = z0 + 50; z < z1 - 60; z += 40) rectQ(marks, a.x - 0.4, a.x + 0.4, z, z + 18, y + 0.04, paint);
      for (const [zt, dir] of [[z0, 1], [z1, -1]]) for (let k = 0; k < 6; k++) { const x0 = a.x + (k - 2.5) * 2.6; rectQ(marks, x0 - 0.5, x0 + 0.5, zt + dir * 8, zt + dir * 28, y + 0.04, paint); }
      for (let z = z0; z <= z1; z += 50) for (const sx of [-1, 1]) lights.box([a.x + sx * (a.half + 1.3), y + 0.3, z], [0.7, 0.7, 0.7], Math.min(z - z0, z1 - z) < 150 ? amber2 : white2);
      const ax = a.x + a.half + 8;
      rectQ(decal, ax, ax + 52, a.z - 55, a.z + 55, y, concrete);
      block([ax + 36, y + 5, a.z - 28], [26, 10, 20], hex('#8a9199'), 'hangar'); gable(b, ax + 36, y + 10, a.z - 28, 26, 20, 4, hex('#a04030'), true);
      sock(a.x - a.half - 14, a.z, y - 0.1);
    }
    // Ground-service vehicles parked on the aprons: a fuel truck, a catering truck, a baggage cart and a pushback tug.
    const trucks = (x, z, y) => {
      b.box([x, y + 1.4, z], [2.6, 2.4, 7], hex('#e8e8e8')); b.box([x, y + 2.9, z], [2.2, 1.4, 4.4], hex('#c0392b')); b.box([x, y + 1.4, z + 3.9], [2.4, 2.2, 1.6], hex('#2c3e50'));      // fuel
      b.box([x + 8, y + 1.5, z + 4], [2.6, 2.6, 6.5], hex('#f4f4f1')); b.box([x + 8, y + 3.6, z + 3.2], [2.4, 2.4, 4.4], hex('#2980b9')); b.box([x + 8, y + 1.4, z + 7.8], [2.4, 2.2, 1.6], hex('#2c3e50'));   // catering
      b.box([x - 7, y + 0.6, z + 2], [1.8, 0.9, 3.4], hex('#7f8c8d')); b.box([x - 7, y + 1.4, z + 2.4], [1.7, 0.8, 2.2], hex('#95a5a6'));                                                         // baggage cart
      b.box([x - 11, y + 0.9, z - 3], [2.2, 1.3, 3.6], hex('#e67e22')); b.box([x - 11, y + 1.9, z - 2.4], [1.6, 0.9, 1.6], hex('#34495e'));                                                      // tug
    };
    for (const a of AIRFIELDS) trucks(a.x + a.half + 24, a.z + 6, gAt(a.x, a.z) + 0.1);
    trucks(72, -690, 0.1); trucks(66, -614, 0.1);
    // Helipads: concrete, a yellow edge, a white H and a ring of lights at the corners.
    for (const hp of HELIPADS) {
      const y = gAt(hp.x, hp.z) + 0.1, h = hp.half;
      rectQ(decal, hp.x - h, hp.x + h, hp.z - h, hp.z + h, y, concrete);
      for (const [x0, x1, z0, z1] of [[-h, h, -h, -h + 0.7], [-h, h, h - 0.7, h], [-h, -h + 0.7, -h, h], [h - 0.7, h, -h, h]]) rectQ(marks, hp.x + x0, hp.x + x1, hp.z + z0, hp.z + z1, y + 0.04, yellow);
      rectQ(marks, hp.x - 5, hp.x - 3.2, hp.z - 6, hp.z + 6, y + 0.05, paint); rectQ(marks, hp.x + 3.2, hp.x + 5, hp.z - 6, hp.z + 6, y + 0.05, paint); rectQ(marks, hp.x - 3.2, hp.x + 3.2, hp.z - 0.9, hp.z + 0.9, y + 0.05, paint);
      for (const sx of [-1, 1]) for (const sz of [-1, 1]) lights.box([hp.x + sx * (h - 0.4), y + 0.3, hp.z + sz * (h - 0.4)], [0.6, 0.6, 0.6], hex('#35e06a'));
    }

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
    if (LANDMARKS[region.id]) LANDMARKS[region.id]({ b, block, solid, hex, r, g: gAt });
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

    }
    if (arena) arenaProps(arena);
    // ---- clouds: flat-bottomed puffs in the middle layer (kept off the airfield), a thin high layer above
    const cl = new Builder();
    for (let i = 0; i < 90; i++) {
      const x = (r() - 0.5) * 2 * WORLD, z = (r() - 0.5) * 2 * WORLD, y = 650 + r() * 450, n = 3 + Math.floor(r() * 4), sc = 0.7 + r() * 0.8;
      if (Math.hypot(x, z + 700) < 1600) continue;
      for (let k = 0; k < n; k++) cloudPuff(cl, x + (r() - 0.5) * 160 * sc, y + r() * 14, z + (r() - 0.5) * 110 * sc, (45 + r() * 55) * sc, (22 + r() * 30) * sc, (40 + r() * 45) * sc);
    }
    for (let i = 0; i < 14; i++) {                                    // a higher, bigger layer
      const x = (r() - 0.5) * 2 * WORLD, z = (r() - 0.5) * 2 * WORLD, y = 1600 + r() * 300;
      for (let k = 0; k < 5; k++) cloudPuff(cl, x + (r() - 0.5) * 420, y + r() * 30, z + (r() - 0.5) * 260, 110 + r() * 90, 45 + r() * 40, 90 + r() * 70);
    }
    Object.assign(world, { world: b, clouds: cl, lights, lightHalo, ground, decal, marks, beacon, lampB });
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
    || (Math.abs(p[0] - RIDGE.x) < RIDGE.half && p[2] < RIDGE.z0 + 5 && p[2] > RIDGE.z1 - 5) || onAirfield(p);
  const onRidge = (p) => Math.abs(p[0] - RIDGE.x) < RIDGE.half && p[2] < RIDGE.z0 + 5 && p[2] > RIDGE.z1 - 5;

  // ------------------------------------------------------------------ drawing the world

  const FOG_FAR = 10500, ONE3 = [1, 1, 1];
  /// How much of the haze colour covers something `d` metres (view depth) away; the same curve in every shader.
  const FOG_GLSL = 'float fogAmt(float d, float far) { float x = d / (far * 0.5); return clamp(1.0 - exp(-x * x * 0.9), 0.0, 1.0); }';
  const PREC = '#ifdef GL_FRAGMENT_PRECISION_HIGH\nprecision highp float;\n#else\nprecision mediump float;\n#endif\n';
  const TERRAIN_VS = `attribute vec3 p; attribute vec4 n; attribute vec4 c; uniform mat4 vp;
    varying vec3 wp; varying vec3 wn; varying vec3 wc; varying float wo; varying float wf; varying float vd;
    void main(){ gl_Position = vp * vec4(p, 1.0); vd = gl_Position.w; wp = p; wn = n.xyz; wo = n.w; wc = c.rgb; wf = c.a; }`;
  const TERRAIN_FS = `${PREC}varying vec3 wp; varying vec3 wn; varying vec3 wc; varying float wo; varying float wf; varying float vd;
    uniform sampler2D tx; uniform vec3 fogc; uniform vec3 sun; uniform vec3 cam; uniform float fogFar; uniform vec3 lum;
    ${FOG_GLSL}
    float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
    void main(){
      vec3 n = normalize(wn);
      float dist = length(wp - cam);
      vec2 q = wp.xz;
      float steep = smoothstep(0.18, 0.5, 1.0 - n.y);
      vec2 qv = vec2(wp.x + wp.z, wp.y);
      vec3 t1 = vec3(0.5), t2 = vec3(0.5);
      if (dist < 700.0) { t1 = texture2D(tx, q / 6.0).rgb; if (steep > 0.02) t1 = mix(t1, texture2D(tx, qv / 6.0).rgb, steep); }
      if (dist < 4500.0) { t2 = texture2D(tx, q / 47.0 + vec2(0.37, 0.11)).rgb; if (steep > 0.02) t2 = mix(t2, texture2D(tx, qv / 47.0 + vec2(0.37, 0.11)).rgb, steep); }
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
      col *= lit * lum;
      float f = fogAmt(vd, fogFar) * (1.0 - 0.4 * smoothstep(100.0, 1600.0, wp.y));
      gl_FragColor = vec4(mix(col, fogc, clamp(f, 0.0, 1.0)), 1.0);
    }`;
  const WATER_VS = `attribute vec4 p; uniform mat4 vp; varying vec3 wp; varying float wd; varying float vd;
    void main(){ gl_Position = vp * vec4(p.xyz, 1.0); vd = gl_Position.w; wp = p.xyz; wd = p.w; }`;
  const WATER_FS = `${PREC}varying vec3 wp; varying float wd; varying float vd;
    uniform sampler2D tx; uniform vec3 fogc; uniform vec3 sun; uniform vec3 cam; uniform float fogFar; uniform float time; uniform vec3 lum;
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
      col *= lum;
      float f = fogAmt(vd, fogFar);
      gl_FragColor = vec4(mix(col, fogc, f), mix(alpha, 1.0, f));
    }`;
  const SKY_VS = 'attribute vec2 p; varying vec2 uv; void main(){ uv = p; gl_Position = vec4(p, 1.0, 1.0); }';
  const SKY_FS = `${PREC}varying vec2 uv; uniform vec3 camR; uniform vec3 camU; uniform vec3 camF; uniform vec2 tn; uniform vec3 sun; uniform vec3 haze; uniform vec3 lum; uniform float stars;
    void main(){
      vec3 d = normalize(camF + camR * (uv.x * tn.x) + camU * (uv.y * tn.y));
      float up = clamp(d.y, 0.0, 1.0);
      vec3 sky = mix(haze, vec3(0.34, 0.58, 0.90) * lum, pow(smoothstep(0.0, 0.30, up), 0.8));
      sky = mix(sky, vec3(0.13, 0.33, 0.74) * lum, smoothstep(0.12, 0.85, up));
      float cs = max(dot(d, sun), 0.0);
      sky += vec3(1.0, 0.82, 0.55) * (pow(cs, 6.0) * 0.12 + pow(cs, 90.0) * 0.30);
      sky = mix(sky, vec3(1.0, 0.98, 0.92), smoothstep(0.9993, 0.99965, cs));
      if (d.y < 0.0) sky = mix(haze, haze * 0.95, clamp(-d.y * 8.0, 0.0, 1.0));
      if (stars > 0.0 && d.y > 0.03) { vec3 g = floor(d * 240.0); float h = fract(sin(dot(g, vec3(12.9898, 78.233, 37.719))) * 43758.5453); sky += vec3(step(0.9975, h)) * stars * smoothstep(0.03, 0.3, d.y); }
      gl_FragColor = vec4(sky, 1.0);
    }`;

  /// Everything the plane flies over: sky, level-of-detail ground chunks, trees, painted ground, buildings, lights, clouds, water.
  /// G: the host's GL helpers { prog, U, draw, upload, I, rotorMesh }. Returns { draw(ctx), prime(x, z) }.
  function makeWorldRenderer(gl, W0, G) {
    let W = W0;
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
    const meshesOf = (W) => ({ world: upload(W.world), ground: upload(W.ground), decal: upload(W.decal), marks: upload(W.marks), lights: upload(W.lights), lightHalo: upload(W.lightHalo), beacon: upload(W.beacon), lamp: upload(W.lampB), clouds: upload(W.clouds) });
    let M = meshesOf(W);
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
        if (c.treesDirty && c.treesGL) { if (c.treesGL.near) gl.deleteBuffer(c.treesGL.near.buf); if (c.treesGL.far) gl.deleteBuffer(c.treesGL.far.buf); c.treesGL = null; c.treesDirty = false; }
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
      gl.uniform2f(SK.u('tn'), tf * ctx.aspect, tf); gl.uniform3fv(SK.u('sun'), SUN); gl.uniform3fv(SK.u('haze'), HAZE); gl.uniform3fv(SK.u('lum'), ENV.lum); gl.uniform1f(SK.u('stars'), ENV.stars);
      gl.disableVertexAttribArray(1); gl.disableVertexAttribArray(2);
      gl.bindBuffer(gl.ARRAY_BUFFER, quadBuf); gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
      gl.drawArrays(gl.TRIANGLES, 0, 6);
      gl.enable(gl.DEPTH_TEST);

      // ---- ground chunks
      gl.useProgram(T.p);
      gl.uniformMatrix4fv(T.u('vp'), false, ctx.vp); gl.uniform3fv(T.u('cam'), eye); gl.uniform3fv(T.u('fogc'), HAZE); gl.uniform3fv(T.u('sun'), SUN);
      gl.uniform1f(T.u('fogFar'), FOG_FAR * ENV.fogMul); gl.uniform3fv(T.u('lum'), ENV.lum); gl.uniform1i(T.u('tx'), 3);
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
        for (const [, c, L] of need) { if (performance.now() - t0 > 3) break; if (!c.lod[L]) ensureMesh(c, L); }
        if (performance.now() - t0 < 3) {
          let best = null;
          for (const v of vis) if (v[2] < 3800 && !v[0].treesGL && (!best || v[2] < best[2])) best = v;
          if (best) ensureTrees(best[0]);
        }
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
        // Trees changed since they were uploaded (broken, or cleared for an airstrip): upload them again.
        if (c.treesDirty && c.treesGL) { if (c.treesGL.near) gl.deleteBuffer(c.treesGL.near.buf); if (c.treesGL.far) gl.deleteBuffer(c.treesGL.far.buf); c.treesGL = null; c.treesDirty = false; ensureTrees(c); }
        const g = c.treesGL; if (!g) continue;
        if (d < 1300) draw(g.near); else if (d < 4800) draw(g.far);
      }
      gl.uniform3fv(U.lum, ONE3);   // lamps are not dimmed by the dark
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
      {
        const nk = clamp(1 - ENV.lum[0], 0, 1) * (ENV.tod === 'night' ? 1.2 : 0.8);
        if (nk > 0.08 && M.lightHalo) { gl.enable(gl.BLEND); gl.depthMask(false); gl.uniform1f(U.alpha, clamp(0.12 + 0.3 * nk, 0, 0.5)); draw(M.lightHalo, I, [1, 1, 1], 1.6); gl.uniform1f(U.alpha, 1); gl.depthMask(true); gl.disable(gl.BLEND); }
      }
      gl.uniform3fv(U.lum, ENV.lum);
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
      gl.uniform1f(WA.u('fogFar'), FOG_FAR * ENV.fogMul); gl.uniform3fv(WA.u('lum'), ENV.lum); gl.uniform1f(WA.u('time'), ts); gl.uniform1i(WA.u('tx'), 3);
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
    /// Swaps in another world (a different place): frees the old one's buffers and builds the new one's.
    function setWorld(nw) {
      const del = (m) => { if (m && m.buf) gl.deleteBuffer(m.buf); };
      Object.values(M).forEach(del);
      for (const c of W.chunks) {
        if (!c) continue;
        for (const l of c.lod) if (l) { if (l.vb) gl.deleteBuffer(l.vb); if (l.wb) gl.deleteBuffer(l.wb); }
        if (c.treesGL) { del(c.treesGL.near); del(c.treesGL.far); }
      }
      W = nw; M = meshesOf(W); prime(0, -300);
    }
    return { draw: drawWorld, prime, setWorld };
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
    runway: { roll: 0.02, grip: 1.0, skid: 0.4, soft: 0 },
    road: { roll: 0.03, grip: 0.9, skid: 0.42, soft: 0 },
    grass: { roll: 0.085, grip: 0.7, skid: 0.55, soft: 1 },
    forest: { roll: 0.15, grip: 0.6, skid: 0.65, soft: 1.2 },
    sand: { roll: 0.16, grip: 0.5, skid: 0.7, soft: 1.5 },
    snow: { roll: 0.11, grip: 0.35, skid: 0.2, soft: 0.7 },
    rock: { roll: 0.14, grip: 0.6, skid: 0.7, soft: 1.2 },
  };
  /// Arcade handling rates (radians/s turn, m/s climb, minimum speed) for Easy and Automatic.
  const ARCADE_RATES = { f16: { turn: 0.87, climb: 30, dive: 95, vmin: 70 }, a10: { turn: 0.52, climb: 20, dive: 70, vmin: 60 }, f15: { turn: 0.7, climb: 42, dive: 105, vmin: 95 }, su27: { turn: 0.5, climb: 24, dive: 85, vmin: 70 }, b52: { turn: 0.31, climb: 12, dive: 30, vmin: 70 } };
  const AP_SIGN = { roll: 1, pitch: 1 };   // which way the stick moves the aircraft (checked in the autopilot tests)
  const gauss = () => (Math.random() + Math.random() + Math.random() - 1.5) * 2;
  // ---- weather settings (Fly menu, saved): a runway-relative wind (crosswind and head/tail wind, in knots) and a turbulence level
  const KT = 0.514444;
  const TURB_LEVELS = [['none', 'None', 0], ['light', 'Light', 0.6], ['moderate', 'Moderate', 1.4], ['severe', 'Severe', 2.4], ['extreme', 'Extreme', 3.6]];
  const WX_DEFAULT = { random: false, crossKt: 5, headKt: 0, turb: 'light' };
  const WX_PRESETS = [
    ['calm', 'Calm', { random: false, crossKt: 0, headKt: 0, turb: 'none' }],
    ['breezy', 'Breezy', { random: false, crossKt: 8, headKt: 6, turb: 'light' }],
    ['xwind', 'Crosswind landing', { random: false, crossKt: 20, headKt: 0, turb: 'light' }],
    ['storm', 'Storm', { random: false, crossKt: 38, headKt: 24, turb: 'severe' }],
    ['hurricane', 'Hurricane', { random: false, crossKt: 90, headKt: 0, turb: 'extreme' }],
    ['random', 'Random (like before)', { random: true, crossKt: 0, headKt: 0, turb: 'moderate' }],
  ];
  let WX = { ...WX_DEFAULT };
  const turbMul = (id) => (TURB_LEVELS.find((t) => t[0] === id) || TURB_LEVELS[1])[2];
  const sanWx = (o) => {
    const d = WX_DEFAULT, n = (v, lo, hi, dv) => (Number.isFinite(Number(v)) && v !== null && v !== '' ? clamp(Math.round(Number(v)), lo, hi) : dv);
    o = o && typeof o === 'object' ? o : {};
    return { random: !!o.random, crossKt: n(o.crossKt, -90, 90, d.crossKt), headKt: n(o.headKt, -30, 30, d.headKt), turb: TURB_LEVELS.some((t) => t[0] === o.turb) ? o.turb : d.turb };
  };
  /// The wind as a velocity (m/s, the way it blows) for a runway heading: crossKt > 0 is from the right, headKt > 0 a headwind.
  const wxVector = (heading, w = WX) => {
    const fx = Math.sin(heading), fz = -Math.cos(heading), rx = Math.cos(heading), rz = Math.sin(heading);
    const h = w.headKt * KT, c = w.crossKt * KT;
    return [-h * fx - c * rx, -h * fz - c * rz];
  };
  /// Total speed (kt), the compass direction it blows from (degrees), and the runway-relative parts, for the menu text.
  const wxInfo = (heading = 0, w = WX) => {
    const [vx, vz] = wxVector(heading, w), kt = Math.hypot(vx, vz) / KT;
    return { kt, from: kt < 0.5 ? 0 : (((Math.atan2(-vx, vz) / DEG) % 360) + 360) % 360, cross: w.crossKt, head: w.headKt };
  };
  const wxText = (w = WX) => {
    if (w.random) return 'Random light breeze (0 to 10 kt, any direction), moderate bumps';
    const i = wxInfo(0, w), tl = (TURB_LEVELS.find((t) => t[0] === w.turb) || TURB_LEVELS[1])[1];
    if (i.kt < 0.5) return `Calm · ${tl} turbulence`;
    const parts = [];
    if (w.crossKt) parts.push(`${Math.abs(w.crossKt)} kt crosswind from the ${w.crossKt < 0 ? 'left' : 'right'}`);
    if (w.headKt) parts.push(`${Math.abs(w.headKt)} kt ${w.headKt > 0 ? 'head' : 'tail'}wind`);
    return `Wind ${String(Math.round(i.from / 10) % 36 * 10).padStart(3, '0')}° at ${Math.round(i.kt)} kt (${(i.kt * KT).toFixed(0)} m/s) · ${parts.join(' + ')} · ${tl} turbulence`;
  };
  /// Lift coefficient rounding off smoothly towards its peak `pk`.
  const satCl = (x, pk) => (x < 0.85 * pk ? x : pk - 0.15 * pk * Math.exp(-(x - 0.85 * pk) / (0.15 * pk)));
  const WHAT = { ground: 'Flew into terrain', terrain: 'Hit the hillside', water: 'Ditched in the water', tree: 'Hit a tree',
    building: 'Flew into a building', bridge: 'Hit the bridge', turbine: 'Hit a wind turbine', mast: 'Hit the radio mast',
    hangar: 'Hit a hangar', tower: 'Hit the control tower', flip: 'Flipped over', nose: 'Dived nose-first into the ground', crash: 'Crashed' };

  class Flight {
    constructor(spec) {
      this.s = spec;
      const clMax = 1.35;
      // A helicopter: the rotor does the lifting, along the body's up axis (see `step`), so the cyclic asks for
      // a rate rather than an angle of attack, and the stub wings carry nothing (a stall of 120 would do that
      // too, but it would also maul the gust, trim and stall terms that read it, so the coefficients are cut
      // straight instead and the rotor's own flat-plate drag is what `step` adds).
      this.heli = !!spec.rotor;
      this.k = this.heli ? 1e-5 : G / (spec.stall * spec.stall * clMax);   // lift per (v² · CL)
      this.clMax = clMax; this.clSlope = 5.2;                    // per radian
      const clLevel = G / (this.k * spec.max * spec.max);
      this.ki = 0.06;
      this.cd0 = this.heli ? 0.012 : spec.thrust / (this.k * spec.max * spec.max) - this.ki * clLevel * clLevel;
      // Heavy aircraft answer the controls slowly (response rate, 1/s).
      this.agil = (this.heli ? 6.5 : 7.5) - (this.heli ? 2 : 2.5) * clamp((spec.stall - 24) / 46, 0, 1);
      // Airliners are quick to start moving when a key goes down (they used to take a beat to bite), still slower than a light plane.
      this.liner = spec.cat === 'liner' ? 1 : 0;
      this.turb = 1;
      this.buildGear();
      this.reset([0, spec.gear * (spec.scale || 1), 0], 0, 0, true);
    }
    /// Contact points (body axes, x right, y up, -z forward): three wheels on springs, and the structure that scrapes
    /// when they fail: wing tips, tail, nose, belly, engine pods and the roof.
    buildGear() {
      const s = this.s, k = s.scale || 1, g = s.gear * k;
      const T = Math.max(0.2, 0.2 * g), x0 = 0.35 * T;                        // travel and static compression
      const mainZ = 0.12 * Math.abs(s.nose) * k, noseZ = 0.62 * s.nose * k;
      const track = Math.max(1.0, s.span * 0.28) * k;
      const wN = mainZ / (mainZ - noseZ), wM = (1 - wN) / 2;                  // share of the weight each wheel carries
      const Ct = 0.3 * Math.sqrt(G / x0);                                     // total damper (damping ratio 0.35: a hard landing bounces)
      // The main legs: one axle on the small planes, a bogie of two or three axles on the big airliners (the 747 and A380
      // add body gear). Every wheel point has its own share of the weight, the oleo's gas spring and its tyre in series.
      const big = s.cat === 'liner' && s.stall >= 62, nAx = big ? (s.id === 'b747' ? 2 : 3) : 1, body = s.id === 'b747' || s.id === 'a380';
      const Lf = (s.tail - s.nose) * k, axD = 0.032 * Lf, dtyre = clamp(0.03 * g, 0.02, 0.07);
      const nMain = 2 * nAx + (body ? 4 : 0);
      const wheel = (id, r, share, o = {}) => Object.assign({ id, kind: 'w', r, k: (G * share) / x0, c: Ct * share, share, kt: (G * share) / dtyre, on: false, vi: 0, vt: 0, Fn: 0, Fs: 0, s: 0, ws: 0, lockT: 0, wear: 0, peak: 0, side: 0, main: false, ax: 0, y0: r[1], sq: 0 }, o);
      const hard = (id, kind, r) => ({ id, kind, r, k: 900, c: 55, on: false, vi: 0, vt: 0, Fn: 0 });
      const yW = -(g + x0 + dtyre), belly = (0.45 + 0.1 * s.gear) * k;
      const tailY = (s.tail * k - mainZ) * Math.tan((s.tailPitch || 12) * DEG) + yW;   // so the tail strikes at tailPitch
      const mainShare = wM * 2 / nMain;
      const wh = [wheel('N', [0, yW, noseZ], wN, { side: 0 })];
      for (const sd of [-1, 1]) {
        for (let a = 0; a < nAx; a++) {
          const ax = nAx === 1 ? 0 : nAx === 2 ? (a - 0.5) * 2 : a - 1;      // -1 rear ... +1 front (positive = ahead)
          wh.push(wheel(nAx === 1 ? (sd < 0 ? 'ML' : 'MR') : (sd < 0 ? 'ML' : 'MR') + a, [sd * track, yW, mainZ - ax * axD], mainShare, { side: sd, main: true, ax }));
        }
        if (body) for (let a = 0; a < 2; a++) wh.push(wheel('B' + (sd < 0 ? 'L' : 'R') + a, [sd * track * 0.36, yW, mainZ + 0.05 * Lf - (a - 0.5) * 2 * axD * 0.8], mainShare, { side: sd, main: true, ax: 0, body: true }));
      }
      this.pts = [...wh,
        hard('L', 's', [-s.span * k, s.wingY * k, s.wingZ * k]), hard('R', 's', [s.span * k, s.wingY * k, s.wingZ * k]),
        hard('T', 's', [0, tailY, s.tail * k]), hard('nose', 's', [0, -belly * 0.6, s.nose * k * 0.95]),
        hard('bf', 'b', [0, -belly, s.nose * k * 0.55]), hard('bm', 'b', [0, -belly, mainZ]), hard('ba', 'b', [0, -belly, s.tail * k * 0.6]),
        hard('pL', 'b', [-track * 0.9, -belly - 0.1 * k, mainZ - 0.6 * k]), hard('pR', 'b', [track * 0.9, -belly - 0.1 * k, mainZ - 0.6 * k]),
        hard('rf', 'r', [0, belly * 1.9, s.nose * k * 0.4]), hard('rm', 'r', [0, belly * 1.9, 0]), hard('ra', 'r', [0, belly * 1.9, s.tail * k * 0.6]),
      ];
      this.rebound = 0.4; this.cmp = 0.3; this.nwL = mainZ - noseZ; this.steerYaw = 0; this.nWheel = wh.length; this.axD = axD; this.tilt = 0; this.truck = nAx > 1;
      this.antiskid = s.cat === 'liner' || s.cat === 'biz' || s.cat === 'mil' || s.cat === 'turbo';
      this.wheelM = 0.015 * (1 + clamp((s.stall - 24) / 40, 0, 1.2));         // how hard it is to spin a wheel up (sets the spin-up time)
      this.reverser = s.engine === 'jet' && s.cat !== 'mil' || s.engine === 'turboprop';
      this.groundSpoil = s.cat === 'liner' || s.cat === 'biz';
      this.T = T; this.x0 = x0;
      this.bound = Math.max(...this.pts.map((p) => len(p.r)));
      const L = (s.tail - s.nose) * k;
      this.I = [Math.pow(0.26 * L, 2), Math.pow(0.26 * L, 2), Math.pow(0.5 * s.span * k, 2)];   // pitch, yaw, roll (per unit mass)
      this.gearSink = clamp(6.6 - (s.stall - 24) * 0.025, 5.2, 6.6);            // sink rate (m/s) a wheel can take
      this.brakeMu = 0.55 - 0.1 * clamp((s.stall - 24) / 46, 0, 1);
      this.nrm = [0, 1, 0]; this.R = new Float64Array(9);
    }
    /// `wind` (m/s) overrides the random steady wind (0 to 5 m/s, from a random direction).
    reset(pos, heading, speed, onGround, wind) {
      this.sturdy = false; this.arcade = null; this.arc = null;
      this.pos = pos; this.q = qheading(heading, onGround ? 0 : 0.02);
      // The wind: the saved Weather settings (runway-relative; `heading` is the runway / approach heading), or the old
      // random 0 to 5 m/s breeze. An explicit `wind` still wins.
      this.rwyHdg = heading;
      if (wind != null) { this.windSpd = wind; this.windFrom = Math.random() * Math.PI * 2; this.turb = 1; }
      else if (WX.random) { this.windSpd = Math.random() * 5; this.windFrom = Math.random() * Math.PI * 2; this.turb = 1; }
      else {
        const [vx, vz] = wxVector(heading);
        this.windSpd = Math.hypot(vx, vz); this.windFrom = this.windSpd > 1e-6 ? Math.atan2(-vx, vz) : 0; this.turb = turbMul(WX.turb);
      }
      const wx = -Math.sin(this.windFrom) * this.windSpd, wz = Math.cos(this.windFrom) * this.windSpd;
      this.wv = [wx, 0, wz]; this.tb = [0, 0, 0]; this.rough = 0; this.roughT = 0; this.gustT = 3 + Math.random() * 8; this.gustPh = -1; this.gustLen = 3; this.gustAmp = 0;
      this.vel = add(mul(qrot(this.q, [0, 0, -1]), speed), onGround ? v3() : [wx, 0, wz]);
      this.engOff = false; this.starting = false; this.startT = 0; this.battery = true; this.beaconSw = true;
      this.w = v3(); this.throttle = onGround ? 0 : 0.7; this.flaps = 0; this.brake = false; this.onGround = onGround;
      this.crashed = false; this.stalled = false; this.aoa = 0; this.beta = 0; this.gload = 1; this.touch = null; this.sinkAtTouch = 0;
      this.ias = speed; this.tas = speed; this.sigma = 1; this.t = 0;
      // What still works: each wing, the engine (and how much power it still makes), the undercarriage, the nose leg, the tyres.
      this.damage = { L: true, R: true, engine: true, power: 1, gear: true, tail: 1, nose: true, tyreL: false, tyreR: false, strutL: 0, strutR: 0 };
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
      for (const P of this.pts) { P.on = false; P.vi = 0; P.vt = 0; P.Fn = 0; P.Fs = 0; P.s = 0; P.ws = 0; P.lockT = 0; P.wear = 0; P.peak = 0; P.sq = 0; if (P.y0 != null) P.r[1] = P.y0; }
      this.tl = [0, 0]; this.sideOn = [false, false]; this.mainsOn = 0; this.brakeP = 0; this.gspoil = 0; this.rev = false; this.inYaw = 0; this.td = null; this.tilt = 0; this.skidT = 0; this.squealT = 0; this.lastTd = null;
      // wreck
      this.hot = 0; this.eStep = 0; this.cabT = 0; this.snapQ = {}; this.crush = 4; this.fireSize = 0; this.gone = new Set(); this.engSev = [0, 0]; this.sepLog = []; this.leak = 0; this.ignited = false; this.igniteT = -1; this.gPeak = 1; this.cabinDmg = 0; this.exT = -1; this.slid = 0; this.impact0 = null; this.fuelAtCrash = 0;
      this.info = null; this.report = null; this.breakQ = []; this.wreckT = 0; this.rest = false; this.restT = 0; this.buoy = 1; this.wetT = 0; this.wreckTouch = 0;
    }
    /// The g meter: the wings' load plus whatever the wheels are adding on the runway.
    get gTotal() { return this.gload + this.gGear; }
    /// The wind right now as a velocity [x, y, z] in m/s (the direction it blows towards): the wind socks follow it.
    get wind() { return this.wv; }
    axes() { return { f: qrot(this.q, [0, 0, -1]), u: qrot(this.q, [0, 1, 0]), r: qrot(this.q, [1, 0, 0]) }; }
    get speed() { return len(this.vel); }
    /// Whether the engine is turning and making power (it is off on a cold-and-dark start until it is started).
    get engRun() { return this.damage.engine && !this.engOff; }
    /// Starts a cold engine: the starter runs for a few seconds (longer for a jet), and the throttle must be at idle.
    engineStart() {
      if (!this.engOff) return 'running';
      if (this.starting) return 'busy';
      if (!this.battery) return 'battery';
      if (!this.onGround || this.speed > 5) return 'air';
      if (this.throttle > 0.05) return 'throttle';
      this.starting = true; this.startT = 0; return 'ok';
    }
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
    loseWing(side, cause, brk) {
      if (this.sturdy && ['overg', 'overspeed', 'tree', 'ground', 'rock'].includes(cause)) {
        this.events.push({ type: 'sturdyhit', cause });
        return;
      }
      if (!this.damage[side]) return;
      this.damage[side] = false;
      // Where it broke: at the root, at the engine pylon (the engine tears off and the wing snaps outboard of it) or out at the tip.
      if (!brk) {
        const r = Math.random(), eng = this.s.engines || 0;
        brk = cause === 'overg' || cause === 'overspeed' ? 'root' : cause === 'crash' ? (eng >= 2 && this.s.cat !== 'ga' ? (r < 0.5 ? 'pylon' : r < 0.85 ? 'root' : 'tip') : (r < 0.55 ? 'root' : 'tip')) : (r < 0.7 ? 'tip' : 'root');
      }
      if (cause === 'ground' || cause === 'crash' || cause === 'tree' || cause === 'water') this.leak = Math.min(1, this.leak + 0.4);     // the tanks are in the wings
      this.sepLog.push(side === 'L' ? 'left wing' : 'right wing');
      if (this.structFail) { /* the first failure is the cause */ } else if (cause === 'overg') this.structFail = { t: this.t, text: `Structural failure: ${Math.abs(this.gload).toFixed(1)} g` };
      else if (cause === 'overspeed') this.structFail = { t: this.t, text: `Structural failure: ${(this.ias * 3.6).toFixed(0)} km/h, over the speed limit` };
      this.events.push({ type: 'wing', side, cause, brk });
    }
    breakTail() {
      if (this.damage.tail <= 0) return;
      this.damage.tail = 0; this.events.push({ type: 'tail', health: 0, sev: 1 }); this.sepLog.push('tail');
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
      // rms turbulence (m/s): the chosen level, plus ground-level and rough-country extras. Capped so that even a hurricane
      // at "Extreme" stays survivable; the level's own multiplier sets the cap.
      const sig = Math.min(this.turb * 1.5 * (0.1 + 0.07 * spd + low * (0.35 + 0.55 * this.rough) * (0.6 + 0.1 * spd)), this.turb * 2.4);
      // Gusts: bigger and more frequent with the level (none at all when the air is smooth).
      const gf = this.turb > 0 ? clamp(this.turb * 0.7, 0.3, 2.5) : 0;
      this.gustMax = 0.4 * (0.4 + spd * 0.25) * gf;
      this.gustT -= dt;
      if (this.gustT <= 0 && this.gustPh < 0) { this.gustPh = 0; this.gustLen = 2 + Math.random() * 3; this.gustAmp = (0.1 + Math.random() * 0.3) * (0.4 + spd * 0.25) * gf; }
      let gust = 0;
      if (this.gustPh >= 0) {
        this.gustPh += dt;
        if (this.gustPh >= this.gustLen) { this.gustPh = -1; this.gustT = (5 + Math.random() * 15) / Math.max(0.6, Math.sqrt(this.turb)); }
        else gust = Math.sin(Math.PI * this.gustPh / this.gustLen) * this.gustAmp;
      }
      const a1 = Math.exp(-dt / 1.6), b1 = sig * Math.sqrt(1 - a1 * a1), lim = 3 * sig + 1e-6;
      for (let i = 0; i < 3; i++) this.tb[i] = clamp(this.tb[i] * a1 + b1 * gauss(), -lim, lim);
      const bl = 0.8 + 0.2 * (1 - Math.exp(-Math.max(agl, 0) / 40));      // a little weaker right at the surface
      const base = (spd + gust) * bl;
      const tg = this.onGround ? 0.5 : 1;                                  // gusts are milder at ground level
      this.wv[0] = -Math.sin(this.windFrom) * base + this.tb[0] * tg;
      this.wv[2] = Math.cos(this.windFrom) * base + this.tb[2] * tg;
      // Vertical gusts: limited so that turbulence alone adds at most ~3 g (light planes) or ~2 g (airliners).
      const V = len(sub(this.vel, this.wv)), gAdd = this.s.stall > 45 ? 2 : 3;
      const wMax = V > 8 ? (gAdd * G) / (this.clSlope * this.k * V) : 1e3;
      this.wv[1] = this.onGround ? 0 : clamp(this.tb[1] * 0.45, -wMax, wMax);
    }

    /// Emergency landing (helicopters): the assist levels the disc, runs the collective to hold a gentle descent
    /// (steeper high up, a flare near the ground, a soft settle at the end) and gives the controls back once the
    /// skids are down and the helicopter has stopped. The pedals stay with the pilot, so they can still point it.
    emergencyOn() {
      if (!this.heli || this.crashed || this.onGround) return false;
      this.emergency = true; this.autoI = 0; return true;
    }
    emergencyOff() { this.emergency = false; }
    /// A parked helicopter (on the ground, collective down) stays where it is: no creeping or slow turning on its skids.
    park() { if (this.heli && this.onGround && !this.crashed) { this.vel[0] = 0; this.vel[2] = 0; this.w = v3(); } }
    autoLand(input, agl, dt) {
      const s = this.s, vy = this.vel[1], hs = Math.hypot(this.vel[0], this.vel[2]);
      let vTarget = agl > 40 ? -4.5 : agl > 12 ? -(1.4 + 0.11 * agl) : -clamp(0.35 + 0.1 * agl, 0.35, 1.7);   // m/s
      // Too fast to touch down: hold the height low down until the drift has been leaned away.
      if ((agl < 30 && hs > 2) || (agl < 8 && hs > 0.8)) vTarget = 0.2;
      // On the skids: take the lift off so it settles, with the cyclic centred and no rocking.
      if (this.onGround) return { ...input, throttle: 0.15, pitch: 0, roll: 0 };
      const hover = 1.06 / s.rotorLift;
      // A little integral term: ground effect and the rotor's lag put the hover collective off the textbook value.
      this.autoI = clamp((this.autoI || 0) + (vTarget - vy) * dt * 0.22, -0.35, 0.25);
      const collective = clamp(hover + clamp((vTarget - vy) * 0.28, -0.35, 0.3) + this.autoI, 0, 1);
      // Lean against the drift to stop it (nose up while moving forward, banked toward the side it is sliding to);
      // the disc trims itself back to level, so a light correction for big tilts is all the attitude needs.
      const { f, r } = this.axes(), vf = dot(this.vel, f), vr = dot(this.vel, r);
      const gain = agl < 10 ? 0.06 : 0.035;
      // The cyclic is an angle command: lean the disc against the drift (nose up while moving forward, banked away from
      // the side it is sliding to).
      const pitch = clamp(vf * gain, -0.5, 0.5);
      const roll = clamp(-vr * gain, -0.5, 0.5);
      return { ...input, throttle: collective, collective, pitch, roll };
    }

    /// The autopilot: holds a heading (banking up to 25 degrees), a height (climbing or descending gently) and a speed.
    apEngage() {
      if (this.s.rotor || this.crashed || this.onGround) return false;
      this.ap = { on: true, hdg: this.heading, alt: this.pos[1], spd: Math.max(this.ias, this.s.stall * 1.35), i: 0 };
      return true;
    }
    /// Arms the approach mode on the runway whose ILS the aircraft is on (the autopilot comes on if it was off).
    apApproach(world) {
      if (this.s.rotor || this.crashed || this.onGround) return null;
      const ils = ilsAt(world, this.pos, this.s.gear * (this.s.scale || 1));
      if (!ils) return null;
      if (!this.ap || !this.ap.on) this.apEngage();
      this.ap.mode = 'appr'; this.ap.rwy = ils.rwy; this.ap.captured = false; this.ap.spd = Math.max(this.s.stall * 1.35, Math.min(this.ias, this.s.stall * 1.6));
      return ils;
    }
    apOff() { if (this.ap) this.ap.on = false; }
    apInput(input, dt, world) {
      const a = this.ap, s = this.s;
      // Taking hold of the stick or running out of safe speed hands the aircraft back.
      if (Math.abs(input.pitch) > 0.35 || Math.abs(input.roll) > 0.35 || this.inStall || this.onGround || this.damage.L === false || this.damage.R === false) { a.on = false; this.events.push({ type: 'apoff' }); return input; }
      // Low and not on an approach: it hands back rather than flying a height-hold into the ground.
      if (a.mode !== 'appr' && this.pos[1] - s.gear * (s.scale || 1) - groundAt(world, this.pos[0], this.pos[2]) < 60) { a.on = false; this.events.push({ type: 'apoff' }); return input; }
      let vsApp = null;
      if (a.mode === 'appr') {
        // Flying the ILS: steer onto the localiser course, hold level until the glideslope comes down to us, then follow it.
        const ils = ilsAt(world, this.pos, s.gear * (s.scale || 1));
        if (!ils || ils.rwy !== a.rwy) { a.mode = 'hold'; a.alt = this.pos[1]; this.events.push({ type: 'apils', lost: true }); }
        else if (ils.high < 45) { a.on = false; this.events.push({ type: 'apils', done: true }); return input; }
        else {
          a.hdg = ils.rwy.hdg - clamp(ils.loc * 6, -0.52, 0.52);
          const err = ils.gsDev * ils.dist, hs = Math.hypot(this.vel[0], this.vel[2]);
          vsApp = err < -80 ? 0 : clamp(-hs * Math.tan(ils.rwy.gs) - err * 0.06, -9, 3);
          if (a.captured !== true && Math.abs(err) < 60) { a.captured = true; this.events.push({ type: 'apils', captured: true }); }
        }
      }
      let he = a.hdg - this.heading; while (he > Math.PI) he -= 2 * Math.PI; while (he < -Math.PI) he += 2 * Math.PI;
      const bankT = clamp(he * 1.1, -0.44, 0.44);
      const roll = clamp((bankT - this.bank) * 2.0 + 0, -0.6, 0.6);
      const vsT = vsApp != null ? vsApp : clamp((a.alt - this.pos[1]) * 0.08, -6, 6) * (s.cat === 'ga' ? 0.6 : 1);
      const pitch = clamp((vsT - this.vel[1]) * 0.06, -0.4, 0.4);
      a.i = clamp(a.i + (a.spd - this.ias) * dt * 0.02, -0.5, 0.5);
      // (the throttle lever moves at a rate set by input.throttle, so ask for the movement that reaches the wanted setting)
      const throttle = clamp((clamp(0.5 + (a.spd - this.ias) * 0.05 + a.i, 0.05, 1) - this.throttle) * 3, -1, 1);
      return { ...input, roll: roll * AP_SIGN.roll, pitch: pitch * AP_SIGN.pitch, yaw: 0, throttle };
    }

    step(dt, input, world) {
      if (this.crashed) { this.emergency = false; this.stepWreck(dt, world); return; }
      const s = this.s, { f, u, r } = this.axes();
      this.t += dt;
      const gh0 = groundAt(world, this.pos[0], this.pos[2]);
      const agl = this.pos[1] - s.gear * (s.scale || 1) - gh0;
      if (this.emergency) {
        if (this.onGround && Math.hypot(this.vel[0], this.vel[1], this.vel[2]) < 1.2) { this.emergency = false; this.events.push({ type: 'emergencydone' }); }
        else input = this.autoLand(input, agl, dt);
      }
      if (this.ap && this.ap.on) input = this.apInput(input, dt, world);
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
      if (this.onGround && V > 1) cl *= Math.cos(beta) ** 2;      // wind along the wings (a crosswind on the runway) makes no lift: the plane is not lifted onto one wing
      const kiEff = this.ki * (0.35 + 0.65 * phi);
        this.stallDir = Math.abs(this.bank) > 3 * DEG ? Math.sign(this.bank) : Math.abs(beta) > 1.5 * DEG ? -Math.sign(beta) : input.roll !== 0 ? Math.sign(input.roll) : input.yaw !== 0 ? Math.sign(input.yaw) : (Math.random() < 0.5 ? -1 : 1);
      const airborne = !this.onGround;
      // A helicopter's wing can't stall (the rotor is what holds it up), so no stall, no buffet, no wing drop.
      const stallNow = airborne && !this.heli && Vi > 4 && aa > stallAoa;
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
      // Brake pressure builds as the pedal is held (a tap is gentle); the ground spoilers of the airliners pop up on touchdown
      // with the thrust at idle (or with the brakes on) and dump the wing's lift so the weight rests on the wheels.
      this.inYaw = input.yaw || 0;
      this.brakeP += ((this.brake && this.onGround ? 1 : 0) - this.brakeP) * Math.min(1, dt * (this.brake ? 2.4 : 7));
      const wantSp = this.groundSpoil && this.onGround && this.noContactT < 0.2 && this.speed > 22 && (this.brake || this.throttle < 0.3) && wings > 0 ? 1 : 0;
      const spRate = dt * (wantSp ? 3 : 1.5);
      if (wantSp !== this.gspoil) this.gspoil = clamp(this.gspoil + clamp(wantSp - this.gspoil, -spRate, spRate), 0, 1);
      if (this.gspoil > 0.3 && !this.spoilEv) { this.spoilEv = true; this.events.push({ type: 'spoilers', up: true }); } else if (this.gspoil < 0.05) this.spoilEv = false;
      cl *= 1 - 0.8 * this.gspoil;
      let cd = this.cd0 * (1 + flaps * 1.6) * gearK + 0.1 * this.gspoil + kiEff * cl * cl * wings + (this.brake && !this.onGround ? 0.06 : 0) + (wings < 1 ? 0.02 : 0);
      if (stallNow) cd += 0.9 * Math.pow(Math.sin(Math.min(aa, Math.PI / 2)), 2);
      if (this.spin) cd += 0.55;
      if (!this.damage.engine && s.engine === 'piston') cd += 0.012;
      const q = this.k * Vi * Vi;
      // Lift is perpendicular to the airflow, in the plane of the wings' "up"; a missing wing takes its half away.
      let liftDir = sub(u, mul(vhat, dot(u, vhat)));
      liftDir = len(liftDir) > 1e-4 ? norm(liftDir) : u;
      const lift = mul(liftDir, q * cl * wings);
      let drag = mul(vhat, -q * cd);
      // A helicopter's flat plate: the rotor pumps the air down and this is what the disc tilt has to beat.
      // A fraction of g at the aircraft's `max`, so each helicopter tops out about where the roster says.
      if (s.rotor) drag = sub(drag, mul(vhat, Math.pow(clamp(V / s.max, 0, 2), 2) * G * 0.42));
      const side = mul(r, -q * Math.sin(beta) * 0.6);         // the fuselage resists skidding
      // ---- thrust: jets keep their push with speed but lose it with the thin air; propellers lose power and
      // thrust fades faster with speed.
      const power = this.damage.engine && !this.engOff ? this.damage.power : 0;
      const jet = s.engine === 'jet', rT = clamp(V / s.max, 0, 1.4);
      const lapse = jet ? Math.pow(sigma, 0.85) : clamp((sigma - 0.12) / 0.88, 0.2, 1);
      // Reverse thrust (jets and turboprops, on the ground): the buckets close, or the blades go flat, and the push goes forward.
      this.rev = !!input.reverse && this.reverser && this.onGround && this.noContactT < 0.2 && V > 5 && this.damage.gear;
      const thrust = mul(f, this.throttle * power * s.thrust * (jet ? 1.15 - 0.22 * rT : 1.2 - 0.35 * rT) * lapse * (this.spin ? 0.5 : 1) * (this.rev ? (jet ? -0.4 : -0.55) : 1));
      // The rotor: the collective is the throttle, and the disc thrust runs along the body's up axis. Level, that
      // holds the helicopter up (the hover); pitching or banking tilts it, and the tilt is what makes it fly —
      // the same reason a real helicopter leans into every acceleration. In ground effect it works a little
      // better, and moving through the air adds a little translational lift.
      let rotor = 0;
      if (s.rotor) {
        const ige = agl < s.rotorR ? 1 + 0.07 * (1 - agl / s.rotorR) : 1;
        const trans = 1 + 0.22 * clamp(V / (s.cruise * 0.6), 0, 1);
        rotor = this.throttle * power * lapse * s.rotorLift * G * ige * trans;
      }
      let acc = add(add(add(lift, drag), add(side, thrust)), [0, -G, 0]);
      if (rotor) acc = add(acc, mul(u, rotor));
      // The rotor's own downwash resists vertical motion, so a collective setting gives a steady climb or descent rate
      // (and hands off it holds its height) instead of an ever faster rise.
      if (this.heli && this.throttle > 0.05) acc = add(acc, [0, -this.vel[1] * 0.9, 0]);
      this.gload = dot(add(acc, [0, G, 0]), u) / G;
      if (this.sturdy) {
        const limited = clamp(this.gload, -Math.max(1.5, s.gLimit * 0.72), Math.max(1.5, s.gLimit * 0.72));
        if (limited !== this.gload) { acc = add(acc, mul(u, (limited - this.gload) * G)); this.gload = limited; }
      }
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
        clamp(aCmd * (stabT + path) - this.aoa * stabT + (V > 5 && !this.onGround ? this.k * sigma * V * flaps * 0.35 - G * Math.cos(gamma) / V : 0), -s.pitch * 1.6 * (1 + 0.2 * this.liner), s.pitch * 1.6 * (1 + 0.2 * this.liner)),
        -input.yaw * s.yaw * eff - beta * stab,
        -input.roll * s.roll * (1 + 0.35 * this.liner) * eff * Math.max(wings, 0.3) * (1 - 0.6 * this.sd),
      ];
      // A helicopter's cyclic: the rotor answers the stick with a rate (tilt the disc, and the thrust follows),
      // not with an angle of attack, and it does so however fast it is going — including a hover. Yaw is the
      // tail rotor's own, not the wind-vane feedback a plane's fin gives: at a helicopter's speeds a sideslip
      // is mostly the wind it is drifting with, and chasing it all the time only wobbles the nose.
      if (this.heli) {
        // The stick sets how far the disc leans (up to about 25 degrees), not how fast it turns: hold it and the helicopter
        // settles at that lean and flies steadily; let go and it comes back to level. Positive pitch is nose up, positive
        // roll is the right side down (the game's keys flip the pitch so that "up" flies forward).
        const maxTilt = 25 * DEG, kP = 3.2;
        target[0] = clamp((input.pitch * maxTilt - this.pitchAngle) * kP, -s.pitch * 1.6, s.pitch * 1.6);
        target[1] = -input.yaw * s.yaw;
        target[2] = clamp((this.bank - input.roll * maxTilt) * kP, -s.roll * 1.6, s.roll * 1.6);
      }
      // Adverse yaw (the rising wing drags back) and, on single-engine propeller planes, a little torque and p-factor
      // that pull the nose left under power at low speed.
      if (!this.onGround) { target[1] += input.roll * 0.12 * eff; const lt = clamp(30 / s.stall, 0.4, 1.2); target[2] += clamp(this.tb[0], -7, 7) * 0.1 * lt; target[0] += clamp(this.tb[1], -7, 7) * 0.05 * lt; }   // gusts rock the wings and the nose
      if (s.engine === 'piston') target[1] += this.throttle * power * (1 - clamp(Vi / s.cruise, 0, 1)) * (this.onGround ? 0.025 : 0.07);
      if (this.damage.tail < 1) { target[0] *= tailF; target[1] *= tailF; if (this.damage.tail <= 0) target[0] -= 0.3; }
      // Wing leveller: with the roll keys released, the wings roll back to level by themselves (positive roll
      // rate is to the left, and a positive bank is right wing down, so the bank itself is the correction).
      // Only hands off and not upside down, so loops and inverted flight still work.
      if (!this.heli && input.roll === 0 && input.pitch === 0 && Math.abs(this.bank) < 100 * DEG && !this.onGround && intact && this.sd < 0.05 && !this.spin) {
        // A helicopter holds its attitude: the leveller works at hover and pushes harder (the rotor is quick).
        const hold = clamp(Vi / s.cruise, 0.3, 1);
        target[2] += Math.sin(this.bank) * (this.heli ? 2.6 : 1.3) * clamp(Vi / s.cruise, this.heli ? 0.45 : 0.3, this.heli ? 1.1 : 1);
        // And the disc: let go of the cyclic and it comes back to level, like the real thing's stability
        // augmentation — otherwise the helicopter would hold the tilted disc, and its attitude, for ever.
        if (this.heli) target[0] -= this.pitchAngle * 1.5 * hold;
      }
      // A missing wing: all the lift is on the other side, so it rolls hard towards the stump.
      if (!intact && wings > 0) target[2] += (this.damage.L ? -1 : 1) * clamp(q * Math.abs(cl) / G, 0.3, 2.5) * 2.2;
      // The break: the nose drops and one wing drops with it (the one already low, or the one the skid or the stick
      // pointed to). A wing drop that is held becomes a spin in the light planes.
      if (this.sd > 0.02) {
          const cue = (Math.abs(input.yaw) > 0.3 ? Math.sign(input.yaw) : 0) + (Math.abs(input.roll) > 0.6 ? Math.sign(input.roll) * 0.6 : 0) - (Math.abs(beta) > 6 * DEG ? Math.sign(beta) * 0.6 : 0) + (Math.abs(this.bank) > 20 * DEG ? Math.sign(this.bank) * 0.5 : 0);   // a spin goes the way the rudder, the aileron, the skid and the dropped wing all point
        target[2] -= this.stallDir * 0.9 * clamp(28 / s.stall, 0.3, 1) * this.sd * (1 + 0.6 * Math.abs(input.yaw)) * (wings === 1 ? 1 : 0.4);
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
        const gs = len(this.vel), sf = clamp(gs / 3, 0, 1), maxYaw = 0.4 * G / Math.max(gs, 5);
        target[2] = 0;
        // The nose wheel steers (its own force is added in `pressWheel`, so only part of the turn is asked for here). With
        // the mains planted, a crabbed or skidding plane is pulled straight (the wheels sit behind the centre of mass),
        // and in a crosswind the fin turns it into the wind unless the rudder holds it.
        let tgy = (-input.yaw * 0.6 - input.roll * 0.3) * sf * (this.damage.gear && this.damage.nose ? 0.6 : 1);
        // (the turn the nose wheel may ask for is limited to a third of a g of sideways load, so a fast turn cannot tip it over)
        this.steerYaw = this.damage.gear && this.damage.nose ? clamp(-tgy, -0.34 * G / Math.max(gs, 4), 0.34 * G / Math.max(gs, 4)) : 0;
        if (this.mainsOn > 0 && gs > 4) {
          const vb = qrot(qconj(this.q), this.vel);
          if (vb[2] < 0) tgy -= clamp(Math.atan2(vb[0], -vb[2]), -0.5, 0.5) * 1.1 * Math.min(1, this.mainsOn / 2);
        }
        tgy -= beta * stab * 0.3 * clamp(Vi / (s.stall * 0.8), 0, 1) * (this.mainsOn > 0 ? 1 : 0.3);
        // A strut that took a beating on landing pulls the plane to that side.
        tgy += (this.damage.strutR - this.damage.strutL) * 0.12 * sf;
        target[1] = clamp(tgy, -maxYaw * 1.3, maxYaw * 1.3);
        if (s.engine === 'piston') target[1] += this.throttle * power * (1 - clamp(Vi / s.cruise, 0, 1)) * 0.025;
        if (Vi < s.stall * 0.7) { if (!this.heli) target[0] = Math.min(target[0], 0); if (this.damage.gear && this.damage.nose) target[0] -= this.pitchAngle * 3; }
      }
      // Heavies answer slowly. On the wheels the springs are free to rock the plane.
      const resp = 1 - Math.exp(-dt * this.agil);
      const rPitch = this.onGround ? 1 - Math.exp(-dt * Math.min(this.agil, 3.5)) : resp, rRoll = this.onGround ? 1 - Math.exp(-dt * 2) : resp;
      this.w[0] += (target[0] - this.w[0]) * rPitch; this.w[1] += (target[1] - this.w[1]) * resp; this.w[2] += (target[2] - this.w[2]) * rRoll;
      if (this.buffet > 0.05 || this.sd > 0.05) { const bf = Math.max(this.buffet * 0.5, this.sd); this.w[2] += (Math.random() - 0.5) * 0.12 * bf; this.w[0] += (Math.random() - 0.5) * 0.07 * bf; }
      const angle = len(this.w) * dt;
      if (angle > 1e-6) this.q = qnorm(qmul(this.q, qaxis(norm(this.w), angle)));

      // The collective is a lever, not a lever-rate: it moves to where the key puts it, while a plane's
      // throttle ramps whichever way the key is held. Same input, different feel, as it should be.
      const collective = input.collective !== undefined ? input.collective : clamp(input.throttle, 0, 1);
      this.throttle = this.heli
        ? clamp(this.throttle + (collective - this.throttle) * Math.min(1, dt * (collective > this.throttle ? 2.2 : 1.6)), 0, 1)
        : clamp(this.throttle + input.throttle * dt * 0.6, 0, 1);
      if (this.engOff) {
        this.throttle = 0;
        if (this.starting) { this.startT += dt; if (this.startT >= (this.s.engine === 'piston' ? 4 : 9)) { this.engOff = false; this.starting = false; this.events.push({ type: 'engstart' }); } }
      }
      // Fuel: burnt with the throttle, and the engine stops when the tank is dry.
      if (this.damage.engine && power > 0) {
        this.fuel = Math.max(0, this.fuel - this.throttle * dt - 0.04 * dt);
        if (this.fuel <= 0) { this.failEngine(); this.fuelOut = true; this.events.push({ type: 'fuel' }); }
      }
      this.tailT = Math.max(0, this.tailT - dt);
      // Bogie trucks tip nose-up in flight, so the rear axle meets the runway first; the truck then levels out.
      if (this.truck) {
        for (let i = 0; i < 2; i++) this.tl[i] += ((this.sideOn[i] ? 0 : 0.13) - this.tl[i]) * (1 - Math.exp(-dt * (this.sideOn[i] ? 7 : 2)));
        for (let i = 0; i < this.nWheel; i++) { const P = this.pts[i]; if (P.ax) P.r[1] = P.y0 + P.ax * this.axD * Math.sin(this.tl[P.side < 0 ? 0 : 1]); }
      }
      this.bumpT = Math.max(0, this.bumpT - dt); this.scrapeEvT = Math.max(0, (this.scrapeEvT || 0) - dt);
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
      if (this.sturdy && this.overG === false) {
        this.stress = 0; this.blackout = 0;
      } else if (gp > 1 && intact) {
        this.stress += Math.max(0, gp - 1.25) * dt * 0.6;                  // only a long, hard pull well past the limit breaks a wing
        if ((this.stress > 1 || gp > 2.4) && !this.sturdy) this.loseWing(this.bank > 0 ? 'R' : 'L', 'overg');
      } else this.stress = Math.max(0, this.stress - dt * 0.3);
      const stick = Math.max(Math.abs(input.pitch), Math.abs(input.roll));
      if (this.sturdy && Vi > s.max) {
        const wind = this.wind || v3(), air = sub(this.vel, wind), capped = mul(norm(air), s.max);
        this.vel = add(capped, wind); this.flutter = 0;
      } else if (Vi > s.max * 1.05 && wings > 0) {
        this.flutter += dt * ((Vi / s.max - 1.05) * 8 + stick * 1.5);
        if (this.flutter > 1) { this.loseWing('L', 'overspeed'); this.loseWing('R', 'overspeed'); }
      } else this.flutter = Math.max(0, this.flutter - dt * 0.5);
      if (!(this.sturdy && this.overG === false)) {
        const gS = Math.max(4.2, s.gLimit * 0.55), gT = this.gload > gS ? clamp((this.gload - gS) / 3, 0, 1) : this.gload < -1 ? -clamp((-1 - this.gload) / 2, 0, 1) : 0;
        this.blackout += clamp(gT - this.blackout, -dt * 0.9, dt * 0.55);
      }

      if (this.arcade && !this.onGround) this.arcadeSteer(dt, input);
      if (this.collide(world)) return;
      if (this.contacts(dt, world, false)) return;
      if (this.pos[1] > 3000) { this.vel[1] = Math.min(this.vel[1], 0); }                  // ceiling
      const edge = WORLD - 600;
      if (Math.abs(this.pos[0]) > edge || Math.abs(this.pos[2]) > edge) this.pos = [clamp(this.pos[0], -edge, edge), this.pos[1], clamp(this.pos[2], -edge, edge)];
    }

    /// Arcade handling (Easy and Automatic): after the normal forces, the flight path is re-aimed so the plane turns and
    /// climbs at fixed, forgiving rates. Speed still comes from the real model; the bank follows the turn, and it never stalls.
    arcadeSteer(dt, input) {
      const A = this.arcade;
      let spd = Math.max(len(this.vel), A.vmin);
      if (!this.arc) {
        const v = this.vel, hz = Math.hypot(v[0], v[2]);
        this.arc = { h: Math.atan2(v[0], -v[2]), g: Math.atan2(v[1], hz || 1), sx: 0, sy: 0, bank: 0, qt: 0, qdir: 0 };
      }
      const a = this.arc;
      const shape = (v) => Math.sign(v) * Math.min(1, Math.abs(v)) ** 1.35;
      const tx = shape(clamp(input.roll || 0, -1, 1)) + shape(clamp(input.yaw || 0, -1, 1)) * 0.3;
      const pi = clamp(input.pitch || 0, -1, 1), ty = shape(pi);
      const k = 1 - Math.exp(-dt * 5);                 // stick smoothing, ~0.2 s
      a.sx += (clamp(tx, -1, 1) - a.sx) * k; a.sy += (ty - a.sy) * k;
      // A jet turns by banking: the stick sets the bank it rolls towards (at a limited roll rate, so it takes a moment to
      // lean in and a moment to level out), and the turn rate follows the bank. Faster means a wider turn.
      const maxBank = 1.15, rollRate = 1.7;
      const bankT = a.qt > 0 ? a.qdir * maxBank : clamp(a.sx, -1, 1) * maxBank;
      a.bank += clamp(bankT - a.bank, -rollRate * dt, rollRate * dt);
      const speedF = clamp(190 / spd, 0.6, 1.15);
      let w = A.turn * 1.25 * (Math.sin(a.bank) / Math.sin(maxBank)) * speedF * 0.85 * (a.qt > 0 ? 1.8 : 1);
      a.h += w * dt;
      if (a.qt > 0) { a.qrem -= Math.abs(w) * dt; if (a.qrem <= 0) a.qt = 0; }   // the quick turn ends after 180 degrees
      // Pitch: climbs are limited, dives are steeper and quicker, and the nose follows at a limited pitch rate.
      // A hard bank without back pressure lets the nose sag a little.
      const rate = a.sy >= 0 ? A.climb : A.dive;
      const gT = Math.asin(clamp(a.sy * rate / spd - 0.05 * Math.abs(Math.sin(a.bank)) * (1 - Math.max(0, a.sy)), -0.95, 0.9));
      const dg = (gT - a.g) * (1 - Math.exp(-dt * 3));
      a.g += clamp(dg, -0.75 * dt, 0.6 * dt);
      const cg = Math.cos(a.g);
      this.vel = [Math.sin(a.h) * cg * spd, Math.sin(a.g) * spd, -Math.cos(a.h) * cg * spd];
      this.q = qnorm(qmul(qheading(a.h, a.g), qaxis([0, 0, 1], -a.bank)));
      this.gload = 1 + Math.min(4, Math.abs(w * spd) / 9.81 * 0.5);
      this.stalled = false; this.inStall = false; this.buffet = 0;
    }
    /// Quick turn: a fast 180 degrees, with a cooldown.
    quickTurn(dir) {
      const a = this.arc; if (!this.arcade || !a || a.qt > 0 || (this.qtCool || 0) > this.t) return false;
      a.qdir = dir || 1; a.qt = 1; a.qrem = Math.PI; this.qtCool = this.t + 6; return true;
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
        if (part === 'L' || part === 'R') {
          if (obj.kind === 'tree') breakTree(world, obj);
          if (this.sturdy) { this.events.push({ type: 'sturdyhit', cause: obj.kind }); this.vel = mul(this.vel, 0.72); }
          else { this.loseWing(part, obj.kind); this.vel = mul(this.vel, 0.8); }
        }
        else if (this.sturdy && obj.kind === 'tree') { breakTree(world, obj); this.events.push({ type: 'sturdyhit', cause: 'tree' }); this.vel = mul(this.vel, 0.6); }
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
      if (this.gone.has('N') && (P.id === 'nose' || P.id === 'bf' || P.id === 'rf')) return false;
      if ((P.id === 'pL' && this.engSev[0] > 0) || (P.id === 'pR' && this.engSev[1] > 0)) return false;
      return true;
    }
    /// A force (m/s² for a unit mass) acting at a contact point: changes the velocity and, through the lever arm, the spin.
    applyForce(P, fx, fy, fz, dt) {
      this.vel[0] += fx * dt; this.vel[1] += fy * dt; this.vel[2] += fz * dt;
      const R = this.R, r = P.r, I = this.I;
      // The force in body axes (the transpose of the rotation matrix), then its torque about the centre of mass.
      const b0 = R[0] * fx + R[3] * fy + R[6] * fz, b1 = R[1] * fx + R[4] * fy + R[7] * fz, b2 = R[2] * fx + R[5] * fy + R[8] * fz;
      this.w[0] += ((r[1] * b2 - r[2] * b1) / I[0]) * dt;
      this.w[1] += ((r[2] * b0 - r[0] * b2) / I[1]) * dt;
      this.w[2] += ((r[0] * b1 - r[1] * b0) / I[2]) * dt;
    }
    /// Fills this.R with the rotation matrix of the attitude (body to world, row-major) so contacts need no allocations.
    setR() {
      const [x, y, z, w] = this.q, R = this.R;
      R[0] = 1 - 2 * (y * y + z * z); R[1] = 2 * (x * y - z * w); R[2] = 2 * (x * z + y * w);
      R[3] = 2 * (x * y + z * w); R[4] = 1 - 2 * (x * x + z * z); R[5] = 2 * (y * z - x * w);
      R[6] = 2 * (x * z - y * w); R[7] = 2 * (y * z + x * w); R[8] = 1 - 2 * (x * x + y * y);
    }
    /// The point's velocity through the ground: speed into it (vi), along it (vt, with the components in P.t).
    probe(P, nx, ny, nz) {
      const R = this.R, w = this.w, r = P.r;
      const c0 = w[1] * r[2] - w[2] * r[1], c1 = w[2] * r[0] - w[0] * r[2], c2 = w[0] * r[1] - w[1] * r[0];      // spin x lever arm, body axes
      const vx = this.vel[0] + R[0] * c0 + R[1] * c1 + R[2] * c2, vy = this.vel[1] + R[3] * c0 + R[4] * c1 + R[5] * c2, vz = this.vel[2] + R[6] * c0 + R[7] * c1 + R[8] * c2;
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
    /// A wheel. The tyre (stiff) and the oleo strut (a gas spring that stiffens as it compresses, damped harder on the way
    /// in than on the way out, with a hard stop at the end of its travel) are in series. Along the wheel: the spin-up of the
    /// wheel from rest at touchdown, rolling resistance, brakes (they lock the wheel unless there is anti-skid) and the
    /// grip it has left. Across it: side force from the slip angle, saturating at the friction limit.
    pressWheel(P, nx, ny, nz, pen, surf, fp0, lat0, dt) {
      const T = this.T, Fs0 = G * P.share, e = 0.12 * T;
      // The nose wheel points where it is steered.
      let fp = fp0, lat = lat0;
      if (P.id === 'N') {
        const gs = len(this.vel), d = clamp(Math.atan(this.nwL * this.steerYaw / Math.max(gs, 2)), -1.05, 1.05);   // the angle that makes the turn the pilot asked for
        if (Math.abs(d) > 1e-3) { const c = Math.cos(d), sn = Math.sin(d); P.fp = P.fp || [0, 0, 0]; P.lat = P.lat || [0, 0, 0];
          for (let i = 0; i < 3; i++) { P.fp[i] = fp0[i] * c + lat0[i] * sn; P.lat[i] = lat0[i] * c - fp0[i] * sn; } fp = P.fp; lat = P.lat; }
      }
      const dty = Math.min(pen, P.Fs / P.kt), stroke = Math.max(0, pen - dty);
      const fa = Fs0 * Math.pow((T - this.x0 + e) / (T - Math.min(stroke, T) + e), 1.35);
      let Fsp = Math.min(fa, P.kt * pen);
      const over = Math.max(0, stroke - T);
      if (over > 0) Fsp += Fs0 * 40 * over / T;                                   // bottomed out
      const engaged = stroke > 0.002;
      const vi = P.vi;
      const Fd = engaged ? (vi > 0 ? P.c * this.cmp * vi * (1 + 0.3 * vi) * (over > 0 ? 2 : 1) : P.c * this.rebound * vi) : P.c * 0.12 * vi;
      let Fn = Math.min(Math.max(0, Fsp + Fd), Math.max(9 * Fs0, 1.5 * G));
      // A strut that has been damaged on a previous landing shimmies.
      const sdmg = P.side < 0 ? this.damage.strutL : P.side > 0 ? this.damage.strutR : 0;
      if (sdmg > 0 && P.main) Fn *= 1 + 0.28 * sdmg * Math.sin(this.t * 17 + P.side) * clamp(len(this.vel) / 18, 0, 1);
      P.Fs = Fsp; P.s = stroke; if (Fn / Fs0 > P.peak) P.peak = Fn / Fs0; if (over > P.over) P.over = over;
      const vlong = P.tx * fp[0] + P.ty * fp[1] + P.tz * fp[2], vlat = P.tx * lat[0] + P.ty * lat[1] + P.tz * lat[2];
      P.vlat = vlat; P.vlong = vlong;
      const burst = P.side < 0 ? this.damage.tyreL : P.side > 0 ? this.damage.tyreR : false;
      const mu = 0.85 * surf.grip * (burst ? 0.55 : 1) * (1 - 0.15 * Math.min(1, P.wear)) * (1 - 0.25 * clamp((Math.abs(P.tx * fp[0] + P.ty * fp[1] + P.tz * fp[2]) - 20) / 40, 0, 1));   // (less grip the faster it slides)
      const av = Math.abs(vlong), sg = vlong >= 0 ? 1 : -1;
      // across the wheel: slip angle -> side force (about 0.7 of the limit at 6 degrees), a stiff stick at walking pace
      const arg = vlat / (av * 0.11 + 0.35);
      const fl = -mu * Fn * Math.tanh(arg);
      if (P.main && Math.abs(arg) > 1.9 && av > 7 && Fn > 0.3 * Fs0) P.sq = Math.min(1, Math.abs(arg) / 4); else P.sq = 0;
      // along the wheel
      let Fb = 0;
      if (P.main) {
        const dbr = 1 + this.inYaw * P.side * 0.6 * (1 - clamp((av - 8) / 12, 0, 1));                  // right rudder brakes the right wheels more
        Fb = this.brakeP * (this.antiskid ? 1.15 : 1.25) * Fs0 * Math.max(0, dbr);
      }
      const sr = av > 1.5 ? clamp((av - P.ws) / av, -1, 1) : 0;
      const muE = mu * (sr > 0.22 ? 0.78 : 1);
      if (this.antiskid && sr > 0.16) Fb *= 0.2;                                    // anti-skid lets the brake off
      const Fx = clamp(1.5 * (av - P.ws), -muE * Fn, muE * Fn);
      P.ws = Math.max(0, P.ws + (Fx - Fb) * dt / this.wheelM);
      // Locked and sliding at speed: smoke, and a flat spot or a burst on dry ground.
      if (Fb > 0.15 && P.ws < 0.25 * av && av > 8) {
        P.lockT += dt;
        if (P.lockT > 0.15) this.skidT = Math.max(this.skidT, P.lockT);
        // Sliding a locked tyre along dry asphalt wears a flat spot; at speed the tyre goes through it.
        if (surf.grip >= 0.9) P.wear += dt * Math.max(0, av - 22) / 10;
        if (P.wear > 1.1 && av > 18 && !burst && Math.random() < dt * 2) this.burstTyre(P.side < 0 ? 'tyreL' : 'tyreR', 'locked');
      } else P.lockT = Math.max(0, P.lockT - dt * 2);
      const rr = (surf.roll + (burst ? 0.3 : 0) + (sdmg > 0 ? 0.05 * sdmg : 0)) * Fn;
      const fo = -sg * Math.min(rr, av / (dt * 2)) - sg * Fx;
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
        for (const P of pts) { P.on = false; if (P.kind === 'w') P.ws *= 1 - dt * 0.3; }
        this.wet = 0; this.wreckTouch = 0; this.gGear = 0; this.mainsOn = 0; this.sideOn[0] = this.sideOn[1] = false; this.skidT = 0;
        if (!wreck) { this.noContactT += dt; this.airT += dt; if (this.noContactT > 0.25) this.onGround = false; }
        return false;
      }
      const x = pos[0], z = pos[2];
      const dhx = (groundAt(world, x - 3, z) - groundAt(world, x + 3, z)) / 6, dhz = (groundAt(world, x, z - 3) - groundAt(world, x, z + 3)) / 6;
      const nl = Math.hypot(dhx, 1, dhz), nx = dhx / nl, ny = 1 / nl, nz = dhz / nl;
      this.nrm[0] = nx; this.nrm[1] = ny; this.nrm[2] = nz;
      const surf = SURFACES[surfaceAt(world, pos[0], pos[2])] || SURFACES.grass;
      this.surface = surf;
      this.setR();
      const f = qrot(this.q, [0, 0, -1]), fd = f[0] * nx + f[1] * ny + f[2] * nz;
      const fp = norm([f[0] - nx * fd, f[1] - ny * fd, f[2] - nz * fd]), lat = cross(fp, [nx, ny, nz]);
      let touching = 0, wheels = 0, gsum = 0, wet = 0, noseLoad = 0, mains = 0, sq = 0;
      this.sideOn[0] = this.sideOn[1] = false; this.skidT = Math.max(0, this.skidT - dt * 2);
      const crashFn = (why, P, extra) => this.crash(why, Object.assign({ n: [nx, ny, nz], vi: P.vi, vt: P.vt, P }, extra));
      for (let i = 0; i < pts.length; i++) {
        const P = pts[i];
        if (!this.pointActive(P, wreck)) { P.on = false; continue; }
        const R = this.R, lr = P.r;
        const px = pos[0] + R[0] * lr[0] + R[1] * lr[1] + R[2] * lr[2], py = pos[1] + R[3] * lr[0] + R[4] * lr[1] + R[5] * lr[2], pz = pos[2] + R[6] * lr[0] + R[7] * lr[1] + R[8] * lr[2];
        const th = terrainAt(world, px, pz), isWet = th < WATER;
        let pen = (isWet ? WATER : th) - py;
        const obj = wreck ? hitObject(world, [px, py, pz]) : null;
        if (pen <= 0 && !obj) { P.on = false; if (P.kind === 'w') { P.ws *= 1 - dt * 0.3; P.Fs = 0; P.s = 0; } continue; }
        // Buried in a hillside (a very fast plane can tunnel into a slope between two steps): that is a crash.
        if (!wreck && pen > 3) { this.probe(P, nx, ny, nz); crashFn(isWet ? 'water' : ny < 0.93 ? 'terrain' : 'ground', P); return true; }
        if (wreck && pen > 2) pen = 2;
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
          if (first) {
            P.peak = 0; P.over = 0;
            const vl = P.tx * fp[0] + P.ty * fp[1] + P.tz * fp[2];
            if (this.airT > 0.12 && P.vi > 0.05) this.events.push({ type: 'wheel', vi: P.vi, vl, id: P.id, side: P.side, main: P.main, at: [px, py, pz] });
            let td = this.td;
            if (this.airT > 0.7 || (!td && this.airT > 0.12)) {
              // The touchdown: where, and how hard.
              this.sinkAtTouch = P.vi; this.touch = [pos[0], pos[2]]; this.everDown = true;
              this.td = td = { t: this.t, sink: P.vi, z: pos[2], x: pos[0], bank: this.bank, pitch: this.pitchAngle, ias: this.ias, vl, first: P.id, noseFirst: P.id === 'N' && P.vi > 0.8, bounces: 0, rebound: 0, lat: Math.abs(P.tx * lat[0] + P.ty * lat[1] + P.tz * lat[2]), done: false, wingLow: false };
              if (P.vi > this.gearSink * 0.5 && !this.gearEvent) this.gearEvent = { cause: 'hard', vi: P.vi };
            } else if (td && this.t - td.t < 0.15) {
              // The other wheels arriving a moment later: the hardest of them counts, and a wing-low touchdown shows in the sink difference.
              if (P.vi > td.sink) { if (P.vi - td.sink > 0.9 && P.main) td.wingLow = true; td.sink = P.vi; this.sinkAtTouch = P.vi; }
            } else if (td && this.airT > 0.12 && this.t - td.t < 10) {
              td.bounces++; td.rebound = Math.max(td.rebound, P.vi); td.t2 = this.t;
              this.events.push({ type: 'bounce', vi: P.vi, n: td.bounces });
            }
          }
          if (first && !this.wheelCheck(P, crashFn, lat)) { if (this.crashed) return true; }
          if (!P.on) continue;
          const Fn = this.pressWheel(P, nx, ny, nz, pen, surf, fp, lat, dt);
          gsum += Fn;
          if (P.id === 'N') noseLoad = Fn;
          if (P.main) { mains++; this.sideOn[P.side < 0 ? 0 : 1] = true; }
          if (P.sq > sq) sq = P.sq;
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
      this.wet = wet; this.mainsOn = mains;
      if (!wreck) {
        // Tyre squeal when the side load is at the limit, and smoke and a screech under a locked wheel.
        this.squealT -= dt; this.skidEvT = (this.skidEvT || 0) - dt;
        if (sq > 0 && this.squealT <= 0) { this.squealT = 0.28; this.events.push({ type: 'squeal', k: sq, at: [pos[0], pos[1] - this.s.gear * (this.s.scale || 1), pos[2]] }); }
        if (this.skidT > 0.15 && this.skidEvT <= 0) { this.skidEvT = 0.25; this.events.push({ type: 'skid', k: clamp(this.skidT / 1.5, 0.2, 1), at: [pos[0], pos[1] - this.s.gear * (this.s.scale || 1), pos[2]] }); }
      }
      this.gGear = Math.min(gsum / G - 1, 12); if (this.gGear < 0) this.gGear = 0;
      if (this.gGear > this.maxGGear) this.maxGGear = this.gGear;
      if (wreck) { this.wreckTouch = touching; return false; }
      // On the ground, or not (the wheels can leave it for a moment in a bounce).
      if (touching > 0) { this.noContactT = 0; this.onGround = true; this.airT = 0; } else { this.noContactT += dt; this.airT += dt; if (this.noContactT > 0.3) this.onGround = false; }
      // A heavily loaded nose wheel digging into soft ground: it collapses and the nose goes down.
      if (wheels > 0 && this.damage.nose && this.damage.gear) {
        const soft = surf.soft;
        const gsp = len(this.vel);
        if (soft && noseLoad > 0.12 * G && gsp > this.s.stall * 0.4) this.noseStress += dt * soft * (gsp / this.s.stall) * (this.brake ? 2.2 : 1) * 0.03;
        else this.noseStress = Math.max(0, this.noseStress - dt * 0.4);
        if (this.noseStress > 1) this.collapseNose('dig', gsp);
      }
      return false;
    }

    /// A wheel touching down (or touching again after a bounce). Returns false when a leg gave way or the flight ended.
    wheelCheck(P, crashFn, lat) {
      const s = this.s, vi = P.vi, gs = this.gearSink * (P.id === 'N' ? 0.95 : 1);
      if (vi > 15) { crashFn(this.nrm[1] < 0.93 ? 'terrain' : 'ground', P); return false; }
      if (vi > gs) {
        if (P.id === 'N') this.collapseNose('hard', vi); else this.collapseGear('hard', vi);
        return false;
      }
      // Sideways at touchdown (crabbing in a crosswind): side load on the wheels.
      if (Math.abs(P.tx * lat[0] + P.ty * lat[1] + P.tz * lat[2]) > 0.3 * s.stall + 1.5 && P.id !== 'N') { this.collapseGear('side', vi); return false; }
      if (P.main && vi > gs * 0.78 && Math.random() < 0.6 * (vi / gs - 0.78) / 0.22) this.burstTyre(P.side < 0 ? 'tyreL' : 'tyreR', 'hard');
      // A very hard landing (close to what the leg is built for) bends the strut for good: it shimmies and drags to that side.
      if (P.main && vi > gs * 0.62) {
        const key = P.side < 0 ? 'strutL' : 'strutR', dmg = clamp((vi / gs - 0.62) / 0.38, 0.15, 1);
        if (dmg > this.damage[key]) { this.damage[key] = dmg; this.events.push({ type: 'strut', side: P.side < 0 ? 'L' : 'R', dmg, vi }); }
      }
      if (P.id === 'N' && vi > 1.2 && this.td && this.t - this.td.t < 0.05 && this.mainsOn === 0) this.td.noseFirst = true;
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
      this.w[0] -= Math.min(0.55, 0.1 + this.speed * 0.008);                       // the nose drops and digs in
      for (const P of this.pts) if (P.id === 'N') P.on = false;
    }
    burstTyre(which, why) {
      if (this.damage[which]) return;
      this.damage[which] = true; this.events.push({ type: 'tyre', side: which === 'tyreL' ? 'L' : 'R', why });
    }
    /// Structure (not wheels) meeting the ground while the plane is still a plane.
    hitCheck(P, first, pen, crashFn) {
      const vi = P.vi, vt = P.vt, V = this.speed;
      switch (P.id) {
        case 'L': case 'R': {
          if (vi + 0.12 * vt > 4.2) {
            // A wing digging in at speed: it snaps, but first it spins the plane round its tip (a cartwheel when it is fast).
            if (this.sturdy) { this.events.push({ type: 'sturdyhit', cause: 'ground' }); this.vel = mul(this.vel, 0.72); return false; }
            this.loseWing(P.id, 'ground'); this.vel = mul(this.vel, 0.92);
            const sg = P.id === 'L' ? 1 : -1, k = clamp(0.45 + V * 0.04, 0.6, 3); this.w[2] += sg * k; this.w[1] += sg * k * 0.35;
          }
          else if (P.vt > 3) { this.scrape(P, 0.5); if (this.scrapeEvT <= 0) { this.scrapeEvT = 2.5; this.events.push({ type: 'scrape', what: 'wingtip' }); } }
          return false;
        }
        case 'T': {
          if (vi > 12) { crashFn('ground', P); return true; }
          if (vi > 5) { this.breakTail(); return false; }
          this.tailStrike(V, vi);
          return false;
        }
        case 'nose':
          if (first && vi > 5) { crashFn(this.pitchAngle < -35 * DEG && V < 45 ? 'nose' : this.nrm[1] < 0.93 ? 'terrain' : 'ground', P); return true; }
          return false;
        case 'rf': case 'rm': case 'ra':
          if ((first && vi > 1.5) || P.vt > 12) { crashFn('flip', P); return true; }      // (sliding along on its roof is the end of it too)
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
    /// Structure meeting the ground or an obstacle in a wreck: things shear off and thud. Each impact is judged by its
    /// energy (per kilogram), so a hard hit takes off more than a scrape.
    wreckCheck(P, first, px, py, pz) {
      const vi = P.vi, e = 0.5 * vi * vi + 0.08 * P.vt * P.vt, id = P.id;
      if ((id === 'L' || id === 'R') && this.damage[id] && vi + 0.12 * P.vt > 6 && !this.snapQ[id]) {
        // The wing digs in: it swings the whole hull round (a cartwheel when it is fast) before the root lets go.
        this.snapQ[id] = true;
        const sg = id === 'L' ? 1 : -1, k = clamp(0.3 + P.vt * 0.04, 0.3, 3);
        this.w[2] += sg * k; this.w[1] += sg * k * 0.3;
        this.breakQ.push({ t: this.wreckT + 0.08 + Math.random() * 0.1, part: id }); this.breakQ.sort((a, b) => a.t - b.t);
      } else if (id === 'T' && vi > 6) this.breakTail();
      else if (first && (id === 'nose' || id === 'bf' || id === 'rf') && e > 90 && !this.gone.has('N')) this.severNose();
      else if (first && (id === 'pL' || id === 'pR') && e > 40 && this.s.engines >= 2 && this.s.cat !== 'ga') this.severEngine(id === 'pL' ? -1 : 1);
      if (first && vi > 3 && id !== 'L' && id !== 'R' && id !== 'T') {
        const g = (vi * vi) / (2 * this.crush * 1.3 * G);
        if (g > this.gPeak) this.gPeak = g;
        if (e > this.eStep) this.eStep = e;
      }
      if (first && vi > 3.5 && this.bumpT <= 0) { this.bumpT = 0.12; this.events.push({ type: 'bump', vi, at: [px, py, pz], e }); }
    }
    /// The cockpit section lets go at the bulkhead behind it.
    severNose() {
      if (this.gone.has('N')) return;
      this.gone.add('N'); this.sepLog.push('nose'); this.cabinDmg = Math.min(1, this.cabinDmg + 0.25);
      if (this.s.engine === 'piston') this.failEngine();
      this.events.push({ type: 'sever', part: 'N', side: 0 });
    }
    /// An engine tears off its pylon (side -1 left, +1 right).
    severEngine(side) {
      const i = side < 0 ? 0 : 1, perSide = Math.max(1, (this.s.engines || 2) >> 1);
      if (this.engSev[i] >= perSide) return;
      this.engSev[i] = perSide;                                    // (every engine on that wing is lost with the pylon load path)
      this.sepLog.push(perSide > 1 ? `${side < 0 ? 'left' : 'right'} engines` : `${side < 0 ? 'left' : 'right'} engine`);
      if (this.engSev[0] && this.engSev[1]) this.failEngine(); else this.failEngine(true);
      this.leak = Math.min(1, this.leak + 0.15); this.hot = Math.max(this.hot, 0.5);
      this.events.push({ type: 'sever', part: 'E', side });
    }
    /// The spilled fuel catches: a fire whose size follows the fuel that is left.
    ignite() {
      if (this.ignited) return;
      const ff = clamp(this.fuel / (this.s.fuel || 1800), 0, 1);
      if (ff < 0.03) return;
      this.ignited = true; this.igniteT = this.wreckT; this.fireSize = ff * (0.5 + 0.35 * (this.s.cam || 1));
      if (Math.random() < 0.1 * ff + (this.s.cat === 'liner' ? 0.04 : 0)) this.exT = this.wreckT + 1 + Math.random() * 5;
      this.events.push({ type: 'ignite', size: this.fireSize, ff, late: this.wreckT > 0.3 });
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

    /// How the landing went, once the bounces have settled (null until then): "Smooth touchdown 0.6 m/s, 14 m past the
    /// numbers", "Hard touchdown 3.1 m/s", "Bounced twice"...
    touchdownText(onRunway) {
      const td = this.td;
      if (!td || td.done || !this.damage.gear) return null;
      if (!this.onGround || this.t - Math.max(td.t, td.t2 || 0) < 1.1) return null;
      td.done = true;
      const sink = td.sink, q = sink < 1 ? 'Smooth' : sink < 2 ? 'Nice' : sink < 3 ? 'Firm' : sink < 4.5 ? 'Hard' : 'Very hard';
      const bank = Math.abs(td.bank) / DEG, tags = [];
      if (td.noseFirst) tags.push('nose first: porpoised');
      else if (td.bounces > 0) tags.push(td.bounces === 1 ? 'bounced' : `bounced ${td.bounces} times`);
      if (td.wingLow || bank > 6) tags.push(`${Math.round(bank)}° wing low`);
      if (td.lat > 3.5) tags.push('sideways');
      const d = -td.z - 12;
      const where = !onRunway ? 'off the runway' : td.z > 5 ? 'short of the runway' : d < 0 ? 'before the numbers' : `${Math.round(d)} m past the numbers`;
      const head = td.bounces > 0 && !td.noseFirst ? 'Bounced' : `${q} touchdown`;
      this.lastTd = { sink, bounces: td.bounces, noseFirst: td.noseFirst, d, q };
      return `${head} ${sink.toFixed(1)} m/s, ${where}${tags.length && !(td.bounces > 0 && !td.noseFirst && tags.length === 1) ? ' · ' + tags.filter((t) => !(head === 'Bounced' && /^bounced/.test(t))).join(', ') : ''}`;
    }

    // ---------------------------------------------------------------- the wreck

    /// After a crash the airframe is a rigid body: it keeps its momentum, tumbles, slides, floats or sinks, and the bits
    /// that touch things shear off, until it comes to rest.
    stepWreck(dt, world) {
      if (this.rest) return;
      this.wreckT += dt;
      while (this.breakQ.length && this.breakQ[0].t <= this.wreckT) {
        const b = this.breakQ.shift();
        if (b.part === 'T') this.breakTail(); else if (b.part === 'N') this.severNose(); else if (b.part === 'E') this.severEngine(b.side);
        else this.loseWing(b.part, 'crash', b.mode);
      }
      this.bumpT = Math.max(0, this.bumpT - dt);
      const V = len(this.vel);
      this.vel[1] -= G * dt;
      this.vel = mul(this.vel, 1 - Math.min(0.2, 0.0012 * V * dt));
      this.pos = add(this.pos, mul(this.vel, dt));
      const wl = len(this.w);
      if (wl * dt > 1e-6) this.q = qnorm(qmul(this.q, qaxis(mul(this.w, 1 / wl), wl * dt)));
      this.w = mul(this.w, Math.exp(-dt * 0.25));
      this.eStep = 0; this.cabT -= dt;
      this.contacts(dt, world, true);
      if (this.eStep > 40 && this.cabT <= 0) { this.cabT = 0.25; this.cabinDmg = Math.min(1, this.cabinDmg + (this.eStep - 40) / 800); }
      if (this.wet > 0) { this.wetT += dt; if (this.wetT > 7) this.buoy = Math.max(0.15, 1 - (this.wetT - 7) * 0.05); }
      // Fuel from the torn tanks and a spark (scraping metal, a hot engine, the shower of sparks at the first hit) start the fire,
      // but not every time. A small fuel explosion is rare.
      if (!this.ignited && this.leak > 0.08 && this.wet === 0 && this.wreckT < 40) {
        const hard = this.surface && this.surface.skid < 0.45 ? 1.5 : 1;
        const spark = (this.scrapeI > 0.2 ? 0.5 * hard : 0) + this.hot * Math.max(0, 1 - this.wreckT / 2.5) + (this.engSev[0] + this.engSev[1] > 0 ? 0.12 : 0);
        if (Math.random() < dt * this.leak * spark * 1.6) this.ignite();
      }
      if (this.ignited && this.exT > 0 && this.wreckT > this.exT) { this.exT = -1; this.events.push({ type: 'explode', size: this.fireSize * 0.6 }); }
      if (this.pos[1] < WATER - 5) { this.rest = true; this.sunk = true; this.report = this.makeReport(); return; }
      const calm = len(this.vel) < 0.35 && len(this.w) < 0.12 && (this.wreckTouch > 0 || this.wet > 0);
      this.restT = calm && this.wet === 0 ? this.restT + dt : 0;
      if (this.restT > 0.8) { this.rest = true; this.vel = v3(); this.w = v3(); this.report = this.makeReport(); }
    }

    /// The end of the flight: works out how bad it was from the velocity into the surface (speed and angle), how much
    /// energy the structure has to take, what lets go first and whether the fuel burns.
    crash(why = 'crash', c = {}) {
      if (this.crashed) return;
      const s = this.s, V = this.speed;
      const vi = Math.max(0, c.vi ?? -this.vel[1]), vt = c.vt ?? 0;
      const ve = c.object ? V * 0.85 : Math.hypot(vi, 0.3 * vt);          // speed that has to be absorbed
      const sev = ve < 8 ? 0 : ve < 16 ? 1 : ve < 30 ? 2 : 3;
      const E = 0.5 * ve * ve;                                            // energy the structure has to absorb (J/kg)
      const ang = c.object ? Math.PI / 2 : Math.atan2(vi, Math.max(vt, 0.1));
      const pitch = this.pitchAngle, bank = this.bank;
      // A shallow hit at speed on level ground does not stop it: it skips like a stone, breaking up as it goes.
      const skip = !c.object && why !== 'water' && ang < 22 * DEG && V > 28 && ve < 45 && Math.abs(bank) < 45 * DEG;
      const fuelFrac = clamp(this.fuel / (s.fuel || 1800), 0, 1);
      const crush = 2.5 + 4 * clamp((s.stall - 24) / 46, 0, 1);            // how far the structure crumples
      this.crush = crush;
      const gEst = (ve * ve) / (2 * crush * (skip ? 1.8 : 1) * G);
      this.gPeak = Math.max(this.gPeak, gEst);
      this.cabinDmg = clamp((gEst - 12) / 16, 0, 1) + (c.object && ve > 25 ? 0.5 : 0);
      this.info = { why, sev, ve, vi, vt, V, pitch, bank, engineOut: !this.damage.engine, g: gEst, fire: false, sink: -this.vel[1], ias: this.ias, at: this.pos.slice(), E, ang, skip,
        hdg: this.heading, surf: this.surface === SURFACES.runway ? 'runway' : 'ground' };
      this.why = why; this.crashed = true; this.wreckT = 0; this.impactVel = this.vel.slice(); this.fuelAtCrash = this.fuel;
      this.snapQ = {}; this.hot = E > 200 ? 1 : E > 80 ? 0.55 : E > 30 ? 0.2 : 0.05;
      // Crumpling takes most of the speed into the surface; the rest becomes tumble (or, shallow, a bounce).
      const n = c.n;
      if (n) {
        const vn = dot(this.vel, n);
        if (vn < 0) {
          const vnv = mul(n, vn), vtv = sub(this.vel, vnv);
          this.vel = add(mul(vtv, skip ? 0.9 : [0.95, 0.8, 0.6, 0.45][sev]), mul(vnv, skip ? -0.3 : -0.1));
        }
        if (c.P) {
          const b = qrot(qconj(this.q), mul(n, Math.max(0, -vn) * 0.5)), r = c.P.r, I = this.I;
          this.w[0] += (r[1] * b[2] - r[2] * b[1]) / I[0]; this.w[1] += (r[2] * b[0] - r[0] * b[2]) / I[1] * 0.5; this.w[2] += (r[0] * b[1] - r[1] * b[0]) / I[2];
        }
      }
      // What comes off, and when: each piece lets go if the energy is above its threshold (a little random), earliest the
      // parts that the attitude put in the way. Each break takes some of the energy with it.
      this.breakQ = [];
      const liner = (s.engines || 0) >= 2 && s.cat !== 'ga' && s.cat !== 'mil', noseOn = why === 'nose' || pitch < -12 * DEG || !!c.object, tailOn = pitch > 12 * DEG && !c.object;
      const low = bank > 0 ? 'R' : 'L', high = low === 'R' ? 'L' : 'R';
      const wf = why === 'water' ? 1.3 : 1;
      let rem = (E / wf) * (skip ? 0.38 : 1);        // (a skip leaves energy for the next hits)
      const q = this.breakQ;
      const take = (thr, t, o) => { const k = thr * (0.75 + 0.5 * Math.random()); if (rem > k) { q.push(Object.assign({ t }, o)); rem -= k * 0.4; return true; } return false; };
      if (liner) { take(c.object ? 60 : 45, 0.03, { part: 'E', side: low === 'L' ? -1 : 1 }); take(c.object ? 70 : 52, 0.08, { part: 'E', side: low === 'L' ? 1 : -1 }); }
      take(Math.abs(bank) > 10 * DEG ? 42 : 95, 0.12, { part: low });
      take(c.object ? 90 : 115, 0.2, { part: high });
      take(tailOn ? 60 : 150, 0.15, { part: 'T' });
      take(noseOn ? 100 : 240, 0.1, { part: 'N' });
      q.sort((a, b) => a.t - b.t);
      if (sev >= 1) this.damage.gear = false;
      this.failEngine();
      // Fire: needs fuel in the torn tanks and something to light it (see stepWreck); the first hit often does.
      this.leak = Math.max(this.leak, E > 70 ? 0.3 : E > 30 ? 0.12 : 0.03);
      for (const b of q) if (b.part === 'L' || b.part === 'R') this.leak = Math.min(1, this.leak + 0.4);
      if (why !== 'water' && fuelFrac > 0.03 && this.leak > 0.1) {
        const pIgn = clamp(this.leak * (0.3 + this.hot * 0.9) * (0.5 + 0.5 * fuelFrac) * 1.1, 0, 0.97);
        if (Math.random() < pIgn) this.ignite();
      }
      this.info.fire = this.ignited;
      this.report = this.makeReport();
      this.events.push({ type: 'crash', why, info: this.info });
    }

    /// A short honest account of what happened, for the result screen: { title, lines, surv, g }. It is rebuilt when the
    /// wreck has stopped, so it can say what separated and where the wreck ended up.
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
      else if (i.engineOut && this.t > 5) cause = 'Engine failure';
      const what = WHAT[i.why] || 'Crashed';
      const impact = `impact ${Math.round(i.V)} m/s`;
      let title;
      if (cause) title = `${cause}, ${impact}, ${att}`;
      else if (i.why === 'water') title = `${what} at ${Math.round(i.V)} m/s`;
      else if (i.why === 'flip') title = `${what} on landing at ${Math.round(i.V)} m/s`;
      else title = `${what}, ${impact}, ${att}${i.skip ? ' (skipped)' : ''}`;
      // Survivability from the peak deceleration and the state of the cabin section.
      const g = this.gPeak, cab = this.cabinDmg;
      const cabin = cab < 0.3 ? 'cabin intact' : cab < 0.7 ? 'cabin badly damaged' : 'cabin destroyed';
      const surv = g < 14 && cab < 0.5 ? 'Survivable' : g < 24 && cab < 0.8 ? 'Barely survivable' : 'Not survivable';
      const list = (a) => a.length < 2 ? a.join('') : a.length === 2 ? a.join(' and ') : `${a.slice(0, -1).join(', ')} and ${a[a.length - 1]}`;
      const lines = [`Speed ${Math.round(i.V)} m/s · sink ${i.sink.toFixed(1)} m/s · ${att}${bank > 4 ? ` · ${bank}° bank` : ''} · ${Math.round(i.ang / DEG)}° to the surface`,
        `About ${Math.round(g)} g peak, ${cabin}`];
      if (this.sepLog.length) { const t = list(this.sepLog); lines.push(`${t.charAt(0).toUpperCase() + t.slice(1)} separated`); }
      if (this.ignited) lines.push(this.igniteT < 0.4 ? 'Fuel fire after the impact' : `Fire broke out ${Math.round(this.igniteT)} s after the impact`);
      else if (this.leak > 0.1 && i.why !== 'water') lines.push('Fuel spilled but did not ignite');
      if (i.why === 'water') lines.push(this.sunk ? 'The wreck sank' : 'The wreck floated for a while');
      { const d = Math.round(Math.hypot(this.pos[0] - i.at[0], this.pos[2] - i.at[2])); if (d > 8) lines.push(`Wreck ${this.rest || this.sunk ? 'came to rest' : 'slid'} ${d} m from the first impact`); }
      return { title, lines, surv, g, cabin, crash: true };
    }
    /// For a flight that ended without a crash (a belly slide to a stop): what failed, and whether it was survivable.
    slideReport() {
      const e = this.gearEvent, g = this.maxGGear, vi = Math.max(e ? e.vi || 0 : 0, this.sinkAtTouch || 0);
      let title;
      if (!e) title = 'Landed on its belly';
      else if (e.cause === 'up') title = 'Landed with the gear up';
      else if (e.cause === 'nose') title = vi > 4 ? `Nose gear collapsed on a hard landing: ${vi.toFixed(1)} m/s sink` : 'Nose gear collapsed';
      else if (e.cause === 'dig') title = 'Nose gear dug into the soft ground and collapsed';
      else if (e.cause === 'side') title = 'Gear collapsed under side load';
      else title = `Gear collapsed on a hard landing: ${vi.toFixed(1)} m/s sink`;
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
    { id: 'war', name: 'Battle', icon: '⚔️', desc: 'Fly a fighter, gunship or bomber, or drive a tank, on a flat battlefield. Destroy the enemy in waves.', unit: 'pts', better: 'high' },
    { id: 'free', name: 'Free Flight', icon: '🌤', desc: 'Take off and explore: hills, a canyon, a mountain strip. Watch for engine failures!', unit: '', better: 'high' },
  ];

  const CHALLENGES = [
    { id: 'first', name: 'First hoop', desc: 'Fly through a hoop' },
    { id: 'warfirst', name: 'First blood', desc: 'Destroy a target in a Battle' },
    { id: 'splash', name: 'Splash one', desc: 'Shoot down an enemy fighter in a Battle' },
    { id: 'wave3', name: 'Dug in', desc: 'Reach wave 3 in a Battle' },
    { id: 'carpet', name: 'Carpet bombing', desc: 'Destroy 4 targets with one bombing run' },
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
    { id: 'near', name: 'Close call', desc: 'Pass within 120 m of another aircraft without hitting it' },
    { id: 'hover', name: 'Hover steady', desc: 'In a helicopter, hold a steady hover for 15 s' },
    { id: 'pad', name: 'On the H', desc: 'Land a helicopter on a helipad and stop' },
    { id: 'padridge', name: 'Top of the world', desc: 'Land a helicopter on the mountain helipad' },
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
  .pg .pg-planewrap { position: relative; max-height: min(236px, 36vh); overflow-y: auto; padding-right: 3px; scrollbar-width: thin; scrollbar-color: rgba(255,255,255,.3) transparent; }
  .pg .pg-planes { display: grid; grid-template-columns: repeat(5, 1fr); gap: 5px; }
  .pg .pg-cat { grid-column: 1 / -1; font-size: 9px; font-weight: 800; letter-spacing: .08em; text-transform: uppercase; color: rgba(255,255,255,.5); margin-top: 5px; }
  .pg .pg-cat:first-child { margin-top: 0; }
  @media (max-width: 720px) { .pg .pg-modes { grid-template-columns: repeat(2, 1fr); } .pg .pg-planes { grid-template-columns: repeat(3, 1fr); } }
  .pg .pg-card { background: rgba(255,255,255,.06); border: 1px solid rgba(255,255,255,.1); border-radius: 10px; padding: 5px 6px; cursor: pointer; }
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
  .pg .pg-toast { position: absolute; left: 50%; top: 12%; transform: translateX(-50%); background: rgba(10,14,28,.82); border: 1px solid #ffb347; border-radius: 12px; padding: 6px 14px; font-size: 13px; font-weight: 700; pointer-events: none; transition: opacity .3s; white-space: normal; text-align: center; width: max-content; max-width: min(92%, 560px); line-height: 1.3; }
  .pg .pg-result { text-align: center; } .pg .pg-big { font-size: 34px; font-weight: 900; margin: 4px 0; }
  .pg .pg-report { margin: 8px auto 4px; padding: 7px 12px; max-width: 360px; border-radius: 10px; background: rgba(255,255,255,.08); font-size: 12px; line-height: 1.45; color: #cfd5df; }
  .pg .pg-report b { display: block; font-size: 14px; margin-bottom: 2px; } .pg .pg-ok b { color: #5ee08a; } .pg .pg-warn b { color: #ffd166; } .pg .pg-bad b { color: #ff7a6b; }
  .pg .pg-bgrid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 6px; } .pg .pg-b3 { grid-template-columns: repeat(3, 1fr); }
  .pg .pg-lab { font-size: 11px; font-weight: 800; opacity: .7; width: 66px; } @media (max-width: 560px) { .pg .pg-bgrid { grid-template-columns: repeat(2, 1fr); } .pg .pg-b3 { grid-template-columns: 1fr; } }
  .pg .pg-netbar { position: absolute; left: 10px; bottom: 12px; z-index: 5; gap: 5px; opacity: .72; font-size: 10px; } .pg .pg-netbar:hover { opacity: 1; } .pg .pg-netbar button { padding: 3px 7px; border-radius: 8px; border: 1px solid rgba(255,255,255,.3); background: rgba(10,14,28,.78); color: #fff; font-size: 12px; font-weight: 700; cursor: pointer; }
  .pg .pg-room { display: flex; align-items: center; justify-content: space-between; gap: 10px; padding: 8px 12px; border-radius: 12px; background: rgba(255,179,71,.12); border: 1px solid rgba(255,179,71,.5); }
  .pg .pg-code { font: 800 30px/1.1 ui-monospace, Menlo, monospace; letter-spacing: .18em; color: #ffb347; user-select: all; }
  .pg .pg-people { display: grid; gap: 4px; } .pg .pg-person { display: flex; justify-content: space-between; padding: 5px 10px; border-radius: 9px; background: rgba(255,255,255,.07); font-size: 12px; } .pg .pg-person span { opacity: .75; }
  .pg button.pg-voted { box-shadow: 0 0 0 1px #ffb347 inset; }
  .pg .pg-vote { top: 30%; transform: none; }
  .pg .pg-ctlcard { position: absolute; left: 10px; top: 50%; transform: translateY(-50%); width: min(300px, 46%); max-height: 78%; overflow: auto; z-index: 6; padding: 10px 12px; border-radius: 14px; background: rgba(10,14,28,.86); backdrop-filter: blur(8px); border: 1px solid rgba(255,179,71,.7); color: #fff; cursor: pointer; font-size: 11.5px; box-shadow: 0 8px 28px rgba(0,0,0,.4); }
  .pg .pg-ctitle { font-size: 13px; font-weight: 800; margin-bottom: 4px; } .pg .pg-ctitle span { float: right; font-size: 9.5px; font-weight: 500; opacity: .6; }
  .pg .pg-cgoal { font-size: 11.5px; line-height: 1.4; margin-bottom: 7px; color: rgba(255,255,255,.88); } .pg .pg-cgoal b { color: #ffb347; }
  .pg .pg-cgrid { display: grid; gap: 5px; } .pg .pg-crow { display: flex; gap: 8px; align-items: flex-start; }
  .pg .pg-ckeys { flex: 0 0 auto; min-width: 74px; display: flex; flex-wrap: wrap; gap: 3px; } .pg .pg-ckeys kbd { font-size: 11.5px; padding: 3px 6px; border-radius: 5px; background: rgba(255,255,255,.2); box-shadow: 0 2px 0 rgba(255,255,255,.18); }
  .pg .pg-ckeys i { font-style: normal; font-size: 11px; font-weight: 700; padding: 3px 6px; border-radius: 5px; background: rgba(255,179,71,.28); }
  .pg .pg-cname b { font-size: 12px; } .pg .pg-cname small { display: block; font-size: 10.5px; line-height: 1.35; color: rgba(255,255,255,.65); }
  .pg .pg-howto { margin-top: 8px; padding: 9px 11px; border-radius: 12px; background: rgba(255,255,255,.06); border: 1px solid rgba(255,255,255,.1); }
  .pg .pg-howto .pg-cgrid { grid-template-columns: repeat(2, 1fr); gap: 4px 14px; } @media (max-width: 560px) { .pg .pg-howto .pg-cgrid { grid-template-columns: 1fr; } }
  .pg .pg-chips { display: flex; gap: 5px; flex-wrap: wrap; margin: 4px 0 8px; }
  .pg .pg-qbar { position: absolute; left: 10px; top: calc(46% - 66px); z-index: 5; display: flex; gap: 6px; } .pg .pg-qbar button { width: 28px; height: 28px; border-radius: 50%; border: 1px solid rgba(255,255,255,.35); background: rgba(10,14,28,.7); color: #fff; font-size: 13px; display: grid; place-items: center; cursor: pointer; padding: 0; } .pg .pg-qbar button.pg-off { opacity: .45; text-decoration: line-through; }
  .pg .pg-chat { position: absolute; left: 10px; bottom: 74px; width: min(400px, 62%); z-index: 6; pointer-events: none; font-size: 12.5px; display: flex; flex-direction: column; gap: 2px; }
  .pg .pg-chat div { background: rgba(10,14,28,.62); padding: 3px 8px; border-radius: 8px; color: #fff; word-break: break-word; }
  .pg .pg-chat b { color: #ffd166; }
  .pg .pg-chatbox { position: absolute; left: 10px; bottom: 18px; width: min(400px, 62%); z-index: 7; background: rgba(10,14,28,.9); border: 1px solid rgba(255,179,71,.7); border-radius: 12px; padding: 7px 8px; color: #fff; }
  .pg .pg-chathint { font-size: 10.5px; color: #cdbfa0; margin-bottom: 5px; }
  .pg .pg-chatrow { display: flex; gap: 5px; }
  .pg .pg-chatrow input { flex: 1; min-width: 0; padding: 5px 8px; border-radius: 8px; border: 1px solid rgba(255,255,255,.3); background: rgba(255,255,255,.08); color: #fff; font-size: 13px; outline: none; }
  .pg .pg-chatrow button { padding: 4px 8px; border-radius: 8px; border: 1px solid rgba(255,255,255,.3); background: rgba(10,14,28,.78); color: #fff; font-size: 11px; font-weight: 700; cursor: pointer; }
  .pg .pg-ctlbtn { position: absolute; left: 10px; top: 46%; z-index: 5; width: 28px; height: 28px; border-radius: 50%; border: 1px solid rgba(255,255,255,.35); background: rgba(10,14,28,.7); color: #fff; font-weight: 800; font-size: 14px; display: grid; place-items: center; cursor: pointer; padding: 0; }
  .pg .pg-wbar { position: absolute; right: 8px; top: 34%; z-index: 5; flex-direction: column; gap: 6px; }
  .pg .pg-wbar button { position: relative; display: grid; grid-template-columns: 26px 1fr auto; align-items: center; gap: 4px; width: 128px; padding: 6px 8px; border-radius: 10px; border: 1px solid rgba(255,255,255,.25); background: rgba(10,14,28,.72); color: #fff; font-size: 12px; cursor: pointer; text-align: left; user-select: none; touch-action: none; }
  .pg .pg-wbar button:active { background: rgba(255,179,71,.45); } .pg .pg-wbar button b { font-weight: 700; } .pg .pg-wbar button span { font-size: 16px; }
  .pg .pg-wbar button kbd { font-size: 10px; } .pg .pg-wbar button i { position: absolute; right: 6px; bottom: 2px; font-style: normal; font-size: 9.5px; opacity: .8; }
  /* In a small window the weapon buttons shrink to an icon, its key and its count, so they fit and cover less. */
  .pg .pg-netbar.pg-compact span { display: none; } .pg .pg-wbar { max-height: 62%; } .pg .pg-wbar.pg-compact { top: 22%; gap: 4px; } .pg .pg-wbar.pg-compact button { width: 46px; grid-template-columns: 1fr; justify-items: center; padding: 4px 3px; } .pg .pg-wbar.pg-compact button b, .pg .pg-wbar.pg-compact button kbd { display: none; } .pg .pg-wbar.pg-compact button i { right: 3px; bottom: 1px; font-size: 10px; opacity: 1; }
  .pg .pg-wbar button.pg-lock { border-color: #ff5d5d; box-shadow: 0 0 10px #ff5d5d; }
  .pg .pg-pause { position: absolute; inset: 0; display: grid; place-items: center; background: rgba(0,0,0,.35); font-size: 13px; }
  `;

  // ------------------------------------------------------------------ war: the physics and the AI's brain (no drawing)

  /// Bombs, bullets and missiles, and how the computer pilots steer and aim. Everything here is plain maths on
  /// positions and velocities (metres, seconds), so it can be tested without a screen.
  const WAR = (() => {
    const G = 9.80665;
    /// Air gets thinner with height: drag at 5 km is about half what it is at sea level.
    const rhoAt = (h) => Math.exp(-Math.max(0, h) / 8500);
    /// A 500 lb bomb: drag per metre `k` gives a terminal speed of about 255 m/s at sea level (sqrt(g / k)). `R` is how far
    /// the blast reaches and `dmg` what it does at the very centre.
    const BOMB = { k: 1.5e-4, R: 45, dmg: 300 };
    /// A 20 mm cannon: the muzzle speed, the drag it slows with, how long a round lives and its scatter (radians).
    const GUN = { speed: 880, k: 4e-5, life: 2.3, spread: 0.0035 };
    const wrap = (a) => ((a + Math.PI * 3) % (Math.PI * 2)) - Math.PI;

    /// One step of a falling bomb. Gravity, plus drag against the air (the wind moves the air, so a bomb drifts with it).
    function bombStep(b, dt, wind = [0, 0, 0]) {
      const rel = sub(b.vel, wind), sp = len(rel), drag = BOMB.k * rhoAt(b.pos[1]) * sp;
      b.vel = [b.vel[0] - rel[0] * drag * dt, b.vel[1] - G * dt - rel[1] * drag * dt, b.vel[2] - rel[2] * drag * dt];
      b.pos = add(b.pos, mul(b.vel, dt));
      b.t = (b.t || 0) + dt;
      return b;
    }
    /// Where a bomb let go right now would land, and when: the bombsight's impact marker.
    function impactPoint(pos, vel, groundFn, wind = [0, 0, 0], dt = 0.05, maxT = 90) {
      const b = { pos: pos.slice(), vel: vel.slice(), t: 0 };
      let prev = b.pos.slice();
      while (b.t < maxT) {
        prev = b.pos.slice(); bombStep(b, dt, wind);
        const g = groundFn(b.pos[0], b.pos[2]);
        if (b.pos[1] <= g) {
          // Slide back to where the path crossed the ground, for a finer answer than one step.
          const g0 = groundFn(prev[0], prev[2]), a = prev[1] - g0, c = b.pos[1] - g, k = a / Math.max(1e-6, a - c);
          return { pos: lerp(prev, b.pos, clamp(k, 0, 1)), t: b.t - dt * (1 - clamp(k, 0, 1)) };
        }
      }
      return { pos: b.pos, t: b.t };
    }
    /// What a blast does at distance d: full power at the centre, falling away with the square of the way out, nothing past R.
    function blastDamage(d, R = BOMB.R, power = BOMB.dmg) {
      if (d >= R) return 0;
      const x = 1 - Math.max(0, d) / R;
      return power * x * x;
    }
    /// One step of a bullet: gravity and a little drag.
    function bulletStep(b, dt) {
      const sp = len(b.vel), drag = GUN.k * sp;
      b.vel = [b.vel[0] - b.vel[0] * drag * dt, b.vel[1] - G * dt - b.vel[1] * drag * dt, b.vel[2] - b.vel[2] * drag * dt];
      b.pos = add(b.pos, mul(b.vel, dt));
      b.t = (b.t || 0) + dt;
      return b;
    }
    /// Does the segment p0→p1 pass within r of centre c? (A fast bullet jumps several metres a step, so a point test misses.)
    function segHit(p0, p1, c, r) {
      const d = sub(p1, p0), l2 = dot(d, d);
      const t = l2 < 1e-9 ? 0 : clamp(dot(sub(c, p0), d) / l2, 0, 1);
      const q = add(p0, mul(d, t));
      return len(sub(q, c)) <= r;
    }
    /// Where to aim a shot of speed `speed` from `sp` to hit a target moving at `tv`: the point and the time of flight.
    function leadPoint(sp, sv, tp, tv, speed) {
      const r = sub(tp, sp), v = sub(tv, sv);          // the target's motion relative to the shooter (who adds its own speed)
      const a = dot(v, v) - speed * speed, b = 2 * dot(r, v), c = dot(r, r);
      let t;
      if (Math.abs(a) < 1e-6) t = b === 0 ? null : -c / b;
      else {
        const disc = b * b - 4 * a * c;
        if (disc < 0) return null;
        const s = Math.sqrt(disc), t1 = (-b - s) / (2 * a), t2 = (-b + s) / (2 * a);
        t = Math.min(...[t1, t2].filter((x) => x > 0));
        if (!Number.isFinite(t)) t = null;
      }
      if (t == null || t <= 0) return null;
      return { point: add(tp, mul(tv, t)), t };
    }
    /// A heat-seeking missile: it flies a proportional-navigation course (turn at N times the rate the target seems to
    /// swing round it), burns for `burn` seconds and then coasts. Without a target it flies straight.
    function missileStep(m, tgt, dt) {
      const N = 4, burn = 4, maxG = 30;
      m.t = (m.t || 0) + dt;
      let speed = len(m.vel);
      const dir = speed > 1 ? mul(m.vel, 1 / speed) : [0, 0, -1];
      // Off the rail it drops for a moment before the motor lights; then it burns (accelerating) and coasts (slowing).
      if (m.drop && m.t < 0.28) { m.vel = add(m.vel, [0, -9.8 * dt, 0]); m.pos = add(m.pos, mul(m.vel, dt)); return m; }
      speed = m.t < burn ? Math.min(620, speed + 190 * dt) : Math.max(180, speed - 25 * dt);
      let nd = dir;
      if (tgt) {
        const r = sub(tgt.pos, m.pos), rn = Math.max(1, len(r)), los = mul(r, 1 / rn), vr = sub(tgt.vel, m.vel);
        const Vc = -dot(r, vr) / rn, omega = mul(cross(r, vr), 1 / (rn * rn));
        let acc = mul(cross(omega, los), N * Math.max(0, Vc));
        const al = len(acc), lim = maxG * G;
        if (al > lim) acc = mul(acc, lim / al);
        nd = norm(add(dir, mul(acc, dt / Math.max(speed, 1))));
      }
      m.vel = mul(nd, speed);
      m.pos = add(m.pos, mul(m.vel, dt));
      return m;
    }
    /// Turns a computer pilot's aircraft `a` ({pos, heading, pitch, speed, bank}) towards the direction `want` at up to
    /// `turn` rad/s, and moves it. Heading 0 is towards -z and turning right is positive, like the player's.
    function steer(a, want, dt, turn) {
      const wh = Math.atan2(want[0], -want[2]), wp = Math.asin(clamp(want[1] / (len(want) || 1), -1, 1));
      const dh = wrap(wh - a.heading);
      a.heading = wrap(a.heading + clamp(dh, -turn * dt, turn * dt));
      a.pitch = clamp(a.pitch + clamp(wp - a.pitch, -turn * 0.75 * dt, turn * 0.75 * dt), -1.2, 1.2);
      a.bank += (clamp(dh * 1.6, -1.25, 1.25) - a.bank) * Math.min(1, dt * 3);
      const cp = Math.cos(a.pitch);
      a.vel = [Math.sin(a.heading) * cp * a.speed, Math.sin(a.pitch) * a.speed, -Math.cos(a.heading) * cp * a.speed];
      a.pos = add(a.pos, mul(a.vel, dt));
      return a;
    }
    /// The angle (radians) between the way an aircraft is pointing and the direction to a point.
    function offBore(a, p) {
      const cp = Math.cos(a.pitch), f = [Math.sin(a.heading) * cp, Math.sin(a.pitch), -Math.cos(a.heading) * cp];
      const to = norm(sub(p, a.pos));
      return Math.acos(clamp(dot(f, to), -1, 1));
    }
    return { G, BOMB, GUN, rhoAt, bombStep, impactPoint, blastDamage, bulletStep, segHit, leadPoint, missileStep, steer, offBore, wrap };
  })();

  // ------------------------------------------------------------------ the tank and the Automatic flying assist

  /// A drivable tank: the hull turns and drives, the turret turns on its own, and the gun raises and lowers.
  const TANK = { speed: 13, boostSpeed: 20, reverse: 6, accel: 9, boostAccel: 13, turn: 1.0, turretRate: 1.7, gunRate: 0.8, gunMin: -0.1, gunMax: 0.5, hp: 260, shell: 420, reload: 2.2 };
  class TankBody {
    constructor(pos, heading) {
      this.pos = [pos[0], 0, pos[2]]; this.heading = heading; this.turret = heading; this.gun = 0.04;
      this.speed = 0; this.vel = [0, 0, 0]; this.q = qheading(heading, 0); this.reload = 0; this.crashed = false;
    }
    /// The way the barrel points, and the end of the barrel.
    aim() { const c = Math.cos(this.gun); return [Math.sin(this.turret) * c, Math.sin(this.gun), -Math.cos(this.turret) * c]; }
    muzzle() { return add(add(this.pos, [0, 2.4, 0]), mul(this.aim(), 5.2)); }
    /// input: { drive -1..1 (forward +), steer -1..1 (right +), aimX -1..1 (turret right +), aimY -1..1 (gun up +) }.
    /// `limit` keeps it inside a round battlefield of that radius; water and steep ground stop it, and so do solid things.
    step(dt, input, world, limit = 1e9, centre = [0, 0]) {
      const K = this.K || TANK, boosting = input.drive > 0 && input.boost;
      const want = input.drive > 0 ? input.drive * (boosting ? K.boostSpeed : K.speed) : input.drive * K.reverse;
      const accel = boosting ? K.boostAccel : K.accel;
      this.speed += clamp(want - this.speed, -accel * dt, accel * dt);
      const sr = K.turn * (0.55 + 0.45 * Math.min(1, Math.abs(this.speed) / 6));
      this.heading = wrapPi(this.heading + input.steer * sr * dt);
      this.turret = wrapPi(this.turret + input.aimX * TANK.turretRate * dt);
      this.gun = clamp(this.gun + input.aimY * TANK.gunRate * dt, TANK.gunMin, TANK.gunMax);
      this.reload = Math.max(0, this.reload - dt);
      const step = this.speed * dt, nx = this.pos[0] + Math.sin(this.heading) * step, nz = this.pos[2] - Math.cos(this.heading) * step;
      const here = groundAt(world, this.pos[0], this.pos[2]), there = groundAt(world, nx, nz);
      const probe = [nx + Math.sin(this.heading) * Math.sign(step || 1) * 3.2, there + 1.2, nz - Math.cos(this.heading) * Math.sign(step || 1) * 3.2];
      const ho = hitObject(world, probe);
      if (ho && ho.kind === 'tree') { breakTree(world, ho); this.speed *= 0.7; }      // a tank or van drives through a tree and it breaks
      const blocked = there < WATER + 0.8 || Math.abs(there - here) > Math.abs(step) * 0.9 + 0.02 || Math.hypot(nx - centre[0], nz - centre[1]) > limit || (!!ho && ho.kind !== 'tree');
      if (blocked && Math.abs(step) > 1e-6) this.speed = 0;
      else { this.pos[0] = nx; this.pos[2] = nz; }
      const y = groundAt(world, this.pos[0], this.pos[2]);
      // Sit on the ground with the hull tilted to the slope under it.
      const fx = Math.sin(this.heading), fz = -Math.cos(this.heading), rx = Math.cos(this.heading), rz = Math.sin(this.heading);
      const pitch = Math.atan2(groundAt(world, this.pos[0] + fx * 3.5, this.pos[2] + fz * 3.5) - groundAt(world, this.pos[0] - fx * 3.5, this.pos[2] - fz * 3.5), 7);
      const roll = Math.atan2(groundAt(world, this.pos[0] - rx * 2, this.pos[2] - rz * 2) - groundAt(world, this.pos[0] + rx * 2, this.pos[2] + rz * 2), 4);
      this.pos[1] = y + 0.2;
      this.q = qmul(qheading(this.heading, clamp(pitch, -0.5, 0.5)), qaxis([0, 0, 1], -clamp(roll, -0.4, 0.4)));
      this.vel = [fx * this.speed, 0, fz * this.speed];
      return this;
    }
  }
  const wrapPi = (a) => ((a + Math.PI * 3) % (Math.PI * 2)) - Math.PI;
  /// The military van: a fast, unarmed truck (same driving model as the tank, with its own limits).
  const VAN = { speed: 24, boostSpeed: 32, reverse: 8, accel: 12, boostAccel: 17, turn: 1.3, turretRate: 0, gunRate: 0, gunMin: 0, gunMax: 0 };
  class VanBody extends TankBody { constructor(pos, heading) { super(pos, heading); this.K = VAN; this.gun = 0; } }
  const DROP_ALT = 380;        // metres: the height you jump from at the start of a soldier's battle

  /// A soldier on foot: walks, runs, strafes, crouches and looks with the mouse. Level ground only (water, steep slopes, trees
  /// and buildings stop it) inside a round battlefield. Shaped like TankBody so the rest of Battle can treat it the same way:
  /// `turret` is the way it looks, `gun` the look's pitch, `reload` the time until the rifle can fire again.
  const SOLDIER = { walk: 4.2, run: 7.4, crouch: 1.9, back: 0.55, strafe: 0.8, accel: 20, lookRate: 1.9, pitchMin: -1.2, pitchMax: 1.2,
    hp: 150, eye: 1.65, eyeCrouch: 1.05, mag: 30, reserve: 210, reloadTime: 1.8, fireGap: 0.11, muzzle: 760, dmg: 20, grenades: 4, zoom: [1, 4, 10],
    enemyHp: 40, enemyDmg: 10, enemyWalk: 3.4,
    shield: 50, shieldMax: 100, jump: 6.2, gravity: 18,
    rpg: 4, rpgReload: 2.8, rpgSpeed: 130, rpgDmg: 120, rpgEnemyDmg: 40 };
  class SoldierBody {
    constructor(pos, heading) {
      this.pos = [pos[0], 0, pos[2]]; this.heading = heading; this.turret = heading; this.gun = 0;
      this.speed = 0; this.vel = [0, 0, 0]; this.q = qheading(heading, 0); this.reload = 0; this.crashed = false;
      this.crouch = false; this.walk = 0; this.sway = 1; this.eye = SOLDIER.eye; this.moving = false;
      this.air = 0;      // metres above the ground while still under a parachute (after ejecting)
      this.jumpH = 0; this.vy = 0;     // a jump: height above the ground and the climb speed
    }
    aim() { const c = Math.cos(this.gun); return [Math.sin(this.turret) * c, Math.sin(this.gun), -Math.cos(this.turret) * c]; }
    muzzle() { return add(add(this.pos, [0, this.eye - 0.12, 0]), mul(this.aim(), 0.9)); }
    /// input: { drive -1..1 (forward +), steer -1..1 (strafe right +), aimX, aimY (look right / up, -1..1), boost (run), crouch, lookScale }.
    step(dt, input, world, limit = 1e9, centre = [0, 0]) {
      this.crouch = !!input.crouch;
      this.eye += ((this.crouch ? SOLDIER.eyeCrouch : SOLDIER.eye) - this.eye) * (1 - Math.exp(-dt * 10));
      const ls = input.lookScale || 1;
      this.turret = wrapPi(this.turret + input.aimX * SOLDIER.lookRate * ls * dt);
      this.gun = clamp(this.gun + input.aimY * SOLDIER.lookRate * 0.8 * ls * dt, SOLDIER.pitchMin, SOLDIER.pitchMax);
      this.heading = this.turret;
      this.reload = Math.max(0, this.reload - dt);
      const top = this.crouch ? SOLDIER.crouch : input.boost ? SOLDIER.run : SOLDIER.walk;
      const fx = Math.sin(this.heading), fz = -Math.cos(this.heading), rx = Math.cos(this.heading), rz = Math.sin(this.heading);
      const fwd = input.drive >= 0 ? input.drive * top : input.drive * top * SOLDIER.back, side = input.steer * top * SOLDIER.strafe;
      let wx = fx * fwd + rx * side, wz = fz * fwd + rz * side;
      const wl = Math.hypot(wx, wz); if (wl > top) { wx *= top / wl; wz *= top / wl; }
      const chute = this.air > 0.05;
      if (chute) { wx *= 0.4; wz *= 0.4; }       // under the canopy you can only steer a little
      const k = clamp(SOLDIER.accel * (chute ? 0.25 : 1) * dt, 0, 1);
      this.vel[0] += (wx - this.vel[0]) * k; this.vel[2] += (wz - this.vel[2]) * k; this.vel[1] = 0;
      const here = groundAt(world, this.pos[0], this.pos[2]);
      const free = (nx, nz) => { const th = groundAt(world, nx, nz); return th >= WATER + 0.5 && Math.abs(th - here) < Math.hypot(nx - this.pos[0], nz - this.pos[2]) * 0.9 + 0.03 && Math.hypot(nx - centre[0], nz - centre[1]) <= limit && !hitObject(world, [nx, th + 1, nz]); };
      const nx = this.pos[0] + this.vel[0] * dt, nz = this.pos[2] + this.vel[2] * dt;
      if (free(nx, nz)) { this.pos[0] = nx; this.pos[2] = nz; }
      else if (free(nx, this.pos[2])) { this.pos[0] = nx; this.vel[2] = 0; }
      else if (free(this.pos[0], nz)) { this.pos[2] = nz; this.vel[0] = 0; }
      else { this.vel[0] = 0; this.vel[2] = 0; }
      this.speed = Math.hypot(this.vel[0], this.vel[2]); this.moving = this.speed > 0.4;
      this.walk += this.speed * dt * 0.9;
      if (this.air > 0) this.air = Math.max(0, this.air - dt * (this.air > 60 ? 22 : 6));      // the canopy opens low down
      if (input.jump && this.jumpH <= 0.01 && this.air <= 0.05) this.vy = SOLDIER.jump;
      if (this.vy !== 0 || this.jumpH > 0) { this.vy -= SOLDIER.gravity * dt; this.jumpH += this.vy * dt; if (this.jumpH <= 0) { this.jumpH = 0; this.vy = 0; } }
      this.pos[1] = groundAt(world, this.pos[0], this.pos[2]) + this.air + this.jumpH;
      // Sway of the rifle: settles when still, more so while crouched.
      const swayT = (this.moving ? 1 : 0.25) * (this.crouch ? 0.5 : 1);
      this.sway += (swayT - this.sway) * (1 - Math.exp(-dt * 2.5));
      this.q = qheading(this.heading, 0);
      return this;
    }
    /// Spread (radians) of the next shot at the current sway and zoom.
    spread(zoom = 1) { return (0.0012 + this.sway * 0.011) / Math.sqrt(zoom); }
  }
  /// Loot, Fortnite style: grey, blue, purple and gold drops. A rarer drop gives more. All rolls are made by the host.
  const LOOT_RARITY = [{ id: 'common', w: 60, mult: 1, tint: [0.85, 0.85, 0.85] }, { id: 'rare', w: 25, mult: 1.5, tint: [0.35, 0.65, 1.7] }, { id: 'epic', w: 12, mult: 2, tint: [1.3, 0.45, 1.6] }, { id: 'legendary', w: 3, mult: 3, tint: [2, 1.5, 0.3] }];
  const LOOT_KINDS = [{ k: 'ammo', w: 30, name: 'Rifle ammo', base: 60 }, { k: 'rocket', w: 12, name: 'Rockets', base: 1 }, { k: 'grenade', w: 16, name: 'Grenades', base: 2 },
    { k: 'bandage', w: 22, name: 'Bandages', base: 3 }, { k: 'shield', w: 14, name: 'Shield potion', base: 1 }, { k: 'medkit', w: 6, name: 'Medkit', base: 1 }];
  const pickWeighted = (list, rand) => { let t = list.reduce((a, b) => a + b.w, 0) * rand(); for (const it of list) { t -= it.w; if (t <= 0) return it; } return list[list.length - 1]; };
  /// One random drop: { k: kind, r: rarity index }.
  const lootRoll = (rand = Math.random) => ({ k: pickWeighted(LOOT_KINDS, rand).k, r: LOOT_RARITY.indexOf(pickWeighted(LOOT_RARITY, rand)) });
  const lootAmount = (k, r) => Math.max(1, Math.round(LOOT_KINDS.find((x) => x.k === k).base * LOOT_RARITY[r].mult));
  /// How far a computer rifleman's shot is off (radians per axis): grows with the range and with how hard the enemy is set.
  const riflemanError = (range, aim) => aim * 0.3 + range * 0.00005;
  /// Where a tank's turret and gun should point to hit a target: leads a moving one and allows for the shell's drop.
  function tankAimAt(tank, tp, tv) {
    const from = add(tank.pos, [0, 2.4, 0]);
    const lead = WAR.leadPoint(from, tank.vel, tp, tv || [0, 0, 0], TANK.shell) || { point: tp, t: len(sub(tp, from)) / TANK.shell };
    const aim = add(lead.point, [0, 0.5 * WAR.G * lead.t * lead.t, 0]), d = sub(aim, from), h = Math.hypot(d[0], d[2]);
    return { yaw: Math.atan2(d[0], -d[2]), pitch: Math.atan2(d[1], Math.max(h, 1)), dist: len(sub(tp, from)) };
  }

  /// Automatic flying: the aircraft keeps its own speed and height and turns where you point it. `cmd` is { turn: -1..1,
  /// climb: -1..1 } and `st` the assist's memory ({ hdg, alt, spd, i }). It never lets the aircraft sink towards the ground
  /// (the floor is `floor` metres up) and returns the stick, rudder and throttle to feed the flight model.
  function planeAssist(fl, st, cmd, dt, world, o = {}) {
    st.hdg = wrapPi(st.hdg + cmd.turn * (o.turnRate || 0.6) * dt);
    const off = wrapPi(st.hdg - fl.heading);
    if (Math.abs(off) > 1.1) st.hdg = wrapPi(fl.heading + Math.sign(off) * 1.1);          // never swing round the long way
    const floor = o.floor || 220, g0 = groundAt(world, fl.pos[0], fl.pos[2]), g1 = groundAt(world, fl.pos[0] + fl.vel[0] * 6, fl.pos[2] + fl.vel[2] * 6);
    st.alt = clamp(st.alt + cmd.climb * (o.climbRate || 70) * dt, Math.max(g0, g1) + floor, o.ceiling || 2600);
    // The wanted height never runs far ahead of the plane, so reversing the stick reverses the climb straight away.
    if (o.lead) st.alt = clamp(st.alt, fl.pos[1] - o.lead, fl.pos[1] + o.lead);
    const bm = o.bankMax || (fl.s.gLimit < 5 ? 1.15 : 1.3), he = wrapPi(st.hdg - fl.heading), bankT = clamp(he * 3.0, -bm, bm);
    const roll = clamp(wrapPi(bankT - fl.bank) * 2.5, -1, 1);          // the short way round, even if a gust has rolled the plane past 90 degrees
    const vsMax = o.vsMax || 30, vsT = clamp((st.alt - fl.pos[1]) * (o.lead ? 0.4 : 0.12), -vsMax, vsMax);
    const pitch = Math.abs(fl.bank) > 1.35 ? clamp((vsT - fl.vel[1]) * 0.02, -0.15, 0.15) : clamp((vsT - fl.vel[1]) * (o.lead ? 0.08 : 0.05) + Math.abs(Math.sin(fl.bank)) * (o.pull || 0.3), -0.5, 0.7);      // rolled right over: level the wings first, do not pull
    st.i = clamp(st.i + (st.spd - fl.ias) * dt * 0.02, -0.5, 0.5);
    const throttle = clamp((clamp(0.55 + (st.spd - fl.ias) * 0.04 + st.i, 0.1, 1) - fl.throttle) * 3, -1, 1);
    return { pitch: pitch * AP_SIGN.pitch, roll: roll * AP_SIGN.roll, yaw: 0, throttle };
  }

  // ------------------------------------------------------------------ playing with others: the room, the lobby and the votes

  /// Everything about a shared Battle that does not need a screen. Players meet in a room named by a short code, through the
  /// same live relay the Clipboard Link uses (it only passes frames between the people connected; nothing is stored). One
  /// player is the host: the computer enemies and the waves run on the host and everyone else is shown them, while each
  /// player drives their own vehicle and judges the hits on it.
  /// The network protocol version of the Battle. Players only meet players on the same one; a newer protocol is how an old version is kept out.
  const BATTLE_PV = 2;
  const BATTLE_RELAY = 'wss://notchapple-rooms.adityajain1225.workers.dev';
  const NET = (() => {
    const CODE_CHARS = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';       // no 0/O, 1/I/L: easy to read out loud
    /// A new room code such as "K7PD2M".
    const newCode = (rand = Math.random) => Array.from({ length: 6 }, () => CODE_CHARS[Math.floor(rand() * CODE_CHARS.length)]).join('');
    /// What someone typed, tidied up: capitals, no spaces or dashes. Null if it cannot be a code.
    const normCode = (raw) => { const c = String(raw || '').toUpperCase().replace(/[^A-Z0-9]/g, ''); return c.length === 6 && [...c].every((ch) => CODE_CHARS.includes(ch)) ? c : null; };
    /// The relay's name for a room: a hash of the code (the relay never sees the code itself).
    async function topicFor(code, ver = 'v2') {
      const data = new TextEncoder().encode(`notchapple-battle-${ver}|${code}`);      // v2: older versions are in other rooms, so they can never meet players on this one
      const h = new Uint8Array(await crypto.subtle.digest('SHA-256', data));
      return `notchapple-v1-${[...h.slice(0, 20)].map((b) => b.toString(16).padStart(2, '0')).join('')}`;
    }
    const r1 = (v) => Math.round(v * 10) / 10, r3 = (v) => Math.round(v * 1000) / 1000;
    /// A vehicle's state, as sent ten times a second.
    const packState = (id, s) => ({ t: 's', id, k: s.kind, p: s.pos.map(r1), q: s.q.map(r3), v: s.vel.map(r1), hp: Math.round(s.hp), tu: r3(s.turret || 0), gn: r3(s.gun || 0), fg: s.firing ? 1 : 0, al: s.alive === false ? 0 : 1 });
    const unpackState = (m) => ({ id: m.id, kind: m.k, pos: m.p, q: m.q, vel: m.v, hp: m.hp, turret: m.tu, gun: m.gn, firing: !!m.fg, alive: m.al !== 0 });
    /// Where a remote vehicle is drawn now: its last reported place carried on by its speed, eased from where it was drawn
    /// before, so it glides instead of jumping (and a late message does not snap it back).
    function glide(shown, report, ageSec, dt) {
      const ahead = Math.min(ageSec, 0.4);
      const goal = [report.pos[0] + report.vel[0] * ahead, report.pos[1] + report.vel[1] * ahead, report.pos[2] + report.vel[2] * ahead];
      if (!shown) return goal;
      const k = 1 - Math.exp(-dt * 9);
      return [shown[0] + (goal[0] - shown[0]) * k, shown[1] + (goal[1] - shown[1]) * k, shown[2] + (goal[2] - shown[2]) * k];
    }
    /// Voting: each player has at most one vote per question. A change passes when more than half of the players voted for it.
    function tally(playerIds, votes, key, current, options) {
      const counts = {};
      for (const id of playerIds) { const v = votes[id] && votes[id][key]; if (v != null && v !== current && options.includes(v)) counts[v] = (counts[v] || 0) + 1; }
      const need = Math.floor(playerIds.length / 2) + 1;
      for (const v of Object.keys(counts)) if (counts[v] >= need) return { passed: v, counts, need };
      return { passed: null, counts, need };
    }
    /// The first free place on each side to start from (so players do not start on top of each other).
    const slotOffset = (slot) => { const col = slot % 4, row = Math.floor(slot / 4); return [(col - 1.5) * 90, row * 90]; };

    /// A link to a room. `Socket` is the WebSocket class (replaced by a pretend one in tests).
    class Link {
      constructor(Socket, onMessage, onState) { this.Socket = Socket; this.onMessage = onMessage; this.onState = onState; this.ws = null; this.state = 'off'; this.topic = null; this.retry = 0; this.wantOpen = false; this.sent = 0; }
      async join(code, ver = 'v2') {
        this.close(); this.topic = await topicFor(code, ver); this.wantOpen = true; this._open();
      }
      _open() {
        if (!this.wantOpen) return;
        this._set('connecting');
        let ws;
        try { ws = new this.Socket(`${BATTLE_RELAY}/${this.topic}/ws`); } catch { this._set('failed'); return; }
        this.ws = ws;
        ws.onmessage = (e) => {
          let m; try { m = JSON.parse(typeof e.data === 'string' ? e.data : ''); } catch { return; }
          if (m && m.event === 'open') { this.retry = 0; this._set('on'); return; }
          if (m && m.t) this.onMessage(m);
        };
        ws.onclose = () => { if (this.ws !== ws) return; this.ws = null; if (!this.wantOpen) return; this._set('connecting'); this.timer = setTimeout(() => this._open(), Math.min(8000, 1000 * 2 ** this.retry++)); };
        ws.onerror = () => { /* onclose follows */ };
      }
      send(obj) { if (this.ws && this.state === 'on') { try { this.ws.send(JSON.stringify(obj)); this.sent++; return true; } catch { return false; } } return false; }
      close() { this.wantOpen = false; clearTimeout(this.timer); if (this.ws) { const ws = this.ws; this.ws = null; try { ws.close(); } catch { /* already closed */ } } this._set('off'); }
      _set(s) { if (this.state !== s) { this.state = s; this.onState && this.onState(s); } }
    }
    return { newCode, normCode, topicFor, packState, unpackState, glide, tally, slotOffset, Link, CODE_CHARS };
  })();

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
    const vs = `attribute vec3 p; attribute vec3 n; attribute vec3 c; uniform mat4 vp, m; uniform vec3 tint; uniform float glow; uniform vec3 sunDir;
      varying vec3 vc; varying float vd; varying float vl;
      void main(){ vec4 w = m * vec4(p,1.0); gl_Position = vp * w; vec3 nn = normalize(mat3(m) * n);
        float l = max(dot(nn, sunDir), 0.0); vl = 0.42 + 0.68 * l + glow; vc = c * tint; vd = gl_Position.w; }`;
    const fs = `precision mediump float; varying vec3 vc; varying float vd; varying float vl; uniform vec3 fog; uniform float fogFar; uniform float alpha; uniform vec3 lum;
      ${FOG_GLSL}
      void main(){ gl_FragColor = vec4(mix(vc * vl * lum, fog, fogAmt(vd, fogFar)), alpha); }`;
    const sh = (type, src) => { const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s); return s; };
    const prog = gl.createProgram(); gl.attachShader(prog, sh(gl.VERTEX_SHADER, vs)); gl.attachShader(prog, sh(gl.FRAGMENT_SHADER, fs));
    gl.bindAttribLocation(prog, 0, 'p'); gl.bindAttribLocation(prog, 1, 'n'); gl.bindAttribLocation(prog, 2, 'c'); gl.linkProgram(prog); gl.useProgram(prog);
    const loc = { p: gl.getAttribLocation(prog, 'p'), n: gl.getAttribLocation(prog, 'n'), c: gl.getAttribLocation(prog, 'c') };
    const uni = (name) => gl.getUniformLocation(prog, name);
    const U = { vp: uni('vp'), m: uni('m'), tint: uni('tint'), glow: uni('glow'), fog: uni('fog'), lum: uni('lum'), sunDir: uni('sunDir'), fogFar: uni('fogFar'), alpha: uni('alpha') };
    gl.enable(gl.DEPTH_TEST);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    const upload = (builder) => {
      if (!builder) return null;
      const buf = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, buf); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(builder.d), gl.STATIC_DRAW);
      return { buf, count: builder.d.length / 9 };
    };
    const I = new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
    let thermal = false, heatPass = false;      // heat vision (Battle, key Y): in the heat pass, anything bright is drawn white-hot
    function draw(mesh, m = I, tint = [1, 1, 1], glow = 0) {
      if (!mesh) return;
      if (heatPass && tint[0] + tint[1] + tint[2] > 1.5) { tint = [3.2, 3.2, 3.2]; glow = 1; }
      gl.bindBuffer(gl.ARRAY_BUFFER, mesh.buf);
      gl.enableVertexAttribArray(loc.p); gl.vertexAttribPointer(loc.p, 3, gl.FLOAT, false, 36, 0);
      gl.enableVertexAttribArray(loc.n); gl.vertexAttribPointer(loc.n, 3, gl.FLOAT, false, 36, 12);
      gl.enableVertexAttribArray(loc.c); gl.vertexAttribPointer(loc.c, 3, gl.FLOAT, false, 36, 24);
      gl.uniformMatrix4fv(U.m, false, m); gl.uniform3fv(U.tint, tint); gl.uniform1f(U.glow, glow);
      gl.drawArrays(gl.TRIANGLES, 0, mesh.count);
    }

    let regionId = read('region', '');    // the place the world is set in (see REGIONS)
    if (!REGIONS.some((x) => x.id === regionId)) regionId = '';
    let W = makeWorld(regionOf(regionId));
    let placeNote = '';
    /// Rebuilds the scenery for another place (only from the menu).
    function setRegion(id) {
      ARENA = null; worldArena = '';
      regionId = id; write('region', id);
      W = makeWorld(regionOf(id)); WR.setWorld(W);
    }
    async function lookupPlace(text) {
      const known = matchRegion(text);
      if (known) { placeNote = known.id ? `${known.name}: ${known.lm}.` : 'The home valley.'; return known; }
      const j = await (await fetch(`https://geocoding-api.open-meteo.com/v1/search?count=1&language=en&name=${encodeURIComponent(text)}`)).json();
      const hit = (j.results || [])[0];
      if (!hit) throw new Error('nothing found');
      const reg = nearestRegion(hit.latitude, hit.longitude, hit.country_code);
      placeNote = `${hit.name}${hit.country ? ', ' + hit.country : ''}: the closest scenery we have is ${reg.name} (${reg.lm}).`;
      return reg;
    }
    async function myPlace() {
      let loc = window.NotchDeviceLocation;
      if (!loc || !Number.isFinite(loc.lat)) {
        const j = await (await fetch('https://ipwho.is/')).json();
        if (!j.success) throw new Error('no location');
        loc = { lat: j.latitude, lon: j.longitude, name: j.city, cc: j.country_code };
      }
      const reg = nearestRegion(loc.lat, loc.lon, loc.cc);
      placeNote = `Near ${loc.name || 'you'}: showing ${reg.name} (${reg.lm}).`;
      return reg;
    }
    const hoopB = new Builder(); hoopB.torus(14, 1.3, [1, 1, 1]); const hoopMesh = upload(hoopB);
    const arrowB = new Builder(); arrowB.cone([0, 0, 0], 2.2, 0, 5, [1, 1, 1], 8); const arrowMesh = upload(arrowB);
    const smokeB = new Builder(); smokeB.box([0, 0, 0], [1, 1, 1], [1, 1, 1]); const smokeMesh = upload(smokeB);
    const decalB = new Builder(); decalB.box([0, 0, 0], [1.4, 0.05, 2.6], [1, 1, 1]); const decalMesh = upload(decalB);
    // ---- SPLIT BEGIN
    // Each plane is split into its body (F), wings (L, R) and tail (T), each centred on itself, so a part can break
    // off and tumble on its own. A part's `mesh` includes the control surfaces resting in their neutral position (that is
    // what tumbles away); `live` leaves them out, because they are drawn separately, moved by the controls.
    function splitPlane(spec, m) {
      const full = {}, live = {}, engs = m.engs || [];
      const place = (d, alsoLive) => {
        for (let i = 0; i < d.length; i += 27) {
          const cx = (d[i] + d[i + 9] + d[i + 18]) / 3, cy = (d[i + 1] + d[i + 10] + d[i + 19]) / 3, cz = (d[i + 2] + d[i + 11] + d[i + 20]) / 3;
          let k = null;
          for (let e = 0; e < engs.length && e < 4; e++) { const E = engs[e], dx = cx - E.x, dy = cy - E.y; if (dx * dx + dy * dy < E.r * E.r && cz > E.z - 0.12 && cz < E.z + E.len) { k = 'E' + e; break; } }
          if (!k) k = bucketOf(spec, cx, cz);
          if (!full[k]) { full[k] = []; live[k] = []; }
          for (let j = 0; j < 27; j++) { full[k].push(d[i + j]); if (alsoLive) live[k].push(d[i + j]); }
        }
      };
      place(m.body.d, true);
      for (const dy of m.dyn || []) place(dy.mesh.d, false);
      const parts = {};
      // The bounding box of a mesh and its centre: the pieces that break off are boxes to the physics.
      const bbox = (arr) => { const lo = [1e9, 1e9, 1e9], hi = [-1e9, -1e9, -1e9]; for (let i = 0; i < arr.length; i += 9) for (let a = 0; a < 3; a++) { const v = arr[i + a]; if (v < lo[a]) lo[a] = v; if (v > hi[a]) hi[a] = v; } return [lo, hi]; };
      for (const [k, arr] of Object.entries(full)) {
        if (!arr.length) continue;
        const c = v3(), n = arr.length / 9;
        for (let i = 0; i < arr.length; i += 9) { c[0] += arr[i] / n; c[1] += arr[i + 1] / n; c[2] += arr[i + 2] / n; }
        const shift = (a) => { for (let i = 0; i < a.length; i += 9) { a[i] -= c[0]; a[i + 1] -= c[1]; a[i + 2] -= c[2]; } };
        shift(arr); shift(live[k]);
        const [lo, hi] = bbox(arr);
        parts[k] = { mesh: upload({ d: arr }), live: upload({ d: live[k] }), center: c, lo, hi };
      }
      // Lights: a glowing core and a faint halo for each kind on each part.
      const groups = new Map();
      for (const l of m.lights || []) {
        const key = `${l.kind}|${l.attach}`;
        if (!groups.has(key)) groups.set(key, { kind: l.kind, attach: l.attach, core: new Builder(), halo: new Builder() });
        const g = groups.get(key);
        blob(g.core, l.p, l.r); orb(g.halo, l.p, l.r * 3.3);
      }
      return {
        parts, prop: upload(m.prop), propAt: m.propAt, propBox: m.prop ? bbox(m.prop.d) : null, disc: upload(m.disc),
        rotors: (m.rotors || []).map((r) => ({ at: r.at, axis: r.axis, gl: upload(r.mesh), disc: upload(r.disc) })),
        dyn: (m.dyn || []).map((d) => ({ kind: d.kind, side: d.side, attach: d.attach, pivot: d.pivot, axis: d.axis, gl: upload(d.mesh) })),
        gears: (m.gears || []).map((g) => {
          // (a recentred copy for the leg when it breaks off)
          const d = g.mesh.d.slice(), c = v3(), n = d.length / 9;
          for (let i = 0; i < d.length; i += 9) { c[0] += d[i] / n; c[1] += d[i + 1] / n; c[2] += d[i + 2] / n; }
          for (let i = 0; i < d.length; i += 9) { d[i] -= c[0]; d[i + 1] -= c[1]; d[i + 2] -= c[2]; }
          const [lo, hi] = bbox(d);
          return { pivot: g.pivot, axis: g.axis, ang: g.ang, nose: !!g.nose, gl: upload(g.mesh), piece: { mesh: upload({ d }), center: c, lo, hi } };
        }),
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
    const ALL_PARTS = ['F', 'N', 'L', 'Lo', 'R', 'Ro', 'T', 'E0', 'E1', 'E2', 'E3', 'P'];

    // ---- state
    let plane = PLANES.find((p) => p.id === read('plane', 'c172')) || PLANES[0];
    let mode = MODES.find((m) => m.id === read('mode', 'hoops')) || MODES[0];
    let screen = 'menu', menuTab = read('menuTab', 'play');
    let flight = new Flight(plane);
    let hoops = [], nextHoop = 0, score = 0, timeLeft = 0, elapsed = 0, streak = 0, hoopsMade = 0;
    let camMode = 0, camPos = [0, 30, 60], paused = false, result = null, propAngle = 0, rotorAngle = 0, toastTimer = 0;
    // ---- the world leaderboard (on the licence server): a name, a plane and a score, nothing else
    const WORLD_SERVER = window.NotchPlaneServer || 'https://notchapple-licenses.adityajain1225.workers.dev';
    let shareWorld = read('shareWorld', true), boardScope = read('boardScope', 'local'), boardPeriod = read('boardPeriod', 'all');
    const worldCache = {};          // "mode|period" → { at, entries, error }
    async function postWorld(modeId, name, score) {
      try {
        const r = await fetch(`${WORLD_SERVER}/plane/score`, { method: 'POST', headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ mode: modeId, name, plane: plane.id, score, region: regionId || '' }) });
        const j = await r.json();
        delete worldCache[`${modeId}|all`]; delete worldCache[`${modeId}|week`];
        return r.ok && j.ok ? { ok: true, rank: j.rank } : { ok: false, error: j.error || 'The world board is busy.' };
      } catch { return { ok: false, error: "Couldn't reach the world board." }; }
    }
    async function loadWorld(modeId, period) {
      const key = `${modeId}|${period}`, hit = worldCache[key];
      if (hit && Date.now() - hit.at < 20000) return hit;
      let out;
      try {
        const r = await fetch(`${WORLD_SERVER}/plane/board?mode=${modeId}&period=${period}`);
        out = { at: Date.now(), entries: (await r.json()).entries || [] };
      } catch { out = { at: Date.now(), entries: [], error: true }; }
      worldCache[key] = out;
      return out;
    }
    let atcOn = read('atc', true), coldStart = read('cold', false), showCheck = true, atc = { cs: 'Notch 100', said: new Set() }, atcText = '', atcT = 0;
    let tcasOn = read('tcas', true), gpwsOn = read('gpws', true), gpwsText = '', gpwsLevel = 0, gpwsT = 0, gpwsLastFt = null, gpwsAt = {}, hundredCalled = false, wasAirborne = false;
    let gearWarn = false, gearBeepAt = 0, tailScrapeT = 0, rotateCalled = false, v1Called = false, lowFuelWarned = false, flapSoundT = 0;
    let rollAcc = 0, rollT = 0, loopAcc = 0, loopT = 0, lowT = 0, hadTakeoff = false, stoppedT = 0, hadAir = false, stopCredited = false, hoverT = 0, cfgTakeoff = false, cfgLanding = false, svc = null, svcDone = {};
    const smoke = [];              // particles: fire, smoke, dust, sparks, spray
    const debris = [];             // parts that have come off and are tumbling on their own
    let attached = new Set(ALL_PARTS);
    let wreckT = 0, failAt = Infinity, hadFailure = false, engineSmokeT = 0, wingLostAt = -1, canyonT = 0;
    let wreckFire = false, fireT = 0, crashCam = null, tyreT = 0, debrisSndT = 0, sideToast = 0, skidToast = 0, tdShown = null, bumpSlow = false;
    const ZERO_CTL = { pitch: 0, roll: 0, yaw: 0, throttle: 0 };
    let failures = read('failures', 'rare');
    const keys = new Set();
    const mouse = { x: 0, y: 0, in: false, engaged: false };   // the cursor in the steering ring, -1..1 each way
    const done = new Set(read('done', []));
    // invertY false (the default): up climbs, for the mouse and the ↑ key. True: flight-stick style, down climbs.
    let invert = read('invertY', false), mouseOn = read('mouse', true), sens = read('sens', 1), sound = (typeof window.NotchHostSound === 'boolean') ? window.NotchHostSound : read('sound', true), units = read('units', 'kmh');
    { const e = read('env', {}); ENV.clock = 0.3 + Math.random() * 0.25; applyEnv(e && e.tod ? e.tod : 'cycle', e && e.vis); }   // time of day (the day/night cycle unless another was picked) and visibility   // time of day and visibility
    WX = sanWx(read('weather', WX_DEFAULT));   // Weather panel settings, shared by every mode
    const saveWx = () => { write('weather', WX); if (screen === 'menu' && flight) flight.reset([0, gearH(), 0], 0, 0, true); };   // the menu scene's windsocks follow
    let playerName = read('name', '');

    // ---- sound (Web Audio): engine drone, a chime for hoops, a thud for crashes
    let ac = null, eng = null, engGain = null, snd = null, soundHeld = false;      // soundHeld: the notch is closed or the sound is off: nothing may make a noise
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
      // A burning wreck crackles: noise through a band-pass, flickered by updateSound.
      const fire = { f: filt('bandpass', 2300, 0.7), f2: filt('lowpass', 420, 0.7), g: gain(0), g2: gain(0) }; const fn = noiseSrc(); fn.connect(fire.f); fire.f.connect(fire.g); fire.g.connect(out); fn.connect(fire.f2); fire.f2.connect(fire.g2); fire.g2.connect(out);
      return { p, j, w, r, horn, clack, fire };
    }
    /// Silences everything for real. (Setting the master gain's value is not enough: the engine sounds keep gliding their level back
    /// up, so the gain's pending changes are cancelled first, and the audio itself is paused.)
    /// `kill` throws the audio engine away altogether (the notch was closed, or sound was switched off): nothing is left that
    /// could ever make a noise, and it is built again from scratch when sound is wanted again.
    function muteAudio(kill = false) {
      try { cancelSpeech(); } catch { /* none */ }
      if (!ac) return;
      const old = ac;
      try { if (engGain) { const t = old.currentTime; engGain.gain.cancelScheduledValues(t); engGain.gain.setValueAtTime(0, t); } if (!kill && old.suspend) old.suspend().catch(() => {}); } catch { /* no sound to mute */ }
      if (kill) { ac = null; engGain = null; snd = null; sndT = -1; try { old.close && old.close().catch(() => {}); } catch { /* already closed */ } }
    }
    function unmuteAudio() {
      if (!sound || soundHeld) return;
      if (!ac) { audio(); return; }
      try { if (engGain) { const t = ac.currentTime; engGain.gain.cancelScheduledValues(t); engGain.gain.setValueAtTime(1, t); } ac.resume && ac.resume(); } catch { /* no sound */ }
    }
    function audio() {
      if (!sound || soundHeld) return null;
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
      const run = flight.engRun ? (flight.damage.power < 1 ? (Math.random() < 0.15 ? 0.2 : 1) : 1) : 0;
      if (plane.engine === 'jet' || plane.engine === 'turboprop' || plane.engine === 'turboshaft') {
        // The fans spool up and down slowly (a turboprop's gauge is torque, its propeller follows the same spool).
        const target = run ? plane.n1Idle + (100 - plane.n1Idle) * flight.throttle * (flight.damage.power) : clamp(flight.speed * 0.08, 0, 12);
        engState.n1 += (target - engState.n1) * (1 - Math.exp(-dt * (target > engState.n1 ? 0.8 : 0.5)));
        engState.level = engState.n1 / 100;
        if (plane.engine === 'turboprop' || plane.engine === 'turboshaft') engState.rpm = plane.rpmIdle + (plane.rpmMax - plane.rpmIdle) * clamp(engState.n1 / 100, 0, 1);
      } else {
        const target = run ? plane.rpmIdle + (plane.rpmMax - plane.rpmIdle) * flight.throttle : clamp(flight.speed * 14, 0, 900);
        engState.rpm += (target - engState.rpm) * (1 - Math.exp(-dt * 6));
        engState.level = engState.rpm / plane.rpmMax;
      }
    }
    /// Sets the level of every looping sound from the engine, speed, ground contact and warnings.
    let sndT = -1;
    function updateSound() {
      if (!snd || !ac || !sound) return;
      const t = ac.currentTime;
      if (t - sndT < 0.03 && t >= sndT) return;      // the levels glide over ~80 ms, so 30 updates a second is plenty
      sndT = t;
      const set = (param, v, tc = 0.08) => param.setTargetAtTime(v, t, tc);
      // After the biggest impact everything goes quiet for a moment, then comes back.
      set(engGain.gain, duckT > 0 ? 0.12 : 1, duckT > 0 ? 0.03 : 0.9);
      if (flight.crashed) {
        // A wreck: the wind falls silent, the engine winds down (a jet's whine drops in pitch and fades), and what is left is
        // the hull grinding along, metal on the ground, and the crackle of the fire.
        for (const g of [snd.p.out.gain, snd.p.crackleGain.gain, snd.j.roarGain.gain, snd.j.rumbleGain.gain, snd.w.g.gain]) set(g, 0, 0.12);
        const spool = Math.exp(-flight.wreckT / 2.2), jetLike = plane.engine === 'jet' || plane.engine === 'turboprop' || plane.engine === 'turboshaft';
        set(snd.j.whine.gain, jetLike && flight.wreckT < 7 ? 0.012 * spool : 0, 0.3);
        set(snd.j.w1.frequency, 500 + 2500 * spool, 0.4); set(snd.j.w2.frequency, 500 + 2500 * spool + 20, 0.4);
        set(snd.horn.g.gain, 0, 0.01); set(snd.clack.g.gain, 0, 0.01);
        const sl = flight.rest ? 0 : clamp(flight.speed / 18, 0, 1), on = flight.wreckTouch > 0 && flight.wet === 0 ? 1 : 0;
        set(snd.r.g.gain, 0.16 * sl * on, 0.1); set(snd.r.sg.gain, 0.17 * flight.scrapeI * sl + 0.05 * sl * on, 0.05);
        set(snd.r.f.frequency, 120 + 140 * sl); set(snd.r.scrape.frequency, 1200 + 900 * sl);
        const burning = wreckFire && fireT > -60 ? clamp((fireT + 60) / 60, 0, 1) * (fireT > 0 ? 1 : 0.35) : 0, fl = 0.5 + Math.random();
        set(snd.fire.g.gain, 0.05 * burning * fl * Math.min(1.4, fireK), 0.05); set(snd.fire.g2.gain, 0.035 * burning * (0.7 + 0.6 * Math.random()), 0.1);
        return;
      }
      const V = flight.ias, run = flight.engRun ? 1 : 0, thr = flight.throttle, fast = clamp(V / plane.max, 0, 1.3);
      // A turboprop is both: the propeller's beat plus a turbine's whine and a quieter roar.
      const turbo = plane.engine === 'turboprop' || plane.engine === 'turboshaft', piston = plane.engine !== 'jet', jet = plane.engine === 'jet' || turbo;
      const burner = plane.ab && thr > 0.9 && run ? 1.7 : 1;      // an afterburner roars
      // Piston.
      const f0 = Math.max(24, (engState.rpm / 60) * (plane.cyl || 4) / 2);
      set(snd.p.o1.frequency, f0); set(snd.p.o2.frequency, f0 * 1.006); set(snd.p.o3.frequency, f0 / 2);
      set(snd.p.lp.frequency, 450 + engState.level * 1500 + (flight.onGround ? 0 : 200));
      set(snd.p.lfo.frequency, (engState.rpm / 60) * 2); set(snd.p.lfoDepth.gain, 0.25 + 0.2 * (1 - thr));
      set(snd.p.out.gain, piston ? (0.03 + engState.level * 0.075) * (run ? 1 : 0.15) * (turbo ? 0.55 : 1) : 0, 0.06);
      set(snd.p.crackleGain.gain, piston && run && thr < 0.3 ? 0.012 : 0, 0.1);
      // Jet.
      const n = clamp(engState.n1 / 100, 0, 1), many = 1 + 0.12 * ((plane.engines || 2) - 1);
      set(snd.j.roar.frequency, 450 + n * 2300); set(snd.j.roar.Q, 0.5 + n * 0.4);
      set(snd.j.roarGain.gain, jet ? (0.015 + 0.2 * Math.pow(n, 1.6)) * many * (turbo ? 0.35 : 1) * burner : 0, 0.15);
      set(snd.j.rumbleGain.gain, jet ? (0.04 + 0.16 * n) * many * (turbo ? 0.4 : 1) * burner : 0, 0.2);
      set(snd.j.w1.frequency, 1800 + n * 3400); set(snd.j.w2.frequency, 1800 + n * 3400 + 25 + (plane.engines || 2) * 8);
      set(snd.j.whine.gain, jet ? (0.003 + 0.011 * n * n) * (turbo ? 2.4 : 1) : 0, 0.2);
      // Wind and the wheels.
      // Wind noise grows with the speed, and a stalling wing adds a buffeting rumble to it.
      set(snd.w.f.frequency, 300 + V * 9 - flight.buffet * 120); set(snd.w.g.gain, Math.pow(fast, 1.6) * 0.12 + (flight.damage.L && flight.damage.R ? 0 : 0.04 * fast) + flight.buffet * 0.05, 0.15);
      const gsp = flight.speed, rolling = flight.onGround ? clamp(gsp / 40, 0, 1) : 0, rumble = 0.6 + 6 * (flight.surface ? flight.surface.roll : 0.02);   // rougher ground rumbles more
      set(snd.r.g.gain, flight.damage.gear && flight.damage.nose ? Math.min(0.2, rolling * 0.07 * rumble) : 0.04 * rolling, 0.1);
      set(snd.r.sg.gain, Math.max(flight.scrapeI * 0.12 * clamp(gsp / 15, 0, 1), flight.damage.tail < 1 && tailScrapeT > 0 ? 0.08 : 0), 0.05);
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
      if (soundHeld || !sound) return;
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
      const alt = flight.pos[1] - gearH(), g0 = groundAt(W, flight.pos[0], flight.pos[2]);
      for (const t of [3, 5, 7, 9, 11, 14]) {
        const x = flight.pos[0] + flight.vel[0] * t, z = flight.pos[2] + flight.vel[2] * t, gh = groundAt(W, x, z);
        if (gh - g0 > 12 && gh > alt - 30) return t;
      }
      return null;
    }
    function gpwsTick(dt) {
      if (gpwsT > 0) gpwsT -= dt;
      if (!gpwsKind(plane) || flight.crashed || !gpwsOn) { gpwsLastFt = null; return; }
      const alt = flight.pos[1] - gearH(), ft = (alt - groundAt(W, flight.pos[0], flight.pos[2])) * 3.281, sink = -flight.vel[1] * 196.85;
      const airborne = !flight.onGround, arcade = mode.id === 'hoops' || mode.id === 'trial';
      const [x, z] = [flight.pos[0], flight.pos[2]];
      const full = gpwsKind(plane) === true;      // an airliner calls everything; the fighter's voice only says "Pull up"
      // Take-off: a hundred knots, V1, rotate, positive rate.
      if (full && flight.onGround && flight.throttle > 0.6) {
        const sp = speedsOf(plane);
        if (!hundredCalled && flight.ias >= 51.4) { hundredCalled = true; say('One hundred knots', { every: 99 }); }
        if (!v1Called && flight.ias >= sp.vr * 0.96) { v1Called = true; say('V one', { every: 99 }); }
        if (!rotateCalled && flight.ias >= sp.vr) { rotateCalled = true; say('Rotate', { every: 99 }); chime(); }
      }
      if (full && airborne && !wasAirborne && flight.vel[1] > 1) say('Positive rate', { every: 99 });
      wasAirborne = airborne;
      if (airborne) {
        // Radio altimeter calls on the way down, with the gear down (the call-outs a crew hears on an approach).
        if (full && flight.gearDown) {
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
          const w = gpwsWarnings(s).filter((q) => full || q.text === 'Pull up')[0];
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
    let howOpen = false;
    function start() {
      write('howseen_' + mode.id, true); howOpen = false;
      if (mode.id === 'war') { plane = PLANES.find((p) => p.id === (warVeh === 'tank' || warVeh === 'soldier' ? 'f16' : warVeh === 'heli' ? 'ah64' : warVeh)) || PLANES[0]; useBattlefield(warField); }
      else { restorePlane(); useBattlefield(''); }
      flight = new Flight(plane); heliColl = 0;
      score = 0; elapsed = 0; streak = 0; hoopsMade = 0; result = null; paused = false; smoke.length = 0;
      mouse.engaged = false;   // move the cursor to the middle to take control
      debris.length = 0; attached = new Set(ALL_PARTS); goneGear.clear(); gouges.length = 0; slowT = 0; duckT = 0; bumpSlow = false; shakeKick = 0; fireK = 1; dirtD = 0; wreckT = 0; hadFailure = false; engineSmokeT = 0; wingLostAt = -1; canyonT = 0;
      wreckFire = false; fireT = 0; crashCam = null;
      // Random failures (Settings): mostly in Free Flight and Landing; "often" means every mode.
      const rate = failures === 'often' ? 1 / 75 : failures === 'rare' ? 1 / 360 : 0;
      const applies = failures === 'often' || mode.id === 'free' || mode.id === 'landing';
      failAt = rate && applies ? (mode.id === 'landing' ? 20 + Math.random() * 40 : -Math.log(Math.random()) / rate + 20) : Infinity;
      if (mode.id === 'landing' && failures === 'rare' && Math.random() > 0.25) failAt = Infinity;
      rollAcc = 0; loopAcc = 0; lowT = 0; stoppedT = 0; hadTakeoff = false; hadAir = false; stopCredited = false; hoverT = 0; cfgTakeoff = false; cfgLanding = false; svc = null; svcDone = {}; traffic = []; trafficT = 3; nearSeen = new Set(); traffic = []; trafficT = 6; nearSeen = new Set();
      hoops = []; nextHoop = 0; war = null;
      const homePad = HELIPADS[0], hoverTrim = plane.rotor ? 1.06 / plane.rotorLift : 0;
      const spot = startSpot();
      if (mode.id === 'free' && plane.rotor) flight.reset([spot.pad.x, groundAt(W, spot.pad.x, spot.pad.z) + gearH() + 0.05, spot.pad.z], 0, 0, true);   // a helicopter starts on its helipad
      else if (mode.id === 'free') flight.reset([spot.pos[0], groundAt(W, spot.pos[0], spot.pos[2]) + gearH(), spot.pos[2]], 0, 0, true);
      else if (mode.id === 'landing' && plane.rotor) {
        // On approach to the helipad: 300 m out and 70 m up, flying slowly towards it.
        flight.reset([homePad.x, groundAt(W, homePad.x, homePad.z) + 70, homePad.z + 300], 0, 14, false);
        flight.throttle = hoverTrim; heliColl = hoverTrim;
      } else if (mode.id === 'landing') {
        const dist = 1600 + Math.random() * 400, side = (Math.random() - 0.5) * 120;
        // On the extended centre line behind the threshold, a 3–4° glide slope, at approach speed.
        flight.reset([side, dist * Math.tan(3.5 * DEG) + 4, dist], 0, plane.stall * 1.35, false);
        flight.throttle = 0.3; flight.flapNotch = Math.min(2, (plane.flapNotches || [0, 1]).length - 1); flight.flaps = (plane.flapNotches || [0, 1])[flight.flapNotch];
      } else {
        flight.reset([0, 160, -200], 0, plane.rotor ? 0 : plane.cruise, false);
        if (plane.rotor) { flight.throttle = hoverTrim; heliColl = hoverTrim; }   // a helicopter starts in a hover, not at 150 km/h
        if (mode.id === 'hoops') {
          timeLeft = 90; hoopRand = rng(Date.now() & 0xffff);
          let from = [0, 160, -200], dir = [0, 0, -1];
          for (let i = 0; i < 4; i++) { const h = spawnHoop(from, dir, hoopRand); hoops.push(h); dir = sub(h.pos, from); from = h.pos; }
        } else if (mode.id === 'war') warStart();
        else hoops = trialCourse();
      }
      const flown = new Set(read('flown', [])); flown.add(plane.id); write('flown', [...flown]);
      if (flown.size >= PLANES.length) achieve('all');
      camPos = add(flight.pos, [0, 12, 40]);
      rotateCalled = false; hundredCalled = false; v1Called = false; wasAirborne = false; gpwsLastFt = null; gpwsAt = {}; gpwsText = ''; gpwsT = 0; cancelSpeech(); lowFuelWarned = false; tailScrapeT = 0; const up = flight.throttle;
      engState.rpm = plane.engine === 'jet' ? 0 : plane.rpmIdle + (plane.rpmMax - plane.rpmIdle) * up;
      engState.n1 = plane.engine === 'jet' || plane.engine === 'turboprop' || plane.engine === 'turboshaft' ? plane.n1Idle + (100 - plane.n1Idle) * up : 0;
      screen = 'fly'; renderUI(); root.focus();
      { const seen = read(`ctlseen.${mode.id}`, 0); write(`ctlseen.${mode.id}`, seen + 1); if (seen < 3) showCtl(true, 18); else { showCtl(false); toast('Press ? for the controls', 2200); } }
      if (shareOn) { remote = []; skyT = 0; toast('Fly with others is on: your callsign, aircraft and position are shared', 2600); }
      atc = { cs: `Notch ${100 + Math.floor(Math.random() * 899)}`, said: new Set() }; atcText = ''; atcT = 0; showCheck = true;
      if (coldStart && !plane.rotor && flight.onGround) { flight.engOff = true; flight.throttle = 0; flight.battery = false; flight.beaconSw = false; toast('Clean start: battery (Y), beacon (O), then the engine (I). The checklist on the left walks you through it', 4200); }
      if (audio()?.state === 'suspended') ac.resume();
      unmuteAudio();
    }

    function finish(kind, value, label, report = null) {
      praceEnd(kind, value);
      screen = 'result';
      result = { kind, value, label, best: false, rank: 0, report };
      muteAudio();
      cancelSpeech();
      const board = read(`board.${mode.id}`, []);
      const qualifies = value != null && (board.length < 10 || (mode.better === 'high' ? value > board[board.length - 1].score : value < board[board.length - 1].score));
      result.qualifies = qualifies && mode.id !== 'free' && (mode.id === 'trial' || value > 0);
      renderUI();
    }

    // A test page can set window.NotchPlaneDebug = {} before mounting to end a run with a chosen result.
    if (window.NotchPlaneDebug) window.NotchPlaneDebug.finish = (kind, value, label) => finish(kind, value, label);
    if (window.NotchPlaneDebug) window.NotchPlaneDebug.state = () => ({ pos: flight.pos, region: regionId, colliders: W.colliders.filter((c) => c.kind === 'landmark').length });
    if (window.NotchPlaneDebug) window.NotchPlaneDebug.tp = (pos, heading = 0, speed = 60) => { flight.reset(pos, heading, speed, false); };
    function saveScore() {
      const name = (ui.querySelector('input')?.value || playerName || 'Pilot').trim().slice(0, 16) || 'Pilot';
      playerName = name; write('name', name);
      const board = read(`board.${mode.id}`, []);
      board.push({ name, plane: plane.name, score: result.value, date: new Date().toISOString().slice(0, 10) });
      board.sort((a, b) => (mode.better === 'high' ? b.score - a.score : a.score - b.score));
      write(`board.${mode.id}`, board.slice(0, 10));
      result.rank = board.findIndex((e) => e.name === name && e.score === result.value) + 1;
      result.qualifies = false; result.saved = true;
      const wantWorld = ui.querySelector('#pg-world')?.checked ?? shareWorld;
      shareWorld = wantWorld; write('shareWorld', wantWorld);
      renderUI();
      if (wantWorld) postToWorld(name);
    }
    /// Posts this result to the world board (name, plane and score only) and shows where it came.
    async function postToWorld(name) {
      if (!result || result.posted || result.value == null || mode.id === 'free') return;
      result.posted = 'sending'; renderUI();
      const r = await postWorld(mode.id, name, result.value);
      result.posted = r.ok ? 'done' : 'failed'; result.worldRank = r.rank; result.worldError = r.error;
      if (screen === 'result') renderUI();
    }

    // ---- input
    const onKey = (e, down) => {
      if (!root.isConnected) return;
      const k = e.key.length === 1 ? e.key.toLowerCase() : e.key;
      if (chatOpen && !e.target) { chatKey(k, down); return; }
      if (down && e.repeat && keys.has(k)) { if (screen === 'fly') e.preventDefault?.(); return; }   // held keys repeat: toggles fire once
      const typing = e.target && e.target.tagName === 'INPUT' && e.target.type !== 'range';
      if (typing) { if (down && k === 'Enter' && result?.qualifies) saveScore(); return; }
      const game = ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', ' ', 'w', 's', 'a', 'd', 'q', 'e', 'f', 'v', 'b', 'c', 'p', 'r', 'x', 'Shift', 'Control', 'g', 'h', 'i', 't', 'y', 'o', 'j', 'k', ',', '.', '[', ']', 'Enter', 'z', 'n', 'l', 'u', '?', '/', 'F11'];
      if (game.includes(k) && screen === 'fly') e.preventDefault?.();
      if (down) {
        if (k === 'F11') { toggleFullscreen(); return; }
        if (screen === 'fly') {
          if (war && war.mapOpen && (k === 'Enter' || k === ' ')) { warConfirmDrop(); e.preventDefault?.(); return; }
          if (k === 'u' && war && war.net) toggleVote();
          if (k === 'p' && (!(war && war.net) || paused)) { paused = !paused; renderUI(); if (!paused) { unmuteAudio(); } }
          if (k === '?') showCtl(ctlEl.style.display === 'none');
          if (mode.id === 'war') { if (k === 'n') warLaunch(); else if (k === 'l') warFlares(); else if (k === 't') warToggleLock(); else if (k === '/') openChat(); else if (k === 'e') warHeliExitEnter(); else if (k === '1' && war && war.foot) warSwitchWeapon('rifle'); else if (k === '2' && war && war.foot) warSwitchWeapon('rpg'); else if (k === 'z') warScope(); else if (k === 'r') warReload(); else if (k === 'g') { if (war && war.foot) warGrenade(); else warLaunchGuided(); } if ((k === 'b' || k === 'z') && war && war.vehicle === 'plane' && !war.dead) war.bombPend = true; }
          if (k === 'c') camMode = (camMode + 1) % 3;
          if (k === 'g' && !(mode.id === 'war' && war)) {
            const r = flight.toggleGear();
            if (r === 'up' || r === 'down') { toast(r === 'down' ? 'Gear down' : 'Gear up', 1100); noise(1.1, 0.12, 280); }
            else toast(r === 'fixed' ? `The ${plane.name} has fixed wheels: no gear to raise` : r === 'broken' ? 'The undercarriage is broken' : 'Gear can only be raised in the air', 1500);
          }
          if (k === 'y' && mode.id === 'war') warThermal();
          else if (k === 'y') { flight.battery = !flight.battery; toast(flight.battery ? 'Battery on' : 'Battery off: the lights go out and the engine cannot be started', 1600); noise(0.4, 0.1, 500); }
          if (k === 'o') { flight.beaconSw = !flight.beaconSw; toast(flight.beaconSw ? 'Beacon on' : 'Beacon off', 1000); noise(0.3, 0.1, 700); }
          if (k === 'i') {
            const r2 = flight.engineStart();
            if (r2 === 'ok') { toast('Starter running…', 2200); beep(300, 0.5, 'sawtooth', 0.06); }
            else if (r2 === 'running') toast('The engine is already running', 1200);
            else if (r2 === 'busy') toast('Starter running…', 900);
            else if (r2 === 'throttle') toast('Pull the throttle back to idle first (S)', 1600);
            else if (r2 === 'battery') toast('Switch the battery on first (Y)', 1600);
            else toast('Engines are started on the ground', 1400);
          }
          if (k === 't' && mode.id !== 'war') { showCheck = !showCheck; toast(showCheck ? 'Checklist on' : 'Checklist off', 900); }
          if (k === 'j' && mode.id === 'war') { if (war && war.foot) warHeal('shield'); else warEject(); }
          if (k === 'j' && mode.id !== 'war') {
            if (plane.rotor) toast('The approach mode is for fixed-wing aircraft', 1500);
            else {
              const ils = flight.apApproach(W);
              if (ils) toast(`ILS ${ils.rwy.name}: autopilot flying the approach. Gear and flaps are yours; it hands over at 45 m`, 2800);
              else toast('No ILS signal: line up with a runway, within 30 km and about 17° of its course', 2200);
            }
          }
          if (k === 'k' && mode.id === 'war' && war && war.foot) warHeal('medkit');
          else if (k === 'k') {
            if (plane.rotor) toast('The autopilot is for fixed-wing aircraft', 1500);
            else if (flight.ap && flight.ap.on) { flight.apOff(); toast('Autopilot off: you have the controls', 1500); }
            else if (flight.apEngage()) toast('Autopilot on: holding heading, altitude and speed', 1800);
            else toast('The autopilot needs you in the air', 1400);
          }
          if (flight.ap && flight.ap.on && (k === ',' || k === '.')) flight.ap.hdg += (k === '.' ? 1 : -1) * 5 * DEG;
          if (flight.ap && flight.ap.on && (k === '[' || k === ']')) flight.ap.alt = Math.max(60, flight.ap.alt + (k === ']' ? 1 : -1) * 50);
          if (k === 'q' && war && war.vehicle === 'plane' && flight.arcade) {
            const dir = (keys.has('d') || keys.has('arrowright')) ? 1 : (keys.has('a') || keys.has('arrowleft')) ? -1 : (flight.arc && flight.arc.sx < 0 ? -1 : 1);
            if (flight.quickTurn(dir)) toast('↩ QUICK TURN', 900); else toast('Quick turn recharging', 700);
          }
          if (k === 'h' && mode.id === 'war' && war && war.foot) warHeal('bandage');
          else if (k === 'h') {
            if (!plane.rotor) toast('Emergency landing is for helicopters', 1400);
            else if (flight.emergency) { flight.emergencyOff(); toast('Emergency landing cancelled: you have the controls', 1600); }
            else if (flight.emergencyOn()) { toast('🚨 EMERGENCY LANDING: levelling and descending. H to cancel', 2400); beep(880, 0.18, 'square', 0.08); }
            else toast('Emergency landing needs the helicopter in the air', 1400);
          }
          if (k === 'f' || k === 'v') {
            const n = plane.flapNotches || [0, 1], to = k === 'f' && flight.flapNotch >= n.length - 1 ? 0 : clamp(flight.flapNotch + (k === 'f' ? 1 : -1), 0, n.length - 1);   // F again after the last notch brings the flaps back up
            if (to !== flight.flapNotch) {
              flight.flapNotch = to; flight.flaps = n[to];
              toast(`Flaps ${(plane.flapLabels || ['UP', 'DOWN'])[to]}`, 900); noise(0.5, 0.12, 700);
              if (to > 0 && flight.ias > speedsOf(plane).vfe * 1.05) toast('⚠ FLAPS OVERSPEED', 1600);
            }
          }
          if ('1234'.includes(k) && k.length === 1 && mode.id !== 'war') {
            const id = +k, ok = flight.onGround && flight.speed < 0.8 && flight.throttle < 0.12 && onApron(flight.pos);
            if (!ok) toast('Ground crew: stop on an apron with the throttle closed (parking brake: Space)', 2200);
            else if (svc) toast('Ground crew: one job at a time', 1400);
            else if (id === 4 && plane.rotor) toast('Helicopters are not pushed back: just lift off', 1800);
            else if (svcDone[id] && id !== 4) toast('Already done', 1200);
            else { svc = { id, t: 0, dur: ({ 1: 9, 2: 8, 3: 7, 4: 14 })[id] }; toast(({ 1: '⛽ Fuel truck connected…', 2: '🍽 Catering truck at the door…', 3: '🧳 Loading baggage…', 4: '🚜 Tug attached: pushing back…' })[id], 1600); }
          }
          if (k === 'r') { if (mode.id !== 'war' || !war) onStartPress('restart'); else if (!(war.foot && !war.dead)) warQuickRespawn(); }
          if (k === 'x' && war) warSelfDestruct();
          if (k === 'm') { mouseOn = !mouseOn; write('mouse', mouseOn); toast(mouseOn ? 'Mouse steering on' : 'Mouse steering off: use the keys', 1400); }
        } else if (screen === 'result' && (k === 'r' || k === ' ')) { e.preventDefault?.(); onStartPress('again'); }
        else if (screen === 'menu' && k === 'Enter') onStartPress('start');
        keys.add(k);
      } else keys.delete(k);
    };
    const kd = (e) => onKey(e, true), ku = (e) => onKey(e, false);
    window.addEventListener('keydown', kd); window.addEventListener('keyup', ku);
    // Forget held keys whenever the game loses the keyboard: a key released while focus was elsewhere never sends
    // its key-up here, and would otherwise stay "held" (a plane that keeps rolling by itself).
    const blur = () => keys.clear(); window.addEventListener('blur', blur);
    root.addEventListener('focusout', (e) => { if (!root.contains(e.relatedTarget)) keys.clear(); });
    // Hidden (the window or notch closed): let go of the keys and pause the flight, so nothing happens while nobody is looking.
    const hidden = () => { if (document.hidden) { muteAudio(true); keys.clear(); warPad.gun = false; warPad.bomb = false; if (screen === 'fly' && !paused && !(war && war.net)) { paused = true; renderUI(); } } else if (screen === 'fly' && !paused && !soundHeld) unmuteAudio(); }; document.addEventListener('visibilitychange', hidden);
    // The mouse steers by where the cursor is inside a small ring in the middle of the view: the ring's edge is full
    // stick, so a short move is enough and the cursor never has to leave the notch. It only takes control once the
    // cursor has been in the middle (a cursor left anywhere after clicking Take off can't bank the plane), and lets
    // go when the cursor leaves the game.
    const ringRadius = () => { const r = root.getBoundingClientRect(); return Math.max(40, Math.min(r.width, r.height) * (flight.arcade ? 0.14 : 0.2)) / clamp(sens, 0.3, 2.5); };
    root.addEventListener('pointermove', (e) => {
      if (e.target && e.target.closest && e.target.closest('.pg-wbar, .pg-ctlbtn, .pg-ctlcard, .pg-netbar')) { mouse.x = 0; mouse.y = 0; mouse.engaged = false; return; }   // over a button: let go of the stick
      const r = root.getBoundingClientRect(), R = ringRadius();
      mouse.px = e.clientX - r.left - r.width / 2; mouse.py = e.clientY - r.top - r.height / 2; mouse.w = r.width; mouse.h = r.height;
      const dx = (e.clientX - r.left - r.width / 2) / R, dy = (e.clientY - r.top - r.height / 2) / R;
      const d = Math.hypot(dx, dy), k = d > 1 ? 1 / d : 1;
      mouse.x = dx * k; mouse.y = dy * k; mouse.in = true;
      if (d < 0.3) mouse.engaged = true;
    });
    root.addEventListener('pointerleave', () => { mouse.x = 0; mouse.y = 0; mouse.in = false; mouse.engaged = false; });
    root.addEventListener('mousedown', (e) => { if (document.activeElement?.tagName !== 'INPUT') root.focus(); if (mode.id === 'war' && screen === 'fly' && e.button === 0) warPad.gun = true; if (mode.id === 'war' && screen === 'fly' && e.button === 2) warScope(); });
    root.addEventListener('contextmenu', (e) => { if (mode.id === 'war' && war && war.foot) e.preventDefault(); });
    const warPadUp = () => { warPad.gun = false; }; window.addEventListener('mouseup', warPadUp); window.addEventListener('blur', warPadUp);

    // A small dead zone in the middle keeps the plane steady, and the curve is gentle near the centre so small moves
    // are fine adjustments. Up climbs (cursor up or ↑) unless Invert is on. The arrow keys always work too.
    const stick = (v) => {
      const dead = 0.1, a = Math.abs(v);
      if (a < dead) return 0;
      return Math.sign(v) * Math.min(1, Math.pow((a - dead) / (1 - dead), 1.3));
    };
    /// The helicopter's collective lever: W raises it, S lowers it, and it stays where you leave it.
    /// How high the aircraft's centre sits when its wheels are on the ground (the model's size is part of it).
    const gearH = () => plane.gear * (plane.scale || 1);
    let heliColl = 0;
    let trafficOn = read('traffic', true), traffic = [], trafficT = 3, nearSeen = new Set();   // AI aircraft crossing the sky
    let startAt = read('startAt', 'auto');   // where a free flight begins: 'home' or an airfield id
    // (no apron or gate start: every flight begins on a runway)
    const startSpot = () => STARTS.find((x) => !x.gate && x.id === (startAt === 'auto' || startAt === 'gate' ? 'home' : startAt)) || STARTS[0];
    function input() {
      const has = (k) => keys.has(k);
      const m = mouseOn && mouse.in && mouse.engaged;
      let pitch = clamp((has('ArrowUp') ? 1 : 0) - (has('ArrowDown') ? 1 : 0) - (m ? stick(mouse.y) : 0), -1, 1);
      if (invert) pitch = -pitch;
      // A helicopter's cyclic: up (or forward) tilts the nose DOWN and flies forward, the opposite of an aeroplane's elevator.
      if (plane.rotor) pitch = -pitch;
      return {
        collective: plane.rotor ? heliColl : undefined,
        pitch,
        roll: clamp((has('ArrowRight') ? 1 : 0) - (has('ArrowLeft') ? 1 : 0) + (m ? stick(mouse.x) : 0), -1, 1),
        yaw: (has('d') || has('e') ? 1 : 0) - (has('a') || has('q') ? 1 : 0),
        throttle: (has('w') || has('Shift') ? 1 : 0) - (has('s') || has('Control') ? 1 : 0),
        boost: has('Shift'),
        reverse: has('x'),
      };
    }

    // ---- per-frame game rules
    // ---- particles: fire, smoke, engine smoke, dust, sparks and spray
    const PUFF = {
      fire: { life: [0.6, 1.4], size: [2, 5], col: (k) => [1, 0.55 - k * 0.4, 0.1], glow: 0.7, rise: 6, grav: 0, a: 0.85 },
      smoke: { drift: 1, life: [3, 6], size: [3, 14], col: (k) => [0.3 + k * 0.35, 0.3 + k * 0.35, 0.31 + k * 0.35], glow: 0, rise: 4, grav: 0, a: 0.55 },
      dark: { life: [0.8, 1.4], size: [0.7, 2.6], col: (k) => [0.1 + k * 0.35, 0.1 + k * 0.35, 0.11 + k * 0.35], glow: 0, rise: 1, grav: 0, a: 0.6 },
      tsmoke: { life: [0.9, 1.9], size: [0.5, 2.8], col: (k) => [0.86 - k * 0.1, 0.86 - k * 0.1, 0.88 - k * 0.1], glow: 0.15, rise: 0.7, grav: 0, a: 0.5 },
      haze: { life: [0.6, 1.1], size: [0.5, 1.8], col: () => [0.75, 0.75, 0.75], glow: 0.2, rise: 0.5, grav: 0, a: 0.35 },
      dust: { life: [1, 2.5], size: [2, 7], col: () => [0.55, 0.45, 0.32], glow: 0, rise: 1, grav: 0, a: 0.5 },
      spark: { life: [0.3, 0.8], size: [0.3, 0.1], col: () => [1, 0.85, 0.3], glow: 1, rise: 0, grav: 9.8 },
      spray: { life: [0.8, 1.6], size: [1.5, 3], col: () => [0.85, 0.92, 1], glow: 0.3, rise: 0, grav: 9.8, a: 0.7 },
      // A burning wreck's long black column, foam and bubbles where a wreck is in the water, and torn-up leaves.
      soot: { drift: 1, life: [5, 9], size: [4, 22], col: (k) => [0.05 + k * 0.14, 0.05 + k * 0.14, 0.055 + k * 0.14], glow: 0, rise: 7, grav: 0, a: 0.72 },
      foam: { life: [2, 4], size: [0.8, 2.6], col: () => [0.92, 0.96, 1], glow: 0.3, rise: 0, grav: 0, a: 0.45 },
      bubble: { life: [1.5, 3], size: [0.3, 0.8], col: () => [0.85, 0.95, 1], glow: 0.5, rise: 2.5, grav: 0, a: 0.5 },
      dirt: { life: [0.8, 1.7], size: [0.3, 0.8], col: () => [0.3, 0.22, 0.13], glow: 0, rise: 0, grav: 9.8, a: 1 },
      gfire: { life: [3, 8], size: [1.4, 3.4], col: (k) => [1, 0.5 - k * 0.3, 0.08], glow: 0.7, rise: 0.8, grav: 0, a: 0.85 },
      leaf: { life: [1, 2], size: [0.5, 1.5], col: () => [0.25, 0.5, 0.18], glow: 0, rise: 0, grav: 4, a: 0.9 },
    };
    function puff(kind, p, v = v3()) {
      if (smoke.length > 480) { if (kind === 'dust' || kind === 'haze' || kind === 'tsmoke' || kind === 'dirt' || kind === 'foam') return; smoke.shift(); }
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
    const HULL_FUEL = new Set(['L', 'Lo', 'R', 'Ro']);          // (the tanks are in the wings)
    /// Velocity of a point of the (still flying or sliding) hull, in the world: its motion plus the spin about the centre.
    function hullVelAt(p) {
      const w = qrot(flight.q, flight.w), r = sub(p, flight.pos);
      return add(flight.vel, cross(w, r));
    }
    const FLOAT = { L: 0.8, Lo: 0.8, R: 0.8, Ro: 0.8, N: 0.45, F: 0.5, T: 0.6, E0: 0.12, E1: 0.12, E2: 0.12, E3: 0.12, P: 0.05, G: 0 };
    const gouges = [], goneGear = new Set();    // dark scars along the slide path, and the legs that have come off
    let slowT = 0, duckT = 0, dirtD = 0, shakeKick = 0, fireK = 1;
    /// The sections named break off together and fly on as one rigid piece: a box with its own spin, ground contact and rest.
    /// `push` is added to the hull's own velocity at that spot. (`P` is the propeller, others are the body's sections.)
    function detachGroup(keys, push = v3(), spin = 3, o = {}) {
      const pm = planeMeshes[plane.id], sc = plane.scale, items = [];
      for (const k of keys) {
        if (!attached.has(k)) continue;
        attached.delete(k);
        if (k === 'P') { if (pm.prop) items.push({ k, mesh: pm.prop, c: pm.propAt, lo: pm.propBox ? pm.propBox[0] : [-1, -1, -0.2], hi: pm.propBox ? pm.propBox[1] : [1, 1, 0.2] }); }
        else if (pm.parts[k]) items.push({ k, mesh: pm.parts[k].mesh, c: pm.parts[k].center, lo: pm.parts[k].lo, hi: pm.parts[k].hi });
      }
      return makePiece(items, push, spin, o);
    }
    function makePiece(items, push, spin, o = {}) {
      if (!items.length) return null;
      const sc = plane.scale, lo = [1e9, 1e9, 1e9], hi = [-1e9, -1e9, -1e9];
      for (const it of items) for (let a = 0; a < 3; a++) { lo[a] = Math.min(lo[a], it.c[a] + it.lo[a]); hi[a] = Math.max(hi[a], it.c[a] + it.hi[a]); }
      const gc = [(lo[0] + hi[0]) / 2, (lo[1] + hi[1]) / 2, (lo[2] + hi[2]) / 2];
      const he = [Math.max(0.12, (hi[0] - lo[0]) / 2 * sc), Math.max(0.1, (hi[1] - lo[1]) / 2 * sc), Math.max(0.12, (hi[2] - lo[2]) / 2 * sc)];
      const pos = add(flight.pos, qrot(flight.q, mul(gc, sc)));
      let fl = 0, fuel = false;
      for (const it of items) { fl = Math.max(fl, FLOAT[it.k] ?? 0.3); if (HULL_FUEL.has(it.k)) fuel = true; }
      // (a big thin wing lets go with a lot of spin, a heavy engine goes in a straight line)
      const vel = add(add(hullVelAt(pos), push), jitter(2)), w = add(qrot(flight.q, flight.w), jitter(spin * 2));
      let n = 0; for (const d of debris) if (d.pieces) n++;
      if (n > 26) { const j = debris.findIndex((d) => d.pieces && d.rest); if (j >= 0) debris.splice(j, 1); }
      const d = { pieces: items.map((it) => ({ mesh: it.mesh, off: mul(sub(it.c, gc), sc) })), pos, q: flight.q.slice(), vel, w, he, rad: len(he), float: fl, fuel, drag: 0.0012 + 0.004 / (1 + len(he)),
        rest: false, restT: 0, wetT: 0, fire: 0, scorch: 0, key: items[0].k };
      if (fuel && flight.ignited) { d.fire = 25 + Math.random() * 40; d.scorch = 1; }
      else if (flight.crashed && flight.ignited && o.near !== false) { d.fire = 4 + Math.random() * 10; d.scorch = 1; }
      debris.push(d);
      return d;
    }
    /// The landing gear legs (all of them, the main legs or the nose leg) break away.
    function detachGears(which, push = v3(), spin = 5) {
      const pm = planeMeshes[plane.id];
      pm.gears.forEach((g, i) => {
        if (goneGear.has(i) || (which === 'nose' && !g.nose) || (which === 'main' && g.nose) || !g.piece) return;
        if (plane.retract && flight.gearPos < 0.9) return;
        goneGear.add(i);
        makePiece([{ k: 'G', mesh: g.piece.mesh, c: g.piece.center, lo: g.piece.lo, hi: g.piece.hi }], add(push, [0, 2 + Math.random() * 3, 0]), spin, { near: false });
      });
    }
    /// The engines still hanging on one side (-1 left, +1 right), outermost first.
    function enginesOn(sgn) {
      const pm = planeMeshes[plane.id];
      return ['E0', 'E1', 'E2', 'E3'].filter((k) => attached.has(k) && pm.parts[k] && pm.parts[k].center[0] * sgn > 0).sort((a, b) => Math.abs(pm.parts[b].center[0]) - Math.abs(pm.parts[a].center[0]));
    }
    /// A part breaks off and flies on by itself (a single section; the propeller).
    function detach(k, push = v3(), spin = 3) { return detachGroup([k], push, spin); }
    /// A wing lets go: at the root (with its engines), at the engine pylon (the engine tears off and the wing snaps outboard
    /// of it) or out at the tip.
    function wingBreak(ev) {
      const { r } = flight.axes(), sgn = ev.side === 'L' ? -1 : 1, outer = ev.side + 'o', eng = enginesOn(sgn);
      const out = mul(r, sgn * (4 + Math.random() * 5)), up = [0, 3, 0];
      let brk = ev.brk;
      if ((brk === 'tip' || brk === 'pylon') && !attached.has(outer)) brk = 'root';
      if (brk === 'tip') detachGroup([outer], add(out, up), 5);
      else if (brk === 'pylon') {
        detachGroup([outer], add(out, up), 5);
        if (eng.length) detachGroup([eng[0]], add(mul(out, 0.4), [0, -1, 0]), 2);
      } else detachGroup([ev.side, outer, ...eng], add(out, up), 4);
    }
    const CRASH_TEXT = { ground: 'Flew into the ground', terrain: 'Hit the hillside', water: 'Ditched in the water', tree: 'Hit a tree',
      building: 'Flew into a building', bridge: 'Hit the bridge', turbine: 'Flew into a wind turbine', mast: 'Hit the radio mast',
      hangar: 'Hit a hangar', tower: 'Hit the control tower' };
    const WING_TEXT = { overspeed: 'Overspeed!', overg: 'Over-G!', ground: 'Wingtip hit the ground!', water: 'Wingtip in the water!',
      tree: 'Clipped a tree!', building: 'Clipped a building!', bridge: 'Clipped the bridge!', turbine: 'Hit a turbine blade!',
      mast: 'Hit the radio mast!', hangar: 'Clipped a hangar!', tower: 'Clipped the tower!', crash: 'Torn off in the crash!', midair: 'MID-AIR COLLISION!', war: 'Shot off!' };
    const CHUNK_COLS = [[0.92, 0.93, 0.95], [0.75, 0.78, 0.82], [0.35, 0.36, 0.4], [0.2, 0.25, 0.5], [0.75, 0.2, 0.15]];
    /// Small broken pieces of the airframe, thrown out over a wide area (they bounce a little and settle).
    function spawnChunks(n, speed, at, base) {
      const size = 0.5 + 0.5 * (plane.cam || 1);
      for (let i = 0; i < n; i++) {
        if (debris.length > 100) { const j = debris.findIndex((d) => d.chunk); if (j < 0) break; debris.splice(j, 1); }
        const a = Math.random() * 6.283, sp = speed * (0.2 + Math.random() * 0.8);
        debris.push({ mesh: smokeMesh, part: 'x', chunk: true, sc: (0.15 + Math.random() * 0.55) * size, col: CHUNK_COLS[(Math.random() * CHUNK_COLS.length) | 0],
          pos: add(at, jitter(3)), q: qnorm([Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5, Math.random() + 0.1]),
          vel: [Math.cos(a) * sp + base[0] * 0.25, sp * (0.25 + Math.random() * 0.7), Math.sin(a) * sp + base[2] * 0.25], w: jitter(14), rest: false, sink: 0, fire: 0 });
      }
    }
    /// Layered impact sound for an energy e (per kilogram): a low thud, a crunch of metal and, when it is big, a long tearing.
    function impactSound(e, tear = true) {
      const k = clamp(Math.sqrt(e) / 40, 0.05, 1.2);
      noise(0.5 + 1.2 * k, 0.18 + 0.32 * k, 90 + 60 * k);                                   // thud
      noise(0.18 + 0.4 * k, 0.12 + 0.28 * k, 1400 + 700 * (1 - k));                         // crunch
      if (tear && k > 0.25) { noise(0.5 + 0.9 * k, 0.1 + 0.2 * k, 2600); beep(55 + 30 * k, 0.7 * k + 0.2, 'sawtooth', 0.1 * k); }
      if (k > 0.6) setTimeout(() => noise(0.6, 0.12 * k, 900), 120 + Math.random() * 120);   // a second tearing wave
    }
    /// The fuel catches. How much burns follows the fuel that was left: a big ball of fire for a full tank, a smaller one for
    /// less; a late ignition starts as a "whoomph" and builds.
    function igniteFx(ev) {
      wreckFire = true; fireK = clamp(ev.size, 0.2, 2.6); fireT = 35 + 55 * clamp(fireK / 1.5, 0.3, 1);
      const at = flight.pos.slice(), v = flight.vel, big = fireK * (ev.late ? 0.7 : 1);
      for (let i = 0; i < 10 + 26 * big; i++) puff('fire', add(at, jitter(3 + 3 * big)), add(mul(v, 0.1), add(jitter(8 + 8 * big), [0, 2 + 3 * big, 0])));
      for (let i = 0; i < 6 + 10 * big; i++) puff('soot', add(at, jitter(5)), add(mul(v, 0.08), jitter(6)));
      noise(0.6 + 0.7 * big, 0.2 + 0.2 * big, 150); if (big > 0.8) noise(1.2 + big, 0.18, 90);
      shakeKick = Math.max(shakeKick, 0.4 * big);
      for (const d of debris) if (d.pieces && d.fuel) { d.fire = 25 + Math.random() * 40; d.scorch = 1; }
    }
    function explodeFx(ev) {
      const at = flight.pos.slice(), big = clamp(ev.size, 0.2, 1.4);
      for (let i = 0; i < 14 + 16 * big; i++) puff('fire', add(at, jitter(4)), add(jitter(14 * big + 4), [0, 4 + 5 * big, 0]));
      for (let i = 0; i < 6; i++) puff('soot', add(at, jitter(4)), add(jitter(6), [0, 6, 0]));
      noise(1.2, 0.35, 110); noise(0.5, 0.25, 700); duckT = Math.max(duckT, 0.8); shakeKick = Math.max(shakeKick, 0.6 * big);
      spawnChunks(8, 16, at, flight.vel);
    }
    /// The impact: what it looks and sounds like depends on how hard (info.sev 0 to 3, info.E) and what it hit. Fire,
    /// separating sections and the camera's slow-motion beat come from the events that go with it.
    function crashEffects(ev) {
      const info = ev.info || { sev: 2, E: 200 }, sev = info.sev, at = flight.pos.slice(), v = flight.impactVel, why = ev.why, E = info.E || 100;
      if (sev >= 1 && attached.has('P')) detach('P', add(jitter(8), [0, 3, 0]), 8);
      if (sev >= 1) detachGears('all', mul(v, 0.05), 6);
      if (why === 'water') {
        const n = 20 + sev * 22;
        for (let i = 0; i < n; i++) puff('spray', add(at, jitter(4)), add(mul(v, 0.12), [(Math.random() - 0.5) * (8 + sev * 6), 5 + Math.random() * (6 + sev * 5), (Math.random() - 0.5) * (8 + sev * 6)]));
        for (let i = 0; i < 10 + sev * 4; i++) puff('foam', [at[0] + (Math.random() - 0.5) * 8, WATER + 0.2, at[2] + (Math.random() - 0.5) * 8], jitter(2));
        noise(0.5 + sev * 0.3, 0.3 + sev * 0.07, 700 + sev * 150); if (sev >= 2) noise(1.4, 0.4, 160);
        if (sev >= 3) spawnChunks(14, 14, at, v);
      } else {
        impactSound(E);
        for (let i = 0; i < 8 + sev * 10; i++) puff('dust', add(at, jitter(5)), add(mul(v, 0.1), jitter(10 + sev * 3)));
        for (let i = 0; i < 12 + sev * 8; i++) puff('spark', at, add(mul(v, 0.25), [(Math.random() - 0.5) * 24, Math.random() * 16, (Math.random() - 0.5) * 24]));
        if (sev >= 1) for (let i = 0; i < 6 + sev * 6; i++) puff('dirt', at, add(mul(v, 0.15), [(Math.random() - 0.5) * 14, 3 + Math.random() * 9, (Math.random() - 0.5) * 14]));
        if (why === 'tree') for (let i = 0; i < 20; i++) puff('leaf', add(at, jitter(4)), jitter(12));
        if (sev >= 2) spawnChunks(sev >= 3 ? 36 : 16, 8 + sev * 7, at, v);
        else if (sev === 1) spawnChunks(6, 7, at, v);
      }
      // The biggest hits: everything else goes quiet for a moment (and a faint ringing), and time slows for a beat.
      if (sev >= 2) { duckT = 2.2; if (sev >= 3) beep(3100, 1.8, 'sine', 0.018); }
      if (E > 110 && !info.skip || E > 220) slowT = 1.2;
      shakeKick = Math.max(shakeKick, clamp(info.g / 18, 0.2, 1.6));
      crashCam = { a: Math.atan2(camPos[0] - at[0], camPos[2] - at[2]), r: Math.max(20, len(sub(camPos, at))), shake: 0.4 + 0.35 * sev, lt: null, kick: 0 };
    }
    /// A section tears away from the hull (nose, engine) in a crash.
    function severFx(ev) {
      const { f, r } = flight.axes();
      if (ev.part === 'N') {
        detachGroup(['N', 'P'], add(add(mul(f, 4), [0, 3, 0]), jitter(4)), 4);
        noise(0.9, 0.35, 2400); impactSound(160, false); toast('💥 The nose section tore off', 1800);
      } else if (ev.part === 'E') {
        const eng = enginesOn(ev.side);
        eng.forEach((k, i) => detachGroup([k], add(mul(r, ev.side * (3 + Math.random() * 4)), [0, 2 + Math.random() * 3, 0]), 2 + i));
        noise(0.7, 0.3, 1800); toast(`💥 ${ev.side < 0 ? 'Left' : 'Right'} engine${eng.length > 1 ? 's' : ''} torn off`, 1800);
      }
      const at = flight.pos;
      for (let i = 0; i < 12; i++) puff('spark', at, add(mul(flight.vel, 0.4), jitter(14)));
      for (let i = 0; i < 6; i++) puff('dust', at, jitter(8));
      shakeKick = Math.max(shakeKick, 0.45);
    }
    /// A burning or smouldering wreck, a wreck dragging along the ground and a wreck in the water, every frame (also on the
    /// result screen, so the smoke column stays).
    const GOUGE = { runway: [0.09, 0.09, 0.1], road: [0.1, 0.1, 0.11], grass: [0.2, 0.14, 0.08], forest: [0.16, 0.12, 0.07], sand: [0.5, 0.4, 0.26], snow: [0.5, 0.52, 0.55], rock: [0.2, 0.19, 0.19] };
    /// A scar in the ground under the sliding hull (darker, scorched on the runway).
    function addGouge(at, g0, k) {
      if (gouges.length > 140) gouges.shift();
      const sn = surfaceAt(W, at[0], at[2]), yaw = Math.atan2(flight.vel[0], -flight.vel[2]);
      const gc = GOUGE[sn] || GOUGE.grass, jt = (0.8 + Math.random() * 0.4) * k;
      gouges.push({ q: qaxis([0, 1, 0], -yaw + (Math.random() - 0.5) * 0.12), p: [at[0] + (Math.random() - 0.5) * 0.8, g0 + 0.12, at[2] + (Math.random() - 0.5) * 0.8], s: 1.5 * Math.pow(plane.cam || 1, 0.7) * (0.75 + Math.random() * 0.5), col: [gc[0] * jt, gc[1] * jt, gc[2] * jt] });
    }
    function wreckFx(dt) {
      if (!flight.crashed) return;
      const at = flight.pos, wv = flight.wv, windPush = [wv[0], wv[2]];
      const crowd = smoke.length > 400 ? 0.4 : 1;                // fewer puffs when the scene is already full
      if (wreckFire) {
        fireT -= dt;
        if (fireT > 0) {
          const k = Math.min(1, fireT / 25) * (0.4 + 0.6 * Math.min(1, fireK));
          if (Math.random() < dt * 14 * k * crowd) puff('fire', add(at, jitter(3 * (0.6 + fireK * 0.5))), [(Math.random() - 0.5) * 2, 3 + Math.random() * 4, (Math.random() - 0.5) * 2]);
          // The black column rises and leans with the wind.
          if (Math.random() < dt * 5 * (0.5 + fireK * 0.5) * crowd) puff('soot', add(at, [0, 1.5, 0]), [windPush[0] * 0.3, 6 + Math.random() * 3, windPush[1] * 0.3]);
        } else if (fireT > -90 && Math.random() < dt * 2.5 * crowd) puff('smoke', add(at, [0, 1, 0]), [windPush[0] * 0.2, 3 + Math.random() * 2, windPush[1] * 0.2]);
        // Fuel spilled along the way is burning on the ground behind: a trail of fire along the slide path.
        if (!flight.rest && flight.speed > 3 && flight.wreckTouch > 0 && flight.leak > 0.05 && fireT > 0 && Math.random() < dt * 12 * crowd) {
          const back = mul(norm(flight.vel), -3 * Math.random());
          puff('gfire', [at[0] + back[0] + (Math.random() - 0.5) * 3, groundAt(W, at[0] + back[0], at[2] + back[2]) + 0.3, at[2] + back[2] + (Math.random() - 0.5) * 3], jitter(0.6));
        }
      }
      if (flight.scrapeI > 0.1 && !flight.rest) {
        const sp = flight.scrapePos, k = flight.scrapeI;
        if (Math.random() < dt * 70 * k * crowd) puff('spark', sp, add(mul(flight.vel, 0.3), [(Math.random() - 0.5) * 6, 2 + Math.random() * 4, (Math.random() - 0.5) * 6]));
        if (Math.random() < dt * 25 * k * crowd) puff('dust', sp, add(mul(flight.vel, 0.15), jitter(3)));
      }
      // Sliding along the ground: clods of dirt thrown up, dust, and a gouge scored into the surface behind.
      if (!flight.rest && flight.wet === 0 && flight.wreckTouch > 0 && flight.speed > 3) {
        const sp = flight.speed, g0 = groundAt(W, at[0], at[2]);
        if (Math.random() < dt * (6 + sp * 0.7) * crowd) puff('dirt', [at[0] + (Math.random() - 0.5) * 3, g0 + 0.2, at[2] + (Math.random() - 0.5) * 3], add(mul(flight.vel, 0.3), [(Math.random() - 0.5) * 6, 2 + Math.random() * 5, (Math.random() - 0.5) * 6]));
        if (Math.random() < dt * 8 * crowd) puff('dust', [at[0], g0 + 0.3, at[2]], add(mul(flight.vel, 0.12), jitter(2)));
        dirtD += sp * dt;
        const step = 2.4 * Math.pow(plane.cam || 1, 0.6);
        if (dirtD > step) {
          dirtD = 0;
          addGouge(at, g0, 1);
        }
      }
      if (flight.wet > 0 && !flight.rest) {
        // A bow wave at the front, spray along the sides and a foamy wake behind; the wreck floats, then slowly goes down.
        const sp = flight.speed, nose = add(at, qrot(flight.q, [0, 0, plane.nose * 0.7 * plane.scale]));
        if (sp > 3) {
          if (Math.random() < dt * 40 * crowd) puff('spray', [nose[0] + (Math.random() - 0.5) * 3, WATER + 0.3, nose[2] + (Math.random() - 0.5) * 3], [flight.vel[0] * 0.25 + (Math.random() - 0.5) * 6, 2 + Math.random() * 4, flight.vel[2] * 0.25 + (Math.random() - 0.5) * 6]);
          if (Math.random() < dt * 30 * crowd) puff('spray', add(at, jitter(5)), [(Math.random() - 0.5) * 6, 2 + Math.random() * 4, (Math.random() - 0.5) * 6]);
        }
        if (Math.random() < dt * (3 + sp) * crowd) puff('foam', [at[0] - flight.vel[0] * 0.2 + (Math.random() - 0.5) * 10, WATER + 0.2, at[2] - flight.vel[2] * 0.2 + (Math.random() - 0.5) * 10], jitter(1));
        if (flight.wetT > 6 && Math.random() < dt * 12 * crowd) puff('bubble', [at[0] + (Math.random() - 0.5) * 6, WATER + 0.1, at[2] + (Math.random() - 0.5) * 6], [0, 1.5, 0]);
      }
      if (flight.sunk && Math.random() < dt * 5) puff('bubble', [at[0] + (Math.random() - 0.5) * 5, WATER + 0.1, at[2] + (Math.random() - 0.5) * 5], [0, 1.5, 0]);
    }
    function crashResult() {
      if (war && war.net) return;
      if (flight.info) flight.report = flight.makeReport();
      const rep = flight.report, why = war && war.dead ? 'Shot down' : rep ? rep.title : (CRASH_TEXT[flight.why] || 'Crashed');
      if (mode.id === 'hoops') finish('crash', score, `${why} · ${score} hoop${score === 1 ? '' : 's'}`, rep);
      else if (mode.id === 'trial') finish('crash', null, `${why} · hoop ${nextHoop + 1} of ${hoops.length}`, rep);
      else if (mode.id === 'landing') finish('crash', 0, why, rep);
      else if (mode.id === 'war') finish('crash', war ? war.score : 0, `${why} · ${war ? war.score : 0} pts · wave ${war ? war.wave : 0}`, rep);
      else finish('crash', null, why, rep);
    }

    // ---- AI traffic
    const TRAFFIC_IDS = ['c172', 'pa28', 'sr22', 'pc12', 'cit', 'e175', 'a220', 'b737', 'a320', 'b787'];
    const trafficRadius = (spec) => (spec.span || 5) * (spec.scale || 1) + 2.5;
    function spawnTraffic() {
      const id = TRAFFIC_IDS[Math.floor(Math.random() * TRAFFIC_IDS.length)], spec = PLANES.find((x) => x.id === id);
      const theta = Math.random() * Math.PI * 2, dist = 2600 + Math.random() * 1700;
      const x = flight.pos[0] + Math.sin(theta) * dist, z = flight.pos[2] - Math.cos(theta) * dist;
      const floor = groundAt(W, x, z) + 320, alt = Math.max(floor, flight.pos[1] + (Math.random() - 0.4) * 500);
      // Aim at the player with some spread: some pass wide, a few come straight at you.
      const spread = Math.random() < 0.2 ? 30 : 150 + Math.random() * 600, aim = [flight.pos[0] + (Math.random() - 0.5) * spread, flight.pos[2] + (Math.random() - 0.5) * spread];
      const heading = Math.atan2(aim[0] - x, -(aim[1] - z));
      traffic.push({ id, spec, pos: [x, Math.min(alt, 3500), z], heading, speed: Math.min(spec.cruise * (0.7 + Math.random() * 0.2), 140), vy: 0, turn: 0, turnT: 8 + Math.random() * 15, bank: 0, state: 'fly', t: 0, vel: v3(), w: v3(), q: qheading(heading) });
    }
    // ---- Fly with others: the pilots who have switched it on appear as aircraft with their callsigns (they cannot be hit).
    let shareOn = read('share', false), skyId = read('skyid', ''), remote = [], skyT = 0, skyBusy = false, skyFails = 0, skyPilots = null, skyOff = false;
    // The random id is made only when sharing is switched on, and a new one is made for every flight session.
    const newSkyId = () => [...crypto.getRandomValues(new Uint8Array(16))].map((x) => x.toString(16).padStart(2, '0')).join('');
    skyId = '';
    const skyFetch = async (path, body) => {
      const ac = new AbortController(), to = setTimeout(() => ac.abort(), 4000);
      try { const r = await fetch(`${WORLD_SERVER}${path}`, { method: body ? 'POST' : 'GET', headers: { 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined, signal: ac.signal, keepalive: !!body }); return r.ok ? await r.json() : null; }
      catch { return null; } finally { clearTimeout(to); }
    };
    async function skySync() {
      if (!skyId) skyId = newSkyId();
      skyBusy = true;
      const j = await skyFetch('/plane/sky', { id: skyId, cs: playerName || 'Pilot', plane: plane.id, rg: regionId || 'home', p: flight.pos.map((v) => Math.round(v * 10) / 10), h: +flight.heading.toFixed(3), pi: +flight.pitchAngle.toFixed(3), b: +flight.bank.toFixed(3), s: +flight.speed.toFixed(1) });
      skyBusy = false;
      if (!shareOn || !alive) { remote = []; return; }   // switched off while the answer was on its way
      if (!j || !Array.isArray(j.others)) { if (++skyFails >= 4 && !skyOff) { skyOff = true; remote = []; toast('Shared flying is not available right now', 2600); } return; }
      skyFails = 0; skyOff = false; skyPilots = j.pilots;
      const seen = new Set();
      for (const o0 of j.others.slice(0, 14)) {
        // What comes back from the server is checked like any outside data: wrong shapes are skipped, numbers are kept sane.
        const fin = (v, lo, hi) => (Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : null);
        const pos = Array.isArray(o0 && o0.p) && o0.p.length === 3 ? o0.p.map((v, i) => fin(v, i === 1 ? -50 : -20000, i === 1 ? 30000 : 20000)) : null;
        const o = pos && !pos.includes(null) && typeof o0.k === 'string' && o0.k.length <= 16 ? { k: o0.k, cs: String(o0.cs ?? 'Pilot').replace(/[^\p{L}\p{N} _.-]/gu, '').slice(0, 16) || 'Pilot', plane: String(o0.plane), p: pos, h: fin(o0.h, -7, 7), pi: fin(o0.pi, -3.2, 3.2), b: fin(o0.b, -3.2, 3.2), s: fin(o0.s, 0, 700), age: fin(o0.age, 0, 10000) ?? 0 } : null;
        if (!o || [o.h, o.pi, o.b, o.s].includes(null)) continue;
        const spec = PLANES.find((x) => x.id === o.plane && !x.rotor) || PLANES.find((x) => x.id === 'c172');
        seen.add(o.k);
        let a = remote.find((q) => q.k === o.k);
        const vel = [Math.sin(o.h) * Math.cos(o.pi) * o.s, Math.sin(o.pi) * o.s, -Math.cos(o.h) * Math.cos(o.pi) * o.s], ahead = add(o.p, mul(vel, o.age / 1000 + 0.3));
        if (!a) { a = { k: o.k, id: spec.id, spec, state: 'fly', pos: ahead, t: 0, w: v3() }; remote.push(a); }
        Object.assign(a, { cs: o.cs, vel, heading: o.h, pitch: o.pi, bank: o.b, speed: o.s, snap: ahead });
        a.q = attitudeQ(o.h, o.pi, o.b);
      }
      remote = remote.filter((a) => seen.has(a.k));
    }
    function stepSky(dt) {
      if (!shareOn || skyOff && skyFails >= 4 && (skyT -= dt) > 0) return;
      for (const a of remote) { a.pos = add(a.pos, mul(a.vel, dt)); if (a.snap) { a.pos = add(a.pos, mul(sub(a.snap, a.pos), Math.min(1, dt * 1.5))); a.snap = add(a.snap, mul(a.vel, dt)); } }
      skyT -= dt;
      if (skyT <= 0 && !skyBusy) { skyT = skyOff ? 15 : 2; skySync(); }
    }
    const skyLeave = () => { if (shareOn && skyId) skyFetch('/plane/sky/leave', { id: skyId }); remote = []; skyId = ''; };
    // ---- Plane racing with friends: the 12-hoop Time Trial course flown together. One pilot makes a room and shares its
    // 6-letter code, friends join, the host starts, and everyone flies the same hoops at once: the others' aircraft are drawn
    // where they are, a standings box shows who is ahead (hoops passed, then time), and the results list everyone's time.
    // It goes over the same live relay as Battle, in rooms of its own.
    let prace = null;                    // { link, code, host, status, peers: Map, racing, order, done }
    let praceShow = [];                  // the other racers' aircraft, in the shape the drawing code uses for other planes
    const prHud = document.createElement('div'); prHud.className = 'pg-prhud'; prHud.style.cssText = 'position:absolute;right:8px;top:190px;z-index:5;background:rgba(8,12,22,.66);color:#fff;font:600 11px system-ui;border-radius:8px;padding:6px 8px;pointer-events:none;display:none;min-width:150px';
    root.append(prHud);
    const prName = () => (playerName || 'Pilot').slice(0, 16);
    function praceOpen(host, code) {
      praceLeave(true);
      const c = code || NET.newCode();
      prace = { code: c, host, status: 'connecting', peers: new Map(), racing: false, order: [], done: new Map(), hb: 0, sendT: 0 };
      prace.link = new NET.Link(WebSocket, praceMsg, (st) => { if (!prace) return; prace.status = st; if (st === 'on') praceHello(); if (screen === 'menu') renderUI(); });
      prace.link.join(c, 'planerace1');
      prace.hb = setInterval(() => { praceHello(); const now = Date.now(); let gone = false; for (const [id, p] of prace.peers) if (now - p.seen > 8000) { prace.peers.delete(id); gone = true; } if (gone && screen === 'menu') renderUI(); }, 2000);
      if (screen === 'menu') renderUI();
    }
    function praceLeave(quiet) {
      if (!prace) return;
      try { prace.link.send({ t: 'bye', id: netMyId }); } catch { /* offline */ }
      clearInterval(prace.hb); prace.link.close(); prace = null; praceShow = []; prHud.style.display = 'none';
      if (!quiet && screen === 'menu') renderUI();
    }
    const praceHello = () => { if (prace) prace.link.send({ t: 'hi', id: netMyId, n: prName(), pl: plane.id, host: prace.host ? 1 : 0 }); };
    function praceMsg(m) {
      if (!prace || !m || m.id === netMyId || typeof m.id !== 'string' || m.id.length > 24) return;
      const fin = (v, lo, hi) => (Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : 0);
      let p = prace.peers.get(m.id);
      if (!p) { p = { id: m.id, n: 'Pilot', pl: 'c172', seen: Date.now(), hoop: 0, el: 0, fin: null, out: false }; prace.peers.set(m.id, p); }
      p.seen = Date.now();
      if (m.t === 'hi') { const known = p.known; p.known = true; p.n = String(m.n || 'Pilot').replace(/[^\p{L}\p{N} _.-]/gu, '').slice(0, 16) || 'Pilot'; p.pl = PLANES.some((x) => x.id === m.pl && !x.rotor) ? m.pl : 'c172'; p.host = !!m.host; if (!known) praceHello(); if (screen === 'menu') renderUI(); }
      else if (m.t === 'go' && Array.isArray(m.order) && !prace.host) praceStart(m.order.slice(0, 12).map(String));
      else if (m.t === 's' && prace.racing && Array.isArray(m.p) && m.p.length === 3) {
        const pos = m.p.map((v, i) => fin(v, i === 1 ? -50 : -20000, i === 1 ? 30000 : 20000)), h = fin(m.h, -7, 7), pi = fin(m.pi, -2, 2), b = fin(m.b, -4, 4), s = fin(m.s, 0, 400);
        p.hoop = Math.round(fin(m.hp, 0, 12)); p.el = fin(m.el, 0, 3600);
        const vel = [Math.sin(h) * Math.cos(pi) * s, Math.sin(pi) * s, -Math.cos(h) * Math.cos(pi) * s];
        let a = praceShow.find((q) => q.k === m.id);
        const spec = PLANES.find((x) => x.id === p.pl) || PLANES.find((x) => x.id === 'c172');
        if (!a) { a = { k: m.id, id: spec.id, spec, state: 'fly', pos, t: 0, w: v3() }; praceShow.push(a); }
        Object.assign(a, { id: spec.id, spec, cs: p.n, vel, snap: add(pos, mul(vel, 0.1)), heading: h, pitch: pi, bank: b, speed: s, state: 'fly' });
        a.q = attitudeQ(h, pi, b);
      } else if (m.t === 'fin' && prace.racing) { p.fin = fin(m.time, 0, 3600); p.hoop = 12; praceShow = praceShow.filter((a) => a.k !== m.id); if (screen === 'result') renderUI(); }
      else if (m.t === 'out' && prace.racing) { p.out = true; praceShow = praceShow.filter((a) => a.k !== m.id); if (screen === 'result') renderUI(); }
      else if (m.t === 'bye') { prace.peers.delete(m.id); praceShow = praceShow.filter((a) => a.k !== m.id); if (screen === 'menu' || screen === 'result') renderUI(); }
    }
    function praceStart(order) {
      if (!prace) return;
      prace.order = order; prace.racing = true; prace.myFin = null; prace.myOut = false;
      for (const p of prace.peers.values()) { p.hoop = 0; p.el = 0; p.fin = null; p.out = false; }
      praceShow = [];
      mode = MODES.find((x) => x.id === 'trial'); if (plane.rotor) { plane = PLANES.find((x) => x.id === 'c172'); write('plane', plane.id); }
      start();
      // Side by side at the start, so nobody starts inside someone else.
      const slot = Math.max(0, order.indexOf(netMyId)), off = (slot % 2 ? 1 : -1) * Math.ceil(slot / 2) * 40;
      flight.reset([off, 160 + (slot % 3) * 12, -200], 0, plane.cruise, false);
      toast(`Race! ${order.length} pilot${order.length === 1 ? '' : 's'} · fly the 12 hoops`, 2600);
    }
    function praceGo() {
      if (!prace || !prace.host) return;
      const order = [netMyId, ...[...prace.peers.values()].filter((p) => p.known).map((p) => p.id)].slice(0, 12);
      const msg = { t: 'go', id: netMyId, order }; prace.link.send(msg); setTimeout(() => prace && prace.link.send(msg), 300);
      praceStart(order);
    }
    /// Called when this pilot's run ends (finished, or crashed out).
    function praceEnd(kind, value) {
      if (!prace || !prace.racing || mode.id !== 'trial') return;
      if (kind !== 'crash' && value != null) { prace.myFin = value; prace.link.send({ t: 'fin', id: netMyId, time: value }); }
      else { prace.myOut = true; prace.link.send({ t: 'out', id: netMyId }); }
    }
    /// Everyone in the race, best first: finishers by time, then the rest by hoops passed (and who got there sooner).
    function praceStandings() {
      if (!prace) return [];
      const me = { id: netMyId, n: prName() + ' (you)', hoop: screen === 'fly' ? nextHoop : (prace.myFin != null ? 12 : nextHoop), el: elapsed, fin: prace.myFin, out: prace.myOut, me: true };
      const all = [me, ...[...prace.peers.values()].filter((p) => prace.order.includes(p.id))];
      return all.sort((a, b) => (a.fin != null && b.fin != null ? a.fin - b.fin : a.fin != null ? -1 : b.fin != null ? 1 : a.out !== b.out ? (a.out ? 1 : -1) : b.hoop - a.hoop || a.el - b.el));
    }
    function praceTable() {
      const rows = praceStandings();
      return `<h2>🏁 Race ${escapeHtml(prace.code)}</h2><table class="pg-table">${rows.map((r, i) => `<tr${r.me ? ' style="background:rgba(91,108,255,.3)"' : ''}><td>${i + 1}</td><td>${escapeHtml(r.n)}</td><td>${r.fin != null ? r.fin.toFixed(1) + ' s' : r.out ? 'crashed out' : `hoop ${r.hoop}/12…`}</td></tr>`).join('')}</table>`;
    }
    function stepRace(dt) {
      if (!prace) return;
      for (const a of praceShow) { a.pos = add(a.pos, mul(a.vel, dt)); if (a.snap) { a.pos = add(a.pos, mul(sub(a.snap, a.pos), Math.min(1, dt * 3))); a.snap = add(a.snap, mul(a.vel, dt)); } }
      const flying = prace.racing && screen === 'fly' && mode.id === 'trial';
      if (flying) {
        prace.sendT -= dt;
        if (prace.sendT <= 0) { prace.sendT = 0.2; prace.link.send({ t: 's', id: netMyId, p: flight.pos.map((v) => Math.round(v * 10) / 10), h: +flight.heading.toFixed(3), pi: +flight.pitchAngle.toFixed(3), b: +flight.bank.toFixed(3), s: Math.round(len(flight.vel)), hp: nextHoop, el: Math.round(elapsed * 10) / 10 }); }
        prace.hudT = (prace.hudT || 0) - dt;
        if (prace.hudT <= 0) { prace.hudT = 0.25; prHud.style.display = ''; prHud.innerHTML = `<b>🏁 Race · ${praceStandings().length} pilots</b>` + praceStandings().map((r, i) => `<div style="${r.me ? 'color:#ffd166' : ''}">${i + 1}. ${escapeHtml(r.n)} · ${r.fin != null ? r.fin.toFixed(1) + ' s' : r.out ? 'out' : `${r.hoop}/12`}</div>`).join(''); }
      } else prHud.style.display = 'none';
    }
    function praceHtml() {
      if (!prace) return `<h2>🏁 Race friends <small style="font-weight:500;opacity:.6">the 12-hoop course, all at once</small></h2><div class="pg-row"><button data-a="prhost">Create a race room</button><input data-prcode maxlength="8" placeholder="CODE" style="width:84px;text-transform:uppercase;letter-spacing:2px"><button data-a="prjoin">Join</button></div><div class="pg-hint">Make a room and send friends the code; everyone picks a plane, the host starts, and you all fly the same hoops. You see their aircraft and who is ahead.</div>`;
      const st = { connecting: 'Connecting…', on: 'Connected', failed: 'Could not connect', off: 'Offline' }[prace.status] || '';
      const names = [prName() + ' (you)', ...[...prace.peers.values()].filter((p) => p.known).map((p) => `${p.n} · ${(PLANES.find((x) => x.id === p.pl) || {}).name || ''}`)];
      return `<h2>🏁 Race room <b style="letter-spacing:2px">${escapeHtml(prace.code)}</b> <small style="font-weight:500;opacity:.6">${st}</small></h2><div class="pg-hint">${names.map(escapeHtml).join(' · ')}</div><div class="pg-row">${prace.host ? '<button data-a="prgo" class="pg-go">🏁 Start the race</button>' : '<span class="pg-hint">Waiting for the host to start…</span>'}<button data-a="prleave">Leave room</button></div><div class="pg-hint">Share the code: friends pick Time Trial → Join. Helicopters can't race: pick a plane.</div>`;
    }

    function stepTraffic(dt) {
      trafficT -= dt;
      if (trafficT <= 0 && traffic.filter((a) => a.state === 'fly').length < 3) { spawnTraffic(); trafficT = 25 + Math.random() * 35; }
      let nearest = null;
      for (const a of traffic) {
        a.t += dt;
        if (a.state === 'fly') {
          a.turnT -= dt;
          if (a.turnT <= 0) { a.turn = Math.random() < 0.5 ? 0 : (Math.random() - 0.5) * 0.07; a.turnT = 6 + Math.random() * 14; }
          a.heading += a.turn * dt;
          const gnd = groundAt(W, a.pos[0], a.pos[2]), want = a.pos[1] < gnd + 240 ? 6 : a.pos[1] > 3600 ? -3 : (Math.sin(a.t / 17 + a.speed) * 1.2);
          a.vy += (want - a.vy) * Math.min(1, dt * 0.8);
          const hv = [Math.sin(a.heading) * a.speed, a.vy, -Math.cos(a.heading) * a.speed];
          a.vel = hv; a.pos = add(a.pos, mul(hv, dt));
          a.bank += (clamp(a.turn * a.speed / 9.8, -0.45, 0.45) - a.bank) * Math.min(1, dt * 1.5);
          a.q = qmul(qheading(a.heading, Math.asin(clamp(a.vy / a.speed, -0.3, 0.3))), qaxis([0, 0, 1], -a.bank));
          const rel = sub(a.pos, flight.pos), d = len(rel);
          if (d > 9500 || a.t > 600) { a.state = 'gone'; continue; }
          // Hit?
          const rr = trafficRadius(a.spec) + (plane.rotor ? 6 : trafficRadius(plane));
          if (d < rr && !flight.crashed) { collideTraffic(a); continue; }
          // A close call, then a TCAS-style call-out as one closes in on the same height.
          if (d < 120 + rr && !nearSeen.has(a)) { nearSeen.add(a); achieve('near'); toast('😮 Close call!', 1600); }
          const closing = -dot(rel, sub(flight.vel, a.vel)) / Math.max(d, 1) < 0;   // distance shrinking
          if (tcasOn && closing && d < 2200 && Math.abs(rel[1]) < 450) say(d < 800 ? 'Traffic, traffic, traffic' : 'Traffic', { level: d < 800 ? 2 : 1, every: 7, key: 'tcas' });
          if (!nearest || d < nearest.d) nearest = { a, d };
        } else if (a.state === 'fall') {
          a.vel = add(a.vel, [0, -9.8 * dt, 0]); a.vel = mul(a.vel, 1 - 0.04 * dt);
          a.pos = add(a.pos, mul(a.vel, dt));
          a.q = qnorm(qmul(a.q, qaxis(norm(a.w), len(a.w) * dt)));
          if (Math.random() < dt * 40) puff('fire', add(a.pos, jitter(3)), jitter(4));
          if (Math.random() < dt * 30) puff('soot', add(a.pos, jitter(2)), [0, 3, 0]);
          const gnd = groundAt(W, a.pos[0], a.pos[2]);
          if (a.pos[1] < gnd + 2) {
            for (let i = 0; i < 26; i++) puff(i % 3 === 0 ? 'fire' : i % 3 === 1 ? 'dirt' : 'soot', add(a.pos, jitter(10)), add([0, 8 + Math.random() * 8, 0], jitter(14)));
            for (let i = 0; i < 6; i++) puff('gfire', add(a.pos, jitter(14)), v3());
            if (len(sub(a.pos, flight.pos)) < 1500) { noise(1.4, 0.45, 220); shakeKick = Math.max(shakeKick, 0.25); }
            a.state = 'gone';
          }
          if (a.t > 120) a.state = 'gone';
        }
      }
      traffic = traffic.filter((a) => a.state !== 'gone');
      trafficNearest = nearest;
    }
    let trafficNearest = null, lastVP = null;
    /// A mid-air collision: the other aircraft loses control and falls burning, and the player's loses a wing.
    function collideTraffic(a) {
      a.state = 'fall'; a.t = 0;
      a.w = [(Math.random() - 0.5) * 3, (Math.random() - 0.5) * 3, (Math.random() - 0.5) * 3 + 2];
      a.vel = add(mul(a.vel, 0.7), [0, -2, 0]);
      const { r } = flight.axes(), side = dot(sub(a.pos, flight.pos), r) >= 0 ? 'R' : 'L';
      if (war && war.vehicle === 'plane') { war.warn = 'AIRCRAFT CONTACT'; war.warnT = 1.8; flight.vel = mul(flight.vel, 0.78); }
      else { flight.loseWing(side, 'midair', Math.random() < 0.6 ? 'tip' : 'root'); if (Math.random() < 0.35) flight.breakTail(); }
      flight.vel = add(flight.vel, jitter(3)); flight.w = add(flight.w, [(Math.random() - 0.5) * 0.5, (Math.random() - 0.5) * 0.5, (side === 'R' ? -1 : 1) * 0.6]);
      shakeKick = 1; noise(0.8, 0.6, 500); noise(1.2, 0.4, 150);
      for (let i = 0; i < 16; i++) puff('spark', a.pos, add(jitter(30), mul(flight.vel, 0.3)));
      for (let i = 0; i < 8; i++) puff('fire', a.pos, jitter(10));
    }

    // ================================================================== AIR WAR (the 'war' mode)
    // Bomb and shoot ground targets and fight computer-flown fighters: alone with a computer wingman (co-op) or against
    // aces that hunt you (versus). Enter or a click fires the guns, Z drops bombs (hold for a stick), N fires a missile at
    // the locked fighter, L fires flares. The physics and the pilots' steering are in WAR (above); this is the game round it.
    const WAR_DIFF = {
      easy:   { turn: 0.55, aim: 0.07, burst: 0.7, hp: 0.8, flak: 0.45, count: 0.7, speed: 180 },
      normal: { turn: 0.8, aim: 0.05, burst: 1, hp: 1, flak: 0.8, count: 1, speed: 205 },
      hard:   { turn: 1.05, aim: 0.03, burst: 1.3, hp: 1.25, flak: 1.1, count: 1.3, speed: 225 },
    };
    const WAR_KINDS = {
      truck: { name: 'Truck', hp: 45, r: 3.8, pts: 50 },
      tank: { name: 'Tank', hp: 130, r: 4.6, pts: 100 },
      aa: { name: 'AA gun', hp: 90, r: 3.6, pts: 150 },
      bunker: { name: 'Bunker', hp: 230, r: 7.5, pts: 200 },
      fuel: { name: 'Fuel depot', hp: 60, r: 5.5, pts: 120 },
      rifleman: { name: 'Rifleman', hp: SOLDIER.enemyHp, r: 0.9, pts: 60 },
      rpgman: { name: 'RPG soldier', hp: SOLDIER.enemyHp, r: 0.9, pts: 120 },
      house: { name: 'Building', hp: 70, r: 7, pts: 60 },
      tower: { name: 'Tower block', hp: 190, r: 9, pts: 150 },
      factory: { name: 'Factory', hp: 260, r: 13, pts: 220 },
      warship: { name: 'Warship', hp: 700, r: 26, pts: 600 },
    };
    const CITY_KINDS = new Set(['house', 'tower', 'factory']);
    const CITY_NAMES = ['Redmoor', 'Ostrava Ridge', 'Kelvin Bay', 'Marrow', 'Dunhaven', 'Zarek', 'Port Lyle', 'Vellin', 'Corvane', 'Stonegate', 'Ashford Cross', 'Novik'];
    const INF = new Set(['rifleman', 'rpgman']);          // enemy people on foot
    // What you chose in the Battle menu: the vehicle, the battlefield, how much the game does for you, who fights, and whether the enemy shoots back.
    const WAR_VEHICLES = [
      { id: 'f16', name: 'Fighter', icon: '✈️', blurb: 'Fast and quick to turn. Guns, missiles and a few bombs.' },
      { id: 'a10', name: 'Gunship', icon: '🛩️', blurb: 'Slow and tough, with the most cannon ammunition. Best at tanks.' },
      { id: 'f15', name: 'Interceptor', icon: '🚀', blurb: 'The fastest jet, with 12 missiles and a light gun but no bombs. Thin armour: kill fighters first, never trade hits.' },
      { id: 'su27', name: 'Heavy Striker', icon: '🦅', blurb: 'A big twin-engine jet that carries 16 bombs, 8 missiles and a strong gun, and takes a beating. Turns slowly.' },
      { id: 'b52', name: 'Bomber', icon: '💣', blurb: 'Carries 40 bombs and has gunners who shoot at fighters.' },
      { id: 'soldier', name: 'Soldier', icon: '🎖️', blurb: 'On foot with a scoped rifle (right-click or Z for 4x and 10x), grenades and a helmet. Enemy riflemen march at you.' },
      { id: 'heli', name: 'Helicopter', icon: '🚁', blurb: 'An Apache gunship. Fly in, land and press E to get out with a rifle and an RPG, and E again beside it to climb back in. Flies like a helicopter: no arcade help.' },
      { id: 'tank', name: 'Tank', icon: '🪖', blurb: 'Drive on the ground with a turret and a big gun.' },
    ];
    let warCity = read('warcity', ''), warSide = read('warside', 'coop'), warDiff = 'easy', warVeh = read('warveh', 'f16'), warField = read('warfield', 'plains'), warAssist = read('warassist', 'easy'), warNpc = read('warnpc', true), warOverG = read('waroverg', true);
    if (warSide !== 'versus') warSide = 'coop';
    if (!WAR_VEHICLES.some((v) => v.id === warVeh)) warVeh = 'f16';
    if (!ARENAS.some((a) => a.id === warField)) warField = 'plains';
    if (!['auto', 'easy', 'pro'].includes(warAssist)) warAssist = 'easy';
    warNpc = warNpc !== false;
    const warLevel = () => (warAssist === 'pro' ? 'normal' : 'easy');         // how hard the enemy is: easy unless you chose full control
    let worldArena = '';
    /// Swaps the world for a battlefield (or back to the ordinary world, with ''), rebuilding the scenery.
    function useBattlefield(id) {
      if (worldArena === id) return;
      const a = id ? ARENAS.find((x) => x.id === id) : null;
      ARENA = a; W = a ? makeWorld(REGIONS[0], a) : makeWorld(regionOf(regionId)); WR.setWorld(W); worldArena = a ? a.id : '';
    }
    /// Your own choice of aircraft for the other modes (Battle uses the vehicle you picked there instead).
    const restorePlane = () => { plane = PLANES.find((p) => p.id === read('plane', 'c172')) || PLANES[0]; };
    const warBody = (spot) => (warVeh === 'soldier' ? new SoldierBody([spot.x, 0, spot.z], spot.heading) : new TankBody([spot.x, 0, spot.z], spot.heading));
    let war = null;
    const warPad = { gun: false, bomb: false };       // the mouse button, for the guns
    const WAR_OLIVE = [0.34, 0.38, 0.24], WAR_DARK = [0.14, 0.15, 0.13], WAR_GREY = [0.55, 0.57, 0.58];

    /// The weapons each kind of aircraft carries, and how much punishment it takes.
    /// Ground fighters and helicopters start on a small field that grows with every wave (jets always get the whole field).
    const WAR_R0 = 0.4;
    const warFieldR = (n) => (war.grows ? war.arena.R * Math.min(1, WAR_R0 + 0.1 * (Math.max(n, 1) - 1)) : war.arena.R);
    const footScoped = () => !!(mode.id === 'war' && war && war.foot && screen === 'fly' && war.zoomI > 0);
    /// How far a place is from the middle of the current front (the battle travels, so "the edge" is measured from here).
    const warDist = (x, z) => Math.hypot(x - war.cx, z - war.cz);
    const warStartAlt = () => (plane.id === 'b52' ? 1100 : plane.rotor ? 140 : 450);
    function warLoadout(p) {
      if (p.id === 'b52') return { gun: 0, bombs: 40, missiles: 0, flares: 12, hp: 170, stick: 0.11, gunners: true };
      if (p.id === 'f15') return { gun: 260, bombs: 0, missiles: 12, flares: 24, hp: 75, stick: 0.2 };
      if (p.id === 'su27') return { gun: 650, bombs: 16, missiles: 8, flares: 16, hp: 135, stick: 0.2 };
      if (p.id === 'a10') return { gun: 1100, bombs: 8, missiles: 4, flares: 16, hp: 150, stick: 0.2 };
      if (p.cat === 'mil') return { gun: 520, bombs: 4, missiles: 6, flares: 20, hp: 100, stick: 0.2 };
      if (p.cat === 'rotary') return { gun: 700, bombs: 6, missiles: 8, flares: 12, hp: 100, stick: 0.25 };
      if (p.cat === 'liner') return { gun: 0, bombs: 24, missiles: 0, flares: 6, hp: 150, stick: 0.15 };
      if (p.cat === 'biz' || p.cat === 'turbo') return { gun: 240, bombs: 8, missiles: 0, flares: 6, hp: 90, stick: 0.2 };
      return { gun: 300, bombs: 3, missiles: 0, flares: 4, hp: 70, stick: 0.25 };
    }

    // ---- the models (nose towards -z, like the aircraft)
    const warMeshes = (() => {
      const m = {};
      let b = new Builder();
      b.box([0, 0.85, 0], [3.0, 0.9, 6.2], WAR_OLIVE); b.box([-1.75, 0.5, 0], [0.8, 1.0, 6.6], WAR_DARK); b.box([1.75, 0.5, 0], [0.8, 1.0, 6.6], WAR_DARK);
      b.taper(0, 0.8, -3.1, 3.0, 0.7, -3.9, 2.6, 0.5, [0.3, 0.34, 0.22]);
      m.tank = upload(b);
      // A soldier: body (torso, head, helmet, arms, rifle) and two legs that swing from the hip.
      const UNI = [0.34, 0.4, 0.26], SKIN = [0.78, 0.6, 0.48], HELM = [0.22, 0.27, 0.19], GUN = [0.1, 0.1, 0.11];
      b = new Builder();
      b.box([0, 1.22, 0], [0.46, 0.62, 0.26], UNI); b.box([0, 1.2, 0.02], [0.5, 0.4, 0.3], [0.26, 0.3, 0.22]);
      b.box([0, 1.64, 0], [0.2, 0.22, 0.2], SKIN); b.box([0, 1.76, 0], [0.27, 0.12, 0.27], HELM);
      b.box([-0.3, 1.27, -0.1], [0.12, 0.46, 0.14], UNI); b.box([0.28, 1.2, -0.24], [0.12, 0.14, 0.5], UNI);
      b.box([0.14, 1.2, -0.5], [0.06, 0.09, 0.95], GUN);
      m.soldier = upload(b);
      b = new Builder(); b.box([0, -0.45, 0], [0.2, 0.9, 0.24], [0.28, 0.32, 0.22]); m.leg = upload(b);
      b = new Builder();
      b.box([0, 1.15, 0.5], [2.3, 1.5, 4.4], [0.3, 0.35, 0.24]); b.box([0, 1.0, -2.1], [2.2, 1.1, 1.3], [0.26, 0.3, 0.2]); b.box([0, 1.75, -2.2], [1.9, 0.5, 0.15], [0.55, 0.7, 0.8]);
      for (const [wx, wz] of [[-1.2, -1.7], [1.2, -1.7], [-1.2, 1.9], [1.2, 1.9]]) b.box([wx, 0.45, wz], [0.35, 0.9, 0.9], [0.08, 0.08, 0.09]);
      m.van = upload(b);
      b = new Builder(); b.cone([0, -6, 0], 0.55, 0.3, 10, TREE_COL.bark, 4); crown(b, 0, 3, 0, 3.2, 3.4, [0.3, 0.55, 0.28], 5, 0.4); m.treeProp = upload(b);
      b = new Builder(); b.box([0, 0.55, 0], [0.7, 0.7, 0.7], [1, 1, 1]); m.loot = upload(b);
      b = new Builder(); b.box([0, 30, 0], [0.35, 60, 0.35], [1, 1, 1]); m.beam = upload(b);
      b = new Builder(); b.box([0, 3.4, 0], [5, 0.12, 5], [0.92, 0.92, 0.86]); b.box([-1.2, 1.9, 0], [0.04, 3, 0.04], [0.4, 0.4, 0.4]); b.box([1.2, 1.9, 0], [0.04, 3, 0.04], [0.4, 0.4, 0.4]); m.canopy = upload(b);
      b = new Builder();
      b.box([0, 0.4, 0.3], [2.2, 0.8, 2.6], [0.3, 0.34, 0.22]);
      m.turret = upload(b);
      b = new Builder(); rod(b, [0, 0, -0.6], [0, 0, -5.6], 0.13, 0.1, [0.2, 0.21, 0.2], 8); m.barrel = upload(b);
      b = new Builder();
      b.box([0, 1.7, -2.0], [2.3, 1.7, 1.8], [0.4, 0.42, 0.3]); b.box([0, 1.45, 1.4], [2.4, 1.3, 4.4], WAR_OLIVE);
      for (const z of [-2.2, 1.0, 2.6]) for (const x of [-1.2, 1.2]) b.box([x, 0.55, z], [0.45, 1.1, 1.1], WAR_DARK);
      m.truck = upload(b);
      b = new Builder();
      b.box([0, 0.4, 0], [2.8, 0.8, 2.8], [0.32, 0.34, 0.28]); b.box([0, 1.25, 0], [1.7, 0.9, 1.7], [0.36, 0.4, 0.28]);
      for (const sx of [-1, 1]) rod(b, [sx * 0.45, 1.35, -0.1], [sx * 0.45, 2.9, -2.7], 0.11, 0.09, [0.18, 0.19, 0.18], 6);
      m.aa = upload(b);
      b = new Builder();
      b.box([0, 1.3, 0], [10, 2.6, 7], [0.58, 0.58, 0.55]); b.box([0, 2.85, 0], [7.4, 0.5, 4.8], [0.46, 0.46, 0.44]); b.box([0, 1.7, -3.55], [4.6, 0.55, 0.2], [0.08, 0.08, 0.08]);
      m.bunker = upload(b);
      b = new Builder();
      for (const [x, z] of [[-3.6, 0], [3.6, 0], [0, 4.2]]) { b.cone([x, 0, z], 2.9, 2.9, 4.2, [0.78, 0.8, 0.82], 14); b.cone([x, 4.2, z], 2.9, 0.6, 0.7, [0.7, 0.72, 0.74], 14); }
      b.box([0, 0.4, 1.8], [10, 0.5, 0.5], [0.45, 0.2, 0.15]);
      m.fuel = upload(b);
      // A town: low houses with roofs, tower blocks with rows of windows, and a factory with chimneys.
      b = new Builder();
      b.box([0, 2.6, 0], [10, 5.2, 8], [0.78, 0.72, 0.62]); b.taper(0, 5.2, -4.2, 10.4, 0.1, 4.2, 10.4, 2.6, [0.55, 0.24, 0.18]);
      for (const x of [-3, 0, 3]) b.box([x, 2.8, -4.05], [1.4, 1.4, 0.1], [0.25, 0.32, 0.4]);
      m.house = upload(b);
      b = new Builder();
      b.box([0, 13, 0], [12, 26, 12], [0.62, 0.64, 0.68]);
      for (let y = 3; y < 25; y += 3.2) { b.box([0, y, -6.05], [10.5, 1.3, 0.1], [0.2, 0.27, 0.36]); b.box([6.05, y, 0], [0.1, 1.3, 10.5], [0.2, 0.27, 0.36]); b.box([-6.05, y, 0], [0.1, 1.3, 10.5], [0.2, 0.27, 0.36]); b.box([0, y, 6.05], [10.5, 1.3, 0.1], [0.2, 0.27, 0.36]); }
      b.box([0, 26.4, 0], [6, 0.8, 6], [0.4, 0.4, 0.42]);
      m.tower = upload(b);
      b = new Builder();
      b.box([0, 4, 0], [24, 8, 16], [0.55, 0.5, 0.44]); b.box([0, 8.4, 0], [24.4, 0.8, 16.4], [0.4, 0.38, 0.36]);
      for (const x of [-7, 0, 7]) b.taper(x, 8, -4, 2.4, 0, 4, 2.4, 1.8, [0.45, 0.43, 0.42]);
      for (const x of [-8, 8]) b.cone([x, 8.8, 5], 1.3, 0.9, 16, [0.5, 0.36, 0.3], 10);
      m.factory = upload(b);
      // An enemy warship: a long grey hull, a stepped superstructure, a mast and three gun turrets.
      b = new Builder();
      b.taper(0, 0, -60, 16, 6, -76, 2, 6, [0.42, 0.45, 0.5]); b.box([0, 3, 4], [16, 6, 128], [0.42, 0.45, 0.5]); b.box([0, 6.2, 4], [15, 0.4, 126], [0.5, 0.48, 0.44]);
      b.box([0, 10, 12], [10, 8, 26], [0.5, 0.53, 0.58]); b.box([0, 16, 8], [6, 5, 12], [0.55, 0.58, 0.62]); b.box([0, 24, 8], [0.6, 12, 0.6], [0.3, 0.3, 0.32]);
      for (const z of [-40, -24, 46]) { b.box([0, 8, z], [6, 3, 7], [0.36, 0.39, 0.43]); for (const sx of [-1, 1]) rod(b, [sx * 0.9, 8.4, z - 2], [sx * 0.9, 8.6, z - 12], 0.35, 0.3, [0.25, 0.26, 0.28], 6); }
      m.warship = upload(b);
      // Your carrier: a flat flight deck with a centre line and an island on the right.
      b = new Builder();
      b.box([0, 8, 0], [34, 16, 300], [0.36, 0.38, 0.42]); b.box([0, 16.3, 0], [42, 0.6, 320], [0.27, 0.28, 0.3]);
      for (let z = -150; z <= 150; z += 20) b.box([0, 16.65, z], [1, 0.05, 10], [0.95, 0.95, 0.9]);
      b.box([17, 16.65, 0], [0.6, 0.05, 300], [0.9, 0.8, 0.2]); b.box([-17, 16.65, 0], [0.6, 0.05, 300], [0.9, 0.8, 0.2]);
      b.box([24, 26, 30], [8, 20, 34], [0.45, 0.47, 0.52]); b.box([24, 40, 32], [0.5, 10, 0.5], [0.3, 0.3, 0.3]);
      m.carrier = upload(b);
      // The home base: a runway with a centre line, threshold bars and a hangar.
      b = new Builder();
      b.box([0, 0.15, 0], [46, 0.3, 900], [0.24, 0.25, 0.27]);
      for (let z = -420; z <= 420; z += 40) b.box([0, 0.32, z], [1.2, 0.05, 18], [0.92, 0.92, 0.9]);
      for (const z of [-440, 440]) for (let x = -18; x <= 18; x += 6) b.box([x, 0.32, z], [3, 0.05, 12], [0.92, 0.92, 0.9]);
      b.box([60, 6, 0], [30, 12, 40], [0.48, 0.5, 0.46]); b.box([60, 12.4, 0], [31, 0.8, 41], [0.38, 0.4, 0.38]);
      m.runway = upload(b);
      b = new Builder();
      rod(b, [0, 0, -1.2], [0, 0, 0.9], 0.2, 0.2, [0.3, 0.34, 0.22], 8); rod(b, [0, 0, -1.6], [0, 0, -1.2], 0.02, 0.2, [0.3, 0.34, 0.22], 8);
      b.box([0, 0, 1.1], [0.95, 0.05, 0.4], [0.2, 0.22, 0.17]); b.box([0, 0, 1.1], [0.05, 0.95, 0.4], [0.2, 0.22, 0.17]);
      m.bomb = upload(b);
      b = new Builder(); rod(b, [0, 0, -2.5], [0, 0, 2.5], 0.07, 0.07, [1, 0.9, 0.45], 4); m.tracer = upload(b);
      b = new Builder();
      rod(b, [0, 0, -2], [0, 0, 2], 0.15, 0.15, [0.92, 0.92, 0.94], 6); rod(b, [0, 0, -2.7], [0, 0, -2], 0.01, 0.15, [0.8, 0.15, 0.1], 6);
      b.box([0, 0, 1.7], [1.0, 0.04, 0.5], [0.4, 0.4, 0.42]); b.box([0, 0, 1.7], [0.04, 1.0, 0.5], [0.4, 0.4, 0.42]);
      m.missile = upload(b);
      b = new Builder(); b.cone([0, 0, 0], 1, 1, 0.05, [1, 1, 1], 18); m.crater = upload(b);
      return m;
    })();
    PUFF.clod = { life: [1, 2.2], size: [1.4, 3.6], col: () => [0.3, 0.22, 0.13], glow: 0, rise: 0, grav: 9.8, a: 0.9 };
    PUFF.boom = { life: [0.4, 0.9], size: [5, 26], col: (k) => [1, 0.5 - k * 0.3, 0.08], glow: 0.9, rise: 3, grav: 0, a: 0.85 };
    PUFF.flare = { life: [1.6, 2.6], size: [1.2, 0.4], col: () => [1, 0.9, 0.7], glow: 3, rise: -5, grav: 0, a: 1 };
    PUFF.burst = { life: [0.7, 1.4], size: [3, 14], col: (k) => [0.08 + k * 0.2, 0.08 + k * 0.2, 0.09 + k * 0.2], glow: 0, rise: 1, grav: 0, a: 0.8 };

    const qDir = (v) => { const sp = len(v) || 1; return qheading(Math.atan2(v[0], -v[2]), Math.asin(clamp(v[1] / sp, -1, 1))); };
    const warRand = () => Math.random();
    const onLand = (x, z) => { const g = groundAt(W, x, z); if (g <= WATER + 1.5) return false; const n = normalAt(W, x, z, 10); return (n[1] ?? 1) > (worldArena ? 0.86 : 0.94); };

    // ---- starting and the waves
    function warStart() {
      if (W.broken) { const keep = worldArena; worldArena = ''; useBattlefield(keep); }      // trees broken in the last battle grow back
      const tank = warVeh === 'tank' || warVeh === 'soldier', arena = (tank && warField === 'sea' ? ARENAS.find((a) => a.id === 'island') : ARENAS.find((a) => a.id === warField)) || ARENAS[0], foot = warVeh === 'soldier', grows = tank || plane.rotor, R = grows ? arena.R * WAR_R0 : arena.R;
      const L = foot ? { gun: SOLDIER.reserve, bombs: SOLDIER.grenades, missiles: 0, flares: 0, hp: SOLDIER.hp, stick: 0.5, shells: 0, rpg: SOLDIER.rpg } : tank ? { gun: 900, bombs: 0, missiles: 0, flares: 0, hp: TANK.hp, stick: 0.2, shells: 40 } : { ...warLoadout(plane), shells: 0 }, d = WAR_DIFF[warLevel()];
      const shared = netg && netg.running && netg.start, mine = shared ? netg.start.players.find((q) => q.id === netMyId) : null;
      const spot = shared ? netStartSpot(R, netg.start.cfg, mine ? mine.slot : 0) : { x: 0, z: R * 0.72, heading: 0 };
      const startZ = spot.z;
      let tankBody = null;
      if (tank) {
        tankBody = warBody(spot);
        tankBody.pos[1] = groundAt(W, spot.x, spot.z) + 0.2;
        flight.reset([spot.x, tankBody.pos[1] + 2.2, spot.z], spot.heading, 0, true);
      } else flight.reset([spot.x, warStartAlt(), shared ? spot.z : R * 0.9], spot.heading, plane.cruise, false);
      flight.sturdy = !tank; flight.overG = warOverG;
      war = { cx: 0, cz: 0, guided: 2, fires: [], flyers: [], startZ, arena, R, grows, loot: [], lootId: 0, shield: foot ? SOLDIER.shield : 0, bandage: 0, shieldPots: 0, medkit: 0, healCool: 0, vehicle: tank ? 'tank' : 'plane', foot, rpg: foot ? SOLDIER.rpg : 0, weapon: 'rifle', heli: null, mag: SOLDIER.mag, reloadT: 0, zoomI: 0, tank: tankBody, assist: warAssist, npc: warNpc, ap: { hdg: spot.heading, alt: flight.pos[1], spd: plane.cruise * 1.05, i: 0 }, outT: 0, endT: 0, shells: L.shells,
        gidn: 0, nidn: 0, score: 0, kills: 0, wave: 0, hp: L.hp, maxHp: L.hp, L, gun: L.gun, bombs: L.bombs, missiles: L.missiles, flares: L.flares,
        ground: [], foes: [], friend: null, bullets: [], bombsAir: [], missilesAir: [], flaks: [], craters: [], feed: [], lock: null, lockT: 0,
        gunT: 0, bombT: 0, flash: 0, warn: '', warnT: 0, wavePause: 2.5, waveClear: false, gunners: 0, dead: false, feedT: 0, shown: false, d };
      if (shared) netAttachToWar();
      else if (warSide === 'coop' && !foot) war.friend = warSpawnAircraft('f16', 'friend');
      if (foot) { camMode = 0; warOpenMap(); }
      buildWbar();
    }

    function warSpawnAircraft(id, role) {
      const spec = PLANES.find((x) => x.id === id), d = war.d, R = war.R;
      let pos, heading;
      if (role === 'friend') {
        if (war.vehicle === 'tank') { pos = [war.tank.pos[0] + 120, groundAt(W, war.tank.pos[0], war.tank.pos[2]) + 170, war.tank.pos[2] + 100]; heading = 0; }
        else { const { r, f } = flight.axes(); pos = add(add(flight.pos, mul(r, 140)), mul(f, -60)); heading = flight.heading; }
      } else {
        const x = war.cx + (warRand() - 0.5) * R * 1.2, z = war.cz - R * (0.85 + warRand() * 0.1);
        pos = [x, groundAt(W, x, z) + 330 + warRand() * 250, z];
        heading = Math.atan2(-(x - war.cx), z - war.cz);            // towards the middle
      }
      const speed = role === 'friend' ? Math.max(flight.speed, plane.cruise * 0.8, 150) : d.speed;
      const a = { nid: role === 'foe' ? ++war.nidn : 0, id, spec, role, pos, heading, pitch: 0, speed, bank: 0, vel: v3(), q: qheading(heading), hp: 100 * (role === 'foe' ? d.hp : 1), maxHp: 100 * (role === 'foe' ? d.hp : 1),
        state: 'fly', t: 0, w: v3(), cool: 1 + warRand() * 2, burstLeft: 0, gunT: 0, mslCool: 8 + warRand() * 10, target: null, retargetT: 0, warnMsl: null, lastHit: null };
      a.vel = [Math.sin(heading) * speed, 0, -Math.cos(heading) * speed];
      return a;
    }

    /// Squads of people on foot in a row ahead of you, each further away. They march at the nearest player and stop to shoot;
    /// from wave 3 one in each squad carries an RPG.
    function warSpawnInfantry(n, squads, size) {
      const d = war.d, R = war.R, z0 = war.wave > 1 && war.arena.journey ? war.cz + R * 0.72 : (war.startZ ?? R * 0.72);
      let alive = war.ground.filter((q) => !q.dead && INF.has(q.kind)).length;      // at most 24 people on foot at once
      for (let c = 0; c < squads; c++) {
        let cx = 0, cz = 0, ok = false;
        for (let tries = 0; tries < 30 && !ok; tries++) { cx = war.cx + (warRand() - 0.5) * (tries < 15 ? 160 : 800); cz = z0 - 330 - c * (180 + warRand() * 80); ok = onLand(cx, cz) && warDist(cx, cz) < R * 0.85; }
        if (!ok) continue;
        for (let i = 0; i < size && alive < 24; i++, alive++) {
          const x = cx + (warRand() - 0.5) * 24, z = cz + (warRand() - 0.5) * 24; if (!onLand(x, z)) continue;
          const sqKind = i === 0 && n >= 3 ? 'rpgman' : 'rifleman', k = WAR_KINDS[sqKind];
          war.ground.push({ nid: ++war.gidn, kind: sqKind, pos: [x, Math.max(groundAt(W, x, z), 0), z], heading: 0, turret: 0, hp: k.hp * d.hp, maxHp: k.hp * d.hp, r: k.r, pts: k.pts, cool: 1.5 + warRand() * 2, t: 0, burning: 0,
            speed: SOLDIER.enemyWalk, stop: 70 + warRand() * 90, walk: warRand() * 6, burst: 0, bt: 0, cover: 0, dead: false });
        }
      }
    }
    // ---- loot (the host rolls and judges; everyone else is told)
    const lootSend = () => { if (war.net && war.net.role === 'host') netSend({ t: 'lw', L: war.loot.map((l) => [l.id, l.k, l.r, r1n(l.x), r1n(l.z)]) }); };
    function warDropLoot(x, z, k, r) {
      if (!warAuth() || war.loot.length >= 40) return;
      const roll = k ? { k, r } : lootRoll(warRand);
      war.loot.push({ id: ++war.lootId, k: roll.k, r: roll.r, x, z }); lootSend();
    }
    /// Chests lying about at the start of each wave.
    function warScatterLoot(n) {
      if (!warAuth() || !(war.grows || war.foot)) return;
      for (let i = 0; i < 3 + n; i++) {
        let x = 0, z = 0, ok = false;
        for (let tries = 0; tries < 20 && !ok; tries++) { const a = warRand() * 6.28, r = Math.sqrt(warRand()) * war.R * 0.75; x = war.cx + Math.cos(a) * r; z = war.cz + Math.sin(a) * r; ok = onLand(x, z); }
        if (ok) warDropLoot(x, z);
      }
    }
    function warApplyLoot(k, r) {
      const n = lootAmount(k, r), nm = LOOT_KINDS.find((q) => q.k === k).name, rar = LOOT_RARITY[r].id;
      if (k === 'ammo') war.gun = Math.min(420, war.gun + n);
      else if (k === 'rocket') war.rpg = Math.min(8, war.rpg + n);
      else if (k === 'grenade') war.bombs = Math.min(8, war.bombs + n);
      else if (k === 'bandage') war.bandage = Math.min(15, war.bandage + n);
      else if (k === 'shield') war.shieldPots = Math.min(5, war.shieldPots + n);
      else if (k === 'medkit') war.medkit = Math.min(3, war.medkit + n);
      toast(`+${n} ${nm} (${rar})`, 1300); beep(r >= 2 ? 1100 : 760, 0.07, 'square', 0.05); 
    }
    function warLootStep() {
      if (!war.foot || war.dead || war.mapOpen) return;
      const p = war.tank.pos;
      for (const l of war.loot) {
        if (l.claimed || Math.hypot(l.x - p[0], l.z - p[2]) > 2.4 || Math.abs(groundAt(W, l.x, l.z) - p[1]) > 4) continue;
        l.claimed = true;
        if (warAuth()) { war.loot = war.loot.filter((q) => q !== l); warApplyLoot(l.k, l.r); lootSend(); if (war.net) netSend({ t: 'lx', id: l.id, w: netMyId }); }
        else netSend({ t: 'lp', id: l.id, p: netMyId });
      }
    }
    /// H bandage, J shield potion, K medkit.
    function warHeal(what) {
      if (!war || !war.foot || war.dead || war.healCool > 0) return;
      if (what === 'bandage') { if (war.bandage <= 0) { toast('No bandages', 900); return; } if (war.hp >= 75) { toast('Bandages heal up to 75: use a medkit', 1200); return; } war.bandage--; war.hp = Math.min(75, war.hp + 15); war.healCool = 1.0; toast('+15 health', 800); }
      else if (what === 'shield') { if (war.shieldPots <= 0) { toast('No shield potions', 900); return; } if (war.shield >= SOLDIER.shieldMax) { toast('Shield is full', 900); return; } war.shieldPots--; war.shield = Math.min(SOLDIER.shieldMax, war.shield + 50); war.healCool = 1.2; toast('+50 shield', 800); }
      else if (what === 'medkit') { if (war.medkit <= 0) { toast('No medkits', 900); return; } if (war.hp >= war.maxHp) { toast('Health is full', 900); return; } war.medkit--; war.hp = war.maxHp; war.healCool = 2.0; toast('Full health', 900); }
      noise(0.1, 0.12, 600);
    }
    function warSpawnWave() {
      war.wave++;
      const n = war.wave, d = war.d;
      if (war.grows && warAuth()) { const R2 = warFieldR(n); if (n > 1 && R2 > war.R + 1) { toast(`⬆ The battlefield grows: ${Math.round(R2)} m across the middle`, 3000); warFeed(`Battlefield radius now ${Math.round(R2)} m`); } war.R = R2; }
      if (n > 1 && war.arena.journey && warAuth()) {      // the next front is further along the road
        const [jx, jz] = journeyCenter(n, war.grows ? 1100 : 2600);
        const ahead = Math.hypot(jx - war.cx, jz - war.cz); war.cx = jx; war.cz = jz;
        toast(`ON TO THE NEXT FRONT: ${(ahead / 1000).toFixed(1)} km ahead`, 3500); warFeed(`The front moves on ${(ahead / 1000).toFixed(1)} km`);
      }
      const R = war.R;
      war.base = { x: war.cx + 520, z: war.cz + R * 0.6 };     // the home base: land (or fly low and slow) along its runway to rearm
      if (war.arena.archipelago) { war.base = { x: war.cx + 300, z: war.cz + R * 0.55, ship: true, deck: 16.6 }; }     // at sea, the home base is your carrier
      if (war.vehicle === 'plane' && war.arena.archipelago) {
        // Enemy warships out on the water: more each wave.
        for (let i = 0; i < Math.min(1 + Math.ceil(n / 2), 4); i++) {
          let x = 0, z = 0, ok = false;
          for (let t = 0; t < 40 && !ok; t++) { const a = warRand() * 6.28, r = R * (0.25 + 0.4 * warRand()); x = war.cx + Math.cos(a) * r; z = war.cz - Math.abs(Math.sin(a)) * r; ok = groundAt(W, x, z) <= WATER + 0.5 && groundAt(W, x + 80, z) <= WATER + 0.5 && groundAt(W, x - 80, z) <= WATER + 0.5; }
          if (!ok) continue;
          const K = WAR_KINDS.warship; war.ground.push({ nid: ++war.gidn, kind: 'warship', pos: [x, 0, z], heading: warRand() * 6.28, turret: 0, hp: K.hp * d.hp, maxHp: K.hp * d.hp, r: K.r, pts: K.pts, cool: 4, t: 0, burning: 0, lastHit: null, speed: 4, hunt: false, dead: false, ship: true });
        }
      }
      if (war.vehicle === 'plane' && !war.base.ship) clearTrees(W, war.base.x - 40, war.base.x + 90, war.base.z - 520, war.base.z + 520);
      if (n >= 3) achieve('wave3');
      const clusters = war.foot ? 0 : Math.min(2 + Math.ceil(n / 2), 5);
      for (let c = 0; c < clusters; c++) {
        let cx = 0, cz = 0, ok = false;
        // Bases stand in a row straight ahead of where you start: the first 1200 m away (800 m for a tank), then 500 to 700 m apart.
        const z0 = war.wave > 1 && war.arena.journey ? war.cz + R * 0.72 : (war.startZ ?? R * 0.72), first = war.vehicle === 'tank' ? 800 : 1200;
        for (let tries = 0; tries < 40 && !ok; tries++) {
          cx = war.cx + (warRand() - 0.5) * (tries < 20 ? 260 : 1200); cz = z0 - first - (c + (tries > 20 ? 0.5 * warRand() : 0)) * (500 + warRand() * 200);
          ok = onLand(cx, cz) && warDist(cx, cz) < R * 0.7;
        }
        if (!ok) { cx = war.cx + (warRand() - 0.5) * 600; cz = war.cz - R * 0.45; }
        const base = warRand() < 0.5 || (c === 0 && n === 1) ? 'base' : 'convoy';
        const place = (kind, dx, dz, heading = 0, forced = false) => {
          const x = cx + dx, z = cz + dz;
          if (!forced && !onLand(x, z)) return;
          const k = WAR_KINDS[kind], hunter = kind === 'tank' && war.npc && war.vehicle === 'tank';
          war.ground.push({ nid: ++war.gidn, kind, pos: [x, Math.max(groundAt(W, x, z), 0), z], heading, turret: heading, hp: k.hp * d.hp, maxHp: k.hp * d.hp, r: k.r, pts: k.pts, cool: (kind === 'aa' || kind === 'tank' ? 5 : 1) + warRand() * 2, t: 0, burning: 0, lastHit: null,
            speed: kind === 'truck' || (kind === 'tank' && base === 'convoy') ? 6 : 0, hunt: hunter, dead: false });
        };
        if (base === 'base') {
          place('bunker', 0, 0, warRand() * 6.28); place('fuel', 22, 6); place('fuel', -24, 10);
          for (let i = 0; i < Math.min(Math.ceil(n / 2) + (n > 2 ? 1 : 0), 4); i++) place('aa', (warRand() - 0.5) * 70, (warRand() - 0.5) * 70);
          for (let i = 0; i < Math.min(1 + Math.floor(n / 2), 3); i++) place('tank', (warRand() - 0.5) * 60, 16 + warRand() * 20, warRand() * 6.28);
        } else {
          const h = warRand() * 6.28, sx = Math.sin(h), sz = -Math.cos(h);
          for (let i = 0; i < 3 + Math.min(n, 3); i++) place('truck', sx * i * 14, sz * i * 14, h);
          place('tank', sx * -16, sz * -16, h); if (n >= 3) place('aa', sx * 50, sz * 50 + 10);
        }
      }
      // A city to bomb on every wave (the one you named, first): buildings in blocks, a couple of tower blocks and a factory.
      if (!war.foot && !war.driving) {
        const want = n === 1 && warCity ? warCity : CITY_NAMES[(n + Math.floor(warRand() * 1000)) % CITY_NAMES.length];
        let ccx = 0, ccz = 0, okc = false;
        for (let t = 0; t < 40 && !okc; t++) { const a = warRand() * 6.28, r = R * (0.25 + 0.3 * warRand()); ccx = war.cx + Math.cos(a) * r; ccz = war.cz - Math.abs(Math.sin(a)) * r; okc = onLand(ccx, ccz) && onLand(ccx + 60, ccz + 60) && onLand(ccx - 60, ccz - 60); }
        if (okc) {
          const k = (kind, dx, dz) => { const x = ccx + dx, z = ccz + dz, K = WAR_KINDS[kind]; if (!onLand(x, z)) return; war.ground.push({ nid: ++war.gidn, kind, pos: [x, Math.max(groundAt(W, x, z), 0), z], heading: Math.round(warRand() * 4) * Math.PI / 2, turret: 0, hp: K.hp * d.hp, maxHp: K.hp * d.hp, r: K.r, pts: K.pts, cool: 99, t: 0, burning: 0, lastHit: null, speed: 0, hunt: false, dead: false, city: want }); };
          const size = Math.min(3, 1 + Math.floor(n / 2));
          for (let i = -size; i <= size; i++) for (let j = -1; j <= 1; j++) { const r0 = warRand(); k(r0 < 0.12 ? 'tower' : 'house', i * 26 + (warRand() - 0.5) * 6, j * 30 + (warRand() - 0.5) * 6); }
          k('factory', (size + 1.6) * 26, 0); if (n > 2) k('tower', -(size + 1.4) * 26, 10);
          war.cityName = want; war.cityAt = [ccx, ccz];
          toast(`🏙 Target: the city of ${want}`, 3200); warFeed(`Bomb the city of ${want}`);
        }
      }
      if (war.foot) warSpawnInfantry(n, Math.min(1 + Math.floor((n + 1) / 2), 4), Math.min(2 + n, 7));
      else if (plane.rotor) warSpawnInfantry(n, Math.min(1 + Math.floor(n / 2), 3), Math.min(2 + n, 5));      // a helicopter also faces people on foot
      // A battlefield with no level ground for a base (it should not happen): put something down so the wave can be won.
      if (!war.ground.some((g) => !g.dead)) {
        const x = 0, z = -R * 0.5, k = WAR_KINDS.bunker;
        war.ground.push({ nid: ++war.gidn, kind: 'bunker', pos: [x, Math.max(groundAt(W, x, z), 0), z], heading: 0, turret: 0, hp: k.hp * d.hp, maxHp: k.hp * d.hp, r: k.r, pts: k.pts, cool: 3, t: 0, burning: 0, lastHit: null, speed: 0, dead: false });
      }
      const airN = war.npc && !war.foot ? Math.min(8, Math.round((warSide === 'versus' ? 2 + Math.floor(n / 1.5) : 1 + Math.floor((n + 1) / 2)) * d.count)) : 0;
      for (let i = 0; i < airN; i++) war.foes.push(warSpawnAircraft(warRand() < 0.5 ? 'su27' : 'f15', 'foe'));
      war.waveGround = war.ground.filter((g) => !g.dead).length; war.waveFighters = airN;
      war.waveClear = false; war.guided = 2; warScatterLoot(n);
      // Re-arm a little between waves.
      if (n > 1) {
        war.bombs = Math.min(war.L.bombs, war.bombs + Math.ceil(war.L.bombs * 0.5)); war.missiles = Math.min(war.L.missiles, war.missiles + Math.ceil(war.L.missiles * 0.5));
        war.gun = Math.min(war.L.gun, war.gun + Math.ceil(war.L.gun * 0.5)); war.flares = Math.min(war.L.flares, war.flares + 6);
        war.shells = Math.min(war.L.shells, war.shells + 15); if (war.L.rpg) war.rpg = Math.min(war.L.rpg, war.rpg + 2);
        war.hp = Math.min(war.maxHp, war.hp + war.maxHp * 0.25);
      }
      warFeed(`WAVE ${n}: ${war.ground.filter((g) => !g.dead).length} ground targets${airN ? ` · ${airN} fighter${airN === 1 ? '' : 's'}` : ''}`);
      war.briefingT = 4;
      toast(`WAVE ${n}`, 1800); beep(520, 0.15, 'square', 0.07);
      netSendWave();
    }

    function warFeed(text, share = true) { war.feed.unshift({ text, t: 6 }); war.feed.length = Math.min(war.feed.length, 5); if (share) netEvent({ k: 'feed', x: text }); }

    // ---- effects
    // ---- trees and fire: blasts throw trees about and set them alight; fire spreads from tree to tree
    function warIgnite(tr) {
      if (!tr || tr.broken || tr.fire || war.fires.length >= 40) return;
      const cx = (tr.min[0] + tr.max[0]) / 2, cz = (tr.min[2] + tr.max[2]) / 2;
      tr.fire = { t: 0, life: 9 + hash01(cx, cz, 7) * 7, em: 0, sp: 0, cx, cz, top: tr.max[1] };
      war.fires.push(tr);
    }
    function warBlastTrees(p, R) {
      if (!war || mode.id !== 'war' || R < 8 || len(sub(p, flight.pos)) > 3000) return;
      const { fly, burn } = blastTrees(W, p, R, Math.round(p[0] / 4) + Math.round(p[2] / 4) * 7);
      for (const t of fly) {
        const out = norm([t.cx - p[0], 0.001, t.cz - p[2]]), sp = 22 + hash01(t.cx, t.cz, 3) * 26;
        war.flyers.push({ pos: [t.cx, t.tree.max[1] * 0.5 + groundAt(W, t.cx, t.cz), t.cz], vel: [out[0] * sp, 18 + hash01(t.cx, t.cz, 4) * 22, out[2] * sp], q: [0, 0, 0, 1], w: [hash01(t.cx, t.cz, 5) * 6 - 3, hash01(t.cx, t.cz, 6) * 4 - 2, hash01(t.cx, t.cz, 9) * 6 - 3], t: 0, h: t.tree.max[1] - t.tree.min[1], hot: t.d < R * 0.25 });
        const g = t.tree; breakTree(W, g, true);
        for (let i = 0; i < 6; i++) puff('leaf', [t.cx, g.max[1] * 0.6, t.cz], jitter(14));
      }
      for (const t of burn) warIgnite(t.tree);
    }
    function warFireStep(dt) {
      if (!war) return;
      for (const tr of war.fires) {
        const F = tr.fire; if (!F) continue; F.t += dt; F.em -= dt; F.sp += dt;
        const y = groundAt(W, F.cx, F.cz), top = [F.cx, y + (F.top - y) * 0.75, F.cz];
        if (F.em <= 0) { F.em = 0.22; puff('fire', add(top, jitter(2.5)), [0, 5 + warRand() * 4, 0]); if (warRand() < 0.4) puff('soot', add(top, jitter(2)), [0, 5, 0]); }
        if (F.sp > 0.7) {       // the fire jumps to trees close by
          F.sp = 0;
          for (const n of treesNear(W, F.cx, F.cz, 17)) if (!n.tree.fire && hash01(n.cx, n.cz, Math.floor(F.t * 3) + 11) < 0.22) warIgnite(n.tree);
        }
        if (war.foot && !war.dead && Math.hypot(war.tank.pos[0] - F.cx, war.tank.pos[2] - F.cz) < 3.2) warHurt(5 * dt, 'fire');
        if (F.t > F.life) {
          tr.fire = null; for (let i = 0; i < 8; i++) puff('fire', add(top, jitter(4)), jitter(10)); for (let i = 0; i < 4; i++) puff('soot', add(top, jitter(3)), [0, 6, 0]);
          breakTree(W, tr, true);
        }
      }
      war.fires = war.fires.filter((t) => t.fire && !t.broken);
      for (const f of war.flyers) {
        f.t += dt; f.vel[1] -= 14 * dt; f.pos = add(f.pos, mul(f.vel, dt)); f.q = qnorm(qmul(f.q, qaxis(norm(f.w), len(f.w) * dt)));
        if (f.hot || f.t < 0.6) { if (warRand() < dt * 30) puff('fire', add(f.pos, jitter(2)), jitter(4)); if (warRand() < dt * 14) puff('soot', add(f.pos, jitter(2)), [0, 3, 0]); }
        const g = groundAt(W, f.pos[0], f.pos[2]);
        if (f.pos[1] < g + 0.6 || f.t > 6) {
          f.dead = true; for (let i = 0; i < 5; i++) puff('dirt', [f.pos[0], g + 0.5, f.pos[2]], jitter(8)); for (let i = 0; i < 6; i++) puff('leaf', add(f.pos, jitter(3)), jitter(10));
          if (f.hot) for (const n of treesNear(W, f.pos[0], f.pos[2], 9)) if (hash01(n.cx, n.cz, 13) < 0.4) warIgnite(n.tree);
        }
      }
      war.flyers = war.flyers.filter((f) => !f.dead);
    }
    function warBoom(p, size = 1) {
      warBlastTrees(p, 22 * size);
      const dist = len(sub(p, flight.pos));
      puff('boom', p, v3());
      for (let i = 0; i < Math.round(12 * size); i++) puff('fire', add(p, jitter(7 * size)), add([0, 6 + warRand() * 10, 0], jitter(14)));
      for (let i = 0; i < Math.round(10 * size); i++) puff('clod', add(p, jitter(5 * size)), add([0, 10 + warRand() * 16, 0], jitter(22)));
      for (let i = 0; i < Math.round(6 * size); i++) puff('soot', add(p, jitter(6 * size)), [0, 4 + warRand() * 4, 0]);
      for (let i = 0; i < Math.round(8 * size); i++) puff('spark', p, jitter(40));
      noise(1.4, clamp(0.75 * (1 - dist / 7000), 0.04, 0.8), 150 + 60 * size);
      if (dist < 1100) shakeKick = Math.max(shakeKick, clamp(1 - dist / 1100, 0, 1) * 0.9 * size);
    }
    function warCrater(p, r) {
      war.craters.push({ p: [p[0], groundAt(W, p[0], p[2]) + 0.25, p[2]], r: r * (0.8 + warRand() * 0.4) });
      if (war.craters.length > 60) war.craters.shift();
    }

    // ---- damage
    function warHurt(amount, why, by = 'npc') {
      if (war.dead || flight.crashed) return;
      if (war.foot && war.shield > 0) { const ab = Math.min(war.shield, amount); war.shield -= ab; amount -= ab; war.flash = Math.min(1, war.flash + 0.15); if (amount <= 0) { noise(0.15, 0.2, 1400); return; } }
      war.hp = Math.max(0, war.hp - amount);
      war.flash = Math.min(1, war.flash + clamp(amount / 40, 0.25, 1));
      shakeKick = Math.max(shakeKick, clamp(amount / 40, 0.2, 0.8));
      noise(0.25, 0.3, 900);
      if (war.hp <= 0) {
        war.dead = true;
        if (war.net) {          // a shared battle: it blows up, the others are told, and you are back in a few seconds
          warBoom(war.vehicle === 'tank' ? war.tank.pos : flight.pos, 1.3); war.flash = 1; war.net.respawnT = 5; toast(`💥 DESTROYED: ${why}`, 2500);
          netSend({ t: 'k', id: netMyId, v: netMyId, by }); netGameMsg({ t: 'k', id: netMyId, v: netMyId, by });
          return;
        }
        if (war.ejected && war.vehicle === 'tank') { toast(`☠ PILOT DOWN: ${why} · new jet coming`, 2600); warBoom(war.tank.pos, 0.9); war.flash = 1; war.selfDestructT = 2; return; }
        if (war.vehicle === 'tank') { toast(war.foot ? `☠ YOU WERE KILLED: ${why}` : `💥 TANK DESTROYED: ${why}`, 3000); warBoom(war.tank.pos, 1.5); war.flash = 1; war.endT = 2.4; return; }
        toast(`💥 SHOT DOWN: ${why}`, 3000);
        flight.loseWing(warRand() < 0.5 ? 'L' : 'R', 'war', 'root');
        if (warRand() < 0.6) flight.breakTail();
        war.flash = 1;
      }
    }
    /// End the current vehicle without throwing away score or wave progress. Shared players use normal respawn and kill reporting.
    function warSelfDestruct() {
      if (!war || war.dead) return;
      if (war.net) { warHurt(war.hp, 'self-destruct', 'p'); return; }
      const p = war.vehicle === 'tank' ? war.tank.pos : flight.pos;
      warBoom(p, 1.1); war.dead = true; war.hp = 0; war.flash = 1; war.selfDestructT = 1.25;
      toast('Sortie ended · returning to the same wave', 1800);
    }
    /// Eject: the jet goes down in flames on its own and you float down on a parachute, then fight on foot with a rifle.
    /// (Also used when the jet comes to rest after a crash you walked away from.)
    function warEject(fromCrash = false) {
      if (!war || screen !== 'fly') return;
      if (mode.id !== 'war') return;
      if (war.vehicle !== 'plane') { toast(war.ejected ? 'You are already on foot' : 'Eject is for the jets: you are not in one', 1600); return; }
      if (war.dead) { toast('Too late to eject', 1200); return; }
      if (flight.crashed && !fromCrash) { toast('The jet has already crashed', 1400); return; }
      const pos = flight.pos.slice(), ground = groundAt(W, pos[0], pos[2]), h = flight.heading;
      if (!fromCrash && !war.net) {
        const w = [(warRand() - 0.5) * 3, (warRand() - 0.5) * 3, (warRand() - 0.5) * 3 + 1.5];
        war.foes.push({ nid: 0, id: plane.id, spec: plane, role: 'wreck', pos: pos.slice(), heading: h, pitch: 0, speed: flight.speed, bank: 0, vel: flight.vel.slice(), q: flight.q.slice(), hp: 0, maxHp: 1,
          state: 'fall', t: 0, w, cool: 0, burstLeft: 0, gunT: 0, mslCool: 99, target: null, retargetT: 0, warnMsl: null, lastHit: null });
      }
      for (let i = 0; i < 8; i++) puff('fire', add(pos, jitter(3)), jitter(10));
      noise(0.5, 0.25, 700);
      const body = new SoldierBody([pos[0], 0, pos[2]], h);
      body.air = fromCrash ? 0 : Math.max(0.5, pos[1] - ground);
      body.vel = [flight.vel[0] * 0.15, 0, flight.vel[2] * 0.15];
      body.pos[1] = ground + body.air;
      netResetWreck(); flight = new Flight(plane);
      war.ejected = true; war.vehicle = 'tank'; war.foot = true; war.tank = body;
      war.L = { gun: SOLDIER.reserve, bombs: SOLDIER.grenades, missiles: 0, flares: 0, hp: SOLDIER.hp, stick: 0.5, shells: 0 };
      war.hp = war.maxHp = SOLDIER.hp; war.gun = war.L.gun; war.bombs = war.L.bombs; war.missiles = 0; war.flares = 0; war.shells = 0;
      war.mag = SOLDIER.mag; war.reloadT = 0; war.zoomI = 0; war.flash = 0; war.pullUp = false; stoppedT = 0; war.rpg = SOLDIER.rpg; war.weapon = 'rifle'; war.shield = SOLDIER.shield;
      flight.reset([pos[0], body.pos[1] + SOLDIER.eye, pos[2]], h, 0, true);
      camMode = 0; buildWbar();
      toast(fromCrash ? '🪂 You climbed out of the wreck: fight on foot' : '🪂 Ejected: the jet is lost. Land and fight on foot with your rifle', 3200);
    }
    /// E: in a helicopter that has landed and stopped, step out as a soldier (the helicopter stays parked); on foot beside it, climb back in.
    function warHeliExitEnter() {
      if (!war || war.dead || screen !== 'fly' || mode.id !== 'war') return;
      if (war.driving) {
        const v = war.tank;
        if (Math.abs(v.speed) > 5) { toast('Stop the van first', 1200); return; }
        const h = v.heading, body = new SoldierBody([v.pos[0] + Math.cos(h) * 4, 0, v.pos[2] + Math.sin(h) * 4], h);
        body.pos[1] = groundAt(W, body.pos[0], body.pos[2]); body.dropped = true; body.landed = true;
        war.van = { pos: v.pos.slice(), q: v.q.slice(), heading: h };
        war.driving = false; war.foot = true; war.tank = body;
        flight.reset([body.pos[0], body.pos[1] + SOLDIER.eye, body.pos[2]], h, 0, true); camMode = 0; buildWbar();
        if (war.net) netSend({ t: 'vn', id: netMyId, on: 1, p: war.van.pos.map(r1n), q: war.van.q.map((x) => Math.round(x * 1000) / 1000) });
        toast('Out of the van', 1200); return;
      }
      if (war.foot && war.van && !(war.heli && len(sub(war.heli.pos, war.tank.pos)) < 14)) {
        if (len(sub(war.van.pos, war.tank.pos)) > 10) { toast('Walk up to the van first', 1400); return; }
        const h = war.van.heading, v = new VanBody([war.van.pos[0], 0, war.van.pos[2]], h);
        v.pos[1] = groundAt(W, v.pos[0], v.pos[2]) + 0.2;
        war.tank = v; war.foot = false; war.driving = true; war.van = null; camMode = 0;
        flight.reset([v.pos[0], v.pos[1] + 2.2, v.pos[2]], h, 0, true); buildWbar();
        if (war.net) netSend({ t: 'vn', id: netMyId, on: 0 });
        toast('In the van: W/S drive, A/D steer, Shift boost, E to get out', 2600); return;
      }
      if (war.vehicle === 'plane' && plane.rotor) {
        const ground = groundAt(W, flight.pos[0], flight.pos[2]);
        if (!(flight.onGround || flight.pos[1] - ground < (plane.gear || 1.5) * (plane.scale || 1) + 1.2) || flight.speed > 3) { toast('Land the helicopter and stop first, then press E', 2000); return; }
        const h = flight.heading, pos = flight.pos.slice();
        war.heliSave = { hp: war.hp, maxHp: war.maxHp, L: war.L, gun: war.gun, bombs: war.bombs, missiles: war.missiles, flares: war.flares };
        war.heli = { id: plane.id, pos, q: flight.q.slice(), heading: h };
        const body = new SoldierBody([pos[0] + Math.cos(h) * 7, 0, pos[2] + Math.sin(h) * 7], h);
        body.pos[1] = groundAt(W, body.pos[0], body.pos[2]);
        netResetWreck(); flight = new Flight(plane);
        war.ejected = true; war.vehicle = 'tank'; war.foot = true; war.tank = body;
        war.L = { gun: SOLDIER.reserve, bombs: SOLDIER.grenades, missiles: 0, flares: 0, hp: SOLDIER.hp, stick: 0.5, shells: 0, rpg: SOLDIER.rpg };
        war.hp = war.maxHp = SOLDIER.hp; war.gun = war.L.gun; war.bombs = war.L.bombs; war.missiles = 0; war.flares = 0; war.shells = 0;
        war.mag = SOLDIER.mag; war.reloadT = 0; war.zoomI = 0; war.rpg = SOLDIER.rpg; war.weapon = 'rifle'; war.shield = SOLDIER.shield; war.guiding = false; war.guideM = null; war.pullUp = false; stoppedT = 0;
        flight.reset([body.pos[0], body.pos[1] + SOLDIER.eye, body.pos[2]], h, 0, true);
        camMode = 0; buildWbar();
        if (war.net) netSend({ t: 'hl', id: netMyId, k: war.heli.id, p: pos.map(r1n), q: war.heli.q.map((v) => Math.round(v * 1000) / 1000), on: 1 });
        toast('You stepped out. Rifle and RPG ready: E near the helicopter climbs back in', 3000);
      } else if (war.foot && war.heli) {
        if (len(sub(war.heli.pos, war.tank.pos)) > 14) { toast('Walk up to the helicopter first', 1400); return; }
        const sv = war.heliSave, h = war.heli.heading, p = war.heli.pos;
        netResetWreck(); flight = new Flight(plane);
        war.ejected = false; war.vehicle = 'plane'; war.foot = false; war.tank = null; camMode = 0;
        Object.assign(war, { L: sv.L, hp: sv.hp, maxHp: sv.maxHp, gun: sv.gun, bombs: sv.bombs, missiles: sv.missiles, flares: sv.flares, weapon: 'rifle' });
        flight.reset([p[0], p[1] + 2, p[2]], h, 6, false); flight.sturdy = true; flight.overG = warOverG;
        war.ap = { hdg: h, alt: p[1] + 2, spd: 20, i: 0 };
        war.heli = null; buildWbar();
        if (war.net) netSend({ t: 'hl', id: netMyId, on: 0 });
        toast('Back in the helicopter', 1600);
      } else if (war.foot) toast('Your helicopter is not here', 1200);
    }
    /// The van that waits beside you once you have landed.
    function warSpawnVan() {
      const t = war.tank; t.landed = true;
      const h = t.heading, x = t.pos[0] + Math.cos(h) * 9, z = t.pos[2] + Math.sin(h) * 9;
      const ok = groundAt(W, x, z) > WATER + 1.5 && Math.hypot(x, z) < war.R;
      const px = ok ? x : t.pos[0] - Math.cos(h) * 9, pz = ok ? z : t.pos[2] - Math.sin(h) * 9;
      war.van = { pos: [px, groundAt(W, px, pz) + 0.2, pz], q: qheading(h, 0), heading: h };
      if (war.net) netSend({ t: 'vn', id: netMyId, on: 1, p: war.van.pos.map(r1n), q: war.van.q.map((v) => Math.round(v * 1000) / 1000) });
      buildWbar(); toast('Landed. Your van is beside you: walk to it and press E', 3200);
    }
    /// R in a battle: you are straight back in your vehicle in the same wave (same score, same kills, same wave and field). It never
    /// restarts the battle for anyone. On foot, R reloads instead: use the pause menu's Respawn.
    function warQuickRespawn() {
      if (!war || screen !== 'fly' || mode.id !== 'war' || war.mapOpen) return;
      war.heli = null; war.guiding = false; war.guideM = null; war.selfDestructT = 0; war.endT = 0;
      if (war.net) { war.net.respawnT = 0; netRespawn(); } else warSoloRespawn();
      war.warn = ''; paused = false; stoppedT = 0;
      toast('Back in the fight: same wave, same score', 1600);
    }
    function warSoloRespawn() {
      if (!war || war.net) return;
      if (war.ejected) {      // a pilot who was lost on foot gets a new jet, back in the same wave
        war.heli = null;
        war.ejected = false; war.vehicle = 'plane'; war.foot = false; war.tank = null; camMode = 0;
        war.L = { ...warLoadout(plane), shells: 0 }; war.maxHp = war.L.hp; buildWbar();
      }
      const R = war.R, spot = { x: war.cx, z: war.cz + R * 0.72, heading: 0 };
      netResetWreck(); flight = new Flight(plane); heliColl = 0;
      war.dead = false; war.selfDestructT = 0; war.hp = war.maxHp; war.gun = war.L.gun; war.bombs = war.L.bombs;
      war.missiles = war.L.missiles; war.flares = war.L.flares; war.shells = war.L.shells; war.flash = 0;
      if (war.vehicle === 'tank') {
        if (war.driving) { war.driving = false; war.foot = warVeh === 'soldier'; war.van = null; } war.tank = warBody(spot);
        if (war.foot) { war.mag = SOLDIER.mag; war.reloadT = 0; war.zoomI = 0; war.rpg = SOLDIER.rpg; war.weapon = 'rifle'; war.shield = SOLDIER.shield; }
        war.tank.pos[1] = groundAt(W, spot.x, spot.z) + 0.2;
        flight.reset([spot.x, war.tank.pos[1] + 2.2, spot.z], spot.heading, 0, true);
      } else {
        flight.reset([spot.x, warStartAlt(), spot.z], spot.heading, plane.cruise, false);
        flight.sturdy = true; flight.overG = warOverG;
        war.ap = { hdg: spot.heading, alt: flight.pos[1], spd: plane.cruise * 1.05, i: 0 };
      }
      toast(`Back in wave ${war.wave} · ${war.kills} kills kept`, 1800);
    }
    function warScore(g, who) {
      war.score += g.pts; war.kills++;
      if (who === 'p') { achieve('warfirst'); if (g.name === 'Fighter') achieve('splash'); war.run = (war.run || 0) + 1; war.runT = 3; if (war.run >= 4) achieve('carpet'); }
      warFeed(`${who === 'f' ? 'Wingman destroyed' : 'Destroyed'} ${g.name || WAR_KINDS[g.kind].name}  +${g.pts}`);
      if (who !== 'f') { beep(880, 0.08, 'square', 0.06); setTimeout(() => beep(1320, 0.1, 'square', 0.06), 70); }
    }
    function warDamageGround(g, dmg, who) {
      if (g.dead || dmg <= 0 || !warAuth()) return;
      g.hp -= dmg; g.lastHit = who;
      if (g.hp <= 0) {
        g.dead = true; g.burning = 20 + warRand() * 20; warScore(g, who);
        if (INF.has(g.kind) && warRand() < 0.45) warDropLoot(g.pos[0], g.pos[2]);
        if (INF.has(g.kind)) { g.burning = 0; for (let i = 0; i < 3; i++) puff('dirt', add(g.pos, [0, 1, 0]), jitter(3)); } else warBoom(g.pos, g.kind === 'fuel' ? 1.8 : g.kind === 'bunker' ? 1.3 : 0.8);
        if (g.kind === 'fuel') warBlast(g.pos, 70, 400, 'x');       // a fuel depot takes what is near it with it
      }
    }
    function warDamageAir(a, dmg, who) {
      if (a.state !== 'fly' || dmg <= 0 || !warAuth()) return;
      a.hp -= dmg; a.lastHit = who;
      if (a.hp <= 0) {
        a.state = 'fall'; a.t = 0; a.w = [(warRand() - 0.5) * 3, (warRand() - 0.5) * 3, (warRand() - 0.5) * 3 + 2];
        if (a.role === 'foe') { a.pts = 300; a.name = 'Fighter'; warScore(a, a.lastHit); toast('✈ Splash one!', 1400); } else { warFeed('Your wingman is down'); toast('Your wingman was shot down', 2200); }
        for (let i = 0; i < 10; i++) puff('fire', add(a.pos, jitter(4)), jitter(14));
      }
    }
    /// A blast: hits every ground target, aircraft, your wingman and you within its reach.
    function warBlast(p, R, power, who, fl = {}) {
      warBlastTrees(p, R);
      // Your side's blasts hurt the enemy (decided by the host); the enemy's (missiles) hurt you and the other players; a fuel depot going up hurts everyone.
      if (who !== 'e' && !fl.noNpc && !fl.vis) {
        for (const g of war.ground) if (!g.dead) warDamageGround(g, WAR.blastDamage(len(sub(add(g.pos, [0, 1, 0]), p)), R, power), who);
        for (const a of war.foes) if (a.state === 'fly') warDamageAir(a, WAR.blastDamage(len(sub(a.pos, p)), R, power), who);
      }
      if (war.friend && war.friend.state === 'fly' && who !== 'f') warDamageAir(war.friend, WAR.blastDamage(len(sub(war.friend.pos, p)), R, power), who);
      if (fl.vis) return;
      const hurtYou = WAR.blastDamage(len(sub(flight.pos, p)), R, power);
      if (who === 'e') warHurt(hurtYou * 0.6, 'enemy missile', 'npc');
      else if (who === 'r') { if (netFight()) warHurt(hurtYou * 0.6, 'enemy player', fl.by); }
      else if (who !== 'f') warHurt(hurtYou * 0.5, 'caught in a blast', who === 'p' ? netMyId : 'npc');
      // On the host: an enemy blast near another player hurts them (it tells them).
      if (who === 'e' && war.net && war.net.role === 'host') for (const o of war.net.others.values()) if (o.alive && o.shown) netHurtRemote(o.id, WAR.blastDamage(len(sub(o.shown, p)), R, power) * 0.6, 'enemy missile');
    }

    // ---- weapons
    const warMuzzle = () => { const { f } = flight.axes(); return add(flight.pos, mul(f, -plane.nose * (plane.scale || 1) * 0.9)); };
    function warShoot(owner, pos, dir, vel, err, dmgAir, dmgGround, speed = WAR.GUN.speed, extra = null) {
      const d = norm(add(dir, [(warRand() - 0.5) * err * 2, (warRand() - 0.5) * err * 2, (warRand() - 0.5) * err * 2]));
      const b = { owner, pos: pos.slice(), vel: add(vel, mul(d, speed)), t: 0, dmgAir, dmgGround };
      if (extra) Object.assign(b, extra);
      if (war.net && owner === 'p') { b.noNpc = !warAuth(); if (b.shell) netSend({ t: 'sh', id: netMyId, p: b.pos.map(r1n), v: b.vel.map(r1n) }); }
      war.bullets.push(b);
      return b;
      if (war.bullets.length > 400) war.bullets.shift();
    }
    /// A tank shell bursts where it lands (or hits): it hurts everything within a few metres.
    function warShellBurst(b) { warBoom(b.pos, 0.7); warCrater(b.pos, 4); warBlast(b.pos, 14, 170, b.owner, b); }
    function warFireMissile(owner, pos, vel, dir, target, quiet = false) {
      const m = { owner, pos: add(pos, [0, -1.2, 0]), vel: add(vel, mul(dir, 20)), t: 0, target, trail: 0, drop: true };
      if (war.net && owner === 'p') { m.noNpc = !warAuth(); if (!quiet) netSend({ t: 'm', id: netMyId, p: m.pos.map(r1n), v: m.vel.map(r1n), tg: target && target.ref ? target.ref.nid : 0 }); }
      war.missilesAir.push(m);
      noise(0.7, 0.25, 1800);
      return m;
    }
    /// The nearest enemy (a fighter, or a ground target that is still alive) within `range` of `from`, for the helpers to aim at.
    function warNearestEnemy(from, range) {
      let best = null, bd = range;
      for (const a of war.foes) { if (a.state !== 'fly') continue; const dd = len(sub(a.pos, from)); if (dd < bd) { bd = dd; best = { pos: a.pos, vel: a.vel }; } }
      for (const g of war.ground) { if (g.dead) continue; const dd = len(sub(g.pos, from)); if (dd < bd) { bd = dd; best = { pos: add(g.pos, [0, 1.5, 0]), vel: v3() }; } }
      return best;
    }
    /// What the keys and the mouse mean in a battle: a tank is driven and its turret aimed; Automatic flying turns and climbs for you.
    function warInput(raw, dt) {
      war.lastRaw = raw;
      if (war.guiding && war.vehicle === 'plane' && !war.dead) {
        // The plane flies itself straight and level while you steer the missile.
        if (flight.arcade) return { ...raw, roll: 0, pitch: 0, yaw: 0 };
        const o = planeAssist(flight, war.ap, { turn: 0, climb: 0 }, dt, W, { floor: 200 });
        return { ...raw, ...o };
      }
      if (war.vehicle !== 'tank') {
        // Easy and Automatic fly arcade style; Pro keeps the full aerodynamic model.
        const R = ARCADE_RATES[plane.id];
        flight.arcade = war.assist !== 'pro' && R ? (war.assist === 'auto' ? { ...R, turn: R.turn * 0.7 } : R) : null;
      }
      if (chatOpen && !war.dead) {
        // Chatting: a plane flies itself in a slow, gentle circle around the middle of the battlefield; anything on the ground stands still.
        if (war.vehicle === 'plane') {
          if (plane.rotor) return { ...raw, pitch: 0, roll: 0, yaw: 0 };
          const st = war.ap, R = war.arena.R;
          st.spd = plane.stall * 1.5;
          if (Math.hypot(flight.pos[0], flight.pos[2]) > R * 0.55) st.hdg = Math.atan2(-flight.pos[0], flight.pos[2]); else st.hdg = wrapPi(st.hdg + 0.12 * dt);
          return { ...raw, ...planeAssist(flight, st, { turn: 0, climb: 0 }, dt, W, { floor: 220 }) };
        }
        return { drive: 0, steer: 0, aimX: 0, aimY: 0, boost: false, crouch: false, lookScale: 1 };
      }
      if (war.driving) { return { drive: raw.throttle, steer: clamp(raw.yaw + raw.roll, -1, 1), aimX: 0, aimY: 0, boost: !!raw.boost || keys.has('Shift') }; }
      if (war.foot) {
        // Not scoped: the cursor is the crosshair and the view turns only when the cursor is near the edge of the screen.
        // Scoped: the crosshair stays in the middle and the cursor's distance from the middle turns the view slowly.
        let aimX = raw.roll, aimY = invert ? -raw.pitch : raw.pitch;
        if (SOLDIER.zoom[war.zoomI] === 1) {
          const edge = (v, lim) => Math.sign(v) * Math.pow(clamp((Math.abs(v) - lim) / (1 - lim), 0, 1), 1.3);
          const kx = (keys.has('ArrowRight') ? 1 : 0) - (keys.has('ArrowLeft') ? 1 : 0), ky = (keys.has('ArrowUp') ? 1 : 0) - (keys.has('ArrowDown') ? 1 : 0);
          aimX = clamp(kx + (mouse.in && mouse.w ? edge(mouse.px / (mouse.w / 2), 0.62) : 0), -1, 1);
          aimY = clamp((invert ? -ky : ky) + (mouse.in && mouse.h ? edge(-mouse.py / (mouse.h / 2), 0.62) * (invert ? -1 : 1) : 0), -1, 1);
        }
        return { drive: raw.throttle, steer: raw.yaw, aimX, aimY, boost: !!raw.boost || keys.has('Shift'), crouch: keys.has('Control') || keys.has('v'), jump: keys.has(' '), lookScale: 1 / SOLDIER.zoom[war.zoomI] };
      }
      if (war.vehicle === 'tank') {
        const t = war.tank;
        let aimX = raw.roll, aimY = invert ? -raw.pitch : raw.pitch;
        if (war.assist !== 'pro') {
          // The turret looks after itself: always in Automatic, and in Easy whenever you are not aiming it yourself.
          const tgt = warNearestEnemy(t.pos, 1800);
          if (tgt && (war.assist === 'auto' || (Math.abs(aimX) < 0.05 && Math.abs(aimY) < 0.05))) {
            const sol = tankAimAt(t, tgt.pos, tgt.vel);
            aimX = clamp(wrapPi(sol.yaw - t.turret) * 3, -1, 1); aimY = clamp((sol.pitch - t.gun) * 4, -1, 1);
          }
        }
        return { drive: raw.throttle, steer: raw.yaw, aimX, aimY, boost: !!raw.boost };
      }
      if (war.assist === 'auto' && !plane.rotor) {
        const st = war.ap, R = war.R;
        st.spd = clamp(st.spd + raw.throttle * 40 * dt, plane.stall * 1.35, plane.max * 0.85);
        const agl = flight.pos[1] - groundAt(W, flight.pos[0], flight.pos[2]);
        // Keep holding the stick down near the ground and the floor lets go: you can fly into it (and crash) if you mean to.
        const climbIn = invert ? -raw.pitch : raw.pitch;
        war.diveHold = climbIn < -0.4 && agl < 60 ? (war.diveHold || 0) + dt : 0;
        const o = planeAssist(flight, st, { turn: raw.roll, climb: climbIn }, dt, W, { floor: war.diveHold > 1 ? -60 : war.overBase ? (war.base && war.base.ship ? 22 : 3) : 30, turnRate: 1.15, climbRate: 95, lead: 120, vsMax: 55 });
        war.pullUp = agl < 45 && flight.vel[1] < -4 && agl / -flight.vel[1] < 1.2 && raw.pitch >= 0;      // holding the stick forward lets you fly into the ground
        if (war.pullUp) o.pitch = Math.max(o.pitch || 0, 0.22);
        // Leaving the battlefield: it turns back by itself.
        if (warDist(flight.pos[0], flight.pos[2]) > R * 0.8) st.hdg = Math.atan2(-(flight.pos[0] - war.cx), flight.pos[2] - war.cz);
        return { ...raw, ...o };
      }
      if (war.assist === 'easy' && !plane.rotor) {
        const agl = flight.pos[1] - groundAt(W, flight.pos[0], flight.pos[2]);
        war.pullUp = agl < 45 && flight.vel[1] < -4 && agl / -flight.vel[1] < 1.2 && raw.pitch >= 0;
        if (war.pullUp) return { ...raw, pitch: Math.max(raw.pitch, 0.18) };
      }
      war.pullUp = false;
      if (war.assist === 'pro' && !plane.rotor) {
        // Pro: past the edge the plane turns itself back to the middle (hands back at 80% of the radius).
        const rr = warDist(flight.pos[0], flight.pos[2]), Rw = war.R;
        // It takes over at 85% of the radius when you are heading outwards (earlier for a fast plane), and hands back once you
        // point inwards again, or are well inside.
        const outward = (flight.vel[0] * (flight.pos[0] - war.cx) + flight.vel[2] * (flight.pos[2] - war.cz)) / (rr || 1);
        const lead = Math.min(0.12, Math.hypot(flight.vel[0], flight.vel[2]) / Rw * 0.9);
        if (rr > Rw * (0.85 - lead) && outward > 5) war.autoBack = true;
        else if (rr < Rw * 0.75 || (outward < -20 && rr < Rw * 0.9)) { war.autoBack = false; war.backDir = 0; }
        if (war.autoBack && !war.dead) {
          let err = wrapPi(Math.atan2(-(flight.pos[0] - war.cx), flight.pos[2] - war.cz) - flight.heading);
          if (!war.backDir) war.backDir = err >= 0 ? 1 : -1;
          if (Math.abs(err) > 2.4) err = war.backDir * Math.abs(err);          // pointing straight away: pick one way and keep to it
          else war.backDir = err >= 0 ? 1 : -1;
          const bankT = clamp(err * 1.5, -1.1, 1.1), roll = clamp((bankT - flight.bank) * 2.5, -1, 1);
          war.warn = 'AUTO-TURN: RETURNING TO THE BATTLEFIELD'; war.warnT = 0.4;
          return { ...raw, roll: roll * AP_SIGN.roll, yaw: 0, pitch: clamp(raw.pitch * 0.3 + Math.abs(Math.sin(flight.bank)) * 0.3 * AP_SIGN.pitch, -0.4, 0.6) };
        }
      }
      return raw;
    }
    /// Drives the tank for one step and lets the rest of the game follow it: `flight` stands in for the tank (where it is,
    /// and the way its turret looks), so the camera, the enemies and the sights all work without knowing about tanks.
    function tankDrive(dt, inp) {
      const t = war.tank;
      if (war.mapOpen) { t.pos[1] = groundAt(W, t.pos[0], t.pos[2]) + t.air; flight.pos = add(t.pos, [0, t.eye, 0]); flight.vel = [0, 0, 0]; flight.q = qheading(t.turret, t.gun); flight.crashed = false; flight.onGround = true; flight.events.length = 0; return; }
      t.step(dt, inp, W, war.R * 1.05, [war.cx, war.cz]);
      if (war.driving) { t.turret = t.heading; t.gun = 0.12; }
      else if (war.foot && t.dropped && !t.landed && t.air <= 0) warSpawnVan();
      flight.pos = add(t.pos, [0, war.foot ? t.eye : 2.2, 0]); flight.vel = t.vel.slice(); flight.q = qheading(t.turret, t.gun);
      flight.crashed = false; flight.onGround = true; flight.events.length = 0;
    }
    /// Easy and Automatic nudge your shots towards the enemy nearest the sights.
    function warAssistDir(dir, range = 1400) {
      if (war.assist === 'pro') return dir;
      const from = warMuzzle(); let best = null, ba = 0.12;      // about 7 degrees either side
      for (const a of war.foes) { if (a.state !== 'fly') continue; const to = sub(a.pos, from), dd = len(to); if (dd > range || dd < 60) continue; const ang = Math.acos(clamp(dot(dir, mul(to, 1 / dd)), -1, 1)); if (ang < ba) { ba = ang; best = { pos: a.pos, vel: a.vel }; } }
      for (const g of war.ground) { if (g.dead) continue; const gp = add(g.pos, [0, 1.5, 0]), to = sub(gp, from), dd = len(to); if (dd > range || dd < 60) continue; const ang = Math.acos(clamp(dot(dir, mul(to, 1 / dd)), -1, 1)); if (ang < ba) { ba = ang; best = { pos: gp, vel: v3() }; } }
      if (!best) return dir;
      const lead = WAR.leadPoint(from, flight.vel, best.pos, best.vel, WAR.GUN.speed);
      if (!lead) return dir;
      return norm(add(mul(dir, 0.35), mul(norm(sub(add(lead.point, [0, 0.5 * WAR.G * lead.t * lead.t, 0]), from)), 0.65)));
    }
    function warTankFire(dt) {
      const t = war.tank, cannon = keys.has('Enter') || keys.has(' ') || warPad.gun, mg = keys.has('z') || keys.has('b') || warPad.bomb;
      if (cannon && t.reload <= 0 && war.shells > 0) {
        t.reload = TANK.reload; war.shells--;
        warShoot('p', t.muzzle(), t.aim(), t.vel, 0.0012, 90, 150, TANK.shell, { shell: true });
        noise(0.55, 0.4, 200); shakeKick = Math.max(shakeKick, 0.25);
        if (war.shells === 0) toast('Out of shells (the machine gun still works)', 1600);
      }
      if (mg && war.gun > 0) {
        war.gunT -= dt;
        while (war.gunT <= 0 && war.gun > 0) { war.gunT += 0.085; war.gun--; warShoot('p', add(t.muzzle(), [0, -0.2, 0]), t.aim(), t.vel, 0.012, 6, 3); if (war.gun % 3 === 0) noise(0.06, 0.12, 1500); }
      } else war.gunT = Math.min(0, war.gunT);
    }
    /// The rifle: automatic, 30 rounds a magazine, a long scope with bullet drop and a sway that settles when still or crouched.
    function warReload() {
      if (!war || !war.foot || war.dead || war.reloadT > 0 || war.mag >= SOLDIER.mag || war.gun <= 0) return;
      war.reloadT = SOLDIER.reloadTime; toast('Reloading…', 900); noise(0.15, 0.15, 900);
    }
    function warScope() {
      if (!war || !war.foot || war.dead) return;
      war.zoomI = (war.zoomI + 1) % SOLDIER.zoom.length; noise(0.05, 0.1, 1200);
      if (war.zoomI) toast(`Scope ${SOLDIER.zoom[war.zoomI]}x`, 700);
    }
    function warGrenade() {
      if (!war || !war.foot || war.dead || war.bombs <= 0 || (war.grenT || 0) > 0) return;
      const t = war.tank, a = warFootAim(), g = { owner: 'p', pos: t.muzzle(), vel: add(t.vel, [a[0] * 22, a[1] * 22 + 5, a[2] * 22]), t: 0, gren: true, fuse: 2.4, noNpc: !!war.net && !warAuth() };
      war.bombs--; war.grenT = 0.8; war.bombsAir.push(g);
      if (war.net) netSend({ t: 'b', id: netMyId, p: g.pos.map(r1n), v: g.vel.map(r1n), g: 1 });
      noise(0.1, 0.12, 500); if (war.bombs === 0) toast('Last grenade thrown', 1200);
    }
    /// The direction of a soldier's shot: through the cursor when not scoped, straight ahead in the scope.
    function warFootAim() {
      const t = war.tank, z = SOLDIER.zoom[war.zoomI];
      if (z !== 1 || !mouse.in || !mouse.w) return t.aim();
      const { f, r, u } = flight.axes(), tH = Math.tan(31 * DEG), nx = mouse.px / (mouse.w / 2), ny = -mouse.py / (mouse.h / 2);
      return norm(add(f, add(mul(r, nx * tH * (mouse.w / mouse.h)), mul(u, ny * tH))));
    }
    function warSwitchWeapon(w) {
      if (!war || !war.foot || war.dead) return;
      war.weapon = w; war.reloadT = 0; toast(w === 'rpg' ? `RPG: ${war.rpg} rocket${war.rpg === 1 ? '' : 's'}` : 'Rifle', 900); noise(0.05, 0.1, 900);
    }
    function warSoldierFire(dt) {
      const t = war.tank; war.grenT = Math.max(0, (war.grenT || 0) - dt); war.healCool = Math.max(0, war.healCool - dt); warLootStep();
      // Tap R to reload; hold R for a second and a half to respawn (back in the same wave).
      if (keys.has('r') && !war.mapOpen) { war.rHold = (war.rHold || 0) + dt; if (war.rHold > 1.5) { war.rHold = 0; warQuickRespawn(); return; } } else war.rHold = 0;
      if (war.reloadT > 0 && (war.reloadT -= dt) <= 0) { const n = Math.min(SOLDIER.mag - war.mag, war.gun); war.mag += n; war.gun -= n; war.reloadT = 0; }
      if (war.mag <= 0 && war.gun > 0 && war.reloadT <= 0) warReload();
      if (war.weapon === 'rpg') {
        if ((keys.has('Enter') || warPad.gun) && t.reload <= 0) {
          if (war.rpg <= 0) { t.reload = 0.6; toast('Out of rockets (you get more each wave)', 1300); return; }
          t.reload = SOLDIER.rpgReload; war.rpg--;
          warShoot('p', t.muzzle(), warFootAim(), t.vel, 0.003, SOLDIER.rpgDmg, SOLDIER.rpgDmg + 40, SOLDIER.rpgSpeed, { shell: true });
          noise(0.5, 0.35, 260); shakeKick = Math.max(shakeKick, 0.3);
        }
        return;
      }
      if ((keys.has('Enter') || warPad.gun) && war.reloadT <= 0 && war.mag > 0 && t.reload <= 0) {
        t.reload = SOLDIER.fireGap; war.mag--;
        warShoot('p', t.muzzle(), warFootAim(), t.vel, t.spread(SOLDIER.zoom[war.zoomI]), SOLDIER.dmg, SOLDIER.dmg, SOLDIER.muzzle);
        noise(0.07, 0.2, 1700); shakeKick = Math.max(shakeKick, 0.06); t.sway = Math.min(1.2, t.sway + 0.08);
        if (war.mag === 0 && war.gun === 0) toast('Out of ammunition', 1400);
      }
    }
    function warPlayerFire(dt) {
      if (war.driving) return;
      if (war.foot) { warSoldierFire(dt); return; }
      if (war.guiding) { if (keys.has('Enter') || keys.has(' ') || warPad.gun) { if (war.guideM) war.guideM.detonate = true; } return; }
      if (war.vehicle === 'tank') { warTankFire(dt); return; }
      const L = war.L, { f, u } = flight.axes();
      const wantGun = (keys.has('Enter') || keys.has(' ') || warPad.gun) && war.gun > 0;
      if (wantGun) {
        war.gunT -= dt;
        while (war.gunT <= 0 && war.gun > 0) {
          war.gunT += 0.05; war.gun--;
          const dir = warAssistDir(norm(add(f, mul(u, 0.004))));
          warShoot('p', warMuzzle(), dir, flight.vel, WAR.GUN.spread, 9, 5);
          if (Math.round(war.gun) % 3 === 0) noise(0.08, 0.18, 1400);
        }
      } else war.gunT = Math.min(0, war.gunT);
      war.bombT -= dt;
      const bombPress = keys.has('z') || keys.has('b') || warPad.bomb || war.bombPend; war.bombPend = false;
      if (bombPress && war.bombs > 0 && war.bombT <= 0) {
        // Automatic drops only when a bomb would land on something; it looks again a moment later.
        if (war.assist === 'auto') {
          const hit = WAR.impactPoint(add(flight.pos, mul(u, -1.6 * (plane.scale || 1))), flight.vel, (x, z) => groundAt(W, x, z), flight.wind || v3(), 0.1);
          if (!war.ground.some((g) => !g.dead && Math.hypot(g.pos[0] - hit.pos[0], g.pos[2] - hit.pos[2]) < 38)) { war.bombT = 0.08; return; }
        }
        war.bombs--; war.bombT = L.stick;
        // The bomb lands where the yellow diamond was when you pressed: it is steered to that point on the way down.
        // Easy and Automatic also snap it to a target within 45 m of the diamond.
        const p = add(flight.pos, mul(u, -1.6 * (plane.scale || 1))), aimHit = WAR.impactPoint(p, flight.vel, (x, z) => groundAt(W, x, z), flight.wind || v3(), 0.08);
        let target = aimHit.pos.slice();
        if (war.assist !== 'pro') { let bd = 45; for (const g of war.ground) { if (g.dead || INF.has(g.kind)) continue; const dd = Math.hypot(g.pos[0] - target[0], g.pos[2] - target[2]); if (dd < bd) { bd = dd; target = g.pos.slice(); } } }
        const bomb = { owner: 'p', pos: p, vel: add(flight.vel, [0, -0.5, 0]), t: 0, target, noNpc: !!war.net && !warAuth() };
        war.bombsAir.push(bomb);
        if (war.net) netSend({ t: 'b', id: netMyId, p: bomb.pos.map(r1n), v: bomb.vel.map(r1n) });
        noise(0.12, 0.12, 700);
        if (war.bombs === 0) toast('Out of bombs', 1400);
      }
    }
    function warLaunch() {
      if (!war || war.dead || screen !== 'fly') return;
      if (war.missiles <= 0) { toast(war.L.missiles ? 'Out of missiles' : 'No missiles on this aircraft', 1200); return; }
      const { f } = flight.axes();
      const locked = war.lock && war.lockT >= 1 ? war.lock : null;
      war.missiles--;
      warFireMissile('p', add(warMuzzle(), mul(flight.axes().u, -1.2)), flight.vel, f, locked ? { ref: locked } : null);
      toast(locked ? 'Missile away' : 'Missile away (no lock: it flies straight)', 1000);
    }
    /// Guided missile (G): you fly the missile with the mouse or arrows while the plane flies itself, then detonate it with
    /// Space, a click or G. Two per round.
    function warLaunchGuided() {
      if (!war || war.dead || war.vehicle !== 'plane' || screen !== 'fly') return;
      if (war.guideM && !war.guideM.dead) { war.guideM.detonate = true; return; }
      if ((war.guided || 0) <= 0) { toast('No guided missiles left this round', 1400); return; }
      const { f } = flight.axes(); war.guided--;
      const m = warFireMissile('p', warMuzzle(), flight.vel, f, null, true); m.guided = true;      // others are told where it explodes, not along its way
      war.guideM = m; war.guiding = true; war.ap = { hdg: flight.heading, alt: flight.pos[1], spd: Math.max(flight.ias, plane.stall * 1.4), i: 0 };
      toast('GUIDED MISSILE: steer with the mouse or arrows. Space, click or G detonates', 2800);
    }
    /// One step of a missile you are flying: it turns where you steer and speeds up to 320 m/s.
    function warGuideStep(m, dt) {
      const raw = war.lastRaw || { roll: 0, pitch: 0 };
      m.t = (m.t || 0) + dt;
      let sp = len(m.vel) || 200; const d = mul(m.vel, 1 / sp);
      let h = Math.atan2(d[0], -d[2]), p = Math.asin(clamp(d[1], -1, 1));
      h += clamp(raw.roll, -1, 1) * 1.2 * dt; p = clamp(p + clamp(raw.pitch, -1, 1) * 1.0 * dt, -1.45, 1.45);
      sp = Math.min(320, sp + 140 * dt);
      m.vel = [Math.sin(h) * Math.cos(p) * sp, Math.sin(p) * sp, -Math.cos(h) * Math.cos(p) * sp];
      m.pos = add(m.pos, mul(m.vel, dt));
    }
    function warFlares() {
      if (!war || war.dead || screen !== 'fly') return;
      if (war.flares <= 0) { toast('Out of flares', 1000); return; }
      war.flares--;
      for (let i = 0; i < 4; i++) puff('flare', add(flight.pos, jitter(6)), add(mul(flight.vel, 0.9), jitter(30)));
      noise(0.3, 0.15, 3000);
      // A missile homing on you may be fooled, and the nearer it is the likelier it is.
      for (const m of war.missilesAir) if (m.owner === 'e' && len(sub(m.pos, flight.pos)) < 2800 && warRand() < 0.6) m.target = null;
      if (war.net) netSend({ t: 'fl', id: netMyId });
    }

    // ---- the computer pilots
    function warPilot(a, dt) {
      const d = war.d, foe = a.role === 'foe';
      a.t += dt;
      // The target: foes go for you (and your wingman, in co-op); the wingman goes for the nearest enemy fighter, else the nearest ground target.
      a.retargetT -= dt;
      if (a.retargetT <= 0 || (a.target && a.target.state === 'fall') || (a.target && a.target.dead)) {
        a.retargetT = 3 + warRand() * 3;
        const cands = [];
        if (foe) { for (const q of warPlayersList()) cands.push({ kind: 'air', pos: q.pos, vel: q.vel, player: q.id, state: 'fly' }); if (war.friend && war.friend.state === 'fly' && warSide === 'coop') cands.push({ kind: 'air', pos: war.friend.pos, vel: war.friend.vel, ref: war.friend, state: 'fly' }); }
        else { for (const o of war.foes) if (o.state === 'fly') cands.push({ kind: 'air', pos: o.pos, vel: o.vel, ref: o, state: 'fly' });
          if (!cands.length) for (const g of war.ground) if (!g.dead) cands.push({ kind: 'ground', pos: g.pos, vel: v3(), ref: g, state: 'fly' }); }
        let best = null, bd = Infinity;
        for (const c of cands) { const dd = len(sub(c.pos, a.pos)) * (foe && c.player && warSide === 'versus' ? 0.6 : 1); if (dd < bd) { bd = dd; best = c; } }
        a.target = best;
      }
      const t = a.target;
      let want, aim = null, range = 99999;
      if (t) {
        if (t.player) { const q = warPlayersList().find((x) => x.id === t.player); if (q) { t.pos = q.pos; t.vel = q.vel; } else { a.target = null; a.retargetT = 0; return; } } else if (t.ref && t.kind === 'air') { t.pos = t.ref.pos; t.vel = t.ref.vel; }
        range = len(sub(t.pos, a.pos));
        const lead = t.kind === 'air' && range < 2500 ? WAR.leadPoint(a.pos, a.vel, t.pos, t.vel, WAR.GUN.speed) : null;
        aim = lead ? add(lead.point, [0, 0.5 * WAR.G * lead.t * lead.t, 0]) : t.pos;
        want = sub(aim, a.pos);
        // Flown past it: pull away and come round again rather than flying a tight circle round the target.
        if (t.kind === 'air' && range < 220 && WAR.offBore(a, t.pos) > 1.2) want = add(mul(norm(sub(a.pos, t.pos)), 1), [0, 0.35, 0]);
      } else if (!foe) {
        const { r, f } = flight.axes();
        aim = add(add(flight.pos, mul(r, 170)), mul(f, 40)); aim[1] += 15; want = sub(aim, a.pos); range = len(want);
      } else want = [Math.sin(a.heading), 0, -Math.cos(a.heading)];
      if (warDist(a.pos[0], a.pos[2]) > war.R * 0.93) want = [-(a.pos[0] - war.cx), 0, -(a.pos[2] - war.cz)];     // back to the battlefield
      // Look out for the ground, and for a missile coming in.
      const ahead = add(a.pos, mul(a.vel, 3)), floor = Math.max(groundAt(W, a.pos[0], a.pos[2]), groundAt(W, ahead[0], ahead[2]));
      let tooLow = false;
      if (a.pos[1] < floor + 140) { want = [want[0] * 0.3, Math.max(0.55, want[1] / (len(want) || 1) + 0.5), want[2] * 0.3]; tooLow = true; }
      a.warnMsl = null;
      for (const m of war.missilesAir) if (m.target && m.target.ref === a) { const dm = len(sub(m.pos, a.pos)); if (dm < 1800) a.warnMsl = m; }
      if (a.warnMsl && !tooLow) {
        const away = norm(sub(a.pos, a.warnMsl.pos)), side = cross(away, [0, 1, 0]);
        want = add(mul(side, 1.2), [0, -0.25, 0]);
        if (len(sub(a.warnMsl.pos, a.pos)) < 400 && !a.flared) { a.flared = true; if (warRand() < (warDiff === 'hard' ? 0.5 : 0.3)) a.warnMsl.target = null; }
      } else a.flared = false;
      // Speed: a foe holds its speed; the wingman stays close to yours.
      const wantSpeed = foe ? d.speed : clamp(flight.speed + (range > 300 ? 25 : -10), 90, 260);
      a.speed += clamp(wantSpeed - a.speed, -25 * dt, 25 * dt);
      WAR.steer(a, want, dt, d.turn * (foe ? 1 : 1.1));
      a.q = qmul(qheading(a.heading, a.pitch), qaxis([0, 0, 1], -a.bank));
      // Guns.
      if (a.cool > 0) a.cool -= dt;
      const nose = norm(a.vel);
      if (a.burstLeft > 0) {
        a.burstLeft -= dt; a.gunT -= dt;
        while (a.gunT <= 0) {
          a.gunT += 0.07;
          warShoot(foe ? 'e' : 'f', add(a.pos, mul(nose, 8)), nose, a.vel, foe ? d.aim : 0.008, foe ? 4 : 9, 5);
        }
        if (a.burstLeft <= 0) a.cool = (1.2 + warRand() * 1.4) / (foe ? d.burst : 1);
      } else if (t && a.cool <= 0 && !tooLow && !a.warnMsl) {
        const ob = WAR.offBore(a, aim), maxR = t.kind === 'ground' ? 1100 : 900;
        if (range > (t.kind === 'ground' ? 300 : (foe ? 250 : 120)) && range < maxR && ob < (t.kind === 'ground' ? 0.05 : 0.065)) { a.burstLeft = (foe ? 0.3 : 0.5) + warRand() * (foe ? 0.3 : 0.5); a.gunT = 0; }
      }
      // A missile from a foe: in versus or on hard, when it has a good look at you.
      a.mslCool -= dt;
      if (foe && t && t.player && a.mslCool <= 0 && (warSide === 'versus' || warDiff === 'hard') && range > 1300 && range < 4200 && WAR.offBore(a, t.pos) < 0.22) {
        a.mslCool = 24 + warRand() * 12;
        warFireMissile('e', a.pos, a.vel, nose, { player: t.player }); netEvent({ k: 'em', p: a.pos.map(r1n), v: add(a.vel, mul(nose, 120)).map(r1n), tg: t.player });
        war.warn = 'MISSILE!'; war.warnT = 3; beep(1500, 0.3, 'square', 0.1);
      }
    }
    function warFall(a, dt) {
      a.t += dt;
      a.vel = add(a.vel, [0, -9.8 * dt, 0]); a.vel = mul(a.vel, 1 - 0.04 * dt);
      a.pos = add(a.pos, mul(a.vel, dt));
      a.q = qnorm(qmul(a.q, qaxis(norm(a.w), len(a.w) * dt)));
      if (warRand() < dt * 40) puff('fire', add(a.pos, jitter(3)), jitter(4));
      if (warRand() < dt * 30) puff('soot', add(a.pos, jitter(2)), [0, 3, 0]);
      if (a.pos[1] < groundAt(W, a.pos[0], a.pos[2]) + 2) { warBoom(a.pos, 1.1); warCrater(a.pos, 6); a.state = 'gone'; }
      if (a.t > 90) a.state = 'gone';
    }

    // ---- the ground
    /// An enemy rifleman: marches at the nearest player, stops at its range (sometimes dropping to cover), and shoots short
    /// bursts that miss a lot, more so the farther away you are.
    function warRifleman(g, dt, np, dp, d) {
      const want = Math.atan2(np.pos[0] - g.pos[0], -(np.pos[2] - g.pos[2]));
      g.heading += clamp(wrapPi(want - g.heading), -2.2 * dt, 2.2 * dt);
      if (!war.npc) return;
      if (g.cover > 0) g.cover -= dt; else if (dp > g.stop && warRand() < dt * 0.1) g.cover = 1.5 + warRand() * 2;
      const go = dp > g.stop && g.cover <= 0 && g.burst <= 0;
      if (go) {
        const nx = g.pos[0] + Math.sin(g.heading) * SOLDIER.enemyWalk * dt, nz = g.pos[2] - Math.cos(g.heading) * SOLDIER.enemyWalk * dt;
        if (onLand(nx, nz)) { g.pos[0] = nx; g.pos[2] = nz; g.pos[1] = groundAt(W, nx, nz); } else g.heading += 1.2 * dt * (g.nid % 2 ? 1 : -1);
        g.walk += SOLDIER.enemyWalk * dt * 0.9;
      }
      g.cool -= dt;
      if (g.kind === 'rpgman') {
        // An RPG soldier fires a rocket now and then at you or your helicopter if you are within reach and low enough.
        const lowEnough = np.pos[1] - groundAt(W, np.pos[0], np.pos[2]) < 160;
        if (g.cool <= 0 && dp > 40 && dp < 330 && lowEnough && !war.dead && !flight.crashed) {
          g.cool = (6 + warRand() * 3) / d.burst;
          const from = add(g.pos, [0, 1.5, 0]), dir = norm(sub(add(np.pos, [0, 0.5, 0]), from));
          const sh = warShoot('e', from, dir, v3(), 0.02 + dp * 0.00012 + d.aim * 0.2, SOLDIER.rpgEnemyDmg, 0, 110, { shell: true });
          netEvent({ k: 'ts', p: sh.pos.map(r1n), v: sh.vel.map(r1n) }); noise(0.3, clamp(0.5 * (1 - dp / 400), 0.05, 0.4), 300);
        }
        return;
      }
      if (g.cool <= 0 && dp < 260 && !war.dead && !flight.crashed) { g.burst = 2 + Math.floor(warRand() * 3); g.cool = (1.7 + warRand() * 1.8) / d.burst; g.bt = 0; }
      if (g.burst > 0 && (g.bt -= dt) <= 0) {
        g.bt = 0.17; g.burst--;
        const from = add(g.pos, [0, 1.4, 0]), dir = norm(sub(add(np.pos, [0, -0.2, 0]), from));
        const sh = warShoot('e', from, dir, v3(), riflemanError(dp, d.aim), SOLDIER.enemyDmg, 0, 650);
        netEvent({ k: 'ts', p: sh.pos.map(r1n), v: sh.vel.map(r1n) }); noise(0.06, clamp(0.3 * (1 - dp / 400), 0.02, 0.25), 1500);
      }
    }
    function warGroundStep(g, dt) {
      if (g.dead) {
        if (g.burning > 0) { g.burning -= dt; if (warRand() < dt * 5) puff('soot', add(g.pos, [0, 2, 0]), [0, 6, 0]); if (warRand() < dt * 3) puff('fire', add(g.pos, jitter(3)), [0, 3, 0]); }
        return;
      }
      const np = warNearestPlayer(g.pos);
      const d = war.d, dp = len(sub(np.pos, g.pos)), flat2 = Math.hypot(np.pos[0] - g.pos[0], np.pos[2] - g.pos[2]), agl = np.pos[1] - groundAt(W, np.pos[0], np.pos[2]);
      if (INF.has(g.kind)) { warRifleman(g, dt, np, dp, d); return; }
      if (g.hunt) {      // an enemy tank drives at yours until it is in range
        g.heading += clamp(wrapPi(Math.atan2(np.pos[0] - g.pos[0], -(np.pos[2] - g.pos[2])) - g.heading), -0.4 * dt, 0.4 * dt);
        g.speed = flat2 > 450 ? 5 : 0;
      }
      if (g.speed > 0) {
        g.pos[0] += Math.sin(g.heading) * g.speed * dt; g.pos[2] -= Math.cos(g.heading) * g.speed * dt; g.pos[1] = groundAt(W, g.pos[0], g.pos[2]);
        if (g.ship) { g.pos[1] = 0; if (groundAt(W, g.pos[0] + Math.sin(g.heading) * 120, g.pos[2] - Math.cos(g.heading) * 120) > WATER + 0.5 || (g.t += dt) > 60) { g.heading += 2.2; g.t = 0; } }
        else if (!onLand(g.pos[0], g.pos[2]) || (!g.hunt && (g.t += dt) > 40)) { g.heading += Math.PI; g.t = 0; }
      }
      if (!war.npc) return;       // the enemy is switched off: targets that do not shoot back
      g.cool -= dt;
      if ((g.kind === 'aa' || g.kind === 'warship') && g.cool <= 0 && dp < 3300 && agl > 40 && !flight.crashed) {
        g.cool = (1.5 + warRand()) * (g.kind === 'warship' ? 0.9 : 1.4) / d.flak;
        const base = add(g.pos, [0, g.kind === 'warship' ? 12 : 2, 0]), lead = WAR.leadPoint(base, v3(), np.pos, np.vel, 750);
        if (lead) {
          // The shell flies to where you will be, and it is never quite right: the error grows with the range.
          const err = dp * 0.012 * 2.5 / d.flak, aim = add(lead.point, [(warRand() - 0.5) * err * 2, (warRand() - 0.5) * err, (warRand() - 0.5) * err * 2]);
          const T = Math.max(0.5, len(sub(aim, base)) / 750);
          war.flaks.push({ from: base, to: aim, t: 0, T });
          netEvent({ k: 'flak', f: base.map(r1n), o: aim.map(r1n), T: Math.round(T * 100) / 100 });
          noise(0.15, clamp(0.5 * (1 - dp / 4000), 0.04, 0.4), 500);
        }
      }
      if (g.kind === 'tank') {
        g.turret = g.turret + clamp(WAR.wrap(Math.atan2(np.pos[0] - g.pos[0], -(np.pos[2] - g.pos[2])) - g.turret), -0.8 * dt, 0.8 * dt);
        if (g.cool <= 0 && flat2 < 1500 && agl < 600 && !flight.crashed) {
          g.cool = (2.4 + warRand() * 1.4) / d.burst;
          const mz = add(g.pos, [Math.sin(g.turret) * 5, 2, -Math.cos(g.turret) * 5]), lead = WAR.leadPoint(mz, v3(), np.pos, np.vel, 650);
          if (lead) { const dir = norm(sub(lead.point, mz)), sh = warShoot('e', mz, dir, v3(), d.aim * 1.6, 26, 0, 650); netEvent({ k: 'ts', p: sh.pos.map(r1n), v: sh.vel.map(r1n) }); noise(0.3, 0.18, 400); }
        }
      }
    }

    // ---- the shots in the air
    function warProjectiles(dt) {
      const rP = war.foot ? 1.0 : war.vehicle === 'tank' ? 4.6 : Math.max(5, (plane.span || 5) * 1.1 * (plane.scale || 1));
      // Bullets (and cannon shells)
      for (const b of war.bullets) {
        const p0 = b.pos.slice(); WAR.bulletStep(b, dt);
        const hitGround = b.pos[1] < groundAt(W, b.pos[0], b.pos[2]);
        if (b.t > (b.shell ? 7 : WAR.GUN.life) * (b.dmgGround === 0 ? 2 : 1) || hitGround) {
          if (hitGround && b.shell) warShellBurst(b);
          else if (hitGround && len(sub(b.pos, flight.pos)) < 3000 && warRand() < 0.5) puff('dirt', b.pos, [0, 6, 0]);
          b.dead = true; continue;
        }
        if (b.owner === 'r' && netFight() && !war.dead && WAR.segHit(p0, b.pos, flight.pos, rP)) { if (b.shell) warShellBurst(b); else { warHurt(b.dmgAir, 'enemy player', b.by); puff('spark', b.pos, jitter(20)); } b.dead = true; continue; }
        if ((b.owner === 'p' || b.owner === 'f' || b.owner === 'r') && !b.noNpc) {
          for (const a of war.foes) if (a.state === 'fly' && WAR.segHit(p0, b.pos, a.pos, 7.5)) { if (b.shell) warShellBurst(b); else { warDamageAir(a, b.dmgAir, b.owner); puff('spark', b.pos, jitter(20)); } b.dead = true; break; }
          if (b.dead) continue;
          // Friendly fire: your own rounds hit your wingman too, so watch where you shoot.
          if (b.owner === 'p' && war.friend && war.friend.state === 'fly' && WAR.segHit(p0, b.pos, war.friend.pos, 7.5)) { warDamageAir(war.friend, b.dmgAir, 'p'); puff('spark', b.pos, jitter(20)); if (!war.ffT || war.ffT < elapsed) { toast('⚠ Friendly fire! That was your wingman', 1600); war.ffT = elapsed + 3; } b.dead = true; continue; }
          for (const g of war.ground) if (!g.dead && WAR.segHit(p0, b.pos, add(g.pos, [0, 1.2, 0]), g.r)) { if (b.shell) warShellBurst(b); else { warDamageGround(g, b.dmgGround, b.owner); puff('dirt', b.pos, jitter(8)); } b.dead = true; break; }
        } else if (b.owner === 'e' && !b.vis) {
          if (!flight.crashed && !war.dead && WAR.segHit(p0, b.pos, flight.pos, rP)) { warHurt(b.dmgAir * (war.maxHp > 120 ? 0.8 : 1) * (war.assist !== 'pro' ? 0.35 : 1), 'enemy fire'); puff('spark', b.pos, jitter(20)); b.dead = true; continue; }
          if (war.friend && war.friend.state === 'fly' && WAR.segHit(p0, b.pos, war.friend.pos, 7.5)) { warDamageAir(war.friend, b.dmgAir, 'e'); b.dead = true; }
          if (war.net && war.net.role === 'host') for (const o of war.net.others.values()) if (o.alive && o.shown && WAR.segHit(p0, b.pos, o.shown, netRadius({ tank: o.rep && (o.rep.kind === 'tank' || o.rep.kind === 'van'), foot: o.rep && o.rep.kind === 'soldier' }))) { netHurtRemote(o.id, b.dmgAir, 'enemy fire'); puff('spark', b.pos, jitter(20)); b.dead = true; break; }
        }
      }
      war.bullets = war.bullets.filter((b) => !b.dead);
      // Bombs
      for (const b of war.bombsAir) {
        if (b.gren) { b.t += dt; b.fuse -= dt; b.vel = add(b.vel, [0, -9.8 * dt, 0]); b.pos = add(b.pos, mul(b.vel, dt)); }
        else {
          if (b.target && b.owner === 'p') {
            const pr = WAR.impactPoint(b.pos, b.vel, (x, z) => groundAt(W, x, z), flight.wind || v3(), 0.08), k = Math.min(1, 8 * dt);
            if (pr && pr.t > 0.12) { b.vel[0] += clamp((b.target[0] - pr.pos[0]) / pr.t * k, -15, 15); b.vel[2] += clamp((b.target[2] - pr.pos[2]) / pr.t * k, -15, 15); }
          }
          WAR.bombStep(b, dt, flight.wind || v3());
        }
        const g = groundAt(W, b.pos[0], b.pos[2]);
        if (b.gren && (b.pos[1] <= g + 0.2 || b.fuse <= 0)) {
          b.dead = true; const at = [b.pos[0], Math.max(g, b.pos[1] > g + 3 ? b.pos[1] : g), b.pos[2]];
          warBoom(at, 0.45); warCrater(at, 1.6); warBlast(at, 10, 150, b.owner, b);
        } else if (!b.gren && b.pos[1] <= g + 0.3) {
          b.dead = true; const at = [b.pos[0], g, b.pos[2]];
          warBoom(at, 1); warCrater(at, 9); warBlast(at, WAR.BOMB.R, WAR.BOMB.dmg, b.owner, b);
          if (b.owner === 'p') war.bombsHit = (war.bombsHit || 0) + 1;
        }
      }
      war.bombsAir = war.bombsAir.filter((b) => !b.dead);
      // Missiles
      for (const m of war.missilesAir) {
        let tg = null;
        if (m.target) {
          if (m.target.player) {
            if (m.target.player === 'me' || m.target.player === true) tg = { pos: flight.pos, vel: flight.vel };
            else { const o = war.net && war.net.others.get(m.target.player); if (o && o.alive && o.rep) tg = { pos: o.shown || o.rep.pos, vel: o.rep.vel }; else m.target = null; }
          } else if (m.target.ref && m.target.ref.state === 'fly') tg = { pos: m.target.ref.pos, vel: m.target.ref.vel };
          else if (m.target.ref && m.target.ref.kind && !m.target.ref.dead) tg = { pos: add(m.target.ref.pos, [0, 1.5, 0]), vel: [0, 0, 0] };
          else m.target = null;
        }
        if (m === war.guideM && war.dead) { m.dead = true; war.guideM = null; war.guiding = false; continue; }
        if (m.guided) warGuideStep(m, dt); else WAR.missileStep(m, tg, dt);
        m.trail -= dt; if (m.trail <= 0 && !(m.drop && m.t < 0.28)) { m.trail = m.t < 4 ? 0.02 : 0.08; puff('tsmoke', m.pos, v3()); }
        const g = groundAt(W, m.pos[0], m.pos[2]);
        let boom = m.pos[1] <= g + 1 || m.t > (m.guided ? 30 : 14) || !!m.detonate;
        if (m.guided && !boom) for (const gr of war.ground) if (!gr.dead && !INF.has(gr.kind) && len(sub(m.pos, gr.pos)) < 14) boom = true;
        if (!boom && m.t > 0.4) {
          if (m.owner === 'e') {
            if (!m.vis && !war.dead && len(sub(m.pos, flight.pos)) < Math.max(14, rP * 1.4)) boom = true;
            if (war.friend && war.friend.state === 'fly' && len(sub(m.pos, war.friend.pos)) < 14) boom = true;
            if (war.net && war.net.role === 'host' && !m.vis) for (const o of war.net.others.values()) if (o.alive && o.shown && len(sub(m.pos, o.shown)) < 14) boom = true;
          } else if (m.owner === 'r' && netFight()) { if (!war.dead && len(sub(m.pos, flight.pos)) < Math.max(14, rP * 1.4)) boom = true; }
          if (m.owner !== 'e') for (const a of war.foes) if (a.state === 'fly' && len(sub(m.pos, a.pos)) < 16) boom = true;
        }
        if (boom) { m.dead = true; warBoom(m.pos, m.guided ? 1.1 : 0.8); warBlast(m.pos, m.guided ? 60 : 45, m.guided ? 320 : 260, m.owner, m); if (m.guided && war.net && m.owner === 'p') netSend({ t: 'gx', id: netMyId, p: m.pos.map(r1n) }); if (m === war.guideM) { war.guideM = null; war.guiding = false; } }
      }
      war.missilesAir = war.missilesAir.filter((m) => !m.dead);
      // Flak: a shell that bursts where it was aimed, and hurts what is near the burst.
      for (const k of war.flaks) {
        k.t += dt;
        if (k.t >= k.T) {
          k.dead = true; const at = k.to;
          for (let i = 0; i < 6; i++) puff('burst', add(at, jitter(10)), jitter(6));
          for (let i = 0; i < 6; i++) puff('spark', at, jitter(30));
          const dist = len(sub(at, flight.pos)); noise(0.35, clamp(0.55 * (1 - dist / 2500), 0.05, 0.5), 260);
          if (dist < 320) { war.warn = 'FLAK!'; war.warnT = 1.2; shakeKick = Math.max(shakeKick, clamp(1 - dist / 320, 0, 1) * 0.5); }
          if (!k.vis) {
            if (!flight.crashed && !war.dead) warHurt(WAR.blastDamage(dist, 38, 16), 'flak');
            if (war.friend && war.friend.state === 'fly') warDamageAir(war.friend, WAR.blastDamage(len(sub(at, war.friend.pos)), 38, 16), 'e');
            if (war.net && war.net.role === 'host') for (const o of war.net.others.values()) if (o.alive && o.shown) netHurtRemote(o.id, WAR.blastDamage(len(sub(at, o.shown)), 38, 16), 'flak');
          }
        }
      }
      war.flaks = war.flaks.filter((k) => !k.dead);
    }

    /// Defensive guns (the bomber's gunners): they shoot at any fighter that comes within 1.5 km.
    function warGunners(dt) {
      war.gunners -= dt;
      if (war.gunners > 0) return;
      let best = null, bd = 1500;
      for (const a of war.foes) { const dd = len(sub(a.pos, flight.pos)); if (a.state === 'fly' && dd < bd) { bd = dd; best = a; } }
      if (!best) { war.gunners = 0.3; return; }
      war.gunners = 0.09;
      for (const off of [[0, 3, 12], [0, -2, -2]]) {
        const from = add(flight.pos, qrot(flight.q, mul(off, plane.scale || 1))), lead = WAR.leadPoint(from, flight.vel, best.pos, best.vel, 880);
        const dir = lead ? norm(sub(add(lead.point, [0, 0.5 * WAR.G * lead.t * lead.t, 0]), from)) : norm(sub(best.pos, from));
        warShoot('p', from, dir, flight.vel, 0.022, 7, 5);
      }
    }

    /// The lock button (K): lock on to the enemy fighter nearest the nose and hold it until you press T again, it is destroyed, or it flies far away.
    const lockAlive = (t) => !!t && (t.state ? t.state === 'fly' : !t.dead);
    const lockPos = (t) => (t.state ? t.pos : add(t.pos, [0, 1.5, 0]));
    /// Heat vision (Y): the picture goes grey, smoke and dust vanish, and people, vehicles, aircraft and fires glow white.
    function warThermal(force) {
      thermal = force != null ? force : !thermal;
      cv.style.filter = thermal ? 'grayscale(1) contrast(1.35) brightness(.8)' : '';
      toast(thermal ? '🔥 HEAT VISION on: you see through smoke (Y to switch off)' : 'Heat vision off', 1400);
    }
    function warToggleLock() {
      if (!war || war.dead || war.vehicle !== 'plane' || screen !== 'fly') return;
      if (war.manualLock) { war.manualLock = false; war.lock = null; war.lockT = 0; toast('Lock released', 900); return; }
      const { f } = flight.axes(); let best = null, ba = 1.2;
      for (const a of [...war.foes, ...war.ground]) {          // fighters, and ground targets: bases, tanks, guns, trucks, fuel
        if (!lockAlive(a) || INF.has(a.kind)) continue;
        const to = sub(lockPos(a), flight.pos), dd = len(to); if (dd > 9000 || dd < 60) continue;
        const ang = Math.acos(clamp(dot(f, mul(to, 1 / dd)), -1, 1)); if (ang < ba) { ba = ang; best = a; }
      }
      if (!best) { toast('Nothing ahead to lock on to', 1300); return; }
      war.lock = best; war.lockT = 0; war.manualLock = true; toast('Locking on… (T to release)', 1100); beep(900, 0.06, 'square', 0.05);
    }
    function warLockOn(dt) {
      const { f } = flight.axes();
      if (war.manualLock) {
        const cur = war.lock;
        if (!lockAlive(cur) || len(sub(lockPos(cur), flight.pos)) > 9000) { war.manualLock = false; war.lock = null; war.lockT = 0; toast('Target lost', 900); }
        else {
          war.lockT += dt;
          if (war.lockT >= 1 && war.missiles > 0) { war.lockBeep = (war.lockBeep || 0) - dt; if (war.lockBeep <= 0) { war.lockBeep = 0.45; beep(1250, 0.07, 'square', 0.05); } }
          return;
        }
      }
      let best = null, ba = 0.5;
      for (const a of war.foes) {
        if (a.state !== 'fly') continue;
        const to = sub(a.pos, flight.pos), dd = len(to);
        if (dd > 7000 || dd < 120) continue;
        const ang = Math.acos(clamp(dot(f, mul(to, 1 / dd)), -1, 1));
        if (ang < ba) { ba = ang; best = a; }
      }
      const cur = war.lock && war.lock.state === 'fly' ? war.lock : null;
      if (cur) {                                   // keep the lock while it stays roughly ahead
        const to = sub(cur.pos, flight.pos), dd = len(to);
        if (dd > 7000 || Math.acos(clamp(dot(f, mul(to, 1 / (dd || 1))), -1, 1)) > 0.75) war.lock = null;
      }
      if (war.lock) war.lockT += dt; else if (best) { war.lock = best; war.lockT = 0; } else war.lockT = 0;
      if (war.lock && war.lockT >= 1 && war.missiles > 0) { war.lockBeep = (war.lockBeep || 0) - dt; if (war.lockBeep <= 0) { war.lockBeep = 0.45; beep(1250, 0.07, 'square', 0.05); } }
    }

    // ---- one step of the war
    function warStep(dt) {
      if (!war) return;
      if (war.mapOpen && (war.mapT -= dt) <= 0) warConfirmDrop();
      warFireStep(dt);
      if (war.net && flight.crashed && !war.dead) netCrashed();
      if (flight.crashed && !war.net && !(war.selfDestructT > 0)) return;
      if (war.endT > 0 && (war.endT -= dt) <= 0) { finish('crash', war.score, `${war.foot ? 'Soldier down' : 'Tank destroyed'} · ${war.score} pts · wave ${war.wave}`); return; }
      if (war.selfDestructT > 0 && (war.selfDestructT -= dt) <= 0) warSoloRespawn();
      if (war.net) { netTick(dt); if (war.net && war.net.role === 'client') netReplicaStep(dt); }
      if (!war.dead && war.vehicle === 'plane' && war.base) {
        // The home base: out of missiles (or bombs), come down the runway low and slow, and the ground crew rearms you.
        const bx = flight.pos[0] - war.base.x, bz = flight.pos[2] - war.base.z, agl = flight.pos[1] - (war.base.ship ? war.base.deck : Math.max(groundAt(W, flight.pos[0], flight.pos[2]), 0));
        const empty = war.missiles === 0 || (war.L.bombs > 0 && war.bombs === 0), onStrip = Math.abs(bx) < (war.base.ship ? 26 : 40) && Math.abs(bz) < (war.base.ship ? 170 : 470) && agl < 45 && agl > -6 && flight.ias < plane.stall * 2.6;
        if (empty && !onStrip) { const dist = Math.hypot(bx, bz), turn = wrapPi(Math.atan2(-bx, bz) - flight.heading); if (!war.warnT || war.warnT < 0.1) { war.warn = `OUT OF ${war.missiles === 0 ? 'MISSILES' : 'BOMBS'}: HOME BASE ${(dist / 1000).toFixed(1)} km ${Math.abs(turn) < 0.3 ? 'AHEAD' : turn > 0 ? '◀ LEFT' : 'RIGHT ▶'} · fly low and slow down its ${war.base.ship ? 'deck (your carrier)' : 'runway'}`; war.warnT = 0.3; } }
        if (empty && onStrip) {
          war.rearmT = (war.rearmT || 0) + dt; war.warn = `REARMING… ${Math.max(0, 1.5 - war.rearmT).toFixed(1)}s`; war.warnT = 0.3;
          if (war.rearmT >= 1.5) { war.missiles = war.L.missiles; war.bombs = war.L.bombs; war.gun = war.L.gun; war.flares = war.L.flares; war.hp = Math.min(war.maxHp, war.hp + war.maxHp * 0.3); war.rearmT = 0; toast('🛠 Rearmed: missiles, bombs, gun and flares full', 2600); }
        } else war.rearmT = 0;
        // Over the base the floor drops away, so the assist lets you come right down to the runway.
        war.overBase = Math.abs(bx) < 120 && Math.abs(bz) < 700;
      }
      if (!war.dead && war.vehicle === 'plane') {
        // Out past the edge of the battlefield: a warning, then damage.
        const rr = warDist(flight.pos[0], flight.pos[2]), Rw = war.R;
        if (rr > Rw * 0.85) {
          const toC = Math.atan2(-(flight.pos[0] - war.cx), flight.pos[2] - war.cz), hd = flight.heading;     // heading that points back to the middle
          war.edgeArrow = wrapPi(toC - hd);
          if (rr > Rw) { war.outT += dt; war.warn = `TURN BACK: LEAVING THE BATTLEFIELD (${Math.max(0, 12 - war.outT).toFixed(0)}s)`; war.warnT = 0.4; if (war.outT > 12) warHurt(3 * dt, 'out of bounds'); }
          else { war.warn = 'NEAR THE EDGE: TURN BACK'; war.warnT = 0.4; war.outT = Math.max(0, war.outT - dt * 2); }
          // Easy gently steers a plane that has drifted past 90% back towards the middle.
          if (war.assist === 'easy' && rr > Rw * 0.9 && flight.arc) flight.arc.h += clamp(wrapPi(toC - flight.arc.h), -1, 1) * 0.35 * dt;
        } else { war.edgeArrow = null; war.outT = Math.max(0, war.outT - dt * 2); }
      }
      if (!war.dead && war.vehicle === 'tank' && war.grows && warDist(flight.pos[0], flight.pos[2]) > war.R * 0.94) { war.warn = 'EDGE OF THE BATTLEFIELD: it grows with every wave'; war.warnT = 0.4; }
      const d = war.d;
      war.flash = Math.max(0, war.flash - dt * 1.6); war.warnT -= dt; if (war.warnT <= 0) war.warn = '';
      for (const f of war.feed) f.t -= dt;
      war.briefingT = Math.max(0, (war.briefingT || 0) - dt);
      if (war.runT > 0 && (war.runT -= dt) <= 0) war.run = 0;
      war.feed = war.feed.filter((f) => f.t > 0);
      // Next wave when the last one is cleared.
      const aliveG = war.ground.some((g) => !g.dead), aliveF = war.foes.some((a) => a.state !== 'gone');
      if (warAuth() && !aliveG && !aliveF && war.wave > 0 && !war.waveClear) { war.waveClear = true; war.wavePause = 4.5; const bonus = 250 * war.wave; war.score += bonus; toast(`✔ WAVE ${war.wave} CLEARED  +${bonus}`, 2400); chime(); }
      if (warAuth() && (war.waveClear || war.wave === 0)) { war.wavePause -= dt; if (war.wavePause <= 0) warSpawnWave(); }
      if (!war.dead) { warPlayerFire(dt); warLockOn(dt); if (war.L.gunners) warGunners(dt); }
      if (warAuth()) for (const a of war.foes) { if (a.state === 'fly') { warPilot(a, dt); if (!war.dead && len(sub(a.pos, flight.pos)) < Math.max(5, (plane.span || 5)) + 7) { warDamageAir(a, 999, 'p'); warHurt(55, 'collision'); } } else if (a.state === 'fall') warFall(a, dt); }
      if (warAuth() && !war.dead && war.vehicle === 'plane' && !flight.crashed) {
        const agl = flight.pos[1] - groundAt(W, flight.pos[0], flight.pos[2]);
        if (agl < 30) for (const g of war.ground) {
          if (g.dead || INF.has(g.kind)) continue;
          const gr = (WAR_KINDS[g.kind] ? WAR_KINDS[g.kind].r : 5) + 7;
          if (Math.hypot(g.pos[0] - flight.pos[0], g.pos[2] - flight.pos[2]) < gr) { warDamageGround(g, 9999, 'p'); warHurt(45, 'collision'); toast('💥 You rammed it: it is destroyed', 1600); break; }
        }
      }
      for (const a of war.foes) if (a.state === 'fly' && warRand() < dt * 8) puff('dark', add(a.pos, mul(a.vel, -0.035)), mul(a.vel, -0.06));
      if (warAuth()) war.foes = war.foes.filter((a) => a.state !== 'gone');
      if (war.friend) { const a = war.friend; if (a.state === 'fly') warPilot(a, dt); else if (a.state === 'fall') warFall(a, dt); else war.friend = null; }
      if (warAuth()) for (const g of war.ground) warGroundStep(g, dt);
      warProjectiles(dt);
      if (!war.dead && war.vehicle === 'plane' && (war.hp < war.maxHp * 0.3 || flight.ignited)) { war.warn = '🪂 EJECT: PRESS J'; war.warnT = 0.4; }
      // A damaged aircraft trails smoke and then fire.
      if (!war.dead && war.hp < war.maxHp * 0.5 && warRand() < dt * 30) puff('dark', warMuzzle(), mul(flight.vel, 0.9));
      if (!war.dead && war.hp < war.maxHp * 0.25 && warRand() < dt * 25) puff('fire', add(flight.pos, jitter(2)), mul(flight.vel, 0.9));
      // A missile locking on to you.
      if (!war.dead && war.missilesAir.some((m) => m.owner === 'e' && len(sub(m.pos, flight.pos)) < 3500)) { war.warn = 'MISSILE! (L: flares)'; war.warnT = 0.4; war.sirenT = (war.sirenT || 0) - dt; if (war.sirenT <= 0) { war.sirenT = 0.35; beep(1700, 0.1, 'square', 0.07); } }
    }

    // ---- drawing
    function warDrawAircraft(a, tint, glow) {
      const tpm = planeMeshes[a.id], sc = a.spec.scale || 1, AM = model(a.q, a.pos, sc);
      const tt = a.state === 'fall' ? [0.32, 0.26, 0.22] : tint;
      for (const k in tpm.parts) { const part = tpm.parts[k]; if (part) draw(part.live, model(a.q, add(a.pos, qrot(a.q, mul(part.center, sc))), sc), tt, a.state === 'fall' ? 0 : glow); }
      for (const dd of tpm.dyn) draw(dd.gl, AM, tt, 0);
    }
    /// A tank: the hull, the turret turned to `yaw` and the barrel raised to `pitch`.
    function warDrawTank(at, q, yaw, pitch, tint) {
      const tp = add(at, [0, 1.3, 0]);
      draw(warMeshes.tank, model(q, at), tint);
      draw(warMeshes.turret, model(qheading(yaw, 0), tp), tint);
      draw(warMeshes.barrel, model(qheading(yaw, pitch), add(tp, [0, 0.5, 0])), tint);
    }
    /// A soldier at `at` (their feet), facing `yaw`, legs swinging with `phase` (the distance walked).
    function warDrawSoldier(at, yaw, phase, tint, crouch = false, moving = true) {
      const q = qheading(yaw, 0), drop = crouch ? 0.45 : 0, base = add(at, [0, -drop, 0]), sw = moving ? Math.sin(phase * 2.2) * 0.7 : 0;
      draw(warMeshes.soldier, model(q, base), tint);
      draw(warMeshes.leg, model(qmul(q, qaxis([1, 0, 0], sw)), add(base, qrot(q, [-0.12, 0.9 - drop * 0.4, 0]))), tint);
      draw(warMeshes.leg, model(qmul(q, qaxis([1, 0, 0], -sw)), add(base, qrot(q, [0.12, 0.9 - drop * 0.4, 0]))), tint);
    }
    /// Your team shows in bright green; in Fight everyone keeps their own colour.
    const teamTint = (o) => (netFight() ? o.colour : [0.45, 1.5, 0.6]);
    function warDrawVan(at, q, tint) { draw(warMeshes.van, model(q, at), tint); }
    function warRender(t) {
      if (!war || screen !== 'fly') return;
      if (war.foot) {
        if (camMode !== 1 && war.zoomI === 0 && !(war.net && war.dead)) warDrawSoldier(war.tank.pos, war.tank.turret, war.tank.walk, war.dead ? [0.2, 0.18, 0.17] : [0.8, 1, 1.5], war.tank.crouch, war.tank.moving);
        if (war.tank.air > 0.5 && camMode !== 1) draw(warMeshes.canopy, model(qheading(war.tank.turret, 0), war.tank.pos), [1, 1, 1]);
      } else if (war.driving) { if (!(war.net && war.dead)) warDrawVan(war.tank.pos, war.tank.q, [0.8, 1, 1.4]); }
      else if (war.vehicle === 'tank' && !(war.net && war.dead)) warDrawTank(war.tank.pos, war.tank.q, war.tank.turret, war.tank.gun, war.dead ? [0.2, 0.18, 0.17] : [0.72, 0.9, 1.3]);
      if (war.net) for (const o of war.net.others.values()) {
        if (!o.alive || !o.rep || !o.shown) continue;
        if (o.rep.kind === 'van') warDrawVan(o.shown, o.rep.q, teamTint(o));
        else if (o.rep.kind === 'soldier') {
          const moved = o.lastShown ? Math.hypot(o.shown[0] - o.lastShown[0], o.shown[2] - o.lastShown[2]) : 0; o.lastShown = o.shown.slice(); o.walk = (o.walk || 0) + moved * 0.9;
          warDrawSoldier(o.shown, o.rep.turret, o.walk, teamTint(o), false, moved > 0.01);
        } else if (o.rep.kind === 'tank') warDrawTank(o.shown, o.rep.q, o.rep.turret, o.rep.gun, teamTint(o));
        else if (planeMeshes[o.rep.kind]) warDrawAircraft({ id: o.rep.kind, spec: PLANES.find((q) => q.id === o.rep.kind), pos: o.shown, q: o.rep.q, state: 'fly' }, teamTint(o), 0);
      }
      for (const l of war.loot) {      // loot: a spinning box and a tall beam in its rarity colour
        const tint = LOOT_RARITY[l.r].tint, y = groundAt(W, l.x, l.z);
        draw(warMeshes.loot, model(qaxis([0, 1, 0], t * 0.0016 + l.id), [l.x, y + 0.5 + Math.sin(t * 0.003 + l.id) * 0.12, l.z], 1), tint, 0.7);
        draw(warMeshes.beam, model([0, 0, 0, 1], [l.x, y, l.z], 1), tint, 1.2);
      }
      if (war.van) warDrawVan(war.van.pos, war.van.q, [1, 1, 1]);
      if (war.net) for (const o of war.net.others.values()) if (o.van) warDrawVan(o.van.pos, o.van.q, teamTint(o));
      if (war.heli && planeMeshes[war.heli.id]) warDrawAircraft({ id: war.heli.id, spec: PLANES.find((q) => q.id === war.heli.id), pos: war.heli.pos, q: war.heli.q, state: 'fly' }, [1, 1, 1], 0);
      if (war.net) for (const o of war.net.others.values()) if (o.heli && planeMeshes[o.heli.id]) warDrawAircraft({ id: o.heli.id, spec: PLANES.find((q) => q.id === o.heli.id), pos: o.heli.pos, q: o.heli.q, state: 'fly' }, teamTint(o), 0);
      for (const c of war.craters) draw(warMeshes.crater, model([0, 0, 0, 1], c.p, c.r), [0.1, 0.085, 0.07]);
      if (war.base && war.vehicle === 'plane') draw(war.base.ship ? warMeshes.carrier : warMeshes.runway, model([0, 0, 0, 1], [war.base.x, war.base.ship ? -2 : Math.max(groundAt(W, war.base.x, war.base.z), 0), war.base.z]), [1, 1, 1]);
      for (const g of war.ground) {
        const tint = g.dead ? [0.2, 0.18, 0.17] : [1, 1, 1], q = qheading(g.heading), at = [g.pos[0], g.pos[1], g.pos[2]];
        if (INF.has(g.kind)) {
          if (g.dead) { draw(warMeshes.soldier, model(qmul(q, qaxis([1, 0, 0], -1.45)), add(at, [0, 0.25, 0])), tint); continue; }
          const moved = g._lx != null ? Math.hypot(at[0] - g._lx, at[2] - g._lz) : 0; g._lx = at[0]; g._lz = at[2]; g.walk = (g.walk || 0) + moved * 0.9;
          warDrawSoldier(at, g.heading, g.walk, g.kind === 'rpgman' ? [1.9, 0.9, 0.2] : [1.7, 0.45, 0.35], !!g.cover, moved > 0.005);
        } else if (g.kind === 'tank') warDrawTank(at, q, g.turret, 0.04, tint);
        else draw(warMeshes[g.kind], model(q, at), tint);
      }
      for (const a of war.foes) warDrawAircraft(a, [1.8, 0.22, 0.16], 0);
      if (war.friend) warDrawAircraft(war.friend, [0.62, 0.82, 1.2], 0);
      for (const f of war.flyers) draw(warMeshes.treeProp, model(f.q, f.pos, clamp(f.h / 12, 0.6, 2)), f.hot ? [1.7, 0.8, 0.25] : [0.45, 0.7, 0.35], f.hot ? 0.8 : 0);
      for (const b of war.bullets) draw(warMeshes.tracer, model(qDir(b.vel), b.pos, b.shell ? 2.4 : 1), b.owner === 'e' ? [1, 0.35, 0.25] : [1, 0.9, 0.4], 2.2);
      for (const b of war.bombsAir) draw(warMeshes.bomb, model(qDir(b.vel), b.pos, 1.4), [1, 1, 1], 0);
      for (const m of war.missilesAir) { draw(warMeshes.missile, model(qDir(m.vel), m.pos, 1.2), [1, 1, 1], 0.4); if (m.t < 4 && !(m.drop && m.t < 0.28)) draw(warMeshes.tracer, model(qDir(m.vel), sub(m.pos, mul(norm(m.vel), 2.2)), 2.2), [1, 0.62, 0.25], 3); }     // the motor's flame
    }

    // ---- the war HUD: sights, markers, ammunition, radar
    function warHud(W2, H2, s, box) {
      if (!war) return;
      const m = lastVP, { f, u } = flight.axes(), tank = war.vehicle === 'tank';
      const proj = (p) => {
        if (!m) return null;
        const cw = m[3] * p[0] + m[7] * p[1] + m[11] * p[2] + m[15];
        if (cw <= 1) return null;
        return { x: ((m[0] * p[0] + m[4] * p[1] + m[8] * p[2] + m[12]) / cw * 0.5 + 0.5) * W2, y: (1 - ((m[1] * p[0] + m[5] * p[1] + m[9] * p[2] + m[13]) / cw * 0.5 + 0.5)) * H2 };
      };
      const edgePoint = (p) => {
        const rel = sub(p, flight.pos), { f: ff, r: rr, u: uu } = flight.axes(), depth = dot(rel, ff), side = dot(rel, rr) * (depth < 0 ? -1 : 1), up = dot(rel, uu) * (depth < 0 ? -1 : 1);
        const dx = side || 0.001, dy = -up || 0.001, k = Math.min((W2 / 2 - 24) / Math.abs(dx), (H2 / 2 - 24) / Math.abs(dy));
        const x = W2 / 2 + dx * k, y = H2 / 2 + dy * k;
        return { x, y, angle: Math.atan2(dy, dx) };
      };
      const onScr = (q, pad = 16) => q && q.x > pad && q.x < W2 - pad && q.y > pad && q.y < H2 - pad;
      h2.textAlign = 'center'; h2.textBaseline = 'middle'; h2.lineWidth = 1.6;
      { // What you are playing, and which wave.
        const vn = (WAR_VEHICLES.find((v) => v.id === warVeh) || WAR_VEHICLES[0]).name, mark = war.assist === 'auto' ? ' · AUTO' : war.assist === 'easy' ? ' · EASY' : '';
        const banner = `${vn}${mark} · wave ${war.wave} · ${war.kills} kill${war.kills === 1 ? '' : 's'}`;
        h2.font = `800 ${Math.round(15 * s + 3)}px system-ui`; const bw0 = h2.measureText(banner).width + 28;
        box(W2 / 2 - bw0 / 2, 8, bw0, 26 * s + 6); h2.fillStyle = '#fff'; h2.fillText(banner, W2 / 2, 8 + (26 * s + 6) / 2);
        const groundLeft = war.ground.filter((g) => !g.dead).length, fighterLeft = war.foes.filter((a) => a.state !== 'gone').length;
        const objective = `WAVE ${war.wave}: destroy ${war.waveGround ?? war.ground.length} targets${war.waveFighters ? ` and ${war.waveFighters} fighters` : ''} · ${groundLeft + fighterLeft} left`;
        h2.font = `700 ${Math.round(10 * s + 2)}px system-ui`; h2.fillStyle = '#ffd166';
        h2.fillText(objective, W2 / 2, 42 * s + 8);
      }
      const fmtD = (d) => (d < 950 ? Math.round(d) + ' m' : (d / 1000).toFixed(1) + ' km');
      // Targets: ground (orange), enemy fighters (red), your wingman (blue).
      h2.font = `700 ${Math.round(9 * s + 2)}px system-ui`;
      const near = war.ground.filter((g) => !g.dead).map((g) => [len(sub(g.pos, flight.pos)), g]).sort((a, b) => a[0] - b[0]).slice(0, 14);
      let labels = 0;
      const placed = [];        // where labels already are: a label is skipped if it would sit on top of another
      const canLabel = (x, y) => { if (placed.some((p) => Math.abs(p.x - x) < 120 && Math.abs(p.y - y) < 15)) return false; placed.push({ x, y }); return true; };
      for (const [dd, g] of near) {
        if (dd > 7000) continue;
        const q = proj(add(g.pos, [0, 3, 0])); if (!onScr(q, 10)) continue;
        const pulse = war.ground.filter((x) => !x.dead).length <= 3 ? 1 + 0.18 * Math.sin(performance.now() / 120) : 1;
        h2.strokeStyle = h2.fillStyle = '#ff9f43'; h2.lineWidth = 2.5;
        const height = Math.max(0, g.pos[1] - flight.pos[1]);
        const r = clamp(2600 / dd * 9 + height / 120, 7, 22) * pulse;
        h2.strokeRect(q.x - r, q.y - r, r * 2, r * 2);
        if (labels < 2 && canLabel(q.x, q.y + r + 9)) { h2.fillText(`${WAR_KINDS[g.kind].name} ${fmtD(dd)}`, q.x, q.y + r + 9); labels++; }
        if (g.hp < g.maxHp) { h2.fillStyle = 'rgba(0,0,0,.6)'; h2.fillRect(q.x - r, q.y - r - 6, r * 2, 3); h2.fillStyle = '#ff9f43'; h2.fillRect(q.x - r, q.y - r - 6, r * 2 * clamp(g.hp / g.maxHp, 0, 1), 3); }
      }
      /// Height ("Y level") of a marker next to yours: its own Y and how far above (+) or below (-) you it is.
      const yTag = (a) => { const dy = Math.round(a.pos[1] - flight.pos[1]); return `Y${Math.round(a.pos[1])} (${dy >= 0 ? '+' : ''}${dy})`; };
      const markAir = (a, col, label, team = false) => {
        if (a.state !== 'fly') return;
        const dd = len(sub(a.pos, flight.pos)), q0 = proj(a.pos), q = onScr(q0, 10) ? q0 : edgePoint(a.pos), locked = war.lock === a, lastFew = war.ground.filter((g) => !g.dead).length + war.foes.filter((f) => f.state === 'fly').length <= 3, r = (locked ? 19 : 14) * (lastFew ? 1 + 0.18 * Math.sin(performance.now() / 120) : 1);
        h2.strokeStyle = h2.fillStyle = col; h2.lineWidth = 3;
        if (onScr(q, 10)) {
          h2.strokeRect(q.x - r, q.y - r, r * 2, r * 2);
          if (team) {          // a teammate: a second bracket, a green glow and the name always shown
            h2.save(); h2.shadowColor = col; h2.shadowBlur = 14; h2.lineWidth = 2; h2.strokeRect(q.x - r - 5, q.y - r - 5, r * 2 + 10, r * 2 + 10); h2.restore();
            h2.save(); h2.font = `800 ${Math.round(12 * s + 3)}px system-ui`; h2.textAlign = 'center'; h2.shadowColor = 'rgba(0,0,0,.8)'; h2.shadowBlur = 4; h2.fillStyle = col; h2.fillText(`${label}  ${fmtD(dd)}  ${yTag(a)}`, q.x, q.y - r - 10); h2.restore();
          } else
          if (labels < 2 && canLabel(q.x, q.y + r + 11)) { h2.fillText(`${label} ${fmtD(dd)} ${yTag(a)}${locked ? (war.lockT >= 1 ? ' LOCK' : ' …') : ''}`, q.x, q.y + r + 11); labels++; }
        } else if (q) {
          const ang = q.angle || Math.atan2(q.y - H2 / 2, q.x - W2 / 2), ex = q.x, ey = q.y;
          h2.save(); h2.translate(ex, ey); h2.rotate(ang); h2.beginPath(); h2.moveTo(11, 0); h2.lineTo(-7, -8); h2.lineTo(-7, 8); h2.closePath(); h2.fill(); h2.restore();
          if (team || (labels < 2 && canLabel(ex, ey + 18))) { h2.fillText(`${label} ${fmtD(dd)} ${yTag(a)}`, ex, ey + 18); if (!team) labels++; }
        }
      };
      if (war.net) for (const o of war.net.others.values()) {
        if (!o.alive || !o.rep || !o.shown) continue;
        // Your team is always bright green with a star; players you are fighting are red.
        const foeP = netFight();
        markAir({ state: 'fly', pos: add(o.shown, [0, o.rep.kind === 'soldier' ? 2.6 : 7, 0]) }, foeP ? '#ff5d5d' : '#39ff7a', (foeP ? '' : '★ ') + o.name.slice(0, 12), !foeP);
      }
      for (const a of war.foes) markAir(a, '#ff5d5d', 'BANDIT');
      if (war.friend) markAir(war.friend, '#39ff7a', '★ WINGMAN', true);
      // The gun sight: the cross where the shells go, 650 m ahead, and a lead cue on the locked fighter.
      const sight = proj(add(flight.pos, mul(f, 650)));
      if (onScr(sight, 4) && war.L.gun > 0 && !tank) {
        h2.strokeStyle = 'rgba(255,240,150,.9)'; h2.beginPath(); h2.arc(sight.x, sight.y, 13, 0, Math.PI * 2); h2.moveTo(sight.x - 21, sight.y); h2.lineTo(sight.x - 8, sight.y); h2.moveTo(sight.x + 8, sight.y); h2.lineTo(sight.x + 21, sight.y); h2.moveTo(sight.x, sight.y - 21); h2.lineTo(sight.x, sight.y - 8); h2.stroke();
      }
      if (lockAlive(war.lock) && !tank) {
        // Lock-on box on the target: a thin box while it tracks, a bright one with LOCK once the missile can fire.
        const t = war.lock, q0 = proj(lockPos(t)), q = onScr(q0, 10) ? q0 : edgePoint(lockPos(t)), on = war.lockT >= 1, sz = 22 * s + 8;
        h2.strokeStyle = h2.fillStyle = on ? '#ff3b3b' : '#ffd166'; h2.lineWidth = on ? 3 : 2;
        h2.strokeRect(q.x - sz, q.y - sz, sz * 2, sz * 2);
        if (!on) { h2.beginPath(); h2.arc(q.x, q.y, sz + 6, -Math.PI / 2, -Math.PI / 2 + war.lockT * Math.PI * 2); h2.stroke(); }
        h2.font = `800 ${Math.round(11 * s + 3)}px system-ui`; h2.textAlign = 'center';
        h2.fillText(on ? (war.missiles > 0 ? 'LOCK: PRESS N' : 'LOCK: NO MISSILES') : 'LOCKING…', q.x, q.y + sz + 16 * s + 4);
        h2.lineWidth = 1;
      }
      const lt = war.lock;
      if (lt && lt.state === 'fly' && war.L.gun > 0 && !tank) {
        const ld = WAR.leadPoint(flight.pos, flight.vel, lt.pos, lt.vel, WAR.GUN.speed);
        if (ld && ld.t < 2) { const q = proj(add(ld.point, [0, 0.5 * WAR.G * ld.t * ld.t, 0])); if (onScr(q, 4)) { h2.strokeStyle = '#ff5d5d'; h2.beginPath(); h2.arc(q.x, q.y, 6, 0, Math.PI * 2); h2.stroke(); h2.fillStyle = '#ff5d5d'; h2.fillRect(q.x - 1, q.y - 1, 2, 2); } }
      }
      if (war.foot) {
        const z = SOLDIER.zoom[war.zoomI], cx = W2 / 2, cy = H2 / 2;
        if (z === 1) {
          const px = mouse.in && mouse.w ? cx + mouse.px / mouse.w * W2 : cx, py = mouse.in && mouse.h ? cy + mouse.py / mouse.h * H2 : cy;
          h2.strokeStyle = 'rgba(255,255,255,.9)'; h2.lineWidth = 2; h2.beginPath();
          h2.moveTo(px - 14, py); h2.lineTo(px - 5, py); h2.moveTo(px + 5, py); h2.lineTo(px + 14, py); h2.moveTo(px, py - 14); h2.lineTo(px, py - 5); h2.moveTo(px, py + 5); h2.lineTo(px, py + 14); h2.stroke(); h2.lineWidth = 1;
        } else {
          // The scope: a black mask with a round window, a crosshair and range marks that show where the bullet will be 100 to 500 m away.
          const R0 = Math.min(W2, H2) * 0.46;
          h2.save(); h2.fillStyle = 'rgba(0,0,0,.93)'; h2.beginPath(); h2.rect(0, 0, W2, H2); h2.arc(cx, cy, R0, 0, Math.PI * 2, true); h2.fill('evenodd'); h2.restore();
          h2.shadowColor = 'rgba(255,255,255,.9)'; h2.shadowBlur = 4;
          h2.strokeStyle = 'rgba(10,10,10,.95)'; h2.lineWidth = 1.5; h2.beginPath(); h2.arc(cx, cy, R0, 0, Math.PI * 2);
          h2.moveTo(cx - R0, cy); h2.lineTo(cx - 10, cy); h2.moveTo(cx + 10, cy); h2.lineTo(cx + R0, cy); h2.moveTo(cx, cy - R0); h2.lineTo(cx, cy - 10); h2.stroke();
          h2.lineWidth = 1; h2.fillStyle = 'rgba(10,10,10,.95)';
          const tanHalf = Math.tan(31 * DEG) / z;
          h2.textAlign = 'left'; h2.font = `700 ${Math.round(8 * s + 3)}px system-ui`;
          for (const r of SOLDIER.marks || (SOLDIER.marks = [100, 200, 300, 400, 500].map((r) => { const b = { pos: [0, 0, 0], vel: [0, 0, -SOLDIER.muzzle], t: 0 }; while (-b.pos[2] < r && b.t < 3) WAR.bulletStep(b, 0.005); return { r, drop: -b.pos[1] / -b.pos[2] }; }))) {
            const y = cy + (r.drop / tanHalf) * (H2 / 2);
            if (y < cy + R0 - 8) { h2.fillRect(cx - 9, y, 18, 1.5); h2.fillText(String(r.r), cx + 12, y + 4); }
          }
          h2.shadowBlur = 0;
          h2.fillStyle = '#fff'; h2.textAlign = 'center'; h2.fillText(`${z}x   ${war.tank.crouch ? 'CROUCHED' : war.tank.moving ? 'MOVING: RIFLE SWAYS' : 'STEADY'}`, cx, cy + R0 + 16);
        }
        // A compass bearing under the header.
        const deg = Math.round(((war.tank.turret * 57.2958) % 360 + 360) % 360), card = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'][Math.round(deg / 45) % 8];
        h2.fillStyle = 'rgba(255,255,255,.85)'; h2.textAlign = 'center'; h2.font = `700 ${Math.round(10 * s + 3)}px system-ui`; h2.fillText(`${card} ${deg}°`, cx, 62 * s + 4);
        if ((war.rHold || 0) > 0.3) { h2.fillStyle = '#ffd166'; h2.font = `800 ${Math.round(13 * s + 4)}px system-ui`; h2.textAlign = 'center'; h2.fillText(`Keep holding R to respawn… ${Math.round(clamp(war.rHold / 1.5, 0, 1) * 100)}%`, cx, cy + 70 * s); }
        if (war.van && len(sub(war.van.pos, war.tank.pos)) < 10) { h2.fillStyle = '#ffd166'; h2.font = `800 ${Math.round(13 * s + 4)}px system-ui`; h2.fillText('E: get in the van', cx, cy + 110 * s); }
        if (war.heli && len(sub(war.heli.pos, war.tank.pos)) < 14) { h2.fillStyle = '#ffd166'; h2.font = `800 ${Math.round(13 * s + 4)}px system-ui`; h2.fillText('E: climb into the helicopter', cx, cy + 90 * s); }
      }
      // The bombsight: where a bomb dropped this instant would land.
      if (tank && !war.foot && !war.driving) {
        // Where the next shell would land, and how long until the cannon is ready.
        const sh = { pos: war.tank.muzzle(), vel: add(war.tank.aim().map((v) => v * TANK.shell), war.tank.vel), t: 0 };
        for (let i = 0; i < 260 && sh.pos[1] > groundAt(W, sh.pos[0], sh.pos[2]); i++) WAR.bulletStep(sh, 0.04);
        const q = proj(sh.pos), ready = war.tank.reload <= 0;
        if (onScr(q, 4)) {
          h2.strokeStyle = h2.fillStyle = ready ? '#ffd166' : '#ff9f43';
          h2.beginPath(); h2.arc(q.x, q.y, 14, 0, Math.PI * 2); h2.moveTo(q.x - 22, q.y); h2.lineTo(q.x - 8, q.y); h2.moveTo(q.x + 8, q.y); h2.lineTo(q.x + 22, q.y); h2.moveTo(q.x, q.y - 22); h2.lineTo(q.x, q.y - 8); h2.moveTo(q.x, q.y + 8); h2.lineTo(q.x, q.y + 22); h2.stroke();
          if (!ready) { h2.beginPath(); h2.arc(q.x, q.y, 20, -Math.PI / 2, -Math.PI / 2 + (1 - war.tank.reload / TANK.reload) * Math.PI * 2); h2.stroke(); }
          h2.font = `700 ${Math.round(9 * s + 2)}px system-ui`; h2.fillText(`${fmtD(len(sub(sh.pos, flight.pos)))}`, q.x, q.y + 32);
        }
      }
      if (war.bombs > 0 && !tank) {
        const hit = WAR.impactPoint(add(flight.pos, mul(u, -1.6 * (plane.scale || 1))), flight.vel, (x, z) => groundAt(W, x, z), flight.wind || v3(), 0.08);
        const q = proj(hit.pos);
        if (onScr(q, 4)) {
          h2.strokeStyle = '#ffd166'; h2.fillStyle = '#ffd166';
          h2.beginPath(); h2.moveTo(q.x, q.y - 11); h2.lineTo(q.x + 11, q.y); h2.lineTo(q.x, q.y + 11); h2.lineTo(q.x - 11, q.y); h2.closePath(); h2.stroke();
          h2.beginPath(); h2.arc(q.x, q.y, 2, 0, Math.PI * 2); h2.fill();
          // The countdown is small, faint and off to the side, and hidden when the marker is over the middle of the screen (your plane).
          if (Math.hypot(q.x - W2 / 2, q.y - H2 / 2) > 90 * s + 40) { h2.save(); h2.globalAlpha = 0.7; h2.font = `700 ${Math.round(8 * s + 2)}px system-ui`; h2.textAlign = 'left'; h2.fillText(`${hit.t.toFixed(0)}s`, q.x + 14, q.y + 4); h2.restore(); }
        } else {
          // Off the screen: an arrow at the edge.
          h2.fillStyle = '#ffd166'; h2.fillText(`BOMB IMPACT ${fmtD(len(sub(hit.pos, flight.pos)))} ${hit.pos[1] < flight.pos[1] ? '↓' : ''}`, W2 / 2, H2 * 0.15 + 16);
        }
      }
      // Bottom panel: health, weapons, score.
      const bw = Math.min(W2 - 24, 420), bx = W2 / 2 - bw / 2, by = H2 - 46 * s - 6, bh = 40 * s;
      box(bx, by, bw, bh);
      h2.textAlign = 'left'; h2.font = `700 ${Math.round(11 * s + 2)}px system-ui`;
      const hpF = clamp(war.hp / war.maxHp, 0, 1);
      h2.fillStyle = 'rgba(255,255,255,.15)'; h2.fillRect(bx + 10, by + 8, bw - 20, 6);
      h2.fillStyle = hpF > 0.5 ? '#5bd17a' : hpF > 0.25 ? '#ffd166' : '#ff5d5d'; h2.fillRect(bx + 10, by + 8, (bw - 20) * hpF, 6);
      if (war.foot) { h2.fillStyle = 'rgba(90,169,255,.25)'; h2.fillRect(bx + 10, by + 16, bw - 20, 4); h2.fillStyle = '#5aa9ff'; h2.fillRect(bx + 10, by + 16, (bw - 20) * clamp(war.shield / SOLDIER.shieldMax, 0, 1), 4); }
      h2.fillStyle = '#fff';
      const wp = war.driving ? `VAN   ${Math.round(Math.abs(war.tank.speed) * 3.6)} km/h   E: get out when stopped` : war.foot ? `${war.weapon === 'rpg' ? `RPG ${war.rpg}` : `RIFLE ${war.mag}/${war.gun}`}  GREN ${war.bombs}  BAND ${war.bandage}  SHLD ${war.shieldPots}  KIT ${war.medkit}   ${war.reloadT > 0 ? 'RELOADING' : war.mag === 0 ? 'EMPTY' : ''}` : tank ? `CANNON ${war.shells}   MACHINE GUN ${war.gun}   ${war.tank.reload > 0 ? 'RELOADING' : 'READY'}` : [war.L.gun ? `GUN ${war.gun}` : null, `BOMB ${war.bombs}`, war.L.missiles ? `MSL ${war.missiles}` : null, `FLARE ${war.flares}`].filter(Boolean).join('   ');
      h2.fillText(wp, bx + 10, by + 26 * s + 3);
      h2.textAlign = 'right'; h2.fillText(`WAVE ${war.wave}  ·  ${war.score} pts`, bx + bw - 10, by + 26 * s + 3);
      if (war.net) {        // who is in the battle, and how they are doing
        h2.textAlign = 'left'; h2.font = `700 ${Math.round(10 * s + 2)}px system-ui`;
        const rows = [[netMyName() + ' (you)', netFight() ? war.net.kills[netMyId] || 0 : Math.round(war.hp / war.maxHp * 100), '#fff'], ...[...war.net.others.values()].map((o) => [o.name, netFight() ? war.net.kills[o.id] || 0 : Math.round(o.hp), o.alive ? (netFight() ? '#cfe6ff' : '#39ff7a') : '#888'])];
        h2.fillStyle = 'rgba(8,12,24,.55)'; h2.fillRect(8, 44 * s + 6, 128, 14 * rows.length + 8);
        rows.forEach(([name, v, col], i) => { h2.fillStyle = col; h2.fillText(name.slice(0, 11), 14, 44 * s + 19 + i * 14); h2.textAlign = 'right'; h2.fillText(netFight() ? `${v} kills` : `${v}%`, 130, 44 * s + 19 + i * 14); h2.textAlign = 'left'; });
        if (war.net.winner) { h2.textAlign = 'center'; h2.font = `800 ${Math.round(24 * s + 4)}px system-ui`; h2.fillStyle = '#ffd166'; h2.fillText('MATCH OVER', W2 / 2, H2 * 0.3); }
      }
      // The feed of what just happened.
      h2.textAlign = 'left'; h2.font = `600 ${Math.round(10 * s + 2)}px system-ui`;
      war.feed.forEach((fd, i) => { h2.fillStyle = `rgba(255,255,255,${clamp(fd.t, 0, 1)})`; h2.fillText(fd.text, 14, H2 * (war.net ? 0.34 : 0.22) + i * 15); });
      // A small radar: you at the centre, ahead is up. Enemies red, wingman blue, ground targets orange.
      const R = Math.round(44 * s + 14), cx = W2 - R - 12, cy = R + 12, range = 6000;
      h2.fillStyle = 'rgba(8,12,24,.55)'; h2.beginPath(); h2.arc(cx, cy, R, 0, Math.PI * 2); h2.fill();
      h2.strokeStyle = 'rgba(255,255,255,.25)'; h2.lineWidth = 1; h2.beginPath(); h2.arc(cx, cy, R, 0, Math.PI * 2); h2.arc(cx, cy, R / 2, 0, Math.PI * 2); h2.moveTo(cx, cy - R); h2.lineTo(cx, cy + R); h2.moveTo(cx - R, cy); h2.lineTo(cx + R, cy); h2.stroke();
      const blip = (p, col, sq, ring = false) => {
        const dx = p[0] - flight.pos[0], dz = p[2] - flight.pos[2], ch = Math.cos(flight.heading), sh = Math.sin(flight.heading);
        const fx = dx * ch + dz * sh, fz = -dx * sh + dz * ch, rr = Math.hypot(fx, fz), k = rr > range ? range / rr : 1;
        const x = cx + fx * k / range * R, y = cy + fz * k / range * R;
        h2.fillStyle = col; if (sq) h2.fillRect(x - 2, y - 2, 4, 4); else { h2.beginPath(); h2.arc(x, y, ring ? 4 : 3, 0, Math.PI * 2); h2.fill(); if (ring) { h2.strokeStyle = '#fff'; h2.lineWidth = 1.5; h2.stroke(); } }
      };
      for (const g of war.ground) if (!g.dead) blip(g.pos, '#ff9f43', true);
      if (war.net) for (const o of war.net.others.values()) if (o.alive && o.shown) blip(o.shown, netFight() ? '#ffb347' : '#39ff7a', false, !netFight());
      for (const a of war.foes) if (a.state === 'fly') blip(a.pos, '#ff5d5d', false);
      if (war.friend && war.friend.state === 'fly') blip(war.friend.pos, '#39ff7a', false, true);
      h2.fillStyle = '#fff'; h2.font = `800 ${Math.round(10 * s + 3)}px system-ui`; h2.textAlign = 'center'; h2.fillText(`Y${Math.round(flight.pos[1])}`, cx, cy + R + 13);
      h2.fillStyle = '#fff'; h2.beginPath(); h2.moveTo(cx, cy - 5); h2.lineTo(cx + 4, cy + 4); h2.lineTo(cx - 4, cy + 4); h2.closePath(); h2.fill();
      if (war.net && war.dead && war.net.respawnT > 0) { h2.textAlign = 'center'; h2.font = `800 ${Math.round(24 * s + 4)}px system-ui`; h2.fillStyle = '#ff9f9f'; h2.fillText(`DESTROYED · BACK IN ${Math.ceil(war.net.respawnT)}`, W2 / 2, H2 * 0.4); }
      if (war.briefingT > 0) {
        h2.textAlign = 'center'; h2.font = `800 ${Math.round(17 * s + 3)}px system-ui`; h2.fillStyle = '#fff';
        h2.fillText(`WAVE ${war.wave} BRIEFING · ${war.foot || war.driving ? 'KILL' : 'DESTROY'} ${war.waveGround ?? war.ground.length} ${war.foot || war.driving ? 'ENEMY SOLDIERS' : 'TARGETS'}${war.waveFighters ? ` + ${war.waveFighters} FIGHTERS` : ''}`, W2 / 2, H2 * 0.31);
        h2.font = `700 ${Math.round(11 * s + 2)}px system-ui`; h2.fillStyle = '#ffd166';
        h2.fillText(war.driving ? 'W/S drive · A/D steer · Shift boost · E get out when stopped' : war.foot ? 'WASD walk · Shift run · aim with the cursor (edges turn) · click fire · right-click scope · R reload · G grenade' : tank ? 'WASD drive · Shift boost · mouse aim · click or Enter to fire' : `Enter / click: guns · Z: bombs${war.L.missiles ? ' · N: missile' : ''} · L: flares`, W2 / 2, H2 * 0.31 + 26 * s);
      }
      if (war.waveClear) { h2.textAlign = 'center'; h2.font = `900 ${Math.round(26 * s + 4)}px system-ui`; h2.fillStyle = '#ffd166'; h2.fillText(`WAVE ${war.wave} CLEARED  +${250 * war.wave}`, W2 / 2, H2 * 0.42); }
      const nextGround = war.ground.filter((g) => !g.dead).sort((a, b) => len(sub(a.pos, flight.pos)) - len(sub(b.pos, flight.pos)))[0];
      if (nextGround) {
        const d = sub(nextGround.pos, flight.pos), ax = dot(d, flight.axes().r), az = dot(d, flight.axes().f), dirs = ['↑', '↗', '→', '↘', '↓', '↙', '←', '↖'], arrow = dirs[(Math.round((Math.atan2(ax, az) / (Math.PI / 4)) + 8) % 8)];
        h2.textAlign = 'center'; h2.font = `800 ${Math.round(11 * s + 2)}px system-ui`; h2.fillStyle = '#ffb15c'; h2.fillText(`NEXT TARGET ${arrow} ${fmtD(len(d))}`, W2 / 2, 62 * s + 8);
      }
      if (war.pullUp || (war.assist === 'pro' && war.vehicle === 'plane' && !plane.rotor && flight.pos[1] - groundAt(W, flight.pos[0], flight.pos[2]) < 80)) {
        h2.textAlign = 'center'; h2.font = `900 ${Math.round(24 * s + 4)}px system-ui`; h2.fillStyle = war.pullUp ? '#ffd166' : '#ff9f43'; h2.fillText(war.pullUp ? 'PULL UP' : 'LOW ALTITUDE', W2 / 2, H2 * 0.23);
      }
      if (war.vehicle === 'plane' && mouseOn && !paused) {
        const ax = W2 / 2, ay = H2 / 2, ar = ringRadius();
        h2.strokeStyle = 'rgba(255,255,255,.68)'; h2.lineWidth = 1.5; h2.beginPath(); h2.arc(ax, ay, ar, 0, Math.PI * 2); h2.stroke();
        if (mouse.in && mouse.engaged) { h2.strokeStyle = '#ffd166'; h2.beginPath(); h2.moveTo(ax, ay); h2.lineTo(ax + mouse.x * ar, ay + mouse.y * ar); h2.stroke(); h2.fillStyle = '#ffd166'; h2.beginPath(); h2.arc(ax + mouse.x * ar, ay + mouse.y * ar, 5, 0, Math.PI * 2); h2.fill(); }
      }
      if (war.guiding && war.guideM && !war.guideM.dead) {
        const m = war.guideM; h2.save(); h2.textAlign = 'center';
        h2.strokeStyle = '#ff5d5d'; h2.lineWidth = 2; h2.beginPath(); h2.arc(W2 / 2, H2 / 2, 18, 0, Math.PI * 2); h2.moveTo(W2 / 2 - 30, H2 / 2); h2.lineTo(W2 / 2 - 10, H2 / 2); h2.moveTo(W2 / 2 + 10, H2 / 2); h2.lineTo(W2 / 2 + 30, H2 / 2); h2.moveTo(W2 / 2, H2 / 2 - 30); h2.lineTo(W2 / 2, H2 / 2 - 10); h2.moveTo(W2 / 2, H2 / 2 + 10); h2.lineTo(W2 / 2, H2 / 2 + 30); h2.stroke();
        h2.fillStyle = '#ff9f9f'; h2.font = `800 ${Math.round(14 * s + 4)}px system-ui`; h2.fillText(`GUIDED MISSILE · ${Math.max(0, 30 - m.t).toFixed(0)}s · ${Math.round(len(m.vel))} m/s`, W2 / 2, 70 * s);
        h2.font = `600 ${Math.round(10 * s + 3)}px system-ui`; h2.fillStyle = '#fff'; h2.fillText('Steer with the mouse or arrows · Space, click or G detonates · your plane flies itself', W2 / 2, 88 * s);
        h2.restore();
      }
      if (thermal) { h2.fillStyle = '#ffd166'; h2.textAlign = 'left'; h2.font = `800 ${Math.round(11 * s + 2)}px system-ui`; h2.fillText('HEAT VISION', 14, H2 * 0.52); }
      if (netHold()) { h2.fillStyle = 'rgba(8,12,24,.6)'; h2.fillRect(0, H2 * 0.4, W2, H2 * 0.16); h2.fillStyle = '#ffd166'; h2.textAlign = 'center'; h2.font = `800 ${Math.round(24 * s + 6)}px system-ui`; h2.fillText('⏸ ROUND PAUSED BY VOTE', W2 / 2, H2 * 0.49); h2.font = `600 ${Math.round(11 * s + 3)}px system-ui`; h2.fillStyle = '#fff'; h2.fillText('Press U and vote ▶ Playing to carry on', W2 / 2, H2 * 0.53); }
      // Warnings and the red flash when you are hit.
      if (war.warn) { h2.textAlign = 'center'; h2.font = `800 ${Math.round(22 * s + 4)}px system-ui`; h2.fillStyle = Math.floor(performance.now() / 180) % 2 ? '#ff5d5d' : '#ffd166'; h2.fillText(war.warn, W2 / 2, H2 * 0.18); }
      if (war.outT > 0) { h2.strokeStyle = `rgba(255,45,45,${0.35 + 0.35 * Math.sin(performance.now() / 160)})`; h2.lineWidth = 7; h2.strokeRect(4, 4, W2 - 8, H2 - 8); }
      if (war.flash > 0) { h2.fillStyle = `rgba(255,30,30,${war.flash * 0.35})`; h2.fillRect(0, 0, W2, H2); }
    }

    // ================================================================== CONTROLS HELP
    // What to press, for each game mode: a card shown when a flight starts (and again with ?), a short version under the
    // mode buttons in the menu, a full version in the Controls tab, and clickable weapon buttons in Air War.
    const CTL_FLY = () => plane.rotor ? [
      [['Mouse'], 'Steer', 'Move the cursor into the ring in the middle of the view, then sideways to bank and up or down to tilt forward or back'],
      [['←', '→', '↑', '↓'], 'Steer (keys)', 'left / right bank, up tilts forward and flies on, down slows and flies back'],
      [['W', 'S'], 'Collective', 'W raises the lever, S lowers it. It stays where you leave it'],
      [['A', 'D'], 'Turn', 'swings the nose round (the tail rotor)'],
    ] : [
      [['Mouse'], 'Steer', 'Move the cursor into the ring in the middle of the view, then sideways to roll and turn, up or down to climb or dive'],
      [['←', '→', '↑', '↓'], 'Steer (keys)', 'left / right roll, up climbs, down dives'],
      [['W', 'S'], 'Throttle', 'W adds power, S takes it away (Shift and Ctrl work too)'],
      [['A', 'D'], 'Rudder', 'tidies a turn, and steers on the ground'],
    ];
    const CTL_GEAR = () => plane.rotor ? [] : [[['G'], 'Landing gear', 'up or down (some aircraft have fixed wheels)'], [['F', 'V'], 'Flaps', 'F lowers a notch, V raises one']];
    const CTL_GAME = [[['C'], 'Camera', 'behind, cockpit or far'], [['P'], 'Pause'], [['R'], 'Restart'], [['?'], 'Show this help']];
    function ctlSpec(id) {
      const brakes = [['Space', 'B'], 'Brakes', 'on the ground. In the air they act as an airbrake'];
      switch (id) {
        case 'hoops': return { goal: '90 seconds. Fly through the glowing hoops: the gold one is next and the arrow ahead of you points to it. Every hoop is a point.', rows: [...CTL_FLY(), ...CTL_GAME] };
        case 'trial': return { goal: 'Fly the 12 hoops in order as fast as you can. The gold one is next and the arrow points to it.', rows: [...CTL_FLY(), ...CTL_GAME] };
        case 'landing': return { goal: 'You start on final approach. Slow down, lower the gear and flaps, line up with the runway and touch down softly, then stop.',
          rows: [...CTL_FLY(), ...CTL_GEAR(), ...(plane.rotor ? [] : [[['J'], 'Approach autopilot', 'flies the ILS for you. Gear, flaps and power are still yours'], [['K'], 'Autopilot', 'holds your heading and height']]), brakes, ...CTL_GAME] };
        case 'war': {
          if (warVeh === 'soldier') return { goal: 'You are a soldier on foot. Shoot the enemy riflemen marching at you, clear each wave and survive. Your rifle hits much harder than theirs.', rows: [
            [['W', 'S'], 'Walk', 'forward and back. Hold Shift to run'], [['A', 'D'], 'Step sideways', 'strafe left and right'],
            [['Mouse'], 'Aim and look', 'the crosshair follows the cursor. Move the cursor to the edge of the screen to turn. In the scope the cursor turns the view slowly. Arrow keys also look'],
            [['Space', 'Enter', 'Click'], 'Rifle', 'hold to fire. 30 rounds a magazine; shots drop over distance'], [['R'], 'Reload / respawn', 'tap R to reload (under 2 seconds); hold R for 1.5 seconds to respawn in the same wave'],
            [['2', '1'], 'RPG or rifle', 'press 2 for the RPG (a big rocket, 4 at a time, more every wave) and 1 for the rifle'], [['E'], 'Van or helicopter', 'beside your van or helicopter, E gets in (and out again when it has stopped). The van is fast: W/S drive, A/D steer, Shift boost'], [['H', 'J', 'K'], 'Heal', 'H bandage (+15 health, up to 75), J shield potion (+50 shield), K medkit (full health). Walk over glowing loot to pick it up: grey, blue, purple, gold'], [['Space'], 'Jump', 'jump over things; Shift runs, Ctrl or V crouches'], [['Right-click', 'Z'], 'Scope', 'cycles 1x, 4x and 10x. The marks show where a bullet lands at 100 to 500 m'], [['G'], 'Grenade', 'a short throw that explodes after about 2 seconds'],
            [['Y'], 'Heat vision', 'see through smoke: people, vehicles, aircraft and fires glow white'], [['Ctrl', 'V'], 'Crouch', 'slower, but the rifle steadies'], [['C'], 'Camera', 'first person, behind you, or far'], [['P'], 'Pause'], [['?'], 'Show this help'],
            ...(war && war.net ? [[['U'], 'Vote', 'change the match with the other players']] : []),
            [[], 'Colours', 'Red soldiers are enemies. Your team is green with a star.']] };
          const tank = warVeh === 'tank', auto = warAssist === 'auto';
          const goal = tank ? 'Destroy the enemy targets and tanks. Drive, aim the turret and fire. Clear a wave to start the next; you are re-armed a little each time.'
            : `Destroy ground targets and shoot down enemy fighters. Clear a wave to start the next; you are re-armed a little each time.${auto ? ' In Automatic mode the plane flies itself: you only steer and shoot.' : ''}`;
          const aimNote = warAssist === 'pro' ? '' : tank ? ' The turret also swings to the nearest enemy by itself.' : ' Your shots curve towards an enemy near the sights.';
          return { goal, rows: tank ? [
            [['W', 'S'], 'Drive', 'forward and back'], [['A', 'D'], 'Turn the tank', 'it turns on the spot when stopped'],
            [['Mouse'], 'Aim the turret', `move the cursor out of the ring in the middle: sideways turns the turret, up and down raise the gun.${aimNote}`], [['←', '→', '↑', '↓'], 'Aim (keys)', 'turret left and right, gun up and down'],
            [['Space', 'Enter', 'Click'], 'Cannon', 'a big shell that explodes where it lands. About 2 seconds to reload'], [['B', 'Z'], 'Machine gun', 'hold to fire. Good against planes and trucks'],
            [['Y'], 'Heat vision', 'see through smoke: vehicles and fires glow white'],
            [['C'], 'Camera', 'behind, gunner or far'], [['P'], 'Pause'], [['R'], 'Respawn', 'straight back in the same wave, nothing else restarts'], [['?'], 'Show this help'],
            ...(war && war.net ? [[['U'], 'Vote', 'change the match with the other players']] : []),
            [[], 'Radar colours', 'The radar is always visible in the top-right. Red: fighters · blue: wingman · orange: ground targets.']
          ] : [
            [['Space', 'Enter', 'Click'], 'Guns', `hold to fire. The circle is where the shells go.${aimNote}`],
            [['B', 'Z'], 'Bombs', auto ? 'hold: it drops only when a bomb would hit a target' : 'the bomb lands exactly on the yellow diamond where it was when you pressed. Hold for a stick'],
            ...(plane.rotor ? [[['E'], 'Land and get out', 'touch down and stop, then E: you step out with a rifle and an RPG, and E beside the helicopter climbs back in']] : []), [['Y'], 'Heat vision', 'see through smoke: aircraft, vehicles, people and fires glow white'], [['T'], 'Lock on', 'press T to lock on to the fighter or ground target (base, tank, gun, truck) nearest your nose and keep it locked. T again to let go'], [['/'], 'Chat', 'online games: press / and type to the other players. Your plane flies itself in slow circles while the box is open'], [['G'], 'Guided missile', 'you fly the missile with the mouse or arrows while the plane flies itself. Space, click or G detonates. 2 each round'], [['N'], 'Missile', 'fire at the locked fighter once it says LOCK'], [['L'], 'Flares', 'press when you hear MISSILE! to break its lock'], [['J'], 'Eject', 'bail out: the jet goes down and you fight on foot with a rifle. Ramming an enemy destroys it too'],
            ...(auto ? [[['Mouse', '←', '→'], 'Turn', 'the plane turns towards where you point and keeps its height'], [['↑', '↓'], 'Climb / dive', 'it settles at the new height'], [['W', 'S'], 'Speed', 'faster or slower']] : CTL_FLY()),
            [['C'], 'Camera', 'behind, cockpit or far'], [['P'], 'Pause'], [['R'], 'Respawn', 'straight back in the same wave, nothing else restarts'], [['?'], 'Show this help'],
            ...(war && war.net ? [[['U'], 'Vote', 'change the match with the other players']] : []),
            [[], 'Radar colours', 'The radar is always visible in the top-right. Red: fighters · blue: wingman · orange: ground targets.']] };
        }
        default: return { goal: 'Take off and explore: hills, a canyon, a mountain strip. Watch for engine failures.',
          rows: [...CTL_FLY(), ...CTL_GEAR(), brakes, ...(plane.rotor ? [[['H'], 'Emergency landing', 'levels the helicopter and sets it down. H again to take over']] : [[['K'], 'Autopilot', 'holds your heading and height'], [['J'], 'Approach autopilot', 'flies the ILS to a runway']]),
            [['Y', 'O', 'I'], 'Start-up', 'battery, beacon, engine (Clean start)'], [['1', '2', '3', '4'], 'Ground crew', 'refuel, catering, baggage, pushback (stopped on an apron)'], [['T'], 'Checklist', 'show or hide it'], ...CTL_GAME] };
      }
    }
    function ctlHtml(id, compact) {
      const sp = ctlSpec(id), m = MODES.find((x) => x.id === id) || MODES[0];
      const cap = (k) => (k === 'Mouse' || k === 'Click' ? `<i>${k}</i>` : `<kbd>${k}</kbd>`);
      const rows = sp.rows.map(([keys, name, how]) => `<div class="pg-crow">${keys.length ? `<span class="pg-ckeys">${keys.map(cap).join('')}</span>` : ''}<span class="pg-cname"><b>${name}</b>${how && !compact ? `<small>${how}</small>` : ''}</span></div>`).join('');
      return `<div class="pg-cgoal"><b>${m.icon} ${m.name}</b> ${sp.goal}</div><div class="pg-cgrid">${rows}</div>`;
    }
    // The card over the flight, the "?" button, and (in Air War) the weapon buttons.
    const ctlEl = document.createElement('div'); ctlEl.className = 'pg-ctlcard'; ctlEl.style.display = 'none';
    const ctlBtn = document.createElement('button'); ctlBtn.className = 'pg-ctlbtn'; ctlBtn.textContent = '?'; ctlBtn.title = 'Controls for this mode (?)'; ctlBtn.style.display = 'none';
    const mapEl = document.createElement('div'); mapEl.style.cssText = 'display:none;position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);z-index:30;text-align:center;width:min(92%,400px);box-sizing:border-box;padding:12px;border-radius:14px;background:rgba(8,12,24,.92);color:#fff;font:600 13px system-ui;box-shadow:0 8px 30px rgba(0,0,0,.5)';
    mapEl.innerHTML = '<div style="font:800 15px system-ui">Choose where to land <span data-map="t" style="opacity:.7;font-weight:600"></span></div><canvas data-map="cv" width="360" height="360" style="position:relative;inset:auto;display:block;margin:6px auto;width:min(100%,360px);height:auto;aspect-ratio:1/1;border-radius:8px;cursor:crosshair"></canvas><div style="margin:6px 0;opacity:.8;font-weight:500">Click the map to pick your landing spot inside the white circle: the battlefield grows with every wave. The enemy comes from the top. You jump from the bus and float down: steer a little with W A S D.</div><button data-map="go" class="pg-go">Jump (Enter)</button>';
    for (const ev of ['mousedown', 'pointerdown', 'click']) mapEl.addEventListener(ev, (e) => e.stopPropagation());
    const wbar = document.createElement('div'); wbar.className = 'pg-wbar'; wbar.style.display = 'none';
    const netbar = document.createElement('div'); netbar.className = 'pg-netbar'; netbar.style.display = 'none';
    netbar.innerHTML = '<button data-nb="vote" title="Vote to change the match (U)">🗳 Vote</button><button data-nb="leave" title="Leave this battle">⎋ Leave</button><span data-nb="code" style="align-self:center;font:700 11px system-ui;opacity:.85;padding:0 6px"></span>';
    const voteEl = document.createElement('div'); voteEl.className = 'pg-ctlcard pg-vote'; voteEl.style.display = 'none';
    const qbar = document.createElement('div'); qbar.className = 'pg-qbar'; qbar.style.display = 'none';
    qbar.innerHTML = '<button data-q="voice" title="Spoken calls on / off: ground proximity (Pull up), ATC">🗣</button><button data-q="tcas" title="Traffic calls (TCAS) on / off">📡</button>';
    const syncQbar = () => { qbar.querySelector('[data-q="voice"]').classList.toggle('pg-off', !(gpwsOn || atcOn)); qbar.querySelector('[data-q="tcas"]').classList.toggle('pg-off', !tcasOn); };
    qbar.querySelectorAll('button').forEach((b) => { b.addEventListener('mousedown', (e) => e.stopPropagation()); b.addEventListener('click', (e) => {
      e.stopPropagation();
      if (b.dataset.q === 'voice') { const on = !(gpwsOn || atcOn); gpwsOn = on; atcOn = on; write('gpws', on); write('atc', on); if (!on) cancelSpeech(); toast(on ? 'Spoken calls on' : 'Spoken calls off', 1200); }
      else { tcasOn = !tcasOn; write('tcas', tcasOn); if (!tcasOn) cancelSpeech(); toast(tcasOn ? 'TCAS traffic calls on' : 'TCAS traffic calls off', 1200); }
      syncQbar(); root.focus();
    }); });
    // ---- chat (shared Battle only): T opens it, the plane flies itself in slow circles while you type
    const chatEl = document.createElement('div'); chatEl.className = 'pg-chat'; chatEl.style.display = 'none';
    const chatBox = document.createElement('div'); chatBox.className = 'pg-chatbox'; chatBox.style.display = 'none';
    chatBox.innerHTML = '<div class="pg-chathint">CHAT · your plane is on autopilot · Enter sends · Enter on an empty line or Esc closes</div><div class="pg-chatrow"><input maxlength="120" placeholder="Say something to the room" autocomplete="off" spellcheck="false"><button data-c="mute"></button><button data-c="close" title="Close chat">✕</button></div>';
    const chatInput = chatBox.querySelector('input'), chatMuteBtn = chatBox.querySelector('[data-c="mute"]');
    let chatOpen = false, chatMuted = read('chatoff', false), chatSentAt = 0; const chatLog = [], chatLast = new Map();
    const cleanChat = (t) => String(t == null ? '' : t).replace(/[\u0000-\u001f\u007f<>]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 120);
    function renderChat() {
      chatEl.replaceChildren(...chatLog.slice(-6).map((c) => { const d = document.createElement('div'), b = document.createElement('b'); b.textContent = `${c.n}: `; d.append(b, document.createTextNode(c.text)); return d; }));
      chatEl.style.display = chatLog.length && !chatMuted && screen === 'fly' ? 'flex' : 'none';
      chatMuteBtn.textContent = chatMuted ? 'Chat hidden' : 'Chat shown';
    }
    function pushChat(n, text) { chatLog.push({ n, text, t: 14 }); if (chatLog.length > 30) chatLog.shift(); renderChat(); }
    function openChat() {
      if (!(war && war.net)) { toast('Chat is for online games with other players', 1800); return; }
      if (chatOpen) return;
      chatOpen = true; keys.clear(); warPad.gun = false; warPad.bomb = false;
      if (war.vehicle === 'plane' && war.ap) { war.ap.hdg = flight.heading; war.ap.alt = flight.pos[1]; war.ap.i = 0; }
      chatBox.style.display = 'block'; chatInput.value = ''; renderChat(); chatInput.focus();
    }
    function closeChat() { if (!chatOpen) return; chatOpen = false; chatBox.style.display = 'none'; chatInput.blur(); root.focus(); }
    function sendChat(text) {
      const now = Date.now(); if (now - chatSentAt < 800) { toast('Slow down a little', 900); return; }
      chatSentAt = now; netSend({ t: 'chat', id: netMyId, m: text }); pushChat('You', text);
    }
    function chatEnter() { const text = cleanChat(chatInput.value); if (!text) { closeChat(); return; } sendChat(text); chatInput.value = ''; }
    /// Keys the notch forwards from outside the page while chat is open (the page may not own the keyboard): type them into the box.
    function chatKey(k, down) {
      if (!down) return;
      if (k === 'Enter') chatEnter();
      else if (k === 'Backspace') chatInput.value = chatInput.value.slice(0, -1);
      else if (k.length === 1 && chatInput.value.length < 120) chatInput.value += k;
    }
    function receiveChat(m) {
      if (chatMuted || !war || !war.net) return;
      const now = Date.now(); if (now - (chatLast.get(m.id) || 0) < 600) return; chatLast.set(m.id, now);
      const text = cleanChat(m.m); if (!text) return;
      pushChat(String(war.net.names[m.id] || (netg && netg.peers.get(m.id) && netg.peers.get(m.id).n) || 'Player').slice(0, 14), text);
    }
    chatInput.addEventListener('keydown', (e) => { e.stopPropagation(); if (e.key === 'Enter') { e.preventDefault(); chatEnter(); } else if (e.key === 'Escape') { e.preventDefault(); closeChat(); } });
    chatInput.addEventListener('keyup', (e) => e.stopPropagation());
    for (const el of [chatBox, chatEl]) { el.addEventListener('mousedown', (e) => e.stopPropagation()); el.addEventListener('pointerdown', (e) => e.stopPropagation()); }
    chatBox.querySelectorAll('button').forEach((b) => b.addEventListener('click', (e) => { e.stopPropagation(); if (b.dataset.c === 'close') closeChat(); else { chatMuted = !chatMuted; write('chatoff', chatMuted); renderChat(); chatInput.focus(); } }));
    root.append(chatEl, chatBox, qbar, ctlEl, ctlBtn, wbar, netbar, voteEl, mapEl);
    for (const el of [voteEl, ctlEl, ctlBtn]) { el.addEventListener('mousedown', (e) => e.stopPropagation()); el.addEventListener('pointerdown', (e) => e.stopPropagation()); }
    function voteHtml() {
      const n = netg, row = (key, label, vals) => `<div class="pg-crow" style="align-items:center"><span class="pg-ckeys" style="min-width:70px"><b>${label}</b></span><span class="pg-chips" style="margin:0">${vals.map(([val, name]) => {
        const cur = n.cfg[key] === val, c = netVoteCounts(key)[val] || 0, mine = n.votes[netMyId] && n.votes[netMyId][key] === val;
        return `<button data-vote="${key}:${val}" class="${cur ? 'pg-on' : mine ? 'pg-voted' : ''}">${name}${!cur && c ? ` (${c})` : ''}</button>`; }).join('')}</span></div>`;
      return `<div class="pg-ctitle">Vote to change the match <span>click or press U to close</span></div>
        <div class="pg-cgoal">A change passes when more than half of the players vote for it. Changing the teams, enemies or field starts the battle again; Pause just freezes the round for everyone until the players vote to play on. The game never stops by itself when someone closes the notch.</div>
        <div class="pg-cgrid">${isOpenRoom() ? '' : row('side', 'Teams', [['coop', '🤝 Co-op'], ['versus', '⚔️ Fight']])}${row('npc', 'Enemies', [[true, 'On'], [false, 'Off']])}${row('field', 'Field', ARENAS.map((a) => [a.id, a.name]))}${row('paused', 'Round', [[false, '▶ Playing'], [true, '⏸ Paused']])}</div>`;
    }
    function toggleVote(force) {
      const on = force != null ? force : voteEl.style.display === 'none';
      if (on && netg) { voteEl.innerHTML = voteHtml(); voteEl.style.display = 'block'; voteEl.querySelectorAll('[data-vote]').forEach((b) => b.onclick = (e) => { e.stopPropagation(); const [key, raw] = b.dataset.vote.split(':'); netVoteCast(key, raw === 'true' ? true : raw === 'false' ? false : raw); voteEl.innerHTML = voteHtml(); toggleVoteBind(); }); }
      else voteEl.style.display = 'none';
    }
    function toggleVoteBind() { voteEl.querySelectorAll('[data-vote]').forEach((b) => b.onclick = (e) => { e.stopPropagation(); const [key, raw] = b.dataset.vote.split(':'); netVoteCast(key, raw === 'true' ? true : raw === 'false' ? false : raw); voteEl.innerHTML = voteHtml(); toggleVoteBind(); }); }
    netbar.querySelectorAll('button').forEach((b) => b.addEventListener('click', (e) => { e.stopPropagation(); if (b.dataset.nb === 'vote') toggleVote(); else { netLeave(true); screen = 'menu'; paused = false; muteAudio(); restorePlane(); useBattlefield(''); flight = new Flight(plane); renderUI(); } }));
    netbar.addEventListener('mousedown', (e) => e.stopPropagation());
    /// The buttons for the vehicle in use: a tank has a cannon and a machine gun; an aircraft has guns, bombs, missiles and flares.
    function buildWbar() {
      const tank = war && war.vehicle === 'tank';
      const defs = war && war.driving ? [['van', '🚪', 'Get out', 'E']] : war && war.foot ? [['gun', '🔫', 'Fire', 'Space'], ['rpg', '🚀', 'RPG / rifle', '2'], ['scope', '🔭', 'Scope', 'Z'], ['gren', '💣', 'Grenade', 'G'], ['rel', '🔄', 'Reload', 'R'], ['band', '🩹', 'Bandage', 'H'], ['shp', '🧪', 'Shield', 'J'], ['kit', '✚', 'Medkit', 'K'], ...(war.heli ? [['heli', '🚁', 'Climb in', 'E']] : []), ...(war.van ? [['van', '🚐', 'Get in van', 'E']] : [])] : tank ? [['gun', '💥', 'Cannon', 'Space'], ['bomb', '🔫', 'Machine gun', 'B']]
        : [['gun', '🔫', 'Guns', 'Space'], ['bomb', '💣', 'Bombs', 'B'], ['msl', '🚀', 'Missile', 'N'], ['gde', '🛰', 'Guided', 'G'], ['lock', '🎯', 'Lock on', 'T'], ['flr', '✨', 'Flares', 'L'], ...(plane.rotor ? [['heli', '🚁', 'Land & exit', 'E']] : [])];
      defs.push(['heat', '🔥', 'Heat vision', 'Y']);
      wbar.innerHTML = defs.map(([id, ic, name, key]) => `<button data-w="${id}" title="${name} (${key})"><span>${ic}</span><b>${name}</b><kbd>${key}</kbd><i data-n="${id}"></i></button>`).join('')
        + (war && war.vehicle === 'plane' ? '<button data-w="eject" title="Eject: the jet goes down and you fight on foot with a rifle"><span>🪂</span><b>Eject</b><kbd>J</kbd></button>' : '')
        + '<button data-w="self" title="End this sortie and respawn without losing wave progress"><span>💥</span><b>Self-destruct</b><kbd>X</kbd></button>';
      bindWbar();
    }
    let ctlT = 0, helpMode = null;
    function showCtl(on, secs = 16) {
      ctlT = on ? secs : 0;
      if (on) ctlEl.innerHTML = `<div class="pg-ctitle">Controls <span>click or press ? to close</span></div>${ctlHtml(mode.id, false)}`;
      ctlEl.style.display = on ? 'block' : 'none';
    }
    ctlEl.onclick = () => showCtl(false);
    ctlBtn.onclick = (e) => { e.stopPropagation(); showCtl(ctlEl.style.display === 'none'); root.focus(); };
    const wDown = (id) => { if (id === 'gun') warPad.gun = true; else if (id === 'bomb') warPad.bomb = true; else if (id === 'msl') warLaunch(); else if (id === 'lock') warToggleLock(); else if (id === 'heat') warThermal(); else if (id === 'heli' || id === 'van') warHeliExitEnter(); else if (id === 'band') warHeal('bandage'); else if (id === 'shp') warHeal('shield'); else if (id === 'kit') warHeal('medkit'); else if (id === 'rpg') warSwitchWeapon(war.weapon === 'rpg' ? 'rifle' : 'rpg'); else if (id === 'gde') warLaunchGuided(); else if (id === 'flr') warFlares(); else if (id === 'scope') warScope(); else if (id === 'gren') warGrenade(); else if (id === 'rel') warReload(); };
    const wUp = () => { warPad.gun = false; warPad.bomb = false; };
    function bindWbar() {
      wbar.querySelectorAll('button').forEach((b) => {
        b.addEventListener('pointerdown', (e) => { e.preventDefault(); e.stopPropagation(); if (screen === 'fly' && !paused) { if (b.dataset.w === 'self') warSelfDestruct(); else if (b.dataset.w === 'eject') warEject(); else wDown(b.dataset.w); } });
        b.addEventListener('mousedown', (e) => e.stopPropagation());
        for (const ev of ['pointerup', 'pointerleave', 'pointercancel']) b.addEventListener(ev, wUp);
      });
    }
    /// Shows or hides the buttons and the card to suit the screen (called whenever the screen changes).
    function syncCtlUi() {
      const fly = screen === 'fly';
      ctlBtn.style.display = fly ? 'grid' : 'none'; qbar.style.display = fly ? 'flex' : 'none'; syncQbar();
      wbar.style.display = fly && mode.id === 'war' ? 'flex' : 'none';
      netbar.style.display = fly && mode.id === 'war' && war && war.net ? 'flex' : 'none';
      const codeEl = netbar.querySelector('[data-nb="code"]'); if (codeEl) codeEl.textContent = netg ? `Room ${netg.code} · ${netRoster ? 1 + (netg.peers ? netg.peers.size : 0) : 1} playing` : '';
      if (!fly) { showCtl(false); toggleVote(false); closeChat(); chatLog.length = 0; renderChat(); }
    }
    /// The landing map: the battlefield from above (sea blue, land green), the circle you can play in, and where you will land.
    const mapImgs = {};
    function warMapDraw() {
      if (!war || !war.mapOpen) return;
      const cv = mapEl.querySelector('[data-map="cv"]'), g = cv.getContext('2d'), a = war.arena, Rw = a.R * 1.15, N = 72, sc = 360 / (2 * Rw);
      if (!mapImgs[a.id]) {
        const im = document.createElement('canvas'); im.width = im.height = N; const ig = im.getContext('2d'), d = ig.createImageData(N, N);
        for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
          const h = arenaHeight(a, ((i + 0.5) / N * 2 - 1) * Rw, ((j + 0.5) / N * 2 - 1) * Rw), o = (j * N + i) * 4, sea = h < 0;
          d.data[o] = sea ? 30 : a.desert ? 196 : 70; d.data[o + 1] = sea ? 74 : a.desert ? 170 : 130; d.data[o + 2] = sea ? 122 : a.desert ? 110 : 72; d.data[o + 3] = 255;
        }
        ig.putImageData(d, 0, 0); mapImgs[a.id] = im;
      }
      g.imageSmoothingEnabled = true; g.drawImage(mapImgs[a.id], 0, 0, 360, 360);
      g.strokeStyle = 'rgba(255,255,255,.35)'; g.lineWidth = 1; g.beginPath(); g.arc(180, 180, a.R * sc, 0, Math.PI * 2); g.stroke();
      g.strokeStyle = '#fff'; g.lineWidth = 2; g.beginPath(); g.arc(180, 180, war.R * sc, 0, Math.PI * 2); g.stroke();
      g.fillStyle = '#fff'; g.font = '700 11px system-ui'; g.textAlign = 'center'; g.fillText('ENEMY ↑', 180, 16);
      const p = war.pick || { x: 0, z: 0 }; g.strokeStyle = '#ffd166'; g.fillStyle = '#ffd166'; g.lineWidth = 2;
      g.beginPath(); g.arc(180 + p.x * sc, 180 + p.z * sc, 7, 0, Math.PI * 2); g.stroke(); g.beginPath(); g.arc(180 + p.x * sc, 180 + p.z * sc, 2, 0, Math.PI * 2); g.fill();
    }
    mapEl.querySelector('[data-map="cv"]').addEventListener('click', (e) => {
      if (!war || !war.mapOpen) return;
      const cv = e.currentTarget, r = cv.getBoundingClientRect(), a = war.arena, sc = 360 / (2 * a.R * 1.15);
      let x = ((e.clientX - r.left) / r.width * 360 - 180) / sc, z = ((e.clientY - r.top) / r.height * 360 - 180) / sc;
      const m = Math.hypot(x, z), lim = war.R * 0.85; if (m > lim) { x *= lim / m; z *= lim / m; }
      war.pick = { x, z }; warMapDraw();
    });
    mapEl.querySelector('[data-map="go"]').addEventListener('click', () => warConfirmDrop());
    function warOpenMap() {
      const t = war.tank; war.mapOpen = true; war.mapT = 25; war.pick = { x: t.pos[0], z: t.pos[2] };
      t.air = DROP_ALT; t.dropped = true; t.landed = false; t.pos[1] = groundAt(W, t.pos[0], t.pos[2]) + t.air;
    }
    function warConfirmDrop() {
      if (!war || !war.mapOpen) return;
      war.mapOpen = false; const t = war.tank, p = war.pick;
      t.pos[0] = p.x; t.pos[2] = p.z; t.air = DROP_ALT; t.pos[1] = groundAt(W, p.x, p.z) + t.air;
      toast('🪂 You jumped from the bus. Steer a little with W A S D', 2600);
    }
    function ctlTick(dt) {
      if (chatLog.length) { for (const c of chatLog) c.t -= dt; const n0 = chatLog.length; while (chatLog.length && chatLog[0].t <= 0 && !chatOpen) chatLog.shift(); if (chatLog.length !== n0) renderChat(); }
      { const rh = root.getBoundingClientRect().height; if (rh) { wbar.classList.toggle('pg-compact', rh < 720); netbar.classList.toggle('pg-compact', rh < 720); } }
      if (netg && war && war.net) { const ce = netbar.querySelector('[data-nb="code"]'); if (ce) { const t = `${netg.code} · ${netg.cfg.side === 'versus' ? '⚔ FIGHT' : '🤝 CO-OP'} · ${netg.role === 'host' ? 1 + netg.peers.size : Math.max(2, (netg.roster || []).length)}`; if (ce.textContent !== t) ce.textContent = t; } }
      { const hb = wbar.querySelector('[data-w="heat"]'); if (hb) hb.classList.toggle('pg-lock', thermal); }
      if (thermal && !(screen === 'fly' && mode.id === 'war')) warThermal(false);
      const showMap = !!(war && war.mapOpen && screen === 'fly');
      if (showMap !== (mapEl.style.display === 'block')) { mapEl.style.display = showMap ? 'block' : 'none'; if (showMap) warMapDraw(); }
      if (showMap) { const tt = mapEl.querySelector('[data-map="t"]'); tt.textContent = `${Math.max(0, Math.ceil(war.mapT))}s`; }
      if (ctlT > 0 && (ctlT -= dt) <= 0) showCtl(false);
      if (voteEl.style.display !== 'none' && netg && String(netg.rev) !== voteEl.dataset.rev && !voteEl.matches(':active')) { voteEl.dataset.rev = String(netg.rev); voteEl.innerHTML = voteHtml(); toggleVoteBind(); }
      if (wbar.style.display !== 'none' && war) {
        const n = war.driving ? {} : war.foot ? { gun: war.weapon === 'rpg' ? `${war.rpg}` : `${war.mag}/${war.gun}`, rpg: war.weapon === 'rpg' ? 'RPG' : `${war.rpg}`, gren: war.bombs, band: war.bandage, shp: war.shieldPots, kit: war.medkit, scope: `${SOLDIER.zoom[war.zoomI]}x`, rel: war.reloadT > 0 ? '…' : '' } : war.vehicle === 'tank' ? { gun: war.shells, bomb: war.gun } : { gun: war.L.gun ? war.gun : '–', bomb: war.bombs, msl: war.L.missiles ? war.missiles : '–', gde: war.guided || 0, flr: war.flares };
        for (const k in n) { const el = wbar.querySelector(`[data-n="${k}"]`); if (el && el.textContent !== String(n[k])) el.textContent = n[k]; }
        const lockOn = war.lock && war.lockT >= 1 && war.missiles > 0, mslBtn = wbar.querySelector('[data-w="msl"]');
        if (mslBtn) mslBtn.classList.toggle('pg-lock', !!lockOn);
      }
    }

    // ================================================================== SHARED BATTLES
    // One player hosts a room and shares its code; the others join with it. The host runs the computer enemies and the waves
    // and everyone else is shown them; each player drives their own vehicle and judges the hits on it. In Co-op everyone is
    // on one side; in Fight the players shoot each other (and the enemies, if they are on, shoot everyone).
    const FIGHT_WIN_KILLS = 10;
    let netg = null;           // the room you are in, or null
    const netMyId = (() => { let id = read('netid', ''); if (!id) { id = [...crypto.getRandomValues(new Uint8Array(4))].map((b) => b.toString(16).padStart(2, '0')).join(''); write('netid', id); } return id; })();
    const netMyName = () => (playerName || `Pilot ${netMyId.slice(0, 2).toUpperCase()}`).slice(0, 14);
    const warAuth = () => !war || !war.net || war.net.role === 'host';          // this copy of the game runs the computer enemies
    const netFight = () => !!(war && war.net && war.net.cfg.side === 'versus');  // players shoot each other
    const netSend = (o) => (netg && netg.link ? netg.link.send(o) : false);
    const NET_COLOURS = [[0.62, 0.82, 1.25], [1.25, 0.9, 0.5], [0.7, 1.2, 0.7], [1.2, 0.7, 1.1], [0.8, 1.1, 1.2], [1.2, 1.0, 0.7]];
    const netBump = () => { if (netg) netg.rev = (netg.rev || 0) + 1; };

    function netOpen(role, code) {
      netLeave(true);
      netg = { role, code, cfg: { field: warField, side: warSide, npc: warNpc, paused: false }, link: null, roster: [], peers: new Map(), votes: {}, running: false, hostSeen: 0, hostId: role === 'host' ? netMyId : '',
        status: 'connecting', error: '', joined: Date.now(), t0: Date.now(), lobbyT: 0, helloT: 0, rev: 0, shownRev: -1, saved: null };
      netg.link = new NET.Link(WebSocket, netMsg, (st) => { if (!netg) return; netg.status = st; if (st === 'on') { netg.error = ''; netg.joined = Date.now(); netHello(); if (role === 'host') netSendLobby(); } netBump(); });
      netg.link.join(code);
      // The host also listens for a few minutes in the old (v1) room of this code: a friend on an older version, who can never meet this
      // game, is told on their own screen (as a player named in their lobby) to update, and the host sees who is stuck.
      if (role === 'host') { netg.legacy = new NET.Link(WebSocket, netLegacyMsg, () => {}); netg.legacy.join(code, 'v1'); netg.legacyUntil = Date.now() + 5 * 60 * 1000; }
      netg.timer = setInterval(netHousekeeping, 500);
      netBump();
    }
    function netLegacyMsg(m) {
      if (!netg || !netg.legacy || !m || m.t !== 'hi' || m.id === netMyId) return;
      const now = Date.now();
      if (now - (netg.legacyToast || 0) > 20000) { netg.legacyToast = now; toast(`${String(m.n || 'A friend').slice(0, 14)} is on an older Notch Apple and cannot join: they need to update (2.1.9 or newer)`, 5000); }
      if (now - (netg.legacyReply || 0) > 2000) {          // what an older version shows in its lobby: a "player" saying what to do
        netg.legacyReply = now;
        netg.legacy.send({ t: 'lobby', host: 'update-needed', cfg: { field: 'plains', side: 'coop', npc: true }, roster: [{ id: 'update-needed', n: '⚠ UPDATE NOTCH APPLE (2.1.9+)', v: 'f16' }], running: false });
      }
    }
    function netLeave(quiet = false) {
      if (!netg) return;
      netSend({ t: 'bye', id: netMyId });
      clearInterval(netg.timer); netg.link.close(); if (netg.legacy) { netg.legacy.close(); netg.legacy = null; }
      if (netg.saved) { warField = netg.saved.field; warSide = netg.saved.side; warNpc = netg.saved.npc; }
      netg = null;
      if (war) war.net = null;
      if (!quiet) renderUI();
    }
    const netHello = () => netg && netg.role === 'client' && netSend({ t: 'hi', id: netMyId, n: netMyName(), v: warVeh, pv: BATTLE_PV });
    function netRoster() {          // the host's list of who is here (itself first)
      return [{ id: netMyId, n: netMyName(), v: warVeh }, ...[...netg.peers.values()].map((p) => ({ id: p.id, n: p.n, v: p.v }))];
    }
    function netSendLobby() { if (netg && netg.role === 'host') { netg.roster = netRoster(); netSend({ t: 'lobby', host: netMyId, cfg: netg.cfg, roster: netg.roster, running: netg.running, t0: netg.t0 || 0, pv: BATTLE_PV }); } }
    function netHousekeeping() {
      if (!netg) return;
      const now = Date.now();
      // Starting a game with no way to reach the room server: stop waiting and play offline.
      if ((netg.autoStart || netg.autoJoin) && netg.status !== 'on' && now - netg.joined > 5000) { warOfflineStart(); return; }
      if (netg.role === 'host' && netg.autoStart && netg.status === 'on') { netg.autoStart = false; netHostStart(); return; }
      if (netg.role === 'client' && netg.autoJoin && !netg.hostSeen && netg.status === 'on' && now - netg.joined > 6000) {
        const code = netg.code; netOpen('host', code); netg.autoStart = true; return;     // nobody is hosting: open the game yourself
      }
      if (netg.legacy && now > netg.legacyUntil) { netg.legacy.close(); netg.legacy = null; }
      if (netg.role === 'host') {
        for (const [id, p] of netg.peers) if (now - p.last > 8000) { netg.peers.delete(id); if (war && war.net) war.net.others.delete(id); netBump(); if (war && war.net) warFeed(`${p.n} left`); }
        if (now - netg.lobbyT > 1500) { netg.lobbyT = now; netSendLobby(); }
      } else {
        if (now - netg.helloT > 1800) { netg.helloT = now; netHello(); }
        if (netg.hostSeen && now - netg.hostSeen > 10000) netEnd('The host left the game.');
        else if (!netg.hostSeen && netg.status === 'on' && now - netg.joined > 12000 && !netg.error) { netg.error = 'No game with that code was found. Check the code, and that the host has opened the room.'; netBump(); }
      }
      if (netg && screen === 'menu' && netg.rev !== netg.shownRev) { netg.shownRev = netg.rev; renderUI(); }
    }
    /// The game you were in is over (the host left, or you left): back to the menu.
    function netEnd(why) {
      const wasInMatch = !!(war && war.net);
      netLeave(true);
      if (wasInMatch && screen === 'fly') { toast(why, 4000); screen = 'menu'; paused = false; muteAudio(); restorePlane(); useBattlefield(''); flight = new Flight(plane); }
      else if (why && screen === 'menu') toast(why, 3500);
      renderUI();
    }

    // ---- the host's side of starting and voting
    function netHostStart() {
      if (!netg || netg.role !== 'host' || netg.status !== 'on') return;
      const players = netRoster().map((p, i) => ({ ...p, slot: i }));
      netg.running = true;
      const msg = { t: 'start', cfg: netg.cfg, players, seed: Date.now() & 0xffff };
      netSend(msg);
      netBegin(msg);
    }
    function netSendStartTo(id) { const players = netRoster().map((p, i) => ({ ...p, slot: i })); netSend({ t: 'start', cfg: netg.cfg, players, seed: 0, to: id, late: true }); if (war) { netSendWave(); if (war.net && war.net.treeLog && war.net.treeLog.length) netSend({ t: 'tl', to: id, L: war.net.treeLog.slice(-300) }); } }
    function netVoteCast(key, val) {
      if (!netg) return;
      if (netg.role === 'host') { netg.votes[netMyId] = { ...(netg.votes[netMyId] || {}), [key]: val }; netCountVotes(); }
      else netSend({ t: 'vote', id: netMyId, key, val });
      netBump();
    }
    const NET_VOTE_OPTIONS = { side: ['coop', 'versus'], npc: [true, false], field: ARENAS.map((a) => a.id), paused: [true, false] };
    function netCountVotes() {
      if (!netg || netg.role !== 'host') return;
      if (isOpenRoom()) { for (const id of Object.keys(netg.votes)) if (netg.votes[id]) delete netg.votes[id].side; netg.cfg.side = 'coop'; }
      const ids = netRoster().map((p) => p.id);
      for (const key of Object.keys(NET_VOTE_OPTIONS)) {
        const r = NET.tally(ids, netg.votes, key, netg.cfg[key], NET_VOTE_OPTIONS[key]);
        if (r.passed != null) {
          netg.cfg = { ...netg.cfg, [key]: NET_VOTE_OPTIONS[key].find((o) => String(o) === String(r.passed)) };      // the tally's keys are text: turn "true" back into true
          for (const id of Object.keys(netg.votes)) if (netg.votes[id]) delete netg.votes[id][key];
          netSendLobby();
          if (netg.running && key !== 'paused') { const players = netRoster().map((p, i) => ({ ...p, slot: i })); const msg = { t: 'start', cfg: netg.cfg, players, seed: Date.now() & 0xffff }; netSend(msg); netBegin(msg); toast('Vote passed: starting again', 2500); }
          netBump();
        }
      }
    }
    /// How many players want each choice right now (for the vote buttons).
    function netVoteCounts(key) { const c = {}; if (!netg) return c; for (const v of Object.values(netg.votes)) if (v && v[key] != null) c[v[key]] = (c[v[key]] || 0) + 1; return c; }
    function netHostSet(key, val) {      // the host may simply decide in the lobby
      if (!netg || netg.role !== 'host' || netg.running) return;
      netg.cfg = { ...netg.cfg, [key]: val }; netSendLobby(); netBump();
    }

    // ---- beginning a match (the host and every other player run this when the host starts)
    function netBegin(msg) {
      if (!netg) return;
      if (!netg.saved) netg.saved = { field: warField, side: warSide, npc: warNpc };
      warField = msg.cfg.field; warSide = msg.cfg.side; warNpc = msg.cfg.npc;
      netg.running = true; netg.cfg = msg.cfg; netg.votes = {};
      netg.start = msg;
      mode = MODES.find((m) => m.id === 'war');
      start();
    }
    /// Called by warStart when the battle is a shared one: adds the shared part of the battle to `war`.
    function netAttachToWar() {
      const msg = netg.start, me = msg.players.find((p) => p.id === netMyId) || { slot: 0 };
      war.net = { role: netg.role, cfg: msg.cfg, slot: me.slot, others: new Map(), kills: {}, names: Object.fromEntries(msg.players.map((p) => [p.id, p.n])), respawnT: 0, sendT: 0, foeT: 0, groundT: 0, remoteFireT: 0, gidn: 0, nidn: 0, endAt: 0, winner: '' };
      for (const p of msg.players) if (p.id !== netMyId) war.net.others.set(p.id, { id: p.id, name: p.n, colour: NET_COLOURS[p.slot % NET_COLOURS.length], rep: null, shown: null, t: 0, alive: false, hp: 100, kind: p.v === 'tank' ? 'tank' : p.v, firing: false, gunT: 0 });
      war.friend = null;                                          // the other players are your wingmen
      if (netg.role === 'client') { war.wavePause = 1e9; war.wave = 0; }   // the host decides when a wave comes
    }
    /// Where this player starts: spread along their side of the battlefield (the south; in a Fight, the odd ones start in the north).
    function netStartSpot(R, cfg, slotNo) {
      const north = cfg.side === 'versus' && slotNo % 2 === 1, slot = north ? (slotNo - 1) / 2 : slotNo / (cfg.side === 'versus' ? 2 : 1);
      const [dx, dz] = NET.slotOffset(Math.floor(slot));
      return { x: dx, z: (north ? -1 : 1) * (R * 0.72 + dz), heading: north ? Math.PI : 0, north };
    }

    // ---- what is sent, ten times a second
    function netMyState() {
      const tank = war.vehicle === 'tank', t = war.tank;
      const firing = war.foot ? (keys.has('Enter') || warPad.gun) && war.mag > 0 && war.reloadT <= 0 : tank ? (keys.has('z') || keys.has('b') || warPad.bomb) && war.gun > 0 : (keys.has('Enter') || keys.has(' ') || warPad.gun) && war.gun > 0;
      return { kind: war.driving ? 'van' : war.foot ? 'soldier' : tank ? 'tank' : plane.id, pos: tank ? t.pos : flight.pos, q: tank ? t.q : flight.q, vel: tank ? t.vel : flight.vel, hp: war.hp / war.maxHp * 100, turret: tank ? t.turret : 0, gun: tank ? t.gun : 0, firing: firing && !war.dead, alive: !war.dead };
    }
    function netTick(dt) {
      const n = war.net;
      n.sendT -= dt;
      if (n.sendT <= 0) { n.sendT = 0.2; netSend(NET.packState(netMyId, netMyState())); }      // 5 a second (the free Cloudflare plan counts every message)
      // The other players: glide them to where they are, and let their guns fire.
      const now = performance.now();
      for (const o of n.others.values()) {
        if (!o.rep) continue;
        if (now - o.t > 5000) { o.alive = false; continue; }
        o.shown = NET.glide(o.shown, o.rep, (now - o.t) / 1000, dt);
        if (o.firing && o.alive) {
          o.gunT -= dt;
          while (o.gunT <= 0) {
            const sold = o.rep.kind === 'soldier';
            o.gunT += sold ? 0.11 : o.rep.kind === 'tank' ? 0.085 : 0.05;
            const dir = o.rep.kind === 'tank' || sold ? [Math.sin(o.rep.turret) * Math.cos(o.rep.gun), Math.sin(o.rep.gun), -Math.cos(o.rep.turret) * Math.cos(o.rep.gun)] : qrot(o.rep.q, [0, 0, -1]);
            const b = { owner: 'r', by: o.id, pos: add(o.shown, mul(dir, 6)), vel: add(o.rep.vel, mul(norm(add(dir, jitter(sold ? 0.004 : 0.006))), sold ? SOLDIER.muzzle : WAR.GUN.speed)), t: 0, dmgAir: sold ? SOLDIER.dmg : o.rep.kind === 'tank' ? 6 : 9, dmgGround: sold ? SOLDIER.dmg : o.rep.kind === 'tank' ? 3 : 5, noNpc: !warAuth() };
            war.bullets.push(b); if (war.bullets.length > 400) war.bullets.shift();
          }
        }
      }
      // The host tells everyone where the enemies are.
      if (n.role === 'host') {
        n.foeT -= dt; n.groundT -= dt;
        if (n.foeT <= 0) { n.foeT = 0.2; netSendFoes(); }
        if (n.groundT <= 0) { n.groundT = war.foot ? 0.2 : 0.5; netSendGround(); }
        n.lootT = (n.lootT || 0) - dt; if (n.lootT <= 0) { n.lootT = 1.5; lootSend(); }
        n.waveT = (n.waveT || 0) - dt;
        if (n.waveT <= 0) { n.waveT = 1; netSendWave(); }
      }
      // Respawn after being destroyed.
      if (war.dead && n.respawnT > 0 && (n.respawnT -= dt) <= 0) netRespawn();
      // A Fight with the enemy off is won by the first to ten.
      if (n.role === 'host' && netFight() && !n.winner) { const best = Object.entries(n.kills).sort((a, b) => b[1] - a[1])[0]; if (best && best[1] >= FIGHT_WIN_KILLS) { n.winner = best[0]; netSend({ t: 'end', w: best[0], k: n.kills }); netFinish(best[0]); } }
    }
    /// The aircraft hit the ground or something solid: in a shared battle that is a death like any other.
    function netCrashed() {
      war.dead = true; war.hp = 0; war.net.respawnT = 5; war.flash = 1; toast('💥 CRASHED', 2500);
      netSend({ t: 'k', id: netMyId, v: netMyId, by: 'npc' }); netGameMsg({ t: 'k', id: netMyId, v: netMyId, by: 'npc' });
    }
    function netResetWreck() {
      debris.length = 0; attached = new Set(ALL_PARTS); goneGear.clear(); gouges.length = 0; slowT = 0; duckT = 0; bumpSlow = false; shakeKick = 0; fireK = 1; dirtD = 0; wreckT = 0; hadFailure = false; engineSmokeT = 0; wingLostAt = -1; canyonT = 0;
      wreckFire = false; fireT = 0; crashCam = null; smoke.length = 0; stoppedT = 0; stopCredited = false; hadAir = false; hadTakeoff = false;
    }
    function netRespawn() {
      if (flight.crashed) { netResetWreck(); flight = new Flight(plane); heliColl = 0; }
      if (war.ejected) { war.ejected = false; war.vehicle = 'plane'; war.foot = false; war.tank = null; camMode = 0; war.L = { ...warLoadout(plane), shells: 0 }; war.maxHp = war.L.hp; buildWbar(); }
      const R = war.R, spot = netStartSpot(R, war.net.cfg, war.net.slot); spot.x += war.cx; spot.z += war.cz;
      war.dead = false; war.hp = war.maxHp; war.gun = war.L.gun; war.bombs = war.L.bombs; war.missiles = war.L.missiles; war.flares = war.L.flares; war.shells = war.L.shells; war.flash = 0;
      if (war.vehicle === 'tank') {
        if (war.driving) { war.driving = false; war.foot = warVeh === 'soldier'; war.van = null; } war.tank = warBody(spot); war.tank.pos[1] = groundAt(W, spot.x, spot.z) + 0.2; if (war.foot) { war.mag = SOLDIER.mag; war.reloadT = 0; war.zoomI = 0; war.rpg = SOLDIER.rpg; war.weapon = 'rifle'; war.shield = SOLDIER.shield; }
        flight.reset([spot.x, war.tank.pos[1] + 2.2, spot.z], spot.heading, 0, true);
      } else { flight.reset([spot.x, warStartAlt(), spot.z], spot.heading, plane.cruise, false); flight.sturdy = true; war.ap = { hdg: spot.heading, alt: flight.pos[1], spd: plane.cruise * 1.05, i: 0 }; }
      toast('Back in the fight', 1500);
    }
    function netFinish(winnerId) {
      const n = war.net, name = winnerId === netMyId ? 'You' : (n.names[winnerId] || 'A player');
      finish('done', war.score, `${name} won with ${n.kills[winnerId] || 0} kills`);
    }

    function toggleFullscreen() {
      if (document.fullscreenElement) { document.exitFullscreen?.().catch?.(() => {}); return; }
      const el = document.documentElement, enter = el.requestFullscreen || el.webkitRequestFullscreen;
      if (enter) Promise.resolve(enter.call(el)).catch(() => toast('Full screen is not available in this window', 1800));
      else toast('Full screen is not available in this window', 1800);
    }
    function toggleWarOverG() {
      warOverG = !warOverG; write('waroverg', warOverG);
      if (war && war.vehicle === 'plane') flight.overG = warOverG;
      renderUI();
    }

    // ---- what the host sends about the enemies
    const r1n = (v) => Math.round(v * 10) / 10;
    function netSendWave() {
      if (!war || !war.net || war.net.role !== 'host') return;
      netSend({ t: 'wave', cx: Math.round(war.cx), cz: Math.round(war.cz), R: Math.round(war.R), n: war.wave, sc: war.score, kl: war.kills, af: war.waveFighters || 0, g: war.ground.map((g) => ({ i: g.nid, k: g.kind, x: r1n(g.pos[0]), y: r1n(g.pos[1]), z: r1n(g.pos[2]), h: Math.round(g.heading * 100) / 100, hp: Math.round(g.hp), mx: Math.round(g.maxHp), d: g.dead ? 1 : 0, s: g.speed })) });
    }
    function netSendFoes() {
      netSend({ t: 'wf', f: war.foes.map((a) => ({ i: a.nid, id: a.id, x: r1n(a.pos[0]), y: r1n(a.pos[1]), z: r1n(a.pos[2]), h: Math.round(a.heading * 100) / 100, p: Math.round(a.pitch * 100) / 100, b: Math.round(a.bank * 100) / 100, s: Math.round(a.speed), hp: Math.round(a.hp), st: a.state === 'fly' ? 0 : 1, fg: a.burstLeft > 0 ? 1 : 0 })) });
    }
    function netSendGround() {
      netSend({ t: 'wg', n: war.wave, sc: war.score, kl: war.kills, g: war.ground.map((g) => [g.nid, Math.round(g.hp), g.dead ? 1 : 0, r1n(g.pos[0]), r1n(g.pos[2]), Math.round(g.heading * 100) / 100]) });
    }
    const netEvent = (e) => { if (war && war.net && war.net.role === 'host') netSend({ t: 'ev', ...e }); };
    const netHurtRemote = (id, amt, why) => { if (amt > 0.05) netSend({ t: 'hit', to: id, a: Math.round(amt * 10) / 10, w: why }); };

    // ---- what arrives
    function netMsg(m) {
      if (!netg || !m || typeof m.t !== 'string') return;
      if (m.id === netMyId) return;
      switch (m.t) {
        case 'hi': {       // someone is here
          if (netg.role !== 'host') break;
          const isNew = !netg.peers.has(m.id), p = netg.peers.get(m.id) || { id: m.id };
          Object.assign(p, { n: String(m.n || 'Pilot').slice(0, 14), v: WAR_VEHICLES.some((v) => v.id === m.v) ? m.v : 'f16', last: Date.now() });
          netg.peers.set(m.id, p);
          if (isNew || p.vChanged) { netBump(); netSendLobby(); if (netg.running) netSendStartTo(m.id); }
          else if (netg.roster.find((r) => r.id === m.id)?.v !== p.v) { netBump(); netSendLobby(); }
          break;
        }
        case 'chat': receiveChat(m); break;
        case 'bye': {
          if (netg.role === 'host' && netg.peers.delete(m.id)) { netBump(); if (war && war.net) { warFeed(`${war.net.names[m.id] || 'A player'} left`); war.net.others.delete(m.id); } netSendLobby(); }
          else if (netg.role === 'client' && m.id === netg.hostId) netEnd('The host left the game.');
          break;
        }
        case 'lobby': {
          if (Number.isFinite(m.pv) && m.pv > BATTLE_PV && netg.role === 'client') { netg.error = 'This game needs a newer version of Notch Apple. Update the app to play.'; netBump(); toast('Update Notch Apple to play this game', 4000); break; }
          // Two people on the same Wi-Fi both pressed Host on the shared code: the one with the lower id keeps it, the other joins.
          if (netg.role === 'host' && netg.wifi && !netg.running && m.host && m.host !== netMyId && String(m.host) < String(netMyId)) { netg.role = 'client'; netg.hostId = m.host; netg.wifi = false; }
          // Two games in one room (two players both found nobody there and opened it): the one that started first keeps the room and the other
          // joins it, so everyone ends up in the same wave.
          if (netg.role === 'host' && m.host && m.host !== netMyId && Number.isFinite(m.t0) && m.t0 > 0 && (m.t0 < (netg.t0 || Infinity) || (m.t0 === netg.t0 && String(m.host) < String(netMyId)))) {
            netg.role = 'client'; netg.hostId = m.host; netg.hostSeen = Date.now(); netg.peers = new Map(); netg.autoJoin = false; netg.autoStart = false; netg.helloT = 0; netg.wifi = false;
            toast('Joining the game that is already running in this room…', 2500); netHello();
          }
          if (netg.role !== 'client') break;
          netg.hostSeen = Date.now(); netg.hostId = m.host; netg.cfg = m.cfg; netg.roster = m.roster; netg.error = ''; netBump();
          break;
        }
        case 'start': {
          if (netg.role !== 'client' || (m.to && m.to !== netMyId)) break;
          netg.hostSeen = Date.now(); netBegin(m);
          break;
        }
        case 'vote': if (netg.role === 'host') { netg.votes[m.id] = { ...(netg.votes[m.id] || {}), [m.key]: m.val }; netCountVotes(); netBump(); } break;
        case 'end': if (war && war.net && !war.net.winner) { war.net.winner = m.w; war.net.kills = m.k || {}; netFinish(m.w); } break;
        default: if (war && war.net) netGameMsg(m);
      }
    }
    function netOther(id) { return war.net.others.get(id); }
    /// A list of `n` finite numbers that could be a place in the world (anything else another player sends is ignored).
    const okVec = (v, n = 3) => Array.isArray(v) && v.length === n && v.every((x) => Number.isFinite(x) && Math.abs(x) < 40000);
    function netGameMsg(m) {
      const n = war.net;
      switch (m.t) {
        case 's': {                           // another player's state
          const o = netOther(m.id); if (!o || !okVec(m.p) || !okVec(m.q, 4) || !okVec(m.v)) break;
          const r = NET.unpackState(m);
          if (o.alive && !r.alive && r.hp <= 0) { /* their death is announced by the 'k' message */ }
          o.rep = r; o.t = performance.now(); o.alive = r.alive; o.hp = r.hp; o.kind = r.kind; o.firing = r.firing;
          if (!o.shown) o.shown = r.pos.slice();
          break;
        }
        case 'b': { if (!okVec(m.p) || !okVec(m.v)) break; war.bombsAir.push({ owner: 'r', by: m.id, pos: m.p.slice(), vel: m.v.slice(), t: 0, noNpc: !warAuth(), gren: m.g === 1, fuse: 2.4 }); break; }
        case 'lw': { if (n.role === 'client' && Array.isArray(m.L)) war.loot = m.L.filter((a) => Array.isArray(a) && LOOT_KINDS.some((q) => q.k === a[1]) && Number.isInteger(a[2]) && a[2] >= 0 && a[2] < 4 && Number.isFinite(a[3]) && Number.isFinite(a[4])).slice(0, 60).map((a) => ({ id: a[0], k: a[1], r: a[2], x: a[3], z: a[4] })); break; }
        case 'lp': {         // someone walked onto loot: the host decides who gets it
          if (n.role !== 'host') break;
          const l = war.loot.find((q) => q.id === m.id), o = netOther(m.p);
          if (!l || !o || !o.rep || Math.hypot(o.rep.pos[0] - l.x, o.rep.pos[2] - l.z) > 8) break;
          war.loot = war.loot.filter((q) => q !== l); lootSend(); netSend({ t: 'lx', id: l.id, w: m.p, k: l.k, r: l.r }); break;
        }
        case 'lx': { if (m.w === netMyId && LOOT_KINDS.some((q) => q.k === m.k) && Number.isInteger(m.r) && m.r >= 0 && m.r < 4) warApplyLoot(m.k, m.r); war.loot = war.loot.filter((q) => q.id !== m.id); break; }
        case 'tb': {         // another player broke a tree: it breaks here too
          if (!Number.isFinite(m.x) || !Number.isFinite(m.z)) break;
          const tr = treeAt(W, m.x, m.z); if (tr) breakTree(W, tr, true); break;
        }
        case 'tl': {         // the trees already broken before you joined
          if (m.to !== netMyId || !Array.isArray(m.L)) break;
          for (const a of m.L.slice(0, 400)) if (Array.isArray(a) && Number.isFinite(a[0]) && Number.isFinite(a[1])) { const tr = treeAt(W, a[0], a[1]); if (tr) breakTree(W, tr, true); }
          break;
        }
        case 'gx': {         // another player's guided missile exploded here: everyone sees it, and the host judges what it hit
          if (!okVec(m.p)) break;
          warBoom(m.p, 1.1);
          if (n.role === 'host') warBlast(m.p, 60, 320, 'r', { by: m.id });
          break;
        }
        case 'vn': { const o = netOther(m.id); if (!o) break; o.van = m.on && okVec(m.p) && okVec(m.q, 4) ? { pos: m.p.slice(), q: m.q.slice() } : null; break; }
        case 'hl': { const o = netOther(m.id); if (!o) break; if (m.on && okVec(m.p) && okVec(m.q, 4) && PLANES.some((q) => q.id === m.k && q.rotor)) o.heli = { id: m.k, pos: m.p.slice(), q: m.q.slice() }; else o.heli = null; break; }
        case 'sh': { if (!okVec(m.p) || !okVec(m.v)) break; war.bullets.push({ owner: 'r', by: m.id, shell: true, pos: m.p.slice(), vel: m.v.slice(), t: 0, dmgAir: 90, dmgGround: 150, noNpc: !warAuth() }); break; }
        case 'm': { if (!okVec(m.p) || !okVec(m.v)) break; const tgt = m.tg ? war.foes.find((a) => a.nid === m.tg) : null; war.missilesAir.push({ owner: 'r', by: m.id, pos: m.p.slice(), vel: m.v.slice(), t: 0, target: tgt ? { ref: tgt } : null, trail: 0, noNpc: !warAuth() }); break; }
        case 'fl': if (n.role === 'host') for (const mm of war.missilesAir) if (mm.owner === 'e' && mm.target && mm.target.player === m.id && warRand() < 0.6) mm.target = null; break;
        case 'hit': if (m.to === netMyId && Number.isFinite(m.a) && m.a > 0 && m.a < 400) warHurt(m.a, String(m.w || 'enemy fire').slice(0, 24)); break;
        case 'k': {                            // someone was destroyed
          const by = m.by || '', victim = m.v, vn = victim === netMyId ? 'You' : (n.names[victim] || 'A player'), bn = by === netMyId ? 'you' : (n.names[by] || 'the enemy');
          if (by && by !== 'npc' && by !== victim) n.kills[by] = (n.kills[by] || 0) + (n.role === 'host' ? 1 : 0);
          warFeed(by && by !== 'npc' && by !== victim ? `${n.names[by] || 'A player'} destroyed ${vn === 'You' ? 'you' : vn}` : `${vn === 'You' ? 'You were' : vn + ' was'} destroyed by ${bn === 'you' ? 'yourself' : bn}`, false);
          if (n.role === 'host') netSend({ t: 'ks', k: n.kills });
          break;
        }
        case 'ks': n.kills = m.k || {}; break;
        case 'wave': if (n.role === 'client') netApplyWave(m); break;
        case 'wf': if (n.role === 'client') netApplyFoes(m); break;
        case 'wg': if (n.role === 'client') netApplyGround(m); break;
        case 'ev': if (n.role === 'client') netApplyEvent(m); break;
      }
    }
    // ---- the other players' copy of the world (what a player who is not the host sees)
    function netApplyWave(m) {
      if (!Number.isInteger(m.n) || m.n < war.wave || m.n === war.appliedWave || !Array.isArray(m.g)) return;
      war.wave = m.n; war.score = m.sc; war.kills = m.kl; war.waveClear = false; war.wavePause = 1e9;
      war.appliedWave = m.n; war.guided = 2; if (Number.isFinite(m.cx) && Number.isFinite(m.cz) && Math.abs(m.cx) < 20000 && Math.abs(m.cz) < 20000) { if (m.n > 1 && (m.cx !== war.cx || m.cz !== war.cz)) toast('ON TO THE NEXT FRONT', 3000); war.cx = m.cx; war.cz = m.cz; } if (Number.isFinite(m.R) && m.R > 300 && m.R < 20000) { if (war.grows && m.R > war.R + 1 && m.n > 1) toast(`⬆ The battlefield grows: ${Math.round(m.R)} m across the middle`, 3000); war.R = m.R; }
      war.waveGround = m.g.length; war.waveFighters = Number.isInteger(m.af) ? m.af : 0; war.briefingT = 4;
      war.ground = m.g.map((g) => ({ nid: g.i, kind: g.k, pos: [g.x, g.y, g.z], heading: g.h, turret: g.h, hp: g.hp, maxHp: g.mx, r: WAR_KINDS[g.k].r, pts: WAR_KINDS[g.k].pts, dead: !!g.d, speed: g.s, burning: 0, cool: 1e9, t: 0 }));
      toast(`WAVE ${m.n}`, 1800); beep(520, 0.15, 'square', 0.07);
    }
    function netApplyGround(m) {
      if (m.n !== war.wave) return;
      war.score = m.sc; war.kills = m.kl;
      for (const [id, hp, dead, x, z, h] of m.g) {
        const g = war.ground.find((q) => q.nid === id); if (!g) continue;
        g.hp = hp; g.heading = h; if (g.speed > 0 || INF.has(g.kind)) { g.pos[0] = x; g.pos[2] = z; g.pos[1] = groundAt(W, x, z); }
        if (dead && !g.dead && INF.has(g.kind)) { g.dead = true; for (let i = 0; i < 3; i++) puff('dirt', add(g.pos, [0, 1, 0]), jitter(3)); } else if (dead && !g.dead) { g.dead = true; g.burning = 25; warBoom(g.pos, g.kind === 'fuel' ? 1.8 : g.kind === 'bunker' ? 1.3 : 0.8); warCrater(g.pos, 6); }
      }
    }
    function netApplyFoes(m) {
      const seen = new Set();
      for (const s of m.f) {
        seen.add(s.i);
        let a = war.foes.find((q) => q.nid === s.i);
        if (!a) { a = { nid: s.i, id: s.id, spec: PLANES.find((x) => x.id === s.id), role: 'foe', pos: [s.x, s.y, s.z], heading: s.h, pitch: s.p, speed: s.s, bank: s.b, vel: v3(), q: qheading(s.h), hp: s.hp, maxHp: 100, state: 'fly', t: 0, w: v3(), burstLeft: 0, gunT: 0, cool: 0, target: null, remote: true }; war.foes.push(a); }
        a.goal = [s.x, s.y, s.z]; a.heading = s.h; a.pitch = s.p; a.bank = s.b; a.speed = s.s; a.hp = s.hp; a.snapAt = performance.now(); a.firing = !!s.fg;
        const cp = Math.cos(a.pitch); a.vel = [Math.sin(a.heading) * cp * a.speed, Math.sin(a.pitch) * a.speed, -Math.cos(a.heading) * cp * a.speed];
        if (s.st && a.state === 'fly') { a.state = 'fall'; a.t = 0; a.w = [(warRand() - 0.5) * 3, (warRand() - 0.5) * 3, (warRand() - 0.5) * 3 + 2]; for (let i = 0; i < 10; i++) puff('fire', add(a.pos, jitter(4)), jitter(14)); }
      }
      for (const a of war.foes) if (!seen.has(a.nid) && a.state === 'fly') a.state = 'gone';       // the host removed it
    }
    function netApplyEvent(m) {
      if (m.k === 'feed') warFeed(m.x, false);
      else if (m.k === 'flak') war.flaks.push({ from: m.f, to: m.o, t: 0, T: m.T, vis: true });
      else if (m.k === 'ts') war.bullets.push({ owner: 'e', vis: true, shell: false, pos: m.p, vel: m.v, t: 0, dmgAir: 0, dmgGround: 0 });
      else if (m.k === 'em') war.missilesAir.push({ owner: 'e', vis: true, pos: m.p, vel: m.v, t: 0, target: m.tg ? { player: m.tg } : null, trail: 0 });
      else if (m.k === 'sc') { war.score = m.sc; }
    }
    /// On a player who is not the host: carry the enemies on between the host's reports (they come ten times a second).
    function netReplicaStep(dt) {
      const now = performance.now();
      for (const a of war.foes) {
        if (a.state === 'fly') {
          a.pos = add(a.pos, mul(a.vel, dt));
          if (a.goal) { const e = sub(a.goal, a.pos), k = 1 - Math.exp(-dt * 6); a.pos = add(a.pos, mul(e, k * 0.6)); }
          a.q = qmul(qheading(a.heading, a.pitch), qaxis([0, 0, 1], -a.bank));
          if (a.firing) { a.gunT -= dt; while (a.gunT <= 0) { a.gunT += 0.07; const d = norm(a.vel); war.bullets.push({ owner: 'e', vis: true, pos: add(a.pos, mul(d, 8)), vel: add(a.vel, mul(norm(add(d, jitter(0.03))), WAR.GUN.speed)), t: 0, dmgAir: 0, dmgGround: 0 }); } }
          if (a.snapAt && now - a.snapAt > 2500) a.state = 'gone';
        } else if (a.state === 'fall') warFall(a, dt);
      }
      war.foes = war.foes.filter((a) => a.state !== 'gone');
      for (const g of war.ground) {
        if (g.dead) { if (g.burning > 0) { g.burning -= dt; if (warRand() < dt * 5) puff('soot', add(g.pos, [0, 2, 0]), [0, 6, 0]); if (warRand() < dt * 3) puff('fire', add(g.pos, jitter(3)), [0, 3, 0]); } continue; }
        if (g.speed > 0) { g.pos[0] += Math.sin(g.heading) * g.speed * dt; g.pos[2] -= Math.cos(g.heading) * g.speed * dt; g.pos[1] = groundAt(W, g.pos[0], g.pos[2]); }
        if (g.kind === 'tank') { const np = warNearestPlayer(g.pos); g.turret += clamp(wrapPi(Math.atan2(np.pos[0] - g.pos[0], -(np.pos[2] - g.pos[2])) - g.turret), -0.8 * dt, 0.8 * dt); }
      }
    }

    // ---- who the computer enemies can aim at: you, and (on the host) the other players
    function warPlayersList() {
      const list = [{ id: 'me', local: true, pos: flight.pos, vel: flight.vel, alive: !war.dead, tank: war.vehicle === 'tank' }];
      if (war.net) for (const o of war.net.others.values()) if (o.alive && o.rep) list.push({ id: o.id, local: false, pos: o.shown || o.rep.pos, vel: o.rep.vel, alive: true, tank: o.rep.kind === 'tank' || o.rep.kind === 'soldier' || o.rep.kind === 'van' });
      return list.filter((p) => p.alive);
    }
    function warNearestPlayer(from) {
      let best = null, bd = Infinity;
      for (const p of warPlayersList()) { const d = len(sub(p.pos, from)); if (d < bd) { bd = d; best = p; } }
      return best || { id: 'me', local: true, pos: flight.pos, vel: flight.vel, alive: true, tank: war.vehicle === 'tank' };
    }
    const netRadius = (p) => (p.foot ? 1.0 : p.tank ? 4.6 : 8);
    function update(dt) {
      if (W.felled && W.felled.length) {         // trees that broke: leaves and a crack
        for (const t of W.felled.splice(0)) {
          if (war && war.net) { if (!t[4]) netSend({ t: 'tb', x: Math.round(t[0] * 10) / 10, z: Math.round(t[2] * 10) / 10 }); (war.net.treeLog || (war.net.treeLog = [])).push([Math.round(t[0] * 10) / 10, Math.round(t[2] * 10) / 10]); }
          for (let i = 0; i < 14; i++) puff('leaf', [t[0], t[1] + t[3] * 0.6, t[2]], jitter(11));
          if (len(sub([t[0], t[1], t[2]], flight.pos)) < 700) noise(0.18, 0.22, 260);
        }
      }
      stepRace(dt); stepCycle(dt);
      if (toastTimer > 0) { toastTimer -= dt; if (toastTimer <= 0) toastEl.style.opacity = 0; }
      if (screen !== 'fly' || paused) return;
      if (plane.rotor) {
        // W / S move the collective lever and it stays put; during the emergency assist it follows what the assist does.
        if (flight.emergency) heliColl = flight.throttle;
        else heliColl = clamp(heliColl + ((keys.has('w') || keys.has('Shift') ? 1 : 0) - (keys.has('s') || keys.has('Control') ? 1 : 0)) * dt * 0.4, 0, 1);
      }
      const raw = input();
      ctl = devCtl || raw;
      const inp = mode.id === 'war' && war ? warInput(ctl, dt) : ctl;
      if (devHold) return;
      // A helicopter on the ground with the collective down is held by its skid friction / parking brake (the wind alone would slide it).
      flight.brake = (mode.id !== 'war' && (keys.has(' ') || keys.has('b'))) || (plane.rotor && flight.onGround && heliColl < 0.12)
        || (chatOpen && war && war.vehicle === 'plane' && !flight.onGround && !plane.rotor && flight.ias > plane.stall * 1.8);      // chatting: slow down with the air brake first
      const prev = flight.pos.slice();
      const wasGround = flight.onGround;
      if (war && war.net && war.dead && !flight.crashed) { /* destroyed: it waits to come back */ } else if (mode.id === 'war' && war && war.vehicle === 'tank') tankDrive(dt, inp); else flight.step(dt, inp, W);
      if (plane.rotor && heliColl < 0.12 && Math.abs(inp.yaw) < 0.05) flight.park();
      elapsed += dt;
      // A dead engine's propeller only windmills in the airflow.
      propAngle += dt * (flight.engRun ? 8 + flight.throttle * 60 * flight.damage.power : flight.speed * 0.12);

      // What broke this step.
      for (const ev of flight.events.splice(0)) {
        if (ev.type === 'sturdyhit') {
          if (war && war.vehicle === 'plane') { war.warn = 'WINGTIP STRIKE · SLOWED'; war.warnT = 1.5; }
        } else if (ev.type === 'wing') {
          const at = partPos(ev.side);
          wingBreak(ev);
          for (let i = 0; i < 14; i++) puff(ev.cause === 'water' ? 'spray' : 'dust', at, add(mul(flight.vel, 0.4), jitter(10)));
          for (let i = 0; i < 10; i++) puff('spark', at, add(mul(flight.vel, 0.5), jitter(16)));
          toast(`💥 ${WING_TEXT[ev.cause] || 'Damage!'} ${ev.side === 'L' ? 'Left' : 'Right'} wing ${ev.brk === 'tip' ? 'snapped off outboard' : ev.brk === 'pylon' ? 'folded at the engine pylon' : 'torn off at the root'}`, 2600);
          noise(0.35, 0.5, 2200); noise(0.6, 0.25, 700); wingLostAt = elapsed; shakeKick = Math.max(shakeKick, 0.5);
          if (ev.cause === 'tree') for (let i = 0; i < 12; i++) puff('leaf', at, jitter(10));
        } else if (ev.type === 'tail') {
          const at = partPos('T');
          for (let i = 0; i < 10; i++) puff('spark', at, add(mul(flight.vel, 0.3), [(Math.random() - 0.5) * 8, 2 + Math.random() * 4, (Math.random() - 0.5) * 8]));
          puff('dust', at, jitter(3));
          noise(0.7, 0.35, 1600); tailScrapeT = 0.7;
          if (ev.health <= 0) {
            detach('T', add(mul(flight.axes().f, -3), [0, 3, 0]), 5);
            toast('💥 TAIL STRIKE! The tail broke off: you have almost no pitch control', 3000);
          } else toast(`⚠ TAIL STRIKE! Tail ${ev.health < 0.35 ? 'badly ' : ''}damaged (${Math.round(ev.health * 100)}%): weaker elevator and rudder. Keep the nose lower.`, 2800);
        } else if (ev.type === 'emergencydone') {
          toast('✅ Emergency landing complete: the helicopter is down and stopped', 2800); noise(0.2, 0.2, 200);
        } else if (ev.type === 'fuel') {
          toast('⛽ Out of fuel: the engine has stopped. Glide and land!', 3000);
        } else if (ev.type === 'gearmoved') {
          noise(0.18, 0.28, 130);                 // the gear locks with a thump
          toast(ev.down ? '🛬 Gear down and locked' : 'Gear up and locked', 1200);
        } else if (ev.type === 'engstart') {
          toast('Engine running', 1600); beep(520, 0.2, 'sine', 0.08);
        } else if (ev.type === 'apoff') {
          toast('Autopilot disconnected', 1500); beep(520, 0.25, 'square', 0.07);
        } else if (ev.type === 'apils') {
          if (ev.captured) toast('Tower: glideslope alive, cleared ILS approach', 2000);
          else if (ev.done) { toast('Autopilot off. Cleared to land: your aircraft', 2600); beep(880, 0.3, 'square', 0.08); }
          else if (ev.lost) toast('ILS signal lost: holding heading and height', 2000);
        } else if (ev.type === 'gearspeed') {
          toast('⚠ GEAR OVERSPEED: slow down before lowering the gear', 2200); beep(520, 0.25, 'square', 0.1);
        } else if (ev.type === 'gear' && ev.cause === 'up') {
          toast('💥 GEAR UP LANDING! Sliding on the belly, engines scraping…', 3000); if (plane.engine === 'piston' || plane.engine === 'turboprop') detach('P', add(mul(flight.vel, 0.2), [0, 4, 0]), 10);
          noise(2.4, 0.4, 600); detachGears('all', mul(flight.vel, 0.02), 4);
        } else if (ev.type === 'gear' && ev.cause === 'nose') {
          detachGears('nose', mul(flight.vel, 0.1), 5); shakeKick = Math.max(shakeKick, 0.5);
          toast('💥 The nose gear collapsed! The nose digs in…', 2600); if (plane.engine === 'piston' || plane.engine === 'turboprop') detach('P', add(mul(flight.vel, 0.2), [0, 4, 0]), 10);
          noise(0.9, 0.45, 500); noise(1.8, 0.3, 180);
          for (let i = 0; i < 18; i++) puff('spark', add(flight.pos, qrot(flight.q, [0, -0.8, plane.nose * 0.8])), add(mul(flight.vel, 0.4), jitter(10)));
        } else if (ev.type === 'gear') {
          toast(ev.cause === 'side' ? '💥 Sideways touchdown! The undercarriage collapsed under the side load' : `💥 The undercarriage collapsed on a hard landing (${(ev.vi || 0).toFixed(1)} m/s)! Sliding on the belly…`, 2800);
          noise(0.6, 0.5, 400); noise(2.2, 0.3, 700);
          detachGears('main', add(mul(flight.axes().r, ev.cause === 'side' ? 5 : 2), [0, 1, 0]), 6); shakeKick = Math.max(shakeKick, 0.5);
        } else if (ev.type === 'wheel') {
          // A tyre meeting the ground: a thump that grows with the sink rate, and on a main wheel the chirp and puff of smoke
          // as the stopped wheel is spun up to the speed of the runway.
          noise(0.22, clamp(0.05 + ev.vi * 0.045, 0.05, 0.45), 130 + ev.vi * 22);
          if (ev.main && ev.vl > 10) {
            const k = clamp((ev.vl - 10) / 55, 0, 1);
            noise(0.07 + 0.12 * k, 0.05 + 0.12 * k, 2200 + 600 * k);
            for (let i = 0, n = 2 + Math.round(7 * k); i < n; i++) puff('tsmoke', ev.at, add(mul(flight.vel, 0.12), jitter(1.5)));
          }
          if (ev.vi > 3.5) for (let i = 0; i < 3; i++) puff('dust', ev.at, jitter(4));
        } else if (ev.type === 'bounce') {
          noise(0.3, clamp(0.05 + ev.vi * 0.05, 0.05, 0.4), 150);
        } else if (ev.type === 'squeal') {
          // Side load at the limit: the tyres howl and smoke.
          noise(0.25, 0.05 + 0.1 * ev.k, 3000); puff('tsmoke', ev.at, add(mul(flight.vel, 0.1), jitter(1)));
          if (!sideToast) { sideToast = 4; toast('Tyres squealing: sideways at touchdown. Keep it straight!', 1600); }
        } else if (ev.type === 'skid') {
          // A locked wheel sliding: a long screech and a trail of smoke.
          noise(0.35, 0.07 + 0.1 * ev.k, 1700 + 600 * ev.k); for (let i = 0; i < 3; i++) puff('tsmoke', ev.at, add(mul(flight.vel, 0.1), jitter(1.2)));
          if (!skidToast) { skidToast = 5; toast('Wheels locked! Ease off the brakes: skidding wears the tyres through', 2000); }
        } else if (ev.type === 'strut') {
          toast(`⚠ ${ev.side === 'L' ? 'Left' : 'Right'} main gear strut damaged by the landing (${ev.vi.toFixed(1)} m/s): it will shimmy and pull to that side`, 3200); noise(0.3, 0.4, 260);
        } else if (ev.type === 'spoilers') {
          noise(0.4, 0.1, 600); toast('Ground spoilers', 900);
        } else if (ev.type === 'tyre') {
          toast(ev.why === 'locked' ? `💥 ${ev.side === 'L' ? 'Left' : 'Right'} tyre burst: skidded through on locked wheels` : `💥 ${ev.side === 'L' ? 'Left' : 'Right'} tyre burst! The plane pulls to that side`, 2600); noise(0.15, 0.5, 2500);
        } else if (ev.type === 'scrape') {
          toast(ev.what === 'wingtip' ? '⚠ Wingtip scraping the ground! Level the wings' : '⚠ Engine scraped the ground: it is running rough', 2200); noise(0.5, 0.35, 900);
        } else if (ev.type === 'spin') {
          toast('🌀 SPIN! Stick forward and push the opposite rudder (A / D) until it stops turning', 3600);
        } else if (ev.type === 'spinend') {
          toast('Spin recovered: ease out of the dive', 2200);
        } else if (ev.type === 'bump') {
          // Part of the wreck hitting the ground or a building: dust, a thud and a shake that grow with the energy, rate-limited.
          if (tyreT <= 0) {
            tyreT = 0.1; impactSound(ev.e || ev.vi * ev.vi * 0.5, ev.vi > 12);
            for (let i = 0; i < Math.min(10, ev.vi * 0.6); i++) puff('dust', ev.at, add(mul(flight.vel, 0.2), jitter(5)));
            if (ev.vi > 6) for (let i = 0; i < 4; i++) puff('dirt', ev.at, add(mul(flight.vel, 0.2), [(Math.random() - 0.5) * 8, 3 + Math.random() * 5, (Math.random() - 0.5) * 8]));
            shakeKick = Math.max(shakeKick, clamp(ev.vi / 25, 0, 0.9));
          }
        } else if (ev.type === 'sever') {
          severFx(ev);
        } else if (ev.type === 'ignite') {
          igniteFx(ev);
        } else if (ev.type === 'explode') {
          explodeFx(ev);
        } else if (ev.type === 'crash') {
          crashEffects(ev);
        }
      }
      if (tyreT > 0) tyreT -= dt;
      if (sideToast > 0) sideToast -= dt;
      if (skidToast > 0) skidToast -= dt;
      if (flight.td && !flight.td.done && !flight.crashed) {
        const msg = flight.touchdownText(onRunway([flight.td.x, 0, flight.td.z]));
        if (msg) toast(msg, 3000);
      }
      if (flight.crashed) {
        // Let the wreck tumble, slide and burn until it has stopped (at least a few seconds, at most a few more) before
        // the result; the report on that screen says what happened.
        wreckT += dt;
        updateSound();
        if (war && war.net) { warStep(dt); return; }      // a shared battle goes on without you; you come back in a few seconds
        if ((flight.rest && wreckT > 3.2) || wreckT > (flight.wet > 0 ? 8 : 11)) crashResult();
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
      // Whatever is dragging on the ground (belly, nose, a wingtip, the tail, an engine) throws sparks and dust, and scars it.
      if (flight.scrapeI > 0.35 && flight.speed > 5 && flight.onGround) {
        dirtD += flight.speed * dt;
        if (dirtD > 2.8 * Math.pow(plane.cam || 1, 0.6)) { dirtD = 0; addGouge(flight.scrapePos, groundAt(W, flight.scrapePos[0], flight.scrapePos[2]), 0.6); }
      }
      if (flight.scrapeI > 0.1 && flight.speed > 3) {
        const k = flight.scrapeI;
        if (Math.random() < dt * 60 * k) puff('spark', flight.scrapePos, add(mul(flight.vel, 0.4), [(Math.random() - 0.5) * 6, 2 + Math.random() * 3, (Math.random() - 0.5) * 6]));
        if (Math.random() < dt * 20 * k) puff('dust', flight.scrapePos, add(mul(flight.vel, 0.1), jitter(3)));
      }
      // Burning rubber off a burst tyre.
      if ((flight.damage.tyreL || flight.damage.tyreR) && flight.onGround && flight.speed > 6 && Math.random() < dt * 14) {
        puff('dark', add(flight.pos, qrot(flight.q, [flight.damage.tyreL ? -1.4 : 1.4, -gearH(), 0.5])), jitter(2));
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
      // Having flown (15 m up) is what makes a later landing count, whether you took off from a runway or started in the air.
      if (!flight.onGround && flight.pos[1] - groundAt(W, flight.pos[0], flight.pos[2]) > 15) hadAir = true;
      if (wasGround && !flight.onGround && flight.pos[1] - groundAt(W, flight.pos[0], flight.pos[2]) > 2) { hadTakeoff = true; if (onRunway(prev)) achieve('takeoff'); }
      if (!wasGround && flight.onGround) {
        const sink = flight.sinkAtTouch;
        // (The tyre chirp and thump come with the 'wheel' event.)
        if (sink < 1 && onRunway(flight.pos) && flight.damage.gear) achieve('butter');
      }
      if (flight.onGround && flight.speed < 1.5 && (!flight.damage.gear || !flight.damage.nose) && !(war && war.net)) {
        stoppedT += dt;
        if (stoppedT > 0.8) {
          achieve('survivor');
          if (mode.id === 'war' && war && !war.net && war.vehicle === 'plane' && !war.dead) { warEject(true); return; }
          const rep = flight.slideReport();
          finish('crash', mode.id === 'landing' ? 0 : mode.id === 'hoops' ? score : mode.id === 'war' && war ? war.score : null, `${rep.title} · the plane is scrap, but you walked away`, rep); return;
        }
      } else if (flight.onGround && flight.speed < 1.5 && (hadTakeoff || hadAir || mode.id === 'landing')) {
        stoppedT += dt;
        if (stoppedT > 0.6) {
          const pad = padAt(flight.pos), on = onRunway(flight.pos) || !!pad;
          // Credit once per stop (it used to need a 0.1 s window, which a landing on a plateau could easily miss).
          if (on && !stopCredited) {
            stopCredited = true;
            if (pad) { if (plane.rotor) { achieve('pad'); if (pad.id === 'ridge') achieve('padridge'); } }
            else { achieve('landed'); if (onRidge(flight.pos)) achieve('ridge'); }
            if (hadFailure && !pad) achieve('glider');
          }
          if (mode.id === 'landing' && plane.rotor) {
            const hp = HELIPADS[0], sink = flight.sinkAtTouch, off = Math.hypot(flight.pos[0] - hp.x, flight.pos[2] - hp.z);
            const pts = pad ? Math.max(0, Math.round(1000 - sink * 160 - off * 25)) : 0;
            finish('done', pts, pad ? `Landed on the helipad · touchdown ${sink.toFixed(1)} m/s · ${off.toFixed(1)} m from the H` : 'Stopped off the helipad');
            return;
          }
          if (mode.id === 'landing') {
            const tp = flight.touch || [flight.pos[0], flight.pos[2]], sink = flight.sinkAtTouch, centre = Math.abs(tp[0]), zone = Math.abs(tp[1] - (-300));
            const pts = on ? Math.max(0, Math.round(1000 - sink * 140 - centre * 12 - zone * 0.5 - (cfgLanding ? 150 : 0))) : 0;
            finish('done', pts, on ? `Landed · touchdown ${sink.toFixed(1)} m/s · ${centre.toFixed(1)} m off the centre line${cfgLanding ? ' · −150 for landing with no flaps' : ''}` : 'Stopped off the runway');
            return;
          }
          if (mode.id === 'war' && war && !war.net) { finish('done', war.score, `Back on the ground · ${war.score} pts · wave ${war.wave} · ${war.kills} kills`); return; }
          if (mode.id === 'free' && on && stoppedT < 0.7) toast('Landed and stopped. Take off again any time.', 2000);
        }
      } else { stoppedT = 0; stopCredited = false; }
      // ---- AI traffic: other aircraft crossing the sky. They can be passed, heard about, or hit.
      ctlTick(dt);
      if (mode.id === 'war') { traffic = []; warStep(dt); }
      else if (trafficOn && !flight.crashed) stepTraffic(dt);
      else if (!trafficOn && traffic.length) traffic = [];
      if (shareOn && !flight.crashed) stepSky(dt);
      // ---- configuration errors: an airliner, business jet or turboprop needs its flaps for take-off and for landing.
      const needsFlaps = ['liner', 'biz', 'turbo'].includes(plane.cat) && (plane.flapNotches || []).length > 2;
      if (needsFlaps) {
        const aglNow = flight.pos[1] - groundAt(W, flight.pos[0], flight.pos[2]), gearDown = plane.retract ? flight.gearDown : true;
        if (flight.onGround && flight.throttle > 0.7 && flight.speed > 25 && flight.flapNotch === 0 && onRunway(flight.pos)) {
          say('Config flaps', { level: 2, every: 4, key: 'cfgto' });
          if (!cfgTakeoff) { cfgTakeoff = true; toast('⚠ CONFIG: flaps up. Set take-off flaps (F)', 3600); beep(520, 0.3, 'square', 0.1); }
        }
        if (!flight.onGround && aglNow < 300 && aglNow > 5 && flight.vel[1] < -1 && flight.flapNotch === 0 && gearDown && !flight.crashed) {
          say('Config flaps', { level: 2, every: 5, key: 'cfgld' });
          if (!cfgLanding) { cfgLanding = true; toast('⚠ CONFIG: flaps up. Set landing flaps (F)', 3600); beep(520, 0.3, 'square', 0.1); }
        }
      }
      // ---- ground services (when stopped on an apron): 1 refuel, 2 catering, 3 baggage, 4 pushback
      if (svc) {
        const still = flight.onGround && flight.speed < (svc.id === 4 ? 3 : 1.2) && flight.throttle < 0.12;
        if (!still) { toast('Ground crew: service cancelled, you started moving', 2000); svc = null; }
        else {
          svc.t += dt;
          // The tug pushes at walking pace with the brake off; every other job is done with the parking brake on.
          flight.brake = svc.id !== 4;
          if (svc.id === 4) { const f4 = flight.axes().f; flight.vel = [-f4[0] * 1.7, flight.vel[1], -f4[2] * 1.7]; }
          if (svc.t >= svc.dur) {
            svcDone[svc.id] = true;
            if (svc.id === 1) { flight.fuel = plane.fuel || 1800; flight.fuelOut = false; }
            toast(({ 1: '⛽ Refuelled: tanks full', 2: '🍽 Catering loaded', 3: '🧳 Baggage loaded', 4: '🚜 Pushback complete: tug disconnected, cleared to start engines and taxi' })[svc.id], 2600); beep(660, 0.12);
            svc = null;
          }
        }
      }
      // Helicopter challenge: hold a steady hover, 5 to 60 m up, within 3 m/s... for 15 s.
      if (plane.rotor && !flight.onGround && !flight.crashed) {
        const hgt = flight.pos[1] - groundAt(W, flight.pos[0], flight.pos[2]), hs = Math.hypot(flight.vel[0], flight.vel[2]);
        if (hgt > 5 && hgt < 60 && hs < 1.2 && Math.abs(flight.vel[1]) < 0.8 && Math.abs(flight.bank) < 8 * DEG && Math.abs(flight.pitchAngle) < 8 * DEG) { hoverT += dt; if (hoverT > 15) achieve('hover'); } else hoverT = Math.max(0, hoverT - dt * 2);
      }
      const w = flight.w;
      rollAcc += w[2] * dt; rollT += dt; if (rollT > 4) { rollAcc *= 0.5; rollT = 2; }
      if (Math.abs(rollAcc) > Math.PI * 2) { achieve('roll'); rollAcc = 0; }
      loopAcc += w[0] * dt; loopT += dt; if (loopT > 10) { loopAcc *= 0.5; loopT = 5; }
      if (Math.abs(loopAcc) > Math.PI * 2 && !flight.onGround) { achieve('loop'); loopAcc = 0; }
      const agl = flight.pos[1] - gearH() - groundAt(W, flight.pos[0], flight.pos[2]);
      if (!flight.onGround && agl < 15 && flight.speed > 60) { lowT += dt; if (lowT > 3) achieve('low'); } else lowT = 0;
      if (flight.ias > plane.max * 0.97) achieve('fast');
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
      if (gpwsKind(plane) !== true && flight.onGround && !rotateCalled && flight.throttle > 0.6 && flight.ias >= speedsOf(plane).vr) {
        rotateCalled = true; toast('ROTATE', 1400); chime();
      }
      if (!flight.onGround) rotateCalled = true;
      // Air traffic control.
      atcT = Math.max(0, atcT - dt);
      const am = mode.id === 'war' ? null : atcStep(atc, flight, W);     // no tower on a bombing run
      if (am) { atcText = am; atcT = 8; if (sound && atcOn) speak(am, 1); }
      // "Too low, gear": an airliner low and slow with its wheels still up.
      const aglNow = flight.pos[1] - gearH() - groundAt(W, flight.pos[0], flight.pos[2]);
      gearWarn = !!plane.retract && !flight.onGround && flight.gearPos < 0.99 && !flight.gearDown && aglNow < 200 && flight.ias < plane.stall * 1.8 && flight.throttle < 0.85;
      if (gearWarn && !gpwsOn && elapsed - gearBeepAt > 1.2) { gearBeepAt = elapsed; beep(900, 0.12, 'square', 0.1); setTimeout(() => beep(700, 0.12, 'square', 0.1), 150); }
      if (!lowFuelWarned && flight.fuel < (plane.fuel || 1800) * 0.12 && flight.damage.engine) { lowFuelWarned = true; toast('⛽ LOW FUEL', 2200); beep(660, 0.2, 'square', 0.12); setTimeout(() => beep(660, 0.2, 'square', 0.12), 260); }
    }

    // ---- drawing
    let lastW = 0, lastH = 0;
    function size() {
      const r = root.getBoundingClientRect(), dpr = Math.min(window.devicePixelRatio || 1, dprCap);
      const w = Math.max(1, Math.round(r.width * dpr)), h = Math.max(1, Math.round(r.height * dpr));
      if (w !== lastW || h !== lastH) { cv.width = hud.width = w; cv.height = hud.height = h; lastW = w; lastH = h; }
      return { w, h, dpr };
    }

    // ---- DRAW AIRCRAFT BEGIN
    // ---- drawing the aircraft: the body in its parts, then the moving surfaces, gear, propeller or fans, lights and flame
    // `ctl` is what the pilot is asking for (set every step); `surf` is where the surfaces actually are, easing towards it.
    let dprCap = 2, ctl = { pitch: 0, roll: 0, yaw: 0, throttle: 0 }, devCtl = null, devHold = false, devView = null;
    const surf = { ail: 0, elev: 0, rud: 0, flap: 0, spoil: 0, last: 0, fan: 0 };
    const hingeM = (pivot, axis, ang) => { const q = qaxis(axis, ang); return model(q, sub(pivot, qrot(q, pivot)), 1); };
    function drawAircraft(t) {
      const pm = planeMeshes[plane.id], menu = screen === 'menu', parts = menu ? new Set(ALL_PARTS) : attached;
      const dt = clamp((t - surf.last) / 1000, 0, 0.1); surf.last = t;
      const ease = 1 - Math.exp(-dt * 8), fly = !menu && !flight.crashed;
      const tgt = { ail: fly ? ctl.roll : 0, elev: fly ? ctl.pitch : 0, rud: fly ? ctl.yaw : 0, flap: menu ? 0 : flight.flaps || 0, spoil: fly ? Math.max(flight.gspoil || 0, flight.brake ? (flight.onGround ? 1 : 0.5) : 0) : 0 };
      for (const k of Object.keys(tgt)) surf[k] += (tgt[k] - surf[k]) * (k === 'flap' ? ease * 0.35 : ease);
      // Other aircraft: their parts and control surfaces at rest (no gear), tumbling and darkened once they are going down.
      for (const a of [...traffic, ...(shareOn ? remote : []), ...praceShow]) {
        const tpm = planeMeshes[a.id], sc = a.spec.scale || 1, AM = model(a.q, a.pos, sc);
        const tint = a.state === 'fall' ? [0.32, 0.26, 0.22] : [1, 1, 1], glow = a.state === 'fall' ? 0.0 : 0;
        for (const k in tpm.parts) { const part = tpm.parts[k]; if (part) draw(part.live, model(a.q, add(a.pos, qrot(a.q, mul(part.center, sc))), sc), tint, glow); }
        for (const d of tpm.dyn) draw(d.gl, AM, tint, glow);
        // Wheels down below 400 m above the ground (approach or climb-out), up in the cruise.
        if (a.pos[1] - groundAt(W, a.pos[0], a.pos[2]) < 400) for (const g of tpm.gears) draw(g.gl, AM, tint, glow);
      }
      const M = model(flight.q, flight.pos, plane.scale);
      const flapMax = plane.cat === 'mil' ? 24 : plane.cat === 'ga' || plane.cat === 'turbo' ? 32 : 38;
      for (const k in pm.parts) {
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
        if (gp > 0.04) pm.gears.forEach((g, gi) => { if (!goneGear.has(gi) && (!g.nose || menu || flight.damage.nose)) {
          // A bogie truck tips about its axle: nose-up in flight, levelling out as the wheels take the weight.
          let gm = gp > 0.999 ? M : mat4mul(M, hingeM(g.pivot, g.axis, g.ang * (1 - gp)));
          if (!menu && flight.truck && !g.nose && gp > 0.99 && g.piece) {
            const tl = flight.tl[g.piece.center[0] < 0 ? 0 : 1];
            if (tl > 0.005) { const c = g.piece.center, lo = g.piece.lo, hi = g.piece.hi; gm = mat4mul(M, hingeM([c[0], c[1] + lo[1] + (hi[1] - lo[1]) * 0.12, c[2]], [1, 0, 0], tl)); }
          }
          draw(g.gl, gm);
        } });
      }
      // Propeller: blades that blur into a disc as they speed up.
      if (pm.prop && parts.has('P')) {
        const pq = qmul(flight.q, qaxis([0, 0, 1], propAngle)), pp = model(pq, add(flight.pos, qrot(flight.q, mul(pm.propAt, plane.scale))), plane.scale);
        const fast = clamp((menu ? 40 : flight.engRun ? 8 + flight.throttle * 60 * flight.damage.power : flight.speed * 0.12) / 45, 0, 1);
        gl.enable(gl.BLEND); gl.depthMask(false);
        gl.uniform1f(U.alpha, 1 - 0.5 * fast); draw(pm.prop, pp);
        if (pm.disc && fast > 0.15) { gl.uniform1f(U.alpha, 0.13 * fast); draw(pm.disc, pp, [0.75, 0.75, 0.75], 0.1); }
        gl.uniform1f(U.alpha, 1); gl.depthMask(true); gl.disable(gl.BLEND);
      }
      // Helicopter rotors: the main rotor and the tail rotor, at engine speed, blurring into discs.
      if (pm.rotors && pm.rotors.length) {
        const spin = (menu ? 55 : 20 + engState.n1 * 2.4);
        rotorAngle += dt * spin * 9;
        const blur = clamp((menu ? 1 : 0.4 + engState.n1 / 120), 0, 1);
        gl.enable(gl.BLEND); gl.depthMask(false);
        for (const r of pm.rotors) {
          if (!parts.has('F')) continue;
          const rq = qmul(flight.q, qaxis(r.axis, rotorAngle * (r.axis[1] ? 1 : 1.6))), rp = model(rq, add(flight.pos, qrot(flight.q, mul(r.at, plane.scale))), plane.scale);
          gl.uniform1f(U.alpha, 1 - 0.45 * blur); draw(r.gl, rp);
          if (r.disc && blur > 0.05) { gl.uniform1f(U.alpha, 0.12 * blur); draw(r.disc, rp, [0.8, 0.8, 0.8], 0.1); }
        }
        gl.uniform1f(U.alpha, 1); gl.depthMask(true); gl.disable(gl.BLEND);
      }
      // Engine fans turn with the engine.
      const n1 = menu ? 40 : engState.n1;
      surf.fan += dt * (4 + n1 * 0.32);
      for (const f of pm.fans) if (parts.has(f.attach)) draw(f.gl, mat4mul(M, model(qaxis([0, 0, 1], surf.fan * f.dir), f.at, 1)));
      // Lights.
      const ground = !menu && flight.onGround, gearOut = menu || (plane.retract ? (flight.gearPos == null ? 1 : flight.gearPos) > 0.3 : true);
      const agl = menu ? 0 : flight.pos[1] - gearH() - groundAt(W, flight.pos[0], flight.pos[2]);
      const ph = (t / 1000) % 1.25, strobeOn = ph < 0.06 || (ph > 0.16 && ph < 0.22), beaconOn = (t / 1000) % 1.1 < 0.22;
      const landOn = menu || (ground ? flight.throttle > 0.02 || flight.speed > 2 : plane.retract ? gearOut && agl < 1500 : agl < 400);
      const running = menu || flight.engRun || flight.speed > 20, moving = menu || !ground || flight.speed > 2.5;
      gl.uniform3fv(U.lum, ONE3);   // the aircraft's own lights shine at full strength
      for (const lg of pm.lights) {
        if (!parts.has(lg.attach)) continue;
        let tint = [1, 1, 1], glow = 1.6, on = menu || flight.battery !== false;
        switch (lg.kind) {
          case 'navR': tint = [1, 0.12, 0.1]; break;
          case 'navG': tint = [0.1, 1, 0.25]; break;
          case 'navW': tint = [1, 1, 1]; glow = 1.2; break;
          case 'strobe': on = on && strobeOn && moving; glow = 3; break;
          case 'beacon': tint = [1, 0.1, 0.08]; on = on && beaconOn && (menu || flight.beaconSw !== false); glow = 2.4; break;
          case 'land': tint = [1, 0.97, 0.86]; on = on && landOn; glow = 2.6; break;
          case 'taxi': tint = [1, 0.95, 0.8]; on = on && landOn && (ground || menu); glow = 2; break;
        }
        draw(lg.core, M, on ? tint : cmul(tint, 0.42), on ? glow : 0);
        if (on) {
          gl.enable(gl.BLEND); gl.depthMask(false); gl.uniform1f(U.alpha, lg.kind === 'strobe' ? 0.5 : lg.kind === 'land' || lg.kind === 'taxi' ? 0.15 : 0.24);
          draw(lg.halo, M, tint, 1.2);
          gl.uniform1f(U.alpha, 1); gl.depthMask(true); gl.disable(gl.BLEND);
        }
      }
      // Afterburner: a long flame with shock diamonds above 90 % throttle; a short blue plume below that.
      if (pm.flame && parts.has('T') && !menu && flight.engRun && flight.throttle > 0.45) {
        const th = flight.throttle, burner = th > 0.9, flick = 1 + 0.12 * Math.sin(t * 0.07) + 0.08 * Math.sin(t * 0.13 + 1);
        const len = burner ? (0.75 + 0.25 * clamp((th - 0.9) / 0.1, 0, 1)) * flick : 0.1 + (th - 0.45) * 0.25;
        const rad = burner ? 1 : 0.7, at = pm.flame.at;
        const S = new Float32Array([rad, 0, 0, 0, 0, rad, 0, 0, 0, 0, len, 0, at[0], at[1], at[2], 1]);
        gl.enable(gl.BLEND); gl.depthMask(false);
        gl.uniform1f(U.alpha, burner ? 0.85 : 0.4); draw(pm.flame.gl, mat4mul(M, S), burner ? [1, 1, 1] : [0.45, 0.6, 1], burner ? 1.1 : 0.9);
        if (burner) { gl.uniform1f(U.alpha, 0.9); draw(pm.flame.dia, mat4mul(M, S), [1, 1, 1], 1.8); }
        gl.uniform1f(U.alpha, 1); gl.depthMask(true); gl.disable(gl.BLEND);
      }
      gl.uniform3fv(U.lum, ENV.lum);
    }

    // ---- DRAW AIRCRAFT END
    function render(t) {
      const { w, h, dpr } = size();
      gl.viewport(0, 0, w, h);
      gl.clearColor(...HAZE, 1); gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
      gl.uniform3fv(U.fog, HAZE); gl.uniform3fv(U.lum, ENV.lum); gl.uniform3fv(U.sunDir, SUN); gl.uniform1f(U.fogFar, FOG_FAR * ENV.fogMul); gl.uniform1f(U.alpha, 1);

      // Camera.
      let eye, at, up;
      const showPlane = screen !== 'fly' || camMode !== 1;
      if (screen === 'menu') {
        const a = t * 0.0003;
        flight.pos = [0, gearH(), 0]; flight.q = qheading(0, 0); flight.crashed = false;
        const r = 15 * (plane.cam || plane.scale);
        eye = [Math.sin(a) * r, 4.5, Math.cos(a) * r]; up = [0, 1, 0];
        // Aim left of the plane so it turns in the free space to the right of the menu.
        const side = norm(cross(norm(sub([0, 1.6, 0], eye)), up));
        at = sub([0, 1.6, 0], mul(side, 6.5 * (plane.cam || plane.scale)));
      } else {
        const { f, u, r: rt } = flight.axes();
        if (war && war.guiding && war.guideM && !war.guideM.dead && mode.id === 'war') {
          // Flying a guided missile: the camera rides behind it.
          const dm = norm(war.guideM.vel); eye = add(sub(war.guideM.pos, mul(dm, 16)), [0, 4, 0]); at = add(war.guideM.pos, mul(dm, 120)); up = [0, 1, 0];
        } else if ((camMode === 1 || footScoped()) && !(flight.crashed && wreckT > 0.8)) {
          eye = add(add(flight.pos, mul(u, 1.1)), mul(f, -0.4)); at = add(eye, f); up = u;
        } else if (flight.crashed && crashCam) {
          // After a crash: keep following from where the camera was, with a little shake that dies away, then settle into
          // a slow orbit round the wreck (wherever it ended up).
          const c = flight.pos;
          if (crashCam.t0 == null) { crashCam.t0 = t; crashCam.y0 = camMode === 1 ? c[1] + 6 : camPos[1]; }
          const el = (t - crashCam.t0) / 1000, k = clamp(el / 3, 0, 1), e = k * k * (3 - 2 * k);
          const rT = 30 * Math.pow(plane.cam || 1, 0.8), r = crashCam.r + (rT - crashCam.r) * e, a = crashCam.a + 0.00032 * (t - crashCam.t0);
          const hy = Math.max(crashCam.y0 + (c[1] + 4 + r * 0.22 - crashCam.y0) * e, c[1] + 2);
          const sh = crashCam.shake * Math.exp(-el * 1.1) + shakeKick * 1.4;
          eye = [c[0] + Math.sin(a) * r + Math.sin(t * 0.071) * sh, hy + Math.sin(t * 0.093 + 1) * sh * 0.7, c[2] + Math.cos(a) * r + Math.cos(t * 0.083) * sh];
          const g = groundAt(W, eye[0], eye[2]) + 2; if (eye[1] < g) eye[1] = g;
          at = add(c, [Math.sin(t * 0.097) * sh * 0.3, 1.5, 0]); up = [0, 1, 0];
        } else if (camMode === 2 || screen === 'result' || flight.crashed) {
          const a = t * 0.0004, c = flight.pos, r = flight.crashed ? 38 : 28;
          eye = [c[0] + Math.sin(a) * r, Math.max(c[1] + 12, groundAt(W, c[0] + Math.sin(a) * r, c[2] + Math.cos(a) * r) + 4), c[2] + Math.cos(a) * r];
          at = c; up = [0, 1, 0];
        } else {
          const onFoot = mode.id === 'war' && war && war.foot && screen === 'fly';
          const back = onFoot ? 3.4 : 20 * (plane.cam || plane.scale), high = onFoot ? 1.3 : 5 * (plane.cam || plane.scale);
          const want = onFoot ? add(add(flight.pos, mul(f, -back)), add(mul(rt, 0.9), [0, high * 0.7, 0])) : add(add(flight.pos, mul(f, -back)), add(mul(u, high * 0.6), [0, high * 0.6, 0]));
          camPos = lerp(camPos, want, onFoot ? 0.4 : 0.12);
          const gh = groundAt(W, camPos[0], camPos[2]) + 1.5; if (camPos[1] < gh) camPos[1] = gh;
          eye = camPos; at = onFoot ? add(add(flight.pos, mul(f, 40)), mul(rt, 0.9)) : add(flight.pos, mul(f, 12)); up = onFoot ? [0, 1, 0] : norm(add(mul(u, 0.35), [0, 1, 0]));
        }
      }
      const zoomF = screen === 'fly' && mode.id === 'war' && war && war.foot ? SOLDIER.zoom[war.zoomI] : 1;
      const fovy = screen === 'menu' ? 45 * DEG : 2 * Math.atan(Math.tan(31 * DEG) / zoomF);
      const proj = persp(fovy, w / h, (camMode === 1 || footScoped()) ? 0.3 : 1, 14000);
      if (devView) { eye = devView.eye; at = devView.at; up = [0, 1, 0]; }
      const vp = mat4mul(proj, lookAt(eye, at, up));
      lastVP = vp;
      gl.uniformMatrix4fv(U.vp, false, vp);

      // Sky, ground, trees, airfield, clouds and water (it leaves the ordinary shader bound).
      WR.draw({ eye, at, up, vp, fovy, aspect: w / h, t, planePos: flight.pos, wind: flight.wind, shadow: screen === 'menu' ? 0 : mode.id === 'war' && war && war.foot ? 0.9 : (plane.span || 5) * 1.1 });

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

      if (showPlane && !(mode.id === 'war' && war && (war.vehicle === 'tank' || (war.net && war.dead && !flight.crashed)))) drawAircraft(t);
      if (mode.id === 'war') { heatPass = thermal; warRender(t); heatPass = false; }
      // Broken-off parts; the burnt ones darker.
      const charred = flight.crashed && flight.ignited ? [0.42, 0.4, 0.38] : null;
      // (the scars the sliding wreck left in the ground, then the pieces)
      for (const g of gouges) draw(decalMesh, model(g.q, g.p, g.s), g.col);
      for (const d of debris) {
        if (d.pieces) { const tint = d.scorch ? [0.4, 0.38, 0.36] : [1, 1, 1]; for (const pc of d.pieces) draw(pc.mesh, model(d.q, add(d.pos, qrot(d.q, pc.off)), plane.scale), tint); }
        else draw(d.mesh, model(d.q, d.pos, d.sc || plane.scale), d.col || (charred && d.fire !== undefined && d.part !== 'P' ? charred : [1, 1, 1]));
      }
      // Fire, smoke, dust, sparks and spray.
      gl.enable(gl.BLEND); gl.depthMask(false);
      for (const p of smoke) {
        const k = p.t / p.life, def = PUFF[p.kind], hot = p.kind === 'fire' || p.kind === 'spark';
        if (thermal && !hot) continue;           // heat vision sees through smoke, dust and haze: only fire shows
        gl.uniform1f(U.alpha, (def.a ?? 1) * (1 - k * k));
        draw(smokeMesh, model(p.q, p.p, def.size[0] + (def.size[1] - def.size[0]) * k), thermal ? [3, 3, 3] : def.col(k), thermal ? 1 : def.glow);
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
      const alt = flight.pos[1] - gearH();
      const agl = alt - groundAt(W, flight.pos[0], flight.pos[2]);
      h2.font = `700 ${Math.round(12 * s + 2)}px system-ui, sans-serif`; h2.textBaseline = 'middle';
      const box = (x, y, bw, bh) => { h2.fillStyle = 'rgba(8,12,24,.55)'; h2.beginPath(); h2.roundRect ? h2.roundRect(x, y, bw, bh, 8) : h2.rect(x, y, bw, bh); h2.fill(); };
      if (mode.id === 'war') { if (war) warHud(W2, H2, s, box); return; }     // a battle shows only its own, simpler, panel
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
        const live = flight.ias, warn = (live < plane.stall * 1.06 && !flight.onGround) || live > plane.max;     // indicated airspeed
        needle(cx, cy, A(live), DR * 0.82, 2.4, warn ? '#ff6b6b' : '#fff');
        h2.fillStyle = '#2b303b'; h2.beginPath(); h2.arc(cx, cy, 4, 0, Math.PI * 2); h2.fill();
      }
      // Altimeter.
      {
        const cx = 8 + DR * 3 + 14, cy = dy, ft = (flight.pos[1] - gearH()) * 3.281, mb = 1013;
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
        const jet = plane.engine === 'jet' || plane.engine === 'turboprop' || plane.engine === 'turboshaft', er =24 * s + 8, ecx = tx - 24 - er, ecy = ty + 80 * s - er - 22;
        ring(ecx, ecy, er);
        const full = jet ? 100 : plane.rpmMax * 1.1, val = jet ? engState.n1 : engState.rpm, EA = (v) => (0.75 + 1.5 * clamp(v / full, 0, 1)) * Math.PI;
        if (jet) { arc(ecx, ecy, er * 0.8, EA(25), EA(95), '#38d26a', 4); arc(ecx, ecy, er * 0.8, EA(95), EA(100), '#ff3b30', 4); }
        else { arc(ecx, ecy, er * 0.8, EA(plane.rpmMax * 0.78), EA(plane.rpmMax * 0.93), '#38d26a', 4); arc(ecx, ecy, er * 0.8, EA(plane.rpmMax * 0.93), EA(full), '#ff3b30', 4); }
        needle(ecx, ecy, EA(val), er * 0.78, 2, flight.damage.engine ? '#fff' : '#ff6b6b');
        label(ecx, ecy + er * 0.45, plane.engine === 'turboprop' ? 'TRQ %' : jet ? 'N1 %' : 'RPM', -Math.PI / 2, 0, 6, '#9aa3b2');  // a turboshaft's gauge is N1 too
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
      else if (mode.id === 'war' && war) status = `✈ AIR WAR · wave ${war.wave} · ${war.kills} kill${war.kills === 1 ? '' : 's'}`;
      else if (!plane.rotor && flight.onGround && flight.speed < 0.5 && onApron(flight.pos) && !hadTakeoff) status = 'At the gate: press 1 refuel · 2 catering · 3 baggage · 4 pushback, then taxi to the runway';
      else if (plane.rotor && flight.onGround && !hadAir) status = 'Hold W to raise the collective · ↑ leans forward · A/D turn · H emergency landing';
      else status = flight.onGround && !hadTakeoff ? (invert ? 'Hold W for throttle · cursor down or ↓ to lift off' : 'Hold W for throttle · cursor up or ↑ to lift off') : 'Free flight';
      const tw = h2.measureText(status).width + 24;
      box(cx - tw / 2, 8, tw, 26 * s + 6); h2.fillStyle = '#fff'; h2.fillText(status, cx, 8 + (26 * s + 6) / 2);
      // Warnings.
      h2.font = `900 ${Math.round(16 * s + 4)}px system-ui`;
      const blink = Math.floor(performance.now() / 300) % 2;
      if (gearWarn && !gpwsOn && blink) { h2.fillStyle = '#ff4d4d'; h2.fillText('TOO LOW · GEAR', cx, 78 * s + 10); }
      if (!flight.damage.engine && blink) { h2.fillStyle = '#ff4d4d'; h2.fillText('ENGINE FAILURE', cx, 56 * s + 10); }
      else if (flight.wings < 1 && blink) { h2.fillStyle = '#ff4d4d'; h2.fillText(flight.wings === 0 ? 'NO WINGS' : 'WING LOST', cx, 56 * s + 10); }
      else if (flight.spin && blink) { h2.fillStyle = '#ff4d4d'; h2.fillText('SPIN · STICK FORWARD · OPPOSITE RUDDER', cx, 56 * s + 10); }
      else if (flight.stalled && blink) { h2.fillStyle = '#ff4d4d'; h2.fillText('STALL', cx, 56 * s + 10); }
      else if (!flight.onGround && agl < 40 && flight.vel[1] < -9 && blink) { h2.fillStyle = '#ffd166'; h2.fillText('PULL UP', cx, 56 * s + 10); }
      else if (!flight.onGround && (Math.abs(flight.gload) > 3 || flight.stress > 0.05)) {
        // The g meter, amber over 3 g and red once the wings are being overloaded.
        h2.fillStyle = flight.stress > 0.05 || Math.abs(flight.gload) > plane.gLimit ? '#ff4d4d' : '#ffd166'; h2.fillText(`${flight.gload.toFixed(1)} G${flight.stress > 0.05 ? ' · OVERSTRESS' : ''}`, cx, 56 * s + 10);
      }
      // Wind: where it blows from, how hard, and an arrow showing which way it is pushing relative to the nose.
      {
        const wx = flight.wv[0], wz = flight.wv[2], ws = flight.windSpd, rel = Math.atan2(wx, -wz) - flight.heading;
        // The steady wind (what the windsock and the weather report say), its gust peak and its parts along and across the runway.
        const sx0 = -Math.sin(flight.windFrom) * ws, sz0 = Math.cos(flight.windFrom) * ws, from = (((flight.windFrom / DEG) % 360) + 360) % 360;
        const rh = flight.rwyHdg || 0, headC = -(sx0 * Math.sin(rh) - sz0 * Math.cos(rh)), crossC = -(sx0 * Math.cos(rh) + sz0 * Math.sin(rh));   // + headwind, + from the right
        const un = kmh ? 3.6 : 1.944, ul = kmh ? 'km/h' : 'kt', gustPk = ws + (flight.gustMax || 0);
        const bw = 118 * s + 40, bh = 46 * s + 18, bx = 8, by = 8, ax = bx + 17, ay = by + bh / 2, al = 4 + clamp(ws, 0, 25) * 0.65;
        box(bx, by, bw, bh);
        h2.strokeStyle = '#8fd0ff'; h2.fillStyle = '#8fd0ff'; h2.lineWidth = 2; h2.beginPath();
        const ex = ax + Math.sin(rel) * al, ey = ay - Math.cos(rel) * al, sx = ax - Math.sin(rel) * al, sy = ay + Math.cos(rel) * al;
        h2.moveTo(sx, sy); h2.lineTo(ex, ey); h2.stroke();
        h2.beginPath(); h2.moveTo(ex, ey); h2.lineTo(ex - Math.sin(rel - 0.5) * 5, ey + Math.cos(rel - 0.5) * 5); h2.lineTo(ex - Math.sin(rel + 0.5) * 5, ey + Math.cos(rel + 0.5) * 5); h2.fill();
        h2.textAlign = 'left'; h2.font = `700 ${Math.round(9 * s + 2)}px system-ui`; h2.fillStyle = '#e8ebf0';
        const ly = 13 * s + 5, ty = by + 8 + ly * 0 + 4;
        h2.fillText(`Wind ${String(Math.round(from / 10) % 36 * 10).padStart(3, '0')}° ${Math.round(ws * un)} ${ul}${gustPk - ws > 0.7 ? ', gusting ' + Math.round(gustPk * un) : ''}`, bx + 36, ty);
        h2.fillStyle = '#9aa3b2';
        h2.fillText(`X-wind ${Math.round(Math.abs(crossC) * un)} ${crossC < -0.3 ? '◀ L' : crossC > 0.3 ? 'R ▶' : ''}`, bx + 36, ty + ly);
        h2.fillText(`${headC >= 0 ? 'H-wind' : 'T-wind'} ${Math.round(Math.abs(headC) * un)} · GS ${Math.round(flight.speed * un)}`, bx + 36, ty + ly * 2);
        h2.textAlign = 'center';
      }
      // Next hoop distance (and direction when it's off-screen).
      if (target) {
        const d = len(sub(target.pos, flight.pos));
        h2.font = `700 ${Math.round(11 * s + 2)}px system-ui`; h2.fillStyle = '#ffd166';
        h2.fillText(`next hoop ${Math.round(d)} m`, cx, 34 * s + 30);
      }
      // Damage panel (top right) once anything is wrong.
      const dmg = flight.damage;
      if (!dmg.engine || dmg.power < 1 || !dmg.L || !dmg.R || !dmg.gear || dmg.tail < 1 || !dmg.nose || dmg.tyreL || dmg.tyreR || dmg.strutL > 0.1 || dmg.strutR > 0.1) {
        const rows = [['ENGINE', !dmg.engine ? 'FAILED' : dmg.power < 1 ? 'ROUGH' : 'OK', !dmg.engine ? '#ff4d4d' : dmg.power < 1 ? '#ffd166' : '#5ee08a'],
          ['L WING', dmg.L ? 'OK' : 'GONE', dmg.L ? '#5ee08a' : '#ff4d4d'], ['R WING', dmg.R ? 'OK' : 'GONE', dmg.R ? '#5ee08a' : '#ff4d4d'],
          ['GEAR', !dmg.gear ? 'BROKEN' : !dmg.nose ? 'NOSE LEG' : dmg.tyreL || dmg.tyreR ? 'TYRE' : dmg.strutL > 0.1 || dmg.strutR > 0.1 ? 'STRUT' : 'OK', dmg.gear && dmg.nose && !dmg.tyreL && !dmg.tyreR && !(dmg.strutL > 0.1 || dmg.strutR > 0.1) ? '#5ee08a' : '#ff4d4d'],
          ['TAIL', dmg.tail >= 1 ? 'OK' : dmg.tail <= 0 ? 'GONE' : `${Math.round(dmg.tail * 100)}%`, dmg.tail >= 1 ? '#5ee08a' : dmg.tail <= 0 ? '#ff4d4d' : '#ffd166']];
        const bw = 120 * s + 14, bx = W2 - bw - 8, by0 = 8;
        box(bx, by0, bw, rows.length * 16 * s + 12);
        h2.font = `700 ${Math.round(9 * s + 2)}px system-ui`; h2.textAlign = 'left';
        rows.forEach(([n, v, c], i) => { const y = by0 + 12 + i * 16 * s; h2.fillStyle = 'rgba(255,255,255,.65)'; h2.fillText(n, bx + 8, y); h2.fillStyle = c; h2.fillText(v, bx + 8 + 62 * s, y); });
        h2.textAlign = 'center';
      }
      // The last air traffic control call.
      if (atcT > 0 && atcText) {
        h2.textAlign = 'center'; h2.textBaseline = 'middle'; h2.font = `600 ${Math.round(10 * s + 2)}px system-ui`;
        const tw = Math.min(W2 - 24, h2.measureText(atcText).width + 28), tx = (W2 - tw) / 2;
        box(tx, 84 * s + 4, tw, 26); h2.fillStyle = '#ffe9a8'; h2.fillText(atcText, W2 / 2, 84 * s + 17, tw - 16);
      }
      // Procedure: the steps for this phase of the flight, ticked off as they are done (T hides it).
      if (showCheck && !flight.crashed && mode.id !== 'war') {
        const pr = procedure(flight, W, { took: hadTakeoff || hadAir });
        if (pr) {
          const bw5 = 214 * s + 20, bh5 = 22 * s + pr.steps.length * 16 * s + 8, bx5 = 8, by5 = 70 * s + 24;
          box(bx5, by5, bw5, bh5); h2.textAlign = 'left'; h2.textBaseline = 'middle'; h2.font = `700 ${Math.round(9 * s + 2)}px system-ui`;
          const done = pr.cur < 0;
          h2.fillStyle = done ? '#5ee08a' : '#9fe3ff'; h2.fillText(done ? pr.title + ': COMPLETE' : pr.title + '  (T hides)', bx5 + 8, by5 + 12);
          pr.steps.forEach((st, i) => {
            h2.fillStyle = st.ok ? '#5ee08a' : i === pr.cur ? '#ffd166' : 'rgba(255,255,255,.5)';
            h2.fillText(`${st.ok ? '✓' : i === pr.cur ? '►' : '○'}  ${st.t}`, bx5 + 8, by5 + 12 + 16 * s * (i + 1) + 4, bw5 - 14);
          });
          h2.textAlign = 'center';
        }
      }
      // Autopilot panel: the targets it is holding.
      if (flight.ap && flight.ap.on && !flight.crashed) {
        h2.textAlign = 'left'; h2.textBaseline = 'middle'; h2.font = `700 ${Math.round(10 * s + 2)}px system-ui`;
        const a = flight.ap, hd = ((Math.round(a.hdg * 57.2958) % 360) + 360) % 360;
        const txt = `${a.mode === 'appr' ? 'AP APPR' : 'AP'}   HDG ${String(hd).padStart(3, '0')}°   ALT ${Math.round(a.alt * 3.28084)} ft   SPD ${Math.round(a.spd / KT)} kt    , . heading   [ ] altitude   K off   J approach`;
        const bw3 = h2.measureText(txt).width + 24, bx3 = (W2 - bw3) / 2;
        box(bx3, H2 - 34 * s - 18, bw3, 24); h2.fillStyle = '#5ee08a'; h2.fillText(txt, bx3 + 12, H2 - 34 * s - 6);
        h2.textAlign = 'center';
      }
      // Instrument landing system: runway, distance and the two needles, shown when on an approach course.
      if (!plane.rotor && !flight.crashed && !flight.onGround && mode.id !== 'war') {
        const il = ilsAt(W, flight.pos, gearH());
        if (il && il.dist < 22000) {
          const x0 = 8, y0 = H2 - 215 * s - 30, bw4 = 128 * s + 20, bh4 = 62 * s;
          box(x0, y0, bw4, bh4); h2.textBaseline = 'middle'; h2.textAlign = 'left';
          h2.font = `700 ${Math.round(9 * s + 2)}px system-ui`; h2.fillStyle = '#9fe3ff';
          h2.fillText(`ILS ${il.rwy.name}  ${(il.dist / 1000).toFixed(1)} km`, x0 + 8, y0 + 12);
          const cx = x0 + 8 + 56 * s, cy = y0 + 38 * s, span = 52 * s;
          h2.strokeStyle = 'rgba(255,255,255,.3)'; h2.lineWidth = 1; h2.beginPath(); h2.moveTo(cx - span, cy); h2.lineTo(cx + span, cy); h2.moveTo(cx, cy - 14 * s); h2.lineTo(cx, cy + 14 * s); h2.stroke();
          // needles point to where the course is: left if you are right of it, down if you are above the slope
          const lx = clamp(-il.loc / 0.044, -1, 1) * span, gy = clamp(il.gsDev / 0.012, -1, 1) * 12 * s;
          h2.fillStyle = Math.abs(il.loc) < 0.01 ? '#5ee08a' : '#ffd166'; h2.fillRect(cx + lx - 1.5, cy - 11 * s, 3, 22 * s);
          h2.fillStyle = Math.abs(il.gsDev) < 0.004 ? '#5ee08a' : '#ffd166'; h2.fillRect(cx - 18 * s, cy + gy * 0 - gy - 1.5, 36 * s, 3);
          h2.textAlign = 'center';
        }
      }
      // Ground services panel: shown when stopped on an apron.
      if (flight.onGround && flight.speed < 1.2 && onApron(flight.pos) && !flight.crashed) {
        h2.textAlign = 'left'; h2.textBaseline = 'middle'; h2.font = `700 ${Math.round(10 * s + 2)}px system-ui`;
        const job = (id, name) => `[${id}] ${name}${svcDone[id] ? ' ✓' : ''}${svc && svc.id === id ? ' ' + Math.round(100 * svc.t / svc.dur) + '%' : ''}`;
        const txt = `GROUND CREW   ${job(1, 'Refuel')}   ${job(2, 'Catering')}   ${job(3, 'Baggage')}${plane.rotor ? '' : '   ' + job(4, 'Pushback')}`;
        const bw3 = h2.measureText(txt).width + 24, bx3 = (W2 - bw3) / 2;
        box(bx3, 48 * s + 30, bw3, svc ? 38 : 24);
        h2.fillStyle = '#9fe3ff'; h2.fillText(txt, bx3 + 12, 48 * s + 42);
        if (svc) { h2.fillStyle = 'rgba(255,255,255,.18)'; h2.fillRect(bx3 + 12, 48 * s + 55, bw3 - 24, 5); h2.fillStyle = '#5ee08a'; h2.fillRect(bx3 + 12, 48 * s + 55, (bw3 - 24) * svc.t / svc.dur, 5); }
      }
      // The nearest airfield (and the helipads), with its distance and which way to turn for it.
      {
        let best = null, bd = Infinity;
        for (const st of STARTS) { if (st.gate) continue; const c = st.id === 'home' ? [0, -700] : [st.pos[0], st.pos[2] - 460]; const d = Math.hypot(c[0] - flight.pos[0], c[1] - flight.pos[2]); if (d < bd) { bd = d; best = { st, c }; } }
        const rel = ((Math.atan2(best.c[0] - flight.pos[0], -(best.c[1] - flight.pos[2])) - flight.heading + Math.PI * 3) % (Math.PI * 2)) - Math.PI;
        const arrow = Math.abs(rel) < 0.35 ? 'AHEAD' : Math.abs(rel) > 2.8 ? 'BEHIND' : rel > 0 ? 'TO THE RIGHT' : 'TO THE LEFT';      // words: an up arrow looked like "it is above you"
        const txt = `${best.st.name} · ${bd < 950 ? Math.round(bd) + ' m' : (bd / 1000).toFixed(1) + ' km'} ${arrow}`;
        h2.font = `700 ${Math.round(9 * s + 2)}px system-ui`; h2.textAlign = 'left'; h2.textBaseline = 'middle';
        const bw2 = h2.measureText(txt).width + 16, by2 = H2 - 8 - 24;
        box(W2 - bw2 - 8, 8 + (flight.damage ? 0 : 0) + 7 * 16 * s + 22, bw2, 22); h2.fillStyle = 'rgba(255,255,255,.85)'; h2.fillText(txt, W2 - bw2, 8 + 7 * 16 * s + 33);
      }
      // Markers over the other aircraft you can see, with their distance (so they are never just a dot in the haze).
      if ((trafficOn || (shareOn && remote.length) || praceShow.length) && lastVP) {
        h2.font = `700 ${Math.round(9 * s + 2)}px system-ui`; h2.textAlign = 'center'; h2.textBaseline = 'middle';
        for (const a of [...(trafficOn ? traffic : []), ...(shareOn ? remote : []), ...praceShow]) {
          if (a.state !== 'fly') continue;
          const px = a.pos[0], py = a.pos[1], pz = a.pos[2], m = lastVP;
          const cw = m[3] * px + m[7] * py + m[11] * pz + m[15];
          if (cw <= 1) continue;
          const sx = ((m[0] * px + m[4] * py + m[8] * pz + m[12]) / cw * 0.5 + 0.5) * W2, sy = (1 - ((m[1] * px + m[5] * py + m[9] * pz + m[13]) / cw * 0.5 + 0.5)) * H2;
          if (sx < 20 || sx > W2 - 20 || sy < 20 || sy > H2 - 20) continue;
          const d = len(sub(a.pos, flight.pos)); if (d > 8000) continue;
          const col = d < 1500 ? '#ffd166' : 'rgba(255,255,255,.85)';
          h2.strokeStyle = col; h2.lineWidth = 1.6; h2.beginPath(); h2.moveTo(sx, sy - 11); h2.lineTo(sx + 11, sy); h2.lineTo(sx, sy + 11); h2.lineTo(sx - 11, sy); h2.closePath(); h2.stroke();
          h2.fillStyle = col; h2.fillText(`${a.cs ? a.cs + ' · ' : ''}${a.spec.name.split(' ').slice(-1)[0]} ${d < 950 ? Math.round(d) + ' m' : (d / 1000).toFixed(1) + ' km'}`, sx, sy + 24);
        }
      }
      // The nearest other aircraft, with its distance, height difference and which way it lies.
      if (trafficOn && trafficNearest && trafficNearest.a.state === 'fly') {
        const a = trafficNearest.a, d = trafficNearest.d, dy = Math.round((a.pos[1] - flight.pos[1]) * 3.281 / 100) * 100;
        const rel = ((Math.atan2(a.pos[0] - flight.pos[0], -(a.pos[2] - flight.pos[2])) - flight.heading + Math.PI * 3) % (Math.PI * 2)) - Math.PI;
        const arrow = Math.abs(rel) < 0.35 ? 'AHEAD' : Math.abs(rel) > 2.8 ? 'BEHIND' : rel > 0 ? 'TO THE RIGHT' : 'TO THE LEFT';      // words: an up arrow looked like "it is above you"
        const txt = `TRAFFIC ${a.spec.name.split(' ').slice(-1)[0]} · ${d < 950 ? Math.round(d) + ' m' : (d / 1000).toFixed(1) + ' km'} ${arrow} ${dy === 0 ? 'LEVEL' : (dy > 0 ? 'ABOVE ' + dy : 'BELOW ' + (-dy)) + ' ft'} · YOU Y${Math.round(flight.pos[1])} · THEM Y${Math.round(a.pos[1])}`;
        h2.font = `700 ${Math.round(9 * s + 2)}px system-ui`; h2.textAlign = 'left'; h2.textBaseline = 'middle';
        const bw4 = h2.measureText(txt).width + 16, by4 = 8 + 7 * 16 * s + 22 + 28;
        box(W2 - bw4 - 8, by4, bw4, 22); h2.fillStyle = d < 800 ? '#ffd166' : 'rgba(255,255,255,.85)'; h2.fillText(txt, W2 - bw4, by4 + 11);
      }
      // Helicopter panel: height above the ground, climb rate, ground speed, collective and rotor speed, and the
      // emergency-landing banner (the assist levels the disc and sets down gently; H starts and cancels it).
      if (plane.rotor) {
        const aglFt = Math.max(0, agl * 3.281), vsFpm = Math.round(flight.vel[1] * 196.85 / 10) * 10;
        const gs = Math.hypot(flight.vel[0], flight.vel[2]), gsTxt = kmh ? `${Math.round(gs * 3.6)} km/h` : `${Math.round(gs * 1.944)} kt`;
        const nr = Math.round(100 * (flight.damage.engine ? 1 : 0.55 + 0.1 * flight.throttle));
        const rows = [['HEIGHT', `${Math.round(aglFt)} ft`, '#e8ebf0'],
          ['V/S', `${vsFpm > 0 ? '+' : ''}${vsFpm} fpm`, vsFpm < -1500 && aglFt < 300 ? '#ff6b6b' : '#e8ebf0'],
          ['GROUND', gsTxt, '#e8ebf0'],
          ['COLLECTIVE', `${Math.round(flight.throttle * 100)}%`, '#e8ebf0'],
          ['ROTOR', `${nr}%`, nr < 90 ? '#ff6b6b' : '#5ee08a']];
        const bw = 128 * s + 22, bx = 8, by0 = 8 + (46 * s + 18) + 6;   // under the wind box
        box(bx, by0, bw, rows.length * 16 * s + 12);
        h2.font = `700 ${Math.round(9 * s + 2)}px system-ui`; h2.textBaseline = 'middle';
        rows.forEach(([n, v, c], i) => {
          const y = by0 + 12 + i * 16 * s;
          h2.textAlign = 'left'; h2.fillStyle = 'rgba(255,255,255,.65)'; h2.fillText(n, bx + 8, y);
          h2.textAlign = 'right'; h2.fillStyle = c; h2.fillText(v, bx + bw - 8, y);
        });
        if (flight.emergency) {
          const blink = 0.55 + 0.45 * Math.sin(performance.now() / 160);
          h2.textAlign = 'center'; h2.font = `800 ${Math.round(13 * s + 3)}px system-ui`;
          h2.fillStyle = `rgba(255,70,60,${0.25 + 0.2 * blink})`; h2.beginPath(); h2.roundRect ? h2.roundRect(W2 / 2 - 150 * s - 10, 44, 300 * s + 20, 30 * s + 8, 10) : h2.rect(W2 / 2 - 150 * s - 10, 44, 300 * s + 20, 30 * s + 8); h2.fill();
          h2.fillStyle = '#fff'; h2.fillText('EMERGENCY LANDING', W2 / 2, 44 + 15 * s + 4);
          h2.font = `600 ${Math.round(9 * s + 2)}px system-ui`; h2.fillStyle = 'rgba(255,255,255,.8)'; h2.fillText('assist is flying · pedals are yours · H to cancel', W2 / 2, 44 + 28 * s + 6);
        } else if (!flight.damage.engine) {
          h2.textAlign = 'center'; h2.font = `800 ${Math.round(12 * s + 3)}px system-ui`; h2.fillStyle = '#ff6b6b'; h2.fillText('ENGINE OUT · press H for an emergency landing', W2 / 2, 60);
        }
      }
      // Hard g: the view narrows to a grey-out and goes black (blackout), or reddens (redout) when pushing negative.
      if (Math.abs(flight.blackout) > 0.04) {
        const b = flight.blackout, ab = Math.abs(b), c = b > 0 ? '0,0,0' : '170,0,10', m = Math.min(W2, H2);
        const g = h2.createRadialGradient(W2 / 2, H2 / 2, m * (0.62 - 0.55 * ab), W2 / 2, H2 / 2, Math.max(W2, H2) * 0.72);
        g.addColorStop(0, `rgba(${c},0)`); g.addColorStop(1, `rgba(${c},${Math.min(0.97, ab * 1.15)})`);
        h2.fillStyle = g; h2.fillRect(0, 0, W2, H2);
      }
      if (paused) { h2.fillStyle = 'rgba(0,0,0,.3)'; h2.fillRect(0, 0, W2, H2); }
    }

    // ---- menus (HTML over the canvas)
    /// The Weather panel on the Fly tab: presets, crosswind (left / right), head / tail wind and turbulence level.
    function weatherPanel() {
      const same = (a, b) => a.random === b.random && (a.random || (Math.abs(a.crossKt) === b.crossKt && a.headKt === b.headKt && a.turb === b.turb));
      const dis = WX.random ? 'disabled style="opacity:.4"' : '';
      const cross = Math.abs(WX.crossKt), side = WX.crossKt < 0 ? 'L' : 'R';
      return `<h2>4 · Weather <small style="font-weight:500;opacity:.6">applies to every challenge</small></h2>
        <div class="pg-row" style="gap:5px">${WX_PRESETS.map(([id, name, p]) => `<button data-wxp="${id}" class="${same(WX, p) ? 'pg-on' : ''}">${name}</button>`).join('')}</div>
        <div class="pg-row" style="margin-top:5px"><label class="pg-hint" style="min-width:185px">Crosswind <b data-wxv="cross">${cross} kt (${(cross * KT).toFixed(0)} m/s)</b></label>
          <button data-wxs="L" class="${side === 'L' ? 'pg-on' : ''}" ${dis}>◀ From left</button><button data-wxs="R" class="${side === 'R' ? 'pg-on' : ''}" ${dis}>From right ▶</button>
          <input type="range" min="0" max="90" step="1" value="${cross}" data-wx="cross" aria-label="Crosswind in knots" style="flex:1;min-width:120px;padding:0" ${dis}></div>
        <div class="pg-row"><label class="pg-hint" style="min-width:185px">Head / tail wind <b data-wxv="head">${WX.headKt === 0 ? '0 kt' : Math.abs(WX.headKt) + ' kt ' + (WX.headKt > 0 ? 'head' : 'tail')}</b></label>
          <input type="range" min="-30" max="30" step="1" value="${WX.headKt}" data-wx="head" aria-label="Headwind positive, tailwind negative, in knots" style="flex:1;min-width:120px;padding:0" ${dis}></div>
        <div class="pg-row" style="gap:5px"><span class="pg-hint" style="min-width:185px">Turbulence and gusts</span>${TURB_LEVELS.map(([id, name]) => `<button data-wxt="${id}" class="${!WX.random && WX.turb === id ? 'pg-on' : ''}" ${dis}>${name}</button>`).join('')}</div>
        <div class="pg-row" style="gap:5px"><span class="pg-hint" style="min-width:185px">Time of day</span>${Object.entries(TODS).map(([id, t]) => `<button data-tod="${id}" class="${ENV.tod === id ? 'pg-on' : ''}">${t.name}</button>`).join('')}</div>
        <div class="pg-row" style="gap:5px"><span class="pg-hint" style="min-width:185px">Visibility</span>${Object.entries(VISIBILITY).map(([id, t]) => `<button data-vis="${id}" class="${ENV.vis === id ? 'pg-on' : ''}">${t.name}</button>`).join('')}</div>
        <div class="pg-hint" style="margin-top:3px" data-wxsum>${wxText()}</div>`;
    }
    function statBar(label, v) { return `<div class="pg-stat">${label}<span><i style="width:${Math.round(clamp(v, 0.05, 1) * 100)}%"></i></span></div>`; }
    function fmtScore(m, v) { return m.id === 'trial' ? `${Number(v).toFixed(1)} s` : m.id === 'hoops' ? `${v}` : `${v}`; }
    /// Draws the menu or the pause / result screen. If one of them ever throws (a saved tab from an older version, a
    /// bad value), it falls back to the first tab instead of leaving a blank blue screen.
    function renderUI() {
      try { renderUIInner(); syncCtlUi(); }
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
    /// The Battle menu: your vehicle, the battlefield, and three simple choices (and a way to play with friends).
    function soloBattleHtml() {
      const card = (attr, cur, id, title, text) => `<div class="pg-card ${cur === id ? 'pg-on' : ''}" data-${attr}="${id}"><b>${title}</b><i>${text}</i></div>`;
      const chip = (attr, cur, id, label, tip) => `<button data-${attr}="${id}" class="${cur === id ? 'pg-on' : ''}" title="${tip}">${label}</button>`;
      const assistText = { auto: 'Automatic: the plane flies itself and holds its own height and speed. You point it where you want to go and shoot. A tank aims its turret by itself.',
        easy: 'Easy: you fly or drive yourself, and your shots curve towards enemies near your sights. The enemy is gentler.', pro: 'Pro: full control with no help, and a tougher enemy.' };
      return `<h2>1 · Your vehicle</h2><div class="pg-bgrid">${WAR_VEHICLES.map((v) => card('warveh', warVeh, v.id, `${v.icon} ${v.name}`, v.blurb)).join('')}</div>
        <h2>2 · Battlefield</h2><div class="pg-bgrid pg-b3">${ARENAS.map((a) => card('warfield', warField, a.id, a.name, a.blurb)).join('')}</div>
        <h2>3 · How you play</h2>
        <div class="pg-row"><span class="pg-lab">Controls</span>${chip('warassist', warAssist, 'auto', '🤖 Automatic', 'The vehicle looks after itself; you point and shoot')}${chip('warassist', warAssist, 'easy', '🙂 Easy', 'You drive or fly, with help aiming')}${chip('warassist', warAssist, 'pro', '🎮 Pro', 'Full control, no help')}</div>
        <div class="pg-hint" style="margin:2px 0 8px">${assistText[warAssist]}</div>
        <div class="pg-row"><span class="pg-lab">Realism</span><button data-waroverg class="${warOverG ? 'pg-on' : ''}">Over-G effects: ${warOverG ? 'On' : 'Off'}</button><span class="pg-hint">On by default; turn off G stress and blackout.</span></div>
        <div class="pg-row"><span class="pg-lab">Target city</span><input data-warcity maxlength="20" placeholder="Name a city to bomb (or leave empty)" value="${escapeHtml(warCity)}" style="width:230px"><span class="pg-hint">Every wave has a city to destroy; the first one is yours.</span></div>
        <div class="pg-row"><span class="pg-lab">Teams</span>${chip('warside', warSide, 'coop', '🤝 Co-op', 'You and a computer wingman against the computer')}${chip('warside', warSide, 'versus', '⚔️ Fight', 'No wingman: computer aces hunt you')}</div>
        <div class="pg-row" style="margin-top:6px"><span class="pg-lab">Enemies</span>${chip('warnpc', warNpc ? 'on' : 'off', 'on', 'On: they fight back', 'Fighters, tanks and guns shoot at you')}${chip('warnpc', warNpc ? 'on' : 'off', 'off', 'Off: targets only', 'Targets that do not shoot: for practice')}</div>`;
    }
    function battleHtml() {
      if (netg) return lobbyHtml();
      loadWifiCode();
      const chipP = (id, label, tip) => `<button data-warplay="${id}" class="${warPlay === id ? 'pg-on' : ''}" title="${tip}">${label}</button>`;
      const offlineNote = navigator.onLine === false ? '<div class="pg-hint" style="color:#ffb347;margin-bottom:6px">You are offline: Start plays a solo Battle on this computer. Online games and friends need the internet.</div>' : '';
      return `${offlineNote}<h2>Who are you?</h2><div class="pg-row"><span class="pg-lab">Your name</span><input data-warname maxlength="14" placeholder="Required: others see this" value="${escapeHtml(playerName)}" style="width:170px"><span class="pg-hint">Shown above you and in the player list.</span></div>
        <div class="pg-row" style="margin:6px 0"><span class="pg-lab">Play</span>${chipP('online', '🌐 Online', 'Join an open game on this battlefield, in the wave being played. If nobody is there you open one.')}${chipP('single', '👤 Single player', 'Your own game. Others can still join with its room code, any time.')}<span class="pg-hint">${warPlay === 'single' ? 'Your own game; others can join with the room code shown in it.' : 'Press Start: you join an open game and the wave being played.'}</span></div>`
        + soloBattleHtml() + `<h2>4 · Play with friends</h2>
        ${wifiCode ? `<div class="pg-row"><span class="pg-lab">This Wi-Fi</span><b style="letter-spacing:.14em;font-size:15px">${wifiCode}</b><span class="pg-hint">Everyone on this Wi-Fi gets this same code: the first to press Host opens the game, the others press Join. (Online already puts everyone in one open game.)</span></div>` : ''}
        <div class="pg-row"><button data-nethost class="pg-go">Host a game</button><span class="pg-hint">or join one:</span><input data-netcode maxlength="8" placeholder="Room code" style="width:110px;text-transform:uppercase" value="${escapeHtml(joinDraft)}"><button data-netjoin>Join</button></div>
        <div class="pg-hint" style="margin-top:4px">Host a private game and share its 6-letter code, or just press Start to join an open one.</div>`;
    }
    /// The waiting room: the code, who is here, and what the match will be (the host chooses; the others vote).
    function lobbyHtml() {
      const n = netg, host = n.role === 'host', veh = (id) => (WAR_VEHICLES.find((v) => v.id === id) || WAR_VEHICLES[0]);
      const roster = host ? netRoster() : n.roster;
      const note = n.error ? `<div class="pg-hint" style="color:#ffb347">${escapeHtml(n.error)}</div>` : n.status !== 'on' ? '<div class="pg-hint">Connecting…</div>' : !host && !n.hostSeen ? '<div class="pg-hint">Looking for the game…</div>' : '';
      const people = roster.map((r) => `<div class="pg-person"><b>${escapeHtml(r.n)}${r.id === netMyId ? ' (you)' : ''}${r.id === n.hostId ? ' 👑' : ''}</b><span>${veh(r.v).icon} ${veh(r.v).name}</span></div>`).join('') || '<div class="pg-hint">Just you so far.</div>';
      const opt = (key, vals) => vals.map(([val, label]) => {
        const cur = n.cfg[key] === val, c = netVoteCounts(key)[val] || 0, mine = n.votes[netMyId] && n.votes[netMyId][key] === val;
        return `<button data-netset="${key}:${val}" class="${cur ? 'pg-on' : mine ? 'pg-voted' : ''}" title="${host ? 'Choose this' : cur ? 'This is how it is' : 'Vote for this'}">${label}${!cur && c ? ` (${c})` : ''}</button>`;
      }).join('');
      const how = host ? 'You are the host: your choices apply straight away.' : 'Press a choice to vote for it. It changes when more than half of the players agree.';
      return `<h2>Your game</h2>
        <div class="pg-room"><div><span class="pg-hint">Room code (tell your friends)</span><div class="pg-code">${n.code}</div></div><button data-netleave>Leave</button></div>${note}
        <h2>Players</h2><div class="pg-people">${people}</div>
        <h2>Your vehicle</h2><div class="pg-bgrid">${WAR_VEHICLES.map((v) => `<div class="pg-card ${warVeh === v.id ? 'pg-on' : ''}" data-warveh="${v.id}"><b>${v.icon} ${v.name}</b><i>${v.blurb}</i></div>`).join('')}</div>
        <h2>The match</h2><div class="pg-hint" style="margin-bottom:4px">${how}</div>
        <div class="pg-row"><span class="pg-lab">Teams</span>${opt('side', [['coop', '🤝 Co-op'], ['versus', '⚔️ Fight']])}</div>
        <div class="pg-row" style="margin-top:6px"><span class="pg-lab">Enemies</span>${opt('npc', [[true, 'On'], [false, 'Off']])}</div>
        <div class="pg-row" style="margin-top:6px"><span class="pg-lab">Field</span>${opt('field', ARENAS.map((a) => [a.id, a.name]))}</div>
        <div class="pg-row" style="margin-top:6px"><span class="pg-lab">Your help</span>${[['auto', '🤖 Automatic'], ['easy', '🙂 Easy'], ['pro', '🎮 Pro']].map(([id, label]) => `<button data-warassist="${id}" class="${warAssist === id ? 'pg-on' : ''}">${label}</button>`).join('')}</div>
        <div class="pg-row" style="margin-top:6px"><span class="pg-lab">Realism</span><button data-waroverg class="${warOverG ? 'pg-on' : ''}">Over-G effects: ${warOverG ? 'On' : 'Off'}</button><span class="pg-hint">Local setting; Battle wings remain sturdy.</span></div>
        <div class="pg-hint" style="margin-top:4px">Co-op: everyone is on one side against the computer. Fight: players shoot each other, first to ${FIGHT_WIN_KILLS} kills wins (if the enemies are on they shoot everyone). Everyone plays the same battlefield and the same enemies.</div>`;
    }
    let joinDraft = '';
    /// The room code everyone on the same Wi-Fi (the same public address) gets, from the licence server; null until it answers (or if it cannot).
    let wifiCode = null, wifiTried = false;
    function loadWifiCode() {
      if (wifiTried) return; wifiTried = true;
      skyFetch('/plane/net').then((j) => { const c = j && NET.normCode(j.code); if (c) { wifiCode = c; if (!joinDraft) joinDraft = c; if (screen === 'menu' && !netg) renderUI(); } });
    }
    let warPlay = read('warplay', 'online');
    if (warPlay !== 'single') warPlay = 'online';
    /// Open games anyone can drop into: one room per battlefield, so players on the same field meet.
    // One open room for everybody (the battlefield is whatever the host chose; vote with U to change it). Older versions used one room per
    // battlefield, which split friends who had picked different fields.
    const PUBLIC_ROOMS = { plains: 'PUBGRN', dunes: 'PUBSND', island: 'PUBSEA' };
    const isOpenRoom = () => !!netg && Object.values(PUBLIC_ROOMS).includes(netg.code);      // the open game: everyone is on one team
    /// Start a Battle: find an open game and join the wave being played, or open one if nobody is there. Single player opens
    /// your own room (with its code on screen) that others can still join at any time.
    /// No internet (or the room server cannot be reached): Battle does not need it. Play a solo Battle on this computer instead.
    function warOfflineStart() {
      if (netg) netLeave(true);
      toast('No connection: playing a solo Battle on this computer', 3200);
      start();
    }
    function warAutoStart() {
      if (navigator.onLine === false) { warOfflineStart(); return; }
      const nm = (playerName || '').trim();
      if (!nm) { toast('Type your name first so the others know who you are', 2400); ui.querySelector('[data-warname]')?.focus(); return; }
      if (warPlay === 'single') { netOpen('host', NET.newCode()); netg.autoStart = true; }
      else { warSide = 'coop'; write('warside', 'coop'); netOpen('client', PUBLIC_ROOMS.plains); netg.autoJoin = true; }       // an open game starts as Co-op: everyone on one team
      renderUI();
    }
    function onStartPress(a) {
      if (mode.id === 'war' && netg && screen === 'menu') { if (netg.role === 'host') netHostStart(); return; }
      if (mode.id === 'war' && !netg && screen === 'menu' && !(war && war.net)) { warAutoStart(); return; }
      if (war && war.net) {
        if (war.net.role === 'host') { netg.running = false; netHostStart(); }
        else if (a === 'again' && screen === 'result') { screen = 'menu'; renderUI(); }
        else toast('Only the host can start it again', 1800);
        return;
      }
      start();
    }
    function renderUIInner() {
      if (screen === 'fly') {
        ui.innerHTML = paused ? `<div class="pg-pause"><div class="pg-menu" style="width:auto;text-align:center"><h1 style="justify-content:center">Paused</h1>
          <div class="pg-row" style="justify-content:center;margin-top:8px"><button data-a="resume" class="pg-go">Resume (P)</button><button data-a="restart">${mode.id === 'war' && war ? 'Respawn (R)' : 'Restart (R)'}</button><button data-a="menu">Menu</button></div></div></div>` : '';
        bind(); return;
      }
      if (screen === 'result') {
        const r = result, m = mode;
        const board = read(`board.${m.id}`, []);
        ui.innerHTML = `<div class="pg-menu pg-result">
          <h1 style="justify-content:center">${r.kind === 'crash' ? '💥 Crashed' : m.id === 'trial' ? '🏁 Finished' : m.id === 'landing' ? '🛬 Landed' : '🎉 Time!'}</h1>
          <div class="pg-hint">${r.label}</div>
          ${r.report ? `<div class="pg-report ${/^Not/.test(r.report.surv) ? 'pg-bad' : /^Barely/.test(r.report.surv) ? 'pg-warn' : 'pg-ok'}"><b>${r.report.surv}</b>${r.report.lines.map((l) => `<div>${l}</div>`).join('')}</div>` : ''}
          ${r.value != null && m.id !== 'free' ? `<div class="pg-big">${fmtScore(m, r.value)}${m.id === 'hoops' ? ' <span style="font-size:16px">hoops</span>' : m.id === 'landing' ? ' <span style="font-size:16px">points</span>' : ''}</div>` : ''}
          ${r.qualifies ? `<div class="pg-row" style="justify-content:center;margin:6px 0">🏆 New leaderboard score! <input maxlength="16" placeholder="Your name" value="${escapeHtml(playerName)}"><label class="pg-hint" style="display:flex;align-items:center;gap:4px"><input type="checkbox" id="pg-world" ${shareWorld ? 'checked' : ''}>🌍 world board</label><button data-a="save" class="pg-go" style="padding:5px 12px;font-size:12px">Save</button></div>` : ''}
          ${!r.qualifies && !r.posted && m.id !== 'free' && r.value >= 1 ? `<div class="pg-row" style="justify-content:center;margin:6px 0"><input maxlength="16" placeholder="Your name" value="${escapeHtml(playerName)}"><button data-a="post" style="padding:5px 12px;font-size:12px">🌍 Post to the world board</button></div>` : ''}
          ${r.saved ? `<div class="pg-hint">Saved at #${r.rank} on the ${m.name} leaderboard.</div>` : ''}
          ${r.posted === 'sending' ? '<div class="pg-hint">Posting to the world board…</div>' : r.posted === 'done' ? `<div class="pg-hint">🌍 On the world board${r.worldRank ? ` at #${r.worldRank}` : ''}.</div>` : r.posted === 'failed' ? `<div class="pg-hint" style="color:#ffb347">${escapeHtml(r.worldError || 'Could not post.')}</div>` : ''}
          ${prace && prace.racing && m.id === 'trial' ? praceTable() : ''}
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
        const setupHtml = `<h2>1 · Pick your plane <small style="font-weight:500;opacity:.6">${PLANES.length} aircraft · scroll for more</small></h2><div class="pg-planewrap"><div class="pg-planes">${CATS.map(([cid, cname]) => `<div class="pg-cat">${cname}</div>${PLANES.filter((p) => p.cat === cid).map((p) => `<div class="pg-card ${p === plane ? 'pg-on' : ''}" data-plane="${p.id}" title="${p.blurb.replace(/"/g, '&quot;')}">
            <b>${p.name}</b><i>${p.kind}</i>${statBar('Speed', p.max / 300)}${statBar('Agility', p.roll / 4.2)}${statBar('Easy', (p.stability - 1.5) / 1.2)}</div>`).join('')}`).join('')}</div></div>
          <div class="pg-hint" style="margin-top:4px"><b>${plane.name}</b> · ${plane.blurb}</div>
          <h2>2 · Where in the world?</h2><div class="pg-row"><select data-region>${REGIONS.map((x) => `<option value="${x.id}" ${x.id === regionId ? 'selected' : ''}>${x.id ? x.name + ' · ' + x.lm : '🏔️ Home valley'}</option>`).join('')}</select>
            <button data-a="mine" title="Pick the scenery nearest to where you are">📍 My location</button>
            <input data-place maxlength="40" placeholder="Type a city or country" style="width:150px"><button data-a="goplace">Go</button></div>
          <div class="pg-hint" style="margin-top:3px">${escapeHtml(placeNote || `Now flying over: ${regionOf(regionId).id ? regionOf(regionId).name + ' (' + regionOf(regionId).lm + ')' : 'the home valley'}. The landmark stands just off the runway.`)}</div>
          <h2>3 · Start at <small style="font-weight:500;opacity:.6">for Free Flight</small></h2>
          <div class="pg-row" style="gap:5px;flex-wrap:wrap"><button data-start="auto" class="${startAt === 'auto' ? 'pg-on' : ''}" title="The home runway">Automatic</button>${STARTS.filter((x) => !x.gate).map((x) => `<button data-start="${x.id}" class="${startAt === x.id ? 'pg-on' : ''}">${x.name}</button>`).join('')}</div>
          <div class="pg-row" style="margin-top:8px"><button data-share class="${shareOn ? 'pg-on' : ''}" title="See other Notch pilots who have this on: your callsign, aircraft and position are sent while you fly">Fly with others: ${shareOn ? 'On' : 'Off'}</button><button data-clean class="${coldStart ? 'pg-on' : ''}" title="Start on the runway with the battery, beacon and engine off, and do the whole start-up yourself with the keys (Y battery, O beacon, I engine)">Clean start: ${coldStart ? 'On' : 'Off'}</button><button data-traffic class="${trafficOn ? 'pg-on' : ''}" title="Other aircraft cross the sky; you can pass them, hear a traffic call, or hit them">AI traffic: ${trafficOn ? 'On' : 'Off'}</button><span class="pg-hint">Other aircraft in the sky: a mid-air collision brings both down.</span></div>
          <div class="pg-hint" style="margin:2px 0 6px">Clean start: you spawn on the runway with everything off and run the whole start-up from the checklist on screen (<kbd>Y</kbd> battery, <kbd>O</kbd> beacon, <kbd>S</kbd> throttle idle, <kbd>I</kbd> engine, <kbd>F</kbd> flaps, <kbd>G</kbd> gear). Off, you spawn ready to roll.</div>
          <div class="pg-hint" style="margin:2px 0 6px">Fly with others sends your callsign (your leaderboard name), aircraft and position to the other pilots who switched it on, every couple of seconds while you fly. It is off until you turn it on, uses a random id (no account) and other pilots cannot be hit.</div>
          ${weatherPanel()}
`;
        const modesHtml = `<h2>What do you want to play?</h2><div class="pg-modes">${MODES.map((m) => `<button class="pg-mode ${m === mode ? 'pg-on' : ''}" data-mode="${m.id}">${m.icon} ${m.name}<small>${m.desc}</small></button>`).join('')}</div>`;
        body = modesHtml + (mode.id === 'trial' ? praceHtml() : '') + (mode.id === 'war' ? battleHtml() : setupHtml) + (read('howseen_' + mode.id, false) && !howOpen ? `          <div class="pg-row" style="margin-top:8px"><button data-howtoggle>❓ How to play ${mode.name}</button></div>` : `          <div class="pg-howto"><div class="pg-ctitle">How to play ${mode.name}${read('howseen_' + mode.id, false) ? ' <button data-howtoggle style="float:right;font-size:11px">Hide</button>' : ''}</div>${ctlHtml(mode.id, true)}<div class="pg-hint" style="margin-top:5px">During a flight, press <kbd>?</kbd> or click the round <b>?</b> button to see this again, with what each control does.</div></div>`) + `
          <div class="pg-row" style="margin-top:10px">${mode.id === 'war' && netg && netg.role === 'client' ? '<span class="pg-hint">Waiting for the host to start…</span>' : `<button class="pg-go" data-a="start">${mode.id === 'war' ? (netg ? '⚔️ Start the battle for everyone (Enter)' : '⚔️ Start the battle (Enter)') : '✈️ Take off (Enter)'}</button>`}
            ${(document.fullscreenEnabled || document.webkitFullscreenEnabled) ? '<button data-a="fullscreen" title="Open the Plane game edge to edge. Press Escape or F11 to leave">⛶ Full screen (F11)</button>' : ''}
            <span class="pg-hint">Best: ${(() => { const b = read(`board.${mode.id}`, [])[0]; return b && mode.id !== 'free' ? `${fmtScore(mode, b.score)} by ${escapeHtml(b.name)}` : '—'; })()}</span></div>`;
      } else if (menuTab === 'board') {
        const scopes = `<div class="pg-row"><button data-scope="local" class="${boardScope === 'local' ? 'pg-on' : ''}">This computer</button><button data-scope="world" class="${boardScope === 'world' ? 'pg-on' : ''}">🌍 World</button>${boardScope === 'world' ? `<button data-period="all" class="${boardPeriod === 'all' ? 'pg-on' : ''}">All time</button><button data-period="week" class="${boardPeriod === 'week' ? 'pg-on' : ''}">This week</button>` : ''}</div>`;
        if (boardScope === 'world') {
          const parts = MODES.filter((m) => m.id !== 'free').map((m) => {
            const c = worldCache[`${m.id}|${boardPeriod}`];
            if (!c) { loadWorld(m.id, boardPeriod).then(() => { if (screen === 'menu' && menuTab === 'board' && boardScope === 'world') renderUI(); }); return `<h2>${m.icon} ${m.name}</h2><div class="pg-hint">Loading the world board…</div>`; }
            if (c.error) return `<h2>${m.icon} ${m.name}</h2><div class="pg-hint" style="color:#ffb347">Couldn't reach the world board. Check your connection.</div>`;
            const rows = c.entries.slice(0, 10).map((e) => ({ ...e, date: new Date(e.at).toISOString().slice(0, 10) }));
            return `<h2>${m.icon} ${m.name}</h2>${rows.length ? table(m, rows, true) : '<div class="pg-hint">No scores yet. Be the first!</div>'}`;
          });
          body = scopes + parts.join('') + `<div class="pg-hint" style="margin-top:6px">Everyone who posts a score appears here: only a name, the plane and the score are sent. You choose when you save a score.</div>`;
        } else {
          body = scopes + MODES.filter((m) => m.id !== 'free').map((m) => { const b = read(`board.${m.id}`, []); return `<h2>${m.icon} ${m.name}</h2>${b.length ? table(m, b) : '<div class="pg-hint">No scores yet. Be the first!</div>'}`; }).join('')
            + '<div class="pg-row" style="margin-top:8px"><button data-a="clear">Clear leaderboards</button><span class="pg-hint">These scores are kept on this computer. The 🌍 World tab shows everyone\'s.</span></div>';
        }
      } else if (menuTab === 'ach') {
        body = `<h2>Challenges · ${[...done].filter((d) => CHALLENGES.some((c) => c.id === d)).length} / ${CHALLENGES.length}</h2><div class="pg-ach">${CHALLENGES.map((c) => `<div class="${done.has(c.id) ? 'pg-done' : ''}">${done.has(c.id) ? '🏅' : '🔒'} ${c.name} <small>${c.desc}</small></div>`).join('')}</div>`;
      } else {
        const climb = invert ? 'down' : 'up';
        const hm = MODES.some((m) => m.id === helpMode) ? helpMode : mode.id;
        body = `<h2>Controls for each game mode</h2><div class="pg-chips">${MODES.map((m) => `<button data-ctlmode="${m.id}" class="${m.id === hm ? 'pg-on' : ''}">${m.icon} ${m.name}</button>`).join('')}</div><div class="pg-howto" style="margin-top:0">${ctlHtml(hm, false)}</div>
          <h2>Mouse steering ${mouseOn ? '' : '(off)'}</h2><div class="pg-hint">Move the cursor into the ring in the middle of the view to take control. Then move it
          <b>left / right</b> to roll into a bank and turn, and <b>${climb}</b> to climb (the other way to dive). The edge of the ring is full stick, so small moves are enough;
          bring it back to the middle to fly straight. Let go of everything and the wings roll back to level. Leaving the game view lets go.
          Higher sensitivity makes the ring smaller.</div>
          <div class="pg-row" style="margin-top:6px"><label class="pg-hint">Sensitivity <input type="range" min="0.3" max="2.5" step="0.1" value="${sens}" data-range="sens" style="width:170px;padding:0"> <b data-sensval>${Number(sens).toFixed(1)}×</b></label>
          <button data-a="mouse">${mouseOn ? '✓ ' : ''}Mouse steering</button>
          <button data-a="invert">${invert ? '✓ ' : ''}Invert (down climbs, like a flight stick)</button></div>
          <h2>Every key</h2><div class="pg-hint">
          <kbd>W</kbd> more throttle · <kbd>S</kbd> less throttle · <kbd>↑</kbd> climb · <kbd>↓</kbd> dive · <kbd>←</kbd> <kbd>→</kbd> roll · <kbd>A</kbd> <kbd>D</kbd> rudder (and steering on the ground)<br>
          <kbd>F</kbd> flaps down a notch · <kbd>V</kbd> flaps up · <kbd>H</kbd> helicopter emergency landing (levels it and sets it down gently; <kbd>H</kbd> again to take over) · <kbd>Y</kbd> battery · <kbd>O</kbd> beacon · <kbd>I</kbd> start the engine (Clean start) · <kbd>T</kbd> checklist · <kbd>K</kbd> autopilot (<kbd>,</kbd> <kbd>.</kbd> heading, <kbd>[</kbd> <kbd>]</kbd> height) · <kbd>J</kbd> ILS approach · <kbd>G</kbd> gear up / down (everything but the Cessna, Piper and Cirrus, which have fixed wheels) · <kbd>Space</kbd> brakes / airbrake (with <kbd>A</kbd> <kbd>D</kbd> at taxi speed it brakes the wheel on that side; the airliners dump their spoilers on touchdown) · <kbd>X</kbd> reverse thrust on the ground (jets and turboprops, with the throttle up) · <kbd>C</kbd> camera (chase, cockpit, orbit) · <kbd>P</kbd> pause (and the menu) · <kbd>R</kbd> restart · <kbd>M</kbd> mouse steering on / off</div>
          <h2>Tips</h2><div class="pg-hint">Bank by moving the cursor sideways and ease it ${climb} to turn: the wings turn the plane, the rudder only tidies up. Too slow or pulling too hard
          stalls the wing (STALL): push the nose down and add power. To land: slow down, flaps down, gear down (airliners), line up with the runway, and touch down gently (watch V/S).
          To take off: full throttle (hold W) on the runway, then ease the cursor ${climb} (or hold ${invert ? "↓" : "↑"}) at about ${Math.round(plane.stall * 1.3 * 3.6)} km/h. Airliners turn slowly, so start turns early.</div>
          <h2>Settings</h2><div class="pg-row">
          <button data-a="sound">${sound ? '🔊 Sound on' : '🔇 Sound off'}</button>
          <button data-a="atc" title="Spoken air traffic control: take-off, approach and landing clearances">${atcOn ? '✓ ' : ''}ATC voice</button>
          <button data-a="tcas" title="Spoken traffic calls (Traffic, traffic, traffic) when another aircraft closes in; on by default">${tcasOn ? '✓ ' : ''}TCAS traffic calls</button>
          <button data-a="gpws" title="Spoken ground proximity warnings and radio-altimeter calls on the airliners">${gpwsOn ? '✓ ' : ''}GPWS voice (airliners)</button>
          <button data-a="units">${units === 'kmh' ? 'km/h · m' : 'knots · feet'}</button>
          <button data-a="failures">Failures: ${failures === 'off' ? 'off' : failures === 'often' ? 'often (every mode)' : 'rare (Free Flight, Landing)'}</button></div>
          <h2>GPWS (airliners)</h2><div class="pg-hint">Like a real cockpit, the airliners speak: <b>One hundred knots, V one, Rotate, Positive rate</b> on take-off; <b>One thousand, Five hundred, Approaching minimums,
          Minimums, One hundred, Fifty, Forty, Thirty, Twenty, Ten</b> and <b>Retard</b> on the way down with the gear down; and warnings: <b>Sink rate</b>, <b>Terrain, terrain</b> and <b>Pull up</b>, <b>Too low, gear</b>, <b>Too low, terrain</b>,
          <b>Too low, flaps</b>, <b>Glideslope</b> (below the 3° path to the runway) and <b>Bank angle</b>. They use your computer's own voice, and show on the panel too. The Hoop Rush and Time Trial challenges skip the warnings. The light planes stay quiet, and the fighter only says <b>Pull up</b>.</div>
          <h2>Damage</h2><div class="pg-hint">Clip a tree, a building or the ground with a wingtip and that wing tears off: the plane rolls hard towards the stump.
          Keep the nose down near the runway: past your aircraft's limit (about 14° in the Cessna, 10° in a 747) the tail scrapes, which damages it and weakens the elevator, and a hard enough scrape breaks it off. Watch the fuel gauge too. Hit something with the nose or tail, or the ground too hard, and it breaks up. Too fast and the wings come off; pulling far too hard snaps one.
          A hard landing can collapse the undercarriage into a belly slide. With failures on, the engine can quit (glide to a field) or run rough after a bird strike.</div>`;
      }
      ui.innerHTML = `<div class="pg-menu pg-side"><div class="pg-row"><h1>✈️ Plane</h1><div class="pg-tabs">${tabs.map(([id, n]) => `<button data-tab="${id}" class="${id === menuTab ? 'pg-on' : ''}">${n}</button>`).join('')}</div></div>${body}</div>`;
      bind();
      { const sel = ui.querySelector('.pg-card.pg-on'), wr = ui.querySelector('.pg-planewrap'); if (sel && wr) wr.scrollTop = Math.max(0, sel.offsetTop - 70); }   // show the chosen plane
    }
    const escapeHtml = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    function table(m, rows, world = false) {
      return `<table><tr><th>#</th><th>Pilot</th><th>Plane</th><th style="text-align:right">${m.id === 'trial' ? 'Time' : m.id === 'hoops' ? 'Hoops' : 'Points'}</th><th>Date</th></tr>${rows.map((e, i) => `<tr${world && playerName && e.name === playerName ? ' style="background:rgba(255,179,71,.18)"' : ''}><td>${i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : i + 1}</td><td>${escapeHtml(e.name)}</td><td>${escapeHtml(e.plane)}</td><td class="pg-n">${fmtScore(m, e.score)}</td><td>${e.date}</td></tr>`).join('')}</table>`;
    }
    function bind() {
      ui.querySelectorAll('[data-plane]').forEach((n) => n.onclick = () => { plane = PLANES.find((p) => p.id === n.dataset.plane); write('plane', plane.id); flight = new Flight(plane);
        const sc = ui.querySelector('.pg-planewrap')?.scrollTop || 0; renderUI(); const wrap = ui.querySelector('.pg-planewrap'); if (wrap) wrap.scrollTop = sc; });
      ui.querySelectorAll('[data-range]').forEach((n) => {
        n.oninput = () => { sens = Number(n.value); write('sens', sens); const v = ui.querySelector('[data-sensval]'); if (v) v.textContent = `${sens.toFixed(1)}×`; };
        n.onchange = () => root.focus();
      });
      // Weather panel: the sliders update the text as they move and save on release; the buttons redraw the menu.
      ui.querySelectorAll('[data-warcity]').forEach((n) => { n.oninput = () => { warCity = n.value.replace(/[<>]/g, '').trim().slice(0, 20); write('warcity', warCity); }; });
      ui.querySelectorAll('[data-wx]').forEach((n) => {
        n.oninput = () => {
          const v = Number(n.value);
          if (n.dataset.wx === 'cross') { WX.crossKt = (WX.crossKt < 0 ? -1 : 1) * v; const e = ui.querySelector('[data-wxv=cross]'); if (e) e.textContent = `${v} kt (${(v * KT).toFixed(0)} m/s)`; }
          else { WX.headKt = v; const e = ui.querySelector('[data-wxv=head]'); if (e) e.textContent = v === 0 ? '0 kt' : `${Math.abs(v)} kt ${v > 0 ? 'head' : 'tail'}`; }
          const t = ui.querySelector('[data-wxsum]'); if (t) t.textContent = wxText();
          saveWx();
        };
        n.onchange = () => { renderUI(); root.focus(); };
      });
      ui.querySelectorAll('[data-wxs]').forEach((n) => n.onclick = () => { const m = Math.abs(WX.crossKt) || 0; WX.crossKt = n.dataset.wxs === 'L' ? -m : m; saveWx(); renderUI(); });
      ui.querySelectorAll('[data-tod]').forEach((n) => n.onclick = () => { applyEnv(n.dataset.tod, ENV.vis); write('env', { tod: ENV.tod, vis: ENV.vis }); renderUI(); });
      ui.querySelectorAll('[data-vis]').forEach((n) => n.onclick = () => { applyEnv(ENV.tod, n.dataset.vis); write('env', { tod: ENV.tod, vis: ENV.vis }); renderUI(); });
      ui.querySelectorAll('[data-wxt]').forEach((n) => n.onclick = () => { WX.turb = n.dataset.wxt; saveWx(); renderUI(); });
      ui.querySelectorAll('[data-clean]').forEach((n) => n.onclick = () => { coldStart = !coldStart; write('cold', coldStart); renderUI(); });
      ui.querySelectorAll('[data-share]').forEach((n) => n.onclick = () => {
        shareOn = !shareOn; write('share', shareOn); if (!shareOn) skyLeave(); else { skyOff = false; skyFails = 0; skyT = 0; skyFetch('/plane/sky/count').then((c) => { if (c) { skyPilots = c.pilots; toast(`${c.pilots} pilot${c.pilots === 1 ? '' : 's'} flying with others right now`, 2200); } }); }
        renderUI();
      });
      ui.querySelectorAll('[data-traffic]').forEach((n) => n.onclick = () => { trafficOn = !trafficOn; write('traffic', trafficOn); renderUI(); });
      ui.querySelectorAll('[data-start]').forEach((n) => n.onclick = () => { startAt = n.dataset.start; write('startAt', startAt); renderUI(); });
      ui.querySelectorAll('[data-wxp]').forEach((n) => n.onclick = () => {
        const p = WX_PRESETS.find((x) => x[0] === n.dataset.wxp); if (!p) return;
        const keepSide = WX.crossKt < 0 ? -1 : 1;   // presets keep the side you chose; Random leaves the sliders where they were
        WX = p[2].random ? { ...WX, random: true } : { ...p[2], crossKt: p[2].crossKt * keepSide }; saveWx(); renderUI();
      });
      ui.querySelectorAll('[data-scope]').forEach((n) => n.onclick = () => { boardScope = n.dataset.scope; write('boardScope', boardScope); renderUI(); });
      ui.querySelectorAll('[data-period]').forEach((n) => n.onclick = () => { boardPeriod = n.dataset.period; write('boardPeriod', boardPeriod); renderUI(); });
      ui.querySelectorAll('[data-region]').forEach((n) => n.onchange = () => { placeNote = ''; setRegion(n.value); renderUI(); });
      const goPlace = async (fn) => {
        placeNote = 'Looking…'; renderUI();
        try { const reg = await fn(); setRegion(reg.id); } catch { placeNote = 'Could not find that place. Try a city, a country, or pick one from the list.'; }
        renderUI();
      };
      ui.querySelectorAll('[data-place]').forEach((n) => n.onkeydown = (e) => { e.stopPropagation(); if (e.key === 'Enter') { const v = n.value.trim(); if (v) goPlace(() => lookupPlace(v)); } });
      ui.querySelectorAll('[data-warveh]').forEach((n) => n.onclick = () => { warVeh = n.dataset.warveh; write('warveh', warVeh); if (netg) { if (netg.role === 'host') netSendLobby(); else netHello(); } renderUI(); });
      ui.querySelectorAll('[data-howtoggle]').forEach((n) => n.onclick = () => { howOpen = !howOpen; renderUI(); });
      ui.querySelectorAll('[data-warname]').forEach((n) => { n.oninput = () => { playerName = n.value.trim().slice(0, 14); write('name', playerName); }; n.onkeydown = (e) => { e.stopPropagation(); if (e.key === 'Enter') onStartPress('start'); }; });
      ui.querySelectorAll('[data-warplay]').forEach((n) => n.onclick = () => { warPlay = n.dataset.warplay; write('warplay', warPlay); renderUI(); });
      ui.querySelectorAll('[data-nethost]').forEach((n) => n.onclick = () => { netOpen('host', wifiCode || NET.newCode()); if (wifiCode && netg) netg.wifi = true; renderUI(); });
      ui.querySelectorAll('[data-netjoin]').forEach((n) => n.onclick = () => { const input = ui.querySelector('[data-netcode]'), c = NET.normCode(input && input.value); if (!c) { toast('A room code is 6 letters and numbers', 2200); return; } joinDraft = ''; netOpen('client', c); renderUI(); });
      ui.querySelectorAll('[data-netcode]').forEach((n) => { n.oninput = () => { joinDraft = n.value.toUpperCase(); }; n.onkeydown = (e) => { e.stopPropagation(); if (e.key === 'Enter') ui.querySelector('[data-netjoin]')?.click(); }; });
      ui.querySelectorAll('[data-netleave]').forEach((n) => n.onclick = () => { netLeave(true); renderUI(); });
      ui.querySelectorAll('[data-netset]').forEach((n) => n.onclick = () => { const [key, raw] = n.dataset.netset.split(':'), val = raw === 'true' ? true : raw === 'false' ? false : raw; if (netg.role === 'host') netHostSet(key, val); else netVoteCast(key, val); renderUI(); });
      ui.querySelectorAll('[data-warfield]').forEach((n) => n.onclick = () => { warField = n.dataset.warfield; write('warfield', warField); renderUI(); });
      ui.querySelectorAll('[data-warassist]').forEach((n) => n.onclick = () => { warAssist = n.dataset.warassist; write('warassist', warAssist); renderUI(); });
      ui.querySelectorAll('[data-waroverg]').forEach((n) => n.onclick = toggleWarOverG);
      ui.querySelectorAll('[data-warnpc]').forEach((n) => n.onclick = () => { warNpc = n.dataset.warnpc === 'on'; write('warnpc', warNpc); renderUI(); });
      ui.querySelectorAll('[data-warside]').forEach((n) => n.onclick = () => { warSide = n.dataset.warside; write('warside', warSide); renderUI(); });
      ui.querySelectorAll('[data-ctlmode]').forEach((n) => n.onclick = () => { helpMode = n.dataset.ctlmode; renderUI(); });
      ui.querySelectorAll('[data-wardiff]').forEach((n) => n.onclick = () => { warDiff = n.dataset.wardiff; write('wardiff', warDiff); renderUI(); });
      ui.querySelectorAll('[data-mode]').forEach((n) => n.onclick = () => {
        if (netg && n.dataset.mode !== 'war') netLeave(true); mode = MODES.find((m) => m.id === n.dataset.mode); write('mode', mode.id); renderUI(); });
      ui.querySelectorAll('[data-tab]').forEach((n) => n.onclick = () => { menuTab = n.dataset.tab; write('menuTab', menuTab); renderUI(); });
      ui.querySelectorAll('[data-a]').forEach((n) => n.onclick = () => {
        const a = n.dataset.a;
        if (a === 'restart' && mode.id === 'war' && war && screen === 'fly') { paused = false; renderUI(); warQuickRespawn(); root.focus(); }
        else if (a === 'start' || a === 'again' || a === 'restart') onStartPress(a);
        else if (a === 'prhost') { praceOpen(true); }
        else if (a === 'prjoin') { const c = NET.normCode(ui.querySelector('[data-prcode]')?.value); if (!c) toast('A race code is 6 letters and numbers', 2200); else praceOpen(false, c); }
        else if (a === 'prgo') { praceGo(); }
        else if (a === 'prleave') { praceLeave(); }
        else if (a === 'resume') { paused = false; renderUI(); root.focus(); unmuteAudio(); }
        else if (a === 'fullscreen') toggleFullscreen();
        else if (a === 'menu') { if (netg) netLeave(true); screen = 'menu'; paused = false; muteAudio(); restorePlane(); useBattlefield(''); flight = new Flight(plane); renderUI(); }
        else if (a === 'save') saveScore();
        else if (a === 'mine') goPlace(myPlace);
        else if (a === 'goplace') { const v = (ui.querySelector('[data-place]')?.value || '').trim(); if (v) goPlace(() => lookupPlace(v)); }
        else if (a === 'post') {
          const name = (ui.querySelector('input')?.value || playerName || 'Pilot').trim().slice(0, 16) || 'Pilot';
          playerName = name; write('name', name); shareWorld = true; write('shareWorld', true);
          postToWorld(name);
        }
        else if (a === 'invert') { invert = !invert; write('invertY', invert); renderUI(); }
        else if (a === 'atc') { atcOn = !atcOn; write('atc', atcOn); if (!atcOn) cancelSpeech(); renderUI(); }
        else if (a === 'tcas') { tcasOn = !tcasOn; write('tcas', tcasOn); if (!tcasOn) cancelSpeech(); renderUI(); }
        else if (a === 'gpws') { gpwsOn = !gpwsOn; write('gpws', gpwsOn); if (!gpwsOn) cancelSpeech(); renderUI(); }
        else if (a === 'mouse') { mouseOn = !mouseOn; write('mouse', mouseOn); renderUI(); }
        else if (a === 'sound') { sound = !sound; write('sound', sound); if (typeof window.NotchHostSound === 'boolean') window.NotchHostSound = sound; if (sound) unmuteAudio(); else muteAudio(true); renderUI(); }
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
        // Smoke is carried along by the wind as it rises: a leaning column.
        if (def.drift) { const k = Math.min(1, dt * 2.5), wv = flight.wv; p.v[0] += (wv[0] * def.drift - p.v[0]) * k; p.v[2] += (wv[2] * def.drift - p.v[2]) * k; }
        p.p = add(p.p, mul(p.v, dt));
        const g = groundAt(W, p.p[0], p.p[2]);
        if (p.p[1] < g) { p.p[1] = g; p.v = mul(p.v, 0.3); }
      }
      for (let i = smoke.length - 1; i >= 0; i--) if (smoke[i].t > smoke[i].life) smoke.splice(i, 1);
    }
    /// Broken-off sections are boxes: gravity, air drag, tumbling, and each corner of the box meeting the ground with an
    /// impulse (bounce that depends on how hard it lands, friction that scrubs off the slide and the spin), until it rests.
    /// In water it floats, more or less, and slowly goes down. Small chunks are simple tumbling bits.
    const SLIDE_MU = { runway: 0.5, road: 0.5, grass: 0.6, forest: 0.7, sand: 0.75, snow: 0.3, rock: 0.6 };
    function stepGroup(d, dt) {
      const sp = len(d.vel);
      d.vel[1] -= G * dt;
      d.vel = mul(d.vel, 1 - Math.min(0.5, d.drag * sp * dt));
      d.pos[0] += d.vel[0] * dt; d.pos[1] += d.vel[1] * dt; d.pos[2] += d.vel[2] * dt;
      const wl = len(d.w);
      if (wl * dt > 1e-6) d.q = qnorm(qmul(qaxis(mul(d.w, 1 / wl), wl * dt), d.q));
      const water = overWater(W, d.pos[0], d.pos[2]), g = water ? WATER : groundAt(W, d.pos[0], d.pos[2]);
      if (d.pos[1] - d.rad > g + 0.3) return;
      if (water) {
        if (d.pos[1] - d.rad * 0.6 > WATER) return;
        if (!d.wetT && d.vel[1] < -4) for (let i = 0; i < 8; i++) puff('spray', [d.pos[0], WATER + 0.3, d.pos[2]], [(Math.random() - 0.5) * 8, 4 + Math.random() * 6, (Math.random() - 0.5) * 8]);
        d.wetT += dt; d.fire = 0;
        const fl = d.float * Math.max(0.15, 1 - d.wetT * (d.key === 'F' || d.key === 'N' ? 0.03 : 0.012)), sub = clamp((WATER - (d.pos[1] - d.he[1])) / (2 * d.he[1] + 0.2), 0, 1);
        d.vel[1] += G * 1.9 * fl * sub * dt; const k = Math.min(1, dt * 1.6);
        d.vel[0] *= 1 - k; d.vel[2] *= 1 - k; d.vel[1] *= 1 - k * 0.7; d.w = mul(d.w, 1 - k);
        if (len(d.vel) > 3 && Math.random() < dt * 8) puff('foam', [d.pos[0], WATER + 0.2, d.pos[2]], jitter(1));
        if (d.pos[1] < WATER - 8) d.rest = true;
        return;
      }
      const ax = qrot(d.q, [1, 0, 0]), ay = qrot(d.q, [0, 1, 0]), az = qrot(d.q, [0, 0, 1]), hx = d.he[0], hy = d.he[1], hz = d.he[2];
      const iX = 3 / (hy * hy + hz * hz), iY = 3 / (hx * hx + hz * hz), iZ = 3 / (hx * hx + hy * hy);   // inverse inertia (unit mass box)
      const mu = SLIDE_MU[surfaceAt(W, d.pos[0], d.pos[2])] || 0.55;
      let deepest = 0, touch = false, hit = 0, slide = 0, hitAt = null;
      for (let pass = 0; pass < 2; pass++) for (let c = 0; c < 8; c++) {
        const sx = c & 1 ? 1 : -1, sy = c & 2 ? 1 : -1, sz = c & 4 ? 1 : -1;
        const rx = ax[0] * sx * hx + ay[0] * sy * hy + az[0] * sz * hz, ry = ax[1] * sx * hx + ay[1] * sy * hy + az[1] * sz * hz, rz = ax[2] * sx * hx + ay[2] * sy * hy + az[2] * sz * hz;
        const pen = g - (d.pos[1] + ry);
        if (pen <= 0) continue;
        touch = true; if (pass === 0 && pen > deepest) deepest = pen;
        const vx = d.vel[0] + d.w[1] * rz - d.w[2] * ry, vy = d.vel[1] + d.w[2] * rx - d.w[0] * rz, vz = d.vel[2] + d.w[0] * ry - d.w[1] * rx;
        if (vy >= 0) continue;
        // inverse-inertia applied to a vector u (world), through the box's own axes
        const invI = (ux, uy, uz) => {
          const a = (ax[0] * ux + ax[1] * uy + ax[2] * uz) * iX, b = (ay[0] * ux + ay[1] * uy + ay[2] * uz) * iY, cc = (az[0] * ux + az[1] * uy + az[2] * uz) * iZ;
          return [ax[0] * a + ay[0] * b + az[0] * cc, ax[1] * a + ay[1] * b + az[1] * cc, ax[2] * a + ay[2] * b + az[2] * cc];
        };
        const a1 = invI(-rz, 0, rx), den = 1 + a1[2] * rx - a1[0] * rz;
        const e = vy < -4 ? 0.3 : vy < -1.5 ? 0.12 : 0, jn = -(1 + e) * vy / den;
        d.vel[1] += jn; d.w[0] += a1[0] * jn; d.w[1] += a1[1] * jn; d.w[2] += a1[2] * jn;
        if (jn > hit) { hit = jn; hitAt = [d.pos[0] + rx, g, d.pos[2] + rz]; }
        const vt = Math.hypot(vx, vz);
        if (vt > 0.02) {
          const tx = vx / vt, tz = vz / vt, b1 = invI(ry * tz, rz * tx - rx * tz, -ry * tx);
          const denT = 1 + (b1[1] * rz - b1[2] * ry) * tx + (b1[0] * ry - b1[1] * rx) * tz;
          const jt = Math.min(mu * jn, vt / denT);
          d.vel[0] -= tx * jt; d.vel[2] -= tz * jt; d.w[0] -= b1[0] * jt; d.w[1] -= b1[1] * jt; d.w[2] -= b1[2] * jt;
          if (vt > slide) { slide = vt; if (!hitAt) hitAt = [d.pos[0] + rx, g, d.pos[2] + rz]; }
        }
      }
      if (deepest > 0) d.pos[1] += deepest;
      if (touch) {
        d.w = mul(d.w, 1 - Math.min(0.4, dt * 0.8));
        if (hit > 2.5 && debrisSndT <= 0) { debrisSndT = 0.1; impactSound(hit * hit * 0.5, false); shakeKick = Math.max(shakeKick, clamp(hit / 40, 0, 0.5) * clamp(40 / (len(sub(d.pos, flight.pos)) + 20), 0.2, 1)); for (let i = 0; i < 4; i++) puff('dust', hitAt, [(Math.random() - 0.5) * 6, 1 + Math.random() * 3, (Math.random() - 0.5) * 6]); for (let i = 0; i < 4; i++) puff('spark', hitAt, add(mul(d.vel, 0.4), jitter(8))); }
        if (slide > 4 && hitAt && Math.random() < dt * 20) { puff('dust', hitAt, add(mul(d.vel, 0.1), jitter(2))); if (Math.random() < 0.4) puff('dirt', hitAt, [(Math.random() - 0.5) * 4, 2 + Math.random() * 3, (Math.random() - 0.5) * 4]); if (slide > 12 && Math.random() < 0.4) puff('spark', hitAt, add(mul(d.vel, 0.3), jitter(6))); }
        if (len(d.vel) < 0.6 && len(d.w) < 0.5) { d.restT += dt; if (d.restT > 0.5) { d.rest = true; d.vel = v3(); d.w = v3(); } } else d.restT = 0;
      }
    }
    function stepDebris(dt) {
      const n = Math.max(1, Math.ceil(dt / (1 / 60))), h = dt / n;
      for (const d of debris) {
        if (d.fire > 0) {
          d.fire -= dt;
          const big = d.pieces ? 1 + len(d.he) * 0.15 : 1, crowd = smoke.length > 400 ? 0.4 : 1;
          if (Math.random() < dt * 14 * Math.min(2, big) * crowd) puff('fire', add(d.pos, jitter(3 * Math.min(2, big))), [0, 2, 0]);
          if (Math.random() < dt * 7 * crowd) puff('smoke', add(d.pos, jitter(3)), [0, 3, 0]);
        }
        if (d.rest) continue;
        if (d.pieces) { for (let i = 0; i < n; i++) { stepGroup(d, h); if (d.rest) break; } continue; }
        const sp = len(d.vel);
        d.vel[1] -= G * dt;
        d.vel = mul(d.vel, 1 - Math.min(0.5, 0.0025 * sp * dt));
        d.pos = add(d.pos, mul(d.vel, dt));
        const ang = len(d.w) * dt;
        if (ang > 1e-6) d.q = qnorm(qmul(d.q, qaxis(norm(d.w), ang)));
        const water = overWater(W, d.pos[0], d.pos[2]), g = groundAt(W, d.pos[0], d.pos[2]) + (d.chunk ? d.sc * 0.4 : 0.5) - d.sink;
        if (d.pos[1] < g) {
          const impact = -d.vel[1];
          d.pos[1] = g;
          if (water) {
            if (impact > 4 && debrisSndT <= 0) { debrisSndT = 0.08; for (let i = 0; i < 6; i++) puff('spray', d.pos, [(Math.random() - 0.5) * 8, 4 + Math.random() * 6, (Math.random() - 0.5) * 8]); }
            d.vel = [d.vel[0] * (1 - Math.min(1, 1.2 * dt)), 0, d.vel[2] * (1 - Math.min(1, 1.2 * dt))]; d.w = mul(d.w, 1 - Math.min(1, 1.5 * dt)); d.fire = 0;
            d.sink += dt * (d.chunk ? 0.5 : 0.12);
            if (Math.random() < dt * 2) puff('foam', [d.pos[0], WATER + 0.2, d.pos[2]], jitter(1));
          } else if (impact < 1.8) {
            d.vel[1] = 0; d.vel[0] *= 1 - Math.min(1, 2.2 * dt); d.vel[2] *= 1 - Math.min(1, 2.2 * dt); d.w = mul(d.w, 1 - Math.min(1, 3 * dt));
          } else {
            d.vel[1] = impact * 0.3; d.vel[0] *= 0.72; d.vel[2] *= 0.72; d.w = mul(d.w, 0.65);
            if (impact > 5 && debrisSndT <= 0) {
              debrisSndT = 0.1; noise(0.25, Math.min(0.3, impact * 0.015), 300);
              for (let i = 0; i < 4; i++) puff('dust', d.pos, [(Math.random() - 0.5) * 6, 1 + Math.random() * 3, (Math.random() - 0.5) * 6]);
              for (let i = 0; i < 4; i++) puff('spark', d.pos, add(mul(d.vel, 0.5), jitter(10)));
            }
          }
          if (len(d.vel) < 0.6 && len(d.w) < 0.5 && !water) { d.rest = true; d.vel = v3(); }
          if (d.sink > 6) d.rest = true;
        }
      }
      debrisSndT -= dt;
    }

    // ---- main loop
    /// The players voted to pause the round: the enemies, the shots and your own vehicle stand still.
    const netHold = () => !!(war && war.net && netg && netg.cfg && netg.cfg.paused);
    let raf = 0, last = performance.now(), alive = true, frameAvg = 0.016, slowFrames = 0;
    function frame(t) {
      // The app's Sound switch is the boss: follow it every frame, and never leave an audio engine alive while it is off.
      if (typeof window.NotchHostSound === 'boolean' && window.NotchHostSound !== sound) window.NotchPlaneGame.setSoundEnabled(window.NotchHostSound);
      if (!sound && ac) muteAudio(true);
      if (!alive || suspended) return;
      const raw = (t - last) / 1000, real = Math.min(0.1, raw); last = t;
      // A slow machine draws fewer pixels rather than flying in slow motion: after a second and a half of frames
      // slower than 24 fps the picture steps down (never back up, so it cannot flicker between sizes).
      frameAvg += (Math.min(raw, 0.25) - frameAvg) * 0.05;
      if (frameAvg > 0.042 && dprCap > 1) { slowFrames += raw; if (slowFrames > 1.5) { dprCap = Math.max(1, dprCap - 0.25); slowFrames = 0; frameAvg = 0.02; } } else slowFrames = 0;
      // The beat of slow motion at a big impact: 0.4x for a second or so, then back to full speed.
      if (slowT > 0) slowT -= real;
      duckT -= real; shakeKick *= Math.exp(-real * 2.5);
      const dt = real * (slowT > 0 ? (slowT > 0.25 ? 0.4 : 0.4 + 2.4 * (0.25 - slowT)) : 1);
      // Physics in small fixed steps so fast planes stay stable.
      const held = netHold();
      let left = held ? 0 : dt; while (left > 1e-4) { const h = Math.min(left, 1 / 120); update(h); left -= h; }
      // Behind the result panel a wreck that has not quite stopped (still sliding, or sinking) carries on.
      if (screen === 'result' && flight.crashed && !flight.rest && !paused) {
        left = dt; while (left > 1e-4) { const h = Math.min(left, 1 / 120); flight.step(h, ZERO_CTL, W); left -= h; }
        flight.events.length = 0;
      }
      if (!paused) { wreckFx(dt); stepParticles(dt); stepDebris(dt); }
      render(t);
      raf = requestAnimationFrame(frame);
    }
    renderUI();
    raf = requestAnimationFrame(frame);
    root.focus();
    // For tests: the live flight state.
    // Setting the game aside (the notch closes, another tab opens) and bringing it back: the flight is kept exactly as it was.
    // It is paused so nothing happens while you are away, the drawing stops and the sound is muted.
    let suspended = false;
    let bgTimer = 0, bgLast = 0;
    /// In a shared battle the game keeps running while the notch is closed (drawing stops, sound is muted): the others are still
    /// playing. Players can vote to pause the round.
    function bgStep() {
      const now = performance.now(), dt = Math.min(1.5, (now - bgLast) / 1000); bgLast = now;
      if (!alive || !(war && war.net) || netHold()) return;
      let left = dt; while (left > 1e-4) { const h = Math.min(left, 1 / 60); update(h); left -= h; }
    }
    function suspendGame() {
      if (suspended || !alive) return;
      suspended = true;
      keys.clear(); warPad.gun = false; warPad.bomb = false; cancelSpeech();
      soundHeld = true; muteAudio(true);
      cancelAnimationFrame(raf);
      if (screen === 'fly' && war && war.net) { bgLast = performance.now(); bgTimer = setInterval(bgStep, 100); return; }
      if (screen === 'fly' && !paused) { paused = true; renderUI(); }
    }
    function resumeGame() {
      if (!suspended || !alive) return;
      suspended = false; soundHeld = false; last = performance.now(); clearInterval(bgTimer); bgTimer = 0;
      raf = requestAnimationFrame(frame);
      if (!(screen === 'fly' && paused)) unmuteAudio();   // sound returns when you unpause
      root.focus();
    }
    window.NotchPlaneGame.suspend = suspendGame; window.NotchPlaneGame.resume = resumeGame;
    /// The app's own Sound switch (the Games sidebar on the Mac) drives the game's sound too.
    window.NotchPlaneGame.setSoundEnabled = (on) => { if (!alive) return; sound = !!on; if (sound) { if (!soundHeld) unmuteAudio(); } else muteAudio(true); if (screen === 'menu') renderUI(); };
    window.NotchPlaneGame.key = (key, down) => onKey({ key, repeat: false, target: null }, down);
    window.NotchPlaneGame._state = () => ({ screen, keys: [...keys], bank: flight.bank, pitch: flight.pitchAngle, pos: flight.pos, w: flight.w, onGround: flight.onGround,
      speed: flight.speed, ias: flight.ias, gload: flight.gload, spin: flight.spin, wreckRest: flight.rest, report: flight.report, damage: flight.damage, crashed: flight.crashed, why: flight.why, debris: debris.length, particles: smoke.length });
    window.NotchPlaneGame._poke = { startBattle: (assist = 'easy', veh = 'f16', npc = false) => { mode = MODES.find((m) => m.id === 'war'); warVeh = veh; warAssist = assist; warSide = 'coop'; warNpc = npc; start(); return war; }, net: { vote: (k, v) => netVoteCast(k, v), hurt: (id, a) => netHurtRemote(id, a, 'test'), room: () => netg && { role: netg.role, code: netg.code, cfg: netg.cfg, running: netg.running, status: netg.status, votes: netg.votes, id: netMyId }, hurtMe: (a, by) => warHurt(a, 'test', by) }, auto: (name, veh = 'f16', play = 'online') => { mode = MODES.find((m) => m.id === 'war'); playerName = name; warVeh = veh; warPlay = play; warNpc = true; warSide = 'coop'; warAutoStart(); return !!netg; }, netinfo: () => ({ role: netg && netg.role, code: netg && netg.code, status: netg && netg.status, running: netg && netg.running, peers: netg ? [...netg.peers.values()].map((p) => p.n) : [], paused: netg && netg.cfg.paused, wave: war && war.wave, net: !!(war && war.net), others: war && war.net ? [...war.net.others.values()].map((o) => [o.name, o.alive, o.rep && o.rep.kind]) : [] }), hostCode: (code, name, veh = 'f16') => { mode = MODES.find((m) => m.id === 'war'); playerName = name; warVeh = veh; netOpen('host', code); netg.autoStart = true; return true; }, join: (code, name, veh = 'f16') => { mode = MODES.find((m) => m.id === 'war'); playerName = name; warVeh = veh; netOpen('client', code); return true; }, dropLoot: (dx, dz, k, r) => { const p = war.tank ? war.tank.pos : flight.pos; warDropLoot(p[0] + dx, p[2] + dz, k, r); return war.loot.length; }, blast: (dx, dz, R = 45) => { const p = war.tank ? war.tank.pos : flight.pos; const x = p[0] + dx, z = p[2] + dz; warBoom([x, groundAt(W, x, z) + 1, z], 1); warBlast([x, groundAt(W, x, z) + 1, z], R, 260, 'p'); return { fires: war.fires.length, flyers: war.flyers.length }; }, bestTrees: () => { let best = null; primeObjects(W, 0, 0, 1800); for (const c of W.colliders) if (c.kind === 'tree' && Math.hypot(c.min[0], c.min[2]) < 1800) { const n = treesNear(W, c.min[0], c.min[2], 45).length; if (!best || n > best.n) best = { n, x: c.min[0], z: c.min[2] }; } return best; }, audioState: () => ({ state: ac && ac.state, gain: engGain ? engGain.gain.value : null, held: soundHeld, sound }), setSound: (on) => { sound = on; if (on) unmuteAudio(); else muteAudio(); }, lock: () => warToggleLock(), spawnWave: () => { warSpawnWave(); return war.ground.map((g) => g.kind); }, war: () => war, cam: () => ({ camMode, camPos: camPos.slice() }), warHurt: (n) => warHurt(n, 'test'), warFire: (k, v) => { if (k === 'gun') warPad.gun = v; }, remote: () => remote, sky: () => ({ on: shareOn, id: skyId, pilots: skyPilots, off: skyOff }), traffic: () => traffic, spawnTraffic: () => spawnTraffic(), failEngine: (p) => { failAt = elapsed; }, flight: () => flight, world: () => W, dbg: () => ({ debris, smoke, gouges, slowT, duckT, shakeKick, attached: [...attached] }),
      // Test hooks for looking at the models: a fixed camera, held controls, and freezing the physics.
      view: (v) => { devView = v; }, ctl: (c) => { devCtl = c; }, hold: (h) => { devHold = h; }, plane: () => plane, surf,
      // Test hook: run the simulation ahead by `secs` seconds without drawing (a slow software renderer can't keep real time).
      step: (secs) => { for (let i = 0; i < secs * 120; i++) { update(1 / 120); if (i % 2 === 0) { wreckFx(1 / 60); stepParticles(1 / 60); stepDebris(1 / 60); } } } };

    return () => {
      alive = false; cancelAnimationFrame(raf); cancelSpeech(); skyLeave(); praceLeave(true);
      window.removeEventListener('keydown', kd); window.removeEventListener('keyup', ku); window.removeEventListener('blur', blur);
      document.removeEventListener('visibilitychange', hidden);
      try { ac?.close(); } catch { /* already closed */ }
      root.remove();
    };
  }

  window.NotchPlaneGame = { mount, PLANES, MODES, CHALLENGES, Flight, _test: { clearTrees, chunkAt: (w, x, z) => chunkOf(w, Math.floor((x + WORLD) / TCS), Math.floor((z + WORLD) / TCS)), journeyCenter, blastTrees, treesNear, hash01, breakTree, treeAt, primeObjects, LOOT_RARITY, LOOT_KINDS, lootRoll, lootAmount, SOLDIER, SoldierBody, riflemanError, ARCADE_RATES, NET, WAR, TANK, TankBody, tankAimAt, planeAssist, ARENAS, arenaHeight, setArena: (a) => { ARENA = a; }, wrapPi, attitudeQ, procedure, atcStep, applyEnv, ENV, ilsAt, RUNWAY_ENDS, AP_SIGN, APRONS, buildPlane, REGIONS, nearestRegion, matchRegion, raCallout, gpwsWarnings, groundAt, makeWorld, qheading, qrot, hitObject, terrainAt, surfaceAt, roughnessAt, normalAt } };
})();
