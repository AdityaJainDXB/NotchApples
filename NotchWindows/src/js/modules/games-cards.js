// Blackjack and Solitaire for the Games tab. The rules live in games/cardslogic.js.
import { el, load, save } from '../store.js';
import { makeDeck, shuffle, bjValue, bjOutcome, isBlackjack, dealerShouldHit, solDeal, canPlaceTableau, canPlaceFoundation, solWon } from '../games/cardslogic.js';
import { cardEl, fanEl } from '../games/cardui.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export function blackjack(host) {
  let bank = load('games.blackjack.bank', 500), bet = Math.min(25, bank), deck = [], player = [], dealer = [], phase = 'bet', msg = '', alive = true, doubled = false;
  const draw = () => { if (deck.length < 15) deck = shuffle(makeDeck(4)); return deck.pop(); };
  const root = el('div', { class: 'col', style: 'align-items:center;gap:8px;min-width:420px' });
  host.replaceChildren(root);
  const total = (h) => { const v = bjValue(h); return `${v.total}${v.soft && v.total < 21 ? ' (soft)' : ''}`; };
  function paint() {
    if (!alive) return;
    const showAll = phase === 'done' || phase === 'dealer';
    const chips = [5, 25, 100].map((n) => el('button', { class: 'btn small quiet', disabled: phase !== 'bet' || n > bank, onclick: () => { bet = Math.min(bank, bet + n); paint(); } }, `+${n}`));
    root.replaceChildren(
      el('div', { class: 'hstack small', style: 'gap:14px' }, el('b', {}, `Bank ${bank}`), el('span', { class: 'dim' }, phase === 'bet' ? `Bet ${bet}` : `Bet ${bet * (doubled ? 2 : 1)}`)),
      el('div', { class: 'tiny dim' }, `Dealer${dealer.length ? ` · ${showAll ? total(dealer) : '?'}` : ''}`),
      dealer.length ? fanEl(dealer, { width: 52, hideFrom: showAll ? -1 : 1 }) : el('div', { style: 'height:96px' }),
      el('div', { class: 'tiny dim' }, `You${player.length ? ` · ${total(player)}` : ''}`),
      player.length ? fanEl(player, { width: 52 }) : el('div', { style: 'height:96px' }),
      el('div', { style: 'min-height:18px;font-weight:700' }, msg),
      phase === 'bet'
        ? el('div', { class: 'hstack', style: 'gap:6px' }, ...chips, el('button', { class: 'btn small ghost', onclick: () => { bet = Math.min(25, bank); paint(); } }, 'Reset'),
            el('button', { class: 'btn small primary', disabled: bet < 1 || bank < 1, onclick: deal }, 'Deal'))
        : phase === 'play'
          ? el('div', { class: 'hstack', style: 'gap:6px' }, el('button', { class: 'btn small primary', onclick: hit }, 'Hit'), el('button', { class: 'btn small', onclick: stand }, 'Stand'),
              el('button', { class: 'btn small quiet', disabled: player.length !== 2 || bank < bet * 2, onclick: dbl }, 'Double'))
          : phase === 'done'
            ? el('button', { class: 'btn small primary', onclick: () => { if (bank < 1) { bank = 500; save('games.blackjack.bank', bank); } bet = Math.min(bet, bank) || 25; phase = 'bet'; player = []; dealer = []; msg = ''; doubled = false; paint(); } }, bank < 1 ? 'Out of chips: new bank of 500' : 'Next hand') : null);
  }
  function deal() {
    player = [draw(), draw()]; dealer = [draw(), draw()]; doubled = false; msg = ''; phase = 'play'; paint();
    if (isBlackjack(player) || isBlackjack(dealer)) finish();
  }
  const hit = () => { player.push(draw()); paint(); if (bjValue(player).total >= 21) finish(); };
  const dbl = () => { doubled = true; player.push(draw()); paint(); finish(); };
  const stand = () => finish();
  async function finish() {
    phase = 'dealer'; paint();
    if (bjValue(player).total <= 21 && !isBlackjack(player)) { while (dealerShouldHit(dealer) && alive) { await sleep(520); dealer.push(draw()); paint(); } }
    if (!alive) return;
    const out = bjOutcome(player, dealer), stake = bet * (doubled ? 2 : 1), won = Math.round(stake * out.pay);
    bank += won; save('games.blackjack.bank', bank);
    msg = { blackjack: `Blackjack! +${won}`, win: `You win +${won}`, push: 'Push', lose: `Dealer wins ${won}`, bust: `Bust ${won}` }[out.result];
    phase = 'done'; paint();
  }
  paint();
  return () => { alive = false; };
}

