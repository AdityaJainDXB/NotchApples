// Messenger → Friends, the rules with no screen, no network and no imports (so Node tests load this file as it is).
// A port of FriendsBook / Friends.parse / FriendsBook.clean in NotchApple/Modules/Messenger/Friends/FriendsLogic.swift.
// The vault is plain JSON: { friends, messages, blocked, seen }. Keys are base64url strings; `fp` is a friend's key fingerprint
// as hex (the caller computes it with friendscrypto.js, because hashing is async and these rules are not).
// Dates are milliseconds since 1970.

export const CODE_ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
export const CODE_LENGTH = 10;
export const MAX_TEXT = 2000;
const SEEN_LIMIT = 500;

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

export const newVault = () => ({ friends: [], messages: {}, blocked: [], seen: [] });
/** A vault read back from disk, with anything missing filled in. */
export function normalizeVault(raw) {
  const v = newVault();
  if (!raw || typeof raw !== 'object') return v;
  if (Array.isArray(raw.friends)) v.friends = raw.friends.filter((f) => f && typeof f.box === 'string');
  if (raw.messages && typeof raw.messages === 'object') v.messages = raw.messages;
  if (Array.isArray(raw.blocked)) v.blocked = raw.blocked.filter((x) => typeof x === 'string');
  if (Array.isArray(raw.seen)) v.seen = raw.seen.filter((x) => typeof x === 'string');
  return v;
}

export const index = (v, box) => v.friends.findIndex((f) => f.box === box);
export const record = (v, box) => v.friends.find((f) => f.box === box) || null;
export const isBlocked = (v, fp) => v.blocked.includes(fp);
export const incoming = (v) => v.friends.filter((f) => f.status === 'incoming').sort((a, b) => a.added - b.added);
export const pending = (v) => v.friends.filter((f) => f.status === 'outgoing').sort((a, b) => a.added - b.added);
export const active = (v) => v.friends.filter((f) => f.status === 'active').sort((a, b) => b.lastActivity - a.lastActivity);
export const messagesOf = (v, box) => v.messages[box] || [];
/** The number on the badge: unread messages plus requests waiting for an answer. */
export const totalUnread = (v) => v.friends.reduce((n, f) => n + (f.unread || 0), 0) + incoming(v).length;
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

/** Three rows of four groups, for showing the 60-digit safety number (as the Mac does). */
export function safetyRows(number) {
  const g = String(number).split(' ');
  return [0, 4, 8].map((i) => g.slice(i, i + 4).join('  '));
}
