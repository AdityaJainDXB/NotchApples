// Connect Four, Rock Paper Scissors and Battleship for two people in a Messenger room or a friend chat: the rules with no screen,
// no network and no imports (so Node tests load this file as it is). A port of NotchApple/Modules/Messenger/TwoPlayerGames.swift
// (rules) and PlayController.swift (the session controller); keep them in step. The JSON field names and values are the Mac's, so
// Mac and Windows play each other (docs/FRIENDS_PROTOCOL.md, "Two-player games").
//
// Both players run the same `reduce` on every game message, their own included, so they always agree:
//   next = reduce(state, msg, fromID)
// A message that is illegal, repeated, stale or from someone who is not playing returns the SAME state object (`next === state`
// means "ignored"). A message that arrives too early (messages can swap order) is kept in `stash` (max 12) and tried again
// after the next change.
//
// Fair play without a referee:
//   Rock Paper Scissors  each pick is sent first as a hash (SHA-256 of "pick:salt") and shown only after both are in, so no one
//                        can change theirs. First to 2 wins.
//   Battleship           each fleet is committed as a hash (SHA-256 of "board:salt", 100 characters) when its owner presses Ready,
//                        shots are answered by the owner (0 miss, 1 hit, 10 + length when a ship sinks), and when the game ends
//                        both fleets are revealed and checked against the hash and against every answer given.
//
// Wire message (PlayMessage), op = invite | accept | start | cancel | quit | rematch   (lobby, same for every game)
//                                | move                                                (Connect Four: a = column)
//                                | commit | reveal                                     (Rock Paper Scissors: h hash; a pick, s salt)
//                                | ready | shoot | result | reveal                     (Battleship: h hash; a cell, b answer; s "board:salt")
//   g = "c4" | "rps" | "bs", gid = game id, x/o = start: who goes first / the other, r = round (0, then +1 per rematch),
//   n = move number (c4, bs) or game within the match (rps), a, b, h, s as above. Every field but g, op and gid is optional.

export const KINDS = ['c4', 'rps', 'bs'];
export const TITLES = { c4: 'Connect Four', rps: 'Rock Paper Scissors', bs: 'Battleship' };
export const EMOJI = { c4: '🔴', rps: '✊', bs: '🚢' };
export const C4 = { cols: 7, rows: 6 };
export const RPS = { wins: 2, names: ['Rock', 'Paper', 'Scissors'], emoji: ['✊', '✋', '✌️'] };
/** True when pick `a` beats pick `b` (0 rock, 1 paper, 2 scissors). */
export const beats = (a, b) => (a - b + 3) % 3 === 1;
export const BS = {
  size: 10,
  fleet: [{ id: 'A', length: 5 }, { id: 'B', length: 4 }, { id: 'C', length: 3 }, { id: 'D', length: 3 }, { id: 'E', length: 2 }],
  shipCells: 17,
};
const MAX_STASH = 12;

// ---- SHA-256 (synchronous, so the reducer can check a reveal; WebCrypto is async-only) ----

const K = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da, 0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);

/** SHA-256 of the UTF-8 text as 64 lowercase hex characters. */
export function sha256Hex(text) {
  const data = new TextEncoder().encode(String(text));
  const padded = new Uint8Array(((data.length + 9 + 63) >> 6) << 6);
  padded.set(data);
  padded[data.length] = 0x80;
  const view = new DataView(padded.buffer);
  view.setUint32(padded.length - 8, Math.floor((data.length * 8) / 0x100000000));
  view.setUint32(padded.length - 4, (data.length * 8) >>> 0);
  const h = new Uint32Array([0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19]);
  const w = new Uint32Array(64);
  const rotr = (x, n) => (x >>> n) | (x << (32 - n));
  for (let off = 0; off < padded.length; off += 64) {
    for (let i = 0; i < 16; i++) w[i] = view.getUint32(off + i * 4);
    for (let i = 16; i < 64; i++) {
      const s0 = rotr(w[i - 15], 7) ^ rotr(w[i - 15], 18) ^ (w[i - 15] >>> 3);
      const s1 = rotr(w[i - 2], 17) ^ rotr(w[i - 2], 19) ^ (w[i - 2] >>> 10);
      w[i] = (w[i - 16] + s0 + w[i - 7] + s1) >>> 0;
    }
    let [a, b, c, d, e, f, g, hh] = h;
    for (let i = 0; i < 64; i++) {
      const t1 = (hh + (rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25)) + ((e & f) ^ (~e & g)) + K[i] + w[i]) >>> 0;
      const t2 = ((rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22)) + ((a & b) ^ (a & c) ^ (b & c))) >>> 0;
      hh = g; g = f; f = e; e = (d + t1) >>> 0; d = c; c = b; b = a; a = (t1 + t2) >>> 0;
    }
    h[0] += a; h[1] += b; h[2] += c; h[3] += d; h[4] += e; h[5] += f; h[6] += g; h[7] += hh;
  }
  return [...h].map((x) => x.toString(16).padStart(8, '0')).join('');
}

