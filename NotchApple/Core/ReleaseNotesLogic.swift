//
//  ReleaseNotesLogic.swift
//  Notch apple
//
//  What the update screen shows of a release's notes: the changes, without the boilerplate (the install line, the
//  updates paragraph) and without the markers that steer the app (`[required-update]`, `[security]`).
//

import Foundation

enum ReleaseNotesLogic {
    /// The notes as shown in "What's in this update".
    static func whatsInside(_ notes: String) -> String {
        var out: [String] = []
        for raw in notes.split(separator: "\n", omittingEmptySubsequences: false) {
            let line = String(raw)
            let t = line.trimmingCharacters(in: .whitespaces)
            let lower = t.lowercased()
            if lower.hasPrefix("[required-update]") || lower.hasPrefix("[security]") { continue }
            // Everything from the "Updates" paragraph on is the same on every release.
            if t == "**Updates**" || t.hasPrefix("**Updates**") { break }
            if lower.hasPrefix("install:") { continue }
            out.append(line)
        }
        // Tidy: no leading or trailing blank lines, and never two blank lines in a row.
        var tidy: [String] = []
        for l in out {
            if l.trimmingCharacters(in: .whitespaces).isEmpty, tidy.last?.trimmingCharacters(in: .whitespaces).isEmpty ?? true { continue }
            tidy.append(l)
        }
        while let last = tidy.last, last.trimmingCharacters(in: .whitespaces).isEmpty { tidy.removeLast() }
        return tidy.joined(separator: "\n")
    }
}
