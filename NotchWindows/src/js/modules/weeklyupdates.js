// Shown once, in the open notch, after updating to a version that has "Update at most once a week": a switch for it
// (off unless you turn it on) and one button to carry on. It lives in Settings → Updates afterwards.
import { el, save } from '../store.js';
import { setPref } from '../prefs.js';
import { toggle, button } from '../ui.js';
import { show } from '../app.js';

export function render(page) {
  let on = false;
  const sw = toggle(false, (v) => { on = v; });
  page.append(el('div', { class: 'col', style: 'gap:12px;max-width:520px;margin:auto;padding:12px' },
    el('div', { style: 'font-size:20px;font-weight:800' }, '🗓 Fewer update prompts?'),
    el('div', { class: 'dim' }, 'Releases have been coming often. Notch apple can tell you about updates once a week instead of for every release. Required security updates still appear straight away, and Check now always shows the latest version.'),
    el('div', { class: 'hstack card' }, el('div', { class: 'grow' }, el('div', { style: 'font-weight:700' }, 'Update at most once a week'), el('div', { class: 'small dim' }, 'Off keeps today’s behaviour: you hear about every release.')), sw),
    el('div', { class: 'hstack' }, el('div', { class: 'grow small faint' }, 'You can change this any time in Settings → Updates.'),
      button('Got it', () => { setPref('updates.weekly', on); save('updates.weeklyAsked', true); show('today'); }))));
}
