//
//  AIExtras.swift
//  Notch apple
//
//  Pro additions to the AI tab:
//   • Personas: a standing instruction ("explain like a tutor", "be brief") added to every answer.
//   • Saved prompts: questions you ask often, one click away.
//   • Slash commands: /summarize, /explain, /eli5, /fix, /translate fr: …, /code, /web, /persona, /help.
//   • Web search: the question goes to DuckDuckGo, the top results are given to the model,
//     and the answer lists them as sources.
//   • Voice: dictate a question (Apple's speech recognition, on this Mac when supported)
//     and have answers read aloud.
//   • Clipboard actions: summarise, translate or fix the copied text; the result is copied back.
//

import AppKit
import AVFoundation
import Speech
import SwiftUI

// MARK: - Personas and saved prompts

struct Persona: Codable, Identifiable, Hashable {
    var id = UUID()
    var name: String
    var instructions: String

    static let builtIn: [Persona] = [
        Persona(name: "Tutor", instructions: "Act as a patient tutor: explain step by step, check understanding, and end with one short practice question."),
        Persona(name: "Concise", instructions: "Answer as briefly as possible: a sentence or a short list, no preamble."),
        Persona(name: "Code reviewer", instructions: "Act as a senior engineer reviewing code: point out bugs, risks and simpler alternatives, with corrected snippets."),
        Persona(name: "Writing coach", instructions: "Help improve writing: keep the author's voice, suggest clearer wording, and explain the main changes briefly."),
    ]
}

struct SavedPrompt: Codable, Identifiable, Hashable {
    var id = UUID()
    var title: String
    var text: String
}

@MainActor
final class AIExtras: ObservableObject {
    static let shared = AIExtras()

    @Published var personas: [Persona] { didSet { save(personas, "ai.personas") } }
    @Published var prompts: [SavedPrompt] { didSet { save(prompts, "ai.savedPrompts") } }
    @AppStorage("ai.activePersona") var activePersonaID = ""
    @AppStorage("ai.speakAnswers") var speakAnswers = false

    private init() {
        personas = Self.load("ai.personas") ?? Persona.builtIn
        prompts = Self.load("ai.savedPrompts") ?? [
            SavedPrompt(title: "Summarise my clipboard", text: "/summarize"),
            SavedPrompt(title: "Explain like I'm 12", text: "Explain this like I'm 12: "),
        ]
    }

    var activePersona: Persona? {
        guard Entitlements.shared.canUse(.personas) else { return nil }
        return personas.first { $0.id.uuidString == activePersonaID }
    }

    /// Added to the system prompt for every answer.
    var systemSuffix: String {
        guard let p = activePersona else { return "" }
        return "\n\nStanding instructions from the user (persona \"\(p.name)\"): \(p.instructions)"
    }

    private func save<T: Encodable>(_ value: T, _ key: String) { UserDefaults.standard.set(try? JSONEncoder().encode(value), forKey: key) }
    private static func load<T: Decodable>(_ key: String) -> T? {
        UserDefaults.standard.data(forKey: key).flatMap { try? JSONDecoder().decode(T.self, from: $0) }
    }
}

// MARK: - Voice in, voice out

@MainActor
final class VoiceInput: ObservableObject {
    static let shared = VoiceInput()
    @Published private(set) var isListening = false
    @Published private(set) var problem: String?

    private let engine = AVAudioEngine()
    private var request: SFSpeechAudioBufferRecognitionRequest?
    private var task: SFSpeechRecognitionTask?
    private var onText: ((String) -> Void)?

    func toggle(onText: @escaping (String) -> Void) {
        isListening ? stop() : start(onText: onText)
    }

    func start(onText: @escaping (String) -> Void) {
        problem = nil
        SFSpeechRecognizer.requestAuthorization { status in
            Task { @MainActor in
                guard status == .authorized else {
                    self.problem = "Allow Speech Recognition in System Settings → Privacy & Security to dictate."
                    return
                }
                self.begin(onText: onText)
            }
        }
    }

    private func begin(onText: @escaping (String) -> Void) {
        guard let recognizer = SFSpeechRecognizer(), recognizer.isAvailable else { problem = "Dictation isn't available right now."; return }
        let req = SFSpeechAudioBufferRecognitionRequest()
        req.shouldReportPartialResults = true
        // Stay on this Mac when it can.
        if recognizer.supportsOnDeviceRecognition { req.requiresOnDeviceRecognition = true }
        let input = engine.inputNode
        input.removeTap(onBus: 0)
        input.installTap(onBus: 0, bufferSize: 1024, format: input.outputFormat(forBus: 0)) { buffer, _ in req.append(buffer) }
        do { engine.prepare(); try engine.start() } catch { problem = "Couldn't use the microphone: \(error.localizedDescription)"; return }
        request = req
        self.onText = onText
        isListening = true
        task = recognizer.recognitionTask(with: req) { result, error in
            Task { @MainActor in
                if let result { self.onText?(result.bestTranscription.formattedString) }
                if error != nil || result?.isFinal == true { self.stop() }
            }
        }
    }

