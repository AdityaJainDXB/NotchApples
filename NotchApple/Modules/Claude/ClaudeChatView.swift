//
//  ClaudeChatView.swift
//  Notch apple
//
//  The AI tab: see something → capture it → understand or act on it.
//
//   • Input: a capture (⌃⌥S), a pasted or dropped image or PDF, copied or
//     selected text, or just a question.
//   • Modes (AIModes.swift) run on the input with one click; suggestions come
//     from a quick look at the text on this Mac.
//   • Replies stream in; Stop keeps what arrived, Retry asks again with the
//     current provider, follow-ups keep the image and earlier answers as context.
//   • Every task is saved to local history (Settings → AI History) unless off.
//

import AppKit
import PDFKit
import SwiftUI

/// Which AI provider and model the AI tab uses. Persisted; one model per provider.
@MainActor
final class AIConfig: ObservableObject {
    static let shared = AIConfig()

    @AppStorage("ai.provider") private var providerRaw = ""

    init() {
        // People who already use AI (a saved key or chat history) skip the first-run setup card.
        let d = UserDefaults.standard
        if !d.bool(forKey: "ai.setupDone"),
           AIProvider.allCases.contains(where: { $0.needsKey && $0.apiKey != nil }) || !(d.string(forKey: "ai.provider") ?? "").isEmpty {
            d.set(true, forKey: "ai.setupDone")
        }
    }
    @AppStorage("ai.models") private var modelsJSON = "{}"
    @Published private(set) var availableModels: [AIProvider: [String]] = [:]
    @Published private(set) var loadingModels = false
    @Published private(set) var modelError: String?

    var provider: AIProvider {
        get {
            if let p = AIProvider(rawValue: providerRaw) { return p }
            // Existing Claude users keep Claude; everyone else starts on free Gemini.
            return AIProvider.claude.apiKey != nil ? .claude : .gemini
        }
        set { objectWillChange.send(); providerRaw = newValue.rawValue; refreshModels() }
    }

    private var chosen: [String: String] {
        get { (try? JSONDecoder().decode([String: String].self, from: Data(modelsJSON.utf8))) ?? [:] }
        set { modelsJSON = String(decoding: (try? JSONEncoder().encode(newValue)) ?? Data("{}".utf8), as: UTF8.self) }
    }

    func model(for p: AIProvider) -> String {
        if let m = chosen[p.rawValue], !m.isEmpty { return m }
        if p == .claude, let legacy = UserDefaults.standard.string(forKey: "claude.model") { return legacy }
        return availableModels[p]?.first ?? p.fallbackModel
    }

    var model: String { model(for: provider) }

    func setModel(_ m: String, for p: AIProvider) {
        objectWillChange.send()
        var c = chosen; c[p.rawValue] = m; chosen = c
    }

    func refreshModels() {
        let p = provider
        guard p.isConfigured else { return }
        loadingModels = true
        modelError = nil
        Task {
            do { availableModels[p] = try await AIClient.models(for: p) }
            catch { modelError = error.localizedDescription }
            loadingModels = false
        }
    }
}


@MainActor
final class ClaudeChatModel: ObservableObject {
    static let shared = ClaudeChatModel()   // survives notch open/close

    @Published var messages: [ChatMessage] = []
    @Published var draft = ""
    @Published var attachScreen = false
    @Published var isSending = false
    @Published var error: String?
    /// Shown under the chat, e.g. when a screenshot was attached automatically.
    @Published var notice: String?
    /// A Pro feature someone tried (capture, files, history); shows what it does and how to unlock it.
    @Published var locked: Feature?

    // The current task's input: a capture / pasted / dropped image, or text.
    @Published private(set) var input: CapturedInput?
    @Published private(set) var inputThumbnail: NSImage?
    @Published private(set) var textInput: String?
    @Published private(set) var detected: InputClassifier.Result?
    @AppStorage("ai.lastMode") private var lastModeRaw = AIMode.explain.rawValue
    var mode: AIMode {
        get { AIMode(rawValue: lastModeRaw) ?? .explain }
        set { objectWillChange.send(); lastModeRaw = newValue.rawValue }
    }

    /// The saved-history session this conversation belongs to.
    private(set) var sessionID = UUID()
    private var running: Task<Void, Never>?
    /// The request behind the latest reply, for Retry.
    private var lastRequest: (provider: AIProvider, model: String)?

    /// Share the screen automatically when a question is about it (Settings → AI).
    @AppStorage("ai.autoScreen") var autoScreen = true

    var hasTask: Bool { input != nil || textInput != nil || !messages.isEmpty }
    var lastAnswer: ChatMessage? { messages.last { $0.role == .assistant } }

    // MARK: Input

    /// Starts a new task from a capture, pasted or dropped image.
    func setInput(_ newInput: CapturedInput) {
        guard allowed(.aiFileDrop) else { return }
        startNewTask()
        input = newInput
        inputThumbnail = ImagePrep.thumbnail(newInput.image)
        Task {
            let result = await InputClassifier.classify(newInput.image)
            if input?.image === newInput.image { detected = result }
        }
    }

    /// Starts a new task from text (copied or selected text, or a dropped PDF's text).
    func setTextInput(_ text: String, source: String) {
        startNewTask()
        textInput = String(text.prefix(30_000))
        detected = InputClassifier.classify(text: text)
        notice = source
    }

    func clearInput() { startNewTask() }

