// Sports (ESPN's free public feed, no key): your team, Barcelona unless you change it,
// with its next match and every competition it plays in, plus a league view with
// upcoming fixtures. Also feeds the live score shown on the collapsed pill.
import { el, load, save } from '../store.js';

const BASE = 'https://site.api.espn.com/apis/site/v2/sports/';

/// Everyone tracks Barcelona until they pick another team.
export const DEFAULT_TEAM = { id: '83', name: 'Barcelona', path: 'soccer/all' };

export const LEAGUES = [
  { id: 'soccer/esp.1', name: 'La Liga', sport: 'Football' },
  { id: 'soccer/eng.1', name: 'Premier League', sport: 'Football' },
  { id: 'soccer/ita.1', name: 'Serie A', sport: 'Football' },
  { id: 'soccer/ger.1', name: 'Bundesliga', sport: 'Football' },
  { id: 'soccer/fra.1', name: 'Ligue 1', sport: 'Football' },
  { id: 'soccer/uefa.champions', name: 'Champions League', sport: 'Football' },
  { id: 'soccer/uefa.europa', name: 'Europa League', sport: 'Football' },
  { id: 'soccer/por.1', name: 'Liga Portugal', sport: 'Football' },
  { id: 'soccer/ned.1', name: 'Eredivisie', sport: 'Football' },
  { id: 'soccer/usa.1', name: 'MLS', sport: 'Football' },
  { id: 'basketball/nba', name: 'NBA', sport: 'Basketball' },
  { id: 'football/nfl', name: 'NFL', sport: 'American football' },
  { id: 'baseball/mlb', name: 'MLB', sport: 'Baseball' },
  { id: 'hockey/nhl', name: 'NHL', sport: 'Hockey' },
];

// ---- saved choices -------------------------------------------------------

export const getTeam = () => {
  const t = load('sports.team', DEFAULT_TEAM);
  return t && t.id && t.path ? t : DEFAULT_TEAM;
};
export const isDefaultTeam = () => getTeam().id === DEFAULT_TEAM.id && getTeam().path === DEFAULT_TEAM.path;
const getLeague = () => {
  const id = load('sports.league', 'soccer/esp.1');
  return LEAGUES.some((l) => l.id === id) ? id : 'soccer/esp.1';
};
export const pillEnabled = () => load('sports.pill', true) !== false;

/// Football teams use ESPN's all-competitions schedule so Champions League and cup
/// matches show up too; other sports use their own league.
function setTeam(id, name, fromLeague) {
  save('sports.team', { id, name, path: fromLeague.startsWith('soccer/') ? 'soccer/all' : fromLeague });
}

// ---- ESPN ----------------------------------------------------------------

async function get(path) {
  try {
    const r = await fetch(BASE + path, { cache: 'no-store' });
    return r.ok ? await r.json() : null;
  } catch { return null; }
}

const ymd = (d) => d.toISOString().slice(0, 10).replaceAll('-', '');

function parseMatch(e, fallback) {
  const comp = e.competitions?.[0];
  if (!e.id || !e.date || !comp?.competitors) return null;
  const side = (ha) => {
    const c = comp.competitors.find((x) => x.homeAway === ha) || {};
    const t = c.team || {};
    // The scoreboard sends the score as a string, a team schedule as an object.
    const score = typeof c.score === 'string' ? c.score : (c.score?.displayValue ?? '');
    return {
      id: String(t.id ?? ''), name: t.displayName || '?', abbr: t.abbreviation || '?',
      logo: t.logo || t.logos?.[0]?.href || '', score, winner: !!c.winner,
    };
  };
  const status = comp.status || e.status || {};
  const type = status.type || {};
  const state = type.state || 'pre';
  let detail = '';
  if (state === 'in') detail = (type.shortDetail && type.shortDetail !== 'Scheduled') ? type.shortDetail : (status.displayClock || '');
  else if (state === 'post') detail = type.shortDetail || 'FT';
  const slug = e.league?.slug;
  return {
    id: String(e.id), date: new Date(e.date), state, detail,
    competition: e.league?.name || e.season?.displayName || '',
    leaguePath: slug && fallback.startsWith('soccer/') ? `soccer/${slug}` : fallback,
    venue: comp.venue?.fullName || '',
    home: side('home'), away: side('away'), live: state === 'in',
  };
}

