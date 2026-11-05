// Messenger (Pro): end-to-end encrypted rooms, compatible with the Mac app.
import { el, load, save, timeAgo } from '../store.js';
import { invoke } from '../native.js';
import { toast, prompt, segmented, button } from '../ui.js';
import * as MS from '../services/messenger.js';
import * as PUI from '../games/playui.js';

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
  const gameBox = el('div'), log = el('div', { class: 'col gap-6 scroll', style: 'flex:1' }), input = el('input', { class: 'field', placeholder: 'Message…', style: 'flex:1' }), head = el('div', { class: 'hstack' });
  const bar = el('div', { class: 'hstack', style: 'flex:none' });
  const size = (n) => (n < 1000 ? `${n} B` : n < 1_000_000 ? `${(n / 1000).toFixed(n < 10000 ? 1 : 0)} KB` : `${(n / 1_000_000).toFixed(1)} MB`);
  async function attach() {
    const p = await invoke('pick_file'); if (!p) return;
    const problem = await MS.sendFile(p);
    if (problem) toast(problem);
  }
  const clip = button('📎', attach, { kind: 'quiet', title: 'Send a file to the room (up to 2 MB, encrypted like a message; the room must be connected to Notch Apple’s relay)' });
  bar.append(input, clip);
  // A file is shown in Explorer when clicked. It is never opened for you.
  const fileBody = (m) => el('a', {
    style: 'cursor:pointer;display:flex;gap:8px;align-items:center', title: 'Show in Explorer (it is not opened)',
    onclick: async () => { const problem = await MS.revealFile(m.id); if (problem) toast(problem); },
  }, el('span', { style: 'font-size:20px' }, '📄'), el('span', { style: 'overflow-wrap:anywhere' }, m.file.name,
    el('div', { class: 'tiny', style: 'opacity:.7' }, m.failed ? `${size(m.file.size)} · not sent` : m.progress !== undefined ? `${size(m.file.size)} · sending ${Math.round(m.progress * 100)}%` : size(m.file.size))));
  code.onkeydown = (e) => { if (e.key === 'Enter' && code.value.trim()) MS.join(code.value); };
  input.onkeydown = (e) => { if (e.key === 'Enter') { MS.send(input.value); input.value = ''; } };
  function paint(st) {
    if (!st.room) {
      PUI.grow('room', false);
      wrap.replaceChildren(el('div', { class: 'center' }, el('div', { class: 'col', style: 'align-items:center;gap:10px;max-width:440px' },
        el('div', { style: 'font-size:36px' }, '💬'), el('div', { class: 'title' }, 'Chat in an encrypted room'),
        el('div', { class: 'small dim' }, 'Everyone with the same code joins the same room, on Mac or Windows. Messages are encrypted on your PC; the relay can’t read them and keeps nothing.'),
        code, el('div', { class: 'hstack' }, el('button', { class: 'btn', onclick: () => code.value.trim() && MS.join(code.value) }, 'Join'),
          el('button', { class: 'btn quiet', onclick: () => { code.value = MS.newRoomCode(); } }, 'Make a private code')),
        el('div', { class: 'tiny faint' }, `You are ${MS.identity().handle}. `, el('a', { onclick: async () => { const h = await prompt('Your name in rooms', { value: MS.identity().handle }); if (h) { MS.setHandle(h); paint(MS.state()); } } }, 'Change')))));
      return;
    }
    MS.markRead();
    head.replaceChildren(...[el('div', { class: 'grow' }, el('div', { class: 'title' }, `#${st.room}`),
      el('div', { class: 'tiny dim' }, st.state === 'joined' ? `${st.members.size + 1} online: you${[...st.members.values()].map((m) => `, ${m.handle}`).join('')}` : st.state === 'connecting' ? 'Connecting…' : st.error || '')),
      st.state === 'joined' && !PUI.tttOpen(st.game) && !MS.play.isActive
        ? PUI.gamesButton({ tictactoe: () => MS.gameInvite(), start: (kind) => MS.play.invite(kind) }) : null,
      el('button', { class: 'btn small quiet', onclick: () => invoke('clipboard_copy_text', { text: st.room }).then(() => toast('Room code copied')) }, 'Copy code'),
      el('button', { class: 'btn small danger', onclick: () => MS.leave() }, 'Leave')].filter(Boolean));   // (replaceChildren(null) would write the word "null")
    const cards = [gamePanel(st), PUI.playCard(MS.play)].filter(Boolean);
    gameBox.replaceChildren(...cards);
    PUI.grow('room', cards.length > 0);   // the notch opens bigger while a board is up
    log.replaceChildren(...st.messages.map((m) => (m.notice ? el('div', { class: 'tiny faint', style: 'text-align:center' }, m.text)
      : el('div', { style: `display:flex;flex-direction:column;align-items:${m.mine ? 'flex-end' : 'flex-start'}` },
        m.mine ? null : el('div', { class: 'tiny faint' }, m.sender),
        el('div', { class: 'selectable', style: `max-width:80%;padding:7px 12px;border-radius:14px;white-space:pre-wrap;overflow-wrap:anywhere;${m.mine ? 'background:var(--accent);color:var(--on-accent)' : 'background:rgba(255,255,255,.08)'}` }, m.file ? fileBody(m) : m.text),
        el('div', { class: 'tiny faint' }, timeAgo(m.at))))));
    if (!st.messages.length) log.append(el('div', { class: 'small dim', style: 'text-align:center;margin-top:30px' }, 'Say hi. Share the room code with people you want here.'));
    if (!wrap.contains(log)) { wrap.replaceChildren(head, gameBox, log, bar); setTimeout(() => input.focus(), 30); }
    log.scrollTop = log.scrollHeight;
  }
  const off = MS.subscribe(paint);
  return () => { off(); PUI.grow('room', false); };
}

// The tic-tac-toe card above the chat (the card itself is shared with Friends, in games/playui.js).
function gamePanel(st) {
  return PUI.tttCard(st.game, MS.identity().senderID, MS.nameOf, {
    accept: () => MS.gameAccept(), cancel: () => MS.gameCancel(), close: () => MS.gameClose(),
    move: (i) => MS.gameMove(i), rematch: () => MS.gameRematch(), quit: () => MS.gameQuit(),
  });
}
