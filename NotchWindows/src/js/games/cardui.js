// Drawing playing cards (the classic 5:7 face with corner indices and pip layouts) and a fanned hand.
import { el } from '../store.js';
import { isRed } from './cardslogic.js';

const SUIT_PATH = {
  clubs: 'M12 2a4.1 4.1 0 0 0-4.1 4.1c0 .93.31 1.79.83 2.48a4.1 4.1 0 1 0 2.9 7.33c-.28 2.2-1.02 3.72-2.43 5.09h5.6c-1.41-1.37-2.15-2.89-2.43-5.09a4.1 4.1 0 1 0 2.9-7.33c.52-.69.83-1.55.83-2.48A4.1 4.1 0 0 0 12 2Z',
  diamonds: 'M12 1.5 19.3 12 12 22.5 4.7 12Z',
  hearts: 'M12 21.4C6.1 15.9 2.6 12.4 2.6 8.6a4.85 4.85 0 0 1 4.85-4.85c1.8 0 3.5.87 4.55 2.33a5.63 5.63 0 0 1 4.55-2.33A4.85 4.85 0 0 1 21.4 8.6c0 3.8-3.5 7.3-9.4 12.8Z',
  spades: 'M12 1.8C6.9 7.2 3.6 10.3 3.6 13.6a4.35 4.35 0 0 0 7.1 3.36c-.3 1.9-1 3.26-2.35 4.54h7.3c-1.35-1.28-2.05-2.64-2.35-4.54a4.35 4.35 0 0 0 7.1-3.36c0-3.3-3.3-6.4-8.4-11.8Z',
};
const suitSvg = (suit, size, flip = false) => `<svg viewBox="0 0 24 24" width="${size}" height="${size}" fill="currentColor" style="${flip ? 'transform:rotate(180deg)' : ''}" aria-hidden="true"><path d="${SUIT_PATH[suit]}"/></svg>`;

const L = 0, C = 50, R = 100;
const PIPS = {
  2: [[C, 0], [C, 100, 1]], 3: [[C, 0], [C, 50], [C, 100, 1]],
  4: [[L, 0], [R, 0], [L, 100, 1], [R, 100, 1]], 5: [[L, 0], [R, 0], [C, 50], [L, 100, 1], [R, 100, 1]],
  6: [[L, 0], [R, 0], [L, 50], [R, 50], [L, 100, 1], [R, 100, 1]],
  7: [[L, 0], [R, 0], [C, 25], [L, 50], [R, 50], [L, 100, 1], [R, 100, 1]],
  8: [[L, 0], [R, 0], [C, 25], [L, 50], [R, 50], [C, 75, 1], [L, 100, 1], [R, 100, 1]],
  9: [[L, 0], [R, 0], [L, 33.3], [R, 33.3], [C, 50], [L, 66.7, 1], [R, 66.7, 1], [L, 100, 1], [R, 100, 1]],
  10: [[L, 0], [R, 0], [C, 16.7], [L, 33.3], [R, 33.3], [L, 66.7, 1], [R, 66.7, 1], [C, 83.3, 1], [L, 100, 1], [R, 100, 1]],
};

/// One card, `width` px wide. `up` false shows the back.
export function cardEl(card, width = 56, up = true) {
  const fs = width / 14, node = el('div', { class: 'pcard', style: `width:${width}px;height:${width * 1.4}px;font-size:${fs}px` });
  if (!up) { node.classList.add('back'); return node; }
  const red = isRed(card.suit);
  node.style.color = red ? '#c22f2f' : '#23262d';
  const corner = (flip) => `<div class="pc-corner${flip ? ' flip' : ''}"><b>${card.rank}</b>${suitSvg(card.suit, fs * 1.05)}</div>`;
  let mid = '';
  if (card.rank === 'A') mid = `<div class="pc-ace">${suitSvg(card.suit, fs * 4.6)}</div>`;
  else if (['J', 'Q', 'K'].includes(card.rank)) mid = `<div class="pc-court"><span>${card.rank}</span>${suitSvg(card.suit, fs * 2.2)}</div>`;
  else mid = `<div class="pc-pips">${PIPS[card.rank].map(([x, y, f]) => `<span style="left:${x}%;top:${y}%">${suitSvg(card.suit, fs * 2.1, !!f)}</span>`).join('')}</div>`;
  node.innerHTML = corner(false) + corner(true) + mid;
  node.setAttribute('role', 'img'); node.setAttribute('aria-label', `${card.rank} of ${card.suit}`);
  return node;
}

/// A hand drawn as a fan: cards spread in an arc, the hovered one lifts.
export function fanEl(cards, { width = 64, hideFrom = -1 } = {}) {
  const n = cards.length, step = n > 1 ? Math.min(9, 40 / (n - 1)) : 0, space = n > 5 ? 30 : 38;
  const box = el('div', { class: 'pfan', style: `height:${width * 1.4 + 26}px;width:${Math.max(width, (n - 1) * space + width + 20)}px` });
  cards.forEach((c, i) => {
    const off = i - (n - 1) / 2, rot = off * step;
    const node = cardEl(c, width, !(hideFrom >= 0 && i >= hideFrom));
    node.classList.add('pfan-card');
    node.style.setProperty('--x', `${off * space}px`); node.style.setProperty('--y', `${Math.abs(rot) * 1.4}px`); node.style.setProperty('--r', `${rot}deg`);
    node.style.zIndex = i + 1; node.style.marginLeft = `-${width / 2}px`;
    box.append(node);
  });
  return box;
}
