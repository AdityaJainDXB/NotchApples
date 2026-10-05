// Keep Awake, with an optional time limit. The state survives restarts, and a
// cup shows on the pill while it's on (as on the Mac).

import { load, save, fmtDuration } from '../store.js';
import { invoke } from '../native.js';
import { provide, refresh } from '../activity.js';

export const state = () => ({ on: false, display: true, until: 0, ...load('awake.state', {}) });

export async function set(on, { display = true, minutes = 0 } = {}) {
  const s = { on, display, until: on && minutes ? Date.now() + minutes * 60e3 : 0 };
  await invoke('set_keep_awake', { on, display });
  save('awake.state', s);
  refresh();
}

export function start() {
  const s = state();
  if (s.on && (!s.until || s.until > Date.now())) invoke('set_keep_awake', { on: true, display: s.display }).catch(() => {});
  else if (s.on) save('awake.state', { ...s, on: false });
  setInterval(() => {
    const t = state();
    if (t.on && t.until && Date.now() >= t.until) set(false);
  }, 15_000);
  provide('awake', 10, () => {
    const t = state();
    if (!t.on || !load('awake.pill', true)) return null;
    return { icon: '☕', label: t.until ? fmtDuration((t.until - Date.now()) / 1000) : 'Awake', tab: 'tools', title: 'Keeping your PC awake' };
  });
}
