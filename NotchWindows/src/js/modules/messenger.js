// Messenger (Pro): end-to-end encrypted rooms, compatible with the Mac app.
import { el, load, save, timeAgo } from '../store.js';
import { invoke } from '../native.js';
import { toast, prompt, segmented } from '../ui.js';
import * as MS from '../services/messenger.js';
import * as G from '../games/tictactoe-logic.js';

/// Messenger has two modes: Rooms (join a chat by a shared code) and Friends (private chat with people you add by friend code).
export function render(root) {
  let mode = load('messenger.mode', 'rooms'), stop = null;
  const body = el('div', { class: 'col fill', style: 'min-height:0' });
  const switcher = segmented([{ value: 'rooms', label: 'Rooms' }, { value: 'friends', label: 'Friends' }], mode, (m) => { mode = m; save('messenger.mode', m); show(); });
  async function show() {
    const mine = {}; show.current = mine;
    stop?.(); stop = null; body.replaceChildren();
    const cleanup = mode === 'friends' ? (await import('./messengerfriends.js')).render(body) : renderRooms(body);
    if (show.current !== mine) cleanup?.(); else stop = cleanup;
  }
  root.append(el('div', { class: 'col fill', style: 'gap:8px' }, el('div', { class: 'hstack' }, switcher), body));
  show();
  return () => { show.current = null; stop?.(); };
}

// Rooms: end-to-end encrypted rooms joined by a code (unchanged).
function renderRooms(root) {
  const wrap = el('div', { class: 'col fill' });
  root.append(wrap);
  const code = el('input', { class: 'field', placeholder: 'Room code, e.g. #study-group (longer = more private)' });
  const gameBox = el('div'), log = el('div', { class: 'col gap-6 scroll', style: 'flex:1' }), input = el('input', { class: 'field', placeholder: 'Message…' }), head = el('div', { class: 'hstack' });
  code.onkeydown = (e) => { if (e.key === 'Enter' && code.value.trim()) MS.join(code.value); };
  input.onkeydown = (e) => { if (e.key === 'Enter') { MS.send(input.value); input.value = ''; } };
  function paint(st) {
    if (!st.room) {
      wrap.replaceChildren(el('div', { class: 'center' }, el('div', { class: 'col', style: 'align-items:center;gap:10px;max-width:440px' },
        el('div', { style: 'font-size:36px' }, '💬'), el('div', { class: 'title' }, 'Chat in an encrypted room'),
        el('div', { class: 'small dim' }, 'Everyone with the same code joins the same room, on Mac or Windows. Messages are encrypted on your PC; the relay can’t read them and keeps nothing.'),
        code, el('div', { class: 'hstack' }, el('button', { class: 'btn', onclick: () => code.value.trim() && MS.join(code.value) }, 'Join'),
          el('button', { class: 'btn quiet', onclick: () => { code.value = MS.newRoomCode(); } }, 'Make a private code')),
        el('div', { class: 'tiny faint' }, `You are ${MS.identity().handle}. `, el('a', { onclick: async () => { const h = await prompt('Your name in rooms', { value: MS.identity().handle }); if (h) { MS.setHandle(h); paint(MS.state()); } } }, 'Change')))));
      return;
    }
    MS.markRead();
    head.replaceChildren(el('div', { class: 'grow' }, el('div', { class: 'title' }, `#${st.room}`),
      el('div', { class: 'tiny dim' }, st.state === 'joined' ? `${st.members.size + 1} online: you${[...st.members.values()].map((m) => `, ${m.handle}`).join('')}` : st.state === 'connecting' ? 'Connecting…' : st.error || '')),
      st.state === 'joined' && (!st.game || ['won', 'draw', 'ended', 'cancelled'].includes(st.game.status))
        ? el('button', { class: 'btn small quiet', title: 'Invite the room to a game', onclick: () => MS.gameInvite() }, '🎮 Tic-tac-toe') : null,
      el('button', { class: 'btn small quiet', onclick: () => invoke('clipboard_copy_text', { text: st.room }).then(() => toast('Room code copied')) }, 'Copy code'),
      el('button', { class: 'btn small danger', onclick: () => MS.leave() }, 'Leave'));
    gameBox.replaceChildren(...[gamePanel(st)].filter(Boolean));
    log.replaceChildren(...st.messages.map((m) => (m.notice ? el('div', { class: 'tiny faint', style: 'text-align:center' }, m.text)
      : el('div', { style: `display:flex;flex-direction:column;align-items:${m.mine ? 'flex-end' : 'flex-start'}` },
        m.mine ? null : el('div', { class: 'tiny faint' }, m.sender),
        el('div', { class: 'selectable', style: `max-width:80%;padding:7px 12px;border-radius:14px;white-space:pre-wrap;${m.mine ? 'background:var(--accent);color:var(--on-accent)' : 'background:rgba(255,255,255,.08)'}` }, m.text),
        el('div', { class: 'tiny faint' }, timeAgo(m.at))))));
    if (!st.messages.length) log.append(el('div', { class: 'small dim', style: 'text-align:center;margin-top:30px' }, 'Say hi. Share the room code with people you want here.'));
    if (!wrap.contains(log)) { wrap.replaceChildren(head, gameBox, log, input); setTimeout(() => input.focus(), 30); }
    log.scrollTop = log.scrollHeight;
  }
  return MS.subscribe(paint);
}

