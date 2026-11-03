import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const T = require('../src/js/games/trivia-logic.js');
const { questions } = require('../src/js/games/trivia-questions.js');

test('the question list is valid: 400+ questions, 4 distinct options, a valid answer, an explanation each', () => {
  assert.ok(questions.length >= 400, `only ${questions.length} questions`);
  assert.deepEqual(T.validate(questions), []);
  for (const q of questions) {
    assert.equal(q.o.length, 4);
    assert.ok(q.a >= 0 && q.a < 4 && q.o[q.a]);
    assert.ok(q.why.trim().length > 0);
  }
});

test('the list covers the planned categories and spreads the right answer over all four slots', () => {
  const cats = new Set(questions.map((q) => q.cat));
  for (const c of ['Science', 'History', 'Geography', 'Nature', 'Sport', 'Food', 'Tech', 'General']) assert.ok(cats.has(c), c);
  const slots = [0, 0, 0, 0];
  questions.forEach((q) => slots[q.a]++);
  for (const n of slots) assert.ok(n > questions.length / 8, `slots ${slots}`);
});

test('validate catches broken questions', () => {
  const ok = { cat: 'X', q: 'Q?', o: ['a', 'b', 'c', 'd'], a: 1, why: 'because' };
  assert.deepEqual(T.validate([ok]), []);
  assert.ok(T.validate([{ ...ok, o: ['a', 'b', 'c', 'A'] }]).length);        // repeated options
  assert.ok(T.validate([{ ...ok, o: ['a', 'b', 'c'] }]).length);             // only three
  assert.ok(T.validate([{ ...ok, a: 4 }]).length);                           // answer out of range
  assert.ok(T.validate([{ ...ok, why: '' }]).length);                        // no explanation
  assert.ok(T.validate([ok, { ...ok }]).length);                             // duplicate question
});

test('the daily question is the same for a date and does not depend on the time of day', () => {
  const a = T.dailyQuestion(questions, T.dateKey(new Date(2026, 10, 3, 0, 5)));
  const b = T.dailyQuestion(questions, T.dateKey(new Date(2026, 10, 3, 23, 55)));
  assert.equal(a, b);
  assert.equal(T.dateKey(new Date(2026, 10, 3)), '2026-11-03');
  assert.notEqual(T.dailyQuestion(questions, '2026-11-03'), T.dailyQuestion(questions, '2026-11-04'));
});

test('the daily question cycles through the whole list before any repeat', () => {
  const n = questions.length, seen = new Set(), start = T.dayNumber('2030-01-01');
  for (let d = 0; d < n; d++) seen.add(T.dailyIndex(n, (() => { const t = new Date((start + d) * 86400000); return `${t.getUTCFullYear()}-${String(t.getUTCMonth() + 1).padStart(2, '0')}-${String(t.getUTCDate()).padStart(2, '0')}`; })()));
  assert.equal(seen.size, n);
});

test('the pick is pinned: the order of the list must not change', () => {
  // If this fails, questions were reordered, removed or inserted, which would change everyone's question of the day.
  assert.equal(T.dailyIndex(420, '2026-11-03'), (((T.dayNumber('2026-11-03') * T.STEP + T.OFFSET) % 420) + 420) % 420);
  assert.equal(questions[0].q, 'Which gas do plants take in from the air for photosynthesis?');
  assert.equal(questions[questions.length - 1].cat, 'General');
});

test('practice sets have five different questions and avoid the ones asked to skip', () => {
  const set = T.practiceSet(questions, Math.random, 5);
  assert.equal(set.length, 5);
  assert.equal(new Set(set).size, 5);
  const again = T.practiceSet(questions, () => 0.42, 5, set);
  assert.equal(again.length, 5);
  assert.ok(again.every((i) => !set.includes(i)));
  assert.equal(T.practiceSet(questions.slice(0, 3), Math.random, 5).length, 3);   // a short list gives what it has
});

test('practice scoring counts the right picks', () => {
  const picked = [0, 1, 2, 3, 4];
  const right = picked.map((i) => questions[i].a);
  assert.equal(T.practiceScore(questions, picked, right), 5);
  assert.equal(T.practiceScore(questions, picked, right.map((a) => (a + 1) % 4)), 0);
  assert.equal(T.practiceScore(questions, picked, [right[0], -1, right[2], undefined, right[4]]), 3);
  assert.equal(T.isRight(questions[0], questions[0].a), true);
  assert.equal(T.isRight(questions[0], (questions[0].a + 1) % 4), false);
});

test('streak: consecutive days of right answers grow it, a wrong answer or a missed day ends it', () => {
  let s = T.newStats();
  s = T.record(s, '2026-11-01', true); assert.equal(s.streak, 1);
  s = T.record(s, '2026-11-02', true); assert.equal(s.streak, 2);
  s = T.record(s, '2026-11-02', false); assert.equal(s.streak, 2);           // the same day counts once
  assert.equal(s.played, 2);
  s = T.record(s, '2026-11-03', false); assert.equal(s.streak, 0); assert.equal(s.best, 2);
  s = T.record(s, '2026-11-04', true); assert.equal(s.streak, 1);
  s = T.record(s, '2026-11-06', true); assert.equal(s.streak, 1);            // a day was missed
  assert.equal(s.correct, 4); assert.equal(s.played, 5);
});

test('streak crosses month, year and leap-day boundaries', () => {
  let s = T.record(T.newStats(), '2027-12-31', true);
  s = T.record(s, '2028-01-01', true); assert.equal(s.streak, 2);
  s = T.record(T.record(T.newStats(), '2028-02-28', true), '2028-02-29', true); assert.equal(s.streak, 2);
  s = T.record(s, '2028-03-01', true); assert.equal(s.streak, 3);
});

test('the streak shown is only alive if the last right answer was today or yesterday', () => {
  const s = T.record(T.record(T.newStats(), '2026-11-01', true), '2026-11-02', true);
  assert.equal(T.currentStreak(s, '2026-11-02'), 2);
  assert.equal(T.currentStreak(s, '2026-11-03'), 2);
  assert.equal(T.currentStreak(s, '2026-11-04'), 0);
  assert.equal(T.currentStreak(null, '2026-11-04'), 0);
});

test('share text has the date and result but never the answer', () => {
  const q = questions[0];
  const t = T.shareText('2026-11-03', q, true);
  assert.match(t, /^Daily Trivia 2026-11-03\n/);
  assert.ok(t.includes('🟩') && !t.includes(q.o[q.a]));
  assert.ok(T.shareText('2026-11-03', q, false).includes('⬛'));
  assert.equal(T.practiceShareText([true, false, true, true, false]), 'Daily Trivia practice 3/5\n🟩⬛🟩🟩⬛');
});
