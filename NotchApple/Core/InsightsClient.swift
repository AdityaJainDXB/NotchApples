//
//  InsightsClient.swift
//  Notch Apple
//
//  Anonymous, opt-in usage counting and the feedback box. Nothing is sent until the person says yes (Settings → Privacy,
//  or the box on the feedback card), and what is sent is only: a random id made on this Mac (not tied to a name, an
//  email or a licence), the app version, "mac", the macOS version and the plan. No IP address is kept by the server.
//  Feedback and problem notes are sent only when the person presses Send, and contain only what they typed.
//  The feedback card appears when the notch is opened, about every three to four weeks; Not now skips it.
//

import Foundation
import SwiftUI

@MainActor
final class Insights: ObservableObject {
    static let shared = Insights()

    enum Kind: String, CaseIterable, Identifiable {
        case idea, problem, praise
        var id: String { rawValue }
        var title: String { switch self { case .idea: "Idea"; case .problem: "Problem"; case .praise: "Praise" } }
        var prompt: String {
            switch self {
            case .idea: "What would you like Notch Apple to do?"
            case .problem: "What went wrong? What were you doing?"
            case .praise: "What do you like?"
            }
        }
    }

    /// "" = not asked yet, "yes", "no".
    @AppStorage("insights.choice") var choice = ""
    @AppStorage("insights.installId") private var installId = ""
    @AppStorage("insights.lastPing") private var lastPing = 0.0
    @AppStorage("insights.surveyNextAt") private var surveyNextAt = 0.0
    @Published var surveyDue = false

    var sharing: Bool { choice == "yes" }

    /// A random id made once on this Mac.
    var id: String {
        if installId.count != 32 { installId = UUID().uuidString.replacingOccurrences(of: "-", with: "").lowercased() }
        return installId
    }

    static var version: String { Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String ?? "0.0" }
    static var system: String { let v = ProcessInfo.processInfo.operatingSystemVersion; return "\(v.majorVersion).\(v.minorVersion)" }

    func setSharing(_ on: Bool) {
        choice = on ? "yes" : "no"
        if on { lastPing = 0; pingIfDue() }
    }

    /// Says hello at most once every six hours, and only while sharing is on.
    func pingIfDue() {
        guard sharing, !DemoHooks.isDemo, Date().timeIntervalSince1970 - lastPing > 6 * 3600 else { return }
        lastPing = Date().timeIntervalSince1970
        let body = ["id": id, "v": Self.version, "os": "mac", "osv": Self.system, "tier": String(Entitlements.shared.tier.rawValue)]
        Task { if let base = await LicenseServer.url() { _ = await LicenseServer.post(base, "telemetry/ping", body) } }
    }

    /// Returns nil when it went through, or a plain-language reason.
    func send(_ kind: Kind, text: String) async -> String? {
        let clean = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard clean.count >= 3 else { return "Write a few words first." }
        guard let base = await LicenseServer.url() else { return "Couldn't reach the server. Try again later." }
        let body = ["id": id, "v": Self.version, "os": "mac", "kind": kind.rawValue, "text": String(clean.prefix(1000))]
        guard let reply = await LicenseServer.post(base, kind == .problem ? "telemetry/glitch" : "feedback", body) else { return "Couldn't reach the server. Try again later." }
        if let error = reply["error"] as? String { return error }
        return nil
    }

    // MARK: The survey

    /// Called whenever the notch opens: after two weeks of use the first time, then every three to four weeks.
    func noteNotchOpened() {
        guard !DemoHooks.isDemo, !surveyDue else { return }
        let now = Date().timeIntervalSince1970
        if surveyNextAt == 0 { surveyNextAt = now + 14 * 86_400; return }
        if now >= surveyNextAt { surveyDue = true }
    }

    func dismissSurvey() {
        surveyDue = false
        surveyNextAt = Date().timeIntervalSince1970 + Double(Int.random(in: 21...28)) * 86_400
    }

    /// Settings → Help & Feedback: open the card now.
    func askNow() {
        surveyDue = true
        AppDelegate.current?.notch?.expand()
    }
}
