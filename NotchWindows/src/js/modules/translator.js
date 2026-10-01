// Translator: 7 languages with a pronunciation line, ported from TranslationManager.swift.
// Translation uses the free MyMemory service, so the text you type is sent to it.
// The pronunciation line is produced on this PC by the Rust side (any_ascii).
import { el, load, save } from '../store.js';
import { invoke } from '../app.js';

export const LANGS = {
  english:  { name: 'English',  code: 'en',    voice: 'en-US', latin: true },
  arabic:   { name: 'Arabic',   code: 'ar',    voice: 'ar-SA', latin: false },
  french:   { name: 'French',   code: 'fr',    voice: 'fr-FR', latin: true },
  spanish:  { name: 'Spanish',  code: 'es',    voice: 'es-ES', latin: true },
  hindi:    { name: 'Hindi',    code: 'hi',    voice: 'hi-IN', latin: false },
  mandarin: { name: 'Mandarin', code: 'zh-CN', voice: 'zh-CN', latin: false },
  german:   { name: 'German',   code: 'de',    voice: 'de-DE', latin: true },
};

const LIMIT = 500;

export async function translate(text, from, to) {
  if (from === to) return text;
  const url = 'https://api.mymemory.translated.net/get?q=' + encodeURIComponent(text.slice(0, LIMIT))
            + '&langpair=' + encodeURIComponent(`${LANGS[from].code}|${LANGS[to].code}`);
  const json = await fetch(url).then((r) => r.json());
  const status = Number(json.responseStatus);
  if (status !== 200) {
    throw new Error(status === 429
      ? 'The free translation limit for today has been reached. Try again later.'
      : "The translation service couldn't translate that.");
  }
  return String(json.responseData.translatedText)
    .replaceAll('&#39;', "'").replaceAll('&quot;', '"').replaceAll('&amp;', '&');
}

export function render(root) {
  let from = load('tr.from', 'english'), to = load('tr.to', 'spanish');
  let debounce;

  const input = el('textarea', { class: 'field', placeholder: 'Type or paste text…', style: 'flex:1' });
  const output = el('div', { style: 'font-size:16px;font-weight:500;white-space:pre-wrap;user-select:text' });
  const phonetic = el('div', { style: 'font-style:italic;color:var(--accent-bright);user-select:text' });
  const phoneticCard = el('div', { class: 'card col', style: 'gap:4px' },
    el('div', { class: 'section-title' }, 'Pronunciation'), phonetic);
  const status = el('div', { class: 'small dim', style: 'min-height:15px' });
  const counter = el('div', { class: 'small dim' }, `0/${LIMIT}`);

  const mkSelect = (value, onChange) => {
    const s = el('select', { class: 'field', style: 'max-width:130px' },
      ...Object.entries(LANGS).map(([id, l]) => el('option', { value: id, selected: id === value }, l.name)));
    s.addEventListener('change', () => onChange(s.value));
    return s;
  };

  const fromSel = mkSelect(from, (v) => { from = v; save('tr.from', v); run(true); });
  const toSel = mkSelect(to, (v) => { to = v; save('tr.to', v); run(true); });

  const swap = el('button', { class: 'sys-btn', title: 'Swap languages' }, '⇄');
  swap.addEventListener('click', () => {
    [from, to] = [to, from];
    save('tr.from', from); save('tr.to', to);
    fromSel.value = from; toSel.value = to;
    if (output.textContent) input.value = output.textContent;
    run(true);
  });

  const speak = el('button', { class: 'sys-btn', title: 'Read aloud' }, '🔊');
  speak.addEventListener('click', () => {
    if (speechSynthesis.speaking) { speechSynthesis.cancel(); return; }
    if (!output.textContent) return;
    const u = new SpeechSynthesisUtterance(output.textContent);
    u.lang = LANGS[to].voice;
    speechSynthesis.speak(u);
  });

  const copy = el('button', { class: 'sys-btn', title: 'Copy translation' }, '⧉');
  copy.addEventListener('click', () => invoke('write_clipboard', { text: output.textContent || '' }));

  async function run(immediate = false) {
    clearTimeout(debounce);
    const text = input.value.trim();
    counter.textContent = `${input.value.length}/${LIMIT}`;
    if (!text) { output.textContent = ''; phonetic.textContent = ''; phoneticCard.classList.add('hidden'); status.textContent = ''; return; }
    debounce = setTimeout(async () => {
      status.textContent = 'Translating…';
      try {
        const result = await translate(text, from, to);
        output.textContent = result;
        status.textContent = '';
        if (!LANGS[to].latin) {
          const latin = await invoke('transliterate', { text: result }).catch(() => '');
          phonetic.textContent = latin || '';
          phoneticCard.classList.toggle('hidden', !latin);
        } else { phoneticCard.classList.add('hidden'); }
      } catch (e) {
        status.textContent = '';
        output.textContent = '';
        phoneticCard.classList.add('hidden');
        status.append(el('span', { class: 'err' }, String(e.message ?? e)));
      }
    }, immediate ? 0 : 600);
  }

  input.addEventListener('input', () => {
    if (input.value.length > LIMIT) input.value = input.value.slice(0, LIMIT);
    run();
  });

  phoneticCard.classList.add('hidden');
  root.append(el('div', { class: 'col', style: 'height:100%' },
    el('div', { style: 'display:flex;gap:8px;align-items:center' }, fromSel, swap, toSel,
      el('div', { style: 'margin-left:auto;display:flex;gap:4px' }, speak, copy)),
    el('div', { class: 'row', style: 'flex:1;min-height:0' },
      el('div', { class: 'card col' },
        el('div', { style: 'display:flex' }, el('div', { class: 'section-title' }, 'From'),
          el('div', { style: 'margin-left:auto' }, counter)),
        input),
      el('div', { class: 'col' },
        el('div', { class: 'card col', style: 'flex:1' },
          el('div', { class: 'section-title' }, 'To'), output),
        phoneticCard)),
    status));
  setTimeout(() => input.focus(), 40);
}
