// Rules for the card games (Blackjack and Solitaire), kept free of any display code so they can be tested
// and mirrored in the Mac app (CardsLogic.swift) with the same test vectors.

export const RANKS = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];
export const SUITS = ['clubs', 'diamonds', 'hearts', 'spades'];
export const isRed = (suit) => suit === 'diamonds' || suit === 'hearts';
export const rankValue = (rank) => RANKS.indexOf(rank) + 1;   // A = 1 … K = 13

export function makeDeck(decks = 1) {
  const out = [];
  for (let d = 0; d < decks; d++) for (const suit of SUITS) for (const rank of RANKS) out.push({ rank, suit, id: `${rank}${suit[0]}${d}` });
  return out;
}

/// Fisher–Yates; `rand` returns [0, 1) so tests can pass a seeded generator.
export function shuffle(cards, rand = Math.random) {
  const a = cards.slice();
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}

// ---------------------------------------------------------------- Blackjack

/// Best total of a hand: aces count 11 while that doesn't bust. `soft` means an ace is still counting 11.
export function bjValue(hand) {
  let total = 0, aces = 0;
  for (const c of hand) { if (c.rank === 'A') { aces++; total += 11; } else total += ['J', 'Q', 'K'].includes(c.rank) ? 10 : Number(c.rank); }
  while (total > 21 && aces > 0) { total -= 10; aces--; }
  return { total, soft: aces > 0 };
}
export const isBlackjack = (hand) => hand.length === 2 && bjValue(hand).total === 21;
export const dealerShouldHit = (hand) => bjValue(hand).total < 17;   // the dealer stands on every 17

/// What a finished round pays, as a multiple of the bet won (negative = lost): blackjack 1.5, win 1, push 0, loss -1.
export function bjOutcome(player, dealer) {
  const p = bjValue(player).total, d = bjValue(dealer).total;
  if (p > 21) return { result: 'bust', pay: -1 };
  if (isBlackjack(player)) return isBlackjack(dealer) ? { result: 'push', pay: 0 } : { result: 'blackjack', pay: 1.5 };
  if (isBlackjack(dealer)) return { result: 'lose', pay: -1 };
  if (d > 21 || p > d) return { result: 'win', pay: 1 };
  return p === d ? { result: 'push', pay: 0 } : { result: 'lose', pay: -1 };
}

// ---------------------------------------------------------------- Klondike Solitaire (draw one)

/// Seven tableau piles of 1…7 cards (the last face up), the rest in the stock.
export function solDeal(deck) {
  const cards = deck.slice(), tableau = [];
  for (let i = 0; i < 7; i++) tableau.push(cards.splice(0, i + 1).map((c, k, a) => ({ ...c, up: k === a.length - 1 })));
  return { tableau, stock: cards.map((c) => ({ ...c, up: false })), waste: [], found: [[], [], [], []] };
}
/// A card may go on a tableau pile if it is one lower and the opposite colour, or a king on an empty pile.
export function canPlaceTableau(card, pile) {
  const top = pile[pile.length - 1];
  if (!top) return card.rank === 'K';
  return top.up && isRed(top.suit) !== isRed(card.suit) && rankValue(top.rank) === rankValue(card.rank) + 1;
}
/// A foundation takes its suit in order from the ace.
export function canPlaceFoundation(card, pile) {
  const top = pile[pile.length - 1];
  if (!top) return card.rank === 'A';
  return top.suit === card.suit && rankValue(card.rank) === rankValue(top.rank) + 1;
}
export const solWon = (s) => s.found.every((p) => p.length === 13);

// ---------------------------------------------------------------- Texas Hold'em (mirrors CardsLogic.swift: Cards.pokerRank)

const pv = (c) => (c.rank === 'A' ? 14 : rankValue(c.rank));   // ace high
/// Rank of exactly five cards: { category 0 high card … 8 straight flush, kickers }.
function pokerFive(hand) {
  const values = hand.map(pv).sort((a, b) => b - a), counts = new Map();
  for (const v of values) counts.set(v, (counts.get(v) || 0) + 1);
  const groups = [...counts].map(([rank, count]) => ({ rank, count })).sort((a, b) => (a.count === b.count ? b.rank - a.rank : b.count - a.count));
  const flush = hand.every((c) => c.suit === hand[0].suit), unique = [...new Set(values)].sort((a, b) => b - a);
  const straightHigh = unique.length === 5 && unique[0] - unique[4] === 4 ? unique[0] : unique.join() === '14,5,4,3,2' ? 5 : null;
  const rest = groups.slice(1).map((g) => g.rank).sort((a, b) => b - a);
  if (flush && straightHigh) return { category: 8, kickers: [straightHigh] };
  if (groups[0].count === 4) return { category: 7, kickers: [groups[0].rank, groups[1].rank] };
  if (groups[0].count === 3 && groups[1].count === 2) return { category: 6, kickers: [groups[0].rank, groups[1].rank] };
  if (flush) return { category: 5, kickers: values };
  if (straightHigh) return { category: 4, kickers: [straightHigh] };
  if (groups[0].count === 3) return { category: 3, kickers: [groups[0].rank, ...rest] };
  if (groups[0].count === 2 && groups[1].count === 2) return { category: 2, kickers: [...groups.slice(0, 2).map((g) => g.rank).sort((a, b) => b - a), groups[2].rank] };
  if (groups[0].count === 2) return { category: 1, kickers: [groups[0].rank, ...rest] };
  return { category: 0, kickers: values };
}
/// Negative, zero or positive: a < b, a = b, a > b.
export function pokerCompare(a, b) {
  if (a.category !== b.category) return a.category - b.category;
  for (let i = 0; i < Math.min(a.kickers.length, b.kickers.length); i++) if (a.kickers[i] !== b.kickers[i]) return a.kickers[i] - b.kickers[i];
  return a.kickers.length - b.kickers.length;
}
/// Best five-card hand from five to seven cards (hole cards plus the community cards); null for any other count.
export function pokerRank(cards) {
  const n = cards.length; if (n < 5 || n > 7) return null;
  let best = null;
  for (let a = 0; a < n - 4; a++) for (let b = a + 1; b < n - 3; b++) for (let c = b + 1; c < n - 2; c++) for (let d = c + 1; d < n - 1; d++) for (let e = d + 1; e < n; e++) {
    const next = pokerFive([cards[a], cards[b], cards[c], cards[d], cards[e]]);
    if (!best || pokerCompare(best, next) < 0) best = next;
  }
  return best;
}
export const POKER_HANDS = ['High card', 'Pair', 'Two pair', 'Three of a kind', 'Straight', 'Flush', 'Full house', 'Four of a kind', 'Straight flush'];
/// The computer's feel for its hand, 0 to 1 (the same numbers as the Mac app's PokerModel.cpuStrength).
export function pokerStrength(hole, board) {
  if (board.length === 5) { const r = pokerRank([...hole, ...board]); return Math.min(0.98, 0.4 + r.category * 0.075 + (r.kickers[0] || 0) / 200); }
  if (hole.length !== 2) return 0.2;
  const a = pv(hole[0]), b = pv(hole[1]), high = Math.max(a, b), gap = Math.abs(a - b);
  let score = 0.12 + high * 0.027 + (a === b ? 0.32 : 0) + (hole[0].suit === hole[1].suit ? 0.06 : 0) + (gap <= 2 ? 0.05 : 0);
  if (board.length) { const br = new Set(board.map(pv)); if (br.has(a) || br.has(b)) score += 0.17; }
  return Math.min(score, 0.92);
}
