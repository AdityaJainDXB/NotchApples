// Connect Four, Rock Paper Scissors, Battleship, Chess and Checkers for two people in a Messenger room or a friend chat: the rules with
// no screen, no network and no imports (so Node tests load this file as it is). A port of NotchApple/Modules/Messenger/TwoPlayerGames.swift
// (rules), BoardGames.swift (Chess and Checkers) and PlayController.swift (the session controller); keep them in step. The JSON field names and values are the Mac's, so
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
//                                | move                                                (Connect Four: a = column; Chess and Checkers: a = from square, b = to square, s = promotion q r b n)
//                                | commit | reveal                                     (Rock Paper Scissors: h hash; a pick, s salt)
//                                | ready | shoot | result | reveal                     (Battleship: h hash; a cell, b answer; s "board:salt")
//   g = "c4" | "rps" | "bs" | "ch" | "ck", gid = game id, x/o = start: who goes first / the other, r = round (0, then +1 per rematch),
//   n = move number (c4, bs, ch, ck) or game within the match (rps), a, b, h, s as above. Every field but g, op and gid is optional.

// "rl" (Rocket League) and "sk" (Scribble) only use the lobby here (invite, accept, start, quit, cancel, rematch): once started, both chats open
// the same live web game (games/rocket.js, games/scribble.js) on a room relay, so there are no moves in the session.
export const KINDS = ['c4', 'rps', 'bs', 'ch', 'ck', 'rl', 'sk'];
export const TITLES = { c4: 'Connect Four', rps: 'Rock Paper Scissors', bs: 'Battleship', ch: 'Chess', ck: 'Checkers', rl: 'Rocket League', sk: 'Scribble' };
export const EMOJI = { c4: '🔴', rps: '✊', bs: '🚢', ch: '♟️', ck: '⚫', rl: '🚀', sk: '✏️' };
/** The web games: the page's global, its two files, and how tall their window is in a chat. */
export const WEB_GAMES = { rl: { global: 'NotchRocketGame', files: ['rocket-logic.js', 'rocket.js'], height: 350 }, sk: { global: 'NotchScribbleGame', files: ['scribble-logic.js', 'scribble.js'], height: 460 } };
/** The room both players' web games join: the first six characters of the game id, upper case (the game id alphabet is the room code alphabet). */
export const roomCodeOf = (gid) => String(gid).slice(0, 6).toUpperCase();
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


// ---- Chess and Checkers (BoardGames.swift) ----
//
// Squares are numbered 0..63, row by row from the top-left (row 0 is the far side from the first player). The first player is white
// in Chess and moves up the screen in Checkers. Both players run the same rules on every message, and an illegal move changes nothing.

const inside = (r, c) => r >= 0 && r < 8 && c >= 0 && c < 8;
const KNIGHT_STEPS = [[-2, -1], [-2, 1], [-1, -2], [-1, 2], [1, -2], [1, 2], [2, -1], [2, 1]];
const KING_STEPS = [[-1, -1], [-1, 0], [-1, 1], [0, -1], [0, 1], [1, -1], [1, 0], [1, 1]];
const ROOK_DIRS = [[-1, 0], [1, 0], [0, -1], [0, 1]];
const BISHOP_DIRS = [[-1, -1], [-1, 1], [1, -1], [1, 1]];
export const CHESS_PROMOTIONS = ['q', 'r', 'b', 'n'];

/** A new chess game. Uppercase is white (the first player), lowercase black, "." empty. Row 0 is rank 8. `outcome` is null while the game
 *  goes on, else checkmate, stalemate, fifty, repetition or material. */
export const newChess = () => ({
  board: Array.from('rnbqkbnrpppppppp' + '.'.repeat(32) + 'PPPPPPPPRNBQKBNR'),
  turn: 0,
  castle: [true, true, true, true],        // white kingside, white queenside, black kingside, black queenside
  enPassant: null,                         // the square a pawn that just moved two squares passed over
  quiet: 0,                                // half-moves since the last capture or pawn move
  moves: 0,                                // half-moves played (also the message number)
  last: null,                              // [from, to] of the last move
  check: false,                            // the side to move is in check
  outcome: null,
  seen: {},
});

