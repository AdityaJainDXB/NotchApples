// The calculator's brain, ported from the Mac app's MathEngine: multi-step expressions, variables, equations and
// algebra, all on this PC. No DOM and no network, so it is tested with Node (tests/mathengine.test.mjs).
//
//   2(3+4)^2 / 7            numbers with brackets, powers, %, !, sqrt, sin, cos, ln, log, abs ...
//   a = 12                  remember a value; later lines can use it (and "ans", the last result)
//   f(x) = x^2 + 1          define a function, then f(3)
//   2x + 3 = 11             solve an equation (one unknown): x = 4
//   x^2 - 5x + 6 = 0        quadratics: exact answers, complex roots, higher degrees numerically
//   x + y = 5; x - y = 1    a system of linear equations
//   solve(a x + b = c, x)   solve for one letter and keep the others as letters
//   expand((x+1)^3)         multiply out and collect like terms
//   factor(x^2 - 5x + 6)    split into factors using rational roots
//   diff(x^3 + 2x, x)       derivative

export class MathError extends Error {}

const CONSTS = { pi: Math.PI, tau: 2 * Math.PI, e: Math.E };
const ONE_ARG = new Set(['sqrt', 'sin', 'cos', 'tan', 'asin', 'acos', 'atan', 'ln', 'log', 'exp', 'abs', 'floor', 'ceil', 'round', 'sinh', 'cosh', 'tanh', 'cbrt']);
const RESERVED = new Set([...ONE_ARG, 'solve', 'expand', 'simplify', 'factor', 'diff']);

function applyFn(name, x) {
  switch (name) {
    case 'sqrt': return x < 0 ? null : Math.sqrt(x);
    case 'cbrt': return Math.cbrt(x);
    case 'sin': return Math.sin(x); case 'cos': return Math.cos(x); case 'tan': return Math.tan(x);
    case 'asin': return Math.abs(x) > 1 ? null : Math.asin(x);
    case 'acos': return Math.abs(x) > 1 ? null : Math.acos(x);
    case 'atan': return Math.atan(x);
    case 'sinh': return Math.sinh(x); case 'cosh': return Math.cosh(x); case 'tanh': return Math.tanh(x);
    case 'ln': return x <= 0 ? null : Math.log(x);
    case 'log': return x <= 0 ? null : Math.log10(x);
    case 'exp': return Math.exp(x);
    case 'abs': return Math.abs(x);
    case 'floor': return Math.floor(x); case 'ceil': return Math.ceil(x); case 'round': return Math.round(x);
    default: return null;
  }
}

// ---------- expressions: {t:'num',v} {t:'sym',n} {t:'add',a,b} {t:'mul',a,b} {t:'pow',a,b} {t:'neg',a} {t:'call',n,args}
const num = (v) => ({ t: 'num', v });
const sym = (n) => ({ t: 'sym', n });
const add = (a, b) => ({ t: 'add', a, b });
const mul = (a, b) => ({ t: 'mul', a, b });
const pow = (a, b) => ({ t: 'pow', a, b });
const neg = (a) => ({ t: 'neg', a });
const call = (n, args) => ({ t: 'call', n, args });

// ---------- parser
function lex(text) {
  const s = [...text.replaceAll('×', '*').replaceAll('÷', '/').replaceAll('−', '-').replaceAll('²', '^2').replaceAll('³', '^3')];
  const out = [];
  let k = 0;
  const isDigit = (c) => c >= '0' && c <= '9';
  const isLetter = (c) => /\p{L}/u.test(c);
  while (k < s.length) {
    const ch = s[k];
    if (/\s/.test(ch)) { k++; continue; }
    if (isDigit(ch) || (ch === '.' && k + 1 < s.length && isDigit(s[k + 1]))) {
      let j = k;
      while (j < s.length && (isDigit(s[j]) || s[j] === '.')) j++;
      if (j < s.length && (s[j] === 'e' || s[j] === 'E')) { // 1e5, 2.5e-3 (only when digits follow, so "2e" stays 2*e)
        let m = j + 1;
        if (m < s.length && (s[m] === '-' || s[m] === '+')) m++;
        if (m < s.length && isDigit(s[m])) { while (m < s.length && isDigit(s[m])) m++; j = m; }
      }
      const v = Number(s.slice(k, j).join(''));
      if (!Number.isFinite(v)) throw new MathError(`Bad number ${s.slice(k, j).join('')}`);
      out.push({ k: 'num', v }); k = j; continue;
    }
    if (isLetter(ch)) {
      let j = k;
      while (j < s.length && isLetter(s[j])) j++;
      out.push({ k: 'id', v: s.slice(k, j).join('') }); k = j; continue;
    }
    if ('+-*/^()=,%!;'.includes(ch)) {
      if (ch === '*' && s[k + 1] === '*') { out.push({ k: 'op', v: '^' }); k += 2; continue; }
      out.push({ k: 'op', v: ch }); k++; continue;
    }
    throw new MathError(`Unexpected “${ch}”`);
  }
  out.push({ k: 'end' });
  return out;
}

class Parser {
  constructor(text, knownNames = new Set(), functionNames = new Set()) {
    this.toks = lex(text); this.i = 0; this.known = knownNames; this.fns = functionNames;
  }
  get peek() { return this.toks[this.i]; }
  next() { const t = this.toks[this.i]; if (this.i < this.toks.length - 1) this.i++; return t; }
  isOp(c) { const p = this.peek; return p.k === 'op' && p.v === c; }
  describe(t) { return t.k === 'end' ? 'end of input' : t.k === 'op' ? `“${t.v}”` : String(t.v); }
  startsFactor(t) { return t.k === 'num' || t.k === 'id' || (t.k === 'op' && t.v === '('); }

