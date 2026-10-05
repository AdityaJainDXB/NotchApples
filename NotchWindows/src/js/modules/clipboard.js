// Clipboard history: everything you copy (text, images and files), recorded in
// the background. Click to copy again, double-click to paste it into the app you
// were using, pin the ones you keep needing. Pro: longer history, ignore apps,
// and AI actions (summarise, fix, translate) on any item.

import { el, load, save, timeAgo, fmtBytes, watch } from '../store.js';
import { canUse } from '../features.js';
import { menu, toast, toggle, segmented, empty, iconBtn, confirm, modal, markdown } from '../ui.js';
import * as C from '../services/clipboard.js';

export function render(root) {
  let filter = '', kind = 'all', selected = 0, shown = [];
  const search = el('input', { class: 'field', placeholder: 'Search clipboard history' });
  const list = el('div', { class: 'col gap-4 scroll', style: 'flex:1' });
  const footer = el('div', { class: 'hstack tiny faint' });

  function paint() {
    const q = filter.toLowerCase();
    const items = C.items();
    shown = items.filter((i) => (kind === 'all' || (kind === 'pinned' ? i.pinned : i.kind === kind))
      && (!q || (i.text || '').toLowerCase().includes(q) || (i.files || []).join(' ').toLowerCase().includes(q) || (i.app || '').toLowerCase().includes(q)));
    // Pinned first.
    shown.sort((a, b) => Number(b.pinned) - Number(a.pinned) || b.at - a.at);
    selected = Math.min(selected, Math.max(0, shown.length - 1));
    list.replaceChildren(...shown.slice(0, 300).map((item, idx) => {
      const preview = item.kind === 'image'
        ? el('div', { class: 'hstack' }, el('img', { src: `data:image/png;base64,${item.thumb}`, style: 'max-height:54px;max-width:160px;border-radius:6px;border:1px solid var(--border)' }),
          el('span', { class: 'tiny faint' }, `${item.width}×${item.height}`))
        : item.kind === 'files'
          ? el('div', { class: 'ellipsis' }, `📁 ${item.files.map((f) => f.split(/[\\/]/).pop()).join(', ')}`)
          : el('div', { class: 'ellipsis', style: 'white-space:pre;max-height:36px' }, (item.text || '').replace(/\s+\n/g, '\n').slice(0, 300));
      const row = el('div', {
        class: `item clickable ${idx === selected ? 'selected' : ''}`,
        title: 'Click to copy · double-click to paste · right-click for more',
        onclick: async () => { await C.copy(item); toast('Copied'); },
        ondblclick: () => C.paste(item),
        onmouseenter: () => { selected = idx; },
      },
        el('div', { class: 'main' }, preview,
          el('div', { class: 'tiny faint' }, [item.pinned ? '📌 Pinned' : null, item.app || null, timeAgo(item.at),
            item.kind === 'text' ? `${item.text.length.toLocaleString()} characters${item.truncated ? ' (shortened)' : ''}` : null].filter(Boolean).join(' · '))),
        el('div', { class: 'actions' },
          iconBtn(item.pinned ? '📍' : '📌', item.pinned ? 'Unpin' : 'Pin', (e) => { e.stopPropagation(); C.togglePin(item.id); }),
          iconBtn('⤵', 'Paste into the app you were using', (e) => { e.stopPropagation(); C.paste(item); }),
          iconBtn('🗑', 'Delete', (e) => { e.stopPropagation(); C.removeItem(item.id); })));
      row.addEventListener('contextmenu', (e) => menu(e, [
        { label: 'Copy', run: () => C.copy(item).then(() => toast('Copied')) },
        { label: 'Paste into the app you were using', run: () => C.paste(item) },
        { label: item.pinned ? 'Unpin' : 'Pin', run: () => C.togglePin(item.id) },
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

  root.append(el('div', { class: 'col fill' },
    el('div', { class: 'hstack' }, search,
      segmented([{ value: 'all', label: 'All' }, { value: 'text', label: 'Text' }, { value: 'image', label: 'Images' }, { value: 'files', label: 'Files' }, { value: 'pinned', label: '📌' }], kind, (v) => { kind = v; paint(); }),
      el('button', { class: 'btn quiet small', onclick: async () => { if (await confirm('Clear clipboard history?', { ok: 'Clear', danger: true, detail: 'Pinned items are kept.' })) { C.clearAll(); paint(); } } }, 'Clear')),
    list, footer));
  paint();
  const unwatch = watch('clipboard.items', () => paint());
  setTimeout(() => search.focus(), 40);
  return () => unwatch();
}

export { fmtBytes };