    func stop() {
        engine.stop()
        engine.inputNode.removeTap(onBus: 0)
        request?.endAudio()
        task?.cancel()
        request = nil; task = nil
        isListening = false
    }
}

@MainActor
final class Speaker: NSObject, ObservableObject, AVSpeechSynthesizerDelegate {
    static let shared = Speaker()
    @Published private(set) var isSpeaking = false
    private let synth = AVSpeechSynthesizer()

    override init() { super.init(); synth.delegate = self }

    func toggle(_ markdown: String) { isSpeaking ? stop() : speak(markdown) }

    func speak(_ markdown: String) {
        stop()
        // Read the words, not the Markdown and LaTeX.
        let plain = MathText.plain(markdown)
            .replacingOccurrences(of: "```[\\s\\S]*?```", with: " (code) ", options: .regularExpression)
            .replacingOccurrences(of: "[*_#`>|]", with: "", options: .regularExpression)
        synth.speak(AVSpeechUtterance(string: plain))
        isSpeaking = true
    }

    func stop() { synth.stopSpeaking(at: .immediate); isSpeaking = false }

    nonisolated func speechSynthesizer(_ s: AVSpeechSynthesizer, didFinish u: AVSpeechUtterance) {
        Task { @MainActor in self.isSpeaking = false }
    }
}

// MARK: - Clipboard actions

@MainActor
enum ClipboardAI {
    enum Action: String, CaseIterable, Identifiable {
        case summarize, fix, translate, explain
        var id: String { rawValue }
        var title: String {
            switch self {
            case .summarize: "Summarise"
            case .fix: "Fix grammar"
            case .translate: "Translate to English"
            case .explain: "Explain"
            }
        }
        var instruction: String {
            switch self {
            case .summarize: "Summarise this in a few short bullet points. Reply with the summary only."
            case .fix: "Fix the grammar, spelling and punctuation of this text. Keep the wording and tone. Reply with the corrected text only."
            case .translate: "Translate this into English. Reply with the translation only."
            case .explain: "Explain this briefly and clearly."
            }
        }
    }

    /// Runs `action` on `text` with the chosen AI provider and copies the result.
    static func run(_ action: Action, on text: String) {
        guard Entitlements.shared.canUse(.clipboardAI) else { return }
        let config = AIConfig.shared
        LiveActivityCenter.shared.flash(LiveActivity(symbol: "sparkles", label: "\(action.title)…", tint: NSColor(Theme.accentBright)), seconds: 3)
        Task {
            var out = ""
            do {
                let msg = ChatMessage(role: .user, text: "\(action.instruction)\n\n---\n\(text.prefix(20_000))")
                for try await piece in AIClient.stream([msg], provider: config.provider, model: config.model, system: AIClient.system(for: nil)) { out += piece }
                NSPasteboard.general.clearContents()
                NSPasteboard.general.setString(MathText.plain(out), forType: .string)
                LiveActivityCenter.shared.flash(LiveActivity(symbol: "doc.on.clipboard.fill", label: "Copied", tint: .systemGreen), seconds: 2)
            } catch {
                LiveActivityCenter.shared.flash(LiveActivity(symbol: "exclamationmark.triangle.fill", label: "AI failed", tint: .systemOrange), seconds: 3)
                Notifier.post(title: "Clipboard AI didn't work", body: error.localizedDescription)
            }
        }
    }
}

// MARK: - UI

/// The AI tab's toolbar menu: persona, saved prompts, web search, voice, read aloud.
struct AIExtrasBar: View {
    @ObservedObject var model: ClaudeChatModel
    @ObservedObject private var extras = AIExtras.shared
    @ObservedObject private var voice = VoiceInput.shared
    @ObservedObject private var speaker = Speaker.shared
    @ObservedObject private var entitlements = Entitlements.shared

