// Tools: keep the PC awake, a quick calculator, and a colour converter.
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

  root.append(el('div', { class: 'col', style: 'height:100%' },
    el('div', { class: 'row' },
      el('div', { class: 'card col' }, el('div', { class: 'section-title' }, '☕ Keep awake'),
        el('div', { class: 'small dim' }, 'Stops the screen sleeping while this is on.'), awakeBtn),
      el('div', { class: 'card col' }, el('div', { class: 'section-title' }, '🎨 Colour'),
        el('div', { style: 'display:flex;gap:10px;align-items:center' }, colorIn, swatch))),
    el('div', { class: 'card col' }, el('div', { class: 'section-title' }, '🔢 Calculator'), calcIn, calcOut)));
}
