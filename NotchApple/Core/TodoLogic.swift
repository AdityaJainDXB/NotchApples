//
//  TodoLogic.swift
//  Notch apple
//
//  The To-Do list's rules, with no screens: priorities, how the list is ordered (red, highest-priority tasks pinned
//  to the top), and how a typed line becomes a task ("call mum tomorrow 3pm !!!"). Tested without the app.
//

import Foundation

enum TodoPriority: Int, Codable, CaseIterable, Identifiable, Comparable {
    case low = 0, medium = 1, high = 2
    var id: Int { rawValue }
    static func < (a: Self, b: Self) -> Bool { a.rawValue < b.rawValue }

    var title: String { self == .high ? "High" : self == .medium ? "Medium" : "Low" }
}

/// One to-do. Saved lists from before priorities existed have no priority or date, so those are optional on the way
/// in: an old task reads as Medium with no due date.
struct TodoItem: Codable, Identifiable, Equatable {
    var id = UUID()
    var text: String
    var done = false
    var created = Date()
    var priority: TodoPriority = .medium
    var due: Date?
    var completed: Date?

    init(id: UUID = UUID(), text: String, done: Bool = false, created: Date = Date(), priority: TodoPriority = .medium, due: Date? = nil, completed: Date? = nil) {
        self.id = id; self.text = text; self.done = done; self.created = created
        self.priority = priority; self.due = due; self.completed = completed
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decodeIfPresent(UUID.self, forKey: .id) ?? UUID()
        text = try c.decode(String.self, forKey: .text)
        done = try c.decodeIfPresent(Bool.self, forKey: .done) ?? false
        created = try c.decodeIfPresent(Date.self, forKey: .created) ?? Date()
        priority = try c.decodeIfPresent(TodoPriority.self, forKey: .priority) ?? .medium
        due = try c.decodeIfPresent(Date.self, forKey: .due)
        completed = try c.decodeIfPresent(Date.self, forKey: .completed)
    }
}

enum TodoLogic {
    /// Open tasks first, then finished ones. With `byPriority` on (the default), red / high comes first, then medium,
    /// then low; ties go to the soonest due date (tasks without one last), then to the newest. With it off the list
    /// is simply newest first, like it always was.
    static func ordered(_ items: [TodoItem], byPriority: Bool) -> [TodoItem] {
        let open = items.filter { !$0.done }, done = items.filter(\.done)
        func key(_ a: TodoItem, _ b: TodoItem) -> Bool {
            if byPriority, a.priority != b.priority { return a.priority > b.priority }
            switch (a.due, b.due) {
            case let (x?, y?) where x != y: return x < y
            case (_?, nil): return byPriority
            case (nil, _?): return !byPriority
            default: return a.created > b.created
            }
        }
        // `sorted` isn't stable, so break every tie on the creation time explicitly (newest first).
        let sortedOpen = open.sorted { key($0, $1) || (!key($1, $0) && $0.created > $1.created) }
        let sortedDone = done.sorted { ($0.completed ?? $0.created) > ($1.completed ?? $1.created) }
        return sortedOpen + sortedDone
    }

    struct Parsed: Equatable {
        var title: String
        var priority: TodoPriority?
        var due: Date?
    }

    /// "Call mum tomorrow 3pm !!!" → title "Call mum", high priority, due tomorrow 3pm.
    /// Priority: "!!!" or "high:" = high, "!!" or "med:" = medium, "!" or "low:" = low (at the start or the end).
    /// A date or time in plain words becomes the due date.
    static func parse(_ raw: String, now: Date = Date()) -> Parsed? {
        var text = raw.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !text.isEmpty else { return nil }
        var priority: TodoPriority?

        for (prefix, p) in [("high:", TodoPriority.high), ("urgent:", .high), ("med:", .medium), ("medium:", .medium), ("low:", .low)] where text.lowercased().hasPrefix(prefix) {
            priority = p; text = String(text.dropFirst(prefix.count)).trimmingCharacters(in: .whitespaces); break
        }
        if priority == nil {
            for (marks, p) in [("!!!", TodoPriority.high), ("!!", .medium), ("!", .low)] {
                if text.hasSuffix(marks) && !text.hasSuffix("!" + marks) { priority = p; text = String(text.dropLast(marks.count)).trimmingCharacters(in: .whitespaces); break }
                if text.hasPrefix(marks) && !text.hasPrefix(marks + "!") { priority = p; text = String(text.dropFirst(marks.count)).trimmingCharacters(in: .whitespaces); break }
            }
        }

        var due: Date?
        if let detector = try? NSDataDetector(types: NSTextCheckingResult.CheckingType.date.rawValue),
           let match = detector.firstMatch(in: text, range: NSRange(text.startIndex..., in: text)), let d = match.date {
            due = d
            let before = (text as NSString).replacingCharacters(in: match.range, with: "")
            let cleaned = before.replacingOccurrences(of: #"\s+"#, with: " ", options: .regularExpression)
                .trimmingCharacters(in: CharacterSet.whitespaces.union(CharacterSet(charactersIn: ",-–:")))
            // Only treat it as a date when something is left to be the task.
            if cleaned.isEmpty { due = nil } else { text = cleaned }
        }
        text = String(text.prefix(200))
        guard !text.isEmpty else { return nil }
        return Parsed(title: text, priority: priority, due: due)
    }

    /// "Today 3:00 PM", "Tomorrow", "Oct 12".
    static func dueLabel(_ date: Date, now: Date = Date(), calendar: Calendar = .current) -> String {
        let hasTime = calendar.dateComponents([.hour, .minute], from: date) != DateComponents(hour: 0, minute: 0)
        let time = hasTime ? " " + date.formatted(date: .omitted, time: .shortened) : ""
        if calendar.isDate(date, inSameDayAs: now) { return "Today" + time }
        if let t = calendar.date(byAdding: .day, value: 1, to: now), calendar.isDate(date, inSameDayAs: t) { return "Tomorrow" + time }
        return date.formatted(.dateTime.month(.abbreviated).day()) + time
    }

    static func isOverdue(_ item: TodoItem, now: Date = Date()) -> Bool {
        guard !item.done, let due = item.due else { return false }
        return due < now
    }
}
