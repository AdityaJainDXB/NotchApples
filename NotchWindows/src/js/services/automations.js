// AI automations (Ultimate): a question that runs on its own at a set time, like
// "Every weekday at 8:00, give me a motivating quote" or "Each Friday, suggest a
// weekend plan". The answer arrives as a notification and is kept in the list.

import { load, save, uid, todayKey } from '../store.js';
import { notify } from '../native.js';
import { canUse } from '../features.js';

export const list = () => load('automations.list', []);
export const saveList = (l) => save('automations.list', l);

/// { id, name, prompt, time: 'HH:MM', days: [0-6], web: bool, lastRun, lastAnswer }
export function add(a) { saveList([...list(), { id: uid(), days: [1, 2, 3, 4, 5], time: '08:00', web: false, ...a }]); }
export function remove(id) { saveList(list().filter((a) => a.id !== id)); }

export async function runNow(a) {
  const ai = await import('./ai.js');
  const answer = a.web && canUse('webSearch') ? (await ai.askWithWeb(a.prompt)).text : await ai.ask(a.prompt);
  saveList(list().map((x) => (x.id === a.id ? { ...x, lastRun: Date.now(), lastDay: todayKey(), lastAnswer: answer.slice(0, 4000) } : x)));
  notify(a.name || 'Automation', answer.replace(/[#*_`>]/g, '').slice(0, 240));
  return answer;
}

async function tick() {
  if (!canUse('automations')) return;
  const now = new Date();
  const hm = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
  for (const a of list()) {
    if (a.paused || !a.days.includes(now.getDay()) || a.lastDay === todayKey()) continue;
    if (hm >= a.time) {
      // Mark first, so a failing request can't repeat every minute.
      saveList(list().map((x) => (x.id === a.id ? { ...x, lastDay: todayKey() } : x)));
      runNow(a).catch((e) => notify(a.name || 'Automation', `Couldn't run: ${e.message}`));
    }
  }
}

export function start() { setInterval(tick, 60_000); setTimeout(tick, 15_000); }
