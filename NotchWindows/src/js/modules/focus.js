// Focus (Pro): a Pomodoro timer that keeps running when the notch is closed.
// Laid out like the Mac's Focus tab: the ring on the left, the mode picker, buttons and session dots on the right.
import { el } from '../store.js';
import { segmented, toggle as sw } from '../ui.js';
import { icon } from '../icons.js';
import * as F from '../services/focus.js';

const MODE_LABEL = { focus: 'Focus', short: 'Break', long: 'Long break' };

export function render(root) {
  const time = el('div', { class: 'huge num', style: 'font-size:58px' });
  const label = el('div', { class: 'dim', style: 'font-size:16px' });
  const ring = el('div', { class: 'ring', style: 'width:210px;flex:none' }, el('div', { class: 'inner' }, el('div', { class: 'col', style: 'align-items:center;gap:2px' }, time, label)));
  const mode = segmented([{ value: 'focus', label: 'Focus' }, { value: 'short', label: 'Break' }, { value: 'long', label: 'Long break' }], F.get().mode, (v) => { F.setMode(v); paint(); });
  mode.style.alignSelf = 'flex-start';
  const main = el('button', { class: 'btn', style: 'min-width:130px', onclick: () => { F.startPause(); paint(); } });
  const dots = el('div', { class: 'hstack', style: 'gap:8px' });
  const stats = el('span', { class: 'dim' });
  const c = F.cfg();
  const num = (k, v, lo, hi) => { const i = el('input', { type: 'number', class: 'field', min: lo, max: hi, value: v, style: 'width:64px' }); i.onchange = () => { F.setCfg({ [k]: Math.max(lo, Math.min(hi, Number(i.value) || v)) }); paint(); }; return i; };
  const settings = el('div', { class: 'card col hidden', style: 'gap:8px' },
    ...[['Focus (min)', 'focus', 1, 180], ['Short break', 'short', 1, 60], ['Long break', 'long', 1, 90], ['Rounds before a long break', 'rounds', 1, 12]]
      .map(([name, k, lo, hi]) => el('div', { class: 'hstack' }, el('span', { class: 'grow' }, name), num(k, c[k], lo, hi))),
    el('div', { class: 'hstack' }, el('span', { class: 'grow' }, 'Start the next one automatically'), sw(c.autoStart, (v) => F.setCfg({ autoStart: v }))),
    el('div', { class: 'small dim' }, 'Block distracting apps during Focus in the Screen Time tab.'));

  function paint() {
    const s = F.get(), left = F.secondsLeft(s);
    time.textContent = `${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}`;
    label.textContent = MODE_LABEL[s.mode];
    ring.style.setProperty('--p', String(100 - (left / F.lengthOf(s.mode)) * 100));
    mode.setValue(s.mode);
    main.replaceChildren(icon(s.running ? 'pause' : 'play', 16, s.running ? '⏸' : '▶'), s.running ? 'Pause' : 'Start');
    const n = F.sessionsToday(), per = F.cfg().rounds;
    dots.replaceChildren(...Array.from({ length: per }, (_, i) => el('span', { style: `width:14px;height:14px;border-radius:50%;background:${i < n % per || (n > 0 && n % per === 0) ? 'var(--accent-bright)' : 'rgba(255,255,255,.14)'}` })));
    stats.textContent = `${n} focus session${n === 1 ? '' : 's'} today`;
  }
  root.append(el('div', { class: 'row fill', style: 'gap:18px;align-items:center' }, ring,
    el('div', { class: 'col grow', style: 'gap:14px;min-width:0' }, mode,
      el('div', { class: 'hstack' }, main,
        el('button', { class: 'btn quiet', onclick: () => { F.reset(); paint(); } }, 'Reset'),
        el('button', { class: 'btn quiet', onclick: () => { F.skip(); paint(); } }, 'Skip')),
      el('div', { class: 'hstack' }, dots, stats),
      el('div', { class: 'dim' }, `The countdown also shows beside the notch while it runs. Every ${F.cfg().rounds}th session earns a long break.`),
      el('button', { class: 'btn small ghost', style: 'align-self:flex-start', onclick: () => settings.classList.toggle('hidden') }, 'Durations…'),
      settings)));
  paint();
  const t = setInterval(paint, 1000);
  return () => clearInterval(t);
}
