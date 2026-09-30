//
//  QuickAddView.swift
//  Notch apple
//
//  Pro: Quick Add. Type naturally ("Dentist tomorrow 3pm", "Call mum friday",
//  "remind me to pay rent on the 1st") and it becomes a Calendar event or a
//  Reminder, with the date understood on your Mac. A preview shows exactly
//  what will be created before you press Return.
//

import EventKit
import SwiftUI

@MainActor
final class QuickAddModel: ObservableObject {
    static let shared = QuickAddModel()

    enum Kind: String { case event = "Event", reminder = "Reminder" }

    struct Parsed: Equatable {
        var kind: Kind
        var title: String
        var date: Date?
        var hasTime: Bool
        var duration: TimeInterval
    }

    struct Created: Identifiable {
        let id = UUID()
        let kind: Kind
        let title: String
        let date: Date?
    }

    @Published var text = "" { didSet { parsed = Self.parse(text) } }
    @Published private(set) var parsed: Parsed?
    @Published private(set) var recent: [Created] = []
    @Published var message: String?
    private let store = EKEventStore()

    /// Works out the date, time, duration and whether it's a reminder.
    static func parse(_ raw: String) -> Parsed? {
        var text = raw.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !text.isEmpty else { return nil }
        var kind: Kind = .event
        for prefix in ["remind me to ", "remind me ", "reminder: ", "reminder ", "todo: ", "todo ", "to do "] where text.lowercased().hasPrefix(prefix) {
            kind = .reminder
            text = String(text.dropFirst(prefix.count))
            break
        }
        var date: Date?
        var hasTime = false
        var duration: TimeInterval = 3600
        if let detector = try? NSDataDetector(types: NSTextCheckingResult.CheckingType.date.rawValue),
           let match = detector.firstMatch(in: text, range: NSRange(text.startIndex..., in: text)), let d = match.date {
            date = d
            let phrase = (text as NSString).substring(with: match.range)
            hasTime = phrase.range(of: #"\d(:\d\d)?\s*(am|pm)|\d:\d\d|noon|midnight|morning|evening|afternoon|tonight"#,
                                   options: [.regularExpression, .caseInsensitive]) != nil
            if match.duration > 0 { duration = match.duration }
            text = (text as NSString).replacingCharacters(in: match.range, with: "")
        }
        // "on the 1st" / "by the 15th": the next time that day of the month comes round.
        if date == nil, let r = text.range(of: #"\b(on|by)?\s*the (\d{1,2})(st|nd|rd|th)\b"#, options: [.regularExpression, .caseInsensitive]) {
            let day = Int(text[r].components(separatedBy: CharacterSet.decimalDigits.inverted).joined()) ?? 0
            if (1...31).contains(day) {
                date = Calendar.current.nextDate(after: Calendar.current.startOfDay(for: .now).addingTimeInterval(-1),
                                                 matching: DateComponents(day: day), matchingPolicy: .nextTime)
                text.removeSubrange(r)
            }
        }
        if let r = text.range(of: #"\bfor (\d+)\s*(min|mins|minutes|h|hr|hrs|hours?)\b"#, options: [.regularExpression, .caseInsensitive]) {
            let part = String(text[r])
            let n = Double(part.components(separatedBy: CharacterSet.decimalDigits.inverted).joined()) ?? 1
            duration = part.lowercased().contains("h") ? n * 3600 : n * 60
            text.removeSubrange(r)
        }
        if date == nil { kind = .reminder }
        let title = text.replacingOccurrences(of: #"\s+(at|on|by)\s*$"#, with: "", options: .regularExpression)
            .replacingOccurrences(of: #"\s{2,}"#, with: " ", options: .regularExpression)
            .trimmingCharacters(in: CharacterSet(charactersIn: " ,.-"))
        return Parsed(kind: kind, title: title.isEmpty ? raw : title.prefix(1).uppercased() + title.dropFirst(), date: date, hasTime: hasTime, duration: duration)
    }

    func toggleKind() {
        guard var p = parsed else { return }
        p.kind = p.kind == .event ? .reminder : .event
        parsed = p
    }

    func add() {
        guard let p = parsed else { return }
        Task {
            do {
                if p.kind == .event {
                    guard try await store.requestFullAccessToEvents() else { throw QuickAddError.noAccess("Calendars", "Privacy_Calendars") }
                    let e = EKEvent(eventStore: store)
                    e.title = p.title
                    let start = p.date ?? .now
                    e.isAllDay = !p.hasTime
                    e.startDate = p.hasTime ? start : Calendar.current.startOfDay(for: start)
                    e.endDate = p.hasTime ? start.addingTimeInterval(p.duration) : e.startDate.addingTimeInterval(86_400)
                    e.calendar = store.defaultCalendarForNewEvents
                    if p.hasTime { e.addAlarm(EKAlarm(relativeOffset: -600)) }
                    try store.save(e, span: .thisEvent)
                } else {
                    guard try await store.requestFullAccessToReminders() else { throw QuickAddError.noAccess("Reminders", "Privacy_Reminders") }
                    let r = EKReminder(eventStore: store)
                    r.title = p.title
                    r.calendar = store.defaultCalendarForNewReminders()
                    if let d = p.date {
                        let parts: Set<Calendar.Component> = p.hasTime ? [.year, .month, .day, .hour, .minute] : [.year, .month, .day]
                        r.dueDateComponents = Calendar.current.dateComponents(parts, from: d)
                        if p.hasTime { r.addAlarm(EKAlarm(absoluteDate: d)) }
                    }
                    try store.save(r, commit: true)
                }
                recent.insert(Created(kind: p.kind, title: p.title, date: p.date), at: 0)
                recent = Array(recent.prefix(6))
                message = "Added to \(p.kind == .event ? "Calendar" : "Reminders")"
                text = ""
                TodayModel.shared.refresh()
            } catch let QuickAddError.noAccess(name, pane) {
                message = "Allow \(name) for Notch apple in System Settings."
                PermissionsModel.openPrivacy(pane)
            } catch {
                message = "Couldn't add it: \(error.localizedDescription)"
            }
        }
    }

    enum QuickAddError: Error { case noAccess(String, String) }
}

struct QuickAddView: View {
    @StateObject private var model = QuickAddModel.shared
    @FocusState private var focused: Bool

    private let examples = ["Dentist tomorrow 3pm", "Lunch with Sara friday 1pm for 90 min", "Remind me to pay rent on the 1st"]

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack(spacing: 10) {
                Image(systemName: "sparkles").foregroundStyle(Theme.accentBright)
                TextField("Type an event or reminder, e.g. “Dentist tomorrow 3pm”", text: $model.text)
                    .textFieldStyle(.plain).font(.system(size: 16)).foregroundStyle(.white)
                    .focused($focused)
                    .onSubmit(model.add)
                Button("Add", action: model.add).buttonStyle(PurpleButtonStyle()).disabled(model.parsed == nil)
            }
            .padding(12)
            .background(Theme.surface, in: RoundedRectangle(cornerRadius: 14))
            .overlay(RoundedRectangle(cornerRadius: 14).strokeBorder(Theme.accent.opacity(focused ? 0.8 : 0.3)))

            if let p = model.parsed {
                HStack(spacing: 12) {
                    Button(action: model.toggleKind) {
                        Label(p.kind.rawValue, systemImage: p.kind == .event ? "calendar" : "checklist")
                    }
                    .buttonStyle(PurpleButtonStyle(prominent: false))
                    .help("Switch between a Calendar event and a Reminder")
                    VStack(alignment: .leading, spacing: 2) {
                        Text(p.title).font(.system(size: 15, weight: .semibold)).foregroundStyle(.white)
                        Text(describe(p)).font(.system(size: 12)).foregroundStyle(Theme.textSecondary)
                    }
                    Spacer()
                }
                .padding(12)
                .background(Theme.accent.opacity(0.15), in: RoundedRectangle(cornerRadius: 12))
            } else {
                VStack(alignment: .leading, spacing: 6) {
                    Text("Try").sectionTitle()
                    ForEach(examples.prefix(3), id: \.self) { ex in
                        Button { model.text = ex } label: { Label(ex, systemImage: "text.cursor").font(.system(size: 12)) }
                            .buttonStyle(.plain).foregroundStyle(Theme.accentBright)
                    }
                }
            }

            if let m = model.message { Text(m).font(.system(size: 11)).foregroundStyle(Theme.textSecondary) }

            if !model.recent.isEmpty {
                Text("Just added").sectionTitle()
                ForEach(model.recent) { r in
                    Label("\(r.title)\(r.date.map { " · " + $0.formatted(date: .abbreviated, time: .shortened) } ?? "")",
                          systemImage: r.kind == .event ? "calendar.badge.checkmark" : "checkmark.circle")
                        .font(.system(size: 12)).foregroundStyle(.white)
                }
            }
            Spacer(minLength: 0)
        }
        .onAppear { focused = true }
    }

    private func describe(_ p: QuickAddModel.Parsed) -> String {
        guard let d = p.date else { return "No date. Added to Reminders without a due date." }
        if p.kind == .event {
            if !p.hasTime { return d.formatted(.dateTime.weekday(.wide).day().month(.wide)) + " · all day" }
            let mins = Int(p.duration / 60)
            return d.formatted(.dateTime.weekday(.wide).day().month().hour().minute()) + " · " + (mins >= 60 && mins % 60 == 0 ? "\(mins / 60) h" : "\(mins) min") + " · alert 10 min before"
        }
        return "Due " + (p.hasTime ? d.formatted(.dateTime.weekday(.wide).day().month().hour().minute()) : d.formatted(.dateTime.weekday(.wide).day().month(.wide)))
    }
}
