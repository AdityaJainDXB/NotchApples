// Download progress (Pro): while a browser is downloading into your Downloads
// folder, its size and speed show on the pill, and "Done" when it finishes.

import { load, fmtBytes, fmtSpeed } from '../store.js';
import { invoke, notify } from '../native.js';
import { provide, refresh } from '../activity.js';
import { canUse } from '../features.js';

let active = [];   // [{ name, size, speed }]
let last = new Map();
let finished = null;

async function poll() {
  clearTimeout(poll.t);
  if (!canUse('downloadProgress') || !load('downloads.pill', true)) { active = []; poll.t = setTimeout(poll, 30_000); return; }
  let list = [];
  try { list = await invoke('downloads_progress'); } catch { list = []; }
  const now = Date.now();
  const next = new Map();
  active = list.map((d) => {
    const prev = last.get(d.name);
    const speed = prev ? Math.max(0, (d.size - prev.size) / ((now - prev.at) / 1000)) : 0;
    next.set(d.name, { size: d.size, at: now });
    return { ...d, speed };
  });
  for (const [name] of last) {
    if (!next.has(name)) {
      finished = { name: name.replace(/\.(crdownload|part|partial|download|opdownload)$/i, ''), until: now + 20_000 };
      notify('Download finished', finished.name);
    }
  }
  last = next;
  refresh();
  poll.t = setTimeout(poll, active.length ? 2000 : 8000);
}

export function start() {
  poll();
  provide('downloads', 50, () => {
    if (active.length) {
      const total = active.reduce((s, d) => s + d.size, 0);
      const speed = active.reduce((s, d) => s + d.speed, 0);
      return { icon: '⬇', label: `${fmtBytes(total)}${speed ? ` · ${fmtSpeed(speed)}` : ''}`, title: active.map((d) => d.name).join(', ') };
    }
    if (finished && finished.until > Date.now()) return { icon: '✅', label: 'Downloaded', title: finished.name };
    return null;
  });
}
