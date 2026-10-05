// Quick Add (Pro), from the Mac's QuickAddView: type "Dentist tomorrow 3pm" or
// "remind me to pay rent on the 1st". Reminders become to-dos with a reminder;
// events open in your calendar app (Outlook, Calendar…) as an .ics invitation.
// `parseWhen` is shared with the To-do tab.

import { el, load, save, dayLabel, fmtTime } from '../store.js';
import { invoke } from '../native.js';
import { toast, segmented } from '../ui.js';
import * as R from '../services/reminders.js';

const DAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
const MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];
const monthIndex = (w) => MONTHS.findIndex((m) => m.startsWith(w.toLowerCase().slice(0, 3)) && w.length >= 3);

/// Finds a date/time in text. Returns { date, hasTime, text } where text has the
/// date words removed, or { date: null, text } when there is none.
export function parseWhen(input, now = new Date()) {
  let text = ` ${input} `;
  let day = null;              // a Date at midnight
  let hour = null, minute = 0;
  const eat = (re) => { const m = text.match(re); if (m) text = text.replace(m[0], ' '); return m; };
  const at0 = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const today = at0(now);

  // Relative: "in 20 minutes", "in 2 hours", "in 3 days", "in a week".
  let m = eat(/\bin\s+(an?|\d+(?:\.\d+)?)\s*(min(?:ute)?s?|h(?:ou)?rs?|hours?|days?|weeks?)\b/i);
  if (m) {
    const n = /^an?$/i.test(m[1]) ? 1 : Number(m[1]);
    const unit = m[2].toLowerCase();
    const ms = unit.startsWith('min') ? 60e3 : unit.startsWith('h') ? 3600e3 : unit.startsWith('d') ? 864e5 : 7 * 864e5;
    const date = new Date(now.getTime() + n * ms);
    return { date, hasTime: !/^(d|w)/.test(unit), text: clean(text) };
  }

  if ((m = eat(/\b(day after tomorrow)\b/i))) day = new Date(today.getTime() + 2 * 864e5);
  else if ((m = eat(/\b(tomorrow|tmrw|tmr)\b/i))) day = new Date(today.getTime() + 864e5);
  else if ((m = eat(/\b(today)\b/i))) day = today;
  else if ((m = eat(/\b(tonight)\b/i))) { day = today; hour = 20; }
  else if ((m = eat(/\bnext week\b/i))) { day = new Date(today.getTime() + ((8 - today.getDay()) % 7 || 7) * 864e5); }
  else if ((m = eat(/\bnext month\b/i))) { day = new Date(today.getFullYear(), today.getMonth() + 1, 1); }

  // Weekdays: "friday", "next monday", "this sat".
  if (!day && (m = eat(new RegExp(`\\b(?:(next|this|on)\\s+)?(${DAYS.map((d) => `${d.slice(0, 3)}(?:${d.slice(3)})?`).join('|')})\\b`, 'i')))) {
    const target = DAYS.findIndex((d) => d.startsWith(m[2].toLowerCase().slice(0, 3)));
    let diff = (target - today.getDay() + 7) % 7;
    if (diff === 0 || (m[1] || '').toLowerCase() === 'next') diff = diff === 0 ? 7 : diff + (m[1]?.toLowerCase() === 'next' && diff < 7 ? 0 : 0);
    day = new Date(today.getTime() + diff * 864e5);
  }

  // "12 March", "March 12th", "12th of march" (with an optional year).
  if (!day && (m = eat(/\b(\d{1,2})(?:st|nd|rd|th)?\s+(?:of\s+)?([a-z]{3,9})\.?(?:\s+(\d{4}))?\b/i)) && monthIndex(m[2]) >= 0) {
    day = new Date(Number(m[3] || now.getFullYear()), monthIndex(m[2]), Number(m[1]));
  } else if (m && monthIndex(m[2]) < 0) { text = ` ${input} `; m = null; }
  if (!day && (m = eat(/\b([a-z]{3,9})\.?\s+(\d{1,2})(?:st|nd|rd|th)?(?:,?\s+(\d{4}))?\b/i)) && monthIndex(m[1]) >= 0) {
    day = new Date(Number(m[3] || now.getFullYear()), monthIndex(m[1]), Number(m[2]));
  } else if (m && monthIndex(m[1]) < 0) { m = null; text = text; }

  // "on the 1st", "the 15th".
  if (!day && (m = eat(/\b(?:on\s+)?the\s+(\d{1,2})(?:st|nd|rd|th)\b/i))) {
    const d = Number(m[1]);
    day = new Date(today.getFullYear(), today.getMonth(), d);
    if (day < today) day = new Date(today.getFullYear(), today.getMonth() + 1, d);
  }

  // "12/3" or "3/12": day/month, except in the US.
  if (!day && (m = eat(/\b(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?\b/))) {
    const us = /^en-US/.test(navigator.language || '');
    const [a, b] = [Number(m[1]), Number(m[2])];
    const [dd, mm] = us ? [b, a] : [a, b];
    const y = m[3] ? (m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3])) : now.getFullYear();
    if (mm >= 1 && mm <= 12 && dd >= 1 && dd <= 31) day = new Date(y, mm - 1, dd);
  }

  // Times: "3pm", "3:30 pm", "at 15:30", "noon", "midnight", "morning".
  if ((m = eat(/\b(?:at\s+)?(\d{1,2})(?::(\d{2}))?\s*(am|pm|a\.m\.|p\.m\.)\b/i))) {
    hour = Number(m[1]) % 12 + (/p/i.test(m[3]) ? 12 : 0); minute = Number(m[2] || 0);
  } else if ((m = eat(/\b(?:at\s+)?([01]?\d|2[0-3]):([0-5]\d)\b/))) {
    hour = Number(m[1]); minute = Number(m[2]);
  } else if ((m = eat(/\bat\s+(\d{1,2})\b/i)) && Number(m[1]) <= 23) {
    hour = Number(m[1]);
    if (hour < 8) hour += 12; // "at 3" means the afternoon
  } else if ((m = eat(/\b(noon|midday)\b/i))) hour = 12;
  else if ((m = eat(/\bmidnight\b/i))) hour = 0;
  else if ((m = eat(/\b(in the\s+)?morning\b/i))) hour = 9;
  else if ((m = eat(/\b(in the\s+)?afternoon\b/i))) hour = 15;
  else if ((m = eat(/\b(in the\s+)?evening\b/i))) hour = 18;

  if (!day && hour === null) return { date: null, hasTime: false, text: input.trim() };
  if (!day) {
    day = today;
    // A time that has already passed today means tomorrow.
    if (hour < now.getHours() || (hour === now.getHours() && minute <= now.getMinutes())) day = new Date(today.getTime() + 864e5);
  }
  const hasTime = hour !== null;
  const date = new Date(day.getFullYear(), day.getMonth(), day.getDate(), hasTime ? hour : 9, hasTime ? minute : 0);
  return { date, hasTime, text: clean(text) };
}

