// The Sports tab: your team (Barcelona by default) with its next match, every
// competition, results and the live score; a league's fixtures and table; and
// (Pro) more teams to follow. Data from ESPN's free feed (services/sports.js).

import { el, load, save, fmtTime, dayLabel } from '../store.js';
import { canUse } from '../features.js';
import { toast, segmented, iconBtn, empty } from '../ui.js';
import { proNote } from './activation.js';
import * as S from '../services/sports.js';

function countdown(d) {
  const ms = d - Date.now();
  if (ms <= 0) return 'now';
  const mins = Math.floor(ms / 60e3), h = Math.floor(mins / 60), days = Math.floor(h / 24);
  if (days >= 1) return `in ${days}d ${h % 24}h`;
  if (h >= 1) return `in ${h}h ${mins % 60}m`;
  return `in ${mins}m`;
}

const logo = (url, size = 22) => (url
  ? el('img', { src: url, width: size, height: size, style: 'object-fit:contain;flex:none', alt: '' })
  : el('span', { style: `width:${size}px;text-align:center;flex:none` }, '🛡'));

export function render(root) {
  let alive = true;
  let leagueId = load('sports.league', 'soccer/esp.1');
  if (!S.LEAGUES.some((l) => l.id === leagueId)) leagueId = 'soccer/esp.1';
  let leagueView = load('sports.leagueView', 'fixtures');
  let teamData = S.cached('team');
  let teamError = false;
  let fixtures = null, table = null, teams = [];

  const left = el('div', { class: 'card col', style: 'flex:1.1;min-width:0;overflow:auto;gap:8px' });
  const right = el('div', { class: 'card col', style: 'flex:1;min-width:0;overflow:auto;gap:6px' });
  root.append(el('div', { class: 'row fill' }, left, right));

  const team = () => S.team();
  const mineOf = (m) => (m.home.id === team().id ? m.home : m.away);
  const theirsOf = (m) => (m.home.id === team().id ? m.away : m.home);

  function scoreLine(m) {
    const side = (s, align) => el('div', { class: 'hstack', style: `flex:1;justify-content:${align};min-width:0;gap:6px` },
      align === 'flex-end' ? [nameEl(s), logo(s.logo, 26)] : [logo(s.logo, 26), nameEl(s)]);
    const nameEl = (s) => el('span', { class: 'ellipsis', style: `font-weight:${s.id === team().id ? 700 : 500};${s.id === team().id ? 'color:var(--accent-bright)' : ''}` }, s.name);
    const mid = m.state === 'pre'
      ? el('span', { class: 'small dim' }, 'vs')
      : el('span', { class: 'big num' }, `${m.home.score} – ${m.away.score}`);
    return el('div', { class: 'hstack' }, side(m.home, 'flex-end'), el('div', { style: 'min-width:70px;text-align:center' }, mid), side(m.away, 'flex-start'));
  }

  function paintLeft() {
    left.replaceChildren();
    left.append(el('div', { class: 'hstack' },
      el('span', { class: 'accent' }, '★'),
      el('div', { class: 'grow', style: 'min-width:0' },
        el('div', { class: 'title ellipsis' }, team().name),
        el('div', { class: 'tiny dim' }, S.isDefaultTeam() ? 'Your team · default' : 'Your team')),
      teamPicker(),
      iconBtn('⟳', 'Refresh', () => { teamData = null; paintLeft(); loadTeamView(); })));

    if (teamError && !teamData) { left.append(empty('📡', 'Couldn’t load matches', 'Check your connection and try again.')); return; }
    if (!teamData) { left.append(el('div', { class: 'skel', style: 'height:90px' }), el('div', { class: 'skel', style: 'height:120px' })); return; }

    const live = teamData.upcoming.find((m) => m.live);
    const next = live || teamData.upcoming.find((m) => m.date > Date.now()) || teamData.upcoming[0];
    if (live) {
      left.append(el('div', { class: 'card col gap-6', style: 'border-color:var(--live)' },
        el('div', { class: 'hstack' }, el('span', { class: 'badge live' }, 'LIVE'), el('span', { class: 'num', style: 'font-weight:700' }, live.detail),
          el('span', { class: 'small dim grow', style: 'text-align:right' }, live.competition)),
        scoreLine(live)));
    } else if (next) {
      left.append(el('div', { class: 'card col gap-6' },
        el('div', { class: 'hstack' }, el('div', { class: 'section-title grow' }, 'Next match'),
          el('div', { class: 'num accent', style: 'font-weight:700' }, countdown(next.date))),
        scoreLine(next),
        el('div', { class: 'hstack small' }, el('span', {}, `${dayLabel(next.date)} · ${fmtTime(next.date)}`),
          el('span', { class: 'dim grow ellipsis', style: 'text-align:right' }, next.competition)),
        next.venue ? el('div', { class: 'tiny dim' }, `📍 ${next.venue}`) : null));
    } else left.append(el('div', { class: 'small dim' }, 'No upcoming matches found.'));

    const more = teamData.upcoming.filter((m) => m !== next).slice(0, 5);
    if (more.length) {
      left.append(el('div', { class: 'section-title' }, 'Coming up'),
        ...more.map((m) => el('div', { class: 'hstack small', title: m.competition },
          el('span', { class: 'dim num', style: 'width:96px' }, m.date.toLocaleDateString([], { weekday: 'short', day: 'numeric', month: 'short' })),
          logo(theirsOf(m).logo, 16),
          el('span', { class: 'grow ellipsis' }, `${m.home.id === team().id ? 'vs' : 'at'} ${theirsOf(m).name}`),
          el('span', { class: 'dim num' }, fmtTime(m.date)))));
    }
    if (teamData.results.length) {
      left.append(el('div', { class: 'section-title' }, 'Recent results'),
        ...teamData.results.slice(0, 4).map((m) => {
          const me = mineOf(m), them = theirsOf(m);
          const [letter, colour] = me.winner ? ['W', 'var(--ok)'] : them.winner ? ['L', 'var(--bad)'] : ['D', 'var(--warn)'];
          return el('div', { class: 'hstack small', title: m.competition },
            el('span', { style: `background:${colour};color:#000;font-weight:800;font-size:10px;width:18px;height:18px;display:grid;place-items:center;border-radius:4px;flex:none` }, letter),
            logo(them.logo, 16),
            el('span', { class: 'grow ellipsis' }, `${m.home.id === team().id ? 'vs' : 'at'} ${them.name}`),
            el('span', { class: 'num', style: 'font-weight:600' }, `${me.score}–${them.score}`));
        }));
    }

    // More teams (Pro).
    left.append(el('div', { class: 'section-title', style: 'margin-top:4px' }, 'More teams'));
    if (!canUse('multiMatch')) left.append(proNote('multiMatch'));
    else {
      const extras = S.extraTeams();
      left.append(...extras.map((t) => {
        const d = S.cached(t.id);
        const m = d?.upcoming?.find((x) => x.live) || d?.upcoming?.[0];
        return el('div', { class: 'item' },
          el('div', { class: 'main' }, el('div', { style: 'font-weight:600' }, t.name),
            el('div', { class: 'tiny dim' }, m ? (m.live ? `LIVE ${m.home.abbr} ${m.home.score}–${m.away.score} ${m.away.abbr} ${m.detail}` : `${m.home.abbr} vs ${m.away.abbr} · ${dayLabel(m.date)} ${fmtTime(m.date)}`) : 'Loading…')),
          el('div', { class: 'actions' }, iconBtn('✕', 'Stop following', () => { S.removeExtra(t.id); paintLeft(); })));
      }));
      if (extras.length < 5) left.append(el('div', { class: 'tiny dim' }, 'Right-click a team on the right and choose “Also follow”.'));
    }

    left.append(el('label', { class: 'hstack small dim', style: 'margin-top:4px;cursor:pointer' },
      el('input', { type: 'checkbox', checked: load('sports.pill', true), onchange: (e) => save('sports.pill', e.target.checked) }),
      'Show live scores on the closed notch'));
  }

  function teamPicker() {
    const sel = el('select', { class: 'field auto', style: 'max-width:150px', title: 'Choose which team to follow' },
      el('option', { value: '' }, 'Change team…'),
      !S.isDefaultTeam() ? el('option', { value: '__default' }, `Back to ${S.DEFAULT_TEAM.name}`) : null,
      ...teams.map((t) => el('option', { value: t.id }, t.name)));
    sel.addEventListener('change', () => {
      if (sel.value === '__default') S.setTeam(S.DEFAULT_TEAM.id, S.DEFAULT_TEAM.name, 'soccer/esp.1');
      else if (sel.value) { const t = teams.find((x) => x.id === sel.value); if (t) S.setTeam(t.id, t.name, leagueId); }
      else return;
      changed();
    });
    return sel;
  }

  function teamName(s) {
    const mine = s.id === team().id;
    const b = el('button', { class: 'btn ghost', title: mine ? `You follow ${s.full}` : `Follow ${s.full} (right-click for more)`,
      style: `flex:1;min-width:0;padding:2px 4px;min-height:22px;font-size:11px;justify-content:inherit;font-weight:${mine ? 700 : 500};${mine ? 'color:var(--accent-bright)' : ''}`,
      onclick: () => { S.setTeam(s.id, s.full, leagueId); changed(); } }, el('span', { class: 'ellipsis' }, s.name));
    b.addEventListener('contextmenu', (e) => {
      import('../ui.js').then(({ menu }) => menu(e, [
        { label: `Follow ${s.full}`, run: () => { S.setTeam(s.id, s.full, leagueId); changed(); } },
        { label: canUse('multiMatch') ? `Also follow ${s.full}` : `Also follow ${s.full} (Pro)`, run: () => {
          if (!canUse('multiMatch')) return toast('More teams is part of Pro.');
          S.addExtra(s.id, s.full, leagueId); toast(`Also following ${s.full}`); setTimeout(paintLeft, 1500);
        } },
      ]));
    });
    return b;
  }

  function paintRight() {
    right.replaceChildren();
    const groups = {};
    for (const l of S.LEAGUES) (groups[l.sport] ||= []).push(l);
    const sel = el('select', { class: 'field auto' }, ...Object.entries(groups).map(([sport, list]) => el('optgroup', { label: sport },
      ...list.map((l) => el('option', { value: l.id, selected: l.id === leagueId }, l.name)))));
    sel.addEventListener('change', () => { leagueId = sel.value; save('sports.league', leagueId); loadLeagueView(); });
    right.append(el('div', { class: 'hstack' }, sel, el('div', { class: 'spacer' }),
      segmented([{ value: 'fixtures', label: 'Fixtures' }, { value: 'table', label: 'Table' }], leagueView, (v) => { leagueView = v; save('sports.leagueView', v); paintRight(); })));

    if (leagueView === 'table') {
      if (table === null) { right.append(el('div', { class: 'skel', style: 'height:200px' })); return; }
      if (!table.length) { right.append(el('div', { class: 'small dim' }, 'No table for this competition right now.')); return; }
      for (const g of table) {
        if (table.length > 1) right.append(el('div', { class: 'section-title', style: 'margin-top:6px' }, g.name));
        const isSoccer = leagueId.startsWith('soccer/');
        right.append(el('div', { class: 'hstack tiny faint' }, el('span', { style: 'width:20px' }, '#'), el('span', { class: 'grow' }, 'Team'),
          el('span', { style: 'width:28px;text-align:right' }, isSoccer ? 'P' : 'W'), el('span', { style: 'width:34px;text-align:right' }, isSoccer ? 'GD' : 'L'), el('span', { style: 'width:34px;text-align:right' }, isSoccer ? 'Pts' : '')));
        for (const r of g.rows) {
          const mine = r.id === team().id;
          right.append(el('div', { class: 'hstack small', style: `padding:2px 4px;border-radius:6px;${mine ? 'background:rgba(255,255,255,.1);font-weight:700' : ''}` },
            el('span', { class: 'num dim', style: 'width:20px' }, r.rank),
            logo(r.logo, 16), el('span', { class: 'grow ellipsis' }, r.name),
            el('span', { class: 'num', style: 'width:28px;text-align:right' }, isSoccer ? r.played : r.wins),
            el('span', { class: 'num dim', style: 'width:34px;text-align:right' }, isSoccer ? r.gd : r.losses),
            el('span', { class: 'num', style: 'width:34px;text-align:right;font-weight:700' }, isSoccer ? r.points : '')));
        }
      }
      return;
    }

    if (fixtures === null) { right.append(el('div', { class: 'skel', style: 'height:200px' })); return; }
    if (!fixtures.length) right.append(el('div', { class: 'small dim' }, 'No upcoming matches found.'));
    let day = '';
    for (const m of fixtures) {
      const label = dayLabel(m.date);
      if (label !== day) { day = label; right.append(el('div', { class: 'section-title', style: 'margin-top:6px' }, label)); }
      const mine = m.home.id === team().id || m.away.id === team().id;
      right.append(el('div', { class: 'hstack', style: `gap:2px;border-radius:6px;${mine ? 'background:rgba(255,255,255,.1)' : ''};justify-content:flex-end` },
        el('div', { class: 'hstack', style: 'flex:1;min-width:0;justify-content:flex-end;gap:4px' }, teamName(m.home), logo(m.home.logo, 16)),
        el('div', { class: 'num small', style: 'width:64px;text-align:center;white-space:nowrap' },
          m.state === 'pre' ? fmtTime(m.date) : el('span', { style: `font-weight:700;${m.live ? 'color:var(--live)' : ''}` }, `${m.home.score}–${m.away.score}`)),
        el('div', { class: 'hstack', style: 'flex:1;min-width:0;gap:4px' }, logo(m.away.logo, 16), teamName(m.away))));
    }
    right.append(el('div', { class: 'tiny dim', style: 'margin-top:4px' }, 'Click a team to follow it.'));
  }

  async function loadTeamView() {
    const t = team();
    const d = await S.loadTeam(t);
    if (!alive || t.id !== team().id) return;
    teamError = !d;
    if (d) teamData = d;
    paintLeft();
  }
  async function loadLeagueView() {
    const id = leagueId;
    fixtures = null; table = null; paintRight();
    const [f, t] = await Promise.all([S.loadLeague(id), S.loadStandings(id)]);
    if (!alive || id !== leagueId) return;
    fixtures = f; table = t;
    teams = (t.flatMap((g) => g.rows).length ? t.flatMap((g) => g.rows) : f.flatMap((m) => [m.home, m.away]))
      .reduce((acc, x) => (acc.some((y) => y.id === x.id) ? acc : [...acc, { id: x.id, name: x.full || x.name }]), [])
      .sort((a, b) => a.name.localeCompare(b.name));
    paintRight(); paintLeft();
  }
  function changed() { teamData = null; paintLeft(); paintRight(); loadTeamView(); }

  paintLeft(); paintRight();
  loadTeamView(); loadLeagueView();
  const tick = setInterval(() => {
    if (teamData?.upcoming.some((m) => m.live) || (teamData?.upcoming[0] && teamData.upcoming[0].date <= Date.now())) loadTeamView();
    else paintLeft();
  }, 40e3);
  return () => { alive = false; clearInterval(tick); };
}
