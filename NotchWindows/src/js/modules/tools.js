// Tools, in three pages: Utilities (Keep Awake, the colour picker), Calculator (algebra that solves for letters,
// plus a unit and currency converter, Pro) and the Translator.
import { percent, unitConversion } from '../services/answers.js';
import { el, load, save } from '../store.js';
import { invoke, getJSON } from '../native.js';
import { canUse } from '../features.js';
import { toast, toggle, segmented } from '../ui.js';
import { MathSession } from '../services/mathengine.js';
import * as A from '../services/awake.js';

const UNITS = {
  Length: { m: 1, km: 1000, cm: 0.01, mm: 0.001, mi: 1609.344, yd: 0.9144, ft: 0.3048, in: 0.0254 },
  Weight: { kg: 1, g: 0.001, lb: 0.45359237, oz: 0.028349523125, t: 1000, st: 6.35029318 },
  Volume: { L: 1, mL: 0.001, gal: 3.785411784, qt: 0.946352946, cup: 0.2365882365, 'fl oz': 0.0295735296 },
  Speed: { 'km/h': 1, mph: 1.609344, 'm/s': 3.6, knot: 1.852 },
  Data: { B: 1, KB: 1e3, MB: 1e6, GB: 1e9, TB: 1e12, KiB: 1024, MiB: 1048576, GiB: 1073741824 },
  Temperature: { '°C': 0, '°F': 0, K: 0 },
  Currency: {},
};
let rates = null;

function utilitiesAndConverter() {
  // keep awake
  const s = A.state();
  let minutes = 0;
  const apply = async (on) => { try { await A.set(on, { display: disp.querySelector('input').checked, minutes }); toast(on ? 'Keeping your PC awake' : 'Keep Awake is off'); } catch (e) { toast(e.message, { error: true }); } };
  const mins = segmented([{ value: 30, label: '30 min' }, { value: 60, label: '1 hour' }, { value: 120, label: '2 hours' }, { value: 0, label: 'Always' }], 0, (v) => { minutes = v; if (awake.querySelector('input').checked) apply(true); });
  const awake = toggle(s.on, apply);
  const disp = toggle(s.display, () => {});
  // colour
  const swatch = el('div', { style: 'width:44px;height:44px;border-radius:10px;border:1px solid var(--border);background:#9e6bff' });
  const codes = el('div', { class: 'col gap-4 small mono selectable' });
  const show = (hex) => { swatch.style.background = hex; const n = parseInt(hex.slice(1), 16); codes.replaceChildren(el('div', {}, hex.toUpperCase()), el('div', { class: 'dim' }, `rgb(${n >> 16 & 255}, ${n >> 8 & 255}, ${n & 255})`)); };
  const picker = el('input', { type: 'color', value: '#9e6bff', oninput: (e) => show(e.target.value) });
  const eye = el('button', { class: 'btn quiet small', onclick: async () => {
    if (!window.EyeDropper) return toast('Picking from the screen needs a newer WebView2.', { error: true });
    try { const r = await new window.EyeDropper().open(); show(r.sRGBHex); picker.value = r.sRGBHex; await invoke('clipboard_copy_text', { text: r.sRGBHex.toUpperCase() }); toast(`${r.sRGBHex.toUpperCase()} copied`); } catch {}
  } }, '💧 Pick from screen');
  // converter
  const kind = el('select', { class: 'field auto' }, ...Object.keys(UNITS).map((k) => el('option', {}, k)));
  const amount = el('input', { class: 'field mono', value: '1', style: 'width:100px' });
  const from = el('select', { class: 'field auto' }), to = el('select', { class: 'field auto' });
  const out = el('div', { class: 'big num selectable' }, '—');
  async function fill() {
    let names = Object.keys(UNITS[kind.value]);
    if (kind.value === 'Currency') {
      if (!canUse('currency')) { out.textContent = 'Currencies are part of Pro'; from.replaceChildren(); to.replaceChildren(); return; }
      if (!rates) { out.textContent = 'Loading rates…'; try { rates = (await getJSON('https://open.er-api.com/v6/latest/USD')).rates; } catch { out.textContent = 'Rates unavailable'; return; } }
      names = Object.keys(rates);
    }
    from.replaceChildren(...names.map((n) => el('option', {}, n))); to.replaceChildren(...names.map((n) => el('option', {}, n)));
    if (kind.value === 'Currency') { from.value = 'USD'; to.value = 'EUR'; } else to.selectedIndex = 1;
    convert();
  }
  const toC = (v, u) => (u === '°C' ? v : u === '°F' ? (v - 32) * 5 / 9 : v - 273.15), fromC = (c, u) => (u === '°C' ? c : u === '°F' ? c * 9 / 5 + 32 : c + 273.15);
  function convert() {
    const v = parseFloat(amount.value);
    if (!Number.isFinite(v) || !from.value) return;
    let r;
    if (kind.value === 'Temperature') r = fromC(toC(v, from.value), to.value);
    else if (kind.value === 'Currency') r = v / rates[from.value] * rates[to.value];
    else r = v * UNITS[kind.value][from.value] / UNITS[kind.value][to.value];
    out.textContent = `${r.toLocaleString(undefined, { maximumFractionDigits: kind.value === 'Currency' ? 2 : 6 })} ${to.value}`;
  }
  kind.onchange = fill; amount.oninput = convert; from.onchange = convert; to.onchange = convert;
  const utilities = el('div', { class: 'col fill scroll' },
    el('div', { class: 'row', style: 'flex:none' },
      el('div', { class: 'card col gap-6' }, el('div', { class: 'section-title' }, '☕ Keep awake'),
        el('div', { class: 'hstack' }, el('span', { class: 'grow' }, 'Keep the PC awake'), awake),
        el('div', { class: 'hstack' }, el('span', { class: 'grow small dim' }, 'Keep the screen on too'), disp), mins),
      el('div', { class: 'card col gap-6' }, el('div', { class: 'section-title' }, '🎨 Colour'), el('div', { class: 'hstack' }, swatch, codes, el('div', { class: 'spacer' }), picker), eye)));
  const converter = el('div', { class: 'card col gap-6', style: 'flex:none' }, el('div', { class: 'section-title' }, '📏 Convert'), el('div', { class: 'hstack wrap' }, kind, amount, from, el('span', {}, '→'), to), out);
  show('#9e6bff'); fill();
  return { utilities, converter };
}

