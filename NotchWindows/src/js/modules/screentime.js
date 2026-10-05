// Screen Time (Pro): time per app, daily limits, and apps blocked during Focus.
import { el, load, save, fmtDuration, todayKey } from '../store.js';
import { segmented, menu, prompt, toast } from '../ui.js';
import * as ST from '../services/screentime.js';

export function render(root) {
  let range = 'today';
  const list = el('div', { class: 'col gap-4 scroll', style: 'flex:1' }), total = el('div', { class: 'big num' }), week = el('div', { class: 'hstack', style: 'align-items:flex-end;gap:6px;height:80px' });
  async function paint() {
    const u = await ST.usage();
    const days = Object.keys(u).sort().slice(-7);
    const agg = {};
    for (const d of range === 'today' ? [todayKey()] : days) for (const [a, s] of Object.entries(u[d] || {})) agg[a] = (agg[a] || 0) + s;
    const rows = Object.entries(agg).sort((a, b) => b[1] - a[1]);
    const max = rows[0]?.[1] || 1, sum = rows.reduce((x, [, s]) => x + s, 0);
    total.textContent = fmtDuration(range === 'today' ? sum : sum / Math.max(1, days.length));
    const limits = ST.limits(), block = ST.blockList();
    list.replaceChildren(...rows.slice(0, 30).map(([a, s]) => {
      const row = el('div', { class: 'item', style: 'padding:4px 6px' }, el('div', { class: 'main' },
        el('div', { class: 'hstack small' }, el('span', { class: 'grow ellipsis' }, a, limits[a] ? ` · limit ${limits[a]} min` : '', block.includes(a) ? ' · blocked in Focus' : ''), el('span', { class: 'num dim' }, fmtDuration(s))),
        el('div', { class: 'bar thin' }, el('i', { style: `width:${(s / max) * 100}%` }))));
      row.addEventListener('contextmenu', (e) => menu(e, [
        { label: limits[a] ? 'Change daily limit' : 'Set a daily limit', run: async () => { const v = await prompt(`Daily limit for ${a} (minutes)`, { value: limits[a] || '' }); if (v === null) return; const l = ST.limits(); if (Number(v) > 0) l[a] = Number(v); else delete l[a]; save('screentime.limits', l); paint(); } },
        { label: block.includes(a) ? 'Don’t block during Focus' : 'Block during Focus', run: () => { save('screentime.block', block.includes(a) ? block.filter((x) => x !== a) : [...block, a]); paint(); } }]));
      return row;
    }));
    if (!rows.length) list.append(el('div', { class: 'small dim' }, 'Screen Time starts counting now. Check back in a little while.'));
    week.replaceChildren(...days.map((d) => { const s = Object.values(u[d] || {}).reduce((x, y) => x + y, 0); const all = days.map((k) => Object.values(u[k] || {}).reduce((x, y) => x + y, 0)); return el('div', { class: 'col', style: 'align-items:center;gap:2px;flex:1', title: fmtDuration(s) },
      el('div', { style: `width:100%;max-width:26px;height:${Math.max(3, (s / Math.max(...all, 1)) * 60)}px;background:var(--accent);border-radius:4px` }), el('div', { class: 'tiny faint' }, new Date(`${d}T12:00`).toLocaleDateString([], { weekday: 'narrow' }))); }));
  }
  root.append(el('div', { class: 'row fill' },
    el('div', { class: 'card col', style: 'flex:0 0 230px' }, segmented([{ value: 'today', label: 'Today' }, { value: 'week', label: 'Daily average' }], range, (v) => { range = v; paint(); }), total, week,
      el('label', { class: 'hstack small dim' }, el('input', { type: 'checkbox', checked: load('screentime.enforce', false), onchange: (e) => save('screentime.enforce', e.target.checked) }), 'Minimise apps over their limit'),
      el('div', { class: 'tiny faint' }, 'Right-click an app to set a limit or block it during Focus. Only counted while you’re at the PC; stays on this PC.')),
    el('div', { class: 'card col', style: 'flex:1' }, list)));
  paint();
  const t = setInterval(paint, 30000);
  return () => clearInterval(t);
}
export { toast };
