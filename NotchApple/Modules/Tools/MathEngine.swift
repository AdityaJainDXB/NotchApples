//
//  MathEngine.swift
//  Notch apple
//
//  The calculator's brain: multi-step expressions, variables, equations and algebra, all on this Mac.
//
//    2(3+4)^2 / 7          numbers with brackets, powers, %, !, sqrt, sin, cos, ln, log, abs ...
//    a = 12                remember a value; later lines can use it (and "ans", the last result)
//    f(x) = x^2 + 1        define a function, then f(3)
//    2x + 3 = 11           solve an equation (one unknown): x = 4
//    x^2 - 5x + 6 = 0      quadratics: exact answers, complex roots, higher degrees numerically
//    x + y = 5; x - y = 1  a system of linear equations
//    solve(a x + b = c, x) solve for one letter and keep the others as letters
//    expand((x+1)^3)       multiply out and collect like terms
//    factor(x^2 - 5x + 6)  split into factors using rational roots
//    diff(x^3 + 2x, x)     derivative (also d/dx(...))
//
//  No screens and no file access here, so it can be tested.
//

import Foundation

// MARK: - Expressions

indirect enum MExpr: Equatable {
    case num(Double)
    case sym(String)
    case add(MExpr, MExpr)
    case mul(MExpr, MExpr)
    case pow(MExpr, MExpr)
    case neg(MExpr)
    case call(String, [MExpr])
}

struct MathError: Error, Equatable { let message: String; init(_ m: String) { message = m } }

enum MathFunctions {
    static let oneArg: Set<String> = ["sqrt", "sin", "cos", "tan", "asin", "acos", "atan", "ln", "log", "exp", "abs", "floor", "ceil", "round", "sinh", "cosh", "tanh", "cbrt"]
    static let constants: [String: Double] = ["pi": .pi, "π": .pi, "e": M_E, "tau": 2 * .pi]
    static let reserved: Set<String> = oneArg.union(["solve", "expand", "simplify", "factor", "diff"])

    static func apply(_ name: String, _ x: Double) -> Double? {
        switch name {
        case "sqrt": return x < 0 ? nil : x.squareRoot()
        case "cbrt": return cbrt(x)
        case "sin": return sin(x)
        case "cos": return cos(x)
        case "tan": return tan(x)
        case "asin": return abs(x) > 1 ? nil : asin(x)
        case "acos": return abs(x) > 1 ? nil : acos(x)
        case "atan": return atan(x)
        case "sinh": return sinh(x)
        case "cosh": return cosh(x)
        case "tanh": return tanh(x)
        case "ln": return x <= 0 ? nil : log(x)
        case "log": return x <= 0 ? nil : log10(x)
        case "exp": return exp(x)
        case "abs": return abs(x)
        case "floor": return floor(x)
        case "ceil": return ceil(x)
        case "round": return x.rounded()
        default: return nil
        }
    }
}

// MARK: - Parser

struct MathParser {
    private enum Tok: Equatable { case num(Double), ident(String), op(Character), end }

    private var toks: [Tok] = []
    private var i = 0
    /// Names that may stand for one value (so "ab" is a name, not a*b).
    let knownNames: Set<String>
    /// Names defined as functions: only these may be followed by brackets as a call.
    let functionNames: Set<String>

    init(_ text: String, knownNames: Set<String> = [], functionNames: Set<String> = []) throws {
        self.knownNames = knownNames
        self.functionNames = functionNames
        toks = try Self.lex(text)
    }

    static func parse(_ text: String, knownNames: Set<String> = [], functionNames: Set<String> = []) throws -> MExpr {
        var p = try MathParser(text, knownNames: knownNames, functionNames: functionNames)
        let e = try p.expression()
        guard p.peek == .end else { throw MathError("Unexpected \(p.describe(p.peek))") }
        return e
    }

    private static func lex(_ s: String) throws -> [Tok] {
        var out: [Tok] = []
        let c = Array(s.replacingOccurrences(of: "×", with: "*").replacingOccurrences(of: "÷", with: "/")
            .replacingOccurrences(of: "−", with: "-").replacingOccurrences(of: "²", with: "^2").replacingOccurrences(of: "³", with: "^3"))
        var k = 0
        while k < c.count {
            let ch = c[k]
            if ch.isWhitespace { k += 1; continue }
            if ch.isNumber || (ch == "." && k + 1 < c.count && c[k + 1].isNumber) {
                var j = k
                while j < c.count, c[j].isNumber || c[j] == "." { j += 1 }
                // Scientific notation: 1e5, 2.5e-3 (only when digits follow, so "2e" stays 2*e).
                if j < c.count, c[j] == "e" || c[j] == "E" {
                    var m = j + 1
                    if m < c.count, c[m] == "-" || c[m] == "+" { m += 1 }
                    if m < c.count, c[m].isNumber { while m < c.count, c[m].isNumber { m += 1 }; j = m }
                }
                guard let v = Double(String(c[k..<j])) else { throw MathError("Bad number \(String(c[k..<j]))") }
                out.append(.num(v)); k = j; continue
            }
            if ch.isLetter || ch == "π" {
                var j = k
                while j < c.count, c[j].isLetter { j += 1 }
                out.append(.ident(String(c[k..<j]))); k = j; continue
            }
            if "+-*/^()=,%!;".contains(ch) {
                if ch == "*", k + 1 < c.count, c[k + 1] == "*" { out.append(.op("^")); k += 2; continue }
                out.append(.op(ch)); k += 1; continue
            }
            throw MathError("Unexpected “\(ch)”")
        }
        out.append(.end)
        return out
    }

    private var peek: Tok { toks[i] }
    private mutating func next() -> Tok { defer { if i < toks.count - 1 { i += 1 } }; return toks[i] }
    private func describe(_ t: Tok) -> String {
        switch t { case .num(let v): return "\(v)"; case .ident(let s): return s; case .op(let c): return "“\(c)”"; case .end: return "end of input" }
    }

    private mutating func expression() throws -> MExpr {
        var left = try term()
        while case .op(let c) = peek, c == "+" || c == "-" {
            _ = next()
            let right = try term()
            left = c == "+" ? .add(left, right) : .add(left, .neg(right))
        }
        return left
    }

