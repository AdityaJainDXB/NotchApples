// Voice Notes (Pro): record from the notch; transcribe and summarise with AI.
import { el, load, save, uid, timeAgo, fmtClock } from '../store.js';
import { invoke } from '../native.js';
import { toast, iconBtn, markdown, empty } from '../ui.js';

export function render(root) {
  let rec = null, chunks = [], started = 0, t;
  const list = el('div', { class: 'col gap-4 scroll', style: 'flex:1' }), timer = el('div', { class: 'big num' }, '0:00');
  const btn = el('button', { class: 'btn', style: 'min-width:140px' }, '🎙 Record');
  const notes = () => load('voicenotes.items', []);
  btn.onclick = async () => {
    if (rec) { rec.stop(); return; }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      rec = new MediaRecorder(stream); chunks = []; started = Date.now();
      rec.ondataavailable = (e) => chunks.push(e.data);
      rec.onstop = async () => {
        stream.getTracks().forEach((x) => x.stop()); clearInterval(t);
        const blob = new Blob(chunks, { type: rec.mimeType }); rec = null; btn.textContent = '🎙 Record';
        const data = await new Promise((r) => { const fr = new FileReader(); fr.onload = () => r(fr.result); fr.readAsDataURL(blob); });
        save('voicenotes.items', [{ id: uid(), at: Date.now(), secs: Math.round((Date.now() - started) / 1000), data, mime: blob.type }, ...notes()].slice(0, 10));
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
      const r = await AI.send([{ role: 'user', text: 'Transcribe this voice note, then give a short summary and any action items, in Markdown with headings "Transcript", "Summary" and "Action items".', images: [{ mime, data: n.data.split(',')[1] }] }], { p: 'gemini' });
      save('voicenotes.items', notes().map((x) => (x.id === n.id ? { ...x, text: r.text } : x))); paint();
    } catch (e) { toast(e.message, { error: true }); }
  }
  function paint() {
    const l = notes();
    list.replaceChildren(...l.map((n) => el('div', { class: 'card col gap-6' },
      el('div', { class: 'hstack' }, el('span', { class: 'grow small' }, `🎙 ${timeAgo(n.at)} · ${fmtClock(n.secs)}`),
        iconBtn('✨', 'Transcribe and summarise', () => transcribe(n)), iconBtn('🗑', 'Delete', () => { save('voicenotes.items', notes().filter((x) => x.id !== n.id)); paint(); })),
      el('audio', { src: n.data, controls: true, style: 'width:100%;height:32px' }),
      n.text ? markdown(n.text) : null)));
    if (!l.length) list.append(empty('🎙', 'No voice notes', 'Press Record and speak. Transcribe with one click.'));
  }
  root.append(el('div', { class: 'row fill' }, el('div', { class: 'card center', style: 'flex:0 0 220px' }, el('div', { class: 'col', style: 'align-items:center;gap:10px' }, timer, btn)), list));
  paint();
  return () => { clearInterval(t); if (rec) rec.stop(); };
}
