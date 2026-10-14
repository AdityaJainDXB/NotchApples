// The Bambu Lab tab: a status card per printer (green printing, yellow paused, blue idle, gray offline), the print's
// file, progress, time left and live temperatures, a red warning when a heater runs too hot, and the printer list
// (IP, access code and serial from the printer's LAN mode screen).

import { el } from '../store.js';
import { button, toggle, toast, holdButton, setting, empty } from '../ui.js';
import * as B from '../services/bambu.js';
import * as L from '../services/bambulogic.js';

export function render(root) {
  let selected = B.printers()[0]?.id || null;
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

  function paint() {
    const list = B.printers();
    if (!list.find((p) => p.id === selected)) selected = list[0]?.id || null;
    const parts = [];

    parts.push(el('div', { class: 'card' }, setting('Watch my printers', 'Off means Notch Apple never contacts the printers. Every report stays on this PC.',
      toggle(B.isOn(), (v) => { v ? B.enable() : B.disable(); paint(); }))));

    if (!list.length) {
      parts.push(empty('🖨️', 'No printer yet', 'Add your Bambu printer below with the IP, access code and serial number shown on its screen under Settings → LAN Mode.'));
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
        el('div', { class: 'small faint' }, `${p.host} · ${p.serial}`),
        el('div', { class: 'hstack', style: 'gap:8px' },
          button('Reconnect', () => { B.enable(); toast('Reconnecting…'); }, { small: true }),
          button('Trust new certificate', async () => { await B.trustNewCertificate(p.id); toast('Will remember the printer’s new certificate'); }, { small: true, title: 'Use after a printer firmware update or reset. Notch Apple remembers the certificate the printer showed the first time and refuses a different one.' }),
          el('span', { class: 'grow' }),
          holdButton('Remove', () => { B.remove(p.id); paint(); }, { hint: 'Hold to remove this printer' }))));
    }

    parts.push(el('div', { class: 'card col', style: 'gap:8px' },
      setting('Sound when a print pauses, finishes or fails', '', toggle(B.sounds(), (v) => B.setSounds(v))),
      setting('Warn when a heater runs too hot', 'Nozzle over 300°, bed over 110°, 15° over target, or a hotend that keeps heating with the heater off.', toggle(B.thermal(), (v) => B.setThermal(v)))));

    const draft = L.blankPrinter();
    const problem = el('div', { class: 'tiny', style: 'color:#ff9f0a;min-height:14px' });
    parts.push(el('div', { class: 'card col', style: 'gap:8px' }, el('b', {}, 'Add a printer'),
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
