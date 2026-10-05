// The F1 tab: the running order (live during a session, else the last race's
// classification) on the left; the next weekend with a countdown and the
// standings on the right. Click a driver to follow them on the pill.

import { el, fmtTime, dayLabel } from '../store.js';
import { segmented, iconBtn, empty } from '../ui.js';
import * as F from '../services/f1.js';

function countdown(d) {
  const ms = d - Date.now();
  if (ms <= 0) return 'now';
  const m = Math.floor(ms / 60e3), h = Math.floor(m / 60), days = Math.floor(h / 24);
  return days ? `${days}d ${h % 24}h` : h ? `${h}h ${m % 60}m` : `${m}m`;
}

export function render(root) {
  let alive = true;
  let tab = 'drivers';
  const tower = el('div', { class: 'card col', style: 'flex:1.2;min-width:0;overflow:auto;gap:4px' });
  const next = el('div', { class: 'card col gap-6' });
  const standings = el('div', { class: 'card col', style: 'flex:1;min-height:0;overflow:auto;gap:4px' });
  root.append(el('div', { class: 'row fill' }, tower, el('div', { class: 'col', style: 'flex:1;min-width:0' }, next, standings)));

  function row(pos, code, name, team, right, { fastest = false } = {}) {
    const mine = code && F.followed() === code;
    return el('div', { class: 'item clickable', style: `padding:3px 6px;${mine ? 'background:rgba(255,255,255,.12)' : ''}`,
      title: mine ? `Following ${name} — click to stop` : `Follow ${name}: their position shows on the pill during sessions`,
      onclick: () => { if (code) { F.follow(code); paint(); } } },
      el('span', { class: 'num', style: 'width:22px;font-weight:700;text-align:right' }, pos),
      el('span', { style: `width:3px;height:14px;border-radius:2px;background:${F.colourOf(team)}` }),
      el('span', { class: 'mono', style: 'width:36px;font-weight:700' }, code || ''),
      el('span', { class: 'grow ellipsis small dim' }, name, fastest ? ' ⏱' : ''),
      el('span', { class: 'num small' }, right || ''));
  }

  function paint() {
    const d = F.get();
    // ---- tower ----
    tower.replaceChildren();
    const live = d.live;
    if (live) {
      tower.append(el('div', { class: 'hstack' },
        live.state === 'in' ? el('span', { class: 'badge live' }, 'LIVE') : el('span', { class: 'badge quiet' }, 'FINISHED'),
        el('span', { class: 'title grow ellipsis' }, `${live.session} · ${live.event}`),
        live.lap && live.session === 'Race' ? el('span', { class: 'num small dim' }, `Lap ${live.lap}`) : null,
        iconBtn('⟳', 'Refresh', refreshAll)));
      tower.append(el('div', { class: 'tiny faint' }, live.state === 'in' ? 'Running order · gaps appear when F1 publishes the timing' : 'Provisional order'));
      tower.append(...live.order.map((o) => row(o.pos, o.code, o.name, o.team)));
    } else if (d.last) {
      tower.append(el('div', { class: 'hstack' }, el('span', { class: 'title grow ellipsis' }, d.last.name), iconBtn('⟳', 'Refresh', refreshAll)));
      tower.append(el('div', { class: 'tiny faint' }, 'Last race · final classification'));
      tower.append(...d.last.rows.map((r) => row(r.pos, r.code, r.name, r.team, r.time, { fastest: r.fastest })));
    } else {
      tower.append(d.at ? empty('🏁', 'No timing yet', 'The order appears here during sessions.') : el('div', { class: 'skel', style: 'height:240px' }));
    }

    // ---- next ----
    next.replaceChildren();
    if (d.weekend) {
      const n = F.nextSession();
      next.append(el('div', { class: 'title ellipsis' }, `Round ${d.weekend.round} · ${d.weekend.name}`),
        el('div', { class: 'tiny dim' }, d.weekend.place || d.weekend.circuit),
        n ? el('div', { class: 'hstack' }, el('span', { class: 'small dim grow' }, `${n.name} starts in`), el('span', { class: 'num accent', style: 'font-weight:700' }, countdown(n.start))) : null,
        ...d.weekend.sessions.map((s) => el('div', { class: 'hstack small', style: s.start < Date.now() ? 'opacity:.55' : '' },
          el('span', { class: 'grow' }, s.name), el('span', { class: 'num dim' }, `${dayLabel(s.start).replace(/,.*/, '')} ${fmtTime(s.start)}`))));
    } else next.append(d.at ? el('div', { class: 'small dim' }, 'The season is over. See you next year.') : el('div', { class: 'skel', style: 'height:80px' }));

    // ---- standings ----
    standings.replaceChildren(segmented([{ value: 'drivers', label: 'Drivers' }, { value: 'teams', label: 'Teams' }], tab, (v) => { tab = v; paint(); }));
    if (tab === 'drivers') standings.append(...d.drivers.map((x) => row(x.pos, x.code, x.name, x.team, `${x.points}`)));
    else standings.append(...d.teams.map((x) => el('div', { class: 'hstack small', style: 'padding:3px 6px' },
      el('span', { class: 'num', style: 'width:22px;font-weight:700;text-align:right' }, x.pos),
      el('span', { style: `width:3px;height:14px;border-radius:2px;background:${F.colourOf(x.name)}` }),
      el('span', { class: 'grow ellipsis' }, x.name), el('span', { class: 'num' }, x.points))));
  }

  async function refreshAll() { await F.loadAll(); if (alive) paint(); }

  paint();
  refreshAll();
  const t = setInterval(async () => { if (F.get().live?.state === 'in') { await F.loadLive().catch(() => {}); } if (alive) paint(); }, 20e3);
  return () => { alive = false; clearInterval(t); };
}
