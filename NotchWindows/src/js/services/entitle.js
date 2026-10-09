// Fetches and keeps the licence server's tokens for this PC (rules and checks: entitlelogic.js), so paid content that lives
// only on the server (the premium Klick sounds) and the Clipboard Link relay go to a real key and to nothing else. A copy of
// the app modified to skip the local licence check still gets no token. It asks at most about twice a day, only while a
// signed key is active, and sends what activating sends (the key and this PC's random ID).

import { load, save } from '../store.js';
import { WORKER, entitleInfo, verifySigned } from '../license.js';
import { verifyToken, needsRenewal } from './entitlelogic.js';

let inFlight = null;

async function fetchTokens() {
  const info = entitleInfo();
  if (!info) return;
  try {
    const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), 10000);
    const r = await (await fetch(`${WORKER}/entitle`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(info), signal: ctl.signal })).json();
    clearTimeout(t);
    if (!r.ok) return;
    const [tk, ps] = await Promise.all([verifyToken(r.token, 'ent1', verifySigned), verifyToken(r.pass, 'pass1', verifySigned)]);
    if (!tk || !ps) return;
    save('entitle.token', r.token); save('entitle.pass', r.pass); save('entitle.exp', tk.exp);
  } catch { /* offline: the last tokens keep working until they expire */ }
}

export async function refresh() { inFlight ??= fetchTokens().finally(() => { inFlight = null; }); await inFlight; }

async function current(kind, store) {
  if (needsRenewal(load('entitle.exp', 0))) await refresh();
  const t = load(store, '');
  return t && (await verifyToken(t, kind, verifySigned)) ? t : null;
}
export const token = () => current('ent1', 'entitle.token');
export const pass = () => current('pass1', 'entitle.pass');

/// Downloads one piece of server-held content. Resolves to the bytes; rejects with a message for the person.
export async function download(id) {
  if (!entitleInfo()) throw new Error('Needs a Pro key.');
  const t = await token();
  if (!t) throw new Error("Couldn't reach the server. Try again when you're online.");
  let r;
  try { r = await fetch(`${WORKER}/asset/${id}`, { headers: { authorization: `Bearer ${t}` } }); } catch { throw new Error("Couldn't reach the server. Try again when you're online."); }
  if (r.status === 200) return new Uint8Array(await r.arrayBuffer());
  if (r.status === 401) { await refresh(); throw new Error("Your key doesn't include this."); }
  throw new Error(r.status === 403 ? "Your key doesn't include this." : r.status === 404 ? 'Not available yet.' : "Couldn't reach the server. Try again when you're online.");
}
