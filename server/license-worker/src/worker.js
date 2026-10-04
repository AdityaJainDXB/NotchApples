// Notch apple license server: a Cloudflare Worker (free plan) with one KV namespace.
//
// It issues product keys signed with Ed25519. The app checks them offline using only the
// public key built into it. The private key exists only as this Worker's SIGNING_KEY secret,
// never in the app, the repo or the website.
//
// Checkout (Litecoin, paid straight to the developer's wallet):
//   POST /order  {tier, email, upgradeFrom?, tip?}  reserves a unique LTC amount (tip = optional extra dollars)
//   POST /claim  {order, txid}                 checks the payment on the blockchain and issues the key
// Only the person holding the secret order ID can claim. Each order has its own exact amount,
// so a payment seen on the public blockchain can't be claimed by anyone else.
//
// Also:
//   POST /promo    {code, email}          one Pro key per promo code
//   POST /recover  {email, txid?}         emails the keys bought with that address (never shows them)
//   POST /activate {key, device}          soft limit of DEVICE_LIMIT Macs per key
//   POST /deactivate {key, device}
//   GET  /revoked                         signed list of revoked key IDs (the app checks it now and then)
//   GET  /config                          prices and whether Ultimate is on sale
//   POST /admin/issue | /admin/revoke | /admin/reissue   (Authorization: Bearer ADMIN_TOKEN)
//   POST /admin/test-payment {order}      admin-only test mode: lets that one order be claimed with the
//                                         transaction ID 000…000 (64 zeros), no money needed. Nobody else can.
//
// What it stores: orders, keys, a salted hash of the buyer's email (for recovery) and a
// salted hash per Mac for the device limit. A plain email is kept only on unpaid orders,
// for up to 48 hours, so the key can be emailed when the payment arrives.

