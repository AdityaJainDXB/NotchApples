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
import * as TTT from '../games/tictactoe-logic.js';
import * as P from '../games/twoplayer-logic.js';

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
export const groups = () => L.groupsSorted(vault);
export const group = (key) => L.group(vault, key);
/** Who sent a group message, as a name (someone who isn't my friend can't send into a group, so this is nearly always known). */
export const nameOfBox = (box) => { const f = box ? L.record(vault, box) : null; return f ? L.displayName(f) : 'Someone'; };
/** "You" for me, else the friend's name (the game cards name players by mailbox). */
export const nameOfBoxOrYou = (box) => (me && box === me.box ? 'You' : nameOfBox(box));
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

// Files that came with messages: one sealed file each (the same vault key), named by a hash of the id, never inside the history.
const fileNameOf = async (id) => `f-${await C.sha256hex(`${id}`)}`;
async function saveFileBytes(id, bytes) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, vaultKey, bytes));
  const out = new Uint8Array(12 + ct.length); out.set(iv); out.set(ct, 12);
  await file.set(await fileNameOf(id), C.b64u(out));
}
async function loadFileBytes(id) {
  try {
    const text = await file.get(await fileNameOf(id));
    if (!text) return null;
    const raw = C.unb64u(text);
    return new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: raw.slice(0, 12) }, vaultKey, raw.slice(12)));
  } catch { return null; }
}
async function deleteFileBytes(ids) { for (const id of ids) { try { await file.del(await fileNameOf(id)); } catch { /* already gone */ } } }
async function clearFileBytes() {
  if (hasTauri) { try { await invoke('friends_files_clear'); } catch (e) { console.error(e); } return; }
  for (const k of Object.keys(localStorage)) if (k.startsWith('friends.file.f-')) localStorage.removeItem(k);
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
      flushClears().catch(() => {});   // a clear that could not be sent earlier (offline, or the app was closed)
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
      const m = L.receiveMessage(vault, friend.box, body.id, body.text, body.ts, Date.now(), body.ce);
      if (!m) return;
      const here = st.viewing === friend.box && (await watching());
      if (here) L.markRead(vault, friend.box);
      else tell(L.displayName(friend), String(m.text).slice(0, 200));
      if (settings.receipts) sendReceipt(friend, body.id, here ? 'read' : 'delivered');
      st.typing.delete(friend.box);
      break;
    }
    case 'grp': {
      const known = typeof body.g === 'string' && !!L.group(vault, L.groupKey(body.g));
      const g = L.receiveGroup(vault, friend.box, body, me.box);
      if (g && !known) tell('New group', `${L.displayName(friend)} added you to ${g.name}.`);
      break;
    }
    case 'gmsg': {
      const m = L.receiveGroupMessage(vault, friend.box, body.g, body.id, body.text, body.ts, Date.now(), body.ce);
      const g = m && L.group(vault, L.groupKey(body.g));
      if (!m || !g) return;
      if (st.viewing === L.groupKey(g.id) && (await watching())) L.markGroupRead(vault, L.groupKey(g.id));
      else tell(`${L.displayName(friend)} in ${g.name}`, String(m.text).slice(0, 200));
      break;
    }
    case 'gleave': if (typeof body.g === 'string') L.receiveLeave(vault, friend.box, body.g); break;
    case 'chunk': await receiveChunk(body, friend); break;
    // "Clear chat" from the other side (or a group member). Apps from before it was added never reach this: they ignore the unknown type.
    case 'clr': { const out = L.receiveClear(vault, friend.box, body); if (out) await forget(out); break; }
    case 'game': if (friend.status === 'active' && body.ttt && typeof body.ttt === 'object') applyTtt(body.ttt, friend.box, friend.box); break;
    case 'play': if (friend.status === 'active' && body.play && typeof body.play === 'object') play(friend.box)?.receive(body.play, friend.box); break;
    case 'rcpt':
      if (typeof body.id === 'string') L.setState(vault, friend.box, body.id, body.state === 'read' ? 'read' : 'delivered');
      break;
    case 'gone': dropGames(friend.box); deleteFileBytes(L.fileIds(vault, friend.box)); L.remove(vault, friend.box); if (st.viewing === friend.box) st.viewing = null; break;
    default: break;
  }
}

