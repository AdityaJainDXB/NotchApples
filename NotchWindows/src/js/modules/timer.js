// Timer and stopwatch with laps; both keep running when the notch is closed.
// Laid out like the Mac's Timer tab: a ring with presets on the left, the stopwatch on the right.
import { el, fmtClock, load, save } from '../store.js';
import { segmented } from '../ui.js';
import { canUse } from '../features.js';
import { proNote } from './activation.js';
import * as NT from '../services/namedtimers.js';
import { icon } from '../icons.js';
import * as T from '../services/timer.js';

const PRESETS = [[1, '1 min'], [3, '3 min'], [5, '5 min'], [10, '10 min'], [15, '15 min'], [30, '30 min'], [45, '45 min'], [60, '1 hr']];

export function render(root) {
  let minutes = 20;
  const time = el('div', { class: 'huge num', style: 'font-size:38px' });
  const ring = el('div', { class: 'ring', style: 'width:150px;flex:none' }, el('div', { class: 'inner' }, time));
  const mins = el('input', { class: 'field num', type: 'number', min: 1, max: 999, value: minutes, style: 'width:72px' });
  const main = el('button', { class: 'btn' });
  const wTime = el('div', { class: 'big num', style: 'font-size:34px' }), wMain = el('button', { class: 'btn' });
  const laps = el('div', { class: 'col gap-4 scroll', style: 'flex:1;min-height:0' });

  const paintTimer = () => {
    const t = T.timer(), left = T.timerLeft(t), active = t.running || t.remaining > 0;
    time.textContent = fmtClock(active ? left : (Number(mins.value) || 0) * 60);
    ring.style.setProperty('--p', String(active && t.total ? 100 - (left / t.total) * 100 : 0));
    main.replaceChildren(icon(t.running ? 'pause' : 'play', 16, t.running ? '⏸' : '▶'), t.running ? 'Pause' : active ? 'Resume' : 'Start');
  };
  const paintWatch = () => {
    const w = T.stopwatch();
    wTime.textContent = T.fmtMs(T.elapsed(w));
    wMain.replaceChildren(icon(w.running ? 'pause' : 'play', 16, w.running ? '⏸' : '▶'), w.running ? 'Stop' : 'Start');
    if (laps.dataset.n !== String(w.laps.length)) {
      laps.dataset.n = String(w.laps.length);
      laps.replaceChildren(...w.laps.map((l, i) => el('div', { class: 'hstack' }, el('span', { class: 'dim grow' }, `Lap ${w.laps.length - i}`), el('span', { class: 'num' }, T.fmtMs(l)))));
    }
  };
  const paint = () => { paintTimer(); paintWatch(); };

  main.onclick = () => { const t = T.timer(); if (t.running || t.remaining > 0) T.pauseTimer(); else T.startTimer((Number(mins.value) || 0) * 60); paint(); };
  wMain.onclick = () => { T.startStop(); paint(); };
  mins.oninput = paint;

  const presets = el('div', { style: 'display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:6px' },
    ...PRESETS.map(([m, label]) => el('button', { class: 'btn quiet', style: 'padding:5px 2px;min-width:0;font-size:12.5px', onclick: () => { T.startTimer(m * 60); paint(); } }, label)));

  const classic = (el('div', { class: 'row fill', style: 'gap:16px' },
    el('div', { class: 'card row', style: 'flex:1.7;min-width:0;align-items:center;gap:16px' }, ring,
      el('div', { class: 'col grow', style: 'gap:12px;min-width:0' },
        el('div', { class: 'section-title' }, 'Timer'), presets,
        el('div', { class: 'hstack' }, mins, el('span', { class: 'dim' }, 'min'),
          el('button', { class: 'btn quiet', onclick: () => { T.startTimer((Number(mins.value) || 0) * 60); paint(); } }, 'Start')),
        el('div', { class: 'hstack', style: 'flex-wrap:wrap' }, main,
          el('button', { class: 'btn quiet', onclick: () => { T.addTime(60); paint(); } }, '+1 min'),
          el('button', { class: 'btn quiet', onclick: () => { T.cancelTimer(); paint(); } }, 'Reset')))),
    el('div', { class: 'card col', style: 'flex:1;min-width:0' },
      el('div', { class: 'section-title' }, 'Stopwatch'), wTime,
      el('div', { class: 'hstack', style: 'flex-wrap:wrap' }, wMain,
        el('button', { class: 'btn quiet', onclick: () => { T.lap(); paint(); } }, 'Lap'),
        el('button', { class: 'btn quiet', onclick: () => { T.resetWatch(); paint(); } }, 'Reset')),
      laps)));

  // Named timers (Pro): several at once, each with its own name.
  const nIn = el('input', { class: 'field', placeholder: 'Pasta 10m · Egg 1:30 · Tea 3 min', style: 'flex:1' });
  const nMsg = el('div', { class: 'tiny', style: 'color:var(--warn,#ffb547);min-height:14px' });
  const nList = el('div', { class: 'col gap-4 scroll', style: 'flex:1;min-height:0' });
  const addNamed = () => { const m = T.addNamed(nIn.value); nMsg.textContent = m || ''; if (!m) nIn.value = ''; paintNamed(); };
  nIn.addEventListener('keydown', (e) => { if (e.key === 'Enter') addNamed(); });
  let sig = '', clocks = new Map();
  function paintNamed() {
    const list = T.named(), next = list.map((t) => `${t.id}${t.done ? '!' : ''}`).join();
    if (next !== sig) {   // rebuild only when timers come or go, so a click is never lost to a redraw
      sig = next; clocks = new Map();
      nList.replaceChildren(...(list.length ? list.map((t) => {
        const c = el('b', { class: 'num' });
        clocks.set(t.id, c);
        return el('div', { class: 'item hstack', style: 'padding:5px 10px;gap:8px' },
          el('span', {}, t.done ? '🔔' : '⏲'), el('span', { class: 'grow ellipsis', style: 'font-weight:600' }, t.name), c,
          el('button', { class: 'icon-btn', style: 'width:22px;height:22px', title: 'Remove', onclick: () => { T.removeNamed(t.id); paintNamed(); } }, '✕'));
      }) : [el('div', { class: 'small dim' }, 'Type a name and a time. Start as many as you need.')]));
    }
    for (const t of list) { const c = clocks.get(t.id); if (c) { c.textContent = t.done ? 'Done' : NT.clock(T.namedLeft(t)); c.style.color = t.done ? 'var(--warn,#ffb547)' : ''; } }
  }
  const named = canUse('namedTimers')
    ? el('div', { class: 'card col', style: 'flex:1;min-width:0;gap:8px' },
      el('div', { class: 'hstack' }, nIn, el('button', { class: 'btn', onclick: addNamed }, 'Start'),
        el('button', { class: 'btn quiet', onclick: () => { T.clearDoneNamed(); paintNamed(); } }, 'Clear done')), nMsg, nList)
    : el('div', { class: 'card col', style: 'flex:1' }, proNote('namedTimers'));
  let page = load('timer.page', 'timer');
  const pages = el('div', { class: 'col', style: 'flex:1;min-height:0' });
  const seg = segmented([{ value: 'timer', label: 'Timer' }, { value: 'named', label: 'Named' }], page, (v) => { page = v; save('timer.page', v); showPage(); });
  seg.style.alignSelf = 'flex-start';
  function showPage() { pages.replaceChildren(page === 'named' ? named : classic); classic.style.flex = '1'; paint(); }
  root.append(el('div', { class: 'col fill', style: 'gap:8px' }, seg, pages));
  showPage();
  const t = setInterval(() => { paint(); if (page === 'named' && canUse('namedTimers')) paintNamed(); }, 100);
  return () => clearInterval(t);
}