/** What Rock Paper Scissors commits to: the pick and a random salt. */
export const rpsCommit = (pick, salt) => sha256Hex(`${pick}:${salt}`);
/** What Battleship commits to: the fleet (100 characters) and a random salt. */
export const fleetCommit = (board, salt) => sha256Hex(`${board}:${salt}`);

// ---- randomness (injectable so tests are repeatable) ----

const ALPHABET = 'abcdefghjkmnpqrstuvwxyz23456789';
function secureRandom() {
  const c = globalThis.crypto;
  return c?.getRandomValues ? c.getRandomValues(new Uint32Array(1))[0] / 0x100000000 : Math.random();
}
const randomText = (n, rand = secureRandom) => Array.from({ length: n }, () => ALPHABET[Math.floor(rand() * ALPHABET.length)]).join('');
export const newGameId = (rand) => randomText(12, rand);

// ---- Battleship fleets ----

export function isLegalFleet(board) {
  if (typeof board !== 'string') return false;
  const chars = Array.from(board);
  if (chars.length !== 100) return false;
  for (const { id, length } of BS.fleet) {
    const cells = [];
    chars.forEach((ch, i) => { if (ch === id) cells.push(i); });
    if (cells.length !== length) return false;
    const rows = new Set(cells.map((c) => Math.floor(c / 10))), cols = new Set(cells.map((c) => c % 10));
    if (rows.size === 1) { if (Math.max(...cols) - Math.min(...cols) !== length - 1) return false; }
    else if (cols.size === 1) { if (Math.max(...rows) - Math.min(...rows) !== length - 1) return false; }
    else return false;
  }
  return chars.filter((ch) => ch !== '0').length === BS.shipCells && chars.every((ch) => ch === '0' || BS.fleet.some((f) => f.id === ch));
}

export function randomFleet(rand = secureRandom) {
  const int = (n) => Math.floor(rand() * n);
  for (;;) {
    const board = Array(100).fill('0');
    let ok = true;
    for (const { id, length } of BS.fleet) {
      let placed = false;
      for (let t = 0; t < 200; t++) {
        const horizontal = rand() < 0.5;
        const r = int(horizontal ? 10 : 10 - length + 1), c = int(horizontal ? 10 - length + 1 : 10);
        const cells = Array.from({ length }, (_, k) => (horizontal ? r * 10 + c + k : (r + k) * 10 + c));
        if (cells.every((cell) => board[cell] === '0')) { for (const cell of cells) board[cell] = id; placed = true; break; }
      }
      if (!placed) { ok = false; break; }
    }
    if (ok) return board.join('');
  }
}

/** The answer to a shot at `cell` on `board`, given every cell already shot (a Set, including this one): 0 miss, 1 hit, 10 + length when it sinks a ship. */
export function answer(board, shot, cell) {
  const chars = Array.from(board);
  if (!(cell >= 0 && cell < 100) || chars[cell] === '0') return 0;
  const all = [];
  chars.forEach((ch, i) => { if (ch === chars[cell]) all.push(i); });
  return all.every((i) => shot.has(i)) ? 10 + all.length : 1;
}

// ---- messages from the network ----

const isInt = (v, lo, hi) => Number.isInteger(v) && v >= lo && v <= hi;
const isId = (v) => typeof v === 'string' && v.length > 0 && Array.from(v).length <= 64;
const isHex64 = (v) => typeof v === 'string' && /^[0-9a-f]{64}$/.test(v);
const STRINGS = ['x', 'o', 'h', 's'], NUMBERS = ['r', 'n', 'a', 'b'];

