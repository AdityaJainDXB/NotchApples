// Shared controls, so every tab looks and behaves the same: buttons, switches,
// segmented pickers, settings rows, empty states, dialogs, menus, toasts, and a
// small, safe Markdown renderer for AI answers and notes.

import { el } from './store.js';

export function button(label, onclick, { kind = '', small = false, title, disabled, block } = {}) {
  return el('button', {
    class: `btn ${kind} ${small ? 'small' : ''} ${block ? 'block' : ''}`.trim(),
    title, disabled: !!disabled, onclick,
  }, label);
}

export function iconBtn(glyph, title, onclick, { on = false, cls = '' } = {}) {
  return el('button', { class: `icon-btn ${on ? 'on' : ''} ${cls}`.trim(), title, 'aria-label': title, onclick }, glyph);
}

/// An on/off switch. `onchange(checked)`.
export function toggle(checked, onchange, { disabled = false, title } = {}) {
  const input = el('input', { type: 'checkbox', checked: !!checked, disabled, onchange: () => onchange(input.checked) });
  return el('label', { class: 'switch', title }, input, el('span', { class: 'knob' }));
}

/// [{ value, label }] → segmented picker. `onchange(value)`.
export function segmented(options, value, onchange) {
  const wrap = el('div', { class: 'seg', role: 'tablist' });
  const paint = (v) => [...wrap.children].forEach((b) => b.classList.toggle('active', b.dataset.value === String(v)));
  for (const o of options) {
    wrap.append(el('button', { dataset: { value: String(o.value) }, title: o.title,
      onclick: () => { paint(o.value); onchange(o.value); } }, o.label));
  }
  paint(value);
  wrap.setValue = paint;
  return wrap;
}

/// options: [{ value, label }] or { 'Group': [{ value, label }] }.
export function select(options, value, onchange, { cls = '', title } = {}) {
  const s = el('select', { class: `field ${cls}`.trim(), title });
  const opt = (o) => el('option', { value: o.value, selected: String(o.value) === String(value), disabled: !!o.disabled }, o.label);
  if (Array.isArray(options)) s.append(...options.map(opt));
  else for (const [group, list] of Object.entries(options)) s.append(el('optgroup', { label: group }, ...list.map(opt)));
  s.addEventListener('change', () => onchange(s.value));
  return s;
}

export function slider(value, oninput, { min = 0, max = 100, step = 1, title } = {}) {
  const r = el('input', { type: 'range', min, max, step, value, title });
  r.addEventListener('input', () => oninput(Number(r.value)));
  return r;
}

/// A settings row: name, description and a control on the right.
export function setting(name, desc, control) {
  return el('div', { class: 'setting' },
    el('div', { class: 'text' }, el('div', { class: 'name' }, name), desc ? el('div', { class: 'desc' }, desc) : null),
    control);
}

export function card(title, body, { actions = [], cls = '', style } = {}) {
  return el('div', { class: `card col ${cls}`.trim(), style },
    title ? el('div', { class: 'card-title' }, el('div', { class: 'section-title' }, title), ...actions) : null,
    ...(Array.isArray(body) ? body : [body]));
}

export function empty(glyph, what, how, action) {
  return el('div', { class: 'empty' },
    el('div', {}, el('div', { class: 'glyph' }, glyph), el('div', { class: 'what' }, what),
      how ? el('div', { class: 'how' }, how) : null,
      action ? el('div', { style: 'margin-top:8px' }, action) : null));
}

export const spinner = () => el('span', { class: 'spin' });

// ---- toasts ----

let host;
export function toast(message, { error = false, ms = 2200 } = {}) {
  host ??= document.body.appendChild(el('div', { class: 'toast-host' }));
  const t = el('div', { class: `toast ${error ? 'err' : ''}` }, message);
  host.append(t);
  setTimeout(() => t.remove(), error ? Math.max(ms, 4000) : ms);
}

