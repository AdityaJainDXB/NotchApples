// F1 aerodynamics: air density from altitude and temperature, quadratic downforce and drag (F = 0.5 ρ v² C A), ground effect that grows as
// the car's ride height falls and stalls below a critical height (porpoising), dirty air behind another car, the 2025 DRS flap and the
// 2026 Z-mode / X-mode, and the DRS / active-aero zones of a track. Deterministic and frame-rate independent: the ride-height oscillator runs
// in fixed 1/240 s sub-steps whatever `dt` is. Pure: no DOM, no clock, no randomness.
//
// ALL TUNABLE NUMBERS ARE IN `AERO` BELOW.
(function (root) {
  'use strict';
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const smooth = (e0, e1, x) => { const t = clamp((x - e0) / (e1 - e0), 0, 1); return t * t * (3 - 2 * t); };

  const AERO = {
    G: 9.81,
    areaM2: 1.5,                // frontal area A
    CL: 2.7,                    // total lift (downforce) coefficient at the reference ride height, wings and floor together (CL·A = 4.05 m²)
    CD: 0.80,                   // drag coefficient (CD·A = 1.2 m²)
    share: { floor: 0.55, frontWing: 0.18, rearWing: 0.20, body: 0.07 },   // where the downforce comes from (the underbody Venturi tunnels give 50–60 %)
    frontOfFloor: 0.38, frontOfBody: 0.4,      // how much of the floor's and the body's downforce acts on the front axle
    gripPerLoad: 0.2,           // grip gained per unit of (downforce / weight): tuned so the F1 car feels as before at top speed
    // Ground effect
    refHeightMm: 32,            // the ride height the coefficients are quoted at
    geExponent: 1.4,            // downforce rises as (ref / height) ^ exponent as the car gets lower
    critHeightMm: 21,           // below this the floor airflow stalls
    stallDepthMm: 2.5,          // how quickly the stall bites (mm below critical to full stall)
    stallLoss: 0.65,            // share of floor downforce lost in a full stall
    reattachMm: 1.0,            // the flow stays broken away until the car has risen this far above the critical height (hysteresis: it is what makes it bounce)
    minHeightMm: 8,
    // Ride-height dynamics (a spring-damper pushed down by its own downforce)
    springNPerMm: 2200,         // how much downforce squats the car by 1 mm
    heaveHz: 4.5, heaveZeta: 0.30,
    subStep: 1 / 240,
    porpoiseMinSpeed: 55,       // m/s: below this there is not enough downforce to porpoise
    // Dirty air (wake behind a car ahead)
    dirtyGapS: 1.5,             // inside this time gap the wake bites
    dirtyMin: 0.15, dirtyMax: 0.35,   // loss of front downforce at the edge of the wake and right on the gearbox
    dirtyFadeS: 0.15,           // the last bit before the edge fades in so there is no step
    wakeDragRelief: 0.15,       // slipstream: up to this much less drag in the wake
    frontSurfaceHeat: 90,       // extra front-tyre surface heating (°C/s at full dirty air) the tyre module can use
    // Moving parts
    flapSecs: 0.25,             // DRS flap / active-aero wings take this long to open or close
    wingStepDown: 0.03, wingStepDrag: 0.008,   // per step of front-wing angle (−5…+5): front downforce and drag
    // Zones
    straightCurv: 0.0012,       // a straight: curvature below this (radius over ~830 m)
    zoneMinM: 300, zoneMaxZones: 3, detectBeforeM: 150,
  };

  /// Air density (kg/m³) at an altitude (m) and air temperature (°C): the standard atmosphere's pressure and the gas law.
  function airDensity(altitudeM = 0, tempC = 15) {
    const p = 101325 * Math.pow(Math.max(0, 1 - 2.25577e-5 * altitudeM), 5.25588);
    return p / (287.058 * (tempC + 273.15));
  }
  /// Floor downforce multiplier for a ride height (mm): grows as the car drops, then stalls below the critical height.
  function floorFactor(hMm) {
    const h = Math.max(AERO.minHeightMm, hMm);
    const gain = Math.pow(AERO.refHeightMm / Math.max(h, AERO.critHeightMm), AERO.geExponent);      // (the gain stops growing at the critical height: past it the flow has broken away)
    const stall = 1 - AERO.stallLoss * smooth(AERO.critHeightMm, AERO.critHeightMm - AERO.stallDepthMm, h);
    return gain * stall;
  }
  /// The floor's downforce factor for a ride height and whether the flow has broken away (the hysteretic version the simulation uses).
  const floorGain = (hMm, separated) => Math.pow(AERO.refHeightMm / Math.max(Math.max(AERO.minHeightMm, hMm), AERO.critHeightMm), AERO.geExponent) * (separated ? 1 - AERO.stallLoss : 1);
  /// Loss of front downforce (0..0.35) for a car `gapS` seconds behind another: nothing beyond 1.5 s, 15–35 % inside it (more the closer).
  function dirtyAirLoss(gapS) {
    if (gapS == null || !(gapS >= 0) || gapS >= AERO.dirtyGapS) return 0;
    const f = 1 - gapS / AERO.dirtyGapS;
    const fade = smooth(AERO.dirtyGapS, AERO.dirtyGapS - AERO.dirtyFadeS, gapS);
    return (AERO.dirtyMin + (AERO.dirtyMax - AERO.dirtyMin) * f) * fade;
  }

  /// A fresh aero state: ride height at its static setting, flap closed.
  function createAero(setup = {}) {
    const h0 = setup.rideHeightMm || 34;
    return { h: h0, hv: 0, hEq: h0, flap: 0, acc: 0, wake: 0, porp: 0, stalled: false, sep: false, last: null };
  }

  /// One step. `p`: v (m/s), rho (kg/m³), massKg, setup { rideHeightMm, frontWing }, open (DRS flap / X-mode wanted), era (the era config),
  /// gapS (seconds behind the car ahead, or null), damage { frontWing 0..1, floor 0..1 }, bumpMm (a kerb or bump this step, pushes the car up).
  /// Returns { downforceN, dragN, downK, understeer, frontLoss, frontShare, rideHeightMm, porpoise, stalled, flap }.
  function step(s, p, dt) {
    const A = AERO, v = Math.max(0, p.v || 0), rho = p.rho || 1.225, setup = p.setup || {}, dmg = p.damage || {}, era = p.era || { aeroEffect: { dragK: 1, downK: 1 } };
    const wingStep = clamp(setup.frontWing || 0, -5, 5), setH = setup.rideHeightMm || 34;
    const q = 0.5 * rho * v * v;
    // The flap / active wings move over a fraction of a second.
    const want = p.open ? 1 : 0;
    s.flap += clamp(want - s.flap, -dt / A.flapSecs, dt / A.flapSecs);
    // Dirty air.
    const loss = dirtyAirLoss(p.gapS);
    s.wake += (loss - s.wake) * (1 - Math.exp(-dt * 6));
    // Shares of downforce, with the floor depending on the ride height and the damage.
    const sh = A.share, wingF = (1 + A.wingStepDown * wingStep) * (1 - 0.7 * (dmg.frontWing || 0));
    const floorDmg = 1 - 0.6 * (dmg.floor || 0);
    // Ride-height oscillator in fixed sub-steps (so 60 Hz and 120 Hz agree). The car squats under its own downforce; if that
    // drops the floor below the critical height the airflow stalls, the downforce falls, the car rises again, and it bounces.
    s.acc += dt;
    const w = 2 * Math.PI * A.heaveHz, zeta = A.heaveZeta, h = A.subStep;
    let F = s.last ? s.last.downforceN : 0;
    let nsub = 0;
    while (s.acc >= h && nsub < 400) {
      s.acc -= h; nsub++;
      if (!s.sep && s.h < A.critHeightMm && v > A.porpoiseMinSpeed) s.sep = true; else if (s.sep && (s.h > A.critHeightMm + A.reattachMm || v <= A.porpoiseMinSpeed)) s.sep = false;
      const floorK = floorGain(s.h, s.sep);
      const dyn = q * A.CL * A.areaM2;
      F = dyn * (sh.floor * floorK * floorDmg + sh.frontWing * wingF + sh.rearWing + sh.body);
      s.hEq = setH - F / A.springNPerMm;
      const acc = w * w * (s.hEq - s.h) - 2 * zeta * w * s.hv;
      s.hv += acc * h; s.h += s.hv * h;
      if (s.h < A.minHeightMm) { s.h = A.minHeightMm; s.hv = Math.max(0, s.hv); }
    }
    if (p.bumpMm) s.hv += p.bumpMm * w * 0.5;      // a kerb or a bump kicks the car's ride height
    const stalled = s.sep;
    // Where the downforce is this step, with all the effects.
    const floorK = floorGain(s.h, s.sep), ef = era.aeroEffect || { dragK: 1, downK: 1 };
    const dyn = q * A.CL * A.areaM2;
    const open = s.flap, openDown = 1 - (1 - ef.downK) * open, openDrag = 1 - (1 - ef.dragK) * open;
    const floorF = sh.floor * floorK * floorDmg, frontF = sh.frontWing * wingF * (1 - s.wake), rearF = sh.rearWing, bodyF = sh.body;
    const totalCoef = (floorF + frontF + rearF + bodyF) * openDown;
    const downforceN = dyn * totalCoef;
    const frontPart = floorF * A.frontOfFloor + frontF + bodyF * A.frontOfBody, rearPart = floorF * (1 - A.frontOfFloor) + rearF + bodyF * (1 - A.frontOfBody);
    const frontShare = frontPart / Math.max(1e-6, frontPart + rearPart);
    const cleanFront = floorF * A.frontOfFloor + sh.frontWing * wingF + bodyF * A.frontOfBody;      // what the front axle would have with no wake
    const understeer = clamp((cleanFront - frontPart) / Math.max(1e-6, cleanFront) + 0.3 * (dmg.frontWing || 0), 0, 0.7);
    const cd = A.CD * (1 + A.wingStepDrag * wingStep) * openDrag * (1 + 0.35 * (dmg.frontWing || 0) * 0.5) * (1 - A.wakeDragRelief * clamp(loss / A.dirtyMax, 0, 1));
    const dragN = q * cd * A.areaM2;
    const weight = (p.massKg || 800) * A.G;
    const downK = 1 + A.gripPerLoad * downforceN / weight;
    // Porpoising: how far the ride height is swinging, 0..1 (only meaningful at speed).
    const swing = Math.abs(s.h - s.hEq);
    const target = v > A.porpoiseMinSpeed ? clamp((swing - 0.4) / 4, 0, 1) : 0;
    s.porp += (target - s.porp) * (1 - Math.exp(-dt * 8));
    s.stalled = stalled;
    const out = { downforceN, dragN, downK, understeer, frontLoss: s.wake, frontShare, rideHeightMm: s.h, porpoise: s.porp, stalled, flap: s.flap };
    s.last = out;
    return out;
  }

  // ---- DRS / active-aero zones and the rules for using them

  /// The designated straights of a track: stretches where the curvature stays below a limit for at least 300 m (at most the 3 longest, in
  /// track order). Each is { s0, s1, len, detS }: the distance it starts and ends at, and where the detection point is (150 m before the start).
  function findZones(T) {
    const S = T.S, m = S.length, step = T.step || 4, L = T.length || m * step;
    if (!m) return [];
    const straight = S.map((q) => Math.abs(q.k) < AERO.straightCurv);
    const zones = [];
    let start = -1;
    const n = T.closed ? m * 2 : m;
    for (let i = 0; i <= n; i++) {
      const ok = i < n && straight[i % m];
      if (ok && start < 0) start = i;
      if (!ok && start >= 0) {
        const len = (i - start) * step;
        if (len >= AERO.zoneMinM) zones.push({ i0: start, i1: i - 1, len });
        start = -1;
      }
    }
    // A closed track's straight that crosses the start line shows up twice in the doubled scan: keep each once.
    const seen = new Set(), out = [];
    for (const z of zones.sort((a, b) => b.len - a.len)) {
      const a = z.i0 % m, key = Math.floor(a / 8);
      if (T.closed && (seen.has(key) || seen.has(key - 1) || seen.has(key + 1))) continue;
      if (T.closed && z.i0 >= m) continue;
      seen.add(key);
      const s0 = a * step, s1 = ((z.i1 % m) + 1) * step;
      out.push({ s0, s1: T.closed ? ((s1 % L) + L) % L : s1, len: z.len, detS: T.closed ? (((s0 - AERO.detectBeforeM) % L) + L) % L : Math.max(0, s0 - AERO.detectBeforeM) });
      if (out.length >= AERO.zoneMaxZones) break;
    }
    return out.sort((a, b) => a.s0 - b.s0);
  }
  /// Whether distance `s` along the track is inside one of the zones (a zone may wrap over the start line).
  const inZone = (zones, s) => zones.some((z) => (z.s0 <= z.s1 ? s >= z.s0 && s <= z.s1 : (s >= z.s0 || s <= z.s1)));

  /// 2025 DRS: the flap may open in a DRS zone when the car was within 1.0 s of the car ahead at the detection point, on a green track, after
  /// the first lap, not in the pit lane.
  function drsAllowed(p) {
    return !!(p.zone && p.flagOk !== false && !p.inPit && (p.lap == null || p.lap >= 1) && p.gapAtDetectionS != null && p.gapAtDetectionS >= 0 && p.gapAtDetectionS <= (p.limitS || 1.0));
  }
  /// 2026 active aero: every driver may switch to X-mode (flat wings) on the designated straights whatever the gap, when the track is green
  /// and the car is not in the pit lane.
  function activeAeroAllowed(p) {
    return !!(p.zone && p.flagOk !== false && !p.inPit);
  }
  /// Whether the low-drag wing setting is allowed right now for this era (DRS or X-mode).
  function wingOpenAllowed(era, p) {
    return era && era.aero === 'active' ? activeAeroAllowed(p) : drsAllowed(p);
  }

  const api = { AERO, airDensity, floorFactor, floorGain, dirtyAirLoss, createAero, step, findZones, inZone, drsAllowed, activeAeroAllowed, wingOpenAllowed };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.NotchRaceF1 = root.NotchRaceF1 || {};
  root.NotchRaceF1.aero = api;
})(typeof window !== 'undefined' ? window : globalThis);
