// Focus (Pro): a Pomodoro timer that keeps running when the notch is closed.
import { el } from '../store.js';
import { toggle as sw } from '../ui.js';
import * as F from '../services/focus.js';

export function render(root) {
  const time = el('div', { class: 'huge num', style: 'font-size:64px' });
  const label = el('div', { class: 'section-title' });
  const btn = el('button', { class: 'btn', style: 'min-width:90px', onclick: () => { F.startPause(); paint(); } });
  const ring = el('div', { class: 'ring', style: 'width:210px' }, el('div', { class: 'inner' }, el('div', { class: 'col', style: 'align-items:center;gap:2px' }, label, time)));
  const stats = el('div', { class: 'small dim' });
  const num = (k, v, lo, hi) => { const i = el('input', { type: 'number', class: 'field', min: lo, max: hi, value: v, style: 'width:64px' }); i.onchange = () => F.setCfg({ [k]: Math.max(lo, Math.min(hi, Number(i.value) || v)) }); return i; };
  const c = F.cfg();
  function paint() {
    const s = F.get(), left = F.secondsLeft(s);
    time.textContent = `${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}`;
    label.textContent = s.mode === 'focus' ? `Focus · round ${s.round}` : s.mode === 'short' ? 'Short break' : 'Long break';
    ring.style.setProperty('--p', String(100 - (left / F.lengthOf(s.mode)) * 100));
    btn.textContent = s.running ? 'Pause' : 'Start';
    const h = F.history(); const week = Object.entries(h).filter(([d]) => Date.now() - new Date(d) < 7 * 864e5).reduce((a, [, m]) => a + m, 0);
    stats.textContent = `${F.sessionsToday()} sessions today · ${Math.round(week / 60 * 10) / 10} h this week`;
  }
  root.append(el('div', { class: 'row fill' },
    el('div', { class: 'card center', style: 'flex:1.3' }, el('div', { class: 'col', style: 'align-items:center;gap:12px' }, ring,
      el('div', { class: 'hstack' }, btn, el('button', { class: 'btn quiet', onclick: () => { F.reset(); paint(); } }, 'Reset'), el('button', { class: 'btn quiet', onclick: () => { F.skip(); paint(); } }, 'Skip')), stats)),
    el('div', { class: 'card col', style: 'flex:1' }, el('div', { class: 'section-title' }, 'Settings'),
      el('div', { class: 'hstack' }, el('span', { class: 'grow' }, 'Focus (min)'), num('focus', c.focus, 1, 180)),
      el('div', { class: 'hstack' }, el('span', { class: 'grow' }, 'Short break'), num('short', c.short, 1, 60)),
      el('div', { class: 'hstack' }, el('span', { class: 'grow' }, 'Long break'), num('long', c.long, 1, 90)),
      el('div', { class: 'hstack' }, el('span', { class: 'grow' }, 'Rounds before long break'), num('rounds', c.rounds, 1, 12)),
      el('div', { class: 'hstack' }, el('span', { class: 'grow' }, 'Start the next one automatically'), sw(c.autoStart, (v) => F.setCfg({ autoStart: v }))),
      el('div', { class: 'tiny faint' }, 'Block distracting apps during Focus in the Screen Time tab.'))));
  paint();
  const t = setInterval(paint, 1000);
  return () => clearInterval(t);
}
