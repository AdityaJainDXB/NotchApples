// The calculator's algebra, mirrored from the Mac app's MathEngineTests. Run: node --test NotchWindows/tests
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadModule } from './load.mjs';

const M = await loadModule('services/mathengine.js');
const last = (...lines) => { const s = new M.MathSession(); let out = []; for (const l of lines) out = out.concat(s.run(l)); return out.at(-1)?.output.join(' | ') ?? ''; };
const run = (...lines) => { const s = new M.MathSession(); return lines.flatMap((l) => s.run(l)); };

test('brackets, powers and implicit multiplication', () => {
  assert.equal(last('2(3+4)^2 / 7'), '14');
  assert.equal(last('2^3^2'), '512');
  assert.equal(last('-2^2'), '-4');
  assert.equal(last('3 * -2'), '-6');
});

test('functions, constants, percent and factorial', () => {
  assert.equal(last('sqrt(16) + abs(-3)'), '7');
  assert.equal(last('5!'), '120');
  assert.equal(last('50%'), '0.5');
  assert.equal(last('sin(pi/2)'), '1');
  assert.equal(last('0.1 + 0.2'), '0.3');
});

test('errors are sentences', () => {
  assert.equal(run('1/0')[0].kind, 'error');
  assert.equal(run('sqrt(-1)')[0].kind, 'error');
  assert.equal(run('2 +')[0].kind, 'error');
});

test('variables and ans carry over', () => {
  assert.equal(last('a = 12', 'b = a * 2', 'a + b'), '36');
  assert.equal(last('2 + 3', 'ans * 4'), '20');
});

test('user functions', () => {
  assert.equal(last('f(x) = x^2 + 1', 'f(3)'), '10');
  assert.equal(last('f(x) = 2x', 'g(x) = f(x) + 1', 'g(5)'), '11');
});

test('linear equations', () => {
  assert.equal(last('2x + 3 = 11'), 'x = 4');
  assert.equal(last('3x - 1 = x + 6'), 'x = 7/2');
});

test('quadratics: rational roots, surds, complex', () => {
  assert.equal(last('x^2 - 5x + 6 = 0'), 'x = 2 | x = 3');
  assert.ok(last('x^2 + 3x + 1 = 0').startsWith('x = (-3 ± √5)/2'), last('x^2 + 3x + 1 = 0'));
  assert.ok(last('x^2 + 1 = 0').includes('i'));
});

test('a cubic, numerically', () => {
  const out = last('x^3 - 6x^2 + 11x - 6 = 0');
  assert.ok(out.includes('x = 1') && out.includes('x = 2') && out.includes('x = 3'), out);
});

test('solve for one letter and keep the others', () => {
  assert.equal(last('solve(a x + b = c, x)'), 'x = (-b + c)/(a)');
  assert.equal(last('solve(2y + 6 = x, y)'), 'y = (1/2)x - 3');
});

test('an equation with a function is solved numerically', () => {
  assert.ok(last('2^x = 8').includes('x ≈ 3'), last('2^x = 8'));
});

test('systems of linear equations', () => {
  assert.equal(last('x + y = 5; x - y = 1'), 'x = 3 | y = 2');
  assert.equal(run('x + y = 5; x^2 = 1')[0].kind, 'error');
});

test('expand and simplify', () => {
  assert.equal(last('expand((x+1)^3)'), 'x^3 + 3x^2 + 3x + 1');
  assert.equal(last('(a+b)^2'), 'a^2 + 2ab + b^2');
  assert.equal(last('simplify(2x + 3x - x)'), '4x');
});

test('factor', () => {
  assert.equal(last('factor(x^2 - 5x + 6)'), '(x - 2)(x - 3)');
  assert.equal(last('factor(2x^2 + 5x + 2)'), '(2x + 1)(x + 2)');
  assert.equal(last('factor(x^3 - x)'), 'x(x - 1)(x + 1)');
});

test('derivatives', () => {
  assert.equal(last('diff(x^3 + 2x, x)'), '3x^2 + 2');
  assert.equal(last('diff(sin(x), x)'), 'cos(x)');
  assert.equal(last('diff(x^2 y, y)'), 'x^2');
});

test('two letters and one equation is an error', () => {
  assert.equal(run('x + y = 5')[0].kind, 'error');
});

test('a solved-for letter ignores a value it was given earlier', () => {
  assert.equal(last('x = 5', 'solve(2x + 3 = 11, x)'), 'x = 4');
  assert.ok(last('x = 5', '2x + 3 = 11').startsWith('False'));
});
