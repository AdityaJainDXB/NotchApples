// Voice Notes (Pro): record from the notch; transcribe and summarise with AI.
import { el, load, save, uid, timeAgo, fmtClock } from '../store.js';
import { invoke } from '../native.js';
import { toast, iconBtn, markdown, empty } from '../ui.js';
import * as MS from '../services/meetingsummary.js';
import * as MN from '../services/meetingnotes.js';
import { canUse } from '../features.js';

export function render(root, opts = {}) {
  let rec = null, chunks = [], started = 0, t, meeting = canUse('meetingSummaries') && opts.meeting ? String(opts.meeting) : null;   // set when started from a calendar event
  const consent = el('div', { class: 'tiny', style: 'color:var(--warn,#ffb547);text-align:center;min-height:14px' });
  const list = el('div', { class: 'col gap-4 scroll', style: 'flex:1' }), timer = el('div', { class: 'big num' }, '0:00');
  const btn = el('button', { class: 'btn', style: 'min-width:140px' }, '🎙 Record');
  const notes = () => load('voicenotes.items', []);
  btn.onclick = async () => {
    if (rec) { rec.stop(); return; }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      rec = new MediaRecorder(stream); chunks = []; started = Date.now(); consent.textContent = meeting ? MS.CONSENT : '';
      rec.ondataavailable = (e) => chunks.push(e.data);
      rec.onstop = async () => {
        stream.getTracks().forEach((x) => x.stop()); clearInterval(t);
        const blob = new Blob(chunks, { type: rec.mimeType }); rec = null; btn.textContent = '🎙 Record'; consent.textContent = '';
        const data = await new Promise((r) => { const fr = new FileReader(); fr.onload = () => r(fr.result); fr.readAsDataURL(blob); });
        save('voicenotes.items', [{ id: uid(), at: Date.now(), secs: Math.round((Date.now() - started) / 1000), data, mime: blob.type, ...(meeting ? { meeting } : {}) }, ...notes()].slice(0, 10)); meeting = null;
        paint();
      };
      rec.start(); btn.textContent = '■ Stop';
      t = setInterval(() => { timer.textContent = fmtClock((Date.now() - started) / 1000); }, 250);
    } catch (e) { toast(`Microphone: ${e.message}`, { error: true }); }
  };
  async function transcribe(n) {
    const AI = await import('../services/ai.js');
    if (AI.provider() !== 'gemini' || !AI.keyOf('gemini')) return toast('Transcribing uses Google Gemini: add its free key in Settings → AI and choose it in the AI tab.', { error: true });
    toast('Transcribing…');
    try {
      const mime = n.mime.split(';')[0] || 'audio/webm';
      const r = await AI.send([{ role: 'user', text: n.meeting ? MS.prompt(n.meeting, '(The recording is attached as audio. Write a "Transcript" section first, then the sections above, in Markdown.)') : 'Transcribe this voice note, then give a short summary and any action items, in Markdown with headings "Transcript", "Summary" and "Action items".', images: [{ mime, data: n.data.split(',')[1] }] }], { p: 'gemini' });
      save('voicenotes.items', notes().map((x) => (x.id === n.id ? { ...x, text: r.text } : x))); paint();
    } catch (e) { toast(e.message, { error: true }); }
  }
  // Adds a meeting's summary to its note in Notes (making the note if there isn't one yet).
  function addToMeetingNotes(n) {
    const day = new Date(n.at).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' });
    const time = new Date(n.at).toLocaleTimeString([], { timeStyle: 'short' });
    const all = load('notes.items', []);
    let i = MN.existing(all.map((x) => x.text), n.meeting, day);
    if (i < 0) { all.unshift({ id: uid(), text: MN.template(n.meeting, day, time), updated: Date.now() }); i = 0; }
    if (all[i].text.includes(n.text.trim())) return toast('Already in your meeting notes');
    all[i] = { ...all[i], text: all[i].text + MS.noteSection(n.text), updated: Date.now() };
    save('notes.items', all);
    toast('Added to your meeting notes');
  }
  function paint() {
    const l = notes();
    list.replaceChildren(...l.map((n) => el('div', { class: 'card col gap-6' },
      el('div', { class: 'hstack' }, el('span', { class: 'grow small' }, `${n.meeting ? `📅 ${n.meeting}` : '🎙'} · ${timeAgo(n.at)} · ${fmtClock(n.secs)}`),
        iconBtn('✨', 'Transcribe and summarise', () => transcribe(n)),
        n.meeting && n.text ? iconBtn('📝', "Add this to the meeting's note", () => addToMeetingNotes(n)) : null, iconBtn('🗑', 'Delete', () => { save('voicenotes.items', notes().filter((x) => x.id !== n.id)); paint(); })),
      el('audio', { src: n.data, controls: true, style: 'width:100%;height:32px' }),
      n.text ? markdown(n.text) : null)));
    if (!l.length) list.append(empty('🎙', 'No voice notes', 'Press Record and speak. Transcribe with one click.'));
  }
  root.append(el('div', { class: 'row fill' }, el('div', { class: 'card center', style: 'flex:0 0 220px' }, el('div', { class: 'col', style: 'align-items:center;gap:10px' }, timer, btn, consent, el('div', { class: 'tiny faint', style: 'text-align:center' }, 'Records your microphone.'))), list));
  paint();
  if (meeting) btn.onclick();   // started from a calendar event: begin recording straight away
  return () => { clearInterval(t); if (rec) rec.stop(); };
}