    /// The clipboard's image, file or text becomes the input. Returns false if there's nothing usable.
    @discardableResult
    func pasteFromClipboard() -> Bool {
        let pb = NSPasteboard.general
        if let urls = pb.readObjects(forClasses: [NSURL.self], options: [.urlReadingFileURLsOnly: true]) as? [URL], let url = urls.first,
           load(file: url) { return true }
        if let image = NSImage(pasteboard: pb), let cg = image.cgImage(forProposedRect: nil, context: nil, hints: nil) {
            guard allowed(.aiFileDrop) else { return false }
            setInput(CapturedInput(image: cg, source: "Pasted image · \(cg.width) × \(cg.height)", kind: .clipboard))
            return true
        }
        if let text = pb.string(forType: .string)?.trimmingCharacters(in: .whitespacesAndNewlines), !text.isEmpty {
            setTextInput(text, source: "Using the text you copied")
            return true
        }
        error = "There's no image or text on the clipboard. Copy something first (⌃⇧⌘4 copies part of the screen)."
        return false
    }

    /// An image or PDF file (dragged in or copied in Finder).
    @discardableResult
    func load(file url: URL) -> Bool {
        guard allowed(.aiFileDrop) else { return false }
        let ext = url.pathExtension.lowercased()
        if ext == "pdf", let doc = PDFDocument(url: url) {
            let text = doc.string?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
            if text.count > 40 {
                setTextInput(text, source: "Using the text of \(url.lastPathComponent) (\(doc.pageCount) page\(doc.pageCount == 1 ? "" : "s"))")
                return true
            }
            if let page = doc.page(at: 0) {
                let thumb = page.thumbnail(of: NSSize(width: 1600, height: 2200), for: .mediaBox)
                if let cg = thumb.cgImage(forProposedRect: nil, context: nil, hints: nil) {
                    setInput(CapturedInput(image: cg, source: "\(url.lastPathComponent) · page 1", kind: .file))
                    return true
                }
            }
        }
        if let image = NSImage(contentsOf: url), let cg = image.cgImage(forProposedRect: nil, context: nil, hints: nil) {
            setInput(CapturedInput(image: cg, source: "\(url.lastPathComponent) · \(cg.width) × \(cg.height)", kind: .file))
            return true
        }
        error = "\(url.lastPathComponent) isn't an image or PDF Notch apple can read. Try PNG, JPEG, WEBP, HEIC or PDF."
        return false
    }

    /// Text selected in the front app (needs Accessibility permission).
    func useSelectedText() {
        guard allowed(.aiCapture) else { return }
        if let text = SelectedText.read(), !text.isEmpty {
            setTextInput(text, source: "Using the text you selected")
        } else {
            error = SelectedText.isTrusted
                ? "No selected text found. Select some text in an app first (some apps don't share their selection; copy it and use Paste instead)."
                : "Reading selected text needs Accessibility permission (System Settings → Privacy & Security → Accessibility). You can copy the text and use Paste instead."
        }
    }

    /// True if this Mac has `feature`; otherwise shows the upsell for it instead.
    func allowed(_ feature: Feature) -> Bool {
        if Entitlements.shared.canUse(feature) { return true }
        locked = feature
        return false
    }

    // MARK: Running a mode

    /// Runs `mode` on the current input (with an optional note from the draft).
    func run(_ chosen: AIMode) {
        guard !isSending else { return }
        mode = chosen
        let note = draft
        draft = ""
        if chosen == .extract, let input {
            runLocalExtract(input)
            return
        }
        var instruction = chosen.instruction(extra: note)
        if let textInput { instruction += "\n\n---\n\(textInput)" }
        var message = ChatMessage(role: .user, text: instruction, display: note.isEmpty ? chosen.title : "\(chosen.title): \(note)")
        if let input { message.imageBase64 = ImagePrep.base64(input.image) }
        messages = [message]
        sessionID = UUID()
        request(firstOfTask: true)
    }

    /// Extract text runs on this Mac, so nothing leaves it.
    private func runLocalExtract(_ input: CapturedInput) {
        messages = [ChatMessage(role: .user, text: "Extract text", display: "Extract text")]
        sessionID = UUID()
        isSending = true
        error = nil
        running = Task {
            let text = await InputClassifier.recognizeText(input.image, fast: false)
            if Task.isCancelled { isSending = false; return }
            if text.isEmpty {
                notice = "No text found on this Mac, so the image was sent to \(AIConfig.shared.provider.title) instead."
                var msg = messages[0]
                msg.text = AIMode.extract.instruction(extra: "")
                msg.imageBase64 = ImagePrep.base64(input.image)
                messages[0] = msg
                isSending = false
                request(firstOfTask: true)
                return
            }
            notice = "Extracted on this Mac with Apple's text recognition; nothing was sent anywhere."
            messages.append(ChatMessage(role: .assistant, text: text, model: "On-device text recognition"))
            record(user: messages[0], reply: messages[1], provider: AIConfig.shared.provider, model: "On-device text recognition")
            isSending = false
        }
    }

    /// Sends the draft: starts a task on the current input, or asks a follow-up.
    func send() {
        let prompt = draft.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !isSending else { return }
        if messages.isEmpty, input != nil || textInput != nil {
            run(prompt.isEmpty ? mode : (mode == .ask || mode == .extract ? .ask : mode))
            return
        }
        guard !prompt.isEmpty else { return }
        draft = ""
        send(prompt)
    }

