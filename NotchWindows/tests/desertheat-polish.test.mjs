// Desert Heat section 11: weather, radio, random events, presets, saves, palettes.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const W = require('../src/js/games/desertheat/polish.js');

test('weather is mostly clear, fog only on winter mornings, and the same for the same hour', () => {
  const count = {};
  for (let d = 1; d <= 365; d++) for (let h = 0; h < 24; h += 6) { const w = W.weatherAt(d, h); count[w] = (count[w] || 0) + 1; if (w === 'fog') assert.ok((d > 305 || d < 75) && h >= 4 && h < 9); }
  assert.ok(count.clear > 365 * 4 * 0.5, 'mostly clear');
  assert.ok(count.sandstorm > 0 && count.sandstorm < 365 * 4 * 0.1, 'sandstorms are rare');
  assert.equal(W.weatherAt(100, 13), W.weatherAt(100, 13.5));
});

test('rain makes the road slippery and storms help you lose the police', () => {
  assert.ok(W.WEATHER.rain.grip < W.WEATHER.clear.grip);
  assert.ok(W.WEATHER.sandstorm.policeEscape > 1);
  const b = W.blend('clear', 'fog', 0.5); assert.ok(b.fog > 1 && b.fog < W.WEATHER.fog.fog);
});

test('six made-up stations; Talk 97 talks and reads the news; ads come round', () => {
  assert.equal(W.STATIONS.length, 6);
  const t = W.programme('talk', 0, ['Chaos on Sheikh Zayed Road']); assert.equal(t.kind, 'talk');
  let ads = 0, music = 0; for (let s = 0; s < 45 * 40; s += 45) { const p = W.programme('noor', s); if (p.kind === 'ad') ads++; if (p.kind === 'music') music++; }
  assert.ok(ads > 5 && music > ads);
  const notes = W.bar('dunes', 3); assert.ok(notes.some((n) => n[3] === 'kick') && notes.some((n) => n[3] === 'lead'));
  assert.equal(W.bar('talk', 1).length, 0);
});

test('random events fit the hour and are rare', () => {
  assert.equal(W.pickEvent(14, 0.5, 0), null);
  assert.equal(W.pickEvent(23, 0.001, 30), null, 'not during the cooldown');
  const night = W.pickEvent(23, 0.001, 0); assert.ok(night);
  for (let r = 0; r < 0.012; r += 0.001) { const e = W.pickEvent(13, r, 0); if (e) assert.notEqual(e.id, 'wedding'); }
});

test('the frame rate picks a lighter preset when slow and a richer one when there is room', () => {
  assert.equal(W.autoPreset('high', 30), 'balanced'); assert.equal(W.autoPreset('balanced', 60), 'high'); assert.equal(W.autoPreset('low', 20), 'low');
});

test('old saves are migrated and there are ten slots', () => {
  const m = W.migrate({ v: 1, chars: {} }); assert.equal(m.v, W.SAVE_VERSION); assert.deepEqual(m.done, []);
  assert.equal(W.migrate(null), null); assert.equal(W.SLOTS, 10); assert.equal(W.slotKey(0), 'desertheat.save');
});

test('colour-blind palettes keep police and allies apart', () => {
  for (const p of Object.values(W.PALETTES)) assert.notEqual(p.police, p.ally);
});
