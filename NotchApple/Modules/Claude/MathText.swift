//
//  MathText.swift
//  Notch apple
//
//  Parsing behind RichTextView, with no UI so it can be unit-tested:
//  LaTeX → readable Unicode math, and Markdown → blocks (text, headings,
//  display math, code, tables).
//

import Foundation

enum MathText {
    private static let symbols: [String: String] = [
        "\\times": "×", "\\cdot": "·", "\\div": "÷", "\\pm": "±", "\\mp": "∓", "\\le": "≤", "\\leq": "≤", "\\ge": "≥", "\\geq": "≥",
        "\\neq": "≠", "\\ne": "≠", "\\approx": "≈", "\\equiv": "≡", "\\sim": "∼", "\\propto": "∝", "\\infty": "∞",
        "\\rightarrow": "→", "\\to": "→", "\\leftarrow": "←", "\\Rightarrow": "⇒", "\\implies": "⇒", "\\Leftrightarrow": "⇔", "\\iff": "⇔",
        "\\in": "∈", "\\notin": "∉", "\\subset": "⊂", "\\subseteq": "⊆", "\\cup": "∪", "\\cap": "∩", "\\emptyset": "∅", "\\forall": "∀", "\\exists": "∃",
        "\\sum": "∑", "\\prod": "∏", "\\int": "∫", "\\oint": "∮", "\\partial": "∂", "\\nabla": "∇", "\\degree": "°", "\\circ": "°",
        "\\alpha": "α", "\\beta": "β", "\\gamma": "γ", "\\delta": "δ", "\\epsilon": "ε", "\\varepsilon": "ε", "\\zeta": "ζ", "\\eta": "η",
        "\\theta": "θ", "\\lambda": "λ", "\\mu": "μ", "\\nu": "ν", "\\xi": "ξ", "\\pi": "π", "\\rho": "ρ", "\\sigma": "σ", "\\tau": "τ",
        "\\phi": "φ", "\\varphi": "φ", "\\chi": "χ", "\\psi": "ψ", "\\omega": "ω", "\\Gamma": "Γ", "\\Delta": "Δ", "\\Theta": "Θ",
        "\\Lambda": "Λ", "\\Pi": "Π", "\\Sigma": "Σ", "\\Phi": "Φ", "\\Psi": "Ψ", "\\Omega": "Ω", "\\ldots": "…", "\\cdots": "⋯", "\\dots": "…",
        "\\angle": "∠", "\\perp": "⊥", "\\parallel": "∥", "\\therefore": "∴", "\\because": "∵", "\\quad": "  ", "\\qquad": "    ",
        "\\,": " ", "\\;": " ", "\\!": "", "\\ ": " ", "\\left": "", "\\right": "", "\\displaystyle": "", "\\{": "{", "\\}": "}",
        "\\%": "%", "\\$": "$",
    ]
    private static let sup: [Character: Character] = ["0": "⁰", "1": "¹", "2": "²", "3": "³", "4": "⁴", "5": "⁵", "6": "⁶", "7": "⁷", "8": "⁸", "9": "⁹",
        "+": "⁺", "-": "⁻", "=": "⁼", "(": "⁽", ")": "⁾", "n": "ⁿ", "i": "ⁱ", "x": "ˣ", "y": "ʸ", "a": "ᵃ", "b": "ᵇ", "c": "ᶜ", "d": "ᵈ",
        "e": "ᵉ", "k": "ᵏ", "m": "ᵐ", "t": "ᵗ", "T": "ᵀ", "−": "⁻"]
    private static let sub: [Character: Character] = ["0": "₀", "1": "₁", "2": "₂", "3": "₃", "4": "₄", "5": "₅", "6": "₆", "7": "₇", "8": "₈", "9": "₉",
        "+": "₊", "-": "₋", "=": "₌", "(": "₍", ")": "₎", "a": "ₐ", "e": "ₑ", "i": "ᵢ", "j": "ⱼ", "k": "ₖ", "n": "ₙ", "o": "ₒ", "x": "ₓ", "m": "ₘ", "t": "ₜ"]

