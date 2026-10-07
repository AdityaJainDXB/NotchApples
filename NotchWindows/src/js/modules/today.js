// Today: the date and time, the weather (with the next 12 hours and 7 days for
// Pro, as on the Mac), your next calendar events, and your PC at a glance.

import { el, fmtTime, dayLabel, load, save, todayKey } from '../store.js';
import { modal, button } from '../ui.js';
import * as WB from '../services/wellbeing.js';
import { invoke } from '../native.js';
import { canUse } from '../features.js';
import { proNote } from './activation.js';
import { show } from '../app.js';
import { icon } from '../icons.js';

/// The line icon for a WMO weather code, like the Mac's SF Symbols.
export function weatherGlyph(code, day = true) {
  if (code === 0) return day ? 'sun' : 'moon';
  if (code <= 2) return day ? 'cloud-sun' : 'cloud';
  if (code === 3) return 'cloud';
  if (code === 45 || code === 48) return 'cloud-fog';
  if ((code >= 71 && code <= 77) || code === 85 || code === 86) return 'cloud-snow';
  if (code >= 95) return 'cloud-lightning';
  return 'cloud-rain';
}
const EVENT_COLOURS = ['#d05ce3', '#f5a14a', '#5fd068', '#5aa9ff', '#ff6b8b'];

/// The day's low-to-high span within the week's range, like a weather app.
function rangeBar(d, week) {
  const lo = Math.min(...week.map((x) => x.min)), hi = Math.max(...week.map((x) => x.max));
  const span = Math.max(1, hi - lo);
  const left = ((d.min - lo) / span) * 100, width = Math.max(6, ((d.max - d.min) / span) * 100);
  return el('div', { class: 'bar thin', style: 'width:70px;position:relative' },
    el('i', { style: `position:absolute;left:${left}%;width:${width}%` }));
}

