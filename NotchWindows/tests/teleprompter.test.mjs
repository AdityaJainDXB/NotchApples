import test from 'node:test';
import assert from 'node:assert/strict';
import { clampSpeed, clampFont, wordsPerMinute, wordCount, pixelsPerSecond, seconds, clock, advance } from '../src/js/services/teleprompterlogic.js';

test('speed levels map to a reading pace', () => {
  assert.equal(wordsPerMinute(1), 60);
  assert.equal(wordsPerMinute(4), 120);
  assert.equal(wordsPerMinute(10), 240);
});

test('speed and size stay in range', () => {
  assert.equal(clampSpeed(0), 1);
  assert.equal(clampSpeed(99), 10);
  assert.equal(clampSpeed('abc'), 1);
  assert.equal(clampFont(2), 14);
  assert.equal(clampFont(500), 44);
  assert.equal(wordsPerMinute(99), 240, 'an out-of-range speed is clamped');
});

test('faster is faster and bigger text moves further per second', () => {
  assert.ok(pixelsPerSecond(8, 24) > pixelsPerSecond(2, 24));
  assert.ok(pixelsPerSecond(4, 40) > pixelsPerSecond(4, 20));
  // 120 words a minute at 6 words a line is 0.333 lines a second; a 24 px line is 33.6 px tall.
  assert.ok(Math.abs(pixelsPerSecond(4, 24) - (120 / 60 / 6) * 24 * 1.4) < 1e-9);
});

test('word count and reading time', () => {
  assert.equal(wordCount('  hello   brave\nnew world  '), 4);
  assert.equal(wordCount(''), 0);
  assert.equal(seconds(120, 4), 60);
  assert.equal(seconds(0, 4), 0);
  assert.equal(clock(75), '1:15');
  assert.equal(clock(5), '0:05');
});

test('the scroll advances and stops at the end', () => {
  const step = advance(0, 1, 4, 24, 1000);
  assert.ok(Math.abs(step.offset - pixelsPerSecond(4, 24)) < 1e-9);
  assert.equal(step.finished, false);
  const end = advance(995, 1, 10, 40, 1000);
  assert.equal(end.offset, 1000);
  assert.equal(end.finished, true);
  assert.equal(advance(0, 1, 4, 24, 0).finished, true, 'a script that fits is finished at once');
  assert.equal(advance(10, -5, 4, 24, 1000).offset, 10, 'time never runs backwards');
});
