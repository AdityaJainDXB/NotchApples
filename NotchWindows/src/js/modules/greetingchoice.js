// Shown once, in the open notch, after installing or updating: choose a hello (or no greeting). It comes back every time the
// notch opens until it is answered, however often the notch is closed. A picture of every choice, and a preview of the notch
// that plays the one you point at (js/mascots.js, the same picker the Mac app shows). The same choice lives in Settings →
// General → Hello from the notch, where greetings can also be turned off completely.
import { el, save } from '../store.js';
import { button } from '../ui.js';
import { show } from '../app.js';
import * as G from '../services/greeting.js';

/// mascots.js is a plain script (the Mac app uses the same file), so it is added with a script tag the first time it is needed.
const loadMascots = () => (window.NotchMascots ? Promise.resolve() : new Promise((resolve, reject) => {
  const s = document.createElement('script');
  s.src = 'js/mascots.js'; s.onload = resolve; s.onerror = reject;
  document.head.append(s);
}));

export function render(page) {
  let picked = G.character(), picker = null, gone = false;
  const host = el('div', { style: 'min-height:236px' });
  loadMascots().then(() => {
    if (gone) return;
    picker = window.NotchMascots.picker(host, { selected: picked, name: G.name(), team: G.team(), choices: G.CHARACTERS, onPick: (id) => { picked = id; } });
  }).catch(() => host.append(el('div', { class: 'dim' }, 'The previews could not load. You can still pick a hello in Settings → General.')));
  const nameBox = el('input', { class: 'field', placeholder: 'Your name (optional)', maxlength: 24, style: 'width:200px' });
  nameBox.value = G.name();
  const finish = (play) => {
    save('hello.chosen', true);
    show('today');
    if (play) setTimeout(() => G.show(true), 500);
  };
  page.append(el('div', { class: 'col scroll', style: 'gap:10px;max-width:700px;margin:auto;padding:12px' },
    el('div', { style: 'font-size:20px;font-weight:800' }, '👋 Choose your hello'),
    el('div', { class: 'dim' }, 'Point at a choice to see it play in the notch, then pick one. You can change it or turn it off any time in Settings → General → Hello from the notch.'),
    host, nameBox,
    el('div', { class: 'hstack' },
      button('No thanks', () => { G.setOn(false); finish(false); }, { kind: 'quiet' }),
      el('div', { class: 'grow' }),
      button('Use this hello', () => { G.setOn(true); G.setCharacter(picked); G.setName(nameBox.value); finish(true); }, { kind: 'primary' }))));
  return () => { gone = true; if (picker) picker.stop(); };
}
