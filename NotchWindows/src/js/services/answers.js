// Short answers typed into the command palette or calculator: "12% of 80", "15% off 200", "200 + 15%", "20 is what % of 80",
// "5 km in mi", "days until 25 Dec" and "time in Tokyo". Nothing is sent anywhere. The same rules as the Mac's
// QuickAnswerLogic.swift, with the same test cases.

import { daysBetween } from './wellbeing.js';

/// Up to 4 decimals, no trailing zeros.
export const number = (v) => (Number.isInteger(v) && Math.abs(v) < 1e12 ? String(v) : String(+v.toFixed(4)));
const N = '(-?[0-9]+(?:\\.[0-9]+)?)';
const groups = (q, pattern) => { const m = q.match(new RegExp(pattern)); return m ? m.slice(1).map(Number) : null; };
const answerOf = (v, suffix = '') => ({ text: number(v) + suffix, copy: number(v) });

// ---- percentages ----

export function percent(q) {
  let g;
  if ((g = groups(q, `^${N}\\s*%\\s*of\\s*${N}$`))) return answerOf((g[0] / 100) * g[1]);               // 12% of 80
  if ((g = groups(q, `^${N}\\s*%\\s*off\\s*${N}$`))) return answerOf(g[1] * (1 - g[0] / 100));           // 15% off 200
  if ((g = groups(q, `^${N}\\s*\\+\\s*${N}\\s*%$`))) return answerOf(g[0] * (1 + g[1] / 100));           // 200 + 15%
  if ((g = groups(q, `^${N}\\s*-\\s*${N}\\s*%$`))) return answerOf(g[0] * (1 - g[1] / 100));             // 200 - 15%
  if ((g = groups(q, `^${N}\\s*is\\s*what\\s*%\\s*of\\s*${N}$`)) && g[1] !== 0) return answerOf((g[0] / g[1]) * 100, '%');   // 20 is what % of 80
  return null;
}

// ---- units (the same table as the Mac's converter) ----

const L = { mm: 0.001, cm: 0.01, m: 1, km: 1000, in: 0.0254, inch: 0.0254, inches: 0.0254, ft: 0.3048, feet: 0.3048, yd: 0.9144, mi: 1609.344, mile: 1609.344, miles: 1609.344, nmi: 1852 };
const M = { mg: 1e-6, g: 0.001, kg: 1, lb: 0.45359237, lbs: 0.45359237, oz: 0.028349523125, st: 6.35029318, t: 1000 };
const V = { ml: 0.001, l: 1, cup: 0.2365882365, cups: 0.2365882365, tsp: 0.00492892159375, tbsp: 0.01478676478125, floz: 0.0295735295625, gal: 3.785411784, pt: 0.473176473 };
const S = { kmh: 1000 / 3600, kph: 1000 / 3600, mph: 0.44704, ms: 1, kn: 1852 / 3600 };
const D = { kb: 1e3, mb: 1e6, gb: 1e9, tb: 1e12 };
const T = { s: 1, sec: 1, min: 60, h: 3600, hr: 3600 };
const A = { sqm: 1, sqft: 0.09290304, acre: 4046.8564224, acres: 4046.8564224, ha: 10000 };
const TEMP = { c: 'c', '°c': 'c', f: 'f', '°f': 'f', k: 'k' };
const FAMILIES = [L, M, V, S, D, T, A];

/// "5 km in mi" → { amount, from, to } or null.
export function parseConversion(s) {
  const m = String(s).toLowerCase().trim().match(/^([0-9]+(?:\.[0-9]+)?)\s*([a-z°$€£¥]+)\s+(?:to|in|as|=)\s+([a-z°$€£¥]+)$/);
  return m ? { amount: Number(m[1]), from: m[2], to: m[3] } : null;
}
export function convertUnits({ amount, from, to }) {
  if (TEMP[from] && TEMP[to]) {
    const c = TEMP[from] === 'c' ? amount : TEMP[from] === 'f' ? ((amount - 32) * 5) / 9 : amount - 273.15;
    return TEMP[to] === 'c' ? c : TEMP[to] === 'f' ? (c * 9) / 5 + 32 : c + 273.15;
  }
  const fam = FAMILIES.find((f) => from in f && to in f);
  return fam ? (amount * fam[from]) / fam[to] : null;
}
export function unitConversion(q) {
  const c = parseConversion(q); const r = c && convertUnits(c);
  if (r === null || r === undefined) return null;
  const out = number(Math.round(r * 1e6) / 1e6);
  return { text: `${number(c.amount)} ${c.from} = ${out} ${c.to}`, copy: out };
}

