// World Clock: the time in the cities you pick, with day/night and the offset.
import { el, load, save } from '../store.js';

const KEY = 'worldclock.zones';
const DEFAULTS = ['Europe/London', 'America/New_York', 'Asia/Tokyo'];
const ALL = Intl.supportedValuesOf ? Intl.supportedValuesOf('timeZone') : DEFAULTS;

export function render(root) {
  let zones = load(KEY, DEFAULTS);
  const grid = el('div', { class: 'grid', style: 'grid-template-columns:repeat(3,1fr)' });

  const picker = el('select', { class: 'field', style: 'max-width:260px' },
    el('option', { value: '' }, 'Add a city…'),
    ...ALL.map((z) => el('option', { value: z }, z.replace(/_/g, ' '))));

  picker.addEventListener('change', () => {
    if (picker.value && !zones.includes(picker.value)) {
      zones.push(picker.value); save(KEY, zones); paint();
    }
    picker.value = '';
  });

  function paint() {
    const now = new Date();
    const localOffset = -now.getTimezoneOffset() / 60;
    grid.replaceChildren(...zones.map((z) => {
      const time = now.toLocaleTimeString([], { timeZone: z, hour: '2-digit', minute: '2-digit' });
      const hour = Number(now.toLocaleString('en-GB', { timeZone: z, hour: '2-digit', hour12: false }));
      const night = hour < 6 || hour >= 19;
      const theirOffset = offsetHours(now, z);
      const diff = Math.round((theirOffset - localOffset) * 10) / 10;
      return el('div', { class: 'card col', style: 'gap:4px;position:relative' },
        el('button', {
          class: 'sys-btn', style: 'position:absolute;top:4px;right:4px', title: 'Remove',
          onclick: () => { zones = zones.filter((x) => x !== z); save(KEY, zones); paint(); },
        }, '×'),
        el('div', { class: 'section-title' }, z.split('/').pop().replace(/_/g, ' ')),
        el('div', { class: 'big mono' }, `${night ? '🌙' : '☀️'} ${time}`),
        el('div', { class: 'small dim' },
          now.toLocaleDateString([], { timeZone: z, weekday: 'short', day: 'numeric', month: 'short' })
          + ` · ${diff === 0 ? 'same time' : `${diff > 0 ? '+' : ''}${diff} h`}`));
    }));
    if (!zones.length) grid.append(el('div', { class: 'small dim' }, 'Add a city below.'));
  }

  function offsetHours(date, zone) {
    const f = new Intl.DateTimeFormat('en-US', { timeZone: zone, timeZoneName: 'shortOffset' });
    const name = f.formatToParts(date).find((p) => p.type === 'timeZoneName')?.value ?? 'GMT';
    const m = name.match(/GMT([+-]\d+)(?::(\d+))?/);
    return m ? Number(m[1]) + (m[2] ? Number(m[2]) / 60 * Math.sign(Number(m[1])) : 0) : 0;
  }

  paint();
  const timer = setInterval(paint, 20000);
  root.append(el('div', { class: 'col', style: 'height:100%' }, grid, el('div', { style: 'flex:1' }), picker));
  return () => clearInterval(timer);
}