// ---- files

/** Files being put back together from their chunks (kept in memory only; a partial file is dropped after 10 minutes). */
const partials = new Map();

async function receiveChunk(body, friend) {
  const done = L.receiveChunk(vault, partials, friend.box, body);
  if (!done) return;
  const m = L.receiveFile(vault, friend.box, done.group, done.id, done.name, done.bytes.length, Date.now(), done.ce, done.ts);
  if (!m) return;
  await saveFileBytes(done.id, done.bytes);
  const g = done.group ? L.group(vault, L.groupKey(done.group)) : null;
  const viewKey = g ? L.groupKey(g.id) : friend.box;
  const here = st.viewing === viewKey && (await watching());
  if (here) { if (g) L.markGroupRead(vault, viewKey); else L.markRead(vault, friend.box); }
  else tell(g ? `${L.displayName(friend)} in ${g.name}` : L.displayName(friend), `Sent a file: ${m.file.name}`);
  if (!g && settings.receipts) sendReceipt(friend, done.id, here ? 'read' : 'delivered');
}

const stdB64 = (bytes) => { let s = ''; for (let i = 0; i < bytes.length; i += 8192) s += String.fromCharCode(...bytes.subarray(i, i + 8192)); return btoa(s); };
const stdBytes = (b64) => Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));

/** Sends a file (a path from the file picker) to one friend or a group. Returns a message when it can't (too big, unreadable). */
export async function sendFile(path, key) {
  await ready();
  let read;
  try { read = await invoke('read_file_base64', { path }); } catch (e) { return typeof e === 'string' && /larger than|folder/.test(e) ? tooBig(e) : "Couldn't read that file."; }
  const bytes = stdBytes(read.data), name = L.cleanFileName(read.name);
  if (bytes.length > L.MAX_FILE_BYTES) return tooBig(bytes.length);
  if (!bytes.length || !name) return "Couldn't read that file.";
  const id = uid().toUpperCase(), info = { name, size: bytes.length };
  let to, gid = null;
  if (L.isGroupKey(key)) {
    const g = L.group(vault, key);
    if (!g) return 'That group is gone.';
    to = g.members.map((b) => L.record(vault, b)).filter((f) => f && f.status === 'active'); gid = g.id;
    if (!to.length) return 'No one in this group is your friend yet, so there is no one to send to.';
    L.addMineToGroup(vault, key, id, '', info);
  } else {
    const f = L.record(vault, key);
    if (!f || f.status !== 'active') return 'Not friends yet.';
    to = [f];
    L.addMineFile(vault, key, id, info);
  }
  await saveFileBytes(id, bytes);
  persist();
  deliverFile(id, name, bytes, gid, key, to);
  return null;
}
const tooBig = (n) => (typeof n === 'number'
  ? `That file is ${Math.ceil(n / 1000)} KB. Files up to ${L.MAX_FILE_TEXT} can be sent in a chat (photos, documents and short clips are fine; long videos are too big).`
  : `That file is too big. Files up to ${L.MAX_FILE_TEXT} can be sent in a chat (photos, documents and short clips are fine; long videos are too big).`);

