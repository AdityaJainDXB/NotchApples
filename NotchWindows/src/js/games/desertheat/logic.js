// Desert Heat: the pure rules (no three.js, no DOM), shared by the game and the node tests.
// Loaded as a plain script in the game (window.DesertHeatLogic) and with require() in tests.
//
//   polyline helpers   lengths, offsets (for lanes, kerbs, barriers), point-at-distance
//   bridgeHeights      how high each point of a bridge or flyover sits, with ramps where it meets the ground
//   Grid               a spatial hash for "what is near this point" (roads, building walls)
//   sunAt              where the sun is over Dubai for an hour of the day and a day of the year
//   Car                the driving model: engine, gearbox, weight transfer, tyre grip and slip, hand brake, drag

(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.DesertHeatLogic = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

  // ------------------------------------------------------------------ polylines ([x,z,x,z,...])

  function cumulative(p) {
    const n = p.length / 2, d = new Float64Array(n);
    for (let i = 1; i < n; i++) d[i] = d[i - 1] + Math.hypot(p[i * 2] - p[i * 2 - 2], p[i * 2 + 1] - p[i * 2 - 1]);
    return d;
  }

  /** Unit direction at each point (averaged at corners). */
  function tangents(p) {
    const n = p.length / 2, t = new Float64Array(n * 2);
    for (let i = 0; i < n; i++) {
      const a = Math.max(0, i - 1), b = Math.min(n - 1, i + 1);
      let dx = p[b * 2] - p[a * 2], dz = p[b * 2 + 1] - p[a * 2 + 1];
      const l = Math.hypot(dx, dz) || 1; t[i * 2] = dx / l; t[i * 2 + 1] = dz / l;
    }
    return t;
  }

  /**
   * The polyline moved sideways by `off` metres (positive = to the right when walking along it, with x east and z south).
   * Corners use a mitre, capped so sharp bends do not shoot out spikes.
   */
  function offset(p, off) {
    const n = p.length / 2, out = new Float64Array(n * 2);
    for (let i = 0; i < n; i++) {
      let nx = 0, nz = 0, k = 1;
      const seg = (j) => { const dx = p[j * 2 + 2] - p[j * 2], dz = p[j * 2 + 3] - p[j * 2 + 1], l = Math.hypot(dx, dz) || 1; return [dx / l, dz / l]; };
      if (i === 0) { const [dx, dz] = seg(0); nx = -dz; nz = dx; }
      else if (i === n - 1) { const [dx, dz] = seg(n - 2); nx = -dz; nz = dx; }
      else {
        const [ax, az] = seg(i - 1), [bx, bz] = seg(i);
        const ux = -az - bz, uz = ax + bx, l = Math.hypot(ux, uz);
        if (l < 1e-6) { nx = -bz; nz = bx; } else { nx = ux / l; nz = uz / l; k = 1 / Math.max(0.35, nx * -bz + nz * bx); }
      }
      // right-hand normal of direction (dx, dz) with z pointing south is (-dz, dx)
      out[i * 2] = p[i * 2] + nx * off * k; out[i * 2 + 1] = p[i * 2 + 1] + nz * off * k;
    }
    return out;
  }

  /** The point and direction `dist` metres along the polyline (clamped to its ends). */
  function pointAt(p, cum, dist) {
    const n = p.length / 2;
    if (dist <= 0) { const dx = p[2] - p[0], dz = p[3] - p[1], l = Math.hypot(dx, dz) || 1; return { x: p[0], z: p[1], dx: dx / l, dz: dz / l, i: 0, f: 0 }; }
    let lo = 0, hi = n - 1;
    if (dist >= cum[hi]) { const dx = p[hi * 2] - p[hi * 2 - 2], dz = p[hi * 2 + 1] - p[hi * 2 - 1], l = Math.hypot(dx, dz) || 1; return { x: p[hi * 2], z: p[hi * 2 + 1], dx: dx / l, dz: dz / l, i: hi - 1, f: 1 }; }
    while (hi - lo > 1) { const m = (lo + hi) >> 1; if (cum[m] <= dist) lo = m; else hi = m; }
    const seg = cum[hi] - cum[lo] || 1, f = (dist - cum[lo]) / seg;
    const dx = p[hi * 2] - p[lo * 2], dz = p[hi * 2 + 1] - p[lo * 2 + 1], l = Math.hypot(dx, dz) || 1;
    return { x: p[lo * 2] + dx * f, z: p[lo * 2 + 1] + dz * f, dx: dx / l, dz: dz / l, i: lo, f };
  }

  // ------------------------------------------------------------------ bridges and flyovers

  const DECK = 7.5;         // metres per bridge level
  const RAMP = 0.055;       // ramp gradient (5.5%), so a level-1 flyover ramps over about 135 m

  /**
   * Height of every point of a road. Bridges sit DECK × level high, and ramp down to the ground at an end that does not
   * continue onto another bridge (`joinedStart` / `joinedEnd` say whether it does). Ordinary roads are at 0.
   */
  function bridgeHeights(p, level, joinedStart, joinedEnd) {
    const n = p.length / 2, h = new Float32Array(n);
    if (!level) return h;
    const cum = cumulative(p), total = cum[n - 1], top = DECK * level;
    for (let i = 0; i < n; i++) {
      let r = top;
      if (!joinedStart) r = Math.min(r, cum[i] * RAMP);
      if (!joinedEnd) r = Math.min(r, (total - cum[i]) * RAMP);
      h[i] = r;
    }
    return h;
  }

  // ------------------------------------------------------------------ spatial hash

  class Grid {
    constructor(cell) { this.cell = cell; this.map = new Map(); }
    key(cx, cz) { return cx * 73856093 ^ cz * 19349663; }
    /** Adds `item` to every cell the segment (ax,az)-(bx,bz) touches (with a margin). */
    addSegment(ax, az, bx, bz, item, margin = 0) {
      const c = this.cell;
      const x0 = Math.floor((Math.min(ax, bx) - margin) / c), x1 = Math.floor((Math.max(ax, bx) + margin) / c);
      const z0 = Math.floor((Math.min(az, bz) - margin) / c), z1 = Math.floor((Math.max(az, bz) + margin) / c);
      for (let x = x0; x <= x1; x++) for (let z = z0; z <= z1; z++) {
        const k = this.key(x, z); let a = this.map.get(k); if (!a) this.map.set(k, a = []); a.push(item);
      }
    }
    query(x, z) { return this.map.get(this.key(Math.floor(x / this.cell), Math.floor(z / this.cell))) || EMPTY; }
    remove(pred) { for (const [k, a] of this.map) { const b = a.filter((i) => !pred(i)); if (b.length) this.map.set(k, b); else this.map.delete(k); } }
  }
  const EMPTY = [];

  /** Closest point on segment a-b to (x,z): { d (distance), t (0..1), px, pz }. */
  function nearestOnSegment(x, z, ax, az, bx, bz) {
    const dx = bx - ax, dz = bz - az, l2 = dx * dx + dz * dz || 1;
    const t = clamp(((x - ax) * dx + (z - az) * dz) / l2, 0, 1);
    const px = ax + dx * t, pz = az + dz * t;
    return { d: Math.hypot(x - px, z - pz), t, px, pz };
  }

  // ------------------------------------------------------------------ the sun over Dubai

  const LAT = 25.2 * Math.PI / 180;

  /**
   * Sun direction for a local solar `hour` (0-24) and `day` of the year (1-365). Returns a unit vector in game axes
   * (x east, y up, z south) and the elevation in degrees.
   */
  function sunAt(hour, day) {
    const dec = -23.44 * Math.PI / 180 * Math.cos(2 * Math.PI / 365 * (day + 10));
    const H = (hour - 12) * 15 * Math.PI / 180;
    const sinEl = Math.sin(LAT) * Math.sin(dec) + Math.cos(LAT) * Math.cos(dec) * Math.cos(H);
    const el = Math.asin(clamp(sinEl, -1, 1));
    // azimuth from north, clockwise
    const cosAz = (Math.sin(dec) - Math.sin(el) * Math.sin(LAT)) / (Math.cos(el) * Math.cos(LAT) || 1e-6);
    let az = Math.acos(clamp(cosAz, -1, 1));
    if (H > 0) az = 2 * Math.PI - az;
    const c = Math.cos(el);
    return { x: Math.sin(az) * c, y: Math.sin(el), z: -Math.cos(az) * c, elevation: el * 180 / Math.PI };
  }

  // ------------------------------------------------------------------ the car

  /**
   * A car on flat ground, in the style of a bicycle model with weight transfer: two axles, each with a tyre whose
   * sideways force grows with its slip angle until it saturates at the grip limit. The rear axle loses grip under the
   * hand brake; the engine runs through an automatic gearbox; braking and accelerating move weight between the axles.
   */
  const SALOON = {
    mass: 1350, inertiaK: 1.25,
    cgFront: 1.18, cgRear: 1.47, cgHeight: 0.56,
    wheelRadius: 0.31, track: 1.5,
    corneringFront: 6.2, corneringRear: 6.6,     // per radian, times the axle load
    grip: 1.02, handbrakeGrip: 0.42, rollResist: 12, drag: 0.42,
    brakeForce: 11000, handbrakeForce: 4000,
    idle: 850, redline: 6400, upshift: 5900, downshift: 2600,
    gears: [3.45, 2.05, 1.42, 1.08, 0.87, 0.72], reverse: 3.2, final: 3.9, efficiency: 0.86,
    torque: [[1000, 120], [2500, 170], [4000, 190], [5200, 182], [6400, 150]],
    driveRear: false, maxSteer: 0.6, topSpeed: 52,
  };

  function torqueAt(spec, rpm) {
    const t = spec.torque;
    if (rpm <= t[0][0]) return t[0][1];
    for (let i = 1; i < t.length; i++) if (rpm <= t[i][0]) { const [r0, a] = t[i - 1], [r1, b] = t[i]; return a + (b - a) * (rpm - r0) / (r1 - r0); }
    return rpm > spec.redline ? 0 : t[t.length - 1][1];
  }

  class Car {
    constructor(spec = SALOON) {
      this.spec = spec;
      this.x = 0; this.z = 0; this.y = 0; this.heading = 0;   // heading: radians, 0 = facing north (-z), clockwise
      this.vx = 0; this.vz = 0; this.yawRate = 0;
      this.gear = 1; this.rpm = spec.idle; this.steer = 0;
      this.ax = 0; this.ay = 0;                                // accelerations in the car's frame (for body pitch and roll)
      this.slipFront = 0; this.slipRear = 0; this.skid = 0;     // for tyre sounds and marks
      this.shiftTimer = 0;
    }
    get forward() { return [Math.sin(this.heading), -Math.cos(this.heading)]; }
    /** Speed along the car's nose, m/s (negative when reversing). */
    get speed() { const [fx, fz] = this.forward; return this.vx * fx + this.vz * fz; }

    /**
     * Advances the car by dt seconds. `input` = { throttle 0..1, brake 0..1, steer -1..1 (right positive), handbrake bool }.
     * Holding brake at a standstill engages reverse; throttle then drives forward again.
     */
    step(dt, input) {
      const s = this.spec, g = 9.81, m = s.mass, L = s.cgFront + s.cgRear;
      const [fx, fz] = this.forward, rx = -fz, rz = fx;               // forward and right unit vectors
      let vLong = this.vx * fx + this.vz * fz, vLat = this.vx * rx + this.vz * rz;
      const speed = Math.abs(vLong);

      // Steering: slower to turn and less lock at speed, so the car is calm on the motorway and nimble in town.
      const lock = s.maxSteer * (1 / (1 + speed * 0.045));
      const target = clamp(input.steer || 0, -1, 1) * lock;
      this.steer += clamp(target - this.steer, -dt * 2.6, dt * 2.6);

      // Gear: reverse when braking at a standstill; automatic shifts otherwise.
      if (this.gear === -1) { if ((input.throttle || 0) > 0.1 && vLong > -0.5) this.gear = 1; }
      else if ((input.brake || 0) > 0.1 && Math.abs(vLong) < 0.5 && (input.throttle || 0) < 0.1) {
        this.stopped = (this.stopped || 0) + dt;                    // hold the brake for a moment at a standstill to reverse
        if (this.stopped > 0.45) this.gear = -1;
      } else this.stopped = 0;
      const ratio = this.gear === -1 ? s.reverse : s.gears[this.gear - 1];
      const wheelRpm = speed / s.wheelRadius * 60 / (2 * Math.PI);
      this.rpm = Math.max(s.idle, wheelRpm * ratio * s.final);
      this.shiftTimer = Math.max(0, this.shiftTimer - dt);
      if (this.gear > 0 && this.shiftTimer === 0) {
        if (this.rpm > s.upshift && this.gear < s.gears.length) { this.gear++; this.shiftTimer = 0.35; }
        else if (this.rpm < s.downshift && this.gear > 1) { this.gear--; this.shiftTimer = 0.25; }
      }
      this.rpm = Math.min(this.rpm, s.redline + 200);

      // Axle loads with weight transfer.
      const W = m * g;
      let loadF = (s.cgRear / L) * W - (s.cgHeight / L) * m * this.ax;
      let loadR = (s.cgFront / L) * W + (s.cgHeight / L) * m * this.ax;
      loadF = Math.max(loadF, W * 0.15); loadR = Math.max(loadR, W * 0.15);

      // Tyre slip angles.
      const vMin = Math.max(speed, 2.5);
      const sgn = vLong >= 0 ? 1 : -1;
      const slipF = Math.atan2(vLat + this.yawRate * s.cgFront, vMin) - this.steer * sgn;
      const slipR = Math.atan2(vLat - this.yawRate * s.cgRear, vMin);
      const gripR = input.handbrake ? s.handbrakeGrip : s.grip;
      let latF = clamp(-s.corneringFront * slipF, -s.grip, s.grip) * loadF;
      let latR = clamp(-s.corneringRear * slipR, -gripR, gripR) * loadR;

      // Drive and brakes.
      // In reverse the brake pedal drives backwards and the accelerator brakes (the usual game controls).
      const pedal = this.gear === -1 ? (input.brake || 0) : (input.throttle || 0);
      const throttle = this.shiftTimer > 0.2 ? 0 : clamp(pedal, 0, 1);
      let drive = throttle * torqueAt(s, this.rpm) * ratio * s.final * s.efficiency / s.wheelRadius;
      if (this.gear === -1) drive = -drive * 0.6;
      if (this.rpm >= s.redline) drive = 0;
      const driveLoad = s.driveRear ? loadR : loadF;
      drive = clamp(drive, -s.grip * driveLoad, s.grip * driveLoad);
      let brake = 0;
      const braking = this.gear === -1 ? (input.throttle || 0) : (input.brake || 0);
      if (braking > 0 && speed > 0.05) brake = -Math.sign(vLong) * Math.min(s.brakeForce * braking, s.grip * W * 1.05);
      if (input.handbrake && speed > 0.05) brake += -Math.sign(vLong) * s.handbrakeForce;
      // The driven axle shares its grip between pushing and turning (a friction circle), so flooring it mid-corner understeers.
      const shareDrive = (f, lat, load) => { const max = s.grip * load, used = Math.hypot(f, lat); return used > max ? max / used : 1; };
      if (s.driveRear) latR *= shareDrive(drive, latR, loadR); else latF *= shareDrive(drive, latF, loadF);

      const resist = -s.rollResist * vLong - s.drag * vLong * Math.abs(vLong);
      const fLong = drive + brake + resist - latF * Math.sin(this.steer);
      const fLat = latR + latF * Math.cos(this.steer);
      const torque = latF * Math.cos(this.steer) * s.cgFront - latR * s.cgRear;

      const aLong = fLong / m, aLat = fLat / m;
      this.ax += (aLong - this.ax) * Math.min(1, dt * 8);
      this.ay += (aLat - this.ay) * Math.min(1, dt * 8);
      vLong += aLong * dt; vLat += aLat * dt;
      // Stop cleanly rather than creeping backwards from braking.
      if (brake !== 0 && Math.sign(vLong) !== sgn && Math.sign(drive) !== Math.sign(vLong)) vLong = 0;
      // At walking pace the bicycle model is unstable; let the tyres simply hold the car straight.
      if (speed < 1.5) vLat *= Math.max(0, 1 - dt * 10);

      const inertia = m * s.inertiaK * (s.cgFront * s.cgRear);
      this.yawRate += torque / inertia * dt;
      if (speed < 1.5) this.yawRate = vLong * Math.tan(this.steer) / L;   // pure rolling at very low speed
      this.heading += this.yawRate * dt;

      const [nfx, nfz] = this.forward, nrx = -nfz, nrz = nfx;
      this.vx = nfx * vLong + nrx * vLat; this.vz = nfz * vLong + nrz * vLat;
      this.x += this.vx * dt; this.z += this.vz * dt;
      this.slipFront = slipF; this.slipRear = slipR;
      this.skid = clamp(Math.max(Math.abs(slipR) * (speed > 4 ? 1 : 0) - 0.12, (Math.abs(brake) > s.grip * W * 0.95 ? 0.6 : 0)), 0, 1);
    }

    /** Hits a wall whose outward normal is (nx, nz): bounce with some energy lost. Returns the impact speed. */
    hit(nx, nz, depth) {
      this.x += nx * depth; this.z += nz * depth;
      const vn = this.vx * nx + this.vz * nz;
      if (vn >= 0) return 0;
      this.vx -= 1.35 * vn * nx; this.vz -= 1.35 * vn * nz;
      this.vx *= 0.75; this.vz *= 0.75; this.yawRate *= 0.5;
      return -vn;
    }
  }

  return { clamp, cumulative, tangents, offset, pointAt, bridgeHeights, DECK, RAMP, Grid, nearestOnSegment, sunAt, Car, SALOON, torqueAt };
});