function clean(text) {
  return text.replace(/\b(remind me to|remind me|reminder to|reminder|on|at|by|due)\s*$/i, ' ')
    .replace(/^\s*(remind me to|remind me|reminder to|reminder:?)\s+/i, '')
    .replace(/\s+(on|at|by|due)\s*$/i, '')
    .replace(/\s{2,}/g, ' ').trim().replace(/^[,;:-]\s*/, '').replace(/[,;:-]\s*$/, '');
}

/// An .ics invitation the calendar app opens.
function ics({ title, start, minutes = 60, allDay = false }) {
  const pad = (n) => String(n).padStart(2, '0');
  const utc = (d) => `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}T${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}00Z`;
  const date = (d) => `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}`;
  const end = new Date(start.getTime() + (allDay ? 864e5 : minutes * 60e3));
  const esc = (s) => s.replace(/([,;\\])/g, '\\$1');
  return ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Notch apple//Quick Add//EN', 'BEGIN:VEVENT',
    `UID:${Date.now()}-${Math.random().toString(36).slice(2)}@notchapple`, `DTSTAMP:${utc(new Date())}`,
    allDay ? `DTSTART;VALUE=DATE:${date(start)}` : `DTSTART:${utc(start)}`, allDay ? `DTEND;VALUE=DATE:${date(end)}` : `DTEND:${utc(end)}`,
    `SUMMARY:${esc(title)}`, 'BEGIN:VALARM', 'TRIGGER:-PT10M', 'ACTION:DISPLAY', `DESCRIPTION:${esc(title)}`, 'END:VALARM', 'END:VEVENT', 'END:VCALENDAR'].join('\r\n');
}

