// Tools → AI Detector: paste text and see how strongly it shows the habits that make writing read like a chatbot, and which ones.
// It runs on this PC with no model and no network (services/aitells.js), so it is free and unlimited. It is a guide to writing
// habits, not a detector like ZeroGPT's, and no score proves who wrote something.
import { el } from '../store.js';
import * as T from '../services/aitells.js';
import { wordCount } from '../services/humanizerlogic.js';

const colour = (s) => (s < 15 ? '#22c55e' : s < 40 ? '#eab308' : s < 70 ? '#f97316' : '#ef4444');

export function render(root) {
  const input = el('textarea', { class: 'field', style: 'flex:1', placeholder: 'Paste the text to check…' });
  const count = el('div', { class: 'small dim' }, '0 words');
  const result = el('div', { class: 'col gap-6', style: 'flex:1;overflow:auto' }, el('div', { class: 'small dim' }, 'Paste some text and press Check.'));
  const check = el('button', { class: 'btn', disabled: true }, 'Check');
  input.oninput = () => { const w = wordCount(input.value); count.textContent = `${w} words`; check.disabled = w === 0; };
  check.onclick = () => {
    const r = T.report(input.value);
    result.replaceChildren(
      el('div', { class: 'hstack', style: 'gap:8px;align-items:baseline' }, el('div', { style: `font-size:30px;font-weight:700;color:${colour(r.score)}` }, `${r.score}%`), el('b', {}, T.verdict(r.score))),
      el('div', { style: 'height:6px;border-radius:3px;background:rgba(255,255,255,.1)' }, el('div', { style: `height:6px;border-radius:3px;width:${r.score}%;background:${colour(r.score)}` })),
      ...(r.tells.length ? r.tells.map((t) => el('div', { class: 'hstack' }, el('span', { class: 'grow small' }, t.label), el('b', { class: 'small' }, String(t.count)))) : [el('div', { class: 'small dim' }, 'No chatbot habits found.')]),
      r.uniformRhythm ? el('div', { class: 'small warn' }, 'Sentences are all about the same length.') : null);
  };
  root.append(el('div', { class: 'hstack', style: 'gap:12px;align-items:stretch;flex:1;min-height:0;height:100%' },
    el('div', { class: 'card col gap-6', style: 'flex:1;min-width:0' }, el('div', { class: 'section-title' }, 'Text to check'), input, el('div', { class: 'hstack' }, count, el('div', { class: 'spacer' }), check)),
    el('div', { class: 'card col gap-6', style: 'flex:1;min-width:0' }, el('div', { class: 'section-title' }, 'Result'), result,
      el('div', { class: 'tiny dim' }, 'A guide to writing habits, not proof. It runs on this PC and sends nothing. Real detectors such as ZeroGPT use other methods and can disagree.'))));
}
