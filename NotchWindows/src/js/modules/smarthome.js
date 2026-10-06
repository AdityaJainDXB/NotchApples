// Smart Home (Ultimate): your Home Assistant lights, switches, fans, covers, scenes and scripts, one click
// each, with a slider for dimmable lights. Laid out like the Mac's Smart Home tab.

import { el } from '../store.js';
import { toast } from '../ui.js';
import { icon } from '../icons.js';
import * as H from '../services/smarthome.js';

const GLYPH = { light: '💡', switch: '🔌', input_boolean: '🔘', fan: '🌀', cover: '🚪', scene: '✨', script: '▶️' };

export function render(root) {
  const card = el('div', { class: 'card col', style: 'flex:1;min-height:0;gap:10px' });
  root.append(el('div', { class: 'col fill' }, card));
  let entities = [], status = 'Not connected', failed = false, editing = false, alive = true;

  async function refresh() {
    if (!H.configured()) return paint();
    try { entities = await H.states(); status = H.summary(entities); failed = false; }
    catch (e) { failed = true; status = e.message; }
    if (alive && !editing) paint();
  }

  function connectForm() {
    const c = H.config();
    const url = el('input', { class: 'field', placeholder: 'Address, e.g. homeassistant.local:8123', value: c.url });
    const token = el('input', { class: 'field', type: 'password', placeholder: 'Long-lived access token', value: c.token });
    const msg = el('div', { class: 'small warn' });
    const connect = el('button', { class: 'btn', onclick: async () => {
      H.saveConfig(url.value, token.value); editing = false; await refresh();
      if (failed) { editing = true; paint(); msg.textContent = status; }
    } }, 'Connect');
    return [el('div', { class: 'section-title' }, 'Connect Home Assistant'),
      el('div', { class: 'small dim' }, 'Controls your lights, switches, scenes and more. Home Assistant also connects Philips Hue, IKEA, Zigbee and Matter devices, so this covers them too.'),
      url, token,
      el('div', { class: 'tiny dim' }, 'In Home Assistant: your profile, then Security, then Long-lived access tokens, then Create token. It stays on this PC.'),
      el('div', { class: 'hstack' }, connect, editing && H.configured() ? el('button', { class: 'btn quiet', onclick: () => { editing = false; paint(); } }, 'Cancel') : null, msg)];
  }

  function tile(e) {
    const on = H.isOn(e) && !H.isButton(e), pct = H.brightnessPercent(e), fav = H.favourites().has(e.id);
    const t = el('div', { class: 'tile', style: `align-items:stretch;gap:3px;padding:9px;cursor:pointer;text-align:left;${on ? 'background:color-mix(in srgb, var(--accent) 30%, transparent);' : ''}${e.state === 'unavailable' ? 'opacity:.4;' : ''}`,
      onclick: async () => { if (e.state === 'unavailable') return; try { await H.press(e); } catch (x) { toast(x.message, { error: true }); } setTimeout(refresh, 350); } },
      el('div', { class: 'hstack' }, el('span', {}, GLYPH[e.domain] || '•'), el('b', { class: 'grow ellipsis', style: 'font-size:12.5px' }, e.name),
        el('button', { class: 'icon-btn', style: 'width:20px;height:20px;font-size:12px', title: 'Favourite', onclick: (ev) => { ev.stopPropagation(); H.toggleFavourite(e.id); paint(); } }, fav ? '★' : '☆')),
      el('div', { class: 'tiny dim' }, H.isButton(e) ? 'Click to run' : e.state[0].toUpperCase() + e.state.slice(1)));
    if (on && pct !== null) {
      const s = el('input', { type: 'range', min: 1, max: 100, value: pct, onclick: (ev) => ev.stopPropagation() });
      s.onchange = async () => { try { await H.dim(e, Number(s.value)); } catch (x) { toast(x.message, { error: true }); } refresh(); };
      t.append(s);
    }
    return t;
  }

  function section(title, items) {
    return el('div', { class: 'col gap-6' }, el('div', { class: 'small dim', style: 'font-weight:600' }, title),
      el('div', { style: 'display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:8px' }, ...items.map(tile)));
  }

  function paint() {
    if (!H.configured() || editing) { card.replaceChildren(...connectForm()); return; }
    const favs = H.favourites();
    const list = el('div', { class: 'col scroll', style: 'flex:1;min-height:0;gap:10px' });
    const f = entities.filter((e) => favs.has(e.id));
    if (f.length) list.append(section('Favourites', f));
    for (const d of H.DOMAINS) { const items = entities.filter((e) => e.domain === d); if (items.length) list.append(section(H.TITLES[d], items)); }
    if (!entities.length && !failed) list.append(el('div', { class: 'dim' }, 'No lights, switches or scenes found.'));
    card.replaceChildren(
      el('div', { class: 'hstack' }, el('div', { class: 'section-title' }, 'Smart Home'), el('span', { class: `small ${failed ? 'warn' : 'dim'}` }, status), el('span', { class: 'spacer' }),
        el('button', { class: 'icon-btn', title: 'Refresh', onclick: refresh }, icon('rotate-ccw', 16, '↻')),
        el('button', { class: 'icon-btn', title: 'Connection', onclick: () => { editing = true; paint(); } }, icon('settings', 17, '⚙'))),
      list);
  }

  paint(); refresh();
  const t = setInterval(refresh, 6000);
  return () => { alive = false; clearInterval(t); };
}