  parse() {
    const e = this.expression();
    if (this.peek.k !== 'end') throw new MathError(`Unexpected ${this.describe(this.peek)}`);
    return e;
  }
  expression() {
    let left = this.term();
    while (this.isOp('+') || this.isOp('-')) {
      const c = this.next().v;
      const right = this.term();
      left = c === '+' ? add(left, right) : add(left, neg(right));
    }
    return left;
  }
  term() {
    let left = this.unary();
    for (;;) {
      if (this.isOp('*') || this.isOp('/')) {
        const c = this.next().v;
        const right = this.unary();
        left = c === '*' ? mul(left, right) : mul(left, pow(right, num(-1)));
      } else if (this.startsFactor(this.peek)) {
        left = mul(left, this.unary());          // implicit multiplication: 2x, 3(x+1), (a+b)(c+d), 2 sin(x)
      } else break;
    }
    return left;
  }
  unary() {
    if (this.isOp('-') || this.isOp('+')) {
      const c = this.next().v;
      const inner = this.unary();
      return c === '-' ? neg(inner) : inner;
    }
    return this.power();
  }
  power() {
    const base = this.postfix();
    if (this.isOp('^')) { this.next(); return pow(base, this.unary()); } // right-associative; the exponent may be negative
    return base;
  }
  postfix() {
    let e = this.atom();
    while (this.isOp('%') || this.isOp('!')) {
      const c = this.next().v;
      e = c === '%' ? mul(e, num(0.01)) : call('fact', [e]);
    }
    return e;
  }
  atom() {
    const t = this.next();
    if (t.k === 'num') return num(t.v);
    if (t.k === 'op' && t.v === '(') {
      const e = this.expression();
      const close = this.next();
      if (!(close.k === 'op' && close.v === ')')) throw new MathError('Missing a closing bracket');
      return e;
    }
    if (t.k === 'id') {
      const name = t.v, lower = name.toLowerCase();
      if (this.isOp('(') && (RESERVED.has(lower) || this.fns.has(name))) {
        this.next();
        const args = [];
        if (this.isOp(')')) this.next();
        else {
          for (;;) {
            args.push(this.expression());
            if (this.isOp(',')) { this.next(); continue; }
            const close = this.next();
            if (!(close.k === 'op' && close.v === ')')) throw new MathError('Missing a closing bracket');
            break;
          }
        }
        return call(RESERVED.has(lower) ? lower : name, args);
      }
      if (lower in CONSTS || name === 'π') return sym(name === 'π' ? 'pi' : lower);
      if (this.known.has(name) || [...name].length === 1) return sym(name);
      // "xy" → x·y, "ab" → a·b (school-style algebra), unless it's a name we know.
      const letters = [...name].map((c) => sym(c));
      return letters.slice(1).reduce((a, b) => mul(a, b), letters[0]);
    }
    throw new MathError(`Unexpected ${this.describe(t)}`);
  }
}

export function parse(text, known = new Set(), fns = new Set()) { return new Parser(text, known, fns).parse(); }

// ---------- numeric evaluation
export function value(e, vars = {}, fns = {}) {
  switch (e.t) {
    case 'num': return e.v;
    case 'sym':
      if (e.n in vars) return vars[e.n];
      if (e.n in CONSTS) return CONSTS[e.n];
      throw new MathError(`“${e.n}” has no value yet`);
    case 'add': return value(e.a, vars, fns) + value(e.b, vars, fns);
    case 'mul': return value(e.a, vars, fns) * value(e.b, vars, fns);
    case 'neg': return -value(e.a, vars, fns);
    case 'pow': {
      const x = value(e.a, vars, fns), y = value(e.b, vars, fns);
      const r = x ** y;
      if (!Number.isFinite(r) && x === 0) throw new MathError("Can't divide by zero");
      if (Number.isNaN(r)) throw new MathError('That has no real value');
      return r;
    }
    case 'call': {
      if (e.n === 'fact') {
        const n = value(e.args[0], vars, fns);
        if (!(n >= 0 && n === Math.round(n) && n <= 170)) throw new MathError('Factorial needs a whole number from 0 to 170');
        let r = 1; for (let i = 2; i <= n; i++) r *= i; return r;
      }
      if (fns[e.n] && e.args.length === 1) {
        const inner = { ...vars, [fns[e.n].param]: value(e.args[0], vars, fns) };
        return value(fns[e.n].body, inner, fns);
      }
      if (e.args.length !== 1) throw new MathError(`${e.n} takes one value`);
      const x = value(e.args[0], vars, fns);
      const r = applyFn(e.n, x);
      if (r === null) throw new MathError(`${e.n}(${number(x)}) has no real value`);
      return r;
    }
    default: throw new MathError('That didn’t work');
  }
}

export function freeSymbols(e, fns = {}) {
  switch (e.t) {
    case 'num': return new Set();
    case 'sym': return e.n in CONSTS ? new Set() : new Set([e.n]);
    case 'add': case 'mul': case 'pow': return new Set([...freeSymbols(e.a, fns), ...freeSymbols(e.b, fns)]);
    case 'neg': return freeSymbols(e.a, fns);
    case 'call': {
      const s = new Set(e.args.flatMap((a) => [...freeSymbols(a, fns)]));
      if (fns[e.n]) for (const x of freeSymbols(fns[e.n].body, fns)) if (x !== fns[e.n].param) s.add(x);
      return s;
    }
    default: return new Set();
  }
}

function substitute(e, name, withExpr) {
  switch (e.t) {
    case 'num': return e;
    case 'sym': return e.n === name ? withExpr : e;
    case 'add': return add(substitute(e.a, name, withExpr), substitute(e.b, name, withExpr));
    case 'mul': return mul(substitute(e.a, name, withExpr), substitute(e.b, name, withExpr));
    case 'pow': return pow(substitute(e.a, name, withExpr), substitute(e.b, name, withExpr));
    case 'neg': return neg(substitute(e.a, name, withExpr));
    case 'call': return call(e.n, e.args.map((a) => substitute(a, name, withExpr)));
    default: return e;
  }
}

