import test from 'node:test';
import assert from 'node:assert/strict';
import * as T from '../src/js/games/threecard-logic.js';

// The Swift tests (ThreeCardTests) are the specification.
const SUIT = { S: 'spades', H: 'hearts', D: 'diamonds', C: 'clubs' };
const hand = (s) => s.split(' ').map((t, i) => ({ id: `${i}${t}`, rank: t.slice(0, -1), suit: SUIT[t.slice(-1)] }));
const cat = (s) => T.evaluate(hand(s)).category;

test('categories', () => {
  assert.equal(cat('7S 7H 7D'), T.TRIPS); assert.equal(cat('9H 10H JH'), T.STRAIGHT_FLUSH); assert.equal(cat('9H 10C JH'), T.STRAIGHT);
  assert.equal(cat('2H 9H KH'), T.FLUSH); assert.equal(cat('5C 5D KH'), T.PAIR); assert.equal(cat('2C 9D KH'), T.HIGH);
  assert.equal(cat('AS 2H 3D'), T.STRAIGHT); assert.equal(cat('QS KH AD'), T.STRAIGHT); assert.equal(cat('KS AH 2D'), T.HIGH);
});

test('three of a kind beats a straight flush; order and tie-breaks', () => {
  assert.ok(T.compare(T.evaluate(hand('2S 2H 2D')), T.evaluate(hand('QH KH AH'))) > 0);
  const order = ['2C 9D KH', '5C 5D KH', '2H 9H KH', '9H 10C JH', '9H 10H JH', '7S 7H 7D'].map((h) => T.evaluate(hand(h)));
  for (let i = 1; i < order.length; i++) assert.ok(T.compare(order[i - 1], order[i]) < 0);
  assert.ok(T.compare(T.evaluate(hand('AS 2H 3D')), T.evaluate(hand('2S 3H 4D'))) < 0, 'A-2-3 is the lowest straight');
  assert.ok(T.compare(T.evaluate(hand('8C 8D 2H')), T.evaluate(hand('8S 8H 3D'))) < 0, 'kicker');
  assert.ok(T.compare(T.evaluate(hand('KC 9D 2H')), T.evaluate(hand('KS 9H 3D'))) < 0, 'third card');
  assert.ok(T.compare(T.evaluate(hand('AS 9D 8H')), T.evaluate(hand('2C 2D 3H'))) < 0, 'a pair beats ace-high');
});

test('winners, draws, split and the computer rule', () => {
  assert.deepEqual(T.winners([hand('2C 9D KH'), hand('5C 5D 3H')]), [1]);
  assert.deepEqual(T.winners([hand('KC 9D 2H'), hand('KS 9H 2D')]), [0, 1]);
  assert.deepEqual(T.split(31, 2), [16, 15]);
  assert.equal(T.cpuPlays(hand('QC 6D 4H')), true); assert.equal(T.cpuPlays(hand('JC 9D 4H')), false); assert.equal(T.cpuPlays(hand('2C 2D 4H')), true);
});
