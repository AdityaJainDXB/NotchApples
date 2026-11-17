// Blackjack and Solitaire for the Games tab. The rules live in games/cardslogic.js.
import { el, load, save } from '../store.js';
import { makeDeck, shuffle, bjValue, bjOutcome, isBlackjack, dealerShouldHit, solDeal, canPlaceTableau, canPlaceFoundation, solWon, pokerRank, pokerCompare, pokerStrength, POKER_HANDS } from '../games/cardslogic.js';
import { cardEl, fanEl } from '../games/cardui.js';
import * as T3 from '../games/threecard-logic.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export function blackjack(host) {
  let bank = load('games.blackjack.bank', 500);
  if (!(bank >= 1)) { bank = 500; save('games.blackjack.bank', bank); }
  let bet = Math.min(25, bank), deck = [], player = [], dealer = [], phase = 'bet', msg = '', alive = true, doubled = false;
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

/// Heads-up Texas Hold'em for play money against the computer: blinds 10 and 20, check or call, raise 20, or fold. Same table as the Mac app.
/// The Poker card: Texas Hold'em or Three-Card Poker (issue #101), with the choice remembered.
export function poker(host) {
  let mode = load('games.poker.mode', 'holdem'), stop = () => {};
  const body = el('div', { class: 'col', style: 'align-items:center' });
  const pick = (m) => { stop(); mode = m; save('games.poker.mode', m); bar.replaceChildren(...tabs()); stop = (m === 'three' ? threeCard : holdem)(body) || (() => {}); };
  const tabs = () => [['holdem', "Texas Hold'em"], ['three', 'Three-Card Poker']].map(([id, label]) => el('button', { class: `btn small ${mode === id ? 'primary' : 'quiet'}`, onclick: () => pick(id) }, label));
  const bar = el('div', { class: 'hstack', style: 'gap:4px;justify-content:center;margin-bottom:6px' });
  host.replaceChildren(el('div', { class: 'col', style: 'align-items:center' }, bar, body));
  pick(mode);
  return () => stop();
}

