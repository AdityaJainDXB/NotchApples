// Launcher: a shelf of apps you choose, opened straight from the notch.
import { el, load, save } from '../store.js';
import { invoke } from '../app.js';

const KEY = 'launcher.apps';

export function render(root) {
  let apps = load(KEY, []);
  const grid = el('div', { class: 'grid', style: 'grid-template-columns:repeat(auto-fill,minmax(88px,1fr))' });
  const status = el('div', { class: 'small dim', style: 'min-height:15px' });

  function paint() {
    grid.replaceChildren(...apps.map((a) => {
      const tile = el('div', { class: 'tile', title: a.path, onclick: () => launch(a) },
        a.icon ? el('img', { src: `data:image/png;base64,${a.icon}`, alt: '' })
               : el('div', { style: 'font-size:30px' }, '📦'),
        el('div', { class: 'name' }, a.name));
      tile.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        apps = apps.filter((x) => x.path !== a.path);
        save(KEY, apps); paint();
      });
      return tile;
    }));
    if (!apps.length) {
      grid.replaceChildren(el('div', { class: 'center dim small', style: 'grid-column:1/-1;padding:28px' },
        'No apps yet — click “Add apps” to pick from everything installed.'));
    }
  }

  async function launch(a) {
    status.textContent = `Opening ${a.name}…`;
    try { await invoke('launch_app', { path: a.path }); status.textContent = ''; }
    catch (e) { status.replaceChildren(el('span', { class: 'err' }, `Couldn't open ${a.name}.`)); }
  }

  async function openPicker() {
    status.textContent = 'Reading installed apps…';
    let installed = [];
    try { installed = await invoke('installed_apps') || []; }
    catch (e) { status.replaceChildren(el('span', { class: 'err' }, String(e?.message ?? e))); return; }
    status.textContent = '';

    const chosen = new Set();
    const search = el('input', { class: 'field', placeholder: 'Search apps' });
    const list = el('div', { class: 'col', style: 'gap:2px;overflow:auto;flex:1;min-height:0' });

    const paintList = () => {
      const q = search.value.trim().toLowerCase();
      const have = new Set(apps.map((a) => a.path));
      const shown = installed.filter((a) => !have.has(a.path) && (!q || a.name.toLowerCase().includes(q)));
      list.replaceChildren(...shown.slice(0, 400).map((a) => el('button', {
        class: 'btn quiet', style: 'text-align:left;display:flex;gap:8px;align-items:center',
        onclick: (e) => {
          chosen.has(a.path) ? chosen.delete(a.path) : chosen.add(a.path);
          e.currentTarget.style.borderColor = chosen.has(a.path) ? 'var(--accent)' : '';
          count.textContent = chosen.size ? `${chosen.size} selected` : 'Tick the apps to add';
        },
      },
        a.icon ? el('img', { src: `data:image/png;base64,${a.icon}`, style: 'width:20px;height:20px' })
               : el('span', {}, '📦'),
        el('span', { style: 'overflow:hidden;text-overflow:ellipsis;white-space:nowrap' }, a.name))));
      if (!shown.length) list.append(el('div', { class: 'small dim', style: 'padding:8px' }, 'Nothing matches.'));
    };

    const count = el('div', { class: 'small dim' }, 'Tick the apps to add');
    search.addEventListener('input', paintList);
    paintList();

    const overlay = el('div', {
      style: 'position:fixed;inset:0;background:rgba(0,0,0,.55);display:flex;align-items:center;'
           + 'justify-content:center;z-index:50',
      onclick: (e) => { if (e.target === overlay) overlay.remove(); },
    }, el('div', {
      class: 'card col',
      style: 'width:380px;height:70vh;background:var(--bg);border-color:var(--accent)',
    },
      el('div', { class: 'section-title' }, `Add apps (${installed.length} installed)`),
      search, list,
      el('div', { style: 'display:flex;gap:8px;align-items:center' }, count,
        el('div', { style: 'flex:1' }),
        el('button', { class: 'btn quiet', onclick: () => overlay.remove() }, 'Cancel'),
        el('button', { class: 'btn', onclick: () => {
          for (const a of installed) if (chosen.has(a.path) && !apps.some((x) => x.path === a.path)) apps.push(a);
          save(KEY, apps); paint(); overlay.remove();
        } }, 'Add'))));
    document.body.append(overlay);
    setTimeout(() => search.focus(), 30);
  }

  async function pickFile() {
    try {
      const picked = await invoke('pick_app');
      if (picked) { apps.push(picked); save(KEY, apps); paint(); }
    } catch (e) { status.replaceChildren(el('span', { class: 'err' }, String(e?.message ?? e))); }
  }

  paint();
  root.append(el('div', { class: 'col', style: 'height:100%' },
    el('div', { style: 'display:flex;gap:8px;align-items:center' },
      el('div', { class: 'section-title' }, 'App launcher'),
      el('div', { class: 'small dim' }, 'Click to open · right-click a tile to remove'),
      el('div', { style: 'flex:1' }),
      el('button', { class: 'btn quiet', onclick: pickFile }, 'Other…'),
      el('button', { class: 'btn', onclick: openPicker }, '+ Add apps')),
    el('div', { style: 'flex:1;overflow:auto' }, grid),
    status));
}