const parseList = (json, fallback) =>
  (json?.events || []).map((e) => parseMatch(e, fallback)).filter(Boolean);

/// The tracked team's upcoming matches and recent results.
export async function loadTeam(team = getTeam()) {
  const [u, r] = await Promise.all([
    get(`${team.path}/teams/${team.id}/schedule?fixture=true`),
    get(`${team.path}/teams/${team.id}/schedule`),
  ]);
  if (!u && !r) return null;
  const fallback = team.path === 'soccer/all' ? 'soccer/esp.1' : team.path;
  const all = new Map();
  for (const m of [...parseList(u, fallback), ...parseList(r, fallback)]) if (!all.has(m.id)) all.set(m.id, m);
  const list = [...all.values()];
  const upcoming = list.filter((m) => m.state !== 'post').sort((a, b) => a.date - b.date);
  const results = list.filter((m) => m.state === 'post').sort((a, b) => b.date - a.date);
  await refreshOngoing(upcoming, results);
  return { upcoming, results };
}

/// The schedule can lag behind a live match, so ask the league's scoreboard directly.
async function refreshOngoing(upcoming, results) {
  const m = upcoming[0];
  if (!m || m.date > Date.now() || !(m.live || Date.now() - m.date < 4 * 3600e3)) return;
  for (const day of [m.date, new Date(m.date - 864e5)]) {
    const j = await get(`${m.leaguePath}/scoreboard?dates=${ymd(day)}`);
    const e = (j?.events || []).find((x) => String(x.id) === m.id);
    const fresh = e && parseMatch(e, m.leaguePath);
    if (!fresh) continue;
    upcoming.shift();
    if (fresh.state === 'post') results.unshift(fresh); else upcoming.unshift(fresh);
    return;
  }
}

/// A league's fixtures for the next two weeks. ESPN's own "current matchday" is added
/// too, so an international break doesn't leave the list empty.
export async function loadLeague(leagueId) {
  const days = Array.from({ length: 14 }, (_, i) => new Date(Date.now() + i * 864e5));
  const pages = await Promise.all([
    ...days.map((d) => get(`${leagueId}/scoreboard?dates=${ymd(d)}`)),
    get(`${leagueId}/scoreboard`),
  ]);
  const all = new Map();
  for (const p of pages) for (const m of parseList(p, leagueId)) if (!all.has(m.id)) all.set(m.id, m);
  return [...all.values()].sort((a, b) => a.date - b.date);
}

/// A league's teams, from its standings table. (ESPN's own team-list endpoint sends no
/// CORS header, so the web view can't call it; the standings endpoint can be.)
async function loadTeams(leagueId, fixtures = []) {
  const found = new Map();
  try {
    const r = await fetch(`https://site.api.espn.com/apis/v2/sports/${leagueId}/standings`, { cache: 'no-store' });
    const j = r.ok ? await r.json() : null;
    const groups = j?.children?.length ? j.children : [j];
    for (const g of groups) for (const e of g?.standings?.entries || []) {
      if (e.team?.id) found.set(String(e.team.id), e.team.displayName || String(e.team.id));
    }
  } catch { /* fall back to the fixtures below */ }
  // Cup competitions have no table, so use whoever is playing in the fixtures list.
  if (!found.size) for (const m of fixtures) for (const t of [m.home, m.away]) if (t.id) found.set(t.id, t.name);
  return [...found].map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name));
}

// ---- the live score on the collapsed pill --------------------------------