/// Three-Card Poker: you against one to three computer players with play-money chips. Everyone antes, you see your three cards
/// and Play (bet the ante again) or Fold; computer players play with Queen-high or better; the best hand that stayed wins the pot.
function threeCard(host) {
  let chips = load('games.3card.chips', 1000), ante = load('games.3card.ante', 10), opponents = load('games.3card.opponents', 1);
  let score = load('games.3card.score', { wins: 0, losses: 0, draws: 0 });
  let cpus = [], mine = [], pot = 0, phase = 'idle', msg = 'Pick an ante and deal.', winners = new Set(), alive = true;
  const NAMES = ['Dealer', 'Sam', 'Ava'];
  const persist = () => { save('games.3card.chips', chips); save('games.3card.score', score); };
  const root = el('div', { class: 'hstack', style: 'gap:12px;align-items:flex-start' });
  host.replaceChildren(root);
  const chipStack = (n) => { const k = n ? Math.min(8, Math.max(1, Math.ceil(Math.sqrt(n / 25)))) : 0; const cols = ['#ef4444', '#3b82f6', '#22c55e', '#eab308', '#a855f7', '#f97316', '#ec4899', '#14b8a6'];
    return el('div', { style: 'position:relative;width:24px;height:28px' }, ...Array.from({ length: k }, (_, i) => el('div', { style: `position:absolute;left:1px;bottom:${i * 2.5}px;width:22px;height:8px;border-radius:50%;background:${cols[i % 8]};border:1px dashed rgba(255,255,255,.8)` }))); };
  const coin = (n) => el('span', { class: 'tiny dim' }, el('span', { style: 'display:inline-block;width:7px;height:7px;border-radius:50%;background:#eab308;margin-right:3px' }), String(n));
  // Three cards side by side, never overlapping (a fan pushed them into the pot and the message).
  const row = (cards, up) => el('div', { class: 'hstack', style: 'gap:4px;height:62px;align-items:center' }, ...(cards.length ? cards.map((c) => cardEl(c, 42, up)) : [0, 1, 2].map(() => el('div', { style: 'width:42px;height:59px;border-radius:5px;border:1px dashed rgba(255,255,255,.18)' }))));
  function deal() {
    if (chips < ante * 2) { chips = 1000; }
    const deck = shuffle(makeDeck(1));
    cpus = Array.from({ length: opponents }, (_, i) => { const old = cpus[i]; const c = old && old.chips >= ante * 2 ? old.chips : 1000; return { id: i, name: NAMES[i], chips: c - ante, cards: deck.splice(0, 3), playing: true }; });
    mine = deck.splice(0, 3); chips -= ante; pot = ante * (opponents + 1); winners = new Set(); phase = 'deciding';
    msg = `You have ${T3.CATEGORIES[T3.evaluate(mine).category].name.toLowerCase()}. Play (bet ${ante} more) or fold?`;
    persist(); paint();
  }
  function play() {
    chips -= ante; pot += ante;
    for (const c of cpus) { c.playing = T3.cpuPlays(c.cards); if (c.playing) { c.chips -= ante; pot += ante; } }
    const inHand = cpus.filter((c) => c.playing);
    if (!inHand.length) { chips += pot; winners = new Set([-1]); score.wins++; msg = `Everyone else folds. You win ${pot} chips.`; }
    else {
      const hands = [mine, ...inHand.map((c) => c.cards)], ids = [-1, ...inHand.map((c) => c.id)];
      const best = T3.winners(hands), shares = T3.split(pot, best.length);
      best.forEach((b, k) => { const id = ids[b]; if (id === -1) chips += shares[k]; else cpus[id].chips += shares[k]; });
      winners = new Set(best.map((b) => ids[b]));
      const name = T3.CATEGORIES[T3.evaluate(hands[best[0]]).category].name;
      if (best.length === 1 && ids[best[0]] === -1) { score.wins++; msg = `You win ${pot} chips with ${name}.`; }
      else if (winners.has(-1)) { score.draws++; msg = `A draw: the pot is split (${name}).`; }
      else { score.losses++; msg = `${[...winners].map((id) => cpus[id].name).join(' and ')} wins with ${name}.`; }
    }
    pot = 0; phase = 'done'; persist(); paint();
  }
  function fold() {
    for (const c of cpus) c.playing = T3.cpuPlays(c.cards);
    const takers = cpus.filter((c) => c.playing).length ? cpus.filter((c) => c.playing) : cpus;
    const best = T3.winners(takers.map((c) => c.cards)), shares = T3.split(pot, best.length);
    best.forEach((b, k) => { takers[b].chips += shares[k]; });
    winners = new Set(best.map((b) => takers[b].id)); score.losses++;
    msg = `You fold and lose your ${ante}-chip ante.`; pot = 0; phase = 'done'; persist(); paint();
  }
  function paint() {
    if (!alive) return;
    const done = phase === 'done', mineRank = mine.length ? T3.evaluate(mine) : null;
    const seat = (name, n, cards, up, label, won) => el('div', { class: 'hstack', style: 'gap:8px;align-items:center' },
      el('div', { class: 'col', style: 'width:64px' }, el('b', { class: 'small' }, name), coin(n)), row(cards, up),
      label ? el('span', { class: 'small', style: `font-weight:600;color:${won ? '#22c55e' : 'var(--text-dim)'}` }, label) : null);
    const table = el('div', { class: 'col', style: 'gap:6px;align-items:flex-start;min-width:360px' },
      ...cpus.map((c) => seat(c.name, c.chips, c.cards, done, done ? (c.playing ? T3.CATEGORIES[T3.evaluate(c.cards).category].name : 'Folded') : '', winners.has(c.id))),
      el('div', { class: 'hstack', style: 'gap:6px;align-items:center;margin-left:72px;height:30px' }, chipStack(pot), el('b', { style: 'color:var(--accent,#a78bfa)' }, `Pot ${pot}`)),
      seat('You', chips, mine, true, mineRank ? T3.CATEGORIES[mineRank.category].name : '', winners.has(-1)),
      el('div', { style: 'min-height:32px;font-weight:700;max-width:360px' }, msg),
      phase === 'deciding'
        ? el('div', { class: 'hstack', style: 'gap:6px' }, el('button', { class: 'btn small primary', onclick: play }, `Play (${ante})`), el('button', { class: 'btn small quiet', onclick: fold }, 'Fold'))
        : el('div', { class: 'hstack', style: 'gap:6px' },
            el('select', { class: 'field auto', onchange: (e) => { ante = Number(e.target.value); save('games.3card.ante', ante); } }, ...[10, 25, 50, 100].map((a) => el('option', { value: a, selected: a === ante }, `Ante ${a}`))),
            el('select', { class: 'field auto', onchange: (e) => { opponents = Number(e.target.value); save('games.3card.opponents', opponents); } }, ...[1, 2, 3].map((n) => el('option', { value: n, selected: n === opponents }, `${n} other${n === 1 ? '' : 's'}`))),
            el('button', { class: 'btn small primary', onclick: deal }, phase === 'idle' ? 'Deal cards' : 'New round')));
    const side = el('div', { class: 'col', style: 'gap:4px;width:170px;padding:8px;border-radius:10px;background:rgba(255,255,255,.05)' },
      el('b', { class: 'small' }, 'Hand rankings'),
      ...T3.CATEGORIES.map((c, i) => [5 - i + 1, c, i]).reverse().map(([n, c, i]) => el('div', { class: 'tiny' }, el('b', { style: `color:${mineRank && mineRank.category === i ? 'var(--accent,#a78bfa)' : 'inherit'}` }, `${6 - i}. ${c.name}`), el('div', { class: 'dim' }, c.detail))),
      el('div', { class: 'tiny dim' }, 'A-2-3 is the lowest straight. Suits never break a tie.'),
      el('hr', { style: 'width:100%;border:none;border-top:1px solid var(--border)' }),
      el('b', { class: 'small' }, 'Scoreboard'),
      el('div', { class: 'hstack small', style: 'gap:10px' }, el('span', { style: 'color:#22c55e' }, `${score.wins} wins`), el('span', { style: 'color:#ef4444' }, `${score.losses} losses`), el('span', { class: 'dim' }, `${score.draws} draws`)),
      el('button', { class: 'btn small quiet', onclick: () => { score = { wins: 0, losses: 0, draws: 0 }; persist(); paint(); } }, 'Reset'));
    root.replaceChildren(table, side);
  }
  paint();
  return () => { alive = false; };
}

