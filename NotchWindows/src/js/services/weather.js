// Weather from Open-Meteo (free, no key), like the Mac app. Your location comes
// from a choice you make in Settings (a city), or roughly from your internet
// connection, cached for 12 hours. Rain alerts (Pro) warn before it starts.

import { load, save } from '../store.js';
import { getJSON, notify } from '../native.js';
import { canUse } from '../features.js';

export const CODES = {
  0: ['Clear', '☀️', '🌙'], 1: ['Mainly clear', '🌤', '🌙'], 2: ['Partly cloudy', '⛅', '☁️'], 3: ['Overcast', '☁️', '☁️'],
  45: ['Fog', '🌫', '🌫'], 48: ['Rime fog', '🌫', '🌫'], 51: ['Light drizzle', '🌦', '🌧'], 53: ['Drizzle', '🌦', '🌧'],
  55: ['Heavy drizzle', '🌧', '🌧'], 56: ['Freezing drizzle', '🌧', '🌧'], 57: ['Freezing drizzle', '🌧', '🌧'],
  61: ['Light rain', '🌦', '🌧'], 63: ['Rain', '🌧', '🌧'], 65: ['Heavy rain', '🌧', '🌧'], 66: ['Freezing rain', '🌧', '🌧'], 67: ['Freezing rain', '🌧', '🌧'],
  71: ['Light snow', '🌨', '🌨'], 73: ['Snow', '🌨', '🌨'], 75: ['Heavy snow', '❄️', '❄️'], 77: ['Snow grains', '🌨', '🌨'],
  80: ['Showers', '🌦', '🌧'], 81: ['Showers', '🌦', '🌧'], 82: ['Violent showers', '⛈', '⛈'], 85: ['Snow showers', '🌨', '🌨'], 86: ['Snow showers', '🌨', '🌨'],
  95: ['Thunderstorm', '⛈', '⛈'], 96: ['Thunderstorm, hail', '⛈', '⛈'], 99: ['Thunderstorm, hail', '⛈', '⛈'],
};
export const describe = (code, day = true) => { const c = CODES[code] || ['—', '🌡', '🌡']; return { text: c[0], icon: day ? c[1] : c[2] }; };

export const units = () => load('weather.units', 'auto'); // auto | c | f
const fahrenheit = () => units() === 'f' || (units() === 'auto' && /^en-(US|LR|MM)/.test(navigator.language));
export const tempUnit = () => (fahrenheit() ? '°F' : '°C');

/// { lat, lon, name } — the chosen city, or a rough guess from the connection.
export async function location() {
  const chosen = load('weather.city', null);
  if (chosen) return chosen;
  const cached = load('weather.ipLocation', null);
  if (cached && Date.now() - cached.at < 12 * 3600e3) return cached;
  const sources = [
    async () => { const j = await getJSON('https://ipwho.is/', { timeout: 8000 }); if (!j.success) throw 0; return { lat: j.latitude, lon: j.longitude, name: j.city }; },
    async () => { const j = await getJSON('https://ipapi.co/json/', { timeout: 8000 }); if (!j.latitude) throw 0; return { lat: j.latitude, lon: j.longitude, name: j.city }; },
    async () => { const j = await getJSON('https://get.geojs.io/v1/ip/geo.json', { timeout: 8000 }); return { lat: Number(j.latitude), lon: Number(j.longitude), name: j.city }; },
  ];
  for (const s of sources) {
    try { const loc = await s(); if (Number.isFinite(loc.lat)) { const v = { ...loc, at: Date.now() }; save('weather.ipLocation', v); return v; } } catch {}
  }
  if (cached) return cached;
  throw new Error('Couldn’t work out where you are. Choose your city in Settings → Weather.');
}

/// Finds cities by name (Open-Meteo geocoding).
export async function searchCity(name) {
  const j = await getJSON(`https://geocoding-api.open-meteo.com/v1/search?count=8&language=en&name=${encodeURIComponent(name)}`);
  return (j.results || []).map((r) => ({ lat: r.latitude, lon: r.longitude, name: r.name, region: [r.admin1, r.country].filter(Boolean).join(', ') }));
}

const cache = new Map(); // "lat,lon" -> { at, data }

/// Current, next 12 hours and next 7 days for a place.
export async function forecast(loc) {
  const key = `${loc.lat.toFixed(2)},${loc.lon.toFixed(2)},${tempUnit()}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < 15 * 60e3) return hit.data;
  const q = new URLSearchParams({
    latitude: loc.lat, longitude: loc.lon, timezone: 'auto', forecast_days: '7',
    current: 'temperature_2m,apparent_temperature,weather_code,is_day,relative_humidity_2m,wind_speed_10m,precipitation',
    hourly: 'temperature_2m,weather_code,precipitation_probability,is_day',
    daily: 'weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max,sunrise,sunset',
    temperature_unit: fahrenheit() ? 'fahrenheit' : 'celsius', wind_speed_unit: fahrenheit() ? 'mph' : 'kmh',
  });
  const j = await getJSON(`https://api.open-meteo.com/v1/forecast?${q}`, { timeout: 15000 });
  const nowIdx = Math.max(0, (j.hourly?.time || []).findIndex((t) => new Date(t) > Date.now()) - 1);
  const data = {
    place: loc.name || '',
    current: { temp: j.current?.temperature_2m, feels: j.current?.apparent_temperature, code: j.current?.weather_code, day: !!j.current?.is_day,
      humidity: j.current?.relative_humidity_2m, wind: j.current?.wind_speed_10m, precip: j.current?.precipitation },
    hourly: (j.hourly?.time || []).slice(nowIdx, nowIdx + 12).map((t, i) => ({ time: new Date(t), temp: j.hourly.temperature_2m[nowIdx + i],
      code: j.hourly.weather_code[nowIdx + i], rain: j.hourly.precipitation_probability?.[nowIdx + i] ?? 0, day: !!j.hourly.is_day?.[nowIdx + i] })),
    daily: (j.daily?.time || []).map((t, i) => ({ date: new Date(`${t}T12:00`), code: j.daily.weather_code[i], max: j.daily.temperature_2m_max[i],
      min: j.daily.temperature_2m_min[i], rain: j.daily.precipitation_probability_max?.[i] ?? 0, sunrise: j.daily.sunrise?.[i], sunset: j.daily.sunset?.[i] })),
  };
  cache.set(key, { at: Date.now(), data });
  return data;
}

export const here = async () => forecast(await location());

// ---- rain alerts (Pro) ----

async function checkRain() {
  if (!canUse('rainAlert') || !load('weather.rainAlert', true)) return;
  try {
    const w = await here();
    const raining = [51, 53, 55, 61, 63, 65, 80, 81, 82, 95].includes(w.current.code) || w.current.precip > 0;
    const soon = w.hourly.slice(1, 2).find((h) => h.rain >= 60);
    const last = load('weather.rainAlertAt', 0);
    if (!raining && soon && Date.now() - last > 3 * 3600e3) {
      save('weather.rainAlertAt', Date.now());
      notify('Rain soon', `${soon.rain}% chance of rain in the next hour${w.place ? ` in ${w.place}` : ''}. Take an umbrella.`);
    }
  } catch {}
}

export function start() {
  setTimeout(checkRain, 20_000);
  setInterval(checkRain, 20 * 60e3);
}
