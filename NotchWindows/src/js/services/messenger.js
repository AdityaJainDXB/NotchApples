// Messenger rooms, the same protocol as the Mac's WebP2PManager.swift, so Mac
// and Windows users can talk in the same room:
//
//  • The room code is normalised and hashed twice with SHA-256 (different labels):
//    one hash names the relay topic, the other is the AES-GCM key. The relay
//    never sees the room name and can't read messages.
//  • Messages go through ntfy.sh over TLS (`Cache: no`, so nothing is stored) and through Notch Apple's own relay
//    (server/room-relay, a Cloudflare Worker: wss://<worker>/<topic>/ws, frames `{"event":"message","message":"<base64 sealed>"}`,
//    at most 16 KB and 60 per second per connection, live only). Both are used at once and duplicates are dropped by ID, like
//    the Mac does. Only the own relay is big enough for files (ntfy takes about 4 KB), so sending a file needs it.
//  • Envelope: { v, kind, id, senderID, sender, text?, ts } as JSON, where ts is
//    Swift's default Date encoding (seconds since 1 Jan 2001), sealed with
//    AES-GCM and sent as base64 of nonce(12) | ciphertext | tag(16).
//  • Everyone announces themselves every 30 s, which builds the "online" list.
//  • Tic-tac-toe rides on the same envelope: an optional `game` object (rules in games/tictactoe-logic.js). The invite is a normal
//    'message' with a plain-text line, so older apps show it as text; every other game message has kind 'game', which older
//    apps (Mac and Windows) skip without touching anything else.
//  • Files (Mac 2.2.8): a file of 8,000 bytes or less is a normal 'message' with `fileData` (base64) and `fileName`; a bigger one (up to
//    2,000,000 bytes) is numbered pieces in envelopes of kind 'chunk' (`fid`, `fi`, `fn`, `fileData`, `fileName`), put back together by
//    services/roomfileslogic.js.
//  • Connect Four, Rock Paper Scissors, Battleship, Chess and Checkers use an optional `play` object (rules in games/twoplayer-logic.js). Their
//    invite is a normal 'message' with a plain-text line and `play`; every other move has kind 'play', which older apps skip.

import { load, save, uid } from '../store.js';
import { http, notify, invoke } from '../native.js';
import { provide, refresh } from '../activity.js';
import * as G from '../games/tictactoe-logic.js';
import * as P from '../games/twoplayer-logic.js';
import * as RF from './roomfileslogic.js';

const RELAY = 'ntfy.sh';
const OWN_RELAY = 'notchapple-rooms.adityajain1225.workers.dev';
const SWIFT_EPOCH = 978307200; // 2001-01-01 in Unix seconds

const listeners = new Set();
const st = { state: 'idle', room: null, error: null, members: new Map(), messages: [], unread: 0, game: null };
let key = null, topic = null, presenceTimer = null, generation = 0;
/** One live connection per relay: { ws, joined, retry, timer }. The room is "joined" while at least one is. */
const links = { ntfy: null, own: null };
const seen = new Set();
const files = new Map();            // message id -> the bytes of a file in the chat (kept only while the room is open)
let assembly = RF.createAssembly(); // files arriving in pieces
const stallTimers = new Set();      // one per file being received: says so if it never completes
const playNames = {};   // sender ID -> handle, for naming players in the games (a player who has gone quiet is no longer a member)

/** Connect Four, Rock Paper Scissors, Battleship, Chess and Checkers in this room (rules and automatic answers: games/twoplayer-logic.js). */
export const play = P.createPlayController({
  myID: () => identity().senderID,
  transport: (m) => {
    if (st.state !== 'joined') return;
    if (m.op === 'invite') publish('message', `🎮 ${P.TITLES[m.g] || 'Game'} invite (update Notch Apple to play)`, undefined, m);
    else publish('play', undefined, undefined, m);
  },
  onEvent: (text) => { notice(text); },
  onChange: () => emit(),
});
play.name = (id) => nameOf(id);

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

async function seal(obj, k = key) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, k, new TextEncoder().encode(JSON.stringify(obj))));
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
  st.messages = []; st.members = new Map(); st.error = null; st.unread = 0; st.game = null; play.reset(); clearFiles();
  const mine = ++generation;
  const k = await crypto.subtle.importKey('raw', await sha(`notchapple-room-key|${room}`), 'AES-GCM', false, ['encrypt', 'decrypt']);
  const t = `notchapple-v1-${hex(await sha(`notchapple-room-topic|${room}`)).slice(0, 40)}`;
  if (mine !== generation) return;   // another join or a leave came in while the keys were made
  key = k; topic = t;
  save('messenger.room', room);
  connect('own'); connect('ntfy');
}