function holdem(host) {
  let bank = load('games.poker.bank', 500), cpuBank = 500, deck = [], you = [], cpu = [], board = [], pot = 0, toCall = 0, street = 'done', msg = 'Deal a hand of Texas Hold’em.', reveal = false, alive = true;
  if (!(bank >= 1)) { bank = 500; save('games.poker.bank', bank); }
  const SHOWN = { preflop: 0, flop: 3, turn: 4, river: 5, done: 5 }, NAME = { preflop: 'Pre-flop', flop: 'Flop', turn: 'Turn', river: 'River', done: 'Hand over' };
  const root = el('div', { class: 'col', style: 'align-items:center;gap:6px;min-width:420px' });
  host.replaceChildren(root);
  const row = (cards, up, w = 46) => (cards.length ? fanEl(cards, { width: w, hideFrom: up ? -1 : 0 }) : el('div', { style: `height:${w * 1.4 + 26}px;opacity:.4` }, '—'));
  function paint() {
    if (!alive) return;
    const shown = board.slice(0, SHOWN[street]);
    root.replaceChildren(
      el('div', { class: 'hstack small', style: 'gap:18px;justify-content:space-between;width:100%;max-width:380px' }, el('b', {}, `You · ${bank}`), el('b', { style: 'color:var(--accent,#a78bfa)' }, `Pot ${pot}`), el('b', {}, `CPU · ${cpuBank}`)),
      el('div', { class: 'tiny dim' }, `Other player · ${reveal ? 'showdown' : 'cards hidden'}`),
      row(cpu, reveal),
      el('div', { class: 'tiny dim' }, `${NAME[street]} · Community cards`),
      shown.length ? fanEl(shown, { width: 46 }) : el('div', { style: 'height:90px;opacity:.4' }, '—'),
      row(you, true),
      el('div', { class: 'tiny dim' }, 'Your cards'),
      el('div', { style: 'min-height:34px;font-weight:700;text-align:center;max-width:380px' }, msg),
      street === 'done'
        ? el('button', { class: 'btn small primary', onclick: deal }, 'Deal')
        : el('div', { class: 'hstack', style: 'gap:6px' },
            el('button', { class: 'btn small primary', disabled: bank < toCall, onclick: checkOrCall }, toCall === 0 ? 'Check' : `Call ${toCall}`),
            el('button', { class: 'btn small', disabled: bank <= toCall, onclick: raise }, 'Raise 20'),
            el('button', { class: 'btn small quiet', onclick: fold }, 'Fold')));
  }
  const draw = () => deck.pop();
  const keep = () => save('games.poker.bank', bank);
  function deal() {
    if (bank < 1) bank = 500; if (cpuBank < 20) cpuBank = 500;
    deck = shuffle(makeDeck()); you = [draw(), draw()]; cpu = [draw(), draw()]; board = [draw(), draw(), draw(), draw(), draw()];
    bank -= 20; cpuBank -= 10; pot = 30; toCall = 10; street = 'preflop'; reveal = false; msg = 'Blinds are in. Call 10, raise, or fold.'; keep(); paint();
  }
  const advance = () => { street = { preflop: 'flop', flop: 'turn', turn: 'river' }[street] || (showdown(), 'done'); };
  function checkOrCall() {
    const paid = Math.min(toCall, bank); bank -= paid; pot += paid; toCall = 0;
    if (street === 'river') showdown(); else { advance(); msg = `${NAME[street]}: check or raise.`; }
    keep(); paint();
  }
  function raise() {
    const paid = Math.min(bank, toCall + 20);
    if (paid <= toCall) return checkOrCall();
    bank -= paid; pot += paid;
    const cost = Math.min(cpuBank, paid);
    if (pokerStrength(cpu, board.slice(0, SHOWN[street])) < 0.28 && cost >= 20 && Math.random() * 100 < 62) { bank += pot; pot = 0; street = 'done'; reveal = false; msg = 'The other player folds. You take the pot.'; }
    else { cpuBank -= cost; pot += cost; if (cost < paid || street === 'river') showdown(); else { advance(); msg = `Called. ${NAME[street]}: check, raise, or fold.`; } }
    keep(); paint();
  }
  function fold() { cpuBank += pot; pot = 0; street = 'done'; reveal = false; msg = 'You fold. Deal another hand when you’re ready.'; keep(); paint(); }
  function showdown() {
    reveal = true; street = 'done';
    const p = pokerRank([...you, ...board]), c = pokerRank([...cpu, ...board]), cmp = pokerCompare(p, c);
    if (cmp > 0) { bank += pot; msg = `You win the ${pot}-chip pot with ${POKER_HANDS[p.category].toLowerCase()}.`; }
    else if (cmp < 0) { cpuBank += pot; msg = `The other player wins the ${pot}-chip pot with ${POKER_HANDS[c.category].toLowerCase()}.`; }
    else { const half = Math.floor(pot / 2); bank += half; cpuBank += pot - half; msg = `Split pot: ${pot} chips.`; }
    pot = 0;
  }
  paint();
  return () => { alive = false; };
}
