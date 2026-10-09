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
