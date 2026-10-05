// World Clock: cities with day/night and the difference; meeting planner (Pro).
import { el, load, save } from '../store.js';
import { canUse } from '../features.js';
import { proNote } from './activation.js';

const KEY = 'worldclock.zones';
const ALL = Intl.supportedValuesOf ? Intl.supportedValuesOf('timeZone') : ['Europe/London', 'America/New_York', 'Asia/Tokyo'];
const offset = (d, z) => { const n = new Intl.DateTimeFormat('en-US', { timeZone: z, timeZoneName: 'shortOffset' }).formatToParts(d).find((p) => p.type === 'timeZoneName')?.value || 'GMT'; const m = n.match(/GMT([+-]\d+)(?::(\d+))?/); return m ? Number(m[1]) + (m[2] ? Math.sign(Number(m[1])) * Number(m[2]) / 60 : 0) : 0; };
const city = (z) => z.split('/').pop().replace(/_/g, ' ');

export function render(root) {
  let zones = load(KEY, ['Europe/London', 'America/New_York', 'Asia/Tokyo']), shift = 0;
  const grid = el('div', { class: 'grid', style: 'grid-template-columns:repeat(auto-fill,minmax(170px,1fr))' });
  const planner = el('div', { class: 'card col gap-6' });
  const picker = el('input', { class: 'field', list: 'tzlist', placeholder: 'Add a city (e.g. Dubai, Paris)…' });
  const dl = el('datalist', { id: 'tzlist' }, ...ALL.map((z) => el('option', { value: z.replace(/_/g, ' ') })));
  picker.onchange = () => { const z = ALL.find((x) => x.replace(/_/g, ' ').toLowerCase() === picker.value.toLowerCase() || city(x).toLowerCase() === picker.value.toLowerCase()); if (z && !zones.includes(z)) { zones.push(z); save(KEY, zones); paint(); } picker.value = ''; };
  let slider = null, sliderLabel = null;
  function paint() {
    const now = new Date(Date.now() + shift * 3600e3), local = -new Date().getTimezoneOffset() / 60;
    grid.replaceChildren(...zones.map((z) => {
      const h = Number(now.toLocaleString('en-GB', { timeZone: z, hour: '2-digit', hour12: false })) % 24;
      const diff = Math.round((offset(now, z) - local) * 10) / 10;
      return el('div', { class: 'card col gap-4', style: 'position:relative' },
        el('button', { class: 'icon-btn', style: 'position:absolute;top:4px;right:4px', title: 'Remove', onclick: () => { zones = zones.filter((x) => x !== z); save(KEY, zones); paint(); } }, '×'),
        el('div', { class: 'section-title' }, city(z)), el('div', { class: 'big num' }, `${h < 6 || h >= 19 ? '🌙' : '☀️'} ${now.toLocaleTimeString([], { timeZone: z, hour: '2-digit', minute: '2-digit' })}`),
        el('div', { class: 'tiny dim' }, `${now.toLocaleDateString([], { timeZone: z, weekday: 'short', day: 'numeric', month: 'short' })} · ${diff === 0 ? 'same time' : `${diff > 0 ? '+' : ''}${diff} h`}`));
    }));
    if (!canUse('meetingPlanner')) { planner.replaceChildren(proNote('meetingPlanner')); return; }
    if (!slider) {
      slider = el('input', { type: 'range', min: -12, max: 36, step: 0.5, value: shift });
      sliderLabel = el('span', { class: 'small num' });
      slider.oninput = () => { shift = Number(slider.value); paint(); };
      planner.replaceChildren(el('div', { class: 'hstack' }, el('span', { class: 'section-title grow' }, 'Meeting planner: slide to find a time'), sliderLabel,
        el('button', { class: 'btn small ghost', onclick: () => { shift = 0; slider.value = 0; paint(); } }, 'Now')), slider);
    }
    sliderLabel.textContent = shift ? `${shift > 0 ? '+' : ''}${shift} h` : 'now';
  }
  root.append(el('div', { class: 'col fill' }, el('div', { class: 'scroll', style: 'flex:1' }, grid), planner, picker, dl));
  paint();
  const t = setInterval(paint, 20000);
  return () => clearInterval(t);
}
