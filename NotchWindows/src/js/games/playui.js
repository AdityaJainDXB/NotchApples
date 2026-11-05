// The screens for the two-player games in a Messenger room or a friend chat: the Games menu, the tic-tac-toe card, and the
// card for Connect Four, Rock Paper Scissors, Battleship, Chess and Checkers (an invite with Accept, then the board, then Rematch). The Mac's
// PlayCards.swift is the model. The rules are in tictactoe-logic.js and twoplayer-logic.js; this file only draws them and passes
// the player's choices on, so rooms (services/messenger.js) and friend chats (services/friends.js) share it.
import { el } from '../store.js';
import { button, menu } from '../ui.js';
import * as P from './twoplayer-logic.js';
import * as T from './tictactoe-logic.js';

// ---- the notch grows while a board is showing (800 x 600 at least, like the Mac) ----

const growing = new Map();
/** Tells the window a board is (or is no longer) on screen in `source` ('room' or 'friend'). Safe to call on every repaint. */
export function grow(source, on) {
  on = !!on;
  if (growing.get(source) === on) return;
  growing.set(source, on);
  import('../app.js').then((a) => a.chatGame?.(source, on)).catch(() => {});
}

// ---- the Games menu ----

/** The "Games" button in a chat header. `tictactoe()` and `start(kind)` are called when one is picked. */
export function gamesButton({ tictactoe, start }) {
  return button('🎮 Games', (e) => menu(e, [
    { label: '⭕ Tic-tac-toe', run: tictactoe },
    ...P.KINDS.map((k) => ({ label: `${P.EMOJI[k]} ${P.TITLES[k]}`, run: () => start(k) })),
  ]), { small: true, kind: 'quiet', title: 'Invite them to a two-player game' });
}

const card = (...kids) => el('div', { class: 'card col gap-6', style: 'padding:10px;margin-bottom:6px;align-items:center;flex:none' }, ...kids);
const btn = (label, fn, kind = '', disabled = false) => button(label, fn, { small: true, kind, disabled });
const dim = (text, extra = '') => el('div', { class: 'tiny dim', style: extra }, text);

// ---- tic-tac-toe ----

const TTT_OVER = ['won', 'draw', 'ended', 'cancelled'];
export const tttOpen = (g) => !!g && !TTT_OVER.includes(g.status);

/** The tic-tac-toe card: an invite with Accept, or the 3x3 board with the status line and Rematch.
 *  `nm(id)` names a player; `act` has accept, cancel, close, move(cell), rematch, quit. */
export function tttCard(g, me, nm, act) {
  if (!g) return null;
  if (g.status === 'invited' || g.status === 'cancelled') {
    const mine = g.inviter === me;
    const line = g.status === 'cancelled' ? `${nm(g.inviter)} cancelled the tic-tac-toe invite.`
      : mine ? `Waiting for someone to accept your tic-tac-toe invite (you play ${g.inviterMark})…`
        : g.accepted === me ? `Waiting for ${nm(g.inviter)} to start (they play ${g.inviterMark})…`
          : `${nm(g.inviter)} invites you to tic-tac-toe. They play ${g.inviterMark}.`;
    return card(el('div', { class: 'small' }, '🎮 ' + line), el('div', { class: 'hstack' },
      g.status === 'cancelled' ? btn('Close', act.close, 'quiet')
        : mine ? btn('Cancel invite', act.cancel, 'quiet')
          : g.accepted === me ? null : btn('Accept', act.accept)));
  }
  const mark = T.markOf(g, me), playing = g.status === 'playing', yours = playing && T.turnPlayer(g) === me;
  const opp = mark ? nm(mark === 'X' ? g.o : g.x) : null;
  const status = g.status === 'won' ? (mark ? (g.winner === mark ? 'You won! 🎉' : `${opp} won`) : `${nm(g.winner === 'X' ? g.x : g.o)} won`)
    : g.status === 'draw' ? 'A draw'
      : g.status === 'ended' ? `${g.leaver === me ? 'You' : nm(g.leaver)} left the game`
        : yours ? 'Your turn' : `${nm(T.turnPlayer(g))}'s turn`;
  const head = mark ? `You are ${mark} · ${opp} is ${mark === 'X' ? 'O' : 'X'}` : `Watching ${nm(g.x)} (X) vs ${nm(g.o)} (O)`;
  const board = el('div', { style: 'display:grid;grid-template-columns:repeat(3,52px);gap:4px' }, ...g.board.map((c, i) => {
    const win = g.line?.includes(i);
    return el('button', {
      class: 'btn quiet', disabled: !T.canMove(g, me, i), onclick: () => act.move(i), 'aria-label': `Cell ${i + 1}${c ? ', ' + c : ''}`,
      style: `width:52px;height:52px;font-size:26px;font-weight:800;padding:0;${win ? 'background:var(--accent);color:var(--on-accent)' : ''}`,
    }, c || '');
  }));
  const asked = g.rematch.includes(me);
  return card(dim('🎮 Tic-tac-toe · ' + head), board, el('div', { class: 'small', style: yours ? 'font-weight:700' : '' }, status),
    el('div', { class: 'hstack' },
      (g.status === 'won' || g.status === 'draw') && mark ? btn(asked ? 'Waiting for a rematch…' : 'Rematch', act.rematch, asked ? 'quiet' : '', asked) : null,
      playing && mark ? btn('Leave game', act.quit, 'quiet') : null,
      !playing ? btn('Close', act.close, 'quiet') : null));
}

