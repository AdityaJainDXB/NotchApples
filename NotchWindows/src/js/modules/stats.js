// PC Stats: live memory, CPU, network, battery and disk; top apps (Pro).
import { el, fmtBytes, fmtSpeed } from '../store.js';
import { invoke } from '../native.js';
import { canUse } from '../features.js';
import { proNote } from './activation.js';

export function render(root) {
  const cards = {};
  const mk = (id, title) => { cards[id] = el('div', { class: 'col gap-4' }); return el('div', { class: 'card col gap-6' }, el('div', { class: 'section-title' }, title), cards[id]); };
  const top = el('div', { class: 'col gap-4' });
  root.append(el('div', { class: 'row fill' },
    el('div', { class: 'col', style: 'flex:1.3' }, el('div', { class: 'row' }, mk('ram', '🧠 Memory'), mk('cpu', '⚙️ CPU')), el('div', { class: 'row' }, mk('net', '📶 Network'), mk('bat', '🔋 Battery'), mk('disk', '💾 Disk'))),
    el('div', { class: 'card col', style: 'flex:1' }, el('div', { class: 'section-title' }, 'Busiest apps'), top)));
  const g = (big, small, f) => [el('div', { class: 'big num' }, big), el('div', { class: 'bar' }, el('i', { style: `width:${Math.min(100, Math.max(0, f * 100))}%` })), el('div', { class: 'tiny dim' }, small)];
  async function tick() {
    const s = await invoke('system_stats').catch(() => null);
    if (!s) return;
    cards.ram.replaceChildren(...g(`${Math.round(s.ram_used / s.ram_total * 100)}%`, `${fmtBytes(s.ram_used)} of ${fmtBytes(s.ram_total)}`, s.ram_used / s.ram_total));
    cards.cpu.replaceChildren(...g(`${Math.round(s.cpu_percent)}%`, `${s.cpu_cores} cores · ${s.cpu_name}`, s.cpu_percent / 100));
    cards.net.replaceChildren(el('div', { class: 'num' }, `⬇ ${fmtSpeed(s.down_bytes_per_sec)}`), el('div', { class: 'num' }, `⬆ ${fmtSpeed(s.up_bytes_per_sec)}`));
    cards.bat.replaceChildren(...(s.battery_percent == null ? [el('div', { class: 'small dim' }, 'No battery')] : g(`${s.battery_percent}%`, s.battery_charging ? 'Charging' : 'On battery', s.battery_percent / 100)));
    cards.disk.replaceChildren(...g(fmtBytes(s.disk_free), `free of ${fmtBytes(s.disk_total)}`, 1 - s.disk_free / s.disk_total));
  }
  async function procs() {
    if (!canUse('topProcesses')) { top.replaceChildren(proNote('topProcesses')); return; }
    const list = await invoke('top_processes', { limit: 9 }).catch(() => []);
    top.replaceChildren(...list.map((p) => el('div', { class: 'hstack small' }, el('span', { class: 'grow ellipsis' }, p.name), el('span', { class: 'num dim' }, fmtBytes(p.memory)), el('span', { class: 'num', style: 'width:52px;text-align:right' }, `${p.cpu.toFixed(1)}%`))));
  }
  tick(); procs();
  const a = setInterval(tick, 1000), b = setInterval(procs, 3000);
  return () => { clearInterval(a); clearInterval(b); };
}
