import test from 'node:test';
import assert from 'node:assert/strict';
import { title, labels, environment, body, issueUrl, isReady, MAX_DESCRIPTION } from '../src/js/modules/reportlogic.js';

const info = { platform: 'Windows', version: '2.2.61', tier: 'Pro', system: 'Windows 11' };

test('the title names the platform, plan and kind, from the first line', () => {
  assert.equal(title('bug', 'Windows', 'Pro', 'Notch closes when I click\nmore'), '[Windows][Pro] Bug: Notch closes when I click');
  assert.equal(title('idea', 'Mac', 'Free', ''), '[Mac][Free] Idea: (no summary)');
  assert.ok(title('question', 'Windows', 'Ultimate', 'x'.repeat(200)).endsWith('…'));
});
test('labels use the repository\'s own', () => {
  assert.equal(labels('bug', 'Windows'), 'bug,windows');
  assert.equal(labels('idea', 'Mac'), 'enhancement,mac');
  assert.equal(labels('question', 'Windows'), 'question,windows');
});
test('the body carries the install lines and nothing else', () => {
  const b = body('It crashed', environment(info));
  assert.ok(b.includes('**Details**\nIt crashed'));
  for (const line of ['- Platform: Windows', '- Notch Apple version: 2.2.61', '- Plan: Pro', '- System: Windows 11']) assert.ok(b.includes(line), line);
  assert.ok(body('  ', []).includes('(nothing written)'));
  assert.ok(body('a'.repeat(MAX_DESCRIPTION + 5000), []).includes('(cut: it was very long)'));
});
test('the issue address is the project\'s, encoded, and a sane length', () => {
  const u = new URL(issueUrl('bug', info, 'a & b? #1'));
  assert.equal(u.origin + u.pathname, 'https://github.com/AdityaJainDXB/NotchApples/issues/new');
  assert.equal(u.searchParams.get('labels'), 'bug,windows');
  assert.ok(u.searchParams.get('body').includes('a & b? #1'));
  assert.ok(u.searchParams.get('title').startsWith('[Windows][Pro] Bug:'));
  assert.ok(issueUrl('bug', info, 'word '.repeat(5000)).length < 14000);
});
test('a report needs a few words', () => { assert.equal(isReady('  short '), false); assert.equal(isReady('The notch closes when I click'), true); });