// ---- Connect Four, Rock Paper Scissors, Battleship ----

/** The card for the controller's current game (`createPlayController`), or null when there is none. */
export function playCard(play) {
  const s = play.session;
  if (!s) return null;
  const me = P.indexOf(s, play.myID), nm = play.name;
  if (s.status === 'invited' || s.status === 'cancelled') return inviteCard(play, s);
  const myTurn = (() => {
    if (s.status !== 'playing' || me === null) return false;
    if (s.kind === 'c4') return s.c4.moves % 2 === me;
    if (s.kind === 'rps') return s.rps.commit[me] === null;
    if (s.kind === 'ch') return s.chess.turn === me;
    if (s.kind === 'ck') return s.checkers.turn === me;
    return P.bothReady(s.bs) ? P.shooter(s.bs) === me : !play.iCommittedFleet;
  })();
  const board = s.kind === 'c4' ? connectFour(play, s) : s.kind === 'rps' ? rps(play, s, me) : s.kind === 'bs' ? battleship(play, s, me) : boardGame(play, s, me);
  return card(
    dim(`${P.EMOJI[s.kind]} ${P.TITLES[s.kind]} · ${headline(play, s, me)}`),
    board,
    el('div', { class: 'small', style: `text-align:center;${myTurn ? 'font-weight:700' : ''}` }, statusLine(play, s, me, myTurn)),
    el('div', { class: 'hstack' },
      s.status === 'finished' && me !== null ? (() => { const asked = s.rematch.includes(play.myID); return btn(asked ? 'Waiting for a rematch…' : 'Rematch', () => play.rematch(), asked ? 'quiet' : '', asked); })() : null,
      s.status === 'playing' && me !== null ? btn('Leave game', () => play.leave(), 'quiet') : null,
      s.status !== 'playing' ? btn('Close', () => play.close(), 'quiet') : null));
}

function inviteCard(play, s) {
  const who = play.name(s.inviter), mine = s.inviter === play.myID;
  const line = s.status === 'cancelled' ? `${who} cancelled the ${P.TITLES[s.kind]} invite.`
    : mine ? `Waiting for someone to accept your ${P.TITLES[s.kind]} invite…`
      : s.accepted === play.myID ? `Waiting for ${who} to start…`
        : `${who} invites you to play ${P.TITLES[s.kind]}.`;
  return card(el('div', { class: 'small' }, `${P.EMOJI[s.kind]} ${line}`), el('div', { class: 'hstack' },
    s.status === 'cancelled' ? btn('Close', () => play.close(), 'quiet')
      : mine ? btn('Cancel invite', () => play.cancelInvite(), 'quiet')
        : s.accepted !== play.myID ? btn('Accept', () => play.accept()) : null));
}

function headline(play, s, me) {
  const nm = play.name;
  if (me === null) return `Watching ${nm(s.p1)} vs ${nm(s.p2)}`;
  const other = nm(P.playerAt(s, 1 - me));
  if (s.kind === 'c4') return `You are ${me === 0 ? 'red' : 'yellow'} · ${other} is ${me === 0 ? 'yellow' : 'red'}`;
  if (s.kind === 'rps') return `You vs ${other} · first to ${P.RPS.wins}`;
  if (s.kind === 'ch') return `You are ${me === 0 ? 'white' : 'black'} · ${other} is ${me === 0 ? 'black' : 'white'}`;
  if (s.kind === 'ck') return `You are ${me === 0 ? 'red' : 'white'} · ${other} is ${me === 0 ? 'white' : 'red'}`;
  return `You vs ${other}`;
}

