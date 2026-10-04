// Tiers, ported from LicenseKey.swift / Entitlements.swift.
// Free works without any key. A signed key (NTCH-PRO-… or NTCH-ULTM-…) unlocks Pro or
// Ultimate: its Ed25519 signature is checked offline with the public key below, the same
// one the Mac app uses, so one key works on both. The old NOTCH-XXXX-XXXX access codes
// still work and count as Pro. Only SHA-256 hashes of those codes ship here.

const VALID = new Set([
  '8c71d5c4d8df7b252f3cc6543476019524361c9cc0619a4bac9ae97b030d14dc',
  '7f4b31b5c204e6b84b5df7bc53b13899069c6188bff4a736b17804d320c13cc7',
  '03af20393ab00a3763cea0557dd88b8fb6a340e5c06661f70fa6a9a19d11714a',
  'ffb65c59eb5246a648bff7defcf18ffc3669d736ab5537bea07c0150b8f71c50',
  'b408103da5cd47f6c124c317fbb26c1b47f3e9d647a66435fa636413d3b9eb54',
  'edbf8b98ef8995c69782d59c61ddccb0964509975bd01888eb0eeecd8a0d717c',
  'fbafbd0e656db90254227366f8403d8cbe37763baacb9b8a232eea84586db588',
  '83a44b9ab8dd113d26d16712cfaac483836ebe52b810bd574f4e95f80d499113',
  '7a4446456746767e6544f2167e14bf1520800fde7cfca9177b9ffc013ac7f39d',
  'a0c2203532abf574a1571f3062c36762d4783f4a0e23b07dcc4254eb9d5868b3',
  'f4a2375b6395c8f7d0f07f5ef30223371cfe45fe3a4449a940893597a62a085c',
  'c00076e982a23371b4bd29b3be5c6139df4c08bb63891f7d23c97af0bfd3e324',
  'd8a1d41f43c825bbb65f062396c86059667cc925caf7c07348f0c11b7465752c',
  'c233475e3d9c88cc6931b921384786a7e76b3e8e6d25b5c76b9df0850f94c6ac',
  '66628cc36dae07ef48cd2c5013552ae2cfbb87f898c35de53423eaf05fe88fe1',
  '87154f1c0db41931bf343a3b3e363d031cd5870a4f230a79e26c6d74cd5af208',
  '5ef017dd422c5303c37b13bc46e334b83d335509f252a3fe3406445518def347',
  'd0148de3947e0bebf03fc1139ab99f825df434bd2316d9458fd13f00ad645461',
  'df53b45e26ab812da4ad752630007889ba8a6b4ebe7db43c4c434c8da4747753',
  'acb199eda227ea89eb7f0d12f4bca33efe437e003ac2601255ab7b33cbd9f431',
  '32c2234f6a26a581ba6a7af8a48ec1ebac7c825270cfca9fb7234bb2a85ce641',
  'cd7ec7e75a20ec8ff722a15d94abcf94859c2f10759730fdb713a8df6db0d9b4',
  'f38699a0ae85a0aa876143a7aa3d9dcedd671d8498943458ee99e171a4cbae1f',
  'ca255449d9987b260397e3d45b84228887b107013edf9eb33bb4d7e2979081e7',
  '968737c4fee7346f1e0f55a4539805c52a6b7ec3d1a87337b6e720224ab7d49b',
  '5b8d186e9392b6496a4589860057b120d594ebaacd53d215335ed6b2be4f3649',
  '8a7ab6514553930dc7db95fc443201f7c5bd23450c3d435811d8cb396b2116d4',
  '4eb8f167eb42173ec3f71931c402a7ca497824de78f8e88b628dd02d3328ff5d',
  'fa678bd8501a1ffe0e310157d88a46c5bb6c204684d30bc38156d7c5293367d9',
  '2031b928a2e3fba24ffd7ba384f178d285c7e767f68c4aa98e1f6adf783c10d1',
  '6b87d5376147decc187d515b35b0cf91992022ef53b12d79cb7254494b880f16',
  'cad782e4069a61c4459f5e158d7ef6a7839d941eefddddf1613de09371cdad12',
  'fc3935d31f3cef10d32a93ae2e5972a8c611e0a4da6b82f6d12225bca4f76c13',
  '94de99a9e0abc4dafbde7838ead4de3120d8abd76998a3e297d6d8c9f5c5d6ee',
  '79e0b53fead74489f69597f9c9e780da1dfeda6212768cf5984aef9e79d5417b',
  '30b9ac41e9cc32fbe3c0edfde41c81076809f5ff6aaf5b703f32c5faf131d73f',
  'e14e933ea3cd728367695d3952ca60d95e876212ed45fd55f699235c148ddd62',
  '030842942fd99b301765d20f16248e2193825b806ebaec639774a75743b9a013',
  'f3ecdfe0cb64567167b6a9dec9c752104904c737927c399d474e0588e0cc0cc5',
  '8999cd9e470a0e95bbdfd5d3d1bdbbc5c23a97ac23cce0c8033a5b329d96ec72',
  '6485a966b12c2f567ed2457a70d5232616018d57b9ab675dce5d3a249a5dac5b',
  'e40c031657167696ab77844d53ca4cb4e5e13c3c5eaa1053ae2e5cabf7e3c093',
  'c211b9112f825a9ae707e1402923b454207c4a201a6449a559d20cdca5078163',
  '870295a6a879e4674e63d3836d209075b2746fa96f6cb12ea36af14712ddb619',
  '9aae3b1a66349ff08f89d4caf0bb2793acc3981773a4071653befb5cb2551455',
  'f7ecd175e5aa2f7695c56054ec3208dc78910371802302be80991c427050c060',
  '09808a606ab1fa1a4d847afda47f6823b7c8ada32a4e26525515c4ec436961a3',
  '01af30fef426d3ff49f74ba11b447ae122eff2fb351ce2e3cba71cb2378b5110',
  '3d3718b39320e56cb9b03f9cf65e0bd04e31119300d20f6a81f5019788aade3d',
  'f9f5e70844c9eb34aa35830f02f94fad77b0f75b01a5e1be516cfd8f7d3d435a',
]);

