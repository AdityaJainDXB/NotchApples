// Email verification and the optional authenticator app. A key belongs to one email: a new PC confirms it with a code we email
// (the default), or with a code from an authenticator app (Google or Microsoft Authenticator) the owner set up earlier.

import { el } from '../store.js';
import { requestCode, verifyCode, securityStatus, totpSetup, totpConfirm, totpDisable, addEmailStart, addEmailFinish } from '../license.js';
import { toast } from '../ui.js';
import qrcode from '../vendor/qrcode.js';
import { stringToBytes } from '../vendor/qrcode-utf8.js';
qrcode.stringToBytes = stringToBytes;

/// A QR code as a canvas (white quiet zone so phone cameras read it in dark mode too).
export function qr(text, size = 156) {
  const q = qrcode(0, 'M'); q.addData(text); q.make();
  const n = q.getModuleCount(), quiet = 4, cell = Math.max(2, Math.floor((size * 2) / (n + quiet * 2))), px = (n + quiet * 2) * cell;
  const c = el('canvas', { width: px, height: px, style: `width:${size}px;height:${size}px;image-rendering:pixelated;border-radius:8px;background:#fff` });
  const g = c.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, px, px); g.fillStyle = '#000';
  for (let r = 0; r < n; r++) for (let k = 0; k < n; k++) if (q.isDark(r, k)) g.fillRect((k + quiet) * cell, (r + quiet) * cell, cell, cell);
  return c;
}

const codeInput = () => el('input', { class: 'field mono', placeholder: '6-digit code', inputmode: 'numeric', maxlength: '7', autocomplete: 'one-time-code', style: 'max-width:200px;text-align:center;font-size:18px;letter-spacing:4px;font-weight:700' });
const emailInput = (v = '') => el('input', { class: 'field', type: 'email', 'aria-label': 'Your email address', autocomplete: 'email', value: v, style: 'max-width:340px;text-align:center' });
/// An email box with a plain label above it (no example address, which people mistook for text they had to edit).
const labelled = (input) => el('label', { class: 'col', style: 'align-items:center;gap:3px;width:100%' }, el('span', { class: 'tiny dim' }, 'Your email address'), input);
const note = () => el('div', { class: 'err small', style: 'min-height:16px;text-align:center' });

/// Shown when a key needs this PC confirmed. `onDone(result)` gets { ok, tier } from the finished activation.
export function verifyFlow(key, info, onDone) {
  const wrap = el('div', { class: 'col', style: 'align-items:center;gap:8px;width:100%' });
  let email = '', method = 'email';
  // A requested code is remembered for its 10 minutes, so leaving to read the email (or a restart) comes back to the code box.
  const MEM = 'license.verify', LIFE = 10 * 60 * 1000;
  const remember = (v) => { try { v ? localStorage.setItem(MEM, JSON.stringify({ email: v, at: Date.now() })) : localStorage.removeItem(MEM); } catch { /* private mode: fine */ } };
  const recall = () => { try { const m = JSON.parse(localStorage.getItem(MEM) || 'null'); return m && Date.now() - m.at < LIFE ? m.email : null; } catch { return null; } };
  const step1 = () => {
    const input = emailInput(), err = note(), go = el('button', { class: 'btn' }, 'Email me a code');
    const send = async () => {
      if (!/^\S+@\S+\.\S+$/.test(input.value.trim())) { err.textContent = 'Enter a valid email address.'; return; }
      go.disabled = true; go.textContent = 'Sending…'; email = input.value.trim();
      const r = await requestCode(key, email); go.disabled = false; go.textContent = 'Email me a code';
      if (r.ok) { remember(email); step2(); } else err.textContent = r.error;
    };
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') send(); });
    go.addEventListener('click', send);
    wrap.replaceChildren(
      el('div', { class: 'title' }, 'Confirm it’s you'),
      el('div', { class: 'small dim', style: 'text-align:center;max-width:380px' }, info.bound
        ? `This key belongs to an email address${info.hint ? ` (${info.hint})` : ''}. Enter it and we’ll send a code to confirm this PC.`
        : 'Enter your email address. We’ll send a code, and the key will belong to that address from now on.'),
      labelled(input), err, go,
      el('button', { class: 'btn quiet small', onclick: () => step2(true) }, 'I use an authenticator app'));
    input.focus();
  };
  const step2 = (authenticator = false) => {
    method = authenticator ? 'totp' : 'email';
    const input = codeInput(), err = note(), go = el('button', { class: 'btn' }, 'Confirm');
    const emailBox = authenticator ? emailInput(email) : null;
    const confirm = async () => {
      const addr = emailBox ? emailBox.value.trim() : email;
      if (!addr) { err.textContent = 'Enter your email address.'; return; }
      go.disabled = true; go.textContent = 'Checking…';
      const r = await verifyCode(key, addr, input.value, method);
      go.disabled = false; go.textContent = 'Confirm';
      if (r.ok) { remember(null); onDone(r); } else err.textContent = r.error;
    };
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') confirm(); });
    go.addEventListener('click', confirm);
    wrap.replaceChildren(
      el('div', { class: 'title' }, authenticator ? 'Authenticator code' : 'Check your email'),
      el('div', { class: 'small dim', style: 'text-align:center;max-width:380px' }, authenticator
        ? 'Open your authenticator app and enter the 6-digit code for Notch Apple.'
        : `If ${email} is the address this key belongs to, we sent it a 6-digit code (valid 10 minutes, check spam too). If it isn’t, no code is sent: only the key’s owner can sign in on a new device.`),
      emailBox ? labelled(emailBox) : null, input, err, go,
      el('button', { class: 'btn quiet small', onclick: () => { if (!authenticator) remember(null); step1(); } }, authenticator ? '← Use an email code instead' : '← Use a different email'));
    input.focus();
  };
  const back = recall();
  if (back) { email = back; step2(); } else step1();
  return wrap;
}