export const chessSide = (ch, sq) => { const c = ch.board[sq]; return c === '.' ? null : (c === c.toUpperCase() ? 0 : 1); };
export const chessKingSquare = (ch, side) => ch.board.indexOf(side === 0 ? 'K' : 'k');
/** The player who delivered checkmate, if that is how it ended. */
export const chessWinnerIndex = (ch) => (ch.outcome === 'checkmate' ? 1 - ch.turn : null);

/** True when a piece of `by` could capture on `square` (ignoring pins). */
export function chessAttacked(ch, square, by) {
  const r = Math.floor(square / 8), c = square % 8, b = ch.board;
  const piece = (x) => (by === 0 ? x.toUpperCase() : x);
  const pr = r + (by === 0 ? 1 : -1);
  for (const dc of [-1, 1]) if (inside(pr, c + dc) && b[pr * 8 + c + dc] === piece('p')) return true;
  for (const [dr, dc] of KNIGHT_STEPS) if (inside(r + dr, c + dc) && b[(r + dr) * 8 + c + dc] === piece('n')) return true;
  for (const [dr, dc] of KING_STEPS) if (inside(r + dr, c + dc) && b[(r + dr) * 8 + c + dc] === piece('k')) return true;
  for (const [dirs, kinds] of [[ROOK_DIRS, ['r', 'q']], [BISHOP_DIRS, ['b', 'q']]]) {
    for (const [dr, dc] of dirs) {
      let rr = r + dr, cc = c + dc;
      while (inside(rr, cc)) {
        const x = b[rr * 8 + cc];
        if (x !== '.') { if (kinds.some((k) => piece(k) === x)) return true; break; }
        rr += dr; cc += dc;
      }
    }
  }
  return false;
}

/** Where the piece on `from` could go before the "don't leave your king in check" rule. */
function chessPseudoTargets(ch, from) {
  const me = chessSide(ch, from);
  if (me === null) return [];
  const r = Math.floor(from / 8), c = from % 8, b = ch.board, out = [];
  const addIfFreeOrEnemy = (rr, cc) => { if (inside(rr, cc) && chessSide(ch, rr * 8 + cc) !== me) out.push(rr * 8 + cc); };
  const kind = b[from].toLowerCase();
  if (kind === 'p') {
    const dir = me === 0 ? -1 : 1, start = me === 0 ? 6 : 1;
    if (inside(r + dir, c) && b[(r + dir) * 8 + c] === '.') {
      out.push((r + dir) * 8 + c);
      if (r === start && b[(r + 2 * dir) * 8 + c] === '.') out.push((r + 2 * dir) * 8 + c);
    }
    for (const dc of [-1, 1]) {
      if (!inside(r + dir, c + dc)) continue;
      const to = (r + dir) * 8 + c + dc, other = chessSide(ch, to);
      if (other !== null && other !== me) out.push(to); else if (to === ch.enPassant) out.push(to);
    }
  } else if (kind === 'n') {
    for (const [dr, dc] of KNIGHT_STEPS) addIfFreeOrEnemy(r + dr, c + dc);
  } else if (kind === 'k') {
    for (const [dr, dc] of KING_STEPS) addIfFreeOrEnemy(r + dr, c + dc);
    const home = me === 0 ? 60 : 4;
    if (from === home && !ch.check) {
      const rook = me === 0 ? 'R' : 'r';
      if (ch.castle[me * 2] && b[home + 3] === rook && b[home + 1] === '.' && b[home + 2] === '.' && !chessAttacked(ch, home + 1, 1 - me)) out.push(home + 2);
      if (ch.castle[me * 2 + 1] && b[home - 4] === rook && b[home - 1] === '.' && b[home - 2] === '.' && b[home - 3] === '.' && !chessAttacked(ch, home - 1, 1 - me)) out.push(home - 2);
    }
  } else {
    const dirs = kind === 'r' ? ROOK_DIRS : kind === 'b' ? BISHOP_DIRS : [...ROOK_DIRS, ...BISHOP_DIRS];
    for (const [dr, dc] of dirs) {
      let rr = r + dr, cc = c + dc;
      while (inside(rr, cc)) {
        const owner = chessSide(ch, rr * 8 + cc);
        if (owner === me) break;
        out.push(rr * 8 + cc);
        if (owner !== null) break;
        rr += dr; cc += dc;
      }
    }
  }
  return out;
}