export function leave(keepRoom = false) {
  const goodbye = st.state === 'joined' ? farewell() : null;
  if (!keepRoom) save('messenger.room', null);
  generation++;
  clearInterval(presenceTimer); presenceTimer = null;
  for (const name of Object.keys(links)) closeLink(name, name === 'own' && !!goodbye);   // (the own relay's socket closes once the goodbye is sent)
  st.state = 'idle'; st.members = new Map(); st.game = null; play.reset(); clearFiles();
  if (!keepRoom) { st.room = null; st.messages = []; }
  emit();
}

function clearFiles() { files.clear(); assembly.reset(); for (const t of stallTimers) clearTimeout(t); stallTimers.clear(); }

function closeLink(name, keepOpen = false) {
  const l = links[name];
  links[name] = null;
  if (!l) return;
  clearTimeout(l.timer);
  if (l.ws) { l.ws.onclose = null; l.ws.onmessage = null; l.ws.onerror = null; if (!keepOpen) { try { l.ws.close(); } catch { /* already closed */ } } }
}

/** Tells the room we are leaving, on the sockets and topic that are open now (leave() is about to close them and change the room). */
async function farewell() {
  const ws = links.own?.ws, t = topic, k = key, me = identity();
  try {
    if (!k || !t) return;
    const env = { v: 1, kind: 'leave', id: uid().toUpperCase(), senderID: me.senderID, sender: me.handle, ts: Date.now() / 1000 - SWIFT_EPOCH };
    const sealed = await seal(env, k);
    if (ws?.readyState === 1) { try { ws.send(JSON.stringify({ event: 'message', message: sealed })); } catch { /* gone already */ } }
    await http(`https://${RELAY}/${t}`, { method: 'POST', body: sealed, headers: { Cache: 'no', Firebase: 'no' }, timeout: 8000 });
  } catch { /* leaving must never fail */ } finally { try { ws?.close(); } catch { /* already closed */ } }
}

const anyJoined = () => Object.values(links).some((l) => l?.joined);
const wsUrl = (name) => `wss://${name === 'own' ? OWN_RELAY : RELAY}/${topic}/ws`;

/** Opens (or reopens) the connection to one relay. They fail and recover on their own; the room works while either is up. */
function connect(name) {
  if (!topic) return;
  const mine = generation, prev = links[name], link = { ws: null, joined: false, retry: prev?.retry || 0, timer: null };
  links[name] = link;
  if (!anyJoined()) { st.state = 'connecting'; emit(); }
  let ws;
  try { ws = new WebSocket(wsUrl(name)); } catch { ws = null; }
  link.ws = ws;
  const lost = () => {
    if (links[name] !== link || mine !== generation) return;
    link.joined = false; link.ws = null;
    if (!st.room) return;
    if (!anyJoined()) { st.state = 'connecting'; emit(); }
    // Reconnect with a growing delay (2 s … 60 s).
    link.timer = setTimeout(() => { if (links[name] === link && mine === generation) connect(name); }, Math.min(60_000, 2000 * 2 ** link.retry++));
  };
  if (!ws) { lost(); return; }
  ws.onmessage = async (e) => {
    if (links[name] !== link) return;
    let ev; try { ev = JSON.parse(e.data); } catch { return; }
    if (ev.event === 'open') {
      link.joined = true; link.retry = 0;
      if (name === 'ntfy') st.error = null;
      const first = st.state !== 'joined';
      st.state = 'joined'; emit();
      publish('presence');                     // let people on this relay see us right away
      if (first) { clearInterval(presenceTimer); presenceTimer = setInterval(tick, 30_000); }
    } else if (ev.event === 'message' && ev.message) {
      const env = await open(ev.message);
      if (env && links[name] === link) receive(env);
    }
  };
  ws.onerror = () => { if (name === 'ntfy' && !links.own?.joined) st.error = "Couldn't reach the relay. Check your connection."; };
  ws.onclose = lost;
}

function tick() {
  publish('presence'); prune();
  const own = links.own;
  if (own?.joined && own.ws?.readyState === 1) { try { own.ws.send('ping'); } catch { /* the close handler reconnects */ } }
  for (const name of assembly.expire()) notice(`"${name}" didn't arrive completely, so it was dropped. Ask them to send it again.`);
}

function prune() {
  const now = Date.now();
  for (const [id, m] of st.members) if (now - m.lastSeen > 75_000) { st.members.delete(id); playerGone(id, m.handle); play.playerGone(id); }
  emit();
}

