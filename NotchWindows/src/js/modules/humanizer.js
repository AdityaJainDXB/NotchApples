// Tools → Humanizer: paste text, press Humanize, and the model chosen in AI settings rewrites it so it reads like a person wrote it.
import { el } from '../store.js';
import { invoke } from '../native.js';
import { toast } from '../ui.js';
import * as H from '../services/humanizer.js';
import * as L from '../services/humanizerlogic.js';

export function render(root) {
  const input = el('textarea', { class: 'field', style: 'flex:1', placeholder: 'Paste or type the text to rewrite…' });
  const out = el('div', { class: 'selectable', style: 'white-space:pre-wrap;flex:1;overflow:auto;font-size:14px' }, '');
  const count = el('div', { class: 'small dim' });
  const left = el('div', { class: 'small dim grow' });
  const problem = el('div', { class: 'small err' });
  const run = el('button', { class: 'btn' }, 'Humanize');
  function paintCount() {
    const w = L.wordCount(input.value), lim = H.perRequestLimit();
    count.textContent = lim === null ? `${w} words` : `${w} of ${lim} words`;
    count.style.color = lim !== null && w > lim ? 'var(--warn, #f59e0b)' : '';
    left.textContent = H.summary();
    run.disabled = H.isBusy() || w === 0;
  }
  input.oninput = paintCount;
  run.onclick = async () => {
    problem.textContent = ''; run.textContent = 'Working…'; run.disabled = true;
    try { out.textContent = await H.humanize(input.value); } catch (e) { problem.textContent = e.message; }
    run.textContent = 'Humanize'; paintCount();
  };
  paintCount();
  root.append(el('div', { class: 'col fill', style: 'gap:8px' },
    el('div', { class: 'hstack fill', style: 'gap:12px;align-items:stretch;flex:1;min-height:0' },
      el('div', { class: 'card col gap-6', style: 'flex:1;min-width:0' }, el('div', { class: 'section-title' }, 'Your text'), input, el('div', { class: 'hstack' }, count, el('div', { class: 'spacer' }), run)),
      el('div', { class: 'card col gap-6', style: 'flex:1;min-width:0' }, el('div', { class: 'hstack' }, el('div', { class: 'section-title grow' }, 'Rewritten'),
        el('button', { class: 'icon-btn', title: 'Copy', onclick: () => out.textContent && invoke('clipboard_copy_text', { text: out.textContent }).then(() => toast('Copied')) }, '⧉')), out)),
    el('div', { class: 'hstack' }, left, H.monthlyLeft() === 0 && H.credits() === 0 ? el('div', { class: 'small accent' }, 'Extra words (1 USD = 50,000, they never run out): coming soon') : null),
    problem));
}
