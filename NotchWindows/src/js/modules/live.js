// Parcels & Flights: track parcels and flights; live flight status (Pro) on the pill.
// Not recommended for most people: limited usefulness, low compatibility (the Mac app says the same).
import { el, load, save, uid, timeAgo } from '../store.js';
import { openUrl } from '../native.js';
import { canUse } from '../features.js';
import { iconBtn, empty, toast } from '../ui.js';
import * as FL from '../services/flights.js';

function resolve(raw) {
  const c = raw.toUpperCase().replace(/\s+/g, ''), e = encodeURIComponent(c), m = (re) => re.test(c);
  if (m(/^1Z[0-9A-Z]{16}$/)) return ['UPS', `https://www.ups.com/track?tracknum=${e}`];
  if (m(/^[A-Z0-9]{2}\d{1,4}[A-Z]?$/) && !m(/^\d+$/)) return ['Flight', `https://www.flightaware.com/live/flight/${encodeURIComponent(FL.callsign(c))}`];
  if (m(/^\d{12}$|^\d{15}$/)) return ['FedEx', `https://www.fedex.com/fedextrack/?trknbr=${e}`];
  if (m(/^\d{10}$/)) return ['DHL', `https://www.dhl.com/global-en/home/tracking.html?tracking-id=${e}`];
  if (m(/^(94|93|92|95)\d{20}$/)) return ['USPS', `https://tools.usps.com/go/TrackConfirmAction?tLabels=${e}`];
  return ['Parcel', `https://parcelsapp.com/en/tracking/${e}`];
}
export function render(root) {
  const input = el('input', { class: 'field', placeholder: 'Tracking number or flight (e.g. EK202)' }), list = el('div', { class: 'col gap-4 scroll', style: 'flex:1' });
  const items = () => load('live.items', []);
  input.onkeydown = (e) => { if (e.key !== 'Enter' || !input.value.trim()) return; const [kind, url] = resolve(input.value); save('live.items', [{ id: uid(), code: input.value.trim().toUpperCase(), kind, url, at: Date.now() }, ...items()]); input.value = ''; paint(); };
  function paint() {
    list.replaceChildren(...items().map((i) => {
      const fs = i.kind === 'Flight' && FL.flightStatus(i.code);
      return el('div', { class: 'item clickable', onclick: () => openUrl(i.url) },
        el('span', { style: 'font-size:18px' }, i.kind === 'Flight' ? '✈' : '📦'),
        el('div', { class: 'main' }, el('div', { style: 'font-weight:600' }, i.code, el('span', { class: 'tiny faint' }, ` · ${i.kind}`)),
          el('div', { class: 'tiny dim' }, fs ? (fs.error ? fs.error : fs.notFound ? 'Not in the air right now' : `In the air · ${fs.alt} ft · ${fs.speed} kt`) : `Added ${timeAgo(i.at)}`)),
        i.kind === 'Flight' ? iconBtn(FL.pinnedFlight() === i.code ? '📍' : '📌', 'Live status on the pill (Pro)', async (e) => { e.stopPropagation(); if (!canUse('flightStatus')) return toast('Live flight status is part of Pro.'); FL.pinFlight(FL.pinnedFlight() === i.code ? '' : i.code); await FL.check(i.code); paint(); }) : null,
        iconBtn('🗑', 'Remove', (e) => { e.stopPropagation(); save('live.items', items().filter((x) => x.id !== i.id)); paint(); }));
    }));
    if (!items().length) list.append(empty('📦', 'Track a parcel or a flight', 'Paste a UPS, FedEx, DHL, USPS or other tracking number, or a flight like BA117.'));
  }
  root.append(el('div', { class: 'col fill' }, el('div', { class: 'small warn', style: 'font-weight:600' }, '(Not recommended: limited usefulness for most situations, low compatibility)'), input, list));
  paint();
  if (canUse('flightStatus')) Promise.all(items().filter((i) => i.kind === 'Flight').map((i) => FL.check(i.code))).then(paint);
}
