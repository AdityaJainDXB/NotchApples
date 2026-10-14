import test from 'node:test';
import assert from 'node:assert/strict';
import { decide, decideDiscussion, kindOf } from './triage-issues.mjs';
process.env.GITHUB_REPOSITORY = 'AdityaJainDXB/NotchApples';

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

const owned = (stage, d) => ({ user: { login: 'AdityaJainDXB', type: 'User' }, body: `text\n\n<!-- weekly-triage:${stage} -->`, created_at: ago(d) });
test('the routine running as the owner is recognised by its marker', () => {
  assert.equal(decide({}, [owned('asked', 3)], now).action, 'wait');
  assert.equal(decide({}, [owned('asked', 8)], now).action, 'assume');
});
test('a stranger pasting the marker cannot move an issue along', () => {
  const forged = { user: { login: 'stranger', type: 'User' }, body: 'x <!-- weekly-triage:assumed -->', created_at: ago(20) };
  assert.equal(decide({}, [forged], now).action, 'attempt');
});
test('issue forms map to kinds by their labels', () => {
  assert.equal(kindOf([{ name: 'enhancement' }]), 'feature');
  assert.equal(kindOf(['bug', 'mac']), 'problem');
  assert.equal(kindOf(['bug', 'flight-sim']), 'problem');
  assert.equal(kindOf(['question']), 'help');
  assert.equal(kindOf(['from-feedback']), 'feedback');
  assert.equal(kindOf([]), 'other');
});
const disc = (category, comments = [], extra = {}) => ({ category: { name: category }, comments: { nodes: comments }, ...extra });
const dc = (login, d, body = 'hi') => ({ author: { login }, createdAt: ago(d), body });
test('discussions: questions and ideas get one reply; show and tell and polls are left alone', () => {
  assert.equal(decideDiscussion(disc('Q&A'), now).action, 'reply');
  assert.equal(decideDiscussion(disc('Ideas'), now).action, 'reply');
  assert.equal(decideDiscussion(disc('Show and tell'), now).action, 'skip');
  assert.equal(decideDiscussion(disc('Polls'), now).action, 'skip');
  assert.equal(decideDiscussion(disc('Q&A', [], { answer: { id: 'x' } }), now).action, 'skip');
  assert.equal(decideDiscussion(disc('General', [], { closed: true }), now).action, 'skip');
});
test('discussions: after the routine replied it waits, until a person writes again', () => {
  const mine = dc('AdityaJainDXB', 5, 'answer <!-- weekly-triage:discussion -->');
  assert.equal(decideDiscussion(disc('Q&A', [mine]), now).action, 'wait');
  assert.equal(decideDiscussion(disc('Q&A', [mine, dc('someone', 2)]), now).action, 'reply');
});