// The tic-tac-toe card above the chat: an invite with Accept, or the 3x3 board with the score line and Rematch.
function gamePanel(st) {
  const g = st.game;
  if (!g) return null;
  const me = MS.identity().senderID, nm = MS.nameOf;
  const card = (...kids) => el('div', { class: 'card col gap-6', style: 'padding:10px;margin-bottom:6px;align-items:center' }, ...kids);
  const btn = (label, fn, kind = '') => el('button', { class: `btn small ${kind}`, onclick: fn }, label);
  if (g.status === 'invited' || g.status === 'cancelled') {
    const mine = g.inviter === me;
    const line = g.status === 'cancelled' ? `${nm(g.inviter)} cancelled the tic-tac-toe invite.`
      : mine ? `Waiting for someone to accept your tic-tac-toe invite (you play ${g.inviterMark})…`
        : g.accepted === me ? `Waiting for ${nm(g.inviter)} to start (they play ${g.inviterMark})…`
          : `${nm(g.inviter)} invites you to tic-tac-toe. They play ${g.inviterMark}.`;
    return card(el('div', { class: 'small' }, '🎮 ' + line), el('div', { class: 'hstack' },
      g.status === 'cancelled' ? btn('Close', () => MS.gameClose(), 'quiet')
        : mine ? btn('Cancel invite', () => MS.gameCancel(), 'quiet')
          : g.accepted === me ? null : btn('Accept', () => MS.gameAccept())));
  }
  const mark = G.markOf(g, me), playing = g.status === 'playing', yours = playing && G.turnPlayer(g) === me;
  const opp = mark ? nm(mark === 'X' ? g.o : g.x) : null;
  const status = g.status === 'won' ? (mark ? (g.winner === mark ? 'You won! 🎉' : `${opp} won`) : `${nm(g.winner === 'X' ? g.x : g.o)} won`)
    : g.status === 'draw' ? 'A draw'
      : g.status === 'ended' ? `${g.leaver === me ? 'You' : nm(g.leaver)} left the game`
        : yours ? 'Your turn' : `${nm(G.turnPlayer(g))}'s turn`;
  const head = mark ? `You are ${mark} · ${opp} is ${mark === 'X' ? 'O' : 'X'}` : `Watching ${nm(g.x)} (X) vs ${nm(g.o)} (O)`;
  const board = el('div', { style: 'display:grid;grid-template-columns:repeat(3,52px);gap:4px' }, ...g.board.map((c, i) => {
    const win = g.line?.includes(i);
    return el('button', {
      class: 'btn quiet', disabled: !G.canMove(g, me, i), onclick: () => MS.gameMove(i), 'aria-label': `Cell ${i + 1}${c ? ', ' + c : ''}`,
      style: `width:52px;height:52px;font-size:26px;font-weight:800;padding:0;${win ? 'background:var(--accent);color:var(--on-accent)' : ''}`,
    }, c || '');
  }));
  const asked = g.rematch.includes(me);
  return card(el('div', { class: 'tiny dim' }, '🎮 Tic-tac-toe · ' + head), board, el('div', { class: 'small', style: yours ? 'font-weight:700' : '' }, status),
    el('div', { class: 'hstack' },
      (g.status === 'won' || g.status === 'draw') && mark ? btn(asked ? 'Waiting for a rematch…' : 'Rematch', () => MS.gameRematch(), asked ? 'quiet' : '') : null,
      playing && mark ? btn('Leave game', () => MS.gameQuit(), 'quiet') : null,
      !playing ? btn('Close', () => MS.gameClose(), 'quiet') : null));
}
