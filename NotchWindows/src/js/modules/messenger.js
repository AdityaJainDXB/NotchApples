// Messenger (Pro): end-to-end encrypted rooms, compatible with the Mac app.
import { el, timeAgo } from '../store.js';
import { invoke } from '../native.js';
import { toast, prompt } from '../ui.js';
import * as MS from '../services/messenger.js';

export function render(root) {
  const wrap = el('div', { class: 'col fill' });
  root.append(wrap);
  const code = el('input', { class: 'field', placeholder: 'Room code, e.g. #study-group (longer = more private)' });
  const log = el('div', { class: 'col gap-6 scroll', style: 'flex:1' }), input = el('input', { class: 'field', placeholder: 'Message…' }), head = el('div', { class: 'hstack' });
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
      el('button', { class: 'btn small quiet', onclick: () => invoke('clipboard_copy_text', { text: st.room }).then(() => toast('Room code copied')) }, 'Copy code'),
      el('button', { class: 'btn small danger', onclick: () => MS.leave() }, 'Leave'));
    log.replaceChildren(...st.messages.map((m) => (m.notice ? el('div', { class: 'tiny faint', style: 'text-align:center' }, m.text)
      : el('div', { style: `display:flex;flex-direction:column;align-items:${m.mine ? 'flex-end' : 'flex-start'}` },
        m.mine ? null : el('div', { class: 'tiny faint' }, m.sender),
        el('div', { class: 'selectable', style: `max-width:80%;padding:7px 12px;border-radius:14px;white-space:pre-wrap;${m.mine ? 'background:var(--accent);color:var(--on-accent)' : 'background:rgba(255,255,255,.08)'}` }, m.text),
        el('div', { class: 'tiny faint' }, timeAgo(m.at))))));
    if (!st.messages.length) log.append(el('div', { class: 'small dim', style: 'text-align:center;margin-top:30px' }, 'Say hi. Share the room code with people you want here.'));
    if (!wrap.contains(log)) { wrap.replaceChildren(head, log, input); setTimeout(() => input.focus(), 30); }
    log.scrollTop = log.scrollHeight;
  }
  return MS.subscribe(paint);
}