    /// Sends `prompt`, attaching a screenshot if asked to or if the question is about the screen.
    func send(_ prompt: String, forceScreen: Bool = false) {
        guard !isSending else { return }
        error = nil
        notice = nil
        let config = AIConfig.shared

        // "What's on my screen?" → take a screenshot automatically.
        if !attachScreen && messages.isEmpty && input == nil && (forceScreen || (autoScreen && ScreenIntent.matches(prompt))),
           forceScreen ? allowed(.aiCapture) : Entitlements.shared.canUse(.aiCapture) {
            if config.provider.likelySupportsVision(config.model) {
                attachScreen = true
                notice = "Took a screenshot to answer that (Notch apple itself is left out)."
            } else {
                notice = "\(config.model) can't see images, so no screenshot was sent. Switch to Gemini or a vision model to ask about your screen."
            }
        }
        let first = messages.isEmpty
        Task {
            var message = ChatMessage(role: .user, text: prompt)
            if attachScreen {
                attachScreen = false
                if let screen = CaptureManager.screenUnderPointer {
                    do {
                        let image = try await CaptureManager.captureDisplay(screen)
                        message.imageBase64 = ImagePrep.base64(image)
                        if first { input = CapturedInput(image: image, source: "Whole display · \(screen.localizedName)", kind: .display)
                                   inputThumbnail = ImagePrep.thumbnail(image) }
                    } catch { self.error = error.localizedDescription }
                }
            }
            messages.append(message)
            if first { sessionID = UUID() }
            request(firstOfTask: first)
        }
    }

    /// Streams a reply to the conversation so far.
    private func request(firstOfTask: Bool) {
        let config = AIConfig.shared
        let provider = config.provider, model = config.model
        error = nil
        if messages.contains(where: { $0.imageBase64 != nil }) && !provider.likelySupportsVision(model) {
            error = AIFailure.visionUnsupported(model).localizedDescription
            return
        }
        if provider == .ollama { notice = notice ?? "Answered on this Mac with Ollama; nothing leaves your Mac." }
        isSending = true
        lastRequest = (provider, model)
        let userTurn = messages.last { $0.role == .user }
        let history = messages
        let reply = ChatMessage(role: .assistant, text: "", model: model)
        messages.append(reply)
        let replyID = reply.id
        let modeNow = firstOfTask ? mode : nil

        running = Task {
            do {
                if provider == .openRouter {
                    // Free OpenRouter models are often busy or can't read images: retry and fall back to ones that can.
                    let outcome = try await OpenRouterFallback.run(
                        chosen: model, needsImages: history.contains { $0.imageBase64 != nil },
                        models: await OpenRouterFallback.models()) { candidate in
                            try await AIClient.send(history, provider: .openRouter, model: candidate)
                        }
                    update(replyID) { $0.text = outcome.reply; $0.model = outcome.model }
                    if let note = outcome.note {
                        notice = "\(note), so \(outcome.model) answered."
                        if outcome.shouldSwitch { config.setModel(outcome.model, for: .openRouter) }
                    }
                } else {
                    for try await piece in AIClient.stream(history, provider: provider, model: model, system: AIClient.system(for: modeNow)) {
                        update(replyID) { $0.text += piece }
                    }
                }
                if Task.isCancelled { update(replyID) { $0.stopped = true } }
            } catch is CancellationError {
                update(replyID) { $0.stopped = true }
            } catch AIFailure.modelUnavailable(let gone) {
                // The saved model was retired: switch to the provider's current one and say so.
                let live = (try? await AIClient.models(for: provider)) ?? []
                if let replacement = live.first(where: { $0 != gone }) {
                    config.setModel(replacement, for: provider)
                    config.refreshModels()
                    self.error = "\(gone) isn't available any more, so Notch apple switched to \(replacement). Press Retry."
                } else {
                    self.error = AIFailure.modelUnavailable(gone).localizedDescription
                }
            } catch {
                self.error = error.localizedDescription
            }
            // Drop an empty reply (failed before any text arrived).
            if let r = messages.first(where: { $0.id == replyID }), r.text.isEmpty {
                messages.removeAll { $0.id == replyID }
            }
            if let userTurn, let r = messages.first(where: { $0.id == replyID }) {
                record(user: userTurn, reply: r, provider: provider, model: r.model ?? model)
            }
            if firstOfTask { ChatHistoryStore.shared.describe(sessionID: sessionID, mode: input != nil || textInput != nil ? modeNow : nil,
                                                              input: input, textInput: textInput != nil) }
            isSending = false
            running = nil
            if self.error == nil { UserDefaults.standard.set(true, forKey: "ai.setupDone") }
        }
    }

    private func update(_ id: UUID, _ change: (inout ChatMessage) -> Void) {
        guard let i = messages.firstIndex(where: { $0.id == id }) else { return }
        change(&messages[i])
    }

    private func record(user: ChatMessage, reply: ChatMessage, provider: AIProvider, model: String) {
        let history = ChatHistoryStore.shared
        history.record(sessionID: sessionID, provider: provider, model: model, role: "user",
                       text: user.display ?? user.text, hadScreenshot: user.imageBase64 != nil)
        history.record(sessionID: sessionID, provider: provider, model: model, role: "assistant",
                       text: reply.text + (reply.stopped ? "\n\n(stopped)" : ""), hadScreenshot: false)
    }

    // MARK: Actions

    /// Stops the reply being written; whatever arrived stays.
    func stop() {
        running?.cancel()
    }

    /// Asks again: drops the last reply and resends, with whichever provider and model are chosen now.
    func retry() {
        guard !isSending, let last = messages.lastIndex(where: { $0.role == .user }) else { return }
        messages.removeSubrange((last + 1)...)
        request(firstOfTask: last == 0)
    }

