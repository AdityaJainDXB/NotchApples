// The Bambu Lab tab: a status card per printer (green printing, yellow paused, blue idle, gray offline), the print's
// file, progress, time left and live temperatures, a red warning when a heater runs too hot, and the printer list
// (IP, access code and serial from the printer's LAN mode screen).

import { el } from '../store.js';
import { button, toggle, toast, holdButton, setting, empty } from '../ui.js';
import * as B from '../services/bambu.js';
import * as L from '../services/bambulogic.js';
import * as C from '../services/bambucloudlogic.js';

const REGION_NAMES = Object.fromEntries(Object.entries(C.REGIONS).map(([k, v]) => [k, v.name]));

export function render(root) {
  let selected = B.printers()[0]?.id || null;
  // The Bambu account sign-in: idle, then (if Bambu asks) an email code or an authenticator code, then the printer list.
  const acct = { step: 'idle', region: 'global', account: '', tfaKey: '', devices: [], chosen: new Set(), msg: '', busy: false };
  const body = el('div', { class: 'col gap-8 scroll fill' });
  root.append(body);

  const field = (label, value, onchange, attrs = {}) =>
    el('label', { class: 'col', style: 'gap:2px;flex:1;min-width:140px' }, el('span', { class: 'tiny faint' }, label),
      el('input', { class: 'field', value, oninput: (e) => onchange(e.target.value), ...attrs }));

  function statusCard(p) {
    const s = B.snapshot(p.id), busy = B.isConnecting(p.id);
    const colour = L.phaseColour(s);
    const word = busy ? 'Connecting…' : { printing: 'Printing', paused: 'Paused', idle: 'Idle', offline: 'Offline' }[s.phase];
    const children = [
      el('div', { class: 'hstack', style: 'gap:8px' },
        el('span', { style: `width:9px;height:9px;border-radius:50%;background:${colour};box-shadow:0 0 8px ${colour};opacity:${busy ? 0.4 : 1}` }),
        el('b', {}, word), el('span', { class: 'grow' }), el('span', { class: 'tiny faint' }, L.printerName(p))),
    ];
    if (s.filename && s.phase !== 'offline') children.push(el('div', { class: 'small ellipsis' }, s.filename));
    if (s.phase === 'printing' || s.phase === 'paused') {
      children.push(
        el('div', { class: 'hstack', style: 'gap:8px;align-items:baseline' },
          el('b', { style: 'font-size:22px' }, `${s.progress}%`), el('span', { class: 'grow' }),
          el('span', { class: 'tiny faint' }, L.remainingLabel(s.remainingMinutes) || '')),
        el('div', { style: 'height:6px;border-radius:3px;background:rgba(255,255,255,.12);overflow:hidden' },
          el('div', { style: `height:100%;width:${s.progress}%;background:${colour};transition:width .6s ease` })));
    }
    if (s.phase !== 'offline') {
      children.push(el('div', { class: 'hstack small', style: 'gap:16px' },
        el('span', {}, '🔥 ', el('b', {}, L.tempLabel(s.nozzleC)), el('span', { class: 'faint' }, ' Nozzle')),
        el('span', {}, '♨️ ', el('b', {}, L.tempLabel(s.bedC)), el('span', { class: 'faint' }, ' Bed'))));
    }
    return el('div', { class: 'card col', style: 'gap:8px' }, ...children);
  }

  async function afterToken(token) {
    const r = await B.cloudFinish(acct.region, token);
    acct.busy = false;
    if (!r.ok) { acct.msg = r.message; acct.step = 'idle'; return paint(); }
    acct.devices = r.devices; acct.chosen = new Set(r.devices.map((d) => d.serial)); acct.step = 'devices';
    acct.msg = r.devices.length ? '' : 'No printers are bound to this account yet.';
    paint();
  }
  async function step(result) {
    if (result.kind === 'ok') return afterToken(result.token);
    acct.busy = false;
    if (result.kind === 'verify') { const s = await B.cloudSendCode(acct.region, acct.account); acct.step = 'verify'; acct.msg = s.ok ? 'Bambu emailed you a six-digit code.' : s.message; }
    else if (result.kind === 'tfa') { acct.step = 'tfa'; acct.tfaKey = result.tfaKey; acct.msg = 'Enter the code from your authenticator app.'; }
    else acct.msg = result.message;
    paint();
  }
  function accountCard() {
    const signed = B.cloudRegion();
    const note = el('div', { class: 'tiny faint' }, 'Your password goes only to Bambu, from this PC, and is never saved. Notch Apple keeps just the sign-in token Bambu returns, in its private folder, and signing out deletes it. Bambu has no official way to do this, so it may stop working if Bambu changes its sign-in: LAN Mode will always work.');
    const msg = el('div', { class: 'small', style: 'color:#ff9f0a;min-height:16px' }, acct.msg);
    if (acct.step === 'devices') {
      const rows = acct.devices.map((d) => el('label', { class: 'hstack', style: 'gap:8px' },
        el('input', { type: 'checkbox', checked: acct.chosen.has(d.serial), onchange: (e) => { e.target.checked ? acct.chosen.add(d.serial) : acct.chosen.delete(d.serial); } }),
        el('span', {}, d.name), el('span', { class: 'tiny faint' }, `${d.model ? d.model + ' · ' : ''}${d.online ? 'online' : 'offline'}`)));
      return el('div', { class: 'card col', style: 'gap:8px' }, el('b', {}, 'Printers on your Bambu account'), ...rows, msg,
        button('Add selected printers', () => {
          const r = B.cloudAdd(acct.devices.filter((d) => acct.chosen.has(d.serial)), acct.region);
          acct.step = 'idle'; acct.msg = ''; if (r.stopped) toast(r.stopped); else toast(r.added ? `Added ${r.added} printer${r.added === 1 ? '' : 's'}` : 'Those printers are already added');
          selected = B.printers().at(-1)?.id || selected; paint();
        }, { small: true }));
    }
    if (acct.step === 'verify' || acct.step === 'tfa') {
      const code = el('input', { class: 'field', inputmode: 'numeric', maxlength: '8', placeholder: '123456', autocomplete: 'one-time-code' });
      const go = async () => {
        if (acct.busy) return; acct.busy = true; acct.msg = 'Checking…'; const v = code.value; paint();
        step(acct.step === 'verify' ? await B.cloudWithCode(acct.region, acct.account, v) : await B.cloudWithTfa(acct.region, acct.tfaKey, v));
      };
      return el('div', { class: 'card col', style: 'gap:8px' }, el('b', {}, 'Bambu account: confirm it is you'), msg,
        el('div', { class: 'hstack', style: 'gap:8px' }, code, button('Confirm', go, { small: true }), button('Cancel', () => { acct.step = 'idle'; acct.msg = ''; paint(); }, { small: true })));
    }
    if (signed) {
      return el('div', { class: 'card col', style: 'gap:8px' }, el('b', {}, '✅ Signed in to your Bambu account'),
        el('div', { class: 'small faint' }, `Region: ${REGION_NAMES[signed] || signed}. Printers added from the account are watched without LAN Mode. To pick up a newly added printer, sign out and sign in again.`),
        el('div', { class: 'hstack', style: 'gap:8px' }, holdButton('Sign out', async () => { await B.cloudSignOut(); toast('Signed out. The saved sign-in is deleted.'); paint(); }, { hint: 'Hold to sign out and remove the account’s printers' })), note);
    }
    const email = el('input', { class: 'field', type: 'email', placeholder: 'Bambu account email', autocomplete: 'off' });
    const pass = el('input', { class: 'field', type: 'password', placeholder: 'Password', autocomplete: 'off' });
    const region = el('select', { class: 'field', onchange: (e) => { acct.region = e.target.value; } },
      ...Object.entries(REGION_NAMES).map(([k, n]) => el('option', { value: k, selected: k === acct.region }, n)));
    const go = async () => {
      if (acct.busy) return;
      acct.account = email.value.trim(); acct.region = region.value;
      const pw = pass.value; pass.value = '';          // the password leaves the screen the moment it is sent
      acct.busy = true; acct.msg = 'Signing in…'; msg.textContent = acct.msg;
      const r = await B.cloudSignIn(acct.region, acct.account, pw);
      step(r);
    };
    // For accounts made with Google, Apple or Facebook (no Bambu password): Bambu emails a code to the account's address.
    const emailCode = async () => {
      if (acct.busy) return;
      acct.account = email.value.trim(); acct.region = region.value;
      if (!C.looksLikeEmail(acct.account)) { acct.msg = 'Enter the email address of your Bambu account first.'; msg.textContent = acct.msg; return; }
      acct.busy = true; acct.msg = 'Asking Bambu to email you a code…'; msg.textContent = acct.msg;
      const s = await B.cloudSendCode(acct.region, acct.account);
      acct.busy = false; acct.step = s.ok ? 'verify' : 'idle'; acct.msg = s.ok ? 'Bambu emailed you a six-digit code.' : s.message; paint();
    };
    return el('div', { class: 'card col', style: 'gap:8px' }, el('b', {}, 'Or: sign in with your Bambu account'),
      el('div', { class: 'small faint' }, 'Watch your printers without turning LAN Mode on, so the Bambu Handy app and the printer’s cloud features keep working.'),
      el('div', { class: 'hstack', style: 'gap:8px;flex-wrap:wrap' }, region, email, pass, button('Sign in', go, { small: true })),
      el('div', { class: 'hstack', style: 'gap:8px;flex-wrap:wrap;align-items:center' }, button('Email me a code instead', emailCode, { small: true, title: 'For accounts you made with Google, Apple or Facebook: no password needed' }),
        el('span', { class: 'tiny faint' }, 'Sign in to Bambu with Google, Apple or Facebook? Enter the same email and use this, no password needed.')), msg, note);
  }

  function paint() {
    const list = B.printers();
    if (!list.find((p) => p.id === selected)) selected = list[0]?.id || null;
    const parts = [];

    parts.push(el('div', { class: 'card' }, setting('Watch my printers', 'Off means Notch Apple never contacts the printers. Every report stays on this PC.',
      toggle(B.isOn(), (v) => { v ? B.enable() : B.disable(); paint(); }))));

    if (!list.length) {
      parts.push(empty('🖨️', 'No printer yet', 'Add your Bambu printer below with the IP, access code and serial number shown on its screen under Settings → LAN Mode. Note: LAN Mode turns off the printer\'s cloud features (Bambu Handy, remote printing).'));
    } else {
      if (list.length > 1) {
        parts.push(el('div', { class: 'hstack', style: 'gap:6px;flex-wrap:wrap' }, ...list.map((p) =>
          el('button', { class: `btn small ${p.id === selected ? '' : 'ghost'}`, onclick: () => { selected = p.id; paint(); } }, L.printerName(p)))));
      }
      const p = list.find((x) => x.id === selected);
      parts.push(statusCard(p));
      const hot = B.alertFor(p.id);
      if (hot) parts.push(el('div', { class: 'card', style: 'border:1px solid rgba(255,69,58,.6);background:rgba(255,69,58,.14)' }, '🌡️ ', hot.message));
      const why = B.failure(p.id);
      if (why) parts.push(el('div', { class: 'card small faint' }, '⚠️ ', why));
      parts.push(el('div', { class: 'card col', style: 'gap:8px' },
        el('b', {}, 'Selected printer'),
        el('div', { class: 'small faint' }, p.cloud ? `Through your Bambu account · ${p.serial}` : `${p.host} · ${p.serial}`),
        el('div', { class: 'hstack', style: 'gap:8px' },
          button('Reconnect', () => { B.enable(); toast('Reconnecting…'); }, { small: true }),
          ...(p.cloud ? [] : [button('Trust new certificate', async () => { await B.trustNewCertificate(p.id); toast('Will remember the printer’s new certificate'); }, { small: true, title: 'Use after a printer firmware update or reset. Notch Apple remembers the certificate the printer showed the first time and refuses a different one.' })]),
          el('span', { class: 'grow' }),
          holdButton('Remove', () => { B.remove(p.id); paint(); }, { hint: 'Hold to remove this printer' }))));
    }

    parts.push(el('div', { class: 'card col', style: 'gap:8px' },
      setting('Sound when a print pauses, finishes or fails', '', toggle(B.sounds(), (v) => B.setSounds(v))),
      setting('Warn when a heater runs too hot', 'Nozzle over 300°, bed over 110°, 15° over target, or a hotend that keeps heating with the heater off.', toggle(B.thermal(), (v) => B.setThermal(v)))));

    const draft = L.blankPrinter();
    const problem = el('div', { class: 'tiny', style: 'color:#ff9f0a;min-height:14px' });
    parts.push(el('div', { class: 'card' }, el('b', {}, '⚠️ Please note'), el('div', { class: 'muted', style: 'margin-top:4px' }, "LAN Mode switches off the printer's cloud features: the Bambu Handy app, starting or watching prints from outside your home, and print history in Bambu Cloud. Some printers and firmware versions may answer on your network without LAN Mode, so try adding the printer first and switch LAN Mode on only if it cannot connect. Signing in with your Bambu account (below) avoids LAN Mode altogether.")));
    parts.push(accountCard());
    parts.push(el('div', { class: 'card col', style: 'gap:8px' }, el('b', {}, 'Add a printer on the LAN (needs LAN Mode)'),
      el('div', { class: 'hstack', style: 'gap:8px;flex-wrap:wrap' },
        field('Name (optional)', '', (v) => { draft.name = v; }),
        field('IP address or hostname', '', (v) => { draft.host = v; }),
        field('Access code', '', (v) => { draft.accessCode = v; }, { type: 'password' }),
        field('Serial number', '', (v) => { draft.serial = v; })),
      problem,
      button('Add printer', () => {
        const bad = B.add(draft);
        if (bad) { problem.textContent = bad; return; }
        selected = B.printers().at(-1).id; paint();
      }, { small: true })));

    body.replaceChildren(...parts);
  }

  paint();
  // A printer reports about once a second; repainting would wipe what is being typed in the Add form.
  const off = B.onChange(() => {
    if (!body.isConnected) return off();
    const a = document.activeElement;
    if (a && a.tagName === 'INPUT' && body.contains(a)) return;
    paint();
  });
}