async function deliverFile(id, name, bytes, gid, historyKey, to) {
  const mine = messages(historyKey).find((m) => m.id === id);
  if (!mine) return;                                                    // cleared before it started
  const bodies = L.chunkBodies(me.box, id, name, bytes, gid, Date.now(), C.b64u, mine.ce ?? L.epochOf(vault, historyKey));
  const gone = () => !messages(historyKey).some((m) => m.id === id);   // cleared while the pieces were going out: stop
  let reached = 0, lastStatus = 200;
  for (const friend of to) {
    if (!friend.sendToken) continue;
    // Paced and retried on 429 (L.sendPieces), so a big file is not lost halfway when the relay's per-minute limit is reached.
    const r = await L.sendPieces(bodies, (b) => (gone() ? Promise.resolve({ status: 0, json: {} }) : post(friend, b, false, historyKey)), (ms) => new Promise((res) => setTimeout(res, ms)));
    if (gone()) return;
    if (r.ok) reached++; else lastStatus = r.status;
  }
  L.setState(vault, historyKey, id, reached > 0 ? 'sent' : 'failed');
  if (reached < to.length) st.lastProblem = reached === 0 ? explain(lastStatus, {}) : `The file reached ${reached} of ${to.length} people.`;
  persist();
}

/** Puts a received file in a fresh temp folder and shows it in Explorer. It is never opened for you. */
export async function reveal(id, name, chat = null) {
  const bytes = await loadFileBytes(id), safe = L.cleanFileName(name);
  if (!bytes || !safe) { st.lastProblem = 'That file is no longer on this PC.'; emit(); return; }
  try {
    const path = await invoke('friends_stage_file', { name: safe, base64: stdB64(bytes) });
    if (chat) (staged.get(chat) || staged.set(chat, []).get(chat)).push(path);   // remembered so "Clear chat" can delete this copy too
    await invoke('reveal_path', { path });
  } catch (e) { st.lastProblem = String(e); emit(); }
}

// ---- groups

/** Makes a group of friends and invites them. Returns a message when it didn't work. */
export function createGroup(name, members) {
  if (!members.length) return 'Pick at least one friend.';
  if (members.length >= L.MAX_GROUP_MEMBERS) return `A group can have up to ${L.MAX_GROUP_MEMBERS} people.`;
  const g = L.createGroup(vault, name, members);
  if (!g) return `Couldn't make the group (${L.MAX_GROUPS} groups at most, and everyone must be a friend).`;
  persist();
  for (const box of g.members) { const f = L.record(vault, box); if (f && f.status === 'active') post(f, L.groupInviteBody(me.box, g, Date.now())); }
  return null;
}

const reachable = (g) => g.members.map((b) => L.record(vault, b)).filter((f) => f && f.status === 'active');

export function sendToGroup(text, key) {
  const t = String(text || '').trim(), g = L.group(vault, key);
  if (!t || L.charCount(t) > L.MAX_TEXT || !g) return;
  const id = uid().toUpperCase(), to = reachable(g);
  L.addMineToGroup(vault, key, id, t); persist();
  if (!to.length) { L.setState(vault, key, id, 'failed'); st.lastProblem = 'No one in this group is your friend yet, so there is no one to send to.'; persist(); return; }
  deliverToGroup(id, t, g, to);
}
async function deliverToGroup(id, text, g, to) {
  let reached = 0;
  for (const friend of to) {
    const mine = messages(L.groupKey(g.id)).find((m) => m.id === id);
    if (!mine) return;                                                    // cleared while sending: do not send it
    const r = await post(friend, { t: 'gmsg', from: me.box, g: g.id, id, text, ts: Date.now(), ce: mine.ce ?? L.epochOf(vault, L.groupKey(g.id)) }, false, L.groupKey(g.id));
    if (r.status === 200) reached++; else if (r.status !== 403) st.lastProblem = explain(r.status, r.json);
  }
  L.setState(vault, L.groupKey(g.id), id, reached > 0 ? 'sent' : 'failed');
  persist();
}

