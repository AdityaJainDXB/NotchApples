// Flight Radar's data: the aircraft within a range of where you are (the same place as your weather), from adsb.lol's
// free public feed. It asks only while the tab is open, every 10 seconds, with your position rounded to about a
// kilometre. Nothing is stored. The rules (distance, bearing, names) are in radarlogic.js.

import { load, save } from '../store.js';
import { getJSON } from '../native.js';
import { location } from './weather.js';
import * as L from './radarlogic.js';

let state = { aircraft: [], loading: false, error: null, updated: 0, place: null };
export const get = () => state;
export const range = () => load('radar.range', 100);
export const setRange = (v) => save('radar.range', v);
export const showGround = () => load('radar.ground', false);
export const setShowGround = (v) => save('radar.ground', v);

let timer = null, listeners = new Set(), token = 0;
const emit = () => listeners.forEach((f) => f(state));

export async function refresh() {
  const mine = ++token;
  state = { ...state, loading: true }; emit();
  try {
    const place = await location();
    const json = await getJSON(L.url(place.lat, place.lon, range()), { timeout: 12000 });
    if (mine !== token) return;
    state = { aircraft: L.parse(json, place.lat, place.lon), loading: false, error: null, updated: Date.now(), place };
  } catch (e) {
    if (mine !== token) return;
    state = { ...state, loading: false, error: e?.message?.includes('city') ? e.message : 'Couldn’t reach the flight feed. Trying again in a few seconds.' };
  }
  emit();
}

/// Starts the 10-second refresh while the tab is open; returns a function that stops it.
export function watch(listener) {
  listeners.add(listener);
  refresh();
  timer = setInterval(refresh, 10_000);
  return () => { listeners.delete(listener); clearInterval(timer); timer = null; token++; };
}
