// Tools: Keep Awake, colour picker (from anywhere on screen), calculator, and a
// unit converter with currencies (Pro, open.er-api.com).
import { percent } from '../services/answers.js';
import { el, load } from '../store.js';
import { invoke, getJSON } from '../native.js';
import { canUse } from '../features.js';
import { toast, toggle, segmented } from '../ui.js';
import { calculate } from '../palette.js';
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

export function render(root) {
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
  // calculator
  const calcIn = el('input', { class: 'field mono', placeholder: '12 * (3 + 4) / 2' }), calcOut = el('div', { class: 'big num selectable' }, '—');
  calcIn.oninput = () => { const pa = percent(calcIn.value.trim().toLowerCase()); if (pa) { calcOut.textContent = pa.text; return; } const v = calculate(calcIn.value); calcOut.textContent = v === null ? '—' : v.toLocaleString(undefined, { maximumFractionDigits: 10 }); };
  calcIn.onkeydown = (e) => { if (e.key === 'Enter' && calcOut.textContent !== '—') invoke('clipboard_copy_text', { text: calcOut.textContent.replace(/,/g, '') }).then(() => toast('Copied')); };
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
  // Each block keeps its natural height (flex:none) and the page scrolls, instead of the cards being squeezed on top of each other.
  root.append(el('div', { class: 'col fill scroll' },
    el('div', { class: 'row', style: 'flex:none' },
      el('div', { class: 'card col gap-6' }, el('div', { class: 'section-title' }, '☕ Keep awake'),
        el('div', { class: 'hstack' }, el('span', { class: 'grow' }, 'Keep the PC awake'), awake),
        el('div', { class: 'hstack' }, el('span', { class: 'grow small dim' }, 'Keep the screen on too'), disp), mins),
      el('div', { class: 'card col gap-6' }, el('div', { class: 'section-title' }, '🎨 Colour'), el('div', { class: 'hstack' }, swatch, codes, el('div', { class: 'spacer' }), picker), eye)),
    el('div', { class: 'card col gap-6', style: 'flex:none' }, el('div', { class: 'section-title' }, '🔢 Calculator · Enter copies'), calcIn, calcOut),
    el('div', { class: 'card col gap-6', style: 'flex:none' }, el('div', { class: 'section-title' }, '📏 Convert'), el('div', { class: 'hstack wrap' }, kind, amount, from, el('span', {}, '→'), to), out)));
  show('#9e6bff'); fill();
}