export function leaveGroup(key) {
  const g = L.group(vault, key);
  if (!g) return;
  for (const f of reachable(g)) post(f, { t: 'gleave', from: me.box, g: g.id, ts: Date.now() });
  const files = L.leaveGroup(vault, key);
  if (st.viewing === key) st.viewing = null;
  deleteFileBytes(files);
  persist();
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
  dropGames(box);
  deleteFileBytes(L.fileIds(vault, box)); unstage(box);
  L.block(vault, box); if (st.viewing === box) st.viewing = null;
  persist();
  if (hash) call('DELETE', `/f/allow/${hash}`, undefined, true);
}

export function remove(box) {
  const r = L.record(vault, box);
  if (!r) return;
  const hash = r.myTokenHash;
  if (r.status === 'active') sendControl('gone', r);
  dropGames(box);
  deleteFileBytes(L.fileIds(vault, box)); unstage(box);
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
  for (const box of [...plays.keys(), ...tttGames.keys()]) dropGames(box);
  vault = L.newVault(); claimed = false; st.typing = new Set(); savePending = false; clearTimeout(saveTimer);
  await file.del('vault');
  await clearFileBytes();
  emit();
  if (settings.active) connect();
}

// ---- Clear chat
//
// Wipes one chat (a friend's, or a group's) on this PC and on every other participant's. The friend stays. Messages sent before the
// clear are gone, messages sent after it survive (clear epochs, L.clearChat). The other side gets a sealed, signed `clr` control
// message over the friend link; if they are offline it waits on the relay like any message. What is still queued on the relay for
// that chat is taken back first (/f/purge). Copies outside the app (screenshots, saved or copied files) are out of reach, and a toast
// that Windows already showed cannot be taken back.

const staged = new Map();   // chat key -> paths of copies put in the temp folder for Explorer
function unstage(key) { const paths = staged.get(key); staged.delete(key); if (paths?.length) invoke('friends_unstage', { paths }).catch(() => {}); }
let flushing = false;

/** Clears a chat for everyone in it. `key` is a friend's mailbox or a group key. Returns true when there was such a chat. */
export function clearChat(key) {
  const out = L.clearChat(vault, key);
  if (!out) return false;
  forget(out);
  const boxes = L.isGroupKey(key) ? (L.group(vault, key)?.members || []) : [key];
  L.queueClear(vault, key, out.epoch, out.at, boxes.filter((b) => L.record(vault, b)?.status === 'active'));
  persist();
  flushClears().catch(() => {});
  return true;
}

/** Everything on this PC that belonged to a cleared chat besides the messages themselves: saved files, half-received files, copies
 *  put in the temp folder for Explorer, receipts bookkeeping and the typing/problem lines. */
async function forget(out) {
  const gid = L.isGroupKey(out.key) ? out.key.slice(2) : null;
  for (const [k, p] of [...partials]) if (gid ? p.group === gid : (!p.group && k.startsWith(`${out.key}|`))) partials.delete(k);
  const gone = new Set(out.files);
  for (const k of [...receiptsSent]) if (gone.has(k.split('|')[0])) receiptsSent.delete(k);
  unstage(out.key);
  st.typing.delete(out.key); st.lastProblem = null;
  await deleteFileBytes(out.files);
  emit();
}

/** Tells everyone who still has to be told about a clear. Safe to call again and again; runs when a clear is made and whenever the link comes up. */
export async function flushClears() {
  if (flushing || !me) return;
  flushing = true;
  try {
    for (const [key, pending] of Object.entries(vault.pendingClears)) {
      for (const box of [...pending.to]) {
        const friend = L.record(vault, box);
        if (!friend || friend.status !== 'active' || !friend.sendToken) { L.clearDelivered(vault, key, pending.epoch, box); continue; }
        // 1. take back what is still waiting for them from this chat (best effort: an older relay answers 404 and that is fine)
        await call('POST', '/f/purge', { to: box, token: friend.sendToken, tag: await L.chatTag(C.sha256hex, friend.sendToken, key) });
        // 2. then the clear itself, so it can never be purged by the step above
        const r = await post(friend, L.clearBody(me.box, key, pending.epoch, pending.at));
        // 403: they removed us, so there is no one to tell. Anything else that is not 200 is tried again later.
        if (r.status === 200 || r.status === 403) L.clearDelivered(vault, key, pending.epoch, box);
        else if (r.status !== 0) st.lastProblem = explain(r.status, r.json);
      }
    }
  } finally { flushing = false; persist(); }
}

