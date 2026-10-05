// The app shell: opening and closing the notch, the tab bar, the pill's live
// activities, the command palette, the Windows Hello lock, shortcuts and boot.
// Modules are plain ES modules loaded on demand; there is no build step.

import { applyTheme, currentThemeId, enforceTheme } from './themes.js';
import { icon } from './icons.js';
import { load, save, el, watch } from './store.js';
import { invoke, listen } from './native.js';
import { loadSaved, tierName, setTierOverride } from './license.js';
import { canUse } from './features.js';
import { MODULES, DEFAULT_ON, byId } from './modules.js';
import { pref, SIZES } from './prefs.js';
import { setRenderer, earsFor, refresh as refreshPill } from './activity.js';
import { toast } from './ui.js';

export { invoke };

export const appInfo = invoke('app_info').catch(() => ({ version: '1.24.0', selftest: false, autostarted: false }));

const body = document.body;
const tabbar = document.getElementById('tabbar');
const tools = document.getElementById('tools');
const page = document.getElementById('page');
const pill = document.getElementById('pill');

// ---------------------------------------------------------------- tabs

export const enabledIds = () => load('modules.enabled', DEFAULT_ON);
export const isEnabled = (id) => id === 'settings' || enabledIds().includes(id);
export function setEnabled(id, on) {
  buildTabs.overflowed = false;
  const list = new Set(enabledIds());
  if (on) list.add(id); else list.delete(id);
  save('modules.enabled', [...list]);
  buildTabs();
}

/// The user's tab order, with tabs added in later versions at the end.
export function tabOrder() {
  const saved = load('ui.tabOrder', []).filter((id) => byId(id));
  return [...saved, ...MODULES.map((m) => m.id).filter((id) => !saved.includes(id))];
}
export function setTabOrder(ids) { save('ui.tabOrder', ids); buildTabs(); }

export const allowed = (m) => !m.feature || canUse(m.feature);

let active = load('ui.lastTab', 'today');
let cleanup = null;
let expanded = false;
let pinned = false;
let busy = 0;          // > 0 while a file dialog or screenshot is open: don't close on blur
let openedByHover = false;

export const isExpanded = () => expanded;
export const activeTab = () => active;

export function buildTabs() {
  const order = tabOrder().map(byId).filter((m) => m && isEnabled(m.id));
  if (!order.some((m) => m.id === active)) active = order[0]?.id ?? 'settings';
  const mode = pref('ui.compactTabs');
  // "auto": names when they fit, icons only (except the active tab) when they don't.
  const compact = mode !== 'names';  // like the Mac: icons, with the name on the open tab

  tabbar.replaceChildren(...order.map((m, i) => {
    const locked = !allowed(m);
    const b = el('button', {
      class: `tab${m.id === active ? ' active' : ''}${compact && m.id !== active ? ' icon-only' : ''}${locked ? ' locked' : ''}`,
      title: `${m.name}${locked ? ' (Pro)' : ''}${i < 9 ? ` — Ctrl+${i + 1}` : ''}`,
      draggable: 'true', dataset: { id: m.id },
      onclick: () => show(m.id),
    }, el('span', { class: 'ico' }, icon(m.id, 22, m.icon)), el('span', { class: 'name' }, m.name));
    // Drag a tab to reorder.
    b.addEventListener('dragstart', (e) => { e.dataTransfer.setData('text/tab', m.id); b.classList.add('dragging'); });
    b.addEventListener('dragend', () => b.classList.remove('dragging'));
    b.addEventListener('dragover', (e) => { if (e.dataTransfer.types.includes('text/tab')) { e.preventDefault(); b.classList.add('drop-before'); } });
    b.addEventListener('dragleave', () => b.classList.remove('drop-before'));
    b.addEventListener('drop', (e) => {
      e.preventDefault(); b.classList.remove('drop-before');
      const moved = e.dataTransfer.getData('text/tab');
      if (!moved || moved === m.id) return;
      const ids = tabOrder().filter((x) => x !== moved);
      ids.splice(ids.indexOf(m.id), 0, moved);
      setTabOrder(ids);
    });
    return b;
  }));
  tabbar.querySelector('.tab.active')?.scrollIntoView({ block: 'nearest', inline: 'nearest' });

  tools.replaceChildren(
    el('button', { class: 'icon-btn', title: 'Command palette (Ctrl+K)', onclick: () => openPalette() }, icon('search', 20)),
    el('button', { class: `icon-btn ${pinned ? 'on' : ''}`, title: pinned ? 'Pinned open — click to unpin' : 'Keep open when I click elsewhere',
      onclick: () => { pinned = !pinned; buildTabs(); } }, icon('pin', 20)),
    el('button', { class: 'icon-btn', title: 'Hide the pill (Ctrl+Alt+O)', onclick: () => { collapse(); invoke('set_hidden', { hidden: true }); } }, icon('hide', 20)),
    el('button', { class: 'icon-btn', title: 'Quit Notch apple', onclick: () => invoke('quit_app') }, icon('power', 20)),
    el('button', { class: 'icon-btn', title: 'Close (Esc)', onclick: () => collapse() }, icon('up', 22)));
}

