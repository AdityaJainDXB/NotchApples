import test from 'node:test';
import assert from 'node:assert/strict';
import { loadModule } from './load.mjs';

const L = await loadModule('services/insightslogic.js');

test('an install id is 32 lowercase hex characters, and different each time', () => {
  const a = L.newId(), b = L.newId();
  assert.ok(L.validId(a) && L.validId(b));
  assert.notEqual(a, b);
  assert.ok(!L.validId('ABC') && !L.validId('') && !L.validId(null));
});

test('the feedback card is first due after two weeks, then every three to four weeks', () => {
  const t = 1_700_000_000_000;
  assert.equal(L.firstDue(t) - t, 14 * L.DAY);
  for (const r of [0, 0.5, 0.999]) { const d = (L.nextDue(t, () => r) - t) / L.DAY; assert.ok(d >= 21 && d <= 28, `${d} days`); }
  assert.equal(L.isDue(t, 0), false, 'no date set: never due');
  assert.equal(L.isDue(t, t + 1), false);
  assert.equal(L.isDue(t, t), true);
});

test('a ping is due at most every six hours', () => {
  const t = 1_700_000_000_000;
  assert.equal(L.pingDue(t, t - 3 * 3_600_000), false);
  assert.equal(L.pingDue(t, t - 7 * 3_600_000), true);
});

test('what is sent holds no personal fields and is trimmed and checked', () => {
  const ping = L.pingBody({ id: 'a'.repeat(32), version: '1.55.0', osVersion: '10.0<script>', tier: 1 });
  assert.deepEqual(Object.keys(ping).sort(), ['id', 'os', 'osv', 'tier', 'v']);
  assert.equal(ping.os, 'win'); assert.equal(ping.osv, '10.0script');
  const note = L.noteBody({ id: 'b'.repeat(32), version: '1.55.0', kind: 'nonsense', text: '  hi there  '.padEnd(2000, 'x') });
  assert.equal(note.kind, 'idea'); assert.ok(note.text.length <= 1000);
  assert.deepEqual(Object.keys(note).sort(), ['id', 'kind', 'os', 'text', 'v']);
});

test('problems go to the glitch list, ideas and praise to feedback; the Windows version comes from the user agent', () => {
  assert.equal(L.endpointFor('problem'), '/telemetry/glitch');
  assert.equal(L.endpointFor('idea'), '/feedback'); assert.equal(L.endpointFor('praise'), '/feedback');
  assert.equal(L.windowsVersion('Mozilla/5.0 (Windows NT 10.0; Win64; x64)'), '10.0');
  assert.equal(L.windowsVersion('something else'), '');
});