    private func startsFactor(_ t: Tok) -> Bool {
        switch t {
        case .num, .ident: return true
        case .op(let c): return c == "("
        case .end: return false
        }
    }

    private mutating func term() throws -> MExpr {
        var left = try unary()
        while true {
            if case .op(let c) = peek, c == "*" || c == "/" {
                _ = next()
                let right = try unary()
                left = c == "*" ? .mul(left, right) : .mul(left, .pow(right, .num(-1)))
            } else if startsFactor(peek) {
                // Implicit multiplication: 2x, 3(x+1), (a+b)(c+d), 2 sin(x)
                left = .mul(left, try unary())
            } else { break }
        }
        return left
    }

    private mutating func unary() throws -> MExpr {
        if case .op(let c) = peek, c == "-" || c == "+" {
            _ = next()
            let inner = try unary()
            return c == "-" ? .neg(inner) : inner
        }
        return try power()
    }

    private mutating func power() throws -> MExpr {
        let base = try postfix()
        if case .op("^") = peek {
            _ = next()
            return .pow(base, try unary())      // right-associative; the exponent may be negative
        }
        return base
    }

    private mutating func postfix() throws -> MExpr {
        var e = try atom()
        while case .op(let c) = peek, c == "%" || c == "!" {
            _ = next()
            e = c == "%" ? .mul(e, .num(0.01)) : .call("fact", [e])
        }
        return e
    }

    private mutating func atom() throws -> MExpr {
        switch next() {
        case .num(let v): return .num(v)
        case .op("("):
            let e = try expression()
            guard case .op(")") = next() else { throw MathError("Missing a closing bracket") }
            return e
        case .ident(let name):
            let lower = name.lowercased()
            if case .op("(") = peek, MathFunctions.reserved.contains(lower) || functionNames.contains(name) {
                _ = next()
                var args: [MExpr] = []
                if case .op(")") = peek { _ = next() } else {
                    while true {
                        args.append(try expression())
                        if case .op(",") = peek { _ = next(); continue }
                        guard case .op(")") = next() else { throw MathError("Missing a closing bracket") }
                        break
                    }
                }
                return .call(MathFunctions.reserved.contains(lower) ? lower : name, args)
            }
            if MathFunctions.constants[lower] != nil || MathFunctions.constants[name] != nil { return .sym(name == "π" ? "pi" : lower) }
            if knownNames.contains(name) || name.count == 1 { return .sym(name) }
            // "xy" → x·y, "ab" → a·b (school-style algebra), unless it's a name we know.
            let letters = name.map { MExpr.sym(String($0)) }
            return letters.dropFirst().reduce(letters[0]) { .mul($0, $1) }
        case let t: throw MathError("Unexpected \(describe(t))")
        }
    }
}

// MARK: - Numeric evaluation

enum MathEval {
    static func value(_ e: MExpr, _ vars: [String: Double] = [:], functions: [String: (param: String, body: MExpr)] = [:]) throws -> Double {
        switch e {
        case .num(let v): return v
        case .sym(let s):
            if let v = vars[s] { return v }
            if let c = MathFunctions.constants[s] { return c }
            throw MathError("“\(s)” has no value yet")
        case .add(let a, let b): return try value(a, vars, functions: functions) + value(b, vars, functions: functions)
        case .mul(let a, let b): return try value(a, vars, functions: functions) * value(b, vars, functions: functions)
        case .neg(let a): return -(try value(a, vars, functions: functions))
        case .pow(let a, let b):
            let x = try value(a, vars, functions: functions), y = try value(b, vars, functions: functions)
            if y == -1, x == 0 { throw MathError("Can't divide by zero") }
            let r = Foundation.pow(x, y)
            if r.isInfinite, x == 0 { throw MathError("Can't divide by zero") }
            if r.isNaN { throw MathError("That has no real value") }
            return r
        case .call(let name, let args):
            if name == "fact" {
                let n = try value(args[0], vars, functions: functions)
                guard n >= 0, n == n.rounded(), n <= 170 else { throw MathError("Factorial needs a whole number from 0 to 170") }
                return n < 2 ? 1 : (2...Int(n)).reduce(1.0) { $0 * Double($1) }
            }
            if let f = functions[name], args.count == 1 {
                var inner = vars; inner[f.param] = try value(args[0], vars, functions: functions)
                return try value(f.body, inner, functions: functions)
            }
            guard args.count == 1 else { throw MathError("\(name) takes one value") }
            let x = try value(args[0], vars, functions: functions)
            guard let r = MathFunctions.apply(name, x) else { throw MathError("\(name)(\(MathFormat.number(x))) has no real value") }
            return r
        }
    }

    static func freeSymbols(_ e: MExpr, functions: [String: (param: String, body: MExpr)] = [:]) -> Set<String> {
        switch e {
        case .num: return []
        case .sym(let s): return MathFunctions.constants[s] == nil ? [s] : []
        case .add(let a, let b), .mul(let a, let b), .pow(let a, let b): return freeSymbols(a, functions: functions).union(freeSymbols(b, functions: functions))
        case .neg(let a): return freeSymbols(a, functions: functions)
        case .call(let n, let args):
            var s = args.reduce(into: Set<String>()) { $0.formUnion(freeSymbols($1, functions: functions)) }
            if let f = functions[n] { s.formUnion(freeSymbols(f.body, functions: functions).subtracting([f.param])) }
            return s
        }
    }

    /// Replaces symbol `name` by `with` everywhere.
    static func substitute(_ e: MExpr, _ name: String, _ with: MExpr) -> MExpr {
        switch e {
        case .num: return e
        case .sym(let s): return s == name ? with : e
        case .add(let a, let b): return .add(substitute(a, name, with), substitute(b, name, with))
        case .mul(let a, let b): return .mul(substitute(a, name, with), substitute(b, name, with))
        case .pow(let a, let b): return .pow(substitute(a, name, with), substitute(b, name, with))
        case .neg(let a): return .neg(substitute(a, name, with))
        case .call(let n, let args): return .call(n, args.map { substitute($0, name, with) })
        }
    }

