// Clipboard history: everything you copy (text, images and files), recorded in
// the background. Click to copy again, double-click to paste it into the app you
// were using, pin the ones you keep needing. Pro: longer history, ignore apps,
// and AI actions (summarise, fix, translate) on any item.

import { el, load, save, timeAgo, fmtBytes, watch } from '../store.js';
import { canUse } from '../features.js';
import { openUrl } from '../native.js';
import { menu, toast, toggle, segmented, empty, iconBtn, confirm, modal, markdown } from '../ui.js';
import { icon } from '../icons.js';
import * as C from '../services/clipboard.js';

const isLink = (i) => i.kind === 'text' && /^https?:\/\/\S+$/i.test((i.text || '').trim());
const glyphOf = (i) => (i.kind === 'image' ? 'image' : i.kind === 'files' ? 'file' : isLink(i) ? 'link' : 'align-left');

export function render(root) {
  let filter = '', kind = 'all', selected = 0, shown = [], slots = [];
  /// Alt+1 to Alt+9 paste the first nine pinned text items, in the order they're listed.
  const onSlot = (e) => { if (e.altKey && !e.ctrlKey && /^[1-9]$/.test(e.key) && slots[Number(e.key) - 1]) { e.preventDefault(); C.paste(slots[Number(e.key) - 1]); } };
  document.addEventListener('keydown', onSlot);
  const search = el('input', { class: 'field', placeholder: 'Search clipboard history' });
  const list = el('div', { class: 'col gap-4 scroll', style: 'flex:1' });
  const footer = el('div', { class: 'hstack tiny faint' });

  function paint() {
    const q = filter.toLowerCase();
    const items = C.items();
    shown = items.filter((i) => (kind === 'all' || (kind === 'pinned' ? i.pinned : kind === 'links' ? isLink(i) : kind === 'text' ? i.kind === 'text' && !isLink(i) : i.kind === kind))
      && (!q || (i.text || '').toLowerCase().includes(q) || (i.files || []).join(' ').toLowerCase().includes(q) || (i.app || '').toLowerCase().includes(q)));
    // Pinned first.
    shown.sort((a, b) => Number(b.pinned) - Number(a.pinned) || b.at - a.at);
    selected = Math.min(selected, Math.max(0, shown.length - 1));
    slots = shown.filter((i) => i.pinned && (i.kind === 'text')).slice(0, 9);
    list.replaceChildren(...shown.slice(0, 300).map((item, idx) => {
      const tile = item.kind === 'image' && item.thumb
        ? el('div', { class: 'tile-ico', style: 'width:40px;height:40px;border-radius:11px;background:rgba(255,255,255,.07);overflow:hidden' }, el('img', { src: `data:image/png;base64,${item.thumb}`, style: 'width:100%;height:100%;object-fit:cover' }))
        : el('div', { class: 'tile-ico', style: 'width:40px;height:40px;border-radius:11px;background:rgba(255,255,255,.07);color:var(--accent-bright)' }, icon(glyphOf(item), 20));
      const preview = item.kind === 'image'
        ? el('div', { class: 'ellipsis' }, `Image · ${item.width}×${item.height}`)
        : item.kind === 'files'
          ? el('div', { class: 'ellipsis' }, item.files.map((f) => f.split(/[\\/]/).pop()).join(', '))
          : el('div', { class: 'ellipsis', style: 'font-size:15px' }, (item.text || '').replace(/\s+/g, ' ').trim().slice(0, 200));
      const row = el('div', {
        class: `item clickable ${idx === selected ? 'selected' : ''}`,
        title: 'Click to copy · double-click to paste · right-click for more',
        onclick: async () => { await C.copy(item); toast('Copied'); },
        ondblclick: () => C.paste(item),
        onmouseenter: () => { selected = idx; },
      },
        tile,
        el('div', { class: 'main' }, preview,
          el('div', { class: 'small dim hstack', style: 'gap:5px' }, item.pinned ? icon('pin', 13) : null, slots.includes(item) ? el('span', { class: 'chip', style: 'padding:0 6px', title: `Alt+${slots.indexOf(item) + 1} pastes this` }, `Alt+${slots.indexOf(item) + 1}`) : null, el('span', {}, [item.app || null, timeAgo(item.at)].filter(Boolean).join(' · ')))),
        el('div', { class: 'actions' },
          item.kind === 'text' ? iconBtn(icon('todo', 16, '✅'), 'Add as a to-do', (e) => { e.stopPropagation(); addTodo(item.text); }) : null,
          item.kind === 'text' && /^https?:\/\/\S+$/i.test(item.text.trim()) ? iconBtn(icon('external-link', 16, '↗'), 'Open the link', (e) => { e.stopPropagation(); openUrl(item.text.trim()); }) : null,
          iconBtn(icon('pin', 16, '📌'), item.pinned ? 'Unpin' : 'Pin', (e) => { e.stopPropagation(); C.togglePin(item.id); }),
          iconBtn('⤵', 'Paste into the app you were using', (e) => { e.stopPropagation(); C.paste(item); }),
          iconBtn(icon('trash-2', 16, '🗑'), 'Delete', (e) => { e.stopPropagation(); C.removeItem(item.id); })));
      row.addEventListener('contextmenu', (e) => menu(e, [
        { label: 'Copy', run: () => C.copy(item).then(() => toast('Copied')) },
        { label: 'Paste into the app you were using', run: () => C.paste(item) },
        { label: item.pinned ? 'Unpin' : 'Pin', run: () => C.togglePin(item.id) },
        item.kind === 'text' ? { label: 'Add as a to-do', run: () => addTodo(item.text) } : null,
        item.kind === 'text' ? 'sep' : null,
        ...(item.kind === 'text' ? Object.entries(aiActions()).map(([id, a]) => ({ label: `✨ ${a.label}${canUse('clipboardAI') ? '' : ' (Pro)'}`, run: () => runAI(item, id) })) : []),
        item.kind === 'text' ? { label: '🈯 Translate in Translator', run: async () => (await import('../app.js')).show('translator', { text: item.text }) } : null,
        'sep',
        { label: 'Delete', danger: true, run: () => C.removeItem(item.id) },
      ]));
      return row;
    }));
    if (!shown.length) list.append(items.length ? el('div', { class: 'small dim', style: 'padding:8px' }, 'Nothing matches.')
      : empty('📋', 'Copy anything', 'Text, images and files you copy appear here, even while the notch is closed. Password managers are always skipped.'));
    const paused = load('clipboard.paused', false);
    footer.replaceChildren(el('span', { class: 'grow' }, `${items.length.toLocaleString()} of ${C.limit().toLocaleString()} items${paused ? ' · paused' : ''}`),
      el('label', { class: 'hstack', style: 'gap:6px;cursor:pointer' }, toggle(!paused, (on) => { C.setPaused(!on); paint(); }), 'Recording'));
  }

  /// Turns the copied text into a to-do (its first line, up to 140 characters).
  function addTodo(text) {
    const line = String(text).split(/\r?\n/).find((l) => l.trim())?.trim().slice(0, 140);
    if (!line) return;
    import('../services/reminders.js').then((R) => { R.addTodo(line); toast('Added to your to-dos'); });
  }

  const aiActions = () => ({ summarize: { label: 'Summarise' }, fix: { label: 'Fix grammar' }, translate: { label: 'Translate to English' }, explain: { label: 'Explain' } });

  async function runAI(item, id) {
    if (!canUse('clipboardAI')) return toast('AI on your clipboard is part of Pro.');
    const AI = await import('../services/ai.js');
    const out = el('div', { class: 'col scroll', style: 'max-height:300px' }, el('div', { class: 'hstack small dim' }, el('span', { class: 'spin' }), ' Working…'));
    const m = modal(`✨ ${AI.CLIPBOARD_ACTIONS[id].label}`, [out]);
    try {
      const answer = await AI.ask(`${AI.CLIPBOARD_ACTIONS[id].prompt}\n\n${item.text}`);
      out.replaceChildren(markdown(answer));
      m.box.append(el('div', { class: 'hstack', style: 'justify-content:flex-end' },
        el('button', { class: 'btn quiet', onclick: () => { C.paste({ kind: 'text', text: answer }); m.close(); } }, 'Paste'),
        el('button', { class: 'btn', onclick: async () => { await C.copy({ kind: 'text', text: answer }); toast('Copied'); m.close(); } }, 'Copy result')));
    } catch (e) { out.replaceChildren(el('div', { class: 'err' }, e.message)); }
  }

  search.addEventListener('input', () => { filter = search.value.trim(); selected = 0; paint(); });
  search.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown') { selected = Math.min(selected + 1, shown.length - 1); paint(); list.children[selected]?.scrollIntoView({ block: 'nearest' }); e.preventDefault(); }
    else if (e.key === 'ArrowUp') { selected = Math.max(selected - 1, 0); paint(); list.children[selected]?.scrollIntoView({ block: 'nearest' }); e.preventDefault(); }
    else if (e.key === 'Enter' && shown[selected]) { e.preventDefault(); e.ctrlKey ? C.copy(shown[selected]).then(() => toast('Copied')) : C.paste(shown[selected]); }
  });

  search.style.paddingLeft = '38px';
  const searchBox = el('div', { style: 'position:relative;flex:1;min-width:0' }, el('span', { style: 'position:absolute;left:12px;top:50%;transform:translateY(-50%);color:var(--text-dim);display:grid', 'aria-hidden': 'true' }, icon('search', 17)), search);
  root.append(el('div', { class: 'col fill' },
    el('div', { class: 'hstack' }, searchBox,
      segmented([{ value: 'all', label: 'All' }, { value: 'pinned', label: 'Pinned' }, { value: 'text', label: 'Text' }, { value: 'links', label: 'Links' }, { value: 'image', label: 'Images' }, { value: 'files', label: 'Files' }], kind, (v) => { kind = v; paint(); }),
      iconBtn(icon('trash-2', 19, '🗑'), 'Clear clipboard history', async () => { if (await confirm('Clear clipboard history?', { ok: 'Clear', danger: true, detail: 'Pinned items are kept.' })) { C.clearAll(); paint(); } })),
    list, footer));
  paint();
  const unwatch = watch('clipboard.items', () => paint());
  setTimeout(() => search.focus(), 40);
  return () => { unwatch(); document.removeEventListener('keydown', onSlot); };
}

export { fmtBytes };