function statusLine(play, s, me, myTurn) {
  const nm = play.name;
  if (s.status === 'finished') {
    const reason = s.kind === 'ch' ? P.chessDescribe(s.chess.outcome) : '';
    if (s.winner === null) return reason || 'A draw';
    const result = me !== null && s.winner === play.myID ? 'You won! 🎉' : `${nm(s.winner)} won`;
    return reason ? `${reason} · ${result}` : result;
  }
  if (s.status === 'ended') return `${nm(s.leaver)} left the game`;
  if (s.kind === 'c4') return myTurn ? 'Your turn' : `${nm(P.playerAt(s, s.c4.moves % 2))}'s turn`;
  if (s.kind === 'ch') return myTurn ? (s.chess.check ? 'Your turn · you are in check' : 'Your turn') : `${nm(P.playerAt(s, s.chess.turn))}'s turn${s.chess.check ? ' · in check' : ''}`;
  if (s.kind === 'ck') {
    const k = s.checkers;
    return myTurn ? (k.chain !== null ? 'Keep jumping with the same piece' : P.checkersMustCapture(k, k.turn) ? 'Your turn · you must capture' : 'Your turn') : `${nm(P.playerAt(s, k.turn))}'s turn`;
  }
  if (me === null) return 'Playing…';
  const other = nm(P.playerAt(s, 1 - me));
  if (s.kind === 'rps') {
    if (s.rps.commit[me] === null) return 'Choose rock, paper or scissors';
    return s.rps.commit[1 - me] === null ? `Waiting for ${other}…` : 'Showing picks…';
  }
  if (!P.bothReady(s.bs)) return play.iCommittedFleet ? `Waiting for ${other} to place their ships…` : 'Shuffle until you like your fleet, then press Ready';
  if (s.bs.pendingCell !== null) return 'Waiting for the answer…';
  return P.shooter(s.bs) === me ? 'Your shot: pick a square in Enemy waters' : `${other} is aiming…`;
}

// ---- Connect Four ----

function connectFour(play, s) {
  const disc = (cell) => {
    const v = s.c4.cells[cell], win = s.c4.line?.includes(cell);
    const ring = win ? '3px solid #fff' : s.c4.last === cell ? '2px solid rgba(255,255,255,.6)' : '2px solid transparent';
    return el('div', { style: `width:30px;height:30px;box-sizing:border-box;border-radius:50%;border:${ring};background:${v === 1 ? '#e5484d' : v === 2 ? '#f5c518' : 'rgba(0,0,0,.55)'}` });
  };
  return el('div', { style: 'display:flex;gap:3px' }, ...Array.from({ length: P.C4.cols }, (_, col) => {
    const can = P.canDrop(s, play.myID, col);
    return el('button', {
      disabled: !can, onclick: () => play.drop(col), 'aria-label': `Drop in column ${col + 1}`,
      style: `display:flex;flex-direction:column;gap:3px;padding:3px;border:0;border-radius:10px;background:rgba(50,100,230,${can ? 0.8 : 0.55});cursor:${can ? 'pointer' : 'default'}`,
    }, ...Array.from({ length: P.C4.rows }, (_, row) => disc(row * P.C4.cols + col)));
  }));
}

// ---- Chess and Checkers ----

const GLYPH = { k: '♚', q: '♛', r: '♜', b: '♝', n: '♞', p: '♟︎' };
/** The piece I have picked up, and a pawn move waiting for the choice of piece to crown it. Kept here because the card is redrawn on every change. */
const hand = { gid: null, moves: -1, picked: null, promoting: null };

