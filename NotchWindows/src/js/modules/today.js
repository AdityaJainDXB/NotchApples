// Today: the date and time, the weather (with the next 12 hours and 7 days for
// Pro, as on the Mac), your next calendar events, and your PC at a glance.

import { el, fmtDuration, fmtTime, dayLabel } from '../store.js';
import { invoke } from '../native.js';
import { canUse } from '../features.js';
import { proNote } from './activation.js';
import { show } from '../app.js';

/// The day's low-to-high span within the week's range, like a weather app.
function rangeBar(d, week) {
  const lo = Math.min(...week.map((x) => x.min)), hi = Math.max(...week.map((x) => x.max));
  const span = Math.max(1, hi - lo);
  const left = ((d.min - lo) / span) * 100, width = Math.max(6, ((d.max - d.min) / span) * 100);
  return el('div', { class: 'bar thin', style: 'width:70px;position:relative' },
    el('i', { style: `position:absolute;left:${left}%;width:${width}%` }));
}

export function render(root) {
  const clock = el('div', { class: 'huge num' });
  const dateLine = el('div', { class: 'dim' });
  const weather = el('div', { class: 'col gap-6' }, el('div', { class: 'skel', style: 'height:58px' }));
  const forecastBox = el('div', { class: 'col gap-6' });
  const events = el('div', { class: 'col gap-4' });
  const sys = el('div', { class: 'col gap-4' }, el('div', { class: 'small dim' }, 'Reading…'));

  const left = el('div', { class: 'card col', style: 'flex:1.15;min-width:0' },
    el('div', {}, dateLine, clock), weather, forecastBox);
  const right = el('div', { class: 'col', style: 'flex:1;min-width:0' },
    el('div', { class: 'card col gap-6', style: 'flex:1;min-height:0;overflow:auto' },
      el('div', { class: 'hstack' }, el('div', { class: 'section-title grow' }, 'Up next'),
        el('button', { class: 'btn small ghost', onclick: () => show('settings', { pane: 'Calendar' }) }, 'Calendars')), events),
    el('div', { class: 'card col gap-6' }, el('div', { class: 'section-title' }, 'This PC'), sys));
  root.append(el('div', { class: 'row fill' }, left, right));

  const tick = () => {
    const now = new Date();
    clock.textContent = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    dateLine.textContent = now.toLocaleDateString([], { weekday: 'long', day: 'numeric', month: 'long' });
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
        el('div', { style: 'font-size:40px;line-height:1' }, now.icon),
        el('div', { class: 'grow' },
          el('div', { class: 'big num' }, `${Math.round(w.current.temp)}${u}`),
          el('div', { class: 'small dim' }, `${now.text}${w.place ? ` · ${w.place}` : ''}`)),
        el('div', { class: 'small dim', style: 'text-align:right' },
          el('div', {}, `Feels ${Math.round(w.current.feels)}°`),
          el('div', {}, `💧 ${w.current.humidity ?? '—'}%`),
          el('div', {}, `↑${Math.round(w.daily[0]?.max ?? 0)}° ↓${Math.round(w.daily[0]?.min ?? 0)}°`))));
      if (canUse('forecast')) {
        forecastBox.replaceChildren(
          el('div', { class: 'hstack scroll', style: 'gap:4px;overflow-x:auto;padding-bottom:2px' },
            ...w.hourly.map((h, i) => el('div', { class: 'col', style: 'align-items:center;gap:2px;min-width:44px', title: `${h.rain}% chance of rain` },
              el('div', { class: 'tiny dim' }, i === 0 ? 'Now' : h.time.toLocaleTimeString([], { hour: 'numeric' })),
              el('div', { style: 'font-size:16px' }, W.describe(h.code, h.day).icon),
              el('div', { class: 'small num' }, `${Math.round(h.temp)}°`)))),
          el('div', { class: 'col gap-4' }, ...w.daily.slice(1, 7).map((d, _, week) => el('div', { class: 'hstack small' },
            el('span', { style: 'width:42px' }, d.date.toLocaleDateString([], { weekday: 'short' })),
            el('span', { style: 'width:22px' }, W.describe(d.code).icon),
            el('span', { class: 'dim', style: 'width:42px' }, d.rain ? `💧${d.rain}%` : ''),
            el('span', { class: 'grow' }),
            el('span', { class: 'num dim' }, `${Math.round(d.min)}°`),
            rangeBar(d, week),
            el('span', { class: 'num' }, `${Math.round(d.max)}°`)))));
      } else {
        forecastBox.replaceChildren(proNote('forecast', 'The next 12 hours and 7 days, for up to six cities.'));
      }
    } catch (e) {
      weather.replaceChildren(el('div', { class: 'small dim' }, `Weather unavailable. ${e.message}`),
        el('button', { class: 'btn small quiet', style: 'align-self:flex-start', onclick: () => show('settings', { pane: 'Weather' }) }, 'Choose your city'));
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
          return el('div', { class: 'item', style: 'padding:5px 6px' },
            el('div', { style: `width:3px;align-self:stretch;border-radius:2px;background:${now ? 'var(--live)' : 'var(--accent)'}` }),
            el('div', { class: 'main' },
              el('div', { class: 'ellipsis', style: 'font-weight:600' }, e.title, now ? el('span', { class: 'badge live', style: 'margin-left:6px' }, 'NOW') : null),
              el('div', { class: 'small dim ellipsis' }, e.allDay ? `${dayLabel(e.start)} · all day` : `${dayLabel(e.start)} · ${fmtTime(e.start)}–${fmtTime(e.end)}`, e.location ? ` · ${e.location}` : '')),
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
    if (!s) { sys.replaceChildren(el('div', { class: 'small dim' }, 'Unavailable.')); return; }
    const row = (k, v) => el('div', { class: 'hstack small' }, el('span', { class: 'dim grow' }, k), el('span', { class: 'num' }, v));
    sys.replaceChildren(
      row('Battery', s.battery_percent == null ? 'Plugged in' : `${s.battery_percent}%${s.battery_charging ? ' · charging' : ''}`),
      row('Memory', `${Math.round((s.ram_used / s.ram_total) * 100)}% used`),
      row('CPU', `${Math.round(s.cpu_percent)}%`),
      row('Up for', fmtDuration(s.uptime_seconds)));
  }
  loadSystem();
  const t2 = setInterval(loadSystem, 20000);

  return () => { clearInterval(t1); clearInterval(t2); unsub?.(); };
}