// ---- two-player games with a friend (kept in memory only: a game ends if either app quits) ----

const plays = new Map();      // friend box -> the Connect Four / Rock Paper Scissors / Battleship controller (games/twoplayer-logic.js)
const tttGames = new Map();   // friend box -> the tic-tac-toe game (games/tictactoe-logic.js)

/** The controller for one friend's game (made on first use). It talks over the same sealed friend link as messages. */
export function play(box) {
  let c = plays.get(box);
  if (c) return c;
  if (!me) return null;   // (the screen only asks once the identity is loaded)
  c = P.createPlayController({
    myID: me.box,
    name: (id) => (id === me.box ? 'You' : nameOfBox(id)),
    transport: (m) => {
      const f = L.record(vault, box);
      if (f?.status === 'active') post(f, L.playBody(me.box, m)).then((r) => { if (r.status === 403) { st.lastProblem = `${L.displayName(f)} removed you or hasn't accepted.`; emit(); } }).catch(() => {});
    },
    onEvent: (text) => { if (st.viewing !== box) tell('Game', text); },
    onInvite: ({ gid, title }) => { announceChallenge(box, gid, title); },
    onChange: () => emit(),
  });
  plays.set(box, c);
  return c;
}
/** A friend challenged me to a game: it shows in their chat like a message (unread count, newest in the list) and notifies the same way,
 *  with "X challenged you to <game>". Accepting is the card under the chat. Quiet while that chat is open and in view. */
async function announceChallenge(box, gid, title) {
  const m = L.receiveChallenge(vault, box, gid, title);
  if (!m) return;
  const f = L.record(vault, box);
  if (st.viewing === box && (await watching())) L.markRead(vault, box);
  else tell(L.displayName(f), `${L.challengeLine(L.displayName(f), title)}. Open the chat to accept.`);
  persist();
}
/** The friend's tic-tac-toe game state, or null. */
export const tttGame = (box) => tttGames.get(box) || null;

function applyTtt(msg, from, box) {
  if (L.record(vault, box)?.status !== 'active') return false;
  const before = tttGames.get(box) || null, next = TTT.reduce(before, msg, from);
  if (next === before) return false;
  tttGames.set(box, next);
  if (msg.op === 'invite' && from !== me.box) announceChallenge(box, next.gid, 'Tic-tac-toe');
  if (msg.op === 'accept' && next.status === 'invited' && next.inviter === me.box && next.accepted === from) sendTtt(TTT.startMsg(next, from), box);
  emit();
  return true;
}
/** Checks a message of mine against my own state first, so an illegal move is never sent, then applies and sends it. */
function sendTtt(msg, box) {
  const f = L.record(vault, box);
  if (!f || f.status !== 'active' || !applyTtt(msg, me.box, box)) return false;
  post(f, L.tttBody(me.box, msg)).catch(() => {});
  return true;
}
const tttOpen = (box) => { const g = tttGames.get(box); return !!g && !['won', 'draw', 'ended', 'cancelled'].includes(g.status); };
export const tttInvite = (box) => !tttOpen(box) && sendTtt(TTT.inviteMsg(TTT.newGameId(), crypto.getRandomValues(new Uint8Array(1))[0] % 2 ? 'X' : 'O'), box);
export const tttAccept = (box) => tttGames.get(box)?.status === 'invited' && sendTtt(TTT.acceptMsg(tttGames.get(box).gid), box);
export const tttCancel = (box) => tttGames.get(box)?.status === 'invited' && sendTtt(TTT.cancelMsg(tttGames.get(box).gid), box);
export const tttMove = (box, cell) => !!tttGames.get(box) && sendTtt(TTT.moveMsg(tttGames.get(box), cell), box);
export const tttRematch = (box) => !!tttGames.get(box) && sendTtt(TTT.rematchMsg(tttGames.get(box)), box);
export const tttQuit = (box) => !!tttGames.get(box) && sendTtt(TTT.quitMsg(tttGames.get(box).gid), box);
/** Closes a finished game's board (nothing is sent). */
export function tttClose(box) { if (tttGames.has(box) && !tttOpen(box)) { tttGames.delete(box); emit(); } }

