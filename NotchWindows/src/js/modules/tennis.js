// The Tennis tab: every match of the week on the left, split into Men, Women and
// Mixed, with the tournament in a banner (red for a Grand Slam) and arrows back to
// earlier weeks; the ATP and WTA top 20 and your favourite players on the right.
// Star a player to follow them: their live score shows on the pill.

import { el, load, save, fmtTime, dayLabel } from '../store.js';
import { segmented, iconBtn, empty, menu } from '../ui.js';
import * as T from '../services/tennis.js';

const DRAWS = [{ value: 'men', label: 'Men' }, { value: 'women', label: 'Women' }, { value: 'mixed', label: 'Mixed' }];

function flag(p, size = 14) {
  if (p.flag) return el('img', { class: 'tn-flag', src: p.flag, width: size, height: Math.round(size * 0.7), alt: p.country || '', title: p.country || '' });
  if (p.emoji) return el('span', { class: 'tn-flag-emoji', title: p.country || '' }, p.emoji);
  return el('span', { class: 'tn-flag-empty' });
}

function weekLabel(offset) {
  if (offset === 0) return 'This week';
  if (offset === -1) return 'Last week';
  if (offset === 1) return 'Next week';
  const d = T.weekDate(offset);
  return `Week of ${d.toLocaleDateString([], { day: 'numeric', month: 'short', year: d.getFullYear() === new Date().getFullYear() ? undefined : 'numeric' })}`;
}

