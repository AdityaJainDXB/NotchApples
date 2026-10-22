import test from 'node:test';
import assert from 'node:assert/strict';
import { PLACES } from '../src/js/modules/tzplaces.js';

const find = (q) => PLACES.filter((p) => `${p[0]} (${p[2]})`.toLowerCase().includes(q.toLowerCase())).map((p) => p[1]);

test('World Clock finds countries, states and big cities', () => {
  assert.ok(find('India').includes('Asia/Kolkata'));
  assert.ok(find('Mumbai').includes('Asia/Kolkata'));
  assert.ok(find('Texas').includes('America/Chicago'));
  assert.ok(find('California').includes('America/Los_Angeles'));
  assert.ok(find('United Arab Emirates').includes('Asia/Dubai'));
});

test('countries with several time zones list each of them', () => {
  const us = new Set(PLACES.filter((p) => p[2].startsWith('United States')).map((p) => p[1]));
  assert.ok(us.size >= 20);
  const au = new Set(PLACES.filter((p) => p[2].startsWith('Australia')).map((p) => p[1]));
  assert.ok(au.has('Australia/Perth') && au.has('Australia/Sydney') && au.has('Australia/Adelaide'));
});

test('every place uses a real time zone', () => {
  for (const p of PLACES) assert.doesNotThrow(() => new Intl.DateTimeFormat('en', { timeZone: p[1] }), p.join(' '));
});
