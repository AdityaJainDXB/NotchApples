import test from 'node:test';
import assert from 'node:assert/strict';
import { loadModule } from './load.mjs';
const { makeDeck, shuffle, bjValue, bjOutcome, isBlackjack, dealerShouldHit, solDeal, canPlaceTableau, canPlaceFoundation, solWon } = await loadModule('games/cardslogic.js');

const h = (...r) => r.map((rank) => ({ rank, suit: 'spades' }));
test('deck has 52 distinct cards and a shuffle keeps them', () => {
  const d = makeDeck(); assert.equal(d.length, 52); assert.equal(new Set(d.map((c) => c.id)).size, 52);
  assert.equal(new Set(shuffle(d).map((c) => c.id)).size, 52);
});
test('blackjack totals', () => {
  assert.deepEqual(bjValue(h('A', 'K')), { total: 21, soft: true });
  assert.deepEqual(bjValue(h('A', 'A', '9')), { total: 21, soft: true });
  assert.deepEqual(bjValue(h('A', 'K', '5')), { total: 16, soft: false });
  assert.equal(bjValue(h('K', 'Q', '5')).total, 25);
  assert.equal(isBlackjack(h('A', 'K')), true); assert.equal(isBlackjack(h('7', '7', '7')), false);
  assert.equal(dealerShouldHit(h('10', '6')), true); assert.equal(dealerShouldHit(h('10', '7')), false);
  assert.equal(dealerShouldHit(h('A', '6')), false);   // soft 17: the dealer stands
});
test('blackjack outcomes', () => {
  assert.deepEqual(bjOutcome(h('A', 'K'), h('10', '7')), { result: 'blackjack', pay: 1.5 });
  assert.deepEqual(bjOutcome(h('A', 'K'), h('A', 'Q')), { result: 'push', pay: 0 });
  assert.equal(bjOutcome(h('K', 'Q', '5'), h('10', '7')).pay, -1);
  assert.equal(bjOutcome(h('10', '9'), h('10', '6', '9')).pay, 1);   // dealer busts
  assert.equal(bjOutcome(h('10', '8'), h('10', '8')).pay, 0);
  assert.equal(bjOutcome(h('10', '7'), h('10', '8')).pay, -1);
  assert.equal(bjOutcome(h('7', '7', '7'), h('A', 'K')).pay, -1);     // dealer blackjack beats 21
});
test('solitaire deal and rules', () => {
  const s = solDeal(makeDeck());
  assert.deepEqual(s.tableau.map((p) => p.length), [1, 2, 3, 4, 5, 6, 7]); assert.equal(s.stock.length, 24);
  assert.ok(s.tableau.every((p) => p.every((c, i) => c.up === (i === p.length - 1))));
  const red6 = { rank: '6', suit: 'hearts', up: true }, black5 = { rank: '5', suit: 'spades' }, red5 = { rank: '5', suit: 'diamonds' };
  assert.equal(canPlaceTableau(black5, [red6]), true); assert.equal(canPlaceTableau(red5, [red6]), false);
  assert.equal(canPlaceTableau({ rank: 'K', suit: 'clubs' }, []), true); assert.equal(canPlaceTableau({ rank: 'Q', suit: 'clubs' }, []), false);
  assert.equal(canPlaceFoundation({ rank: 'A', suit: 'clubs' }, []), true);
  assert.equal(canPlaceFoundation({ rank: '2', suit: 'clubs' }, [{ rank: 'A', suit: 'clubs' }]), true);
  assert.equal(canPlaceFoundation({ rank: '2', suit: 'hearts' }, [{ rank: 'A', suit: 'clubs' }]), false);
  assert.equal(solWon({ found: [new Array(13), new Array(13), new Array(13), new Array(13)] }), true);
});
