// Timer and stopwatch with laps; both keep running when the notch is closed.
import { el, fmtClock } from '../store.js';
import * as T from '../services/timer.js';

export function render(root) {
  const tDisplay = el('div', { class: 'huge num' }), tBtn = el('button', { class: 'btn' });
  const label = el('input', { class: 'field', placeholder: 'Label (optional)' });
  const mins = el('input', { class: 'field', type: 'number', min: 0, value: 5, style: 'width:70px' });
  const secs = el('input', { class: 'field', type: 'number', min: 0, max: 59, value: 0, style: 'width:70px' });
  const wDisplay = el('div', { class: 'big num' }), wBtn = el('button', { class: 'btn' }), laps = el('div', { class: 'col gap-4 scroll', style: 'flex:1' });
  const preset = (m) => el('button', { class: 'chip clickable', onclick: () => { T.startTimer(m * 60); paint(); } }, `${m} min`);
  tBtn.onclick = () => { const t = T.timer(); if (t.running || t.remaining) T.pauseTimer(); else T.startTimer((Number(mins.value) || 0) * 60 + (Number(secs.value) || 0), label.value.trim()); paint(); };
  wBtn.onclick = () => { T.startStop(); paint(); };
  function paint() {
    const t = T.timer(), left = T.timerLeft(t);
    tDisplay.textContent = t.running || t.remaining ? fmtClock(left) : `${fmtClock((Number(mins.value) || 0) * 60 + (Number(secs.value) || 0))}`;
    tBtn.textContent = t.running ? 'Pause' : t.remaining ? 'Resume' : 'Start';
    const w = T.stopwatch();
    wDisplay.textContent = T.fmtMs(T.elapsed(w));
    wBtn.textContent = w.running ? 'Stop' : 'Start';
    if (laps.childElementCount !== w.laps.length) laps.replaceChildren(...w.laps.map((l, i) => el('div', { class: 'hstack small' }, el('span', { class: 'dim grow' }, `Lap ${w.laps.length - i}`), el('span', { class: 'num' }, T.fmtMs(l)))));
  }
  root.append(el('div', { class: 'row fill' },
    el('div', { class: 'card col', style: 'flex:1;align-items:center;justify-content:center' }, el('div', { class: 'section-title' }, 'Timer'), tDisplay,
      el('div', { class: 'hstack' }, mins, el('span', {}, 'min'), secs, el('span', {}, 's')), label,
      el('div', { class: 'hstack wrap', style: 'gap:4px;justify-content:center' }, preset(1), preset(5), preset(10), preset(15), preset(30), preset(60)),
      el('div', { class: 'hstack' }, tBtn, el('button', { class: 'btn quiet', onclick: () => { T.addTime(60); paint(); } }, '+1 min'), el('button', { class: 'btn quiet', onclick: () => { T.cancelTimer(); paint(); } }, 'Cancel'))),
    el('div', { class: 'card col', style: 'flex:1;align-items:center' }, el('div', { class: 'section-title' }, 'Stopwatch'), wDisplay,
      el('div', { class: 'hstack' }, wBtn, el('button', { class: 'btn quiet', onclick: () => { T.lap(); paint(); } }, 'Lap'), el('button', { class: 'btn quiet', onclick: () => { T.resetWatch(); paint(); } }, 'Reset')), laps)));
  mins.oninput = secs.oninput = paint;
  paint();
  const t = setInterval(paint, 100);
  return () => clearInterval(t);
}
