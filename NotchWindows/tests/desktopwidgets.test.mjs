import test from 'node:test';
import assert from 'node:assert/strict';
import { enabled, todoLines, nowPlayingText, positionOnScreen } from '../src/js/services/desktopwidgetlogic.js';

// The Swift tests (DesktopWidgetTests) are the specification.

test('only switched-on widgets, in a fixed order', () => {
  assert.deepEqual(enabled(['nowplaying', 'clock', 'bogus']), ['clock', 'nowplaying']);
  assert.deepEqual(enabled([]), []);
  assert.deepEqual(enabled(null), []);
});
test('to-do lines show open tasks and count the rest', () => {
  const items = Array.from({ length: 8 }, (_, i) => ({ text: `t${i + 1}`, done: i === 1 }));
  const r = todoLines(items, 5);
  assert.deepEqual(r.shown.map((t) => t.text), ['t1', 't3', 't4', 't5', 't6']);
  assert.equal(r.more, 2);
  assert.deepEqual(todoLines([{ text: 'x', done: true }]).shown, []);
  assert.deepEqual(todoLines(undefined), { shown: [], more: 0 });
});
test('now playing words', () => {
  assert.equal(nowPlayingText(null, null, false).line1, 'Nothing playing');
  assert.equal(nowPlayingText('  ', 'A', true).line1, 'Nothing playing');
  assert.equal(nowPlayingText('Song', 'Band', true).line2, 'Band');
  assert.equal(nowPlayingText('Song', 'Band', false).line2, 'Band · paused');
  assert.equal(nowPlayingText('Song', '', false).line2, 'Paused');
});
test('a saved position on a screen is kept, one off every screen is not', () => {
  const one = [{ x: 0, y: 0, w: 1920, h: 1080 }];
  assert.equal(positionOnScreen(300, 300, 200, 100, one), true);
  assert.equal(positionOnScreen(2800, 400, 200, 100, one), false);
  assert.equal(positionOnScreen(-900, -500, 200, 100, one), false);
  assert.equal(positionOnScreen(2000, 300, 200, 100, [...one, { x: 1920, y: 0, w: 1920, h: 1080 }]), true);
  assert.equal(positionOnScreen(NaN, 1, 2, 3, one), false);
});
