// Voxel Wall rules for Windows, the same as NotchApple/Modules/NowPlaying/VoxelWallLogic.swift (the Swift tests are the specification).

export const SCENES = ['Voxel Field', 'Spike Field', 'Infinite Tunnel', 'Voxel City'];
export const PALETTES = {
  ocean: { name: 'Ocean', colours: [[0.05, 0.55, 0.56], [0.93, 0.74, 0.32]] },
  ember: { name: 'Ember', colours: [[0.62, 0.12, 0.08], [1, 0.72, 0.3]] },
  violet: { name: 'Violet', colours: [[0.32, 0.16, 0.78], [1, 0.5, 0.8]] },
  mono: { name: 'Monochrome', colours: [[0.38, 0.38, 0.38], [0.96, 0.96, 0.96]] },
};

/** How many words of a lyric line are showing: one by one across the line's time, at least one once it starts. */
export function wordsShown(lineStart, nextStart, position, wordCount) {
  if (wordCount <= 0) return 0;
  const length = Math.max(0.6, Math.min(8, (nextStart ?? lineStart + 4) - lineStart));
  const progress = (position - lineStart) / (length * 0.85);
  return Math.max(1, Math.min(wordCount, Math.floor(progress * wordCount) + 1));
}

/** The last `keep` words shown, newest last. */
export const stack = (words, shown, keep = 3) => words.slice(0, shown).slice(-keep);

/** Made-up levels when the real sound isn't available: a 120 bpm beat while music plays, almost still when paused. */
export function simulatedLevels(time, playing) {
  if (!playing) return [0.04, 0.03, 0.02, 0.02];
  const beat = Math.pow(Math.max(0, Math.sin(time * 2 * Math.PI * 2)), 6);
  return [0.35 + 0.6 * beat, 0.3 + 0.25 * (0.5 + 0.5 * Math.sin(time * 3.1)), 0.25 + 0.25 * (0.5 + 0.5 * Math.sin(time * 5.3 + 1)), 0.15 + 0.2 * (0.5 + 0.5 * Math.sin(time * 8.7 + 2))];
}

/** Fast up, slow down. */
export const easeBands = (cur, target) => (cur.length !== target.length ? target : cur.map((c, i) => (target[i] > c ? c + (target[i] - c) * 0.6 : c + (target[i] - c) * 0.12)));