/// Shows a tab. `opts` are passed to the module (e.g. a search query).
export async function show(id, opts) {
  if (!byId(id)) id = 'today';
  if (!isEnabled(id) && id !== 'settings') setEnabled(id, true);
  active = id;
  save('ui.lastTab', id);
  buildTabs();
  if (typeof cleanup === 'function') { try { cleanup(); } catch (e) { console.error(e); } }
  cleanup = null;
  page.replaceChildren();
  page.classList.remove('fade'); void page.offsetWidth; page.classList.add('fade');

  const m = byId(id);
  if (!allowed(m)) {
    const { renderUpgrade } = await import('./modules/activation.js');
    if (active === id) page.append(renderUpgrade(m, () => show(id)));
    return;
  }
  try {
    const mod = await m.load();
    if (active !== id || !expanded) return; // switched away while it loaded
    const r = mod.render(page, opts || {});
    cleanup = typeof r === 'function' ? r : null;
  } catch (e) {
    console.error(e);
    reportError(`${m.name}: ${e?.message ?? e}`);
    page.replaceChildren(el('div', { class: 'empty' }, el('div', {},
      el('div', { class: 'glyph' }, '⚠️'), el('div', { class: 'what' }, `Couldn't open ${m.name}`),
      el('div', { class: 'how' }, String(e?.message ?? e)),
      el('button', { class: 'btn quiet', style: 'margin-top:8px', onclick: () => show(id) }, 'Try again'))));
  }
}

// ---------------------------------------------------------------- open / close

let unlockedAt = 0;

async function unlock() {
  if (!pref('lock.enabled')) return true;
  if (Date.now() - unlockedAt < pref('lock.grace') * 1000) return true;
  busy++;
  try {
    const ok = await invoke('hello_verify', { message: 'Unlock Notch apple' });
    if (ok) unlockedAt = Date.now();
    return ok;
  } catch (e) {
    toast(`Windows Hello: ${e.message}`, { error: true });
    return false;
  } finally { busy--; }
}

export async function expand(tab, opts) {
  if (expanded) { if (tab) show(tab, opts); return; }
  if (!(await unlock())) return;
  expanded = true;
  body.classList.remove('collapsed');
  playSound('open');
  try { await invoke('set_expanded', { expanded: true }); } catch (e) { console.error(e); }
  buildTabs.overflowed = false;
  show(tab || active, opts);
}

export async function collapse() {
  if (!expanded) return;
  expanded = false;
  openedByHover = false;
  document.querySelectorAll('.overlay, .menu').forEach((n) => n.remove());
  if (typeof cleanup === 'function') { try { cleanup(); } catch {} }
  cleanup = null;
  page.replaceChildren();
  body.classList.add('collapsed');
  try { await invoke('set_expanded', { expanded: false }); } catch {}
  refreshPill();
}

export const toggle = () => (expanded ? collapse() : expand());

/// Keeps the notch open while `work` runs (file dialogs, screenshots).
export async function keepOpen(work) {
  busy++;
  try { return await work(); } finally { setTimeout(() => { busy--; }, 400); }
}

// Clicking anywhere else closes it, like the Mac notch.
listen('notch-blur', () => {
  if (!expanded || pinned || busy > 0 || !pref('ui.closeOnBlur')) return;
  setTimeout(() => { if (!document.hasFocus() && expanded && !pinned && busy === 0) collapse(); }, 150);
});

// Hover to open (optional), and close again when the mouse leaves if it opened that way.
let hoverTimer;
pill.addEventListener('mouseenter', () => {
  if (!pref('ui.hoverOpen')) return;
  clearTimeout(hoverTimer);
  hoverTimer = setTimeout(() => { openedByHover = true; expand(); }, pref('ui.hoverDelay'));
});
pill.addEventListener('mouseleave', () => clearTimeout(hoverTimer));
document.documentElement.addEventListener('mouseleave', () => {
  if (!openedByHover || pinned) return;
  setTimeout(() => {
    const typing = document.activeElement?.matches?.('input, textarea, select');
    if (openedByHover && !typing && !document.querySelector('.overlay') && !document.documentElement.matches(':hover')) collapse();
  }, 450);
});
pill.addEventListener('click', () => {
  clearTimeout(hoverTimer);
  expand(topActivity?.tab);
});

