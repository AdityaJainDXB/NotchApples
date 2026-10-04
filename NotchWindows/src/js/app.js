// App shell: tab bar, module routing, collapse/expand and feature gating.
// The Tauri JS API is exposed globally (app.withGlobalTauri), so there is no
// bundler and no Node build step — the frontend is plain ES modules.

import { applyTheme, currentThemeId } from './themes.js';
import { load, save, el } from './store.js';
import { can, loadSaved, tierName } from './license.js';
import { renderUpgrade } from './modules/activation.js';

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
  { id: 'sports',     name: 'Sports',     icon: '⚽', load: () => import('./modules/sports.js') },
  { id: 'browser',    name: 'Browser',    icon: '🌐', load: () => import('./modules/browser.js') },
  { id: 'launcher',   name: 'Launcher',   icon: '🚀', tier: 1, load: () => import('./modules/launcher.js') },
  { id: 'search',     name: 'Search',     icon: '🔍', load: () => import('./modules/search.js') },
  { id: 'clipboard',  name: 'Clipboard',  icon: '📋', tier: 1, load: () => import('./modules/clipboard.js') },
  { id: 'todo',       name: 'To-do',      icon: '✅', load: () => import('./modules/todo.js') },
  { id: 'notes',      name: 'Notes',      icon: '📝', load: () => import('./modules/notes.js') },
  { id: 'focus',      name: 'Focus',      icon: '⏱', tier: 1, load: () => import('./modules/focus.js') },
  { id: 'translator', name: 'Translator', icon: '🈯', tier: 1, load: () => import('./modules/translator.js') },
  { id: 'stats',      name: 'PC Stats',   icon: '📊', tier: 1, load: () => import('./modules/stats.js') },
  { id: 'worldclock', name: 'World Clock',icon: '🕐', load: () => import('./modules/worldclock.js') },
  { id: 'tools',      name: 'Tools',      icon: '🛠', load: () => import('./modules/tools.js') },
  { id: 'shelf',      name: 'Shelf',      icon: '🗂', tier: 1, load: () => import('./modules/shelf.js') },
  { id: 'settings',   name: 'Settings',   icon: '⚙️', load: () => import('./modules/settings.js') },
];

/// The tier a module needs (0 Free, 1 Pro, 2 Ultimate), as on the Mac.
export const needs = (m) => m.tier ?? 0;

const DEFAULT_ON = ['today', 'todo', 'ai', 'sports', 'browser', 'launcher', 'stats', 'settings'];

// Sports is on for everyone (it follows Barcelona out of the box), including people who
// saved their tab choices before it existed.
try {
  if (localStorage.getItem('modules.enabled') !== null && !localStorage.getItem('sports.added')) {
    const list = new Set(JSON.parse(localStorage.getItem('modules.enabled')));
    list.add('sports');
    localStorage.setItem('modules.enabled', JSON.stringify([...list]));
    localStorage.setItem('sports.added', '1');
  }
} catch { /* storage unavailable */ }

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
    const locked = !can(needs(m));
    tabbar.append(el('button', {
      class: `tab${m.id === active ? ' active' : ''}${compact && m.id !== active ? ' icon-only' : ''}`,
      title: locked ? `${m.name} (${needs(m) === 2 ? 'Ultimate' : 'Pro'})` : m.name,
      style: locked ? 'opacity:.55' : '',
      onclick: () => show(m.id),
    }, el('span', { class: 'ico' }, m.icon), el('span', {}, m.name)));
  }
  tabbar.append(el('div', { class: 'spacer' }));
  tabbar.append(el('button', { class: 'sys-btn', title: 'Hide the notch (Ctrl+Alt+O)', onclick: hideNotch }, '👁'));
  tabbar.append(el('button', { class: 'sys-btn', title: 'Close (Esc)', onclick: collapse }, '⌃'));
}