/** Cleans anything that came off the network: a safe message with only the known fields, or null. A field of the wrong type makes the whole message invalid (the Mac fails to decode it too). */
export function parse(raw) {
  if (!raw || typeof raw !== 'object') return null;
  if (typeof raw.g !== 'string' || typeof raw.op !== 'string' || typeof raw.gid !== 'string') return null;
  const m = { g: raw.g, op: raw.op, gid: raw.gid };
  for (const k of STRINGS) { if (raw[k] != null) { if (typeof raw[k] !== 'string') return null; m[k] = raw[k]; } }
  for (const k of NUMBERS) { if (raw[k] != null) { if (!Number.isInteger(raw[k])) return null; m[k] = raw[k]; } }
  if (!KINDS.includes(m.g) || !isId(m.gid)) return null;
  const ok = (cond) => (cond ? m : null);
  switch (m.op) {
    case 'invite': case 'accept': case 'quit': case 'cancel': return m;
    case 'start': return ok(isId(m.x) && isId(m.o) && m.x !== m.o);
    case 'rematch': return ok(isInt(m.r, 0, 1000));
    case 'move': return ok(isInt(m.r, 0, 1000) && isInt(m.n, 0, 100) && isInt(m.a, 0, 6));
    case 'commit': return ok(isInt(m.r, 0, 1000) && isInt(m.n, 0, 10) && isHex64(m.h));
    case 'reveal': {
      if (!isInt(m.r, 0, 1000) || typeof m.s !== 'string') return null;
      const len = Array.from(m.s).length;
      if (len < 1 || len > 140) return null;
      if (m.g === 'rps') return ok(isInt(m.n, 0, 10) && isInt(m.a, 0, 2));
      return m.g === 'bs' ? m : null;
    }
    case 'ready': return ok(isInt(m.r, 0, 1000) && isHex64(m.h));
    case 'shoot': return ok(isInt(m.r, 0, 1000) && isInt(m.n, 0, 200) && isInt(m.a, 0, 99));
    case 'result': return ok(isInt(m.r, 0, 1000) && isInt(m.n, 0, 200) && isInt(m.a, 0, 99) && Number.isInteger(m.b) && (m.b === 0 || m.b === 1 || (m.b >= 12 && m.b <= 15)));
    default: return null;
  }
}

// ---- sessions ----

const clone = (s) => structuredClone(s);
export const isFinished = (s) => s.status === 'finished' || s.status === 'ended' || s.status === 'cancelled';
/** 0 for the player who moves first, 1 for the other, null for anyone else. */
export const indexOf = (s, id) => (id != null && id === s.p1 ? 0 : id != null && id === s.p2 ? 1 : null);
export const isPlayer = (s, id) => indexOf(s, id) !== null;
export const playerAt = (s, i) => (i === 0 ? s.p1 : s.p2);
export const otherThan = (s, id) => (id === s.p1 ? s.p2 : id === s.p2 ? s.p1 : null);
/** Battleship: whose turn to shoot (index), or null while waiting for an answer or for the fleets. */
export const shooter = (bs) => (bs.pendingCell === null && bs.commit[0] !== null && bs.commit[1] !== null ? bs.moves % 2 : null);
export const bothReady = (bs) => bs.commit[0] !== null && bs.commit[1] !== null;

function fresh(kind, gid, inviter) {
  return {
    kind, gid, status: 'invited', inviter, accepted: null, p1: null, p2: null, round: 0, rematch: [], leaver: null, winner: null,
    c4: { cells: Array(42).fill(0), moves: 0, line: null, last: null },
    rps: { n: 0, commit: [null, null], reveal: [null, null], score: [0, 0], last: null, lastWinner: null },
    bs: { commit: [null, null], moves: 0, pendingCell: null, shots: [Array(100).fill(0), Array(100).fill(0)], sunk: [[], []], hits: [0, 0], revealed: [null, null] },
    stash: [],
  };
}

function lowestEmptyRow(c4, col) {
  if (!(col >= 0 && col < C4.cols)) return null;
  for (let row = C4.rows - 1; row >= 0; row--) if (c4.cells[row * C4.cols + col] === 0) return row;
  return null;
}

