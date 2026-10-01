// Today: date, local weather (free Open-Meteo, no key), battery and uptime.
import { el } from '../store.js';
import { invoke } from '../app.js';

const CODES = {
  0: ['Clear', '☀️'], 1: ['Mainly clear', '🌤'], 2: ['Partly cloudy', '⛅'], 3: ['Overcast', '☁️'],
  45: ['Fog', '🌫'], 48: ['Rime fog', '🌫'], 51: ['Light drizzle', '🌦'], 53: ['Drizzle', '🌦'],
  55: ['Heavy drizzle', '🌦'], 61: ['Light rain', '🌧'], 63: ['Rain', '🌧'], 65: ['Heavy rain', '🌧'],
  71: ['Light snow', '🌨'], 73: ['Snow', '🌨'], 75: ['Heavy snow', '❄️'], 80: ['Showers', '🌦'],
  81: ['Showers', '🌦'], 82: ['Violent showers', '⛈'], 95: ['Thunderstorm', '⛈'], 96: ['Thunderstorm', '⛈'],
};

export function render(root) {
  const weather = el('div', { class: 'col' }, el('div', { class: 'small dim' }, 'Loading weather…'));
  const battery = el('div', { class: 'small dim' }, '');
  const clock = el('div', { class: 'big mono' }, '');
  const dateLine = el('div', { class: 'section-title' }, '');

  const left = el('div', { class: 'card col' },
    dateLine,
    el('div', { class: 'big' }, new Date().toLocaleDateString([], { day: 'numeric', month: 'long' })),
    clock, weather, el('div', { style: 'flex:1' }), battery);

  const right = el('div', { class: 'card col' },
    el('div', { class: 'section-title' }, 'At a glance'),
    el('div', { id: 'today-sys', class: 'col' }, el('div', { class: 'small dim' }, 'Reading system info…')));

  root.append(el('div', { class: 'row', style: 'height:100%' }, left, right));

  const tick = () => {
    const now = new Date();
    dateLine.textContent = now.toLocaleDateString([], { weekday: 'long' });
    clock.textContent = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  };
  tick();
  const timer = setInterval(tick, 10000);

  loadWeather(weather);
  loadSystem(right.querySelector('#today-sys'), battery);
  const sysTimer = setInterval(() => loadSystem(right.querySelector('#today-sys'), battery), 30000);

  return () => { clearInterval(timer); clearInterval(sysTimer); };
}

async function loadWeather(target) {
  try {
    // Approximate location from IP, then the free Open-Meteo forecast. No key, no account.
    const loc = await fetch('https://ipapi.co/json/').then((r) => r.json());
    const url = `https://api.open-meteo.com/v1/forecast?latitude=${loc.latitude}&longitude=${loc.longitude}`
              + '&current=temperature_2m,weather_code&timezone=auto';
    const w = await fetch(url).then((r) => r.json());
    const code = w.current?.weather_code ?? 0;
    const [text, icon] = CODES[code] || ['—', '🌡'];
    target.replaceChildren(
      el('div', { style: 'display:flex;align-items:center;gap:10px' },
        el('div', { style: 'font-size:30px' }, icon),
        el('div', {},
          el('div', { class: 'big mono' }, `${Math.round(w.current?.temperature_2m ?? 0)}°`),
          el('div', { class: 'small dim' }, `${text} · ${loc.city ?? ''}`))));
  } catch {
    target.replaceChildren(el('div', { class: 'small dim' }, 'Weather unavailable (no connection).'));
  }
}

async function loadSystem(target, batteryLine) {
  const s = await invoke('system_stats').catch(() => null);
  if (!s) { target.replaceChildren(el('div', { class: 'small dim' }, 'System info needs the app window.')); return; }

  const rows = [
    ['Memory', `${Math.round((s.ram_used / s.ram_total) * 100)}% used`],
    ['CPU', `${Math.round(s.cpu_percent)}%`],
    ['Uptime', formatUptime(s.uptime_seconds)],
    ['Computer', s.host_name || '—'],
  ];
  target.replaceChildren(...rows.map(([k, v]) =>
    el('div', { style: 'display:flex;justify-content:space-between' },
      el('span', { class: 'dim small' }, k), el('span', { class: 'small mono' }, v))));

  if (s.battery_percent !== null && s.battery_percent !== undefined) {
    batteryLine.textContent = `🔋 ${s.battery_percent}%${s.battery_charging ? ' · charging' : ''}`;
  } else {
    batteryLine.textContent = '🔌 Plugged in (no battery)';
  }
}

function formatUptime(seconds) {
  const h = Math.floor((seconds || 0) / 3600), m = Math.floor(((seconds || 0) % 3600) / 60);
  return h ? `${h} h ${m} min` : `${m} min`;
}
