// Messenger → Friends, the rules with no screen, no network and no imports (so Node tests load this file as it is).
// A port of FriendsBook / Friends.parse / FriendsBook.clean in NotchApple/Modules/Messenger/Friends/FriendsLogic.swift.
// The vault is plain JSON: { friends, messages, blocked, seen }. Keys are base64url strings; `fp` is a friend's key fingerprint
// as hex (the caller computes it with friendscrypto.js, because hashing is async and these rules are not).
// Dates are milliseconds since 1970.

export const CODE_ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
export const CODE_LENGTH = 10;
export const MAX_TEXT = 2000;
const SEEN_LIMIT = 500;
/** Files: 8 KB chunks (a sealed message is limited to about 16 KB by the relay), at most 20 of them. Same numbers as the Mac. */
export const CHUNK_SIZE = 8000;
export const MAX_CHUNKS = 20;
export const MAX_FILE_BYTES = CHUNK_SIZE * MAX_CHUNKS;
export const MAX_GROUP_MEMBERS = 20;
export const MAX_GROUPS = 30;
export const PARTIAL_TTL_MS = 10 * 60 * 1000;
export const MAX_PARTIALS = 8;

// ---- small helpers (kept local so this file has no imports)

const unb64uBytes = (s) => { try { const t = String(s).replace(/-/g, '+').replace(/_/g, '/'); return Uint8Array.from(atob(t + '==='.slice((t.length + 3) % 4)), (c) => c.charCodeAt(0)); } catch { return null; } };
const sameKey = (a, b) => { const x = unb64uBytes(a), y = unb64uBytes(b); return !!x && !!y && x.length === y.length && x.every((v, i) => v === y[i]); };
const goodKey = (s) => { const x = typeof s === 'string' ? unb64uBytes(s) : null; return !!x && x.length === 32; };
const graphemes = (s) => (typeof Intl !== 'undefined' && Intl.Segmenter ? [...new Intl.Segmenter().segment(s)].map((x) => x.segment) : [...s]);
/** Characters as a person counts them (Swift's String.count does the same), so Mac and Windows agree on the 2000 limit. */
export const charCount = (s) => graphemes(String(s)).length;

// ---- codes and links

/** What someone typed, as the canonical code, or null. Case, spaces and dashes don't matter; O reads as 0, I and L as 1. */
export function normalizeCode(typed) {
  const s = String(typed || '').toUpperCase().replace(/[\s\-–—]/g, '').replace(/O/g, '0').replace(/[IL]/g, '1');
  return s.length === CODE_LENGTH && [...s].every((c) => CODE_ALPHABET.includes(c)) ? s : null;
}
export const displayCode = (code) => `${code.slice(0, 5)}-${code.slice(5)}`;
/** notchapple://friend?c=CODE&k=<fingerprint b64url>: the fingerprint lets the app check the keys the server returns. */
export const friendLink = (code, fingerprintB64u) => `notchapple://friend?c=${code}&k=${fingerprintB64u}`;
/** A typed code, or a link made by friendLink, as { code, fingerprint (b64url or null) }, or null. */
export function parseFriend(text) {
  const t = String(text || '').trim();
  const m = /^notchapple:\/\/friend\/?\?(.*)$/i.exec(t);
  if (m) {
    const q = new URLSearchParams(m[1]);
    const code = normalizeCode(q.get('c'));
    if (code) { const k = q.get('k'); return { code, fingerprint: k && unb64uBytes(k) ? k : null }; }
    return null;
  }
  const code = normalizeCode(t);
  return code ? { code, fingerprint: null } : null;
}

/** Names are shown to the person who received them, so keep them short, single-line and free of control characters. */
export function clean(raw) {
  if (raw === null || raw === undefined) return null;
  const s = String(raw).replace(/[\p{Default_Ignorable_Code_Point}\p{Cc}]/gu, '').replace(/^[ \t  - 　]+|[ \t  - 　]+$/g, '');
  return s ? graphemes(s).slice(0, 32).join('') : null;
}

// ---- the data model

export const newVault = () => ({ friends: [], messages: {}, blocked: [], seen: [], groups: [] });
/** A vault read back from disk, with anything missing filled in. */
export function normalizeVault(raw) {
  const v = newVault();
  if (!raw || typeof raw !== 'object') return v;
  if (Array.isArray(raw.friends)) v.friends = raw.friends.filter((f) => f && typeof f.box === 'string');
  if (raw.messages && typeof raw.messages === 'object') v.messages = raw.messages;
  if (Array.isArray(raw.blocked)) v.blocked = raw.blocked.filter((x) => typeof x === 'string');
  if (Array.isArray(raw.seen)) v.seen = raw.seen.filter((x) => typeof x === 'string');
  // A vault saved before groups existed has no `groups`: that must load as "no groups", never wipe the friends.
  if (Array.isArray(raw.groups)) v.groups = raw.groups.filter((g) => g && typeof g.id === 'string' && Array.isArray(g.members));
  return v;
}

