// The lock screen: shown instead of every tab until a valid access code is entered.
import { el } from '../store.js';
import { activate, format } from '../license.js';

export function renderLock(onUnlocked) {
  const input = el('input', {
    class: 'field mono', placeholder: 'NOTCH-XXXX-XXXX', spellcheck: 'false', autocomplete: 'off',
    style: 'max-width:260px;font-size:16px;font-weight:600;text-align:center',
  });
  const error = el('div', { class: 'err', style: 'min-height:16px' });
  const button = el('button', { class: 'btn' }, 'Unlock');

  input.addEventListener('input', () => {
    const formatted = format(input.value);
    if (formatted !== input.value) input.value = formatted;
    error.textContent = '';
  });
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') button.click(); });

  button.addEventListener('click', async () => {
    if (await activate(input.value)) {
      wrap.replaceChildren(el('div', { class: 'center' },
        el('div', { style: 'font-size:34px' }, '✅'),
        el('div', { style: 'font-size:17px;font-weight:700' }, 'Unlocked'),
        el('div', { class: 'small dim' }, 'Notch apple is unlocked on this PC.')));
      setTimeout(onUnlocked, 900);
    } else {
      error.textContent = 'Invalid Access Code. Please try again.';
      input.animate(
        [{ transform: 'translateX(0)' }, { transform: 'translateX(-9px)' }, { transform: 'translateX(9px)' },
         { transform: 'translateX(-5px)' }, { transform: 'translateX(0)' }],
        { duration: 320, easing: 'ease-in-out' });
    }
  });

  const wrap = el('div', { class: 'center' },
    el('div', { style: 'font-size:34px' }, '🔒'),
    el('div', { style: 'font-size:17px;font-weight:700' }, 'Notch apple is locked'),
    el('div', { class: 'small dim', style: 'max-width:420px' },
      'Enter your access code to unlock it on this PC. The same code works on the Mac app.'),
    input, error, button);
  setTimeout(() => input.focus(), 30);
  return wrap;
}
