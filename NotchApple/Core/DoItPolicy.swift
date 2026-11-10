//
//  DoItPolicy.swift
//  Notch Apple
//
//  The decisions behind a reliable Do It run (Ultimate), kept pure so they can be unit-tested and shared in spirit with the
//  Windows twin (NotchWindows/src/js/services/doitpolicy.js): did the screen change between two screenshots, is the agent
//  stuck repeating itself, which hint to escalate to, when an AI error is worth retrying and for how long, when a run has
//  made no progress for too long, how to break one scroll into chunks a real app honours, and how to trim an accessibility
//  element list down to what fits in a prompt. No screen, no events, no imports beyond Foundation.
//

import Foundation

/// One finished step, as the stuck detector sees it.
struct DoItStepOutcome: Equatable {
    /// A canonical key for the action ("click@3,5", "key return", …) so near-identical actions compare equal.
    var key: String
    /// Did the screenshot change visibly after the action?
    var changed: Bool
}

/// One interactive element from the OS accessibility tree, ready for the prompt.
struct DoItElement: Equatable {
    var id: Int
    var role: String
    var label: String
    var value: String
    /// Bounds on the 0–1000 grid of the screenshot.
    var x: Double, y: Double, w: Double, h: Double
    var focused = false
    /// Part of an open menu or popup (highest priority: it is what the agent most likely wants right now).
    var menu = false
    /// In the frontmost window.
    var front = true
}

enum DoItPolicy {
    // MARK: Budgets

    /// The run ends after this many consecutive steps without progress…
    static let maxNoProgress = 15
    /// …or after this many steps in all (a safety ceiling; a paused run can be continued).
    static let stepCeiling = 300

    enum EndReason: Equatable { case noProgress, ceiling }

    /// Why the run must pause now, or nil to carry on.
    static func shouldEnd(noProgress: Int, totalSteps: Int) -> EndReason? {
        if noProgress >= maxNoProgress { return .noProgress }
        if totalSteps >= stepCeiling { return .ceiling }
        return nil
    }

    /// The new "steps without progress" counter after a step. The screen changing is progress; so is asking the user
    /// (their answer moves the task on) and zooming (the agent deliberately changed what it sees).
    static func updateNoProgress(_ count: Int, action: String, changed: Bool) -> Int {
        if changed || action == "ask" || action == "zoom" { return 0 }
        return count + 1
    }

    // MARK: Did the screen change?

    /// Two signatures (same-length grids of 0–255 luma values) count as different when more than this fraction of
    /// cells moved by more than `cellDelta`.
    static let changeFraction = 0.015
    static let cellDelta = 12

    /// The fraction of cells that changed noticeably between two signatures. Signatures of different lengths count as
    /// fully changed (1), and empty ones as unchanged (0) so a failed capture never fakes progress or an endless settle.
    static func changedFraction(_ a: [UInt8], _ b: [UInt8]) -> Double {
        guard !a.isEmpty || !b.isEmpty else { return 0 }
        guard a.count == b.count, !a.isEmpty else { return 1 }
        var moved = 0
        for i in 0..<a.count where abs(Int(a[i]) - Int(b[i])) > cellDelta { moved += 1 }
        return Double(moved) / Double(a.count)
    }

    static func screenChanged(_ a: [UInt8], _ b: [UInt8]) -> Bool {
        changedFraction(a, b) > changeFraction
    }

    // MARK: Settling (instead of a fixed wait)

    /// After an action the engine polls the screen signature every `settlePollMs` until it stops changing for
    /// `settleQuietPolls` polls in a row, up to `settleMaxMs`. "wait" always sleeps at least `settleMinMs`.
    static let settlePollMs = 400
    static let settleQuietPolls = 2
    static let settleMaxMs = 5000
    static let settleMinMs = 300

    // MARK: Stuck detection

    /// The same action this many times in a row means the approach is wrong, whatever the screen did.
    static let repeatLimit = 3

    /// A canonical key for an action, so "click (312, 448)" and "click (318, 451)" count as the same attempt.
    /// Coordinates are bucketed to 25 grid units.
    static func actionKey(action: String, x: Int = 0, y: Int = 0, text: String = "", key: String = "",
                          id: Int = -1, option: String = "", path: [String] = [], name: String = "") -> String {
        switch action {
        case "click", "double_click", "right_click", "drag":
            return "\(action)@\(x / 25),\(y / 25)"
        case "scroll":
            return "scroll@\(x / 25),\(y / 25)"
        case "type":
            return "type \(text.prefix(30))"
        case "key":
            return "key \(key.lowercased())"
        case "click_element", "set_value", "select":
            return "\(action)#\(id) \(option.prefix(30))"
        case "menu":
            return "menu \(path.joined(separator: ">"))"
        case "focus_app", "open_app":
            return "\(action) \(name)"
        default:
            return action
        }
    }

