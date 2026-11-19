// Desert Heat: the helicopter (part 9, Act 4-5). An arcade model that feels like a light helicopter: collective (up/down),
// tilt to move (W/S), yaw (A/D), momentum and a gentle auto-level. window.DesertHeatAir / node.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.DesertHeatAir = factory();
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  class Heli {
    constructor() { this.x = 0; this.y = 0; this.z = 0; this.vx = 0; this.vy = 0; this.vz = 0; this.heading = 0; this.yawRate = 0; this.pitch = 0; this.roll = 0; this.rotor = 0; this.ground = 0; }
    /** input: { up, down, forward (-1..1), turn (-1..1) }; ground: the height below. */
    step(dt, input, ground = 0) {
      this.ground = ground;
      this.rotor = Math.min(1, this.rotor + dt * 0.5);                 // the rotor spins up before it can lift
      const lift = (input.up ? 7 : input.down ? -6 : 0) * this.rotor;
      this.vy += (lift - this.vy * 1.6) * dt;                          // climb rate eases in and out
      const fwd = input.forward || 0;
      this.pitch += (fwd * 0.28 - this.pitch) * Math.min(1, dt * 2.5);
      this.yawRate += ((input.turn || 0) * 1.1 - this.yawRate) * Math.min(1, dt * 3);
      this.heading += this.yawRate * dt;
      this.roll += (-(input.turn || 0) * 0.18 * Math.min(1, Math.hypot(this.vx, this.vz) / 20) - this.roll) * Math.min(1, dt * 3);
      const airborne = this.y > ground + 0.3;
      const thrust = airborne ? this.pitch * 75 : 0;                  // tilt turns lift into forward speed
      const fx = Math.sin(this.heading), fz = -Math.cos(this.heading);
      this.vx += (fx * thrust - this.vx * 0.55) * dt; this.vz += (fz * thrust - this.vz * 0.55) * dt;
      this.x += this.vx * dt; this.y += this.vy * dt; this.z += this.vz * dt;
      if (this.y < ground) { this.y = ground; if (this.vy < 0) this.vy = 0; this.vx *= 0.9; this.vz *= 0.9; }
      if (this.y > 600) { this.y = 600; this.vy = Math.min(0, this.vy); }
    }
    get speed() { return Math.hypot(this.vx, this.vz); }
    get landed() { return this.y - this.ground < 0.4 && this.speed < 3; }
  }
  return { Heli };
}));