/// A destructive button you press and hold: a fill sweeps across, and only when it is full does onConfirm run.
/// Letting go early or sliding off cancels. Enter or Space held does the same, so keyboards work.
export function holdButton(label, onConfirm, { ms = 1200, hint = 'Press and hold to confirm' } = {}) {
  const fill = el('span', { class: 'hold-fill', 'aria-hidden': 'true' }, label);
  const b = el('button', { class: 'btn small hold-btn', type: 'button', title: hint, 'aria-label': `${label}. ${hint}` }, el('span', {}, label), fill);
  const reduce = (typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches);
  let timer = null;
  const start = () => {
    if (timer) return;
    b.classList.add('holding');
    fill.style.transition = reduce ? 'none' : `clip-path ${ms}ms linear`;
    fill.style.clipPath = 'inset(0 0 0 0)';
    timer = setTimeout(() => { timer = null; reset(true); onConfirm(); }, ms);
  };
  const reset = (instant) => {
    if (timer) { clearTimeout(timer); timer = null; }
    b.classList.remove('holding');
    fill.style.transition = instant ? 'none' : 'clip-path .18s cubic-bezier(.23,1,.32,1)';
    fill.style.clipPath = 'inset(0 100% 0 0)';
  };
  b.addEventListener('pointerdown', (e) => { if (e.button === 0) { b.setPointerCapture(e.pointerId); start(); } });
  for (const t of ['pointerup', 'pointercancel', 'pointerleave', 'blur']) b.addEventListener(t, () => reset(false));
  b.addEventListener('keydown', (e) => { if ((e.key === 'Enter' || e.key === ' ') && !e.repeat) { e.preventDefault(); start(); } });
  b.addEventListener('keyup', (e) => { if (e.key === 'Enter' || e.key === ' ') reset(false); });
  reset(true);
  return b;
}

/// "Deleted. Undo" for five seconds, with the Undo button's fill draining as the time runs out.
export function undoToast(message, undo, ms = 5000) {
  host ??= document.body.appendChild(el('div', { class: 'toast-host' }));
  const fill = el('span', { class: 'undo-fill', 'aria-hidden': 'true' }, 'Undo');
  const btn = el('button', { class: 'undo-btn', type: 'button' }, el('span', {}, 'Undo'), fill);
  const t = el('div', { class: 'toast undo-toast', role: 'status' }, el('span', { class: 'undo-ok' }, '✓'), el('span', {}, message), btn);
  host.append(t);
  const reduce = (typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches);
  requestAnimationFrame(() => { fill.style.transition = reduce ? 'none' : `clip-path ${ms}ms linear`; fill.style.clipPath = 'inset(0 100% 0 0)'; });
  const gone = setTimeout(() => t.remove(), ms);
  btn.onclick = () => { clearTimeout(gone); t.remove(); undo(); };
}

// ---- dialogs ----

/// Opens a dialog. Returns { close, box }. Esc or clicking outside closes it.
export function modal(title, body, { actions = [], wide = false, onclose } = {}) {
  const close = () => { overlay.remove(); document.removeEventListener('keydown', onKey, true); onclose?.(); };
  const onKey = (e) => { if (e.key === 'Escape') { e.stopPropagation(); e.preventDefault(); close(); } };
  const box = el('div', { class: `dialog ${wide ? 'wide' : ''}` },
    title ? el('div', { class: 'hstack' }, el('div', { class: 'title grow' }, title), iconBtn('✕', 'Close', () => close())) : null,
    ...(Array.isArray(body) ? body : [body]),
    actions.length ? el('div', { class: 'hstack', style: 'justify-content:flex-end' }, ...actions) : null);
  const overlay = el('div', { class: 'overlay', onmousedown: (e) => { if (e.target === overlay) close(); } }, box);
  document.body.append(overlay);
  document.addEventListener('keydown', onKey, true);
  setTimeout(() => box.querySelector('input,textarea,select')?.focus(), 30);
  return { close, box };
}

/// Asks before doing something. Resolves true or false.
export function confirm(message, { ok = 'OK', danger = false, detail } = {}) {
  return new Promise((resolve) => {
    let answered = false;
    const done = (v) => { answered = true; m.close(); resolve(v); };
    const m = modal(null, [el('div', { class: 'title' }, message), detail ? el('div', { class: 'small dim' }, detail) : null], {
      actions: [button('Cancel', () => done(false), { kind: 'quiet' }), button(ok, () => done(true), { kind: danger ? 'danger' : '' })],
      onclose: () => { if (!answered) resolve(false); },
    });
  });
}

/// Asks for a line of text. Resolves the text or null.
export function prompt(message, { value = '', placeholder = '', ok = 'Save' } = {}) {
  return new Promise((resolve) => {
    let answered = false;
    const input = el('input', { class: 'field', value, placeholder });
    const done = (v) => { answered = true; m.close(); resolve(v); };
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') done(input.value.trim() || null); });
    const m = modal(message, [input], {
      actions: [button('Cancel', () => done(null), { kind: 'quiet' }), button(ok, () => done(input.value.trim() || null))],
      onclose: () => { if (!answered) resolve(null); },
    });
    setTimeout(() => { input.focus(); input.select(); }, 40);
  });
}