/** Four in a row through `cell`, if there is one (sorted cell numbers). */
function winningLine(c4, cell) {
  const me = c4.cells[cell];
  if (me === 0) return null;
  const r0 = Math.floor(cell / C4.cols), c0 = cell % C4.cols;
  for (const [dr, dc] of [[0, 1], [1, 0], [1, 1], [1, -1]]) {
    const line = [cell];
    for (const sign of [1, -1]) {
      let r = r0 + dr * sign, c = c0 + dc * sign;
      while (r >= 0 && r < C4.rows && c >= 0 && c < C4.cols && c4.cells[r * C4.cols + c] === me) { line.push(r * C4.cols + c); r += dr * sign; c += dc * sign; }
    }
    if (line.length >= 4) return line.sort((a, b) => a - b);
  }
  return null;
}
export { lowestEmptyRow };

function finish(s, winnerIndex) {
  s.status = 'finished';
  s.winner = winnerIndex === null ? null : playerAt(s, winnerIndex);
}

/** Applies one game message from player `idx` to `s` (already a private copy). Returns false, having changed nothing, when it isn't legal right now. */
function apply(s, m, idx) {
  if (s.kind === 'c4') return applyConnectFour(s, m, idx);
  if (s.kind === 'rps') return applyRPS(s, m, idx);
  return applyBattleship(s, m, idx);
}

function applyConnectFour(s, m, idx) {
  const c4 = s.c4;
  if (m.op !== 'move' || m.n !== c4.moves || idx !== c4.moves % 2) return false;
  const row = lowestEmptyRow(c4, m.a);
  if (row === null) return false;
  const cell = row * C4.cols + m.a;
  c4.cells[cell] = idx + 1; c4.moves += 1; c4.last = cell;
  const line = winningLine(c4, cell);
  if (line) { c4.line = line; finish(s, idx); } else if (c4.moves === 42) finish(s, null);
  return true;
}

function applyRPS(s, m, idx) {
  const rps = s.rps;
  if (m.n !== rps.n) return false;
  if (m.op === 'commit') {
    if (rps.commit[idx] !== null || m.h === undefined) return false;
    rps.commit[idx] = m.h;
    return true;
  }
  if (m.op === 'reveal') {
    if (rps.reveal[idx] !== null || m.a === undefined || m.s === undefined || rps.commit[idx] === null || rpsCommit(m.a, m.s) !== rps.commit[idx]) return false;
    rps.reveal[idx] = m.a;
    if (rps.reveal[0] !== null && rps.reveal[1] !== null) {            // both are in: score the game
      const [a, b] = rps.reveal;
      rps.last = [a, b];
      if (a === b) rps.lastWinner = null;
      else { const w = beats(a, b) ? 0 : 1; rps.lastWinner = w; rps.score[w] += 1; }
      rps.commit = [null, null]; rps.reveal = [null, null]; rps.n += 1;
      const w = rps.score.indexOf(RPS.wins);
      if (w >= 0) finish(s, w);
    }
    return true;
  }
  return false;
}

function applyBattleship(s, m, idx) {
  const bs = s.bs;
  switch (m.op) {
    case 'ready':
      if (s.status !== 'playing' || bs.commit[idx] !== null || m.h === undefined) return false;
      bs.commit[idx] = m.h;
      return true;
    case 'shoot':
      if (s.status !== 'playing' || shooter(bs) !== idx || m.n !== bs.moves || m.a === undefined || bs.shots[1 - idx][m.a] !== 0) return false;
      bs.pendingCell = m.a;
      return true;
    case 'result': {
      // The answer comes from the player who was shot at.
      if (s.status !== 'playing' || m.a === undefined || m.b === undefined || bs.pendingCell === null || bs.pendingCell !== m.a || m.n !== bs.moves || idx !== (bs.moves + 1) % 2) return false;
      const mover = 1 - idx;
      bs.shots[idx][m.a] = m.b === 0 ? 1 : 2;
      if (m.b >= 10) bs.sunk[idx].push(m.b - 10);
      if (m.b !== 0) bs.hits[idx] += 1;
      bs.pendingCell = null; bs.moves += 1;
      if (bs.hits[idx] === BS.shipCells) finish(s, mover);
      return true;
    }
    case 'reveal': {
      if (bs.revealed[idx] !== null || m.s === undefined) return false;
      // "board:salt" split at the first colon; both parts must be non-empty (the Mac drops empty parts the same way).
      const colon = m.s.indexOf(':');
      const board = colon < 0 ? m.s : m.s.slice(0, colon), salt = colon < 0 ? '' : m.s.slice(colon + 1);
      let ok = false;
      if (board && salt && bs.commit[idx] !== null && fleetCommit(board, salt) === bs.commit[idx] && isLegalFleet(board)) {
        const chars = Array.from(board);
        ok = chars.every((ch, cell) => {
          const shot = bs.shots[idx][cell];
          return shot === 1 ? ch === '0' : shot === 2 ? ch !== '0' : true;
        });
      }
      bs.revealed[idx] = ok;
      return true;
    }
    default: return false;
  }
}