// ---------------------------------------------------------------- keyboard

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && expanded && !document.querySelector('.overlay, .menu')) { collapse(); return; }
  if (!expanded) return;
  if (e.ctrlKey && !e.altKey && e.key.toLowerCase() === 'k') { e.preventDefault(); openPalette(); }
  else if (e.ctrlKey && !e.altKey && e.key === ',') { e.preventDefault(); show('settings'); }
  else if (e.ctrlKey && !e.altKey && /^[1-9]$/.test(e.key)) {
    const tabs = [...tabbar.querySelectorAll('.tab')];
    const t = tabs[Number(e.key) - 1];
    if (t) { e.preventDefault(); show(t.dataset.id); }
  }
});

// ---------------------------------------------------------------- native events

listen('toggle-notch', () => toggle());
listen('tray', (what) => {
  if (what === 'settings') expand('settings');
  if (what === 'updates') expand('settings', { pane: 'Updates' });
});
listen('shortcut', (action) => {
  if (action === 'palette') { expand().then(() => openPalette()); return; }
  if (action === 'ai:screen') { expand('ai', { screen: true }); return; }
  if (action === 'focus:toggle') { import('./services/focus.js').then((f) => f.toggle()); return; }
  if (action.startsWith('tab:')) { const id = action.slice(4); expanded ? show(id) : expand(id); }
});
listen('edge', () => { if (pref('ui.edgeTrigger') && canUse('edgeTrigger')) expand(); });
listen('second-instance', (args) => handleArgs(args));
// Dragging files onto the notch (even closed) opens the Shelf; dropping adds them.
listen('tauri://drag-enter', () => { if (!expanded) expand('shelf'); });
listen('tauri://drag-drop', async (e) => {
  if (active === 'ai' || active === 'shelf') return; // those tabs handle drops themselves
  const { addPaths } = await import('./modules/shelf.js');
  await addPaths(e?.paths || []);
  show('shelf');
});

/// Command-line control (Ultimate: Command-line and scripting):
///   "Notch apple.exe" --open clipboard | --toggle | --hide | --show
function handleArgs(args = []) {
  const i = args.indexOf('--open');
  if (!canUse('scripting')) return;
  if (i >= 0 && args[i + 1]) expand(args[i + 1]);
  else if (args.includes('--hide')) invoke('set_hidden', { hidden: true });
  else if (args.includes('--show')) invoke('set_hidden', { hidden: false });
}

// ---------------------------------------------------------------- the pill

let topActivity = null;
const earLeft = document.getElementById('ear-left');
const earRight = document.getElementById('ear-right');
const hint = document.getElementById('pill-hint');

setRenderer((list) => {
  topActivity = list[0] || null;
  const stacking = canUse('activityStacking') && list.length > 1;
  if (topActivity) {
    const { left, right } = earsFor(topActivity);
    earLeft.replaceChildren(...left);
    earRight.replaceChildren(right);
    if (stacking) {
      const second = earsFor(list[1]);
      hint.replaceChildren(...second.left, ' ', second.right);
      hint.style.color = 'var(--text-dim)';
    } else {
      hint.replaceChildren();
    }
    pill.title = topActivity.title || 'Open Notch apple (Ctrl+Alt+N)';
  } else {
    earLeft.replaceChildren();
    hint.style.color = '';
    hint.textContent = tierName() === 'Free' ? 'Notch apple' : `Notch apple ${tierName()}`;
    earRight.replaceChildren(pref('ui.showClock')
      ? el('span', { class: 'label num' }, new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }))
      : '');
    pill.title = 'Open Notch apple (Ctrl+Alt+N)';
  }
});
setInterval(refreshPill, 15000);

// ---------------------------------------------------------------- command palette

export async function openPalette(initial = '') {
  if (!canUse('commandPalette')) {
    toast('The command palette is part of Pro.');
    expand('settings', { pane: 'Access' });
    return;
  }
  if (document.getElementById('palette')) return;
  if (!expanded) await expand();
  const { paletteActions } = await import('./palette.js');
  const input = el('input', { class: 'field', placeholder: 'Type a tab, an action, or anything to ask, search or translate…', value: initial });
  const list = el('div', { class: 'col gap-4 scroll', style: 'max-height:280px' });
  let picked = 0, matches = [];
  const close = () => box.remove();
  const paint = async () => {
    matches = await paletteActions(input.value);
    picked = Math.min(picked, Math.max(0, matches.length - 1));
    list.replaceChildren(...matches.map((a, i) => el('div', {
      class: `item clickable ${i === picked ? 'selected' : ''}`,
      onmouseenter: () => { picked = i; [...list.children].forEach((c, j) => c.classList.toggle('selected', j === i)); },
      onclick: () => { close(); a.run(); },
    }, el('span', { style: 'width:20px;text-align:center' }, a.icon || '•'),
       el('div', { class: 'main ellipsis' }, a.label),
       a.hint ? el('span', { class: 'small faint' }, a.hint) : null)));
    if (!matches.length) list.append(el('div', { class: 'small dim', style: 'padding:8px' }, 'Nothing matches.'));
  };
  input.addEventListener('input', () => { picked = 0; paint(); });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown') { picked = Math.min(picked + 1, matches.length - 1); paint(); e.preventDefault(); }
    else if (e.key === 'ArrowUp') { picked = Math.max(picked - 1, 0); paint(); e.preventDefault(); }
    else if (e.key === 'Enter' && matches[picked]) { e.preventDefault(); close(); matches[picked].run(); }
    else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); }
  });
  const box = el('div', { id: 'palette', class: 'overlay', onmousedown: (e) => { if (e.target === box) close(); } },
    el('div', { class: 'dialog wide' }, input, list,
      el('div', { class: 'small faint' }, '↑↓ to choose · Enter to run · Esc to close')));
  body.append(box);
  paint();
  setTimeout(() => input.focus(), 20);
}

