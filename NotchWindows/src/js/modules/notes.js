// Notes, saved automatically as you type. Search across all notes, pin
// favourites, and (Pro) a Markdown preview with #tags to filter by.

import { el, load, save, uid, timeAgo } from '../store.js';
import { canUse } from '../features.js';
import { iconBtn, markdown, confirm, menu, toast, empty } from '../ui.js';
import { invoke, openUrl } from '../native.js';

const KEY = 'notes.items';

const tagsOf = (text) => [...new Set((text.match(/(^|\s)#([\p{L}\p{N}_-]{2,30})/gu) || []).map((t) => t.trim().slice(1).toLowerCase()))];

export function render(root, opts = {}) {
  let notes = load(KEY, []);
  let activeId = (opts.open && notes.some((n) => n.id === opts.open) ? opts.open : null) ?? notes.find((n) => n.pinned)?.id ?? notes[0]?.id ?? null;
  let preview = false, tag = null;

  const list = el('div', { class: 'col gap-4 scroll', style: 'flex:1' });
  const search = el('input', { class: 'field', placeholder: 'Search notes' });
  const tags = el('div', { class: 'hstack wrap', style: 'gap:4px' });
  const editor = el('textarea', { class: 'field', style: 'flex:1;min-height:0;resize:none;font-size:13.5px', placeholder: 'Write something… (saved automatically)' });
  const previewBox = el('div', { class: 'scroll hidden', style: 'flex:1;padding:4px 2px' });
  const meta = el('div', { class: 'tiny faint' });
  const previewBtn = iconBtn('👁', 'Markdown preview (Pro)', () => {
    if (!canUse('richNotes')) return toast('Markdown notes and tags are part of Pro.');
    preview = !preview; previewBtn.classList.toggle('on', preview); paintEditor();
  });

  const persist = () => save(KEY, notes);
  const active = () => notes.find((n) => n.id === activeId);
  const titleOf = (n) => n.text.trim().split('\n')[0].replace(/^#+\s*/, '').slice(0, 40) || 'New note';

  function paintList() {
    const q = search.value.trim().toLowerCase();
    const shown = notes
      .filter((n) => (!q || n.text.toLowerCase().includes(q)) && (!tag || tagsOf(n.text).includes(tag)))
      .sort((a, b) => Number(!!b.pinned) - Number(!!a.pinned) || b.updated - a.updated);
    list.replaceChildren(...shown.map((n) => {
      const row = el('div', { class: `item clickable ${n.id === activeId ? 'selected' : ''}`, style: 'padding:6px 8px', onclick: () => { activeId = n.id; paintEditor(); paintList(); } },
        el('div', { class: 'main' },
          el('div', { class: 'ellipsis', style: 'font-weight:600' }, n.pinned ? '📌 ' : '', titleOf(n)),
          el('div', { class: 'tiny faint ellipsis' }, timeAgo(n.updated), ' · ', n.text.split('\n').slice(1).join(' ').trim().slice(0, 60))));
      row.addEventListener('contextmenu', (e) => menu(e, [
        { label: n.pinned ? 'Unpin' : 'Pin to top', run: () => { n.pinned = !n.pinned; persist(); paintList(); } },
        { label: 'Copy text', run: () => invoke('clipboard_copy_text', { text: n.text }).then(() => toast('Copied')) },
        { label: 'Duplicate', run: () => { notes.unshift({ ...n, id: uid(), pinned: false, updated: Date.now() }); persist(); paintList(); } },
        { label: 'Delete', danger: true, run: () => remove(n.id) },
      ]));
      return row;
    }));
    if (!shown.length) list.append(el('div', { class: 'small dim', style: 'padding:6px' }, notes.length ? 'Nothing matches.' : 'No notes yet.'));
    // Tags (Pro).
    if (canUse('richNotes')) {
      const all = [...new Set(notes.flatMap((n) => tagsOf(n.text)))].sort();
      tags.replaceChildren(...all.map((t) => el('span', { class: `chip clickable ${tag === t ? 'on' : ''}`, onclick: () => { tag = tag === t ? null : t; paintList(); } }, `#${t}`)));
    }
  }

  function paintEditor() {
    const n = active();
    editor.disabled = !n;
    editor.value = n?.text ?? '';
    meta.textContent = n ? `Edited ${timeAgo(n.updated)} · ${n.text.trim() ? n.text.trim().split(/\s+/).length : 0} words` : '';
    editor.classList.toggle('hidden', preview && !!n);
    previewBox.classList.toggle('hidden', !preview || !n);
    if (preview && n) previewBox.replaceChildren(markdown(n.text || '*Empty note*', { onLink: openUrl }));
    if (!n) {
      editor.classList.add('hidden'); previewBox.classList.remove('hidden');
      previewBox.replaceChildren(empty('📝', 'No note selected', 'Create a note with “+ New”.'));
    }
  }

  editor.addEventListener('input', () => {
    const n = active();
    if (!n) return;
    n.text = editor.value;
    n.updated = Date.now();
    persist();
    clearTimeout(editor._t);
    editor._t = setTimeout(() => { paintList(); meta.textContent = `Saved · ${n.text.trim() ? n.text.trim().split(/\s+/).length : 0} words`; }, 350);
  });

  function add() {
    const n = { id: uid(), text: tag ? `\n\n#${tag}` : '', updated: Date.now(), pinned: false };
    notes.unshift(n); activeId = n.id; preview = false; previewBtn.classList.remove('on');
    persist(); paintList(); paintEditor();
    editor.focus(); editor.setSelectionRange(0, 0);
  }

  async function remove(id) {
    const n = notes.find((x) => x.id === id);
    if (n?.text.trim() && !(await confirm(`Delete “${titleOf(n)}”?`, { ok: 'Delete', danger: true }))) return;
    notes = notes.filter((x) => x.id !== id);
    if (activeId === id) activeId = notes[0]?.id ?? null;
    persist(); paintList(); paintEditor();
  }

  search.addEventListener('input', paintList);
  root.append(el('div', { class: 'row fill' },
    el('div', { class: 'col', style: 'flex:0 0 210px;gap:6px' },
      el('div', { class: 'hstack' }, el('button', { class: 'btn', style: 'flex:1', onclick: add }, '+ New'), iconBtn('🗑', 'Delete this note', () => activeId && remove(activeId))),
      search, tags, list),
    el('div', { class: 'card col', style: 'flex:1;gap:6px' }, el('div', { class: 'hstack' }, meta, el('div', { class: 'spacer' }), previewBtn), editor, previewBox)));
  paintList();
  paintEditor();
  if (opts.newNote || load('notes.newOnOpen', false)) { save('notes.newOnOpen', false); add(); }
  else if (active()) setTimeout(() => editor.focus(), 40);
}
