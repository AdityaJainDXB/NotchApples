// The per-car Formula One simulation: one object that holds a car's aero, power unit, fuel, tyres and damage, steps them together once per
// physics step, and hands the game the handful of multipliers it needs (power, top speed, grip, downforce, understeer, snap oversteer, steering
// pull, retirement). The game's own car physics stays in racing.js; this only says what the F1 systems do to it. Pure: no DOM, no clock.
//
// ALL TUNABLE NUMBERS ARE IN `SIM` BELOW (the physics constants are at the top of each module).
(function (root) {
  'use strict';
  const NS = root.NotchRaceF1 = root.NotchRaceF1 || {};
  const dep = (name) => NS[name] || (typeof require !== 'undefined' ? require('./' + name + '.js') : null);
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

  const SIM = {
    G: 9.81,
    altitudeM: 0, ambientC: 28, trackDeltaC: 12,      // defaults when the track gives none
    defaultSetup: { rideHeightMm: 34, frontWing: 0, brakeBias: 56, diffOnThrottle: 70, diffOffThrottle: 60, pressureFront: 0, pressureRear: 0, ersMode: 'MEDIUM', mix: 'STD' },
    refCdRatio: 1.0,            // the drag the base car's top speed is quoted at (1 = the aero module's closed-wing car at the reference)
    brakeBiasIdeal: 57,         // the brake bias (% front) that locks neither axle first
    brakeBiasGripLoss: 0.012,   // grip lost (front tyres with too much bias, rears with too little) per % of bias away from ideal
    diffRotation: 0.0012,       // how much a tighter diff on throttle helps traction and costs turn-in, per % over 70
    latGLimit: 6,               // clamp for the lateral g fed to the tyres
    kerbMm: 3.5,                // a kerb strike's push on the ride height
    refDragCd: 0.8,             // the CD the aero module's base car has
  };

  /// A new car. `opt`: era (config), compound, setup {…}, fuelKg, tough, altitudeM, ambientC.
  function create(opt = {}) {
    const era = opt.era || dep('era').getEra('2025'), aero = dep('aero'), pu = dep('powerunit'), ty = dep('tyres'), dm = dep('damage');
    const setup = Object.assign({}, SIM.defaultSetup, opt.setup || {});
    const sim = {
      era, setup, altitudeM: opt.altitudeM != null ? opt.altitudeM : SIM.altitudeM, ambientC: opt.ambientC != null ? opt.ambientC : SIM.ambientC,
      aero: aero.createAero(setup), pu: pu.createPU(era, { fuelKg: opt.fuelKg, mode: setup.ersMode, mix: setup.mix }), tyres: ty.createSet(opt.compound || 'M', opt.tyre), dmg: dm.create({ tough: opt.tough }),
      lap: 0, mods: null, wingOpen: false, stops: 0, used: [opt.compound || 'M'], kerbT: 0, alerts: [],
    };
    sim.mods = neutral(sim);
    return sim;
  }
  const neutral = (sim) => ({ accelK: 1, vmaxK: 1, gripK: 1, downK: 1, understeer: 0, snap: 0, pull: 0, dnf: null, engineDead: false, needsPit: false, meatballWhy: null, porpoise: 0, rideHeightMm: sim.setup.rideHeightMm, flap: 0, overtakeActive: false, clipping: false, soc: sim.pu.soc, socFraction: sim.pu.soc / sim.era.batteryMJ, fuelKg: sim.pu.fuel, derate: 1, massKg: sim.era.massKg + sim.pu.fuel, tyreState: 'ok', life: 1, carcass: [], surface: [], wearCliff: false, blistering: 0, graining: 0, engineC: 100, downforceN: 0, dragN: 0, brakeK: 1 });

  /// One physics step. `p`: v, vf (signed forward speed), vl (sideways speed), yaw (rad/s), throttle, brake, steer (−1..1), gapAheadS (seconds to the
  /// car ahead, or null), wingOpenWanted, wingOpenAllowed (the rules say the flap / X-mode may open), overtakeWanted, inPit, flagOk, wet (0..1),
  /// trackK (track grip from rubber, default 1), trackC, kerb (the car is on a kerb), dt via the argument.
  function step(sim, p, dt) {
    const S = SIM, aero = dep('aero'), pu = dep('powerunit'), ty = dep('tyres'), dm = dep('damage'), era = sim.era;
    const v = Math.max(0, Math.abs(p.vf != null ? p.vf : p.v || 0)), thr = clamp(p.throttle || 0, 0, 1), brk = clamp(p.brake || 0, 0, 1);
    const rho = aero.airDensity(sim.altitudeM, sim.ambientC), mass = pu.massOf(era, sim.pu);
    const fx = dm.effects(sim.dmg);
    // The wings open only if the rules allow it, the driver wants it, and he is not braking.
    const open = !!(p.wingOpenWanted && p.wingOpenAllowed && brk < 0.05 && thr > 0.5);
    sim.wingOpen = open;
    // A kerb strike: counted once when the car hits it (not every step it is on it), then not again for a moment.
    let bump = 0;
    sim.kerbT = Math.max(0, (sim.kerbT || 0) - dt);
    if (p.kerb && v > 30 && sim.kerbT <= 0) { sim.kerbT = 0.6; bump = S.kerbMm * Math.min(1, v / 70); dm.kerb(sim.dmg, v, Math.min(1, v / 80)); }
    const a = aero.step(sim.aero, { v, rho, massKg: mass, setup: sim.setup, era, open, gapS: p.gapAheadS, damage: fx.aero, bumpMm: bump }, dt);
    // The power unit: the engine's heat and any damage take power away; Overtake Mode / the ERS mode come from the driver.
    sim.pu.mode = sim.setup.ersMode || sim.pu.mode; sim.pu.mix = sim.setup.mix || sim.pu.mix;
    const w = pu.step(sim.pu, { era, v, throttle: thr, brake: brk, derate: fx.derate, gapAheadS: p.gapAheadS, overtakeWanted: p.overtakeWanted, inPit: p.inPit, flagOk: p.flagOk }, dt);
    dm.step(sim.dmg, { v, iceFraction: era.iceKw > 0 ? (w.iceKw / era.iceKw) : 0, ambientC: sim.ambientC }, dt);
    // Tyres: heated by what the car is doing, with the dirty air on the front.
    const latG = clamp(Math.abs((p.yaw || 0) * v) / S.G, 0, S.latGLimit), dirty = clamp(a.frontLoss / 0.35, 0, 1);
    const t = ty.step(sim.tyres, { v, latG, steer: p.steer || 0, brake: brk, throttle: thr, slip: p.vl || 0, ambientC: sim.ambientC, trackC: p.trackC != null ? p.trackC : sim.ambientC + S.trackDeltaC, wet: p.wet || 0, dirty, dirtyHeat: aero.AERO.frontSurfaceHeat, massRatio: mass / era.massKg,
      pressure: { front: sim.setup.pressureFront, rear: sim.setup.pressureRear } }, dt);
    // Brake bias: too far forward locks the fronts (they lose grip under braking), too far back the rears.
    const bbErr = (sim.setup.brakeBias - S.brakeBiasIdeal) * S.brakeBiasGripLoss;
    const brakeK = 1 - Math.min(0.15, Math.abs(bbErr)) * brk;
    // The differential: a tighter one on throttle helps traction (power oversteer less) and costs a little turn-in.
    const diff = (sim.setup.diffOnThrottle - 70) * S.diffRotation;
    const dragRel = clamp((a.dragN / Math.max(1e-6, 0.5 * rho * v * v * S.refDragCd * aero.AERO.areaM2)) / S.refCdRatio, 0.5, 1.5);
    const vmaxK = clamp(Math.pow(Math.max(0.05, w.netFullKw / pu.PU.refKw) / dragRel, 1 / 3), pu.PU.minVmaxK, pu.PU.maxVmaxK);
    const down = Math.max(1, a.downK);
    const gripK = t.grip * clamp(p.trackK == null ? 1 : p.trackK, 0.7, 1.2) * brakeK;
    const understeer = clamp(a.understeer - diff * 0.3, 0, 0.7);
    const out = sim.mods = {
      accelK: w.accelK, vmaxK, gripK, downK: down, understeer, snap: clamp(t.snap + Math.max(0, diff) * 0.2, 0, 1), pull: fx.pull, dnf: fx.dnf, engineDead: fx.dnf === 'engine', needsPit: fx.needsPit, meatballWhy: fx.meatballWhy,
      porpoise: a.porpoise, rideHeightMm: a.rideHeightMm, flap: a.flap, overtakeActive: w.overtakeActive, overtakeEligible: w.overtakeEligible, clipping: w.clipping, soc: sim.pu.soc, socFraction: w.socFraction, fuelKg: sim.pu.fuel, derate: fx.derate, massKg: mass,
      tyreState: t.state, life: t.life, carcass: sim.tyres.w.map((x) => x.Tc), surface: sim.tyres.w.map((x) => x.Ts), wearCliff: t.cliff, blistering: t.blistering, graining: t.graining, engineC: sim.dmg.engineC, downforceN: a.downforceN, dragN: a.dragN,
      harvestKw: w.harvestKw, deployKw: w.deployKw, regenAvailable: w.regenAvailable, brakeK, stalled: a.stalled, frontLoss: a.frontLoss, netKw: w.netKw, lapHarvest: sim.pu.lapHarvest, window: t.window,
    };
    return out;
  }

  /// A knock (see damage.impact). Returns the events (an endplate coming off, a failure...).
  function onImpact(sim, a) { return dep('damage').impact(sim.dmg, a); }
  /// Crossing the line: the lap's energy allowance starts again.
  function newLap(sim) { sim.lap++; dep('powerunit').newLap(sim.pu); }
  /// A pit stop: fit a new set (a compound letter) and/or repair parts. Returns the extra seconds the repairs take.
  function pitStop(sim, o = {}) {
    const ty = dep('tyres'), dm = dep('damage');
    let extra = 0;
    if (o.repair !== false) { extra = dm.repairTime(sim.dmg); dm.repair(sim.dmg, o.parts); }
    if (o.compound) { sim.tyres = ty.createSet(o.compound, { startC: o.startC != null ? o.startC : 80 }); if (!sim.used.includes(o.compound)) sim.used.push(o.compound); }
    sim.stops++;
    return extra;
  }
  /// A setup change (the MFD and the garage): returns the value actually set, within its limits.
  function setSetup(sim, key, val, limits) {
    const lim = (limits || {})[key];
    const v = typeof val === 'number' && lim ? clamp(val, lim[0], lim[1]) : val;
    sim.setup[key] = v;
    return v;
  }

  const api = { SIM, create, step, onImpact, newLap, pitStop, setSetup };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  NS.sim = api;
})(typeof window !== 'undefined' ? window : globalThis);
