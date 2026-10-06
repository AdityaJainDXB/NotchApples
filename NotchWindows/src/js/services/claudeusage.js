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

/// { found, summary } from the transcripts on this PC.
export async function read() {
  const r = await invoke('claude_usage');
  return { found: !!r?.found, summary: summary((r?.entries || []).map(entryOf)) };
}