    /// Replaces calls to user functions by their bodies, and known values by numbers.
    static func inline(_ e: MExpr, vars: [String: Double], functions: [String: (param: String, body: MExpr)]) -> MExpr {
        switch e {
        case .num: return e
        case .sym(let s): return vars[s].map { .num($0) } ?? e
        case .add(let a, let b): return .add(inline(a, vars: vars, functions: functions), inline(b, vars: vars, functions: functions))
        case .mul(let a, let b): return .mul(inline(a, vars: vars, functions: functions), inline(b, vars: vars, functions: functions))
        case .pow(let a, let b): return .pow(inline(a, vars: vars, functions: functions), inline(b, vars: vars, functions: functions))
        case .neg(let a): return .neg(inline(a, vars: vars, functions: functions))
        case .call(let n, let args):
            let a = args.map { inline($0, vars: vars, functions: functions) }
            if let f = functions[n], a.count == 1 {
                return inline(substitute(f.body, f.param, a[0]), vars: vars, functions: functions)
            }
            return .call(n, a)
        }
    }
}

// MARK: - Polynomials

struct Mono: Hashable {
    var powers: [String: Int]
    var degree: Int { powers.values.reduce(0, +) }
    static let one = Mono(powers: [:])
    func times(_ o: Mono) -> Mono { Mono(powers: powers.merging(o.powers, uniquingKeysWith: +)) }
}

struct Poly: Equatable {
    var terms: [Mono: Double] = [:]

    static func constant(_ c: Double) -> Poly { c == 0 ? Poly() : Poly(terms: [.one: c]) }
    static func variable(_ v: String) -> Poly { Poly(terms: [Mono(powers: [v: 1]): 1]) }

    var isZero: Bool { terms.isEmpty }
    var constantValue: Double? {
        if terms.isEmpty { return 0 }
        if terms.count == 1, let c = terms[.one] { return c }
        return nil
    }
    var variables: Set<String> { Set(terms.keys.flatMap { $0.powers.keys }) }

    func degree(in v: String) -> Int { terms.keys.map { $0.powers[v] ?? 0 }.max() ?? 0 }

    static func + (a: Poly, b: Poly) -> Poly {
        var t = a.terms
        for (m, c) in b.terms { t[m, default: 0] += c; if abs(t[m]!) < 1e-12 { t[m] = nil } }
        return Poly(terms: t)
    }
    static prefix func - (a: Poly) -> Poly { Poly(terms: a.terms.mapValues { -$0 }) }
    static func - (a: Poly, b: Poly) -> Poly { a + (-b) }
    static func * (a: Poly, b: Poly) -> Poly {
        var t: [Mono: Double] = [:]
        for (m1, c1) in a.terms { for (m2, c2) in b.terms { t[m1.times(m2), default: 0] += c1 * c2 } }
        return Poly(terms: t.filter { abs($0.value) > 1e-12 })
    }
    func scaled(_ k: Double) -> Poly { k == 0 ? Poly() : Poly(terms: terms.mapValues { $0 * k }) }

    func power(_ n: Int) -> Poly {
        var result = Poly.constant(1)
        for _ in 0..<n { result = result * self }
        return result
    }

    /// The part of the polynomial that multiplies v^k, with v taken out.
    func coefficient(of v: String, _ k: Int) -> Poly {
        var t: [Mono: Double] = [:]
        for (m, c) in terms where (m.powers[v] ?? 0) == k {
            var p = m.powers; p[v] = nil
            t[Mono(powers: p), default: 0] += c
        }
        return Poly(terms: t)
    }

    func evaluate(_ vars: [String: Double]) -> Double {
        terms.reduce(0) { sum, kv in sum + kv.value * kv.key.powers.reduce(1.0) { $0 * Foundation.pow(vars[$1.key] ?? 0, Double($1.value)) } }
    }

    /// Expression → polynomial, or nil when it has division by a letter, functions of letters, and so on.
    static func from(_ e: MExpr) -> Poly? {
        switch e {
        case .num(let v): return .constant(v)
        case .sym(let s): if let c = MathFunctions.constants[s] { return .constant(c) }; return .variable(s)
        case .add(let a, let b): guard let x = from(a), let y = from(b) else { return nil }; return x + y
        case .neg(let a): return from(a).map { -$0 }
        case .mul(let a, let b): guard let x = from(a), let y = from(b) else { return nil }; return x * y
        case .pow(let a, let b):
            guard let base = from(a), let ex = from(b)?.constantValue else { return nil }
            if ex >= 0, ex == ex.rounded(), ex <= 64 { return base.power(Int(ex)) }
            if let c = base.constantValue, c != 0 { return .constant(Foundation.pow(c, ex)) }
            // Division by a constant polynomial is fine; by a letter is not a polynomial.
            return nil
        case .call(let n, let args):
            if args.count == 1, let c = from(args[0])?.constantValue {
                if n == "fact" { return (try? MathEval.value(e)).map { .constant($0) } }
                return MathFunctions.apply(n, c).map { .constant($0) }
            }
            return nil
        }
    }
}

// MARK: - Formatting

enum MathFormat {
    /// 3 · 0.5 · 1/3 · 2.718281828
    static func number(_ x: Double, fractions: Bool = true) -> String {
        if x.isNaN || x.isInfinite { return x.isNaN ? "undefined" : (x < 0 ? "-∞" : "∞") }
        if abs(x) < 1e-12 { return "0" }
        if abs(x - x.rounded()) < 1e-9, abs(x) < 1e15 { return String(Int(x.rounded())) }
        if fractions, let (p, q) = rational(x), q <= 1000 { return "\(p)/\(q)" }
        return String(format: "%.10g", x)
    }

    /// The simplest fraction p/q (q ≤ 1000) equal to x within 1e-10, as (numerator, denominator).
    static func rational(_ x: Double) -> (Int, Int)? {
        guard abs(x) < 1e9 else { return nil }
        for q in 1...1000 {
            let p = (x * Double(q)).rounded()
            if abs(p / Double(q) - x) < 1e-10 * max(1, abs(x)) { return (Int(p), q) }
        }
        return nil
    }

    private static func coefText(_ c: Double) -> String {
        if let (p, q) = rational(c), q != 1 { return "\(abs(p))/\(q)" }
        return number(abs(c))
    }

