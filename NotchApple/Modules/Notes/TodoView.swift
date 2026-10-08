//
//  TodoView.swift
//  Notch apple
//
//  The to-do list (free), saved on this Mac. It sits in the Notes tab and as the To-Do widget on Home. The input
//  at the top is also the Quick Add: write "call mum tomorrow 3pm !!!" and the date and priority are picked out
//  of the line. High priority shows red and, with priority sorting on (the default), is pinned to the top.
//  With Pro it can also show your Apple Reminders (the default list), and ticking one off completes it in
//  Reminders too. Reminders are read and written on this Mac with EventKit. The rules are in TodoLogic.swift.
//

import EventKit
import SwiftUI

@MainActor
final class TodoStore: ObservableObject {
    static let shared = TodoStore()

    @Published private(set) var items: [TodoItem] = []
    @Published private(set) var reminders: [EKReminder] = []
    @Published private(set) var remindersProblem: String?
    @AppStorage("todo.showReminders") var showReminders = false { didSet { Task { await loadReminders() } } }
    /// On by default: red / high first, then medium, then low. Off keeps newest first.
    @AppStorage("todo.sortByPriority") var sortByPriority = true

    private let store = EKEventStore()
    private let url: URL = {
        let dir = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0].appendingPathComponent("Notch apple", isDirectory: true)
        try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        return dir.appendingPathComponent("todos.json")
    }()

    private init() {
        items = (try? JSONDecoder().decode([TodoItem].self, from: Data(contentsOf: url))) ?? []
    }

    /// After iCloud sync replaced the file (Ultimate).
    func reloadFromDisk() { items = (try? JSONDecoder().decode([TodoItem].self, from: Data(contentsOf: url))) ?? items }

    /// The tasks in the order they are shown: open ones by priority (or newest first), finished ones at the bottom.
    var ordered: [TodoItem] { TodoLogic.ordered(items, byPriority: sortByPriority) }
    var openCount: Int { items.filter { !$0.done }.count }

    /// Adds a task from a typed line. A date or time in plain words becomes its due date, and `!!!`, `!!`, `!` or
    /// `high:` / `med:` / `low:` set the priority; otherwise `fallback` (the priority chosen in the menu) is used.
    @discardableResult
    func add(_ text: String, fallback: TodoPriority = .medium) -> TodoItem? {
        guard let p = TodoLogic.parse(text) else { return nil }
        let item = TodoItem(text: p.title, priority: p.priority ?? fallback, due: p.due)
        items.insert(item, at: 0)
        save()
        return item
    }

    func toggle(_ item: TodoItem) {
        guard let i = items.firstIndex(where: { $0.id == item.id }) else { return }
        items[i].done.toggle()
        items[i].completed = items[i].done ? Date() : nil
        save()
    }

    func setPriority(_ item: TodoItem, _ p: TodoPriority) {
        guard let i = items.firstIndex(where: { $0.id == item.id }) else { return }
        items[i].priority = p
        save()
    }

    func delete(_ item: TodoItem) {
        let before = items
        items.removeAll { $0.id == item.id }; save()
        UndoCenter.shared.offer("To-do deleted") { [weak self] in self?.items = before; self?.save() }
    }
    func clearDone() {
        let before = items
        items.removeAll(where: \.done); save()
        UndoCenter.shared.offer("Done items cleared") { [weak self] in self?.items = before; self?.save() }
    }

    private func save() { try? JSONEncoder().encode(items).write(to: url, options: .atomic) }

    // MARK: Reminders (Pro)

    func loadReminders() async {
        guard showReminders, Entitlements.shared.canUse(.remindersSync) else { reminders = []; return }
        let granted = (try? await store.requestFullAccessToReminders()) ?? false
        guard granted else { remindersProblem = "Allow Reminders in System Settings → Privacy & Security → Reminders."; reminders = []; return }
        remindersProblem = nil
        let predicate = store.predicateForIncompleteReminders(withDueDateStarting: nil, ending: nil, calendars: nil)
        let found: [EKReminder] = await withCheckedContinuation { c in
            store.fetchReminders(matching: predicate) { c.resume(returning: $0 ?? []) }
        }
        reminders = found.sorted { ($0.dueDateComponents?.date ?? .distantFuture) < ($1.dueDateComponents?.date ?? .distantFuture) }
    }

    func complete(_ r: EKReminder) {
        r.isCompleted = true
        try? store.save(r, commit: true)
        reminders.removeAll { $0.calendarItemIdentifier == r.calendarItemIdentifier }
    }

    func addReminder(_ text: String, due: Date? = nil) {
        guard Entitlements.shared.canUse(.remindersSync), let cal = store.defaultCalendarForNewReminders() else { return }
        let r = EKReminder(eventStore: store)
        r.title = text
        r.calendar = cal
        if let due {
            r.dueDateComponents = Calendar.current.dateComponents([.year, .month, .day, .hour, .minute], from: due)
            r.addAlarm(EKAlarm(absoluteDate: due))
        }
        try? store.save(r, commit: true)
        Task { await loadReminders() }
    }
}