const sameStash = (a, b) => a.from === b.from && JSON.stringify(a.m) === JSON.stringify(b.m);

/** Tries the kept messages again; stops when none of them applies any more. */
function drain(s) {
  let progress = true;
  while (progress && s.stash.length) {
    progress = false;
    for (const item of s.stash) {
      const idx = indexOf(s, item.from);
      if (idx === null || !(s.status === 'playing' || item.m.op === 'reveal')) continue;
      const kept = s.stash;
      s.stash = [];
      if (apply(s, item.m, idx)) { s.stash = kept.filter((x) => !sameStash(x, item)); progress = true; break; }
      s.stash = kept;
    }
  }
}

/** The state after `raw` (from player id `from`) is applied. The very same object comes back when the message is ignored. */
export function reduce(state, raw, from) {
  const m = parse(raw);
  if (!m || !isId(from)) return state;
  if (m.op === 'invite') {
    if (state && !isFinished(state)) return state;
    return fresh(m.g, m.gid, from);
  }
  if (!state || state.gid !== m.gid || state.kind !== m.g) return state;
  const s = clone(state);
  switch (m.op) {
    case 'accept':
      if (s.status !== 'invited' || from === s.inviter || s.accepted !== null) return state;
      s.accepted = from;
      return s;
    case 'cancel':
      if (s.status !== 'invited' || from !== s.inviter) return state;
      s.status = 'cancelled';
      return s;
    case 'start':
      if (s.status !== 'invited' || from !== s.inviter || s.accepted === null || ![m.x, m.o].includes(s.inviter) || ![m.x, m.o].includes(s.accepted)) return state;
      s.status = 'playing'; s.p1 = m.x; s.p2 = m.o;
      return s;
    case 'quit':
      if (s.status !== 'playing' || !isPlayer(s, from)) return state;
      s.status = 'ended'; s.leaver = from;
      return s;
    case 'rematch':
      if (s.status !== 'finished' || !isPlayer(s, from) || m.r !== s.round || s.rematch.includes(from)) return state;
      s.rematch.push(from);
      if (s.rematch.length === 2) {                       // both asked: the first mover swaps and the game starts again
        s.round += 1; s.rematch = []; s.winner = null;
        [s.p1, s.p2] = [s.p2, s.p1];
        const f = fresh(s.kind, s.gid, s.inviter);
        s.c4 = f.c4; s.rps = f.rps; s.bs = f.bs; s.stash = [];
        s.status = 'playing';
      }
      return s;
    default: break;
  }
  // The Battleship reveal comes after the game is over; everything else only while it is being played.
  const revealAfter = m.op === 'reveal' && s.kind === 'bs' && (s.status === 'finished' || s.status === 'ended');
  const idx = indexOf(s, from);
  if (!(s.status === 'playing' || revealAfter) || idx === null || m.r !== s.round) return state;
  if (apply(s, m, idx)) { drain(s); return s; }
  // Not legal yet: it may just have overtaken an earlier message, so keep it for after the next change.
  const item = { m, from };
  if (s.stash.length < MAX_STASH && !s.stash.some((x) => sameStash(x, item)) && (m.op !== 'reveal' || s.kind === 'rps')) {
    s.stash.push(item);
    return s;
  }
  return state;
}

// ---- building messages (the app sends these after checking them against its own state) ----

export const inviteMsg = (kind, gid) => ({ g: kind, op: 'invite', gid });
export const acceptMsg = (s) => ({ g: s.kind, op: 'accept', gid: s.gid });
export const cancelMsg = (s) => ({ g: s.kind, op: 'cancel', gid: s.gid });
export const quitMsg = (s) => ({ g: s.kind, op: 'quit', gid: s.gid });
export const rematchMsg = (s) => ({ g: s.kind, op: 'rematch', gid: s.gid, r: s.round });
/** The inviter picks who goes first (at random unless `inviterFirst` says otherwise). */
export const startMsg = (s, acceptor, inviterFirst = secureRandom() < 0.5) =>
  ({ g: s.kind, op: 'start', gid: s.gid, x: inviterFirst ? s.inviter : acceptor, o: inviterFirst ? acceptor : s.inviter });