/** Moves the piece (and the rook when castling, the captured pawn when taking en passant) without checking anything. */
function chessPlace(ch, from, to, promotion) {
  const b = ch.board;
  let piece = b[from];
  const pawn = piece === 'P' || piece === 'p';
  if (pawn && to === ch.enPassant && b[to] === '.' && from % 8 !== to % 8) b[Math.floor(from / 8) * 8 + (to % 8)] = '.';
  if ((piece === 'K' || piece === 'k') && Math.abs((to % 8) - (from % 8)) === 2) {
    const kingside = to % 8 > from % 8;
    const rookFrom = kingside ? from + 3 : from - 4, rookTo = kingside ? from + 1 : from - 1;
    b[rookTo] = b[rookFrom]; b[rookFrom] = '.';
  }
  if (pawn && (Math.floor(to / 8) === 0 || Math.floor(to / 8) === 7)) {
    const chosen = promotion || 'q';
    piece = piece === 'P' ? chosen.toUpperCase() : chosen;
  }
  b[to] = piece; b[from] = '.';
}

/** Squares the piece on `from` may legally move to now (empty if it isn't that side's turn or the game is over). */
export function chessLegalTargets(ch, from) {
  if (ch.outcome !== null || !Number.isInteger(from) || from < 0 || from > 63) return [];
  const me = chessSide(ch, from);
  if (me === null || me !== ch.turn) return [];
  return chessPseudoTargets(ch, from).filter((to) => {
    const copy = { ...ch, board: ch.board.slice() };       // (only the board is touched; `seen` is shared and left alone)
    chessPlace(copy, from, to, 'q');
    const king = chessKingSquare(copy, me);
    return king >= 0 && !chessAttacked(copy, king, 1 - me);
  });
}

export const chessIsPromotion = (ch, from, to) => (ch.board[from] === 'P' && Math.floor(to / 8) === 0) || (ch.board[from] === 'p' && Math.floor(to / 8) === 7);

/** Neither side can ever give mate: only kings, or kings and one knight or bishop. */
export function chessInsufficientMaterial(ch) {
  const rest = ch.board.filter((x) => x !== '.' && x !== 'K' && x !== 'k');
  return rest.length === 0 || (rest.length === 1 && 'nNbB'.includes(rest[0]));
}

/** Plays a legal move on `ch` (changed in place). `promotion` is q, r, b or n and only matters when a pawn reaches the last row (queen if
 *  missing). Returns false, having changed nothing, when the move is not legal. */
export function chessPlay(ch, from, to, promotion) {
  if (!chessLegalTargets(ch, from).includes(to)) return false;
  if (promotion != null && !CHESS_PROMOTIONS.includes(promotion)) return false;
  const me = ch.turn, piece = ch.board[from], pawn = piece === 'P' || piece === 'p';
  const capture = ch.board[to] !== '.' || (pawn && to === ch.enPassant);
  chessPlace(ch, from, to, promotion);
  // Castling rights go when the king or a rook moves, or a rook is taken.
  if (piece === 'K') { ch.castle[0] = false; ch.castle[1] = false; }
  if (piece === 'k') { ch.castle[2] = false; ch.castle[3] = false; }
  for (const sq of [from, to]) {
    if (sq === 63) ch.castle[0] = false; else if (sq === 56) ch.castle[1] = false; else if (sq === 7) ch.castle[2] = false; else if (sq === 0) ch.castle[3] = false;
  }
  ch.enPassant = pawn && Math.abs(to - from) === 16 ? (from + to) / 2 : null;
  ch.quiet = capture || pawn ? 0 : ch.quiet + 1;
  ch.turn = 1 - me; ch.moves += 1; ch.last = [from, to];
  const king = chessKingSquare(ch, ch.turn);
  ch.check = king >= 0 ? chessAttacked(ch, king, me) : false;
  const key = `${ch.board.join('')}|${ch.turn}|${ch.castle.join(',')}|${ch.enPassant ?? -1}`;
  ch.seen[key] = (ch.seen[key] || 0) + 1;
  let canMove = false;
  for (let sq = 0; sq < 64 && !canMove; sq++) canMove = chessLegalTargets(ch, sq).length > 0;
  if (!canMove) ch.outcome = ch.check ? 'checkmate' : 'stalemate';
  else if (ch.quiet >= 100) ch.outcome = 'fifty';
  else if (ch.seen[key] >= 3) ch.outcome = 'repetition';
  else if (chessInsufficientMaterial(ch)) ch.outcome = 'material';
  return true;
}

