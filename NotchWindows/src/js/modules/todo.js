// To-do: a simple checklist saved on this PC. Done items sink to the bottom.
import { el, load, save } from '../store.js';

const KEY = 'todo.items';

export function render(root) {
  let items = load(KEY, []);
  const list = el('div', { class: 'col', style: 'overflow:auto;flex:1;min-height:0;gap:4px' });
  const input = el('input', { class: 'field', placeholder: 'Add a to-do and press Enter' });
  const persist = () => save(KEY, items);

  function paint() {
    const sorted = [...items.filter((i) => !i.done), ...items.filter((i) => i.done)];
    list.replaceChildren(...sorted.map((item) => el('div', { class: 'card', style: 'display:flex;gap:10px;align-items:center;padding:7px 12px' },
      el('input', { type: 'checkbox', checked: item.done, style: 'cursor:pointer',
        onchange: () => { item.done = !item.done; persist(); paint(); } }),
      el('div', { style: `flex:1;${item.done ? 'text-decoration:line-through;opacity:.5' : ''}` }, item.text),
      el('button', { class: 'btn quiet', title: 'Delete', onclick: () => { items = items.filter((i) => i !== item); persist(); paint(); } }, '✕'))));
    if (!items.length) list.append(el('div', { class: 'small dim', style: 'padding:6px' }, 'Nothing to do. Nice.'));
  }

  input.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' || !input.value.trim()) return;
    items.unshift({ id: crypto.randomUUID(), text: input.value.trim().slice(0, 300), done: false });
    input.value = ''; persist(); paint();
  });
  const clearDone = el('button', { class: 'btn quiet', onclick: () => { items = items.filter((i) => !i.done); persist(); paint(); } }, 'Clear done');

  paint();
  setTimeout(() => input.focus(), 30);
  root.append(el('div', { class: 'col', style: 'height:100%' },
    el('div', { style: 'display:flex;gap:6px' }, el('div', { style: 'flex:1' }, input), clearDone), list));
}