const TIER = { pro: 1, ultimate: 2 };
const TIER_LABEL = { 1: 'PRO', 2: 'ULTM' };
const TIER_NAME = { 1: 'Pro', 2: 'Ultimate' };
const B32 = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';   // Crockford: no I, L, O or U
const EPOCH = Date.UTC(2026, 0, 1);
const ORDER_TTL = 48 * 3600;
const PROMOS = new Set(['ac4a37500c7956c1f8ea62df3114d7a99f14c14da75fa217b820c1d1d1386363','01e3c47261f3463dfc92aae452c39add3284a3fdea4062d810fd70773e357c22','eda3d49a88774830110e754712b392751c0ab222e34b5382b2599521d04250ad','65e9ee0536873b1328de7af086e64316d70dcb6e1e5f7d374ed277804e457656','6cc11ea96a4802fb81414175fa39c9c7b5526b7810833379d387b786a6b04a8f','49fdd7aa8a42de4665eed747b265c59950475a0a8d0f1392d7b8d603c81e763d','b9ba4f7c58f9d47cd4d562a4751e2e1721f4271fe2a8846a02c0049b5b5323ec','ef07990f901bad6bf8689682bc8d19985a3e57aa869b176fda71e682cd2d830c','a2674a8543b5887d7629fe294a0e2879de7a4e23e82655827aa2126ca98bb12e','0cff91e9f3721f9fe29782d0547f81a3d7b7c3a51aa4c22056a4c4dc253787a7','05ab9ee051812fffdf532cb225eadd5cc6c2c5c5ad6ebf8ddee022e48942e7c4','1fffcc4cf60f90975cc3e8107c18c0487d501b7d4aa98db19ad5a608a52aab45','d1646d76106082006921c226a91516a8a9a4877435f46d3d6aa7f84e0452552e','877bdaa4c3df0a3c25412c9dd34c50978085ea7108453858dc3dd184fd85a8ef','a50c15ea0bd86329633d8a99636887b32794ee356ba4253464626379d9309a23','c607ba8fca726b49434fdad679e805d88c513a8f1f7ddc8e5c91b3a09a37aed0','0dc33cb6e85443961f75ca250ee82f0b7066c9f500ceca73cf746c0e41e866e1','42b19dd2d0f58dbbf22cb9cd36980a2ee3765fe1c8a7bad2614f6a9c24eeb7bc','dcbc5daa475b02e2065724ad5f371c062fe7dcb2f537e774d883a4093610090d','4c7b585ce4edda954401e5b31517e9871a39aef9707d65ba5d4d78145ac9b41b','ab9114a6452ef5e9cacea7ab3fa6de030a139599eb9337653d4985aac74409a3','4e25614e6676748f2687f10a56e80a869edb69acdaab9f014fe63b5c5a45f688','fe6ca0bd656019afd8704e44e3aae07cca6bdf87a64083c15083fcf7f4a7ecb4','8ab9ee29893cc0e423a418fda9370bfbfdeb3f6105854985cb61ba9f22372166','63e53d2ccd3fafb0a758b4fe6a0c64a4d44652ead196f48536e814646d667400','ffbda69a55b45739e0ccfb9b3d620b6d9245a6534c587a3439515976b8d27265','52947eb4a6046bd22056ac146990d85b292ec2b52dbd630fba82ffbb6fa45b61','35a327707b5961cf138305b96b96885a0c79c8b58cd3657204eb5daca1c7372f','0a6b49c9c8b8084a273d48d24a6254ee465d546b9115ed21099b563192433aa3','d4c9469eb8bb5b2a7f864e9f3cb30418a9fb45c083a78b095bbdad49bbf57bbf','f621ad44b6068898e85d79c30cd9e93bab429adc066c1c23070feae03ef87b10','143214be4950a5d7c313ece19f4daa6986045131814be83504398931130ba92b','cc0cb62806fb67758a7115b4bf177bb0973e9dccdc75b44e1916d0dba05f0340','1686a8cdf6eda5a8f4ce3a067e592d5144feb29aee3661f95514f81d0e8cf995','b90cb30b21a469f6bee88047ff5db63c5dc07cd44e66965e6e1e9854fd349980','ec4e542b487eebe4e2eea643c89cbff2198e4d9c6c17af7c783e7e6c47423187','777b9fbad39d5ca79e415d74f07352e9790a4309c268aceea58d64b80203457b','093d297472d195722193ecbe0ba8b5265a9e55513aa84708e8e02e6744e45e52','24851dacff60dbdbd6f2def9fe2f2f33a405ccbd2563c778a1ac12dbb0089f64','00dd7ad838b87a3472cd2d312a4ea3dc394e7efc81993f99f1793c89a20cd8ba','c3728b56345a35f785c0f5415b59e52a1178754b049f96a73b75aaf4d057aae6','0c02adb8754ebea20feffc40a043a9105dcd31b20f3d49dcc11ceefe3388391d','a363f2d3c5bdc8ec1857dff7355ea152760ded2396333a4189145649e38046f5','43adeeb41960f31a120afaae6e3252592ed4b440cd21c1ed5c45cddd24b0a09b','6e0f3d4e8fbce3aa26d5f0b9245d0597a97f91259a52c8ecc20a5c4908d9c4e5','d058a993fbcbae1caebf4920f5b92a29e41676e33af06aff2c55732e03bc95e6','8fe524627b8e1790f3c68f2edf107745e6efd309dd2c9b84069ae308bbcbc09d','0a416fe1bb0e26724373609263c45b4819e643c51219755a1834b3715094f557','b579cb91f33b1e942995971e697753661929073780d946e478111cff785ae5a1','e751a34f3b6823249f9cbd51070a78ba70c0ffec8820f4938027153d04fe1a27']);
// Promo codes already claimed through the old website checkout (Firestore).
const PROMOS_USED_BEFORE = new Set(['e751a34f3b6823249f9cbd51070a78ba70c0ffec8820f4938027153d04fe1a27']);

// MARK: Key format
//
// 12-byte payload: version (1) · tier (1) · key ID (8 random bytes) · issue day since 2026-01-01 (2)
// followed by its 64-byte Ed25519 signature, written in Crockford base32:
//   NTCH-PRO-XXXXXX-XXXXXX-…   or   NTCH-ULTM-XXXXXX-…
// No expiry field: keys are for life.

