// Lock Messenger: ask for Windows Hello or a short code before Messenger opens. Only Messenger: every other tab stays as it is.
// It is offered once, the first time Messenger opens. The code's rules are in services/lockcodelogic.js; the same lock is on the Mac.
import { el, load, save } from '../store.js';
import { invoke } from '../native.js';
import { pref } from '../prefs.js';
import { toast, button, modal } from '../ui.js';
import { createStore, cleaned, isValid } from '../services/lockcodelogic.js';

const code = createStore();
let unlockedAt = 0;

export const isLocked = () => load('chatlock.on', false) === true;
export const hasCode = () => code.isSet();
const helloReady = () => invoke('hello_available').catch(() => false);
const stillUnlocked = () => Date.now() - unlockedAt < pref('lock.grace') * 1000;

export function setLocked(on) { save('chatlock.on', on); if (on) unlockedAt = Date.now(); }
export function removeCode() { code.clear(); }

/// Asks for a new code twice. Calls onSaved(true) when it is saved.
export function codeDialog(onSaved = () => {}) {
  const a = el('input', { class: 'field', type: 'password', inputmode: 'numeric', maxlength: '8', placeholder: '4 to 8 digits', 'aria-label': 'New code' });
  const b = el('input', { class: 'field', type: 'password', inputmode: 'numeric', maxlength: '8', placeholder: 'Again', 'aria-label': 'New code again' });
  const err = el('div', { class: 'err small', style: 'min-height:16px' });
  [a, b].forEach((i) => i.addEventListener('input', () => { i.value = cleaned(i.value); err.textContent = ''; }));
  const save1 = async () => {
    if (!isValid(a.value)) { err.textContent = 'Use 4 to 8 digits.'; return; }
    if (a.value !== b.value) { err.textContent = 'The two codes don’t match.'; return; }
    await code.set(a.value);
    m.close(); onSaved(true);
  };
  b.addEventListener('keydown', (e) => { if (e.key === 'Enter') save1(); });
  const m = modal('Set an unlock code', [el('div', { class: 'small dim' }, 'It unlocks Messenger. It is kept on this PC as a scrambled value, never the digits themselves.'), a, b, err],
    { actions: [button('Cancel', () => { m.close(); onSaved(false); }, { kind: 'quiet' }), button('Save', save1)] });
}

/// Shows the lock or the one-time offer instead of Messenger when one is due. Returns true when it drew something
/// (then `retry` opens Messenger once it is unlocked or the offer is answered), false when Messenger can open as usual.
export async function gateMessenger(page, retry) {
  if (isLocked()) {
    if (stillUnlocked()) return false;
    lockScreen(page, retry);
    return true;
  }
  if (!load('chatlock.offerDone', false)) { offerScreen(page, retry); return true; }
  return false;
}

function lockScreen(page, retry) {
  const unlocked = () => { unlockedAt = Date.now(); retry(); };
  const msg = el('div', { class: 'small dim', style: 'min-height:18px;text-align:center' });
  const input = el('input', { class: 'field', type: 'password', inputmode: 'numeric', maxlength: '8', placeholder: 'Code', 'aria-label': 'Unlock code', style: 'max-width:170px;text-align:center;letter-spacing:.3em' });
  const hello = button('Use Windows Hello', async () => {
    try { if (await invoke('hello_verify', { message: 'Unlock Messenger' })) unlocked(); } catch (e) { toast(`Windows Hello: ${e.message}`, { error: true }); }
  }, { kind: 'quiet' });
  const tryCode = async (final) => {
    const typed = input.value;
    if (code.waitRemaining() > 0) return;
    if (!final && !(await code.isRight(typed))) { if (typed.length === 8) tryCode(true); return; }   // a half-typed code is not a wrong try
    if (await code.check(typed)) { unlocked(); return; }
    input.value = ''; msg.textContent = 'That isn’t the right code.'; tick();
  };
  input.addEventListener('input', () => { input.value = cleaned(input.value); if (input.value.length >= 4) tryCode(false); });
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') tryCode(true); });
  const box = el('div', { class: 'empty', style: 'gap:10px' },
    el('div', { class: 'glyph' }, '🔒'), el('div', { class: 'what' }, 'Messenger is locked'),
    ...(code.isSet() ? [input, msg] : []), hello);
  page.replaceChildren(box);
  let timer = null;
  function tick() {
    const wait = code.waitRemaining();
    input.disabled = wait > 0;
    if (wait > 0) { msg.textContent = `Too many tries. Wait ${wait} seconds.`; timer ??= setInterval(() => { if (!box.isConnected) { clearInterval(timer); return; } tick(); }, 1000); }
    else { if (timer) { clearInterval(timer); timer = null; } if (msg.textContent.startsWith('Too many')) msg.textContent = ''; }
  }
  tick();
  if (code.isSet()) setTimeout(() => input.focus(), 30);
  else helloReady().then((ok) => { if (ok && box.isConnected) hello.click(); });   // no code: Windows Hello asks straight away
}

function offerScreen(page, retry) {
  const done = (lock) => { save('chatlock.offerDone', true); if (lock) setLocked(true); retry(); };
  page.replaceChildren(el('div', { class: 'empty', style: 'gap:10px' },
    el('div', { class: 'glyph' }, '🔒'), el('div', { class: 'what' }, 'Lock your messages?'),
    el('div', { class: 'how' }, 'Ask for Windows Hello or a code before Messenger opens. Every other tab stays as it is.'),
    el('div', { class: 'hstack', style: 'justify-content:center' },
      button('Use Windows Hello', async () => {
        if (!(await helloReady())) { toast('Set up Windows Hello first (Windows Settings → Accounts → Sign-in options), or use a code.', { error: true }); return; }
        if (await invoke('hello_verify', { message: 'Lock Messenger' }).catch(() => false)) done(true);
      }),
      button('Use a code…', () => codeDialog((saved) => { if (saved) done(true); }), { kind: 'quiet' })),
    el('button', { class: 'btn small ghost', onclick: () => done(false) }, 'Not now')));
}