// ---------------------------------------------------------------- layout, sounds, look

export function applyLayout() {
  const sizeName = canUse('notchResize') ? pref('ui.size') : 'standard';
  const size = SIZES[sizeName] || SIZES.standard;
  invoke('set_layout', { layout: { position: pref('ui.position'), inset: pref('ui.inset'), ...size } }).catch(console.error);
  invoke('set_hide_in_fullscreen', { on: pref('ui.hideFullscreen') }).catch(() => {});
  invoke('set_edge_trigger', { on: pref('ui.edgeTrigger') && canUse('edgeTrigger') }).catch(() => {});
  body.dataset.anim = canUse('animationStyles') ? pref('ui.animation') : 'smooth';
  body.dataset.font = canUse('fontsAndIcons') ? pref('ui.font') : 'system';
}

let warnedShortcuts = false;
export async function registerShortcuts() {
  const gate = { palette: 'commandPalette', 'ai:screen': 'aiCapture', 'tab:quickadd': 'quickAdd', 'focus:toggle': 'focus' };
  const wanted = Object.fromEntries(Object.entries(pref('shortcuts')).filter(([action, keys]) => keys && (!gate[action] || canUse(gate[action]))));
  try {
    const failed = await invoke('register_shortcuts', { shortcuts: wanted });
    if (failed?.length && !warnedShortcuts) {
      warnedShortcuts = true;
      toast(`Another app already uses ${failed.join(', ')}. Pick other keys in Settings → Shortcuts.`, { error: true });
    }
    return failed || [];
  } catch (e) { console.error(e); return []; }
}

let audioCtx;
export function playSound(kind) {
  if (!pref('ui.sounds') || !canUse('customSounds')) return;
  try {
    audioCtx ??= new AudioContext();
    const notes = kind === 'done' ? [660, 880, 990] : kind === 'alert' ? [880, 660] : [520, 780];
    notes.forEach((f, i) => {
      const o = audioCtx.createOscillator(), g = audioCtx.createGain();
      o.frequency.value = f; o.type = 'sine';
      const t = audioCtx.currentTime + i * 0.09;
      g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.12, t + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.22);
      o.connect(g).connect(audioCtx.destination); o.start(t); o.stop(t + 0.25);
    });
  } catch {}
}

// ---------------------------------------------------------------- errors (for the self-test and support)

export const errors = [];
export function reportError(message) {
  errors.push({ at: Date.now(), message: String(message).slice(0, 500) });
  if (errors.length > 50) errors.shift();
}
window.addEventListener('error', (e) => reportError(e.message));
window.addEventListener('unhandledrejection', (e) => reportError(e.reason?.message ?? e.reason));

// ---------------------------------------------------------------- boot

function onTierChange() {
  enforceTheme(canUse('proThemes'));
  applyLayout();
  registerShortcuts();
  buildTabs();
  refreshPill();
  if (expanded) show(active);
}

applyTheme(currentThemeId());
applyLayout();
buildTabs();
refreshPill();

for (const key of ['ui.position', 'ui.inset', 'ui.size', 'ui.hideFullscreen', 'ui.animation', 'ui.font', 'ui.edgeTrigger']) watch(key, applyLayout);
watch('shortcuts', registerShortcuts);
watch('ui.showClock', refreshPill);
watch('ui.compactTabs', buildTabs);
window.addEventListener('tierchange', onTierChange);
window.addEventListener('theme-changed', () => buildTabs());

(async () => {
  const info = await appInfo;
  if (info.selftest) setTierOverride(2);
  await loadSaved();
  onTierChange();
  const { start } = await import('./services/index.js');
  await start();
  if (info.selftest) {
    const { run } = await import('./dev/selftest.js');
    run();
  } else if (!info.autostarted && !load('ui.welcomed', false)) {
    save('ui.welcomed', true);
    expand('today');
  }
})();
