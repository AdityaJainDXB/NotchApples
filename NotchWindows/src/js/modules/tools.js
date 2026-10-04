// Tools: keep the PC awake, a quick calculator, a colour picker and a unit converter.
import { el, load, save } from '../store.js';
import { invoke } from '../app.js';

export function render(root) {
  // --- keep awake
  let awake = false;
  const awakeBtn = el('button', { class: 'btn quiet' }, 'Keep PC awake: Off');
  awakeBtn.addEventListener('click', async () => {
    awake = !awake;
    try {
      await invoke('set_keep_awake', { on: awake });
      awakeBtn.textContent = `Keep PC awake: ${awake ? 'On' : 'Off'}`;
      awakeBtn.style.background = awake ? 'var(--accent)' : '';
      awakeBtn.style.color = awake ? '#0b0b0b' : '';
    } catch { awake = !awake; awakeBtn.textContent = 'Keep PC awake: unavailable'; }
  });

  // --- calculator
  const calcIn = el('input', { class: 'field mono', placeholder: '12 * (3 + 4) / 2' });
  const calcOut = el('div', { class: 'big mono' }, '—');
  calcIn.addEventListener('input', () => {
    const expr = calcIn.value.trim();
    if (!expr) { calcOut.textContent = '—'; calcOut.className = 'big mono'; return; }
    // Only arithmetic is accepted; anything else is rejected rather than evaluated.
    if (!/^[0-9+\-*/%(). ]+$/.test(expr)) { calcOut.textContent = 'Numbers and + - * / % ( ) only'; calcOut.className = 'small err'; return; }
    try {
      const value = Function(`"use strict";return (${expr})`)();
      calcOut.textContent = Number.isFinite(value) ? String(Math.round(value * 1e10) / 1e10) : '—';
      calcOut.className = 'big mono';
    } catch { calcOut.textContent = '—'; calcOut.className = 'big mono'; }
  });

  // --- colour
  const colorIn = el('input', { type: 'color', value: '#9e6bff', style: 'width:52px;height:34px;border:none;background:none;cursor:pointer' });
  const swatch = el('div', { class: 'col', style: 'gap:2px' });
  const paintColor = () => {
    const hex = colorIn.value;
    const n = parseInt(hex.slice(1), 16);
    const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255];
    swatch.replaceChildren(
      el('div', { class: 'mono', style: 'font-weight:600' }, hex.toUpperCase()),
      el('div', { class: 'small mono dim' }, `rgb(${r}, ${g}, ${b})`));
  };
  colorIn.addEventListener('input', paintColor);
  paintColor();

  // --- unit converter
  const UNITS = {
    Length: { m: 1, km: 1000, cm: 0.01, mm: 0.001, mi: 1609.344, yd: 0.9144, ft: 0.3048, in: 0.0254 },
    Weight: { kg: 1, g: 0.001, lb: 0.45359237, oz: 0.028349523125, t: 1000 },
    Data: { B: 1, KB: 1e3, MB: 1e6, GB: 1e9, TB: 1e12, KiB: 1024, MiB: 1048576, GiB: 1073741824 },
    Temperature: { '°C': 'c', '°F': 'f', K: 'k' },
  };
  const kind = el('select', { class: 'field', style: 'flex:0 0 auto;width:auto' }, ...Object.keys(UNITS).map((k) => el('option', {}, k)));
  const amount = el('input', { class: 'field mono', value: '1', style: 'width:90px;flex:0 0 auto' });
  const from = el('select', { class: 'field', style: 'width:auto;flex:0 0 auto' });
  const to = el('select', { class: 'field', style: 'width:auto;flex:0 0 auto' });
  const convOut = el('div', { class: 'big mono' }, '—');
  const fillUnits = () => {
    const names = Object.keys(UNITS[kind.value]);
    from.replaceChildren(...names.map((n) => el('option', {}, n)));
    to.replaceChildren(...names.map((n) => el('option', {}, n)));
    to.selectedIndex = 1;
  };
  const toC = (v, u) => (u === '°C' ? v : u === '°F' ? (v - 32) * 5 / 9 : v - 273.15);
  const fromC = (c, u) => (u === '°C' ? c : u === '°F' ? c * 9 / 5 + 32 : c + 273.15);
  const convert = () => {
    const v = parseFloat(amount.value);
    if (!Number.isFinite(v)) { convOut.textContent = '—'; return; }
    const t = UNITS[kind.value];
    const r = kind.value === 'Temperature' ? fromC(toC(v, from.value), to.value) : v * t[from.value] / t[to.value];
    convOut.textContent = `${Math.round(r * 1e6) / 1e6} ${to.value}`;
  };
  kind.addEventListener('change', () => { fillUnits(); convert(); });
  for (const x of [amount, from, to]) x.addEventListener('input', convert);
  fillUnits(); convert();

  root.append(el('div', { class: 'col', style: 'height:100%;overflow:auto' },
    el('div', { class: 'row' },
      el('div', { class: 'card col' }, el('div', { class: 'section-title' }, '☕ Keep awake'),
        el('div', { class: 'small dim' }, 'Stops the screen sleeping while this is on.'), awakeBtn),
      el('div', { class: 'card col' }, el('div', { class: 'section-title' }, '🎨 Colour'),
        el('div', { style: 'display:flex;gap:10px;align-items:center' }, colorIn, swatch))),
    el('div', { class: 'card col' }, el('div', { class: 'section-title' }, '🔢 Calculator'), calcIn, calcOut),
    el('div', { class: 'card col' }, el('div', { class: 'section-title' }, '📏 Convert'),
      el('div', { style: 'display:flex;gap:6px;flex-wrap:wrap;align-items:center' }, kind, amount, from, el('span', {}, '→'), to), convOut)));
}