// ---- dates ----

const MONTHS = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };
const parts = (now, tz) => { const [y, m, d] = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now).split('-').map(Number); return { y, m, d }; };
const key = (y, m, d) => `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;

/// "days until 25 dec", "days until dec 25", "days until 2026-12-25". A date that has passed this year means next year.
export function daysUntil(q, now = new Date(), tz) {
  const m0 = q.match(/^days (?:until|to) (.+)$/);
  if (!m0) return null;
  const rest = m0[1].trim(), today = parts(now, tz);
  let y = today.y, mo, d, explicitYear = false, m;
  if ((m = rest.match(/^([0-9]{4})-([0-9]{1,2})-([0-9]{1,2})$/))) { y = +m[1]; mo = +m[2]; d = +m[3]; explicitYear = true; }
  else if ((m = rest.match(/^([0-9]{1,2})\s+([a-z]{3})[a-z]*$/))) { d = +m[1]; mo = MONTHS[m[2]]; }
  else if ((m = rest.match(/^([a-z]{3})[a-z]*\s+([0-9]{1,2})$/))) { mo = MONTHS[m[1]]; d = +m[2]; }
  if (!mo || !d || d < 1 || d > 31) return null;
  const from = key(today.y, today.m, today.d);
  let target = key(y, mo, d), days = daysBetween(from, target);
  if (!explicitYear && days < 0) { y++; target = key(y, mo, d); days = daysBetween(from, target); }
  if (days === null || new Date(Date.UTC(y, mo - 1, d)).getUTCDate() !== d) return null;   // 31 Feb and the like
  return { text: days === 0 ? 'Today' : `${Math.abs(days)} day${Math.abs(days) === 1 ? '' : 's'}${days < 0 ? ' ago' : ''}`, copy: String(days) };
}

// ---- time zones ----

export const CITIES = {
  tokyo: 'Asia/Tokyo', london: 'Europe/London', 'new york': 'America/New_York', nyc: 'America/New_York', 'los angeles': 'America/Los_Angeles', 'san francisco': 'America/Los_Angeles',
  chicago: 'America/Chicago', toronto: 'America/Toronto', 'mexico city': 'America/Mexico_City', 'sao paulo': 'America/Sao_Paulo', paris: 'Europe/Paris', berlin: 'Europe/Berlin',
  madrid: 'Europe/Madrid', rome: 'Europe/Rome', amsterdam: 'Europe/Amsterdam', moscow: 'Europe/Moscow', istanbul: 'Europe/Istanbul', cairo: 'Africa/Cairo', lagos: 'Africa/Lagos',
  johannesburg: 'Africa/Johannesburg', nairobi: 'Africa/Nairobi', dubai: 'Asia/Dubai', karachi: 'Asia/Karachi', delhi: 'Asia/Kolkata', mumbai: 'Asia/Kolkata', dhaka: 'Asia/Dhaka',
  bangkok: 'Asia/Bangkok', singapore: 'Asia/Singapore', 'hong kong': 'Asia/Hong_Kong', shanghai: 'Asia/Shanghai', beijing: 'Asia/Shanghai', seoul: 'Asia/Seoul', sydney: 'Australia/Sydney',
  melbourne: 'Australia/Melbourne', auckland: 'Pacific/Auckland', honolulu: 'Pacific/Honolulu', utc: 'UTC',
};

/// "time in tokyo" → "15:45 in Tokyo (Wed)"
export function timeIn(q, now = new Date()) {
  const m = q.match(/^time in (.+)$/);
  const zone = m && CITIES[m[1].trim()];
  if (!zone) return null;
  const hm = new Intl.DateTimeFormat('en-GB', { timeZone: zone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(now);
  const day = new Intl.DateTimeFormat('en-US', { timeZone: zone, weekday: 'short' }).format(now);
  const name = m[1].trim().split(' ').map((w) => w[0].toUpperCase() + w.slice(1)).join(' ');
  return { text: `${hm} in ${name} (${day})`, copy: hm };
}

/// The answer to a typed question, or null if it isn't one of the forms above.
export function answer(raw, now = new Date(), tz) {
  const q = String(raw).trim().toLowerCase().replace('what is ', '').replace("what's ", '');
  return q ? percent(q) || unitConversion(q) || daysUntil(q, now, tz) || timeIn(q, now) : null;
}
