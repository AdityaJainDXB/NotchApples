// NotchAI on Windows (beta): the first stage of the Windows plan in docs/NOTCHAI_ROADMAP.md, which is chat with a
// local model. It is the same conversation idea as the Mac's NotchAI tab: one chat, Stop, Regenerate, New chat,
// answers in Markdown, and the answer read aloud by a Windows voice if you want.
//
// Local first is the point of it. While "Allow cloud and unverified models" is off, a question is only sent to a
// model that Ollama's own model list shows as installed on this PC. Any other provider, or a model that cannot be
// confirmed, is refused before a request is made. The rules are in services/notchailogic.js (node tests).
//
// Not on Windows yet: voice questions, screen reading, files, agents, connectors, routines. The tab says so.

import { el, load, save } from '../store.js';
import { http } from '../native.js';
import { markdown, toast } from '../ui.js';
import * as AI from '../services/ai.js';
import * as L from '../services/notchailogic.js';

const GREEN = '#22C55E';
const SYSTEM = "You are NotchAI, an assistant in the user's notch on their Windows PC. Be concise and use Markdown when it helps.";

/// Ollama's own list of installed models, or null when it cannot be read (Ollama is not running).
async function ollamaTags() {
  try {
    const r = await http('http://localhost:11434/api/tags', { timeout: 4000 });
    if (!r.ok) return null;
    const j = r.json();
    return Array.isArray(j?.models) ? j.models : null;
  } catch { return null; }
}

