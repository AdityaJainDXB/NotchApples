import test from 'node:test';
import assert from 'node:assert/strict';
import { decide } from './triage-issues.mjs';

const day = 86_400_000, now = new Date('2026-11-10T00:00:00Z');
const ago = (d) => new Date(now - d * day).toISOString();
const bot = (stage, d) => ({ user: { login: 'github-actions[bot]', type: 'Bot' }, body: `text\n\n<!-- weekly-triage:${stage} -->`, created_at: ago(d) });
const person = (d) => ({ user: { login: 'someone', type: 'User' }, body: 'hello', created_at: ago(d) });

test('a new issue is attempted', () => assert.equal(decide({}, [], now).action, 'attempt'));
test('a person talking without a bot marker is still attempted', () => assert.equal(decide({}, [person(3)], now).action, 'attempt'));
test('after asking, it waits for the first cycle', () => assert.equal(decide({}, [bot('asked', 3)], now).action, 'wait'));
test('after one quiet cycle it assumes', () => assert.equal(decide({}, [bot('asked', 8)], now).action, 'assume'));
test('a reply after asking sends it back to attempt', () => assert.equal(decide({}, [bot('asked', 8), person(2)], now).action, 'attempt'));
test('after assuming it waits two cycles', () => {
  assert.equal(decide({}, [bot('assumed', 8)], now).action, 'wait');
  assert.equal(decide({}, [bot('assumed', 15)], now).action, 'close');
});
test('a reply after assuming reopens the conversation', () => assert.equal(decide({}, [bot('assumed', 20), person(1)], now).action, 'attempt'));
test('only the newest marker counts', () => assert.equal(decide({}, [bot('asked', 30), person(25), bot('assumed', 3)], now).action, 'wait'));
