// Shelf: drop files and folders onto the notch to keep them handy. Click to open,
// right-click for more. Shelf+ (Pro): group into folders.
import { el, load, save, uid } from '../store.js';
import { invoke, listen } from '../native.js';
import { canUse } from '../features.js';
import { menu, toast, prompt, empty, segmented } from '../ui.js';
import { withIcons, iconEl } from './launcher.js';

const KEY = 'shelf.items';
export async function addPaths(paths, group = load('shelf.group', 'All')) {
  const items = load(KEY, []);
  for (const path of paths) {
    if (items.some((i) => i.path === path)) continue;
    const info = await invoke('path_info', { path }).catch(() => ({ path, name: path.split(/[\\/]/).pop(), is_dir: false }));
    items.push({ ...info, id: uid(), group: group === 'All' ? '' : group, at: Date.now() });
  }
  save(KEY, items);
}
export function render(root) {
  let group = load('shelf.group', 'All');
  const grid = el('div', { class: 'grid', style: 'grid-template-columns:repeat(auto-fill,minmax(92px,1fr))' });
  const groupsBar = el('div');
  const zone = el('div', { class: 'scroll', style: 'flex:1;border:1.5px dashed var(--border);border-radius:var(--radius);padding:12px' }, grid);
  async function paint() {
    const all = load(KEY, []);
    const groups = ['All', ...new Set(all.map((i) => i.group).filter(Boolean))];
    groupsBar.replaceChildren(canUse('shelfPlus') && groups.length > 1 ? segmented(groups.map((g) => ({ value: g, label: g })), group, (g) => { group = g; save('shelf.group', g); paint(); }) : el('span'));
    const items = await withIcons(all.filter((i) => group === 'All' || i.group === group));
    grid.replaceChildren(...items.map((i) => {
      const t = el('div', { class: 'tile', title: i.path, onclick: () => invoke('open_path', { path: i.path }).catch(() => toast(`${i.name} has moved or been deleted.`, { error: true })) },
        i.icon ? iconEl(i) : el('div', { class: 'glyph' }, i.is_dir ? '📁' : '📄'), el('div', { class: 'name' }, i.name));
      t.addEventListener('contextmenu', (e) => menu(e, [
        { label: 'Open', run: () => invoke('open_path', { path: i.path }) },
        { label: 'Show in Explorer', run: () => invoke('reveal_path', { path: i.path }) },
        { label: 'Copy path', run: () => invoke('clipboard_copy_text', { text: i.path }).then(() => toast('Copied')) },
        canUse('shelfPlus') ? { label: 'Move to folder…', run: async () => { const g = await prompt('Folder name', { value: i.group || '' }); if (g !== null) { save(KEY, load(KEY, []).map((x) => (x.id === i.id ? { ...x, group: g } : x))); paint(); } } } : null,
        { label: 'Remove from Shelf', danger: true, run: () => { save(KEY, load(KEY, []).filter((x) => x.id !== i.id)); paint(); } },
      ]));
      return t;
    }));
    if (!items.length) grid.replaceChildren(el('div', { style: 'grid-column:1/-1' }, empty('🗂', 'Drop files here', 'Drag files or folders onto the notch (even when it’s closed) to keep them handy.')));
  }
  let un;
  listen('tauri://drag-drop', async (e) => { await addPaths(e?.paths || [], group); paint(); }).then((u) => { un = u; });
  root.append(el('div', { class: 'col fill' }, el('div', { class: 'hstack' }, el('div', { class: 'section-title grow' }, 'Shelf'), groupsBar,
    el('button', { class: 'btn small quiet', onclick: async () => { const p = await invoke('pick_file'); if (p) { await addPaths([p], group); paint(); } } }, '+ Add file'),
    el('button', { class: 'btn small ghost', onclick: () => { save(KEY, []); paint(); } }, 'Clear')), zone));
  paint();
  return () => un?.();
}