/** Forgets every game with a friend (removed, blocked, or all data deleted). */
function dropGames(box) { plays.get(box)?.reset(); plays.delete(box); tttGames.delete(box); }

// ---- sending

/** `chat` (a friend's box or a group key) labels the message for the relay, so a later "Clear chat" can take back what is still queued. */
async function post(friend, body, live = false, chat = null) {
  if (!friend.sendToken) return { status: 0, json: {} };
  const blob = await sealTo('msg', body, friend.box, friend.dh);
  const tag = chat ? await L.chatTag(C.sha256hex, friend.sendToken, chat) : null;
  return call('POST', '/f/send', { to: friend.box, token: friend.sendToken, blob, ...(tag ? { tag } : {}), ...(live ? { live: true } : {}) });
}

export function send(text, box) {
  if (L.isGroupKey(box)) return sendToGroup(text, box);
  const t = String(text || '').trim();
  const friend = L.record(vault, box);
  if (!t || L.charCount(t) > L.MAX_TEXT || !friend || friend.status !== 'active') return;
  const id = uid().toUpperCase();
  L.addMine(vault, box, id, t); persist();
  deliver(id, t, friend);
}
export function retry(id, box) {
  if (L.isGroupKey(box)) {   // a group message that failed (a file is not retried, like the Mac)
    const g = L.group(vault, box), m = messages(box).find((x) => x.id === id && x.mine && x.state === 'failed');
    if (!g || !m || m.file || !L.retryState(vault, box, id)) return;
    persist(); deliverToGroup(id, m.text, g, reachable(g));
    return;
  }
  const m0 = messages(box).find((x) => x.id === id && x.mine && x.state === 'failed' && x.file);
  if (m0) {
    const f = L.record(vault, box);
    if (f && L.retryState(vault, box, id)) loadFileBytes(id).then((bytes) => { if (bytes) { persist(); deliverFile(id, m0.file.name, bytes, null, box, [f]); } else { L.setState(vault, box, id, 'failed'); persist(); } });
    return;
  }
  const friend = L.record(vault, box), m = messages(box).find((x) => x.id === id);
  if (!friend || !m || !L.retryState(vault, box, id)) return;
  persist(); deliver(id, m.text, friend);
}
async function deliver(id, text, friend) {
  // If the chat was cleared while this waited, the message is gone and must not be sent (it would come back to life on their side).
  const mine = messages(friend.box).find((m) => m.id === id);
  if (!mine) return;
  const r = await post(friend, { t: 'msg', from: me.box, id, text, ts: Date.now(), ce: mine.ce ?? L.epochOf(vault, friend.box) }, false, friend.box);
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
  post(friend, { t: 'rcpt', from: me.box, id, state, ts: Date.now() }, false, friend.box);
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
  if (L.isGroupKey(box)) { L.markGroupRead(vault, box); persist(); return; }   // no receipts in groups
  L.markRead(vault, box);
  const friend = L.record(vault, box);
  if (settings.receipts && friend) for (const m of messages(box).slice(-20)) if (!m.mine) sendReceipt(friend, m.id, 'read');
  persist();
}
export function setViewing(box) { st.viewing = box; if (box) markRead(box); else emit(); }