    static func poly(_ p: Poly) -> String {
        if p.isZero { return "0" }
        // Highest total degree first; ties go to the alphabetically first letter with the larger power (a² before ab).
        let letters = Array(p.variables).sorted()
        let monos = p.terms.keys.sorted { a, b in
            if a.degree != b.degree { return a.degree > b.degree }
            for l in letters {
                let x = a.powers[l] ?? 0, y = b.powers[l] ?? 0
                if x != y { return x > y }
            }
            return false
        }
        var out = ""
        for (n, m) in monos.enumerated() {
            let c = p.terms[m]!
            let vars = m.powers.sorted { $0.key < $1.key }.map { $0.value == 1 ? $0.key : "\($0.key)^\($0.value)" }.joined()
            var body: String
            if vars.isEmpty { body = coefText(c) }
            else if abs(abs(c) - 1) < 1e-12 { body = vars }
            else { body = coefText(c) + vars }
            // Fractions in front of letters read better as (1/2)x.
            if !vars.isEmpty, body.contains("/") && abs(abs(c) - 1) >= 1e-12 { body = "(\(coefText(c)))" + vars }
            if n == 0 { out += (c < 0 ? "-" : "") + body } else { out += (c < 0 ? " - " : " + ") + body }
        }
        return out
    }

    /// An expression, with only the brackets that are needed.
    static func expr(_ e: MExpr, parent: Int = 0) -> String {
        func wrap(_ s: String, _ prec: Int) -> String { prec < parent ? "(\(s))" : s }
        switch e {
        case .num(let v): return v < 0 ? "(\(number(v)))" : number(v)
        case .sym(let s): return s
        case .neg(let a): return wrap("-" + expr(a, parent: 3), 1)
        case .add(let a, .neg(let b)): return wrap(expr(a, parent: 1) + " - " + expr(b, parent: 2), 1)
        case .add(let a, let b): return wrap(expr(a, parent: 1) + " + " + expr(b, parent: 1), 1)
        case .mul(let a, .pow(let b, .num(-1))): return wrap(expr(a, parent: 2) + "/" + expr(b, parent: 3), 2)
        case .mul(let a, let b): return wrap(expr(a, parent: 2) + "·" + expr(b, parent: 2), 2)
        case .pow(let a, .num(-1)): return wrap("1/" + expr(a, parent: 3), 2)
        case .pow(let a, let b): return wrap(expr(a, parent: 4) + "^" + expr(b, parent: 4), 3)
        case .call(let n, let args): return n == "fact" ? expr(args[0], parent: 4) + "!" : "\(n)(" + args.map { expr($0) }.joined(separator: ", ") + ")"
        }
    }
}

// MARK: - Algebra

enum MathAlgebra {
    /// Integer square factor: √n → (k, m) with √n = k√m.
    static func simplifySqrt(_ n: Int) -> (Int, Int) {
        var k = 1, m = n, f = 2
        while f * f <= m { while m % (f * f) == 0 { m /= f * f; k *= f }; f += 1 }
        return (k, m)
    }

    static func gcd(_ a: Int, _ b: Int) -> Int { b == 0 ? abs(a) : gcd(b, a % b) }

    /// Real and complex roots of a numeric polynomial (coefficients from the constant term up), by Durand–Kerner.
    static func roots(_ coeffs: [Double]) -> [(re: Double, im: Double)] {
        var c = coeffs
        while let l = c.last, abs(l) < 1e-14 { c.removeLast() }
        let n = c.count - 1
        guard n >= 1, let lead = c.last else { return [] }
        let a = c.map { $0 / lead }
        let radius = 1 + (a.dropLast().map(abs).max() ?? 1)
        var z = (0..<n).map { k -> (Double, Double) in
            let ang = 2 * Double.pi * Double(k) / Double(n) + 0.4
            return (radius * 0.5 * cos(ang), radius * 0.5 * sin(ang))
        }
        func mul(_ p: (Double, Double), _ q: (Double, Double)) -> (Double, Double) { (p.0 * q.0 - p.1 * q.1, p.0 * q.1 + p.1 * q.0) }
        func div(_ p: (Double, Double), _ q: (Double, Double)) -> (Double, Double) {
            let d = q.0 * q.0 + q.1 * q.1
            return d == 0 ? (0, 0) : ((p.0 * q.0 + p.1 * q.1) / d, (p.1 * q.0 - p.0 * q.1) / d)
        }
        for _ in 0..<500 {
            var delta = 0.0
            for i in 0..<n {
                var value: (Double, Double) = (a[n], 0)           // Horner from the top
                for k in stride(from: n - 1, through: 0, by: -1) { let t = mul(value, z[i]); value = (t.0 + a[k], t.1) }
                var denom: (Double, Double) = (1, 0)
                for j in 0..<n where j != i { denom = mul(denom, (z[i].0 - z[j].0, z[i].1 - z[j].1)) }
                let step = div(value, denom)
                z[i] = (z[i].0 - step.0, z[i].1 - step.1)
                delta = max(delta, abs(step.0) + abs(step.1))
            }
            if delta < 1e-13 { break }
        }
        return z.map { (abs($0.0) < 1e-9 ? 0 : $0.0, abs($0.1) < 1e-9 ? 0 : $0.1) }
            .sorted { ($0.im == 0 ? 0 : 1, $0.re) < ($1.im == 0 ? 0 : 1, $1.re) }
    }

    static func rootText(_ r: (re: Double, im: Double)) -> String {
        if r.im == 0 { return MathFormat.number(r.re) }
        let re = r.re == 0 ? "" : MathFormat.number(r.re)
        let im = abs(r.im) == 1 ? "i" : MathFormat.number(abs(r.im)) + "i"
        return re + (r.im < 0 ? (re.isEmpty ? "-" : " - ") : (re.isEmpty ? "" : " + ")) + im
    }

