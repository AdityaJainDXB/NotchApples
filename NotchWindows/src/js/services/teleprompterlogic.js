// Tools → Teleprompter: the rules, the same as NotchApple/Core/TeleprompterLogic.swift (the Swift tests are the specification).
// A speed is a level from 1 to 10, which means a reading pace in words a minute; the text moves up that fast for the chosen text size.

export const SPEED_MIN = 1;
export const SPEED_MAX = 10;
export const DEFAULT_SPEED = 4;
export const FONT_MIN = 14;
export const FONT_MAX = 44;
export const DEFAULT_FONT = 24;
/** How many words fit on one line of the reader, used to turn a reading pace into a scroll speed. */
export const WORDS_PER_LINE = 6;
/** A line is this many times as tall as its text. */
export const LINE_HEIGHT = 1.4;

export const clampSpeed = (s) => Math.min(SPEED_MAX, Math.max(SPEED_MIN, Math.round(Number(s)) || SPEED_MIN));
export const clampFont = (f) => Math.min(FONT_MAX, Math.max(FONT_MIN, Number(f) || DEFAULT_FONT));

/** The reading pace a speed level stands for: 60 words a minute at level 1, 240 at level 10. */
export const wordsPerMinute = (speed) => 60 + (clampSpeed(speed) - 1) * 20;
export const wordCount = (text) => String(text || '').split(/\s+/).filter(Boolean).length;

/** How far the text moves up each second, in pixels, for a speed and a text size. */
export const pixelsPerSecond = (speed, fontSize) => (wordsPerMinute(speed) / 60 / WORDS_PER_LINE) * clampFont(fontSize) * LINE_HEIGHT;

/** How long the script takes to read at a speed, in whole seconds. */
export const seconds = (words, speed) => Math.round((Math.max(0, words) / wordsPerMinute(speed)) * 60);

/** m:ss */
export const clock = (s) => { const n = Math.max(0, Math.round(s)); return `${Math.floor(n / 60)}:${String(n % 60).padStart(2, '0')}`; };

/** One tick of the scroll: the new offset after `dt` seconds, never past `maxOffset`, and whether the end was reached. */
export function advance(offset, dt, speed, fontSize, maxOffset) {
  const limit = Math.max(0, maxOffset);
  const next = offset + pixelsPerSecond(speed, fontSize) * Math.max(0, dt);
  return next >= limit ? { offset: limit, finished: true } : { offset: next, finished: false };
}