/** Seals one envelope and sends it on every relay we are connected to. `file` ({ data: base64, name, piece?: { fid, i, n } }) makes it a
 *  file message, which only the own relay can carry (ntfy takes about 4 KB). Resolves to the envelope, or null when nothing was sent. */
async function publish(kind, text, game, playMsg, file) {
  if (!key || !topic) return null;
  const me = identity();
  const env = { v: 1, kind, id: uid().toUpperCase(), senderID: me.senderID, sender: me.handle, ts: Date.now() / 1000 - SWIFT_EPOCH };
  if (text) env.text = text;
  if (game) env.game = game;
  if (playMsg) env.play = playMsg;
  if (file) {
    env.fileData = file.data; env.fileName = file.name;
    if (file.piece) { env.fid = file.piece.fid; env.fi = file.piece.i; env.fn = file.piece.n; }
  }
  const mine = generation;
  const sealed = await seal(env);
  if (mine !== generation) return null;   // the room was left while sealing
  const own = links.own;
  const viaOwn = !!(own?.joined && own.ws?.readyState === 1);
  if (viaOwn) { try { own.ws.send(JSON.stringify({ event: 'message', message: sealed })); } catch { /* the close handler reconnects */ } }
  if (file) return viaOwn ? env : null;
  // ntfy too, as before (it is the way in for people whose network blocks the own relay); with both up it is a backup, and the
  // receivers drop the copy by ID.
  if (!viaOwn || links.ntfy?.joined) {
    try {
      await http(`https://${RELAY}/${topic}`, { method: 'POST', body: sealed, headers: { Cache: 'no', Firebase: 'no' }, timeout: 15000 });
    } catch (e) { if (!viaOwn) { st.error = e.message; emit(); } }
  }
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

/** Puts a file into the chat (kept in memory while the room is open). */
const KEEP_FILES = 12;   // the newest files stay in memory (up to 2 MB each); older ones stay in the chat as "no longer available"
function addFile(id, sender, name, data, at, mine) {
  files.set(id, data);
  while (files.size > KEEP_FILES) files.delete(files.keys().next().value);
  st.messages.push({ id, sender, text: '', file: { name, size: data.length }, at, mine });
}

async function seeIfUnread(name, text) {
  const { isExpanded, activeTab } = await import('../app.js');
  if (!(isExpanded() && activeTab() === 'messenger')) {
    st.unread++;
    if (load('messenger.notify', true)) notify(`${name} · #${st.room}`, text);
  }
}

async function receive(env) {
  if (!env || typeof env !== 'object' || typeof env.id !== 'string' || typeof env.senderID !== 'string' || typeof env.ts !== 'number') return;
  const at = (env.ts + SWIFT_EPOCH) * 1000;
  if (Math.abs(Date.now() - at) > 600_000) return; // stale or replayed
  const me = identity();
  const isMe = env.senderID === me.senderID;
  const name = String(env.sender || '?').slice(0, 32);
  // The same envelope can arrive once per relay: handle it once. (Our own are applied when we send them.)
  if (!isMe) {
    if (seen.has(env.id)) return;
    seen.add(env.id);
    if (seen.size > 5000) for (const old of [...seen].slice(0, 2500)) seen.delete(old);
  }
  if (env.kind === 'presence') {
    if (!isMe) {
      if (!st.members.has(env.senderID)) { notice(`${name} joined`); publish('presence'); }
      st.members.set(env.senderID, { handle: name, lastSeen: Date.now() });
    }
  } else if (env.kind === 'leave') {
    const m = st.members.get(env.senderID);
    if (m) { st.members.delete(env.senderID); notice(`${m.handle} left`); playerGone(env.senderID, m.handle); play.playerGone(env.senderID); }
  } else if ((env.kind === 'play' || env.kind === 'message') && env.play && typeof env.play === 'object') {
    // Connect Four, Rock Paper Scissors, Battleship, Chess, Checkers.
    if (!isMe) {
      playNames[env.senderID] = name;
      if (play.receive(env.play, env.senderID) && env.play.op === 'invite') await seeIfUnread(name, `invited the room to play ${P.TITLES[env.play.g] || 'a game'}`);
    }
  } else if ((env.kind === 'game' || env.kind === 'message') && env.game && typeof env.game === 'object') {
    // Tic-tac-toe.
    if (!isMe && applyGame(env.game, env.senderID, name) && env.game.op === 'invite') await seeIfUnread(name, 'invited the room to play tic-tac-toe');
  } else if (env.kind === 'chunk') {
    if (!isMe) await receivePiece(env, name, at);
  } else if (env.kind === 'message' && !isMe && (env.text || env.fileData)) {
    if (!st.members.has(env.senderID)) notice(`${name} joined`);
    st.members.set(env.senderID, { handle: name, lastSeen: Date.now() });
    if (env.text) {
      st.messages.push({ id: env.id, sender: name, text: String(env.text).slice(0, 2000), at, mine: false });
      await seeIfUnread(name, String(env.text).slice(0, 200));
    }
    if (env.fileData) {
      // A file of one piece (8,000 bytes or less on the Mac; anything the relay's 16 KB frame allows).
      const data = RF.fromBase64(env.fileData), fileName = RF.cleanName(env.fileName) || 'file';
      if (data && data.length > 0 && data.length <= 12_000) {
        addFile(env.text ? uid() : env.id, name, fileName, data, at, false);
        await seeIfUnread(name, `sent a file: ${fileName}`);
      }
    }
  }
  if (st.messages.length > 500) for (const m of st.messages.splice(0, st.messages.length - 500)) files.delete(m.id);
  emit();
}

/** One piece of a big file (kind 'chunk'), the way the Mac's WebP2PManager handles it. */
async function receivePiece(env, name, at) {
  const n = env.fn, i = env.fi, fid = env.fid, fileName = RF.cleanName(env.fileName);
  const bytes = typeof env.fileData === 'string' ? RF.fromBase64(env.fileData) : null;
  if (typeof fid !== 'string' || !fid || fid.length > 100 || !bytes || !fileName) return;
  for (const dropped of assembly.expire()) notice(`"${dropped}" didn't arrive completely, so it was dropped. Ask them to send it again.`);
  const partKey = `${env.senderID}|${fid}`, startedWaiting = !assembly.parts.has(partKey);
  const whole = assembly.add(partKey, fileName, n, i, bytes);
  if (whole) {
    st.members.set(env.senderID, { handle: name, lastSeen: Date.now() });
    addFile(uid(), name, whole.name, whole.data, at, false);
    await seeIfUnread(name, `sent a file: ${whole.name}`);
  } else if (startedWaiting && assembly.parts.has(partKey)) {
    // Say once that a file is on its way, and drop it with a notice if it stalls.
    notice(`${name} is sending "${fileName}" (${Math.round((n * RF.CHUNK_SIZE) / 1000)} KB at most)…`);
    const timer = setTimeout(() => {
      stallTimers.delete(timer);
      for (const dropped of assembly.expire()) notice(`"${dropped}" didn't arrive completely, so it was dropped. Ask them to send it again.`);
      emit();
    }, RF.PATIENCE_MS + 5000);
    stallTimers.add(timer);
  }
}

// ---- sending and opening files ----

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** True when this room can carry a file right now: it needs Notch Apple's own relay (ntfy takes about 4 KB per message). */
export const canSendFiles = () => st.state === 'joined' && !!links.own?.joined;

/** Sends a file (a path from the file picker) to the room. Returns a message when it can't (too big, unreadable, no relay). */
export async function sendFile(path) {
  if (st.state !== 'joined') return 'Join a room first.';
  if (!canSendFiles()) return "Files need Notch Apple's own relay, which isn't connected right now (some networks block it). Text and games still work. Try again in a moment.";
  let read;
  try { read = await invoke('read_file_base64', { path }); } catch (e) { return typeof e === 'string' && /larger than|folder/.test(e) ? `Rooms can carry files up to ${RF.MAX_BYTES / 1_000_000} MB.` : "Couldn't read that file."; }
  const data = Uint8Array.from(atob(read.data), (c) => c.charCodeAt(0));
  if (!data.length) return "Couldn't read that file.";
  if (data.length > RF.MAX_BYTES) return `That file is ${(data.length / 1_000_000).toFixed(1)} MB. Rooms can carry files up to ${RF.MAX_BYTES / 1_000_000} MB.`;
  const name = RF.cleanName(read.name) || 'file', me = identity(), mine = generation, id = uid().toUpperCase();
  addFile(id, me.handle, name, data, Date.now(), true);
  const msg = st.messages[st.messages.length - 1];
  const pieces = RF.split(data);
  msg.progress = 0; emit();
  const fid = uid().toUpperCase();
  for (let i = 0; i < pieces.length; i++) {
    if (mine !== generation || !canSendFiles()) { msg.progress = undefined; msg.failed = true; if (mine === generation) { notice(`Sending "${name}" stopped: the connection to the relay was lost. Send it again.`); emit(); } return null; }
    const piece = { data: RF.toBase64(pieces[i]), name };
    const sent = pieces.length === 1 ? await publish('message', undefined, undefined, undefined, piece) : await publish('chunk', undefined, undefined, undefined, { ...piece, piece: { fid, i, n: pieces.length } });
    if (!sent) { msg.progress = undefined; msg.failed = true; notice(`Sending "${name}" failed. Send it again.`); emit(); return null; }
    seen.add(sent.id);
    msg.progress = (i + 1) / pieces.length;
    if (pieces.length > 1) { if (i % 10 === 9 || i === pieces.length - 1) emit(); await sleep(RF.PIECE_GAP_MS); }
  }
  msg.progress = undefined; emit();
  return null;
}

/** Writes a file from the chat to a fresh temp folder and shows it in Explorer. It is never opened for you. */
export async function revealFile(id) {
  const data = files.get(id), m = st.messages.find((x) => x.id === id);
  const safe = RF.cleanName(m?.file?.name);
  if (!data || !safe) return "That file isn't available any more.";
  try {
    const path = await invoke('friends_stage_file', { name: safe, base64: RF.toBase64(data) });
    await invoke('reveal_path', { path });
    return null;
  } catch (e) { return String(e); }
}

export const markRead = () => { st.unread = 0; emit(); };

// ---- tic-tac-toe (rules in games/tictactoe-logic.js; both sides run the same reduce) ----

export const nameOf = (id) => (id === identity().senderID ? 'You' : st.members.get(id)?.handle || st.game?.names?.[id] || playNames[id] || 'Someone');

/// Applies a game message from `from`. Returns true when it changed the game. The inviter answers the first accept with 'start'.
function applyGame(msg, from, name) {
  const before = st.game, next = G.reduce(before, msg, from);
  if (next === before) return false;
  const names = { ...(before && before.gid === next.gid ? before.names : null), ...(name ? { [from]: name } : null) };
  st.game = { ...next, names };
  const me = identity().senderID;
  if (msg.op === 'invite') notice(`${name || nameOf(from)} invited the room to play tic-tac-toe`);
  if (msg.op === 'accept' && next.status === 'invited' && next.inviter === me && next.accepted === from) sendGame(G.startMsg(next, from));
  if (before && before.status !== next.status && (next.status === 'won' || next.status === 'draw' || next.status === 'ended')) {
    notice(next.status === 'draw' ? 'Tic-tac-toe: a draw'
      : next.status === 'won' ? `Tic-tac-toe: ${nameOf(next.winner === 'X' ? next.x : next.o)} won`
        : `Tic-tac-toe ended: ${nameOf(next.leaver)} left the game`);
  }
  emit();
  return true;
}

/// A player left the room (or went quiet): their game is over. The rules ignore this for anyone who is not playing.
function playerGone(id, name) { if (st.game) applyGame(G.quitMsg(st.game.gid), id, name); }

/// Checks a message of ours against our own state first, so an illegal move is never sent, then applies and sends it.
function sendGame(msg) {
  if (st.state !== 'joined') return false;
  if (!applyGame(msg, identity().senderID, identity().handle)) return false;
  if (msg.op === 'invite') publish('message', '🎮 Tic-tac-toe invite (update Notch Apple to play)', msg);
  else publish('game', undefined, msg);
  return true;
}

export const gameInvite = () => sendGame(G.inviteMsg(G.newGameId(), crypto.getRandomValues(new Uint8Array(1))[0] % 2 ? 'X' : 'O'));
export const gameAccept = () => st.game?.status === 'invited' && sendGame(G.acceptMsg(st.game.gid));
export const gameCancel = () => st.game?.status === 'invited' && sendGame(G.cancelMsg(st.game.gid));
export const gameMove = (cell) => !!st.game && sendGame(G.moveMsg(st.game, cell));
export const gameRematch = () => !!st.game && sendGame(G.rematchMsg(st.game));
export const gameQuit = () => !!st.game && sendGame(G.quitMsg(st.game.gid));
/// Closes a finished game's board (nothing is sent).
export function gameClose() { if (st.game && ['won', 'draw', 'ended', 'cancelled'].includes(st.game.status)) { st.game = null; emit(); } }

export function start() {
  // Rejoin the room you were in.
  const room = load('messenger.room', null);
  if (room) join(room);
  provide('messenger', 45, () => (st.unread ? { icon: '💬', label: `${st.unread} new`, tab: 'messenger', title: `#${st.room}` } : null));
}
