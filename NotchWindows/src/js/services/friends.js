// Messenger → Friends, the client. The same behaviour as the Mac's FriendsClient.swift, on the wire format of
// docs/FRIENDS_PROTOCOL.md: this install's identity (friend code + keys), one WebSocket to its mailbox on the relay, friend
// requests (typed code or notchapple://friend link), sealed messages with sent / delivered / read, typing, block and remove.
// The rules are in friendslogic.js, the cryptography in friendscrypto.js; this file is the network, the disk and the state.
//
// Where things live (Windows): the friend code + private keys, the vault key and the sealed history are three small files in
// the app's data folder (src-tauri/src/friendsstore.rs, the same idea as the Bambu sign-in). The history is AES-GCM sealed
// under the vault key and is never synced anywhere. Outside the app (a plain browser, for design work) they fall back to localStorage.

import { load, save, uid } from '../store.js';
import { invoke, hasTauri, http, notify } from '../native.js';
import { provide, refresh } from '../activity.js';
import * as C from './friendscrypto.js';
import * as L from './friendslogic.js';

const BASE = 'https://notchapple-rooms.adityajain1225.workers.dev';
const WS_BASE = 'wss://notchapple-rooms.adityajain1225.workers.dev';

export const settings = {
  get active() { return load('friends.active', false); },
  get nick() { return load('friends.nick', ''); },
  set nick(v) { save('friends.nick', String(v || '').slice(0, 64)); },
  get receipts() { return load('friends.receipts', true); },
  set receipts(v) { save('friends.receipts', !!v); },
};

// ---- state the screen reads

const listeners = new Set();
export const st = { link: 'off', problem: '', typing: new Set(), viewing: null, lastProblem: null, ready: false };
let vault = L.newVault(), me = null, vaultKey = null;
export const state = () => st;
export const book = () => vault;
export const identity = () => me;
export function subscribe(fn) { listeners.add(fn); fn(st); return () => listeners.delete(fn); }
const emit = () => { refresh(); for (const fn of [...listeners]) { try { fn(st); } catch (e) { console.error(e); } } };

export const friends = () => L.active(vault);
export const incoming = () => L.incoming(vault);
export const pending = () => L.pending(vault);
export const messages = (box) => L.messagesOf(vault, box);
export const unread = () => L.totalUnread(vault);
export const displayNick = () => L.clean(settings.nick) || L.clean(load('messenger.identity', null)?.handle) || 'Someone';

// ---- the three files

const file = {
  async get(name) { return hasTauri ? invoke('friends_file_get', { name }) : (localStorage.getItem(`friends.file.${name}`)); },
  async set(name, text) { return hasTauri ? invoke('friends_file_set', { name, text }) : localStorage.setItem(`friends.file.${name}`, text); },
  async del(name) { return hasTauri ? invoke('friends_file_delete', { name }) : localStorage.removeItem(`friends.file.${name}`); },
};

async function loadIdentity() {
  const text = await file.get('identity');
  if (text) {
    try {
      const d = JSON.parse(text);
      const keys = await C.identityFromSeeds(C.unb64u(d.signSeed), C.unb64u(d.dhSeed));
      if (C.normalizeCode(d.code) === d.code) return finishIdentity(d.code, keys);
    } catch (e) { console.error('friends identity unreadable', e); }
    throw new Error('The saved friend identity is unreadable, so a new one was not made over it. Nothing was deleted.');
  }
  const keys = await C.newIdentity(), code = C.newCode();
  await file.set('identity', JSON.stringify({ code, signSeed: C.b64u(keys.signSeed), dhSeed: C.b64u(keys.dhSeed) }));
  return finishIdentity(code, keys);
}
async function finishIdentity(code, keys) {
  const fp = await C.fingerprint(keys.signPub, keys.dhPub);
  return { ...keys, code, box: await C.boxOf(code), fp, fpB64u: C.b64u(fp), link: L.friendLink(code, C.b64u(fp)) };
}