    /// Solves p = 0 for variable v. Exact forms for linear and quadratic, numeric for the rest.
    static func solvePoly(_ p: Poly, for v: String) throws -> [String] {
        let deg = p.degree(in: v)
        guard deg >= 1 else {
            return p.isZero ? ["\(v) can be anything"] : ["No solution"]
        }
        let cs = (0...deg).map { p.coefficient(of: v, $0) }
        let numeric = cs.allSatisfy { $0.constantValue != nil }
        if !numeric {
            // Letters other than v stay as letters.
            if deg == 1 {
                let b = cs[0], a = cs[1]
                if let k = a.constantValue { return ["\(v) = " + MathFormat.poly((-b).scaled(1 / k))] }
                return ["\(v) = (" + MathFormat.poly(-b) + ")/(" + MathFormat.poly(a) + ")"]
            }
            if deg == 2 {
                let c = cs[0], b = cs[1], a = cs[2]
                let disc = b * b - a * c.scaled(4)
                let text = "\(v) = (" + MathFormat.poly(-b) + " ± √(" + MathFormat.poly(disc) + "))/(" + MathFormat.poly(a.scaled(2)) + ")"
                return [text]
            }
            throw MathError("I can only solve for \(v) with other letters when it is linear or quadratic")
        }
        let c = cs.map { $0.constantValue! }
        if deg == 1 { return ["\(v) = " + MathFormat.number(-c[0] / c[1])] }
        if deg == 2 { return quadratic(a: c[2], b: c[1], c: c[0], v: v) }
        let r = roots(c)
        var seen: [String] = [], out: [String] = []
        for root in r {
            let t = rootText(root)
            if !seen.contains(t) { seen.append(t); out.append("\(v) = \(t)") }
        }
        return out
    }

    static func quadratic(a: Double, b: Double, c: Double, v: String) -> [String] {
        let disc = b * b - 4 * a * c
        // Exact form when the coefficients are whole numbers (or fractions scaled to whole numbers).
        var scale = 1
        for x in [a, b, c] { if let (_, q) = MathFormat.rational(x) { scale = scale / gcd(scale, q) * q } }
        let ia = Int((a * Double(scale)).rounded()), ib = Int((b * Double(scale)).rounded()), ic = Int((c * Double(scale)).rounded())
        let exact = [a, b, c].allSatisfy { MathFormat.rational($0) != nil } && scale <= 1000
        if abs(disc) < 1e-12 { return ["\(v) = " + MathFormat.number(-b / (2 * a))] }
        if exact {
            let D = ib * ib - 4 * ia * ic
            let (k, m) = simplifySqrt(abs(D))
            if D > 0 && m == 1 {
                let r1 = (-b + Double(k) / Double(scale)) / (2 * a), r2 = (-b - Double(k) / Double(scale)) / (2 * a)
                return [r1, r2].sorted().map { "\(v) = " + MathFormat.number($0) }
            }
            // (-b ± k√m)/(2a), reduced.
            let den = 2 * ia
            var num = -ib, kk = k
            let g = gcd(gcd(num, kk), den)
            if g > 1 { num /= g; kk /= g }
            var d = den / (g > 1 ? g : 1)
            var nn = num
            if d < 0 { d = -d; nn = -nn }
            let root = (D < 0 ? "i" : "") + (m == 1 ? "" : "√\(m)")
            let rootTerm = (kk == 1 ? "" : "\(kk)") + (root.isEmpty ? "" : root)
            let head = nn == 0 ? "" : "\(nn)"
            let numerator = head.isEmpty ? "±\(rootTerm)" : "\(head) ± \(rootTerm)"
            let text = d == 1 ? (head.isEmpty ? "±\(rootTerm)" : "\(head) ± \(rootTerm)") : "(\(numerator))/\(d)"
            let approx: String
            if D > 0 {
                let s = disc.squareRoot()
                approx = "≈ " + [(-b + s) / (2 * a), (-b - s) / (2 * a)].sorted().map { MathFormat.number($0) }.joined(separator: ", ")
            } else {
                let s = (-disc).squareRoot() / abs(2 * a)
                approx = "≈ " + rootText((-b / (2 * a), s)).replacingOccurrences(of: " + ", with: " ± ").replacingOccurrences(of: " - ", with: " ± ")
            }
            return ["\(v) = \(text)", approx]
        }
        return roots([c, b, a]).map { "\(v) = \(rootText($0))" }
    }

    /// Linear system by Gaussian elimination. Unknowns in alphabetical order.
    static func solveLinear(_ eqs: [Poly], unknowns: [String]) throws -> [String] {
        let n = unknowns.count
        guard eqs.count == n else { throw MathError("\(n) unknown\(n == 1 ? "" : "s") needs \(n) equation\(n == 1 ? "" : "s"), not \(eqs.count)") }
        var m = [[Double]](repeating: [Double](repeating: 0, count: n + 1), count: n)
        for (r, p) in eqs.enumerated() {
            for (mono, c) in p.terms {
                if mono.degree == 0 { m[r][n] = -c }
                else if mono.degree == 1, let v = mono.powers.keys.first, let col = unknowns.firstIndex(of: v) { m[r][col] += c }
                else { throw MathError("Only linear systems (no x², xy…) are solved") }
            }
        }
        for col in 0..<n {
            guard let pivot = (col..<n).max(by: { abs(m[$0][col]) < abs(m[$1][col]) }), abs(m[pivot][col]) > 1e-12 else {
                throw MathError("These equations don't pin down every unknown (no single solution)")
            }
            m.swapAt(col, pivot)
            let d = m[col][col]
            for k in 0...n { m[col][k] /= d }
            for r in 0..<n where r != col {
                let f = m[r][col]
                if f != 0 { for k in 0...n { m[r][k] -= f * m[col][k] } }
            }
        }
        return unknowns.enumerated().map { "\($1) = " + MathFormat.number(m[$0][n]) }
    }

