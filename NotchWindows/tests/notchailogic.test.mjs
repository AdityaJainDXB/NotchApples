import test from 'node:test';
import assert from 'node:assert/strict';
import * as L from '../src/js/services/notchailogic.js';

// The Swift tests (NotchAITests, NotchAIConversationTests, NotchAIVoiceTests) are the specification for these.

test('Ollama cloud names are recognised', () => {
  for (const m of ['gpt-oss:120b-cloud', 'qwen3:cloud', 'model:cloud-preview', 'x-cloud:latest', 'GLM-4.6:CLOUD']) assert.equal(L.isOllamaCloudName(m), true, m);
  for (const m of ['qwen3:8b', 'llama3.2', 'cloudy:7b', 'mycloudmodel', '']) assert.equal(L.isOllamaCloudName(m), false, m);
});

test('local and loopback hosts', () => {
  for (const u of ['http://localhost:11434', 'http://127.0.0.1:1234/v1', 'http://[::1]:11434', 'http://10.0.0.5', 'http://192.168.1.20:8080', 'http://172.16.0.1', 'http://172.31.255.1', 'http://nas.local:11434', 'http://app.localhost']) assert.equal(L.isLocalHost(u), true, u);
  for (const u of ['https://api.openai.com/v1', 'http://172.32.0.1', 'http://8.8.8.8', 'http://192.169.1.1', 'not a url', '', 'http://localhost.evil.com']) assert.equal(L.isLocalHost(u), false, u);
  assert.equal(L.isLoopbackHost('http://localhost:11434'), true);
  assert.equal(L.isLoopbackHost('http://127.0.0.9'), true);
  assert.equal(L.isLoopbackHost('http://192.168.1.20'), false);
  assert.equal(L.isLoopbackHost('http://nas.local'), false);
});

const tags = [
  { name: 'qwen3:8b', model: 'qwen3:8b', size: 5_200_000_000, digest: 'abc' },
  { name: 'llama3.2:latest', model: 'llama3.2:latest', size: 2_000_000_000, digest: 'def' },
  { name: 'proxy:1', model: 'proxy:1', size: 400, digest: 'x', remote_host: 'https://ollama.com' },
  { name: 'stub:1', size: 0, digest: 'y' },
  { name: 'nodigest:1', size: 10 },
];

test('a model is local only when the server shows real weights and nothing remote', () => {
  assert.equal(L.verdict(tags, 'qwen3:8b').kind, 'local');
  assert.equal(L.verdict(tags, 'QWEN3:8B').kind, 'local');
  assert.equal(L.verdict(tags, 'llama3.2').kind, 'local', ':latest is implied');
  assert.equal(L.verdict(tags, 'proxy:1').kind, 'cloud');
  assert.equal(L.verdict(tags, 'stub:1').kind, 'cloud');
  assert.equal(L.verdict(tags, 'nodigest:1').kind, 'unverified');
  assert.equal(L.verdict(tags, 'missing:1').kind, 'unverified');
  assert.equal(L.verdict(tags, 'gpt-oss:120b-cloud').kind, 'cloud');
  assert.equal(L.verdict(null, 'qwen3:8b').kind, 'unverified');
  assert.equal(L.verdict([null, 5, {}], 'qwen3:8b').kind, 'unverified');
});

test('badges are for display', () => {
  assert.equal(L.badge('ollama', 'qwen3:8b', L.verdict(tags, 'qwen3:8b')), 'Local');
  assert.equal(L.badge('ollama', 'qwen3:8b', null), 'Unverified');
  assert.equal(L.badge('ollama', 'x-cloud', { kind: 'local' }), 'Cloud');
  assert.equal(L.badge('ollama', 'proxy:1', L.verdict(tags, 'proxy:1')), 'Cloud');
  assert.equal(L.badge('gemini', 'gemini-3.5-flash', null), 'Cloud');
});

test('Local first fails closed', () => {
  const g = (o) => L.guard({ provider: 'ollama', providerName: 'Ollama', model: 'qwen3:8b', allowCloud: false, v: null, ...o });
  assert.equal(g({ v: L.verdict(tags, 'qwen3:8b') }).ok, true);
  assert.equal(g({}).ok, false, 'no model list means no request');
  assert.match(g({}).why, /Nothing was sent/);
  assert.equal(g({ model: 'missing:1', v: L.verdict(tags, 'missing:1') }).ok, false);
  assert.equal(g({ model: 'proxy:1', v: L.verdict(tags, 'proxy:1') }).ok, false);
  const cloud = g({ provider: 'gemini', providerName: 'Google Gemini', model: 'gemini-3.5-flash' });
  assert.equal(cloud.ok, false);
  assert.match(cloud.why, /Google Gemini is a cloud provider/);
  assert.equal(g({ provider: 'hosted', v: { kind: 'local' } }).ok, false, 'a cloud provider is refused whatever else is passed');
  assert.equal(g({ provider: 'gemini', allowCloud: true }).ok, true);
  assert.equal(g({ allowCloud: true }).ok, true);
});