function boardGame(play, s, me) {
  const game = s.kind === 'ch' ? s.chess : s.checkers;
  if (hand.gid !== s.gid || hand.moves !== game.moves) { hand.gid = s.gid; hand.moves = game.moves; hand.picked = null; hand.promoting = null; }
  const flip = me === 1;                                    // the second player sees the board turned round, so their pieces are at the bottom
  const targets = hand.picked !== null ? P.boardTargets(s, play.myID, hand.picked) : [];
  const last = game.last || [];
  const kingInCheck = s.kind === 'ch' && s.chess.check ? P.chessKingSquare(s.chess, s.chess.turn) : -1;
  const repaint = () => { try { play.onChange(); } catch { /* the screen repaints on the next change */ } };
  const tap = (square) => {
    if (s.status !== 'playing' || me === null) return;
    if (hand.picked !== null && P.boardTargets(s, play.myID, hand.picked).includes(square)) {
      if (s.kind === 'ch' && P.chessIsPromotion(s.chess, hand.picked, square)) { hand.promoting = { from: hand.picked, to: square }; repaint(); return; }
      const from = hand.picked;
      hand.picked = null;
      play.move(from, square);
    } else {
      hand.promoting = null;
      hand.picked = P.boardTargets(s, play.myID, square).length ? square : null;
    }
    repaint();
  };
  const piece = (square) => {
    if (s.kind === 'ch') {
      const c = s.chess.board[square];
      if (c === '.') return null;
      const white = c === c.toUpperCase();
      return el('span', { style: `font-size:26px;line-height:1;color:${white ? '#fff' : '#000'};text-shadow:${white ? '0 0 2px #000,0 0 1px #000' : '0 0 2px rgba(255,255,255,.7)'}` }, GLYPH[c.toLowerCase()] || '?');
    }
    const c = s.checkers.board[square];
    if (c === '.') return null;
    return el('span', { style: `width:26px;height:26px;box-sizing:border-box;border-radius:50%;border:1.5px solid rgba(0,0,0,.45);display:grid;place-items:center;font-size:14px;line-height:1;background:${c === 'a' || c === 'A' ? '#d92626' : '#ebebeb'};color:${c === 'A' ? '#f5c518' : '#000'}` }, c === c.toUpperCase() ? '♛' : '');
  };
  const cells = [];
  for (let row = 0; row < 8; row++) {
    for (let col = 0; col < 8; col++) {
      const square = (flip ? 7 - row : row) * 8 + (flip ? 7 - col : col);
      const dark = (Math.floor(square / 8) + (square % 8)) % 2 === 1;
      const tint = [last.includes(square) ? 'rgba(255,215,0,.28)' : null, hand.picked === square ? 'rgba(60,200,90,.45)' : null, kingInCheck === square ? 'rgba(230,50,50,.5)' : null].filter(Boolean);
      cells.push(el('button', {
        disabled: s.status !== 'playing' || me === null, onclick: () => tap(square), 'aria-label': `Square ${row + 1}, ${col + 1}`,
        style: `position:relative;width:34px;height:34px;padding:0;border:0;border-radius:0;display:grid;place-items:center;cursor:${s.status === 'playing' && me !== null ? 'pointer' : 'default'};background:${tint.map((t) => `linear-gradient(${t},${t}),`).join('')}${dark ? '#8c6140' : '#ebd6b0'}`,
      }, piece(square), targets.includes(square) ? el('span', { style: 'position:absolute;width:10px;height:10px;border-radius:50%;background:rgba(60,200,90,.8)' }) : null));
    }
  }
  const grid = el('div', { style: 'display:grid;grid-template-columns:repeat(8,34px);border-radius:4px;overflow:hidden;border:1px solid rgba(0,0,0,.5)' }, ...cells);
  const crown = hand.promoting && me !== null ? el('div', { class: 'hstack', style: 'gap:6px' }, dim('Crown the pawn as'),
    ...CROWNS.map((code) => btn(GLYPH[code], () => { const { from, to } = hand.promoting; hand.promoting = null; hand.picked = null; play.move(from, to, code); }, code === 'q' ? '' : 'quiet'))) : null;
  return el('div', { class: 'col gap-6', style: 'align-items:center' }, grid, crown);
}
const CROWNS = ['q', 'r', 'b', 'n'];

// ---- Rock Paper Scissors ----