async function loadVaultKey() {
  let text = await file.get('vaultkey');
  if (!text || C.unb64u(text).length !== 32) {
    text = C.b64u(crypto.getRandomValues(new Uint8Array(32)));
    await file.set('vaultkey', text);
  }
  return crypto.subtle.importKey('raw', C.unb64u(text), 'AES-GCM', false, ['encrypt', 'decrypt']);
}
async function loadVault() {
  const text = await file.get('vault');
  if (!text) return L.newVault();
  try {
    const raw = C.unb64u(text), plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: raw.slice(0, 12) }, vaultKey, raw.slice(12));
    return L.normalizeVault(JSON.parse(new TextDecoder().decode(plain)));
  } catch { return L.newVault(); }
}

let readyPromise = null;
/** Makes the identity on first use, then loads the history. Safe to call again and again. */
export function ready() {
  readyPromise ??= (async () => {
    me = await loadIdentity();
    vaultKey = await loadVaultKey();
    vault = await loadVault();
    st.ready = true; emit();
  })().catch((e) => { readyPromise = null; st.link = 'problem'; st.problem = e.message || String(e); emit(); throw e; });
  return readyPromise;
}

let saveTimer = null, savePending = false;
function persist() {
  savePending = true;
  clearTimeout(saveTimer);
  saveTimer = setTimeout(flush, 300);
  emit();
}
async function flush() {
  if (!savePending || !vaultKey) return;
  savePending = false;
  try {
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, vaultKey, new TextEncoder().encode(JSON.stringify(vault))));
    const out = new Uint8Array(12 + ct.length); out.set(iv); out.set(ct, 12);
    await file.set('vault', C.b64u(out));
  } catch (e) { console.error('friends: could not save', e); }
}
if (typeof window !== 'undefined') window.addEventListener('beforeunload', () => { clearTimeout(saveTimer); flush(); });

// ---- HTTP

let lastTs = 0, claimed = false;
const nextTs = () => (lastTs = Math.max(Date.now(), lastTs + 1));

/** One call to the relay. Returns { status, json }; status 0 means the server could not be reached. Owner calls are signed. */
async function call(method, path, body, owner = false) {
  const text = body === undefined ? '' : JSON.stringify(body);
  const headers = {};
  if (body !== undefined) headers['content-type'] = 'application/json';
  if (owner) { headers['x-nf-box'] = me.box; headers['x-nf-auth'] = await C.authHeader(me, method, path, nextTs(), text); }
  try {
    const r = await http(BASE + path, { method, headers, body: body === undefined ? undefined : text, timeout: 20000 });
    let json = {}; try { json = JSON.parse(r.text) || {}; } catch { /* no body */ }
    return { status: r.status, json };
  } catch { return { status: 0, json: {} }; }
}
function explain(status, json) {
  if (status === 0) return "Can't reach the server. Check your internet connection.";
  if (status === 429) return 'Too many tries. Wait a minute and try again.';
  if (status === 507) return 'Their mailbox is full.';
  return (typeof json?.error === 'string' && json.error) || `Something went wrong (${status}).`;
}

/** Registers this install's keys for its mailbox (safe to repeat). */
async function claim() {
  const r = await call('POST', '/f/claim', { box: me.box, sign: C.b64u(me.signPub), dh: C.b64u(me.dhPub) }, true);
  if (r.status === 200) { claimed = true; return true; }
  st.link = 'problem'; st.problem = explain(r.status, r.json); emit();
  return false;
}

// ---- the socket

let ws = null, attempt = 0, reconnectTimer = null, pingTimer = null, wakeWatched = false;

export function activate() { if (!settings.active) save('friends.active', true); return connect(); }

/** Called at app start: reconnects if Friends was ever opened. */
export async function start() {
  provide('friends', 46, () => (unread() ? { icon: '💬', label: `${unread()} new`, tab: 'messenger', title: 'Friends' } : null));
  if (!settings.active) return;
  try { await ready(); await connect(); } catch { /* shown as a problem in the list */ }
}

export async function connect() {
  await ready();
  if (ws) return;
  clearTimeout(reconnectTimer);
  st.link = 'connecting'; st.problem = ''; emit();
  if (!claimed && !(await claim())) { scheduleReconnect(); return; }
  openSocket();
  if (!wakeWatched && typeof document !== 'undefined') {
    wakeWatched = true;
    // A laptop waking up or the network coming back: the old socket is usually dead without knowing it.
    window.addEventListener('online', () => { if (settings.active) { dropSocket(); attempt = 0; connect(); } });
    document.addEventListener('visibilitychange', () => { if (!document.hidden && settings.active && ws && ws.readyState !== WebSocket.OPEN) { dropSocket(); connect(); } });
  }
}