export const moveMsg = (s, column) => ({ g: s.kind, op: 'move', gid: s.gid, r: s.round, n: s.c4.moves, a: column });
export const commitMsg = (s, pick, salt) => ({ g: s.kind, op: 'commit', gid: s.gid, r: s.round, n: s.rps.n, h: rpsCommit(pick, salt) });
export const revealMsg = (s, pick, salt) => ({ g: s.kind, op: 'reveal', gid: s.gid, r: s.round, n: s.rps.n, a: pick, s: salt });
export const readyMsg = (s, board, salt) => ({ g: s.kind, op: 'ready', gid: s.gid, r: s.round, h: fleetCommit(board, salt) });
export const shootMsg = (s, cell) => ({ g: s.kind, op: 'shoot', gid: s.gid, r: s.round, n: s.bs.moves, a: cell });
export const resultMsg = (s, cell, code) => ({ g: s.kind, op: 'result', gid: s.gid, r: s.round, n: s.bs.moves, a: cell, b: code });
export const revealFleetMsg = (s, board, salt) => ({ g: s.kind, op: 'reveal', gid: s.gid, r: s.round, s: `${board}:${salt}` });

/** True when `id` may drop a disc in `column` right now (the board enables columns with it; `reduce` is still the judge). */
export function canDrop(s, id, column) {
  return !!s && s.kind === 'c4' && s.status === 'playing' && indexOf(s, id) === s.c4.moves % 2 && lowestEmptyRow(s.c4, column) !== null;
}
export function canShoot(s, id, cell) {
  if (!s || s.kind !== 'bs' || s.status !== 'playing') return false;
  const me = indexOf(s, id);
  return me !== null && shooter(s.bs) === me && Number.isInteger(cell) && cell >= 0 && cell < 100 && s.bs.shots[1 - me][cell] === 0;
}

// ---- the controller: one game for one room or one friend chat ----
//
// Keeps the session, the secrets that must not leave this PC until the right moment (the Rock Paper Scissors pick, the Battleship
// fleet) and answers the opponent automatically (starting the game, revealing, answering shots). The room or the friend chat only
// passes messages in (`receive`) and carries the ones it sends (`transport`). Games are not saved: they end if the app quits.