/// Replaces calls to user functions by their bodies, and known values by numbers.
function inline(e, vars, fns) {
  switch (e.t) {
    case 'num': return e;
    case 'sym': return e.n in vars ? num(vars[e.n]) : e;
    case 'add': return add(inline(e.a, vars, fns), inline(e.b, vars, fns));
    case 'mul': return mul(inline(e.a, vars, fns), inline(e.b, vars, fns));
    case 'pow': return pow(inline(e.a, vars, fns), inline(e.b, vars, fns));
    case 'neg': return neg(inline(e.a, vars, fns));
    case 'call': {
      const a = e.args.map((x) => inline(x, vars, fns));
      if (fns[e.n] && a.length === 1) return inline(substitute(fns[e.n].body, fns[e.n].param, a[0]), vars, fns);
      return call(e.n, a);
    }
    default: return e;
  }
}

// ---------- polynomials
const monoKey = (powers) => Object.entries(powers).filter(([, p]) => p > 0).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)).map(([v, p]) => `${v}^${p}`).join('*');
const monoDegree = (powers) => Object.values(powers).reduce((a, b) => a + b, 0);

export class Poly {
  constructor(terms = new Map()) { this.terms = terms; }          // key → { powers, c }
  static constant(c) { return c === 0 ? new Poly() : new Poly(new Map([['', { powers: {}, c }]])); }
  static variable(v) { return new Poly(new Map([[`${v}^1`, { powers: { [v]: 1 }, c: 1 }]])); }
  get isZero() { return this.terms.size === 0; }
  get constantValue() {
    if (this.terms.size === 0) return 0;
    if (this.terms.size === 1 && this.terms.has('')) return this.terms.get('').c;
    return null;
  }
  variables() { const s = new Set(); for (const { powers } of this.terms.values()) for (const v of Object.keys(powers)) s.add(v); return s; }
  degreeIn(v) { let d = 0; for (const { powers } of this.terms.values()) d = Math.max(d, powers[v] || 0); return d; }
  plus(o) {
    const t = new Map([...this.terms].map(([k, x]) => [k, { powers: x.powers, c: x.c }]));
    for (const [k, x] of o.terms) {
      const cur = t.get(k);
      const c = (cur ? cur.c : 0) + x.c;
      if (Math.abs(c) < 1e-12) t.delete(k); else t.set(k, { powers: x.powers, c });
    }
    return new Poly(t);
  }
  negated() { return new Poly(new Map([...this.terms].map(([k, x]) => [k, { powers: x.powers, c: -x.c }]))); }
  minus(o) { return this.plus(o.negated()); }
  times(o) {
    const t = new Map();
    for (const a of this.terms.values()) for (const b of o.terms.values()) {
      const powers = { ...a.powers };
      for (const [v, p] of Object.entries(b.powers)) powers[v] = (powers[v] || 0) + p;
      const k = monoKey(powers);
      t.set(k, { powers, c: (t.get(k)?.c || 0) + a.c * b.c });
    }
    for (const [k, x] of t) if (Math.abs(x.c) <= 1e-12) t.delete(k);
    return new Poly(t);
  }
  scaled(k) { return k === 0 ? new Poly() : new Poly(new Map([...this.terms].map(([key, x]) => [key, { powers: x.powers, c: x.c * k }]))); }
  power(n) { let r = Poly.constant(1); for (let i = 0; i < n; i++) r = r.times(this); return r; }
  /// The part that multiplies v^k, with v taken out.
  coefficient(v, k) {
    const t = new Map();
    for (const x of this.terms.values()) {
      if ((x.powers[v] || 0) !== k) continue;
      const powers = { ...x.powers }; delete powers[v];
      const key = monoKey(powers);
      t.set(key, { powers, c: (t.get(key)?.c || 0) + x.c });
    }
    return new Poly(t);
  }

  /// Expression → polynomial, or null when it has division by a letter, functions of letters, and so on.
  static from(e) {
    switch (e.t) {
      case 'num': return Poly.constant(e.v);
      case 'sym': return e.n in CONSTS ? Poly.constant(CONSTS[e.n]) : Poly.variable(e.n);
      case 'add': { const x = Poly.from(e.a), y = Poly.from(e.b); return x && y ? x.plus(y) : null; }
      case 'neg': { const x = Poly.from(e.a); return x ? x.negated() : null; }
      case 'mul': { const x = Poly.from(e.a), y = Poly.from(e.b); return x && y ? x.times(y) : null; }
      case 'pow': {
        const base = Poly.from(e.a), ex = Poly.from(e.b)?.constantValue;
        if (!base || ex === null || ex === undefined) return null;
        if (ex >= 0 && ex === Math.round(ex) && ex <= 64) return base.power(ex);
        const c = base.constantValue;
        if (c !== null && c !== 0) return Poly.constant(c ** ex);
        return null;
      }
      case 'call': {
        if (e.args.length === 1) {
          const c = Poly.from(e.args[0])?.constantValue;
          if (c !== null && c !== undefined) {
            if (e.n === 'fact') { try { return Poly.constant(value(e)); } catch { return null; } }
            const r = applyFn(e.n, c);
            return r === null ? null : Poly.constant(r);
          }
        }
        return null;
      }
      default: return null;
    }
  }
}

// ---------- formatting
export function rational(x) {
  if (!(Math.abs(x) < 1e9)) return null;
  for (let q = 1; q <= 1000; q++) {
    const p = Math.round(x * q);
    if (Math.abs(p / q - x) < 1e-10 * Math.max(1, Math.abs(x))) return [p, q];
  }
  return null;
}