    /// Factors a one-letter polynomial with rational roots: x² − 5x + 6 → (x - 2)(x - 3).
    static func factor(_ p: Poly, v: String) -> String? {
        let deg = p.degree(in: v)
        guard deg >= 2, p.variables == [v] else { return nil }
        let c = (0...deg).map { p.coefficient(of: v, $0).constantValue ?? 0 }
        guard c.allSatisfy({ MathFormat.rational($0) != nil }) else { return nil }
        // Whole-number version, only to know which fractions can be roots.
        var scale = 1
        for x in c { if let (_, q) = MathFormat.rational(x) { scale = scale / gcd(scale, q) * q } }
        let ints = c.map { Int(($0 * Double(scale)).rounded()) }
        let content = ints.reduce(0) { gcd($0, $1) }
        guard content != 0 else { return nil }
        let scaledLead = abs(ints.last! / content)
        let scaledTail = abs(ints.first! / content)

        var lead = c.last!                       // the overall multiplier, adjusted as (qx - p) factors are written
        var rest = c.map { $0 / c.last! }        // monic polynomial still to be split
        var factors: [String] = []
        var found = true
        while rest.count > 2, found {
            found = false
            if abs(rest[0]) < 1e-12 { factors.append(v); rest.removeFirst(); found = true; continue }
            let ps = divisors(scaledTail), qs = divisors(scaledLead)
            search: for pp in ps { for qq in qs { for sign in [1, -1] {
                let r = Double(sign * pp) / Double(qq)
                let value = rest.enumerated().reduce(0.0) { $0 + $1.element * Foundation.pow(r, Double($1.offset)) }
                guard abs(value) < 1e-9 else { continue }
                var quotient = [Double](repeating: 0, count: rest.count - 1)
                var carry = 0.0
                for k in stride(from: rest.count - 1, to: 0, by: -1) { carry = rest[k] + carry * r; quotient[k - 1] = carry }
                rest = quotient
                if let (num, den) = MathFormat.rational(r), den > 1 {
                    factors.append("(\(den)\(v) \(num < 0 ? "+" : "-") \(abs(num)))")
                    lead /= Double(den)
                } else {
                    factors.append(r < 0 ? "(\(v) + \(MathFormat.number(-r)))" : "(\(v) - \(MathFormat.number(r)))")
                }
                found = true
                break search
            } } }
        }
        guard !factors.isEmpty else { return nil }
        // Whatever is left (an irreducible quadratic, say) goes in one bracket, cleared of fractions.
        var leftover = ""
        if rest.count > 1 {
            var d = 1
            for x in rest { if let (_, q) = MathFormat.rational(x) { d = d / gcd(d, q) * q } }
            var tail = Poly()
            for (k, coef) in rest.enumerated() where abs(coef) > 1e-12 { tail = tail + Poly.variable(v).power(k).scaled(coef * Double(d)) }
            leftover = "(" + MathFormat.poly(tail) + ")"
            lead /= Double(d)
        }
        var out = ""
        if abs(lead - 1) > 1e-12 { out = abs(lead + 1) < 1e-12 ? "-" : (MathFormat.number(lead).contains("/") ? "(\(MathFormat.number(lead)))" : MathFormat.number(lead)) }
        return out + factors.joined() + leftover
    }

    private static func divisors(_ n: Int) -> [Int] { n == 0 ? [1] : (1...n).filter { n % $0 == 0 } }

    // MARK: Derivatives

    static func diff(_ e: MExpr, _ v: String) throws -> MExpr {
        switch e {
        case .num: return .num(0)
        case .sym(let s): return .num(s == v ? 1 : 0)
        case .add(let a, let b): return .add(try diff(a, v), try diff(b, v))
        case .neg(let a): return .neg(try diff(a, v))
        case .mul(let a, let b): return .add(.mul(try diff(a, v), b), .mul(a, try diff(b, v)))
        case .pow(let a, .num(let n)):
            return .mul(.mul(.num(n), .pow(a, .num(n - 1))), try diff(a, v))
        case .pow(let a, let b):
            let aFree = !MathEval.freeSymbols(a).contains(v), bFree = !MathEval.freeSymbols(b).contains(v)
            if bFree { return .mul(.mul(b, .pow(a, .add(b, .num(-1)))), try diff(a, v)) }
            if aFree { return .mul(.mul(.pow(a, b), .call("ln", [a])), try diff(b, v)) }
            // a^b = e^(b ln a)
            return .mul(e, try diff(.mul(b, .call("ln", [a])), v))
        case .call(let n, let args):
            guard args.count == 1 else { throw MathError("Can't differentiate \(n)") }
            let u = args[0], du = try diff(u, v)
            let outer: MExpr
            switch n {
            case "sin": outer = .call("cos", [u])
            case "cos": outer = .neg(.call("sin", [u]))
            case "tan": outer = .pow(.call("cos", [u]), .num(-2))
            case "exp": outer = .call("exp", [u])
            case "ln": outer = .pow(u, .num(-1))
            case "log": outer = .mul(.num(1 / log(10.0)), .pow(u, .num(-1)))
            case "sqrt": outer = .mul(.num(0.5), .pow(u, .num(-0.5)))
            case "sinh": outer = .call("cosh", [u])
            case "cosh": outer = .call("sinh", [u])
            case "atan": outer = .pow(.add(.num(1), .pow(u, .num(2))), .num(-1))
            case "abs": outer = .mul(u, .pow(.call("abs", [u]), .num(-1)))
            default: throw MathError("I can't differentiate \(n) yet")
            }
            return .mul(outer, du)
        }
    }

    /// Folds numbers and drops ·1, +0, ^1 so a derivative reads like a person wrote it.
    static func tidy(_ e: MExpr) -> MExpr {
        switch e {
        case .num, .sym: return e
        case .neg(let a):
            let t = tidy(a)
            if case .num(let v) = t { return .num(-v) }
            if case .neg(let inner) = t { return inner }
            return .neg(t)
        case .add(let a, let b):
            let x = tidy(a), y = tidy(b)
            if case .num(let p) = x, case .num(let q) = y { return .num(p + q) }
            if case .num(0) = x { return y }
            if case .num(0) = y { return x }
            return .add(x, y)
        case .mul(let a, let b):
            let x = tidy(a), y = tidy(b)
            if case .num(let p) = x, case .num(let q) = y { return .num(p * q) }
            if case .num(0) = x { return .num(0) }
            if case .num(0) = y { return .num(0) }
            if case .num(1) = x { return y }
            if case .num(1) = y { return x }
            if case .num(let p) = y { return tidy(.mul(.num(p), x)) }   // numbers first: 3x, not x·3
            if case .num(let p) = x, case .mul(.num(let q), let rest) = y { return .mul(.num(p * q), rest) }
            if case .num(-1) = x { return .neg(y) }
            return .mul(x, y)
        case .pow(let a, let b):
            let x = tidy(a), y = tidy(b)
            if case .num(let q) = y {
                if q == 1 { return x }
                if q == 0 { return .num(1) }
                if case .num(let p) = x { return .num(Foundation.pow(p, q)) }
            }
            return .pow(x, y)
        case .call(let n, let args): return .call(n, args.map(tidy))
        }
    }
}

