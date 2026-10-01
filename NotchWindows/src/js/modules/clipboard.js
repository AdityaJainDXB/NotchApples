// Clipboard history: everything you copy while the app runs, click to copy again.
import { el, load, save } from '../store.js';
import { invoke } from '../app.js';

const KEY = 'clipboard.items';
const LIMIT = 200;

export function render(root) {
  let items = load(KEY, []);
  let filter = '';
  const list = el('div', { class: 'col', style: 'gap:3px;overflow:auto;flex:1;min-height:0' });
  const search = el('input', { class: 'field', placeholder: 'Search clipboard history' });
  const status = el('div', { class: 'small dim', style: 'min-height:15px' });

  function paint() {
    const shown = filter ? items.filter((i) => i.text.toLowerCase().includes(filter)) : items;
    list.replaceChildren(...shown.map((item) => el('div', {
      class: 'btn quiet',
      style: 'display:flex;gap:10px;align-items:center;text-align:left;cursor:pointer',
      onclick: async () => {
        await invoke('write_clipboard', { text: item.text });
        status.textContent = 'Copied.';
        setTimeout(() => { status.textContent = ''; }, 1200);
      },
    },
      el('div', { style: 'flex:1;min-width:0' },
        el('div', { style: 'overflow:hidden;text-overflow:ellipsis;white-space:nowrap' }, item.text.slice(0, 120)),
        el('div', { class: 'small dim' }, new Date(item.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }))),
      el('button', {
        class: 'sys-btn', title: 'Delete',
        onclick: (e) => { e.stopPropagation(); items = items.filter((x) => x.at !== item.at); save(KEY, items); paint(); },
      }, '×'))));
    if (!shown.length) list.append(el('div', { class: 'center dim small', style: 'padding:24px' },
      items.length ? 'Nothing matches.' : 'Copy anything and it appears here.'));
  }

  search.addEventListener('input', () => { filter = search.value.trim().toLowerCase(); paint(); });

  // Poll the clipboard from the Rust side. The webview refuses to read it unless
  // it has focus, which is never true while you are copying in another app.
  let lastSeen = items[0]?.text ?? '';
  async function poll() {
    try {
      const text = await invoke('read_clipboard');
      if (text && text !== lastSeen) {
        lastSeen = text;
        items = [{ text, at: Date.now() }, ...items.filter((i) => i.text !== text)].slice(0, LIMIT);
        save(KEY, items); paint();
      }
    } catch { /* clipboard unavailable */ }
  }

  paint();
  poll();
  const timer = setInterval(poll, 1500);

  root.append(el('div', { class: 'col', style: 'height:100%' },
    el('div', { style: 'display:flex;gap:8px' }, search,
      el('button', { class: 'btn quiet', onclick: () => { items = []; save(KEY, items); paint(); } }, 'Clear')),
    list, status));

  return () => clearInterval(timer);
}
