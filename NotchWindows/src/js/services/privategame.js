// Private games: a game that only people with an access code can open (Flight Economy). The game file is never in the app: the
// license server sends it after it accepts a code, and the app keeps it in a folder of its own and opens it in a window of its
// own. The code is checked again every few days, so a cancelled code stops working; offline, a game stays open for up to
// two weeks. The Mac app does the same (PrivateGame.swift).

import { load, save, remove } from '../store.js';
import { getJSON, invoke } from '../native.js';
import { WORKER } from '../license.js';

export const GAME_ID = 'flight-economy';
const RECHECK_MS = 3 * 86400000;      // ask the server again after this long
const OFFLINE_MS = 14 * 86400000;     // and give up on a game that could not be checked for this long

/// Splits what a person typed into the 12 letters and numbers of a code ("" when it is not one).
export const cleanCode = (raw) => { const c = String(raw || '').toUpperCase().replace(/[^A-Z0-9]/g, ''); return c.length === 12 ? c : ''; };
/// ABCD-EFGH-IJKL, as codes are shown.
export const prettyCode = (raw) => String(raw || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 12).replace(/(.{4})(?=.)/g, '$1-');

const device = () => {
  let d = load('game.device', '');
  if (!/^[A-Za-z0-9_-]{16,64}$/.test(d)) {
    const bytes = crypto.getRandomValues(new Uint8Array(18));
    d = btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
    save('game.device', d);
  }
  return d;
};

const stateKey = (id) => `game.private.${id}`;
/// { code, version, name, checked } when this PC has the game unlocked, else null.
export const status = (id = GAME_ID) => load(stateKey(id), null);
export const isUnlocked = (id = GAME_ID) => !!status(id);

const ask = (code, have) => getJSON(`${WORKER}/game/unlock`, { method: 'POST', json: { code, device: device(), have: have || undefined }, timeout: 60000 });

/// Checks a code with the server. On success the game is saved on this PC and the PC counts as unlocked. Throws a sentence otherwise.
export async function unlock(raw, id = GAME_ID) {
  const code = cleanCode(raw);
  if (!code) throw new Error('Enter the whole access code: 12 letters and numbers.');
  const r = await ask(code);
  if (r.game !== id) throw new Error('That code is for a different game.');
  if (!r.html) throw new Error('The server did not send the game. Try again.');
  await invoke('private_game_save', { id, html: r.html });
  save(stateKey(id), { code, version: r.version, name: r.name, checked: Date.now() });
  return r;
}

/// Forgets the code and deletes the saved game (the code was cancelled, or the person asked).
export async function lock(id = GAME_ID) {
  remove(stateKey(id));
  await invoke('private_game_remove', { id }).catch(() => {});
}

/// Opens the game in its own window. Every few days the code is checked again first (and a newer game version is fetched).
export async function open(id = GAME_ID) {
  const st = status(id);
  if (!st) throw new Error('Enter your access code first.');
  if (Date.now() - (st.checked || 0) > RECHECK_MS) {
    try {
      const r = await ask(st.code, st.version);
      if (r.html) await invoke('private_game_save', { id, html: r.html });
      save(stateKey(id), { ...st, version: r.version, name: r.name, checked: Date.now() });
    } catch (e) {
      if (e && (e.status === 403 || e.status === 409)) { await lock(id); throw new Error(`${e.message} The game is locked again.`); }
      if (Date.now() - (st.checked || 0) > OFFLINE_MS) throw new Error('Connect to the internet once to keep the game unlocked.');
      // offline for now: carry on with the saved copy
    }
  }
  await invoke('private_game_open', { id, name: status(id)?.name || 'Flight Economy' });
}
