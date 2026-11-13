// App-wide preferences with their defaults, in one place.

import { load, save } from './store.js';

export const DEFAULTS = {
  'ui.position': 'center',          // center | left | right
  'ui.inset': 120,                  // distance from the edge for left/right
  'ui.size': 'standard',            // compact | standard | large (Pro: other than standard)
  'ui.hoverOpen': false,            // open when the mouse rests on the pill
  'ui.hoverDelay': 250,
  'ui.edgeTrigger': false,          // Pro: open by pushing the mouse to the top edge
  'ui.closeOnBlur': true,           // close when you click elsewhere
  'ui.hideFullscreen': true,        // hide over fullscreen videos and games
  'ui.showClock': true,             // the time on the pill when nothing is happening
  'ui.animation': 'smooth',         // smooth | fast | off (Pro: other than smooth)
  'ui.glass': false,                // experimental: let the desktop show through behind the open notch (off: solid material)
  'ui.performance': 'auto',         // auto | full | lite: lite drops glows and looping animations on slow graphics
  'ui.sounds': false,               // Pro: sounds on open and when timers end
  'ui.textScale': 1,                // 0.9 | 1 | 1.15 | 1.3: the size of text in the open notch
  'ui.skin': 'solid',               // solid | outline | neon: how the open notch looks
  'ui.font': 'system',              // Pro: system | rounded | mono
  'ui.compactTabs': 'auto',         // auto | always | never
  'shortcuts': {
    toggle: 'Ctrl+Alt+N',
    hide: 'Ctrl+Alt+O',
    'tab:clipboard': 'Ctrl+Alt+V',
    palette: 'Ctrl+Alt+K',
    panic: 'Ctrl+Alt+Shift+P',
    quickcapture: 'Ctrl+Alt+J',
    'ai:screen': '',
    'tab:quickadd': '',
    'focus:toggle': '',
    'snap:left': '', 'snap:right': '', 'snap:maximize': '', 'snap:center': '', 'tile': '',
  },
  'lock.enabled': false,            // Windows Hello before the notch opens
  'lock.grace': 300,                // seconds after unlocking before asking again
  'updates.auto': true,
  'updates.pill': true,
  'updates.weekly': false,          // off: you hear about every release; on: one update prompt a week
};

// The notch's size as a percentage of the standard one (Pro). It replaces the old Small / Standard / Large buttons:
// 'ui.sizePct' wins once it has been set, and until then the old choice is read as 86 / 100 / 124 %.
export const SIZE_PCT = { min: 80, max: 150, step: 5, standard: 100 };
const LEGACY_PCT = { compact: 86, standard: 100, large: 124 };
const clampPct = (v) => Math.min(SIZE_PCT.max, Math.max(SIZE_PCT.min, Math.round(Number(v))));
export function sizePct() {
  const v = load('ui.sizePct', null);
  if (typeof v === 'number' && Number.isFinite(v)) return clampPct(v);
  return LEGACY_PCT[load('ui.size', DEFAULTS['ui.size'])] ?? SIZE_PCT.standard;
}
/// The pill and the open panel at `pct` percent of the standard size.
export function sizeFor(pct) {
  const k = clampPct(pct) / 100, s = SIZES.standard;
  return { pillWidth: Math.round(s.pillWidth * k), pillHeight: Math.round(s.pillHeight * k), width: Math.round(s.width * k), height: Math.round(s.height * k) };
}

export const pref = (key) => {
  const v = load(key, DEFAULTS[key]);
  // New shortcut actions added in an update keep their defaults.
  return key === 'shortcuts' ? { ...DEFAULTS.shortcuts, ...v } : v;
};
export const setPref = (key, value) => save(key, value);

export const SIZES = {
  compact:  { pillWidth: 200, pillHeight: 30, width: 640, height: 380 },
  // The Mac's default panel (740 x 420); its custom range is 620-1000 x 360-600.
  standard: { pillWidth: 240, pillHeight: 34, width: 740, height: 420 },
  large:    { pillWidth: 280, pillHeight: 38, width: 920, height: 560 },
};

export const SHORTCUT_NAMES = {
  toggle: 'Open or close the notch',
  hide: 'Hide or show the pill',
  'tab:clipboard': 'Open Clipboard',
  palette: 'Command palette',
  panic: 'Panic hide (hides everything, empties the clipboard)',
  quickcapture: 'Quick note from anywhere',
  'ai:screen': 'Ask AI about your screen',
  'tab:quickadd': 'Quick Add',
  'focus:toggle': 'Start or pause Focus',
  'snap:left': 'Snap window: left half',
  'snap:right': 'Snap window: right half',
  'snap:maximize': 'Snap window: maximise',
  'snap:center': 'Snap window: centre',
  tile: 'Tile all windows',
};
