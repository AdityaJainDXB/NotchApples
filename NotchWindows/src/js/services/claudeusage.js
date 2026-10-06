// Claude Code usage maths, the same as the Mac's ClaudeUsageLogic.swift so both show the same numbers:
// tokens in your current 5-hour window, today and the last 7 days, and per model.
// The native side (claude_usage.rs) reads the files and hands over one row per reply.

import { load, save } from '../store.js';
import { invoke } from '../native.js';

export const BLOCK_MS = 5 * 3600 * 1000;

/// A native row { t, m, i, o, cw, cr } → an entry.
export const entryOf = (r) => ({ time: r.t, model: r.m, input: r.i, output: r.o, cacheWrite: r.cw, cacheRead: r.cr });
const tokensOf = (e) => e.input + e.output;

export const emptyTotals = () => ({ input: 0, output: 0, cacheWrite: 0, cacheRead: 0, messages: 0 });
function add(t, e) { t.input += e.input; t.output += e.output; t.cacheWrite += e.cacheWrite; t.cacheRead += e.cacheRead; t.messages++; }
export const tokens = (t) => t.input + t.output;

/// A window starts at the hour of its first message.
export const blockStart = (ms) => Math.floor(ms / 3600000) * 3600000;

/// Splits entries (any order) into 5-hour windows.
export function blocks(entries) {
  const out = [];
  for (const e of [...entries].sort((a, b) => a.time - b.time)) {
    const b = out[out.length - 1];
    if (b && e.time < b.start + BLOCK_MS && e.time - b.last < BLOCK_MS) { b.last = e.time; add(b.totals, e); }
    else { const n = { start: blockStart(e.time), last: e.time, totals: emptyTotals() }; add(n.totals, e); out.push(n); }
  }
  return out;
}

/// The window you're in now: not ended, and you used Claude within the last 5 hours.
export function currentBlock(entries, now) {
  const b = blocks(entries).at(-1);
  return b && now < b.start + BLOCK_MS && now - b.last < BLOCK_MS ? { ...b, end: b.start + BLOCK_MS } : null;
}

export function summary(entries, now = Date.now()) {
  const day = new Date(now); day.setHours(0, 0, 0, 0);
  const dayStart = day.getTime();
  const weekStartDate = new Date(day); weekStartDate.setDate(weekStartDate.getDate() - 6);
  const weekStart = weekStartDate.getTime();
  const s = { block: currentBlock(entries, now), today: emptyTotals(), week: emptyTotals(), byModel: [] };
  const per = new Map();
  for (const e of entries) {
    if (e.time > now) continue;
    if (e.time >= dayStart) add(s.today, e);
    if (e.time >= weekStart) { add(s.week, e); per.set(e.model, (per.get(e.model) || 0) + tokensOf(e)); }
  }
  s.byModel = [...per].map(([model, t]) => ({ model, tokens: t })).sort((a, b) => b.tokens - a.tokens);
  return s;
}

export function format(n) {
  if (n < 10000) return Math.round(n).toLocaleString();
  if (n < 1e6) return `${(n / 1e3).toFixed(1)}K`;
  return `${(n / 1e6).toFixed(2)}M`;
}

/// "claude-opus-5-5" → "Opus 5.5"
export function friendlyModel(id) {
  const lower = String(id).toLowerCase();
  const family = ['opus', 'sonnet', 'haiku', 'fable'].find((f) => lower.includes(f));
  if (!family) return id;
  const parts = lower.split(/[-_ ]/);
  const i = parts.indexOf(family);
  const isVersion = (s) => s.length <= 2 && /^\d+$/.test(s);
  const after = []; for (const p of parts.slice(i + 1)) { if (!isVersion(p)) break; after.push(p); }
  const before = []; for (const p of parts.slice(0, i).reverse()) { if (!isVersion(p)) break; before.unshift(p); }
  const digits = after.length ? after : before;
  const name = family[0].toUpperCase() + family.slice(1);
  return digits.length ? `${name} ${digits.join('.')}` : name;
}

