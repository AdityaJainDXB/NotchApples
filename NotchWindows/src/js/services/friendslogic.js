// Messenger → Friends, the rules with no screen, no network and no imports (so Node tests load this file as it is).
// A port of FriendsBook / Friends.parse / FriendsBook.clean in NotchApple/Modules/Messenger/Friends/FriendsLogic.swift.
// The vault is plain JSON: { friends, messages, blocked, seen }. Keys are base64url strings; `fp` is a friend's key fingerprint
// as hex (the caller computes it with friendscrypto.js, because hashing is async and these rules are not).
// Dates are milliseconds since 1970.

export const CODE_ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
export const CODE_LENGTH = 10;
export const MAX_TEXT = 2000;
const SEEN_LIMIT = 500;
/** Files: 8 KB chunks (a sealed message is limited to about 16 KB by the relay), at most 250 of them, so 2,000,000 bytes (the relay's
 *  mailbox holds 4.5 MB). Same numbers as the Mac since 2.2.8; before that it was 20 chunks and 160,000 bytes. */
export const CHUNK_SIZE = 8000;
export const MAX_CHUNKS = 250;
export const MAX_FILE_BYTES = CHUNK_SIZE * MAX_CHUNKS;
/** "2 MB" for messages. */
export const MAX_FILE_TEXT = `${MAX_FILE_BYTES / 1_000_000} MB`;
/** Sending a file: about 4 pieces a second, and when the relay says 429 (too many sends a minute) wait 8 s and send the same piece again, up to 8 times. */
export const PIECE_GAP_MS = 220;
export const RATE_WAIT_MS = 8000;
export const RATE_RETRIES = 8;
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