export function render(root) {
  // Laid out like the Mac's Today: the weekday, a big date, the weather, and the battery at the bottom.
  const dayName = el('div', { class: 'section-title' });
  const dateBig = el('div', { class: 'big', style: 'font-size:34px' });
  const weather = el('div', { class: 'col gap-6' }, el('div', { class: 'skel', style: 'height:58px' }));
  const forecastBox = el('div', { class: 'col gap-6' });
  const events = el('div', { class: 'col gap-4' });
  const sys = el('div', { class: 'hstack dim', style: 'gap:8px;margin-top:auto' });

  // Notes pinned in Notes (up to three). Click one to open it.
  const pinnedBox = el('div', { class: 'col gap-4', style: 'margin-top:auto' });
  const pinned = load('notes.items', []).filter((n) => n.pinned).sort((a, b) => b.updated - a.updated).slice(0, 3);
  if (pinned.length) {
    pinnedBox.append(el('div', { class: 'section-title' }, 'Pinned notes'), ...pinned.map((n) => {
      const lines = n.text.trim().split('\n');
      return el('div', { class: 'item clickable', style: 'padding:4px 6px', onclick: () => show('notes', { open: n.id }) },
        el('div', { class: 'main' }, el('div', { class: 'ellipsis', style: 'font-weight:600' }, lines[0].replace(/^#+\s*/, '').slice(0, 50) || 'New note'),
          lines[1] ? el('div', { class: 'tiny faint ellipsis' }, lines.slice(1).join(' ').trim().slice(0, 70)) : null));
    }));
  }

  // Countdowns to dates you care about (an exam, a trip, a launch). Past ones disappear after a day.
  const countdownBox = el('div', { class: 'col gap-4', style: 'margin-top:8px' });
  function paintCountdowns() {
    const today = todayKey();
    const all = load('today.countdowns', []);
    const items = all.map((c) => ({ ...c, days: WB.daysBetween(today, c.date) })).filter((c) => c.days !== null && c.days >= -1).sort((a, b) => a.days - b.days).slice(0, 3);
    countdownBox.replaceChildren(
      el('div', { class: 'hstack' }, el('div', { class: 'section-title grow' }, 'Countdowns'), el('button', { class: 'btn small ghost', onclick: addCountdown }, '+ Add')),
      ...items.map((c) => el('div', { class: 'hstack item', style: 'padding:3px 0' }, el('span', { class: 'grow ellipsis' }, c.title), el('b', { class: 'num' }, WB.countdownLabel(c.days)),
        el('button', { class: 'icon-btn', style: 'width:22px;height:22px', title: 'Remove', onclick: () => { save('today.countdowns', load('today.countdowns', []).filter((x) => !(x.title === c.title && x.date === c.date))); paintCountdowns(); } }, '✕'))),
      ...(items.length ? [] : [el('div', { class: 'small dim' }, 'Add a date to count down to.')]));
  }
  function addCountdown() {
    const name = el('input', { class: 'field', placeholder: 'What is it? (Exam, Trip, Launch…)', maxlength: 40 });
    const date = el('input', { class: 'field', type: 'date', min: todayKey() });
    const m = modal('New countdown', [name, date], { actions: [button('Cancel', () => m.close(), { kind: 'quiet' }), button('Add', () => {
      if (!name.value.trim() || WB.daysBetween(todayKey(), date.value) === null) return;
      save('today.countdowns', [...load('today.countdowns', []), { title: name.value.trim(), date: date.value }]); m.close(); paintCountdowns();
    })] });
  }
  paintCountdowns();

  // One thing today: a single line that clears itself tomorrow. It can also sit on the closed pill (off by default).
  const oneNow = () => { const v = load('today.oneThing', null); return v && v.day === todayKey() ? v.text : ''; };
  const oneInput = el('input', { class: 'field', placeholder: 'The one thing today…', maxlength: 90, value: oneNow(), style: 'min-height:30px' });
  oneInput.onchange = () => { save('today.oneThing', { day: todayKey(), text: oneInput.value.trim() }); import('../activity.js').then((a) => a.refresh()); };
  const onePill = el('input', { type: 'checkbox', checked: load('today.onePill', false), onchange: (e) => { save('today.onePill', e.target.checked); import('../activity.js').then((a) => a.refresh()); } });
  const oneRow = el('div', { class: 'col', style: 'gap:4px' }, oneInput, el('label', { class: 'hstack tiny dim', style: 'gap:6px;cursor:pointer' }, onePill, 'Show on the pill'));
  const left = el('div', { class: 'card col', style: 'flex:0 0 42%;min-width:0;overflow:auto;gap:12px' },
    el('div', { class: 'col', style: 'gap:2px' }, dayName, dateBig), oneRow, weather, forecastBox, sys);
  const right = el('div', { class: 'card col gap-6', style: 'flex:1;min-width:0;min-height:0;overflow:auto' },
    el('div', { class: 'hstack' }, el('div', { class: 'section-title grow' }, 'Up next'),
      el('button', { class: 'btn small ghost', onclick: () => show('settings', { pane: 'Calendar' }) }, 'Calendars')), events, pinnedBox, countdownBox);
  root.append(el('div', { class: 'row fill', style: 'gap:16px' }, left, right));

  const tick = () => {
    const now = new Date();
    dayName.textContent = now.toLocaleDateString([], { weekday: 'long' });
    dateBig.textContent = now.toLocaleDateString([], { day: 'numeric', month: 'long' });
  };
  tick();
  const t1 = setInterval(tick, 5000);

  // ---- weather ----
  (async () => {
    const W = await import('../services/weather.js');
    try {
      const w = await W.here();
      const now = W.describe(w.current.code, w.current.day);
      const u = W.tempUnit();
      weather.replaceChildren(el('div', { class: 'hstack', style: 'gap:12px' },
        icon(weatherGlyph(w.current.code, w.current.day), 42, now.icon),
        el('div', { class: 'grow' },
          el('div', { class: 'big num' }, `${Math.round(w.current.temp)}°`),
          el('div', { class: 'dim' }, `${now.text}${w.place ? ` · ${w.place}` : ''}`)),
        el('div', { class: 'small dim', style: 'text-align:right' },
          el('div', {}, `Feels ${Math.round(w.current.feels)}${u}`),
          el('div', {}, `Humidity ${w.current.humidity ?? '—'}%`),
          el('div', {}, `H ${Math.round(w.daily[0]?.max ?? 0)}° · L ${Math.round(w.daily[0]?.min ?? 0)}°`))));
      if (canUse('forecast')) {
        forecastBox.replaceChildren(
          el('div', { class: 'hstack scroll', style: 'gap:4px;overflow-x:auto;padding-bottom:2px' },
            ...w.hourly.map((h, i) => el('div', { class: 'col', style: 'align-items:center;gap:2px;min-width:44px', title: `${h.rain}% chance of rain` },
              el('div', { class: 'tiny dim' }, i === 0 ? 'Now' : h.time.toLocaleTimeString([], { hour: 'numeric' })),
              icon(weatherGlyph(h.code, h.day), 17, W.describe(h.code, h.day).icon),
              el('div', { class: 'small num' }, `${Math.round(h.temp)}°`)))),
          el('div', { class: 'col gap-4' }, ...w.daily.slice(1, 7).map((d, _, week) => el('div', { class: 'hstack small' },
            el('span', { style: 'width:42px' }, d.date.toLocaleDateString([], { weekday: 'short' })),
            el('span', { style: 'width:22px' }, icon(weatherGlyph(d.code), 16, W.describe(d.code).icon)),
            el('span', { class: 'dim', style: 'width:42px' }, d.rain ? `${d.rain}%` : ''),
            el('span', { class: 'grow' }),
            el('span', { class: 'num dim' }, `${Math.round(d.min)}°`),
            rangeBar(d, week),
            el('span', { class: 'num' }, `${Math.round(d.max)}°`)))));
      } else {
        forecastBox.replaceChildren(proNote('forecast', 'The next 12 hours and 7 days, for up to six cities.'));
      }
    } catch (e) {
      weather.replaceChildren(el('div', { class: 'small dim' }, `Weather unavailable. ${e.message}`),
        el('button', { class: 'btn quiet', style: 'align-self:flex-start', onclick: () => show('settings', { pane: 'Weather' }) }, icon('navigation', 16), 'Choose your city'));
    }
  })();

  // ---- calendar ----
  let unsub = null;
  (async () => {
    const C = await import('../services/calendar.js');
    const paint = () => {
      if (!C.hasCalendars()) {
        events.replaceChildren(el('div', { class: 'small dim' }, 'Add your calendar to see what’s next: paste its private iCal (.ics) address from Outlook, Google Calendar or iCloud.'),
          el('button', { class: 'btn small quiet', style: 'align-self:flex-start', onclick: () => show('settings', { pane: 'Calendar' }) }, 'Add a calendar'));
        return;
      }
      const list = C.upcoming(3).slice(0, 6);
      events.replaceChildren(
        ...(C.error() ? [el('div', { class: 'small warn' }, C.error())] : []),
        ...list.map((e) => {
          const now = e.start <= Date.now() && e.end > Date.now();
          const colour = EVENT_COLOURS[[...String(e.calendar || e.title)].reduce((a, c) => a + c.charCodeAt(0), 0) % EVENT_COLOURS.length];
          return el('div', { class: 'item', style: 'padding:4px 0' },
            el('div', { style: `width:4px;align-self:stretch;border-radius:2px;background:${colour}` }),
            el('div', { class: 'main' },
              el('div', { class: 'ellipsis', style: 'font-weight:600;font-size:15px' }, e.title),
              el('div', { class: 'dim ellipsis' }, e.allDay ? `${dayLabel(e.start)} · all day` : `${dayLabel(e.start)} · ${fmtTime(e.start)}–${fmtTime(e.end)}`, e.location ? ` · ${e.location}` : '')),
            now ? el('span', { class: 'chip', style: 'background:color-mix(in srgb, var(--accent) 45%, transparent);color:#fff;border:0' }, 'Now') : null,
            e.join ? el('button', { class: 'btn small', onclick: () => C.join(e) }, 'Join') : null);
        }));
      if (!list.length) events.append(el('div', { class: 'small dim' }, 'Nothing in the next three days.'));
    };
    paint();
    unsub = C.subscribe(paint);
  })();

  // ---- this PC ----
  async function loadSystem() {
    const s = await invoke('system_stats').catch(() => null);
    if (!s || s.battery_percent == null) { sys.replaceChildren(); return; }   // desktops have no battery line
    sys.replaceChildren(icon(s.battery_charging ? 'battery-charging' : 'battery', 20), el('span', { class: 'num' }, `${s.battery_percent}%`));
  }
  loadSystem();
  const t2 = setInterval(loadSystem, 20000);

  return () => { clearInterval(t1); clearInterval(t2); unsub?.(); };
}
