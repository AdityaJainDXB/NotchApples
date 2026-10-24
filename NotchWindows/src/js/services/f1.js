// Formula 1, like the Mac's F1 add-on: the weekend schedule in your time zone
// and standings (Jolpica, the free Ergast-compatible API), the running order
// during a session (ESPN's free racing feed), the latest classification, and a
// driver you follow on the pill while a session is live.

import { load, save } from '../store.js';
import { getJSON } from '../native.js';
import { provide, refresh } from '../activity.js';

const J = 'https://api.jolpi.ca/ergast/f1';
const ESPN = 'https://site.api.espn.com/apis/site/v2/sports/racing/f1/scoreboard';

export const TEAM_COLOURS = {
  'Red Bull': '#3671C6', Mercedes: '#27F4D2', Ferrari: '#E8002D', McLaren: '#FF8000', 'Aston Martin': '#229971',
  Alpine: '#0093CC', Williams: '#64C4FF', 'RB F1 Team': '#6692FF', 'Racing Bulls': '#6692FF', Sauber: '#52E252',
  'Kick Sauber': '#52E252', Audi: '#F50537', Haas: '#B6BABD', 'Haas F1 Team': '#B6BABD', Cadillac: '#C9B37E',
};
export const colourOf = (team = '') => Object.entries(TEAM_COLOURS).find(([k]) => team.toLowerCase().includes(k.toLowerCase()))?.[1] || '#888';

const SESSION_NAMES = { FirstPractice: 'Practice 1', SecondPractice: 'Practice 2', ThirdPractice: 'Practice 3', SprintQualifying: 'Sprint Qualifying', SprintShootout: 'Sprint Shootout', Sprint: 'Sprint', Qualifying: 'Qualifying' };

const data = { weekend: null, drivers: [], teams: [], last: null, live: null, timing: null, at: 0 };
const OF1 = 'https://api.openf1.org/v1/';

export const lapText = (s) => { if (!(s > 0)) return ''; const m = Math.floor(s / 60), r = s - m * 60; return m ? `${m}:${r.toFixed(3).padStart(6, '0')}` : r.toFixed(3); };
/// The timing table for a session from OpenF1's lists: the order (by best lap outside races), last and best laps, the
/// tyre and its age in laps, pit stops and gaps.
export function buildTiming(session, drv, pos, laps, stints, pits, ivals) {
  const isRace = session.session_type === 'Race', place = {}, best = {}, last = {}, lapN = {}, stint = {}, pitN = {}, gapL = {}, gapA = {};
  for (const p of pos) place[p.driver_number] = p.position;
  for (const l of laps) { const n = l.driver_number; lapN[n] = Math.max(lapN[n] || 0, l.lap_number || 0); if (l.lap_duration > 0) { last[n] = l.lap_duration; if (!(best[n] <= l.lap_duration)) best[n] = l.lap_duration; } }
  for (const st of stints) stint[st.driver_number] = st;
  for (const p of pits) pitN[p.driver_number] = (pitN[p.driver_number] || 0) + 1;
  const g = (v) => (typeof v === 'number' ? `+${v.toFixed(3)}` : v || '');
  for (const i of ivals) { gapL[i.driver_number] = g(i.gap_to_leader); gapA[i.driver_number] = g(i.interval); }
  const fastest = Math.min(...Object.values(best));
  let rows = drv.map((d) => { const n = d.driver_number, st = stint[n], ln = lapN[n] || 0;
    return { num: n, pos: place[n] || 99, code: d.name_acronym, name: d.full_name, team: d.team_name || '', colour: d.team_colour ? `#${d.team_colour}` : null,
      gap: isRace ? gapL[n] || '' : best[n] && best[n] !== fastest ? `+${(best[n] - fastest).toFixed(3)}` : '', interval: isRace ? gapA[n] || '' : '',
      last: lapText(last[n]), best: lapText(best[n]), bestS: best[n] || Infinity, tyre: st?.compound || '', age: st ? (st.tyre_age_at_start || 0) + Math.max(0, ln - (st.lap_start ?? ln) + 1) : 0, pits: pitN[n] || 0, laps: ln }; });
  rows = isRace ? rows.sort((a, b) => a.pos - b.pos) : rows.sort((a, b) => a.bestS - b.bestS).map((r, i) => ({ ...r, pos: i + 1 }));
  return { title: `${session.session_name} · ${session.location || ''}`, race: isRace, rows };
}
export async function loadTiming() {
  const s = (await getJSON(`${OF1}sessions?session_key=latest`))?.[0];
  if (!s) { data.timing = null; return; }
  const q = `?session_key=${s.session_key}`, get1 = (e) => getJSON(OF1 + e + q).catch(() => []);
  const [drv, pos, laps, stints, pits, ivals] = await Promise.all(['drivers', 'position', 'laps', 'stints', 'pit', 'intervals'].map(get1));
  data.timing = Array.isArray(drv) && drv.length ? buildTiming(s, drv, pos || [], Array.isArray(laps) ? laps : [], Array.isArray(stints) ? stints : [], Array.isArray(pits) ? pits : [], Array.isArray(ivals) ? ivals : []) : null;
}
export const get = () => data;
export const followed = () => load('f1.follow', '');
export const follow = (code) => { save('f1.follow', followed() === code ? '' : code); refresh(); };