export const chessDescribe = (outcome) => ({
  checkmate: 'Checkmate', stalemate: 'Stalemate', fifty: 'Draw: fifty moves without a capture or pawn move',
  repetition: 'Draw: the same position three times', material: 'Draw: not enough pieces left to mate',
}[outcome] || '');

/** A new checkers game (English draughts, 8 x 8). "a"/"A" is the first player's man/king (starts at the bottom, moves up), "b"/"B" the
 *  second player's. Pieces live on dark squares (row + column odd). `winnerIndex` null with `over` set means a draw. */
export const newCheckers = () => {
  const board = Array(64).fill('.');
  for (let sq = 0; sq < 64; sq++) {
    if ((Math.floor(sq / 8) + (sq % 8)) % 2 === 1) { if (Math.floor(sq / 8) < 3) board[sq] = 'b'; else if (Math.floor(sq / 8) > 4) board[sq] = 'a'; }
  }
  return { board, turn: 0, chain: null, moves: 0, quiet: 0, last: null, over: false, winnerIndex: null };
};

const ckSide = (k, sq) => { const x = k.board[sq]; return x === 'a' || x === 'A' ? 0 : x === 'b' || x === 'B' ? 1 : null; };
const ckIsKing = (k, sq) => k.board[sq] === 'A' || k.board[sq] === 'B';
const ckDirections = (k, sq) => (ckIsKing(k, sq) ? [[-1, -1], [-1, 1], [1, -1], [1, 1]] : ckSide(k, sq) === 0 ? [[-1, -1], [-1, 1]] : [[1, -1], [1, 1]]);

function ckJumps(k, sq) {
  const me = ckSide(k, sq);
  if (me === null) return [];
  const r = Math.floor(sq / 8), c = sq % 8, out = [];
  for (const [dr, dc] of ckDirections(k, sq)) {
    if (inside(r + 2 * dr, c + 2 * dc) && ckSide(k, (r + dr) * 8 + c + dc) === 1 - me && k.board[(r + 2 * dr) * 8 + c + 2 * dc] === '.') out.push((r + 2 * dr) * 8 + c + 2 * dc);
  }
  return out;
}
function ckSteps(k, sq) {
  const r = Math.floor(sq / 8), c = sq % 8, out = [];
  for (const [dr, dc] of ckDirections(k, sq)) if (inside(r + dr, c + dc) && k.board[(r + dr) * 8 + c + dc] === '.') out.push((r + dr) * 8 + c + dc);
  return out;
}

/** True when `side` has a capture available somewhere (then it must capture). */
export function checkersMustCapture(k, side) {
  for (let sq = 0; sq < 64; sq++) if (ckSide(k, sq) === side && ckJumps(k, sq).length) return true;
  return false;
}

/** Squares the piece on `from` may move to now (a jump while one is compulsory or in progress). */
export function checkersLegalTargets(k, from) {
  if (k.over || !Number.isInteger(from) || from < 0 || from > 63 || ckSide(k, from) !== k.turn) return [];
  if (k.chain !== null) return from === k.chain ? ckJumps(k, from) : [];
  return checkersMustCapture(k, k.turn) ? ckJumps(k, from) : ckSteps(k, from);
}

/** Plays a legal move on `k` (changed in place). A jump continues with the same piece while another jump is possible, and stops when a
 *  man is crowned. Every hop is one move (and one message). Returns false, having changed nothing, when it is not legal. */