/// Calculator page: one step per line, each worked out in order, so later lines can use earlier ones
/// (a = 5, then 2a + 1). Equations, systems, factor and diff work too (services/mathengine.js).
function calculatorPage(converter) {
  const input = el('textarea', { class: 'field mono', style: 'flex:1;min-height:120px;resize:none', spellcheck: false,
    placeholder: 'a = 5\n2a + 1\n2x + 3 = 11\nx^2 - 5x + 6 = 0\nfactor(x^2 - 1)\ndiff(x^3, x)' });
  input.value = load('tools.calcInput', '');
  const answers = el('div', { class: 'col gap-6 scroll selectable', style: 'flex:1;min-height:0' });
  const copy = el('button', { class: 'btn quiet small', onclick: () => { const t = answers.dataset.last; if (t) invoke('clipboard_copy_text', { text: t }).then(() => toast('Copied')); } }, 'Copy last answer');
  function paint() {
    save('tools.calcInput', input.value);
    const session = new MathSession();
    const lines = input.value.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
    let last = '';
    answers.replaceChildren(...lines.map((raw) => {
      const pa = percent(raw.toLowerCase()) || unitConversion(raw);   // "12% of 80", "200 + 15%", "5 km to mi"
      const r = pa ? { output: [pa.text], kind: 'value' } : session.runLine(raw);
      const usable = r.kind !== 'error' && r.output.length;
      if (usable) last = (r.output[0] || '').replace(/^\w+ = /, '').replace(/,/g, '');
      return el('div', { class: 'col', style: 'gap:1px' },
        el('div', { class: 'tiny faint mono ellipsis' }, raw),
        ...r.output.map((o) => el('div', { class: r.kind === 'value' ? 'big num' : '', style: r.kind === 'value' ? '' : `font-weight:600;${r.kind === 'error' ? 'color:var(--warn,#ff9f43)' : ''}` }, r.kind === 'value' ? `= ${o}` : o)));
    }));
    if (!lines.length) answers.append(el('div', { class: 'small dim' }, 'Answers appear here as you type.'));
    answers.dataset.last = last;
  }
  input.oninput = paint;
  paint();
  return el('div', { class: 'col fill scroll' },
    el('div', { class: 'row', style: 'flex:none;min-height:230px' },
      el('div', { class: 'card col gap-6', style: 'flex:1;min-width:0' }, el('div', { class: 'section-title' }, '🔢 Calculator'), input,
        el('div', { class: 'tiny faint' }, 'One step per line: a = 5, then 2a + 1. Try 2x + 3 = 11, x^2 - 5x + 6 = 0, factor(x^2 - 1), diff(x^3, x).')),
      el('div', { class: 'card col gap-6', style: 'flex:1;min-width:0' }, el('div', { class: 'hstack' }, el('div', { class: 'section-title grow' }, 'Answers'), copy), answers)),
    converter);
}

export function render(root) {
  let page = load('tools.page', 'utilities');
  if (!['utilities', 'calculator', 'translator'].includes(page)) page = 'utilities';
  const { utilities, converter } = utilitiesAndConverter();
  const calc = calculatorPage(converter);
  const host = el('div', { class: 'col fill', style: 'min-height:0' });
  let translatorBuilt = false;
  const translator = el('div', { class: 'col fill' });
  function paint() {
    host.replaceChildren(page === 'utilities' ? utilities : page === 'calculator' ? calc : translator);
    if (page === 'translator' && !translatorBuilt) { translatorBuilt = true; import('./translator.js').then((m) => m.render(translator)); }
  }
  const pages = segmented([{ value: 'utilities', label: 'Utilities' }, { value: 'calculator', label: 'Calculator' }, { value: 'translator', label: 'Translator' }], page, (v) => { page = v; save('tools.page', v); paint(); });
  root.append(el('div', { class: 'col fill', style: 'gap:8px' }, el('div', { class: 'hstack', style: 'flex:none' }, pages), host));
  paint();
}
