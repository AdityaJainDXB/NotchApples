//
//  NotchAIDictation.swift
//  Notch Apple
//
//  Dictation into other apps. Press Dictate, speak, and the text appears in an editable box; Insert puts it into the
//  text field you were just using, Cancel (or saying "cancel that") throws it away. Nothing is typed until you press
//  Insert, and nothing is sent anywhere: recognition is on this Mac (the app's VoiceInput) and the text goes only to
//  that field.
//
//  Insertion sets the focused field's selected text through the Accessibility API (needs the Accessibility permission),
//  so it lands exactly at the cursor. There is NO clipboard fallback: if the field does not accept text, you are told.
//  Spoken punctuation, filler words and your own vocabulary corrections are applied by NotchAIDictationLogic.
//

import AppKit
import ApplicationServices
import Combine
import SwiftUI

@MainActor
final class NotchAIDictation: ObservableObject {
    static let shared = NotchAIDictation()

    @Published var text = ""
    @Published private(set) var listening = false
    @Published private(set) var status: String?
    @AppStorage("notchai.dictation.vocab") private var vocabJSON = "{}"

    var vocabulary: [String: String] {
        get { (try? JSONDecoder().decode([String: String].self, from: Data(vocabJSON.utf8))) ?? [:] }
        set { objectWillChange.send(); vocabJSON = String(decoding: (try? JSONEncoder().encode(newValue)) ?? Data("{}".utf8), as: UTF8.self) }
    }

    private var raw = ""
    private var bag = Set<AnyCancellable>()

    private init() {
        VoiceInput.shared.$isListening.dropFirst().removeDuplicates().sink { [weak self] on in
            guard let self, self.listening, !on else { return }
            self.listening = false
            if NotchAIDictationLogic.isCancelCommand(self.raw) { self.text = ""; self.status = "Cancelled."; return }
            self.text = NotchAIDictationLogic.clean(self.raw, vocabulary: self.vocabulary)
            self.status = self.text.isEmpty ? "Nothing was heard." : "Check the text, then press Insert."
        }.store(in: &bag)
    }

    func toggle() {
        if listening { VoiceInput.shared.stop(); return }
        status = nil; raw = ""; text = ""; listening = true
        VoiceInput.shared.start { [weak self] heard in self?.raw = heard; self?.text = NotchAIDictationLogic.clean(heard, vocabulary: self?.vocabulary ?? [:]) }
    }

    @Published private(set) var drafting = false

    /// Screen-aware drafting: what is in the box is the instruction; the window you were using is read once, now,
    /// and the model's draft replaces the instruction in the box for you to check before Insert.
    func draftFromScreen() {
        guard !drafting, !listening else { return }
        let instruction = text
        if let p = ScreenDraftLogic.problem(instruction: instruction, proAllowed: NotchAITier.allows(.pro), screenOn: ScreenIntelligence.shared.isOn) { status = p; return }
        drafting = true; status = "Reading the window and drafting…"
        Task {
            defer { drafting = false }
            do {
                let seen = try await ScreenIntelligence.shared.captureForAgent(scope: .window)
                let reply = try await AgentModelClient.complete(agent: "screen", system: ScreenDraftLogic.system,
                                                                user: ScreenDraftLogic.prompt(instruction: instruction, appName: seen.appName, windowTitle: seen.windowTitle, screenText: seen.ocrText))
                let draft = ScreenDraftLogic.clean(reply)
                guard !draft.isEmpty else { status = "The model returned nothing to insert."; return }
                text = draft; raw = draft
                status = "Drafted from \(seen.appName). Check it, then press Insert."
            } catch { status = error.localizedDescription }
        }
    }

    func cancel() { if listening { listening = false; VoiceInput.shared.stop() }; text = ""; raw = ""; status = nil }

    func setWord(_ heard: String, meaning: String) {
        let h = heard.trimmingCharacters(in: .whitespaces), m = meaning.trimmingCharacters(in: .whitespaces)
        guard !h.isEmpty, !m.isEmpty else { return }
        var v = vocabulary; v[h.lowercased()] = m; vocabulary = v
    }

    func removeWord(_ heard: String) { var v = vocabulary; v.removeValue(forKey: heard); vocabulary = v }

    /// Puts the text into the focused field of the app the user was just in. Never uses the clipboard.
    func insert() {
        let t = text
        guard !t.isEmpty else { return }
        guard AXIsProcessTrusted() else {
            status = "Allow Notch Apple in System Settings → Privacy & Security → Accessibility to insert text."
            return
        }
        guard let app = ScreenIntelligence.shared.lastExternalApp else { status = "Click the text field you want first."; return }
        let axApp = AXUIElementCreateApplication(app.processIdentifier)
        var focused: CFTypeRef?
        guard AXUIElementCopyAttributeValue(axApp, kAXFocusedUIElementAttribute as CFString, &focused) == .success, let el = focused else {
            status = "No text field is selected in \(app.localizedName ?? "that app")."; return
        }
        let result = AXUIElementSetAttributeValue(el as! AXUIElement, kAXSelectedTextAttribute as CFString, t as CFTypeRef)
        if result == .success { status = "Inserted into \(app.localizedName ?? "the app")."; text = ""; raw = "" }
        else { status = "That field does not accept dictated text (\(result.rawValue)). Nothing was typed, and the clipboard was not used." }
    }
}
