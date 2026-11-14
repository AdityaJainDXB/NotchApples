// F1 modular damage: front-wing endplates that break away (understeer and drag), floor edge damage (a big loss of downforce), sidepod
// intakes blocked by debris (the engine runs hotter and loses power, then fails), and suspension wishbones (terminal: the car is out).
// Each part has its own health; `effects()` turns them into what the other modules need (aero damage, steering pull, engine derate,
// a meatball flag, a retirement). Pure: no DOM, no clock, no randomness (impacts come in with a speed and a place).
//
// ALL TUNABLE NUMBERS ARE IN `DMG` BELOW.
(function (root) {
  'use strict';
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const smooth = (e0, e1, x) => { const t = clamp((x - e0) / (e1 - e0), 0, 1); return t * t * (3 - 2 * t); };

  const DMG = {
    scrapeBelow: 6,             // m/s: slower knocks do nothing
    wingPerMs: 1 / 28,          // front-wing damage per m/s of impact speed over the scrape speed (a 34 m/s nose hit takes the wing off)
    endplateBreaks: 0.5,        // an endplate with this much damage breaks away
    wingBreakAero: 0.7,         // a broken endplate counts as at least this much front-wing damage for the aero
    pullPerWing: 0.35,          // steering pull per unit of one-sided front-wing damage
    kerbMinSpeed: 35,           // m/s: a kerb strike below this does not hurt the floor
    kerbPerStrike: 0.018,       // floor damage per hard kerb strike (scaled by how hard)
    floorPerMs: 1 / 60,         // floor damage per m/s of a heavy impact over the scrape speed
    floorMeatball: 0.6,         // a floor this damaged is loose bodywork
    debrisBlock: 0.12,          // sidepod blockage per piece of debris (1 = a wing's worth)
    blockClearRate: 0.004,      // blockage blown clear per second at 60 m/s (faster when quicker)
    meatballBlock: 0.5,         // blockage that needs a stop to clear
    suspMinSpeed: 14,           // m/s: a wheel hit this hard can bend a wishbone
    suspPerMs: 1 / 36,          // wishbone damage per m/s over that speed
    suspTerminal: 1.0,          // a wishbone this damaged has failed: the car is out
    // Engine cooling
    ambientC: 28,
    heat: 3.7,                  // °C/s of heating at full power
    cool: 0.05,                 // cooling rate (1/s) at the base airflow
    airflow: { base: 0.30, perMs: 0.012 },     // the airflow cooling factor: base + per m/s of speed
    blockCoolLoss: 0.7,         // the share of the airflow a fully blocked sidepod takes away
    derateFrom: 120, derateTo: 145, derateMax: 0.4,       // engine temperature (°C) over which power falls, and by how much at most
    failAt: 155,                // the engine dies at this temperature
    nominalC: 100,
    // Repairs (seconds added to a stop)
    repairSecs: { frontWing: 3.0, floor: 6.0, sidepod: 2.0, suspension: 0 },
  };

  /// A fresh car: all parts perfect, engine at working temperature.
  function create(opt = {}) {
    return { wingL: 0, wingR: 0, endplateL: true, endplateR: true, floor: 0, sidepod: 0, susp: [0, 0, 0, 0], engineC: opt.engineC != null ? opt.engineC : DMG.nominalC, dnf: null, tough: opt.tough || 1, events: [] };
  }
  const pushEv = (s, ev) => { s.events.push(ev); return ev; };

  /// A knock. `a`: speed (m/s, closing speed), zone ('front' | 'rear' | 'left' | 'right'), lateral (−1 left … +1 right: where across the nose, for the wing),
  /// wheel (0..3: which corner took it, if a wheel was hit), wall (true if it was a barrier: harder on the floor and suspension).
  /// Returns the events it caused (also queued in `s.events`).
  function impact(s, a) {
    const D = DMG, evs = [], v = Math.max(0, a.speed - D.scrapeBelow);
    if (v <= 0 || s.dnf) return evs;
    const k = 1 / s.tough;
    if (a.zone === 'front') {
      const lat = clamp(a.lateral || 0, -1, 1), dmg = v * D.wingPerMs * k;
      s.wingL = clamp(s.wingL + dmg * (0.5 - 0.5 * lat + 0.2), 0, 1); s.wingR = clamp(s.wingR + dmg * (0.5 + 0.5 * lat + 0.2), 0, 1);
      if (s.endplateL && s.wingL >= D.endplateBreaks) { s.endplateL = false; evs.push(pushEv(s, { type: 'endplate', side: 'L' })); }
      if (s.endplateR && s.wingR >= D.endplateBreaks) { s.endplateR = false; evs.push(pushEv(s, { type: 'endplate', side: 'R' })); }
    }
    if (a.speed > D.kerbMinSpeed * 0.6 && (a.wall || a.speed > 25)) {
      const before = s.floor; s.floor = clamp(s.floor + v * D.floorPerMs * k * (a.wall ? 1 : 0.6), 0, 1);
      if (s.floor > before + 0.05) evs.push(pushEv(s, { type: 'floor', amount: s.floor - before }));
    }
    if (a.speed > D.suspMinSpeed + D.scrapeBelow - 6 && (a.wheel != null || a.wall)) {
      const idx = a.wheel != null ? a.wheel : (a.zone === 'front' ? (a.lateral > 0 ? 1 : 0) : a.zone === 'rear' ? (a.lateral > 0 ? 3 : 2) : (a.zone === 'left' ? 0 : 1)), dmg = Math.max(0, a.speed - D.suspMinSpeed) * D.suspPerMs * k;
      if (dmg > 0) { s.susp[idx] = clamp(s.susp[idx] + dmg, 0, 1); evs.push(pushEv(s, { type: 'suspension', wheel: idx, amount: dmg }));
        if (s.susp[idx] >= D.suspTerminal && !s.dnf) { s.dnf = 'suspension'; evs.push(pushEv(s, { type: 'dnf', why: 'suspension failure' })); } }
    }
    return evs;
  }
  /// A hard kerb strike at speed (m/s): wears the floor edge a little. `hard` 0..1 is how violent the kerb was.
  function kerb(s, speed, hard = 1) {
    if (s.dnf || speed < DMG.kerbMinSpeed) return 0;
    const d = DMG.kerbPerStrike * clamp(hard, 0, 1) * (speed / 80) / s.tough; s.floor = clamp(s.floor + d, 0, 1); return d;
  }
  /// Debris picked up: blocks the sidepod intakes (`pieces` of 1 each).
  function debris(s, pieces = 1) {
    s.sidepod = clamp(s.sidepod + DMG.debrisBlock * pieces, 0, 1);
    return pushEv(s, { type: 'debris', blockage: s.sidepod });
  }

  /// One step: the engine's temperature (from the power it is making, the airflow and any blockage), the blockage blowing clear, and a
  /// failed engine. `iceFraction` 0..1 is the power the combustion engine is making; `v` is speed in m/s.
  function step(s, p, dt) {
    const D = DMG, v = Math.max(0, p.v || 0), amb = p.ambientC != null ? p.ambientC : D.ambientC;
    s.sidepod = Math.max(0, s.sidepod - D.blockClearRate * Math.min(2, v / 60) * dt);
    const flow = (D.airflow.base + D.airflow.perMs * v) * (1 - D.blockCoolLoss * s.sidepod);
    const heat = D.heat * clamp(p.iceFraction == null ? 1 : p.iceFraction, 0, 1.2) + 0.25;
    s.engineC += (heat - D.cool * flow * (s.engineC - amb)) * dt;
    s.engineC = clamp(s.engineC, amb, 220);
    if (s.engineC >= D.failAt && !s.dnf) { s.dnf = 'engine'; pushEv(s, { type: 'dnf', why: 'engine failure' }); }
    return s.engineC;
  }

  /// What the damage does to the car right now.
  /// { aero: { frontWing, floor }, pull, derate, coolingK, needsPit (the meatball flag), meatballWhy, dnf, tooHot }
  function effects(s) {
    const D = DMG;
    const wingAvg = (s.wingL + s.wingR) / 2, broken = (!s.endplateL ? 1 : 0) + (!s.endplateR ? 1 : 0);
    const frontWing = clamp(Math.max(wingAvg, broken ? D.wingBreakAero * (broken === 2 ? 1.2 : 1) * 0.8 : 0), 0, 1);
    const pull = clamp((s.wingR - s.wingL) * D.pullPerWing, -0.4, 0.4);
    const derate = 1 - D.derateMax * smooth(D.derateFrom, D.derateTo, s.engineC);
    const susp = Math.max(...s.susp);
    let why = null;
    if (!s.endplateL || !s.endplateR) why = 'a broken front wing endplate';
    else if (s.floor >= D.floorMeatball) why = 'floor damage';
    else if (s.sidepod >= D.meatballBlock) why = 'debris in the sidepod';
    else if (s.engineC >= D.derateTo) why = 'engine overheating';
    else if (susp >= 0.7) why = 'suspension damage';
    return { aero: { frontWing, floor: s.floor }, pull: pull + (s.susp[0] + s.susp[2] - s.susp[1] - s.susp[3]) * 0.1, derate: s.dnf === 'engine' ? 0 : derate, coolingK: 1 - D.blockCoolLoss * s.sidepod,
      needsPit: !!why && !s.dnf, meatballWhy: why, dnf: s.dnf, tooHot: s.engineC > D.derateFrom, suspension: susp };
  }
  /// The seconds a pit stop adds to repair what is damaged (a new front wing, floor repair, clearing the intakes).
  function repairTime(s) {
    const R = DMG.repairSecs; let t = 0;
    if (s.wingL > 0.05 || s.wingR > 0.05 || !s.endplateL || !s.endplateR) t += R.frontWing;
    if (s.floor > 0.1) t += R.floor * s.floor + 1;
    if (s.sidepod > 0.05) t += R.sidepod;
    return t;
  }
  /// Fix what a stop can fix: any of 'frontWing', 'floor', 'sidepod' (the suspension cannot be repaired).
  function repair(s, parts = ['frontWing', 'floor', 'sidepod']) {
    if (s.dnf) return false;
    if (parts.includes('frontWing')) { s.wingL = s.wingR = 0; s.endplateL = s.endplateR = true; }
    if (parts.includes('floor')) s.floor = 0;
    if (parts.includes('sidepod')) s.sidepod = 0;
    return true;
  }
  const drainEvents = (s) => s.events.splice(0, s.events.length);

  const api = { DMG, create, impact, kerb, debris, step, effects, repairTime, repair, drainEvents };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.NotchRaceF1 = root.NotchRaceF1 || {};
  root.NotchRaceF1.damage = api;
})(typeof window !== 'undefined' ? window : globalThis);
