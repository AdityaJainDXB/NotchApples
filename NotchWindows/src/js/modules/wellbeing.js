// Wellbeing (free, off until you turn it on in Settings → Tabs): a breathing exercise, break reminders (eyes, water,
// stretch, posture) and a bedtime nudge. The rules are in services/wellbeing.js; the reminders run in the background.

import { el, load, save } from '../store.js';
import { segmented, toggle, select, setting } from '../ui.js';
import * as W from '../services/wellbeing.js';
import * as H from '../services/habits.js';
import { canUse } from '../features.js';
import { proNote } from './activation.js';

const hhmm = (m) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
const minutes = (s) => { const [h, m] = String(s).split(':').map(Number); return Number.isFinite(h) ? h * 60 + (m || 0) : null; };

export function render(root) {
  let pattern = load('wellbeing.pattern', 'box'), running = false, t0 = 0, raf = 0;
  if (!W.PATTERNS[pattern]) pattern = 'box';

  // ---- breathing ----
  const circle = el('div', { style: 'width:118px;height:118px;border-radius:50%;background:radial-gradient(circle at 35% 30%, var(--accent-bright), var(--accent));box-shadow:0 0 40px color-mix(in srgb, var(--accent) 55%, transparent);transform:scale(.45);transition:transform .12s linear' });
  const label = el('div', { class: 'big', style: 'font-size:20px' }, 'Ready');
  const sub = el('div', { class: 'small dim' }, 'Pick a pattern, then press Start.');
  const go = el('button', { class: 'btn', onclick: () => { running ? stop() : begin(); } }, 'Start');
  const pick = segmented(Object.entries(W.PATTERNS).map(([value, p]) => ({ value, label: p.short })), pattern, (v) => { pattern = v; save('wellbeing.pattern', v); if (running) begin(); });
  function begin() { running = true; t0 = performance.now(); go.textContent = 'Stop'; tick(); }
  function stop() { running = false; cancelAnimationFrame(raf); go.textContent = 'Start'; circle.style.transform = 'scale(.45)'; label.textContent = 'Ready'; sub.textContent = 'Pick a pattern, then press Start.'; }
  function tick() {
    if (!running) return;
    const b = W.breath(W.PATTERNS[pattern], (performance.now() - t0) / 1000);
    circle.style.transform = `scale(${0.45 + 0.55 * b.size})`;
    label.textContent = b.label; sub.textContent = `${b.secondsLeft}s · ${b.cycles} round${b.cycles === 1 ? '' : 's'} done`;
    raf = requestAnimationFrame(tick);
  }

  // ---- reminders ----
  const rem = el('div', { class: 'col scroll', style: 'gap:0;flex:1;min-height:0' });
  function paintReminders() {
    const c = W.config();
    const every = (k) => select([5, 10, 15, 20, 30, 45, 60, 90, 120].map((n) => ({ value: n, label: `${n} min` })), c.settings[k].every, (v) => W.setConfig({ settings: { ...W.config().settings, [k]: { ...W.config().settings[k], every: Number(v) } } }), { cls: 'auto' });
    const row = (k) => el('div', { class: 'setting' }, el('span', { style: 'font-size:18px;width:26px' }, W.BREAKS[k].icon),
      el('div', { class: 'text' }, el('div', { class: 'name' }, W.BREAKS[k].title), el('div', { class: 'desc' }, W.BREAKS[k].message), ),
      every(k), toggle(c.settings[k].on, (on) => { W.setConfig({ settings: { ...W.config().settings, [k]: { ...W.config().settings[k], on } } }); }));
    const time = (value, onchange) => { const i = el('input', { class: 'field auto', type: 'time', value: hhmm(value), style: 'width:110px' }); i.onchange = () => { const m = minutes(i.value); if (m !== null) onchange(m); }; return i; };
    rem.replaceChildren(
      setting('Break reminders', 'A notification and a note on the pill.', toggle(c.on, (on) => W.setConfig({ on }))),
      ...W.KINDS.map(row),
      setting('Only between', 'Outside these hours nothing reminds you.', el('div', { class: 'hstack' }, time(c.from, (m) => W.setConfig({ from: m })), el('span', { class: 'dim' }, 'and'), time(c.to, (m) => W.setConfig({ to: m })))),
      setting('Bedtime wind-down', 'A nudge before you go to bed, once a day.', el('div', { class: 'hstack' }, time(c.bedtime.at, (m) => W.setConfig({ bedtime: { ...W.config().bedtime, at: m } })), toggle(c.bedtime.on, (on) => W.setConfig({ bedtime: { ...W.config().bedtime, on } })))),
      el('div', { class: 'hstack', style: 'padding-top:8px' }, el('button', { class: 'btn small quiet', onclick: () => { W.snooze(60); } }, 'Snooze all for an hour')));
  }

  // ---- habits (Pro) ----
  const habitBox = el('div', { class: 'card col', style: 'flex:1;min-width:0;min-height:0;gap:8px' });
  function paintHabits() {
    if (!canUse('habits')) { habitBox.replaceChildren(proNote('habits', 'Build streaks: tick a habit each day and watch the run grow.')); return; }
    const today = H.todayKey();
    const input = el('input', { class: 'field', placeholder: 'A habit to build, e.g. Read 10 pages', maxlength: 40 });
    const add = () => { H.addHabit(input.value); paintHabits(); };
    input.onkeydown = (e) => { if (e.key === 'Enter') add(); };
    const rows = H.habits().map((h) => {
      const done = new Set(h.done), streak = H.currentStreak(done, today);
      return el('div', { class: 'item', style: 'gap:10px' },
        el('div', { class: 'main' }, el('div', { class: 'ellipsis', style: 'font-weight:600' }, h.name), el('div', { class: 'tiny dim' }, `Best ${H.bestStreak(done)} · ${H.thisWeek(done, today)} of the last 7 days`)),
        el('div', { class: 'hstack', style: 'gap:5px' }, ...H.lastDays(7, today).map((d) => el('button', { title: d === today ? 'Today' : d, class: 'icon-btn', style: `width:18px;height:18px;border-radius:50%;padding:0;background:${done.has(d) ? 'var(--accent)' : 'var(--surface-2, rgba(255,255,255,.12))'};${d === today ? 'box-shadow:0 0 0 1.5px var(--accent-bright)' : ''}`, onclick: () => { H.toggle(h.id, d); paintHabits(); } }))),
        el('b', { class: 'num', style: `width:46px;text-align:right;color:${streak ? '#ff9f0a' : 'var(--text-dim)'}`, title: 'Days in a row' }, `🔥 ${streak}`),
        el('button', { class: 'icon-btn', style: 'width:22px;height:22px', title: 'Delete', onclick: () => { H.removeHabit(h.id); paintHabits(); } }, '✕'));
    });
    habitBox.replaceChildren(el('div', { class: 'hstack' }, input, el('button', { class: 'btn', onclick: add }, 'Add')),
      ...(rows.length ? [el('div', { class: 'col gap-4 scroll', style: 'flex:1;min-height:0' }, ...rows)] : [el('div', { class: 'small dim' }, 'Nothing yet. Add a habit and tick it each day to build a streak.')]));
  }

  const calm = el('div', { class: 'row', style: 'gap:16px;flex:1;min-height:0' },
    el('div', { class: 'card col', style: 'flex:1;min-width:0;align-items:center;gap:8px' },
      el('div', { class: 'section-title', style: 'align-self:flex-start' }, 'Breathe'),
      el('div', { style: 'height:124px;display:grid;place-items:center' }, circle), label, sub, el('div', { class: 'hstack', style: 'flex-wrap:wrap;justify-content:center' }, go), pick),
    el('div', { class: 'card col', style: 'flex:1.6;min-width:0;min-height:0' }, el('div', { class: 'section-title' }, 'Reminders'), rem));
  let page = load('wellbeing.page', 'calm');
  const body = el('div', { class: 'row', style: 'flex:1;min-height:0' });
  const tabs = segmented([{ value: 'calm', label: 'Breathe & reminders' }, { value: 'habits', label: 'Habits' }], page, (v) => { page = v; save('wellbeing.page', v); showPage(); });
  function showPage() { if (page === 'habits') { paintHabits(); body.replaceChildren(habitBox); } else body.replaceChildren(calm); }
  root.append(el('div', { class: 'col fill', style: 'gap:10px' }, tabs, body));
  showPage();
  paintReminders();
  return () => { running = false; cancelAnimationFrame(raf); };
}