export function render(root) {
  let alive = true;
  let draw = load('tennis.draw', 'men');
  let kind = load('tennis.kind', 'all');        // all | singles | doubles
  let tour = load('tennis.tour', 'atp');
  let eventId = null;
  let loading = false;

  const left = el('div', { class: 'card col tn-main', style: 'flex:1.55;min-width:0;overflow:hidden;gap:8px;padding:12px 14px' });
  const right = el('div', { class: 'card col', style: 'flex:1;min-width:0;overflow:auto;gap:6px;padding:12px 14px' });
  root.append(el('div', { class: 'row fill' }, left, right));

  const events = () => T.get().events;
  const current = () => events().find((e) => e.id === eventId) || events()[0] || null;

  function slamMenu(e) {
    const now = new Date();
    const items = [];
    // The last four Grand Slams that have started, newest first, plus the next one.
    for (let y = now.getFullYear() + 1; y >= now.getFullYear() - 1; y--) {
      for (const s of [...T.SLAM_DATES].reverse()) {
        const d = new Date(y, s.month, s.day);
        items.push({ d, label: `${s.name} ${y}` });
      }
    }
    const past = items.filter((i) => i.d <= now).slice(0, 4);
    const next = items.filter((i) => i.d > now).pop();
    menu(e, [next && { label: `🔜 ${next.label}`, run: () => jump(next.d) }, next && 'sep',
      ...past.map((i) => ({ label: `🏆 ${i.label}`, run: () => jump(i.d) }))]);
  }

  async function jump(date) {
    loading = true; eventId = null; paintLeft();
    await T.loadAround(date).catch(() => {});
    // Pick the Grand Slam if that week has one.
    eventId = events().find((ev) => ev.slam)?.id || null;
    loading = false; if (alive) paint();
  }

  async function go(offset) {
    loading = true; eventId = null; paintLeft();
    await T.loadWeek(offset).catch(() => {});
    loading = false; if (alive) paint();
  }

  function banner(ev) {
    const d = T.get();
    const dates = ev?.start ? `${ev.start.toLocaleDateString([], { day: 'numeric', month: 'short' })}${ev.end ? ` – ${ev.end.toLocaleDateString([], { day: 'numeric', month: 'short' })}` : ''}` : '';
    const live = ev?.matches.filter((m) => m.state === 'in').length || 0;
    return el('div', { class: `tn-banner ${ev?.slam ? 'slam' : ''}` },
      el('div', { class: 'tn-ball', 'aria-hidden': 'true' }),
      el('div', { class: 'grow', style: 'min-width:0' },
        el('div', { class: 'hstack', style: 'gap:6px' },
          ev?.slam ? el('span', { class: 'tn-slam-badge' }, '🏆 GRAND SLAM') : el('span', { class: 'tn-tour-badge' }, (ev?.tours || [ev?.tour]).filter(Boolean).map((t) => t.toUpperCase()).join(' · ') || 'TENNIS'),
          live ? el('span', { class: 'badge live' }, `${live} LIVE`) : null),
        el('div', { class: 'tn-event-name ellipsis' }, ev?.name || 'Tennis'),
        el('div', { class: 'tiny tn-sub ellipsis' }, [ev?.place, dates].filter(Boolean).join(' · ') || ' ')),
      el('div', { class: 'col', style: 'gap:4px;align-items:flex-end' },
        el('div', { class: 'hstack', style: 'gap:2px' },
          iconBtn('‹', 'Previous week', () => go(d.week - 1)),
          el('span', { class: 'small tn-week' }, weekLabel(d.week)),
          iconBtn('›', 'Next week', () => go(d.week + 1)),
          iconBtn('⟳', 'Refresh', () => go(d.week))),
        el('div', { class: 'hstack', style: 'gap:4px' },
          d.week !== 0 ? el('span', { class: 'chip clickable', onclick: () => go(0) }, 'Today') : null,
          el('span', { class: 'chip clickable', onclick: slamMenu, title: 'Jump to a Grand Slam' }, '🏆 Slams ▾'))));
  }

  function setsRow(p, other, m) {
    const cells = p.sets.map((s, k) => {
      const o = other?.sets[k];
      const won = s.won || (m.state !== 'in' || k < p.sets.length - 1) && o && s.games > o.games;
      return el('span', { class: `tn-set ${won ? 'won' : ''} ${m.state === 'in' && k === p.sets.length - 1 ? 'cur' : ''}` },
        String(s.games), s.tiebreak != null && s.tiebreak !== '' ? el('sup', {}, String(s.tiebreak)) : null);
    });
    return el('div', { class: 'tn-sets' }, cells);
  }

  function playerLine(m, i) {
    const p = m.players[i];
    if (!p) return null;
    const fav = T.isFavourite(p.name) || p.name.split(' / ').some(T.isFavourite);
    const lost = m.state === 'post' && m.players.some((x) => x.winner) && !p.winner;
    const single = !p.name.includes('/');
    return el('div', { class: `tn-pl ${p.winner ? 'win' : ''} ${lost ? 'lost' : ''}` },
      flag(p),
      el('span', { class: `tn-name ellipsis ${fav ? 'fav' : ''}`, title: single ? (fav ? `Stop following ${p.name}` : `Follow ${p.name}: their live score shows on the pill`) : p.name,
        onclick: single ? (e) => { e.stopPropagation(); T.toggleFavourite(p.name); paint(); } : null },
        fav ? '★ ' : '', p.name),
      p.seed ? el('span', { class: 'tiny faint' }, `(${p.seed})`) : null,
      m.state === 'in' && p.serving ? el('span', { class: 'tn-serve', title: 'Serving' }) : null,
      el('span', { class: 'grow' }),
      p.winner ? el('span', { class: 'tn-check' }, '✓') : null,
      setsRow(p, m.players[1 - i], m));
  }

  function matchCard(m, ev) {
    const status = m.state === 'in' ? el('span', { class: 'tn-live' }, el('i'), m.detail && !/^in progress$/i.test(m.detail) ? m.detail : 'LIVE')
      : m.state === 'pre' ? el('span', { class: 'tiny dim num' }, m.date ? `${dayLabel(m.date).replace(/,.*/, '')} ${fmtTime(m.date)}` : 'Scheduled')
      : el('span', { class: 'tiny faint' }, m.detail || 'Final');
    return el('div', { class: `tn-match ${m.state} ${ev?.slam ? 'slam' : ''}` },
      el('div', { class: 'hstack tn-meta' }, el('span', { class: 'tiny faint ellipsis grow' }, [m.round, m.court].filter(Boolean).join(' · ')), status),
      playerLine(m, 0), playerLine(m, 1));
  }

  function paintLeft() {
    left.replaceChildren();
    const d = T.get();
    const evs = events();
    const ev = current();
    left.classList.toggle('slam', !!ev?.slam);
    left.append(banner(ev));

    if (evs.length > 1) {
      left.append(el('div', { class: 'tn-chips' }, evs.map((x) => el('span', {
        class: `chip clickable ${x === ev ? 'on' : ''} ${x.slam ? 'tn-chip-slam' : ''}`,
        onclick: () => { eventId = x.id; paintLeft(); } }, x.slam ? '🏆 ' : '', x.name, x.matches.some((m) => m.state === 'in') ? ' •' : ''))));
    }

    const all = ev ? ev.matches : [];
    const counts = Object.fromEntries(DRAWS.map((o) => [o.value, all.filter((m) => m.draw === o.value).length]));
    const drawOpts = DRAWS.map((o) => ({ value: o.value, label: counts[o.value] ? `${o.label} ${counts[o.value]}` : o.label }));
    left.append(el('div', { class: 'hstack' },
      segmented(drawOpts, draw, (v) => { draw = v; save('tennis.draw', v); paintLeft(); }),
      el('span', { class: 'grow' }),
      draw !== 'mixed' ? segmented([{ value: 'all', label: 'All' }, { value: 'singles', label: 'Singles' }, { value: 'doubles', label: 'Doubles' }], kind,
        (v) => { kind = v; save('tennis.kind', v); paintLeft(); }) : null));

    const list = el('div', { class: 'col tn-list' });
    left.append(list);
    if (loading || (!d.at && !d.error)) { list.append(el('div', { class: 'skel', style: 'height:220px' })); return; }
    if (d.error && !evs.length) { list.append(empty('🎾', d.error, 'Check your connection, then press ⟳.')); return; }
    if (!ev) { list.append(empty('🎾', 'No tournaments this week', 'Use ‹ to see earlier weeks, or 🏆 Slams to jump to a Grand Slam.')); return; }

    let ms = all.filter((m) => m.draw === draw);
    if (draw !== 'mixed' && kind !== 'all') ms = ms.filter((m) => (kind === 'doubles') === /doubles/i.test(m.group));
    if (!ms.length) {
      list.append(empty('🎾', `No ${DRAWS.find((o) => o.value === draw).label.toLowerCase()}'s matches here`,
        draw === 'mixed' ? 'Mixed doubles is played at the Grand Slams.' : 'Try another tournament or week.'));
      return;
    }
    ms = T.sortMatches(ms);
    // Favourites' matches float to the top.
    ms.sort((a, b) => (b.players.some((p) => T.isFavourite(p.name)) - a.players.some((p) => T.isFavourite(p.name))));
    let lastHead = '';
    for (const m of ms) {
      const head = m.state === 'in' ? 'Live now' : m.state === 'pre' ? 'Coming up' : 'Results';
      if (head !== lastHead) { list.append(el('div', { class: `tn-head ${m.state}` }, head)); lastHead = head; }
      list.append(matchCard(m, ev));
    }
  }

  function paintRight() {
    right.replaceChildren();
    const d = T.get();
    const favs = T.favourites();

    // ---- favourites ----
    const input = el('input', { class: 'field', placeholder: 'Add a favourite player…', list: 'tn-players', style: 'flex:1;min-width:0' });
    const add = () => { const v = input.value.trim(); if (v && !T.isFavourite(v)) T.toggleFavourite(v); input.value = ''; paint(); };
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') add(); });
    right.append(el('div', { class: 'hstack' }, el('span', { class: 'tn-star' }, '★'), el('span', { class: 'title', style: 'font-size:13px' }, 'Favourite players')),
      el('div', { class: 'tn-chips' }, favs.length
        ? favs.map((f) => el('span', { class: 'chip tn-fav-chip', title: `Stop following ${f}` }, f, el('button', { class: 'tn-x', 'aria-label': `Remove ${f}`, onclick: () => { T.toggleFavourite(f); paint(); } }, '×')))
        : el('span', { class: 'tiny dim' }, 'Star players below or in a match. Their live score shows on the pill.')),
      el('div', { class: 'hstack' }, input, el('button', { class: 'btn small', onclick: add }, 'Add')),
      el('datalist', { id: 'tn-players' }, T.allPlayers().map((n) => el('option', { value: n }))));

    // ---- top 20 ----
    right.append(el('div', { class: 'hstack', style: 'margin-top:6px' },
      el('span', { class: 'title grow', style: 'font-size:13px' }, 'Top 20'),
      segmented([{ value: 'atp', label: 'ATP' }, { value: 'wta', label: 'WTA' }], tour, (v) => { tour = v; save('tennis.tour', v); paintRight(); })));
    const rows = d.rankings[tour] || [];
    if (!rows.length) { right.append(el('div', { class: 'skel', style: 'height:200px' })); return; }
    if (!d.rankingsLive) right.append(el('div', { class: 'tiny faint' }, 'Saved list · live rankings appear when ESPN answers'));
    right.append(...rows.map((r) => {
      const fav = T.isFavourite(r.name);
      return el('div', { class: `item clickable tn-rank ${r.rank <= 3 ? `top${r.rank}` : ''}`, title: fav ? `Stop following ${r.name}` : `Follow ${r.name}`,
        onclick: () => { T.toggleFavourite(r.name); paint(); } },
        el('span', { class: 'num tn-rank-no' }, String(r.rank)),
        el('span', { class: `tiny tn-move ${r.move > 0 ? 'up' : r.move < 0 ? 'down' : ''}` }, r.move > 0 ? `▲${r.move}` : r.move < 0 ? `▼${-r.move}` : ''),
        flag(r),
        el('span', { class: 'grow ellipsis', style: fav ? 'font-weight:700;color:var(--accent-bright)' : '' }, r.name),
        r.points != null ? el('span', { class: 'num tiny dim' }, r.points.toLocaleString()) : null,
        el('span', { class: `tn-star-btn ${fav ? 'on' : ''}` }, fav ? '★' : '☆'));
    }));
  }

  function paint() { paintLeft(); paintRight(); }

  paint();
  const first = T.get().at ? Promise.resolve() : T.loadWeek(0);
  Promise.allSettled([first, T.get().rankings.atp.length ? null : T.loadRankings()]).then(() => alive && paint());
  if (T.get().at) T.loadWeek(T.get().week).then(() => alive && !loading && paint()).catch(() => {});
  // Live scores every 30 seconds while the tab is open and something is being played.
  const t = setInterval(async () => {
    if (loading || T.get().week !== 0 || !events().some((e) => e.matches.some((m) => m.state === 'in'))) return;
    await T.loadWeek(0).catch(() => {});
    if (alive && !loading) paintLeft();   // not the right side: it would clear what you're typing
  }, 30e3);
  return () => { alive = false; clearInterval(t); };
}