let watching = false;
export function startWatcher(setPillText, isActive = () => true) {
  if (watching) return;
  watching = true;
  let timer = null;
  async function tick() {
    let next = 15 * 60e3;
    if (!isActive()) { setPillText(''); timer = setTimeout(tick, 60e3); return; }
    try {
      const d = pillEnabled() ? await loadTeam() : null;
      const m = d?.upcoming.find((x) => x.live);
      if (m) {
        const team = getTeam();
        const mine = m.home.id === team.id ? m.home : m.away;
        const theirs = m.home.id === team.id ? m.away : m.home;
        setPillText(`⚽ ${mine.abbr} ${mine.score}-${theirs.score} ${theirs.abbr}${m.detail ? ' ' + m.detail : ''}`);
        next = 40e3;
      } else {
        setPillText('');
        if (d?.upcoming[0] && d.upcoming[0].date <= Date.now() && Date.now() - d.upcoming[0].date < 4 * 3600e3) next = 40e3;
      }
    } catch { setPillText(''); }
    timer = setTimeout(tick, next);
  }
  tick();
  window.addEventListener('sports-changed', () => { clearTimeout(timer); tick(); });
}

// ---- the tab -------------------------------------------------------------

const fmtDay = (d) => {
  const s = (x) => x.toDateString();
  if (s(d) === s(new Date())) return 'Today';
  if (s(d) === s(new Date(Date.now() + 864e5))) return 'Tomorrow';
  return d.toLocaleDateString([], { weekday: 'long', day: 'numeric', month: 'short' });
};
const fmtTime = (d) => d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
const fmtShort = (d) => d.toLocaleDateString([], { weekday: 'short', day: 'numeric', month: 'short' });
const fmtLong = (d) => `${d.toLocaleDateString([], { weekday: 'long', day: 'numeric', month: 'short' })} · ${fmtTime(d)}`;

function countdown(d) {
  const ms = d - Date.now();
  if (ms <= 0) return 'now';
  const mins = Math.floor(ms / 60e3), h = Math.floor(mins / 60), days = Math.floor(h / 24);
  if (days >= 1) return `in ${days}d ${h % 24}h`;
  if (h >= 1) return `in ${h}h ${mins % 60}m`;
  return `in ${mins}m`;
}

const logo = (url) => url
  ? el('img', { src: url, width: 22, height: 22, style: 'object-fit:contain', alt: '' })
  : el('span', { style: 'width:22px;display:inline-block' }, '🛡');