/// 3 · 0.5 · 1/3 · 2.718281828
export function number(x, fractions = true) {
  if (Number.isNaN(x)) return 'undefined';
  if (!Number.isFinite(x)) return x < 0 ? '-∞' : '∞';
  if (Math.abs(x) < 1e-12) return '0';
  if (Math.abs(x - Math.round(x)) < 1e-9 && Math.abs(x) < 1e15) return String(Math.round(x));
  if (fractions) { const r = rational(x); if (r && r[1] <= 1000) return `${r[0]}/${r[1]}`; }
  return String(Number(x.toPrecision(10)));
}

const coefText = (c) => { const r = rational(c); return r && r[1] !== 1 ? `${Math.abs(r[0])}/${r[1]}` : number(Math.abs(c)); };

export function formatPoly(p) {
  if (p.isZero) return '0';
  // Highest total degree first; ties go to the alphabetically first letter with the larger power (a² before ab).
  const letters = [...p.variables()].sort();
  const monos = [...p.terms.values()].sort((a, b) => {
    const da = monoDegree(a.powers), db = monoDegree(b.powers);
    if (da !== db) return db - da;
    for (const l of letters) { const x = a.powers[l] || 0, y = b.powers[l] || 0; if (x !== y) return y - x; }
    return 0;
  });
  let out = '';
  monos.forEach((m, n) => {
    const c = m.c;
    const vars = Object.entries(m.powers).sort(([a], [b]) => (a < b ? -1 : 1)).map(([v, pw]) => (pw === 1 ? v : `${v}^${pw}`)).join('');
    let body;
    if (!vars) body = coefText(c);
    else if (Math.abs(Math.abs(c) - 1) < 1e-12) body = vars;
    else body = coefText(c) + vars;
    if (vars && body.includes('/') && Math.abs(Math.abs(c) - 1) >= 1e-12) body = `(${coefText(c)})${vars}`;
    out += n === 0 ? (c < 0 ? '-' : '') + body : (c < 0 ? ' - ' : ' + ') + body;
  });
  return out;
}

export function formatExpr(e, parent = 0) {
  const wrap = (s, prec) => (prec < parent ? `(${s})` : s);
  switch (e.t) {
    case 'num': return e.v < 0 ? `(${number(e.v)})` : number(e.v);
    case 'sym': return e.n;
    case 'neg': return wrap(`-${formatExpr(e.a, 3)}`, 1);
    case 'add':
      if (e.b.t === 'neg') return wrap(`${formatExpr(e.a, 1)} - ${formatExpr(e.b.a, 2)}`, 1);
      return wrap(`${formatExpr(e.a, 1)} + ${formatExpr(e.b, 1)}`, 1);
    case 'mul':
      if (e.b.t === 'pow' && e.b.b.t === 'num' && e.b.b.v === -1) return wrap(`${formatExpr(e.a, 2)}/${formatExpr(e.b.a, 3)}`, 2);
      return wrap(`${formatExpr(e.a, 2)}·${formatExpr(e.b, 2)}`, 2);
    case 'pow':
      if (e.b.t === 'num' && e.b.v === -1) return wrap(`1/${formatExpr(e.a, 3)}`, 2);
      return wrap(`${formatExpr(e.a, 4)}^${formatExpr(e.b, 4)}`, 3);
    case 'call': return e.n === 'fact' ? `${formatExpr(e.args[0], 4)}!` : `${e.n}(${e.args.map((a) => formatExpr(a)).join(', ')})`;
    default: return '';
  }
}

// ---------- algebra
const gcd = (a, b) => (b === 0 ? Math.abs(a) : gcd(b, a % b));
const divisors = (n) => (n === 0 ? [1] : Array.from({ length: n }, (_, i) => i + 1).filter((d) => n % d === 0));

function simplifySqrt(n) {
  let k = 1, m = n, f = 2;
  while (f * f <= m) { while (m % (f * f) === 0) { m /= f * f; k *= f; } f++; }
  return [k, m];
}

/// Real and complex roots of a numeric polynomial (coefficients from the constant term up), by Durand–Kerner.
export function roots(coeffs) {
  const c = [...coeffs];
  while (c.length && Math.abs(c[c.length - 1]) < 1e-14) c.pop();
  const n = c.length - 1;
  if (n < 1) return [];
  const lead = c[c.length - 1];
  const a = c.map((x) => x / lead);
  const radius = 1 + Math.max(...a.slice(0, -1).map(Math.abs), 1);
  const z = Array.from({ length: n }, (_, k) => {
    const ang = (2 * Math.PI * k) / n + 0.4;
    return [radius * 0.5 * Math.cos(ang), radius * 0.5 * Math.sin(ang)];
  });
  const cmul = (p, q) => [p[0] * q[0] - p[1] * q[1], p[0] * q[1] + p[1] * q[0]];
  const cdiv = (p, q) => { const d = q[0] * q[0] + q[1] * q[1]; return d === 0 ? [0, 0] : [(p[0] * q[0] + p[1] * q[1]) / d, (p[1] * q[0] - p[0] * q[1]) / d]; };
  for (let iter = 0; iter < 500; iter++) {
    let delta = 0;
    for (let i = 0; i < n; i++) {
      let v = [a[n], 0];
      for (let k = n - 1; k >= 0; k--) { const t = cmul(v, z[i]); v = [t[0] + a[k], t[1]]; }
      let denom = [1, 0];
      for (let j = 0; j < n; j++) if (j !== i) denom = cmul(denom, [z[i][0] - z[j][0], z[i][1] - z[j][1]]);
      const step = cdiv(v, denom);
      z[i] = [z[i][0] - step[0], z[i][1] - step[1]];
      delta = Math.max(delta, Math.abs(step[0]) + Math.abs(step[1]));
    }
    if (delta < 1e-13) break;
  }
  return z.map(([re, im]) => ({ re: Math.abs(re) < 1e-9 ? 0 : re, im: Math.abs(im) < 1e-9 ? 0 : im }))
    .sort((p, q) => (p.im === 0 ? 0 : 1) - (q.im === 0 ? 0 : 1) || p.re - q.re);
}

