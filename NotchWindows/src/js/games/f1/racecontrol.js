// F1 race control: one state machine for the whole track (GREEN, VSC, SAFETY_CAR, RED_FLAG, CHEQUERED), local yellow flags per mini-sector
// (single and double), and the flags shown to one driver (BLUE, BLACK_AND_ORANGE, BLACK_AND_WHITE, BLACK). It decides what is allowed (overtaking,
// DRS / active aero, speed) and tells the game what to do through events; it never moves a car or touches the screen. Penalties it calls for
// come out as `penalty` events for the stewards (penalties.js). Pure: no DOM, no clock, no randomness; time comes in with `tick`.
//
// ALL TUNABLE NUMBERS ARE IN `RC` BELOW.
(function (root) {
  'use strict';
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

  const RC = {
    miniSectors: 24,            // a lap is cut into this many mini-sectors (yellow flags and delta timing work per mini-sector)
    yellowSpeedK: 0.85,         // single yellow: the speed cap in the sector, as a share of racing pace
    doubleYellowK: 0.6,         // double yellow: be prepared to stop
    yellowGraceS: 4,            // seconds after a yellow appears before breaking it is punished (the driver has to see it)
    vscSlow: 0.35,              // VSC: the delta pace is this much slower than racing pace (30–40 %)
    vscDeltaTolS: 0.25,         // negative delta tolerated per mini-sector before a breach
    vscPenaltyS: 5,             // breaking the VSC delta
    scPaceK: 0.6,               // the Safety Car's pace, as a share of racing pace
    scBunchM: 45,               // the pack stays within this many metres of the car in front (about 10 car lengths)
    scMinSpeed: 38,             // m/s (about 137 km/h): the Safety Car is brisk, fast enough to keep tyres and brakes alive
    scPaceWindow: 0.10,         // a player-driven Safety Car should stay within this share of the target pace
    scTooSlowK: 0.82, scTooFastK: 1.18,       // ... and is warned beyond these (the field overheats behind a slow car, cannot keep up with a fast one)
    scWarnSecs: 3,              // seconds out of the pace window before a warning
    scHardBrake: 7,             // m/s²: braking harder than this at the front is dangerous
    scLeaderBrakeCheck: 8,      // m/s²: the leader slowing this hard on the restart lap is brake-checking the field
    scSector3From: 2 / 3,       // Sector 3 starts here (share of the lap): the lights go off in it
    scPitEntryFromEndM: 140,    // the pit entry is this far before the line (used when the track has no pit data)
    scDoneScore: 150, scWarnScore: -25, scMissedPitScore: -100,
    vscEndMin: 10, vscEndMax: 15,   // "VSC ENDING" shows for a random 10–15 seconds before green
    scLine1FromEndM: 220,       // Safety Car Line 1 is this far before the start/finish line
    blueGapS: 1.2,              // a faster car within this time of a backmarker gets him the blue flag
    bluePosts: 3,               // marshal posts a backmarker has to let the car through
    postSpacingM: 160,          // distance between marshal posts
    bluePenaltyS: 5,
    meatballLaps: 3,            // laps a car may ignore the meatball before the black flag
    mcAssessMin: 10, mcAssessMax: 15,     // the Medical Car's check at a wreck takes this long (seconds)
    mcStopZoneM: 45,            // it must stop within this distance of the wreck, off the racing line
    mcMaxSpeed: 1.0,            // its response speed, as a share of the car's safe maximum
    mcLap1SectorShare: 1 / 3,   // on lap 1 it follows the pack through Sector 1 (this share of the lap) to cover start-line incidents
    mcOffLineM: 4,              // and parks this far off the middle of the road edge
    redGraceS: 0,
    redRestartFormationLaps: 1,
    postRedWork: { tyres: true, frontWing: true, wingAngle: true, repair: true, engine: false, chassis: false, gearbox: false },
  };

  const STATES = ['GREEN', 'VSC', 'SAFETY_CAR', 'RED_FLAG', 'CHEQUERED'];
  const RANK = { GREEN: 0, VSC: 1, SAFETY_CAR: 2, RED_FLAG: 3, CHEQUERED: 4 };

  /// A new race control. cfg: trackLength (m), laps (race distance; 0 for a timed session), sessionSecs (timed sessions), session ('race' | 'sprint' |
  /// 'quali' | 'practice'), wet (bool: a wet restart is rolling), raceSpeed (m/s, the pace the VSC and Safety Car are a share of), cars (ids).
  function create(cfg = {}) {
    const L = cfg.trackLength || 5000;
    const rc = {
      cfg: Object.assign({ laps: 0, sessionSecs: 0, session: 'race', wet: false, raceSpeed: 70, scLine1S: L - RC.scLine1FromEndM, loops: RC.miniSectors }, cfg, { trackLength: L }),
      state: 'GREEN', time: 0, since: 0, yellow: new Array(RC.miniSectors).fill(0), yellowAt: new Array(RC.miniSectors).fill(-1e9),
      cars: new Map(), events: [], log: [], sc: null, red: null, vsc: null, chequered: false, finishOrder: [], frozen: null, loops: new Map(), loopTimes: new Map(),
      leaderId: null, lastLeaderLap: 0, sessionOver: false, mc: null, rand: typeof cfg.rand === 'function' ? cfg.rand : () => 0.5,
    };
    for (const id of cfg.cars || []) addCar(rc, id);
    return rc;
  }
  function addCar(rc, id) {
    if (!rc.cars.has(id)) rc.cars.set(id, { id, s: 0, lap: 0, speed: 0, inPit: false, finished: false, flags: { blue: null, meatball: null, bw: null, black: null }, vscDelta: 0, vscSec: -1, vscSecStart: 0, vscBreached: -1, lastLoop: -1, released: true, restartLap: null, retired: false, dnf: false, unlap: false, pitLaneIn: false, worked: [] });
    return rc.cars.get(id);
  }
  const emit = (rc, ev) => { ev.t = rc.time; rc.events.push(ev); rc.log.push(ev); return ev; };
  const drain = (rc) => rc.events.splice(0, rc.events.length);
  const L_ = (rc) => rc.cfg.trackLength;
  const wrapRel = (rc, d) => { const L = L_(rc); return ((((d % L) + L) % L) + L / 2) % L - L / 2; };
  /// The mini-sector a distance along the lap is in.
  const sectorAt = (rc, s) => { const L = L_(rc); return clamp(Math.floor((((s % L) + L) % L) / L * RC.miniSectors), 0, RC.miniSectors - 1); };

  function setState(rc, next, why) {
    if (rc.state === next) return false;
    const was = rc.state; rc.state = next; rc.since = rc.time;
    emit(rc, { type: 'state', from: was, to: next, why: why || '' });
    return true;
  }

  // ---- yellow flags

  /// A yellow flag in a mini-sector: level 1 single (a hazard off the racing line), 2 double (the track is blocked or marshals are on it).
  /// The sector before gets a single yellow with a double (the warning post). Never lowers a flag.
  function setYellow(rc, sector, level, why) {
    const n = RC.miniSectors, sec = ((sector % n) + n) % n, set = (i, lv) => { if (rc.yellow[i] < lv) { rc.yellow[i] = lv; rc.yellowAt[i] = rc.time; emit(rc, { type: 'yellow', sector: i, level: lv, why: why || '' }); } };
    set(sec, level);
    if (level >= 2) set((sec - 1 + n) % n, 1);
  }
  function clearYellow(rc, sector) {
    const n = RC.miniSectors, sec = ((sector % n) + n) % n;
    for (const i of [sec, (sec - 1 + n) % n]) if (rc.yellow[i]) { rc.yellow[i] = 0; emit(rc, { type: 'yellow-clear', sector: i }); }
  }
  const clearAllYellows = (rc) => { for (let i = 0; i < RC.miniSectors; i++) if (rc.yellow[i]) { rc.yellow[i] = 0; emit(rc, { type: 'yellow-clear', sector: i }); } };
  const yellowLevelAt = (rc, s) => rc.yellow[sectorAt(rc, s)] || 0;

  // ---- incidents: the steward in the tower picks the response

  /// A hazard. a: { sector (or s), carId, kind: 'offtrack' | 'blocking' | 'stopped' | 'debris' | 'major' | 'barrier' | 'blocked-track', recoverable }.
  /// Escalates only: it never calls off a stronger state.
  function reportIncident(rc, a) {
    const sec = a.sector != null ? a.sector : sectorAt(rc, a.s || 0);
    if (rc.state === 'CHEQUERED' || rc.state === 'RED_FLAG') return null;
    let want = 'YELLOW_SINGLE';
    switch (a.kind) {
      case 'offtrack': want = 'YELLOW_SINGLE'; break;
      case 'blocking': case 'debris': case 'marshals': want = 'YELLOW_DOUBLE'; break;
      case 'stopped': want = a.recoverable === false ? 'SAFETY_CAR' : 'VSC'; if (rc.state === 'GREEN') setYellow(rc, sec, 2, 'stopped car'); break;
      case 'barrier': case 'major': want = 'SAFETY_CAR'; setYellow(rc, sec, 2, 'major incident'); break;
      case 'blocked-track': want = 'RED_FLAG'; break;
      default: break;
    }
    if (want === 'YELLOW_SINGLE') { if (rc.state === 'GREEN') setYellow(rc, sec, 1, a.kind); }
    else if (want === 'YELLOW_DOUBLE') { if (rc.state === 'GREEN') setYellow(rc, sec, 2, a.kind); }
    else if (want === 'VSC') deployVSC(rc, a.kind);
    else if (want === 'SAFETY_CAR') deploySC(rc, a.kind);
    else if (want === 'RED_FLAG') redFlag(rc, a.kind, a.carId);
    if (a.kind === 'barrier' || a.kind === 'major' || a.kind === 'blocked-track' || a.highG) mcDispatch(rc, { kind: 'crash', s: a.s != null ? a.s : (sec + 0.5) * (L_(rc) / RC.miniSectors), carIds: a.carId ? [a.carId] : [], severity: a.kind });
    emit(rc, { type: 'incident', carId: a.carId || null, kind: a.kind, sector: sec, response: want });
    return want;
  }

  // ---- Virtual Safety Car

  function deployVSC(rc, why) {
    if (RANK[rc.state] >= RANK.VSC) return false;
    rc.vsc = { ending: false, endAt: 0, startedAt: rc.time };
    for (const c of rc.cars.values()) { c.vscDelta = 0; c.vscSec = -1; c.vscBreached = -1; c.vscPenalised = false; c.vscArmed = false; c.vscPassPenalised = false; }
    setState(rc, 'VSC', why); return true;
  }
  /// Race control calls the VSC to end: "VSC ENDING" shows for a random 10–15 s, then every sector goes green at once. Returns the seconds it will show.
  function endVSC(rc, rand) {
    if (rc.state !== 'VSC' || rc.vsc.ending) return 0;
    const r = typeof rand === 'function' ? rand : rc.rand, secs = RC.vscEndMin + r() * (RC.vscEndMax - RC.vscEndMin);
    rc.vsc.ending = true; rc.vsc.endAt = rc.time + secs; rc.vsc.endSecs = secs; emit(rc, { type: 'vsc-ending', secs }); return secs;
  }
  /// The VSC delta a car sees on its display: seconds ahead of (+) or behind (−) the minimum time for the mini-sector it is in, at its place in it.
  /// Positive is slower than the limit (good); negative means it is too fast. { delta, ok, text }.
  function vscDelta(rc, carId) {
    const c = rc.cars.get(carId);
    if (!c || rc.state !== 'VSC' || c.vscSec < 0) return { delta: 0, ok: true, text: '' };
    const L = L_(rc), secLen = L / RC.miniSectors, frac = clamp((((c.s % L) + L) % L - c.vscSec * secLen) / secLen, 0, 1);
    const ref = (rc.cfg.sectorRefSecs && rc.cfg.sectorRefSecs[c.vscSec]) || (secLen / rc.cfg.raceSpeed), min = vscMinSectorTime(rc, ref);
    const delta = (rc.time - c.vscSecStart) - min * frac;
    return { delta, ok: delta >= 0, text: (delta >= 0 ? '+' : '−') + Math.abs(delta).toFixed(2) };
  }
  /// A car passed another under the VSC (neither in the pit lane): a time penalty, once per car per VSC period.
  function vscOvertake(rc, passerId, passedId) {
    if (rc.state !== 'VSC') return false;
    const c = rc.cars.get(passerId); if (!c || c.inPit || c.vscPassPenalised) return false;
    c.vscPassPenalised = true;
    emit(rc, { type: 'penalty', carId: passerId, seconds: RC.vscPenaltyS, reason: 'overtaking under the Virtual Safety Car', passed: passedId || null });
    return true;
  }
  function vscGreen(rc) {
    // The green flag: any car still going faster than the VSC delta allows at that moment is penalised.
    for (const c of rc.cars.values()) {
      if (c.inPit || c.retired || c.dnf || c.finished) continue;
      const d = vscDelta(rc, c.id);
      if (!d.ok && d.delta < -RC.vscDeltaTolS && !c.vscPenalised) { c.vscPenalised = true; emit(rc, { type: 'penalty', carId: c.id, seconds: RC.vscPenaltyS, reason: 'negative VSC delta at the green flag' }); }
    }
    rc.vsc = null; setState(rc, 'GREEN', 'VSC ended');
  }
  /// The pace each mini-sector must take under the VSC: racing pace slowed by 30–40 %.
  const vscSpeed = (rc) => rc.cfg.raceSpeed * (1 - RC.vscSlow);
  /// Sector times for the delta: `refSecs` is how long a mini-sector takes at racing pace; the minimum allowed under VSC is that divided by (1 − slow).
  const vscMinSectorTime = (rc, refSecs) => refSecs / (1 - RC.vscSlow);

  // ---- Safety Car

  /// The Safety Car is called. It waits at the pit exit with its amber lights on (phase 'staging') until the race leader crosses Safety Car Line 1, then pulls
  /// out directly in front of him (phase 'out'). Set cfg.scStaging = false to put it straight on the track (phase 'out').
  function deploySC(rc, why) {
    if (RANK[rc.state] >= RANK.SAFETY_CAR) return false;
    if (rc.state === 'VSC') rc.vsc = null;
    rc.sc = { phase: rc.cfg.scStaging === false ? 'out' : 'staging', lights: true, hazardClear: false, unlapAllowed: false, unlapped: new Set(), leaderPrevS: null, leaderPrevSpeed: null, pitted: false, lightsOffSent: false,
      missedPit: false, erratic: false, player: { slowT: 0, fastT: 0, warned: {}, score: 0, warnings: 0 } };
    setState(rc, 'SAFETY_CAR', why);
    emit(rc, { type: 'sc-deployed', phase: rc.sc.phase }); return true;
  }
  /// Race control says the hazard is cleared: now lapped cars may unlap and the Safety Car may be called in.
  function hazardCleared(rc) {
    if (rc.state !== 'SAFETY_CAR' || !rc.sc || rc.sc.hazardClear) return false;
    rc.sc.hazardClear = true; emit(rc, { type: 'hazard-clear' }); return true;
  }
  /// "LAPPED CARS MAY NOW OVERTAKE": race control lets the lapped cars between the leader and the Safety Car pass it and the lead pack, to rejoin at the back.
  /// Only once the hazard is clear. Returns the ids waved on.
  function waveLapped(rc, order) {
    if (rc.state !== 'SAFETY_CAR' || !rc.sc || rc.sc.phase === 'staging' || !rc.sc.hazardClear) return [];
    rc.sc.unlapAllowed = true;
    const ids = (order || []).filter((r) => r.lapsDown > 0 && !r.inPit).map((r) => r.id);
    for (const id of ids) { rc.sc.unlapped.add(id); const c = rc.cars.get(id); if (c) c.unlap = true; }
    emit(rc, { type: 'unlap', ids, text: 'LAPPED CARS MAY NOW OVERTAKE' });
    return ids;
  }
  /// A lapped car has passed the pack and rejoined at the back: it may no longer overtake.
  function unlapDone(rc, carId) {
    const c = rc.cars.get(carId); if (!c || !c.unlap) return false;
    c.unlap = false; if (rc.sc) rc.sc.unlapped.delete(carId); emit(rc, { type: 'unlap-done', carId }); return true;
  }
  /// "Safety Car in this lap": allowed once the hazard is clear. The lights go off in Sector 3 and it pulls into the pit lane; the leader then controls the pace.
  function sendSCIn(rc) {
    if (rc.state !== 'SAFETY_CAR' || !rc.sc || rc.sc.phase !== 'out') return false;
    if (!rc.sc.hazardClear) return false;
    rc.sc.phase = 'in-this-lap'; emit(rc, { type: 'sc-in', text: 'SAFETY CAR IN THIS LAP' }); return true;
  }
  /// The Safety Car's pace: brisk, a share of racing pace but never below the speed that keeps tyres and brakes alive.
  const scSpeed = (rc) => Math.max(RC.scMinSpeed, rc.cfg.raceSpeed * RC.scPaceK);
  /// Whether the Safety Car's lights are on at distance `s` along the lap: on until the lap it comes in, then off from Sector 3.
  function scLightsOn(rc, s) {
    if (!rc.sc) return false;
    if (rc.sc.phase !== 'in-this-lap') return true;
    const L = L_(rc); return !(((s % L) + L) % L >= L * RC.scSector3From);
  }
  /// The speed the leader may do behind the Safety Car; the others stay close to the car in front (never further than scBunchM, never closer than 10 m).
  function scTarget(rc, carId, aheadGapM, aheadSpeed) {
    const base = scSpeed(rc);
    if (aheadGapM == null) return base;                     // the leader follows the Safety Car at its pace
    if (aheadGapM > RC.scBunchM) return base * 1.35;        // too far back: close up
    if (aheadGapM < 10) return Math.min(base, aheadSpeed != null ? aheadSpeed * 0.9 : base);
    return base;
  }
  /// Where each Safety Car phase leaves the field: the field behind it may not overtake (except lapped cars waved on).
  const scPhase = (rc) => (rc.sc ? rc.sc.phase : null);

  /// Per-step work: the Safety Car comes out when the leader crosses Line 1; its lights go off in Sector 3 on the lap it is called in; it pits; and the track goes green when
  /// the leader reaches Line 1 after that. snap.sc (optional): { s, speed, inPit }.
  function scStep(rc, cars, order, snap) {
    const sc = rc.sc, L = L_(rc), line1 = rc.cfg.scLine1S, lead = order[0], scs = snap && snap.sc;
    if (!lead) return;
    const ls = ((lead.s % L) + L) % L, crossed = sc.leaderPrevS != null && sc.leaderPrevS < line1 && ls >= line1;       // the leader just crossed Line 1
    if (sc.phase === 'staging' && crossed) { sc.phase = 'out'; emit(rc, { type: 'sc-out', leaderId: lead.id, text: 'SAFETY CAR OUT, AHEAD OF THE LEADER' }); }
    if (sc.phase === 'in-this-lap') {
      if (scs && !sc.lightsOffSent && !scLightsOn(rc, scs.s)) { sc.lightsOffSent = true; sc.lights = false; emit(rc, { type: 'sc-lights-off' }); }
      if (scs && !sc.pitted && scs.inPit) { sc.pitted = true; emit(rc, { type: 'sc-in-pit' }); }
      // The leader controls the pace: braking hard to bunch the field is "brake-checking".
      if (sc.leaderPrevSpeed != null && !sc.erratic && (sc.lightsOffSent || sc.pitted)) {
        const decel = (sc.leaderPrevSpeed - lead.speed) / Math.max(1e-3, snap && snap.dt ? snap.dt : 0.1);
        if (decel > RC.scLeaderBrakeCheck && lead.speed > 12) { sc.erratic = true; emit(rc, { type: 'erratic-leader', carId: lead.id }); emit(rc, { type: 'penalty', carId: lead.id, seconds: RC.vscPenaltyS, reason: 'brake-testing the field behind the Safety Car' }); }
      }
      // The Safety Car missed its pit entry: it went past the line out on the track.
      if (scs && !sc.pitted && !sc.missedPit && sc.scPrevS != null && sc.scPrevS < line1 && ((scs.s % L) + L) % L >= line1 && !scs.inPit) { sc.missedPit = true; emit(rc, { type: 'sc-missed-pit' }); }
      // The track goes green when the leader reaches Line 1 and the Safety Car is in (or is not being followed at all).
      if (crossed && (sc.pitted || !scs)) {
        setState(rc, 'GREEN', 'Safety Car in');
        rc.restartHold = rc.time + 90;
        for (const x of cars) { const c = rc.cars.get(x.id); if (c) { c.restartLap = x.lap; c.released = x.id === lead.id; c.unlap = false; } }
        emit(rc, { type: 'restart', startType: 'safety-car', order: order.map((x) => x.id) });
        rc.sc = null; return;
      }
    }
    sc.leaderPrevS = ls; sc.leaderPrevSpeed = lead.speed; if (scs) sc.scPrevS = ((scs.s % L) + L) % L;
  }
  /// After a Safety Car restart a car is free to overtake (and to use its wings) once it has crossed Line 1. tick() does this; the game can also call it.
  function crossLine1(rc, carId) {
    const c = rc.cars.get(carId); if (!c || c.released) return;
    c.released = true;
    if (rc.restartHold && [...rc.cars.values()].every((x) => x.released || x.retired || x.dnf)) { rc.restartHold = 0; emit(rc, { type: 'restart-free' }); }
  }

  /// What a player driving the Safety Car should see and be judged on. st: { s, speed, decel (m/s², braking positive), inPit, atPitExit, lightsOn, offTrack, leaderS, leaderId,
  /// pitEntryS }. Call every step with dt; it keeps the timers on rc.sc.player. Returns { stage, prompt, target: { lo, hi, v }, warnings: [text], score, events }.
  function scPlayerStep(rc, st, dt) {
    const out = { stage: 'off', prompt: '', target: null, warnings: [], score: 0, events: [] };
    const P = rc.sc && rc.sc.player;
    if (!rc.sc) { out.stage = rc.log.some((e) => e.type === 'restart' && e.startType === 'safety-car') ? 'done' : 'off'; return out; }
    const v = scSpeed(rc), lo = v * RC.scTooSlowK, hi = v * RC.scTooFastK, L = L_(rc), line1 = rc.cfg.scLine1S;
    out.target = { lo, hi, v, loKmh: Math.round(lo * 3.6), hiKmh: Math.round(hi * 3.6), vKmh: Math.round(v * 3.6) };
    const warn = (id, text, score) => { if (!P.warned[id] || rc.time - P.warned[id] > 8) { P.warned[id] = rc.time; P.warnings++; P.score += score || RC.scWarnScore; out.events.push({ type: 'sc-warning', id, text, score: score || RC.scWarnScore }); } out.warnings.push(text); };
    if (rc.sc.phase === 'staging') {
      const dist = st.leaderS != null ? ((line1 - (((st.leaderS % L) + L) % L)) % L + L) % L : null;
      out.stage = 'hold'; out.prompt = `HOLD AT THE PIT EXIT with the amber lights on. Pull out when the leader (P1) crosses the line${dist != null ? ` (${Math.round(dist)} m to go)` : ''}.`;
      if (st.speed > 3 && st.atPitExit !== false) warn('early', 'Wait: the leader has not crossed the line yet');
      return Object.assign(out, { score: P.score });
    }
    if (rc.sc.phase === 'out') {
      out.stage = 'lead';
      out.prompt = `LEAD THE FIELD at ${out.target.vKmh} km/h (stay within ${out.target.loKmh} to ${out.target.hiKmh}). ${rc.sc.hazardClear ? 'The track is clear: wait for "SAFETY CAR IN THIS LAP".' : 'Hold the pace until race control clears the hazard.'}`;
      P.slowT = st.speed < lo && st.speed > 1 ? P.slowT + dt : 0; P.fastT = st.speed > hi ? P.fastT + dt : 0;
      if (P.slowT > RC.scWarnSecs) warn('slow', 'TOO SLOW: the field is losing tyre and brake temperature');
      if (P.fastT > RC.scWarnSecs) warn('fast', 'TOO FAST: the pack cannot keep up');
      if ((st.decel || 0) > RC.scHardBrake) warn('brake', 'DANGEROUS: braking too hard in front of the field');
      if (st.offTrack) warn('off', 'DANGEROUS: you are off the road');
      return Object.assign(out, { score: P.score });
    }
    if (rc.sc.phase === 'in-this-lap') {
      out.stage = rc.sc.pitted ? 'box' : 'in';
      const lightsOff = st.lightsOn === false, s3 = (((st.s % L) + L) % L) >= L * RC.scSector3From;
      out.prompt = rc.sc.pitted ? 'In the pit lane. Well done: the leader controls the restart.' : `SAFETY CAR IN THIS LAP: ${lightsOff ? 'lights off, now ' : 'switch the lights off in Sector 3 and '}box this lap.`;
      if (s3 && !lightsOff && !rc.sc.pitted) warn('lights', 'Switch the lights off now (Sector 3)');
      if (rc.sc.missedPit && !P.missed) { P.missed = true; P.score += RC.scMissedPitScore; out.events.push({ type: 'sc-warning', id: 'pit', text: 'You missed the pit entry: go round again', score: RC.scMissedPitScore }); }
      if (rc.sc.missedPit) out.warnings.push('You missed the pit entry: go round again');
      if ((st.decel || 0) > RC.scHardBrake) warn('brake', 'DANGEROUS: braking too hard');
      if (rc.sc.pitted && !P.done) { P.done = true; P.score += RC.scDoneScore; out.events.push({ type: 'sc-done', score: RC.scDoneScore }); }
      return Object.assign(out, { score: P.score });
    }
    return out;
  }

  // ---- Red flag

  /// Red flag: the session stops now. The classification is frozen from the last timing loop all cars have crossed; the cars go to the pit lane in that order.
  /// `causeId`: a car that caused it and has not returned to the pits (classified by its own last loop).
  function redFlag(rc, why, causeId) {
    if (rc.state === 'RED_FLAG' || rc.state === 'CHEQUERED') return false;
    if (rc.state === 'VSC') rc.vsc = null;
    if (rc.state === 'SAFETY_CAR') rc.sc = null;
    rc.red = { phase: 'stopping', causeId: causeId || null, worked: new Map(), formation: 0, startType: null, restartAt: 0, lineup: [] };
    clearAllYellows(rc);
    rc.frozen = classifyAtRed(rc, causeId);
    rc.red.lineup = rc.frozen.map((id, i) => ({ id, slot: i }));
    setState(rc, 'RED_FLAG', why);
    emit(rc, { type: 'classification-frozen', order: rc.frozen.slice() });
    return true;
  }
  /// A car crossed timing loop number `index` (counted from the start of the session, so it grows every lap) at time `t`.
  function recordLoop(rc, carId, index, t) {
    const c = addCar(rc, carId); c.lastLoop = Math.max(c.lastLoop, index);
    if (!rc.loopTimes.has(index)) rc.loopTimes.set(index, new Map());
    rc.loopTimes.get(index).set(carId, t);
    return c.lastLoop;
  }
  /// The order at the last timing loop crossed by every car (cars that retired are left out). A car that caused the stoppage and did not return is
  /// placed by its own last loop.
  function classifyAtRed(rc, causeId) {
    const live = [...rc.cars.values()].filter((c) => !c.retired && !c.dnf);
    if (!live.length) return [];
    const others = live.filter((c) => c.id !== causeId);
    const base = others.length ? Math.min(...others.map((c) => c.lastLoop)) : Math.min(...live.map((c) => c.lastLoop));
    const orderAt = (idx, among) => among.filter((c) => c.lastLoop >= idx && rc.loopTimes.has(idx) && rc.loopTimes.get(idx).has(c.id)).sort((a, b) => rc.loopTimes.get(idx).get(a.id) - rc.loopTimes.get(idx).get(b.id)).map((c) => c.id);
    let order = base >= 0 ? orderAt(base, others.length ? others : live) : [];
    // Anyone with no loop time at all (never crossed one) goes last, in id order.
    for (const c of live) if (c.id !== causeId && !order.includes(c.id)) order.push(c.id);
    const cause = causeId ? rc.cars.get(causeId) : null;
    if (cause && !cause.retired && !cause.dnf) {
      const own = cause.lastLoop;
      if (own >= base && base >= 0) order = orderAt(base, live);
      else if (own >= 0) {
        const at = orderAt(own, live), pos = Math.max(0, at.indexOf(causeId));
        order.splice(Math.min(pos, order.length), 0, causeId);
      } else order.push(causeId);
    }
    return order;
  }
  /// Everyone goes to the pit lane and lines up in the fast lane in race order. Returns the line-up; `rc.red.phase` becomes 'pitlane' when called.
  function redFlagLineup(rc) {
    if (rc.state !== 'RED_FLAG') return [];
    rc.red.phase = 'pitlane'; emit(rc, { type: 'red-pitlane' });
    return rc.red.lineup.slice();
  }
  /// Work in the pit lane under the red flag. kind: 'tyres' | 'frontWing' | 'wingAngle' | 'repair' (non-structural) | 'engine' | 'chassis' | 'gearbox'.
  /// Tyre changes count toward the two-compound rule (the caller records the compound). Returns { ok, why, countsCompound }.
  function redFlagWork(rc, carId, kind, detail) {
    if (rc.state !== 'RED_FLAG' || !rc.red) return { ok: false, why: 'not under a red flag' };
    if (rc.red.phase === 'formation' || rc.red.phase === 'start') return { ok: false, why: 'the cars have left the pit lane' };
    if (!RC.postRedWork[kind]) return { ok: false, why: `${kind} work is not allowed under a red flag` };
    const list = rc.red.worked.get(carId) || []; list.push({ kind, detail }); rc.red.worked.set(carId, list);
    return { ok: true, countsCompound: kind === 'tyres', detail };
  }
  /// Restart: one formation lap behind the Safety Car, then a standing start (dry) or a rolling start (wet).
  function restartFromRed(rc) {
    if (rc.state !== 'RED_FLAG' || !rc.red) return null;
    rc.red.phase = 'formation'; rc.red.formation = RC.redRestartFormationLaps; rc.red.startType = rc.cfg.wet ? 'rolling' : 'standing';
    emit(rc, { type: 'red-restart', startType: rc.red.startType, order: rc.red.lineup.map((x) => x.id) });
    return { startType: rc.red.startType, order: rc.red.lineup.map((x) => x.id), formationLaps: rc.red.formation };
  }
  /// The formation lap is complete and the lights are going out: green flag, race order as frozen.
  function startAfterRed(rc) {
    if (rc.state !== 'RED_FLAG' || !rc.red || rc.red.phase !== 'formation') return false;
    rc.red.phase = 'start'; const type = rc.red.startType; const order = rc.red.lineup.map((x) => x.id);
    setState(rc, 'GREEN', 'restart'); rc.red = null; rc.frozen = null;
    emit(rc, { type: 'restart', startType: type, order });
    return true;
  }

  // ---- driver flags

  /// Blue flag: for each pair where a faster, lapping car is within 1.2 s behind a backmarker. cars: [{ id, s, lap, speed, inPit }] (lap = laps completed).
  /// The backmarker must let it through within 3 marshal posts or get +5 s.
  function updateBlue(rc, cars) {
    if (rc.state !== 'GREEN') { for (const c of rc.cars.values()) c.flags.blue = null; return; }
    for (const b of cars) {
      const cb = addCar(rc, b.id), live = cb.flags.blue;
      if (b.inPit || cb.finished || cb.retired) { cb.flags.blue = null; continue; }
      if (live) {
        const a = cars.find((x) => x.id === live.from);
        if (!a) { cb.flags.blue = null; continue; }
        const rel = wrapRel(rc, a.s - b.s);                    // > 0: the faster car is now ahead of the backmarker on the track: he let it by
        if (rel > 5) { emit(rc, { type: 'blue-cleared', carId: b.id, by: a.id, posts: live.posts }); cb.flags.blue = null; continue; }
        const post = Math.floor(b.s / RC.postSpacingM);
        if (post !== live.lastPost) { live.lastPost = post; live.posts++; }
        if (live.posts > RC.bluePosts && !live.penalised) { live.penalised = true; emit(rc, { type: 'penalty', carId: b.id, seconds: RC.bluePenaltyS, reason: 'ignoring blue flags' }); cb.flags.blue = null; }
        continue;
      }
      for (const a of cars) {
        if (a.id === b.id || a.inPit) continue;
        if (a.lap <= b.lap) continue;                        // only a car a lap ahead is lapping him
        const behind = wrapRel(rc, b.s - a.s);               // how far the lapping car is behind the backmarker
        if (behind <= 0 || behind > 400) continue;
        const gapS = behind / Math.max(10, a.speed);
        if (gapS <= RC.blueGapS && a.speed > b.speed) { cb.flags.blue = { from: a.id, since: rc.time, posts: 0, lastPost: Math.floor(b.s / RC.postSpacingM), penalised: false }; emit(rc, { type: 'blue', carId: b.id, from: a.id, gapS }); break; }
      }
    }
  }
  /// The meatball: loose bodywork or a critical fault. The car must pit now; it cannot be cleared until the repair is done.
  function meatball(rc, carId, why) {
    const c = addCar(rc, carId);
    if (!c.flags.meatball) { c.flags.meatball = { since: rc.time, why: why || '', lapsLeft: RC.meatballLaps, lap0: c.lap }; emit(rc, { type: 'meatball', carId, why: why || '' }); }
    return c.flags.meatball;
  }
  const clearMeatball = (rc, carId) => { const c = rc.cars.get(carId); if (c && c.flags.meatball) { c.flags.meatball = null; emit(rc, { type: 'meatball-cleared', carId }); return true; } return false; };
  /// The black-and-white flag: a warning for unsportsmanlike driving or the third track-limit strike.
  function blackWhite(rc, carId, why) {
    const c = addCar(rc, carId);
    if (!c.flags.bw) { c.flags.bw = { since: rc.time, why: why || '', lap: c.lap }; emit(rc, { type: 'black-white', carId, why: why || '' }); return true; }
    return false;
  }
  /// The black flag: disqualified. The car must return to the pits and retire.
  function blackFlag(rc, carId, why) {
    const c = addCar(rc, carId);
    if (!c.flags.black) { c.flags.black = { since: rc.time, why: why || '' }; c.dnf = true; emit(rc, { type: 'black', carId, why: why || '' }); return true; }
    return false;
  }
  /// A car out of the session (crashed out or retired in the garage): it no longer counts for classification, the red-flag line-up or the finish.
  const retire = (rc, carId, why) => { const c = addCar(rc, carId); c.retired = true; c.dnf = true; emit(rc, { type: 'retired', carId, why: why || '' }); };

  // ---- Medical Car

  /// Send the Medical Car. kind 'lap1': it follows the pack from the back of the grid through Sector 1 to cover start-line incidents, then pits at the end of the
  /// first lap if all is clear. kind 'crash': it goes to the site (s along the lap) at its maximum safe speed, stops off the racing line beside the wreck for a medical check of
  /// 10–15 s, and returns to the pit lane once race control has cleared it. A new crash redirects a lap-1 follow.
  function mcDispatch(rc, o = {}) {
    const kind = o.kind || 'crash';
    if (kind === 'crash' && o.s == null) return null;
    if (rc.mc && rc.mc.kind === 'crash' && rc.mc.phase !== 'in-pit' && rc.mc.phase !== 'returning') return rc.mc;       // already on its way to a wreck
    const L = L_(rc);
    rc.mc = { kind, phase: kind === 'lap1' ? 'follow' : 'responding', site: o.s != null ? { s: ((o.s % L) + L) % L, sector: sectorAt(rc, o.s), carIds: o.carIds || [], severity: o.severity || 'major' } : null,
      assessLeft: 0, assessTotal: 0, assessed: false, cleared: false, since: rc.time, interrupted: 0 };
    emit(rc, { type: 'mc-dispatched', kind, site: rc.mc.site });
    return rc.mc;
  }
  const mcLap1 = (rc) => mcDispatch(rc, { kind: 'lap1' });
  /// Race control clears the Medical Car after the check: it drives back to the pit lane.
  function clearMedical(rc) {
    const m = rc.mc; if (!m || m.phase !== 'cleared') return false;
    m.phase = 'returning'; m.cleared = true; emit(rc, { type: 'mc-returning' }); return true;
  }
  /// Is the Medical Car in position to check on the wreck? Stopped, near it, and off the racing line (at the edge of the road).
  function mcInZone(rc, st) {
    const m = rc.mc; if (!m || !m.site) return false;
    const L = L_(rc), d = Math.abs(wrapRel(rc, (st.s || 0) - m.site.s));
    return d <= RC.mcStopZoneM && (st.speed || 0) < 1.5 && Math.abs(st.lat == null ? 99 : st.lat) >= (rc.cfg.halfWidth != null ? rc.cfg.halfWidth - RC.mcOffLineM : 0);
  }
  /// Per step: where the Medical Car is. st: { s, lat (metres off the middle), speed, inPit, lap }. Returns the events (also in rc.log).
  function mcStep(rc, st, dt) {
    const m = rc.mc; if (!m || !st) return [];
    const evs = [], L = L_(rc), sec = sectorAt(rc, st.s || 0), push = (e) => evs.push(emit(rc, e));
    if (m.phase === 'follow') {
      m.passedS1 = m.passedS1 || (st.lap >= 0 && (((st.s % L) + L) % L) / L >= RC.mcLap1SectorShare);
      // At the end of the first lap, if nothing happened, it goes into the pits.
      if (st.lap >= 1 || (m.passedS1 && st.inPit)) { m.phase = 'returning'; push({ type: 'mc-returning', why: 'lap 1 clear' }); }
    }
    if (m.phase === 'responding') {
      if (mcInZone(rc, st)) { m.phase = 'assessing'; m.assessTotal = m.assessLeft = RC.mcAssessMin + rc.rand() * (RC.mcAssessMax - RC.mcAssessMin); push({ type: 'mc-arrived', secs: m.assessTotal }); }
    } else if (m.phase === 'assessing') {
      if (mcInZone(rc, st)) { m.assessLeft -= dt; if (m.assessLeft <= 0) { m.phase = 'cleared'; m.assessed = true; push({ type: 'mc-assessed' }); } }
      else if ((st.speed || 0) > 3 || Math.abs(wrapRel(rc, (st.s || 0) - m.site.s)) > RC.mcStopZoneM) { m.assessLeft = m.assessTotal; m.interrupted++; push({ type: 'mc-interrupted' }); m.phase = 'responding'; }
    }
    if (m.phase === 'returning' && st.inPit) { m.phase = 'in-pit'; push({ type: 'mc-in-pit' }); }
    return evs;
  }
  /// What a player driving the Medical Car should see: the target to drive to (a waypoint and mini-sector), what to do there, the check timer, and the way back.
  /// st: as for mcStep (plus pitEntryS). Returns { stage, prompt, target: { s, sector, distance } | null, timer: { left, total } | null }.
  function mcObjectives(rc, st) {
    const m = rc.mc, L = L_(rc);
    if (!m) return { stage: 'idle', prompt: 'Stand by at the pit exit. Race control will send you.', target: null, timer: null };
    const dist = (s) => Math.round(((s - ((st.s % L) + L) % L) % L + L) % L);
    if (m.phase === 'follow') return { stage: 'follow', prompt: 'LAP 1: follow the pack from the back of the grid through Sector 1, then come into the pits if all is clear.', target: null, timer: null };
    if (m.phase === 'responding') {
      const d = dist(m.site.s), inZone = Math.abs(wrapRel(rc, (st.s || 0) - m.site.s)) <= RC.mcStopZoneM;
      return { stage: 'respond', prompt: inZone ? 'STOP at the edge of the road beside the wreck, off the racing line.' : `GO to the crash in Sector ${Math.floor(m.site.sector / (RC.miniSectors / 3)) + 1} (${d} m ahead). Drive fast but safely.`, target: { s: m.site.s, sector: m.site.sector, distance: d }, timer: null };
    }
    if (m.phase === 'assessing') return { stage: 'assess', prompt: `STAY STILL: medical check in progress (${Math.ceil(m.assessLeft)} s).`, target: { s: m.site.s, sector: m.site.sector, distance: 0 }, timer: { left: m.assessLeft, total: m.assessTotal } };
    if (m.phase === 'cleared') return { stage: 'cleared', prompt: 'The driver is OK. Wait for race control to clear you.', target: null, timer: { left: 0, total: m.assessTotal } };
    if (m.phase === 'returning') return { stage: 'return', prompt: 'RETURN to the pit lane.', target: st.pitEntryS != null ? { s: st.pitEntryS, sector: sectorAt(rc, st.pitEntryS), distance: dist(st.pitEntryS) } : null, timer: null };
    return { stage: 'done', prompt: 'Back in the pits. Good job.', target: null, timer: null };
  }

  // ---- the rules, as questions the game asks

  /// May `carId` overtake at distance `s`? No in a yellow mini-sector, under VSC, under the Safety Car (until Line 1 on the restart lap), under a red flag.
  function canOvertake(rc, carId, s) {
    if (rc.state === 'RED_FLAG' || rc.state === 'VSC' || rc.state === 'CHEQUERED') return rc.state === 'CHEQUERED';
    if (rc.state === 'SAFETY_CAR') {
      const c = rc.cars.get(carId);
      if (rc.sc && rc.sc.unlapAllowed && c && c.unlap) return true;          // a lapped car waved past to unlap
      return false;
    }
    if (rc.restartHold && rc.restartHold > rc.time) { const c = rc.cars.get(carId); if (!(c && c.released)) return false; }
    return yellowLevelAt(rc, s) === 0;
  }
  /// May the car open its rear flap (2025) or switch to X-mode (2026) here? Only on a green track with no yellow in the mini-sector.
  function wingOpenAllowed(rc, carId, s) {
    if (rc.state !== 'GREEN') return false;
    if (rc.restartHold && rc.restartHold > rc.time) { const c = rc.cars.get(carId); if (!(c && c.released)) return false; }
    return yellowLevelAt(rc, s) === 0;
  }
  /// The speed cap the track imposes on a car at distance `s` (m/s), or null. { max, why }.
  function speedCap(rc, carId, s) {
    const race = rc.cfg.raceSpeed;
    if (rc.state === 'RED_FLAG') return { max: 0, why: 'red flag' };
    if (rc.state === 'VSC') return { max: vscSpeed(rc), why: 'VSC' };
    if (rc.state === 'SAFETY_CAR') return { max: scSpeed(rc), why: 'Safety Car' };
    const y = yellowLevelAt(rc, s);
    if (y === 2) return { max: race * RC.doubleYellowK, why: 'double yellow' };
    if (y === 1) return { max: race * RC.yellowSpeedK, why: 'yellow' };
    return null;
  }

  // ---- the clock

  /// Advance by `dt` with where the cars are. snap: { cars: [{ id, s, lap, speed, inPit, finished }], dt }. Returns the events this step produced.
  function tick(rc, snap, dt) {
    rc.time += dt;
    const L = L_(rc), cars = snap.cars || [];
    for (const x of cars) {
      const c = addCar(rc, x.id), prevS = c.s, prevLap = c.lap;
      c.s = x.s; c.lap = x.lap; c.speed = x.speed; c.inPit = !!x.inPit; if (x.finished) c.finished = true;
      // a new lap crossed
      if (x.lap > prevLap && c.flags.meatball) { c.flags.meatball.lapsLeft = RC.meatballLaps - (x.lap - c.flags.meatball.lap0); if (c.flags.meatball.lapsLeft < 0 && !c.flags.black) blackFlag(rc, c.id, 'ignored the black and orange flag'); }
      // after a Safety Car restart a car is released when it has crossed Line 1
      if (rc.restartHold && !c.released && c.restartLap != null && (x.lap > c.restartLap || (x.lap === c.restartLap && ((x.s % L) + L) % L >= rc.cfg.scLine1S))) crossLine1(rc, c.id);
      // VSC: the delta timer, per mini-sector
      if (rc.state === 'VSC' && !c.inPit && !x.finished) vscDeltaStep(rc, c, prevS, x.s);
    }
    // leader and the classification at the end
    const order = cars.slice().sort((a, b) => (b.lap * L + b.s) - (a.lap * L + a.s));
    if (order.length) rc.leaderId = order[0].id;
    if (rc.state === 'VSC' && rc.vsc && rc.vsc.ending && rc.time >= rc.vsc.endAt) vscGreen(rc);
    if (rc.state === 'SAFETY_CAR' && rc.sc) scStep(rc, cars, order, Object.assign({ dt }, snap));
    if (rc.state === 'GREEN') updateBlue(rc, cars);
    if (rc.mc && snap.mc) mcStep(rc, snap.mc, dt);
    chequerStep(rc, cars, order);
    return drain(rc);
  }

  function vscDeltaStep(rc, c, prevS, s) {
    const sec = sectorAt(rc, s);
    if (c.vscSec < 0) { c.vscSec = sec; c.vscSecStart = rc.time; return; }
    if (sec !== c.vscSec && !c.vscArmed) { c.vscArmed = true; c.vscSec = sec; c.vscSecStart = rc.time; return; }      // the first mini-sector was already part-run when the VSC came out
    if (sec !== c.vscSec) {
      // finished a mini-sector: compare with the minimum time for it
      const took = rc.time - c.vscSecStart, ref = (rc.cfg.sectorRefSecs && rc.cfg.sectorRefSecs[c.vscSec]) || (L_(rc) / RC.miniSectors / rc.cfg.raceSpeed);
      const min = vscMinSectorTime(rc, ref), delta = took - min;       // positive: slower than the minimum, fine
      c.vscDelta = delta;
      if (delta < -RC.vscDeltaTolS && c.vscBreached !== c.vscSec && !(rc.vsc && rc.vsc.ending)) {
        c.vscBreached = c.vscSec;
        emit(rc, { type: 'vsc-breach', carId: c.id, sector: c.vscSec, delta });
        if (!c.vscPenalised) { c.vscPenalised = true; emit(rc, { type: 'penalty', carId: c.id, seconds: RC.vscPenaltyS, reason: 'exceeding the VSC delta time' }); }      // one penalty a VSC period, however many sectors
      }
      c.vscSec = sec; c.vscSecStart = rc.time;
    }
  }

  function chequerStep(rc, cars, order) {
    if (rc.state === 'RED_FLAG' || rc.state === 'CHEQUERED') return;
    const cfg = rc.cfg, lead = order[0];
    if (!rc.chequered) {
      const timed = cfg.sessionSecs > 0 && rc.time >= cfg.sessionSecs, dist = cfg.laps > 0 && lead && lead.lap >= cfg.laps;
      if (!timed && !dist) return;
      rc.chequered = true; rc.chequerKind = dist ? 'distance' : 'timer';
      rc.chequerLap = new Map(cars.map((x) => [x.id, x.lap]));          // the lap each car was on when the flag came out
      emit(rc, { type: 'chequered-out', kind: rc.chequerKind });
      if (dist) takeFlag(rc, addCar(rc, lead.id));                       // the leader has done the distance: he takes it
    }
    for (const x of cars) {
      const c = rc.cars.get(x.id); if (!c || c.finished || c.dnf) continue;
      if (!rc.chequerLap.has(x.id)) rc.chequerLap.set(x.id, x.lap);
      // Everyone else takes it the next time they cross the line (or when they have done the full distance themselves).
      if (x.lap > rc.chequerLap.get(x.id) || (cfg.laps > 0 && x.lap >= cfg.laps)) takeFlag(rc, c);
    }
    if (cars.length && [...rc.cars.values()].every((c) => c.finished || c.dnf || c.retired)) { setState(rc, 'CHEQUERED', 'all cars finished'); rc.sessionOver = true; }
  }
  function takeFlag(rc, c) {
    if (c.finished) return;
    c.finished = true; rc.finishOrder.push(c.id);
    emit(rc, { type: 'chequered', carId: c.id, position: rc.finishOrder.length });
  }
  /// The chequered flag for a car that crossed the line (the game calls this when a timed session is over and a car completes its lap).
  const chequeredFor = (rc, carId) => { const c = rc.cars.get(carId); if (c) takeFlag(rc, c); };

  const api = { RC, STATES, create, addCar, drain, sectorAt, setState, setYellow, clearYellow, clearAllYellows, yellowLevelAt, reportIncident, deployVSC, endVSC, vscSpeed, vscMinSectorTime, deploySC, waveLapped, sendSCIn, scSpeed, scTarget, crossLine1,
    hazardCleared, unlapDone, scLightsOn, scPhase, scPlayerStep, vscDelta, vscOvertake, mcDispatch, mcLap1, clearMedical, mcInZone, mcStep, mcObjectives,
    redFlag, recordLoop, classifyAtRed, redFlagLineup, redFlagWork, restartFromRed, startAfterRed, updateBlue, meatball, clearMeatball, blackWhite, blackFlag, retire, canOvertake, wingOpenAllowed, speedCap, tick, chequeredFor };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.NotchRaceF1 = root.NotchRaceF1 || {};
  root.NotchRaceF1.racecontrol = api;
})(typeof window !== 'undefined' ? window : globalThis);
