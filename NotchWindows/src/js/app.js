// App shell: tab bar, module routing, collapse/expand and feature gating.
// The Tauri JS API is exposed globally (app.withGlobalTauri), so there is no
// bundler and no Node build step — the frontend is plain ES modules.

import { applyTheme, currentThemeId } from './themes.js';
import { load, save, el } from './store.js';
import { GATED, isActivated } from './license.js';
import { renderActivation } from './modules/activation.js';

const tauri = window.__TAURI__;
export const hasTauri = !!tauri;

/// Calls a Rust command. Returns null (and logs) when running outside Tauri,
/// so the UI can be opened in a plain browser for design work.
export async function invoke(cmd, args) {
  if (!tauri) { console.warn('invoke outside Tauri:', cmd); return null; }
  try { return await tauri.core.invoke(cmd, args); }
  catch (e) { console.error(`invoke ${cmd} failed:`, e); throw e; }
}

export const MODULES = [
  { id: 'today',      name: 'Today',      icon: '☀️', load: () => import('./modules/today.js') },
  { id: 'ai',         name: 'AI',         icon: '✨', load: () => import('./modules/ai.js') },
  { id: 'browser',    name: 'Browser',    icon: '🌐', load: () => import('./modules/browser.js') },
  { id: 'launcher',   name: 'Launcher',   icon: '🚀', load: () => import('./modules/launcher.js') },
  { id: 'search',     name: 'Search',     icon: '🔍', load: () => import('./modules/search.js') },
  { id: 'clipboard',  name: 'Clipboard',  icon: '📋', load: () => import('./modules/clipboard.js') },
  { id: 'notes',      name: 'Notes',      icon: '📝', load: () => import('./modules/notes.js') },
  { id: 'focus',      name: 'Focus',      icon: '⏱', load: () => import('./modules/focus.js') },
  { id: 'translator', name: 'Translator', icon: '🈯', load: () => import('./modules/translator.js') },
  { id: 'stats',      name: 'PC Stats',   icon: '📊', load: () => import('./modules/stats.js') },
  { id: 'worldclock', name: 'World Clock',icon: '🕐', load: () => import('./modules/worldclock.js') },
  { id: 'tools',      name: 'Tools',      icon: '🛠', load: () => import('./modules/tools.js') },
  { id: 'shelf',      name: 'Shelf',      icon: '🗂', load: () => import('./modules/shelf.js') },
  { id: 'settings',   name: 'Settings',   icon: '⚙️', load: () => import('./modules/settings.js') },
];

const DEFAULT_ON = ['today', 'ai', 'browser', 'launcher', 'stats', 'settings'];

export const enabledIds = () => load('modules.enabled', DEFAULT_ON);
export const isEnabled = (id) => id === 'settings' || enabledIds().includes(id);
export function setEnabled(id, on) {
  const list = new Set(enabledIds());
  on ? list.add(id) : list.delete(id);
  save('modules.enabled', [...list]);
  buildTabs();
}

let active = load('ui.lastTab', 'today');
let currentCleanup = null;

const tabbar = document.getElementById('tabbar');
const page = document.getElementById('page');

export function buildTabs() {
  tabbar.replaceChildren();
  const shown = MODULES.filter((m) => isEnabled(m.id));
  if (!shown.some((m) => m.id === active)) active = shown[0]?.id ?? 'settings';
  const compact = shown.length > 7;

  for (const m of shown) {
    const locked = GATED.has(m.id) && !isActivated();
    tabbar.append(el('button', {
      class: `tab${m.id === active ? ' active' : ''}${compact && m.id !== active ? ' icon-only' : ''}`,
      title: m.name + (locked ? ' — needs an access code' : ''),
      onclick: () => show(m.id),
    }, el('span', { class: 'ico' }, m.icon), el('span', {}, m.name + (locked ? ' 🔒' : ''))));
  }
  tabbar.append(el('div', { class: 'spacer' }));
  tabbar.append(el('button', { class: 'sys-btn', title: 'Hide the notch (Ctrl+Alt+O)', onclick: hideNotch }, '👁'));
  tabbar.append(el('button', { class: 'sys-btn', title: 'Close (Esc)', onclick: collapse }, '⌃'));
}

export async function show(id) {
  active = id;
  save('ui.lastTab', id);
  buildTabs();

  if (typeof currentCleanup === 'function') { try { currentCleanup(); } catch {} }
  currentCleanup = null;
  page.replaceChildren();

  // Gated features show the access-code prompt instead of the module.
  if (GATED.has(id) && !isActivated()) {
    const mod = MODULES.find((m) => m.id === id);
    page.append(renderActivation(mod?.name ?? id, () => show(id)));
    return;
  }

  const entry = MODULES.find((m) => m.id === id);
  if (!entry) return;
  try {
    const mod = await entry.load();
    currentCleanup = mod.render(page) || null;
  } catch (e) {
    console.error(e);
    page.append(el('div', { class: 'center' },
      el('div', { class: 'err' }, `Couldn't open ${entry.name}.`),
      el('div', { class: 'small dim' }, String(e?.message ?? e))));
  }
}

// ---- window state -------------------------------------------------------

export async function expand() {
  document.body.classList.remove('collapsed');
  await invoke('set_expanded', { expanded: true });
  show(active);
}

export async function collapse() {
  document.body.classList.add('collapsed');
  if (typeof currentCleanup === 'function') { try { currentCleanup(); } catch {} }
  currentCleanup = null;
  page.replaceChildren();
  await invoke('set_expanded', { expanded: false });
}

async function hideNotch() { await invoke('set_hidden', { hidden: true }); }

document.getElementById('collapsed').addEventListener('click', expand);
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && !document.body.classList.contains('collapsed')) collapse();
});

// Toggled from Rust by the global shortcut, and when the tray icon is clicked.
if (tauri) {
  tauri.event.listen('toggle-notch', () => {
    document.body.classList.contains('collapsed') ? expand() : collapse();
  });
  tauri.event.listen('recording-changed', (e) => {
    document.getElementById('rec-dot').style.display = e.payload ? 'block' : 'none';
  });
}

// ---- collapsed-pill live info ------------------------------------------

function tickPill() {
  const now = new Date();
  document.getElementById('ear-right').textContent =
    now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

applyTheme(currentThemeId());
buildTabs();
tickPill();
setInterval(tickPill, 15000);
window.addEventListener('theme-changed', buildTabs);