// ---- context menu ----

/// items: [{ label, run, danger }] or 'sep'. Opens at the mouse.
export function menu(event, items) {
  event.preventDefault();
  document.querySelector('.menu')?.remove();
  const m = el('div', { class: 'menu' }, ...items.filter(Boolean).map((i) => i === 'sep'
    ? el('hr')
    : el('button', { class: i.danger ? 'danger' : '', onclick: () => { m.remove(); i.run(); } }, i.label)));
  document.body.append(m);
  const r = m.getBoundingClientRect();
  m.style.left = `${Math.min(event.clientX, innerWidth - r.width - 6)}px`;
  m.style.top = `${Math.min(event.clientY, innerHeight - r.height - 6)}px`;
  const away = (e) => { if (!m.contains(e.target)) { m.remove(); removeEventListener('mousedown', away, true); } };
  setTimeout(() => addEventListener('mousedown', away, true), 0);
}

// ---- Markdown ----

const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function inline(s) {
  return esc(s)
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|[^*])\*([^*\n]+)\*/g, '$1<em>$2</em>')
    .replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, '<a data-href="$2">$1</a>')
    .replace(/(^|[\s(])(https?:\/\/[^\s<)]+)/g, '$1<a data-href="$2">$2</a>');
}

/// Renders a safe subset of Markdown: everything is escaped first, links open in
/// the system browser, and no raw HTML is ever passed through.
export function markdown(text, { onLink } = {}) {
  const out = [];
  const lines = String(text || '').replace(/\r/g, '').split('\n');
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (line.startsWith('```')) {
      const code = [];
      i++;
      while (i < lines.length && !lines[i].startsWith('```')) code.push(lines[i++]);
      i++;
      out.push(`<pre><code>${esc(code.join('\n'))}</code></pre>`);
      continue;
    }
    if (/^#{1,6}\s/.test(line)) { out.push(`<h3>${inline(line.replace(/^#+\s/, ''))}</h3>`); i++; continue; }
    if (/^\s*([-*•]|\d+\.)\s+/.test(line)) {
      const ordered = /^\s*\d+\./.test(line);
      const items = [];
      while (i < lines.length && /^\s*([-*•]|\d+\.)\s+/.test(lines[i])) items.push(`<li>${inline(lines[i++].replace(/^\s*([-*•]|\d+\.)\s+/, ''))}</li>`);
      out.push(ordered ? `<ol>${items.join('')}</ol>` : `<ul>${items.join('')}</ul>`);
      continue;
    }
    if (/^>\s?/.test(line)) { out.push(`<blockquote>${inline(line.replace(/^>\s?/, ''))}</blockquote>`); i++; continue; }
    if (/^(-{3,}|\*{3,})$/.test(line.trim())) { out.push('<hr>'); i++; continue; }
    if (/^\|.*\|$/.test(line.trim()) && i + 1 < lines.length && /^\|?\s*:?-+/.test(lines[i + 1].trim())) {
      const row = (l) => l.trim().replace(/^\||\|$/g, '').split('|').map((c) => inline(c.trim()));
      const head = row(line); i += 2;
      const body = [];
      while (i < lines.length && /^\|.*\|$/.test(lines[i].trim())) body.push(row(lines[i++]));
      out.push(`<table><tr>${head.map((h) => `<th>${h}</th>`).join('')}</tr>${body.map((r) => `<tr>${r.map((c) => `<td>${c}</td>`).join('')}</tr>`).join('')}</table>`);
      continue;
    }
    if (!line.trim()) { i++; continue; }
    const para = [];
    while (i < lines.length && lines[i].trim() && !/^(```|#{1,6}\s|>\s?|\s*([-*•]|\d+\.)\s+)/.test(lines[i])) para.push(inline(lines[i++]));
    out.push(`<p>${para.join('<br>')}</p>`);
  }
  const node = el('div', { class: 'md', html: out.join('') });
  node.addEventListener('click', (e) => {
    const a = e.target.closest('a[data-href]');
    if (a) { e.preventDefault(); onLink?.(a.dataset.href); }
  });
  return node;
}