    /// Puts the last question back in the box to edit and resend.
    func editLast() {
        guard !isSending, let last = messages.lastIndex(where: { $0.role == .user }), last > 0 || input == nil else { return }
        draft = messages[last].display ?? messages[last].text
        messages.removeSubrange(last...)
    }

    func copyLastAnswer() {
        guard let a = lastAnswer else { return }
        NSPasteboard.general.clearContents()
        NSPasteboard.general.setString(MathText.plain(a.text), forType: .string)
        notice = "Copied the answer."
    }

    var conversationMarkdown: String {
        messages.map { m in
            m.role == .user ? "**You:** \(m.display ?? m.text)" : "**AI\(m.model.map { " (\($0))" } ?? ""):**\n\n\(m.text)"
        }.joined(separator: "\n\n")
    }

    func copyConversation() {
        NSPasteboard.general.clearContents()
        NSPasteboard.general.setString(conversationMarkdown, forType: .string)
        notice = "Copied the whole conversation."
    }

    func export(markdown: Bool) {
        let panel = NSSavePanel()
        panel.nameFieldStringValue = "Notch apple \(Date.now.formatted(.iso8601.year().month().day())).\(markdown ? "md" : "txt")"
        NSApp.activate(ignoringOtherApps: true)
        guard panel.runModal() == .OK, let url = panel.url else { return }
        let body = markdown ? conversationMarkdown : MathText.plain(conversationMarkdown)
        try? body.write(to: url, atomically: true, encoding: .utf8)
        if let input, markdown {
            let imageURL = url.deletingPathExtension().appendingPathExtension("jpg")
            try? NSBitmapImageRep(cgImage: input.image).representation(using: .jpeg, properties: [.compressionFactor: 0.9])?.write(to: imageURL)
        }
        notice = "Saved \(url.lastPathComponent)."
    }

    private func startNewTask() {
        running?.cancel()
        messages.removeAll()
        input = nil; inputThumbnail = nil; textInput = nil; detected = nil
        error = nil; notice = nil
        sessionID = UUID()
        isSending = false
    }

    /// Starts a new conversation (the old one stays in Settings → AI History).
    func clear() { startNewTask() }

    /// Reopens a saved conversation in the notch so you can keep going, with its image if it was saved.
    func resume(_ session: ChatSession) {
        startNewTask()
        sessionID = session.id
        messages = session.messages.map {
            ChatMessage(role: $0.role == "user" ? .user : .assistant, text: $0.text, model: $0.model)
        }
        if let image = ChatHistoryStore.shared.image(for: session) {
            let kind = session.inputKind.flatMap(CapturedInput.Kind.init(rawValue:)) ?? .file
            input = CapturedInput(image: image, source: session.inputSource ?? "Saved image", kind: kind)
            inputThumbnail = ImagePrep.thumbnail(image)
            if let first = messages.firstIndex(where: { $0.role == .user }) {
                // Give the model the image again so follow-ups still see it.
                let modeInstruction = session.mode.flatMap(AIMode.init(rawValue:))?.instruction(extra: "")
                messages[first].display = messages[first].text
                messages[first].text = modeInstruction ?? messages[first].text
                messages[first].imageBase64 = ImagePrep.base64(image)
            }
        } else if session.messages.contains(where: \.hadScreenshot) {
            notice = "The image from this chat wasn't saved, so the AI can't see it again."
        }
        if let m = session.mode.flatMap(AIMode.init(rawValue:)) { mode = m }
        if let p = AIProvider(rawValue: session.provider) {
            AIConfig.shared.provider = p
            AIConfig.shared.setModel(session.model, for: p)
        }
    }

    // MARK: Quick actions (no input yet)

    struct QuickAction: Identifiable {
        let id = UUID()
        let title: String
        let symbol: String
        let run: @MainActor (ClaudeChatModel) -> Void
    }

    static var quickActions: [QuickAction] {
        [
            QuickAction(title: "Capture", symbol: "viewfinder") { _ in CaptureManager.shared.captureToAI(.region) },
            QuickAction(title: "Paste", symbol: "doc.on.clipboard") { $0.pasteFromClipboard() },
            QuickAction(title: "Selected text", symbol: "text.cursor") { $0.useSelectedText() },
            QuickAction(title: "What's on my screen?", symbol: "eye") {
                $0.send("What's on my screen? Describe it briefly and point out anything useful.", forceScreen: true)
            },
        ]
    }
}

// MARK: - Selected text

enum SelectedText {
    static var isTrusted: Bool { AXIsProcessTrusted() }

    /// The selection in the frontmost app via Accessibility, if it shares it.
    static func read() -> String? {
        guard isTrusted else { return nil }
        let system = AXUIElementCreateSystemWide()
        var focused: AnyObject?
        guard AXUIElementCopyAttributeValue(system, kAXFocusedUIElementAttribute as CFString, &focused) == .success,
              let element = focused else { return nil }
        var value: AnyObject?
        guard AXUIElementCopyAttributeValue(element as! AXUIElement, kAXSelectedTextAttribute as CFString, &value) == .success else { return nil }
        return (value as? String)?.trimmingCharacters(in: .whitespacesAndNewlines)
    }
}

// MARK: - View

struct ClaudeChatView: View {
    /// True in the separate Full View window.
    var fullView = false
    @StateObject private var model = ClaudeChatModel.shared
    @AppStorage("ai.setupDone") private var setupDone = false
    @StateObject private var config = AIConfig.shared
    @State private var keyDraft = ""
    @State private var dropTargeted = false
    @FocusState private var fieldFocused: Bool

