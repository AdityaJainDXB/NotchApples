// Dev Tools (free, off until you turn it on in Settings → Tabs): JSON, Base64 and URL encoding, case changes, a JWT
// reader, hashes and ids, timestamps, a regex tester, a colour contrast checker and a QR code. Every tool has Paste and
// Copy, so it works on whatever you just copied. Runs on this PC only. The rules are in services/devkit.js.

import { el, load, save } from '../store.js';
import { toast } from '../ui.js';
import qrcode from '../vendor/qrcode.js';
import { stringToBytes } from '../vendor/qrcode-utf8.js';
import * as D from '../services/devkit.js';

qrcode.stringToBytes = stringToBytes;   // so links and text with accents scan correctly

const TOOLS = [['json', 'JSON', '{ }'], ['encoding', 'Base64 & URL', '⇄'], ['case', 'Case', 'Aa'], ['jwt', 'JWT', '🔑'], ['hashes', 'Hashes & IDs', '#'],
  ['time', 'Timestamps', '🕐'], ['regex', 'Regex', '✱'], ['contrast', 'Contrast', '◐'], ['qr', 'QR code', '▦']];

/// A QR code for `text` as a canvas (4-module quiet zone, black on white), or null for empty text.
export function qrCanvas(text, size = 130) {
  if (!text) return null;
  const q = qrcode(0, 'M');
  q.addData(text); q.make();
  const n = q.getModuleCount(), quiet = 4, cell = Math.max(2, Math.floor((size * 2) / (n + quiet * 2)));
  const px = (n + quiet * 2) * cell;
  const c = el('canvas', { width: px, height: px, style: `width:${size}px;height:${size}px;image-rendering:pixelated;border-radius:6px;background:#fff` });
  const g = c.getContext('2d');
  g.fillStyle = '#fff'; g.fillRect(0, 0, px, px); g.fillStyle = '#000';
  for (let r = 0; r < n; r++) for (let k = 0; k < n; k++) if (q.isDark(r, k)) g.fillRect((k + quiet) * cell, (r + quiet) * cell, cell, cell);
  return c;
}

