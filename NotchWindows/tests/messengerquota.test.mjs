import test from 'node:test';
import assert from 'node:assert/strict';
import { monthlyLimit, monthKey, current, remaining, isNearLimit, burstWait, limitMessage, BURST_MAX } from '../src/js/services/messengerquotalogic.js';

// The Swift tests (MessengerQuotaTests) are the specification.
test('monthly limits per tier', () => {
  assert.deepEqual([0, 1, 2].map(monthlyLimit), [500, 1000, 5000]);
});

test('a count starts again in a new month', () => {
  assert.deepEqual(current({ month: '2026-10', used: 480 }, new Date(2026, 10, 1)), { month: '2026-11', used: 0 });
  assert.equal(current({ month: '2026-11', used: 12 }, new Date(2026, 10, 30)).used, 12);
  assert.equal(current(null, new Date(2026, 10, 3)).used, 0);
  assert.equal(monthKey(new Date(2026, 0, 5)), '2026-01');
});

test('near the limit and remaining', () => {
  const c = (n) => ({ month: '2026-11', used: n });
  assert.equal(isNearLimit(c(399), 500), false);
  assert.equal(isNearLimit(c(400), 500), true);
  assert.equal(isNearLimit(c(500), 500), false);
  assert.equal(remaining(c(520), 500), 0);
});

test('the burst limit is five in ten seconds', () => {
  const now = 1_000_000;
  assert.equal(BURST_MAX, 5);
  assert.equal(burstWait([0, 1, 2, 3].map((i) => now - i * 1000), now), null);
  assert.equal(burstWait([0, 2, 4, 6, 8].map((i) => now - i * 1000), now), 2);
  assert.equal(burstWait([0, 1, 2, 3, 4].map((i) => now - 11000 - i * 1000), now), null);
});

test('the limit message points to the next plan', () => {
  assert.match(limitMessage(0, 500), /Pro gives you 1,000/);
  assert.match(limitMessage(1, 1000), /Ultimate gives you 5,000/);
  assert.doesNotMatch(limitMessage(2, 5000), /gives you/);
});
