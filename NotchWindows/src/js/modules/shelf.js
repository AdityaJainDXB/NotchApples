// Shelf: drop files and folders onto the notch to keep them handy. Click to open,
// right-click for more. Shelf+ (Pro): group into folders.
import { el, load, save, uid } from '../store.js';
import { invoke, listen, openUrl } from '../native.js';
import { canUse } from '../features.js';
import { menu, toast, prompt, empty, segmented } from '../ui.js';
import { normalize, label } from '../services/linkshelf.js';
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
  const files = (el('div', { class: 'col fill' }, el('div', { class: 'hstack' }, el('div', { class: 'section-title grow' }, 'Shelf'), groupsBar,
    el('button', { class: 'btn small quiet', onclick: async () => { const p = await invoke('pick_file'); if (p) { await addPaths([p], group); paint(); } } }, '+ Add file'),
    el('button', { class: 'btn small ghost', onclick: () => { save(KEY, []); paint(); } }, 'Clear')), zone));

  // Links: save a link now, read it later. Nothing is fetched; a saved link shows its address.
  const LKEY = 'shelf.links';
  const linkIn = el('input', { class: 'field', placeholder: 'Paste a link to read later', style: 'flex:1' });
  const linkMsg = el('div', { class: 'tiny', style: 'color:var(--warn,#ffb547);min-height:14px' });
  const linkList = el('div', { class: 'col gap-4 scroll', style: 'flex:1;min-height:0' });
  function saveLink(text) {
    const url = normalize(text);
    if (!url) return linkMsg.textContent = 'That doesn’t look like a web address.';
    const all = load(LKEY, []);
    if (all.some((l) => l.url === url)) return linkMsg.textContent = 'Already saved.';
    save(LKEY, [{ id: uid(), url, added: Date.now(), read: false }, ...all]);
    linkMsg.textContent = ''; linkIn.value = ''; paintLinks();
  }
  const patchLink = (id, change) => { save(LKEY, load(LKEY, []).map((l) => (l.id === id ? { ...l, ...change } : l))); paintLinks(); };
  function paintLinks() {
    const all = load(LKEY, []), ordered = [...all.filter((l) => !l.read), ...all.filter((l) => l.read)];
    linkList.replaceChildren(...(ordered.length ? ordered.map((l) => el('div', { class: 'item hstack', style: 'padding:5px 10px;gap:8px' },
      el('span', {}, l.read ? '✅' : '🔗'), el('div', { class: 'grow', style: 'min-width:0' },
        el('div', { class: 'ellipsis', style: `font-weight:600;${l.read ? 'opacity:.5' : ''}` }, label(l.url)), el('div', { class: 'tiny faint' }, `Saved ${new Date(l.added).toLocaleDateString()}`)),
      el('button', { class: 'btn small quiet', onclick: async () => { await openUrl(l.url).catch(() => toast('Couldn’t open that link.', { error: true })); patchLink(l.id, { read: true }); } }, 'Open'),
      el('button', { class: 'icon-btn', style: 'width:24px;height:24px', title: l.read ? 'Mark unread' : 'Mark read', onclick: () => patchLink(l.id, { read: !l.read }) }, l.read ? '↩' : '✓'),
      el('button', { class: 'icon-btn', style: 'width:24px;height:24px', title: 'Remove', onclick: () => { save(LKEY, load(LKEY, []).filter((x) => x.id !== l.id)); paintLinks(); } }, '🗑')))
      : [el('div', { class: 'small dim' }, 'Nothing saved. Paste a link above and read it when you have time.')]));
  }
  linkIn.addEventListener('keydown', (e) => { if (e.key === 'Enter') saveLink(linkIn.value); });
  const linksView = el('div', { class: 'col fill', style: 'gap:8px' },
    el('div', { class: 'hstack' }, linkIn, el('button', { class: 'btn', onclick: () => saveLink(linkIn.value) }, 'Save'),
      el('button', { class: 'btn quiet', onclick: async () => { const t = await navigator.clipboard.readText().catch(() => ''); saveLink(t); } }, 'From clipboard'),
      el('button', { class: 'btn quiet', onclick: () => { save(LKEY, load(LKEY, []).filter((l) => !l.read)); paintLinks(); } }, 'Clear read')), linkMsg, linkList);

  let page = load('shelf.page', 'files');
  const body = el('div', { class: 'col fill' });
  const seg = segmented([{ value: 'files', label: 'Files' }, { value: 'links', label: 'Links' }], page, (v) => { page = v; save('shelf.page', v); showPage(); });
  seg.style.alignSelf = 'flex-start';
  function showPage() { body.replaceChildren(page === 'links' ? linksView : files); if (page === 'links') paintLinks(); else paint(); }
  root.append(el('div', { class: 'col fill', style: 'gap:8px' }, seg, body));
  showPage();
  return () => un?.();
}
