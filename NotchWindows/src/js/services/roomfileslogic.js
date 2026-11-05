// Big files in an anonymous Messenger room, the rules with no screen, no network and no imports (so Node tests load this file as it is).
// A port of NotchApple/Modules/Messenger/FileChunks.swift (RoomFiles, FileAssembly); keep them in step.
//
// The room relay forwards one frame of at most 16 KB, so a file bigger than one piece is cut into 8,000-byte pieces, each sealed and sent
// as its own envelope (kind "chunk": fid = the file's id, fi = this piece's number, fn = how many pieces, fileData = the piece as base64,
// fileName), and put back together by whoever receives them. A file of 8,000 bytes or less goes as one ordinary "message" envelope with
// fileData and fileName. docs/FRIENDS_PROTOCOL.md ("Rooms: big files") has the wire format.

export const CHUNK_SIZE = 8000;
export const MAX_BYTES = 2_000_000;
export const MAX_CHUNKS = Math.ceil(MAX_BYTES / CHUNK_SIZE);   // 250
export const MAX_PARTS = 6;                  // files in flight at once
export const PATIENCE_MS = 180_000;          // give up on a file that stops arriving
export const PIECE_GAP_MS = 30;              // about 33 pieces a second, under the relay's 60 frames a second

const graphemes = (s) => (typeof Intl !== 'undefined' && Intl.Segmenter ? [...new Intl.Segmenter().segment(s)].map((x) => x.segment) : [...s]);

/** The pieces of a file (Uint8Arrays of at most 8,000 bytes). */
export function split(bytes) {
  const out = [];
  for (let at = 0; at < bytes.length; at += CHUNK_SIZE) out.push(bytes.subarray(at, Math.min(at + CHUNK_SIZE, bytes.length)));
  return out;
}

/** A file name that is safe to show and to save: no folders (the last path component only), no control characters, at most 100 characters.
 *  null when nothing is left. (Backslashes count as folder marks too, which the Mac does not do but a Windows PC must.) */
export function cleanName(raw) {
  let s = typeof raw === 'string' ? raw : '';
  s = s.replace(/[\\/]+$/, '');
  s = s.slice(Math.max(s.lastIndexOf('/'), s.lastIndexOf('\\')) + 1);
  s = s.replace(/[\u0000-\u001f\u007f-\u009f]/g, '').trim();
  if (!s || s === '.' || s === '..') return null;
  return graphemes(s).slice(0, 100).join('');
}

/** Standard base64 of a Uint8Array (what Swift's JSONEncoder writes for Data). */
export function toBase64(bytes) {
  let s = '';
  for (let i = 0; i < bytes.length; i += 4096) s += String.fromCharCode(...bytes.subarray(i, i + 4096));
  return btoa(s);
}

/** Bytes of a standard base64 string, or null if it isn't valid (the Mac fails to decode the whole envelope then). */
export function fromBase64(text) {
  if (typeof text !== 'string' || text.length > 20_000 || text.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(text)) return null;
  try { return Uint8Array.from(atob(text), (c) => c.charCodeAt(0)); } catch { return null; }
}

/** Files arriving in pieces, from several senders at once. `parts` maps "senderID|fid" to { name, n, chunks: Map, started }. */
export function createAssembly() {
  const parts = new Map();
  return {
    parts,
    /** Adds one piece of file `key`. Returns { name, data } once every piece is in; null while waiting or when the piece is not acceptable. */
    add(key, name, n, i, bytes, now = Date.now()) {
      if (!Number.isInteger(n) || !Number.isInteger(i) || !(bytes instanceof Uint8Array)) return null;
      if (n < 2 || n > MAX_CHUNKS || i < 0 || i >= n || bytes.length === 0 || bytes.length > CHUNK_SIZE) return null;
      if (i < n - 1 && bytes.length !== CHUNK_SIZE) return null;   // only the last piece may be short
      if (!parts.has(key)) {
        if (parts.size >= MAX_PARTS) return null;
        parts.set(key, { name, n, chunks: new Map(), started: now });
      }
      const part = parts.get(key);
      if (part.n !== n) return null;
      part.chunks.set(i, bytes);
      if (part.chunks.size !== n) return null;
      parts.delete(key);
      let total = 0;
      for (let k = 0; k < n; k++) { const c = part.chunks.get(k); if (!c) return null; total += c.length; }
      const data = new Uint8Array(total);
      let at = 0;
      for (let k = 0; k < n; k++) { const c = part.chunks.get(k); data.set(c, at); at += c.length; }
      return data.length <= MAX_BYTES ? { name: part.name, data } : null;
    },
    /** Forgets files that stopped arriving; returns their names so the screen can say so. */
    expire(now = Date.now()) {
      const names = [];
      for (const [key, p] of parts) if (now - p.started > PATIENCE_MS) { names.push(p.name); parts.delete(key); }
      return names;
    },
    reset() { parts.clear(); },
  };
}