function rootText(r) {
  if (r.im === 0) return number(r.re);
  const re = r.re === 0 ? '' : number(r.re);
  const im = Math.abs(r.im) === 1 ? 'i' : `${number(Math.abs(r.im))}i`;
  return re + (r.im < 0 ? (re ? ' - ' : '-') : (re ? ' + ' : '')) + im;
}

/// Solves p = 0 for variable v. Exact forms for linear and quadratic, numeric for the rest.
export function solvePoly(p, v) {
  const deg = p.degreeIn(v);
  if (deg < 1) return [p.isZero ? `${v} can be anything` : 'No solution'];
  const cs = Array.from({ length: deg + 1 }, (_, k) => p.coefficient(v, k));
  const numeric = cs.every((c) => c.constantValue !== null);
  if (!numeric) {
    if (deg === 1) {
      const b = cs[0], a = cs[1];
      const k = a.constantValue;
      if (k !== null) return [`${v} = ${formatPoly(b.negated().scaled(1 / k))}`];
      return [`${v} = (${formatPoly(b.negated())})/(${formatPoly(a)})`];
    }
    if (deg === 2) {
      const c = cs[0], b = cs[1], a = cs[2];
      const disc = b.times(b).minus(a.times(c.scaled(4)));
      return [`${v} = (${formatPoly(b.negated())} ± √(${formatPoly(disc)}))/(${formatPoly(a.scaled(2))})`];
    }
    throw new MathError(`I can only solve for ${v} with other letters when it is linear or quadratic`);
  }
  const c = cs.map((x) => x.constantValue);
  if (deg === 1) return [`${v} = ${number(-c[0] / c[1])}`];
  if (deg === 2) return quadratic(c[2], c[1], c[0], v);
  const seen = [], out = [];
  for (const root of roots(c)) {
    const t = rootText(root);
    if (!seen.includes(t)) { seen.push(t); out.push(`${v} = ${t}`); }
  }
  return out;
}

export function quadratic(a, b, c, v) {
  const disc = b * b - 4 * a * c;
  let scale = 1;
  for (const x of [a, b, c]) { const r = rational(x); if (r) scale = (scale / gcd(scale, r[1])) * r[1]; }
  const ia = Math.round(a * scale), ib = Math.round(b * scale), ic = Math.round(c * scale);
  const exact = [a, b, c].every((x) => rational(x) !== null) && scale <= 1000;
  if (Math.abs(disc) < 1e-12) return [`${v} = ${number(-b / (2 * a))}`];
  if (exact) {
    const D = ib * ib - 4 * ia * ic;
    const [k, m] = simplifySqrt(Math.abs(D));
    if (D > 0 && m === 1) {
      const r1 = (-b + k / scale) / (2 * a), r2 = (-b - k / scale) / (2 * a);
      return [r1, r2].sort((x, y) => x - y).map((r) => `${v} = ${number(r)}`);
    }
    // (-b ± k√m)/(2a), reduced.
    const den = 2 * ia;
    let num0 = -ib, kk = k;
    const g = gcd(gcd(num0, kk), den);
    if (g > 1) { num0 /= g; kk /= g; }
    let d = den / (g > 1 ? g : 1), nn = num0;
    if (d < 0) { d = -d; nn = -nn; }
    const root = (D < 0 ? 'i' : '') + (m === 1 ? '' : `√${m}`);
    const rootTerm = (kk === 1 ? '' : String(kk)) + root;
    const head = nn === 0 ? '' : String(nn);
    const numerator = head ? `${head} ± ${rootTerm}` : `±${rootTerm}`;
    const text = d === 1 ? numerator : `(${numerator})/${d}`;
    let approx;
    if (D > 0) {
      const s = Math.sqrt(disc);
      approx = '≈ ' + [(-b + s) / (2 * a), (-b - s) / (2 * a)].sort((x, y) => x - y).map((r) => number(r)).join(', ');
    } else {
      const s = Math.sqrt(-disc) / Math.abs(2 * a);
      approx = '≈ ' + rootText({ re: -b / (2 * a), im: s }).replace(' + ', ' ± ').replace(' - ', ' ± ');
    }
    return [`${v} = ${text}`, approx];
  }
  return roots([c, b, a]).map((r) => `${v} = ${rootText(r)}`);
}

/// Linear system by Gaussian elimination. Unknowns in alphabetical order.
export function solveLinear(eqs, unknowns) {
  const n = unknowns.length;
  if (eqs.length !== n) throw new MathError(`${n} unknown${n === 1 ? '' : 's'} needs ${n} equation${n === 1 ? '' : 's'}, not ${eqs.length}`);
  const m = Array.from({ length: n }, () => new Array(n + 1).fill(0));
  eqs.forEach((p, r) => {
    for (const { powers, c } of p.terms.values()) {
      const deg = monoDegree(powers);
      if (deg === 0) m[r][n] = -c;
      else if (deg === 1) { const col = unknowns.indexOf(Object.keys(powers)[0]); if (col < 0) throw new MathError('Only linear systems (no x², xy…) are solved'); m[r][col] += c; }
      else throw new MathError('Only linear systems (no x², xy…) are solved');
    }
  });
  for (let col = 0; col < n; col++) {
    let pivot = col;
    for (let r = col; r < n; r++) if (Math.abs(m[r][col]) > Math.abs(m[pivot][col])) pivot = r;
    if (Math.abs(m[pivot][col]) <= 1e-12) throw new MathError("These equations don't pin down every unknown (no single solution)");
    [m[col], m[pivot]] = [m[pivot], m[col]];
    const d = m[col][col];
    for (let k = 0; k <= n; k++) m[col][k] /= d;
    for (let r = 0; r < n; r++) if (r !== col) { const f = m[r][col]; if (f !== 0) for (let k = 0; k <= n; k++) m[r][k] -= f * m[col][k]; }
  }
  return unknowns.map((u, i) => `${u} = ${number(m[i][n])}`);
}

