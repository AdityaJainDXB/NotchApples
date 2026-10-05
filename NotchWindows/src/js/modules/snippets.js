// Snippets (Pro): saved text you paste into any app with one click.
import { el, load, save, uid } from '../store.js';
import { invoke } from '../native.js';
import { collapse } from '../app.js';
import { iconBtn, modal, button, empty, toast } from '../ui.js';

export function render(root) {
  const list = el('div', { class: 'col gap-4 scroll', style: 'flex:1' }), search = el('input', { class: 'field', placeholder: 'Search snippets' });
  const items = () => load('snippets.items', []);
  const edit = (s = { id: uid(), title: '', text: '' }) => {
    const t = el('input', { class: 'field', placeholder: 'Title', value: s.title }), x = el('textarea', { class: 'field', placeholder: 'Text to paste', value: s.text, style: 'min-height:120px' });
    const m = modal(s.title ? 'Edit snippet' : 'New snippet', [t, x], { actions: [button('Save', () => { if (!x.value) return; save('snippets.items', [...items().filter((i) => i.id !== s.id), { ...s, title: t.value || x.value.slice(0, 30), text: x.value }]); m.close(); paint(); })] });
  };
  const paste = async (s) => { await collapse(); invoke('paste_text', { text: s.text.replace(/\{date\}/g, new Date().toLocaleDateString()).replace(/\{time\}/g, new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })) }); };
  function paint() {
    const q = search.value.toLowerCase(), l = items().filter((s) => !q || (s.title + s.text).toLowerCase().includes(q));
    list.replaceChildren(...l.map((s) => el('div', { class: 'item clickable', onclick: () => paste(s), title: 'Click to paste into the app you were using' },
      el('div', { class: 'main' }, el('div', { style: 'font-weight:600' }, s.title), el('div', { class: 'tiny faint ellipsis' }, s.text)),
      el('div', { class: 'actions' }, iconBtn('⧉', 'Copy', (e) => { e.stopPropagation(); invoke('clipboard_copy_text', { text: s.text }).then(() => toast('Copied')); }),
        iconBtn('✎', 'Edit', (e) => { e.stopPropagation(); edit(s); }), iconBtn('🗑', 'Delete', (e) => { e.stopPropagation(); save('snippets.items', items().filter((i) => i.id !== s.id)); paint(); })))));
    if (!l.length) list.append(empty('✂️', 'No snippets yet', 'Save your email signature, address or replies you type often. {date} and {time} are filled in for you.'));
  }
  search.oninput = paint;
  root.append(el('div', { class: 'col fill' }, el('div', { class: 'hstack' }, search, button('+ New', () => edit())), list));
  paint();
}
