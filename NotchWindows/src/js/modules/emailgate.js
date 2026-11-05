// "Please set up your email": shown at start-up when this PC's key has no email yet (see license.js checkEmailGate).
// "Not now" closes it; paid features stay locked until the email is confirmed. Free features are never affected.

import { el } from '../store.js';
import { verifyFlow } from './security.js';

export function showEmailGate(info) {
  if (document.getElementById('email-gate')) return;
  const close = () => overlay.remove();
  const overlay = el('div', { id: 'email-gate', style: 'position:fixed;inset:0;z-index:9999;background:rgba(0,0,0,.72);display:flex;align-items:center;justify-content:center;padding:16px' },
    el('div', { class: 'card col', style: 'max-width:480px;width:100%;align-items:center;gap:10px;padding:20px' },
      el('div', { style: 'font-size:34px' }, '✉️'),
      el('div', { class: 'title' }, 'Please set up your email'),
      el('div', { class: 'small dim', style: 'text-align:center' }, 'Your key now belongs to one email address, so a key that leaks can’t be used by anyone else. Confirm your email with a code to keep using your paid features. It takes a minute and you only do it once.'),
      verifyFlow(info.key, info, () => { close(); }),
      el('div', { class: 'tiny faint', style: 'text-align:center' }, 'Free features keep working either way. “Not now” leaves paid features locked until this is done.'),
      el('button', { class: 'btn quiet small', onclick: close }, 'Not now')));
  document.body.append(overlay);
}