/// Factors a one-letter polynomial with rational roots: x² − 5x + 6 → (x - 2)(x - 3).
export function factor(p, v) {
  const deg = p.degreeIn(v);
  const vars = p.variables();
  if (deg < 2 || vars.size !== 1 || !vars.has(v)) return null;
  const c = Array.from({ length: deg + 1 }, (_, k) => p.coefficient(v, k).constantValue ?? 0);
  if (!c.every((x) => rational(x) !== null)) return null;
  let scale = 1;
  for (const x of c) { const r = rational(x); if (r) scale = (scale / gcd(scale, r[1])) * r[1]; }
  const ints = c.map((x) => Math.round(x * scale));
  const content = ints.reduce((g, x) => gcd(g, x), 0);
  if (content === 0) return null;
  const scaledLead = Math.abs(ints[ints.length - 1] / content), scaledTail = Math.abs(ints[0] / content);
  let lead = c[c.length - 1];
  let rest = c.map((x) => x / c[c.length - 1]);
  const factors = [];
  let found = true;
  while (rest.length > 2 && found) {
    found = false;
    if (Math.abs(rest[0]) < 1e-12) { factors.push(v); rest = rest.slice(1); found = true; continue; }
    const ps = divisors(scaledTail), qs = divisors(scaledLead);
    search: for (const pp of ps) for (const qq of qs) for (const sign of [1, -1]) {
      const r = (sign * pp) / qq;
      const val = rest.reduce((s, x, i) => s + x * r ** i, 0);
      if (Math.abs(val) >= 1e-9) continue;
      const quotient = new Array(rest.length - 1).fill(0);
      let carry = 0;
      for (let k = rest.length - 1; k > 0; k--) { carry = rest[k] + carry * r; quotient[k - 1] = carry; }
      rest = quotient;
      const rr = rational(r);
      if (rr && rr[1] > 1) { factors.push(`(${rr[1]}${v} ${rr[0] < 0 ? '+' : '-'} ${Math.abs(rr[0])})`); lead /= rr[1]; }
      else factors.push(r < 0 ? `(${v} + ${number(-r)})` : `(${v} - ${number(r)})`);
      found = true;
      break search;
    }
  }
  if (!factors.length) return null;
  // Whatever is left (an irreducible quadratic, say) goes in one bracket, cleared of fractions.
  let leftover = '';
  if (rest.length > 1) {
    let d = 1;
    for (const x of rest) { const r = rational(x); if (r) d = (d / gcd(d, r[1])) * r[1]; }
    let tail = new Poly();
    rest.forEach((coef, k) => { if (Math.abs(coef) > 1e-12) tail = tail.plus(Poly.variable(v).power(k).scaled(coef * d)); });
    leftover = `(${formatPoly(tail)})`;
    lead /= d;
  }
  let out = '';
  if (Math.abs(lead - 1) > 1e-12) out = Math.abs(lead + 1) < 1e-12 ? '-' : (number(lead).includes('/') ? `(${number(lead)})` : number(lead));
  return out + factors.join('') + leftover;
}

export function diff(e, v) {
  switch (e.t) {
    case 'num': return num(0);
    case 'sym': return num(e.n === v ? 1 : 0);
    case 'add': return add(diff(e.a, v), diff(e.b, v));
    case 'neg': return neg(diff(e.a, v));
    case 'mul': return add(mul(diff(e.a, v), e.b), mul(e.a, diff(e.b, v)));
    case 'pow': {
      if (e.b.t === 'num') return mul(mul(num(e.b.v), pow(e.a, num(e.b.v - 1))), diff(e.a, v));
      const aFree = !freeSymbols(e.a).has(v), bFree = !freeSymbols(e.b).has(v);
      if (bFree) return mul(mul(e.b, pow(e.a, add(e.b, num(-1)))), diff(e.a, v));
      if (aFree) return mul(mul(pow(e.a, e.b), call('ln', [e.a])), diff(e.b, v));
      return mul(e, diff(mul(e.b, call('ln', [e.a])), v));       // a^b = e^(b ln a)
    }
    case 'call': {
      if (e.args.length !== 1) throw new MathError(`Can't differentiate ${e.n}`);
      const u = e.args[0], du = diff(u, v);
      let outer;
      switch (e.n) {
        case 'sin': outer = call('cos', [u]); break;
        case 'cos': outer = neg(call('sin', [u])); break;
        case 'tan': outer = pow(call('cos', [u]), num(-2)); break;
        case 'exp': outer = call('exp', [u]); break;
        case 'ln': outer = pow(u, num(-1)); break;
        case 'log': outer = mul(num(1 / Math.log(10)), pow(u, num(-1))); break;
        case 'sqrt': outer = mul(num(0.5), pow(u, num(-0.5))); break;
        case 'sinh': outer = call('cosh', [u]); break;
        case 'cosh': outer = call('sinh', [u]); break;
        case 'atan': outer = pow(add(num(1), pow(u, num(2))), num(-1)); break;
        case 'abs': outer = mul(u, pow(call('abs', [u]), num(-1))); break;
        default: throw new MathError(`I can't differentiate ${e.n} yet`);
      }
      return mul(outer, du);
    }
    default: throw new MathError('That didn’t work');
  }
}