export async function show(id) {
  active = id;
  save('ui.lastTab', id);
  buildTabs();
  updateHint();

  if (typeof currentCleanup === 'function') { try { currentCleanup(); } catch {} }
  currentCleanup = null;
  page.replaceChildren();

  const entry = MODULES.find((m) => m.id === id);
  if (!entry) return;
  // A Pro or Ultimate module on a lower tier shows what it does and how to unlock it.
  if (!can(needs(entry))) {
    page.append(renderUpgrade(entry, () => show(active)));
    return;
  }
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

function updateHint() {
  document.getElementById('collapsed-hint').textContent = tierName() === 'Free' ? 'Notch apple' : `Notch apple ${tierName()}`;
  ensureSportsWatcher();
}

// The live score of your team shows on the closed pill.
let sportsWatching = false;
function ensureSportsWatcher() {
  if (sportsWatching || !isEnabled('sports')) return;
  sportsWatching = true;
  import('./modules/sports.js').then((m) => m.startWatcher(
    (text) => { document.getElementById('ear-left').textContent = text; },
    () => isEnabled('sports')));
}

function tickPill() {
  const now = new Date();
  document.getElementById('ear-right').textContent =
    now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

// ---- command palette (Ctrl+K): jump to any tab or action by typing ----

function openPalette() {
  if (document.getElementById('palette')) return;
  if (document.body.classList.contains('collapsed')) expand();
  const actions = [
    ...MODULES.filter((m) => isEnabled(m.id)).map((m) => ({ label: `${m.icon} ${m.name}`, run: () => show(m.id) })),
    { label: '➕ New note', run: () => { save('notes.newOnOpen', true); show('notes'); } },
    { label: '🔑 Enter a key', run: () => { save('settings.pane', 'Access'); show('settings'); } },
    { label: '🎨 Change theme', run: () => { save('settings.pane', 'Appearance'); show('settings'); } },
    { label: '🙈 Hide the notch', run: hideNotch },
    { label: '⏏ Quit Notch apple', run: () => invoke('quit_app') },
  ];
  const input = el('input', { class: 'field', placeholder: 'Type a tab or action…' });
  const list = el('div', { class: 'col', style: 'gap:2px;max-height:240px;overflow:auto' });
  let picked = 0, matches = actions;
  const close = () => box.remove();
  const paint = () => {
    const q = input.value.trim().toLowerCase();
    matches = actions.filter((a) => a.label.toLowerCase().includes(q));
    picked = Math.min(picked, Math.max(0, matches.length - 1));
    list.replaceChildren(...matches.map((a, i) => el('button', {
      class: 'btn quiet', style: `text-align:left;${i === picked ? 'border-color:var(--accent)' : ''}`,
      onclick: () => { close(); a.run(); } }, a.label)));
  };
  input.addEventListener('input', () => { picked = 0; paint(); });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown') { picked = Math.min(picked + 1, matches.length - 1); paint(); e.preventDefault(); }
    else if (e.key === 'ArrowUp') { picked = Math.max(picked - 1, 0); paint(); e.preventDefault(); }
    else if (e.key === 'Enter' && matches[picked]) { close(); matches[picked].run(); }
    else if (e.key === 'Escape') { close(); e.stopPropagation(); }
  });
  const box = el('div', { id: 'palette', style: 'position:fixed;inset:0;background:rgba(0,0,0,.45);display:flex;'
    + 'justify-content:center;align-items:flex-start;padding-top:60px;z-index:50', onclick: (e) => { if (e.target === box) close(); } },
    el('div', { class: 'card col', style: 'width:min(420px,90%);background:var(--bg);gap:8px' }, input, list));
  document.body.append(box);
  paint();
  input.focus();
}
document.addEventListener('keydown', (e) => {
  if (e.ctrlKey && e.key.toLowerCase() === 'k') { e.preventDefault(); openPalette(); }
}, true);

window.addEventListener('tierchange', () => { buildTabs(); updateHint(); });

applyTheme(currentThemeId());
buildTabs();
updateHint();
loadSaved().then(() => { buildTabs(); updateHint(); if (!document.body.classList.contains('collapsed')) show(active); });
tickPill();
setInterval(tickPill, 15000);
window.addEventListener('theme-changed', buildTabs);
