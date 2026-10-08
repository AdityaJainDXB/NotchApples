// Share: PairDrop between this PC and nearby Macs and PCs, and private chat. Receive shows your code; Send takes
// theirs and your files or folders; Chat opens a private conversation with a device by its code. It runs in the
// background (services/pairdrop.js), so this tab only shows it. Works with Notch apple on Mac.
import { el, load, save } from '../store.js';
import { invoke, listen, openUrl } from '../native.js';
import { segmented, toast } from '../ui.js';
import * as PD from '../services/pairdrop.js';

const digits = (s) => String(s).replace(/\D/g, '').slice(0, 6);

export function render(root) {
  let mode = load('pd.mode', 'receive');
  let peer = '';
  let openThread = null;
  let editing = false;

  // Inputs live for the whole visit, so a repaint never wipes what is being typed.
  const codeIn = el('input', { class: 'field mono', placeholder: 'Their 6-digit code', inputmode: 'numeric', style: 'font-size:18px;width:200px' });
  codeIn.addEventListener('input', () => { codeIn.value = digits(codeIn.value); paint(); });
  const msgIn = el('input', { class: 'field', placeholder: 'Message…' });
  const nameIn = el('input', { class: 'field', style: 'width:140px', placeholder: 'Your name' });
  const status = el('div', { class: 'small dim', style: 'min-height:16px' });
  const progress = el('progress', { max: 1, value: 0, style: 'width:100%;display:none' });
  const body = el('div', { class: 'col fill', style: 'gap:10px;min-height:0' });
  const nameBox = el('div', { class: 'hstack', style: 'gap:6px' });

  const snap = () => PD.state();
  const send = (paths) => {
    if (!paths?.length) return;
    if (codeIn.value.length !== 6) return toast('Type their 6-digit code first.', { error: true });
    PD.api.send(paths, codeIn.value, peer);
  };

  const peerSelect = () => {
    const s = el('select', { class: 'field auto' }, el('option', { value: '' }, `${snap().peers.length} nearby device${snap().peers.length === 1 ? '' : 's'} · automatic`),
      ...snap().peers.map((p) => el('option', { value: p.id, selected: p.id === peer }, p.name)));
    s.onchange = () => { peer = s.value; };
    return s;
  };

  function paintName() {
    nameBox.replaceChildren(el('span', { class: 'tiny faint' }, '👤'),
      ...(editing
        ? [nameIn, el('button', { class: 'btn small', onclick: async () => { editing = false; await PD.api.setUsername(nameIn.value); } }, 'Save')]
        : [el('span', { class: 'small dim' }, snap().deviceName || 'This PC'), el('button', { class: 'icon-btn', title: 'Change the name other people see', onclick: () => { nameIn.value = snap().username || snap().deviceName; editing = true; paintName(); nameIn.focus(); } }, '✎')]));
  }

  function receiveView() {
    const s = snap();
    return el('div', { class: 'card col gap-6' },
      el('div', {}, 'Give this code to the person sending you files, or starting a chat:'),
      el('div', { class: 'hstack' }, el('div', { class: 'mono selectable', style: 'font-size:34px;font-weight:700;letter-spacing:.2em;color:var(--accent)' }, s.code.split('').join(' ')),
        el('button', { class: 'icon-btn', title: 'New code', onclick: () => PD.api.regenerate() }, '↻')),
      el('div', { class: 'small dim' }, 'Files you receive are saved to Downloads. Both devices need to be on the same Wi-Fi, with Notch apple open.'));
  }

  function sendView() {
    const zone = el('div', { class: 'card', style: 'border:1px dashed var(--border);text-align:center;padding:16px;color:var(--text-dim)' },
      codeIn.value.length === 6 ? 'Drop files or folders here to send' : 'Enter the code, then drop files or folders here');
    return el('div', { class: 'col gap-6' },
      el('div', { class: 'hstack wrap' }, codeIn,
        el('button', { class: 'btn', disabled: codeIn.value.length !== 6 || snap().sending, onclick: async () => { const p = await invoke('pick_file'); if (p) send([p]); } }, 'Choose a file…'),
        el('button', { class: 'btn quiet', disabled: codeIn.value.length !== 6 || snap().sending, onclick: async () => { const p = await invoke('pick_folder'); if (p) send([p]); } }, 'Choose a folder…')),
      zone, peerSelect());
  }

  function chatView() {
    const s = snap();
    const t = s.threads.find((x) => x.id === openThread) || s.threads[0];
    if (t && t.unread) PD.api.chatRead(t.id);
    const list = el('div', { class: 'col gap-4 scroll', style: 'flex:1;min-height:0' },
      ...(t ? t.messages.map((m) => el('div', { class: 'hstack', style: `justify-content:${m.fromMe ? 'flex-end' : 'flex-start'}` },
        el('div', { class: 'selectable', style: `max-width:75%;padding:5px 10px;border-radius:12px;background:${m.fromMe ? 'var(--accent)' : 'var(--surface-2)'};color:${m.fromMe ? 'var(--on-accent)' : 'inherit'}` }, m.text))) : []));
    queueMicrotask(() => { list.scrollTop = list.scrollHeight; });
    const sendMsg = () => { if (t && msgIn.value.trim()) { PD.api.chatSend(t.id, msgIn.value); msgIn.value = ''; } };
    msgIn.onkeydown = (e) => { if (e.key === 'Enter') sendMsg(); };
    return el('div', { class: 'row', style: 'flex:1;min-height:0;gap:12px' },
      el('div', { class: 'card col gap-6', style: 'flex:0 0 210px' },
        el('div', { class: 'section-title' }, 'Start a private chat'), codeIn,
        el('button', { class: 'btn', disabled: codeIn.value.length !== 6, onclick: () => PD.api.chatStart(codeIn.value, peer) }, 'Connect'), peerSelect(),
        el('div', { class: 'tiny faint' }, 'Chats live only while Notch apple is open and you are both on this Wi-Fi.')),
      el('div', { class: 'card col gap-6', style: 'flex:1;min-width:0' },
        s.threads.length
          ? el('div', { class: 'col', style: 'flex:1;min-height:0;gap:6px' },
            el('div', { class: 'hstack wrap' }, ...s.threads.map((x) => el('button', { class: `btn small ${x.id === (t && t.id) ? '' : 'quiet'}`, onclick: () => { openThread = x.id; paint(); } }, x.unread ? `${x.peerName} (${x.unread})` : x.peerName)),
              el('div', { class: 'spacer' }), t ? el('button', { class: 'icon-btn', title: 'End this chat', onclick: () => { PD.api.chatClose(t.id); openThread = null; } }, '✕') : null),
            list, el('div', { class: 'hstack' }, msgIn, el('button', { class: 'btn', onclick: sendMsg }, 'Send')))
          : el('div', { class: 'small dim', style: 'margin:auto;text-align:center' }, 'No chats yet. Type someone’s code and press Connect, or give yours and let them connect.')));
  }

  function paint() {
    const s = snap();
    paintName();
    status.textContent = s.status;
    progress.style.display = s.sending && s.progress !== null ? 'block' : 'none';
    progress.value = s.progress ?? 0;
    body.replaceChildren(mode === 'receive' ? receiveView() : mode === 'send' ? sendView() : chatView());
  }

  const modes = segmented([{ value: 'receive', label: 'Receive' }, { value: 'send', label: 'Send' }, { value: 'chat', label: 'Chat' }], mode, (v) => { mode = v; save('pd.mode', v); paint(); });
  const header = el('div', { class: 'hstack', style: 'flex:none' }, el('div', { class: 'section-title' }, '📤 PairDrop'), nameBox, el('div', { class: 'spacer' }), modes);
  const footer = el('div', { class: 'hstack tiny faint', style: 'flex:none;gap:10px' },
    el('span', { class: 'grow' }, 'If Windows asks about the firewall, allow Notch apple on private networks.'),
    el('button', { class: 'btn small ghost', onclick: () => openUrl('ms-settings:crossdevice') }, 'Nearby sharing'),
    el('button', { class: 'btn small ghost', onclick: () => invoke('open_browser', { url: 'https://pairdrop.net/' }) }, 'pairdrop.net'));
  root.append(el('div', { class: 'col fill', style: 'gap:8px' }, header, body, progress, status, footer));

  const stopWatching = PD.subscribe(() => paint());
  let unDrop = null;
  listen('tauri://drag-drop', (e) => { if (mode === 'send') send(e?.paths || []); else toast('Open the Send tab and type their code first.'); }).then((u) => { unDrop = u; });
  paint();
  return () => { stopWatching(); unDrop?.(); };
}
