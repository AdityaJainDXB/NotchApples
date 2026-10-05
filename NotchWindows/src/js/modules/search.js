// Search: files, folders and apps, instantly, from a background index of your
// folders (Desktop, Documents, Downloads, Pictures, Music, Videos, OneDrive and
// any you add in Settings → Search). Enter opens, Ctrl+Enter shows in Explorer.

import { el, fmtBytes, timeAgo } from '../store.js';
import { invoke } from '../native.js';
import { collapse } from '../app.js';
import { menu, toast } from '../ui.js';
import { withIcons, iconEl } from './launcher.js';

const KIND_ICON = { folder: '📁', app: '🚀' };
const EXT_ICON = [[/\.(png|jpe?g|gif|webp|heic|bmp|svg)$/i, '🖼'], [/\.(mp4|mov|mkv|avi|webm)$/i, '🎞'], [/\.(mp3|wav|flac|m4a|aac|ogg)$/i, '🎵'],
  [/\.pdf$/i, '📕'], [/\.(docx?|odt|rtf)$/i, '📘'], [/\.(xlsx?|csv|ods)$/i, '📗'], [/\.(pptx?|odp)$/i, '📙'], [/\.(zip|rar|7z|tar|gz)$/i, '🗜'],
  [/\.(exe|msi|lnk)$/i, '⚙️'], [/\.(js|ts|py|rs|java|cs|cpp|c|go|html|css|json)$/i, '💻'], [/\.(txt|md|log)$/i, '📄']];
const iconFor = (r) => KIND_ICON[r.kind] || EXT_ICON.find(([re]) => re.test(r.name))?.[1] || '📄';

export function render(root, opts = {}) {
  let seq = 0, debounce, selected = 0, results = [];
  const field = el('input', { class: 'field', placeholder: 'Search files, folders and apps', value: opts.query || '' });
  const list = el('div', { class: 'col gap-4 scroll', style: 'flex:1' });
  const status = el('div', { class: 'tiny faint', style: 'min-height:14px' });

  async function open(r, reveal = false) {
    try {
      if (reveal && r.kind !== 'app') await invoke('reveal_path', { path: r.path });
      else if (r.kind === 'app') await invoke('launch_app', { path: r.path });
      else await invoke('open_path', { path: r.path });
      collapse();
    } catch (e) { toast(e.message, { error: true }); }
  }

  function paint() {
    list.replaceChildren(...results.map((r, i) => {
      const row = el('div', { class: `item clickable ${i === selected ? 'selected' : ''}`, onclick: () => open(r), onmouseenter: () => { selected = i; [...list.children].forEach((c, j) => c.classList.toggle('selected', j === i)); } },
        r.icon ? iconEl(r, 22) : el('span', { style: 'font-size:17px;width:22px;text-align:center' }, iconFor(r)),
        el('div', { class: 'main' },
          el('div', { class: 'ellipsis', style: 'font-weight:600' }, r.name),
          el('div', { class: 'tiny faint ellipsis', style: 'direction:rtl;text-align:left' }, r.kind === 'app' ? 'App' : r.parent)),
        el('span', { class: 'tiny faint num' }, r.kind === 'file' ? fmtBytes(r.size) : ''),
        el('span', { class: 'tiny faint', style: 'width:64px;text-align:right' }, r.modified ? timeAgo(r.modified * 1000) : ''));
      row.addEventListener('contextmenu', (e) => menu(e, [
        { label: 'Open', run: () => open(r) },
        r.kind !== 'app' ? { label: 'Show in Explorer', run: () => open(r, true) } : null,
        { label: 'Copy path', run: () => invoke('clipboard_copy_text', { text: r.path }).then(() => toast('Path copied')) },
        r.kind !== 'app' ? { label: 'Add to Shelf', run: async () => { (await import('./shelf.js')).addPaths([r.path]); toast('Added to Shelf'); } } : null,
      ]));
      return row;
    }));
    if (!results.length && field.value.trim()) list.append(el('div', { class: 'small dim', style: 'padding:8px' }, 'No matches.'));
    if (!field.value.trim()) list.append(el('div', { class: 'empty' }, el('div', {}, el('div', { class: 'glyph' }, '🔍'),
      el('div', { class: 'what' }, 'Find anything on this PC'), el('div', { class: 'how' }, 'Files, folders and apps. Enter opens · Ctrl+Enter shows in Explorer · ↑↓ to choose'))));
  }

  async function run() {
    const q = field.value.trim();
    if (!q) { results = []; paint(); status.textContent = ''; return; }
    const mine = ++seq;
    try {
      const found = await invoke('search_files', { query: q, limit: 40 }) || [];
      if (mine !== seq) return;
      results = found; selected = 0; paint();
      const [ready, count] = await invoke('search_status').catch(() => [true, 0]);
      status.textContent = ready ? `${found.length} result${found.length === 1 ? '' : 's'} · ${count.toLocaleString()} items indexed` : 'Still indexing your folders — results will fill in…';
      // App icons for the app results.
      const apps = results.filter((r) => r.kind === 'app');
      if (apps.length) { const withI = await withIcons(apps); if (mine === seq) { withI.forEach((a) => { const r = results.find((x) => x.path === a.path); if (r) r.icon = a.icon; }); paint(); } }
    } catch (e) { if (mine === seq) status.replaceChildren(el('span', { class: 'err' }, e.message)); }
  }

  field.addEventListener('input', () => { clearTimeout(debounce); debounce = setTimeout(run, 120); });
  field.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown') { selected = Math.min(selected + 1, results.length - 1); paint(); e.preventDefault(); list.children[selected]?.scrollIntoView({ block: 'nearest' }); }
    else if (e.key === 'ArrowUp') { selected = Math.max(selected - 1, 0); paint(); e.preventDefault(); list.children[selected]?.scrollIntoView({ block: 'nearest' }); }
    else if (e.key === 'Enter' && results[selected]) open(results[selected], e.ctrlKey);
  });

  root.append(el('div', { class: 'col fill' }, field, list, status));
  paint();
  if (opts.query) run();
  setTimeout(() => field.focus(), 40);
}
