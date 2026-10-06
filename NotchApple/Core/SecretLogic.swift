//
//  SecretLogic.swift
//  Notch apple
//
//  "Protect secrets" for the clipboard: spots copied text that looks like a secret (an API key or token, a private key,
//  a JWT, a one-time code or a card number) so it can be kept out of the clipboard history and cleared from the
//  clipboard a few seconds later. It is a best guess from the shape of the text, not a promise; it never sends anything
//  anywhere. The Windows app has the same rules in services/secrets.js and the same test cases.
//

import Foundation

enum SecretLogic {
    static func looksSecret(_ text: String) -> Bool {
        let t = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !t.isEmpty, t.count <= 8_000 else { return false }
        if t.contains("-----BEGIN") && t.contains("PRIVATE KEY") { return true }
        if matches(t, #"^eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]*$"#) { return true }                          // a JWT
        if matches(t, #"^(sk|pk|rk)[-_][A-Za-z0-9_-]{16,}$"#) { return true }                                             // sk-… style keys
        if matches(t, #"^(ghp|gho|ghu|ghs|ghr|github_pat|glpat|xox[abprs]|AKIA|ASIA|AIza)[-_A-Za-z0-9]{16,}$"#) { return true }   // GitHub, GitLab, Slack, AWS, Google
        if matches(t, #"^[0-9]{6}$"#) { return true }                                                                     // a one-time code
        if isCardNumber(t) { return true }
        // A long unbroken run of letters and digits (and a few symbols) with both kinds in it: a token or password hash.
        if matches(t, #"^[A-Za-z0-9_\-+/=.]{32,}$"#), t.contains(where: \.isNumber), t.contains(where: \.isLetter) { return true }
        return false
    }

    /// 13-19 digits (spaces and dashes allowed) that pass the Luhn check, the test every card number passes.
    static func isCardNumber(_ s: String) -> Bool {
        guard matches(s, #"^[0-9][0-9 -]{11,22}[0-9]$"#) else { return false }
        let digits = s.filter(\.isNumber).compactMap { Int(String($0)) }
        guard (13...19).contains(digits.count) else { return false }
        var sum = 0
        for (i, d) in digits.reversed().enumerated() { sum += i % 2 == 1 ? (d * 2 > 9 ? d * 2 - 9 : d * 2) : d }
        return sum % 10 == 0
    }

    private static func matches(_ s: String, _ pattern: String) -> Bool { s.range(of: pattern, options: .regularExpression) != nil }
}
