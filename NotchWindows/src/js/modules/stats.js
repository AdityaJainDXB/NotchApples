// PC Stats: live RAM, CPU, network, disk and battery, read by the Rust side.
import { el, fmtBytes, fmtSpeed } from '../store.js';
import { invoke } from '../app.js';

export function render(root) {
  const cards = {};
  const mk = (id, title, icon) => {
    const body = el('div', { class: 'col', style: 'gap:6px' }, el('div', { class: 'small dim' }, '—'));
    cards[id] = body;
    return el('div', { class: 'card col', style: 'gap:6px' },
      el('div', { class: 'section-title' }, `${icon} ${title}`), body);
  };

  root.append(el('div', { class: 'col', style: 'height:100%' },
    el('div', { class: 'row' }, mk('ram', 'Memory', '🧠'), mk('cpu', 'CPU', '⚙️')),
    el('div', { class: 'row' }, mk('net', 'Network', '📶'), mk('bat', 'Battery', '🔋'), mk('disk', 'Storage', '💾'))));

  const gauge = (big, small, frac) => [
    el('div', { class: 'big mono' }, big),
    el('div', { class: 'bar' }, el('i', { style: `width:${Math.min(100, Math.max(0, frac * 100))}%` })),
    el('div', { class: 'small dim' }, small),
  ];

  async function tick() {
    const s = await invoke('system_stats').catch(() => null);
    if (!s) {
      for (const b of Object.values(cards)) b.replaceChildren(el('div', { class: 'small dim' }, 'Unavailable'));
      return;
    }
    const ramFrac = s.ram_total ? s.ram_used / s.ram_total : 0;
    cards.ram.replaceChildren(...gauge(`${Math.round(ramFrac * 100)}%`,
      `${fmtBytes(s.ram_used)} of ${fmtBytes(s.ram_total)}`, ramFrac));

    cards.cpu.replaceChildren(...gauge(`${Math.round(s.cpu_percent)}%`,
      `${s.cpu_cores} cores · ${s.cpu_name || ''}`.trim(), s.cpu_percent / 100));

    cards.net.replaceChildren(
      el('div', { style: 'font-size:15px;font-weight:600' }, `⬇ ${fmtSpeed(s.down_bytes_per_sec)}`),
      el('div', { style: 'font-size:15px;font-weight:600' }, `⬆ ${fmtSpeed(s.up_bytes_per_sec)}`),
      el('div', { class: 'small dim' }, s.net_interface || ''));

    if (s.battery_percent === null || s.battery_percent === undefined) {
      cards.bat.replaceChildren(el('div', { class: 'small dim' }, 'No battery (desktop PC)'));
    } else {
      cards.bat.replaceChildren(...gauge(`${s.battery_percent}%`,
        s.battery_charging ? 'Charging' : 'On battery', s.battery_percent / 100));
    }

    const diskFrac = s.disk_total ? (s.disk_total - s.disk_free) / s.disk_total : 0;
    cards.disk.replaceChildren(...gauge(fmtBytes(s.disk_free),
      `free of ${fmtBytes(s.disk_total)}`, diskFrac));
  }

  tick();
  const timer = setInterval(tick, 1000);
  return () => clearInterval(timer);
}