// MARK: - A calculator session

/// What one line of input produced.
struct MathLine: Equatable {
    enum Kind: Equatable { case value, equation, definition, algebra, error }
    let input: String
    let output: [String]
    let kind: Kind
}

/// Keeps the values and functions you define so later lines can use them.
struct MathSession {
    private(set) var vars: [String: Double] = [:]
    private(set) var functions: [String: (param: String, body: MExpr)] = [:]
    private(set) var ans: Double?

    mutating func reset() { vars = [:]; functions = [:]; ans = nil }

    /// Runs every line (separated by new lines) in order.
    mutating func run(_ text: String) -> [MathLine] {
        text.split(whereSeparator: \.isNewline).map { String($0).trimmingCharacters(in: .whitespaces) }.filter { !$0.isEmpty }
            .map { runLine($0) }
    }

    private var names: Set<String> { Set(vars.keys).union(functions.keys).union(["ans"]) }

    private func parse(_ s: String) throws -> MExpr { try MathParser.parse(s, knownNames: names, functionNames: Set(functions.keys)) }

    mutating func runLine(_ line: String) -> MathLine {
        do { return try evaluate(line) } catch let e as MathError { return MathLine(input: line, output: [e.message], kind: .error) }
        catch { return MathLine(input: line, output: ["That didn't work"], kind: .error) }
    }

    private mutating func evaluate(_ line: String) throws -> MathLine {
        var env = vars
        if let a = ans { env["ans"] = a }

        // Several equations on one line: "x + y = 5; x - y = 1".
        let parts = line.split(separator: ";").map { String($0).trimmingCharacters(in: .whitespaces) }.filter { !$0.isEmpty }
        if parts.count > 1 { return try system(parts, original: line, env: env) }

        // solve(equation, x)
        let lowered = line.lowercased()
        if lowered.hasPrefix("solve("), line.hasSuffix(")") {
            let inner = String(line.dropFirst(6).dropLast())
            var depth = 0, split: String.Index?
            for idx in inner.indices { let ch = inner[idx]; if ch == "(" { depth += 1 } else if ch == ")" { depth -= 1 } else if ch == ",", depth == 0 { split = idx } }
            let eqText = split.map { String(inner[..<$0]) } ?? inner
            let unknown = split.map { String(inner[inner.index(after: $0)...]).trimmingCharacters(in: .whitespaces) }
            let sides = eqText.split(separator: "=", omittingEmptySubsequences: false).map { String($0).trimmingCharacters(in: .whitespaces) }
            guard sides.count == 2 else { throw MathError("solve(2x + 3 = 11, x)") }
            if let u = unknown, !(u.count >= 1 && u.allSatisfy(\.isLetter)) { throw MathError("Say which letter to solve for, like x") }
            return try equation(try parse(sides[0]), try parse(sides[1]), original: line, env: env, unknown: unknown, forceUnknown: true)
        }

        // f(x) = expression
        if let (name, param, bodyText) = Self.functionDefinition(line) {
            guard !MathFunctions.reserved.contains(name.lowercased()) else { throw MathError("“\(name)” is a built-in function") }
            let body = try MathParser.parse(bodyText, knownNames: names.union([param]), functionNames: Set(functions.keys))
            functions[name] = (param, body)
            return MathLine(input: line, output: ["\(name)(\(param)) = \(MathFormat.expr(MathAlgebra.tidy(body)))"], kind: .definition)
        }

        // Equation or assignment.
        if line.contains("=") {
            let sides = line.split(separator: "=", omittingEmptySubsequences: false).map { String($0).trimmingCharacters(in: .whitespaces) }
            guard sides.count == 2, !sides[0].isEmpty, !sides[1].isEmpty else { throw MathError("An equation has one “=”") }
            // name = value
            if sides[0].allSatisfy(\.isLetter), !MathFunctions.reserved.contains(sides[0].lowercased()), MathFunctions.constants[sides[0]] == nil, sides[0] != "ans" {
                let rhs = MathEval.inline(try parse(sides[1]), vars: env, functions: functions)
                if MathEval.freeSymbols(rhs, functions: functions).isEmpty {
                    let v = try MathEval.value(rhs, env, functions: functions)
                    vars[sides[0]] = v; ans = v
                    return MathLine(input: line, output: ["\(sides[0]) = \(MathFormat.number(v))"], kind: .definition)
                }
            }
            return try equation(try parse(sides[0]), try parse(sides[1]), original: line, env: env, unknown: nil, forceUnknown: false)
        }

        let e = MathEval.inline(try parse(line), vars: env, functions: functions)

        // Commands: solve, expand, simplify, factor, diff, d/dx
        if case .call(let name, let args) = e {
            switch name {
            case "expand", "simplify":
                guard args.count == 1 else { throw MathError("\(name) takes one expression") }
                if let p = Poly.from(args[0]) { return MathLine(input: line, output: [MathFormat.poly(p)], kind: .algebra) }
                return MathLine(input: line, output: [MathFormat.expr(MathAlgebra.tidy(args[0]))], kind: .algebra)
            case "factor":
                guard args.count == 1, let p = Poly.from(args[0]) else { throw MathError("factor needs a polynomial") }
                let letters = p.variables
                guard letters.count == 1, let v = letters.first else { throw MathError("factor works with one letter, like x") }
                guard let f = MathAlgebra.factor(p, v: v) else { return MathLine(input: line, output: ["\(MathFormat.poly(p)) (nothing to factor over the rationals)"], kind: .algebra) }
                return MathLine(input: line, output: [f], kind: .algebra)
            case "diff":
                guard args.count >= 1 else { throw MathError("diff(expression, x)") }
                var v = "x"
                if args.count >= 2, case .sym(let s) = args[1] { v = s }
                else if args.count == 1 { v = MathEval.freeSymbols(args[0]).sorted().first ?? "x" }
                let d = MathAlgebra.tidy(try MathAlgebra.diff(args[0], v))
                if let p = Poly.from(d) { return MathLine(input: line, output: [MathFormat.poly(p)], kind: .algebra) }
                return MathLine(input: line, output: [MathFormat.expr(d)], kind: .algebra)
            case "solve":
                guard args.count >= 1 else { throw MathError("solve(equation, x)") }
                // The equation arrives as a single expression because "=" ended the parse; handled below by text.
                throw MathError("Write it as solve(2x + 3 = 11, x)")
            default: break
            }
        }

        if case .call("d", _) = e { throw MathError("Use diff(expression, x)") }
        let free = MathEval.freeSymbols(e, functions: functions)
        if free.isEmpty {
            let v = try MathEval.value(e, env, functions: functions)
            ans = v
            return MathLine(input: line, output: [MathFormat.number(v, fractions: false)], kind: .value)
        }
        // Letters left: show it expanded and collected.
        if let p = Poly.from(e) { return MathLine(input: line, output: [MathFormat.poly(p)], kind: .algebra) }
        return MathLine(input: line, output: [MathFormat.expr(MathAlgebra.tidy(e))], kind: .algebra)
    }