export function solitaire(host) {
  const W = 52;
  let s, sel = null, moves = 0, won = false;
  const root = el('div', { class: 'col', style: 'gap:8px;align-items:center;min-width:420px' });
  host.replaceChildren(root);
  const newGame = () => { s = solDeal(shuffle(makeDeck())); sel = null; moves = 0; won = false; paint(); };
  const same = (a, b) => a && b && a.kind === b.kind && a.pile === b.pile && a.idx === b.idx;
  function cardsOf(from) { return from.kind === 'waste' ? [s.waste[s.waste.length - 1]] : from.kind === 'found' ? [s.found[from.pile][s.found[from.pile].length - 1]] : s.tableau[from.pile].slice(from.idx); }
  function take(from) { if (from.kind === 'waste') s.waste.pop(); else if (from.kind === 'found') s.found[from.pile].pop(); else { s.tableau[from.pile].splice(from.idx); const t = s.tableau[from.pile]; if (t.length) t[t.length - 1].up = true; } }
  function tryMove(from, to) {
    const cards = cardsOf(from); if (!cards[0]) return false;
    if (to.kind === 'tableau' ? !canPlaceTableau(cards[0], s.tableau[to.pile]) : !(cards.length === 1 && canPlaceFoundation(cards[0], s.found[to.pile]))) return false;
    take(from); (to.kind === 'tableau' ? s.tableau[to.pile] : s.found[to.pile]).push(...cards.map((c) => ({ ...c, up: true }))); moves++;
    if (solWon(s)) won = true;
    return true;
  }
  function click(target) {
    if (won) return;
    if (sel && !same(sel, target) && (target.kind === 'tableau' || target.kind === 'found')) { if (tryMove(sel, target)) { sel = null; return paint(); } }
    sel = target.pick && !same(sel, target) ? target : null; paint();
  }
  function auto(from) {   // double click: send to a foundation if one takes it
    const c = cardsOf(from); if (c.length !== 1) return;
    for (let i = 0; i < 4; i++) if (tryMove(from, { kind: 'found', pile: i })) { sel = null; return paint(); }
  }
  const slot = (child, onclick) => el('div', { style: `width:${W}px;height:${W * 1.4}px;border-radius:7px;border:1px dashed rgba(255,255,255,.2);flex:none;position:relative;cursor:pointer`, onclick }, child);
  function paint() {
    const wasteTop = s.waste[s.waste.length - 1];
    const stock = slot(s.stock.length ? cardEl(null, W, false) : el('div', { class: 'dim', style: 'display:grid;place-items:center;height:100%;font-size:20px' }, '↺'), () => {
      if (s.stock.length) { const c = s.stock.pop(); s.waste.push({ ...c, up: true }); } else { s.stock = s.waste.reverse().map((c) => ({ ...c, up: false })); s.waste = []; }
      sel = null; moves++; paint();
    });
    const waste = slot(wasteTop ? (() => { const n = cardEl(wasteTop, W); n.classList.add('sol-card'); if (sel && sel.kind === 'waste') n.classList.add('sel'); n.ondblclick = () => auto({ kind: 'waste' }); return n; })() : null, () => wasteTop && click({ kind: 'waste', pick: true }));
    const found = s.found.map((p, i) => slot(p.length ? cardEl(p[p.length - 1], W) : el('div', { class: 'dim', style: 'display:grid;place-items:center;height:100%;font-size:18px' }, ['♣', '♦', '♥', '♠'][i]), () => click({ kind: 'found', pile: i })));
    const tab = s.tableau.map((pile, pi) => {
      const col = el('div', { style: `position:relative;width:${W}px;min-height:${W * 1.4}px;flex:none`, onclick: () => click({ kind: 'tableau', pile: pi }) });
      let y = 0;
      pile.forEach((c, idx) => {
        const n = cardEl(c, W, c.up); n.classList.add('sol-card'); n.style.position = 'absolute'; n.style.top = `${y}px`;
        if (sel && sel.kind === 'tableau' && sel.pile === pi && idx >= sel.idx) n.classList.add('sel');
        n.onclick = (e) => { e.stopPropagation(); if (!c.up) { if (idx === pile.length - 1) { c.up = true; paint(); } return; } click({ kind: 'tableau', pile: pi, idx, pick: true }); };
        n.ondblclick = () => idx === pile.length - 1 && auto({ kind: 'tableau', pile: pi, idx });
        col.append(n); y += c.up ? W * 0.32 : W * 0.14;
      });
      col.style.height = `${y + W * 1.4}px`;
      return col;
    });
    root.replaceChildren(
      el('div', { class: 'hstack', style: 'gap:6px;align-items:flex-start' }, stock, waste, el('div', { style: `width:${W}px` }), ...found),
      el('div', { class: 'hstack', style: 'gap:6px;align-items:flex-start' }, ...tab),
      el('div', { class: 'hstack small', style: 'gap:10px' }, el('span', { class: 'dim' }, won ? `You won in ${moves} moves!` : `Moves ${moves} · tap a card, then where it goes · double-tap to send up`),
        el('button', { class: 'btn small quiet', onclick: newGame }, 'New game')));
  }
  newGame();
  return () => {};
}
