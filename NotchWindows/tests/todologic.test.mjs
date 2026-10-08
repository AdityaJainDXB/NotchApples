// The To-do list's priority rules, mirrored from the Mac app's TodoLogicTests.
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadModule } from './load.mjs';

const T = await loadModule('services/todologic.js');
const item = (text, priority, extra = {}) => ({ text, priority, done: false, created: 1000, ...extra });

test('high priority is pinned to the top by default', () => {
  const list = [item('low', 'low', { created: 1 }), item('high', 'high', { created: 2 }), item('med', 'medium', { created: 3 }), item('high2', 'high', { created: 4 })];
  assert.deepEqual(T.orderTodos(list, true).map((t) => t.text), ['high2', 'high', 'med', 'low']);
});

test('with priority sorting off the order is due date, then newest', () => {
  const list = [item('low', 'low', { created: 1 }), item('high', 'high', { created: 2 }), item('med', 'medium', { created: 3 })];
  assert.deepEqual(T.orderTodos(list, false).map((t) => t.text), ['med', 'high', 'low']);
  const dated = [item('later', 'low', { due: 9000 }), item('soon', 'high', { due: 5000 }), item('none', 'high')];
  assert.deepEqual(T.orderTodos(dated, false).map((t) => t.text), ['soon', 'later', 'none']);
});

test('done tasks sink to the bottom whatever their priority', () => {
  const list = [item('done high', 'high', { done: true }), item('open low', 'low', { created: 2 })];
  assert.deepEqual(T.orderTodos(list, true).map((t) => t.text), ['open low', 'done high']);
});

test('soonest due wins within a priority', () => {
  const list = [item('none', 'high', { created: 1 }), item('later', 'high', { due: 9000, created: 2 }), item('soon', 'high', { due: 5000, created: 3 })];
  assert.deepEqual(T.orderTodos(list, true).map((t) => t.text), ['soon', 'later', 'none']);
});

test('priority marks are read', () => {
  assert.deepEqual(T.splitPriority('Buy milk !!!'), { text: 'Buy milk', priority: 'high' });
  assert.deepEqual(T.splitPriority('!! Email Sam'), { text: 'Email Sam', priority: 'medium' });
  assert.deepEqual(T.splitPriority('Water plants !'), { text: 'Water plants', priority: 'low' });
  assert.deepEqual(T.splitPriority('high: Pay rent'), { text: 'Pay rent', priority: 'high' });
  assert.deepEqual(T.splitPriority('Plain task'), { text: 'Plain task', priority: null });
  assert.deepEqual(T.splitPriority('   '), { text: '', priority: null });
});

test('an old task without a priority reads as medium', () => {
  assert.equal(T.priorityOf({ text: 'old' }), 'medium');
  assert.equal(T.priorityOf({ priority: 'banana' }), 'medium');
  assert.equal(T.priorityOf({ priority: 'high' }), 'high');
});
