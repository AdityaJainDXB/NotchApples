// Tennis, like the Mac's Tennis tab: every ATP and WTA match of the week from
// ESPN's free public feed (live, upcoming and finished), split into men's,
// women's and mixed draws; earlier weeks one click back; the ATP and WTA top 20;
// and favourite players, whose live score shows on the pill. Grand Slams are
// marked so the tab can paint them red.

import { load, save } from '../store.js';
import { getJSON } from '../native.js';
import { provide, refresh } from '../activity.js';

const ESPN = 'https://site.api.espn.com/apis/site/v2/sports/tennis';
const TOURS = ['atp', 'wta'];

export const SLAMS = ['Australian Open', 'Roland Garros', 'French Open', 'Wimbledon', 'US Open'];
export const isSlamName = (name = '') => SLAMS.some((s) => name.toLowerCase().includes(s.toLowerCase()));

/// The four Grand Slams and roughly when their second week falls, for "jump to" (month is 0-based).
export const SLAM_DATES = [
  { name: 'Australian Open', month: 0, day: 25 },
  { name: 'Roland Garros', month: 5, day: 4 },
  { name: 'Wimbledon', month: 6, day: 9 },
  { name: 'US Open', month: 8, day: 3 },
];

/// Shown when ESPN's rankings can't be reached, so the top 20 and the favourites picker are never empty.
export const SAVED_TOP = {
  atp: [['Carlos Alcaraz', 'ES'], ['Jannik Sinner', 'IT'], ['Alexander Zverev', 'DE'], ['Novak Djokovic', 'RS'], ['Taylor Fritz', 'US'],
    ['Felix Auger-Aliassime', 'CA'], ['Alex de Minaur', 'AU'], ['Lorenzo Musetti', 'IT'], ['Ben Shelton', 'US'], ['Jack Draper', 'GB'],
    ['Daniil Medvedev', 'RU'], ['Casper Ruud', 'NO'], ['Alexander Bublik', 'KZ'], ['Holger Rune', 'DK'], ['Andrey Rublev', 'RU'],
    ['Jakub Mensik', 'CZ'], ['Karen Khachanov', 'RU'], ['Tommy Paul', 'US'], ['Flavio Cobolli', 'IT'], ['Alejandro Davidovich Fokina', 'ES']],
  wta: [['Aryna Sabalenka', 'BY'], ['Iga Swiatek', 'PL'], ['Coco Gauff', 'US'], ['Amanda Anisimova', 'US'], ['Elena Rybakina', 'KZ'],
    ['Jessica Pegula', 'US'], ['Madison Keys', 'US'], ['Jasmine Paolini', 'IT'], ['Mirra Andreeva', 'RU'], ['Ekaterina Alexandrova', 'RU'],
    ['Belinda Bencic', 'CH'], ['Elina Svitolina', 'UA'], ['Clara Tauson', 'DK'], ['Karolina Muchova', 'CZ'], ['Linda Noskova', 'CZ'],
    ['Emma Navarro', 'US'], ['Naomi Osaka', 'JP'], ['Victoria Mboko', 'CA'], ['Liudmila Samsonova', 'RU'], ['Diana Shnaider', 'RU']],
};

/// "IT" → 🇮🇹
export const flagEmoji = (code = '') => (/^[A-Za-z]{2}$/.test(code) ? String.fromCodePoint(...[...code.toUpperCase()].map((c) => 0x1f1a5 + c.charCodeAt(0))) : '');

// ---------------------------------------------------------------- parsing (pure)

/// Which draw a match belongs to: men, women or mixed. ESPN names the draw ("Men's Singles",
/// "Mixed Doubles"); without one, the tour it came from decides.
export function drawOf(groupName = '', tour = 'atp') {
  const g = groupName.toLowerCase();
  if (g.includes('mixed')) return 'mixed';
  if (g.includes('women') || g.includes('ladies') || g.includes('girls')) return 'women';
  if (g.includes('men') || g.includes('gentlemen') || g.includes('boys')) return 'men';
  return tour === 'wta' ? 'women' : 'men';
}

const nameOf = (c) => c.athlete?.displayName || c.roster?.displayName
  || (c.roster?.athletes || []).map((a) => a.shortName || a.displayName).filter(Boolean).join(' / ')
  || c.team?.displayName || c.displayName || 'TBD';
const shortOf = (c) => c.athlete?.shortName || (c.roster?.athletes || []).map((a) => (a.displayName || '').split(' ').pop()).filter(Boolean).join(' / ') || nameOf(c);
const flagOf = (c) => c.athlete?.flag?.href || c.roster?.athletes?.[0]?.flag?.href || '';
const countryOf = (c) => c.athlete?.flag?.alt || c.roster?.athletes?.[0]?.flag?.alt || '';

