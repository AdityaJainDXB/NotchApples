// Notes: several quick notes saved on this PC, with search.
import { el, load, save } from '../store.js';

const KEY = 'notes.items';

export function render(root) {
  let notes = load(KEY, []);
  let activeId = notes[0]?.id ?? null;

  const list = el('div', { class: 'col', style: 'overflow:auto;gap:4px' });
  const editor = el('textarea', { class: 'field', style: 'flex:1;min-height:0', placeholder: 'Write something…' });
  const search = el('input', { class: 'field', placeholder: 'Search notes', style: 'margin-bottom:6px' });

  const persist = () => save(KEY, notes);
  const activeNote = () => notes.find((n) => n.id === activeId);

  function refreshList() {
    const q = search.value.trim().toLowerCase();
    const shown = q ? notes.filter((n) => n.text.toLowerCase().includes(q)) : notes;
    list.replaceChildren(...shown.map((n) => el('button', {
      class: 'btn quiet',
      style: `text-align:left;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;${
        n.id === activeId ? 'border-color:var(--accent)' : ''}`,
      onclick: () => { activeId = n.id; editor.value = n.text; refreshList(); editor.focus(); },
    }, n.text.split('\n')[0].slice(0, 28) || 'Empty note')));
    if (!shown.length) list.append(el('div', { class: 'small dim', style: 'padding:6px' },
      notes.length ? 'Nothing matches.' : 'No notes yet.'));
  }

  editor.addEventListener('input', () => {
    const n = activeNote();
    if (!n) return;
    n.text = editor.value;
    n.updated = Date.now();
    persist();
    clearTimeout(editor._t);
    editor._t = setTimeout(refreshList, 400);
  });

  const addNote = () => {
    const n = { id: crypto.randomUUID(), text: '', updated: Date.now() };
    notes.unshift(n); activeId = n.id; persist();
    editor.value = ''; refreshList(); editor.focus();
  };

  const deleteNote = () => {
    notes = notes.filter((n) => n.id !== activeId);
    activeId = notes[0]?.id ?? null;
    editor.value = activeNote()?.text ?? '';
    persist(); refreshList();
  };

  if (activeId) editor.value = activeNote().text;
  refreshList();
  search.addEventListener('input', refreshList);

  root.append(el('div', { class: 'row', style: 'height:100%' },
    el('div', { class: 'col', style: 'flex:0 0 190px' },
      el('div', { style: 'display:flex;gap:6px' },
        el('button', { class: 'btn', style: 'flex:1', onclick: addNote }, '+ New'),
        el('button', { class: 'btn quiet', onclick: deleteNote, title: 'Delete this note' }, '🗑')),
      search, list),
    el('div', { class: 'card col', style: 'flex:1' }, editor)));
}