export function render(root) {
  let alive = true;
  let team = getTeam();
  let leagueId = getLeague();
  let teamData = null;       // { upcoming, results } | null
  let leagueData = null;     // matches | null (loading)
  let teams = [];
  let teamError = false;

  const left = el('div', { class: 'card col', style: 'flex:1;min-width:0;overflow:auto;gap:8px' });
  const right = el('div', { class: 'card col', style: 'width:300px;flex:none;overflow:auto;gap:6px' });
  root.append(el('div', { class: 'row', style: 'height:100%;align-items:stretch;gap:10px' }, left, right));

  const mineOf = (m) => (m.home.id === team.id ? m.home : m.away);
  const theirsOf = (m) => (m.home.id === team.id ? m.away : m.home);

  function scoreLine(m) {
    const side = (s, align) => el('div', {
      style: `flex:1;display:flex;gap:6px;align-items:center;justify-content:${align};min-width:0`,
    }, align === 'flex-end' ? [nameEl(s), logo(s.logo)] : [logo(s.logo), nameEl(s)]);
    const nameEl = (s) => el('span', {
      style: `font-weight:${s.id === team.id ? 700 : 500};${s.id === team.id ? 'color:var(--accent-bright)' : ''};`
        + 'white-space:nowrap;overflow:hidden;text-overflow:ellipsis',
    }, s.name);
    const mid = m.state === 'pre'
      ? el('span', { class: 'small dim' }, 'vs')
      : el('span', { class: 'mono', style: 'font-size:20px;font-weight:700' }, `${m.home.score} – ${m.away.score}`);
    return el('div', { style: 'display:flex;align-items:center;gap:8px' },
      side(m.home, 'flex-end'), el('div', { style: 'min-width:56px;text-align:center' }, mid), side(m.away, 'flex-start'));
  }

  function paintLeft() {
    left.replaceChildren();

    const teamSelect = el('select', { class: 'field', style: 'width:auto;max-width:150px',
      title: 'Choose which team to track',
      onchange: (e) => {
        const v = e.target.value;
        if (v === '__default') setTeam(DEFAULT_TEAM.id, DEFAULT_TEAM.name, 'soccer/esp.1');
        else if (v) { const t = teams.find((x) => x.id === v); if (t) setTeam(t.id, t.name, leagueId); }
        else return;
        changed();
      } },
      el('option', { value: '' }, 'Change team…'),
      !isDefaultTeam() ? el('option', { value: '__default' }, `Back to ${DEFAULT_TEAM.name} (default)`) : null,
      ...teams.map((t) => el('option', { value: t.id }, t.name)));

    left.append(el('div', { style: 'display:flex;align-items:center;gap:8px' },
      el('span', { style: 'color:var(--accent-bright)' }, '★'),
      el('div', { style: 'flex:1;min-width:0' },
        el('div', { style: 'font-size:15px;font-weight:700' }, team.name),
        el('div', { class: 'small dim' }, isDefaultTeam() ? 'Your team · default' : 'Your team')),
      teamSelect,
      el('button', { class: 'btn quiet', title: 'Refresh', onclick: () => { loadAll(); } }, '⟳')));

    if (teamError) left.append(el('div', { class: 'err' }, 'Couldn’t load matches. Check your connection.'));
    if (!teamData) { if (!teamError) left.append(el('div', { class: 'small dim' }, 'Loading…')); return; }

    const live = teamData.upcoming.find((m) => m.live);
    const next = live || teamData.upcoming.find((m) => m.date > Date.now()) || teamData.upcoming[0];

    if (live) {
      left.append(el('div', { class: 'card col', style: 'gap:6px' },
        el('div', { style: 'display:flex;gap:8px;align-items:center' },
          el('span', { style: 'background:#e5484d;color:#fff;font-size:9px;font-weight:800;padding:2px 6px;border-radius:99px' }, 'LIVE'),
          el('span', { class: 'mono', style: 'font-weight:600' }, live.detail),
          el('span', { class: 'small dim', style: 'margin-left:auto' }, live.competition)),
        scoreLine(live)));
    } else if (next) {
      left.append(el('div', { class: 'card col', style: 'gap:6px' },
        el('div', { style: 'display:flex;align-items:baseline' },
          el('div', { class: 'section-title' }, 'Next match'),
          el('div', { class: 'mono', style: 'margin-left:auto;font-weight:700;color:var(--accent-bright)' }, countdown(next.date))),
        scoreLine(next),
        el('div', { style: 'display:flex' }, el('span', { class: 'small' }, fmtLong(next.date)),
          el('span', { class: 'small dim', style: 'margin-left:auto' }, next.competition)),
        next.venue ? el('div', { class: 'small dim' }, next.venue) : null));
    } else {
      left.append(el('div', { class: 'small dim' }, 'No upcoming matches found.'));
    }

    const more = teamData.upcoming.filter((m) => m !== next).slice(0, 5);
    if (more.length) {
      left.append(el('div', { class: 'section-title' }, 'Coming up'),
        ...more.map((m) => el('div', { style: 'display:flex;gap:8px;font-size:12px', title: m.competition },
          el('span', { class: 'dim mono', style: 'width:92px' }, fmtShort(m.date)),
          el('span', { style: 'flex:1' }, `${m.home.id === team.id ? 'vs' : 'at'} ${theirsOf(m).name}`),
          el('span', { class: 'dim mono' }, fmtTime(m.date)))));
    }

    if (teamData.results.length) {
      left.append(el('div', { class: 'section-title' }, 'Recent results'),
        ...teamData.results.slice(0, 3).map((m) => {
          const me = mineOf(m), them = theirsOf(m);
          const [letter, colour] = me.winner ? ['W', '#30a46c'] : them.winner ? ['L', '#e5484d'] : ['D', '#f5d90a'];
          return el('div', { style: 'display:flex;gap:8px;align-items:center;font-size:12px', title: m.competition },
            el('span', { style: `background:${colour};color:#000;font-weight:800;font-size:10px;width:18px;height:18px;`
              + 'display:grid;place-items:center;border-radius:4px' }, letter),
            el('span', { style: 'flex:1' }, `${m.home.id === team.id ? 'vs' : 'at'} ${them.name}`),
            el('span', { class: 'mono', style: 'font-weight:600' }, `${me.score}–${them.score}`));
        }));
    }

    const pill = el('input', { type: 'checkbox', checked: pillEnabled() ? true : null,
      onchange: (e) => { save('sports.pill', e.target.checked); window.dispatchEvent(new Event('sports-changed')); } });
    left.append(el('label', { class: 'small dim', style: 'display:flex;gap:8px;align-items:center;cursor:pointer;margin-top:4px' },
      pill, 'Show the live score on the closed notch'));
  }

  function paintRight() {
    right.replaceChildren();
    const sel = el('select', { class: 'field', onchange: (e) => { leagueId = e.target.value; save('sports.league', leagueId); loadLeagueView(); } },
      ...[...new Set(LEAGUES.map((l) => l.sport))].map((sport) => el('optgroup', { label: sport },
        ...LEAGUES.filter((l) => l.sport === sport).map((l) =>
          el('option', { value: l.id, selected: l.id === leagueId ? true : null }, l.name)))));
    right.append(el('div', { style: 'display:flex;gap:6px' }, sel,
      el('button', { class: 'btn quiet', title: 'Refresh', onclick: loadLeagueView }, '⟳')));

    if (leagueData === null) { right.append(el('div', { class: 'small dim' }, 'Loading…')); return; }
    if (!leagueData.length) right.append(el('div', { class: 'small dim' }, 'No upcoming matches found.'));

    let day = '';
    for (const m of leagueData) {
      const label = fmtDay(m.date);
      if (label !== day) { day = label; right.append(el('div', { class: 'section-title', style: 'margin-top:6px' }, label)); }
      const mine = m.home.id === team.id || m.away.id === team.id;
      const name = (s, align) => el('button', {
        class: 'btn quiet', title: s.id === team.id ? `You're tracking ${s.name}` : `Track ${s.name}`,
        style: `flex:1;min-width:0;padding:3px 4px;text-align:${align};background:none;border:none;`
          + `font-weight:${s.id === team.id ? 700 : 500};${s.id === team.id ? 'color:var(--accent-bright)' : ''};`
          + 'white-space:nowrap;overflow:hidden;text-overflow:ellipsis;font-size:11px',
        onclick: () => { setTeam(s.id, s.name, leagueId); changed(); },
      }, s.name);
      right.append(el('div', { style: `display:flex;align-items:center;gap:2px;border-radius:6px;${mine ? 'background:rgba(255,255,255,.1)' : ''}` },
        name(m.home, 'right'),
        el('div', { class: 'mono', style: 'width:70px;white-space:nowrap;text-align:center;font-size:11px' },
          m.state === 'pre' ? fmtTime(m.date)
            : el('span', { style: m.live ? 'color:#30a46c;font-weight:700' : 'font-weight:700' }, `${m.home.score}–${m.away.score}`)),
        name(m.away, 'left')));
    }
    right.append(el('div', { class: 'small dim', style: 'margin-top:4px' }, 'Tap a team to track it.'));
  }

  async function loadTeamView() {
    const t = getTeam();
    const d = await loadTeam(t);
    if (!alive || t.id !== getTeam().id) return;
    teamError = !d && !teamData;
    if (d) teamData = d;
    paintLeft();
  }
  async function loadLeagueView() {
    const id = leagueId;
    leagueData = null; paintRight();
    const matches = await loadLeague(id);
    if (!alive || id !== leagueId) return;
    leagueData = matches;
    paintRight();
    const list = await loadTeams(id, matches);
    if (!alive || id !== leagueId) return;
    teams = list;
    paintRight(); paintLeft();
  }
  function loadAll() { loadTeamView(); loadLeagueView(); }
  function changed() {
    team = getTeam(); teamData = null; teamError = false;
    paintLeft(); paintRight();
    loadTeamView();
    window.dispatchEvent(new Event('sports-changed'));
  }

  paintLeft(); paintRight();
  loadAll();
  // Keep the countdown fresh, and poll quickly while the match is on.
  const tick = setInterval(() => {
    if (teamData?.upcoming.some((m) => m.live) || (teamData?.upcoming[0] && teamData.upcoming[0].date <= Date.now())) loadTeamView();
    else paintLeft();
  }, 40e3);
  return () => { alive = false; clearInterval(tick); };
}
