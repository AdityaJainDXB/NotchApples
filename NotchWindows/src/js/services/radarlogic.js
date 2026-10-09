// Flight Radar's rules, the same as the Mac app's RadarLogic.swift and with the same test vectors: reading adsb.lol's
// feed, distance and bearing from you, where an aircraft sits on the radar, and the words for height and type.

export const RANGES = [25, 50, 100, 200];
const R_NM = 3440.065;
const rad = Math.PI / 180;

/// Rounded to about a kilometre before it is sent, which is all the feed needs.
export const roundedCoordinate = (v) => Math.round(v * 100) / 100;

export function url(lat, lon, rangeNM) {
  return `https://api.adsb.lol/v2/point/${roundedCoordinate(lat).toFixed(2)}/${roundedCoordinate(lon).toFixed(2)}/${Math.min(Math.max(rangeNM, 1), 250)}`;
}

export function distanceNM(lat1, lon1, lat2, lon2) {
  const dLat = (lat2 - lat1) * rad, dLon = (lon2 - lon1) * rad;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * rad) * Math.cos(lat2 * rad) * Math.sin(dLon / 2) ** 2;
  return 2 * R_NM * Math.asin(Math.min(1, Math.sqrt(a)));
}

export function bearing(lat1, lon1, lat2, lon2) {
  const dLon = (lon2 - lon1) * rad;
  const y = Math.sin(dLon) * Math.cos(lat2 * rad);
  const x = Math.cos(lat1 * rad) * Math.sin(lat2 * rad) - Math.sin(lat1 * rad) * Math.cos(lat2 * rad) * Math.cos(dLon);
  return ((Math.atan2(y, x) / rad) + 360) % 360;
}

/// Reads the feed's `ac` list; aircraft without a position are skipped; the rest are sorted nearest first.
export function parse(json, lat, lon, limit = 80) {
  const list = json && (Array.isArray(json.ac) ? json.ac : Array.isArray(json.aircraft) ? json.aircraft : null);
  if (!list) return [];
  const out = [];
  for (const a of list) {
    if (typeof a.lat !== 'number' || typeof a.lon !== 'number' || typeof a.hex !== 'string') continue;
    const ground = typeof a.alt_baro === 'string' && a.alt_baro.toLowerCase() === 'ground';
    const call = (a.flight || '').trim();
    out.push({
      id: a.hex, callsign: call || a.r || a.hex.toUpperCase(), type: (a.t || '').toUpperCase(), registration: a.r || '',
      altitudeFt: ground || typeof a.alt_baro !== 'number' ? null : Math.trunc(a.alt_baro), onGround: ground,
      speedKt: Math.round(a.gs || 0), track: typeof a.track === 'number' ? a.track : (typeof a.true_heading === 'number' ? a.true_heading : 0),
      climbFpm: Math.trunc(a.baro_rate || 0), lat: a.lat, lon: a.lon,
      distanceNM: distanceNM(lat, lon, a.lat, a.lon), bearing: bearing(lat, lon, a.lat, a.lon),
    });
  }
  return out.sort((x, y) => x.distanceNM - y.distanceNM).slice(0, limit);
}

/// x right, y down, each -1…1 with north up and the edge at `rangeNM` (held just outside it past that).
export function position(distNM, bearingDeg, rangeNM) {
  const d = Math.min(distNM / Math.max(rangeNM, 1), 1.05), b = bearingDeg * rad;
  return { x: Math.sin(b) * d, y: -Math.cos(b) * d };
}

export function altitudeLabel(ft, onGround) {
  if (onGround) return 'ground';
  if (ft == null) return '—';
  if (ft >= 18000) return `FL${Math.trunc(ft / 100)}`;
  return `${ft.toLocaleString('en-US')} ft`;
}

/// 'ground' | 'low' | 'mid' | 'high'
export function band(ft, onGround) {
  if (onGround) return 'ground';
  if (ft == null) return 'low';
  return ft < 5000 ? 'low' : ft < 18000 ? 'mid' : 'high';
}

const TYPE_NAMES = {
  A318: 'Airbus A318', A319: 'Airbus A319', A320: 'Airbus A320', A321: 'Airbus A321', A20N: 'Airbus A320neo', A21N: 'Airbus A321neo',
  A332: 'Airbus A330-200', A333: 'Airbus A330-300', A338: 'Airbus A330-800', A339: 'Airbus A330-900', A342: 'Airbus A340-200', A343: 'Airbus A340-300', A346: 'Airbus A340-600',
  A359: 'Airbus A350-900', A35K: 'Airbus A350-1000', A388: 'Airbus A380-800',
  B737: 'Boeing 737', B738: 'Boeing 737-800', B739: 'Boeing 737-900', B38M: 'Boeing 737 MAX 8', B39M: 'Boeing 737 MAX 9', B734: 'Boeing 737-400',
  B744: 'Boeing 747-400', B748: 'Boeing 747-8', B752: 'Boeing 757-200', B763: 'Boeing 767-300', B772: 'Boeing 777-200', B77L: 'Boeing 777-200LR',
  B77W: 'Boeing 777-300ER', B788: 'Boeing 787-8', B789: 'Boeing 787-9', B78X: 'Boeing 787-10',
  E170: 'Embraer 170', E190: 'Embraer 190', E195: 'Embraer 195', E75L: 'Embraer 175', CRJ9: 'CRJ-900', AT76: 'ATR 72', DH8D: 'Dash 8 Q400',
  C172: 'Cessna 172', C182: 'Cessna 182', C208: 'Cessna Caravan', PA28: 'Piper Cherokee', SR22: 'Cirrus SR22', BE20: 'King Air 200',
  GLF5: 'Gulfstream V', GLEX: 'Bombardier Global Express', C56X: 'Citation Excel', H25B: 'Hawker 800', R44: 'Robinson R44', EC35: 'Airbus H135',
};
export function typeName(code) {
  const c = (code || '').toUpperCase();
  return TYPE_NAMES[c] || (c || 'Unknown type');
}

export function compass(deg) {
  const names = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];
  return names[Math.floor((((deg % 360) + 360) % 360 + 11.25) / 22.5) % 16];
}