export const index = (v, box) => v.friends.findIndex((f) => f.box === box);
export const record = (v, box) => v.friends.find((f) => f.box === box) || null;

// ---- two-player games in a friend chat (docs/FRIENDS_PROTOCOL.md, "Two-player games"; rules in games/) ----
/** The body carrying a Connect Four / Rock Paper Scissors / Battleship message. Older apps ignore the unknown `t`. */
export const playBody = (myBox, play, now = Date.now()) => ({ t: 'play', from: myBox, ts: now, play });
/** The body carrying a tic-tac-toe message (the Mac sends `t:"game"` with a `ttt` object). */
export const tttBody = (myBox, ttt, now = Date.now()) => ({ t: 'game', from: myBox, ts: now, ttt });
export const isBlocked = (v, fp) => v.blocked.includes(fp);
export const incoming = (v) => v.friends.filter((f) => f.status === 'incoming').sort((a, b) => a.added - b.added);
export const pending = (v) => v.friends.filter((f) => f.status === 'outgoing').sort((a, b) => a.added - b.added);
export const active = (v) => v.friends.filter((f) => f.status === 'active').sort((a, b) => b.lastActivity - a.lastActivity);
export const messagesOf = (v, box) => v.messages[box] || [];
/** The number on the badge: unread messages plus requests waiting for an answer. */
export const totalUnread = (v) => v.friends.reduce((n, f) => n + (f.unread || 0), 0) + (v.groups || []).reduce((n, g) => n + (g.unread || 0), 0) + incoming(v).length;
export function displayName(f) {
  if (f.alias) return f.alias;
  if (f.nick) return f.nick;
  return `Friend ${String(f.fp || '').slice(0, 4).toUpperCase()}`;
}

// ---- the rules

/** A request I sent: pending until they accept. */
export function addOutgoing(v, { box, sign, dh, fp, alias = null, myTokenHash, now = Date.now() }) {
  const i = index(v, box);
  if (i >= 0) { v.friends[i].myTokenHash = myTokenHash; return; }
  v.friends.push({ box, sign, dh, fp, nick: null, alias: clean(alias), status: 'outgoing', sendToken: null, myTokenHash, pendingToken: null, added: now, unread: 0, lastActivity: now });
}

/**
 * A request from someone else (already checked: signature good). `fp` is the fingerprint (hex) of the keys in the request.
 * Returns { kind: 'ignored' } | { kind: 'added', record } | { kind: 'mutual', record }.
 */
export function receiveRequest(v, body, fp, now = Date.now()) {
  const ignored = { kind: 'ignored' };
  if (!body || typeof body.box !== 'string' || !body.box || typeof body.token !== 'string' || !goodKey(body.sign) || !goodKey(body.dh)) return ignored;
  if (isBlocked(v, fp)) return ignored;
  const i = index(v, body.box);
  if (i >= 0) {
    const f = v.friends[i];
    if (!sameKey(f.sign, body.sign) || !sameKey(f.dh, body.dh)) return ignored;   // same address, different keys: never accepted silently
    if (f.status === 'outgoing') {                                                  // we asked each other: that is agreement from both sides
      Object.assign(f, { status: 'active', sendToken: body.token, nick: clean(body.nick), lastActivity: now });
      return { kind: 'mutual', record: f };
    }
    return ignored;
  }
  const r = { box: body.box, sign: body.sign, dh: body.dh, fp, nick: clean(body.nick), alias: null, status: 'incoming', sendToken: null, myTokenHash: null, pendingToken: body.token, added: now, unread: 0, lastActivity: now };
  v.friends.push(r);
  return { kind: 'added', record: r };
}

/** I press Accept: they get a token for my mailbox; I get to use the one they sent. */
export function accept(v, box, myTokenHash, now = Date.now()) {
  const f = record(v, box);
  if (!f || f.status !== 'incoming' || !f.pendingToken) return null;
  Object.assign(f, { status: 'active', sendToken: f.pendingToken, pendingToken: null, myTokenHash, lastActivity: now });
  return f;
}