function dropSocket() { clearInterval(pingTimer); if (ws) { ws.onclose = null; ws.onmessage = null; try { ws.close(); } catch { /* closed */ } ws = null; } }
export function disconnect() { clearTimeout(reconnectTimer); dropSocket(); st.link = 'off'; emit(); }

function scheduleReconnect() {
  dropSocket();
  attempt++;
  clearTimeout(reconnectTimer);
  reconnectTimer = setTimeout(() => { if (settings.active) connect(); }, Math.min(60, 2 ** Math.min(attempt, 6)) * 1000);
}

async function openSocket() {
  const path = `/f/ws/${me.box}`;
  const auth = await C.authHeader(me, 'GET', path, nextTs());
  let sock;
  try { sock = new WebSocket(`${WS_BASE}${path}?a=${encodeURIComponent(auth)}`); } catch { scheduleReconnect(); return; }
  ws = sock;
  sock.onmessage = (e) => { if (ws === sock && typeof e.data === 'string') handle(e.data).catch((err) => console.error('friends', err)); };
  const lost = () => { if (ws !== sock) return; st.link = 'connecting'; emit(); scheduleReconnect(); };
  sock.onclose = lost; sock.onerror = lost;
  clearInterval(pingTimer);
  pingTimer = setInterval(() => { if (ws === sock && sock.readyState === WebSocket.OPEN) sock.send('ping'); }, 25_000);
}

async function handle(text) {
  if (text === 'pong') return;
  let obj; try { obj = JSON.parse(text); } catch { return; }
  const acks = [];
  switch (obj.type) {
    case 'hello':
      attempt = 0; st.link = 'online'; st.problem = '';
      for (const it of obj.requests || []) if (Number.isInteger(it.id) && typeof it.blob === 'string') { await processRequest(it.blob); acks.push(it.id); }
      for (const it of obj.queue || []) if (Number.isInteger(it.id) && typeof it.blob === 'string') { await processMessage(it.blob); acks.push(it.id); }
      break;
    case 'req': if (Number.isInteger(obj.id) && typeof obj.blob === 'string') { await processRequest(obj.blob); acks.push(obj.id); } break;
    case 'msg': if (Number.isInteger(obj.id) && typeof obj.blob === 'string') { await processMessage(obj.blob); acks.push(obj.id); } break;
    case 'live': if (typeof obj.blob === 'string') await processLive(obj.blob); break;
    default: break;
  }
  if (acks.length && ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ ack: acks }));
  persist();
}

// ---- what arrives

