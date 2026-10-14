// Signing in to Bambu Cloud, so a printer can be watched without LAN Mode (which turns the printer's cloud features off).
//
// How it stays safe:
//  - the password goes only to Bambu (api.bambulab.com, or .cn), over https, from this PC. It is held in memory for the
//    one sign-in call, never saved, never logged, and the sign-in screen clears the field straight after;
//  - what is kept is the access token Bambu returns (in the app's private data folder, handled in Rust), and the
//    printer is then reached through Bambu's own MQTT broker, checked against the system's trusted authorities;
//  - this module only knows Bambu's two regions: no other address can be given to it.
//
// Bambu has no official API for this. The calls below follow what the community has documented, so any step can stop
// working when Bambu changes it: every failure is turned into a plain message that points back to LAN Mode.
// Pure, with the HTTP function passed in, so it is tested against a fake Bambu (tests/bambucloud.test.mjs).

// (the serial rule is repeated from bambulogic.js so this file has no imports and can be tested on its own)
function normalizeSerial(raw) {
  const s = String(raw || '').trim().replace(/\s+/g, '').toUpperCase();
  return s.length < 8 || s.length > 32 || !/^[A-Z0-9]+$/.test(s) ? null : s;
}

export const REGIONS = {
  global: { name: 'Global (most accounts)', api: 'https://api.bambulab.com', web: 'https://bambulab.com' },
  china: { name: 'China', api: 'https://api.bambulab.cn', web: 'https://bambulab.cn' },
};
export const regionOf = (r) => (Object.prototype.hasOwnProperty.call(REGIONS, r) ? REGIONS[r] : null);

const FALLBACK = 'Bambu’s sign-in did not work. It may have changed, so use LAN Mode on the printer instead.';
export const looksLikeToken = (t) => typeof t === 'string' && t.length >= 20 && t.length <= 8192 && !/\s/.test(t);
export const looksLikeEmail = (s) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(s || '').trim());
const parse = (r) => { try { return JSON.parse(r.text); } catch { return null; } };
const isHtml = (r) => /^\s*</.test(r.text || '');

/// What an answer to a sign-in call means: { kind: 'ok', token } | { kind: 'verify' } | { kind: 'tfa', tfaKey } | { kind: 'error', message }.
export function readSignIn(r) {
  if (!r) return { kind: 'error', message: FALLBACK };
  if (isHtml(r)) return { kind: 'error', message: 'Bambu asked for a browser check before it would sign in. Try again later, or use LAN Mode on the printer.' };
  const j = parse(r);
  if (r.status === 429) return { kind: 'error', message: 'Bambu is limiting sign-ins right now. Wait a few minutes and try again.' };
  if (j && looksLikeToken(j.accessToken)) return { kind: 'ok', token: j.accessToken };
  if (j && j.loginType === 'verifyCode') return { kind: 'verify' };
  if (j && j.loginType === 'tfa' && typeof j.tfaKey === 'string' && j.tfaKey) return { kind: 'tfa', tfaKey: j.tfaKey };
  if (r.status === 400 || r.status === 401 || r.status === 403 || (j && j.success === false)) return { kind: 'error', message: 'Bambu did not accept that. Check the email, password or code.' };
  return { kind: 'error', message: FALLBACK };
}

const json = (body, headers = {}) => ({ method: 'POST', json: body, headers: { 'user-agent': 'Notch Apple', ...headers }, timeout: 20000 });

/// Step 1: the account's email and password.
export async function signIn(http, region, account, password) {
  const reg = regionOf(region); if (!reg) return { kind: 'error', message: 'Unknown Bambu account region.' };
  if (!looksLikeEmail(account) || !password) return { kind: 'error', message: 'Enter the email and password of your Bambu account.' };
  try { return readSignIn(await http(`${reg.api}/v1/user-service/user/login`, json({ account: String(account).trim(), password, apiError: '' }))); }
  catch { return { kind: 'error', message: 'Couldn’t reach Bambu. Check your internet connection.' }; }
}

/// Bambu emails a six-digit code when it does not know this device.
export async function sendCode(http, region, account) {
  const reg = regionOf(region); if (!reg) return { ok: false, message: 'Unknown Bambu account region.' };
  try {
    const r = await http(`${reg.api}/v1/user-service/user/sendemail/code`, json({ email: String(account).trim(), type: 'codeLogin' }));
    return r.ok || r.status === 200 ? { ok: true } : { ok: false, message: r.status === 429 ? 'Bambu is limiting codes right now. Wait a few minutes.' : 'Bambu would not send a code. Try again in a moment.' };
  } catch { return { ok: false, message: 'Couldn’t reach Bambu. Check your internet connection.' }; }
}

/// Step 2 (email code): signs in with the code instead of the password.
export async function signInWithCode(http, region, account, code) {
  const reg = regionOf(region); if (!reg) return { kind: 'error', message: 'Unknown Bambu account region.' };
  if (!/^\d{4,8}$/.test(String(code || '').trim())) return { kind: 'error', message: 'The code is the six digits Bambu emailed you.' };
  try { return readSignIn(await http(`${reg.api}/v1/user-service/user/login`, json({ account: String(account).trim(), code: String(code).trim() }))); }
  catch { return { kind: 'error', message: 'Couldn’t reach Bambu. Check your internet connection.' }; }
}

