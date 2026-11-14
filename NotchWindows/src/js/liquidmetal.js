// Liquid metal for the notch (opt-in): the highlight behind the open tab, and a metal rim on the notch while the
// pointer is on it. The effect is Jakub Antalik's metal-fx (MIT, https://github.com/Jakubantalik/metal-fx), bundled
// unchanged in vendor/metalfx.js; this file is only the glue (a plain-JS version of the prototype in
// docs/prototypes/liquid-metal-notch.html). It is a WebGL shader, so it is OFF unless the user turns it on in
// Settings, it is never used in Lite performance mode or with Reduce Motion, it stops drawing while hidden, and
// without WebGL nothing changes. Nothing here needs the network.

import { pref } from './prefs.js';

let engine = null, loading = null, glowMap = new Map();

function webglOk() {
  try { const c = document.createElement('canvas'); return !!(c.getContext('webgl2') || c.getContext('webgl')); } catch { return false; }
}
const reduced = () => !!(window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches);
export const wanted = () => pref('ui.liquidMetal') === true && document.body.dataset.perf !== 'lite' && !reduced() && webglOk();

function loadEngine() {
  if (engine) return Promise.resolve(engine);
  loading ||= new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = new URL('./vendor/metalfx.js', import.meta.url).href;
    s.onload = () => {
      const E = window.MetalFxEngine;
      if (!E) return reject(new Error('metal-fx did not load'));
      E.ensureStylesInjected();
      E.setGlowCallback((inst, now) => { const g = glowMap.get(inst); if (g) E.updateGlow(g.handles, inst, now, inst.opacityMul, 'dark'); });
      E.setSharedPreset('silver', 'dark');
      engine = E; resolve(E);
    };
    s.onerror = () => reject(new Error('metal-fx could not be read'));
    document.head.append(s);
  });
  return loading;
}

/// Makes `root` (an element that is already positioned) a liquid-metal surface. Returns { setStrength, destroy }.
async function surface(root, { ring = 1, radius = 999, strength = 1 } = {}) {
  const E = await loadEngine();
  root.classList.add('metal-fx-root');
  root.dataset.variant = 'button'; root.dataset.shape = 'pill'; root.dataset.theme = 'dark'; root.dataset.normalize = 'true';
  const canvas = document.createElement('canvas'); canvas.className = 'metal-fx-canvas'; canvas.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;pointer-events:none';
  const glowHost = document.createElement('div'); glowHost.setAttribute('aria-hidden', 'true'); glowHost.style.cssText = 'position:absolute;inset:0;pointer-events:none';
  root.prepend(canvas, glowHost);
  const size = () => { const r = root.getBoundingClientRect(); const w = Math.max(1, Math.round(r.width)), h = Math.max(1, Math.round(r.height)); return { w, h, r: Math.min(radius, Math.min(w, h) / 2) }; };
  let m = size();
  const inst = E.createInstance({ hostCanvas: canvas, cssWidth: m.w, cssHeight: m.h, cornerRadius: m.r, kind: 'pill', paused: false, scale: 1, ringCssPx: ring });
  const paintGlow = (d) => { glowHost.innerHTML = ''; const handles = E.injectGlow(glowHost, { width: d.w, height: d.h, cornerRadius: d.r, kind: 'pill', scale: 1 }); glowMap.set(inst, { handles }); };
  paintGlow(m); E.registerGlowInstance(inst);
  E.updateInstance(inst, { opacityMul: strength });
  let raf = 0;
  const ro = new ResizeObserver(() => { if (raf) return; raf = requestAnimationFrame(() => { raf = 0; const n = size(); if (n.w === m.w && n.h === m.h) return; m = n; E.updateInstance(inst, { cssWidth: n.w, cssHeight: n.h, cornerRadius: n.r }); paintGlow(n); }); });
  ro.observe(root);
  const io = new IntersectionObserver((es) => es.forEach((e) => E.setInstanceVisible(inst, e.isIntersecting)));
  io.observe(root);
  return {
    setStrength(v) { E.updateInstance(inst, { opacityMul: Math.max(0, Math.min(1, v)) }); },
    setRing(px) { E.updateInstance(inst, { ringCssPx: px }); },
    destroy() { ro.disconnect(); io.disconnect(); try { E.unregisterGlowInstance?.(inst); E.destroyInstance?.(inst); } catch {} glowMap.delete(inst); canvas.remove(); glowHost.remove(); root.classList.remove('metal-fx-root'); },
  };
}

let pill = null, rim = null, rimHost = null, started = false;

/// Called once by the app with the open-tab highlight and the notch's main element.
export function init(tabPill, notchEl) {
  if (started) return; started = true;
  const apply = async () => {
    if (wanted()) {
      document.body.classList.add('liquid-metal');
      try {
        pill ||= await surface(tabPill, { ring: 1, strength: 0.95 });
        if (notchEl && !rim) {
          rimHost = document.createElement('div'); rimHost.className = 'lm-rim'; notchEl.append(rimHost);
          rim = await surface(rimHost, { ring: 2, strength: 0.9, radius: 22 });
        }
      } catch { document.body.classList.remove('liquid-metal'); }
    } else {
      document.body.classList.remove('liquid-metal');
      pill?.destroy(); pill = null; rim?.destroy(); rim = null; rimHost?.remove(); rimHost = null;
    }
  };
  // The metal rim eases in while the pointer is on the notch and out when it leaves (never a hard switch).
  let target = 0, level = 0, raf = 0;
  const step = () => { level += (target - level) * 0.18; if (Math.abs(target - level) < 0.01) level = target; if (rimHost) rimHost.style.opacity = String(level * 0.95); rim?.setStrength(0.9); rim?.setRing(1 + 1.8 * level); raf = level === target ? 0 : requestAnimationFrame(step); };
  const hover = (on) => { target = on ? 1 : 0; if (!raf && rim) raf = requestAnimationFrame(step); };
  notchEl?.addEventListener('pointerenter', () => hover(true));
  notchEl?.addEventListener('pointerleave', () => hover(false));
  window.addEventListener('notch-pref', (e) => { if (!e.detail || e.detail.key === 'ui.liquidMetal' || e.detail.key === 'ui.performance') apply(); });
  matchMedia('(prefers-reduced-motion: reduce)').addEventListener?.('change', apply);
  apply();
}
