// Unlocking Pro and Ultimate: the card shown on a locked tab, the key field
// (also used in Settings → Access) and the small "Pro" note inside free tabs.
// Keys come from the website and work on Mac and Windows.

import { el } from '../store.js';
import { activate, format } from '../license.js';
import { openUrl } from '../native.js';
import { FEATURES, tierLabel } from '../features.js';

export const BUY_URL = 'https://virajsinghchadha.github.io/notchapples-site/pro.html';

/// A field that takes an NTCH-PRO-…/NTCH-ULTM-… key or an old NOTCH-XXXX-XXXX code.
export function keyField(onDone) {
  const input = el('input', {
    class: 'field mono', placeholder: 'NTCH-PRO-… or NOTCH-XXXX-XXXX', spellcheck: 'false', autocomplete: 'off',
    style: 'max-width:440px;font-weight:600;text-align:center',
  });
  const error = el('div', { class: 'err small', style: 'min-height:16px;text-align:center' });
  const button = el('button', { class: 'btn' }, 'Unlock');

  input.addEventListener('input', () => {
    const formatted = format(input.value);
    if (formatted !== input.value) input.value = formatted;
    error.textContent = '';
  });
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') button.click(); });
  // Pasting a whole key with stray spaces or line breaks still works.
  input.addEventListener('paste', () => setTimeout(() => { input.value = format(input.value.replace(/\s+/g, '')); }, 0));

  button.addEventListener('click', async () => {
    if (!input.value.trim()) { error.textContent = 'Paste your key first.'; return; }
    button.disabled = true;
    button.textContent = 'Checking…';
    const r = await activate(input.value).catch((e) => ({ error: e.message }));
    button.disabled = false;
    button.textContent = 'Unlock';
    if (r.ok) { onDone(r.tier); return; }
    error.textContent = r.error;
    input.animate(
      [{ transform: 'translateX(0)' }, { transform: 'translateX(-9px)' }, { transform: 'translateX(9px)' },
       { transform: 'translateX(-5px)' }, { transform: 'translateX(0)' }],
      { duration: 320, easing: 'ease-in-out' });
  });
  return el('div', { class: 'col', style: 'align-items:center;gap:6px;width:100%' }, input, error, button);
}

/// The card a locked tab shows: what it does, and how to unlock it.
export function renderUpgrade(module, onUnlocked) {
  const f = FEATURES[module.feature] || {};
  const name = tierLabel(f.tier || 1);
  const wrap = el('div', { class: 'center' },
    el('div', { class: 'col', style: 'align-items:center;max-width:460px;gap:8px' },
      el('div', { style: 'font-size:38px' }, module.icon),
      el('div', { class: 'title' }, `${module.name} is part of ${name}`),
      el('div', { class: 'small dim' }, module.blurb || f.detail || ''),
      el('div', { class: 'small faint' }, 'Pro is a one-time $1 and Ultimate $5, with every future update included. One key works on up to 3 devices, Mac or Windows.'),
      el('button', { class: 'btn quiet', onclick: () => openUrl(BUY_URL) }, `Get ${name} →`),
      keyField(() => {
        wrap.replaceChildren(el('div', { class: 'center' },
          el('div', { style: 'font-size:34px' }, '✅'),
          el('div', { class: 'title' }, 'Unlocked'),
          el('div', { class: 'small dim' }, 'Thanks for supporting Notch apple.')));
        setTimeout(onUnlocked, 900);
      })));
  return wrap;
}

/// A one-line note inside a free tab for a Pro part of it.
export function proNote(featureId, text) {
  const f = FEATURES[featureId];
  const label = tierLabel(f?.tier || 1);
  return el('div', { class: 'locked-note' },
    el('span', { class: `badge ${f?.tier >= 2 ? 'ult' : 'pro'}` }, label.toUpperCase()),
    el('span', { class: 'grow' }, text || f?.detail || ''),
    el('button', { class: 'btn small quiet', onclick: async () => (await import('../app.js')).show('settings', { pane: 'Access' }) }, 'Unlock'));
}

export const badge = (featureId) => {
  const t = FEATURES[featureId]?.tier || 1;
  return el('span', { class: `badge ${t >= 2 ? 'ult' : 'pro'}`, title: FEATURES[featureId]?.detail }, t >= 2 ? 'ULTIMATE' : 'PRO');
};