export function b32encode(bytes) {
  let out = '', bits = 0, value = 0;
  for (const b of bytes) {
    value = (value << 8) | b; bits += 8;
    while (bits >= 5) { out += B32[(value >>> (bits - 5)) & 31]; bits -= 5; value &= (1 << bits) - 1; }
  }
  if (bits > 0) out += B32[(value << (5 - bits)) & 31];
  return out;
}

export function b32decode(text) {
  const out = []; let bits = 0, value = 0;
  for (let c of text) {
    c = c === 'O' ? '0' : (c === 'I' || c === 'L') ? '1' : c;
    const i = B32.indexOf(c);
    if (i < 0) return null;
    value = (value << 5) | i; bits += 5;
    if (bits >= 8) { out.push((value >>> (bits - 8)) & 255); bits -= 8; value &= (1 << bits) - 1; }
  }
  return new Uint8Array(out);
}

export function formatKey(tier, bytes) {
  return `NTCH-${TIER_LABEL[tier]}-` + b32encode(bytes).match(/.{1,6}/g).join('-');
}

/** Parses a key into { tier, keyId, day, payload, sig } or null. Doesn't check the signature. */
export function parseKey(input) {
  const s = String(input || '').toUpperCase().replace(/\s+/g, '');
  const m = s.match(/^NTCH-?(PRO|ULTM)-?([0-9A-Z-]+)$/);
  if (!m) return null;
  const bytes = b32decode(m[2].replace(/-/g, ''));
  if (!bytes || bytes.length !== 76 || bytes[0] !== 1) return null;
  const tier = bytes[1];
  if (TIER_LABEL[tier] !== m[1]) return null;
  return {
    tier, payload: bytes.slice(0, 12), sig: bytes.slice(12),
    keyId: hex(bytes.slice(2, 10)), day: (bytes[10] << 8) | bytes[11],
  };
}

// MARK: Crypto helpers

