// Shelf: drop files here to keep them handy, then open them or show them in Explorer.
import { el, load, save } from '../store.js';
import { invoke } from '../app.js';

const KEY = 'shelf.items';

export function render(root) {
  let items = load(KEY, []);
  const grid = el('div', { class: 'grid', style: 'grid-template-columns:repeat(auto-fill,minmax(96px,1fr))' });
  const status = el('div', { class: 'small dim', style: 'min-height:15px' });

  function paint() {
    grid.replaceChildren(...items.map((item) => {
      const tile = el('div', { class: 'tile', title: item.path,
        onclick: () => invoke('open_path', { path: item.path }).catch(() => {
          status.replaceChildren(el('span', { class: 'err' }, `Couldn't open ${item.name} — it may have moved.`));
        }) },
        el('div', { style: 'font-size:28px' }, item.is_dir ? '📁' : '📄'),
        el('div', { class: 'name' }, item.name));
      tile.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        items = items.filter((x) => x.path !== item.path);
        save(KEY, items); paint();
      });
      return tile;
    }));
    if (!items.length) grid.replaceChildren(el('div', { class: 'center dim small', style: 'grid-column:1/-1;padding:28px' },
      'Drop files or folders here to keep them handy.'));
  }

  const zone = el('div', {
    style: 'flex:1;border:1.5px dashed var(--border);border-radius:var(--radius);padding:12px;overflow:auto',
  }, grid);

  zone.addEventListener('dragover', (e) => { e.preventDefault(); zone.style.borderColor = 'var(--accent)'; });
  zone.addEventListener('dragleave', () => { zone.style.borderColor = 'var(--border)'; });

  // Tauri delivers real file drops as an event with the dropped paths.
  const tauri = window.__TAURI__;
  let unlisten;
  if (tauri) {
    tauri.event.listen('tauri://drag-drop', async (e) => {
      zone.style.borderColor = 'var(--border)';
      for (const path of e.payload?.paths || []) {
        if (items.some((i) => i.path === path)) continue;
        const info = await invoke('path_info', { path }).catch(() => null);
        items.push(info || { path, name: path.split(/[\\/]/).pop(), is_dir: false });
      }
      save(KEY, items); paint();
    }).then((fn) => { unlisten = fn; });
  }

  paint();
  root.append(el('div', { class: 'col', style: 'height:100%' },
    el('div', { style: 'display:flex;gap:8px;align-items:center' },
      el('div', { class: 'section-title' }, 'File shelf'),
      el('div', { class: 'small dim' }, 'Click to open · right-click to remove'),
      el('div', { style: 'flex:1' }),
      el('button', { class: 'btn quiet', onclick: () => { items = []; save(KEY, items); paint(); } }, 'Clear')),
    zone, status));

  return () => { if (unlisten) unlisten(); };
}