extension TodoPriority {
    /// Red for high, orange for medium, grey for low.
    var colour: Color { self == .high ? Color(red: 1.0, green: 0.33, blue: 0.33) : self == .medium ? .orange : Color(white: 0.62) }
    var flag: String { self == .low ? "flag" : "flag.fill" }
}

struct TodoView: View {
    @StateObject private var todos = TodoStore.shared
    @ObservedObject private var entitlements = Entitlements.shared
    @State private var new = ""
    @State private var chosen: TodoPriority = .medium
    @State private var toReminders = false
    @FocusState private var focused: Bool

    private var preview: TodoLogic.Parsed? { TodoLogic.parse(new) }

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            header
            inputRow
            if let p = preview, p.due != nil || p.priority != nil {
                HStack(spacing: 6) {
                    Image(systemName: "sparkles").font(.system(size: 9)).foregroundStyle(Theme.accentBright)
                    Text(previewText(p)).font(.system(size: 10)).foregroundStyle(Theme.textSecondary)
                }
            }
            ScrollView {
                VStack(spacing: 3) {
                    ForEach(todos.ordered) { row($0) }
                    if todos.items.isEmpty && todos.reminders.isEmpty {
                        Text("Nothing to do. Add your first task above.").font(.system(size: 12)).foregroundStyle(Theme.textSecondary).padding(.top, 14)
                    }
                    if !todos.reminders.isEmpty { remindersList }
                }
            }
            .scrollIndicators(.hidden)
            footer
            if let p = todos.remindersProblem { Text(p).font(.system(size: 11)).foregroundStyle(.orange) }
        }
        .task { await todos.loadReminders() }
    }

    // MARK: Header

    private var header: some View {
        HStack(spacing: 8) {
            Label("To-Do", systemImage: "checklist").font(.system(size: 13, weight: .semibold)).foregroundStyle(.white)
            Text(todos.openCount == 0 ? "all clear" : "\(todos.openCount) open").font(.system(size: 11)).foregroundStyle(Theme.textSecondary)
            Spacer()
            Button { todos.sortByPriority.toggle() } label: {
                Label("Priority", systemImage: "arrow.up.arrow.down").font(.system(size: 10, weight: .semibold))
                    .padding(.horizontal, 7).frame(height: 20)
                    .background(Capsule().fill(todos.sortByPriority ? AnyShapeStyle(TodoPriority.high.colour.opacity(0.28)) : AnyShapeStyle(Theme.surface)))
                    .foregroundStyle(todos.sortByPriority ? TodoPriority.high.colour : Theme.textSecondary)
            }
            .buttonStyle(.plain)
            .help(todos.sortByPriority ? "Sorted by priority, red first. Click to show newest first." : "Click to sort by priority, red first.")
        }
    }

    // MARK: Quick add

    private var inputRow: some View {
        HStack(spacing: 6) {
            Menu {
                ForEach(TodoPriority.allCases.reversed()) { p in
                    Button { chosen = p } label: { Label(p.title + " priority", systemImage: chosen == p ? "checkmark" : p.flag) }
                }
            } label: {
                Image(systemName: chosen.flag).foregroundStyle(chosen.colour).font(.system(size: 13))
                    .frame(width: 26, height: 26).background(Theme.surface, in: Circle())
            }
            .menuStyle(.borderlessButton).fixedSize()
            .help("Priority for the next task: \(chosen.title)")
            TextField("Add a task. Try “call mum tomorrow 3pm !!!”", text: $new)
                .textFieldStyle(.plain).font(.system(size: 12)).foregroundStyle(.white)
                .focused($focused)
                .onSubmit(add)
            if entitlements.canUse(.remindersSync) && todos.showReminders {
                Toggle("To Reminders", isOn: $toReminders).toggleStyle(.checkbox).font(.system(size: 10))
            }
            Button("Add", action: add).buttonStyle(PurpleButtonStyle()).disabled(preview == nil)
        }
        .padding(.horizontal, 8).padding(.vertical, 5)
        .background(Theme.surface, in: RoundedRectangle(cornerRadius: 10))
        .overlay(RoundedRectangle(cornerRadius: 10).strokeBorder(Theme.accent.opacity(focused ? 0.8 : 0.25)))
    }

    private func add() {
        guard let parsed = TodoLogic.parse(new) else { return }
        if toReminders && entitlements.canUse(.remindersSync) && todos.showReminders {
            todos.addReminder(parsed.title, due: parsed.due)
        } else {
            todos.add(new, fallback: chosen)     // shows at once, right under the field
        }
        new = ""
        focused = true                            // keep typing: the next task goes straight in
    }

    private func previewText(_ p: TodoLogic.Parsed) -> String {
        var parts: [String] = []
        if let pr = p.priority { parts.append("\(pr.title) priority") }
        if let d = p.due { parts.append("due " + TodoLogic.dueLabel(d)) }
        return parts.joined(separator: " · ")
    }

    // MARK: Rows

    private func row(_ item: TodoItem) -> some View {
        let high = item.priority == .high && !item.done
        return HStack(spacing: 8) {
            Capsule().fill(item.done ? Color.clear : item.priority.colour).frame(width: 3, height: 22)
            Button { withAnimation(Theme.spring) { todos.toggle(item) } } label: {
                Image(systemName: item.done ? "checkmark.circle.fill" : "circle").font(.system(size: 15))
                    .foregroundStyle(item.done ? Color.green : item.priority.colour)
            }
            .buttonStyle(.plain)
            .accessibilityLabel(item.done ? "Mark not done" : "Mark done")
            VStack(alignment: .leading, spacing: 0) {
                Text(item.text).strikethrough(item.done)
                    .foregroundStyle(item.done ? Theme.textSecondary : high ? TodoPriority.high.colour : .white)
                    .font(.system(size: 13, weight: high ? .semibold : .regular)).lineLimit(2)
                if let due = item.due, !item.done {
                    Text(TodoLogic.dueLabel(due)).font(.system(size: 9)).foregroundStyle(TodoLogic.isOverdue(item) ? Color.red : Theme.textSecondary)
                }
            }
            Spacer()
            if !item.done {
                Menu {
                    ForEach(TodoPriority.allCases.reversed()) { p in
                        Button { todos.setPriority(item, p) } label: { Label(p.title, systemImage: item.priority == p ? "checkmark" : p.flag) }
                    }
                } label: { Image(systemName: item.priority.flag).foregroundStyle(item.priority.colour).font(.system(size: 11)) }
                .menuStyle(.borderlessButton).fixedSize().help("Change priority")
            }
            if entitlements.canUse(.remindersSync) {
                Menu {
                    Button("Send to Things") { TodoIntegrations.things(item.text) }
                    Button("Send to Todoist") { TodoIntegrations.todoist(item.text) }
                    Button("Send to Reminders") { todos.addReminder(item.text, due: item.due) }
                } label: { Image(systemName: "paperplane") }
                .menuStyle(.borderlessButton).fixedSize().help("Send to another app")
            }
            IconButton(systemImage: "xmark", help: "Delete") { todos.delete(item) }
        }
        .padding(.horizontal, 6).padding(.vertical, 3)
        .background(high ? TodoPriority.high.colour.opacity(0.13) : Color.clear, in: RoundedRectangle(cornerRadius: 8))
    }

    private var remindersList: some View {
        VStack(spacing: 2) {
            Text("Reminders").sectionTitle().frame(maxWidth: .infinity, alignment: .leading).padding(.top, 8)
            ForEach(todos.reminders, id: \.calendarItemIdentifier) { r in
                HStack(spacing: 8) {
                    Button { withAnimation(Theme.spring) { todos.complete(r) } } label: {
                        Image(systemName: "circle").foregroundStyle(Color(cgColor: r.calendar.cgColor))
                    }
                    .buttonStyle(.plain).accessibilityLabel("Complete \(r.title ?? "reminder")")
                    Text(r.title ?? "").font(.system(size: 13)).foregroundStyle(.white).lineLimit(2)
                    Spacer()
                    if let due = r.dueDateComponents?.date {
                        Text(due.formatted(date: .abbreviated, time: .omitted)).font(.system(size: 10))
                            .foregroundStyle(due < .now ? .orange : Theme.textSecondary)
                    }
                }
                .padding(.horizontal, 8).padding(.vertical, 3)
            }
        }
    }

    private var footer: some View {
        HStack {
            if todos.items.contains(where: \.done) { Button("Clear done") { todos.clearDone() }.buttonStyle(.plain).font(.system(size: 11)).foregroundStyle(Theme.accentBright) }
            Spacer()
            if entitlements.canUse(.remindersSync) {
                Toggle("Show Reminders", isOn: $todos.showReminders).toggleStyle(.switch).controlSize(.mini).font(.system(size: 11))
            } else {
                HStack(spacing: 4) { TierBadge(tier: .pro); Text("Sync with Reminders").font(.system(size: 11)).foregroundStyle(Theme.textSecondary) }
                    .help(Feature.remindersSync.benefit)
            }
        }
    }
}