const enc = new TextEncoder();
const hex = (b) => [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
const b64 = (b) => btoa(String.fromCharCode(...b));
async function sha256(text) { return hex(new Uint8Array(await crypto.subtle.digest('SHA-256', enc.encode(text)))); }
function randomBytes(n) { return crypto.getRandomValues(new Uint8Array(n)); }

let keyCache = null;
async function keys(env) {
  if (keyCache?.raw === env.SIGNING_KEY) return keyCache;
  const { kty, crv, d, x } = JSON.parse(env.SIGNING_KEY);
  // Standard name first; Cloudflare's older runtime calls the same algorithm NODE-ED25519.
  for (const algo of [{ name: 'Ed25519' }, { name: 'NODE-ED25519', namedCurve: 'NODE-ED25519' }]) {
    try {
      const priv = await crypto.subtle.importKey('jwk', { kty, crv, d, x }, algo, false, ['sign']);
      const pub = await crypto.subtle.importKey('jwk', { kty, crv, x }, algo, false, ['verify']);
      keyCache = { raw: env.SIGNING_KEY, priv, pub, algo };
      return keyCache;
    } catch (e) { console.error('Ed25519 import failed with', algo.name, e && e.message); }
  }
  throw new Error('Could not load the signing key');
}

async function sign(env, bytes) { const k = await keys(env); return new Uint8Array(await crypto.subtle.sign(k.algo, k.priv, bytes)); }

/** Makes a new signed key. Returns { key, keyId }. */
export async function mintKey(env, tier, now = Date.now()) {
  const payload = new Uint8Array(12);
  payload[0] = 1; payload[1] = tier;
  payload.set(randomBytes(8), 2);
  const day = Math.max(0, Math.floor((now - EPOCH) / 86400000));
  payload[10] = day >> 8; payload[11] = day & 255;
  const sig = await sign(env, payload);
  const all = new Uint8Array(76); all.set(payload); all.set(sig, 12);
  return { key: formatKey(tier, all), keyId: hex(payload.slice(2, 10)) };
}

/** Parses and checks the signature. Returns the parsed key or null. */
export async function verifyKey(env, input) {
  const k = parseKey(input);
  if (!k) return null;
  const keyset = await keys(env);
  const ok = await crypto.subtle.verify(keyset.algo, keyset.pub, k.sig, k.payload);
  return ok ? k : null;
}

// MARK: Storage

const getJSON = async (env, k) => { const v = await env.KV.get(k); return v ? JSON.parse(v) : null; };
const putJSON = (env, k, v, ttl) => env.KV.put(k, JSON.stringify(v), ttl ? { expirationTtl: ttl } : undefined);
const emailHash = (env, email) => sha256((env.EMAIL_PEPPER || '') + '|' + email.trim().toLowerCase());
async function revokedIds(env) { return (await getJSON(env, 'revoked')) || []; }

/** Mints a key and records it (plus the buyer's email hash for recovery). */
async function issueKey(env, tier, source, email, extra = {}) {
  const { key, keyId } = await mintKey(env, tier);
  const eh = email ? await emailHash(env, email) : null;
  await putJSON(env, `key:${keyId}`, { tier, source, created: Date.now(), devices: [], emailHash: eh, key, ...extra });
  if (eh) {
    const list = (await getJSON(env, `email:${eh}`)) || [];
    list.push({ keyId, tier, key });
    await putJSON(env, `email:${eh}`, list);
  }
  return { key, keyId };
}

// MARK: Prices

let priceCache = null;
async function ltcPrice(env) {
  if (env.TEST_LTC_PRICE) return Number(env.TEST_LTC_PRICE);
  if (priceCache && Date.now() - priceCache.at < 60000) return priceCache.usd;
  let usd = null;
  try {
    const r = await fetch('https://api.coingecko.com/api/v3/simple/price?ids=litecoin&vs_currencies=usd', { signal: timeout(6000) });
    usd = (await r.json()).litecoin.usd;
  } catch {}
  if (!usd) {
    try {
      const r = await fetch('https://api.kraken.com/0/public/Ticker?pair=LTCUSD', { signal: timeout(6000) });
      const j = await r.json();
      usd = Number(Object.values(j.result)[0].c[0]);
    } catch {}
  }
  if (!usd) throw new HTTPError(503, "Couldn't get the Litecoin price right now. Try again in a minute.");
  priceCache = { usd, at: Date.now() };
  return usd;
}

function prices(env) {
  return { pro: Number(env.PRICE_PRO || 1), ultimate: Number(env.PRICE_ULTIMATE || 5), upgrade: Number(env.PRICE_UPGRADE || 4) };
}

// MARK: Litecoin

function explorer(env) { return env.NETWORK === 'testnet' ? 'https://litecoinspace.org/testnet/api' : 'https://litecoinspace.org/api'; }

const timeout = (ms) => AbortSignal.timeout(ms);

/** Litoshi paid to our wallet by a transaction, and when it was confirmed (null = still unconfirmed).
 *  Asks litecoinspace.org first and falls back to a Blockbook explorer, so one explorer being
 *  down never blocks a purchase. null = not on the network yet. */
async function payment(env, txid) {
  try {
    const r = await fetch(`${explorer(env)}/tx/${txid}`, { signal: timeout(6000) });
    if (r.status === 404 || r.status === 400) { if (env.NETWORK === 'testnet') return null; }
    else if (r.ok) {
      const tx = await r.json();
      const paid = (tx.vout || []).filter((o) => o.scriptpubkey_address === env.WALLET).reduce((a, o) => a + o.value, 0);
      return { paid, blockTime: tx.status?.confirmed ? tx.status.block_time : null };
    }
  } catch {}
  if (env.NETWORK === 'testnet') throw new HTTPError(502, "Couldn't reach the Litecoin explorer. Try again in a minute.");
  try {
    const r = await fetch(`https://litecoinblockexplorer.net/api/v2/tx/${txid}`, { signal: timeout(8000), headers: { 'user-agent': 'Notch apple license server' } });
    if (r.status === 404 || r.status === 400) return null;
    if (r.ok) {
      const tx = await r.json();
      const paid = (tx.vout || []).filter((o) => (o.addresses || []).includes(env.WALLET)).reduce((a, o) => a + Number(o.value || 0), 0);
      return { paid, blockTime: tx.confirmations > 0 ? tx.blockTime : null };
    }
  } catch {}
  throw new HTTPError(502, "Couldn't reach the Litecoin explorers. Try again in a minute; your order stays open for 48 hours.");
}

const ltc = (litoshi) => (litoshi / 1e8).toFixed(6);

// MARK: Mail

async function sendMail(env, to, subject, text) {
  if (env.MAIL_LOG) { env.MAIL_LOG.push({ to, subject, text }); return true; }
  if (!env.MAIL_API_KEY || !env.MAIL_FROM) return false;
  let r;
  if (env.MAIL_PROVIDER === 'resend') {
    r = await fetch('https://api.resend.com/emails', {
      method: 'POST', headers: { Authorization: `Bearer ${env.MAIL_API_KEY}`, 'content-type': 'application/json' },
      body: JSON.stringify({ from: env.MAIL_FROM, to: [to], subject, text }),
    });
  } else {
    r = await fetch('https://api.brevo.com/v3/smtp/email', {
      method: 'POST', headers: { 'api-key': env.MAIL_API_KEY, 'content-type': 'application/json' },
      body: JSON.stringify({ sender: { email: env.MAIL_FROM, name: 'Notch Apples' }, to: [{ email: to }], subject, textContent: text }),
    });
  }
  if (!r.ok) console.error('Email not sent', env.MAIL_PROVIDER, r.status, (await r.text()).slice(0, 300));
  return r.ok;
}

function keyMail(keys) {
  const lines = keys.map((k) => `${TIER_NAME[k.tier]} key:\n${k.key}\n\nActivate in one click: notchapple://activate?key=${encodeURIComponent(k.key)}`);
  return `Thanks for supporting Notch apple!\n\n${lines.join('\n\n')}\n\n` +
    'Or open Notch apple → Settings → License, paste the key and press Activate.\n' +
    "It's yours for life: every 1.x update is included. Keep this email; if you lose the key, use \"Lost my key?\" on the website.\n\n" +
    'Questions? Just reply to this email, or write to notchapples.support@gmail.com.';
}

// MARK: Routes

class HTTPError extends Error { constructor(status, message, extra = {}) { super(message); this.status = status; this.extra = extra; } }

const validEmail = (e) => typeof e === 'string' && e.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e.trim());
const validTxid = (t) => typeof t === 'string' && /^[0-9a-f]{64}$/.test(t);

