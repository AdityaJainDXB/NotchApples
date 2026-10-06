// Clipboard Link (Ultimate): copy on one device, paste on another. Your devices share a secret link code; text is
// sealed with a key made from that code (AES-GCM) and passed through Notch apple's room relay, which only sees
// scrambled bytes and an unreadable topic. Same recipe as the Mac's ClipboardLinkLogic.swift, so Macs and PCs
// share one clipboard. Off until you turn it on in Settings → Clipboard.

import { load, save, uid } from '../store.js';
import { invoke } from '../native.js';
import { canUse } from '../features.js';
import { provide, refresh } from '../activity.js';

export const RELAY = 'wss://notchapple-rooms.adityajain1225.workers.dev';
export const MAX_TEXT = 100_000;
const TOLERANCE_MS = 3600 * 1000;
const ALPHABET = 'abcdefghjkmnpqrstuvwxyz23456789';

const enc = new TextEncoder(), dec = new TextDecoder();
const b64 = (bytes) => btoa(String.fromCharCode(...bytes));
const unb64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
const hex = (buf) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
const sha256 = (s) => crypto.subtle.digest('SHA-256', enc.encode(s));

// ---- codes, keys and topics ----

export const normalize = (raw) => String(raw || '').toLowerCase().replace(/[^a-z0-9]/g, '');
export const isValid = (raw) => { const n = normalize(raw); return n.length === 20 && [...n].every((c) => ALPHABET.includes(c)); };
export function newCode() {
  const bytes = crypto.getRandomValues(new Uint8Array(20));
  const chars = [...bytes].map((b) => ALPHABET[b % ALPHABET.length]);   // 248 is a multiple of 31, so no bias
  return [0, 4, 8, 12, 16].map((i) => chars.slice(i, i + 4).join('')).join('-');
}
export const format = (raw) => { const n = normalize(raw); return [0, 4, 8, 12, 16].map((i) => n.slice(i, i + 4)).join('-'); };

export async function keyFor(code) {
  return crypto.subtle.importKey('raw', await sha256(`notchapple-clip-key|${normalize(code)}`), 'AES-GCM', false, ['encrypt', 'decrypt']);
}
export async function topicFor(code) { return `notchapple-v1-${hex(await sha256(`notchapple-clip-topic|${normalize(code)}`)).slice(0, 40)}`; }

// ---- sealing ----

/// nonce (12) + ciphertext + tag, base64: the same layout CryptoKit calls "combined".
export async function seal(envelope, key) {
  const nonce = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce }, key, enc.encode(JSON.stringify(envelope))));
  const out = new Uint8Array(12 + ct.length); out.set(nonce); out.set(ct, 12);
  return b64(out);
}
export async function open(base64, key) {
  try {
    const b = unb64(base64);
    const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: b.slice(0, 12) }, key, b.slice(12));
    const e = JSON.parse(dec.decode(plain));
    return typeof e?.id === 'string' && typeof e.from === 'string' && typeof e.text === 'string' && typeof e.ts === 'number' ? e : null;
  } catch { return null; }
}
export const frame = (sealed) => JSON.stringify({ event: 'message', message: sealed });
export function sealedFromFrame(text) { try { const o = JSON.parse(text); return o?.event === 'message' && typeof o.message === 'string' ? o.message : null; } catch { return null; } }

/// 'accept', 'own', 'duplicate', 'stale', 'empty' or 'tooLong'. Mutates `seen`.
export function judge(e, selfId, seen, now = Date.now()) {
  if (e.from === selfId) return 'own';
  if (seen.has(e.id)) return 'duplicate';
  if (Math.abs(now - e.ts) > TOLERANCE_MS) return 'stale';
  if (!String(e.text).trim()) return 'empty';
  if ([...e.text].length > MAX_TEXT) return 'tooLong';
  seen.add(e.id);
  if (seen.size > 200) { const keep = [...seen].slice(-100); seen.clear(); keep.forEach((k) => seen.add(k)); }
  return 'accept';
}

// ---- the connection ----

export const enabled = () => load('clipsync.on', false);
export const code = () => load('clipsync.code', '');
export const deviceId = () => { let d = load('clipsync.device', ''); if (!d) { d = uid(); save('clipsync.device', d); } return d; };
export const deviceName = () => load('clipsync.name', 'Windows PC');
export let state = 'off';           // off | connecting | live | reconnecting
const seen = new Set();
let socket = null, gen = 0, retry = 0, pingTimer = null, flashUntil = 0, flashText = '', lastApplied = '', lastAppliedAt = 0;

const setState = (s) => { state = s; dispatchEvent(new Event('clipsync-state')); };

export function setCode(raw) {
  const n = raw == null ? normalize(newCode()) : normalize(raw);
  if (!isValid(n)) return false;
  save('clipsync.code', format(n));
  apply();
  return true;
}
export function setEnabled(on) { save('clipsync.on', !!on); apply(); }

export async function apply() {
  gen++; clearInterval(pingTimer); pingTimer = null;
  try { socket?.close(); } catch {}
  socket = null;
  if (!enabled() || !canUse('clipboardLink') || !isValid(code())) { setState('off'); return; }
  retry = 0;
  connect();
}

async function connect() {
  const g = gen, c = code();
  setState('connecting');
  const [key, topic] = await Promise.all([keyFor(c), topicFor(c)]);
  if (g !== gen) return;
  let ws;
  try { ws = new WebSocket(`${RELAY}/${topic}/ws`); } catch { return lost(g); }
  socket = ws;
  ws.onmessage = async (m) => {
    if (g !== gen || typeof m.data !== 'string' || m.data === 'pong') return;
    try { if (JSON.parse(m.data).event === 'open') { setState('live'); retry = 0; return; } } catch { return; }
    const sealed = sealedFromFrame(m.data);
    const env = sealed && await open(sealed, key);
    if (env && judge(env, deviceId(), seen) === 'accept') applyRemote(env);
  };
  ws.onclose = () => lost(g);
  ws.onerror = () => {};
  pingTimer = setInterval(() => { try { ws.send('ping'); } catch {} }, 30000);
}

function lost(g) {
  if (g !== gen || !enabled()) return;
  clearInterval(pingTimer); pingTimer = null; socket = null;
  retry++; setState('reconnecting');
  setTimeout(() => { if (g === gen && enabled()) connect(); }, Math.min(60, 3 * 2 ** Math.min(retry, 5)) * 1000);
}

/// Text from another device: onto this PC's clipboard, without sending it back.
async function applyRemote(env) {
  lastApplied = env.text; lastAppliedAt = Date.now();
  await invoke('clipboard_copy_text', { text: env.text }).catch(() => {});
  flashText = `From ${env.name}`; flashUntil = Date.now() + 3000;
  refresh(); setTimeout(refresh, 3100);
}

/// Called for every text copied here (services/clipboard.js).
export async function onLocalCopy(text) {
  if (state !== 'live' || !socket || socket.readyState !== 1) return;
  if (text === lastApplied && Date.now() - lastAppliedAt < 5000) return;   // that was us writing it
  if ([...text].length > MAX_TEXT) return;
  const env = { v: 1, id: uid(), from: deviceId(), name: deviceName(), text, ts: Date.now() };
  seen.add(env.id);
  try { socket.send(frame(await seal(env, await keyFor(code())))); } catch {}
}

export function start() {
  provide('clipsync', 40, () => (Date.now() < flashUntil ? { icon: '📋', label: flashText, priority: 40 } : null));
  apply();
}
