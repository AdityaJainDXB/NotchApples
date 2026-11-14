// F1 track evolution: a "green" track starts dusty and slow; rubber laid down along the racing line adds grip (about +3 to +5 %) as the weekend goes on;
// rain washes the rubber away and leaves a wet track where the racing line dries first and the off-line is slow, with slick-wet kerbs. Also a
// seeded weather timeline and a "radar" the race engineer can read. Pure: no DOM, no clock; randomness only through a seed passed in.
//
// ALL TUNABLE NUMBERS ARE IN `EVO` BELOW.
(function (root) {
  'use strict';
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

  const EVO = {
    cellM: 20,                  // length of a track cell (m)
    lanes: 11,                  // cells across the road
    greenGrip: 0.97,            // grip of a track nobody has driven on (1 = the track fully rubbered in, off the line)
    rubberBonus: 0.05,          // grip a fully rubbered line adds (+5 %; ≈ +3 to +5 % between a green and a rubbered-in track)
    depositRate: 0.0006,        // rubber laid per metre driven over a cell (each pass adds this fraction of what is still missing)
    depositMinSpeed: 25,        // m/s: a slow car lays nothing
    slideDeposit: 1.8,          // a sliding tyre lays more rubber (and wears the line)
    offLineDust: 0.012,         // grip an unrubbered cell loses to dust off the line
    // Rain
    rainWash: 0.012,            // rubber washed off per second at full rain (fraction of what is there)
    wetRise: 0.08,              // how fast a cell gets wet in full rain (per second)
    dryBase: 0.0035,            // drying rate per second when it is not raining
    dryOnLine: 2.6,             // the racing line dries this many times faster (rubber and heat)
    dryByCars: 0.004,           // cars driving over a cell dry it a little more (per second per unit of speed share)
    puddleOffLine: 0.28,        // off the line the water is deeper by this much when it is wet
    kerbWetGrip: 0.55,          // a kerb in the wet grips this much of the road
    kerbWetFrom: 0.2,           // wetness at which the kerbs turn slick
    // Weather timeline
    rainChance: 0.45, rainMinS: 90, rainMaxS: 360, dryMinS: 120, dryMaxS: 420, rainPeak: [0.35, 1],
    radarError: 0.12,           // the engineer's radar is this far out about intensity
  };

  /// A fresh (green) track of `length` metres and `width`.
  function create(length, width) {
    const n = Math.max(2, Math.ceil(length / EVO.cellM)), cells = n * EVO.lanes;
    return { length, width, n, rubber: new Float32Array(cells), wet: new Float32Array(cells), rain: 0, laps: 0, passes: 0 };
  }
  const idx = (E, s, lat) => {
    const i = ((Math.floor((((s % E.length) + E.length) % E.length) / EVO.cellM)) % E.n + E.n) % E.n;
    const j = clamp(Math.floor((lat / E.width + 0.5) * EVO.lanes), 0, EVO.lanes - 1);
    return i * EVO.lanes + j;
  };

  /// A car drove over (s, lat) at speed v for dt seconds: it lays rubber if the track is dry enough.
  function deposit(E, s, lat, v, dt, o = {}) {
    if (v < EVO.depositMinSpeed) return;
    const k = idx(E, s, lat);
    if (E.wet[k] > 0.25) return;
    const slide = o.slide ? EVO.slideDeposit : 1, add = EVO.depositRate * v * dt * slide * (1 - E.wet[k] * 2);
    E.rubber[k] = Math.min(1, E.rubber[k] + (1 - E.rubber[k]) * add);
    if (E.wet[k] > 0) E.wet[k] = Math.max(0, E.wet[k] - EVO.dryByCars * Math.min(1, v / 60) * dt * (1 + E.rubber[k]));
  }

  /// The weather and the track's drying and washing over `dt`. rain: how hard it is raining now (0..1).
  function step(E, dt, rain) {
    E.rain = clamp(rain || 0, 0, 1);
    const R = EVO;
    for (let i = 0; i < E.n; i++) for (let j = 0; j < R.lanes; j++) {
      const k = i * R.lanes + j, mid = Math.abs(j - (R.lanes - 1) / 2) / ((R.lanes - 1) / 2);       // 0 in the middle, 1 at the edge
      if (E.rain > 0.02) {
        E.rubber[k] = Math.max(0, E.rubber[k] * (1 - R.rainWash * E.rain * dt));
        const target = clamp(E.rain * (1 + R.puddleOffLine * mid), 0, 1);
        if (E.wet[k] < target) E.wet[k] = Math.min(target, E.wet[k] + R.wetRise * E.rain * dt);
        else E.wet[k] = Math.max(target, E.wet[k] - R.dryBase * 0.5 * dt);
      } else if (E.wet[k] > 0) {
        E.wet[k] = Math.max(0, E.wet[k] - R.dryBase * (1 + (R.dryOnLine - 1) * E.rubber[k]) * dt * (1 - 0.35 * mid));
      }
    }
  }

  /// The grip at a place on the track. Returns { dry, wet, kerb, rubber, trackK }: `dry` the multiplier from the rubber (green, rubbered, dusty off the line),
  /// `wet` the local wetness 0..1 (for the tyre's wet grip), `kerb` the extra factor on a kerb in the wet, and `trackK` all of it together for a slick on a dry track.
  function gripAt(E, s, lat, o = {}) {
    const k = idx(E, s, lat), rub = E.rubber[k], wet = E.wet[k];
    const dust = EVO.offLineDust * (1 - rub) * (Math.abs(lat) > E.width * 0.28 ? 1 : 0.4);
    const dry = EVO.greenGrip + EVO.rubberBonus * rub - dust;
    const onKerb = !!o.kerb;
    const kerb = onKerb && wet > EVO.kerbWetFrom ? EVO.kerbWetGrip : 1;
    return { dry, wet, kerb, rubber: rub, trackK: dry * kerb };
  }
  /// The track's average rubber (0..1) and how much of it is wet: for the HUD and the engineer.
  function summary(E) {
    let r = 0, w = 0; const lane = new Float64Array(EVO.lanes);
    for (let i = 0; i < E.n; i++) for (let j = 0; j < EVO.lanes; j++) { const k = i * EVO.lanes + j; r += E.rubber[k]; w += E.wet[k]; lane[j] += E.rubber[k]; }
    const c = E.n * EVO.lanes, line = Math.max(...lane) / E.n;          // the line: the lane with the most rubber all the way round
    return { rubber: r / c, lineRubber: line, wet: w / c, rain: E.rain, gripGain: EVO.rubberBonus * line };
  }
  /// Save and load the track's state (it carries over between the sessions of a weekend).
  const serialize = (E) => JSON.stringify({ length: E.length, width: E.width, rubber: Array.from(E.rubber, (v) => Math.round(v * 1000) / 1000), wet: Array.from(E.wet, (v) => Math.round(v * 1000) / 1000), rain: E.rain });
  function load(text, length, width) {
    try { const o = JSON.parse(text), E = create(length, width); if (o && Array.isArray(o.rubber) && o.rubber.length === E.rubber.length && Math.abs(o.length - length) < 1) { E.rubber.set(o.rubber); E.wet.set(o.wet || []); E.rain = o.rain || 0; return E; } } catch { /* fall through */ }
    return create(length, width);
  }

  // ---- weather

  /// A small deterministic random generator from a seed (mulberry32).
  function rng(seed) { let a = (seed >>> 0) || 1; return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
  /// A weather timeline for `durationS` seconds: [{ from, to, rain }]. `mode`: 'dry' (never), 'mixed' (showers), 'wet' (rain most of the time).
  function makeWeather(seed, durationS, mode = 'mixed') {
    const r = rng(seed), out = []; let t = 0;
    if (mode === 'dry') return [{ from: 0, to: Math.max(1, durationS), rain: 0 }];
    let raining = mode === 'wet' ? true : r() < EVO.rainChance * 0.5;
    while (t < durationS) {
      const len = raining ? EVO.rainMinS + r() * (EVO.rainMaxS - EVO.rainMinS) : EVO.dryMinS + r() * (EVO.dryMaxS - EVO.dryMinS);
      const peak = EVO.rainPeak[0] + r() * (EVO.rainPeak[1] - EVO.rainPeak[0]);
      out.push({ from: t, to: t + len, rain: raining ? (mode === 'wet' ? Math.max(0.5, peak) : peak) : 0 });
      t += len; raining = mode === 'wet' ? r() < 0.85 : !raining;
    }
    return out;
  }
  /// The rain at time t on a timeline (eased in and out over 20 s at each edge).
  function rainAt(tl, t) {
    for (const seg of tl) if (t >= seg.from && t < seg.to) {
      const edge = Math.min(t - seg.from, seg.to - t, 20) / 20;
      return seg.rain * (seg.rain > 0 ? clamp(edge, 0, 1) : 1);
    }
    return 0;
  }
  /// The radar for the engineer: the rain expected at `t + horizon`, with an error that grows with the horizon, from a seeded generator (so it is repeatable).
  function radar(tl, t, horizonS, seed = 1) {
    const truth = rainAt(tl, t + horizonS), e = (rng(seed + Math.floor(t / 10) + Math.floor(horizonS))() - 0.5) * 2 * EVO.radarError * Math.min(1, horizonS / 300);
    return { rain: clamp(truth + e, 0, 1), horizonS, raining: truth > 0.15 };
  }
  /// The first time after `t` (within `maxS`) that rain of at least `level` is forecast, or null.
  function nextRain(tl, t, maxS = 900, level = 0.2) {
    for (let d = 0; d <= maxS; d += 15) if (rainAt(tl, t + d) >= level) return t + d;
    return null;
  }

  const api = { EVO, create, deposit, step, gripAt, summary, serialize, load, rng, makeWeather, rainAt, radar, nextRain };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.NotchRaceF1 = root.NotchRaceF1 || {};
  root.NotchRaceF1.evolution = api;
})(typeof window !== 'undefined' ? window : globalThis);