async function order(env, body) {
  const tier = TIER[body.tier];
  if (!tier) throw new HTTPError(400, 'Choose Pro or Ultimate.');
  if (tier === TIER.ultimate && env.ULTIMATE_ON !== '1') throw new HTTPError(403, 'Ultimate is not on sale yet.');
  if (!validEmail(body.email)) throw new HTTPError(400, 'Enter a valid email address. Your key is sent there.');
  const p = prices(env);
  let usd = tier === TIER.pro ? p.pro : p.ultimate, upgradeFrom = null;
  if (body.upgradeFrom) {
    if (tier !== TIER.ultimate) throw new HTTPError(400, 'Only Pro can be upgraded, to Ultimate.');
    const k = await verifyKey(env, body.upgradeFrom);
    if (!k || k.tier !== TIER.pro) throw new HTTPError(400, "That isn't a valid Pro key.");
    if ((await revokedIds(env)).includes(k.keyId)) throw new HTTPError(400, 'That Pro key has been revoked.');
    usd = p.upgrade; upgradeFrom = k.keyId;
  }
  // Pay what you want: an optional tip on top (whole dollars, up to $50).
  const tip = Math.max(0, Math.min(50, Math.floor(Number(body.tip) || 0)));
  usd += tip;
  const price = await ltcPrice(env);
  const base = Math.ceil((usd / price) * 1e4) * 1e4;       // round up to 0.0001 LTC
  // A unique amount per open order: the last two of six decimals.
  for (let i = 0; i < 20; i++) {
    const litoshi = base + (1 + Math.floor(Math.random() * 99)) * 100 + Math.floor(i / 5) * 1e4;
    if (await env.KV.get(`amount:${litoshi}`)) continue;
    const id = hex(randomBytes(16));
    const created = Date.now();
    await env.KV.put(`amount:${litoshi}`, id, { expirationTtl: ORDER_TTL });
    await putJSON(env, `order:${id}`, { tier, usd, litoshi, created, email: body.email.trim(), upgradeFrom, status: 'open' }, ORDER_TTL);
    return { order: id, tier: body.tier, usd, ltc: ltc(litoshi), litoshi, wallet: env.WALLET, price, expires: created + ORDER_TTL * 1000 };
  }
  throw new HTTPError(503, 'Checkout is busy. Try again in a minute.');
}

