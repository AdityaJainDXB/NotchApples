// Sports data (ESPN's free public feed, no key) and the live score on the pill.
// Everyone follows Barcelona until they pick another team. "More teams" (Pro)
// follows up to five more; their live scores take turns on the pill.

import { load, save } from '../store.js';
import { getJSON } from '../native.js';
import { provide, refresh } from '../activity.js';
import { canUse } from '../features.js';

const BASE = 'https://site.api.espn.com/apis/site/v2/sports/';
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
  { id: 'soccer/ksa.1', name: 'Saudi Pro League', sport: 'Football' },
  { id: 'basketball/nba', name: 'NBA', sport: 'Basketball' },
  { id: 'football/nfl', name: 'NFL', sport: 'American football' },
  { id: 'baseball/mlb', name: 'MLB', sport: 'Baseball' },
  { id: 'hockey/nhl', name: 'NHL', sport: 'Hockey' },
  { id: 'badminton/bwf', name: 'BWF World Tour', sport: 'Badminton' },
];

export const isBadminton = (id = '') => id.startsWith('badminton/');

export const sportIcon = (path = '') =>
  path.startsWith('basketball') ? '🏀' : path.startsWith('football') ? '🏈' : path.startsWith('baseball') ? '⚾' : path.startsWith('hockey') ? '🏒' : path.startsWith('badminton') ? '🏸' : '⚽';

// ---- teams you follow ----

export function team() {
  const t = load('sports.team', DEFAULT_TEAM);
  return t && t.id && t.path ? t : DEFAULT_TEAM;
}
export const isDefaultTeam = () => team().id === DEFAULT_TEAM.id && team().path === DEFAULT_TEAM.path;
const pathFor = (league) => (league.startsWith('soccer/') ? 'soccer/all' : league);

export function setTeam(id, name, fromLeague) {
  save('sports.team', { id: String(id), name, path: pathFor(fromLeague) });
  cache.delete('team');
  poll();
}

/// Extra teams (Pro: More teams), up to five.
export const extraTeams = () => (canUse('multiMatch') ? load('sports.more', []) : []);
export function addExtra(id, name, fromLeague) {
  const list = load('sports.more', []).filter((t) => t.id !== String(id));
  save('sports.more', [...list, { id: String(id), name, path: pathFor(fromLeague) }].slice(0, 5));
  poll();
}
export function removeExtra(id) { save('sports.more', load('sports.more', []).filter((t) => t.id !== id)); refresh(); }

// ---- ESPN ----

const ymd = (d) => d.toISOString().slice(0, 10).replaceAll('-', '');

function parseMatch(e, fallback) {
  const comp = e.competitions?.[0];
  if (!e.id || !e.date || !comp?.competitors) return null;
  const side = (ha) => {
    const c = comp.competitors.find((x) => x.homeAway === ha) || {};
    const t = c.team || {};
    // The scoreboard sends the score as a string, a team schedule as an object.
    const score = typeof c.score === 'string' ? c.score : (c.score?.displayValue ?? '');
    return { id: String(t.id ?? ''), name: t.shortDisplayName || t.displayName || '?', full: t.displayName || '?', abbr: t.abbreviation || '?',
      logo: t.logo || t.logos?.[0]?.href || '', score, winner: !!c.winner };
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
    venue: comp.venue?.fullName || '', home: side('home'), away: side('away'), live: state === 'in',
  };
}

const parseList = (json, fallback) => (json?.events || []).map((e) => parseMatch(e, fallback)).filter(Boolean);
const get = (path) => getJSON(BASE + path, { timeout: 15000 }).catch(() => null);

