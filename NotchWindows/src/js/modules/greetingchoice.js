// Shown once, in the open notch, after installing or updating: choose a hello (or no greeting). It comes back every time the
// notch opens until it is answered, however often the notch is closed. The same choice lives in Settings → General →
// Hello from the notch, where greetings can also be turned off completely.
import { el, save } from '../store.js';
import { button } from '../ui.js';
import { show } from '../app.js';
import * as G from '../services/greeting.js';

export function render(page) {
  let picked = G.character();
  const grid = el('div', { class: 'grid', style: 'grid-template-columns:repeat(auto-fill,minmax(190px,1fr));gap:8px' });
  const paint = () => grid.replaceChildren(...G.CHARACTERS.map((c) => el('button', {
    type: 'button', class: `tile ${c.id === picked ? 'selected' : ''}`, style: 'text-align:left;padding:8px 10px',
    onclick: () => { picked = c.id; paint(); } },
  el('div', { style: 'font-weight:700' }, c.name), el('div', { class: 'small dim' }, c.how))));
  paint();
  const nameBox = el('input', { class: 'field', placeholder: 'Your name (optional)', maxlength: 24, style: 'width:200px' });
  nameBox.value = G.name();
  const finish = (play) => {
    save('hello.chosen', true);
    show('today');
    if (play) setTimeout(() => G.show(true), 500);
  };
  page.append(el('div', { class: 'col scroll', style: 'gap:10px;max-width:660px;margin:auto;padding:12px' },
    el('div', { style: 'font-size:20px;font-weight:800' }, '👋 Choose your hello'),
    el('div', { class: 'dim' }, 'When this PC starts or wakes up, the notch can say hello: written by hand, or a little character that moves across the notch. You can change it or turn it off any time in Settings → General → Hello from the notch.'),
    grid, nameBox,
    el('div', { class: 'hstack' },
      button('No thanks', () => { G.setOn(false); finish(false); }, { kind: 'quiet' }),
      el('div', { class: 'grow' }),
      button('Use this hello', () => { G.setOn(true); G.setCharacter(picked); G.setName(nameBox.value); finish(true); }, { kind: 'primary' }))));
}