    var body: some View {
        VStack(spacing: 8) {
            providerBar
            if config.provider.isConfigured { content } else { keyPrompt }
        }
        .onAppear { if config.availableModels[config.provider] == nil { config.refreshModels() } }
        .onDrop(of: [.fileURL, .image], isTargeted: $dropTargeted, perform: handleDrop)
        .overlay {
            if dropTargeted {
                RoundedRectangle(cornerRadius: 14).strokeBorder(Theme.accent, style: StrokeStyle(lineWidth: 2, dash: [6]))
                    .background(Theme.accent.opacity(0.08), in: RoundedRectangle(cornerRadius: 14))
                    .overlay(Label("Drop an image or PDF", systemImage: "square.and.arrow.down").font(.headline).foregroundStyle(.white))
                    .allowsHitTesting(false)
            }
        }
        // Keyboard: ⌘V paste, ⌘. stop, ⌘R retry, ⌘⇧C copy answer, ⌘N new task.
        .background {
            Group {
                Button("") { if !fieldFocused || model.draft.isEmpty { model.pasteFromClipboard() } }.keyboardShortcut("v", modifiers: [.command, .shift])
                Button("") { model.stop() }.keyboardShortcut(".", modifiers: .command)
                Button("") { model.retry() }.keyboardShortcut("r", modifiers: .command)
                Button("") { model.copyLastAnswer() }.keyboardShortcut("c", modifiers: [.command, .shift])
                Button("") { model.clear() }.keyboardShortcut("n", modifiers: .command)
            }
            .opacity(0).allowsHitTesting(false).accessibilityHidden(true)
        }
    }

    // MARK: Provider bar

    private var providerBar: some View {
        HStack(spacing: 8) {
            Menu {
                Section("Free") {
                    ForEach(AIProvider.allCases.filter(\.isFree)) { p in
                        Button { config.provider = p } label: { Label(p.title, systemImage: p == config.provider ? "checkmark" : "") }
                    }
                }
                Section("Paid (your own account)") {
                    ForEach(AIProvider.allCases.filter { !$0.isFree }) { p in
                        Button { config.provider = p } label: { Label(p.title, systemImage: p == config.provider ? "checkmark" : "") }
                    }
                }
            } label: {
                Label(config.provider.title, systemImage: "sparkles").font(.system(size: 12, weight: .semibold))
            }
            .menuStyle(.borderlessButton).fixedSize()
            .help("AI provider")

            if config.provider.isConfigured {
                Menu {
                    let models = config.availableModels[config.provider] ?? []
                    if models.isEmpty { Text(config.loadingModels ? "Loading models…" : "No models found") }
                    ForEach(models, id: \.self) { m in
                        Button { config.setModel(m, for: config.provider) } label: {
                            Label(m, systemImage: m == config.model ? "checkmark" : "")
                        }
                    }
                    Divider()
                    Button("Refresh model list") { config.refreshModels() }
                } label: {
                    Text(config.model).font(.system(size: 12)).lineLimit(1)
                }
                .menuStyle(.borderlessButton).fixedSize()
                .help("Model")
            }
            Spacer()
            badge(config.provider.likelySupportsVision(config.model) ? "Sees images" : "Text only",
                  symbol: config.provider.likelySupportsVision(config.model) ? "eye" : "eye.slash")
            if config.provider == .ollama {
                badge("On this Mac", symbol: "lock.fill", tint: .green)
            } else {
                Text(config.provider.costNote).font(.system(size: 11)).lineLimit(1)
                    .foregroundStyle(config.provider.isFree ? Color.green.opacity(0.9) : Theme.textSecondary)
            }
        }
    }

    private func badge(_ text: String, symbol: String, tint: Color = Theme.textSecondary) -> some View {
        Label(text, systemImage: symbol).font(.system(size: 10, weight: .semibold)).foregroundStyle(tint)
            .padding(.horizontal, 6).padding(.vertical, 2)
            .background(Color.white.opacity(0.07), in: Capsule())
    }

    // MARK: Key

    private var keyPrompt: some View {
        VStack(alignment: .leading, spacing: 10) {
            Label("Add your \(config.provider.title) key", systemImage: "key.fill").font(.headline).foregroundStyle(.white)
            Text("\(config.provider.costNote). Your key stays on this Mac and is sent only to \(config.provider.title).")
                .font(.caption).foregroundStyle(Theme.textSecondary)
            HStack {
                SecureField(config.provider.keyPlaceholder, text: $keyDraft)
                    .textFieldStyle(.roundedBorder)
                    .onSubmit(saveKey)
                Button("Save", action: saveKey)
                    .buttonStyle(PurpleButtonStyle())
                    .disabled(keyDraft.isEmpty)
            }
            HStack {
                Link(config.provider.isFree ? "Get a free key →" : "Get a key →", destination: config.provider.keyURL).font(.caption.bold())
                Spacer()
                Button("Use Ollama on this Mac instead") { config.provider = .ollama }.buttonStyle(.link).font(.caption)
            }
        }
        .frame(maxHeight: .infinity, alignment: .center)
    }

    private func saveKey() {
        let key = keyDraft.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !key.isEmpty else { return }
        KeychainHelper.set(key, for: config.provider.keychainKey)
        keyDraft = ""
        config.objectWillChange.send()
        config.refreshModels()
    }

    // MARK: Content

    private var content: some View {
        VStack(spacing: 8) {
            if model.input != nil || model.textInput != nil { inputStrip }
            if (model.input != nil || model.textInput != nil) && model.messages.isEmpty { modeChips }
            conversation
            statusLines
            if !model.messages.isEmpty { actionRow }
            inputBar
        }
    }