    /// How long the trailing run of the same action key is (0 for an empty history).
    static func repeatRun(_ outcomes: [DoItStepOutcome]) -> Int {
        guard let last = outcomes.last else { return 0 }
        var n = 0
        for o in outcomes.reversed() {
            if o.key == last.key { n += 1 } else { break }
        }
        return n
    }

    /// How many steps in a row ended with no visible change (asking and zooming break the run).
    static func noChangeRun(_ outcomes: [DoItStepOutcome]) -> Int {
        var n = 0
        for o in outcomes.reversed() {
            if o.changed { break }
            n += 1
        }
        return n
    }

    /// The escalating hint the next prompt should carry: 0 none, 1 gentle, 2 firm (change method), 3 ask the user.
    static func hintLevel(_ outcomes: [DoItStepOutcome]) -> Int {
        let repeats = repeatRun(outcomes)
        let flat = noChangeRun(outcomes)
        let effectiveRepeats = outcomes.last?.changed == false ? repeats : 0
        if flat >= 8 || effectiveRepeats >= repeatLimit + 3 { return 3 }
        if flat >= 5 || effectiveRepeats >= repeatLimit { return 2 }
        if flat >= 2 || effectiveRepeats >= 2 { return 1 }
        return 0
    }

    // MARK: Retrying the AI

    /// Pauses between retries of a transient AI failure; after the last the run gives up.
    static let retryDelaysMs = [2000, 5000, 15000, 30000, 60000]

    /// nil when there are no retries left.
    static func retryDelayMs(attempt: Int) -> Int? {
        guard attempt >= 0, attempt < retryDelaysMs.count else { return nil }
        return retryDelaysMs[attempt]
    }

    /// Is this AI error worth retrying (rate limits, server errors, timeouts, network blips), or permanent
    /// (bad key, no access, a model that cannot see images)?
    static func isTransientAIError(_ message: String) -> Bool {
        let m = message.lowercased()
        let permanent = ["api key", "apikey", "invalid key", "unauthorized", "401", "403", "forbidden",
                         "quota exceeded for this billing", "billing", "not found", "404",
                         "can't see images", "does not support", "unsupported"]
        if permanent.contains(where: m.contains) { return false }
        let transient = ["429", "rate limit", "rate_limit", "too many requests", "overloaded", "503", "502", "500",
                         "529", "timed out", "timeout", "took too long", "network", "connection", "temporarily",
                         "unavailable", "offline", "internet", "socket", "reset", "eof", "stream"]
        return transient.contains(where: m.contains)
    }

    // MARK: Scrolling

    /// One scroll request split into small chunks (at most `scrollChunk` lines each) played ~`scrollChunkGapMs` apart,
    /// because many apps ignore one big wheel event but follow several small ones.
    static let scrollChunk = 4
    static let scrollChunkGapMs = 60

    static func scrollChunks(_ amount: Int) -> [Int] {
        guard amount != 0 else { return [] }
        let sign = amount < 0 ? -1 : 1
        var left = abs(amount)
        var out: [Int] = []
        while left > 0 {
            let step = min(left, scrollChunk)
            out.append(step * sign)
            left -= step
        }
        return out
    }

    // MARK: The element list

    static let maxElements = 80
    static let maxElementChars = 6000

    /// One prompt line per element: `id role "label" = value @x,y wxh` (grid units), flagged when focused or in a menu.
    static func elementLine(_ e: DoItElement) -> String {
        var s = "\(e.id) \(e.role)"
        if !e.label.isEmpty { s += " \"\(String(e.label.prefix(60)))\"" }
        if !e.value.isEmpty { s += " = \(String(e.value.prefix(40)))" }
        s += " @\(Int(e.x)),\(Int(e.y)) \(Int(e.w))x\(Int(e.h))"
        if e.focused { s += " FOCUSED" }
        if e.menu { s += " MENU" }
        return s
    }

    /// The elements worth sending, highest priority first: open menus, the focused element, the frontmost window, the rest —
    /// capped by count and by the total characters their lines would take. Original order is kept within each group.
    static func trimElements(_ all: [DoItElement], maxCount: Int = maxElements, maxChars: Int = maxElementChars) -> [DoItElement] {
        let groups = [all.filter { $0.menu }, all.filter { !$0.menu && $0.focused },
                      all.filter { !$0.menu && !$0.focused && $0.front }, all.filter { !$0.menu && !$0.focused && !$0.front }]
        var out: [DoItElement] = []
        var chars = 0
        for group in groups {
            for e in group {
                guard out.count < maxCount else { return out }
                let line = elementLine(e).count + 1
                guard chars + line <= maxChars else { return out }
                out.append(e)
                chars += line
            }
        }
        return out
    }
}
