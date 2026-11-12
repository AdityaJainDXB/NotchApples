// Messenger → Friends (the screen): requests, pending, friends with unread counts, adding by code, one chat per friend with
// sent / delivered / read and a typing line, the safety number, and your own code with a QR code. The same as the Mac's
// FriendsView.swift. The rules are in services/friendslogic.js and the network in services/friends.js.
import { el, fmtTime } from '../store.js';
import { invoke } from '../native.js';
import { toast, prompt, confirm, modal, menu, button, toggle, setting } from '../ui.js';
import * as FR from '../services/friends.js';
import * as L from '../services/friendslogic.js';
import * as C from '../services/friendscrypto.js';
import * as PUI from '../games/playui.js';

const hue = (box) => { let h = 0; for (const c of box) h = (h * 31 + c.charCodeAt(0)) % 360; return h; };
const avatar = (f) => el('div', { style: `width:24px;height:24px;border-radius:50%;flex:none;display:grid;place-items:center;font-size:11px;font-weight:700;color:#fff;background:hsl(${hue(f.box)} 55% 45%)` },
  [...L.displayName(f)][0]?.toUpperCase() || '?');

const STATE = { sending: '· sending…', sent: '· sent', delivered: '· delivered', read: '· read' };

export function render(root) {
  FR.activate().catch(() => {});
  let selected = FR.friends()[0]?.box || null, adding = false, note = '';
  const wrap = el('div', { style: 'display:flex;gap:10px;flex:1;min-height:0' });
  const side = el('div', { class: 'col gap-6', style: 'width:210px;flex:none;min-height:0' });
  const pane = el('div', { class: 'col gap-6', style: 'flex:1;min-width:0;min-height:0' });
  wrap.append(side, pane);
  // Your own code, always in view at the bottom right, so it is easy to read out or copy.
  const codeBar = el('div', { class: 'hstack', style: 'justify-content:flex-end;gap:8px;flex:none' });
  root.append(wrap, codeBar);
  function paintCodeBar() {
    const me = FR.identity();
    if (!me) { codeBar.replaceChildren(); return; }
    codeBar.replaceChildren(el('span', { class: 'tiny dim' }, 'Your code'),
      el('b', { class: 'selectable', style: 'font-family:ui-monospace,Consolas,monospace' }, L.displayCode(me.code)),
      button('Copy', () => invoke('clipboard_copy_text', { text: L.displayCode(me.code) }).then(() => toast('Friend code copied')), { small: true, kind: 'quiet' }),
      button('QR', () => myCode(), { small: true, kind: 'quiet', title: 'Show your QR code' }));
  }

  // Kept between repaints, so typing is never interrupted.
  const addInput = el('input', { class: 'field', placeholder: 'Friend code or link', style: 'min-width:0;flex:1' });
  const draft = el('input', { class: 'field', placeholder: 'Message…', maxlength: 2000, style: 'flex:1' });
  const addNote = el('div', { class: 'tiny', style: 'color:var(--warn,#e0a030)' });
  let chatKey = null;   // which chat the pane is showing, so the log can repaint without rebuilding the header

  async function add() {
    if (adding || !addInput.value.trim()) return;
    adding = true; addNote.textContent = ''; paintSide();
    const problem = await FR.addFriend(addInput.value);
    adding = false;
    if (problem) addNote.textContent = problem; else { addInput.value = ''; addNote.textContent = ''; toast('Request sent. They have to accept it.'); }
    paintSide();
  }
  addInput.onkeydown = (e) => { if (e.key === 'Enter') add(); };

  const section = (t) => el('div', { class: 'tiny faint', style: 'text-transform:uppercase;font-weight:700;margin-top:6px' }, t);

  function requestRow(r) {
    return el('div', { class: 'card col gap-4', style: 'padding:8px' },
      el('div', { style: 'font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap' }, L.displayName(r)),
      el('div', { class: 'tiny dim' }, 'wants to be friends'),
      el('div', { class: 'hstack' },
        button('Accept', async () => { const p = await FR.accept(r.box); if (p) toast(p, { error: true }); else { selected = r.box; FR.setViewing(r.box); } }, { small: true }),
        button('Block', () => FR.block(r.box), { small: true, kind: 'quiet' })));
  }
  /** A person you blocked, with a button to unblock just them. */
  function blockedRow(b) {
    return el('div', { class: 'item', style: 'padding:5px 8px;gap:8px' }, el('div', { class: 'main dim', style: 'overflow:hidden;text-overflow:ellipsis;white-space:nowrap' }, b.name),
      button('Unblock', () => { FR.unblock(b.fp); toast(`${b.name} is unblocked. They can send you a request again, or you can add their code.`); paintSide(); }, { small: true, kind: 'quiet' }));
  }
  function pendingRow(r) {
    return el('div', { class: 'item', style: 'padding:5px 8px' }, el('div', { class: 'main dim' }, r.alias || `Friend ${r.fp.slice(0, 4).toUpperCase()}`),
      button('✕', () => FR.remove(r.box), { small: true, kind: 'quiet', title: 'Cancel this request' }));
  }
  function friendRow(f) {
    const row = el('div', { class: `item clickable ${selected === f.box ? 'selected' : ''}`, style: 'padding:5px 8px;gap:8px', onclick: () => select(f.box),
      oncontextmenu: (e) => { e.preventDefault(); friendMenu(e, f); } },
      avatar(f), el('div', { class: 'main', style: 'font-weight:500;overflow:hidden;text-overflow:ellipsis;white-space:nowrap' }, L.displayName(f)),
      f.unread > 0 ? el('span', { class: 'badge' }, String(f.unread)) : null);
    return row;
  }
  function groupRow(g) {
    const key = L.groupKey(g.id);
    return el('div', { class: `item clickable ${selected === key ? 'selected' : ''}`, style: 'padding:5px 8px;gap:8px', onclick: () => select(key),
      oncontextmenu: (e) => { e.preventDefault(); menu(e, [{ label: 'Clear chat…', danger: true, run: () => clearChat(key, `everyone in ${g.name}`, true) }, { label: 'Leave group', danger: true, run: () => leave(g) }]); } },
      el('div', { style: 'width:24px;height:24px;border-radius:50%;flex:none;display:grid;place-items:center;font-size:12px;background:rgba(255,255,255,.12)' }, '👥'),
      el('div', { class: 'main', style: 'font-weight:500;overflow:hidden;text-overflow:ellipsis;white-space:nowrap' }, g.name),
      g.unread > 0 ? el('span', { class: 'badge' }, String(g.unread)) : null);
  }
  /** "Clear chat": the exact scope and the honest limits are in the dialog, the same words as on the Mac (docs/GUIDES.md). */
  async function clearChat(key, who, group) {
    const ok = await confirm(group ? 'Clear this group chat for everyone?' : 'Clear this chat?', {
      ok: group ? 'Clear chat for everyone' : 'Clear chat for both of us', danger: true,
      detail: `This deletes the whole chat for you and for ${who}, including files saved from it, and cannot be undone. ${group ? 'The group stays. ' : 'You both stay friends. '}`
        + 'Notch Apple removes its own copies on both sides. It can\u2019t erase screenshots, anything copied or saved outside the app, or a modified app that ignores the request. '
        + `If ${group ? 'someone' : who} is offline it is applied when they come online, and only an up-to-date Notch Apple honours it.` });
    if (!ok) return;
    FR.clearChat(key); draft.value = '';
    toast('Chat cleared');
  }
  async function leave(g) {
    if (await confirm(`Leave ${g.name}?`, { ok: 'Leave', danger: true, detail: 'The group and its messages are deleted from this PC. Others are told you left.' })) { const key = L.groupKey(g.id); FR.leaveGroup(key); if (selected === key) select(null); }
  }
  function newGroup() {
    const fr = FR.friends(), picked = new Set(), nameIn = el('input', { class: 'field', placeholder: 'Group name', maxlength: 32 }), note = el('div', { class: 'tiny', style: 'color:var(--warn,#e0a030)' });
    if (!fr.length) { toast('Add a friend first, then you can make a group.'); return; }
    const m = modal('New group', [nameIn,
      el('div', { class: 'col gap-4 scroll', style: 'max-height:200px' }, fr.map((f) => el('label', { class: 'hstack', style: 'gap:8px;cursor:pointer' },
        el('input', { type: 'checkbox', onchange: (e) => { if (e.target.checked) picked.add(f.box); else picked.delete(f.box); } }), L.displayName(f)))),
      el('div', { class: 'tiny dim' }, 'Everyone in a group sees messages only from people who are also their friends, so add people who know each other. Each message is encrypted separately for each person.'),
      note,
      el('div', { class: 'hstack' }, button('Create', () => {
        const problem = FR.createGroup(nameIn.value, [...picked]);
        if (problem) { note.textContent = problem; return; }
        m.close(); select(L.groupKey(FR.groups()[0].id));
      }))]);
    setTimeout(() => nameIn.focus(), 30);
  }
  function friendMenu(e, f) {
    menu(e, [
      { label: 'Nickname…', run: () => nickname(f) },
      { label: 'Clear chat…', danger: true, run: () => clearChat(f.box, L.displayName(f), false) },
      { label: 'Remove friend', danger: true, run: () => removeFriend(f) },
      { label: 'Block', danger: true, run: () => { FR.block(f.box); if (selected === f.box) select(null); } },
    ]);
  }
  async function nickname(f) {
    const a = await prompt('Nickname (only you see it)', { value: f.alias || '' });
    if (a !== null) FR.setAlias(f.box, a);
  }
  async function removeFriend(f) {
    if (await confirm(`Remove ${L.displayName(f)}?`, { ok: 'Remove', danger: true, detail: "They won't be told why, and you can add them again later." })) { FR.remove(f.box); if (selected === f.box) select(null); }
  }
  function select(box) { selected = box; chatKey = null; FR.setViewing(box); paint(); }

  const dot = { online: '#34c759', connecting: '#ffcc00', problem: '#ff453a', off: 'var(--text-dim)' };
  function paintSide() {
    const st = FR.st, inc = FR.incoming(), pend = FR.pending(), fr = FR.friends(), refocus = document.activeElement === addInput;
    side.replaceChildren(
      el('div', { class: 'hstack', style: 'gap:6px' },
        el('span', { style: `width:8px;height:8px;border-radius:50%;flex:none;background:${dot[st.link] || dot.off}` }),
        el('div', { class: 'tiny dim grow', style: 'overflow:hidden;text-overflow:ellipsis;white-space:nowrap', title: st.problem }, st.link === 'online' ? 'Online' : st.link === 'connecting' ? 'Connecting…' : st.link === 'problem' ? st.problem : 'Not connected'),
        button('My code', () => myCode(), { small: true, kind: 'quiet', title: 'Your friend code, QR code and settings' })),
      el('div', { class: 'hstack', style: 'gap:4px' }, addInput, button(adding ? '…' : 'Add', add, { small: true, disabled: adding, title: 'Send a friend request. They have to accept before either of you can message.' })),
      addNote,
      el('div', { class: 'col gap-4 scroll', style: 'flex:1;min-height:0' },
        inc.length ? [section('Requests'), ...inc.map(requestRow)] : null,
        pend.length ? [section('Waiting for an answer'), ...pend.map(pendingRow)] : null,
        section('Friends'),
        fr.length ? fr.map(friendRow) : el('div', { class: 'tiny dim' }, 'Type a friend’s code above to add them, or share yours (bottom right).'),
        el('div', { class: 'hstack', style: 'justify-content:space-between;margin-top:6px' }, el('div', { class: 'tiny faint', style: 'text-transform:uppercase;font-weight:700' }, 'Groups'),
          button('＋', () => newGroup(), { small: true, kind: 'quiet', title: 'Start a group chat with some of your friends' })),
        FR.groups().length ? FR.groups().map(groupRow) : el('div', { class: 'tiny dim' }, fr.length ? 'Press ＋ to start a group chat.' : 'Add a friend first, then you can make a group.'),
        FR.blockedPeople().length ? [section('Blocked'), ...FR.blockedPeople().map(blockedRow)] : null));
    if (refocus) addInput.focus();
    paintCodeBar();
  }

  const size = (n) => (n < 1000 ? `${n} B` : `${(n / 1000).toFixed(n < 10000 ? 1 : 0)} KB`);
  /** `key` is a friend's box or a group key; `inGroup` shows who sent it and hides delivered / read (there are no receipts in groups). */
  function bubble(m, key, inGroup) {
    // The one line "Clear chat" leaves behind.
    if (m.kind) return el('div', { class: 'tiny dim', style: 'text-align:center;font-style:italic;padding:6px 0' }, m.text);
    // A file is shown in Explorer when clicked. It is never opened for you.
    const body = m.file
      ? el('a', { style: 'cursor:pointer;display:flex;gap:8px;align-items:center', title: 'Show in Explorer (it is not opened)', onclick: () => FR.reveal(m.id, m.file.name, key) },
        el('span', { style: 'font-size:20px' }, '📄'), el('span', { style: 'overflow-wrap:anywhere' }, m.file.name, el('div', { class: 'tiny', style: 'opacity:.7' }, size(m.file.size))))
      : m.text;
    const state = inGroup ? { sending: '· sending…', sent: '· sent', delivered: '', read: '' } : STATE;
    return el('div', { style: `display:flex;flex-direction:column;align-items:${m.mine ? 'flex-end' : 'flex-start'}` },
      inGroup && !m.mine ? el('div', { class: 'tiny faint' }, FR.nameOfBox(m.by)) : null,
      el('div', { class: 'selectable', style: `max-width:80%;padding:7px 12px;border-radius:14px;white-space:pre-wrap;overflow-wrap:anywhere;${m.mine ? 'background:var(--accent);color:var(--on-accent)' : 'background:rgba(255,255,255,.08)'}` }, body),
      el('div', { class: 'tiny faint hstack', style: 'gap:4px' }, fmtTime(m.date),
        m.mine ? (m.state === 'failed'
          ? el('a', { style: 'color:var(--warn,#e0a030);cursor:pointer', onclick: () => FR.retry(m.id, key) }, '· failed, click to retry')
          : el('span', { style: m.state === 'read' ? 'color:var(--accent)' : '' }, state[m.state])) : null));
  }
  async function attach() {
    const key = selected; if (!key) return;
    const p = await invoke('pick_file'); if (!p) return;
    FR.st.lastProblem = await FR.sendFile(p, key);
    paint();
  }

  const log = el('div', { class: 'col gap-6 scroll', style: 'flex:1;min-height:0' });
  const typingLine = el('div', { class: 'tiny', style: 'color:var(--accent)' });
  const problem = el('div', { class: 'tiny', style: 'color:var(--warn,#e0a030)' });
  const title = el('div', { class: 'title grow' });
  const gamesSlot = el('div', { class: 'hstack' });   // the Games button, while no game is open
  const gameBox = el('div', { style: 'flex:none' });   // the game card above the chat
  const groupNote = el('div', { class: 'tiny', style: 'color:var(--warn,#e0a030)' });
  const clip = button('📎', attach, { kind: 'quiet', title: `Send a file (up to ${L.MAX_FILE_TEXT}). It is encrypted like a message.` });
  function send() {
    const box = selected; if (!box || !draft.value.trim()) return;
    FR.st.lastProblem = null; FR.send(draft.value, box); draft.value = '';
  }
  draft.onkeydown = (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } };
  draft.oninput = () => { if (draft.value && selected) FR.typingChanged(selected); };

  /** The Games button and the game card for this friend. The notch grows while a board is showing. */
  function paintGames(friend) {
    const box = friend.box, me = FR.identity()?.box, play = FR.play(box), ttt = FR.tttGame(box);
    if (!me || !play) { gamesSlot.replaceChildren(); gameBox.replaceChildren(); PUI.grow('friend', false); return; }
    gamesSlot.replaceChildren(...(!PUI.tttOpen(ttt) && !play.isActive
      ? [PUI.gamesButton({ tictactoe: () => FR.tttInvite(box), start: (kind) => play.invite(kind) })] : []));
    const cards = [
      PUI.tttCard(ttt, me, FR.nameOfBoxOrYou, {
        accept: () => FR.tttAccept(box), cancel: () => FR.tttCancel(box), close: () => FR.tttClose(box),
        move: (i) => FR.tttMove(box, i), rematch: () => FR.tttRematch(box), quit: () => FR.tttQuit(box),
      }),
      PUI.playCard(play, 'friend'),
    ].filter(Boolean);
    gameBox.replaceChildren(...cards);
    PUI.grow('friend', cards.length > 0, cards.some((c) => c.dataset?.tall === '1'));
  }

  function paintChat(friend) {
    if (chatKey !== friend.box) {
      chatKey = friend.box;
      pane.replaceChildren(
        el('div', { class: 'hstack' }, title, typingLine, gamesSlot,
          button('Safety number', () => safety(friend.box), { small: true, kind: 'quiet', title: 'Compare these numbers with your friend to be sure nobody is in the middle' }),
          button('⋯', (e) => friendMenu(e, FR.book().friends.find((f) => f.box === chatKey) || friend), { small: true, kind: 'quiet' })),
        gameBox, log, problem, el('div', { class: 'hstack' }, clip, draft, button('Send', send, { title: 'Send (Enter)' })));
      setTimeout(() => draft.focus(), 30);
    }
    paintGames(friend);
    title.textContent = L.displayName(friend);
    typingLine.textContent = FR.st.typing.has(friend.box) ? 'typing…' : '';
    problem.textContent = FR.st.lastProblem || '';
    const msgs = FR.messages(friend.box);
    log.replaceChildren(...(msgs.length ? msgs.map((m) => bubble(m, friend.box, false))
      : [el('div', { class: 'small dim', style: 'text-align:center;margin-top:30px' }, `Say hi. Messages are encrypted on this PC; the server only holds them until ${L.displayName(friend)} is online.`)]));
    log.scrollTop = log.scrollHeight;
    if (friend.unread > 0) FR.markRead(friend.box);
  }

  function paintGroup(g) {
    PUI.grow('friend', false);
    const key = L.groupKey(g.id);
    if (chatKey !== key) {
      chatKey = key;
      pane.replaceChildren(
        el('div', { class: 'hstack' }, title, typingLine,
          button('⋯', (e) => menu(e, [{ label: 'Clear chat…', danger: true, run: () => clearChat(key, `everyone in ${(FR.group(key) || g).name}`, true) }, { label: 'Leave group', danger: true, run: () => leave(FR.group(key) || g) }]), { small: true, kind: 'quiet' })),
        groupNote, log, problem, el('div', { class: 'hstack' }, clip, draft, button('Send', send, { title: 'Send (Enter)' })));
      setTimeout(() => draft.focus(), 30);
    }
    title.textContent = g.name; typingLine.textContent = '';
    const out = L.unreachable(FR.book(), g);
    groupNote.textContent = out ? `${out} in this group aren't your friends, so you can't message or hear from them here.` : '';
    problem.textContent = FR.st.lastProblem || '';
    const msgs = FR.messages(key);
    log.replaceChildren(...(msgs.length ? msgs.map((m) => bubble(m, key, true))
      : [el('div', { class: 'small dim', style: 'text-align:center;margin-top:30px' }, 'Say hi to the group. Each message is encrypted for every member who is your friend.')]));
    log.scrollTop = log.scrollHeight;
    if (g.unread > 0) FR.markRead(key);
  }

  function paintPlaceholder() {
    chatKey = null; PUI.grow('friend', false);
    pane.replaceChildren(el('div', { class: 'center' }, el('div', { class: 'col', style: 'align-items:center;gap:10px;max-width:380px;text-align:center' },
      el('div', { style: 'font-size:36px' }, '👥'), el('div', { class: 'title' }, 'Friends'),
      el('div', { class: 'small dim' }, 'Private, end-to-end encrypted chat, files and group chats with people you add by code, on Mac or Windows. Nobody can message you until you accept them.'),
      FR.identity() ? el('div', { class: 'small' }, 'Your code: ', el('b', { class: 'selectable' }, L.displayCode(FR.identity().code))) : null,
      el('div', { class: 'tiny faint' }, 'Windows Friends is a BETA.'))));
  }

  async function safety(box) {
    const f = FR.book().friends.find((x) => x.box === box), me = FR.identity();
    if (!f || !me) return;
    const number = await C.safetyNumber(me, { signPub: C.unb64u(f.sign), dhPub: C.unb64u(f.dh) });
    modal(`Safety number with ${L.displayName(f)}`, [
      ...L.safetyRows(number).map((r) => el('div', { class: 'selectable', style: 'font-family:ui-monospace,Consolas,monospace;font-size:15px;white-space:pre' }, r)),
      el('div', { class: 'small dim' }, 'Read these out (in person or on a call). If they match on both screens, no one can read your chat in the middle.')]);
  }

  async function myCode() {
    const me = FR.identity(); if (!me) return;
    const { qrCanvas } = await import('./devtools.js');
    const qr = qrCanvas(me.link, 150);
    const nick = el('input', { class: 'field', value: FR.settings.nick, placeholder: FR.displayNick(), maxlength: 32, onchange: (e) => { FR.settings.nick = e.target.value; } });
    const blocked = FR.book().blocked.length;
    const m = modal('Your friend code', [
      el('div', { class: 'hstack' }, el('b', { class: 'selectable', style: 'font-size:20px;font-family:ui-monospace,Consolas,monospace' }, L.displayCode(me.code)),
        button('Copy', () => invoke('clipboard_copy_text', { text: L.displayCode(me.code) }).then(() => toast('Friend code copied')), { small: true, kind: 'quiet' }),
        button('Copy link', () => invoke('clipboard_copy_text', { text: me.link }).then(() => toast('Friend link copied')), { small: true, kind: 'quiet' })),
      qr ? el('div', { class: 'hstack' }, qr, el('div', { class: 'tiny dim' }, 'Anyone who scans this (or opens the link) can send you a request. The QR code also lets their app check your keys.')) : null,
      setting('Name shown in friend requests', null, nick),
      setting('Send read receipts and typing', null, toggle(FR.settings.receipts, (v) => { FR.settings.receipts = v; })),
      blocked ? setting('Blocked people', 'Unblock one person below, or everyone. They can then send a request again, or you can add their code.', el('div', { class: 'col gap-4' },
        ...FR.blockedPeople().map((b) => el('div', { class: 'hstack' }, el('span', { class: 'grow ellipsis' }, b.name), button('Unblock', () => { FR.unblock(b.fp); m.close(); paintSide(); }, { small: true, kind: 'quiet' }))),
        button(`Unblock all (${blocked})`, () => { FR.unblockAll(); m.close(); paintSide(); }, { small: true, kind: 'quiet' }))) : null,
      button('Delete all my chat data', async () => {
        if (!await confirm('Delete every friend, message and block, here and on the server?', { ok: 'Delete everything', danger: true, detail: 'Your friend code stays the same.' })) return;
        m.close(); selected = null; await FR.deleteEverything(); toast('Chat data deleted');
      }, { kind: 'danger' }),
      el('div', { class: 'tiny faint' }, 'Your code is an address, not a password: someone who has it can only send you a request, and you choose whether to accept. Messages are end-to-end encrypted; the server sees only random IDs and encrypted data, and history stays on this PC.')]);
  }

  function paint() {
    paintSide();
    const g = selected && L.isGroupKey(selected) ? FR.group(selected) : null;
    const f = selected && !g && FR.book().friends.find((x) => x.box === selected && x.status === 'active');
    if (g) paintGroup(g); else if (f) paintChat(f); else { if (selected) selected = null; paintPlaceholder(); }
  }
  // Repaint on every change except while a message is being typed in the add box (it is kept, so this is safe anyway).
  const off = FR.subscribe(paint);
  if (selected) FR.setViewing(selected);
  return () => { off(); FR.setViewing(null); PUI.grow('friend', false); };
}