async function claim(env, body) {
  if (typeof body.order !== 'string' || !/^[0-9a-f]{32}$/.test(body.order)) throw new HTTPError(400, 'Missing order.');
  const txid = String(body.txid || '').toLowerCase().match(/[0-9a-f]{64}/)?.[0];
  if (!validTxid(txid)) throw new HTTPError(400, 'Paste the 64-character transaction ID (or an explorer link to it).');
  const o = await getJSON(env, `order:${body.order}`);
  if (!o) throw new HTTPError(404, 'That order has expired. Start a new one; if you already paid, use "Lost my key?" or contact us with the transaction ID.');
  if (o.status === 'paid') {
    if (o.txid !== txid) throw new HTTPError(409, 'This order is already paid with a different transaction.');
    return { key: o.key, tier: TIER_NAME[o.tier], emailed: o.emailed, again: true };
  }
  // Admin test mode: only an order the admin marked, and only with the all-zeros transaction ID.
  const testTx = '0'.repeat(64);
  if (txid === testTx && !o.testPayment) throw new HTTPError(400, "That isn't a real transaction ID.");
  const used = txid === testTx ? null : await env.KV.get(`tx:${txid}`);
  if (used) throw new HTTPError(409, 'That payment has already been used for a key.');
  const pay = txid === testTx ? { paid: o.litoshi, blockTime: null } : await payment(env, txid);
  if (!pay) return { pending: true, message: 'Waiting for the transaction to appear on the network…' };
  if (pay.paid === 0) throw new HTTPError(400, "That transaction doesn't pay the Notch apple address.");
  if (pay.paid !== o.litoshi) {
    throw new HTTPError(400, `That payment is ${ltc(pay.paid)} LTC, but this order needs exactly ${ltc(o.litoshi)} LTC. ` +
      'If an exchange took a fee from it, contact us with the transaction ID and we will sort it out.');
  }
  if (pay.blockTime && pay.blockTime * 1000 < o.created - 600000) throw new HTTPError(400, 'That payment was made before this order.');
  if (txid !== testTx) await env.KV.put(`tx:${txid}`, body.order);
  const { key, keyId } = await issueKey(env, o.tier, txid === testTx ? 'test' : 'ltc', o.email, { order: body.order, txid, upgradeFrom: o.upgradeFrom });
  if (o.upgradeFrom) {
    const old = await getJSON(env, `key:${o.upgradeFrom}`);
    if (old) { old.upgradedTo = keyId; await putJSON(env, `key:${o.upgradeFrom}`, old); }
  }
  const emailed = await sendMail(env, o.email, `Your Notch apple ${TIER_NAME[o.tier]} key`, keyMail([{ tier: o.tier, key }]));
  const done = { ...o, status: 'paid', txid, keyId, key, emailed, email: undefined, emailHash: await emailHash(env, o.email) };
  await putJSON(env, `order:${body.order}`, done);
  return { key, tier: TIER_NAME[o.tier], emailed };
}