const watching = async () => { const a = await import('../app.js'); return a.isExpanded() && a.activeTab() === 'messenger'; };
const hexOf = (bytes) => [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');

async function processRequest(blob) {
  const opened = await C.open(me, me.box, 'req', blob);
  const body = opened?.body;
  if (!body || body.t !== 'req' || typeof body.sign !== 'string') return;
  let sign, dh;
  try { sign = C.unb64u(body.sign); dh = C.unb64u(body.dh); } catch { return; }
  if (sign.length !== 32 || dh.length !== 32 || !(await C.sealedBy(sign, me.box, 'req', opened))) return;
  const out = L.receiveRequest(vault, body, hexOf(await C.fingerprint(sign, dh)));
  if (out.kind === 'added') tell('Friend request', `${L.displayName(out.record)} wants to be friends.`);
  else if (out.kind === 'mutual') tell("You're friends", `You and ${L.displayName(out.record)} are now friends.`);
}

/** A blob from a friend I know: opened, signature checked against the key I pinned. */
async function openFromFriend(blob) {
  const opened = await C.open(me, me.box, 'msg', blob);
  const body = opened?.body;
  if (!body) return null;
  const friend = L.record(vault, body.from || body.box);
  if (!friend || !(await C.sealedBy(C.unb64u(friend.sign), me.box, 'msg', opened))) return null;
  return { body, friend };
}

async function processMessage(blob) {
  const got = await openFromFriend(blob);
  if (!got) return;
  const { body, friend } = got;
  switch (body.t) {
    case 'acc': {
      const r = L.receiveAcceptance(vault, body);
      if (r) tell('Friend request accepted', `${L.displayName(r)} accepted. You can chat now.`);
      break;
    }
    case 'msg': {
      const m = L.receiveMessage(vault, friend.box, body.id, body.text, body.ts);
      if (!m) return;
      const here = st.viewing === friend.box && (await watching());
      if (here) L.markRead(vault, friend.box);
      else tell(L.displayName(friend), String(m.text).slice(0, 200));
      if (settings.receipts) sendReceipt(friend, body.id, here ? 'read' : 'delivered');
      st.typing.delete(friend.box);
      break;
    }
    case 'rcpt':
      if (typeof body.id === 'string') L.setState(vault, friend.box, body.id, body.state === 'read' ? 'read' : 'delivered');
      break;
    case 'gone': L.remove(vault, friend.box); if (st.viewing === friend.box) st.viewing = null; break;
    default: break;
  }
}

async function processLive(blob) {
  const got = await openFromFriend(blob);
  if (!got || got.body.t !== 'typing') return;
  const box = got.friend.box;
  st.typing.add(box); emit();
  setTimeout(() => { st.typing.delete(box); emit(); }, 6000);
}

async function tell(title, body) {
  if (!load('messenger.notify', true)) return;
  if (await watching()) return;
  notify(title, body);
}

// ---- adding, accepting, blocking, removing

const sealTo = (kind, body, box, dh) => C.seal(me, { box, dh: typeof dh === 'string' ? C.unb64u(dh) : dh }, kind, body);

/** Adds a friend from a typed code or a notchapple://friend link. Returns a message when it didn't work, else null. */
export async function addFriend(input, alias = null) {
  await ready();
  const parsed = L.parseFriend(input);
  if (!parsed) return "That doesn't look like a friend code. It has 10 letters and numbers.";
  const box = await C.boxOf(parsed.code);
  if (box === me.box) return "That's your own code.";
  const existing = L.record(vault, box);
  if (existing) return existing.status === 'active' ? "You're already friends." : 'You already asked this person.';
  save('friends.active', true);
  if (!claimed && !(await claim())) return "Can't reach the server. Check your internet connection.";
  connect();
  const key = await call('GET', `/f/key/${box}`);
  if (key.status !== 200 || typeof key.json.sign !== 'string' || typeof key.json.dh !== 'string') {
    return key.status === 404 ? 'No one has that code yet. Check it and try again.' : explain(key.status, key.json);
  }
  let sign, dh;
  try { sign = C.unb64u(key.json.sign); dh = C.unb64u(key.json.dh); } catch { return 'The server sent keys that could not be read.'; }
  if (sign.length !== 32 || dh.length !== 32) return 'The server sent keys that could not be read.';
  const fp = await C.fingerprint(sign, dh);
  if (parsed.fingerprint && parsed.fingerprint !== C.b64u(fp)) return "That code's keys don't match the QR code. Someone may be interfering, so don't add it.";
  if (L.isBlocked(vault, hexOf(fp))) return 'You blocked this person. Unblock them in the Friends settings first.';
  const mine = await C.newToken();
  const allow = await call('PUT', '/f/allow', { hash: mine.hash }, true);
  if (allow.status !== 200) return explain(allow.status, allow.json);
  const blob = await sealTo('req', { t: 'req', box: me.box, sign: C.b64u(me.signPub), dh: C.b64u(me.dhPub), nick: displayNick(), token: mine.token, ts: Date.now() }, box, dh);
  const sent = await call('POST', '/f/req', { to: box, blob });
  if (sent.status !== 202) { await call('DELETE', `/f/allow/${mine.hash}`, undefined, true); return explain(sent.status, sent.json); }
  L.addOutgoing(vault, { box, sign: C.b64u(sign), dh: C.b64u(dh), fp: hexOf(fp), alias, myTokenHash: mine.hash });
  persist();
  return null;
}

export async function accept(box) {
  await ready();
  const r = L.record(vault, box);
  if (!r || r.status !== 'incoming' || !r.pendingToken) return 'That request is gone.';
  const mine = await C.newToken();
  const allow = await call('PUT', '/f/allow', { hash: mine.hash }, true);
  if (allow.status !== 200) return explain(allow.status, allow.json);
  const blob = await sealTo('msg', { t: 'acc', box: me.box, sign: C.b64u(me.signPub), dh: C.b64u(me.dhPub), nick: displayNick(), token: mine.token, ts: Date.now() }, r.box, r.dh);
  const sent = await call('POST', '/f/send', { to: r.box, token: r.pendingToken, blob });
  if (sent.status !== 200) { await call('DELETE', `/f/allow/${mine.hash}`, undefined, true); return explain(sent.status, sent.json); }
  L.accept(vault, box, mine.hash);
  persist();
  return null;
}

export function block(box) {
  const hash = L.record(vault, box)?.myTokenHash;
  L.block(vault, box); if (st.viewing === box) st.viewing = null;
  persist();
  if (hash) call('DELETE', `/f/allow/${hash}`, undefined, true);
}

export function remove(box) {
  const r = L.record(vault, box);
  if (!r) return;
  const hash = r.myTokenHash;
  if (r.status === 'active') sendControl('gone', r);
  L.remove(vault, box); if (st.viewing === box) st.viewing = null;
  persist();
  if (hash) call('DELETE', `/f/allow/${hash}`, undefined, true);
}

export function setAlias(box, alias) { L.setAlias(vault, box, alias); persist(); }
export function unblockAll() { L.unblockAll(vault); persist(); }

/** "Delete all my chat data": the server mailbox, the history, friends and block list. The code and keys stay. */
export async function deleteEverything() {
  await ready();
  disconnect();
  await call('POST', '/f/wipe', {}, true);
  vault = L.newVault(); claimed = false; st.typing = new Set(); savePending = false; clearTimeout(saveTimer);
  await file.del('vault');
  emit();
  if (settings.active) connect();
}

// ---- sending

async function post(friend, body, live = false) {
  if (!friend.sendToken) return { status: 0, json: {} };
  const blob = await sealTo('msg', body, friend.box, friend.dh);
  return call('POST', '/f/send', { to: friend.box, token: friend.sendToken, blob, ...(live ? { live: true } : {}) });
}

export function send(text, box) {
  const t = String(text || '').trim();
  const friend = L.record(vault, box);
  if (!t || L.charCount(t) > L.MAX_TEXT || !friend || friend.status !== 'active') return;
  const id = uid().toUpperCase();
  L.addMine(vault, box, id, t); persist();
  deliver(id, t, friend);
}
export function retry(id, box) {
  const friend = L.record(vault, box), m = messages(box).find((x) => x.id === id);
  if (!friend || !m || !L.retryState(vault, box, id)) return;
  persist(); deliver(id, m.text, friend);
}
async function deliver(id, text, friend) {
  const r = await post(friend, { t: 'msg', from: me.box, id, text, ts: Date.now() });
  L.setState(vault, friend.box, id, r.status === 200 ? 'sent' : 'failed');
  if (r.status === 403) st.lastProblem = `${L.displayName(friend)} removed you or hasn't accepted.`;
  else if (r.status !== 200) st.lastProblem = explain(r.status, r.json);
  persist();
}

const receiptsSent = new Set();
function sendReceipt(friend, id, state) {
  const key = `${id}|${state}`;
  if (!friend.sendToken || receiptsSent.has(key)) return;
  receiptsSent.add(key);
  post(friend, { t: 'rcpt', from: me.box, id, state, ts: Date.now() });
}
function sendControl(type, friend) { post(friend, { t: type, from: me.box, ts: Date.now() }); }

const lastTypingSent = {};
/** Called as someone types; sends at most one "typing" signal every 3 seconds. */
export function typingChanged(box) {
  const friend = L.record(vault, box);
  if (!settings.receipts || !friend || friend.status !== 'active' || !friend.sendToken) return;
  if (Date.now() - (lastTypingSent[box] || 0) < 3000) return;
  lastTypingSent[box] = Date.now();
  post(friend, { t: 'typing', from: me.box, ts: Date.now() }, true);
}

/** The chat is on screen: clear the unread count and tell the friend (if receipts are on). */
export function markRead(box) {
  L.markRead(vault, box);
  const friend = L.record(vault, box);
  if (settings.receipts && friend) for (const m of messages(box).slice(-20)) if (!m.mine) sendReceipt(friend, m.id, 'read');
  persist();
}
export function setViewing(box) { st.viewing = box; if (box) markRead(box); else emit(); }