function player(c) {
  const sets = (c.linescores || []).map((s) => ({ games: Math.round(Number(s.value ?? 0)), tiebreak: s.tiebreak ?? null, won: !!s.winner }));
  return { name: nameOf(c), short: shortOf(c), flag: flagOf(c), country: countryOf(c), seed: c.curatedRank?.current && c.curatedRank.current < 99 ? c.curatedRank.current : (c.seed || null),
    winner: c.winner === true, serving: c.possession === true, sets };
}

function match(comp, tour, groupName) {
  const type = comp.status?.type || {};
  const cs = [...(comp.competitors || [])].sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
  return {
    id: String(comp.id ?? `${tour}-${comp.date}-${cs.map(nameOf).join('-')}`),
    date: comp.date ? new Date(comp.date) : null,
    state: type.state || 'pre',                          // pre | in | post
    detail: type.shortDetail || type.detail || '',
    round: comp.round?.displayName || comp.notes?.[0]?.headline || '',
    draw: drawOf(groupName || comp.type?.text || '', tour),
    group: groupName || comp.type?.text || (tour === 'wta' ? "Women's Singles" : "Men's Singles"),
    court: comp.venue?.court || comp.venue?.fullName || '',
    players: cs.slice(0, 2).map(player),
  };
}

/// One ESPN tennis event (a tournament) → { id, name, slam, start, end, place, matches[] }.
export function parseEvent(e, tour) {
  const matches = [];
  for (const g of e.groupings || []) {
    const gname = g.grouping?.displayName || g.grouping?.slug || '';
    for (const c of g.competitions || []) matches.push(match(c, tour, gname));
  }
  for (const c of e.competitions || []) matches.push(match(c, tour, ''));
  const name = e.name || e.shortName || 'Tournament';
  return {
    id: String(e.id ?? name), name, tour,
    slam: e.major === true || isSlamName(name),
    start: e.date ? new Date(e.date) : null, end: e.endDate ? new Date(e.endDate) : null,
    place: e.venue?.displayName || [e.venue?.address?.city, e.venue?.address?.country].filter(Boolean).join(', '),
    matches,
  };
}

/// Both tours' events for one scoreboard, merged: a Grand Slam appears in both feeds once.
export function mergeEvents(lists) {
  const byName = new Map();
  for (const ev of lists.flat()) {
    const key = ev.name.toLowerCase().replace(/\s+(presented|powered) by.*$/, '').trim();
    const have = byName.get(key);
    if (!have) { byName.set(key, { ...ev, tours: [ev.tour], matches: [...ev.matches] }); continue; }
    const seen = new Set(have.matches.map((m) => m.id));
    have.matches.push(...ev.matches.filter((m) => !seen.has(m.id)));
    have.tours.push(ev.tour);
    have.slam = have.slam || ev.slam;
  }
  // Grand Slams first, then whichever has live matches, then the bigger draw.
  const live = (ev) => ev.matches.some((m) => m.state === 'in');
  return [...byName.values()].sort((a, b) => (b.slam - a.slam) || (live(b) - live(a)) || (b.matches.length - a.matches.length));
}

/// ESPN rankings → [{ rank, name, points, flag, country, move }]
export function parseRankings(j) {
  const list = (j?.rankings || []).find((r) => !/doubles/i.test(`${r.name} ${r.type}`)) || j?.rankings?.[0];
  return (list?.ranks || []).slice(0, 20).map((r) => ({
    rank: r.current, name: r.athlete?.displayName || r.athlete?.name || '', points: r.points != null ? Math.round(r.points) : null,
    flag: r.athlete?.flag?.href || '', country: r.athlete?.flag?.alt || '', move: (r.previous && r.current) ? r.previous - r.current : 0,
  })).filter((r) => r.name);
}

const order = { in: 0, pre: 1, post: 2 };
/// Live first, then upcoming (soonest first), then finished (latest first).
export function sortMatches(ms) {
  return [...ms].sort((a, b) => (order[a.state] - order[b.state])
    || (a.state === 'post' ? (b.date || 0) - (a.date || 0) : (a.date || 0) - (b.date || 0)));
}

/// "6-4 3-6 7-6" from one player's point of view.
export function scoreText(m, i = 0) {
  const [a, b] = [m.players[i], m.players[1 - i]];
  if (!a || !b) return '';
  return a.sets.map((s, k) => `${s.games}-${b.sets[k]?.games ?? 0}`).join(' ');
}