/// Time to warn about a budget? True once per period (`key` names the window or week) when `used` reaches `threshold` of it.
export const alertDue = (used, budget, threshold, alertedKey, key) => budget > 0 && alertedKey !== key && used >= budget * (threshold ?? 0.9);

/// The daily summary is due from `at` (minutes since midnight) until the end of the day, once per day.
export const summaryDue = (minuteOfDay, at, lastDayKey, todayKey) => lastDayKey !== todayKey && minuteOfDay >= at;

/// "108K tokens in 107 replies today · 1.64M this week · mostly Opus 5.5"
export function summaryText(today, week, topModel) {
  if (today.messages === 0) return `No Claude Code use today. This week: ${format(tokens(week))} tokens.`;
  let t = `${format(tokens(today))} tokens in ${today.messages} repl${today.messages === 1 ? 'y' : 'ies'} today · ${format(tokens(week))} this week`;
  if (topModel) t += ` · mostly ${friendlyModel(topModel)}`;
  return t;
}

export const fraction = (used, budget) => (budget > 0 ? Math.min(1, used / budget) : null);

export function remaining(end, now = Date.now()) {
  const s = Math.max(0, Math.floor((end - now) / 1000));
  if (s < 60) return 'now';
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

// ---- reading it from this PC ----

export const budgets = () => ({ block: load('claudeusage.block', 0), week: load('claudeusage.week', 0) });
export const setBudget = (key, v) => save(`claudeusage.${key}`, Math.max(0, Math.floor(Number(v) || 0)));
export const alertOn = () => load('claudeusage.alert', true);
export const prefs = () => ({ weekAlert: load('claudeusage.weekAlert', true), summary: load('claudeusage.summary', false), summaryAt: load('claudeusage.summaryAt', 1080) });
export const setPref = (k, v) => save(`claudeusage.${k}`, v);

// ---- background: alerts and the daily summary, even while the tab is closed ----

const isoWeekKey = (d = new Date()) => { const x = new Date(d); x.setHours(0, 0, 0, 0); x.setDate(x.getDate() - ((x.getDay() + 6) % 7)); return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`; };
const dayKey = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

export async function check() {
  const b = budgets(), p = prefs();
  if (!(b.week > 0 && p.weekAlert) && !(b.block > 0 && alertOn()) && !p.summary) return;
  const { canUse } = await import('../features.js');
  if (!canUse('claudeUsage')) return;
  const { found, summary: s } = await read();
  if (!found) return;
  const { notify } = await import('../native.js');
  const dot = await import('./claudecode.js');
  const blk = s.block;
  if (alertOn() && blk && alertDue(tokens(blk.totals), b.block, 0.9, load('claudeusage.blockKey', ''), String(blk.start))) {
    save('claudeusage.blockKey', String(blk.start)); dot.show('yellow');
  }
  if (p.weekAlert && alertDue(tokens(s.week), b.week, 0.9, load('claudeusage.weekKey', ''), isoWeekKey())) {
    save('claudeusage.weekKey', isoWeekKey()); dot.show('yellow');
    notify('Claude usage: 90% of your weekly budget', `${format(tokens(s.week))} of ${format(b.week)} tokens in the last 7 days.`);
  }
  const now = new Date();
  if (p.summary && summaryDue(now.getHours() * 60 + now.getMinutes(), p.summaryAt, load('claudeusage.summaryDay', ''), dayKey())) {
    save('claudeusage.summaryDay', dayKey());
    notify('Claude Code today', summaryText(s.today, s.week, s.byModel[0]?.model));
  }
}

export function start() { setInterval(() => check().catch(() => {}), 300000); }

/// { found, summary } from the transcripts on this PC.
export async function read() {
  const r = await invoke('claude_usage');
  return { found: !!r?.found, summary: summary((r?.entries || []).map(entryOf)) };
}