    /// Converts one piece of LaTeX into readable Unicode.
    static func readable(_ latex: String) -> String {
        var s = latex
        // \text{…}, \mathrm{…}, \mathbf{…} → contents.
        s = replace(s, #"\\(?:text|mathrm|mathbf|mathit|operatorname|textbf|boxed)\{([^{}]*)\}"#) { $0[1] }
        // Fractions (repeat for nesting).
        for _ in 0..<4 {
            s = replace(s, #"\\[dt]?frac\{([^{}]*)\}\{([^{}]*)\}"#) { g in
                let a = g[1], b = g[2]
                let simple = { (x: String) in x.allSatisfy { $0.isLetter || $0.isNumber || $0 == "." } }
                return (simple(a) ? a : "(\(a))") + "⁄" + (simple(b) ? b : "(\(b))")
            }
        }
        s = replace(s, #"\\sqrt\[([^\]]*)\]\{([^{}]*)\}"#) { g in "\(superscript(g[1]))√(\(g[2]))" }
        s = replace(s, #"\\sqrt\{([^{}]*)\}"#) { g in g[1].count <= 2 ? "√\(g[1])" : "√(\(g[1]))" }
        s = replace(s, #"\\(?:vec|overrightarrow)\{([^{}]*)\}"#) { "\($0[1])⃗" }
        s = replace(s, #"\\(?:hat)\{([^{}]*)\}"#) { "\($0[1])̂" }
        s = replace(s, #"\\(?:bar|overline)\{([^{}]*)\}"#) { "\($0[1])̄" }
        // Named functions.
        s = replace(s, #"\\(sin|cos|tan|cot|sec|csc|log|ln|exp|lim|max|min|det|arcsin|arccos|arctan)\b"#) { $0[1] }
        for (k, v) in symbols.sorted(by: { $0.key.count > $1.key.count }) { s = s.replacingOccurrences(of: k, with: v) }
        // Superscripts and subscripts.
        s = replace(s, #"\^\{([^{}]*)\}"#) { superscript($0[1]) }
        s = replace(s, #"\^([A-Za-z0-9])"#) { superscript($0[1]) }
        s = replace(s, #"_\{([^{}]*)\}"#) { lowered($0[1]) }
        s = replace(s, #"_([A-Za-z0-9])"#) { lowered($0[1]) }
        s = s.replacingOccurrences(of: "{", with: "").replacingOccurrences(of: "}", with: "")
        s = replace(s, #"\\([A-Za-z]+)"#) { $0[1] }   // anything left: drop the backslash
        return s
    }

    static func superscript(_ t: String) -> String {
        t.allSatisfy { sup[$0] != nil } ? String(t.map { sup[$0]! }) : "^(\(t))"
    }

    static func lowered(_ t: String) -> String {
        t.allSatisfy { sub[$0] != nil } ? String(t.map { sub[$0]! }) : "_(\(t))"
    }

    /// Replaces inline $…$ and \(…\) math inside a line of Markdown.
    static func inline(_ line: String) -> String {
        var s = replace(line, #"\$\$(.+?)\$\$"#) { readable($0[1]) }   // display math written mid-sentence
        s = replace(s, #"\\\((.+?)\\\)"#) { readable($0[1]) }
        // Pandoc's rule: no space just inside the dollars and no digit right after, so "$5 and $10" stays money.
        s = replace(s, #"(?<![\\$])\$(?![\s$])([^$\n]+?)(?<!\s)\$(?!\d)"#) { readable($0[1]) }
        return s
    }

    private static func replace(_ s: String, _ pattern: String, _ f: ([String]) -> String) -> String {
        guard let re = try? NSRegularExpression(pattern: pattern) else { return s }
        var out = s
        for m in re.matches(in: s, range: NSRange(s.startIndex..., in: s)).reversed() {
            let groups = (0..<m.numberOfRanges).map { i -> String in
                guard let r = Range(m.range(at: i), in: s) else { return "" }
                return String(s[r])
            }
            if let r = Range(m.range, in: out) { out.replaceSubrange(r, with: f(groups)) }
        }
        return out
    }

    /// Plain text for copying: Markdown kept, LaTeX made readable.
    static func plain(_ markdown: String) -> String {
        RichBlocks.parse(markdown).map { block -> String in
            switch block {
            case .text(let t): return t
            case .heading(let t, _): return t
            case .math(let m): return m
            case .code(let c, _): return c
            case .table(let rows): return rows.map { $0.joined(separator: "\t") }.joined(separator: "\n")
            }
        }.joined(separator: "\n\n")
    }
}

enum RichBlocks: Equatable {
    case text(String), heading(String, Int), math(String), code(String, String), table([[String]])

    static func parse(_ source: String) -> [RichBlocks] {
        var blocks: [RichBlocks] = []
        var lines = source.components(separatedBy: "\n")[...]
        var paragraph: [String] = []
        func flush() {
            let t = paragraph.joined(separator: "\n").trimmingCharacters(in: .whitespacesAndNewlines)
            if !t.isEmpty { blocks.append(.text(MathText.inline(t))) }
            paragraph = []
        }
        while let line = lines.popFirst() {
            let trimmed = line.trimmingCharacters(in: .whitespaces)
            if trimmed.hasPrefix("```") {
                flush()
                let lang = String(trimmed.dropFirst(3))
                var code: [String] = []
                while let l = lines.popFirst(), !l.trimmingCharacters(in: .whitespaces).hasPrefix("```") { code.append(l) }
                blocks.append(.code(code.joined(separator: "\n"), lang))
            } else if trimmed.hasPrefix("$$") || trimmed.hasPrefix("\\[") {
                flush()
                let close = trimmed.hasPrefix("$$") ? "$$" : "\\]"
                var body = String(trimmed.dropFirst(2))
                if body.hasSuffix(close) && body.count >= 2 { body = String(body.dropLast(2)) }
                else {
                    while let l = lines.popFirst() {
                        let t = l.trimmingCharacters(in: .whitespaces)
                        if t.hasSuffix(close) { body += " " + t.dropLast(2); break }
                        body += " " + t
                    }
                }
                blocks.append(.math(MathText.readable(body.trimmingCharacters(in: .whitespaces))))
            } else if trimmed.hasPrefix("|") && trimmed.hasSuffix("|") && trimmed.count > 2 {
                flush()
                var rows = [cells(trimmed)]
                while let next = lines.first, next.trimmingCharacters(in: .whitespaces).hasPrefix("|") {
                    lines.removeFirst()
                    let r = cells(next.trimmingCharacters(in: .whitespaces))
                    if !r.allSatisfy({ $0.allSatisfy { "-: ".contains($0) } }) { rows.append(r) }
                }
                blocks.append(.table(rows))
            } else if let level = trimmed.firstIndex(where: { $0 != "#" }).map({ trimmed.distance(from: trimmed.startIndex, to: $0) }),
                      level > 0, level <= 4, trimmed.dropFirst(level).hasPrefix(" ") {
                flush()
                blocks.append(.heading(MathText.inline(String(trimmed.dropFirst(level + 1))), level))
            } else if trimmed.isEmpty {
                flush()
            } else {
                paragraph.append(line)
            }
        }
        flush()
        return blocks
    }

    private static func cells(_ row: String) -> [String] {
        row.trimmingCharacters(in: CharacterSet(charactersIn: "|")).components(separatedBy: "|")
            .map { MathText.inline($0.trimmingCharacters(in: .whitespaces)) }
    }
}