export function render(root) {
  let mode = load('quickadd.mode', 'auto'); // auto | reminder | event
  const input = el('input', { class: 'field', style: 'font-size:15px;min-height:42px', placeholder: 'Dentist tomorrow 3pm · Remind me to pay rent on the 1st' });
  const preview = el('div', { class: 'card col gap-6', style: 'min-height:90px' });
  const recent = el('div', { class: 'col gap-4' });

  const kindOf = (text) => (mode !== 'auto' ? mode : /^\s*(remind|reminder|todo|to-do|to do|buy|call|pay|email|send)\b/i.test(text) ? 'reminder' : 'event');

  function paintPreview() {
    const text = input.value.trim();
    if (!text) { preview.replaceChildren(el('div', { class: 'small dim' }, 'Type what and when. Press Enter to add it.'),
      el('div', { class: 'tiny faint' }, 'Starts with “remind me”, “buy”, “call” or “pay”? It becomes a reminder. Anything else becomes a calendar event.')); return; }
    const w = parseWhen(text);
    const kind = kindOf(text);
    preview.replaceChildren(
      el('div', { class: 'hstack' }, el('span', { style: 'font-size:22px' }, kind === 'reminder' ? '🔔' : '📅'),
        el('div', { class: 'grow' }, el('div', { class: 'title' }, w.text || text),
          el('div', { class: 'small dim' }, w.date ? `${dayLabel(w.date)}${w.hasTime ? ` at ${fmtTime(w.date)}` : kind === 'event' ? ' · all day' : ' at 9:00'}` : 'No date: added without one'))),
      el('div', { class: 'tiny faint' }, kind === 'reminder' ? 'Goes to To-do with a reminder.' : 'Opens in your calendar app (Outlook, Calendar…) to save.'));
  }

  async function add() {
    const text = input.value.trim();
    if (!text) return;
    const w = parseWhen(text);
    const title = w.text || text;
    if (kindOf(text) === 'reminder') {
      R.addTodo(title, { due: w.date ? w.date.getTime() : null, remind: !!w.date });
      toast(w.date ? `Reminder set for ${dayLabel(w.date)} ${fmtTime(w.date)}` : 'Added to To-do');
    } else {
      if (!w.date) return toast('Add a day or time, e.g. “tomorrow 3pm”.', { error: true });
      const file = ics({ title, start: w.date, allDay: !w.hasTime });
      try {
        const path = await invoke('save_temp_file', { name: `event-${Date.now()}.ics`, base64: btoa(unescape(encodeURIComponent(file))) });
        await invoke('open_path', { path });
        toast('Opened in your calendar app');
      } catch (e) { toast(`Couldn't open the calendar: ${e.message}`, { error: true }); return; }
    }
    save('quickadd.recent', [{ text, at: Date.now() }, ...load('quickadd.recent', [])].slice(0, 8));
    input.value = ''; paintPreview(); paintRecent();
  }

  function paintRecent() {
    const items = load('quickadd.recent', []);
    recent.replaceChildren(...(items.length ? [el('div', { class: 'section-title' }, 'Recently added')] : []),
      ...items.map((i) => el('div', { class: 'small dim ellipsis' }, `• ${i.text}`)));
  }

  input.addEventListener('input', paintPreview);
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') add(); });
  root.append(el('div', { class: 'col fill', style: 'max-width:640px;margin:0 auto;width:100%;justify-content:center' },
    el('div', { class: 'hstack' }, el('div', { class: 'title grow' }, '⚡ Quick Add'),
      segmented([{ value: 'auto', label: 'Auto' }, { value: 'reminder', label: 'Reminder' }, { value: 'event', label: 'Event' }], mode, (v) => { mode = v; save('quickadd.mode', v); paintPreview(); })),
    input, preview, recent));
  paintPreview(); paintRecent();
  setTimeout(() => input.focus(), 40);
}
