// F1 regulation eras: one config object says which rules the simulation follows. 2025 is the ground-effect / DRS ruleset;
// 2026 is the active-aero (Z-mode / X-mode) ruleset with the 50/50 hybrid split. Every other F1 module reads its numbers from here,
// so switching the era changes aero, power unit and energy rules in one place. Pure data and tiny helpers: no DOM, no clock, no randomness.
//
// ALL TUNABLE NUMBERS ARE IN `ERAS` BELOW.
(function (root) {
  'use strict';

  const ERAS = {
    ERA_2025: {
      id: '2025', name: '2025 · ground effect + DRS',
      aero: 'drs',                      // 'drs' = a rear flap that opens in DRS zones; 'active' = Z/X mode on the designated straights
      massKg: 800,                      // car + driver, no fuel (minimum weight)
      iceKw: 560, mguKw: 120,           // combustion engine and MGU-K peak power (kW)
      batteryMJ: 4.0,                   // usable energy store swing (MJ)
      harvestCapMJ: 4.0,                // most the MGU-K may harvest in a lap (MJ)
      deployFullKmh: 350, deployZeroKmh: 350,   // electrical deployment is flat to this speed (no taper)
      overtakeMode: false,              // no manual-override boost in this era
      aeroEffect: { dragK: 0.78, downK: 0.88 },  // DRS open: drag and downforce multipliers
      detectionGapS: 1.0,               // DRS: within this gap at the detection point
      fuelStartKg: 110,                 // fuel limit for a full race distance (kg)
    },
    ERA_2026: {
      id: '2026', name: '2026 · active aero + 50/50 hybrid',
      aero: 'active',
      massKg: 768,
      iceKw: 400, mguKw: 350,
      batteryMJ: 4.0,
      harvestCapMJ: 8.5,
      deployFullKmh: 290, deployZeroKmh: 345,   // deployment tapers from 290 km/h to nothing at 345 km/h
      overtakeMode: true,
      aeroEffect: { dragK: 0.68, downK: 0.62 }, // X-mode: both wings flat: much less drag, much less downforce
      detectionGapS: 1.0,               // Overtake Mode: within this gap of the car ahead
      fuelStartKg: 70,                  // the 2026 cars carry much less fuel (the battery does more of the work)
    },
  };

  const DEFAULT = 'ERA_2025';

  /// The era for a name ('ERA_2025', '2025', 2025, 'era_2026'...). Anything unknown gives the default.
  function getEra(id) {
    const k = String(id == null ? '' : id).toUpperCase();
    if (ERAS[k]) return ERAS[k];
    for (const key of Object.keys(ERAS)) if (ERAS[key].id === String(id)) return ERAS[key];
    return ERAS[DEFAULT];
  }
  const isActiveAero = (era) => getEra(era && era.id ? era.id : era).aero === 'active';
  const list = () => Object.keys(ERAS).map((k) => ERAS[k]);

  const api = { ERAS, DEFAULT, getEra, isActiveAero, list };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.NotchRaceF1 = root.NotchRaceF1 || {};
  root.NotchRaceF1.era = api;
})(typeof window !== 'undefined' ? window : globalThis);
