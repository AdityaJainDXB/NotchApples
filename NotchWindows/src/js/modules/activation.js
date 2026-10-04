// Unlocking Pro and Ultimate: the card shown on a locked tab, and the key field
// (also used in Settings → Access). Keys come from the website and work on Mac and Windows.
import { el } from '../store.js';
import { activate, format } from '../license.js';
import { invoke } from '../app.js';

export const BUY_URL = 'https://virajsinghchadha.github.io/notchapples-site/pro.html';

/// A field that takes an NTCH-PRO-…/NTCH-ULTM-… key or an old NOTCH-XXXX-XXXX code.
export function keyField(onDone) {
  const input = el('input', {
    class: 'field mono', placeholder: 'NTCH-PRO-… or NOTCH-XXXX-XXXX', spellcheck: 'false', autocomplete: 'off',
    style: 'max-width:420px;font-size:13px;font-weight:600;text-align:center',
  });
  const error = el('div', { class: 'err small', style: 'min-height:16px' });
  const button = el('button', { class: 'btn' }, 'Unlock');

  input.addEventListener('input', () => {
    const formatted = format(input.value);
    if (formatted !== input.value) input.value = formatted;
    error.textContent = '';
  });
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') button.click(); });

  button.addEventListener('click', async () => {
    button.disabled = true;
    const r = await activate(input.value);
    button.disabled = false;
    if (r.ok) { onDone(r.tier); return; }
    error.textContent = r.error;
    input.animate(
      [{ transform: 'translateX(0)' }, { transform: 'translateX(-9px)' }, { transform: 'translateX(9px)' },
       { transform: 'translateX(-5px)' }, { transform: 'translateX(0)' }],
      { duration: 320, easing: 'ease-in-out' });
  });
  return el('div', { class: 'col', style: 'align-items:center;gap:6px;width:100%' }, input, error, button);
}

export function renderUpgrade(entry, onUnlocked) {
  const name = entry.tier === 2 ? 'Ultimate' : 'Pro';
  const wrap = el('div', { class: 'center' },
    el('div', { style: 'font-size:34px' }, entry.icon),
    el('div', { style: 'font-size:17px;font-weight:700' }, `${entry.name} is part of ${name}`),
    el('div', { class: 'small dim', style: 'max-width:420px' },
      'Pro is a one-time $1 and Ultimate $5, paid in Litecoin, with every future update included. '
      + 'One key works on up to 3 devices, Mac or Windows.'),
    el('button', { class: 'btn quiet', onclick: () => invoke('open_url', { url: BUY_URL }) }, `Get ${name} →`),
    keyField(() => {
      wrap.replaceChildren(el('div', { class: 'center' },
        el('div', { style: 'font-size:34px' }, '✅'),
        el('div', { style: 'font-size:17px;font-weight:700' }, 'Unlocked'),
        el('div', { class: 'small dim' }, 'Thanks for supporting Notch apple.')));
      setTimeout(onUnlocked, 900);
    }));
  return wrap;
}
