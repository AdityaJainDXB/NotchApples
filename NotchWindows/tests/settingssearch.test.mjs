import test from 'node:test';
import assert from 'node:assert/strict';
import { fold, buildIndex, search } from '../src/js/modules/settingssearch.js';

const index = buildIndex({
  General: [{ name: 'Launch at login', desc: 'Start Notch Apple with Windows' }, { name: 'Café mode', desc: '' }],
  Appearance: [{ name: 'Theme', desc: 'Colours of the notch' }, { name: 'Tab names', desc: '' }],
  Updates: [{ name: 'Check for updates', desc: 'Install new versions automatically' }],
});

test('nothing typed finds nothing', () => { assert.deepEqual(search(index, ''), []); assert.deepEqual(search(index, '   '), []); });
test('a row name finds its pane and the row', () => {
  const r = search(index, 'launch');
  assert.equal(r[0].pane, 'General');
  assert.equal(r[0].rows[0].name, 'Launch at login');
});
test('every word must match, in any order', () => {
  assert.equal(search(index, 'login launch')[0].pane, 'General');
  assert.deepEqual(search(index, 'launch theme'), []);
});
test('accents and capitals do not matter', () => {
  assert.equal(fold('Café'), 'cafe');
  assert.equal(search(index, 'CAFE')[0].pane, 'General');
});
test('a pane name alone opens the pane', () => {
  const r = search(index, 'updates');
  assert.equal(r[0].pane, 'Updates');
});
test('ties keep the settings order', () => {
  const r = search(index, 'notch', ['General', 'Appearance', 'Updates']);
  assert.deepEqual(r.map((x) => x.pane), ['General', 'Appearance']);
});