export function checkersPlay(k, from, to) {
  if (!checkersLegalTargets(k, from).includes(to)) return false;
  const me = k.turn, wasKing = ckIsKing(k, from);
  const jumped = Math.abs(Math.floor(to / 8) - Math.floor(from / 8)) === 2;
  if (jumped) k.board[((Math.floor(from / 8) + Math.floor(to / 8)) / 2) * 8 + (from % 8 + (to % 8)) / 2] = '.';
  k.board[to] = k.board[from]; k.board[from] = '.';
  let crowned = false;
  if (!wasKing && Math.floor(to / 8) === (me === 0 ? 0 : 7)) { k.board[to] = me === 0 ? 'A' : 'B'; crowned = true; }
  k.moves += 1; k.last = [from, to];
  k.quiet = jumped || !wasKing ? 0 : k.quiet + 1;
  if (jumped && !crowned && ckJumps(k, to).length) k.chain = to; else { k.chain = null; k.turn = 1 - me; }
  // The game is over when the side to move has nothing left to move, or after a long stretch with no progress.
  if (k.chain === null) {
    let canMove = false;
    for (let sq = 0; sq < 64 && !canMove; sq++) canMove = checkersLegalTargets(k, sq).length > 0;
    if (!canMove) { k.over = true; k.winnerIndex = me; } else if (k.quiet >= 80) { k.over = true; k.winnerIndex = null; }
  }
  return true;
}

/** Where `id` may move the piece on `from` right now in Chess or Checkers (empty when it is not their turn). */
export function boardTargets(s, id, from) {
  if (!s || s.status !== 'playing') return [];
  const me = indexOf(s, id);
  if (me === null) return [];
  if (s.kind === 'ch') return s.chess.turn === me ? chessLegalTargets(s.chess, from) : [];
  if (s.kind === 'ck') return s.checkers.turn === me ? checkersLegalTargets(s.checkers, from) : [];
  return [];
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
    case 'move':
      if (!isInt(m.r, 0, 1000)) return null;
      if (m.g === 'ch' || m.g === 'ck') return ok(isInt(m.n, 0, 800) && isInt(m.a, 0, 63) && isInt(m.b, 0, 63) && (m.s === undefined || CHESS_PROMOTIONS.includes(m.s)));   // a from, b to, s promotion
      return ok(isInt(m.n, 0, 100) && isInt(m.a, 0, 6));
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
    chess: newChess(), checkers: newCheckers(),
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
  if (s.kind === 'ch') return applyChess(s, m, idx);
  if (s.kind === 'ck') return applyCheckers(s, m, idx);
  if (s.kind === 'rl' || s.kind === 'sk') return false;     // only the lobby is in the session; the game runs live between the two web views
  return applyBattleship(s, m, idx);
}

function applyChess(s, m, idx) {
  const ch = s.chess;
  if (m.op !== 'move' || m.n !== ch.moves || idx !== ch.turn || m.a === undefined || m.b === undefined || !chessPlay(ch, m.a, m.b, m.s)) return false;
  if (ch.outcome !== null) finish(s, chessWinnerIndex(ch));
  return true;
}

function applyCheckers(s, m, idx) {
  const k = s.checkers;
  if (m.op !== 'move' || m.n !== k.moves || idx !== k.turn || m.a === undefined || m.b === undefined || !checkersPlay(k, m.a, m.b)) return false;
  if (k.over) finish(s, k.winnerIndex);
  return true;
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
        s.c4 = f.c4; s.rps = f.rps; s.bs = f.bs; s.chess = f.chess; s.checkers = f.checkers; s.stash = [];
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
/** Chess and Checkers: a move from one square to another (`promotion` only for a pawn reaching the last row in Chess). */
export const boardMoveMsg = (s, from, to, promotion) => ({
  g: s.kind, op: 'move', gid: s.gid, r: s.round, n: s.kind === 'ch' ? s.chess.moves : s.checkers.moves, a: from, b: to, ...(promotion ? { s: promotion } : null),
});
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
    /** Chess and Checkers: move the piece on `from` to `to` (an illegal move is never sent). */
    move(from, to, promotion) {
      const s = s0();
      if (s && boardTargets(s, idOf(), from).includes(to)) send(boardMoveMsg(s, from, to, promotion));   // (checked first, so a move out of turn is not even stashed or sent)
    },
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
