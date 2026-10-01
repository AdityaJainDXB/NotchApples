// Search: find files and folders on this PC. The Rust side walks your user
// folders (Documents, Desktop, Downloads, Pictures…) and skips system paths.
import { el, fmtBytes } from '../store.js';
import { invoke } from '../app.js';

export function render(root) {
  let debounce, seq = 0;
  const field = el('input', { class: 'field', placeholder: 'Search files, folders and apps' });
  const list = el('div', { class: 'col', style: 'gap:2px;overflow:auto;flex:1;min-height:0' });
  const status = el('div', { class: 'small dim', style: 'min-height:15px' });
  let selected = 0, results = [];

  function paint() {
    list.replaceChildren(...results.map((r, i) => el('div', {
      class: 'btn quiet',
      style: `display:flex;gap:10px;align-items:center;text-align:left;cursor:pointer;`
           + (i === selected ? 'border-color:var(--accent);background:rgba(255,255,255,.12)' : ''),
      onclick: () => openItem(r),
      onmouseenter: () => { selected = i; paint(); },
    },
      el('span', { style: 'font-size:17px' }, r.is_dir ? '📁' : '📄'),
      el('div', { style: 'flex:1;min-width:0' },
        el('div', { style: 'overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-weight:600' }, r.name),
        el('div', { class: 'small dim', style: 'overflow:hidden;text-overflow:ellipsis;white-space:nowrap;direction:rtl' },
          r.parent)),
      el('div', { class: 'small dim mono' }, r.is_dir ? '' : fmtBytes(r.size)))));
    if (!results.length && field.value.trim()) list.append(el('div', { class: 'small dim', style: 'padding:8px' }, 'No matches.'));
  }

  async function openItem(r) {
    status.textContent = `Opening ${r.name}…`;
    try { await invoke('open_path', { path: r.path }); status.textContent = ''; }
    catch (e) { status.replaceChildren(el('span', { class: 'err' }, String(e?.message ?? e))); }
  }

  async function run() {
    const q = field.value.trim();
    if (!q) { results = []; paint(); status.textContent = ''; return; }
    const mine = ++seq;
    status.textContent = 'Searching…';
    try {
      const found = await invoke('search_files', { query: q, limit: 30 }) || [];
      if (mine !== seq) return;
      results = found; selected = 0; paint();
      status.textContent = found.length ? `${found.length} result${found.length === 1 ? '' : 's'}` : '';
    } catch (e) {
      if (mine !== seq) return;
      status.replaceChildren(el('span', { class: 'err' }, String(e?.message ?? e)));
    }
  }

  field.addEventListener('input', () => { clearTimeout(debounce); debounce = setTimeout(run, 250); });
  field.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown') { selected = Math.min(selected + 1, results.length - 1); paint(); e.preventDefault(); }
    else if (e.key === 'ArrowUp') { selected = Math.max(selected - 1, 0); paint(); e.preventDefault(); }
    else if (e.key === 'Enter' && results[selected]) openItem(results[selected]);
  });

  root.append(el('div', { class: 'col', style: 'height:100%' }, field, list, status));
  setTimeout(() => field.focus(), 40);
}