export function render(root) {
  let turns = load('notchai.turns', []);            // [{ role: 'user' | 'assistant', text }]
  let busy = false;
  let run = 0;                                       // a newer run, or Stop, makes an older answer be ignored
  let tags = null;
  let speaking = false;

  const allowCloud = () => load('notchai.allowCloud', false);
  const speakOn = () => load('notchai.speak', false);
  const provider = () => AI.provider();
  const model = () => AI.modelOf(provider());

  const dot = el('span', { style: `display:inline-block;width:12px;height:12px;border-radius:50%;background:${GREEN};box-shadow:0 0 8px ${GREEN}` });
  const where = el('span', { class: 'small', style: 'padding:2px 8px;border-radius:999px;border:1px solid var(--border)' });
  const modelLine = el('div', { class: 'small dim' });
  const notice = el('div', { class: 'small', style: 'min-height:14px;color:#f5a623' });
  const log = el('div', { class: 'col scroll', style: 'flex:1;gap:8px;padding:2px 4px 2px 0;min-height:0' });
  const input = el('textarea', { class: 'field', rows: 1, placeholder: 'Ask NotchAI…  (Enter to send, Shift+Enter for a new line)', style: 'min-height:36px;max-height:110px;width:100%' });
  const sendBtn = el('button', { class: 'btn small', type: 'button' }, 'Send');
  const stopBtn = el('button', { class: 'btn quiet small', type: 'button' }, 'Stop');
  const againBtn = el('button', { class: 'btn quiet small', type: 'button', title: 'Ask the last question again' }, 'Regenerate');
  const newBtn = el('button', { class: 'btn quiet small', type: 'button' }, 'New chat');
  const cloudBox = el('input', { type: 'checkbox' });
  const speakBox = el('input', { type: 'checkbox' });
  cloudBox.checked = allowCloud();
  speakBox.checked = speakOn();

  function paintStatus() {
    const p = provider(), m = model();
    const v = p === 'ollama' && tags ? L.verdict(tags, m) : null;
    const b = L.badge(p, m, v);
    where.textContent = b;
    where.style.color = b === 'Local' ? GREEN : '#f5a623';
    modelLine.textContent = `${(AI.PROVIDERS[p] || {}).name || p} · ${m}  (change it in the AI tab)`;
    stopBtn.disabled = !busy && !speaking;
    sendBtn.disabled = busy;
    againBtn.disabled = busy || !L.regeneration(turns);
    newBtn.disabled = busy || !turns.length;
  }

  function paintLog() {
    log.replaceChildren();
    if (!turns.length) {
      log.append(el('div', { class: 'small dim', style: 'padding:8px 2px' },
        'Ask anything. With Local first on, your words go only to a model on this PC (Ollama). ',
        'On Windows NotchAI is chat only for now: voice questions, screen reading, files and agents are on the Mac.'));
    }
    for (const t of turns) {
      const bubble = el('div', { style: `padding:8px 10px;border-radius:10px;max-width:92%;${t.role === 'user'
        ? 'align-self:flex-end;background:rgba(34,197,94,.18)' : 'align-self:flex-start;background:var(--surface)'}` });
      if (t.role === 'assistant') bubble.append(markdown(t.text)); else bubble.textContent = t.text;
      log.append(bubble);
    }
    if (busy) log.append(el('div', { class: 'small dim', style: 'align-self:flex-start;padding:4px 2px' }, 'Thinking…'));
    log.scrollTop = log.scrollHeight;
  }

  const keep = () => save('notchai.turns', turns.slice(-60));

  function stopSpeaking() {
    try { window.speechSynthesis?.cancel(); } catch {}
    speaking = false;
  }

  /// Reads an answer with a Windows voice, sentence group by sentence group, so Stop works between them.
  function speak(text) {
    const synth = window.speechSynthesis;
    if (!synth || typeof SpeechSynthesisUtterance === 'undefined') return;
    stopSpeaking();
    const parts = L.chunks(L.spokenText(text));
    if (!parts.length) return;
    speaking = true;
    parts.forEach((part, i) => {
      const u = new SpeechSynthesisUtterance(part);
      if (i === parts.length - 1) u.onend = u.onerror = () => { speaking = false; paintStatus(); };
      synth.speak(u);
    });
    paintStatus();
  }

  async function answer(history, question) {
    const mine = ++run;
    busy = true; notice.textContent = ''; stopSpeaking();
    turns = [...history, { role: 'user', text: question }];
    keep(); paintLog(); paintStatus();
    try {
      const p = provider(), m = model();
      // Local first: decide before anything is sent. The model list is read fresh each time (it is on this PC).
      if (!allowCloud() && p === 'ollama') tags = await ollamaTags();
      const gate = L.guard({ provider: p, providerName: (AI.PROVIDERS[p] || {}).name, model: m, allowCloud: allowCloud(), v: p === 'ollama' && tags ? L.verdict(tags, m) : null });
      if (!gate.ok) throw new Error(gate.why);
      const sendable = L.trimmed(turns, L.contextBudget(null)).map((t) => ({ role: t.role, text: t.text }));
      const out = await AI.send(sendable, { p, model: m, system: SYSTEM });
      if (mine !== run) return;                       // stopped, or a newer question took over
      turns = [...turns, { role: 'assistant', text: out.text }];
      keep();
      if (out.note) notice.textContent = out.note;
      if (speakOn()) speak(out.text);
    } catch (e) {
      if (mine !== run) return;
      notice.textContent = e?.message || String(e);
    } finally {
      if (mine === run) { busy = false; paintLog(); paintStatus(); }
    }
  }

  function send() {
    const q = input.value.trim();
    if (!q || busy) return;
    input.value = '';
    answer(turns, q);
  }

  sendBtn.addEventListener('click', send);
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } });
  stopBtn.addEventListener('click', () => {
    stopSpeaking();
    if (busy) { run++; busy = false; notice.textContent = 'Stopped. The answer, if it still arrives, is ignored.'; }
    paintLog(); paintStatus();
  });
  againBtn.addEventListener('click', () => { const r = L.regeneration(turns); if (r && !busy) answer(r.history, r.question); });
  newBtn.addEventListener('click', () => { if (busy) return; stopSpeaking(); turns = []; keep(); notice.textContent = ''; paintLog(); paintStatus(); });
  cloudBox.addEventListener('change', () => {
    save('notchai.allowCloud', cloudBox.checked);
    toast(cloudBox.checked ? 'Cloud and unverified models are allowed: your words can leave this PC' : 'Local first is on: only a model on this PC is used');
    paintStatus();
  });
  speakBox.addEventListener('change', () => { save('notchai.speak', speakBox.checked); if (!speakBox.checked) stopSpeaking(); paintStatus(); });

  root.replaceChildren(el('div', { class: 'col', style: 'height:100%;gap:8px;min-height:0' },
    el('div', { class: 'hstack', style: 'gap:10px;align-items:center' },
      dot,
      el('div', { class: 'col', style: 'flex:1;min-width:0' },
        el('div', { style: 'font-weight:700' }, 'NotchAI ', el('span', { class: 'small dim' }, 'beta on Windows · chat')),
        modelLine),
      where),
    log,
    notice,
    input,
    el('div', { class: 'hstack wrap', style: 'gap:6px;align-items:center' }, sendBtn, stopBtn, againBtn, newBtn,
      el('label', { class: 'small hstack', style: 'gap:4px;align-items:center;margin-left:auto' }, speakBox, 'Read answers aloud')),
    el('label', { class: 'small dim hstack', style: 'gap:6px;align-items:center' }, cloudBox,
      'Allow cloud and unverified models (off: only a model Ollama has installed on this PC is used, and anything else is refused before it is sent)')));

  paintLog(); paintStatus();
  ollamaTags().then((t) => { tags = t; paintStatus(); });
  return () => { run++; stopSpeaking(); };
}
