// Smart Home (Ultimate): your own Home Assistant, over its REST API. Home Assistant also connects Philips Hue,
// IKEA, Zigbee and Matter devices, so this one tab covers them. Same rules as the Mac's SmartHomeLogic.swift.

import { load, save } from '../store.js';
import { http } from '../native.js';

export const DOMAINS = ['light', 'switch', 'fan', 'cover', 'input_boolean', 'scene', 'script'];
export const TITLES = { light: 'Lights', switch: 'Switches', fan: 'Fans', cover: 'Covers', input_boolean: 'Toggles', scene: 'Scenes', script: 'Scripts' };

/// What people type → the server address, or null. Adds http://, drops a trailing slash and any pasted /api path.
export function normalize(raw) {
  let s = String(raw || '').trim();
  if (!s) return null;
  const bare = !s.includes('://');
  if (bare) s = `http://${s}`;
  let u;
  try { u = new URL(s); } catch { return null; }
  if (!['http:', 'https:'].includes(u.protocol) || !u.hostname) return null;
  // A bare address like "homeassistant.local" means Home Assistant's own port.
  const port = u.port || (bare && u.protocol === 'http:' ? '8123' : '');
  return `${u.protocol}//${u.hostname}${port ? `:${port}` : ''}`;
}

const domainOf = (id) => id.split('.')[0];
export const isButton = (e) => e.domain === 'scene' || e.domain === 'script';
export const isOn = (e) => ['on', 'open', 'playing'].includes(e.state);

/// GET /api/states → the devices we can show, sorted by kind and then name.
export function parse(list) {
  const out = [];
  for (const item of Array.isArray(list) ? list : []) {
    if (typeof item?.entity_id !== 'string' || typeof item.state !== 'string') continue;
    const domain = domainOf(item.entity_id);
    if (!DOMAINS.includes(domain)) continue;
    const a = item.attributes || {};
    if (a.hidden === true) continue;
    const name = a.friendly_name || item.entity_id.split('.')[1].replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
    out.push({ id: item.entity_id, domain, name, state: item.state, brightness: typeof a.brightness === 'number' ? a.brightness : null });
  }
  return out.sort((x, y) => DOMAINS.indexOf(x.domain) - DOMAINS.indexOf(y.domain) || x.name.localeCompare(y.name, undefined, { sensitivity: 'base' }));
}

/// The service to call to press or flip a device.
export function service(e) {
  if (e.domain === 'scene') return ['scene', 'turn_on'];
  if (e.domain === 'script') return ['script', 'turn_on'];
  if (e.domain === 'cover') return ['cover', isOn(e) ? 'close_cover' : 'open_cover'];
  return ['homeassistant', 'toggle'];
}
export const brightnessPercent = (e) => (e.domain === 'light' && e.brightness != null ? Math.round((e.brightness / 255) * 100) : null);
export const brightnessBody = (entity, percent) => ({ entity_id: entity, brightness_pct: Math.min(100, Math.max(1, Math.round(percent))) });
export const summary = (list) => { const n = list.filter((e) => isOn(e) && !isButton(e)).length; return n ? `${n} on` : 'Everything is off'; };

// ---- talking to your server ----

export const config = () => ({ url: load('smarthome.url', ''), token: load('smarthome.token', '') });
export const configured = () => !!normalize(config().url) && !!config().token;
export const saveConfig = (url, token) => { save('smarthome.url', normalize(url) || url); save('smarthome.token', String(token || '').trim()); };
export const disconnect = () => { save('smarthome.token', ''); };
export const favourites = () => new Set(load('smarthome.favourites', []));
export function toggleFavourite(id) { const f = favourites(); f.has(id) ? f.delete(id) : f.add(id); save('smarthome.favourites', [...f]); }

async function call(path, method = 'GET', json) {
  const { url, token } = config();
  const base = normalize(url);
  if (!base) throw new Error('Enter the address of your Home Assistant.');
  const r = await http(`${base}${path}`, { method, headers: { authorization: `Bearer ${token}` }, json, timeout: 8000 });
  if (r.status === 401) throw new Error("Home Assistant didn't accept that token.");
  if (!r.ok) throw new Error(`Home Assistant answered ${r.status}.`);
  return r;
}
export async function states() { return parse((await call('/api/states')).json()); }
export async function press(e) { const [d, s] = service(e); await call(`/api/services/${d}/${s}`, 'POST', { entity_id: e.id }); }
export async function dim(e, percent) { await call('/api/services/light/turn_on', 'POST', brightnessBody(e.id, percent)); }