    private var inputStrip: some View {
        HStack(spacing: 10) {
            if let thumb = model.inputThumbnail {
                Image(nsImage: thumb).resizable().scaledToFit().frame(maxWidth: 90, maxHeight: 44)
                    .clipShape(RoundedRectangle(cornerRadius: 6))
                    .overlay(RoundedRectangle(cornerRadius: 6).strokeBorder(Color.white.opacity(0.15)))
                    .accessibilityLabel("Captured image")
            } else {
                Image(systemName: "text.alignleft").font(.system(size: 18)).foregroundStyle(Theme.accentBright).frame(width: 44, height: 44)
                    .background(Color.white.opacity(0.06), in: RoundedRectangle(cornerRadius: 6))
            }
            VStack(alignment: .leading, spacing: 2) {
                Text(model.input?.source ?? (model.textInput.map { "\($0.count) characters of text" } ?? ""))
                    .font(.system(size: 12, weight: .semibold)).foregroundStyle(.white).lineLimit(1)
                if let label = model.detected?.label {
                    Text(label).font(.system(size: 11)).foregroundStyle(Theme.textSecondary)
                } else if let t = model.textInput {
                    Text(t.prefix(120)).font(.system(size: 11)).foregroundStyle(Theme.textSecondary).lineLimit(1)
                }
            }
            Spacer()
            Button { model.clearInput() } label: { Image(systemName: "xmark.circle.fill").font(.system(size: 15)) }
                .buttonStyle(.plain).foregroundStyle(Theme.textSecondary)
                .help("New task (⌘N)").accessibilityLabel("Remove input and start a new task")
        }
        .padding(8)
        .background(Color.white.opacity(0.05), in: RoundedRectangle(cornerRadius: 10))
    }

