import test from 'node:test';
import assert from 'node:assert/strict';
import { report, autoFix, isUniform, verdict } from '../src/js/services/aitells.js';
import { userMessage, editMessage, clean, SYSTEM } from '../src/js/services/humanizerlogic.js';

// The Swift tests (AITellCheckerTests) are the specification.
const robot = 'Nestled in the heart of Dubai, our studio serves as a vibrant hub, showcasing a rich tapestry of designs. Additionally, it plays a pivotal role in the community — a testament to its legacy. Certainly! I hope this helps.';
const human = "We're a small 3D printing shop in Dubai. We print custom parts, gifts and prototypes. Most orders ship within a week, and if one is late we tell you why.";

test('robot text scores high and human text low', () => {
  assert.ok(report(robot).score > 40);
  assert.ok(report(human).score < 15);
  assert.ok(report(robot).total > report(human).total);
  assert.equal(report('').score, 0);
});

test('finds the tells by name', () => {
  const labels = new Set(report(robot).tells.map((t) => t.label));
  for (const l of ['AI vocabulary', 'Promotional words', 'Puffed-up importance', 'Chatbot leftovers']) assert.ok(labels.has(l), l);
  assert.ok(report("It is not just a tool, it's a way of life.").tells.some((t) => t.label === 'Negative parallelism'));
  assert.ok(report('One. Two — three — four — five.').tells.some((t) => t.label === 'Em dashes' && t.count === 2));
  assert.ok(!report('One dash — is fine.').tells.some((t) => t.label === 'Em dashes'));
});

test('safe fixes', () => {
  assert.equal(autoFix('It serves as a hub and boasts two rooms.'), 'It is a hub and has two rooms.');
  assert.equal(autoFix('We’re “open”.'), 'We\'re "open".');
  assert.equal(autoFix('Here is **the** point.'), 'Here is the point.');
  assert.equal(autoFix('It works. Additionally, it is cheap.'), 'It works. It is cheap.');
  assert.equal(autoFix('A — B — C — D'), 'A — B, C, D');
  assert.equal(autoFix('Certainly! Here you go.'), 'Here you go.');
  assert.ok(report(autoFix(robot)).total < report(robot).total);
});

test('uniform rhythm and verdicts', () => {
  assert.equal(isUniform([10, 11, 10, 9, 10, 11]), true);
  assert.equal(isUniform([3, 22, 7, 14, 5, 30]), false);
  assert.equal(isUniform([10, 10]), false);
  assert.equal(verdict(5), 'Reads like a person');
  assert.equal(verdict(90), 'Reads like a chatbot');
});

test('prompts carry the style sample and examples', () => {
  assert.match(userMessage('abc', 'my own words'), /my own words/);
  assert.doesNotMatch(userMessage('abc'), /STYLE/);
  assert.match(editMessage('draft', 'Em dashes (2)'), /Em dashes \(2\)/);
  assert.equal(clean('<<<TEXT\n Hi.\nTEXT>>>'), 'Hi.');
  assert.match(SYSTEM, /Examples of the change/);
});
