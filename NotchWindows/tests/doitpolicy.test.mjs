// Do It's reliability decisions on Windows (services/doitpolicy.js, a port of the Mac's DoItPolicy.swift). The cases are the
// Mac's, from DoItPolicyTests. Run: node --test NotchWindows/tests/doitpolicy.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadModule } from './load.mjs';

const P = await loadModule('services/doitpolicy.js');

test('the run ends after 15 steps without progress or at the ceiling, not before', () => {
  assert.equal(P.shouldEnd(0, 0), null);
  assert.equal(P.shouldEnd(14, 80), null, 'step 80 alone no longer ends a run');
  assert.equal(P.shouldEnd(15, 80), 'noProgress');
  assert.equal(P.shouldEnd(0, 300), 'ceiling');
  assert.equal(P.shouldEnd(0, 299), null);
});

test('the no-progress counter resets on change, ask and zoom', () => {
  assert.equal(P.updateNoProgress(4, 'click', false), 5);
  assert.equal(P.updateNoProgress(4, 'click', true), 0);
  assert.equal(P.updateNoProgress(4, 'ask', false), 0);
  assert.equal(P.updateNoProgress(4, 'zoom', false), 0);
  assert.equal(P.updateNoProgress(0, 'wait', false), 1);
});

test('screen change is judged by the fraction of cells that moved', () => {
  const a = new Array(100).fill(100);
  assert.equal(P.changedFraction(a, [...a]), 0);
  const b = [...a]; b[0] = 200; b[1] = 200;
  assert.equal(P.changedFraction(a, b), 0.02);
  assert.ok(P.screenChanged(a, b));
  const c = [...a]; c[0] = 108;
  assert.ok(!P.screenChanged(a, c), 'a tiny luma wobble is not a change');
  assert.equal(P.changedFraction([], []), 0, 'two failed captures are not a change');
  assert.equal(P.changedFraction(a, []), 1, 'mismatched signatures count as fully changed');
  assert.equal(P.changedFraction(a, a.slice(0, 50)), 1);
});

test('near-identical actions share one key, different ones do not', () => {
  assert.equal(P.actionKey({ action: 'click', x: 312, y: 448 }), P.actionKey({ action: 'click', x: 318, y: 442 }));
  assert.notEqual(P.actionKey({ action: 'click', x: 312, y: 448 }), P.actionKey({ action: 'click', x: 600, y: 448 }));
  assert.notEqual(P.actionKey({ action: 'click', x: 10, y: 10 }), P.actionKey({ action: 'right_click', x: 10, y: 10 }));
  assert.equal(P.actionKey({ action: 'key', key: 'Return' }), P.actionKey({ action: 'key', key: 'return' }));
  assert.equal(P.actionKey({ action: 'menu', path: ['File', 'Export…'] }), 'menu File>Export…');
  assert.equal(P.actionKey({ action: 'click_element', id: 7 }), 'click_element#7 ');
});

const o = (key, changed) => ({ key, changed });

test('hints escalate: repeats and flat screens raise the level, change clears it', () => {
  assert.equal(P.hintLevel([]), 0);
  assert.equal(P.hintLevel([o('a', true), o('b', true)]), 0);
  assert.equal(P.hintLevel([o('a', false), o('a', false)]), 1, 'two flat steps: gentle hint');
  assert.equal(P.hintLevel([o('a', false), o('a', false), o('a', false), o('a', false), o('a', false)]), 2, 'five flat: change method');
  assert.equal(P.hintLevel(new Array(8).fill(o('a', false))), 3, 'eight flat: ask the user');
  assert.equal(P.hintLevel([o('a', false), o('a', false), o('a', false)]), 2, 'three same flat actions: change method');
  assert.equal(P.hintLevel([o('a', true), o('a', true), o('a', true)]), 0, 'repeating while the screen changes is fine (scrolling a long page)');
  assert.equal(P.repeatRun([o('a', true), o('b', true), o('b', false)]), 2);
  assert.equal(P.noChangeRun([o('a', false), o('b', true), o('c', false)]), 1);
});

test('transient AI errors are retried with growing pauses, permanent ones are not', () => {
  assert.ok(P.isTransientAIError('HTTP 429: rate limit exceeded'));
  assert.ok(P.isTransientAIError('The model is overloaded, please try again'));
  assert.ok(P.isTransientAIError('network connection lost'));
  assert.ok(P.isTransientAIError("The AI (gemini) didn't answer in 90 seconds, so I stopped (timed out)"));
  assert.ok(!P.isTransientAIError('Invalid API key'));
  assert.ok(!P.isTransientAIError('401 unauthorized'));
  assert.ok(!P.isTransientAIError("gpt-3.5 can't see images"));
  assert.equal(P.retryDelayMs(0), 2000);
  assert.equal(P.retryDelayMs(4), 60000);
  assert.equal(P.retryDelayMs(5), null, 'after the budget the run gives up');
  assert.ok(P.RETRY_DELAYS_MS.reduce((a, b) => a + b, 0) <= 120000, 'the whole budget stays near two minutes');
});

test('scrolls are split into small signed chunks', () => {
  assert.deepEqual(P.scrollChunks(10), [4, 4, 2]);
  assert.deepEqual(P.scrollChunks(-6), [-4, -2]);
  assert.deepEqual(P.scrollChunks(3), [3]);
  assert.deepEqual(P.scrollChunks(0), []);
});

test('element lines are compact and the trim keeps menus, focus and the front window first', () => {
  const e = { id: 3, role: 'button', label: 'Save', value: '', x: 512.7, y: 40.2, w: 80, h: 30, focused: true };
  assert.equal(P.elementLine(e), '3 button "Save" @512,40 80x30 FOCUSED');
  const mk = (id, extra = {}) => ({ id, role: 'button', label: `b${id}`, value: '', x: 0, y: 0, w: 10, h: 10, ...extra });
  const all = [mk(1, { front: false }), mk(2), mk(3, { focused: true }), mk(4, { menu: true })];
  assert.deepEqual(P.trimElements(all).map((x) => x.id), [4, 3, 2, 1]);
  assert.equal(P.trimElements(all, 2).length, 2);
  const many = Array.from({ length: 200 }, (_, i) => mk(i));
  assert.equal(P.trimElements(many).length, P.MAX_ELEMENTS);
  assert.ok(P.trimElements(many, 200, 300).length < 20, 'the character budget also caps the list');
});