export function render(root) {
  let tool = load('devtools.tool', 'json');
  if (!TOOLS.some(([id]) => id === tool)) tool = 'json';
  let input = '', output = '', note = '', pattern = '', ignoreCase = false, colourA = '#777777', colourB = '#ffffff', hashKind = 'SHA-256', loremWords = 50;

  const nav = el('div', { class: 'card col gap-4 scroll', style: 'flex:0 0 150px;padding:8px' });
  const main = el('div', { class: 'card col', style: 'flex:1;min-width:0;min-height:0;gap:8px;overflow:auto' });
  root.append(el('div', { class: 'row fill', style: 'gap:12px' }, nav, main));

  const btn = (label, fn, kind = '') => el('button', { class: `btn small ${kind}`.trim(), onclick: fn }, label);
  const outBox = el('pre', { class: 'mono small selectable', style: 'background:var(--surface);border-radius:10px;padding:8px;min-height:54px;max-height:170px;overflow:auto;white-space:pre-wrap;word-break:break-word;margin:0;flex:1' });
  const noteEl = el('div', { class: 'small warn' });
  const area = el('textarea', { class: 'field mono', style: 'min-height:62px;max-height:110px;resize:none', spellcheck: 'false' });
  area.addEventListener('input', () => { input = area.value; });
  const showOut = () => { outBox.textContent = output; noteEl.textContent = note; };
  const set = (result, bad = '') => { if (result != null) { output = result; note = ''; } else { output = ''; note = bad; } showOut(); };
  const paste = btn('Paste', async () => { try { area.value = input = await navigator.clipboard.readText(); } catch { toast('Allow clipboard access to paste', { error: true }); } }, 'quiet');
  const copy = btn('Copy', async () => { if (output) { await navigator.clipboard.writeText(output); toast('Copied'); } }, 'quiet');

  function jwt() {
    const j = D.decodeJWT(input);
    if (!j) return set(null, 'That doesn’t look like a JWT (three parts separated by dots).');
    const when = (d) => (d ? d.toLocaleString() : 'not set');
    set(`HEADER\n${j.header}\n\nPAYLOAD\n${j.payload}\n\nIssued: ${when(j.issued)}\nExpires: ${when(j.expires)}${j.isExpired() ? '  (expired)' : ''}\nNot before: ${when(j.notBefore)}\nSignature: ${j.hasSignature ? 'present, not checked' : 'none'}`);
  }
  function time() {
    const s = D.parseStamp(input);
    if (!s) return set(null, 'Enter seconds, milliseconds or an ISO date.');
    const d = new Date(s.seconds * 1000);
    set(`UTC: ${s.isoUTC}\nLocal: ${d.toLocaleString([], { dateStyle: 'full', timeStyle: 'medium' })}\nSeconds: ${Math.floor(s.seconds)}\nMilliseconds: ${Math.floor(s.seconds * 1000)}`);
  }
  function regex() {
    const r = D.regexTest(pattern, input, { ignoreCase, multiline: true });
    if (r.invalid) return set(null, r.invalid);
    set(r.matches.length ? `${r.matches.length} match${r.matches.length === 1 ? '' : 'es'}\n${r.matches.map((m, i) => `${i + 1}. ${m.text}${m.groups.length ? `\n   groups: ${m.groups.map((g) => `“${g}”`).join(', ')}` : ''}`).join('\n')}` : 'No matches.');
  }
  function contrast() {
    const c = D.contrast(colourA, colourB);
    if (!c) return set(null, 'Enter two colours like #333 and #ffffff.');
    const v = (ok) => (ok ? 'pass' : 'fail');
    set(`Contrast ratio ${c.ratio.toFixed(2)} : 1\nAA normal text (4.5): ${v(c.aaNormal)}\nAA large text (3): ${v(c.aaLarge)}\nAAA normal text (7): ${v(c.aaaNormal)}\nAAA large text (4.5): ${v(c.aaaLarge)}`);
  }

  function paint() {
    nav.replaceChildren(...TOOLS.map(([id, name, glyph]) => el('button', {
      class: `btn quiet ${id === tool ? 'on' : ''}`, style: 'justify-content:flex-start;gap:8px;width:100%',
      onclick: () => { tool = id; save('devtools.tool', id); output = ''; note = ''; paint(); } }, el('span', { style: 'width:18px;text-align:center' }, glyph), name)));
    const [, name] = TOOLS.find(([id]) => id === tool);
    area.placeholder = { json: 'Paste JSON', encoding: 'Text to encode or decode', case: 'Text to change', jwt: 'Paste a JWT', hashes: 'Text to hash',
      time: 'A timestamp (1516239022) or a date (2018-01-18T01:30:22Z)', regex: 'Text to search', qr: 'A link or some text' }[tool] || '';
    area.value = input;
    const rows = [el('div', { class: 'section-title' }, name)];
    const bar = (...items) => el('div', { class: 'hstack', style: 'flex-wrap:wrap;gap:6px' }, ...items);
    if (tool === 'json') rows.push(area, bar(paste, btn('Format', () => set(D.formatJSON(input), 'That isn’t valid JSON.')), btn('Minify', () => set(D.minifyJSON(input), 'That isn’t valid JSON.'))), outBox, bar(noteEl, el('span', { class: 'spacer' }), copy));
    else if (tool === 'encoding') rows.push(area, bar(paste, btn('Base64 encode', () => set(D.base64Encode(input))), btn('Base64 decode', () => set(D.base64Decode(input), 'That isn’t valid Base64 text.')),
      btn('URL encode', () => set(D.urlEncode(input))), btn('URL decode', () => set(D.urlDecode(input), 'That isn’t valid URL encoding.'))), outBox, bar(noteEl, el('span', { class: 'spacer' }), copy));
    else if (tool === 'case') rows.push(area, bar(paste, ...D.CASES.map((s) => btn(s, () => set(D.convert(input, s))))), outBox, bar(noteEl, el('span', { class: 'spacer' }), copy));
    else if (tool === 'jwt') rows.push(area, bar(paste, btn('Decode', jwt)), outBox, bar(noteEl, el('span', { class: 'spacer' }), copy), el('div', { class: 'tiny dim' }, 'Shows what’s inside. It can’t check the signature, because that needs the secret.'));
    else if (tool === 'hashes') {
      const kind = el('select', { class: 'field auto', onchange: (e) => { hashKind = e.target.value; } }, ...Object.keys(D.HASHES).map((k) => el('option', { value: k, selected: k === hashKind }, k)));
      const words = el('input', { class: 'field auto num', type: 'number', min: 5, max: 500, step: 5, value: loremWords, style: 'width:72px', oninput: (e) => { loremWords = Number(e.target.value) || 50; } });
      rows.push(area, bar(paste, kind, btn('Hash', async () => set(await D.hash(input, hashKind))), btn('New UUID', () => set(D.uuid()), 'quiet'), words, btn('Lorem ipsum', () => set(D.loremIpsum(loremWords)), 'quiet')), outBox, bar(noteEl, el('span', { class: 'spacer' }), copy));
    } else if (tool === 'time') rows.push(area, bar(paste, btn('Convert', time), btn('Now', () => { area.value = input = String(Math.floor(Date.now() / 1000)); time(); }, 'quiet')), outBox, bar(noteEl, el('span', { class: 'spacer' }), copy));
    else if (tool === 'regex') {
      const p = el('input', { class: 'field mono', placeholder: 'Pattern, e.g. (\\w+)@(\\w+)\\.com', value: pattern, oninput: (e) => { pattern = e.target.value; } });
      const ic = el('input', { type: 'checkbox', checked: ignoreCase, onchange: (e) => { ignoreCase = e.target.checked; } });
      rows.push(p, area, bar(el('label', { class: 'hstack small', style: 'gap:5px' }, ic, 'Ignore case'), btn('Test', regex), paste), outBox, bar(noteEl, el('span', { class: 'spacer' }), copy));
    } else if (tool === 'contrast') {
      const a = el('input', { class: 'field', placeholder: 'Text colour', value: colourA, oninput: (e) => { colourA = e.target.value; sample(); } });
      const b = el('input', { class: 'field', placeholder: 'Background', value: colourB, oninput: (e) => { colourB = e.target.value; sample(); } });
      const sampleEl = el('div', { style: 'padding:10px;border-radius:8px;font-weight:600;text-align:center' }, 'Sample text 14pt and large 18pt');
      const sample = () => { const x = D.rgb(colourA), y = D.rgb(colourB); if (x && y) { sampleEl.style.color = `rgb(${x.r * 255},${x.g * 255},${x.b * 255})`; sampleEl.style.background = `rgb(${y.r * 255},${y.g * 255},${y.b * 255})`; } };
      sample();
      rows.push(el('div', { class: 'hstack' }, a, b, btn('Check', contrast)), sampleEl, outBox, bar(noteEl, el('span', { class: 'spacer' }), copy));
      contrast();
    } else if (tool === 'qr') {
      const holder = el('div', { class: 'col', style: 'gap:6px;align-items:flex-start' });
      const draw = () => { const c = qrCanvas(input); holder.replaceChildren(...(c ? [c, el('div', { class: 'tiny dim' }, 'Scan it with your phone’s camera.')] : [el('div', { class: 'small dim' }, 'Type or paste something above.')])); };
      area.addEventListener('input', draw);
      rows.push(area, bar(btn('Make QR code', draw), paste), holder); draw();
    }
    main.replaceChildren(...rows);
    showOut();
  }
  paint();
}
