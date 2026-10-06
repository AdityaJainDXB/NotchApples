// To-dos with a due time, and Quick Add reminders: a Windows notification and a
// flash on the pill when one is due. Shared by the To-do and Quick Add tabs.

import { load, save, uid, update } from '../store.js';
import { notify } from '../native.js';
import { provide, refresh } from '../activity.js';

const KEY = 'todo.items';
let flash = null; // { text, until }

export const todos = () => load(KEY, []);
export const saveTodos = (list) => save(KEY, list);

/// { text, due (ms or null), remind (bool), list ('Inbox' | name), notes }
export function addTodo(text, { due = null, remind = !!due, list = 'Inbox', notes = '' } = {}) {
  const item = { id: uid(), text: text.trim().slice(0, 500), done: false, created: Date.now(), due, remind, list, notes, notified: false };
  update(KEY, [], (l) => [item, ...l]);
  return item;
}

export function check() {
  const now = Date.now();
  let changed = false;
  const list = todos().map((t) => {
    if (!t.done && t.remind && t.due && !t.notified && t.due <= now) {
      changed = true;
      notify('Reminder', t.text);
      flash = { text: t.text, until: now + 90_000 };
      import('../app.js').then((a) => a.playSound('alert'));
      return { ...t, notified: true };
    }
    return t;
  });
  if (changed) { saveTodos(list); refresh(); }
}

export function start() {
  check();
  setInterval(check, 15_000);
  provide('reminder', 85, () => (flash && flash.until > Date.now()
    ? { icon: '🔔', label: flash.text.length > 22 ? `${flash.text.slice(0, 21)}…` : flash.text, tab: 'todo', title: flash.text }
    : null));
  // "3 due": to-dos due today or overdue, shown on the pill when nothing more urgent is (Settings → On the pill).
  provide('duetoday', 30, () => {
    if (!load('todo.pill', true)) return null;
    const end = new Date(); end.setHours(23, 59, 59, 999);
    const n = todos().filter((t) => !t.done && t.due && t.due <= end.getTime()).length;
    return n ? { icon: '✅', label: `${n} due`, tab: 'todo', title: `${n} to-do${n === 1 ? ' is' : 's are'} due today or overdue` } : null;
  });
}
