// To-do, from the Mac's TodoView: lists, due dates with reminders (a Windows
// notification and a flash on the pill), notes, and done items that sink.
// Type naturally: "Call mum tomorrow 6pm" sets the due time for you.

import { el, load, save, uid, dayLabel, fmtTime } from '../store.js';
import { iconBtn, menu, toast, prompt, empty } from '../ui.js';
import * as R from '../services/reminders.js';
import { parseWhen } from './quickadd.js';
import { RULES, nextDue, ruleLabel } from '../services/recur.js';

export function render(root, opts = {}) {
  let list = load('todo.list', 'All');
  let showDone = load('todo.showDone', true);
  const input = el('input', { class: 'field', placeholder: 'Add a to-do… e.g. “Pay rent on the 1st” or “Call mum tomorrow 6pm”' });
  const hint = el('div', { class: 'tiny faint', style: 'min-height:14px' });
  const listsBox = el('div', { class: 'col gap-4' });
  const items = el('div', { class: 'col gap-4 scroll', style: 'flex:1' });

  const lists = () => ['All', 'Today', 'Upcoming', ...new Set(['Inbox', ...load('todo.lists', []), ...R.todos().map((t) => t.list || 'Inbox')])];

  function visible() {
    const now = new Date(); const endOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1).getTime();
    return R.todos().filter((t) => {
      if (!showDone && t.done) return false;
      if (list === 'All') return true;
      if (list === 'Today') return t.due && t.due < endOfDay;
      if (list === 'Upcoming') return t.due && t.due >= endOfDay;
      return (t.list || 'Inbox') === list;
    }).sort((a, b) => Number(a.done) - Number(b.done) || (a.due || Infinity) - (b.due || Infinity) || b.created - a.created);
  }

  function paintLists() {
    const all = R.todos();
    listsBox.replaceChildren(...lists().map((name) => {
      const count = name === 'All' ? all.filter((t) => !t.done).length : name === 'Today' || name === 'Upcoming' ? null : all.filter((t) => !t.done && (t.list || 'Inbox') === name).length;
      return el('div', { class: `item clickable ${list === name ? 'selected' : ''}`, style: 'padding:5px 8px', onclick: () => { list = name; save('todo.list', list); paint(); } },
        el('span', {}, { All: '📋', Today: '📅', Upcoming: '🗓', Inbox: '📥' }[name] || '•'), el('span', { class: 'main ellipsis' }, name),
        count ? el('span', { class: 'tiny faint' }, count) : null);
    }), el('button', { class: 'btn small ghost', onclick: async () => {
      const name = await prompt('New list', { placeholder: 'e.g. Shopping', ok: 'Add' });
      if (name && !lists().includes(name)) { save('todo.lists', [...load('todo.lists', []), name]); list = name; save('todo.list', list); paint(); }
    } }, '+ New list'));
  }

  function due(t) {
    if (!t.due) return null;
    const late = !t.done && t.due < Date.now();
    return el('span', { class: `tiny ${late ? 'bad' : 'faint'}` }, `${t.remind ? '🔔 ' : ''}${dayLabel(t.due)} ${fmtTime(t.due)}${t.repeat ? ` · ↻ ${ruleLabel(t.repeat).toLowerCase()}` : ''}`);
  }

  function paintItems() {
    const shown = visible();
    items.replaceChildren(...shown.map((t) => {
      const row = el('div', { class: 'item', style: 'padding:6px 10px' },
        el('input', { type: 'checkbox', checked: t.done, onchange: () => tick(t) }),
        el('div', { class: 'main', ondblclick: () => rename(t) },
          el('div', { style: `${t.done ? 'text-decoration:line-through;opacity:.5' : ''}` }, t.text),
          el('div', { class: 'hstack', style: 'gap:8px' }, due(t), list === 'All' && t.list && t.list !== 'Inbox' ? el('span', { class: 'tiny faint' }, t.list) : null,
            t.notes ? el('span', { class: 'tiny faint ellipsis' }, t.notes) : null)),
        el('div', { class: 'actions' }, iconBtn('⏰', 'Due date', () => setDue(t)), iconBtn('🗑', 'Delete', () => del(t.id))));
      row.addEventListener('contextmenu', (e) => menu(e, [
        { label: 'Rename', run: () => rename(t) },
        { label: t.due ? 'Change due date' : 'Add a due date', run: () => setDue(t) },
        t.due ? { label: 'Snooze 10 minutes', run: () => snooze(t, Date.now() + 10 * 60e3) } : null,
        t.due ? { label: 'Snooze 1 hour', run: () => snooze(t, Date.now() + 60 * 60e3) } : null,
        t.due ? { label: 'Snooze until tomorrow 9am', run: () => { const d = new Date(); d.setDate(d.getDate() + 1); d.setHours(9, 0, 0, 0); snooze(t, d.getTime()); } } : null,
        t.due ? { label: t.repeat ? `Repeats: ${ruleLabel(t.repeat).toLowerCase()} (change)` : 'Repeat…', run: () => setRepeat(t) } : null,
        t.due ? { label: 'Remove due date', run: () => update(t.id, { due: null, remind: false, repeat: null }) } : null,
        { label: 'Add a note', run: async () => { const n = await prompt('Note', { value: t.notes || '' }); if (n !== null) update(t.id, { notes: n }); } },
        'sep',
        ...lists().filter((l) => !['All', 'Today', 'Upcoming', t.list || 'Inbox'].includes(l)).map((l) => ({ label: `Move to ${l}`, run: () => update(t.id, { list: l }) })),
        { label: 'Delete', danger: true, run: () => del(t.id) },
      ]));
      return row;
    }));
    if (!shown.length) items.append(empty('✅', list === 'Today' ? 'Nothing due today' : 'All done', 'Add a to-do above. Give it a time to get a reminder.'));
  }

  function paint() { paintLists(); paintItems(); }
  const update = (id, patch) => { R.saveTodos(R.todos().map((t) => (t.id === id ? { ...t, ...patch, ...(patch.due !== undefined ? { notified: false } : {}) } : t))); paint(); };
  const del = (id) => { const before = R.todos(); R.saveTodos(before.filter((t) => t.id !== id)); paint(); toast('Deleted'); };
  async function rename(t) { const v = await prompt('Rename', { value: t.text }); if (v) update(t.id, { text: v }); }
  function snooze(t, when) { update(t.id, { due: when, remind: true }); toast(`Snoozed to ${dayLabel(when)} ${fmtTime(when)}`); }
  // Ticking a repeating to-do off makes the next one, so the list never runs dry.
  function tick(t) {
    const next = !t.done && t.repeat && t.due ? nextDue(t.due, t.repeat, Date.now(), t.anchor) : null;
    if (!next) return update(t.id, { done: !t.done, doneAt: Date.now() });
    R.saveTodos(R.todos().flatMap((x) => (x.id === t.id
      ? [{ ...x, done: true, doneAt: Date.now() }, { ...x, id: uid(), due: next, done: false, doneAt: undefined, notified: false, created: Date.now() }]
      : [x])));
    paint(); toast(`Done. Next one: ${dayLabel(next)} ${fmtTime(next)}`);
  }
  async function setRepeat(t) {
    const v = await prompt('Repeat how often?', { value: t.repeat || '', placeholder: 'daily, weekdays, weekly or monthly (blank to stop)', ok: 'Set' });
    if (v === null) return;
    const rule = v.trim().toLowerCase().replace(/^every\s*/, '').replace(/^day$/, 'daily').replace(/^week$/, 'weekly').replace(/^month$/, 'monthly').replace(/^weekday$/, 'weekdays');
    if (!rule) return update(t.id, { repeat: null });
    if (!RULES.some((r) => r.value === rule)) return toast('Try daily, weekdays, weekly or monthly.', { error: true });
    update(t.id, { repeat: rule, anchor: new Date(t.due).getDate() });
  }
  async function setDue(t) {
    const v = await prompt('When is it due?', { value: t.due ? `${dayLabel(t.due)} ${fmtTime(t.due)}` : '', placeholder: 'e.g. tomorrow 9am, Friday, 12 March 5pm' });
    if (v === null) return;
    const when = parseWhen(v);
    if (!when.date) return toast('I couldn’t understand that date. Try “tomorrow 9am”.', { error: true });
    update(t.id, { due: when.date.getTime(), remind: true });
  }

  input.addEventListener('input', () => {
    const w = parseWhen(input.value);
    hint.textContent = w.date ? `📅 Due ${dayLabel(w.date)}${w.hasTime ? ` at ${fmtTime(w.date)}` : ''} · reminder on` : '';
  });
  input.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' || !input.value.trim()) return;
    const w = parseWhen(input.value);
    const target = ['All', 'Today', 'Upcoming'].includes(list) ? 'Inbox' : list;
    let due = w.date ? w.date.getTime() : null;
    if (!due && list === 'Today') { const d = new Date(); d.setHours(18, 0, 0, 0); due = d.getTime(); }
    R.addTodo(w.date ? w.text : input.value.trim(), { due, remind: !!w.date, list: target });
    input.value = ''; hint.textContent = '';
    paint();
  });

  root.append(el('div', { class: 'row fill' },
    el('div', { class: 'col scroll', style: 'flex:0 0 170px;gap:4px' }, listsBox,
      el('label', { class: 'hstack tiny dim', style: 'margin-top:6px;cursor:pointer' }, el('input', { type: 'checkbox', checked: showDone, onchange: (e) => { showDone = e.target.checked; save('todo.showDone', showDone); paint(); } }), 'Show done'),
      el('button', { class: 'btn small ghost', onclick: () => { R.saveTodos(R.todos().filter((t) => !t.done)); paint(); } }, 'Clear done')),
    el('div', { class: 'col', style: 'flex:1;min-width:0;gap:6px' }, input, hint, items)));
  paint();
  setTimeout(() => input.focus(), 40);
  return () => {};
}
