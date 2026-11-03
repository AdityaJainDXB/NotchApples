// Tic-tac-toe in a Messenger room: the rules with no screen, no network and no imports (so Node tests load this file as it is).
// Mirrored by NotchApple/Modules/Messenger/TicTacToeLogic.swift; keep the two in step (the tests on both sides use the same cases).
//
// Both players run the same `reduce` on every game message, their own moves included, so they always agree:
//   state = reduce(state, msg, fromSenderID)
// An illegal, duplicate, stale or foreign message returns the SAME state object (`next === state` means "ignored").
//
// Wire message (`game` field of a Messenger envelope):
//   { g:'ttt', op, gid, ... }   op = invite | accept | start | move | rematch | quit | cancel
//   invite  {mark:'X'|'O'}      the inviter picks their own mark (X always moves first)
//   accept  {}                  anyone else in the room says yes
//   start   {x, o}              the inviter picks the first acceptor: x and o are sender IDs, and one of them is the inviter
//   move    {r, n, cell}        round r, move number n (0 = X's first move), cell 0..8
//   rematch {r}                 asks for another round; when both asked, the marks swap
//   quit    {}                  I'm leaving the game (the app also sends this for you when a player leaves the room)
//   cancel  {}                  the inviter withdraws an open invite
// States: invited -> playing -> won | draw | ended (a player left); an open invite can end as cancelled.

export const LINES = [[0, 1, 2], [3, 4, 5], [6, 7, 8], [0, 3, 6], [1, 4, 7], [2, 5, 8], [0, 4, 8], [2, 4, 6]];
const OPS = new Set(['invite', 'accept', 'start', 'move', 'rematch', 'quit', 'cancel']);
const MAX_PENDING = 18;
const isInt = (v, lo, hi) => Number.isInteger(v) && v >= lo && v <= hi;
const isId = (v) => typeof v === 'string' && v.length > 0 && v.length <= 64;

/// The winner of a board ('X' / 'O') with its line, 'draw' when full, or null while it is still going.
export function outcome(board) {
  for (const line of LINES) {
    const [a, b, c] = line;
    if (board[a] && board[a] === board[b] && board[a] === board[c]) return { winner: board[a], line };
  }
  return board.every(Boolean) ? { winner: 'draw', line: null } : null;
}

/// Cleans anything that came off the network: returns a safe message or null. Unknown fields are dropped.
export function parse(raw) {
  if (!raw || typeof raw !== 'object' || raw.g !== 'ttt' || !OPS.has(raw.op) || !isId(raw.gid)) return null;
  const m = { g: 'ttt', op: raw.op, gid: raw.gid };
  if (raw.op === 'invite') { if (raw.mark !== 'X' && raw.mark !== 'O') return null; m.mark = raw.mark; }
  if (raw.op === 'start') { if (!isId(raw.x) || !isId(raw.o) || raw.x === raw.o) return null; m.x = raw.x; m.o = raw.o; }
  if (raw.op === 'move') {
    if (!isInt(raw.r, 0, 1000) || !isInt(raw.n, 0, 8) || !isInt(raw.cell, 0, 8)) return null;
    m.r = raw.r; m.n = raw.n; m.cell = raw.cell;
  }
  if (raw.op === 'rematch') { if (!isInt(raw.r, 0, 1000)) return null; m.r = raw.r; }
  return m;
}

const isTerminal = (s) => ['won', 'draw', 'ended', 'cancelled'].includes(s.status);
const isPlayer = (s, id) => id === s.x || id === s.o;

/// X when an even number of moves has been made, otherwise O. Returns the sender ID whose turn it is.
export const turnPlayer = (s) => (s.moves % 2 === 0 ? s.x : s.o);
export const markOf = (s, id) => (id === s.x ? 'X' : id === s.o ? 'O' : null);

function fresh(gid, inviter, inviterMark) {
  return {
    gid, status: 'invited', inviter, inviterMark, accepted: null,
    x: null, o: null, board: Array(9).fill(null), moves: 0, round: 0,
    winner: null, line: null, leaver: null, rematch: [], pending: [],
  };
}

