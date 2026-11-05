// "Please set up your email": shown at start-up when this PC's key has no email yet (see license.js checkEmailGate).
// It covers the whole window and cannot be dismissed: the only way out is confirming the email (Quit is the other).

import { el } from '../store.js';
import { verifyFlow } from './security.js';

export function showEmailGate(info) {
  if (document.getElementById('email-gate')) return;
  const overlay = el('div', { id: 'email-gate', style: 'position:fixed;inset:0;z-index:2147483647;background:#0b0b10;display:flex;align-items:center;justify-content:center;padding:16px;overflow:auto' },
    el('div', { class: 'card col', style: 'max-width:480px;width:100%;align-items:center;gap:10px;padding:20px' },
      el('div', { style: 'font-size:34px' }, '✉️'),
      el('div', { class: 'title' }, 'Please set up your email'),
      el('div', { class: 'small dim', style: 'text-align:center' }, 'Your key now belongs to one email address, so a key that leaks can’t be used by anyone else. Confirm your email with a code to keep using Notch Apple. It takes a minute and you only do it once.'),
      verifyFlow(info.key, info, () => overlay.remove()),
      el('div', { class: 'tiny faint', style: 'text-align:center' }, 'Notch Apple stays locked until this is done.')));
  // Nothing underneath can be reached by keyboard or shortcut while it is up.
  overlay.addEventListener('keydown', (e) => e.stopPropagation());
  document.body.append(overlay);
  overlay.querySelector('input')?.focus();
}
