// The Multi-Function Display (the F1 steering-wheel screen): the pages, the settings on them with their limits and steps (brake bias, differentials,
// ERS mode, front wing, tyre pressures, fuel mixture, pit strategy), moving about it and changing a value, parc fermé checks through a callback, and the
// rows for the live timing page. A data model only: the game draws it. Pure: no DOM, no clock, no randomness.
//
// ALL TUNABLE NUMBERS ARE IN `MFD` BELOW.
(function (root) {
  'use strict';
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

  const MFD = {
    items: {
      brakeBias: { label: 'Brake bias', unit: '% front', min: 50, max: 62, step: 0.5, def: 56 },
      diffOnThrottle: { label: 'Diff on throttle', unit: '%', min: 50, max: 100, step: 5, def: 70 },
      diffOffThrottle: { label: 'Diff off throttle', unit: '%', min: 40, max: 90, step: 5, def: 60 },
      frontWing: { label: 'Front wing', unit: 'steps', min: -5, max: 5, step: 1, def: 0 },
      pressureFront: { label: 'Pressure front', unit: 'psi', min: -2, max: 3, step: 0.5, def: 0 },
      pressureRear: { label: 'Pressure rear', unit: 'psi', min: -2, max: 3, step: 0.5, def: 0 },
      ersMode: { label: 'ERS mode', options: ['LOW', 'MEDIUM', 'HIGH'], def: 'MEDIUM' },
      mix: { label: 'Fuel mixture', options: ['LEAN', 'STD', 'RICH'], def: 'STD' },
      plan: { label: 'Pit strategy', options: [], def: null },
    },
    pages: [
      { id: 'setup', title: 'SETUP', items: ['brakeBias', 'diffOnThrottle', 'diffOffThrottle', 'frontWing'] },
      { id: 'energy', title: 'ENERGY', items: ['ersMode', 'mix'] },
      { id: 'tyres', title: 'TYRES', items: ['pressureFront', 'pressureRear'] },
      { id: 'strategy', title: 'STRATEGY', items: ['plan'] },
      { id: 'timing', title: 'TIMING', items: [] },
    ],
  };
  const keys = Object.keys(MFD.items);

  /// A new display. opt.values: starting settings (anything not given takes its default).
  function create(opt = {}) {
    const values = {}; for (const k of keys) values[k] = opt.values && opt.values[k] !== undefined ? opt.values[k] : MFD.items[k].def;
    return { page: 0, row: 0, values, plans: [], flash: null };
  }
  const pageOf = (m) => MFD.pages[m.page];
  const selected = (m) => pageOf(m).items[m.row] || null;
  /// Move about: 'next' / 'prev' change page, 'down' / 'up' change the row. Returns the selected setting (or null).
  function navigate(m, dir) {
    const n = MFD.pages.length;
    if (dir === 'next') { m.page = (m.page + 1) % n; m.row = 0; }
    else if (dir === 'prev') { m.page = (m.page - 1 + n) % n; m.row = 0; }
    else if (dir === 'down') { const c = pageOf(m).items.length; if (c) m.row = (m.row + 1) % c; }
    else if (dir === 'up') { const c = pageOf(m).items.length; if (c) m.row = (m.row - 1 + c) % c; }
    return selected(m);
  }

  /// Offer the pit strategies for a race: stops are laps with the compound to fit. lapsTotal, wet (a wet race), noStops (a sprint: no mandatory stop).
  function makePlans(lapsTotal, o = {}) {
    if (o.wet) return [{ id: 'I', label: 'Inters, stop for slicks when dry', stops: [{ lap: Math.round(lapsTotal * 0.6), compound: 'M' }] }, { id: 'W', label: 'Wets, then inters', stops: [{ lap: Math.round(lapsTotal * 0.5), compound: 'I' }] }];
    const a = Math.max(2, Math.round(lapsTotal * 0.4)), b = Math.max(2, Math.round(lapsTotal * 0.5)), c = Math.max(2, Math.round(lapsTotal * 0.6));
    const plans = [{ id: 'M-H', label: 'Medium, then Hard', stops: [{ lap: b, compound: 'H' }] }, { id: 'S-M', label: 'Soft, then Medium (early stop)', stops: [{ lap: a, compound: 'M' }] }, { id: 'H-M', label: 'Hard, then Medium (late stop)', stops: [{ lap: c, compound: 'M' }] }];
    if (lapsTotal >= 8) plans.push({ id: 'S-M-S', label: 'Two stops: Soft, Medium, Soft', stops: [{ lap: Math.round(lapsTotal / 3), compound: 'M' }, { lap: Math.round(lapsTotal * 2 / 3), compound: 'S' }] });
    if (o.noStops) plans.unshift({ id: 'none', label: 'No stop (sprint)', stops: [] });
    return plans;
  }
  function setPlans(m, plans, keep) {
    m.plans = plans; MFD.items.plan.options = plans.map((p) => p.id);
    if (!plans.some((p) => p.id === m.values.plan)) m.values.plan = (plans[0] && plans[0].id) || null;
    if (keep) m.values.plan = keep;
  }
  const planOf = (m) => m.plans.find((p) => p.id === m.values.plan) || null;

  /// Change a setting one step. `dir` +1 or −1. `ctx.parc(key, value)` may veto (parc fermé) and returns { ok, violation, why }.
  /// Returns { ok, key, value, violation, why }.
  function adjust(m, key, dir, ctx = {}) {
    const k = key || selected(m), it = MFD.items[k];
    if (!it) return { ok: false, why: 'no such setting' };
    const cur = m.values[k]; let next;
    if (it.options) {
      const opts = k === 'plan' ? m.plans.map((p) => p.id) : it.options;
      if (!opts.length) return { ok: false, key: k, why: 'nothing to choose' };
      const i = opts.indexOf(cur); next = opts[clamp((i < 0 ? 0 : i) + (dir > 0 ? 1 : -1), 0, opts.length - 1)];
    } else next = Math.round(clamp(cur + (dir > 0 ? it.step : -it.step), it.min, it.max) / it.step) * it.step;
    if (next === cur) return { ok: true, key: k, value: cur, unchanged: true };
    let verdict = { ok: true };
    if (ctx.parc && k !== 'plan') verdict = ctx.parc(k, next) || { ok: true };
    if (verdict.ok === false) { m.flash = { text: verdict.why || 'not allowed', key: k }; return { ok: false, key: k, value: cur, why: verdict.why }; }
    m.values[k] = next;
    if (verdict.violation) m.flash = { text: verdict.why, key: k, violation: true };
    return { ok: true, key: k, value: next, violation: !!verdict.violation, why: verdict.why };
  }
  /// Write the display's settings into a car sim's setup (brake bias, diffs, wing, pressures, ERS mode, mixture).
  function applyToSim(m, sim) {
    for (const k of keys) if (k !== 'plan') sim.setup[k] = m.values[k];
    return sim.setup;
  }
  const fmtValue = (k, v) => { const it = MFD.items[k]; if (it.options) return k === 'plan' ? String(v || '–') : String(v); return `${v > 0 && k === 'frontWing' ? '+' : ''}${Number.isInteger(v) ? v : v.toFixed(1)} ${it.unit}`; };
  /// The rows of the current page for drawing: [{ key, label, value, selected }]. The timing page has none (use timingRows).
  function rows(m) {
    return pageOf(m).items.map((k, i) => ({ key: k, label: MFD.items[k].label, value: fmtValue(k, m.values[k]), selected: i === m.row, plan: k === 'plan' ? planOf(m) : null }));
  }
  const sign = (x) => (x >= 0 ? '+' : '−') + Math.abs(x).toFixed(3);
  /// The timing page: live sector deltas to the best lap, tyre temperatures (surface and carcass) and the flag. d: { sectors: [delta seconds], lapDelta, surface: [4], carcass: [4], flag, window }.
  function timingRows(d) {
    const out = [];
    (d.sectors || []).forEach((x, i) => out.push({ label: `Sector ${i + 1}`, value: x == null ? '–' : sign(x), good: x != null && x <= 0 }));
    if (d.lapDelta != null) out.push({ label: 'Lap delta', value: sign(d.lapDelta), good: d.lapDelta <= 0 });
    const names = ['FL', 'FR', 'RL', 'RR'];
    (d.carcass || []).forEach((c, i) => { const s = d.surface ? d.surface[i] : null, w = d.window || [0, 999]; out.push({ label: `Tyre ${names[i]}`, value: `${Math.round(s ?? c)}° / ${Math.round(c)}°`, state: c < w[0] ? 'cold' : c > w[1] ? 'hot' : 'ok' }); });
    if (d.flag) out.push({ label: 'Track', value: d.flag });
    return out;
  }

  const api = { MFD, create, pageOf, selected, navigate, makePlans, setPlans, planOf, adjust, applyToSim, rows, timingRows, fmtValue };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.NotchRaceF1 = root.NotchRaceF1 || {};
  root.NotchRaceF1.mfd = api;
})(typeof window !== 'undefined' ? window : globalThis);
