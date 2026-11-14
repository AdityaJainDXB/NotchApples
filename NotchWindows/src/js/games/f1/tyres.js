// F1 tyres, four wheels each with TWO temperatures: the surface (heats and cools in seconds: sliding, braking, dirty air, the airflow) and
// the carcass (changes over a minute). Every compound has a carcass window it grips best in (Soft 90–110 °C, Medium 100–120 °C, Hard
// 110–135 °C). Below it the rubber cannot key into the road and grains; a surface that runs far above it blisters and the car snaps loose;
// and wear takes grip away slowly down to 30 % life, then falls off a cliff. Pure: no DOM, no clock, no randomness.
//
// ALL TUNABLE NUMBERS ARE IN `TYRE` BELOW.
(function (root) {
  'use strict';
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

  const TYRE = {
    // grip: the compound's peak grip; wear: how quickly it wears (relative); heat: how much heat it makes for the same work (harder rubber
    // makes more, which is what it needs to reach its window); window: the carcass temperature range (°C) it works best in.
    compounds: {
      S: { name: 'Soft', grip: 1.06, wear: 1.6, heat: 1.0, window: [90, 110], rain: 0, col: '#ff3b3b' },
      M: { name: 'Medium', grip: 1.0, wear: 1.0, heat: 1.1, window: [100, 120], rain: 0, col: '#ffd23f' },
      H: { name: 'Hard', grip: 0.95, wear: 0.6, heat: 1.3, window: [110, 135], rain: 0, col: '#f2f2f2' },
      I: { name: 'Intermediate', grip: 0.9, wear: 1.3, heat: 0.7, window: [60, 90], rain: 1, col: '#3ad07a' },
      W: { name: 'Full Wet', grip: 0.8, wear: 1.1, heat: 0.5, window: [40, 70], rain: 2, col: '#3a7bff' },
    },
    startC: 70,                 // temperature the tyres leave the blankets at (°C)
    // Heat into the surface (°C per second at full effort)
    surfLateral: 9.5,           // cornering: × lateral g × wheel load × (speed / 50 m/s)
    surfBrake: 5.0,             // front braking
    surfTraction: 2.4,          // rear wheels under power
    surfSlip: 1.6,              // sliding: × slip speed (m/s)
    surfBase: 0.5,              // rolling
    surfCool: 0.25, surfCoolV: 0.004,       // surface loses heat to the air: rate (1/s) = surfCool + surfCoolV × speed
    surfToCarcass: 0.06,        // heat flows from the hot surface into the carcass (1/s)
    carcassBase: 1.6,           // the carcass warms from rolling at speed (°C/s)
    carcassFlex: 0.8,           // ... and from flexing in corners (°C/s per g of cornering at full wheel load)
    carcassCool: 0.0075, carcassCoolV: 0.00012,     // carcass loses heat to the air (1/s, plus per m/s)
    trackHeat: 0.18,            // a hot track heats the tyres: fraction of (track − tyre) per second, a little
    wetCool: 2.5,               // rain cools the surface this much faster at full wetness
    // Grip from temperature
    coldLoss: 0.007, coldFloor: 0.80,       // grip lost per °C below the window, and the least it falls to (graining)
    hotLoss: 0.009, hotFloor: 0.66,         // grip lost per °C above the window (overheating)
    surfaceOptAbove: 8,         // the surface grips best this much hotter than the carcass
    surfaceTol: 14, surfaceLoss: 0.004, surfaceFloor: 0.86,
    // Blistering and graining
    blisterAbove: 18,           // surface this many °C over the window top: blisters form
    blisterRate: 0.020, blisterHeal: 0.0, blisterGrip: 0.28, blisterWear: 1.6,    // (blisters do not heal)
    grainBelow: 14,             // surface this many °C under the window bottom, while sliding: grains
    grainRate: 0.010, grainHeal: 0.03, grainGrip: 0.12,
    snapStart: 0.25, snapAt: 0.75,         // rear blistering turns into snap oversteer between these
    // Wear
    wearBase: 0.0004,          // life used per second at a "1.0" effort
    wearEffort: { base: 0.5, lateral: 0.35, brake: 0.3, traction: 0.15, slip: 0.012 },
    wearHot: 0.02,              // extra wear per °C of carcass over the window
    // The wear curve: gentle to the cliff, sharp after it
    cliffLife: 0.30, gentleLoss: 0.10, cliffLoss: 0.48, cliffExp: 0.8,
    // Load split and pressures
    frontShare: 0.46, transfer: 0.18,
    pressureHeat: 0.05, pressureGrip: 0.004,      // per psi from the reference
  };

  const windowOf = (c) => (TYRE.compounds[c] || TYRE.compounds.M).window;

  /// The grip a compound gives on a wet track (the same shape the rest of the game uses): slicks lose a lot, inters like damp, wets like rain.
  function wetGrip(compound, wet) {
    const t = TYRE.compounds[compound] || TYRE.compounds.M, w = clamp(wet || 0, 0, 1);
    if (!t.rain) return t.grip * (1 - 0.55 * w);
    if (t.rain === 1) return t.grip * (1 + 0.12 * w - 0.25 * Math.max(0, w - 0.65));
    return t.grip * (1 + 0.16 * w);
  }
  /// Grip multiplier for the carcass temperature: 1 inside the window, falling on either side (graining below, overheating above).
  function gripFromCarcass(compound, tc) {
    const [lo, hi] = windowOf(compound);
    if (tc < lo) return Math.max(TYRE.coldFloor, 1 - TYRE.coldLoss * (lo - tc));
    if (tc > hi) return Math.max(TYRE.hotFloor, 1 - TYRE.hotLoss * (tc - hi));
    return 1;
  }
  /// Grip multiplier for the remaining life (1 new, 0 worn out): a slow loss to 30 % life, then a cliff.
  function gripFromLife(life) {
    const l = clamp(life, 0, 1);
    if (l >= TYRE.cliffLife) return 1 - TYRE.gentleLoss * (1 - l) / (1 - TYRE.cliffLife);
    const x = (TYRE.cliffLife - l) / TYRE.cliffLife;
    return 1 - TYRE.gentleLoss - TYRE.cliffLoss * Math.pow(x, TYRE.cliffExp);
  }

  const wheel = (T) => ({ Ts: T, Tc: T, wear: 0, blister: 0, grain: 0 });
  /// A set of four tyres of a compound, fresh off the blankets.
  function createSet(compound, opt = {}) {
    const T = opt.startC != null ? opt.startC : TYRE.startC;
    return { compound: TYRE.compounds[compound] ? compound : 'M', w: [wheel(T), wheel(T), wheel(T), wheel(T)], age: 0, last: null };
  }

  /// One step. `p`: v (m/s), latG (lateral acceleration in g, signed), steer (−1..1), brake, throttle (0..1), slip (sideways speed m/s),
  /// ambientC, trackC, wet (0..1), dirty (0..1, how much of the dirty-air loss the front is feeling), massRatio (car mass / reference),
  /// pressure { front, rear } (psi offsets from the reference), heatK (setup).
  /// Returns { grip, gripFront, gripRear, snap, life, surface, carcass, state, window, blistering, graining, cliff }.
  function step(s, p, dt) {
    const T = TYRE, comp = T.compounds[s.compound], v = Math.max(0, p.v || 0), lat = Math.abs(p.latG || 0);
    const amb = p.ambientC != null ? p.ambientC : 25, trk = p.trackC != null ? p.trackC : amb + 12, wet = clamp(p.wet || 0, 0, 1), brk = clamp(p.brake || 0, 0, 1), thr = clamp(p.throttle || 0, 0, 1);
    const side = p.steer > 0.05 ? 1 : p.steer < -0.05 ? -1 : 0, slip = Math.abs(p.slip || 0), dirty = clamp(p.dirty || 0, 0, 1);
    const pr = p.pressure || {}, massK = Math.sqrt(p.massRatio || 1), vk = Math.min(1.4, v / 50), [lo, hi] = comp.window;
    s.age += dt;
    let fSum = 0, rSum = 0, ts = 0, tc = 0, snapRear = 0, blis = 0, gr = 0, lifeSum = 0;
    for (let i = 0; i < 4; i++) {
      const w = s.w[i], front = i < 2, left = i % 2 === 0;
      const outer = side === 0 ? 0 : (left ? (side > 0 ? 1 : -1) : (side > 0 ? -1 : 1));
      const share = front ? T.frontShare : 1 - T.frontShare, load = 2 * share * (1 + T.transfer * outer * Math.min(1, lat / 3));
      const psi = (front ? pr.front : pr.rear) || 0, pK = 1 + T.pressureHeat * psi;
      // Surface: heated by the work, cooled by the air and the rain, shares heat with the carcass.
      let heat = (T.surfBase * Math.min(1, v / 15) + T.surfLateral * lat * load * vk + (front ? T.surfBrake * brk * Math.min(1, v / 40) : 0.35 * T.surfBrake * brk * Math.min(1, v / 40)) + (front ? 0 : T.surfTraction * thr * Math.min(1, v / 40)) + T.surfSlip * slip) * comp.heat * pK * massK;
      if (front) heat += (p.dirtyHeat != null ? p.dirtyHeat : 90) * dirty;
      const cool = (T.surfCool + T.surfCoolV * v) * (1 + T.wetCool * wet);
      const toC = T.surfToCarcass * (w.Ts - w.Tc);
      w.Ts += (heat - cool * (w.Ts - amb) - toC) * dt;
      // Carcass: warmed by the surface and by flexing, cooled by the air, a little by the track.
      const flex = (T.carcassBase * Math.min(1, v / 40) + T.carcassFlex * lat * load * vk) * comp.heat * massK;
      w.Tc += (toC * 0.9 + flex - (T.carcassCool + T.carcassCoolV * v) * (1 + T.wetCool * 0.4 * wet) * (w.Tc - amb) + T.trackHeat * 0.05 * (trk - w.Tc)) * dt;
      w.Ts = clamp(w.Ts, amb - 5, 260); w.Tc = clamp(w.Tc, amb - 5, 200);
      // Blisters on an overheated surface; graining on a cold, sliding one.
      const over = w.Ts - (hi + T.blisterAbove);
      if (over > 0) w.blister = Math.min(1, w.blister + T.blisterRate * (over / 10) * dt);
      const under = (lo - T.grainBelow) - w.Ts;
      if (under > 0 && slip > 1.2) w.grain = Math.min(1, w.grain + T.grainRate * (under / 10) * Math.min(slip, 5) * dt);
      else w.grain = Math.max(0, w.grain - T.grainHeal * dt);
      // Wear.
      const e = T.wearEffort, effort = e.base + e.lateral * lat * load + e.brake * brk * (front ? 1 : 0.4) + e.traction * thr * (front ? 0 : 1) + e.slip * slip;
      const hot = Math.max(0, w.Tc - hi) * T.wearHot;
      w.wear = Math.min(1, w.wear + T.wearBase * comp.wear * (effort * (v > 3 ? 1 : 0.1) + hot) * (1 + T.blisterWear * w.blister) * massK * dt);
      // Grip of this wheel.
      const life = 1 - w.wear, wetK = p.wet != null ? wetGrip(s.compound, wet) : comp.grip;
      const surfDelta = Math.abs(w.Ts - (w.Tc + T.surfaceOptAbove)), surfK = Math.max(T.surfaceFloor, 1 - T.surfaceLoss * Math.max(0, surfDelta - T.surfaceTol));
      const pg = 1 - T.pressureGrip * Math.abs(psi);
      const g = wetK * gripFromCarcass(s.compound, w.Tc) * surfK * gripFromLife(life) * (1 - T.blisterGrip * w.blister) * (1 - T.grainGrip * w.grain) * pg;
      w.grip = g;
      if (front) fSum += g; else { rSum += g; snapRear = Math.max(snapRear, w.blister); }
      ts += w.Ts; tc += w.Tc; blis = Math.max(blis, w.blister); gr = Math.max(gr, w.grain); lifeSum += life;
    }
    const gripFront = fSum / 2, gripRear = rSum / 2, life = lifeSum / 4, carcass = tc / 4;
    const snap = clamp((snapRear - T.snapStart) / (T.snapAt - T.snapStart), 0, 1);
    const state = carcass < lo ? 'cold' : carcass > hi ? 'hot' : 'ok';
    const out = { grip: (gripFront + gripRear) / 2, gripFront, gripRear, snap, life, surface: ts / 4, carcass, state, window: comp.window, blistering: blis, graining: gr, cliff: life < T.cliffLife };
    s.last = out;
    return out;
  }

  /// The most worn wheel's life, 0..1 (what the engineer and the pit stop decision look at).
  const lifeOf = (s) => 1 - Math.max(...s.w.map((w) => w.wear));

  const api = { TYRE, windowOf, wetGrip, gripFromCarcass, gripFromLife, createSet, step, lifeOf };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.NotchRaceF1 = root.NotchRaceF1 || {};
  root.NotchRaceF1.tyres = api;
})(typeof window !== 'undefined' ? window : globalThis);
