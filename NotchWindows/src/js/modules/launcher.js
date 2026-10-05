// Launcher (Pro): a grid of the apps you use most, with their real icons.
// Add from everything installed (Start menu and Store apps), drag to reorder,
// right-click to remove.

import { el, load, save } from '../store.js';
import { invoke } from '../native.js';
import { keepOpen, collapse } from '../app.js';
import { modal, button, menu, toast, empty } from '../ui.js';

const KEY = 'launcher.apps';
const iconCache = new Map();

/// Fills in icons for apps that don't have one yet (fetched in one batch).
export async function withIcons(apps) {
  const missing = apps.filter((a) => !a.icon && !iconCache.has(a.path)).map((a) => a.path);
  if (missing.length) {
    const got = await invoke('icons', { paths: missing }).catch(() => ({}));
    for (const p of missing) iconCache.set(p, got[p] || null);
  }
  return apps.map((a) => ({ ...a, icon: a.icon || iconCache.get(a.path) || null }));
}

export const iconEl = (a, size = 36) => (a.icon
  ? el('img', { src: `data:image/png;base64,${a.icon}`, alt: '', style: `width:${size}px;height:${size}px;object-fit:contain` })
  : el('div', { class: 'glyph', style: `font-size:${Math.round(size * 0.7)}px;line-height:${size}px;height:${size}px` }, '📦'));

export function render(root) {
  let apps = load(KEY, []);
  const grid = el('div', { class: 'grid', style: 'grid-template-columns:repeat(auto-fill,minmax(86px,1fr))' });

  async function launch(a) {
    try { await invoke('launch_app', { path: a.path }); if (load('launcher.closeAfter', true)) collapse(); }
    catch (e) { toast(`Couldn't open ${a.name}: ${e.message}`, { error: true }); }
  }

  function paint() {
    if (!apps.length) {
      grid.replaceChildren(el('div', { style: 'grid-column:1/-1' }, empty('🚀', 'Your apps, one click away', 'Add the apps you use most. They open straight from the notch.',
        button('+ Add apps', openPicker))));
      return;
    }
    grid.replaceChildren(...apps.map((a, i) => {
      const tile = el('div', { class: 'tile', title: a.name, draggable: 'true', onclick: () => launch(a) }, iconEl(a), el('div', { class: 'name' }, a.name));
      tile.addEventListener('contextmenu', (e) => menu(e, [
        { label: `Open ${a.name}`, run: () => launch(a) },
        a.path.startsWith('shell:') ? null : { label: 'Show in Explorer', run: () => invoke('reveal_path', { path: a.path }) },
        { label: 'Remove from Launcher', danger: true, run: () => { apps.splice(i, 1); save(KEY, apps); paint(); } },
      ]));
      tile.addEventListener('dragstart', (e) => e.dataTransfer.setData('text/app', String(i)));
      tile.addEventListener('dragover', (e) => e.preventDefault());
      tile.addEventListener('drop', (e) => {
        e.preventDefault();
        const from = Number(e.dataTransfer.getData('text/app'));
        if (Number.isNaN(from) || from === i) return;
        const [moved] = apps.splice(from, 1);
        apps.splice(i, 0, moved);
        save(KEY, apps); paint();
      });
      return tile;
    }));
  }

  async function openPicker() {
    const list = el('div', { class: 'col gap-4 scroll', style: 'flex:1;min-height:0' }, el('div', { class: 'small dim' }, 'Reading installed apps…'));
    const search = el('input', { class: 'field', placeholder: 'Search apps' });
    const count = el('span', { class: 'small dim grow' }, 'Tick the apps to add');
    const chosen = new Set();
    let installed = [];
    const m = modal(null, [el('div', { class: 'title' }, 'Add apps'), search, el('div', { style: 'height:46vh;display:flex;flex-direction:column' }, list)], {
      actions: [count, button('Cancel', () => m.close(), { kind: 'quiet' }), button('Add', async () => {
        const add = installed.filter((a) => chosen.has(a.path) && !apps.some((x) => x.path === a.path));
        apps = await withIcons([...apps, ...add]);
        save(KEY, apps); paint(); m.close();
      })] });
    try { installed = await invoke('installed_apps'); } catch (e) { list.replaceChildren(el('div', { class: 'err' }, e.message)); return; }
    const paintList = async () => {
      const q = search.value.trim().toLowerCase();
      const have = new Set(apps.map((a) => a.path));
      const shown = installed.filter((a) => !have.has(a.path) && (!q || a.name.toLowerCase().includes(q))).slice(0, 300);
      const withI = await withIcons(shown.slice(0, 60));
      list.replaceChildren(...shown.map((a, i) => el('label', { class: 'item clickable' },
        el('input', { type: 'checkbox', checked: chosen.has(a.path), onchange: (e) => { e.target.checked ? chosen.add(a.path) : chosen.delete(a.path); count.textContent = chosen.size ? `${chosen.size} selected` : 'Tick the apps to add'; } }),
        iconEl(withI[i] || a, 22), el('span', { class: 'ellipsis' }, a.name))));
      if (!shown.length) list.append(el('div', { class: 'small dim' }, 'Nothing matches.'));
    };
    search.addEventListener('input', paintList);
    paintList();
  }

  async function pickFile() {
    const picked = await keepOpen(() => invoke('pick_app')).catch((e) => { toast(e.message, { error: true }); return null; });
    if (picked) { apps = await withIcons([...apps, picked]); save(KEY, apps); paint(); }
  }

  root.append(el('div', { class: 'col fill' },
    el('div', { class: 'hstack' }, el('div', { class: 'section-title grow' }, 'Launcher'),
      el('span', { class: 'tiny faint' }, 'Drag to reorder · right-click for more'),
      button('Other app…', pickFile, { kind: 'quiet', small: true }), button('+ Add apps', openPicker, { small: true })),
    el('div', { class: 'scroll', style: 'flex:1' }, grid)));
  paint();
  // Older saved apps may have no icon yet.
  withIcons(apps).then((a) => { if (a.some((x, i) => x.icon && !apps[i]?.icon)) { apps = a; save(KEY, apps); paint(); } });
}
