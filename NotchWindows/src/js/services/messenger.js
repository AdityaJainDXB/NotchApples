// Messenger rooms, the same protocol as the Mac's WebP2PManager.swift, so Mac
// and Windows users can talk in the same room:
//
//  • The room code is normalised and hashed twice with SHA-256 (different labels):
//    one hash names the relay topic, the other is the AES-GCM key. The relay
//    never sees the room name and can't read messages.
//  • Messages go through ntfy.sh over TLS (`Cache: no`, so nothing is stored).
//  • Envelope: { v, kind, id, senderID, sender, text?, ts } as JSON, where ts is
//    Swift's default Date encoding (seconds since 1 Jan 2001), sealed with
//    AES-GCM and sent as base64 of nonce(12) | ciphertext | tag(16).
//  • Everyone announces themselves every 30 s, which builds the "online" list.

import { load, save, uid } from '../store.js';
import { http, notify } from '../native.js';
import { provide, refresh } from '../activity.js';

const RELAY = 'ntfy.sh';
const SWIFT_EPOCH = 978307200; // 2001-01-01 in Unix seconds

const listeners = new Set();
const st = { state: 'idle', room: null, error: null, members: new Map(), messages: [], unread: 0 };
let ws = null, key = null, topic = null, presenceTimer = null, retry = 0;
const seen = new Set();

export const state = () => st;
export function subscribe(fn) { listeners.add(fn); fn(st); return () => listeners.delete(fn); }
const emit = () => { refresh(); for (const fn of listeners) { try { fn(st); } catch {} } };

// ---- identity: a random handle and ID, never tied to you or this PC ----

const ADJ = ['Purple', 'Amber', 'Cobalt', 'Coral', 'Jade', 'Lunar', 'Solar', 'Misty', 'Velvet', 'Neon', 'Maple', 'Cedar'];
const ANIMAL = ['Panda', 'Otter', 'Falcon', 'Lynx', 'Koala', 'Raven', 'Tiger', 'Gecko', 'Heron', 'Bison', 'Manta', 'Puffin'];
export function identity() {
  let id = load('messenger.identity', null);
  if (!id) {
    const r = (a) => a[crypto.getRandomValues(new Uint32Array(1))[0] % a.length];
    id = { senderID: uid().toUpperCase(), handle: `${r(ADJ)}${r(ANIMAL)}#${100 + (crypto.getRandomValues(new Uint32Array(1))[0] % 900)}` };
    save('messenger.identity', id);
  }
  return id;
}
export function setHandle(handle) { save('messenger.identity', { ...identity(), handle: handle.slice(0, 32) }); }

// ---- crypto ----

export const normalize = (raw) => raw.trim().toLowerCase().replace(/^#+/, '');

export function newRoomCode() {
  const words = ['violet', 'amber', 'cobalt', 'coral', 'jade', 'lunar', 'solar', 'misty', 'velvet', 'neon', 'maple', 'cedar', 'orbit', 'pixel', 'ember', 'frost'];
  const animals = ['otter', 'panda', 'falcon', 'lynx', 'koala', 'raven', 'tiger', 'gecko', 'moose', 'heron', 'bison', 'dingo', 'manta', 'puffin', 'yak', 'zebra'];
  const alphabet = 'abcdefghjkmnpqrstuvwxyz23456789';
  const n = (max) => crypto.getRandomValues(new Uint32Array(1))[0] % max;
  const tail = Array.from({ length: 4 }, () => alphabet[n(alphabet.length)]).join('');
  return `${words[n(words.length)]}-${animals[n(animals.length)]}-${1000 + n(9000)}-${tail}`;
}

const sha = async (text) => new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)));
const hex = (bytes) => [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
const b64 = (bytes) => btoa(String.fromCharCode(...bytes));
const unb64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

async function seal(obj) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(JSON.stringify(obj))));
  const out = new Uint8Array(12 + ct.length);
  out.set(iv); out.set(ct, 12);
  return b64(out);
}

async function open(text) {
  try {
    const bytes = unb64(text);
    const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: bytes.slice(0, 12) }, key, bytes.slice(12));
    return JSON.parse(new TextDecoder().decode(plain));
  } catch { return null; } // not for us, or tampered with
}

// ---- room ----

export async function join(raw) {
  const room = normalize(raw);
  if (!room) return;
  leave(true);
  st.room = room;
  st.messages = []; st.members = new Map(); st.error = null; st.unread = 0;
  key = await crypto.subtle.importKey('raw', await sha(`notchapple-room-key|${room}`), 'AES-GCM', false, ['encrypt', 'decrypt']);
  topic = `notchapple-v1-${hex(await sha(`notchapple-room-topic|${room}`)).slice(0, 40)}`;
  save('messenger.room', room);
  connect();
}

