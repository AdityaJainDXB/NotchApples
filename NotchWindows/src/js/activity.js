// Live activities on the closed pill, like the Mac's LiveActivityCenter: a running
// timer, the song playing, a live match, a download, the mic in use… Each
// feature registers a provider; the most important current one is shown
// (two at once with Ultimate's "Two activities at once").
//
// An activity is { icon, art, label, side, gauge, bars, live, priority }:
//   icon   an emoji for the left ear       art    an image URL instead of the icon
//   label  short text for the right ear    gauge  0…1 progress bar instead of text
//   bars   animated music bars             live   a pulsing red dot

import { el } from './store.js';

const providers = new Map(); // id -> { priority, get }
let renderer = null;

/// Registers a provider. `get()` returns an activity or null. Higher priority wins.
export function provide(id, priority, get) {
  providers.set(id, { priority, get });
  refresh();
}

export function setRenderer(fn) { renderer = fn; refresh(); }

let queued = false;
/// Recomputes what the pill shows (batched to once per frame).
export function refresh() {
  if (queued) return;
  queued = true;
  requestAnimationFrame(() => {
    queued = false;
    const list = [];
    for (const [id, p] of providers) {
      let a = null;
      try { a = p.get(); } catch (e) { console.error(`activity ${id}`, e); }
      if (a) list.push({ id, priority: a.priority ?? p.priority, ...a });
    }
    list.sort((a, b) => b.priority - a.priority);
    renderer?.(list);
  });
}

/// Builds the pill's left ear (icon or art) and right ear (label, gauge or bars).
export function earsFor(a) {
  const left = [];
  if (a.live) left.push(el('span', { class: 'dot live' }));
  if (a.art) left.push(el('img', { src: a.art, alt: '' }));
  else if (a.icon) left.push(el('span', { class: 'sym' }, a.icon));
  if (a.leftText) left.push(el('span', { class: 'label' }, a.leftText));
  let right;
  if (a.gauge !== undefined && a.gauge !== null) right = el('span', { class: 'gauge' }, el('i', { style: `width:${Math.round(a.gauge * 100)}%` }));
  else if (a.bars) right = el('span', { class: 'bars' }, el('i'), el('i'), el('i'));
  else right = el('span', { class: 'label num' }, a.label ?? '');
  return { left, right };
}
