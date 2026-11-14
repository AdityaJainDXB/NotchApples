// F1 power unit: the combustion engine (ICE) and the MGU-K hybrid motor, the battery's state of charge (SoC, in MJ), how it is harvested
// (braking, lift-and-coast, super clipping) and spent, the 2026 Overtake Mode (manual override), and the fuel load and its weight.
// Reads its era (power split, harvest cap, deployment taper) from era.js. Pure: no DOM, no clock, no randomness.
//
// ALL TUNABLE NUMBERS ARE IN `PU` BELOW.
(function (root) {
  'use strict';
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const KMH = 3.6;

  const PU = {
    refKw: 650,                 // the total power the F1 car's base acceleration is quoted at (a 2025 car deploying 80 % of its MGU-K)
    refMassKg: 880,             // the car's mass at that reference (car + driver + a mid-race fuel load)
    storeEff: 0.90,             // fraction of harvested energy that ends up in the battery
    startSoc: 0.8,              // battery at the start, as a fraction of its capacity
    modes: { LOW: 0.5, MEDIUM: 0.8, HIGH: 1.0 },     // ERS deployment modes: the share of the MGU-K's peak power used on the throttle
    brakeRegenKw: 1.0,          // braking harvest, as a share of the MGU-K's peak power (at full brake)
    liftCoastShare: 0.35,       // lift and coast harvest, as a share of the MGU-K's peak power
    clipShare: 0.55,            // super clipping: harvest at full throttle at the end of a straight, share of the MGU-K's peak power
    clipKmh: 300,               // super clipping starts above this speed on full throttle
    clipMaxSoc: 0.97,           // clipping stops when the battery is this full
    liftMinKmh: 90,             // lift and coast only above this speed
    overtakeGapS: 1.0,          // Overtake Mode: within this gap of the car ahead
    overtakeMinKmh: 290,        // ... and it matters above this speed (where the car in front's deployment tapers off)
    overtakeExtraKmh: 45,       // Overtake Mode pushes the deployment taper this much higher (km/h)
    overtakeBoostSoc: 0.0,      // Overtake Mode needs at least this much battery
    // Fuel
    flowKgPerKwS: 0.0000496,    // fuel burned per second per kW of combustion power (100 kg/h at about 560 kW)
    mixes: { RICH: { power: 1.03, flow: 1.12 }, STD: { power: 1, flow: 1 }, LEAN: { power: 0.965, flow: 0.88 } },
    vmaxPower: 1 / 3,           // top speed grows with the cube root of power over drag
    accelPower: 1.0,            // acceleration grows linearly with power
    minAccelK: 0.25, maxAccelK: 1.6, minVmaxK: 0.7, maxVmaxK: 1.25,
  };

  /// The share of the MGU-K's power available at a speed (m/s): full up to `deployFullKmh`, then tapering to nothing at `deployZeroKmh`;
  /// with Overtake Mode the taper starts and ends 45 km/h higher.
  function deployTaper(era, v, overtake) {
    const kmh = v * KMH, ex = overtake ? PU.overtakeExtraKmh : 0;
    const a = era.deployFullKmh + ex, b = era.deployZeroKmh + ex;
    if (kmh <= a) return 1;
    if (b <= a) return kmh <= b ? 1 : 0;
    return clamp(1 - (kmh - a) / (b - a), 0, 1);
  }

  /// Fresh power unit state for an era with `fuelKg` aboard.
  function createPU(era, opt = {}) {
    return { soc: era.batteryMJ * (opt.soc != null ? opt.soc : PU.startSoc), lapHarvest: 0, lapDeployed: 0, fuel: opt.fuelKg != null ? opt.fuelKg : era.fuelStartKg, mode: opt.mode || 'MEDIUM', mix: opt.mix || 'STD',
      clipping: false, overtake: false, last: null, harvestedTotal: 0, deployedTotal: 0 };
  }
  const newLap = (s) => { s.lapHarvest = 0; s.lapDeployed = 0; };
  const massOf = (era, s) => era.massKg + Math.max(0, s.fuel);

  /// Whether Overtake Mode may be used now: this era has it, the car is within a second of the one ahead, going fast enough, with some charge.
  function overtakeEligible(era, p, s) {
    return !!(era.overtakeMode && p.gapAheadS != null && p.gapAheadS >= 0 && p.gapAheadS <= PU.overtakeGapS && !p.inPit && p.flagOk !== false && s.soc / era.batteryMJ > PU.overtakeBoostSoc);
  }

  /// One step. `p`: era, v (m/s), throttle, brake (0..1), derate (0..1, engine health/heat, default 1), gapAheadS, overtakeWanted, inPit, flagOk.
  /// Returns { iceKw, deployKw, harvestKw, netKw, accelK, vmaxK, massKg, clipping, overtakeActive, regenAvailable, socFraction }.
  function step(s, p, dt) {
    const era = p.era, v = Math.max(0, p.v || 0), kmh = v * KMH, thr = clamp(p.throttle || 0, 0, 1), brk = clamp(p.brake || 0, 0, 1);
    const mix = PU.mixes[s.mix] || PU.mixes.STD, derate = p.derate == null ? 1 : clamp(p.derate, 0, 1);
    const cap = era.batteryMJ, mguKw = era.mguKw;
    const eligible = overtakeEligible(era, p, s), overtake = !!(p.overtakeWanted && eligible && kmh > PU.overtakeMinKmh * 0.6);
    s.overtake = overtake;
    // Harvest: braking, lift-and-coast and super clipping, until the lap's cap or the battery's top.
    const room = Math.max(0, cap - s.soc), capLeft = Math.max(0, era.harvestCapMJ - s.lapHarvest);
    let harvestKw = 0, clipping = false;
    if (brk > 0.05 && kmh > 40) harvestKw = mguKw * PU.brakeRegenKw * brk;
    else if (thr < 0.05 && brk < 0.05 && kmh > PU.liftMinKmh) harvestKw = mguKw * PU.liftCoastShare;
    else if (thr > 0.97 && kmh > PU.clipKmh && s.soc / cap < PU.clipMaxSoc && s.mode !== 'HIGH' && !overtake) { harvestKw = mguKw * PU.clipShare; clipping = true; }
    if (capLeft <= 0 || room <= 0 || p.inPit) { harvestKw = 0; clipping = false; }
    let harvestMJ = harvestKw * dt / 1000 * PU.storeEff;
    if (harvestMJ > capLeft) { harvestMJ = capLeft; harvestKw = harvestMJ * 1000 / dt / PU.storeEff; }
    if (harvestMJ > room) { harvestMJ = room; harvestKw = harvestMJ * 1000 / dt / PU.storeEff; }
    s.soc += harvestMJ; s.lapHarvest += harvestMJ; s.harvestedTotal += harvestMJ;
    // Deploy on the throttle (not while harvesting at full throttle in a clip): the share set by the ERS mode, tapering with speed.
    let deployKw = 0;
    const modeK = overtake ? 1 : (PU.modes[s.mode] != null ? PU.modes[s.mode] : PU.modes.MEDIUM);
    if (thr > 0.02 && s.soc > 0 && !clipping) {
      deployKw = mguKw * modeK * deployTaper(era, v, overtake) * thr;
      const need = deployKw * dt / 1000;
      if (need > s.soc) { deployKw *= s.soc / need; s.soc = 0; } else s.soc -= need;
      s.lapDeployed += deployKw * dt / 1000; s.deployedTotal += deployKw * dt / 1000;
    }
    // Power at the wheels at full throttle, which sets how hard the car can accelerate and how fast it can go.
    const ice = era.iceKw * mix.power * derate;
    const fullDeploy = (s.soc > 0 && !clipping) ? mguKw * modeK * deployTaper(era, v, overtake) : 0;
    const clipLoss = clipping ? harvestKw / PU.storeEff : 0;
    const netFull = Math.max(0, ice + fullDeploy - clipLoss);
    // Fuel burned (more the harder the throttle).
    s.fuel = Math.max(0, s.fuel - PU.flowKgPerKwS * era.iceKw * mix.power * mix.flow * thr * derate * dt);
    const mass = massOf(era, s);
    const accelK = clamp(Math.pow(netFull / PU.refKw, PU.accelPower) * (PU.refMassKg / mass), PU.minAccelK, PU.maxAccelK);
    const vmaxK = clamp(Math.pow(netFull / PU.refKw, PU.vmaxPower), PU.minVmaxK, PU.maxVmaxK);
    s.clipping = clipping;
    const out = { iceKw: ice * thr, deployKw, harvestKw, netKw: ice * thr + deployKw - clipLoss * thr, netFullKw: netFull, accelK, vmaxK, massKg: mass, fuelKg: s.fuel, clipping, overtakeActive: overtake, overtakeEligible: eligible, regenAvailable: capLeft > 0 && room > 0, socFraction: s.soc / cap };
    s.last = out;
    return out;
  }

  /// Fuel needed for `laps` laps of `lapKm`, burning at the average throttle `avgThrottle`, with a margin (kg).
  function fuelFor(era, laps, lapSeconds, avgThrottle = 0.62, marginKg = 1.5) {
    return Math.min(era.fuelStartKg, laps * lapSeconds * PU.flowKgPerKwS * era.iceKw * avgThrottle + marginKg);
  }
  /// How many laps of fuel are left against what the race still needs (positive is spare, negative means he will run dry): the engineer's "fuel delta".
  function fuelDeltaLaps(fuelKg, lapsLeft, kgPerLap) {
    return kgPerLap > 0 ? fuelKg / kgPerLap - lapsLeft : 99;
  }

  const api = { PU, deployTaper, createPU, newLap, massOf, overtakeEligible, step, fuelFor, fuelDeltaLaps };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.NotchRaceF1 = root.NotchRaceF1 || {};
  root.NotchRaceF1.powerunit = api;
})(typeof window !== 'undefined' ? window : globalThis);
