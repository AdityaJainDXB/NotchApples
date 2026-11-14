// F1 stewards: track limits (warnings, black-and-white, +5 s, +10 s, then the count starts again), pit-lane speeding, unsafe release, and the
// penalties race control asks for (blue flags, VSC delta). Time penalties are served stationary in the pit box before the mechanics touch the car,
// or added to the race time if the driver does not stop again; a drive-through and a 10 s stop-go must be served within 3 laps without a tyre change.
// Pure: no DOM, no clock, no randomness.
//
// ALL TUNABLE NUMBERS ARE IN `PEN` BELOW.
(function (root) {
  'use strict';

  const PEN = {
    pitLimitKmh: 80, pitLimitStreetKmh: 60,
    speedingSmallKmh: 5,        // up to this much over the limit: 5 s; more: 10 s
    speedingSmallS: 5, speedingBigS: 10,
    unsafeReleaseS: 5, unsafeReleaseCollisionS: 10,
    trackLimitPlus5: 4, trackLimitPlus10: 5, trackLimitBW: 3,   // the strike that brings each (the 5th strike is +10 s, then the count resets)
    stopGoS: 10,
    serveWindowLaps: 3,         // a drive-through or stop-go must be served within this many laps of being given
    lateConvert: { driveThrough: 20, stopGo: 30 },    // given with fewer laps than the window left: served as time after the race
    levels: { fiveSecs: 5, tenSecs: 10 },
  };

  /// A new steward's log. cfg: session ('race' | 'sprint' | 'quali' | 'practice'), lapsTotal (race laps), street (a tight street circuit: 60 km/h pit limit).
  function create(cfg = {}) {
    return { cfg: Object.assign({ session: 'race', lapsTotal: 0, street: false }, cfg), list: [], strikes: new Map(), warnings: new Map(), events: [], nextId: 1, dsq: new Map(), deletedLaps: new Map() };
  }
  const emit = (s, ev) => { s.events.push(ev); return ev; };
  const drain = (s) => s.events.splice(0, s.events.length);
  const pitLimitKmh = (s) => (s.cfg.street ? PEN.pitLimitStreetKmh : PEN.pitLimitKmh);
  const timed = (s) => s.cfg.session === 'quali' || s.cfg.session === 'practice' || s.cfg.session === 'sprint-quali';

  /// Hand out a penalty. o: carId, kind ('time' | 'driveThrough' | 'stopGo'), seconds (for time or the stop-go length), reason, lap (the lap it was given).
  /// A drive-through or stop-go given too late to be served is turned into a time penalty. Returns the penalty.
  function issue(s, o) {
    let { kind, seconds } = o; const lap = o.lap || 0, laps = s.cfg.lapsTotal;
    if (timed(s) && kind === 'time') { emit(s, { type: 'fine', carId: o.carId, reason: o.reason, seconds }); return null; }      // no time to add in practice or qualifying
    if ((kind === 'driveThrough' || kind === 'stopGo') && laps > 0 && laps - lap < PEN.serveWindowLaps) {
      const was = kind; kind = 'time'; seconds = was === 'driveThrough' ? PEN.lateConvert.driveThrough : PEN.lateConvert.stopGo;
      emit(s, { type: 'converted', carId: o.carId, from: was, seconds });
    }
    const p = { id: s.nextId++, carId: o.carId, kind, seconds: seconds || 0, reason: o.reason || '', lap, status: 'pending', servedAt: null, postRace: false };
    s.list.push(p); emit(s, { type: 'penalty-issued', ...p });
    return p;
  }
  const pending = (s, carId, kind) => s.list.filter((p) => p.carId === carId && p.status === 'pending' && (!kind || p.kind === kind));
  /// Seconds the car has to stand still in its box before the mechanics may touch it (all its pending 5 s and 10 s penalties).
  const stationarySecs = (s, carId) => pending(s, carId, 'time').reduce((a, p) => a + p.seconds, 0);
  /// May the mechanics work yet, `standing` seconds into the stop? Not until the penalties are served.
  const mechanicsMayWork = (s, carId, standing) => standing >= stationarySecs(s, carId) - 1e-9;

  // ---- track limits

  /// All four wheels past the white line. Returns what happened: { strike, action }, where action is 'warning', 'lap-deleted', 'black-white', 'plus5' or 'plus10'.
  /// Practice and qualifying: the lap is deleted for strikes 1 and 2 (and for the later ones); a race: a warning. The 5th strike resets the count.
  function trackLimit(s, carId, o = {}) {
    const n = (s.strikes.get(carId) || 0) + 1, race = !timed(s);
    let action;
    if (race) action = n >= PEN.trackLimitPlus10 ? 'plus10' : n >= PEN.trackLimitPlus5 ? 'plus5' : n >= PEN.trackLimitBW ? 'black-white' : 'warning';
    else action = n === PEN.trackLimitBW ? 'black-white' : 'lap-deleted';
    s.strikes.set(carId, n >= PEN.trackLimitPlus10 ? 0 : n);          // the fifth strike brings +10 s and the count starts again
    const res = { carId, strike: n, action };
    if (!race) { s.deletedLaps.set(carId, (s.deletedLaps.get(carId) || 0) + 1); res.lapDeleted = true; }
    if (race && action === 'plus5') issue(s, { carId, kind: 'time', seconds: 5, reason: 'track limits (4th strike)', lap: o.lap });
    if (race && action === 'plus10') issue(s, { carId, kind: 'time', seconds: 10, reason: 'track limits (5th strike)', lap: o.lap });
    emit(s, { type: 'track-limits', ...res });
    return res;
  }
  const strikesOf = (s, carId) => s.strikes.get(carId) || 0;

  // ---- the pit lane

  /// A car's speed (km/h) in the pit lane. Over the limit: 5 s (a little over) or 10 s (well over); in practice and qualifying it is a fine.
  function pitSpeed(s, carId, kmh, o = {}) {
    const lim = pitLimitKmh(s), over = kmh - lim;
    if (over <= 0.5) return null;
    const secs = over <= PEN.speedingSmallKmh ? PEN.speedingSmallS : PEN.speedingBigS;
    return issue(s, { carId, kind: 'time', seconds: secs, reason: `speeding in the pit lane (${Math.round(over)} km/h over)`, lap: o.lap });
  }
  /// Released into the path of a car in the fast lane: 5 s, or 10 s if there was contact.
  function unsafeRelease(s, carId, collision, o = {}) {
    return issue(s, { carId, kind: 'time', seconds: collision ? PEN.unsafeReleaseCollisionS : PEN.unsafeReleaseS, reason: collision ? 'unsafe release (collision)' : 'unsafe release', lap: o.lap });
  }

  // ---- serving

  /// A pit stop. o: standing (seconds stationary before work began), lap, passedThrough (the car drove through the pit lane without stopping),
  /// stoppedSecs (seconds it stood still for a stop-go), tyresChanged, workDone (the crew worked on it).
  /// Marks what the stop served. Returns { served: [...], failed: [...] }.
  function pitStop(s, carId, o = {}) {
    const served = [], failed = [];
    const standing = o.standing != null ? o.standing : 0;
    // 5 s / 10 s penalties: the whole sum has to be stood out before the crew touches the car.
    const need = stationarySecs(s, carId);
    if (need > 0) {
      if (standing + 1e-9 >= need) { for (const p of pending(s, carId, 'time')) { p.status = 'served'; p.servedAt = o.lap; served.push(p); emit(s, { type: 'penalty-served', ...p }); } }
      else failed.push(...pending(s, carId, 'time'));
    }
    for (const p of pending(s, carId, 'driveThrough')) {
      if (o.passedThrough) { p.status = 'served'; p.servedAt = o.lap; served.push(p); emit(s, { type: 'penalty-served', ...p }); }
    }
    for (const p of pending(s, carId, 'stopGo')) {
      if ((o.stoppedSecs || 0) + 1e-9 >= p.seconds && !o.tyresChanged && !o.workDone) { p.status = 'served'; p.servedAt = o.lap; served.push(p); emit(s, { type: 'penalty-served', ...p }); }
      else if (o.stoppedSecs != null) failed.push(p);
    }
    return { served, failed };
  }
  /// A lap is completed: a drive-through or stop-go not served within 3 laps of being given is a black flag (disqualification). Returns the offending penalties.
  function lapDone(s, carId, lap) {
    const late = s.list.filter((p) => p.carId === carId && p.status === 'pending' && (p.kind === 'driveThrough' || p.kind === 'stopGo') && lap - p.lap >= PEN.serveWindowLaps);
    for (const p of late) { p.status = 'ignored'; emit(s, { type: 'black-flag', carId, reason: `did not serve the ${p.kind === 'driveThrough' ? 'drive-through' : 'stop-go'} penalty in ${PEN.serveWindowLaps} laps`, penaltyId: p.id }); s.dsq.set(carId, p.reason); }
    return late;
  }
  /// Disqualify a car (post-race rule breaks: the compound rule, a parc fermé breach, a black flag).
  function disqualify(s, carId, reason) { s.dsq.set(carId, reason); emit(s, { type: 'disqualified', carId, reason }); }

  /// The race result: `rows` are { id, time (seconds, race time), laps }. Time penalties the car has not served (it did not stop again) are added now;
  /// penalties served in the pits are not added again. Disqualified cars go last. Returns { order, rows }.
  function finalise(s, rows) {
    const out = rows.map((r) => {
      const added = s.list.filter((p) => p.carId === r.id && (p.status === 'pending') && p.kind === 'time').reduce((a, p) => a + p.seconds, 0);
      for (const p of s.list) if (p.carId === r.id && p.status === 'pending' && p.kind === 'time') { p.status = 'added'; p.postRace = true; }
      return { id: r.id, laps: r.laps, raw: r.time, added, time: r.time + added, dsq: s.dsq.get(r.id) || null };
    });
    out.sort((a, b) => (a.dsq ? 1 : 0) - (b.dsq ? 1 : 0) || b.laps - a.laps || a.time - b.time);
    return { order: out.map((r) => r.id), rows: out };
  }
  const list = (s, carId) => s.list.filter((p) => !carId || p.carId === carId);

  const api = { PEN, create, drain, issue, pending, stationarySecs, mechanicsMayWork, trackLimit, strikesOf, pitLimitKmh, pitSpeed, unsafeRelease, pitStop, lapDone, disqualify, finalise, list };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.NotchRaceF1 = root.NotchRaceF1 || {};
  root.NotchRaceF1.penalties = api;
})(typeof window !== 'undefined' ? window : globalThis);