/// Send a to-do to Things (its URL scheme) or Todoist (your own API token, Settings → Focus). Pro.
@MainActor
enum TodoIntegrations {
    static func things(_ text: String) {
        guard let q = text.addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed),
              let url = URL(string: "things:///add?title=\(q)") else { return }
        if NSWorkspace.shared.urlForApplication(toOpen: url) == nil {
            Notifier.post(title: "Things isn't installed", body: "Install Things 3 to send to-dos to it."); return
        }
        NSWorkspace.shared.open(url)
    }

    static func todoist(_ text: String) {
        guard let token = KeychainHelper.get(.todoistToken), !token.isEmpty else {
            Notifier.post(title: "Add your Todoist token", body: "Settings → Focus → Todoist API token (todoist.com → Settings → Integrations → Developer).")
            AppDelegate.openSettingsWindow(tab: .focus)
            return
        }
        var r = URLRequest(url: URL(string: "https://api.todoist.com/rest/v2/tasks")!)
        r.httpMethod = "POST"
        r.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        r.setValue("application/json", forHTTPHeaderField: "Content-Type")
        r.httpBody = try? JSONSerialization.data(withJSONObject: ["content": text])
        Task {
            let ok = ((try? await URLSession.shared.data(for: r))?.1 as? HTTPURLResponse).map { (200..<300).contains($0.statusCode) } ?? false
            LiveActivityCenter.shared.flash(LiveActivity(symbol: ok ? "checkmark.circle.fill" : "exclamationmark.triangle.fill",
                                                         label: ok ? "Sent to Todoist" : "Todoist failed", tint: ok ? .systemGreen : .systemOrange), seconds: 2)
        }
    }
}
