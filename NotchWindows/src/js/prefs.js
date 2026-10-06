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
  'ui.font': 'system',              // Pro: system | rounded | mono
  'ui.compactTabs': 'auto',         // auto | always | never
  'shortcuts': {
    toggle: 'Ctrl+Alt+N',
    hide: 'Ctrl+Alt+O',
    'tab:clipboard': 'Ctrl+Alt+V',
    palette: 'Ctrl+Alt+K',
    'ai:screen': '',
    'tab:quickadd': '',
    'focus:toggle': '',
    'snap:left': '', 'snap:right': '', 'snap:maximize': '', 'snap:center': '', 'tile': '',
  },
  'lock.enabled': false,            // Windows Hello before the notch opens
  'lock.grace': 300,                // seconds after unlocking before asking again
  'updates.auto': true,
  'updates.pill': true,
};

export const pref = (key) => {
  const v = load(key, DEFAULTS[key]);
  // New shortcut actions added in an update keep their defaults.
  return key === 'shortcuts' ? { ...DEFAULTS.shortcuts, ...v } : v;
};
export const setPref = (key, value) => save(key, value);

export const SIZES = {
  compact:  { pillWidth: 200, pillHeight: 30, width: 700, height: 420 },
  standard: { pillWidth: 240, pillHeight: 34, width: 780, height: 460 },
  large:    { pillWidth: 280, pillHeight: 38, width: 920, height: 560 },
};

export const SHORTCUT_NAMES = {
  toggle: 'Open or close the notch',
  hide: 'Hide or show the pill',
  'tab:clipboard': 'Open Clipboard',
  palette: 'Command palette',
  'ai:screen': 'Ask AI about your screen',
  'tab:quickadd': 'Quick Add',
  'focus:toggle': 'Start or pause Focus',
  'snap:left': 'Snap window: left half',
  'snap:right': 'Snap window: right half',
  'snap:maximize': 'Snap window: maximise',
  'snap:center': 'Snap window: centre',
  tile: 'Tile all windows',
};