    private var modeChips: some View {
        let suggested = model.detected?.suggested ?? []
        let others = AIMode.allCases.filter { !suggested.contains($0) && $0 != .ask }
        return ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 6) {
                ForEach(suggested + others) { m in
                    Button { model.run(m) } label: {
                        Label(m.title, systemImage: m.symbol).font(.system(size: 12, weight: .medium))
                    }
                    .buttonStyle(PurpleButtonStyle(prominent: suggested.first == m))
                    .help(m.isLocal ? "\(m.title): runs on this Mac" : "\(m.title) with \(config.provider.title)")
                }
            }
        }
    }

    private var conversation: some View {
        ScrollViewReader { proxy in
            ScrollView {
                LazyVStack(alignment: .leading, spacing: 8) {
                    if model.messages.isEmpty && model.input == nil && model.textInput == nil { emptyState }
                    ForEach(model.messages) { Bubble(message: $0, streaming: model.isSending && $0.id == model.messages.last?.id).id($0.id) }
                    if model.isSending, model.messages.last?.text.isEmpty ?? true {
                        ProgressView().controlSize(.small).padding(.leading, 6).id("typing")
                    }
                    Color.clear.frame(height: 1).id("bottom")
                }
            }
            .onChange(of: model.messages.last?.text.count) { _, _ in proxy.scrollTo("bottom", anchor: .bottom) }
            .onChange(of: model.messages.count) { _, _ in withAnimation { proxy.scrollTo("bottom", anchor: .bottom) } }
        }
    }

    private var emptyState: some View {
        VStack(spacing: 12) {
            if !setupDone { AISetupCard() }
            Text("Capture anything on screen with \(HotkeyBinding.capture.label), paste or drop an image, or just ask.")
                .font(.callout).foregroundStyle(Theme.textSecondary).multilineTextAlignment(.center)
            HStack(spacing: 8) {
                ForEach(ClaudeChatModel.quickActions) { action in
                    Button { action.run(model) } label: {
                        Label(action.title, systemImage: action.symbol).font(.system(size: 12, weight: .medium))
                    }
                    .buttonStyle(PurpleButtonStyle(prominent: action.title == "Capture"))
                }
            }
        }
        .frame(maxWidth: .infinity).padding(.top, 16)
    }

    @ViewBuilder private var statusLines: some View {
        if let feature = model.locked {
            HStack(alignment: .top, spacing: 8) {
                TierBadge(tier: feature.tier)
                VStack(alignment: .leading, spacing: 4) {
                    Text("\(feature.title): \(feature.benefit)").font(.caption).foregroundStyle(.white)
                        .fixedSize(horizontal: false, vertical: true)
                    HStack(spacing: 10) {
                        Link("Get \(feature.tier.name), \(feature.tier.price) →", destination: URL(string: LicenseServer.site)!)
                        Button("I have a key") { AppDelegate.openSettingsWindow(tab: .license) }.buttonStyle(.plain)
                        Button("Not now") { model.locked = nil }.buttonStyle(.plain).foregroundStyle(Theme.textSecondary)
                    }
                    .font(.caption).foregroundStyle(Theme.accent)
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        if let notice = model.notice {
            Label(notice, systemImage: "info.circle").font(.caption).foregroundStyle(Theme.textSecondary).lineLimit(2)
                .frame(maxWidth: .infinity, alignment: .leading)
        }
        if let error = model.error ?? config.modelError {
            VStack(alignment: .leading, spacing: 6) {
                Label(error, systemImage: "exclamationmark.triangle.fill").font(.caption).foregroundStyle(.orange).lineLimit(3)
                if error.contains("Screen Recording") {
                    HStack(spacing: 8) {
                        Button("Open System Settings") { ScreenPermission.openSettings() }.buttonStyle(PurpleButtonStyle(prominent: false))
                        Button("Relaunch Notch apple") { AppRelauncher.relaunch() }.buttonStyle(PurpleButtonStyle())
                    }
                } else if !model.messages.isEmpty && !model.isSending {
                    Button("Retry") { model.retry() }.buttonStyle(PurpleButtonStyle(prominent: false))
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
    }

    private var actionRow: some View {
        HStack(spacing: 6) {
            if model.isSending {
                Button { model.stop() } label: { Label("Stop", systemImage: "stop.fill") }
                    .help("Stop (⌘.)")
            } else {
                Button { model.retry() } label: { Label("Retry", systemImage: "arrow.clockwise") }.help("Ask again with the current provider and model (⌘R)")
                Button { model.copyLastAnswer() } label: { Label("Copy", systemImage: "doc.on.doc") }.help("Copy the answer (⌘⇧C)")
                Button { model.editLast() } label: { Label("Edit", systemImage: "pencil") }.help("Edit your last question and send it again")
                Menu {
                    Button("Copy whole conversation") { model.copyConversation() }
                    Button("Export as Markdown…") { model.export(markdown: true) }
                    Button("Export as plain text…") { model.export(markdown: false) }
                    Divider()
                    if !fullView { Button("Open full view") { AIFullView.open() } }
                    Button("History…") { AppDelegate.openSettingsWindow(tab: .aiHistory) }
                } label: { Label("More", systemImage: "ellipsis.circle") }
                .menuStyle(.borderlessButton).fixedSize()
            }
            Spacer()
            if !fullView {
                Button { AIFullView.open() } label: { Label("Full view", systemImage: "arrow.up.left.and.arrow.down.right") }
                    .help("Open this conversation in a resizable window")
            }
            Button { model.clear() } label: { Label("New task", systemImage: "plus") }.help("New task (⌘N)")
        }
        .buttonStyle(.plain).font(.system(size: 11, weight: .medium)).foregroundStyle(Theme.accentBright)
        .labelStyle(.titleAndIcon)
    }

    private var inputBar: some View {
        HStack(spacing: 8) {
            Menu {
                ForEach(CaptureManager.Mode.allCases) { m in
                    Button(m.title) { CaptureManager.shared.captureToAI(m) }
                }
                Divider()
                Button("Paste image or text (⌘⇧V)") { model.pasteFromClipboard() }
                Button("Use selected text") { model.useSelectedText() }
                Divider()
                Toggle("Attach a screenshot to the next message", isOn: $model.attachScreen)
            } label: {
                Image(systemName: model.attachScreen ? "display.and.arrow.down" : "viewfinder")
            } primaryAction: {
                CaptureManager.shared.captureToAI()
            }
            .menuStyle(.borderlessButton).fixedSize()
            .help("Capture (\(HotkeyBinding.capture.label)); hold for more options")

            TextField(placeholder, text: $model.draft)
                .textFieldStyle(.plain)
                .focused($fieldFocused)
                .padding(.horizontal, 12).padding(.vertical, 8)
                .background(Color.white.opacity(0.08), in: Capsule())
                .onSubmit(model.send)

            if model.isSending {
                Button(action: model.stop) { Image(systemName: "stop.fill") }
                    .buttonStyle(PurpleButtonStyle()).help("Stop (⌘.)").accessibilityLabel("Stop")
            } else {
                Button(action: model.send) { Image(systemName: "arrow.up") }
                    .buttonStyle(PurpleButtonStyle())
                    .disabled(model.draft.isEmpty && model.input == nil && model.textInput == nil)
                    .help("Send (Return)").accessibilityLabel("Send")
            }
        }
    }

    private var placeholder: String {
        if !model.messages.isEmpty { return "Ask a follow-up…" }
        if model.input != nil || model.textInput != nil { return "Add a note, or pick an action above…" }
        return "Ask anything…"
    }

    private func handleDrop(_ providers: [NSItemProvider]) -> Bool {
        guard let item = providers.first else { return false }
        if item.canLoadObject(ofClass: URL.self) {
            _ = item.loadObject(ofClass: URL.self) { url, _ in
                guard let url else { return }
                DispatchQueue.main.async { ClaudeChatModel.shared.load(file: url) }
            }
            return true
        }
        if item.canLoadObject(ofClass: NSImage.self) {
            _ = item.loadObject(ofClass: NSImage.self) { obj, _ in
                guard let image = obj as? NSImage, let cg = image.cgImage(forProposedRect: nil, context: nil, hints: nil) else { return }
                DispatchQueue.main.async {
                    ClaudeChatModel.shared.setInput(CapturedInput(image: cg, source: "Dropped image · \(cg.width) × \(cg.height)", kind: .file))
                }
            }
            return true
        }
        return false
    }
}

private struct Bubble: View {
    let message: ChatMessage
    var streaming = false
    var isUser: Bool { message.role == .user }
    @State private var hovering = false

    var body: some View {
        HStack(alignment: .top) {
            if isUser { Spacer(minLength: 60) }
            VStack(alignment: .leading, spacing: 4) {
                if message.imageBase64 != nil {
                    Label("Image attached", systemImage: "photo").font(.caption2).foregroundStyle(isUser ? .white.opacity(0.8) : Theme.textSecondary)
                }
                if isUser {
                    Text(message.display ?? message.text).font(.system(size: 13)).foregroundStyle(.white).textSelection(.enabled)
                        .lineLimit(6)
                } else {
                    RichTextView(markdown: message.text)
                    if message.stopped {
                        Label("Stopped", systemImage: "stop.circle").font(.caption2).foregroundStyle(Theme.textSecondary)
                    }
                    if !streaming, let m = message.model {
                        HStack(spacing: 8) {
                            Text(m).font(.system(size: 10)).foregroundStyle(Theme.textSecondary).lineLimit(1)
                            Spacer()
                            Button {
                                NSPasteboard.general.clearContents()
                                NSPasteboard.general.setString(MathText.plain(message.text), forType: .string)
                            } label: { Image(systemName: "doc.on.doc").font(.system(size: 10)) }
                                .buttonStyle(.plain).foregroundStyle(Theme.textSecondary).help("Copy this answer")
                                .accessibilityLabel("Copy this answer")
                        }
                    }
                }
            }
            .padding(.horizontal, 12).padding(.vertical, 8)
            .background(
                RoundedRectangle(cornerRadius: 14, style: .continuous)
                    .fill(isUser ? AnyShapeStyle(Theme.accentGradient) : AnyShapeStyle(Color.white.opacity(0.08)))
            )
            .onHover { hovering = $0 }
            if !isUser { Spacer(minLength: 30) }
        }
    }
}

// MARK: - Full view

/// The AI tab in its own resizable window, for long answers. Same conversation as the notch.
@MainActor
enum AIFullView {
    private static var window: NSWindow?

    static func open() {
        AppDelegate.current?.notch?.closeNotch()
        if let window { window.makeKeyAndOrderFront(nil); NSApp.activate(ignoringOtherApps: true); return }
        let host = NSHostingView(rootView: ClaudeChatView(fullView: true)
            .padding(16)
            .frame(minWidth: 560, minHeight: 420)
            .background(LinearGradient(colors: [Color(red: 0.05, green: 0.03, blue: 0.09), Color(red: 0.1, green: 0.05, blue: 0.2)],
                                       startPoint: .top, endPoint: .bottom)))
        let w = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 820, height: 640),
                         styleMask: [.titled, .closable, .resizable, .miniaturizable, .fullSizeContentView], backing: .buffered, defer: false)
        w.title = "Notch apple AI"
        w.titlebarAppearsTransparent = true
        w.appearance = NSAppearance(named: .darkAqua)
        w.contentView = host
        w.isReleasedWhenClosed = false
        w.center()
        w.setFrameAutosaveName("AIFullView")
        window = w
        w.makeKeyAndOrderFront(nil)
        NSApp.activate(ignoringOtherApps: true)
    }
}

// MARK: - First run

/// Shown in the AI tab until set up: pick a free or local provider, test it, try a capture.
struct AISetupCard: View {
    @StateObject private var config = AIConfig.shared
    @AppStorage("ai.setupDone") private var setupDone = false
    @State private var key = ""
    @State private var result: (ok: Bool, message: String)?
    @State private var testing = false

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack {
                Label("Set up AI in three steps", systemImage: "sparkles").font(.system(size: 14, weight: .bold)).foregroundStyle(.white)
                Spacer()
                Button("Skip") { setupDone = true }.buttonStyle(.plain).font(.system(size: 11)).foregroundStyle(Theme.textSecondary)
            }
            Text("1  Choose: free Gemini in the cloud, or Ollama, which runs on this Mac and keeps everything private.")
                .font(.system(size: 12)).foregroundStyle(Theme.textSecondary)
            HStack(spacing: 8) {
                Button { config.provider = .gemini } label: { Label("Google Gemini (free)", systemImage: "cloud") }
                    .buttonStyle(PurpleButtonStyle(prominent: config.provider == .gemini))
                Button { config.provider = .ollama } label: { Label("Ollama (on this Mac)", systemImage: "lock.fill") }
                    .buttonStyle(PurpleButtonStyle(prominent: config.provider == .ollama))
            }
            if config.provider.needsKey && !config.provider.isConfigured {
                HStack {
                    SecureField(config.provider.keyPlaceholder, text: $key).textFieldStyle(.roundedBorder)
                    Button("Save") {
                        KeychainHelper.set(key.trimmingCharacters(in: .whitespaces), for: config.provider.keychainKey)
                        key = ""; config.objectWillChange.send(); config.refreshModels()
                    }.disabled(key.isEmpty)
                    Link("Get a free key", destination: config.provider.keyURL).font(.system(size: 11))
                }
            } else if config.provider == .ollama {
                Text("Install Ollama from ollama.com, then run `ollama pull gemma3:4b` once (it can read images).")
                    .font(.system(size: 11)).foregroundStyle(Theme.textSecondary)
            }
            HStack(spacing: 8) {
                Text("2").font(.system(size: 12, weight: .bold)).foregroundStyle(Theme.accentBright)
                Button(testing ? "Testing…" : "Test connection") {
                    testing = true
                    Task { result = await AIClient.testConnection(provider: config.provider, model: config.model); testing = false }
                }
                .disabled(testing || !config.provider.isConfigured)
                if let r = result {
                    Label(r.message, systemImage: r.ok ? "checkmark.circle.fill" : "xmark.octagon.fill")
                        .font(.system(size: 11)).foregroundStyle(r.ok ? .green : .orange).lineLimit(2)
                }
            }
            HStack(spacing: 8) {
                Text("3").font(.system(size: 12, weight: .bold)).foregroundStyle(Theme.accentBright)
                Button { setupDone = true; CaptureManager.shared.captureToAI(.region) } label: {
                    Label("Try a capture (\(HotkeyBinding.capture.label))", systemImage: "viewfinder")
                }
                .buttonStyle(PurpleButtonStyle())
                .disabled(result?.ok != true)
            }
        }
        .padding(12)
        .background(Color.white.opacity(0.05), in: RoundedRectangle(cornerRadius: 12))
    }
}