export const TIERS = ['Free', 'Pro', 'Ultimate'];
export const WORKER = 'https://notchapple-licenses.adityajain1225.workers.dev';
const PUBLIC_KEY = 'HmCtNtd+sFaJO+8TQ57od7pptH3dhEx00SO16I1fhvs=';
const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
const EPOCH = Date.UTC(2026, 0, 1);

const KEY = 'license.activated';      // hash of an old access code
const MASK_KEY = 'license.codeMask';
const SIGNED = 'license.key';         // a signed key, as typed (normalised)
const REVOKED = 'license.revoked';

export const sanitize = (s) =>
  (s || '').toUpperCase().replace(/[^A-Z0-9]/g, '');

export async function hashOf(clean) {
  const bytes = new TextEncoder().encode(clean);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

// ---- old access codes (count as Pro) ----

export async function validate(input) {
  const clean = sanitize(input);
  if (clean.length !== 13 || !clean.startsWith('NOTCH')) return false;
  return VALID.has(await hashOf(clean));
}

const hasOldCode = () => { const h = localStorage.getItem(KEY); return !!h && VALID.has(h); };

// ---- signed keys ----

export const looksLikeKey = (s) => (s || '').trim().toUpperCase().startsWith('NTCH');

function decode(text) {
  const out = []; let bits = 0, value = 0;
  for (let c of text) {
    if (c === 'O') c = '0'; else if (c === 'I' || c === 'L') c = '1';
    const i = ALPHABET.indexOf(c);
    if (i < 0) return null;
    value = (value << 5) | i; bits += 5;
    if (bits >= 8) { out.push((value >> (bits - 8)) & 255); bits -= 8; value &= (1 << bits) - 1; }
  }
  return new Uint8Array(out);
}

let pubKey;
async function publicKey() {
  pubKey ??= crypto.subtle.importKey('raw', Uint8Array.from(atob(PUBLIC_KEY), (c) => c.charCodeAt(0)),
    { name: 'Ed25519' }, false, ['verify']);
  return pubKey;
}

/// { tier: 1|2, id, issued, text } or { error } — checks the signature offline.
export async function parseKey(input) {
  const s = (input || '').toUpperCase().replace(/\s/g, '');
  let label, rest;
  if (s.startsWith('NTCH-PRO-')) { label = 'PRO'; rest = s.slice(9); }
  else if (s.startsWith('NTCH-ULTM-')) { label = 'ULTM'; rest = s.slice(10); }
  else return { error: "That doesn't look like a Notch apple key. Copy the whole key, from NTCH- to the end." };
  const body = rest.replace(/-/g, '');
  const bytes = decode(body);
  if (!bytes || bytes.length !== 76 || bytes[0] !== 1) return { error: "This key has been changed or wasn't copied completely." };
  let ok = false;
  try { ok = await crypto.subtle.verify('Ed25519', await publicKey(), bytes.slice(12), bytes.slice(0, 12)); }
  catch { return { error: "This version of Windows can't check keys yet. Update Microsoft Edge WebView2 and try again." }; }
  if (!ok) return { error: "This key has been changed or wasn't copied completely." };
  const tier = bytes[1];
  if (tier !== 1 && tier !== 2) return { error: "This key has been changed or wasn't copied completely." };
  if ((tier === 1 ? 'PRO' : 'ULTM') !== label) return { error: 'The start of this key doesn\'t match its tier.' };
  const id = [...bytes.slice(2, 10)].map((b) => b.toString(16).padStart(2, '0')).join('');
  const groups = body.match(/.{1,6}/g);
  return { tier, id, issued: new Date(EPOCH + ((bytes[10] << 8) | bytes[11]) * 86400000),
    text: `NTCH-${label}-${groups.join('-')}` };
}

/// A random ID for this PC, used only for the 3-device limit. Never anything about you.
function deviceId() {
  let d = localStorage.getItem('license.device');
  if (!d) {
    d = [...crypto.getRandomValues(new Uint8Array(32))].map((b) => b.toString(16).padStart(2, '0')).join('');
    localStorage.setItem('license.device', d);
  }
  return d;
}

async function post(path, body) {
  const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), 8000);
  try {
    const r = await fetch(WORKER + path, { method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body), signal: ctl.signal });
    return await r.json();
  } finally { clearTimeout(t); }
}