    var body: some View {
        HStack(spacing: 4) {
            Menu {
                Button(extras.activePersona == nil ? "✓ No persona" : "No persona") { extras.activePersonaID = "" }
                ForEach(extras.personas) { p in
                    Button((extras.activePersona?.id == p.id ? "✓ " : "") + p.name) {
                        if model.allowed(.personas) { extras.activePersonaID = p.id.uuidString }
                    }
                }
                Divider()
                Button("Edit personas and prompts…") { AppDelegate.openSettingsWindow(tab: .claude) }
            } label: {
                Image(systemName: extras.activePersona == nil ? "person.crop.circle" : "person.crop.circle.fill")
            }
            .menuStyle(.borderlessButton).fixedSize()
            .help(extras.activePersona.map { "Persona: \($0.name)" } ?? "Persona (Pro)")

            Menu {
                ForEach(extras.prompts) { p in
                    Button(p.title) {
                        guard model.allowed(.personas) else { return }
                        model.draft = p.text
                        if !p.text.hasSuffix(" ") && !p.text.hasSuffix(":") { model.send() }
                    }
                }
                if extras.prompts.isEmpty { Text("No saved prompts yet") }
                Divider()
                Button("Save what I've typed") {
                    guard model.allowed(.personas), !model.draft.isEmpty else { return }
                    extras.prompts.append(SavedPrompt(title: String(model.draft.prefix(40)), text: model.draft))
                }
                .disabled(model.draft.isEmpty)
            } label: { Image(systemName: "text.badge.star") }
            .menuStyle(.borderlessButton).fixedSize()
            .help("Saved prompts (Pro)")

            Toggle(isOn: Binding(get: { model.webSearch }, set: { on in if !on || model.allowed(.webSearch) { model.webSearch = on } })) {
                Image(systemName: "globe")
            }
            .toggleStyle(.button).buttonStyle(.plain)
            .foregroundStyle(model.webSearch ? Theme.accentBright : Theme.textSecondary)
            .help(model.webSearch ? "Web search on: answers cite their sources" : "Search the web for the next answers (Pro)")
            .accessibilityLabel("Web search")

            Button {
                guard model.allowed(.voice) else { return }
                voice.toggle { text in model.draft = text }
            } label: { Image(systemName: voice.isListening ? "mic.fill" : "mic") }
            .buttonStyle(.plain)
            .foregroundStyle(voice.isListening ? .red : Theme.textSecondary)
            .help(voice.isListening ? "Stop dictating" : "Dictate your question (Pro)")
            .accessibilityLabel(voice.isListening ? "Stop dictating" : "Dictate")

            Button {
                guard model.allowed(.voice), let a = model.lastAnswer else { return }
                speaker.toggle(a.text)
            } label: { Image(systemName: speaker.isSpeaking ? "speaker.slash.fill" : "speaker.wave.2") }
            .buttonStyle(.plain).foregroundStyle(Theme.textSecondary)
            .disabled(model.lastAnswer == nil)
            .help(speaker.isSpeaking ? "Stop reading" : "Read the answer aloud (Pro)")
            .accessibilityLabel(speaker.isSpeaking ? "Stop reading" : "Read aloud")
        }
        .font(.system(size: 13))
        .onChange(of: voice.problem) { _, p in if let p { model.error = p } }
    }
}

/// Settings → AI: personas and saved prompts (Pro).
struct PersonasSettings: View {
    @ObservedObject private var extras = AIExtras.shared
    @ObservedObject private var entitlements = Entitlements.shared
    @State private var name = ""
    @State private var instructions = ""

    var body: some View {
        Section {
            ForEach($extras.personas) { $p in
                VStack(alignment: .leading, spacing: 4) {
                    HStack {
                        TextField("Name", text: $p.name).font(.headline)
                        Button(role: .destructive) { extras.personas.removeAll { $0.id == p.id } } label: { Image(systemName: "trash") }
                            .buttonStyle(.borderless)
                    }
                    TextField("Instructions", text: $p.instructions, axis: .vertical).lineLimit(1...4).font(.callout)
                }
            }
            HStack {
                TextField("New persona name", text: $name)
                TextField("What it should do", text: $instructions)
                Button("Add") {
                    extras.personas.append(Persona(name: name, instructions: instructions)); name = ""; instructions = ""
                }.disabled(name.isEmpty || instructions.isEmpty)
            }
            Toggle("Read every answer aloud", isOn: $extras.speakAnswers)
        } header: {
            HStack(spacing: 6) {
                Text("Personas")
                if !entitlements.canUse(.personas) { TierBadge(tier: .pro) }
            }
        } footer: {
            Text("Pick a persona from the person icon in the AI tab; its instructions are added to every answer. Slash commands: \(SlashCommand.helpText).")
        }
        .disabled(!entitlements.canUse(.personas))

        Section {
            ForEach($extras.prompts) { $p in
                HStack {
                    TextField("Title", text: $p.title).frame(width: 180)
                    TextField("Prompt", text: $p.text)
                    Button(role: .destructive) { extras.prompts.removeAll { $0.id == p.id } } label: { Image(systemName: "trash") }
                        .buttonStyle(.borderless)
                }
            }
            Button("Add a prompt") { extras.prompts.append(SavedPrompt(title: "New prompt", text: "")) }
        } header: {
            Text("Saved prompts")
        } footer: {
            Text("A prompt ending in a space or colon is put in the box for you to finish; anything else is sent straight away.")
        }
        .disabled(!entitlements.canUse(.personas))
    }
}