export async function loadSchedule() {
  const j = await getJSON(`${J}/current/next.json`);
  const r = j.MRData?.RaceTable?.Races?.[0];
  if (!r) { data.weekend = null; return; }
  const at = (x) => new Date(`${x.date}T${x.time || '00:00:00Z'}`);
  const sessions = Object.entries(SESSION_NAMES).filter(([k]) => r[k]).map(([k, name]) => ({ name, start: at(r[k]) }));
  sessions.push({ name: 'Race', start: at(r) });
  sessions.sort((a, b) => a.start - b.start);
  data.weekend = { name: r.raceName, round: r.round, circuit: r.Circuit?.circuitName, place: [r.Circuit?.Location?.locality, r.Circuit?.Location?.country].filter(Boolean).join(', '), sessions };
}

export async function loadStandings() {
  const [d, c] = await Promise.all([getJSON(`${J}/current/driverstandings.json`), getJSON(`${J}/current/constructorstandings.json`)]);
  data.drivers = (d.MRData?.StandingsTable?.StandingsLists?.[0]?.DriverStandings || []).map((x) => ({
    pos: x.position, code: x.Driver.code, name: `${x.Driver.givenName} ${x.Driver.familyName}`, family: x.Driver.familyName, team: x.Constructors?.[0]?.name || '', points: x.points, wins: x.wins }));
  data.teams = (c.MRData?.StandingsTable?.StandingsLists?.[0]?.ConstructorStandings || []).map((x) => ({ pos: x.position, name: x.Constructor.name, points: x.points, wins: x.wins }));
}

export async function loadLast() {
  const j = await getJSON(`${J}/current/last/results.json`);
  const r = j.MRData?.RaceTable?.Races?.[0];
  data.last = r ? { name: r.raceName, rows: r.Results.map((x) => ({ pos: x.positionText, code: x.Driver.code, name: `${x.Driver.givenName} ${x.Driver.familyName}`,
    team: x.Constructor?.name || '', time: x.Time?.time || x.status, points: x.points, laps: x.laps, fastest: x.FastestLap?.rank === '1' })) } : null;
}

/// The session on now (or that just ended), with its running order, from ESPN.
export async function loadLive() {
  const j = await getJSON(ESPN, { timeout: 12000 });
  const e = j.events?.[0];
  const comps = e?.competitions || [];
  const now = Date.now();
  // In progress, or finished within the last 2 hours.
  const c = comps.find((x) => x.status?.type?.state === 'in')
    || comps.filter((x) => x.status?.type?.state === 'post' && now - new Date(x.date) < 4 * 3600e3).pop();
  if (!c) { data.live = null; return; }
  const codeOf = (name) => {
    const family = name.split(' ').slice(1).join(' ').toLowerCase();
    return data.drivers.find((d) => d.family.toLowerCase() === family || name.toLowerCase().includes(d.family.toLowerCase()))?.code
      || name.split(' ').pop().slice(0, 3).toUpperCase();
  };
  data.live = {
    event: e.name, session: c.type?.abbreviation || '', state: c.status.type.state, lap: c.status.period || 0,
    order: (c.competitors || []).sort((a, b) => a.order - b.order).map((x) => {
      const code = codeOf(x.athlete?.displayName || '');
      return { pos: x.order, name: x.athlete?.displayName, code, team: data.drivers.find((d) => d.code === code)?.team || '' };
    }),
  };
}

export async function loadAll() {
  await Promise.allSettled([loadSchedule(), loadStandings(), loadLast(), loadTiming()]);
  await loadLive().catch(() => {});
  data.at = Date.now();
  refresh();
}

export const nextSession = () => data.weekend?.sessions.find((s) => s.start > Date.now()) || null;
const sessionLive = () => data.weekend?.sessions.some((s) => Date.now() >= s.start && Date.now() - s.start < 3 * 3600e3);

async function poll() {
  clearTimeout(poll.t);
  const following = !!followed();
  if (sessionLive() || !data.at) {
    await loadLive().catch(() => {});
    if (!data.at) await loadAll();
    refresh();
  }
  // Every 30 s during a session if you follow a driver, else every 30 minutes.
  poll.t = setTimeout(poll, sessionLive() && following ? 30e3 : 30 * 60e3);
}

export function start() {
  setTimeout(poll, 8000);
  provide('f1', 52, () => {
    const code = followed();
    const live = data.live;
    if (!code || !live || live.state !== 'in') return null;
    const car = live.order.find((o) => o.code === code);
    if (!car) return null;
    return { icon: '🏁', leftText: `P${car.pos}`, label: `${code}${live.session === 'Race' && live.lap ? ` L${live.lap}` : ''}`, live: true, tab: 'f1', title: `${car.name} — ${live.session}` };
  });
}