/** They accepted my request (the body is already checked against the keys I pinned when I added them). */
export function receiveAcceptance(v, body, now = Date.now()) {
  const f = body && typeof body.box === 'string' ? record(v, body.box) : null;
  if (!f || f.status !== 'outgoing' || typeof body.token !== 'string' || !sameKey(f.sign, body.sign) || !sameKey(f.dh, body.dh)) return null;
  Object.assign(f, { status: 'active', sendToken: body.token, nick: clean(body.nick) || f.nick, lastActivity: now });
  return f;
}

/** A message from an active friend. Returns it if new, else null. */
export function receiveMessage(v, from, id, text, ts, now = Date.now()) {
  const f = record(v, from);
  if (!f || f.status !== 'active' || typeof id !== 'string' || !id || charCount(id) > 64 || typeof text !== 'string' || !text || charCount(text) > MAX_TEXT) return null;
  if (v.seen.includes(id)) return null;
  v.seen.push(id);
  if (v.seen.length > SEEN_LIMIT) v.seen.splice(0, v.seen.length - SEEN_LIMIT);
  const date = Number.isFinite(ts) ? Math.min(ts, now) : now;
  const m = { id, mine: false, text, date, state: 'delivered' };
  (v.messages[from] ||= []).push(m);
  f.unread = (f.unread || 0) + 1; f.lastActivity = now;
  return m;
}

export function addMine(v, box, id, text, now = Date.now()) {
  (v.messages[box] ||= []).push({ id, mine: true, text, date: now, state: 'sending' });
  const f = record(v, box);
  if (f) f.lastActivity = now;
}

const RANK = { failed: 0, sending: 0, sent: 1, delivered: 2, read: 3 };
/** Moves one of my messages forward (sending → sent → delivered → read); it never goes backwards, except to failed from sending. */
export function setState(v, box, id, state) {
  const m = (v.messages[box] || []).find((x) => x.id === id && x.mine);
  if (!m) return false;
  if (state === 'failed' ? m.state === 'sending' : RANK[state] > RANK[m.state]) { m.state = state; return true; }
  return false;
}
/** Failed → sending again, for "tap to retry". */
export function retryState(v, box, id) {
  const m = (v.messages[box] || []).find((x) => x.id === id && x.mine && x.state === 'failed');
  if (m) m.state = 'sending';
  return !!m;
}

export function markRead(v, box) { const f = record(v, box); if (f) f.unread = 0; }
export function setAlias(v, box, alias) { const f = record(v, box); if (f) f.alias = clean(alias); }

/** Blocks someone: they leave the list, their fingerprint is remembered, and their conversation is deleted. */
export function block(v, box) {
  const i = index(v, box);
  if (i < 0) return;
  const fp = v.friends[i].fp;
  if (fp && !v.blocked.includes(fp)) v.blocked.push(fp);
  v.friends.splice(i, 1); delete v.messages[box];
}
export function remove(v, box) { v.friends = v.friends.filter((f) => f.box !== box); delete v.messages[box]; }
export function unblockAll(v) { v.blocked = []; }

// ---- files and groups (the Mac's "Files and groups" in FriendsLogic.swift; wire format in docs/FRIENDS_PROTOCOL.md)

/** Group chats live in the same message table as friends, under a key no mailbox can have (mailboxes are hex). */
export const groupKey = (id) => `g:${id}`;
export const isGroupKey = (key) => typeof key === 'string' && key.startsWith('g:');
/** Ids come from other people, so only plain ones are accepted (they also become part of a stored file's name). */
export const isPlainID = (id) => typeof id === 'string' && id.length > 0 && id.length <= 64 && /^[0-9A-Za-z-]+$/.test(id);

/** A file's name comes from the sender: one line, no folders, no control characters, 80 characters at most. */
export function cleanFileName(raw) {
  if (typeof raw !== 'string') return null;
  const last = raw.split(/[/\\]/).filter(Boolean).pop() || '';
  const s = last.replace(/[\p{Default_Ignorable_Code_Point}\p{Cc}]/gu, '').replace(/^[ \t   -   　]+|[ \t   -   　]+$/g, '');
  if (!s || s === '.' || s === '..') return null;
  return graphemes(s).slice(0, 80).join('');
}

export const group = (v, key) => (v.groups || []).find((g) => g.key === key || groupKey(g.id) === key) || null;
const groupIndex = (v, key) => (v.groups || []).findIndex((g) => groupKey(g.id) === key);
/** Groups, newest activity first. */
export const groupsSorted = (v) => [...(v.groups || [])].sort((a, b) => b.lastActivity - a.lastActivity);
/** Members of a group that I can't reach (not my active friends), who won't get what I send and whose messages I won't see. */
export const unreachable = (v, g) => g.members.filter((b) => record(v, b)?.status !== 'active').length;