/// Upcoming matches and recent results for a team.
export async function loadTeam(t = team()) {
  const [u, r] = await Promise.all([get(`${t.path}/teams/${t.id}/schedule?fixture=true`), get(`${t.path}/teams/${t.id}/schedule`)]);
  if (!u && !r) return null;
  const fallback = t.path === 'soccer/all' ? 'soccer/esp.1' : t.path;
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

/// A league's fixtures for the next two weeks, plus ESPN's own "current matchday",
/// so an international break doesn't leave the list empty.
export async function loadLeague(leagueId) {
  const days = Array.from({ length: 14 }, (_, i) => new Date(Date.now() + i * 864e5));
  const pages = await Promise.all([...days.map((d) => get(`${leagueId}/scoreboard?dates=${ymd(d)}`)), get(`${leagueId}/scoreboard`)]);
  const all = new Map();
  for (const p of pages) for (const m of parseList(p, leagueId)) if (!all.has(m.id)) all.set(m.id, m);
  return [...all.values()].sort((a, b) => a.date - b.date);
}

/// Badminton: the BWF World Tour calendar (TheSportsDB's free feed lists tournaments,
/// not live scores). Past results, what's on now and what's next.
export async function loadBadminton() {
  const T = 'https://www.thesportsdb.com/api/v1/json/3/';
  const year = new Date().getFullYear();
  const pages = await Promise.all([`eventsnextleague.php?id=5646`, `eventspastleague.php?id=5646`,
    `eventsseason.php?id=5646&s=${year}`, `eventsseason.php?id=5646&s=${year + 1}`].map((p) => getJSON(T + p, { timeout: 15000 }).catch(() => null)));
  const all = new Map();
  for (const p of pages) for (const e of (p?.events || [])) {
    if (!e.idEvent || !e.dateEvent) continue;
    const start = new Date(`${e.dateEvent}T12:00:00`);
    const cancelled = /canc|postp/i.test(e.strStatus || '');
    all.set(e.idEvent, { id: e.idEvent, name: e.strEvent, date: start, city: [e.strCity, e.strCountry].filter(Boolean).join(', '),
      state: cancelled ? 'cancelled' : (Date.now() - start > 7 * 864e5 ? 'post' : Date.now() >= start - 12 * 3600e3 ? 'in' : 'pre') });
  }
  return [...all.values()].sort((a, b) => a.date - b.date);
}

/// A league's teams, from its standings table (with the table itself).
export async function loadStandings(leagueId) {
  const j = await getJSON(`https://site.api.espn.com/apis/v2/sports/${leagueId}/standings`, { timeout: 15000 }).catch(() => null);
  const groups = j?.children?.length ? j.children : (j ? [j] : []);
  return groups.map((g) => ({
    name: g.name || '',
    rows: (g.standings?.entries || []).map((e) => {
      const stat = (n) => e.stats?.find((s) => s.name === n || s.type === n)?.displayValue ?? '';
      return { id: String(e.team?.id ?? ''), name: e.team?.shortDisplayName || e.team?.displayName || '?', logo: e.team?.logos?.[0]?.href || '',
        rank: stat('rank') || stat('playoffSeed'), played: stat('gamesPlayed'), points: stat('points'), wins: stat('wins'), losses: stat('losses'), gd: stat('pointDifferential') || stat('differential') };
    }).sort((a, b) => (Number(a.rank) || 99) - (Number(b.rank) || 99)),
  })).filter((g) => g.rows.length);
}

// ---- the pill ----

const cache = new Map(); // 'team' | extra id -> { upcoming, results, at }
let rotate = 0;

export const cached = (key = 'team') => cache.get(key) || null;

async function poll() {
  const teams = [['team', team()], ...extraTeams().map((t) => [t.id, t])];
  let liveSoon = false;
  await Promise.all(teams.map(async ([key, t]) => {
    const d = await loadTeam(t);
    if (d) cache.set(key, { ...d, at: Date.now(), team: t });
    const first = d?.upcoming?.[0];
    if (first && (first.live || Math.abs(first.date - Date.now()) < 3 * 3600e3)) liveSoon = true;
  }));
  refresh();
  clearTimeout(poll.timer);
  // Every 40 s while a match is on or about to start, otherwise every 15 minutes.
  poll.timer = setTimeout(poll, liveSoon ? 40e3 : 15 * 60e3);
}

export function start() {
  poll();
  setInterval(() => { rotate++; refresh(); }, 6000);
  provide('sports', 55, () => {
    if (!load('sports.pill', true)) return null;
    const live = [];
    for (const [key, d] of cache) {
      const m = d.upcoming?.find((x) => x.live);
      if (m) live.push({ m, t: d.team || (key === 'team' ? team() : null) });
    }
    if (!live.length) return null;
    const { m, t } = live[rotate % live.length];
    const mine = m.home.id === t?.id ? m.home : m.away;
    const theirs = m.home.id === t?.id ? m.away : m.home;
    return { icon: sportIcon(t?.path), live: true, tab: 'sports', leftText: mine.abbr,
      label: `${mine.score}-${theirs.score} ${theirs.abbr}${m.detail ? ` ${m.detail}` : ''}`, title: `${m.home.full} ${m.home.score}–${m.away.score} ${m.away.full}` };
  });
}

export const refreshNow = poll;