function rps(play, s, me) {
  const nm = play.name;
  if (me === null) return el('div', { style: 'font-weight:700' }, `${nm(s.p1)} ${s.rps.score[0]} – ${s.rps.score[1]} ${nm(s.p2)}`);
  const last = s.rps.last;
  return el('div', { class: 'col gap-6', style: 'align-items:center' },
    el('div', { class: 'hstack', style: 'gap:14px;font-weight:700' }, el('span', {}, `You ${s.rps.score[me]}`), el('span', { class: 'dim' }, '–'), el('span', {}, `${nm(P.playerAt(s, 1 - me))} ${s.rps.score[1 - me]}`)),
    last ? dim(`Last game: ${P.RPS.emoji[last[me]]} vs ${P.RPS.emoji[last[1 - me]]} · ${s.rps.lastWinner === null ? 'a tie' : s.rps.lastWinner === me ? 'you won it' : 'they won it'}`) : null,
    el('div', { class: 'hstack', style: 'gap:10px' }, ...[0, 1, 2].map((i) => el('button', {
      class: `btn ${play.myPick === i ? '' : 'quiet'}`, disabled: s.status !== 'playing' || s.rps.commit[me] !== null, onclick: () => play.pick(i),
      style: 'width:78px;height:62px;padding:0;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:2px',
    }, el('span', { style: 'font-size:28px;line-height:1' }, P.RPS.emoji[i]), el('span', { style: 'font-size:10px;opacity:.8' }, P.RPS.names[i])))));
}

// ---- Battleship ----

const sunkText = (lengths) => (lengths.length ? [...lengths].sort((x, y) => y - x).join(', ') : 'none');

/** A 10 x 10 grid. `own` shows a fleet (ships as blue squares); `shots` marks misses and hits on it; `tappable` lets you fire. */
function grid(play, s, { own, shots, tappable }) {
  const ships = own ? Array.from(own) : null;
  return el('div', { style: 'display:grid;grid-template-columns:repeat(10,22px);gap:1px;padding:2px;background:rgba(0,0,0,.35);border-radius:4px' },
    ...Array.from({ length: 100 }, (_, cell) => {
      const shot = shots ? shots[cell] : 0, ship = ships ? ships[cell] !== '0' : false;
      const can = tappable && P.canShoot(s, play.myID, cell);
      return el('button', {
        disabled: !can, onclick: () => play.fire(cell), 'aria-label': `Square ${Math.floor(cell / 10) + 1}, ${(cell % 10) + 1}`,
        style: `width:22px;height:22px;padding:0;border:0;position:relative;display:grid;place-items:center;font-size:12px;font-weight:800;line-height:1;color:#ff5a5f;cursor:${can ? 'crosshair' : 'default'};background:${ship ? 'rgba(60,110,230,.75)' : can ? 'rgba(255,255,255,.14)' : 'rgba(255,255,255,.08)'}`,
      }, shot === 2 ? '✕' : shot === 1 ? el('span', { style: 'width:5px;height:5px;border-radius:50%;background:rgba(255,255,255,.55)' }) : '');
    }));
}

function battleship(play, s, me) {
  if (me === null) return dim('Watching a Battleship game', 'font-size:11px');
  const nm = play.name, other = P.playerAt(s, 1 - me);
  let boards;
  if (!P.bothReady(s.bs) && !play.iCommittedFleet) {
    // Placing ships: your fleet, then Shuffle or Ready.
    boards = el('div', { class: 'col gap-6', style: 'align-items:center' },
      dim('Your fleet'), grid(play, s, { own: play.fleet, shots: null, tappable: false }),
      el('div', { class: 'hstack' }, btn('Shuffle', () => play.shuffleFleet(), 'quiet'), btn('Ready', () => play.readyFleet())));
  } else {
    boards = el('div', { class: 'hstack', style: 'align-items:flex-start;gap:18px' },
      el('div', { class: 'col gap-4', style: 'align-items:center' }, dim('Enemy waters'), grid(play, s, { own: null, shots: s.bs.shots[1 - me], tappable: true }), dim(`Sunk: ${sunkText(s.bs.sunk[1 - me])}`)),
      el('div', { class: 'col gap-4', style: 'align-items:center' }, dim('Your fleet'), grid(play, s, { own: play.fleet, shots: s.bs.shots[me], tappable: false }), dim(`Lost: ${sunkText(s.bs.sunk[me])}`)));
  }
  let check = null;
  if (s.status === 'finished') {
    const r = s.bs.revealed[1 - me];
    check = r === true ? dim(`✅ ${nm(other)}'s fleet matched every answer they gave.`)
      : r === false ? el('div', { class: 'tiny', style: 'color:var(--warn,#e0a030);font-weight:600' }, `⚠️ ${nm(other)}'s fleet didn't match their answers. They may have cheated.`)
        : dim(`Checking ${nm(other)}'s fleet…`);
  }
  return el('div', { class: 'col gap-6', style: 'align-items:center' }, boards, check);
}