    /// solve(lhs = rhs, x) is parsed by hand because "=" isn't part of the expression grammar.
    private mutating func equation(_ lhs: MExpr, _ rhs: MExpr, original: String, env: [String: Double], unknown: String?, forceUnknown: Bool) throws -> MathLine {
        // The letter being solved for ignores any value it was given earlier.
        var scope = env
        if let u = unknown { scope[u] = nil }
        let l = MathEval.inline(lhs, vars: scope, functions: functions), r = MathEval.inline(rhs, vars: scope, functions: functions)
        let free = MathEval.freeSymbols(l).union(MathEval.freeSymbols(r)).subtracting(MathFunctions.constants.keys)
        guard !free.isEmpty else {
            let a = try MathEval.value(l, env, functions: functions), b = try MathEval.value(r, env, functions: functions)
            let used = MathEval.freeSymbols(lhs).union(MathEval.freeSymbols(rhs)).intersection(env.keys).sorted()
            let hint = used.isEmpty ? "" : " (" + used.map { "\($0) is \(MathFormat.number(env[$0] ?? 0))" }.joined(separator: ", ") + ")"
            return MathLine(input: original, output: [abs(a - b) < 1e-9 ? "True" + hint : "False: \(MathFormat.number(a)) ≠ \(MathFormat.number(b))" + hint], kind: .equation)
        }
        let v: String
        if let u = unknown { v = u }
        else if free.count == 1, let only = free.first { v = only }
        else { throw MathError("More than one letter (\(free.sorted().joined(separator: ", "))): use solve(equation, x) or give a system") }
        if let pl = Poly.from(l), let pr = Poly.from(r) {
            return MathLine(input: original, output: try MathAlgebra.solvePoly(pl - pr, for: v), kind: .equation)
        }
        // Not a polynomial (sin x = 0.5, 2^x = 8 …): look for sign changes and refine them.
        guard free == [v] || forceUnknown else { throw MathError("I can only solve this for one letter at a time") }
        let fns = functions
        let f: (Double) -> Double? = { x in
            var e2 = env; e2[v] = x
            guard let a = try? MathEval.value(l, e2, functions: fns), let b = try? MathEval.value(r, e2, functions: fns) else { return nil }
            return a - b
        }
        var found: [Double] = []
        var prevX = -100.0, prevY = f(prevX)
        var x = -100.0 + 0.05
        while x <= 100 {
            let y = f(x)
            if let py = prevY, let cy = y {
                if cy == 0 { found.append(x) }
                else if py * cy < 0, abs(py) < 1e6, abs(cy) < 1e6 {
                    var lo = prevX, hi = x
                    for _ in 0..<80 { let mid = (lo + hi) / 2; if let fm = f(mid), let fl = f(lo), fm * fl <= 0 { hi = mid } else { lo = mid } }
                    found.append((lo + hi) / 2)
                }
            }
            prevX = x; prevY = y; x += 0.05
        }
        var unique: [Double] = []
        for s in found where !unique.contains(where: { abs($0 - s) < 1e-6 }) { unique.append(s) }
        guard !unique.isEmpty else { throw MathError("I couldn't find a solution for \(v) between -100 and 100") }
        let shown = unique.prefix(6).map { "\(v) ≈ \(MathFormat.number($0))" }
        return MathLine(input: original, output: shown + (unique.count > 6 ? ["…and more"] : []), kind: .equation)
    }

    private mutating func system(_ parts: [String], original: String, env: [String: Double]) throws -> MathLine {
        var polys: [Poly] = []
        for part in parts {
            let sides = part.split(separator: "=", omittingEmptySubsequences: false).map { String($0).trimmingCharacters(in: .whitespaces) }
            guard sides.count == 2 else { throw MathError("Each equation needs one “=”") }
            let l = MathEval.inline(try parse(sides[0]), vars: env, functions: functions), r = MathEval.inline(try parse(sides[1]), vars: env, functions: functions)
            guard let pl = Poly.from(l), let pr = Poly.from(r) else { throw MathError("Only polynomial equations can be solved together") }
            polys.append(pl - pr)
        }
        let unknowns = Set(polys.flatMap { $0.variables }).sorted()
        return MathLine(input: original, output: try MathAlgebra.solveLinear(polys, unknowns: unknowns), kind: .equation)
    }

    /// "f(x) = x^2 + 1" → ("f", "x", "x^2 + 1")
    static func functionDefinition(_ line: String) -> (String, String, String)? {
        guard let eq = line.firstIndex(of: "="), let open = line.firstIndex(of: "("), open < eq else { return nil }
        let name = line[..<open].trimmingCharacters(in: .whitespaces)
        let rest = line[line.index(after: open)..<eq].trimmingCharacters(in: .whitespaces)
        guard name.count >= 1, name.allSatisfy(\.isLetter), rest.hasSuffix(")") else { return nil }
        let param = rest.dropLast().trimmingCharacters(in: .whitespaces)
        guard param.count == 1, param.allSatisfy(\.isLetter) else { return nil }
        return (name, param, String(line[line.index(after: eq)...]).trimmingCharacters(in: .whitespaces))
    }
}
