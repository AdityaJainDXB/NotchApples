import test from 'node:test';
import assert from 'node:assert/strict';

// The service reads its settings from the browser's storage: give it a small one.
const mem = new Map();
globalThis.window = globalThis;
globalThis.localStorage = { getItem: (k) => (mem.has(k) ? mem.get(k) : null), setItem: (k, v) => mem.set(k, String(v)), removeItem: (k) => mem.delete(k) };
globalThis.document = { addEventListener() {}, querySelector: () => null, documentElement: { style: {}, dataset: {} } };
const { isGeminiChatModel, geminiRank, modelOf, PROVIDERS } = await import('../src/js/services/ai.js');

test('only Gemini chat models are offered, never image, voice, embedding or live ones', () => {
  for (const ok of ['gemini-3.5-flash-lite', 'gemini-3.8-flash', 'gemini-2.5-pro']) assert.equal(isGeminiChatModel(ok), true, ok);
  for (const bad of ['gemini-3-pro-image-preview', 'gemini-2.5-flash-preview-tts', 'gemini-embedding-001', 'gemini-live-2.5-flash', 'gemini-2.5-flash-native-audio', 'imagen-4', 'veo-3']) {
    assert.equal(isGeminiChatModel(bad), false, bad);
  }
});

test('flash and newer models rank first, previews last (same as the Mac)', () => {
  assert.ok(geminiRank('gemini-3.8-flash') > geminiRank('gemini-2.5-flash'));
  assert.ok(geminiRank('gemini-3.8-flash') > geminiRank('gemini-3.8-pro'));
  assert.ok(geminiRank('gemini-3.8-flash') > geminiRank('gemini-3.8-flash-preview'));
});

test('a Gemini image model picked earlier falls back to the default model', () => {
  assert.equal(PROVIDERS.gemini.def, 'gemini-3.5-flash-lite');
  mem.set('ai.model.gemini', JSON.stringify('gemini-3-pro-image-preview'));
  assert.equal(modelOf('gemini'), 'gemini-3.5-flash-lite');
  mem.set('ai.model.gemini', JSON.stringify('gemini-3.8-flash'));
  assert.equal(modelOf('gemini'), 'gemini-3.8-flash');
});