async function promo(env, body) {
  const code = String(body.code || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (code.length !== 17 || !code.startsWith('PROMO')) throw new HTTPError(400, 'Enter the full promo code: PROMO-XXXX-XXXX-XXXX.');
  if (!validEmail(body.email)) throw new HTTPError(400, 'Enter a valid email address. Your key is sent there.');
  const h = await sha256(code);
  if (!PROMOS.has(h) && !String(env.TEST_PROMOS || '').split(',').includes(h)) throw new HTTPError(400, "That promo code isn't valid.");
  if (PROMOS_USED_BEFORE.has(h) || (await env.KV.get(`promo:${h}`))) throw new HTTPError(409, 'That promo code has already been used.');
  await env.KV.put(`promo:${h}`, 'claiming');
  const { key, keyId } = await issueKey(env, TIER.pro, 'promo', body.email.trim(), { promo: h });
  await env.KV.put(`promo:${h}`, keyId);
  const emailed = await sendMail(env, body.email.trim(), 'Your Notch apple Pro key', keyMail([{ tier: TIER.pro, key }]));
  return { key, tier: 'Pro', emailed };
}

async function recover(env, body) {
  if (!validEmail(body.email)) throw new HTTPError(400, 'Enter the email address you used at checkout.');
  const eh = await emailHash(env, body.email);
  const generic = { ok: true, message: "If that email bought a key, it's on its way. Check your spam folder too." };
  let found = [];
  if (body.txid) {
    const txid = String(body.txid).toLowerCase().match(/[0-9a-f]{64}/)?.[0];
    const id = txid && (await env.KV.get(`tx:${txid}`));
    const o = id && (await getJSON(env, `order:${id}`));
    if (o?.emailHash === eh) found = [{ tier: o.tier, key: o.key }];
  } else {
    found = (await getJSON(env, `email:${eh}`)) || [];
  }
  const revoked = await revokedIds(env);
  found = found.filter((k) => !revoked.includes(parseKey(k.key)?.keyId));
  if (found.length) await sendMail(env, body.email.trim(), 'Your Notch apple key', keyMail(found));
  return generic;
}

async function activate(env, body, add) {
  const k = await verifyKey(env, body.key);
  if (!k) throw new HTTPError(400, "That key isn't valid.");
  if (typeof body.device !== 'string' || !/^[0-9a-f]{64}$/.test(body.device)) throw new HTTPError(400, 'Missing device.');
  if ((await revokedIds(env)).includes(k.keyId)) return { ok: false, reason: 'revoked' };
  const rec = (await getJSON(env, `key:${k.keyId}`)) || { tier: k.tier, source: 'unknown', devices: [] };
  const has = rec.devices.includes(body.device);
  if (!add) {
    if (has) { rec.devices = rec.devices.filter((d) => d !== body.device); await putJSON(env, `key:${k.keyId}`, rec); }
    return { ok: true };
  }
  if (has) return { ok: true, tier: TIER_NAME[k.tier] };
  const limit = Number(env.DEVICE_LIMIT || 3);
  if (rec.devices.length >= limit) return { ok: false, reason: 'limit', limit };
  rec.devices.push(body.device);
  await putJSON(env, `key:${k.keyId}`, rec);
  return { ok: true, tier: TIER_NAME[k.tier] };
}

async function revokedList(env) {
  const list = JSON.stringify({ ids: await revokedIds(env), at: Date.now() });
  return { list, sig: b64(await sign(env, enc.encode(list))) };
}

// MARK: Admin

function isAdmin(env, request) {
  const got = request.headers.get('authorization') || '', want = `Bearer ${env.ADMIN_TOKEN || ''}`;
  if (!env.ADMIN_TOKEN || got.length !== want.length) return false;
  let diff = 0;
  for (let i = 0; i < got.length; i++) diff |= got.charCodeAt(i) ^ want.charCodeAt(i);
  return diff === 0;
}

async function admin(env, path, body) {
  if (path === '/admin/issue') {
    const tier = TIER[body.tier];
    if (!tier) throw new HTTPError(400, 'tier must be pro or ultimate');
    const r = await issueKey(env, tier, 'admin', body.email || null, { note: String(body.note || '').slice(0, 200) });
    const emailed = body.email ? await sendMail(env, body.email, `Your Notch apple ${TIER_NAME[tier]} key`, keyMail([{ tier, key: r.key }])) : false;
    return { ...r, emailed };
  }
  if (path === '/admin/test-payment') {
    const o = /^[0-9a-f]{32}$/.test(String(body.order)) && await getJSON(env, `order:${body.order}`);
    if (!o) throw new HTTPError(404, 'No such open order');
    o.testPayment = true;
    await putJSON(env, `order:${body.order}`, o, ORDER_TTL);
    return { ok: true, claimWith: '0'.repeat(64) };
  }
  if (path === '/admin/revoke' || path === '/admin/reissue') {
    const id = String(body.keyId || (body.key && parseKey(body.key)?.keyId) || '');
    if (!/^[0-9a-f]{16}$/.test(id)) throw new HTTPError(400, 'keyId or key needed');
    const rec = await getJSON(env, `key:${id}`);
    const ids = await revokedIds(env);
    if (!ids.includes(id)) { ids.push(id); await putJSON(env, 'revoked', ids); }
    if (rec) { rec.revoked = { at: Date.now(), reason: String(body.reason || '').slice(0, 200) }; await putJSON(env, `key:${id}`, rec); }
    if (path === '/admin/revoke') return { revoked: id };
    // Reissue: same tier, to the real buyer. Their other keys and everyone else's keep working.
    const tier = rec?.tier || parseKey(body.key)?.tier;
    if (!tier) throw new HTTPError(400, 'Unknown key; pass the full key to reissue');
    const r = await issueKey(env, tier, 'reissue', body.email || null, { replaces: id });
    const emailed = body.email ? await sendMail(env, body.email, `Your new Notch apple ${TIER_NAME[tier]} key`, keyMail([{ tier, key: r.key }])) : false;
    return { revoked: id, ...r, emailed };
  }
  throw new HTTPError(404, 'Not found');
}

// MARK: Entry

const CORS = { 'access-control-allow-origin': '*', 'access-control-allow-methods': 'GET, POST, OPTIONS', 'access-control-allow-headers': 'content-type, authorization' };
const json = (data, status = 200, headers = {}) => new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json', ...CORS, ...headers } });

export default {
  async fetch(request, env) {
    if (request.method === 'OPTIONS') return new Response(null, { headers: CORS });
    const path = new URL(request.url).pathname.replace(/\/+$/, '') || '/';
    try {
      if (request.method === 'GET') {
        if (path === '/') return json({ ok: true, service: 'Notch apple licenses' });
        if (path === '/config') return json({ prices: prices(env), ultimate: env.ULTIMATE_ON === '1', network: env.NETWORK || 'mainnet', wallet: env.WALLET });
        if (path === '/revoked') return json(await revokedList(env), 200, { 'cache-control': 'public, max-age=3600' });
        throw new HTTPError(404, 'Not found');
      }
      if (request.method !== 'POST') throw new HTTPError(405, 'Method not allowed');
      const text = await request.text();
      if (text.length > 4096) throw new HTTPError(413, 'Too large');
      let body; try { body = JSON.parse(text || '{}'); } catch { throw new HTTPError(400, 'Bad JSON'); }
      if (path.startsWith('/admin/')) {
        if (!isAdmin(env, request)) throw new HTTPError(401, 'Unauthorized');
        return json(await admin(env, path, body));
      }
      switch (path) {
        case '/order': return json(await order(env, body));
        case '/claim': return json(await claim(env, body));
        case '/promo': return json(await promo(env, body));
        case '/recover': return json(await recover(env, body));
        case '/activate': return json(await activate(env, body, true));
        case '/deactivate': return json(await activate(env, body, false));
      }
      throw new HTTPError(404, 'Not found');
    } catch (e) {
      if (e instanceof HTTPError) return json({ error: e.message, ...e.extra }, e.status);
      console.error('Unhandled error', e && e.stack || e);
      return json({ error: 'Something went wrong. Please try again.' }, 500);
    }
  },
};
