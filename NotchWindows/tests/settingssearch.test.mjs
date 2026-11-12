import test from 'node:test';
import assert from 'node:assert/strict';
import { fold, buildIndex, search, searchFeatures, PANE_KEYWORDS } from '../src/js/modules/settingssearch.js';

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

test('a pane answers to its keywords, like the Mac search', () => {
  const idx = buildIndex({ Shortcuts: [], Access: [], General: [] });
  assert.equal(search(idx, 'hotkey')[0].pane, 'Shortcuts');
  assert.equal(search(idx, 'license')[0].pane, 'Access');
  assert.equal(search(idx, 'startup')[0].pane, 'General');
});
test('every pane has keywords', () => {
  for (const k of ['General', 'Updates', 'Appearance', 'Tabs', 'Shortcuts', 'AI', 'Calendar', 'Weather', 'Clipboard', 'Security', 'Rules', 'Automations', 'Access', 'About']) assert.ok(PANE_KEYWORDS[k], k);
});
const mods = [
  { id: 'games', name: 'Games', blurb: 'Play Snake and Chess.' },
  { id: 'notes', name: 'Notes', blurb: 'Quick notes, with games of the day.' },
  { id: 'settings', name: 'Settings', blurb: 'Everything.' },
];
test('features match by name or description, names that start with the query first', () => {
  assert.deepEqual(searchFeatures(mods, 'games').map((m) => m.id), ['games', 'notes']);
  assert.deepEqual(searchFeatures(mods, 'QUICK').map((m) => m.id), ['notes']);
});
test('a feature needs two letters and Settings itself is never a feature', () => {
  assert.deepEqual(searchFeatures(mods, 'g'), []);
  assert.deepEqual(searchFeatures(mods, 'every'), []);
  assert.deepEqual(searchFeatures(mods, ''), []);
});
