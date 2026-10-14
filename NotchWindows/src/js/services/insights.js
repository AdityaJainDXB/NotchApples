// Anonymous opt-in usage count and the feedback card. See insightslogic.js for exactly what is (and is never) sent.

import { load, save, el } from '../store.js';
import { invoke, http } from '../native.js';
import { modal, segmented, toggle, toast, button } from '../ui.js';
import { WORKER, tier } from '../license.js';
import * as L from './insightslogic.js';

export const choice = () => load('insights.choice', '');   // '' = not asked, 'yes', 'no'
export const sharing = () => choice() === 'yes';
const id = () => { let v = load('insights.id', ''); if (!L.validId(v)) { v = L.newId(); save('insights.id', v); } return v; };

let version = null;
async function appVersion() {
  if (version) return version;
  try { version = (await invoke('app_info')).version; } catch { version = '0.0'; }
  return version;
}

export function setSharing(on) {
  save('insights.choice', on ? 'yes' : 'no');
  if (on) { save('insights.lastPing', 0); pingIfDue(); }
}

export async function pingIfDue() {
  if (!sharing() || !L.pingDue(Date.now(), load('insights.lastPing', 0))) return;
  save('insights.lastPing', Date.now());
  try {
    await http(`${WORKER}/telemetry/ping`, { method: 'POST', timeout: 15000,
      json: L.pingBody({ id: id(), version: await appVersion(), osVersion: L.windowsVersion(navigator.userAgent), tier: tier() }) });
  } catch { /* offline: the next try is in a few hours */ }
}

/// Returns null when it went through, or a plain-language reason.
export async function send(kind, text) {
  const body = L.noteBody({ id: id(), version: await appVersion(), kind, text });
  if (body.text.length < 3) return 'Write a few words first.';
  try {
    const r = await http(WORKER + L.endpointFor(body.kind), { method: 'POST', json: body, timeout: 15000 });
    const j = r.ok ? null : (() => { try { return r.json(); } catch { return null; } })();
    return r.ok ? null : (j?.error || 'Couldn’t send that. Try again later.');
  } catch { return 'Couldn’t reach the server. Try again later.'; }
}

/// Opens the feedback card. `scheduled` = it came up on its own (so Not now / Send push the next one 3 to 4 weeks away).
export function ask({ scheduled = false } = {}) {
  let kind = 'idea', count = false;
  const area = el('textarea', { class: 'field', rows: 4, maxlength: 1000, placeholder: L.KIND_PROMPT.idea, style: 'width:100%;resize:vertical' });
  const problem = el('div', { class: 'tiny', style: 'color:#ff9f0a;min-height:14px' });
  const seg = segmented(L.KINDS.map((k) => ({ value: k, label: L.KIND_TITLE[k] })), kind, (v) => { kind = v; area.placeholder = L.KIND_PROMPT[v]; });
  const countRow = choice() === '' ? el('label', { class: 'hstack small', style: 'gap:8px;align-items:flex-start' }, toggle(false, (v) => { count = v; }),
    el('span', { class: 'faint' }, 'Also count this PC, anonymously (app version, Windows version and plan; no name, email or address). Change it any time in Settings.')) : null;
  const done = () => { if (scheduled) save('insights.nextAt', L.nextDue(Date.now())); };
  const m = modal('How is Notch Apple going?', [
    el('div', { class: 'small faint' }, 'Tell us an idea, a problem, or what you like. It goes straight to the people who build it, and only when you press Send.'),
    seg, area, countRow, problem,
  ], { onclose: done, actions: [
    button('Not now', () => m.close(), { small: true }),
    button('Send', async () => {
      problem.textContent = '';
      const why = await send(kind, area.value);
      if (why) { problem.textContent = why; return; }
      if (choice() === '') setSharing(count);
      toast('Thank you!');
      m.close();
    }, { kind: 'primary', small: true }),
  ] });
}

/// Called when the notch opens: the first card after two weeks of use, then every three to four weeks.
export function noteOpened() {
  const now = Date.now(), due = load('insights.nextAt', 0);
  if (!due) { save('insights.nextAt', L.firstDue(now)); return; }
  if (L.isDue(now, due)) ask({ scheduled: true });
}

export function start() {
  pingIfDue();
  setInterval(pingIfDue, 30 * 60_000);
}
