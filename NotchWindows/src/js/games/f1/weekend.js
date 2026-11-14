// F1 race weekend: the session flow (standard or sprint), knockout qualifying with the 107 % rule, parc fermé, the 13-set dry tyre allocation and
// the two-compound rule, the season's component pool and the grid penalties it causes, and the starting grid. Pure data and rules: it never
// runs a session, it says what the sessions are and what their results mean. No DOM, no clock, no randomness.
//
// ALL TUNABLE NUMBERS ARE IN `WK` BELOW.
(function (root) {
  'use strict';

  const WK = {
    flows: {
      standard: [
        { id: 'FP1', kind: 'practice', name: 'Practice 1', minutes: 60 }, { id: 'FP2', kind: 'practice', name: 'Practice 2', minutes: 60 }, { id: 'FP3', kind: 'practice', name: 'Practice 3', minutes: 60 },
        { id: 'Q1', kind: 'quali', name: 'Qualifying 1', minutes: 18, stage: 0 }, { id: 'Q2', kind: 'quali', name: 'Qualifying 2', minutes: 15, stage: 1 }, { id: 'Q3', kind: 'quali', name: 'Qualifying 3', minutes: 12, stage: 2 },
        { id: 'GP', kind: 'race', name: 'Grand Prix', minutes: 0, grandPrix: true },
      ],
      sprint: [
        { id: 'FP1', kind: 'practice', name: 'Practice 1', minutes: 60 },
        { id: 'SQ1', kind: 'quali', name: 'Sprint Qualifying 1', minutes: 12, stage: 0, sprint: true }, { id: 'SQ2', kind: 'quali', name: 'Sprint Qualifying 2', minutes: 10, stage: 1, sprint: true }, { id: 'SQ3', kind: 'quali', name: 'Sprint Qualifying 3', minutes: 8, stage: 2, sprint: true },
        { id: 'SPR', kind: 'race', name: 'Sprint', minutes: 30, sprint: true, km: 100, noMandatoryStop: true },
        { id: 'Q1', kind: 'quali', name: 'Qualifying 1', minutes: 18, stage: 0, reopensParc: true }, { id: 'Q2', kind: 'quali', name: 'Qualifying 2', minutes: 15, stage: 1 }, { id: 'Q3', kind: 'quali', name: 'Qualifying 3', minutes: 12, stage: 2 },
        { id: 'GP', kind: 'race', name: 'Grand Prix', minutes: 0, grandPrix: true },
      ],
    },
    rule107: 1.07,              // a driver slower than 107 % of the fastest Q1 time does not qualify
    q1Eliminated22: 6, q1Eliminated20: 5, q3Size: 10,
    tyres: { H: 2, M: 3, S: 8, I: 4, W: 3, q3ReservedSoft: 1 },       // 13 dry sets (2 Hard, 3 Medium, 8 Soft, one of them kept for Q3), plus inters and wets
    dry: ['S', 'M', 'H'], wet: ['I', 'W'],
    parcAllowed: ['frontWing', 'brakeBias', 'diffOnThrottle', 'diffOffThrottle', 'pressureFront', 'pressureRear', 'ersMode', 'mix'],     // what may still be changed once the cars are in parc fermé
    parcLocked: ['rideHeightMm', 'suspension', 'gearRatios', 'aeroSpec', 'rearWing', 'floorSpec'],
    minPressureOffset: -1.0,    // Pirelli's minimum tyre pressure, as an offset from the reference (psi)
    components: { ice: 4, tc: 4, mguk: 4, es: 2, ce: 2, exhaust: 8 },     // the season's pool
    firstExtraPlaces: 10, nextExtraPlaces: 5,
    gridSize: 22,
    baseLapsInSegment: 8,       // game laps in an 18-minute qualifying segment; the others scale with their real minutes
  };

  // ---- sessions

  /// The sessions of a weekend flow ('standard' or 'sprint').
  const sessionsOf = (flow) => (WK.flows[flow] || WK.flows.standard).map((s) => Object.assign({}, s));
  /// How many game laps a timed session lasts, from its real minutes (an 18-minute qualifying segment is about 8 laps of the game's quick lap).
  const lapsFor = (session, base = WK.baseLapsInSegment) => Math.max(2, Math.round(base * (session.minutes || 18) / 18));

  /// A new weekend. opt: flow, cars (ids), tyreSets override, pool (the season component pool, from a previous weekend), grandPrixLaps, street (tight street circuit).
  function create(opt = {}) {
    const flow = WK.flows[opt.flow] ? opt.flow : 'standard', cars = (opt.cars || []).slice();
    const w = { flow, sessions: sessionsOf(flow), index: 0, cars, results: {}, grid: null, gridInfo: null, street: !!opt.street, quali: { out: [[], [], []], times: {}, through: cars.slice(), failed107: [], allowed107: new Set() },
      parc: { locked: false, setups: {}, violations: new Set(), reopened: false }, tyres: {}, pool: opt.pool || createPool(), penalties: {}, pitLaneStart: new Set(), lastGp: null, done: false, log: [] };
    for (const id of cars) w.tyres[id] = newTyres();
    return w;
  }
  const current = (w) => w.sessions[w.index] || null;
  const next = (w) => { if (w.index < w.sessions.length - 1) w.index++; else w.done = true; return current(w); };
  const log = (w, e) => { w.log.push(e); return e; };

  // ---- qualifying: knockout sizes, order, the 107 % rule

  /// How many cars start each qualifying segment for a field of `n`: 22 cars: 22, 16, 10 (the slowest 6 are out after Q1 and again after Q2).
  function knockoutSizes(n) {
    if (n < 4) return [n];
    if (n < 8) return [n, n - Math.floor(n / 3)];
    if (n >= 20) { const out1 = n >= 22 ? WK.q1Eliminated22 : WK.q1Eliminated20; return [n, n - out1, WK.q3Size]; }
    const e = Math.min(5, Math.max(1, Math.round(n / 4)));
    return [n, n - e, n - 2 * e];
  }
  /// The order by best lap (earlier time sets the order in a tie); a car with no time comes after every car with one. rows: { id, best, at }.
  function qualiOrder(rows) {
    return rows.slice().sort((a, b) => {
      const ta = a.best > 0, tb = b.best > 0;
      if (ta !== tb) return ta ? -1 : 1;
      if (ta && a.best !== b.best) return a.best - b.best;
      if (ta && (a.at || 0) !== (b.at || 0)) return (a.at || 0) - (b.at || 0);
      return String(a.id).localeCompare(String(b.id));
    });
  }
  /// Cars whose best Q1 lap is slower than 107 % of the fastest (or that set none) fail to qualify. Returns { limit, failed: [ids] }.
  function check107(rows) {
    const set = rows.filter((r) => r.best > 0), fastest = set.length ? Math.min(...set.map((r) => r.best)) : 0, limit = fastest * WK.rule107;
    return { fastest, limit, failed: rows.filter((r) => !(r.best > 0) || r.best > limit + 1e-9).map((r) => r.id) };
  }
  /// The stewards let a driver start although he missed the 107 % limit (wet weather, or his practice times were good enough).
  function allow107(w, carId, why) { w.quali.allowed107.add(carId); log(w, { type: 'dispensation', carId, why: why || '' }); }

  /// A qualifying segment is over. `rows` are { id, best, at } for the cars in it. Knocks out the slowest, applies the 107 % rule after Q1 / SQ1,
  /// and returns { order, through, out, failed107 }. Call it for each stage in turn.
  function finishQuali(w, stage, rows) {
    const sizes = knockoutSizes(w.cars.length), keep = sizes[stage + 1];
    const order = qualiOrder(rows);
    const result = { stage, order: order.map((r) => r.id), rows: order, through: [], out: [], failed107: [] };
    if (stage === 0) {
      const c = check107(order); result.limit = c.limit; result.fastest = c.fastest;
      result.failed107 = c.failed.filter((id) => !w.quali.allowed107.has(id));
      w.quali.failed107 = result.failed107.slice();
    }
    if (keep == null) { result.through = result.order.slice(); w.quali.final = order; }
    else { result.through = result.order.slice(0, keep); result.out = result.order.slice(keep); }
    w.quali.out[stage] = result.out.map((id) => order.find((r) => r.id === id));
    w.quali.through = result.through.slice();
    w.results[stage === 0 ? 'Q1' : stage === 1 ? 'Q2' : 'Q3'] = result;
    return result;
  }
  /// The starting grid (ids, pole first): the last segment's order, then those knocked out in the segment before (fastest first) and so on back to Q1;
  /// cars that failed 107 % and were not allowed to race are left out. `grid` applies penalties: { places: { id: n }, pitLane: [ids] }.
  function buildGrid(w, pen = {}) {
    const q = w.quali; let ids = [];
    if (q.final) ids = qualiOrder(q.final).map((r) => r.id);
    else ids = q.through.slice();
    for (let i = q.out.length - 1; i >= 0; i--) for (const r of qualiOrder(q.out[i] || [])) if (!ids.includes(r.id)) ids.push(r.id);
    ids = ids.filter((id) => !q.failed107.includes(id));
    for (const id of w.cars) if (!ids.includes(id) && !q.failed107.includes(id)) ids.push(id);
    return applyGridPenalties(ids, pen.places || w.penalties, pen.pitLane || [...w.pitLaneStart]);
  }
  /// Grid penalties: a car drops `places` positions (the cars it passes move up one each); pit-lane starters go to the back, behind the grid.
  function applyGridPenalties(order, places = {}, pitLane = []) {
    const grid = order.filter((id) => !pitLane.includes(id));
    // apply in grid order, from the front, so each car's drop is counted from its own qualifying position
    for (const id of order) {
      const n = places[id] || 0; if (n <= 0 || pitLane.includes(id)) continue;
      const i = grid.indexOf(id), j = Math.min(grid.length - 1, i + n);
      grid.splice(i, 1); grid.splice(j, 0, id);
    }
    return { order: grid.concat(order.filter((id) => pitLane.includes(id))), grid, pitLane: order.filter((id) => pitLane.includes(id)) };
  }

  // ---- parc fermé

  /// A car left the pit lane for the first time in Q1 / SQ1: its setup is locked from now on. `setup` is a snapshot of what it was.
  function carLeftPits(w, carId, setup) {
    const s = current(w);
    if (!s || s.kind !== 'quali') return false;
    if (s.stage !== 0 && !w.parc.locked) return false;
    if (!w.parc.setups[carId]) { w.parc.setups[carId] = Object.assign({}, setup); log(w, { type: 'parc-lock', carId }); }
    w.parc.locked = true;
    return true;
  }
  /// A setup change in parc fermé. Front wing angle, brake bias, differential, tyre pressures (not below the minimum) and the energy settings are allowed;
  /// anything else (ride height / suspension, gear ratios, aero spec) breaks parc fermé and the car starts from the pit lane.
  /// Returns { ok, violation, why }.
  function parcAdjust(w, carId, key, value) {
    const locked = w.parc.locked && w.parc.setups[carId] && !w.parc.reopened;
    if (!locked) return { ok: true };
    if (WK.parcAllowed.includes(key)) {
      if ((key === 'pressureFront' || key === 'pressureRear') && value < WK.minPressureOffset) return { ok: false, violation: false, why: 'below the minimum tyre pressure' };
      return { ok: true };
    }
    w.parc.violations.add(carId); w.pitLaneStart.add(carId); log(w, { type: 'parc-violation', carId, key });
    return { ok: true, violation: true, why: `changing ${key} in parc fermé: pit lane start` };
  }
  /// Between the Sprint and Qualifying parc fermé re-opens briefly (a sprint weekend): setups may change, then it is locked again at Q1.
  function reopenParc(w) { if (w.flow === 'sprint') { w.parc.reopened = true; w.parc.locked = false; w.parc.setups = {}; log(w, { type: 'parc-reopen' }); return true; } return false; }

  // ---- tyres

  /// A car's tyre sets for the weekend: how many of each compound there are, and how many have been used.
  function newTyres() { return { total: { S: WK.tyres.S, M: WK.tyres.M, H: WK.tyres.H, I: WK.tyres.I, W: WK.tyres.W }, used: { S: 0, M: 0, H: 0, I: 0, W: 0 }, raceCompounds: [] }; }
  const dryTotal = () => WK.tyres.S + WK.tyres.M + WK.tyres.H;
  /// Sets of a compound the car may still use in this session. The last soft is only for Q3.
  function setsLeft(w, carId, compound, sessionId) {
    const t = w.tyres[carId]; if (!t || !t.total[compound]) return 0;
    const reserved = compound === 'S' && sessionId !== 'Q3' ? WK.tyres.q3ReservedSoft : 0;
    return Math.max(0, t.total[compound] - t.used[compound] - reserved);
  }
  /// Use a new set. Returns { ok, why }.
  function useSet(w, carId, compound, sessionId) {
    const t = w.tyres[carId]; if (!t) return { ok: false, why: 'unknown car' };
    if (!t.total[compound]) return { ok: false, why: 'no such compound' };
    if (setsLeft(w, carId, compound, sessionId) <= 0) return { ok: false, why: compound === 'S' && sessionId !== 'Q3' ? 'no Soft sets left (one is kept for Q3)' : 'no sets left' };
    t.used[compound]++;
    if (sessionId === 'GP' || sessionId === 'SPR') t.raceCompounds.push(compound);
    return { ok: true };
  }
  /// The dry-race rule: at least two different dry compounds, unless intermediates or wets were used (then it is waived). Returns { ok, why }.
  function compoundRule(compounds, o = {}) {
    const list = compounds || [];
    if (o.waived) return { ok: true, waived: true };
    if (list.some((c) => WK.wet.includes(c))) return { ok: true, waived: true, why: 'intermediate or wet tyres were used' };
    const distinct = new Set(list.filter((c) => WK.dry.includes(c)));
    return distinct.size >= 2 ? { ok: true } : { ok: false, why: 'used fewer than two different dry compounds' };
  }
  /// A red flag stop under which tyres were changed counts toward the rule: the same function, fed the compounds fitted then.
  const compoundsWithRed = (used, redFitted) => (used || []).concat(redFitted || []);

  // ---- the season's component pool

  const createPool = () => ({ used: { ice: 1, tc: 1, mguk: 1, es: 1, ce: 1, exhaust: 1 }, penaltyHistory: [], extras: { ice: 0, tc: 0, mguk: 0, es: 0, ce: 0, exhaust: 0 } });
  /// Fit a new component. Over the season's allowance, the first extra one of that kind costs a 10-place grid penalty, each one after it 5 places.
  /// Returns { places, over }.
  function fitComponent(pool, kind) {
    if (!(kind in WK.components)) return { places: 0, over: false, why: 'unknown component' };
    pool.used[kind] = (pool.used[kind] || 0) + 1;
    if (pool.used[kind] <= WK.components[kind]) return { places: 0, over: false };
    pool.extras[kind]++;
    const places = pool.extras[kind] === 1 ? WK.firstExtraPlaces : WK.nextExtraPlaces;
    pool.penaltyHistory.push({ kind, places });
    return { places, over: true };
  }
  /// The grid penalty (places) a weekend's component changes add up to, capped at the size of the grid.
  const placesFor = (changes) => Math.min(WK.gridSize, (changes || []).reduce((a, c) => a + (c.places || 0), 0));
  const serializePool = (pool) => JSON.stringify(pool);
  function loadPool(text) {
    try { const p = JSON.parse(text); if (p && p.used && p.extras) return p; } catch { /* fall through */ }
    return createPool();
  }

  const api = { WK, sessionsOf, lapsFor, create, current, next, knockoutSizes, qualiOrder, check107, allow107, finishQuali, buildGrid, applyGridPenalties, carLeftPits, parcAdjust, reopenParc,
    newTyres, dryTotal, setsLeft, useSet, compoundRule, compoundsWithRed, createPool, fitComponent, placesFor, serializePool, loadPool };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.NotchRaceF1 = root.NotchRaceF1 || {};
  root.NotchRaceF1.weekend = api;
})(typeof window !== 'undefined' ? window : globalThis);
