// Focus: a Pomodoro timer. 25 min focus, 5 min break, longer break every 4th.
import { el, load, save } from '../store.js';

const SETTINGS = 'focus.settings';

export function render(root) {
  const cfg = load(SETTINGS, { focus: 25, short: 5, long: 15 });
  let mode = 'focus', remaining = cfg.focus * 60, running = false, completed = 0, timer = null;

  const time = el('div', { class: 'mono', style: 'font-size:62px;font-weight:700;letter-spacing:-2px' });
  const label = el('div', { class: 'section-title' });
  const startBtn = el('button', { class: 'btn' }, 'Start');
  const bar = el('i', { style: 'width:0%' });

  const total = () => (mode === 'focus' ? cfg.focus : mode === 'short' ? cfg.short : cfg.long) * 60;

  function paint() {
    const m = Math.floor(remaining / 60), s = remaining % 60;
    time.textContent = `${m}:${String(s).padStart(2, '0')}`;
    label.textContent = mode === 'focus' ? 'Focus session' : mode === 'short' ? 'Short break' : 'Long break';
    bar.style.width = `${100 - (remaining / total()) * 100}%`;
    startBtn.textContent = running ? 'Pause' : 'Start';
  }

  function next() {
    if (mode === 'focus') {
      completed++;
      mode = completed % 4 === 0 ? 'long' : 'short';
    } else mode = 'focus';
    remaining = total();
    try { new Notification('Notch apple', { body: mode === 'focus' ? 'Break over — back to it.' : 'Session done. Take a break.' }); } catch {}
    paint();
  }

  function tick() {
    if (!running) return;
    remaining--;
    if (remaining <= 0) next();
    paint();
  }

  startBtn.addEventListener('click', () => {
    running = !running;
    if (running && !timer) timer = setInterval(tick, 1000);
    paint();
  });

  const reset = () => { running = false; remaining = total(); paint(); };
  if ('Notification' in window && Notification.permission === 'default') Notification.requestPermission();

  paint();
  root.append(el('div', { class: 'center' },
    label, time,
    el('div', { class: 'bar', style: 'width:300px' }, bar),
    el('div', { style: 'display:flex;gap:8px;margin-top:6px' },
      startBtn,
      el('button', { class: 'btn quiet', onclick: reset }, 'Reset'),
      el('button', { class: 'btn quiet', onclick: () => { running = false; next(); } }, 'Skip')),
    el('div', { class: 'small dim' }, `${completed} session${completed === 1 ? '' : 's'} done today`)));

  return () => { if (timer) clearInterval(timer); };
}