const remember = (v, id) => { v.seen.push(id); if (v.seen.length > SEEN_LIMIT) v.seen.splice(0, v.seen.length - SEEN_LIMIT); };
const wireDate = (ts, now) => (Number.isFinite(ts) ? Math.min(ts, now) : now);

/** I make a group out of friends I already have. Returns it, or null if that isn't allowed. */
export function createGroup(v, name, members, id = globalThis.crypto.randomUUID().toUpperCase(), now = Date.now()) {
  v.groups ||= [];
  const people = [...new Set(members)].filter((b) => record(v, b)?.status === 'active');
  if (!people.length || people.length >= MAX_GROUP_MEMBERS || v.groups.length >= MAX_GROUPS || !isPlainID(id)) return null;
  const g = { id, name: clean(String(name || '').replace(/\n/g, ' ')) || 'Group', members: people.sort(), creator: null, unread: 0, lastActivity: now };
  v.groups.push(g);
  return g;
}

/** An invite or a change from a friend. It must list me, and only the person who made the group can change it. */
export function receiveGroup(v, from, body, myBox, now = Date.now()) {
  v.groups ||= [];
  const all = body && Array.isArray(body.gm) ? body.gm : null;
  if (record(v, from)?.status !== 'active' || !body || !isPlainID(body.g) || !all || all.length > MAX_GROUP_MEMBERS
    || !all.every((b) => typeof b === 'string' && b.length > 0 && b.length <= 64) || !all.includes(myBox) || !all.includes(from)) return null;
  const others = [...new Set(all)].filter((b) => b !== myBox).sort();
  const name = clean(body.gname) || 'Group';
  const i = groupIndex(v, groupKey(body.g));
  if (i >= 0) {
    if (v.groups[i].creator !== from) return null;
    v.groups[i].name = name; v.groups[i].members = others;
    return v.groups[i];
  }
  if (v.groups.length >= MAX_GROUPS) return null;
  const g = { id: body.g, name, members: others, creator: from, unread: 0, lastActivity: now };
  v.groups.push(g);
  return g;
}

/** A message in a group, from a member who is one of my friends. Returns it if new. No receipts for these. */
export function receiveGroupMessage(v, from, gid, id, text, ts, now = Date.now()) {
  const key = groupKey(gid), gi = groupIndex(v, key);
  if (gi < 0 || !v.groups[gi].members.includes(from) || record(v, from)?.status !== 'active'
    || !isPlainID(id) || typeof text !== 'string' || !text || charCount(text) > MAX_TEXT || v.seen.includes(id)) return null;
  remember(v, id);
  const m = { id, mine: false, text, date: wireDate(ts, now), state: 'delivered', by: from };
  (v.messages[key] ||= []).push(m);
  v.groups[gi].unread = (v.groups[gi].unread || 0) + 1; v.groups[gi].lastActivity = now;
  return m;
}

/** A finished file, from a friend (one to one, or `gid` if it came into a group). */
export function receiveFile(v, from, gid, id, name, size, now = Date.now()) {
  const f = record(v, from), clean_ = cleanFileName(name);
  if (!f || f.status !== 'active' || !isPlainID(id) || !Number.isInteger(size) || size <= 0 || size > MAX_FILE_BYTES || !clean_ || v.seen.includes(id)) return null;
  const m = { id, mine: false, text: '', date: now, state: 'delivered', file: { name: clean_, size } };
  if (gid) {
    const key = groupKey(gid), gi = groupIndex(v, key);
    if (gi < 0 || !v.groups[gi].members.includes(from)) return null;
    m.by = from; remember(v, id);
    (v.messages[key] ||= []).push(m);
    v.groups[gi].unread = (v.groups[gi].unread || 0) + 1; v.groups[gi].lastActivity = now;
  } else {
    remember(v, id);
    (v.messages[from] ||= []).push(m);
    f.unread = (f.unread || 0) + 1; f.lastActivity = now;
  }
  return m;
}

/** My own message in a group (text, or a file when `file` is set). */
export function addMineToGroup(v, key, id, text, file = null, now = Date.now()) {
  const gi = groupIndex(v, key);
  if (gi < 0) return;
  const m = { id, mine: true, text, date: now, state: 'sending' };
  if (file) m.file = file;
  (v.messages[key] ||= []).push(m);
  v.groups[gi].lastActivity = now;
}
/** My own file in a one to one chat. */
export function addMineFile(v, box, id, file, now = Date.now()) {
  (v.messages[box] ||= []).push({ id, mine: true, text: '', date: now, state: 'sending', file });
  const f = record(v, box);
  if (f) f.lastActivity = now;
}