/// The state after `msg` (from sender `from`) is applied. The very same object comes back when the message is ignored.
export function reduce(state, rawMsg, from) {
  const msg = parse(rawMsg);
  if (!msg || !isId(from)) return state;

  if (msg.op === 'invite') {
    // One game per room at a time: a new invite only replaces nothing or a finished game.
    if (state && !isTerminal(state)) return state;
    return fresh(msg.gid, from, msg.mark);
  }
  if (!state || state.gid !== msg.gid) return state;

  switch (msg.op) {
    case 'accept':
      if (state.status !== 'invited' || from === state.inviter || state.accepted) return state;
      return { ...state, accepted: from };
    case 'cancel':
      if (state.status !== 'invited' || from !== state.inviter) return state;
      return { ...state, status: 'cancelled' };
    case 'start': {
      if (state.status !== 'invited' || from !== state.inviter) return state;
      const inviterIsX = msg.x === state.inviter;
      if (!inviterIsX && msg.o !== state.inviter) return state;            // the inviter must play
      if ((inviterIsX ? 'X' : 'O') !== state.inviterMark) return state;    // and keep the mark they chose
      return drain({ ...state, status: 'playing', x: msg.x, o: msg.o });   // moves that beat the start message are applied now
    }
    case 'quit':
      if (isTerminal(state) && state.status !== 'won' && state.status !== 'draw') return state;
      if (state.status === 'invited') return from === state.inviter ? { ...state, status: 'cancelled' } : state;
      if (!isPlayer(state, from)) return state;
      return { ...state, status: 'ended', leaver: from };
    case 'rematch': {
      if ((state.status !== 'won' && state.status !== 'draw') || msg.r !== state.round || !isPlayer(state, from)) return state;
      if (state.rematch.includes(from)) return state;
      const asked = [...state.rematch, from];
      if (asked.length < 2) return { ...state, rematch: asked };
      // Both agreed: a clean board, the marks swap, and moves that already arrived for the new round are applied.
      const next = { ...state, status: 'playing', x: state.o, o: state.x, board: Array(9).fill(null), moves: 0,
        round: state.round + 1, winner: null, line: null, rematch: [], pending: state.pending.filter((p) => p.r > state.round) };
      return drain(next);
    }
    case 'move': {
      if (state.status === 'playing' || state.status === 'invited') {
        if (msg.r < state.round || (msg.r === state.round && msg.n < state.moves)) return state; // old or duplicate
        if (state.status === 'playing' && msg.r === state.round && msg.n === state.moves
          && (turnPlayer(state) !== from || state.board[msg.cell])) return state;                  // it is due now and it's illegal
        const queued = state.pending.some((p) => p.r === msg.r && p.n === msg.n && p.from === from);
        if (queued) return state;
        if (state.status === 'playing' && !isPlayer(state, from)) return state;                    // not in this game
        if (state.status === 'invited' && from !== state.inviter && from !== state.accepted) return state;
        if (state.pending.length >= MAX_PENDING) return state;
        return drain({ ...state, pending: [...state.pending, { r: msg.r, n: msg.n, cell: msg.cell, from }] });
      }
      // After a win or draw only the next round's early moves matter; hold them for the rematch.
      if ((state.status === 'won' || state.status === 'draw') && isPlayer(state, from) && msg.r === state.round + 1
        && state.pending.length < MAX_PENDING && !state.pending.some((p) => p.r === msg.r && p.n === msg.n && p.from === from)) {
        return { ...state, pending: [...state.pending, { r: msg.r, n: msg.n, cell: msg.cell, from }] };
      }
      return state;
    }
  }
  return state;
}

/// Applies queued moves that are now next in line (same round, move number = moves made, right player, empty cell).
function drain(s) {
  let state = s;
  while (state.status === 'playing') {
    const want = turnPlayer(state);
    const i = state.pending.findIndex((p) => p.r === state.round && p.n === state.moves && p.from === want);
    if (i < 0) break;
    const p = state.pending[i];
    const rest = state.pending.filter((_, j) => j !== i);
    if (state.board[p.cell]) { state = { ...state, pending: rest }; continue; }               // occupied: drop it
    const board = state.board.slice();
    board[p.cell] = markOf(state, p.from);
    const end = outcome(board);
    state = { ...state, board, moves: state.moves + 1, pending: rest.filter((q) => q.r >= state.round),
      status: end ? (end.winner === 'draw' ? 'draw' : 'won') : 'playing', winner: end ? end.winner : null, line: end ? end.line : null };
  }
  // Drop leftovers that can never apply any more (earlier rounds or already-played move numbers).
  const keep = state.pending.filter((p) => p.r > state.round || (p.r === state.round && p.n >= state.moves));
  return keep.length === state.pending.length ? state : { ...state, pending: keep };
}

// ---- building messages (the app sends these, after checking them with `reduce` on its own state) ----

export const newGameId = (rand = Math.random) => Array.from({ length: 12 }, () => 'abcdefghjkmnpqrstuvwxyz23456789'[Math.floor(rand() * 31)]).join('');
export const inviteMsg = (gid, mark) => ({ g: 'ttt', op: 'invite', gid, mark });
export const acceptMsg = (gid) => ({ g: 'ttt', op: 'accept', gid });
export const cancelMsg = (gid) => ({ g: 'ttt', op: 'cancel', gid });
export const quitMsg = (gid) => ({ g: 'ttt', op: 'quit', gid });
export const rematchMsg = (s) => ({ g: 'ttt', op: 'rematch', gid: s.gid, r: s.round });
export const moveMsg = (s, cell) => ({ g: 'ttt', op: 'move', gid: s.gid, r: s.round, n: s.moves, cell });
/// The inviter's answer to the first accept: who is X and who is O follows the mark the inviter chose.
export const startMsg = (s, acceptor) => ({ g: 'ttt', op: 'start', gid: s.gid,
  x: s.inviterMark === 'X' ? s.inviter : acceptor, o: s.inviterMark === 'X' ? acceptor : s.inviter });

/// True when `id` may play `cell` right now (used by the board to enable cells; `reduce` is still the judge).
export const canMove = (s, id, cell) => !!s && s.status === 'playing' && turnPlayer(s) === id && isInt(cell, 0, 8) && !s.board[cell];