/// Folds numbers and drops ·1, +0, ^1 so a derivative reads like a person wrote it.
export function tidy(e) {
  switch (e.t) {
    case 'num': case 'sym': return e;
    case 'neg': { const t = tidy(e.a); if (t.t === 'num') return num(-t.v); if (t.t === 'neg') return t.a; return neg(t); }
    case 'add': {
      const x = tidy(e.a), y = tidy(e.b);
      if (x.t === 'num' && y.t === 'num') return num(x.v + y.v);
      if (x.t === 'num' && x.v === 0) return y;
      if (y.t === 'num' && y.v === 0) return x;
      return add(x, y);
    }
    case 'mul': {
      const x = tidy(e.a), y = tidy(e.b);
      if (x.t === 'num' && y.t === 'num') return num(x.v * y.v);
      if ((x.t === 'num' && x.v === 0) || (y.t === 'num' && y.v === 0)) return num(0);
      if (x.t === 'num' && x.v === 1) return y;
      if (y.t === 'num' && y.v === 1) return x;
      if (y.t === 'num') return tidy(mul(num(y.v), x));                  // numbers first: 3x, not x·3
      if (x.t === 'num' && y.t === 'mul' && y.a.t === 'num') return mul(num(x.v * y.a.v), y.b);
      if (x.t === 'num' && x.v === -1) return neg(y);
      return mul(x, y);
    }
    case 'pow': {
      const x = tidy(e.a), y = tidy(e.b);
      if (y.t === 'num') {
        if (y.v === 1) return x;
        if (y.v === 0) return num(1);
        if (x.t === 'num') return num(x.v ** y.v);
      }
      return pow(x, y);
    }
    case 'call': return call(e.n, e.args.map(tidy));
    default: return e;
  }
}

// ---------- a calculator session
/// Keeps the values and functions you define so later lines can use them.
export class MathSession {
  constructor() { this.reset(); }
  reset() { this.vars = {}; this.fns = {}; this.ans = null; }

