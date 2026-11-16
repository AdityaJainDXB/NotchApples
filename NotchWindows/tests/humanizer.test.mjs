import test from 'node:test';
import assert from 'node:assert/strict';
import { perRequestLimit, monthlyAllowance, wordCount, current, decide, applying, message, dollars, clean, userMessage, totalLeft, SYSTEM, WORDS_PER_DOLLAR } from '../src/js/services/humanizerlogic.js';

// The Swift tests (HumanizerTests) are the specification.
const u = (used = 0, credits = 0) => ({ month: '2026-11', used, credits });

test('limits by plan', () => {
  assert.deepEqual([0, 1, 2].map(perRequestLimit), [500, 1000, null]);
  assert.deepEqual([0, 1, 2].map(monthlyAllowance), [3000, 15000, 40000]);
  assert.equal(WORDS_PER_DOLLAR, 50000);
});

test('word count', () => {
  assert.equal(wordCount('  Hello,   big\nworld  '), 3);
  assert.equal(wordCount(''), 0);
});

test('one request cannot be longer than the plan allows', () => {
  assert.deepEqual(decide(501, 0, u()), { kind: 'tooLong', limit: 500, words: 501 });
  assert.equal(decide(500, 0, u()).kind, 'allowed');
  assert.equal(decide(1001, 1, u()).kind, 'tooLong');
  assert.deepEqual(decide(30000, 2, u()), { kind: 'allowed', fromMonth: 30000, fromCredits: 0 });
  assert.equal(decide(0, 1, u()).kind, 'empty');
});

test('the month runs out, then credits cover the rest', () => {
  assert.deepEqual(decide(400, 0, u(2700)), { kind: 'outOfWords', needed: 400, left: 300 });
  assert.deepEqual(decide(400, 0, u(2700, 100)), { kind: 'allowed', fromMonth: 300, fromCredits: 100 });
  assert.equal(decide(400, 0, u(2700, 99)).kind, 'outOfWords');
  assert.deepEqual(decide(100, 0, u(3000, 500)), { kind: 'allowed', fromMonth: 0, fromCredits: 100 });
});

test('applying takes the month first, then credits', () => {
  assert.deepEqual(applying(decide(400, 0, u(2700, 150)), u(2700, 150)), u(3000, 50));
  assert.deepEqual(applying(decide(600, 0, u()), u(5)), u(5));
});

test('a new month renews words and keeps credits', () => {
  const now = current({ month: '2026-10', used: 2900, credits: 700 }, new Date(2026, 10, 1));
  assert.deepEqual(now, { month: '2026-11', used: 0, credits: 700 });
  assert.equal(totalLeft(now, 0), 3700);
});

test('credits price, cleaning and messages', () => {
  assert.equal(dollars(50000), 1); assert.equal(dollars(25000), 0.5); assert.equal(dollars(1), 0.01);
  assert.equal(clean('<<<TEXT\n  Hi there.\nTEXT>>>\n'), 'Hi there.');
  assert.ok(userMessage('abc').includes('abc'));
  assert.ok(message({ kind: 'tooLong', limit: 500, words: 600 }, 0));
  assert.ok(message({ kind: 'outOfWords', needed: 10, left: 0 }, 1));
  assert.equal(message({ kind: 'allowed', fromMonth: 1, fromCredits: 0 }, 1), null);
  assert.match(SYSTEM, /Signs of AI writing/);
  assert.doesNotMatch(SYSTEM, /\\\n/);
});

test('an admin key has no Humanizer limits at all', async () => {
  const L = await import('../src/js/services/humanizerlogic.js');
  assert.equal(L.perRequestLimit(3), null);
  assert.equal(L.monthlyAllowance(3), Number.MAX_SAFE_INTEGER);
  assert.equal(L.decide(5000, 3, L.current(null)).kind, 'allowed');
  assert.equal(L.perRequestLimit(2), null, 'Ultimate is unchanged');
  assert.equal(L.monthlyAllowance(2), 40000, 'Ultimate is unchanged');
});