export function leave(keepRoom = false) {
  if (st.state === 'joined') publish('leave');
  if (!keepRoom) save('messenger.room', null);
  clearInterval(presenceTimer); presenceTimer = null;
  if (ws) { ws.onclose = null; ws.close(); ws = null; }
  st.state = 'idle'; st.members = new Map();
  if (!keepRoom) { st.room = null; st.messages = []; }
  emit();
}

function connect() {
  if (!topic) return;
  st.state = 'connecting'; emit();
  ws = new WebSocket(`wss://${RELAY}/${topic}/ws`);
  ws.onmessage = async (e) => {
    let ev; try { ev = JSON.parse(e.data); } catch { return; }
    if (ev.event === 'open') {
      st.state = 'joined'; retry = 0; st.error = null; emit();
      publish('presence');
      clearInterval(presenceTimer);
      presenceTimer = setInterval(() => { publish('presence'); prune(); }, 30_000);
    } else if (ev.event === 'message' && ev.message) {
      const env = await open(ev.message);
      if (env) receive(env);
    }
  };
  ws.onerror = () => { st.error = "Couldn't reach the relay. Check your connection."; };
  ws.onclose = () => {
    ws = null;
    if (!st.room) return;
    st.state = 'connecting'; emit();
    // Reconnect with a growing delay (2 s … 60 s).
    setTimeout(connect, Math.min(60_000, 2000 * 2 ** retry++));
  };
}

function prune() {
  const now = Date.now();
  for (const [id, m] of st.members) if (now - m.lastSeen > 75_000) st.members.delete(id);
  emit();
}

async function publish(kind, text) {
  if (!key || !topic) return null;
  const me = identity();
  const env = { v: 1, kind, id: uid().toUpperCase(), senderID: me.senderID, sender: me.handle, ts: Date.now() / 1000 - SWIFT_EPOCH };
  if (text) env.text = text;
  try {
    await http(`https://${RELAY}/${topic}`, { method: 'POST', body: await seal(env), headers: { Cache: 'no', Firebase: 'no' }, timeout: 15000 });
  } catch (e) { st.error = e.message; emit(); }
  return env;
}

export async function send(text) {
  const t = text.trim();
  if (!t || st.state !== 'joined') return;
  const env = await publish('message', t.slice(0, 2000));
  if (!env) return;
  seen.add(env.id);
  st.messages.push({ id: env.id, sender: env.sender, text: t, at: Date.now(), mine: true });
  emit();
}

function notice(text) { st.messages.push({ id: uid(), notice: true, text, at: Date.now() }); }

async function receive(env) {
  const at = (env.ts + SWIFT_EPOCH) * 1000;
  if (Math.abs(Date.now() - at) > 600_000) return; // stale or replayed
  const me = identity();
  const isMe = env.senderID === me.senderID;
  const name = String(env.sender || '?').slice(0, 32);
  if (env.kind === 'presence') {
    if (!isMe) {
      if (!st.members.has(env.senderID)) { notice(`${name} joined`); publish('presence'); }
      st.members.set(env.senderID, { handle: name, lastSeen: Date.now() });
    }
  } else if (env.kind === 'leave') {
    const m = st.members.get(env.senderID);
    if (m) { st.members.delete(env.senderID); notice(`${m.handle} left`); }
  } else if (env.kind === 'message' && !isMe && !seen.has(env.id) && env.text) {
    seen.add(env.id);
    if (!st.members.has(env.senderID)) notice(`${name} joined`);
    st.members.set(env.senderID, { handle: name, lastSeen: Date.now() });
    st.messages.push({ id: env.id, sender: name, text: String(env.text).slice(0, 2000), at, mine: false });
    const { isExpanded, activeTab } = await import('../app.js');
    if (!(isExpanded() && activeTab() === 'messenger')) {
      st.unread++;
      if (load('messenger.notify', true)) notify(`${name} · #${st.room}`, String(env.text).slice(0, 200));
    }
  }
  if (st.messages.length > 500) st.messages.splice(0, st.messages.length - 500);
  emit();
}

export const markRead = () => { st.unread = 0; emit(); };

export function start() {
  // Rejoin the room you were in.
  const room = load('messenger.room', null);
  if (room) import('../features.js').then((f) => { if (f.canUse('messenger')) join(room); });
  provide('messenger', 45, () => (st.unread ? { icon: '💬', label: `${st.unread} new`, tab: 'messenger', title: `#${st.room}` } : null));
}