const u = (text) => ({ role: 'user', text }), a = (text) => ({ role: 'assistant', text });

test('Regenerate asks the last question again', () => {
  assert.deepEqual(L.regeneration([u('one'), a('1'), u('two'), a('2')]), { history: [u('one'), a('1')], question: 'two' });
  assert.deepEqual(L.regeneration([u('one'), a('x'), a('y')]), { history: [], question: 'one' });
  assert.deepEqual(L.regeneration([u('one')]), { history: [], question: 'one' });
  assert.equal(L.regeneration([]), null);
  assert.equal(L.regeneration([a('hello')]), null);
  assert.equal(L.regeneration([u('   '), a('x')]), null);
  const turns = [u('q'), a('r')];
  L.regeneration(turns);
  assert.equal(turns.length, 2, 'the chat itself is not changed');
});

test('a long chat is trimmed from the old end and never starts on a reply', () => {
  const turns = [u('aaaa'), a('bbbb'), u('cccc'), a('dddd'), u('eeee')];
  assert.deepEqual(L.trimmed(turns, 100), turns);
  assert.deepEqual(L.trimmed(turns, 12), [u('cccc'), a('dddd'), u('eeee')]);
  assert.deepEqual(L.trimmed(turns, 8), [u('eeee')], 'a leading reply is dropped');
  assert.deepEqual(L.trimmed(turns, 1), [u('eeee')], 'the last turn always stays');
  assert.deepEqual(L.trimmed([], 10), []);
  assert.equal(L.contextBudget(null), 24000);
  assert.equal(L.contextBudget(8000), 24000);
  assert.equal(L.contextBudget(100), 2000);
});

test('what is read aloud has no Markdown', () => {
  assert.equal(L.spokenText('# Title\n\n**Bold** and `code` and [a link](https://x.y)\n\n- one\n- two'), 'Title\nBold and code and a link\none\ntwo');
  assert.equal(L.spokenText('Run this:\n```js\nlet x = 1\n```\nDone.'), 'Run this:\n (code omitted) \nDone.');
  assert.equal(L.spokenText('See https://example.com/page now'), 'See a link now');
  assert.equal(L.spokenText(''), '');
});

test('speech is cut into sentence groups', () => {
  assert.deepEqual(L.chunks('One. Two! Three?', 220), ['One. Two! Three?']);
  assert.deepEqual(L.chunks('One. Two! Three?', 10), ['One. Two!', 'Three?']);
  assert.deepEqual(L.chunks('', 50), []);
  assert.deepEqual(L.chunks('   \n  ', 50), []);
  const long = L.chunks('word '.repeat(80).trim() + '.', 50);
  assert.ok(long.length > 5);
  for (const c of long) assert.ok(c.length <= 50, c);
  assert.equal(long.join(' ').replace(/\s+/g, ' '), 'word '.repeat(80).trim() + '.');
  const commas = L.chunks('alpha beta, gamma delta, epsilon zeta eta theta.', 26);
  assert.equal(commas[0], 'alpha beta, gamma delta,', 'a long sentence is cut at a comma when there is one');
});

test('the voice states follow the Mac', () => {
  const run = (events, from = 'idle') => events.reduce((s, e) => (Array.isArray(e) ? L.nextVoiceState(s, e[0], e[1]) : L.nextVoiceState(s, e)), from);
  assert.equal(run(['startListening']), 'listening');
  assert.equal(run(['startListening', 'heardWords']), 'transcribing');
  assert.equal(run(['startListening', 'heardWords', 'speechEnded']), 'thinking');
  assert.equal(run(['startListening', 'heardWords', 'speechEnded', ['aiReplied', true]]), 'speaking');
  assert.equal(run(['startListening', 'heardWords', 'speechEnded', ['aiReplied', true], 'speakingFinished']), 'idle');
  assert.equal(run([['aiReplied', false]], 'thinking'), 'idle');
  assert.equal(run(['toolsRunning'], 'thinking'), 'executing');
  assert.equal(run([['aiReplied', false]], 'executing'), 'idle');
  assert.equal(run(['startListening'], 'speaking'), 'interrupted', 'talking over a spoken answer interrupts it');
  assert.equal(run(['interrupt'], 'speaking'), 'interrupted');
  assert.equal(run(['heardWords'], 'interrupted'), 'transcribing');
  assert.equal(run(['cancelled'], 'listening'), 'idle');
  assert.equal(run(['failed'], 'thinking'), 'error');
  assert.equal(run(['startListening'], 'error'), 'listening');
  assert.equal(run(['reset'], 'speaking'), 'idle');
  assert.equal(run(['heardWords'], 'idle'), 'idle', 'an event that does not apply changes nothing');
  assert.equal(run(['speakingStarted'], 'idle'), 'speaking');
});
