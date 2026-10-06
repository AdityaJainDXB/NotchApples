// Performance. Two jobs:
//  1. Lite mode: a machine that cannot draw about 40 frames a second (a virtual machine without a graphics
//     driver, an old laptop) gets no glows and no looping animations, so the app stays responsive there.
//     Setting → Appearance → Performance: Auto (default), Full, or Lite.
//  2. A frame-time readout (Ctrl+Shift+F) so slowness can be measured instead of guessed: frames per
//     second, the slowest recent frame, long tasks, and memory.

import { pref } from './prefs.js';
import { load, save } from './store.js';

const body = document.body;
// null = not measured yet; true/false = measured on this machine (kept between launches).
let autoLite = load('perf.autoLite', null);
let probed = false;

export function applyPerf() {
  const mode = pref('ui.performance');
  body.dataset.perf = mode === 'lite' || (mode === 'auto' && autoLite === true) ? 'lite' : 'full';
}

/// Times 36 frames right after the first open. Runs once per launch, only in Auto.
export function probeOnce() {
  if (probed || pref('ui.performance') !== 'auto') return;
  probed = true;
  const deltas = [];
  let last = 0;
  const frame = (t) => {
    if (last) deltas.push(t - last);
    last = t;
    if (deltas.length < 36) return requestAnimationFrame(frame);
    const sorted = deltas.slice(4).sort((a, b) => a - b);        // skip the first frames (layout warm-up)
    const median = sorted[Math.floor(sorted.length / 2)];
    const slow = median > 26;                                    // slower than about 38 fps
    if (slow !== autoLite) { autoLite = slow; save('perf.autoLite', slow); applyPerf(); }
  };
  requestAnimationFrame(frame);
}

// ---------------------------------------------------------------- readout

let hud = null, raf = 0, longTasks = 0, observer = null;

export function toggleHud() {
  if (hud) { hud.remove(); hud = null; cancelAnimationFrame(raf); observer?.disconnect(); return; }
  hud = document.createElement('div');
  hud.id = 'perfhud';
  document.body.appendChild(hud);
  longTasks = 0;
  try { observer = new PerformanceObserver((l) => { longTasks += l.getEntries().length; }); observer.observe({ entryTypes: ['longtask'] }); } catch {}
  let frames = 0, worst = 0, last = performance.now(), since = last;
  const tick = (now) => {
    frames++; worst = Math.max(worst, now - last); last = now;
    if (now - since >= 1000) {
      const mem = performance.memory ? `${Math.round(performance.memory.usedJSHeapSize / 1048576)} MB heap` : '';
      hud.textContent = `${Math.round(frames * 1000 / (now - since))} fps · worst ${Math.round(worst)} ms · ${longTasks} long tasks · ${body.dataset.perf} ${mem}`;
      frames = 0; worst = 0; since = now;
    }
    raf = requestAnimationFrame(tick);
  };
  raf = requestAnimationFrame(tick);
}