/// Settings → Access: add an email to a key that has none, and set up (or remove) the authenticator app.
export function securityCard(repaint) {
  const box = el('div', { class: 'card col', style: 'gap:8px' }, el('div', { class: 'section-title' }, 'Security'), el('div', { class: 'small dim' }, 'Checking…'));
  securityStatus().then((st) => {
    const body = [];
    if (!st) body.push(el('div', { class: 'small dim' }, 'Couldn’t reach the server. Try again when you’re online.'));
    else if (!st.email) body.push(emailSetup(repaint));
    else {
      body.push(el('div', { class: 'small' }, `✓ Your key belongs to ${st.hint || 'your email'}. A new device must confirm with a code we email you.`));
      body.push(st.totp ? totpOff(repaint) : totpOn(repaint));
    }
    box.replaceChildren(el('div', { class: 'section-title' }, 'Security'), ...body);
  });
  return box;
}

function emailSetup(repaint) {
  const wrap = el('div', { class: 'col', style: 'gap:8px' });
  const intro = el('div', { class: 'small dim' }, 'Your key has no email yet, so anyone who finds it could use it. Add your email: we send a code to it, and the key will then work on a new device only with a code from your inbox.');
  const start = () => {
    const input = emailInput(), err = note(), go = el('button', { class: 'btn small' }, 'Email me a code');
    go.addEventListener('click', async () => {
      if (!/^\S+@\S+\.\S+$/.test(input.value.trim())) { err.textContent = 'Enter a valid email address.'; return; }
      go.disabled = true; const addr = input.value.trim(); const r = await addEmailStart(addr); go.disabled = false;
      if (r.ok) finish(addr); else err.textContent = r.error;
    });
    wrap.replaceChildren(intro, labelled(input), err, go);
  };
  const finish = (addr) => {
    const code = codeInput(), err = note(), go = el('button', { class: 'btn small' }, 'Confirm');
    go.addEventListener('click', async () => {
      go.disabled = true; const r = await addEmailFinish(addr, code.value); go.disabled = false;
      if (r.ok) { toast('Email added. Your key is now protected.'); repaint(); } else err.textContent = r.error;
    });
    wrap.replaceChildren(el('div', { class: 'small dim' }, `We sent a code to ${addr}.`), code, err, go);
  };
  start();
  return wrap;
}

function totpOn(repaint) {
  const wrap = el('div', { class: 'col', style: 'gap:6px' });
  const intro = el('div', { class: 'small dim' }, 'Optional: use an authenticator app (Google Authenticator, Microsoft Authenticator, 1Password…) to confirm a new device instead of waiting for an email.');
  const go = el('button', { class: 'btn small quiet' }, 'Set up an authenticator app');
  go.addEventListener('click', async () => {
    go.disabled = true; const r = await totpSetup(); go.disabled = false;
    if (!r.uri) { toast(r.error || 'Could not start setup.', { error: true }); return; }
    const code = codeInput(), err = note(), ok = el('button', { class: 'btn small' }, 'Turn on');
    ok.addEventListener('click', async () => {
      ok.disabled = true; const c = await totpConfirm(code.value); ok.disabled = false;
      if (c.ok) { toast('Authenticator app is on.'); repaint(); } else err.textContent = c.error;
    });
    wrap.replaceChildren(intro,
      el('div', { class: 'small' }, '1. Scan this with your authenticator app'), el('div', { style: 'align-self:center' }, qr(r.uri)),
      el('div', { class: 'tiny dim', style: 'text-align:center' }, 'Can’t scan? Enter this key by hand:'), el('div', { class: 'mono small selectable', style: 'text-align:center;word-break:break-all' }, r.secret),
      el('div', { class: 'small' }, '2. Enter the 6-digit code it shows'), code, err, ok);
  });
  wrap.append(intro, go);
  return wrap;
}

function totpOff(repaint) {
  const code = codeInput(), err = note(), go = el('button', { class: 'btn small danger' }, 'Turn off');
  go.addEventListener('click', async () => {
    go.disabled = true; const r = await totpDisable(code.value); go.disabled = false;
    if (r.ok) { toast('Authenticator app turned off.'); repaint(); } else err.textContent = r.error;
  });
  return el('div', { class: 'col', style: 'gap:6px' },
    el('div', { class: 'small' }, '✓ Authenticator app is on: a new device can use its code instead of the email.'),
    el('div', { class: 'tiny dim' }, 'To turn it off, enter a current code from the app.'), code, err, go);
}
