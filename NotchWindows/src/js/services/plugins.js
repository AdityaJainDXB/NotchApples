// Plugins: the xbar-like format the Mac app uses (see plugins.rs). Parsing lives
// here so the tab and the background runner share it. With Ultimate's Live
// Activities API, a plugin line like
//     activity: text=42% icon=🔨 progress=0.42
// shows on the pill, so plugins keep running in the background.

import { load } from '../store.js';
import { invoke } from '../native.js';
import { provide, refresh } from '../activity.js';
import { canUse } from '../features.js';

/// Output text -> { title, lines: [{ text, href, run }], activity }
export function parse(output = '') {
  const lines = output.replace(/\r/g, '').split('\n').filter((l) => l.trim() && l.trim() !== '---');
  let activity = null;
  const parsed = [];
  for (const raw of lines) {
    if (/^activity:/i.test(raw.trim())) {
      const a = {};
      for (const m of raw.replace(/^activity:/i, '').matchAll(/(\w+)=("[^"]*"|\S+)/g)) a[m[1]] = m[2].replace(/^"|"$/g, '');
      activity = { label: a.text || '', icon: a.icon || a.symbol || '🧩', gauge: a.progress !== undefined ? Math.max(0, Math.min(1, Number(a.progress))) : undefined };
      continue;
    }
    const [text, ...params] = raw.split('|');
    const opts = Object.fromEntries(params.join('|').trim().split(/\s+/).filter(Boolean).map((p) => {
      const i = p.indexOf('='); return i < 0 ? [p, true] : [p.slice(0, i), p.slice(i + 1)];
    }));
    parsed.push({ text: text.trim(), href: /^https?:\/\//.test(opts.href || '') ? opts.href : null, run: opts.run || null });
  }
  return { title: parsed[0]?.text || '', lines: parsed.slice(1), activity };
}

const outputs = new Map(); // file -> { at, parsed, error }
export const output = (file) => outputs.get(file);

export async function run(file) {
  try {
    const text = await invoke('plugin_run', { file });
    outputs.set(file, { at: Date.now(), parsed: parse(text), error: null });
  } catch (e) {
    outputs.set(file, { at: Date.now(), parsed: null, error: e.message });
  }
  refresh();
  return outputs.get(file);
}

let timer = null;

async function background() {
  clearTimeout(timer);
  if (canUse('liveActivityAPI') && load('plugins.background', true)) {
    let list = [];
    try { list = await invoke('plugins_list'); } catch {}
    for (const p of list) {
      const last = outputs.get(p.file);
      if (!last || Date.now() - last.at >= p.interval * 1000) await run(p.file);
    }
  }
  timer = setTimeout(background, 15_000);
}

export function start() {
  setTimeout(background, 10_000);
  provide('plugins', 35, () => {
    if (!canUse('liveActivityAPI')) return null;
    for (const [, o] of outputs) if (o.parsed?.activity) return { ...o.parsed.activity, tab: 'plugins' };
    return null;
  });
}
