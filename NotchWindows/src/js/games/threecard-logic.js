// Three-Card Poker (issue #101), the same rules as NotchApple/Modules/Games/ThreeCardLogic.swift (the Swift tests are the
// specification). Rankings, strongest first: Three of a Kind, Straight Flush, Straight, Flush, Pair, High Card. Ace is high, and
// also low in A-2-3, the lowest straight. Suits never break a tie; equal hands are a draw.
import { rankValue } from './cardslogic.js';

export const CATEGORIES = [
  { name: 'High Card', detail: 'None of the above' },
  { name: 'Pair', detail: 'Two cards of the same value' },
  { name: 'Flush', detail: 'Three of the same suit' },
  { name: 'Straight', detail: 'Three in a row, mixed suits' },
  { name: 'Straight Flush', detail: 'Three in a row, same suit' },
  { name: 'Three of a Kind', detail: 'Three cards of the same value' },
];
export const HIGH = 0, PAIR = 1, FLUSH = 2, STRAIGHT = 3, STRAIGHT_FLUSH = 4, TRIPS = 5;

const value = (c) => (c.rank === 'A' ? 14 : rankValue(c.rank));

/** { category, tiebreak } for exactly three cards. */
export function evaluate(cards) {
  if (cards.length !== 3) throw new Error('Three-Card Poker hands have exactly three cards');
  const v = cards.map(value).sort((a, b) => b - a);
  const flush = new Set(cards.map((c) => c.suit)).size === 1;
  const sh = v[0] === 14 && v[1] === 3 && v[2] === 2 ? 3 : (v[0] - 1 === v[1] && v[1] - 1 === v[2] ? v[0] : null);
  if (v[0] === v[2]) return { category: TRIPS, tiebreak: [v[0]] };
  if (sh !== null && flush) return { category: STRAIGHT_FLUSH, tiebreak: [sh] };
  if (sh !== null) return { category: STRAIGHT, tiebreak: [sh] };
  if (flush) return { category: FLUSH, tiebreak: v };
  if (v[0] === v[1]) return { category: PAIR, tiebreak: [v[0], v[2]] };
  if (v[1] === v[2]) return { category: PAIR, tiebreak: [v[1], v[0]] };
  return { category: HIGH, tiebreak: v };
}

/** Negative when a is weaker, positive when stronger, 0 for an exact tie. */
export function compare(a, b) {
  if (a.category !== b.category) return a.category - b.category;
  for (let i = 0; i < Math.min(a.tiebreak.length, b.tiebreak.length); i++) if (a.tiebreak[i] !== b.tiebreak[i]) return a.tiebreak[i] - b.tiebreak[i];
  return 0;
}

/** Indexes of the best hands (more than one when they tie exactly). */
export function winners(hands) {
  const ranks = hands.map(evaluate);
  let best = ranks[0];
  for (const r of ranks) if (compare(r, best) > 0) best = r;
  return ranks.map((r, i) => (compare(r, best) === 0 ? i : -1)).filter((i) => i >= 0);
}

/** A computer player stays in with a pair or better, or Queen-high or better. */
export const cpuPlays = (cards) => { const r = evaluate(cards); return r.category > HIGH || r.tiebreak[0] >= 12; };

/** Equal shares of the pot, the odd chips to the first winners. */
export const split = (pot, count) => Array.from({ length: count }, (_, i) => Math.floor(pot / count) + (i < pot % count ? 1 : 0));
