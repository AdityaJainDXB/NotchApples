//
//  AIAutomations.swift
//  Notch apple
//
//  AI automations (Ultimate): prompts that run on a schedule, like "every
//  weekday at 8:00, summarise my calendar". The answer arrives as a
//  notification and is saved in AI History, where you can keep asking.
//
//  They run with the AI provider chosen in Settings → AI (Ollama or Apple
//  Intelligence keep it on this Mac). Calendar context is read on this Mac
//  with EventKit and only included when you choose it.
//

import AppKit
import EventKit
import SwiftUI

@MainActor
final class AIAutomations: ObservableObject {
    static let shared = AIAutomations()
    @Published var items: [Automation] { didSet { UserDefaults.standard.set(try? JSONEncoder().encode(items), forKey: key) } }
    @Published private(set) var running: Set<UUID> = []
    private let key = "ai.automations"

    private init() {
        items = UserDefaults.standard.data(forKey: key).flatMap { try? JSONDecoder().decode([Automation].self, from: $0) } ?? []
    }

    /// Called by the 30-second heartbeat.
    func checkDue() {
        guard Entitlements.shared.canUse(.automations) else { return }
        for a in items where a.isDue() && !running.contains(a.id) { run(a) }
    }

    func run(_ a: Automation) {
        guard Entitlements.shared.canUse(.automations) else { return }
        running.insert(a.id)
        if let i = items.firstIndex(where: { $0.id == a.id }) { items[i].lastRun = .now }
        let config = AIConfig.shared
        Task {
            defer { running.remove(a.id) }
            var text = a.prompt
            switch a.context {
            case .none: break
            case .calendar: text += "\n\n---\nMy calendar today:\n" + Self.todaysEvents()
            case .clipboard: text += "\n\n---\n" + (NSPasteboard.general.string(forType: .string)?.prefix(15_000).description ?? "(the clipboard is empty)")
            }
            var reply = ""
            do {
                for try await piece in AIClient.stream([ChatMessage(role: .user, text: text)], provider: config.provider, model: config.model,
                                                       system: AIClient.system(for: nil) + AIExtras.shared.systemSuffix) { reply += piece }
            } catch {
                Notifier.post(title: "\(a.name) didn't run", body: error.localizedDescription)
                return
            }
            let session = UUID(), history = ChatHistoryStore.shared
            history.record(sessionID: session, provider: config.provider, model: config.model, role: "user", text: "⏰ \(a.name)", hadScreenshot: false)
            history.record(sessionID: session, provider: config.provider, model: config.model, role: "assistant", text: reply, hadScreenshot: false)
            Notifier.post(title: a.name, body: String(MathText.plain(reply).prefix(240)))
        }
    }

    /// "09:00–09:30 Standup (Zoom)" lines, read on this Mac.
    static func todaysEvents() -> String {
        guard EKEventStore.authorizationStatus(for: .event) == .fullAccess else { return "(Calendar access isn't allowed: Settings → Permissions.)" }
        let store = EKEventStore(), cal = Calendar.current
        let start = cal.startOfDay(for: .now), end = cal.date(byAdding: .day, value: 1, to: start)!
        let f = DateFormatter(); f.timeStyle = .short; f.dateStyle = .none
        let events = store.events(matching: store.predicateForEvents(withStart: start, end: end, calendars: nil)).sorted { $0.startDate < $1.startDate }
        if events.isEmpty { return "(Nothing scheduled.)" }
        return events.map { e in
            let when = e.isAllDay ? "All day" : "\(f.string(from: e.startDate))–\(f.string(from: e.endDate))"
            return "\(when) \(e.title ?? "Event")" + ((e.location ?? "").isEmpty ? "" : " (\(e.location!))")
        }.joined(separator: "\n")
    }
}

/// Settings → AI → Automations (Ultimate).
struct AutomationsSettings: View {
    @ObservedObject private var store = AIAutomations.shared
    @ObservedObject private var entitlements = Entitlements.shared
    private let days = ["S", "M", "T", "W", "T", "F", "S"]

    var body: some View {
        Section {
            ForEach($store.items) { $a in
                VStack(alignment: .leading, spacing: 6) {
                    HStack {
                        Toggle("", isOn: $a.enabled).labelsHidden().toggleStyle(.switch).controlSize(.small)
                        TextField("Name", text: $a.name).font(.headline)
                        Button(store.running.contains(a.id) ? "Running…" : "Run now") { store.run(a) }
                            .disabled(store.running.contains(a.id))
                        Button(role: .destructive) { store.items.removeAll { $0.id == a.id } } label: { Image(systemName: "trash") }
                            .buttonStyle(.borderless)
                    }
                    TextField("What should the AI do?", text: $a.prompt, axis: .vertical).lineLimit(1...4)
                    HStack {
                        DatePicker("At", selection: Binding(
                            get: { Calendar.current.date(bySettingHour: a.hour, minute: a.minute, second: 0, of: .now) ?? .now },
                            set: { a.hour = Calendar.current.component(.hour, from: $0); a.minute = Calendar.current.component(.minute, from: $0) }),
                                   displayedComponents: .hourAndMinute).fixedSize()
                        ForEach(1...7, id: \.self) { d in
                            Button(days[d - 1]) {
                                if a.weekdays.contains(d) { a.weekdays.remove(d) } else { a.weekdays.insert(d) }
                            }
                            .buttonStyle(.bordered).tint(a.weekdays.contains(d) ? Theme.accent : .gray)
                            .controlSize(.small)
                            .accessibilityLabel(Calendar.current.weekdaySymbols[d - 1])
                            .accessibilityValue(a.weekdays.contains(d) ? "On" : "Off")
                        }
                        Spacer()
                        Picker("Include", selection: $a.context) {
                            ForEach(Automation.Context.allCases) { Text($0.title).tag($0) }
                        }.fixedSize()
                    }
                    if let last = a.lastRun {
                        Text("Last ran \(last.formatted(.relative(presentation: .named))).").font(.caption).foregroundStyle(.secondary)
                    }
                }
                .padding(.vertical, 4)
            }
            Button("Add an automation") { store.items.append(Automation()) }
        } header: {
            HStack(spacing: 6) {
                Text("Automations")
                if !entitlements.canUse(.automations) { TierBadge(tier: .ultimate) }
            }
        } footer: {
            Text("Runs while your Mac is awake (a missed time runs when it wakes, up to 6 hours later). The answer arrives as a notification and is saved in AI History.")
        }
        .disabled(!entitlements.canUse(.automations))
    }
}
