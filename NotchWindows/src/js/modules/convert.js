// The Convert tab (Ultimate): drop files (or choose them), check what each one is, pick what it should become, and
// convert. Each result is saved next to the original. See services/convert.js.

import { el, load, save, uid } from '../store.js';
import { invoke, listen, openUrl } from '../native.js';
import { select, toast, spinner } from '../ui.js';
import * as C from '../services/convert.js';

const ICON = { image: '🖼', pdf: '📕', document: '📄', presentation: '📊', spreadsheet: '📈', audio: '🎵', video: '🎬', archive: '🗜', folder: '📁' };
const items = [];   // kept while the app runs, so switching tabs doesn't lose the list

/// Adds paths to the list (from a drop, the file picker, or another tab).
export async function addPaths(paths) {
  for (const path of paths) {
    if (items.some((i) => i.path === path)) continue;
    const info = await invoke('path_info', { path }).catch(() => ({ name: path.split(/[\\/]/).pop(), is_dir: false, size: 0 }));
    const from = C.detect(path, info.is_dir);
    items.push({ id: uid(), path, name: info.name || path.split(/[\\/]/).pop(), size: info.size || 0, from, to: pick(from), status: 'ready' });
  }
}
function pick(from) {
  if (!from) return null;
  const list = C.targets(from), last = load('convert.last', {})[from];
  return list.includes(last) ? last : list[0] || null;
}
const size = (b) => (!b ? '' : b < 1024 ? `${b} B` : b < 1048576 ? `${(b / 1024).toFixed(0)} KB` : b < 1073741824 ? `${(b / 1048576).toFixed(1)} MB` : `${(b / 1073741824).toFixed(2)} GB`);

// Every format, grouped, for "this file is a…".
const FROM_OPTIONS = Object.fromEntries(C.KINDS.map(([kind, title]) => [title,
  Object.keys(C.FORMATS).filter((f) => C.FORMATS[f].kind === kind).map((f) => ({ value: f, label: C.label(f) }))]));

