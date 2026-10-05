// The AI tab, ported from ClaudeChatView.swift and AIExtras.swift: chat with a
// free or paid model, answers in Markdown, and (Pro) ask about your screen,
// attach images and PDFs, search the web with sources, personas, slash commands,
// saved chats, read aloud and voice typing.

import { el, load, save, timeAgo } from '../store.js';
import { invoke, listen, openUrl } from '../native.js';
import { canUse } from '../features.js';
import { markdown, toast, menu, iconBtn, modal, button, confirm, empty } from '../ui.js';
import { keepOpen, collapse, show } from '../app.js';
import * as AI from '../services/ai.js';

const SCREEN_WORDS = /\b(my screen|on screen|on my screen|this screen|screenshot|what('?s| is) (on|in) (my|the) screen|look at (my|the) screen)\b/i;

export function render(root, opts = {}) {
  let chat = { id: null, messages: [] };   // [{ role, text, model, images, pdf, sources }]
  let attachments = [];                     // [{ kind: 'image'|'pdf', name, mime, data }]
  let web = canUse('webSearch') && load('ai.web', false);
  let speak = canUse('voice') && load('ai.speak', false);
  let busy = false;

  const log = el('div', { class: 'col scroll', style: 'flex:1;gap:10px;padding:2px 4px 2px 0' });
  const input = el('textarea', { class: 'field', rows: 1, placeholder: 'Ask anything…  (Shift+Enter for a new line)', style: 'min-height:36px;max-height:120px;flex:1' });
  const sendBtn = el('button', { class: 'icon-btn solid', title: 'Send (Enter)' }, '↑');
  const notice = el('div', { class: 'small dim', style: 'min-height:14px' });
  const chips = el('div', { class: 'hstack wrap', style: 'gap:4px' });
  const slashBox = el('div', { class: 'col gap-4 hidden', style: 'max-height:150px;overflow:auto' });

  // ---- toolbar ----
  const providerSel = el('select', { class: 'field auto', title: 'Provider' },
    ...Object.entries(AI.PROVIDERS).map(([id, p]) => el('option', { value: id, selected: id === AI.provider() }, p.name)));
  const modelSel = el('select', { class: 'field auto', title: 'Model', style: 'max-width:220px' });

  async function paintModels() {
    const p = AI.provider();
    const current = AI.modelOf(p);
    modelSel.replaceChildren(el('option', { value: current, selected: true }, current));
    const list = await AI.listModels(p);
    const ids = new Set();
    const opts2 = [];
    for (const m of [{ id: current, label: current }, ...(p === 'openRouter' ? list.filter((x) => x.free) : list)]) {
      if (ids.has(m.id)) continue; ids.add(m.id);
      opts2.push(el('option', { value: m.id, selected: m.id === current }, p === 'openRouter' && m.free ? `${m.id}` : m.label || m.id));
    }
    opts2.push(el('option', { value: '__custom' }, 'Other model…'));
    modelSel.replaceChildren(...opts2);
  }
  providerSel.addEventListener('change', () => { AI.setProvider(providerSel.value); paintModels(); keyHint(); });
  modelSel.addEventListener('change', async () => {
    if (modelSel.value === '__custom') {
      const { prompt } = await import('../ui.js');
      const id = await prompt('Model name', { placeholder: 'e.g. gemini-3.8-pro', value: AI.modelOf(AI.provider()) });
      if (id) AI.setModel(AI.provider(), id);
      paintModels();
    } else AI.setModel(AI.provider(), modelSel.value);
  });

  const webBtn = iconBtn('🌐', 'Search the web for answers (Pro)', () => {
    if (!canUse('webSearch')) return locked('webSearch');
    web = !web; save('ai.web', web); webBtn.classList.toggle('on', web);
    toast(web ? 'Web search on: answers cite their sources' : 'Web search off');
  }, { on: web });
  const shotBtn = iconBtn('📸', 'Ask about your screen (Pro)', () => attachScreen());
  const fileBtn = iconBtn('📎', 'Attach an image or PDF (Pro)', () => pickFile());
  const voiceBtn = iconBtn('🎙', 'Voice typing (Win + H)', () => {
    if (!canUse('voice')) return locked('voice');
    input.focus(); invoke('dictate').catch(() => {});
  });
  const speakBtn = iconBtn('🔊', 'Read answers aloud (Pro)', () => {
    if (!canUse('voice')) return locked('voice');
    speak = !speak; save('ai.speak', speak); speakBtn.classList.toggle('on', speak);
    if (!speak) speechSynthesis.cancel();
  }, { on: speak });
  const moreBtn = iconBtn('⋯', 'More', (e) => menu(e, [
    { label: '🆕  New chat', run: newChat },
    { label: '🕘  Chat history', run: historyDialog },
    { label: `🎭  Persona: ${AI.activePersona()?.name || 'none'}`, run: personaMenu },
    { label: '⭐  Saved prompts', run: promptsDialog },
    'sep',
    { label: '🔑  Keys and providers', run: () => show('settings', { pane: 'AI' }) },
  ]));

  function locked(feature) {
    toast(`${{ webSearch: 'Web search', voice: 'Voice', aiCapture: 'Asking about your screen', aiFileDrop: 'Attachments', aiHistory: 'Chat history', personas: 'Personas' }[feature] || 'This'} is part of Pro.`);
  }

  function keyHint() {
    const p = AI.provider();
    notice.replaceChildren();
    if (!AI.ready(p)) {
      notice.append(`Add your ${AI.PROVIDERS[p].name} key to start (${AI.PROVIDERS[p].free}). `,
        el('a', { onclick: () => show('settings', { pane: 'AI' }) }, 'Add key'), ' · ',
        el('a', { onclick: () => openUrl(AI.PROVIDERS[p].keyUrl) }, 'Get one'));
    }
  }

  // ---- messages ----

  function bubble(m, i) {
    const mine = m.role === 'user';
    const body = mine
      ? el('div', { class: 'selectable', style: 'white-space:pre-wrap' }, m.display || m.text)
      : markdown(m.text, { onLink: openUrl });
    const extras = [];
    if (m.images?.length) extras.push(el('div', { class: 'hstack wrap gap-4' }, ...m.images.map((img) => el('img', { src: `data:${img.mime};base64,${img.data}`, style: 'max-width:120px;max-height:70px;border-radius:6px' }))));
    if (m.pdf) extras.push(el('div', { class: 'chip' }, `📄 ${m.pdf.name}`));
    const actions = mine ? [] : [
      iconBtn('⧉', 'Copy', () => invoke('clipboard_copy_text', { text: m.text }).then(() => toast('Copied'))),
      iconBtn('⤵', 'Paste into the app you were using', async () => { await collapse(); invoke('paste_text', { text: m.text }); }),
      iconBtn('🔊', 'Read aloud', () => say(m.text)),
      i === chat.messages.length - 1 ? iconBtn('↻', 'Try again', retry) : null,
    ];
    return el('div', { style: `display:flex;flex-direction:column;align-items:${mine ? 'flex-end' : 'flex-start'};gap:3px` },
      el('div', { style: `max-width:86%;padding:9px 13px;border-radius:14px;${mine
        ? 'background:var(--accent);color:var(--on-accent)'
        : 'background:rgba(255,255,255,.07);border:1px solid var(--border)'}` }, ...extras, body),
      (!mine && (m.model || m.sources?.length)) ? el('div', { class: 'tiny faint' }, m.note || m.model || '') : null,
      actions.length ? el('div', { class: 'hstack', style: 'gap:0' }, ...actions) : null);
  }

  function paint() {
    if (!chat.messages.length) {
      log.replaceChildren(empty('✨', 'Ask anything', 'Ask a question, paste text to summarise or translate, or ask "what’s on my screen?". Type / for commands.', chips));
      paintChips();
      return;
    }
    log.replaceChildren(...chat.messages.map(bubble));
    log.scrollTop = log.scrollHeight;
  }

  function paintChips() {
    const prompts = canUse('personas') ? AI.savedPrompts() : [{ title: 'Summarise my clipboard', text: '/summarize' }, { title: 'What’s on my screen?', text: "What's on my screen?" }];
    chips.replaceChildren(...prompts.slice(0, 6).map((p) => el('button', { class: 'chip clickable', onclick: () => { input.value = p.text; input.focus(); if (!p.text.endsWith(': ') && !p.text.endsWith(' ')) submit(); } }, p.title)));
  }

  function say(text) {
    speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text.replace(/[#*_`>|]/g, '').slice(0, 4000));
    speechSynthesis.speak(u);
  }

  // ---- attachments ----

  const tray = el('div', { class: 'hstack wrap gap-4 hidden' });
  function paintTray() {
    tray.classList.toggle('hidden', !attachments.length);
    tray.replaceChildren(...attachments.map((a, i) => el('span', { class: 'chip' },
      a.kind === 'image' ? el('img', { src: `data:${a.mime};base64,${a.data}`, style: 'height:18px;border-radius:3px' }) : '📄',
      a.name, el('a', { onclick: () => { attachments.splice(i, 1); paintTray(); } }, ' ✕'))));
  }

  async function attachScreen() {
    if (!canUse('aiCapture')) return locked('aiCapture');
    notice.textContent = 'Taking a screenshot…';
    try {
      const data = await keepOpen(() => invoke('capture_screen'));
      attachments.push({ kind: 'image', name: 'Screenshot', mime: 'image/jpeg', data });
      notice.textContent = 'Screenshot attached. Ask about it.';
      paintTray();
      input.focus();
    } catch (e) { notice.textContent = `Couldn't take a screenshot: ${e.message}`; }
  }

  async function addFile(path) {
    if (!canUse('aiFileDrop')) return locked('aiFileDrop');
    try {
      const f = await invoke('read_file_base64', { path });
      if (f.mime.startsWith('image/')) attachments.push({ kind: 'image', name: f.name, mime: f.mime, data: f.data });
      else if (f.mime === 'application/pdf') attachments.push({ kind: 'pdf', name: f.name, mime: f.mime, data: f.data });
      else if (f.mime === 'text/plain') { input.value += `\n\n${f.name}:\n${atob(f.data).slice(0, 30000)}`; }
      else { toast('Attach images, PDFs or text files.', { error: true }); return; }
      paintTray();
    } catch (e) { toast(e.message, { error: true }); }
  }

  async function pickFile() {
    if (!canUse('aiFileDrop')) return locked('aiFileDrop');
    const path = await keepOpen(() => invoke('pick_file'));
    if (path) addFile(path);
  }

  // Dropping files onto the notch while this tab is open attaches them.
  let unlistenDrop = null;
  listen('tauri://drag-drop', (e) => { for (const p of e?.paths || []) addFile(p); }).then((u) => { unlistenDrop = u; });

  // ---- sending ----

  async function submit() {
    let text = input.value.trim();
    if ((!text && !attachments.length) || busy) return;
    input.value = '';
    input.style.height = '';
    slashBox.classList.add('hidden');
    if (!text) text = 'What is this?';

    // "What's on my screen?" attaches a screenshot automatically (Pro).
    if (SCREEN_WORDS.test(text) && !attachments.some((a) => a.kind === 'image') && canUse('aiCapture')) await attachScreen();

    const { prompt, web: slashWeb, command } = await AI.expandSlash(text);
    const useWeb = (web || slashWeb) && canUse('webSearch');
    const images = attachments.filter((a) => a.kind === 'image').map(({ mime, data }) => ({ mime, data }));
    const pdf = attachments.find((a) => a.kind === 'pdf') || null;
    attachments = []; paintTray();

    chat.messages.push({ role: 'user', text: prompt, display: command ? text : undefined, images, pdf });
    paint();
    await answer(useWeb, command === '/web' ? text.replace(/^\/web\s*/, '') : text);
  }

  async function answer(useWeb, question) {
    busy = true; sendBtn.disabled = true;
    const thinking = el('div', { class: 'hstack small dim' }, el('span', { class: 'spin' }), useWeb ? ' Searching the web…' : ' Thinking…');
    log.append(thinking); log.scrollTop = log.scrollHeight;
    notice.textContent = '';
    try {
      const history = chat.messages.map(({ role, text, images, pdf }) => ({ role, text, images, pdf }));
      const r = useWeb
        ? await AI.askWithWeb(question, history.slice(0, -1))
        : await AI.send(history);
      chat.messages.push({ role: 'assistant', text: r.text, model: r.model, note: r.note, sources: r.sources });
      if (r.note) notice.textContent = r.note;
      if (speak) say(r.text);
      chat = AI.saveChat(chat);
    } catch (e) {
      notice.replaceChildren(el('span', { class: 'err' }, e.message));
      if (/key in Settings/.test(e.message)) notice.append(' ', el('a', { onclick: () => show('settings', { pane: 'AI' }) }, 'Open Settings'));
    } finally {
      busy = false; sendBtn.disabled = false;
      paint();
      input.focus();
    }
  }

  function retry() {
    if (busy) return;
    if (chat.messages.at(-1)?.role === 'assistant') chat.messages.pop();
    paint();
    answer(web && canUse('webSearch'), chat.messages.at(-1)?.text || '');
  }

  function newChat() { chat = { id: null, messages: [] }; attachments = []; paintTray(); paint(); input.focus(); }

  // ---- slash commands ----

  input.addEventListener('input', () => {
    input.style.height = 'auto';
    input.style.height = `${Math.min(120, input.scrollHeight)}px`;
    const v = input.value;
    if (v.startsWith('/') && !v.includes(' ') && canUse('slashCommands')) {
      const list = Object.entries(AI.SLASH).filter(([k]) => k.startsWith(v));
      slashBox.replaceChildren(...list.map(([k, c]) => el('div', { class: 'item clickable', onclick: () => { input.value = `${k} `; input.focus(); slashBox.classList.add('hidden'); } },
        el('span', { class: 'mono accent' }, k), el('span', { class: 'small dim' }, c.help))));
      slashBox.classList.toggle('hidden', !list.length);
    } else slashBox.classList.add('hidden');
  });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submit(); }
  });
  sendBtn.addEventListener('click', submit);

  // ---- history, personas, saved prompts (Pro) ----

  function historyDialog() {
    if (!canUse('aiHistory')) return locked('aiHistory');
    const list = el('div', { class: 'col gap-4 scroll', style: 'max-height:320px' });
    const paintList = () => {
      const chats = AI.chats();
      list.replaceChildren(...chats.map((c) => el('div', { class: 'item clickable', onclick: () => { chat = { ...c, messages: c.messages.map((m) => ({ ...m })) }; m.close(); paint(); } },
        el('div', { class: 'main' }, el('div', { class: 'ellipsis' }, c.title), el('div', { class: 'tiny faint' }, `${timeAgo(c.at)} · ${c.messages.length} messages`)),
        el('div', { class: 'actions' }, iconBtn('🗑', 'Delete', (e) => { e.stopPropagation(); AI.deleteChat(c.id); paintList(); })))));
      if (!chats.length) list.append(el('div', { class: 'small dim' }, 'Chats you have are saved here.'));
    };
    const m = modal('Chat history', [list]);
    paintList();
  }

  function personaMenu() {
    if (!canUse('personas')) return locked('personas');
    const current = load('ai.activePersona', '');
    const list = el('div', { class: 'col gap-4' },
      el('div', { class: `item clickable ${!current ? 'selected' : ''}`, onclick: () => { save('ai.activePersona', ''); m.close(); toast('No persona'); } }, el('div', { class: 'main' }, 'No persona')),
      ...AI.personas().map((p) => el('div', { class: `item clickable ${current === p.id ? 'selected' : ''}`, onclick: () => { save('ai.activePersona', p.id); m.close(); toast(`Persona: ${p.name}`); } },
        el('div', { class: 'main' }, el('div', {}, p.name), el('div', { class: 'tiny faint' }, p.instructions)))));
    const name = el('input', { class: 'field', placeholder: 'New persona name' });
    const instr = el('textarea', { class: 'field', placeholder: 'Standing instructions, e.g. "Answer like a friendly maths teacher"', style: 'min-height:60px' });
    const m = modal('Persona', [list, el('div', { class: 'section-title' }, 'Add your own'), name, instr], {
      actions: [button('Add', () => {
        if (!name.value.trim() || !instr.value.trim()) return;
        const p = { id: `p-${Date.now()}`, name: name.value.trim(), instructions: instr.value.trim() };
        save('ai.personas', [...AI.personas(), p]); save('ai.activePersona', p.id); m.close(); toast(`Persona: ${p.name}`);
      })] });
  }

  function promptsDialog() {
    if (!canUse('personas')) return locked('personas');
    const list = el('div', { class: 'col gap-4' });
    const paintList = () => list.replaceChildren(...AI.savedPrompts().map((p, i) => el('div', { class: 'item clickable', onclick: () => { input.value = p.text; m.close(); input.focus(); } },
      el('div', { class: 'main' }, el('div', {}, p.title), el('div', { class: 'tiny faint ellipsis' }, p.text)),
      el('div', { class: 'actions' }, iconBtn('🗑', 'Delete', async (e) => { e.stopPropagation(); if (await confirm(`Delete "${p.title}"?`, { ok: 'Delete', danger: true })) { const l = AI.savedPrompts(); l.splice(i, 1); save('ai.savedPrompts', l); paintList(); } })))));
    const title = el('input', { class: 'field', placeholder: 'Title' });
    const text = el('input', { class: 'field', placeholder: 'Prompt (end with a space to fill in the rest)' });
    const m = modal('Saved prompts', [list, el('div', { class: 'hstack' }, title, text)], {
      actions: [button('Save', () => { if (!title.value.trim() || !text.value) return; save('ai.savedPrompts', [...AI.savedPrompts(), { title: title.value.trim(), text: text.value }]); title.value = ''; text.value = ''; paintList(); paintChips(); })] });
    paintList();
  }

  // ---- layout ----

  root.append(el('div', { class: 'col fill', style: 'gap:8px' },
    el('div', { class: 'hstack' }, providerSel, modelSel, el('div', { class: 'spacer' }), webBtn, shotBtn, fileBtn, voiceBtn, speakBtn, moreBtn),
    log, slashBox, tray, notice,
    el('div', { class: 'hstack', style: 'align-items:flex-end' }, input, sendBtn)));

  paintModels();
  keyHint();
  paint();

  if (opts.screen) attachScreen();
  if (opts.ask) { input.value = opts.ask; submit(); }
  setTimeout(() => input.focus(), 50);

  return () => { unlistenDrop?.(); speechSynthesis.cancel(); };
}
