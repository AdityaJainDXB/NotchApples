import test from 'node:test';
import assert from 'node:assert/strict';
import { wordsShown, stack, simulatedLevels, easeBands, SCENES, PALETTES } from '../src/js/services/voxelwalllogic.js';

// The Swift tests (VoxelWallTests) are the specification.
test('Verse shows words one by one across the line', () => {
  assert.equal(wordsShown(10, 14, 10, 4), 1);
  assert.equal(wordsShown(10, 14, 11.8, 4), 3);
  assert.equal(wordsShown(10, 14, 20, 4), 4);
  assert.equal(wordsShown(10, null, 9, 3), 1);
  assert.deepEqual(stack(['a', 'b', 'c', 'd'], 4), ['b', 'c', 'd']);
  assert.deepEqual(stack(['a', 'b'], 1), ['a']);
});

test('bands jump up and settle slowly; paused music is almost still', () => {
  assert.equal(easeBands([0, 0, 0, 0], [1, 1, 1, 1])[0], 0.6);
  assert.ok(Math.abs(easeBands([1, 1, 1, 1], [0, 0, 0, 0])[0] - 0.88) < 1e-9);
  assert.ok(simulatedLevels(1, false).every((x) => x < 0.05));
  assert.ok(simulatedLevels(0.125, true)[0] > 0.5);
});

test('the same scenes and colours as the Mac', () => {
  assert.deepEqual(SCENES, ['Block Field', 'Spike Field', 'Infinite Tunnel', 'Block City']);
  assert.deepEqual(Object.keys(PALETTES), ['ocean', 'ember', 'violet', 'mono']);
});
