// Focus (Pro): a Pomodoro timer that keeps running when the notch is closed.
// Laid out like the Mac's Focus tab: the ring on the left, the mode picker, buttons and session dots on the right.
import { el } from '../store.js';
import { segmented, toggle as sw } from '../ui.js';
import { icon } from '../icons.js';
import * as F from '../services/focus.js';
import { goalFraction } from '../services/wellbeing.js';
import { canUse } from '../features.js';

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
  const goalBar = el('div', { class: 'col', style: 'gap:4px' });
  // Project (Pro): what this session counts towards, and this week split by project.
  const projectIn = el('input', { class: 'field', style: 'width:170px', placeholder: 'Project (optional)', value: F.project(), list: 'focus-projects', onchange: (e) => { F.setProject(e.target.value); e.target.value = F.project(); paint(); } });
  const projectList = el('datalist', { id: 'focus-projects' });
  const projectSum = el('div', { class: 'tiny dim' });
  const projectRow = canUse('focusProjects') ? el('div', { class: 'col', style: 'gap:4px' }, el('div', { class: 'hstack', style: 'gap:6px' }, el('span', { class: 'dim' }, '📁'), projectIn, projectList), projectSum) : null;
  const c = F.cfg();
  const num = (k, v, lo, hi) => { const i = el('input', { type: 'number', class: 'field', min: lo, max: hi, value: v, style: 'width:64px' }); i.onchange = () => { F.setCfg({ [k]: Math.max(lo, Math.min(hi, Number(i.value) || v)) }); paint(); }; return i; };
  const num0 = () => { const i = el('input', { type: 'number', class: 'field', min: 0, max: 1440, value: F.dailyGoal(), style: 'width:72px' }); i.onchange = () => { F.setDailyGoal(i.value); paint(); }; return i; };
  const settings = el('div', { class: 'card col hidden', style: 'gap:8px' },
    ...[['Focus (min)', 'focus', 1, 180], ['Short break', 'short', 1, 60], ['Long break', 'long', 1, 90], ['Rounds before a long break', 'rounds', 1, 12]]
      .map(([name, k, lo, hi]) => el('div', { class: 'hstack' }, el('span', { class: 'grow' }, name), num(k, c[k], lo, hi))),
    el('div', { class: 'hstack' }, el('span', { class: 'grow' }, 'Daily goal (min, 0 = none)'), num0()),
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
    const goal = F.dailyGoal(), mins = F.minutesToday();
    if (projectRow) {
      projectList.replaceChildren(...F.projectNames().map((n) => el('option', { value: n })));
      projectSum.textContent = F.weekByProject().slice(0, 3).map((p) => `${p.project} ${Math.floor(p.minutes / 60)}h ${p.minutes % 60}m`).join(' · ');
    }
    goalBar.replaceChildren(...(goal > 0 ? [el('div', { class: 'hstack small' }, el('span', { class: 'dim grow' }, `Daily goal: ${mins} of ${goal} min`), el('b', { class: goalFraction(mins, goal) >= 1 ? 'ok' : '' }, `${Math.round(goalFraction(mins, goal) * 100)}%`)),
      el('div', { class: 'bar' }, el('i', { style: `width:${Math.round(goalFraction(mins, goal) * 100)}%` }))] : []));
  }
  root.append(el('div', { class: 'row fill', style: 'gap:18px;align-items:center' }, ring,
    el('div', { class: 'col grow', style: 'gap:14px;min-width:0' }, mode,
      el('div', { class: 'hstack' }, main,
        el('button', { class: 'btn quiet', onclick: () => { F.reset(); paint(); } }, 'Reset'),
        el('button', { class: 'btn quiet', onclick: () => { F.skip(); paint(); } }, 'Skip')),
      el('div', { class: 'hstack' }, dots, stats), goalBar, projectRow,
      el('div', { class: 'dim' }, `The countdown also shows beside the notch while it runs. Every ${F.cfg().rounds}th session earns a long break.`),
      el('button', { class: 'btn small ghost', style: 'align-self:flex-start', onclick: () => settings.classList.toggle('hidden') }, 'Durations…'),
      settings)));
  paint();
  const t = setInterval(paint, 1000);
  return () => clearInterval(t);
}
