// Live flight status (Pro), from the free adsb.lol feed the Mac app uses: for a
// flight you track in the Live tab, its altitude, speed and position while it's
// in the air, with a plane on the pill.

import { load, save } from '../store.js';
import { getJSON } from '../native.js';
import { provide, refresh } from '../activity.js';
import { canUse } from '../features.js';

const status = new Map(); // callsign -> { airborne, alt, speed, lat, lon, at, error }
export const flightStatus = (code) => status.get(code.toUpperCase());

/// "BA117" (IATA) is mapped to the ICAO callsign when we know the airline ("BAW117").
const IATA_TO_ICAO = { BA: 'BAW', EK: 'UAE', QR: 'QTR', EY: 'ETD', LH: 'DLH', AF: 'AFR', KL: 'KLM', AA: 'AAL', DL: 'DAL', UA: 'UAL', WN: 'SWA',
  FR: 'RYR', U2: 'EZY', TK: 'THY', SQ: 'SIA', CX: 'CPA', QF: 'QFA', AI: 'AIC', '6E': 'IGO', FZ: 'FDB', SV: 'SVA', MS: 'MSR', LX: 'SWR', IB: 'IBE',
  VY: 'VLG', AZ: 'ITY', SK: 'SAS', AY: 'FIN', NH: 'ANA', JL: 'JAL', KE: 'KAL', AC: 'ACA', NZ: 'ANZ', VS: 'VIR', WY: 'OMA', GF: 'GFA', KU: 'KAC' };

export function callsign(code) {
  const c = code.toUpperCase().replace(/\s+/g, '');
  const m = c.match(/^([A-Z0-9]{2})(\d{1,4}[A-Z]?)$/);
  if (m && IATA_TO_ICAO[m[1]]) return IATA_TO_ICAO[m[1]] + m[2];
  return c;
}

export async function check(code) {
  const cs = callsign(code);
  try {
    const j = await getJSON(`https://api.adsb.lol/v2/callsign/${encodeURIComponent(cs)}`, { timeout: 12000 });
    const ac = (j.ac || [])[0];
    status.set(code.toUpperCase(), ac
      ? { airborne: ac.alt_baro !== 'ground', alt: typeof ac.alt_baro === 'number' ? ac.alt_baro : 0, speed: Math.round(ac.gs || 0), lat: ac.lat, lon: ac.lon, type: ac.t, at: Date.now() }
      : { airborne: false, notFound: true, at: Date.now() });
  } catch (e) { status.set(code.toUpperCase(), { error: e.message, at: Date.now() }); }
  refresh();
  return status.get(code.toUpperCase());
}

export const tracked = () => load('live.items', []).filter((i) => i.kind === 'Flight');
export const pinnedFlight = () => load('flights.pin', '');
export const pinFlight = (code) => { save('flights.pin', code); poll(); };

async function poll() {
  clearTimeout(poll.t);
  const pin = pinnedFlight();
  if (pin && canUse('flightStatus')) await check(pin);
  poll.t = setTimeout(poll, 120_000);
}

export function start() {
  poll();
  provide('flight', 48, () => {
    const pin = pinnedFlight();
    const s = pin && flightStatus(pin);
    if (!s || !canUse('flightStatus') || !s.airborne) return null;
    return { icon: '✈', leftText: pin, label: s.alt ? `FL${Math.round(s.alt / 100)}` : 'In the air', tab: 'live', title: `${pin}: ${s.alt} ft, ${s.speed} kt` };
  });
}
