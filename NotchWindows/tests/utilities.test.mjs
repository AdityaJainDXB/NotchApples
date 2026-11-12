import test from 'node:test';
import assert from 'node:assert/strict';
import { loadModule } from './load.mjs';

const U = await loadModule('modules/utilitieslogic.js');

test('the tools inside Utilities leave the tab bar only while Utilities is on', () => {
  const on = ['today', 'utilities', 'shelf', 'stats'];
  const off = ['today', 'shelf', 'stats'];
  for (const id of U.MEMBERS) {
    assert.equal(U.insideUtilities(on, id), true, id);
    // World Clock is the exception: it is inside Utilities for everyone (tested below)
    assert.equal(U.insideUtilities(off, id), U.ALWAYS_INSIDE.includes(id), id);
  }
  assert.equal(U.insideUtilities(on, 'today'), false);
  assert.equal(U.insideUtilities(on, 'utilities'), false);
});

test('a request for a tool opens Utilities with that tool showing', () => {
  assert.deepEqual(U.route(['utilities'], 'shelf'), { id: 'utilities', opts: { open: 'shelf' } });
  assert.deepEqual(U.route([], 'shelf'), { id: 'shelf', opts: undefined });
  assert.deepEqual(U.route(['utilities'], 'today'), { id: 'today', opts: undefined });
});

test('Utilities holds exactly the tools the Windows app has', () => {
  assert.deepEqual(U.MEMBERS, ['stats', 'shelf', 'worldclock', 'launcher', 'convert']);
});

test('World Clock is inside Utilities for everyone, even with Utilities off', () => {
  assert.equal(U.insideUtilities([], 'worldclock'), true);
  assert.equal(U.insideUtilities(['today'], 'worldclock'), true);
  assert.deepEqual(U.route(['today'], 'worldclock'), { id: 'utilities', opts: { open: 'worldclock' } });
  assert.equal(U.insideUtilities([], 'stats'), false);                       // the others still need Utilities switched on
  assert.equal(U.insideUtilities(['utilities'], 'stats'), true);
});