/// Step 2 (authenticator app): the code from the account's two-step sign-in. Bambu asks for a CSRF token first.
export async function signInWithTfa(http, region, tfaKey, code) {
  const reg = regionOf(region); if (!reg) return { kind: 'error', message: 'Unknown Bambu account region.' };
  if (!/^\d{6}$/.test(String(code || '').trim())) return { kind: 'error', message: 'The code is the six digits from your authenticator app.' };
  try {
    const headers = {};
    const csrf = await http(`${reg.web}/api/csrf`, { method: 'GET', headers: { 'user-agent': 'Notch Apple' }, timeout: 15000 });
    const cj = csrf.ok ? parse(csrf) : null, cookie = String(csrf.headers?.['set-cookie'] || '').split(';')[0];
    const tokenFromBody = cj && (cj.csrfToken || cj.token || cj.csrf);
    if (tokenFromBody) headers['x-csrf-token'] = String(tokenFromBody);
    if (cookie) headers.cookie = cookie;
    const r = await http(`${reg.web}/api/sign-in/tfa`, json({ tfaKey, tfaCode: String(code).trim() }, headers));
    const fromBody = readSignIn(r);
    if (fromBody.kind === 'ok') return fromBody;
    const m = String(r.headers?.['set-cookie'] || '').match(/(?:^|[;,\s])token=([^;,\s]+)/);   // the token can come back as a cookie
    if (m && looksLikeToken(m[1])) return { kind: 'ok', token: m[1] };
    return fromBody.kind === 'error' ? fromBody : { kind: 'error', message: FALLBACK };
  } catch { return { kind: 'error', message: 'Couldn’t reach Bambu. Check your internet connection.' }; }
}

/// The account id (needed for the MQTT user name) and the printers bound to the account.
export async function fetchAccount(http, region, token) {
  const reg = regionOf(region); if (!reg) return { ok: false, message: 'Unknown Bambu account region.' };
  if (!looksLikeToken(token)) return { ok: false, message: FALLBACK };
  const headers = { authorization: `Bearer ${token}`, 'user-agent': 'Notch Apple' };
  try {
    const pref = await http(`${reg.api}/v1/design-user-service/my/preference`, { headers, timeout: 20000 });
    if (!pref.ok || isHtml(pref)) return { ok: false, message: pref.status === 401 ? 'Bambu refused the sign-in. Try again.' : FALLBACK };
    const uid = readUid(parse(pref));
    if (!uid) return { ok: false, message: FALLBACK };
    const bind = await http(`${reg.api}/v1/iot-service/api/user/bind`, { headers, timeout: 20000 });
    if (!bind.ok || isHtml(bind)) return { ok: false, message: FALLBACK };
    return { ok: true, uid, devices: readDevices(parse(bind)) };
  } catch { return { ok: false, message: 'Couldn’t reach Bambu. Check your internet connection.' }; }
}

/// With the saved token held in Rust: asks for the account id and printers through `ask(what)` ('preference' | 'bind', returns the answer's text).
export async function accountVia(ask) {
  try {
    let pref; try { pref = JSON.parse(await ask('preference')); } catch (e) { if (/sign in again|refused/i.test(String(e))) return { ok: false, message: String(e) }; return { ok: false, message: FALLBACK }; }
    if (!readUid(pref)) return { ok: false, message: FALLBACK };
    let bind; try { bind = JSON.parse(await ask('bind')); } catch (e) { return { ok: false, message: /sign in again|refused/i.test(String(e)) ? String(e) : FALLBACK }; }
    return { ok: true, devices: readDevices(bind) };
  } catch { return { ok: false, message: FALLBACK }; }
}

/// The numeric account id from the preference answer.
export function readUid(j) {
  const v = j && (j.uid ?? j.uId ?? j.userId);
  const s = typeof v === 'number' && Number.isSafeInteger(v) ? String(v) : typeof v === 'string' ? v.trim() : '';
  return /^\d{1,20}$/.test(s) ? s : null;
}

/// The printers on the account: serial, name, model and whether Bambu says it is online.
export function readDevices(j) {
  const list = j && Array.isArray(j.devices) ? j.devices : [];
  const out = [];
  for (const d of list) {
    const serial = normalizeSerial(d && d.dev_id);
    if (!serial) continue;
    const clean = (t) => String(t || '').replace(/[\u0000-\u001f<>]/g, '').trim().slice(0, 40);
    const code = String(d.dev_access_code || '').replace(/[^A-Za-z0-9]/g, '');
    out.push({ serial, name: clean(d.name) || clean(d.dev_product_name) || 'Bambu printer', model: clean(d.dev_product_name), online: !!d.online, accessCode: code.length <= 32 ? code : '' });
  }
  return out;
}

/// A cloud printer as the printer list keeps it (no address, no access code: the account's sign-in does the rest).
export const cloudPrinter = (d, region) => ({ id: `cloud-${d.serial}`, name: d.name, host: '', accessCode: d.accessCode || '', serial: d.serial, cloud: region });