// ---- current tier ----

let cached = null;   // { tier, id, text } for a signed key

/// Reads the saved key at startup (and checks the signed revocation list when online).
export async function loadSaved() {
  const text = localStorage.getItem(SIGNED);
  cached = null;
  if (text) {
    const k = await parseKey(text);
    if (!k.error && !revokedIds().includes(k.id)) cached = k;
  }
  refreshRevoked();
  return tier();
}

const revokedIds = () => { try { return JSON.parse(localStorage.getItem(REVOKED) || '[]'); } catch { return []; } };

async function refreshRevoked() {
  try {
    const r = await (await fetch(WORKER + '/revoked')).json();
    const sig = Uint8Array.from(atob(r.sig), (c) => c.charCodeAt(0));
    if (!(await crypto.subtle.verify('Ed25519', await publicKey(), sig, new TextEncoder().encode(r.list)))) return;
    const ids = JSON.parse(r.list).ids || [];
    localStorage.setItem(REVOKED, JSON.stringify(ids));
    if (cached && ids.includes(cached.id)) { cached = null; localStorage.removeItem(SIGNED); dispatchEvent(new Event('tierchange')); }
  } catch { /* offline: keep the last list */ }
}

/// 0 Free, 1 Pro, 2 Ultimate.
export const tier = () => Math.max(cached?.tier ?? 0, hasOldCode() ? 1 : 0);
export const tierName = () => TIERS[tier()];
export const can = (needed) => tier() >= needed;

/// Activates a signed key or an old code. Returns { ok, tier } or { error }.
export async function activate(input) {
  if (looksLikeKey(input)) {
    const k = await parseKey(input);
    if (k.error) return k;
    if (revokedIds().includes(k.id)) return { error: 'This key has been turned off. Email notchapples.support@gmail.com if that seems wrong.' };
    try {
      const r = await post('/activate', { key: k.text, device: deviceId() });
      if (r && r.ok === false && r.reason === 'limit') return { error: `This key is already on ${r.limit} devices. Remove it from one in Settings → Access first.` };
      if (r && r.ok === false && r.reason === 'revoked') return { error: 'This key has been turned off. Email notchapples.support@gmail.com if that seems wrong.' };
    } catch { /* offline: the signature is enough, activation is retried never — that's fine */ }
    localStorage.setItem(SIGNED, k.text);
    cached = k;
    dispatchEvent(new Event('tierchange'));
    return { ok: true, tier: k.tier };
  }
  const clean = sanitize(input);
  if (!(await validate(clean))) return { error: 'Invalid key or access code. Please try again.' };
  localStorage.setItem(KEY, await hashOf(clean));
  localStorage.setItem(MASK_KEY, `NOTCH-${clean.slice(5, 9)}-****`);
  dispatchEvent(new Event('tierchange'));
  return { ok: true, tier: tier() };
}

export function maskedCode() {
  if (cached) {
    const p = cached.text.split('-');
    return p.length > 4 ? `${p[0]}-${p[1]}-${p[2]}-…-${p[p.length - 2]}` : cached.text;
  }
  return hasOldCode() ? (localStorage.getItem(MASK_KEY) || 'NOTCH-****-****') : '';
}

/// Removes the key from this PC (and frees its device slot when online). Back to Free.
export async function deactivate() {
  if (cached) { try { await post('/deactivate', { key: cached.text, device: deviceId() }); } catch {} }
  cached = null;
  localStorage.removeItem(SIGNED);
  localStorage.removeItem(KEY);
  localStorage.removeItem(MASK_KEY);
  dispatchEvent(new Event('tierchange'));
}

/// Formats old codes as NOTCH-XXXX-XXXX while typing; signed keys are left alone.
export function format(input) {
  if (looksLikeKey(input)) return input;
  let s = sanitize(input);
  if (!s) return '';
  if (!'NOTCH'.startsWith(s) && !s.startsWith('NOTCH')) s = 'NOTCH' + s;
  s = s.slice(0, 13);
  if (s.length <= 5) return s;
  const body = s.slice(5);
  return 'NOTCH-' + body.slice(0, 4) + (body.length > 4 ? '-' + body.slice(4) : '');
}
