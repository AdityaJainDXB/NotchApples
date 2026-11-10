// Utilities: PC Stats, Shelf, World Clock, Launcher and Convert on one screen, like the Mac's Utilities tab. Each panel shows what is
// useful at a glance; click its title to open the full tool inside this tab (with a back button). Files dropped on the notch go to the Shelf.
import { el, load } from '../store.js';
import { invoke } from '../native.js';
import { canUse } from '../features.js';
import { allowed } from '../app.js';
import { byId } from '../modules.js';

const zoneOf = (e) => e.split('#')[0];
const cityOf = (e) => (e.includes('#') ? e.split('#')[1] : e.split('/').pop().replace(/_/g, ' '));

export function render(root, opts = {}) {
  let stop = null;
  const timers = [];
  const clear = () => {
    if (typeof stop === 'function') { try { stop(); } catch (e) { console.error(e); } }
    stop = null;
    timers.splice(0).forEach(clearInterval);
  };

  async function openTool(id) {
    clear();
    const m = byId(id);
    const inner = el('div', { class: 'col fill' });
    root.replaceChildren(el('div', { class: 'col fill', style: 'gap:6px' },
      el('button', { class: 'btn small ghost', style: 'align-self:flex-start', onclick: () => home() }, '‹ Utilities'), inner));
    if (!m) return;
    if (!allowed(m)) { const { renderUpgrade } = await import('./activation.js'); inner.append(renderUpgrade(m, () => openTool(id))); return; }
    try { const mod = await m.load(); const r = mod.render(inner, {}); stop = typeof r === 'function' ? r : null; }
    catch (e) { inner.append(el('div', { class: 'empty' }, `Couldn't open ${m.name}: ${e?.message ?? e}`)); }
  }

  const panel = (id, title, icon, body) => el('div', { class: 'card col gap-4', style: 'min-height:96px' },
    el('button', { class: 'btn small ghost', style: 'justify-content:space-between;width:100%;padding:2px 4px', onclick: () => openTool(id) }, `${icon} ${title}`, el('span', {}, '›')),
    body);
  const bar = (f) => el('div', { class: 'bar' }, el('i', { style: `width:${Math.min(100, Math.max(0, f * 100))}%` }));

  function home() {
    clear();
    const stats = el('div', { class: 'col gap-4' }, el('div', { class: 'tiny dim' }, 'Reading…'));
    const tick = async () => {
      const s = await invoke('system_stats').catch(() => null);
      if (!s) return;
      stats.replaceChildren(
        el('div', { class: 'tiny' }, `CPU ${Math.round(s.cpu_percent)}%`), bar(s.cpu_percent / 100),
        el('div', { class: 'tiny' }, `Memory ${Math.round(s.ram_used / s.ram_total * 100)}%`), bar(s.ram_used / s.ram_total),
        ...(s.battery_percent == null ? [] : [el('div', { class: 'tiny' }, `Battery ${s.battery_percent}%`), bar(s.battery_percent / 100)]));
    };
    tick(); timers.push(setInterval(tick, 2000));

    const items = load('shelf.items', []);
    const shelf = items.length
      ? el('div', { class: 'col gap-4' }, el('div', { class: 'small' }, `${items.length} item${items.length === 1 ? '' : 's'} held`),
        el('div', { class: 'tiny dim ellipsis' }, items.slice(-2).reverse().map((i) => i.name).join(', ')))
      : el('div', { class: 'tiny dim' }, 'Drop files on the notch to hold them');

    const now = new Date();
    const clock = el('div', { class: 'col gap-4' }, ...load('worldclock.zones', ['Europe/London', 'America/New_York', 'Asia/Tokyo']).slice(0, 3).map((z) =>
      el('div', { class: 'hstack small' }, el('span', { class: 'grow ellipsis' }, cityOf(z)),
        el('span', { class: 'num' }, now.toLocaleTimeString([], { timeZone: zoneOf(z), hour: '2-digit', minute: '2-digit' })))));

    const apps = load('launcher.apps', []).slice(0, 6);
    const launcher = !canUse('launcher') ? el('div', { class: 'tiny dim' }, 'Launcher is a Pro feature')
      : apps.length ? el('div', { class: 'small ellipsis' }, apps.map((a) => a.name).join(', ')) : el('div', { class: 'tiny dim' }, 'Add the apps you use most');

    root.replaceChildren(el('div', { class: 'grid', style: 'grid-template-columns:repeat(auto-fill,minmax(210px,1fr))' },
      panel('stats', 'PC stats', '📊', stats), panel('shelf', 'Shelf', '🗂', shelf), panel('worldclock', 'World clock', '🕐', clock),
      panel('launcher', 'Launcher', '🚀', launcher),
      panel('convert', 'Convert', '🔁', el('div', { class: 'tiny dim' }, 'Images, video, audio, documents'))));
  }

  if (opts.open) openTool(opts.open); else home();
  return clear;
}
