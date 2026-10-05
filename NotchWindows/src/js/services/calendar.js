// Your calendar on Windows: paste the private iCal (.ics) address from Outlook,
// Google Calendar or iCloud in Settings → Calendar, and Today shows your next
// events. Meeting alerts (Pro) count down on the pill and offer a Join button.
//
// Windows doesn't let ordinary apps read the Calendar app's data, so a
// subscription link is the reliable way, and it works with every calendar.

import { load, save } from '../store.js';
import { http, notify, openUrl } from '../native.js';
import { provide, refresh } from '../activity.js';
import { canUse } from '../features.js';

let events = [];
let lastError = null;
const subscribers = new Set();

export const upcoming = (days = 7) => {
  const now = Date.now(), end = now + days * 864e5;
  return events.filter((e) => e.end > now && e.start < end).sort((a, b) => a.start - b.start);
};
export const error = () => lastError;
export const hasCalendars = () => load('calendar.urls', []).length > 0;
export function subscribe(fn) { subscribers.add(fn); return () => subscribers.delete(fn); }

// ---- ICS parsing ----

function unfold(text) { return text.replace(/\r\n/g, '\n').replace(/\n[ \t]/g, ''); }

function parseDate(value, params = '') {
  if (!value) return null;
  const v = value.trim();
  const m = v.match(/^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})(Z)?)?$/);
  if (!m) return null;
  const [, y, mo, d, h = '00', mi = '00', s = '00', z] = m;
  if (!m[4]) return { time: new Date(+y, +mo - 1, +d).getTime(), allDay: true };
  if (z) return { time: Date.UTC(+y, +mo - 1, +d, +h, +mi, +s), allDay: false };
  const tz = (params.match(/TZID=([^;:]+)/) || [])[1];
  if (tz) {
    // Interpret the wall-clock time in that zone.
    try {
      const guess = Date.UTC(+y, +mo - 1, +d, +h, +mi, +s);
      const inZone = new Date(new Date(guess).toLocaleString('en-US', { timeZone: tz.replace(/"/g, '') }));
      const asUtc = new Date(new Date(guess).toLocaleString('en-US', { timeZone: 'UTC' }));
      return { time: guess - (inZone - asUtc), allDay: false };
    } catch { /* unknown zone: treat as local */ }
  }
  return { time: new Date(+y, +mo - 1, +d, +h, +mi, +s).getTime(), allDay: false };
}

const unescape = (s = '') => s.replace(/\\n/gi, '\n').replace(/\\,/g, ',').replace(/\\;/g, ';').replace(/\\\\/g, '\\');
const JOIN = /(https:\/\/[^\s"<>]*(teams\.microsoft\.com|teams\.live\.com|zoom\.us|meet\.google\.com|webex\.com|whereby\.com|meet\.jit\.si)[^\s"<>]*)/i;

export function parseICS(text, calendarName = '') {
  const out = [];
  const DAY = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'];
  for (const block of unfold(text).split('BEGIN:VEVENT').slice(1)) {
    const body = block.split('END:VEVENT')[0];
    const props = {};
    for (const line of body.split('\n')) {
      const i = line.indexOf(':');
      if (i < 0) continue;
      const [name, ...params] = line.slice(0, i).split(';');
      props[name.toUpperCase()] = { value: line.slice(i + 1), params: params.join(';') };
    }
    if ((props.STATUS?.value || '').toUpperCase() === 'CANCELLED') continue;
    const start = parseDate(props.DTSTART?.value, props.DTSTART?.params);
    if (!start) continue;
    const endP = parseDate(props.DTEND?.value, props.DTEND?.params);
    const length = endP ? endP.time - start.time : (start.allDay ? 864e5 : 3600e3);
    const description = unescape(props.DESCRIPTION?.value);
    const location = unescape(props.LOCATION?.value);
    const base = { title: unescape(props.SUMMARY?.value) || '(No title)', allDay: start.allDay, location, calendar: calendarName,
      join: (location.match(JOIN) || description.match(JOIN) || [])[1] || null };

    const rule = props.RRULE?.value;
    if (!rule) { out.push({ ...base, start: start.time, end: start.time + length }); continue; }

    // Repeating events: expanded for the next two weeks (daily/weekly/monthly/yearly).
    const r = Object.fromEntries(rule.split(';').map((p) => p.split('=')));
    const until = r.UNTIL ? parseDate(r.UNTIL)?.time : Infinity;
    const count = r.COUNT ? Number(r.COUNT) : Infinity;
    const interval = Number(r.INTERVAL || 1);
    const byDay = r.BYDAY ? r.BYDAY.split(',').map((d) => DAY.indexOf(d.slice(-2))) : null;
    const exdates = (body.match(/^EXDATE[^:]*:(.*)$/gm) || []).flatMap((l) => l.split(':')[1].split(',')).map((d) => parseDate(d)?.time);
    const horizon = Date.now() + 15 * 864e5;
    let n = 0;
    const s0 = new Date(start.time);
    for (let k = 0; k < 2000 && n < count; k++) {
      let candidates = [];
      if (r.FREQ === 'DAILY') candidates = [new Date(s0.getTime() + k * interval * 864e5)];
      else if (r.FREQ === 'WEEKLY') {
        const weekStart = new Date(s0.getTime() + k * interval * 7 * 864e5);
        candidates = (byDay || [s0.getDay()]).map((dow) => new Date(weekStart.getTime() + ((dow - s0.getDay() + 7) % 7) * 864e5));
      } else if (r.FREQ === 'MONTHLY') { const d = new Date(s0); d.setMonth(s0.getMonth() + k * interval); candidates = [d]; }
      else if (r.FREQ === 'YEARLY') { const d = new Date(s0); d.setFullYear(s0.getFullYear() + k * interval); candidates = [d]; }
      else break;
      let past = false;
      for (const c of candidates.sort((a, b) => a - b)) {
        const t = c.getTime();
        if (t < start.time) continue;
        if (t > until || t > horizon || n >= count) { past = true; break; }
        n++;
        if (!exdates.includes(t) && t + length > Date.now() - 864e5) out.push({ ...base, start: t, end: t + length });
      }
      if (past) break;
    }
  }
  return out;
}

// ---- fetching ----

export async function reload() {
  const urls = load('calendar.urls', []);
  if (!urls.length) { events = []; lastError = null; notifyAll(); return; }
  const all = [];
  let failed = 0;
  for (const { url, name } of urls) {
    try {
      const r = await http(url.replace(/^webcal:\/\//i, 'https://'), { timeout: 20000 });
      if (!r.ok) throw new Error(`answered ${r.status}`);
      all.push(...parseICS(r.text, name));
    } catch { failed++; }
  }
  events = all;
  lastError = failed ? `${failed} calendar${failed > 1 ? 's' : ''} couldn't be loaded. Check the address in Settings → Calendar.` : null;
  notifyAll();
}

function notifyAll() { refresh(); for (const fn of subscribers) { try { fn(); } catch {} } }

export function addCalendar(url, name) {
  const list = load('calendar.urls', []).filter((c) => c.url !== url);
  save('calendar.urls', [...list, { url: url.trim(), name: name || 'Calendar' }]);
  return reload();
}
export function removeCalendar(url) { save('calendar.urls', load('calendar.urls', []).filter((c) => c.url !== url)); return reload(); }

// ---- meeting alerts (Pro) ----

const alerted = new Set();

export function start() {
  reload();
  setInterval(reload, 15 * 60e3);
  setInterval(() => {
    if (!canUse('meetingAlert') || !load('calendar.alerts', true)) return;
    for (const e of upcoming(1)) {
      const mins = (e.start - Date.now()) / 60e3;
      const key = `${e.title}|${e.start}`;
      if (!e.allDay && mins <= 5 && mins > 0 && !alerted.has(key)) {
        alerted.add(key);
        notify(`${e.title} in ${Math.ceil(mins)} min`, e.join ? 'Open Notch apple to join.' : (e.location || 'Coming up'));
      }
    }
    refresh();
  }, 30e3);

  provide('meeting', 75, () => {
    if (!canUse('meetingAlert') || !load('calendar.alerts', true)) return null;
    const e = upcoming(1).find((x) => !x.allDay && x.start - Date.now() <= 10 * 60e3 && x.end > Date.now());
    if (!e) return null;
    const mins = Math.ceil((e.start - Date.now()) / 60e3);
    return { icon: '📅', label: mins > 0 ? `in ${mins} min` : 'Now', live: mins <= 0, tab: 'today', title: e.title };
  });
}

export const join = (e) => e.join && openUrl(e.join);