export function createPlayController({ myID: myIdOrFn, name = () => 'Someone', transport = () => {}, onEvent = () => {}, onChange = () => {}, random } = {}) {
  const idOf = typeof myIdOrFn === 'function' ? myIdOrFn : () => myIdOrFn;   // a room's ID is only known once it is needed
  let session = null, fleet = null, myPick = null, salt = '', sentReveal = false, shotsAtMe = new Set();
  const changed = () => { try { api.onChange(); } catch { /* a screen error must not stop the game */ } };
  const saltText = () => randomText(16, random);

  function newGame(s) {
    myPick = null; sentReveal = false; shotsAtMe = new Set();
    salt = saltText();
    fleet = s.kind === 'bs' ? randomFleet(random) : null;
  }

  /** Everything that happens automatically after a change. */
  function react(msg, before, s) {
    // The inviter starts the game when someone accepts.
    if (msg.op === 'accept' && s.status === 'invited' && s.inviter === idOf() && s.accepted) send(startMsg(s, s.accepted));
    // A new game (or rematch): forget the last one's secrets and set up my side.
    if (s.status === 'playing' && isPlayer(s, idOf()) && (before?.status !== 'playing' || s.round !== before?.round)) newGame(s);
    const me = indexOf(s, idOf());
    if (me === null) return;
    if (s.kind === 'rps') {
      // Once both picks are committed, show mine (the reveal), unless I am still waiting to pick.
      if (s.status === 'playing' && myPick !== null && s.rps.commit[me] !== null && s.rps.commit[1 - me] !== null && s.rps.reveal[me] === null && !sentReveal) {
        sentReveal = true;
        send(revealMsg(s, myPick, salt));
      }
      if (s.rps.n !== before?.rps.n || s.round !== before?.round) { myPick = null; sentReveal = false; }
    } else if (s.kind === 'bs') {
      // Answer a shot at me from my own fleet.
      if (s.status === 'playing' && s.bs.pendingCell !== null && s.bs.moves % 2 === 1 - me && fleet && !shotsAtMe.has(s.bs.pendingCell)) {
        const cell = s.bs.pendingCell;
        shotsAtMe.add(cell);
        send(resultMsg(s, cell, answer(fleet, shotsAtMe, cell)));
      }
      // The game is over: show my fleet so the opponent can check my answers.
      if (s.status === 'finished' && fleet && !sentReveal && s.bs.revealed[me] === null) {
        sentReveal = true;
        send(revealFleetMsg(s, fleet, salt));
      }
    }
    if (before?.status !== s.status) {
      if (s.status === 'finished') api.onEvent(s.winner === null ? `${TITLES[s.kind]}: a draw.` : `${TITLES[s.kind]}: ${api.name(s.winner)} won.`);
      else if (s.status === 'ended') api.onEvent(`${TITLES[s.kind]} ended: ${api.name(s.leaver)} left the game.`);
    }
  }

  /** Applies a message (mine or theirs). Returns true when it changed the game. */
  function applyMsg(msg, from) {
    const before = session;
    const next = reduce(before, msg, from);
    if (next === before) return false;
    session = next;
    if (msg.op === 'invite' && from !== idOf()) api.onEvent(`${api.name(from)} invited you to play ${TITLES[next.kind]}.`);
    react(msg, before, next);
    changed();
    return true;
  }

  /** Checks a message of mine against my own state first, so an illegal move is never sent, then applies and sends it. */
  function send(msg) {
    if (!applyMsg(msg, idOf())) return false;
    api.transport(msg);
    return true;
  }

  const s0 = () => session;
  const api = {
    get myID() { return idOf(); },
    name, transport, onEvent, onChange,
    get session() { return session; },
    get fleet() { return fleet; },
    get myPick() { return myPick; },
    get isActive() { return !!session && !isFinished(session); },
    get myIndex() { return session ? indexOf(session, idOf()) : null; },
    get iCommittedFleet() { const i = session ? indexOf(session, idOf()) : null; return !!session && i !== null && session.bs.commit[i] !== null; },
    /** A message from `from` (not from me). Returns true when it changed the game. */
    receive: (msg, from) => applyMsg(msg, from),
    invite(kind) { if (!api.isActive && KINDS.includes(kind)) send(inviteMsg(kind, newGameId(random))); },
    accept() { const s = s0(); if (s && s.status === 'invited') send(acceptMsg(s)); },
    cancelInvite() { const s = s0(); if (s && s.status === 'invited') send(cancelMsg(s)); },
    leave() { const s = s0(); if (s && s.status === 'playing') send(quitMsg(s)); },
    rematch() { const s = s0(); if (s && s.status === 'finished') send(rematchMsg(s)); },
    /** Forgets any game (leaving or joining a room). */
    reset() { session = null; fleet = null; myPick = null; sentReveal = false; shotsAtMe = new Set(); changed(); },
    /** Closes a finished game's board (nothing is sent). */
    close() { const s = s0(); if (s && isFinished(s)) { session = null; fleet = null; myPick = null; changed(); } },
    /** The opponent left the room or the app: their game is over. */
    playerGone(id) { const s = s0(); if (s && s.status === 'playing') applyMsg(quitMsg(s), id); },
    drop(column) { const s = s0(); if (s) send(moveMsg(s, column)); },
    /** Rock Paper Scissors: lock in a pick. Only the hash leaves this PC until both picks are in. */
    pick(choice) {
      const s = s0(), me = s ? indexOf(s, idOf()) : null;
      if (!s || s.kind !== 'rps' || s.status !== 'playing' || me === null || s.rps.commit[me] !== null || myPick !== null || !isInt(choice, 0, 2)) return;
      myPick = choice;
      send(commitMsg(s, choice, salt));
      changed();
    },
    /** Battleship: new random placement (before pressing Ready). */
    shuffleFleet() { const s = s0(); if (s && s.kind === 'bs' && s.status === 'playing' && !api.iCommittedFleet) { fleet = randomFleet(random); changed(); } },
    readyFleet() { const s = s0(); if (s && s.kind === 'bs' && s.status === 'playing' && fleet && !api.iCommittedFleet) send(readyMsg(s, fleet, salt)); },
    fire(cell) { const s = s0(); if (s) send(shootMsg(s, cell)); },
  };
  return api;
}
