// The Do It tab (Ultimate): tell the AI a task, press Start, and it looks at the screen and clicks, types and scrolls
// step by step until it is done. You can answer its questions here, and Stop it at any time. The run lives in
// services/doit.js, so it carries on while the notch is out of the way.

import { el } from '../store.js';
import { canUse } from '../features.js';
import { toggle, empty } from '../ui.js';
import * as D from '../services/doit.js';

export function render(root) {
  if (!canUse('doit')) {
    root.append(el('div', { class: 'card col fill' }, empty('🪄', 'Do It is part of Ultimate', 'Unlock Ultimate in Settings to let the AI do tasks on your screen.')));
    return () => {};
  }

  const dot = el('span', { class: 'di-dot' });
  const sub = el('div', { class: 'small dim ellipsis' });
  const log = el('div', { class: 'col scroll di-log' });
  const notice = el('div', { class: 'small di-notice' });
  const input = el('textarea', { class: 'field', rows: 1, style: 'min-height:36px;max-height:110px;flex:1;resize:none' });
  const go = el('button', { class: 'btn', onclick: () => submit() }, 'Start');
  const stopBtn = el('button', { class: 'btn danger', title: 'Stop (Ctrl+Alt+Esc)', onclick: () => D.stop() }, 'Stop');
  const approveBar = el('div', { class: 'hstack di-approve hidden' });
  const confirmSw = el('span', { style: 'flex:none;display:flex' }, toggle(D.confirmEvery(), (v) => D.setConfirmEvery(v)));

  const head = el('div', { class: 'hstack', style: 'gap:12px' },
    el('div', { class: 'di-icon' }, '🪄'),
    el('div', { class: 'grow', style: 'min-width:0' }, el('div', { class: 'title' }, 'Do It'), sub), dot);
  const how = el('div', { class: 'tiny dim' },
    'Uses this PC’s screen: screenshots go to the AI provider chosen in Settings → AI. Stop with the Stop button, the little bar on screen, or Ctrl+Alt+Esc.');
  root.append(el('div', { class: 'card col fill', style: 'gap:10px;min-height:0' }, head, log, notice, approveBar,
    el('div', { class: 'hstack', style: 'gap:8px;align-items:flex-end' }, input, go, stopBtn),
    el('div', { class: 'hstack', style: 'gap:8px' }, el('label', { class: 'hstack small', style: 'gap:6px;cursor:pointer;flex:none' }, confirmSw, 'Confirm every step')),
    how));

  async function submit() {
    const text = input.value.trim();
    if (!text) return;
    const st = D.snapshot();
    if (st.running) {
      if (D.reply(text)) input.value = '';
      return;
    }
    const err = await D.start(text);
    if (err) notice.textContent = err; else { notice.textContent = ''; input.value = ''; }
  }

  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); submit(); }
  });

  function paint(st = D.snapshot()) {
    const issue = D.visionIssue();
    dot.className = `di-dot${st.running ? (st.waiting ? ' wait' : ' run') : ''}`;
    sub.textContent = st.running
      ? (st.waiting === 'ask' ? 'Waiting for your answer' : st.waiting === 'confirm' ? 'Waiting for you to approve the next step' : `Working · step ${st.step} of ${D.MAX_STEPS}`)
      : 'Tell the AI a task and it does it on your screen, step by step.';
    notice.textContent = st.running ? '' : (issue || notice.textContent);
    notice.classList.toggle('bad', !!issue && !st.running);

    go.classList.add('primary');
    go.textContent = st.running ? 'Reply' : 'Start';
    go.style.display = st.running && st.waiting !== 'ask' ? 'none' : '';
    stopBtn.style.display = st.running ? '' : 'none';
    input.placeholder = st.running
      ? (st.waiting === 'ask' ? 'Answer the question…' : 'Add a note for the AI…')
      : 'What should I do? e.g. “Fill in this worksheet”';

    approveBar.classList.toggle('hidden', st.waiting !== 'confirm');
    approveBar.replaceChildren(...(st.waiting === 'confirm' ? [
      el('div', { class: 'small grow' }, 'Allow this step?'),
      el('button', { class: 'btn quiet small', onclick: () => D.approve(false) }, 'Skip'),
      el('button', { class: 'btn primary small', onclick: () => D.approve(true) }, 'Approve')] : []));

    if (!st.log.length) {
      log.replaceChildren(empty('🪄', 'What should I do?', 'Describe a task on your screen, like “fill in this worksheet” or “find the cheapest flight and stop before paying”, then press Start. I will ask before anything final.'));
    } else {
      log.replaceChildren(...st.log.map((m) => el('div', { class: `di-msg ${m.kind}` }, m.text)));
      log.scrollTop = log.scrollHeight;
    }
  }

  paint();
  const off = D.subscribe(paint);
  return () => off();
}
