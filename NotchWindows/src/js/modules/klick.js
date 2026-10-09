// The Klick tab (Pro): the on / off switch, the eight sounds as cards (click one to choose it and hear it; the chosen
// one has its own volume slider), a key-up option and a box to try it. See services/klick.js.

import { el } from '../store.js';
import { toggle } from '../ui.js';
import * as K from '../services/klick.js';

export function render(root) {
  const light = el('span', { class: 'kl-light' });
  const sub = el('div', { class: 'small dim ellipsis' });
  const sw = el('span', { style: 'flex:none;display:flex' });
  const grid = el('div', { class: 'kl-grid' });
  const head = el('div', { class: 'hstack', style: 'gap:12px' },
    el('div', { class: 'kl-icon' }, '⌨️'),
    el('div', { class: 'grow', style: 'min-width:0' }, el('div', { class: 'title' }, 'Klick'), sub),
    light, sw);
  const tryBox = el('input', { class: 'field', placeholder: 'Type here to try it…', style: 'flex:1' });
  const foot = el('div', { class: 'hstack', style: 'gap:10px' },
    el('label', { class: 'hstack small', style: 'gap:6px;cursor:pointer' }, toggle(K.keyUp(), (v) => K.setKeyUp(v)), 'Key-up sound'), tryBox);
  root.append(el('div', { class: 'card col fill', style: 'gap:12px' }, head, grid, foot));

  // Keys typed in this box play even before Klick is switched on, so you can try a sound.
  tryBox.addEventListener('keydown', (e) => { if (!e.repeat && !K.isOn()) K.play(e.key === ' ' ? 'space' : e.key === 'Enter' ? 'enter' : 'key'); });
  tryBox.addEventListener('keyup', () => { if (!K.isOn() && K.keyUp()) K.play('up'); });

  function paint() {
    const on = K.isOn(), pack = K.PACKS.find((p) => p.id === K.packId());
    sub.textContent = on ? `${pack.name} · every key you type, in any app` : 'Mechanical keyboard sounds as you type';
    sw.replaceChildren(toggle(on, (v) => { K.setOn(v); paint(); }));
    grid.replaceChildren(...K.PACKS.map((p) => {
      const chosen = p.id === pack.id;
      const card = el('div', { class: `kl-card${chosen ? ' on' : ''}`, title: `Choose ${p.name} and hear it`, onclick: () => { K.preview(p.id); paint(); } },
        el('div', { class: 'hstack', style: 'gap:6px' }, el('span', {}, p.icon), el('b', { class: 'grow' }, p.name), chosen ? el('span', { class: 'accent' }, '✓') : null),
        el('div', { class: 'tiny dim' }, p.blurb));
      if (chosen) {
        // The chosen sound's own volume.
        const range = el('input', { type: 'range', min: 0, max: 100, value: Math.round(K.volume(p.id) * 100), style: 'flex:1', title: `${p.name} volume` });
        const pct = el('span', { class: 'tiny num dim', style: 'width:32px;text-align:right' }, `${range.value}%`);
        range.addEventListener('click', (e) => e.stopPropagation());
        range.addEventListener('input', () => { K.setVolume(p.id, range.value / 100); pct.textContent = `${range.value}%`; });
        range.addEventListener('change', () => K.play('key'));
        card.append(el('div', { class: 'hstack', style: 'gap:6px;margin-top:4px' }, el('span', { class: 'tiny' }, '🔈'), range, pct));
      }
      return card;
    }));
  }
  paint();
  const off = K.onChange(() => {
    light.classList.toggle('lit', performance.now() - K.lastKey < 90);
    setTimeout(() => light.classList.remove('lit'), 90);
  });
  return () => off();
}
