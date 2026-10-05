// Translator: 7 languages with a pronunciation line (free MyMemory service).
import { el, load, save } from '../store.js';
import { invoke, getJSON } from '../native.js';
import { toast } from '../ui.js';

export const LANGS = {
  english: { name: 'English', code: 'en', voice: 'en-US', latin: true }, arabic: { name: 'Arabic', code: 'ar', voice: 'ar-SA' },
  french: { name: 'French', code: 'fr', voice: 'fr-FR', latin: true }, spanish: { name: 'Spanish', code: 'es', voice: 'es-ES', latin: true },
  hindi: { name: 'Hindi', code: 'hi', voice: 'hi-IN' }, mandarin: { name: 'Mandarin', code: 'zh-CN', voice: 'zh-CN' },
  german: { name: 'German', code: 'de', voice: 'de-DE', latin: true },
};
export async function translate(text, from, to) {
  if (from === to) return text;
  const j = await getJSON(`https://api.mymemory.translated.net/get?q=${encodeURIComponent(text.slice(0, 500))}&langpair=${encodeURIComponent(`${LANGS[from].code}|${LANGS[to].code}`)}`);
  if (Number(j.responseStatus) !== 200) throw new Error(Number(j.responseStatus) === 429 ? 'The free translation limit for today has been reached.' : "Couldn't translate that.");
  return String(j.responseData.translatedText).replaceAll('&#39;', "'").replaceAll('&quot;', '"').replaceAll('&amp;', '&');
}
export function render(root, opts = {}) {
  let from = load('tr.from', 'english'), to = load('tr.to', 'spanish'), deb;
  const input = el('textarea', { class: 'field', style: 'flex:1', placeholder: 'Type or paste text…', value: opts.text || '' });
  const out = el('div', { class: 'selectable', style: 'font-size:16px;white-space:pre-wrap;flex:1;overflow:auto' });
  const phon = el('div', { class: 'accent', style: 'font-style:italic' }), status = el('div', { class: 'small dim', style: 'min-height:15px' });
  const sel = (v, f) => { const s = el('select', { class: 'field auto' }, ...Object.entries(LANGS).map(([id, l]) => el('option', { value: id, selected: id === v }, l.name))); s.onchange = () => f(s.value); return s; };
  const fromSel = sel(from, (v) => { from = v; save('tr.from', v); run(0); }), toSel = sel(to, (v) => { to = v; save('tr.to', v); run(0); });
  function run(delay = 500) {
    clearTimeout(deb);
    const text = input.value.trim();
    if (!text) { out.textContent = ''; phon.textContent = ''; status.textContent = ''; return; }
    deb = setTimeout(async () => {
      status.textContent = 'Translating…';
      try { const r = await translate(text, from, to); out.textContent = r; status.textContent = ''; phon.textContent = LANGS[to].latin ? '' : await invoke('transliterate', { text: r }).catch(() => ''); }
      catch (e) { status.replaceChildren(el('span', { class: 'err' }, e.message)); }
    }, delay);
  }
  input.oninput = () => run();
  root.append(el('div', { class: 'col fill' },
    el('div', { class: 'hstack' }, fromSel, el('button', { class: 'icon-btn', title: 'Swap', onclick: () => { [from, to] = [to, from]; fromSel.value = from; toSel.value = to; save('tr.from', from); save('tr.to', to); if (out.textContent) input.value = out.textContent; run(0); } }, '⇄'), toSel,
      el('div', { class: 'spacer' }),
      el('button', { class: 'icon-btn', title: 'Read aloud', onclick: () => { speechSynthesis.cancel(); const u = new SpeechSynthesisUtterance(out.textContent); u.lang = LANGS[to].voice; speechSynthesis.speak(u); } }, '🔊'),
      el('button', { class: 'icon-btn', title: 'Copy', onclick: () => invoke('clipboard_copy_text', { text: out.textContent }).then(() => toast('Copied')) }, '⧉')),
    el('div', { class: 'row', style: 'flex:1' }, el('div', { class: 'card col' }, input), el('div', { class: 'card col' }, out, phon)), status));
  if (opts.text) run(0);
  setTimeout(() => input.focus(), 40);
}