export function render(root) {
  const list = el('div', { class: 'col cv-list scroll' });
  const helpers = el('div', { class: 'hstack cv-helpers' });
  const footer = el('div', { class: 'hstack', style: 'gap:8px;flex-wrap:wrap' });
  const head = el('div', { class: 'hstack', style: 'gap:8px' },
    el('div', { class: 'cv-icon' }, '🔁'),
    el('div', { class: 'grow', style: 'min-width:0' }, el('div', { class: 'title' }, 'Convert'),
      el('div', { class: 'small dim ellipsis' }, 'Pictures, PDFs, documents, slides, tables, audio and video. Saved next to the original.')),
    helpers,
    el('button', { class: 'btn small', onclick: choose }, '+ Choose files'));
  root.append(el('div', { class: 'card col fill', style: 'gap:10px;min-height:0' }, head, list, footer));

  async function choose() {
    const paths = await invoke('convert_pick').catch(() => []);
    if (paths?.length) { await addPaths(paths); paint(); }
  }

  async function paintHelpers(refresh) {
    const t = await C.tools(refresh);
    const chip = (on, name, title) => el('span', { class: `cv-chip${on ? ' on' : ''}`, title }, `${on ? '✓' : '–'} ${name}`);
    helpers.replaceChildren(
      chip(t.word || t.powerpoint || t.excel, 'Office', 'Word, PowerPoint and Excel convert Office files when they are installed.'),
      chip(t.libreoffice, 'LibreOffice', 'Free. Converts Office files when Microsoft Office isn’t installed.'),
      chip(t.ffmpeg, 'FFmpeg', 'Free. Converts audio and video.'),
      el('button', { class: 'btn small ghost', title: 'Look for Office, LibreOffice and FFmpeg again', onclick: () => paintHelpers(true) }, '↻'));
  }

  function row(it) {
    const kind = C.FORMATS[it.from]?.kind;
    const from = select(it.from ? FROM_OPTIONS : { 'Choose what this file is': [{ value: '', label: 'Unknown: choose…' }], ...FROM_OPTIONS }, it.from || '', (v) => {
      it.from = v || null; it.to = pick(it.from); it.status = 'ready'; paint();
    }, { cls: 'cv-select', title: 'What this file is' });
    const targets = it.from ? C.targets(it.from) : [];
    const to = select(targets.length ? targets.map((f) => ({ value: f, label: C.label(f) })) : [{ value: '', label: '—' }], it.to || '', (v) => {
      it.to = v; it.status = 'ready'; save('convert.last', { ...load('convert.last', {}), [it.from]: v }); paint();
    }, { cls: 'cv-select', title: 'What it should become' });
    to.disabled = !targets.length;

    let action;
    if (it.status === 'busy') action = el('span', { class: 'hstack small dim', style: 'gap:6px' }, spinner(), it.step || 'Converting…');
    else if (it.status === 'done') action = el('span', { class: 'hstack', style: 'gap:4px' },
      el('span', { class: 'cv-ok' }, '✓'),
      el('button', { class: 'btn small', onclick: () => invoke('open_path', { path: it.output }).catch((e) => toast(e.message, { error: true })) }, 'Open'),
      el('button', { class: 'btn small ghost', onclick: () => invoke('reveal_path', { path: it.output }) }, 'Show'));
    else action = el('button', { class: 'btn small primary', disabled: !it.from || !it.to, onclick: () => run(it) }, 'Convert');

    const r = el('div', { class: `cv-row${it.status === 'error' ? ' err' : ''}` },
      el('div', { class: 'hstack', style: 'gap:8px;min-width:0' },
        el('span', { class: 'cv-kind' }, ICON[kind] || '❔'),
        el('div', { class: 'grow', style: 'min-width:0' },
          el('div', { class: 'ellipsis', title: it.path, style: 'font-weight:600' }, it.name),
          el('div', { class: 'tiny dim' }, [size(it.size), it.status === 'done' ? `→ ${it.output.split(/[\\/]/).pop()}` : ''].filter(Boolean).join(' · '))),
        from, el('span', { class: 'dim' }, '→'), to, action,
        el('button', { class: 'icon-btn', title: 'Remove from the list', onclick: () => { items.splice(items.indexOf(it), 1); paint(); } }, '×')));
    if (it.status === 'error') {
      const h = it.help && C.HELP[it.help];
      r.append(el('div', { class: 'hstack small cv-error', style: 'gap:8px' }, el('span', { class: 'grow' }, it.error),
        h?.command ? el('button', { class: 'btn small ghost', title: 'Paste it in Terminal or PowerShell', onclick: () => invoke('clipboard_copy_text', { text: h.command }).then(() => toast(`Copied: ${h.command}`)) }, 'Copy install command') : null,
        h?.link ? el('button', { class: 'btn small', onclick: () => openUrl(h.link) }, h.button) : null));
    }
    return r;
  }

  async function run(it) {
    it.status = 'busy'; it.step = 'Starting…'; paint();
    try {
      it.output = await C.convert(it.path, it.from, it.to, (s) => { it.step = s; paint(); });
      it.status = 'done';
    } catch (e) {
      it.status = 'error'; it.error = e.message || String(e); it.help = e.help;
    }
    paint();
  }

  async function runAll() {
    const images = items.filter((i) => i.status !== 'done' && i.status !== 'busy' && C.FORMATS[i.from]?.kind === 'image' && i.to === 'pdf');
    if (combine && images.length > 1) {
      images.forEach((i) => { i.status = 'busy'; i.step = 'Combining…'; });
      paint();
      try {
        const out = await C.combinePdf(images, (s) => { images.forEach((i) => { i.step = s; }); paint(); });
        images.forEach((i) => { i.status = 'done'; i.output = out; });
      } catch (e) { images.forEach((i) => { i.status = 'error'; i.error = e.message; }); }
      paint();
    }
    for (const it of items.filter((i) => i.status === 'ready' || i.status === 'error')) if (it.from && it.to) await run(it);
  }

  let combine = load('convert.combine', false);
  function paint() {
    if (!items.length) {
      list.replaceChildren(el('div', { class: 'cv-drop', onclick: choose },
        el('div', { style: 'font-size:28px' }, '📥'),
        el('div', { style: 'font-weight:700' }, 'Drop files here'),
        el('div', { class: 'small dim' }, 'or click to choose them. PPTX → PDF, HEIC → JPG, DOCX → PDF, MOV → MP4, PNG → ICO, XLSX → CSV, PDF → pictures and more.')));
      footer.replaceChildren();
      return;
    }
    list.replaceChildren(...items.map(row));
    const all = [...new Set(items.filter((i) => i.from).flatMap((i) => C.targets(i.from)))];
    const imagePdfs = items.filter((i) => C.FORMATS[i.from]?.kind === 'image' && i.to === 'pdf').length;
    footer.replaceChildren(...[
      el('span', { class: 'small dim' }, 'Make them all'),
      select([{ value: '', label: 'Choose…' }, ...all.map((f) => ({ value: f, label: C.label(f) }))], '', (v) => {
        for (const i of items) if (i.from && C.targets(i.from).includes(v) && i.status !== 'busy') { i.to = v; i.status = 'ready'; }
        paint();
      }, { cls: 'cv-select', title: 'Set what every file should become (where it can)' }),
      imagePdfs > 1 ? el('label', { class: 'hstack small', style: 'gap:6px;cursor:pointer' },
        el('input', { type: 'checkbox', checked: combine, onchange: (e) => { combine = e.target.checked; save('convert.combine', combine); } }), 'Combine the pictures into one PDF') : null,
      el('span', { class: 'grow' }),
      el('button', { class: 'btn small ghost', onclick: () => { items.splice(0, items.length, ...items.filter((i) => i.status === 'busy')); paint(); } }, 'Clear'),
      el('button', { class: 'btn small primary', disabled: !items.some((i) => i.from && i.to && i.status !== 'busy' && i.status !== 'done'), onclick: runAll }, items.length > 1 ? 'Convert all' : 'Convert'),
    ].filter(Boolean));
  }

  let un;
  listen('tauri://drag-drop', async (e) => { await addPaths(e?.paths || []); paint(); }).then((u) => { un = u; });
  paint();
  paintHelpers(false);
  return () => un?.();
}