  /// Runs every line (separated by new lines) in order. Each result: { input, output: [..], kind }.
  run(text) {
    return text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean).map((l) => this.runLine(l));
  }

  get names() { return new Set([...Object.keys(this.vars), ...Object.keys(this.fns), 'ans']); }
  parse(s) { return parse(s, this.names, new Set(Object.keys(this.fns))); }

  runLine(line) {
    try { return this.evaluate(line); }
    catch (e) {
      if (e instanceof MathError) return { input: line, output: [e.message], kind: 'error' };
      return { input: line, output: ['That didn’t work'], kind: 'error' };
    }
  }

  evaluate(line) {
    const env = { ...this.vars };
    if (this.ans !== null) env.ans = this.ans;

    // Several equations on one line: "x + y = 5; x - y = 1".
    const parts = line.split(';').map((s) => s.trim()).filter(Boolean);
    if (parts.length > 1) return this.system(parts, line, env);

    // solve(equation, x)
    if (line.toLowerCase().startsWith('solve(') && line.endsWith(')')) {
      const inner = line.slice(6, -1);
      let depth = 0, split = -1;
      for (let i = 0; i < inner.length; i++) { const ch = inner[i]; if (ch === '(') depth++; else if (ch === ')') depth--; else if (ch === ',' && depth === 0) split = i; }
      const eqText = split >= 0 ? inner.slice(0, split) : inner;
      const unknown = split >= 0 ? inner.slice(split + 1).trim() : null;
      const sides = eqText.split('=').map((s) => s.trim());
      if (sides.length !== 2) throw new MathError('solve(2x + 3 = 11, x)');
      if (unknown !== null && !/^\p{L}+$/u.test(unknown)) throw new MathError('Say which letter to solve for, like x');
      return this.equation(this.parse(sides[0]), this.parse(sides[1]), line, env, unknown, true);
    }

    // f(x) = expression
    const def = MathSession.functionDefinition(line);
    if (def) {
      const [name, param, bodyText] = def;
      if (RESERVED.has(name.toLowerCase())) throw new MathError(`“${name}” is a built-in function`);
      const body = parse(bodyText, new Set([...this.names, param]), new Set(Object.keys(this.fns)));
      this.fns[name] = { param, body };
      return { input: line, output: [`${name}(${param}) = ${formatExpr(tidy(body))}`], kind: 'definition' };
    }

    // Equation or assignment.
    if (line.includes('=')) {
      const sides = line.split('=').map((s) => s.trim());
      if (sides.length !== 2 || !sides[0] || !sides[1]) throw new MathError('An equation has one “=”');
      // name = value
      if (/^\p{L}+$/u.test(sides[0]) && !RESERVED.has(sides[0].toLowerCase()) && !(sides[0].toLowerCase() in CONSTS) && sides[0] !== 'ans') {
        const rhs = inline(this.parse(sides[1]), env, this.fns);
        if (freeSymbols(rhs, this.fns).size === 0) {
          const v = value(rhs, env, this.fns);
          this.vars[sides[0]] = v; this.ans = v;
          return { input: line, output: [`${sides[0]} = ${number(v)}`], kind: 'definition' };
        }
      }
      return this.equation(this.parse(sides[0]), this.parse(sides[1]), line, env, null, false);
    }

    const e = inline(this.parse(line), env, this.fns);

    // Commands: expand, simplify, factor, diff
    if (e.t === 'call') {
      const args = e.args;
      switch (e.n) {
        case 'expand': case 'simplify': {
          if (args.length !== 1) throw new MathError(`${e.n} takes one expression`);
          const p = Poly.from(args[0]);
          return { input: line, output: [p ? formatPoly(p) : formatExpr(tidy(args[0]))], kind: 'algebra' };
        }
        case 'factor': {
          const p = args.length === 1 ? Poly.from(args[0]) : null;
          if (!p) throw new MathError('factor needs a polynomial');
          const letters = [...p.variables()];
          if (letters.length !== 1) throw new MathError('factor works with one letter, like x');
          const f = factor(p, letters[0]);
          return { input: line, output: [f ?? `${formatPoly(p)} (nothing to factor over the rationals)`], kind: 'algebra' };
        }
        case 'diff': {
          if (args.length < 1) throw new MathError('diff(expression, x)');
          let v = 'x';
          if (args.length >= 2 && args[1].t === 'sym') v = args[1].n;
          else if (args.length === 1) v = [...freeSymbols(args[0])].sort()[0] ?? 'x';
          const d = tidy(diff(args[0], v));
          const p = Poly.from(d);
          return { input: line, output: [p ? formatPoly(p) : formatExpr(d)], kind: 'algebra' };
        }
        default: break;
      }
    }

    const free = freeSymbols(e, this.fns);
    if (free.size === 0) {
      const v = value(e, env, this.fns);
      this.ans = v;
      return { input: line, output: [number(v, false)], kind: 'value' };
    }
    // Letters left: show it expanded and collected.
    const p = Poly.from(e);
    return { input: line, output: [p ? formatPoly(p) : formatExpr(tidy(e))], kind: 'algebra' };
  }

  equation(lhs, rhs, original, env, unknown, force) {
    const scope = { ...env };
    if (unknown) delete scope[unknown];            // the letter being solved for ignores any value it was given earlier
    const l = inline(lhs, scope, this.fns), r = inline(rhs, scope, this.fns);
    const free = new Set([...freeSymbols(l), ...freeSymbols(r)]);
    if (free.size === 0) {
      const a = value(l, env, this.fns), b = value(r, env, this.fns);
      const used = [...freeSymbols(lhs), ...freeSymbols(rhs)].filter((n) => n in env).sort();
      const hint = used.length ? ` (${used.map((n) => `${n} is ${number(env[n])}`).join(', ')})` : '';
      return { input: original, output: [Math.abs(a - b) < 1e-9 ? `True${hint}` : `False: ${number(a)} ≠ ${number(b)}${hint}`], kind: 'equation' };
    }
    let v;
    if (unknown) v = unknown;
    else if (free.size === 1) v = [...free][0];
    else throw new MathError(`More than one letter (${[...free].sort().join(', ')}): use solve(equation, x) or give a system`);
    const pl = Poly.from(l), pr = Poly.from(r);
    if (pl && pr) return { input: original, output: solvePoly(pl.minus(pr), v), kind: 'equation' };
    // Not a polynomial (sin x = 0.5, 2^x = 8 …): look for sign changes and refine them.
    if (!(free.size === 1 && free.has(v)) && !force) throw new MathError('I can only solve this for one letter at a time');
    const fns = this.fns;
    const f = (x) => {
      try { const e2 = { ...env, [v]: x }; return value(l, e2, fns) - value(r, e2, fns); } catch { return null; }
    };
    const found = [];
    let prevX = -100, prevY = f(prevX);
    for (let x = -100 + 0.05; x <= 100; x += 0.05) {
      const y = f(x);
      if (prevY !== null && y !== null) {
        if (y === 0) found.push(x);
        else if (prevY * y < 0 && Math.abs(prevY) < 1e6 && Math.abs(y) < 1e6) {
          let lo = prevX, hi = x;
          for (let i = 0; i < 80; i++) { const mid = (lo + hi) / 2, fm = f(mid), fl = f(lo); if (fm !== null && fl !== null && fm * fl <= 0) hi = mid; else lo = mid; }
          found.push((lo + hi) / 2);
        }
      }
      prevX = x; prevY = y;
    }
    const unique = [];
    for (const s of found) if (!unique.some((u) => Math.abs(u - s) < 1e-6)) unique.push(s);
    if (!unique.length) throw new MathError(`I couldn't find a solution for ${v} between -100 and 100`);
    const shown = unique.slice(0, 6).map((s) => `${v} ≈ ${number(s)}`);
    return { input: original, output: shown.concat(unique.length > 6 ? ['…and more'] : []), kind: 'equation' };
  }

  system(parts, original, env) {
    const polys = [];
    for (const part of parts) {
      const sides = part.split('=').map((s) => s.trim());
      if (sides.length !== 2) throw new MathError('Each equation needs one “=”');
      const l = inline(this.parse(sides[0]), env, this.fns), r = inline(this.parse(sides[1]), env, this.fns);
      const pl = Poly.from(l), pr = Poly.from(r);
      if (!pl || !pr) throw new MathError('Only polynomial equations can be solved together');
      polys.push(pl.minus(pr));
    }
    const unknowns = [...new Set(polys.flatMap((p) => [...p.variables()]))].sort();
    return { input: original, output: solveLinear(polys, unknowns), kind: 'equation' };
  }

  /// "f(x) = x^2 + 1" → ['f', 'x', 'x^2 + 1']
  static functionDefinition(line) {
    const eq = line.indexOf('='), open = line.indexOf('(');
    if (eq < 0 || open < 0 || open > eq) return null;
    const name = line.slice(0, open).trim();
    const rest = line.slice(open + 1, eq).trim();
    if (!name || !/^\p{L}+$/u.test(name) || !rest.endsWith(')')) return null;
    const param = rest.slice(0, -1).trim();
    if ([...param].length !== 1 || !/^\p{L}$/u.test(param)) return null;
    return [name, param, line.slice(eq + 1).trim()];
  }
}