export const newVault = () => ({ friends: [], messages: {}, blocked: [], blockedNames: {}, seen: [], groups: [], clears: {}, pendingClears: {} });
/** A vault read back from disk, with anything missing filled in. */
export function normalizeVault(raw) {
  const v = newVault();
  if (!raw || typeof raw !== 'object') return v;
  if (Array.isArray(raw.friends)) v.friends = raw.friends.filter((f) => f && typeof f.box === 'string');
  if (raw.messages && typeof raw.messages === 'object') v.messages = raw.messages;
  if (Array.isArray(raw.blocked)) v.blocked = raw.blocked.filter((x) => typeof x === 'string');
  // The names shown in the blocked list (added later): a vault without them loads fine and shows a short code instead.
  if (raw.blockedNames && typeof raw.blockedNames === 'object' && !Array.isArray(raw.blockedNames)) {
    for (const [fp, name] of Object.entries(raw.blockedNames)) if (v.blocked.includes(fp) && typeof name === 'string') v.blockedNames[fp] = name.slice(0, 64);
  }
  if (Array.isArray(raw.seen)) v.seen = raw.seen.filter((x) => typeof x === 'string');
  // A vault saved before groups existed has no `groups`: that must load as "no groups", never wipe the friends.
  if (Array.isArray(raw.groups)) v.groups = raw.groups.filter((g) => g && typeof g.id === 'string' && Array.isArray(g.members));
  // Same for "Clear chat" (Windows 2.2.43): a vault saved before it loads as "nothing cleared yet".
  const isObj = (x) => x && typeof x === 'object' && !Array.isArray(x);
  if (isObj(raw.clears)) for (const [k, m] of Object.entries(raw.clears)) if (isObj(m) && Number.isInteger(m.epoch) && Number.isFinite(m.at)) v.clears[k] = { epoch: m.epoch, at: m.at };
  if (isObj(raw.pendingClears)) for (const [k, p] of Object.entries(raw.pendingClears)) if (isObj(p) && Number.isInteger(p.epoch) && Number.isFinite(p.at) && Array.isArray(p.to)) v.pendingClears[k] = { epoch: p.epoch, at: p.at, to: p.to.filter((b) => typeof b === 'string') };
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
export function receiveMessage(v, from, id, text, ts, now = Date.now(), ce = undefined) {
  const f = record(v, from);
  if (!f || f.status !== 'active' || typeof id !== 'string' || !id || charCount(id) > 64 || typeof text !== 'string' || !text || charCount(text) > MAX_TEXT) return null;
  if (v.seen.includes(id)) return null;
  const date = Number.isFinite(ts) ? Math.min(ts, now) : now;
  if (isStale(v, from, ce, date)) return null;           // sent before the chat was cleared
  v.seen.push(id);
  if (v.seen.length > SEEN_LIMIT) v.seen.splice(0, v.seen.length - SEEN_LIMIT);
  const m = { id, mine: false, text, date, state: 'delivered' };
  if (Number.isInteger(ce)) m.ce = ce;
  (v.messages[from] ||= []).push(m);
  f.unread = (f.unread || 0) + 1; f.lastActivity = now;
  return m;
}

/** The line shown (and notified) when a friend challenges me to a two-player game. */
export const challengeLine = (name, title) => `🎮 ${name} challenged you to ${title}`;

/** A friend's game invite as a message in their chat, so it counts as unread like any message and shows in the list. Returns it if new
 *  (a repeat of the same invite is dropped), else null. The Accept button is the game card shown with the chat. */
export function receiveChallenge(v, from, gid, title, now = Date.now()) {
  const f = record(v, from);
  if (!f || typeof gid !== 'string' || !gid) return null;
  return receiveMessage(v, from, `ch-${gid}`.slice(0, 64), `${challengeLine(displayName(f), String(title))}. Press Accept below to play.`, now, now);
}

export function addMine(v, box, id, text, now = Date.now()) {
  (v.messages[box] ||= []).push({ id, mine: true, text, date: now, state: 'sending', ce: epochOf(v, box) });
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
  if (fp) v.blockedNames[fp] = displayName(v.friends[i]);   // so the blocked list can say who it is
  v.friends.splice(i, 1); delete v.messages[box]; delete v.clears[box]; delete v.pendingClears[box];
}
export function remove(v, box) { v.friends = v.friends.filter((f) => f.box !== box); delete v.messages[box]; delete v.clears[box]; delete v.pendingClears[box]; }
export function unblockAll(v) { v.blocked = []; v.blockedNames = {}; }

/** Unblocks one person (by the fingerprint in the blocked list). They can then send a request again, or be added by their code. */
export function unblock(v, fp) { v.blocked = v.blocked.filter((x) => x !== fp); delete v.blockedNames[fp]; }

/** The blocked list for display: who, and the fingerprint to unblock them by. */
export const blockedPeople = (v) => v.blocked.map((fp) => ({ fp, name: v.blockedNames[fp] || `Someone you blocked (${String(fp).slice(0, 4).toUpperCase()})` }));

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
/** I add some of my friends to a group I'm in, whoever made it. Returns the people actually added (none if it isn't allowed). */
export function addToGroup(v, key, members) {
  const g = group(v, key);
  if (!g) return [];
  const fresh = [...new Set(members)].filter((b) => record(v, b)?.status === 'active' && !g.members.includes(b)).sort();
  if (!fresh.length || g.members.length + fresh.length >= MAX_GROUP_MEMBERS) return [];
  g.members = [...g.members, ...fresh].sort();
  return fresh;
}
export function receiveGroup(v, from, body, myBox, now = Date.now()) {
  v.groups ||= [];
  const all = body && Array.isArray(body.gm) ? body.gm : null;
  if (record(v, from)?.status !== 'active' || !body || !isPlainID(body.g) || !all || all.length > MAX_GROUP_MEMBERS
    || !all.every((b) => typeof b === 'string' && b.length > 0 && b.length <= 64) || !all.includes(myBox) || !all.includes(from)) return null;
  const others = [...new Set(all)].filter((b) => b !== myBox).sort();
  const name = clean(body.gname) || 'Group';
  const i = groupIndex(v, groupKey(body.g));
  if (i >= 0) {
    if (v.groups[i].creator === from) { v.groups[i].name = name; v.groups[i].members = others; return v.groups[i]; }
    // Any other member may only ADD people (their own friends): the list must keep everyone already in, and the name stays.
    if (!v.groups[i].members.includes(from) || !v.groups[i].members.every((b) => others.includes(b))) return null;
    v.groups[i].members = others;
    return v.groups[i];
  }
  if (v.groups.length >= MAX_GROUPS) return null;
  const g = { id: body.g, name, members: others, creator: from, unread: 0, lastActivity: now };
  v.groups.push(g);
  return g;
}

/** A message in a group, from a member who is one of my friends. Returns it if new. No receipts for these. */
export function receiveGroupMessage(v, from, gid, id, text, ts, now = Date.now(), ce = undefined) {
  const key = groupKey(gid), gi = groupIndex(v, key);
  if (gi < 0 || !v.groups[gi].members.includes(from) || record(v, from)?.status !== 'active'
    || !isPlainID(id) || typeof text !== 'string' || !text || charCount(text) > MAX_TEXT || v.seen.includes(id)) return null;
  if (isStale(v, key, ce, wireDate(ts, now))) return null;
  remember(v, id);
  const m = { id, mine: false, text, date: wireDate(ts, now), state: 'delivered', by: from };
  if (Number.isInteger(ce)) m.ce = ce;
  (v.messages[key] ||= []).push(m);
  v.groups[gi].unread = (v.groups[gi].unread || 0) + 1; v.groups[gi].lastActivity = now;
  return m;
}

/** A finished file, from a friend (one to one, or `gid` if it came into a group). */
export function receiveFile(v, from, gid, id, name, size, now = Date.now(), ce = undefined, ts = undefined) {
  const f = record(v, from), clean_ = cleanFileName(name);
  if (!f || f.status !== 'active' || !isPlainID(id) || !Number.isInteger(size) || size <= 0 || size > MAX_FILE_BYTES || !clean_ || v.seen.includes(id)) return null;
  if (isStale(v, gid ? groupKey(gid) : from, ce, wireDate(ts, now))) return null;
  const m = { id, mine: false, text: '', date: now, state: 'delivered', file: { name: clean_, size } };
  if (Number.isInteger(ce)) m.ce = ce;
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
  const m = { id, mine: true, text, date: now, state: 'sending', ce: epochOf(v, key) };
  if (file) m.file = file;
  (v.messages[key] ||= []).push(m);
  v.groups[gi].lastActivity = now;
}
/** My own file in a one to one chat. */
export function addMineFile(v, box, id, file, now = Date.now()) {
  (v.messages[box] ||= []).push({ id, mine: true, text: '', date: now, state: 'sending', file, ce: epochOf(v, box) });
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
  v.groups = (v.groups || []).filter((g) => groupKey(g.id) !== key); delete v.messages[key]; delete v.clears[key]; delete v.pendingClears[key];
  return files;
}
export function markGroupRead(v, key) { const gi = groupIndex(v, key); if (gi >= 0) v.groups[gi].unread = 0; }

/** The ids of every file in the history, so "delete everything" or removing a friend can drop the stored bytes too. */
export const fileIds = (v, key) => (v.messages[key] || []).filter((m) => m.file).map((m) => m.id);

/**
 * One chunk of a file. `partials` is a Map the caller keeps between calls (files being put back together).
 * Returns { group, id, name, bytes } when the last piece arrives, else null. Nothing is stored here: the caller does that.
 * Limits (same as the Mac): 1…250 chunks of up to 8,000 bytes, a partial file is dropped after 10 minutes, at most 8 at once.
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
  const chatKey = gid ? groupKey(gid) : from;
  if (isStale(v, chatKey, body.ce, wireDate(body.ts, now))) return null;          // a piece from before the chat was cleared
  const key = `${from}|${id}`;
  for (const [k, p] of partials) if (now - p.started >= PARTIAL_TTL_MS) partials.delete(k);   // give up on files that stalled
  let part = partials.get(key);
  if (!part) {
    if (partials.size >= MAX_PARTIALS) return null;
    part = { name, n: fn, group: gid, ce: Number.isInteger(body.ce) ? body.ce : undefined, chunks: new Map(), started: now };
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
  return { group: part.group, id, name: part.name, bytes: out, ce: part.ce, ts: body.ts };
}

/** The pieces of a file to send, each as a `chunk` body (the caller seals one per piece per receiver). */
export function chunkBodies(from, id, name, bytes, group, ts, toB64u, ce = undefined) {
  const n = Math.max(1, Math.ceil(bytes.length / CHUNK_SIZE)), out = [];
  for (let i = 0; i < n; i++) {
    const b = { t: 'chunk', from, id, ts };
    if (Number.isInteger(ce)) b.ce = ce;
    if (group) b.g = group;
    b.fname = name; b.fn = n; b.fi = i; b.fd = toB64u(bytes.subarray(i * CHUNK_SIZE, (i + 1) * CHUNK_SIZE));
    out.push(b);
  }
  return out;
}

/**
 * Sends the pieces of a file one after the other with `post(body)` (which resolves to { status }), like the Mac's deliverFile:
 * a 429 waits RATE_WAIT_MS and sends the same piece again (at most RATE_RETRIES times), and a file of several pieces waits PIECE_GAP_MS
 * after each one. Stops at the first piece that fails. Returns { ok, status } (status of the failure, or 200).
 */
export async function sendPieces(bodies, post, sleep) {
  for (const b of bodies) {
    let r = await post(b), waits = 0;
    while (r.status === 429 && waits < RATE_RETRIES) { waits++; await sleep(RATE_WAIT_MS); r = await post(b); }
    if (r.status !== 200) return { ok: false, status: r.status };
    if (bodies.length > 1) await sleep(PIECE_GAP_MS);
  }
  return { ok: true, status: 200 };
}

/** The body of an invite / change for a group: every member's mailbox including mine (the receiver is in the list too). */
export const groupInviteBody = (me, g, ts) => ({ t: 'grp', from: me, g: g.id, gname: g.name, gm: [me, ...g.members].sort(), ts });

/** Three rows of four groups, for showing the 60-digit safety number (as the Mac does). */
export function safetyRows(number) {
  const g = String(number).split(' ');
  return [0, 4, 8].map((i) => g.slice(i, i + 4).join('  '));
}

// ---- Clear chat (docs/FRIENDS_PROTOCOL.md, "Clear chat"; the Mac's FriendsBook.clearChat / receiveClear)
//
// Every chat has a clear epoch (0 until it is first cleared). A clear raises it; every message carries the epoch its sender was in
// (`ce`). A message from before the newest clear is dropped, one from after it is kept, wherever and whenever it arrives, so a clear
// and a message that cross each other can never bring old messages back. Messages from an app that predates clearing carry no
// epoch; for those the time the clear was made decides.

export const MAX_EPOCH = 1_000_000;
export const epochOf = (v, key) => v.clears?.[key]?.epoch || 0;

/** True when a message was sent before the newest clear of this chat (so it must not be shown). `date` is ms since 1970. */
export function isStale(v, key, ce, date) {
  const mark = v.clears?.[key];
  if (!mark) return false;
  if (Number.isInteger(ce)) return ce < mark.epoch;
  return date <= mark.at;
}

const clearable = (v, key) => (isGroupKey(key) ? !!group(v, key) : record(v, key)?.status === 'active');
const isNotice = (m) => !!m.kind;

/** Unread count and activity time follow what is left in the chat; nothing about the old messages survives in them. */
function resetCounts(v, key, now) {
  const unread = (v.messages[key] || []).filter((m) => !m.mine && !isNotice(m)).length;
  if (isGroupKey(key)) { const gi = groupIndex(v, key); if (gi >= 0) { v.groups[gi].unread = unread; v.groups[gi].lastActivity = now; } }
  else { const f = record(v, key); if (f) { f.unread = unread; f.lastActivity = now; } }
}

/**
 * I clear a chat (a friend's box or a group key): everything in it goes, for me, and a single line says so. The friend or group stays.
 * Returns { key, epoch, at, files } (`files` = ids of saved files the caller must delete), or null when there is no such chat.
 */
export function clearChat(v, key, now = Date.now()) {
  if (!clearable(v, key)) return null;
  const old = v.messages[key] || [];
  const epoch = Math.min(MAX_EPOCH, Math.max(epochOf(v, key), ...old.map((m) => (Number.isInteger(m.ce) ? m.ce : 0))) + 1);
  v.clears[key] = { epoch, at: now };
  v.messages[key] = [{ id: `clear-${epoch}`, mine: true, text: 'You cleared this chat', date: now, state: 'sent', ce: epoch, kind: 'clear' }];
  resetCounts(v, key, now);
  return { key, epoch, at: now, files: old.filter((m) => m.file).map((m) => m.id) };
}

/**
 * A clear from a friend (already checked: signature good). Returns { key, epoch, at, files } for what was removed, or null when it was
 * refused or already applied. In a group, any member who is one of my friends may clear it for everyone.
 */
export function receiveClear(v, from, body, now = Date.now()) {
  const epoch = body?.ce;
  if (!body || body.t !== 'clr' || record(v, from)?.status !== 'active' || !Number.isInteger(epoch) || epoch < 1 || epoch > MAX_EPOCH) return null;
  let key = from;
  if (body.g !== undefined && body.g !== null) {
    if (!isPlainID(body.g) || groupIndex(v, groupKey(body.g)) < 0 || !v.groups[groupIndex(v, groupKey(body.g))].members.includes(from)) return null;
    key = groupKey(body.g);
  }
  if (epoch <= epochOf(v, key)) return null;                   // already applied, or an older clear arriving late
  const at = Math.min(Number.isFinite(body.ts) ? body.ts : now, now);
  const old = v.messages[key] || [];
  // What survives: messages sent after the clear (they may have overtaken it), and nothing else.
  const kept = old.filter((m) => (Number.isInteger(m.ce) ? m.ce >= epoch : !m.mine && m.date > at));
  const name = displayName(record(v, from));
  v.clears[key] = { epoch, at };
  v.messages[key] = [{ id: `clear-${epoch}`, mine: false, text: `${name} cleared this chat`, date: now, state: 'delivered', ce: epoch, kind: 'clear' }, ...kept];
  resetCounts(v, key, now);
  const keptIds = new Set(kept.map((m) => m.id));
  return { key, epoch, at, files: old.filter((m) => m.file && !keptIds.has(m.id)).map((m) => m.id) };
}

/** The `clr` body to send to one participant. */
export const clearBody = (me, key, epoch, at) => { const b = { t: 'clr', from: me, ts: at, ce: epoch }; if (isGroupKey(key)) b.g = key.slice(2); return b; };

/** Writes down that these members still have to be told about a clear (kept across restarts until each one has it). */
export function queueClear(v, key, epoch, at, to) {
  let p = v.pendingClears[key];
  if (p && p.epoch > epoch) return;
  if (!p || p.epoch < epoch) p = { epoch, at, to: [] };
  p.to = [...new Set([...p.to, ...to])].sort();
  v.pendingClears[key] = p;
}
/** One member has the clear (or can never get it): stop trying for them. */
export function clearDelivered(v, key, epoch, box) {
  const p = v.pendingClears[key];
  if (!p || p.epoch !== epoch) return;
  p.to = p.to.filter((b) => b !== box);
  if (!p.to.length) delete v.pendingClears[key];
}

/** The label a message carries on the relay so a clear can take back what is still queued: opaque, and different for every friend
 *  link, so the relay cannot tell that two mailboxes' messages belong to one group. `sha256hex` is friendscrypto's. */
export const chatTag = async (sha256hex, token, key) => (await sha256hex(`notchapple-clear-v1|${token}|${key}`)).slice(0, 32);