/** A member says they left. */
export function receiveLeave(v, from, gid) {
  const gi = groupIndex(v, groupKey(gid));
  if (gi >= 0) v.groups[gi].members = v.groups[gi].members.filter((b) => b !== from);
}
/** I leave (or the group is deleted): it and its history go. Returns the ids of files that were in it. */
export function leaveGroup(v, key) {
  const files = (v.messages[key] || []).filter((m) => m.file).map((m) => m.id);
  v.groups = (v.groups || []).filter((g) => groupKey(g.id) !== key); delete v.messages[key];
  return files;
}
export function markGroupRead(v, key) { const gi = groupIndex(v, key); if (gi >= 0) v.groups[gi].unread = 0; }

/** The ids of every file in the history, so "delete everything" or removing a friend can drop the stored bytes too. */
export const fileIds = (v, key) => (v.messages[key] || []).filter((m) => m.file).map((m) => m.id);

/**
 * One chunk of a file. `partials` is a Map the caller keeps between calls (files being put back together).
 * Returns { group, id, name, bytes } when the last piece arrives, else null. Nothing is stored here: the caller does that.
 * Limits (same as the Mac): 1…20 chunks of up to 8,000 bytes, a partial file is dropped after 10 minutes, at most 8 at once.
 */
export function receiveChunk(v, partials, from, body, now = Date.now()) {
  const f = record(v, from);
  if (!f || f.status !== 'active' || !body) return null;
  const { id, fn, fi, fd } = body;
  const name = cleanFileName(body.fname);
  if (!isPlainID(id) || !Number.isInteger(fn) || !Number.isInteger(fi) || fn < 1 || fn > MAX_CHUNKS || fi < 0 || fi >= fn
    || typeof fd !== 'string' || fd.length > CHUNK_SIZE * 2 || !/^[A-Za-z0-9_-]*$/.test(fd) || !name || v.seen.includes(id)) return null;
  const bytes = unb64uBytes(fd);
  if (!bytes || bytes.length > CHUNK_SIZE) return null;
  const gid = typeof body.g === 'string' && body.g ? body.g : null;
  if (body.g !== undefined && body.g !== null && !gid) return null;
  if (gid && !(group(v, groupKey(gid))?.members.includes(from))) return null;
  const key = `${from}|${id}`;
  for (const [k, p] of partials) if (now - p.started >= PARTIAL_TTL_MS) partials.delete(k);   // give up on files that stalled
  let part = partials.get(key);
  if (!part) {
    if (partials.size >= MAX_PARTIALS) return null;
    part = { name, n: fn, group: gid, chunks: new Map(), started: now };
    partials.set(key, part);
  }
  if (part.n !== fn) return null;
  part.chunks.set(fi, bytes);
  if (part.chunks.size !== fn) return null;
  partials.delete(key);
  const out = new Uint8Array([...part.chunks.keys()].reduce((n, k) => n + part.chunks.get(k).length, 0));
  let at = 0;
  for (let k = 0; k < fn; k++) { const c = part.chunks.get(k); if (!c) return null; out.set(c, at); at += c.length; }
  if (out.length > MAX_FILE_BYTES) return null;
  return { group: part.group, id, name: part.name, bytes: out };
}

/** The pieces of a file to send, each as a `chunk` body (the caller seals one per piece per receiver). */
export function chunkBodies(from, id, name, bytes, group, ts, toB64u) {
  const n = Math.max(1, Math.ceil(bytes.length / CHUNK_SIZE)), out = [];
  for (let i = 0; i < n; i++) {
    const b = { t: 'chunk', from, id, ts };
    if (group) b.g = group;
    b.fname = name; b.fn = n; b.fi = i; b.fd = toB64u(bytes.subarray(i * CHUNK_SIZE, (i + 1) * CHUNK_SIZE));
    out.push(b);
  }
  return out;
}

/** The body of an invite / change for a group: every member's mailbox including mine (the receiver is in the list too). */
export const groupInviteBody = (me, g, ts) => ({ t: 'grp', from: me, g: g.id, gname: g.name, gm: [me, ...g.members].sort(), ts });

/** Three rows of four groups, for showing the 60-digit safety number (as the Mac does). */
export function safetyRows(number) {
  const g = String(number).split(' ');
  return [0, 4, 8].map((i) => g.slice(i, i + 4).join('  '));
}