export const samePlayer = (a = '', b = '') => {
  const n = (s) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z ]/g, '').trim();
  const x = n(a), y = n(b);
  return !!x && !!y && (x === y || x.split(' ').pop() === y.split(' ').pop() && x[0] === y[0]);
};

// ---------------------------------------------------------------- state

const data = { events: [], rankings: { atp: [], wta: [] }, rankingsLive: false, week: 0, at: 0, error: '' };
export const get = () => data;

export const favourites = () => load('tennis.favourites', []);
export const isFavourite = (name) => favourites().some((f) => samePlayer(f, name));
export function toggleFavourite(name) {
  const list = favourites();
  save('tennis.favourites', isFavourite(name) ? list.filter((f) => !samePlayer(f, name)) : [...list, name]);
  refresh();
}

const ymd = (d) => `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
/// The day the week `offset` weeks back is fetched for (0 = today).
export const weekDate = (offset = 0) => new Date(Date.now() + offset * 7 * 864e5);

export async function loadWeek(offset = data.week, at = null) {
  data.week = offset;
  const day = at || weekDate(offset);
  const q = offset === 0 && !at ? '' : `?dates=${ymd(day)}`;
  const results = await Promise.allSettled(TOURS.map((t) => getJSON(`${ESPN}/${t}/scoreboard${q}`, { timeout: 15000 })
    .then((j) => (j.events || []).map((e) => parseEvent(e, t)))));
  const ok = results.filter((r) => r.status === 'fulfilled').map((r) => r.value);
  data.error = ok.length ? '' : 'Tennis scores are unavailable right now.';
  if (ok.length) data.events = mergeEvents(ok);
  data.at = Date.now();
  refresh();
}

/// Jump to the week holding a date (a Grand Slam from the menu). Returns the week offset.
export async function loadAround(date) {
  const offset = Math.round((date - Date.now()) / (7 * 864e5));
  await loadWeek(offset, date);
  return offset;
}

export async function loadRankings() {
  const out = {};
  await Promise.allSettled(TOURS.map(async (t) => { out[t] = parseRankings(await getJSON(`${ESPN}/${t}/rankings`, { timeout: 15000 })); }));
  data.rankingsLive = TOURS.every((t) => out[t]?.length);
  for (const t of TOURS) {
    data.rankings[t] = out[t]?.length ? out[t] : SAVED_TOP[t].map(([name, cc], i) => ({ rank: i + 1, name, points: null, flag: '', country: cc, emoji: flagEmoji(cc), move: 0 }));
  }
  refresh();
}

/// Every player anyone could pick: the top 20s plus everyone playing this week.
export function allPlayers() {
  const names = new Map();
  for (const t of TOURS) for (const r of data.rankings[t]) names.set(r.name.toLowerCase(), r.name);
  for (const ev of data.events) for (const m of ev.matches) for (const p of m.players) {
    if (!p.name.includes('/') && p.name !== 'TBD') names.set(p.name.toLowerCase(), p.name);
  }
  return [...names.values()].sort((a, b) => a.localeCompare(b));
}

/// A favourite's live match this week, if any: { ev, m, i } (i = which side they are).
export function favouriteLive() {
  if (data.week !== 0) return null;
  for (const ev of data.events) for (const m of ev.matches) {
    if (m.state !== 'in') continue;
    const i = m.players.findIndex((p) => isFavourite(p.name) || p.name.split(' / ').some(isFavourite));
    if (i >= 0) return { ev, m, i };
  }
  return null;
}

async function poll() {
  clearTimeout(poll.t);
  const following = favourites().length > 0;
  if (following && data.week === 0) await loadWeek(0).catch(() => {});
  // Every minute while a favourite plays, every 15 minutes otherwise (only when you follow someone).
  poll.t = setTimeout(poll, favouriteLive() ? 60e3 : 15 * 60e3);
}

export async function start() {
  // 2.0.5 adds Tennis: switch the tab on once for people who already chose their tabs.
  if (!load('tennis.introduced', false)) {
    save('tennis.introduced', true);
    const enabled = load('modules.enabled', null);
    if (Array.isArray(enabled) && !enabled.includes('tennis')) (await import('../app.js')).setEnabled('tennis', true);
  }
  setTimeout(poll, 10000);
  provide('tennis', 51, () => {
    const f = favouriteLive();
    if (!f) return null;
    const p = f.m.players[f.i];
    const last = (p.short || p.name).split(' ').pop();
    return { icon: '🎾', leftText: last, label: scoreText(f.m, f.i) || 'Live', live: true, tab: 'tennis',
      title: `${p.name} — ${f.ev.name}${f.m.round ? ` · ${f.m.round}` : ''}` };
  });
}
