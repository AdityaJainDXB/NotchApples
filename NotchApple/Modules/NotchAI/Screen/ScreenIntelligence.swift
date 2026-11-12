//
//  ScreenIntelligence.swift
//  Notch Apple
//
//  NotchAI's screen awareness (Pro). On demand only: nothing is captured until a button is pressed, nothing is
//  stored, and nothing is captured continuously. A capture is:
//    1. checks: Pro tier, the switch is on, Screen Recording permission, and the app is not on the exclusion list;
//    2. ScreenCaptureKit grabs the window (or display / a region) and hides Notch Apple's own windows;
//    3. Apple Vision reads the text on this Mac;
//    4. the app name, window title and text become one question for the shared conversation, which still goes
//       through the Local-first guard, so a cloud model is refused unless the user allowed it.
//  The screenshot itself is never sent unless "Send the screenshot too" is on and the model can read images.
//

import AppKit
import ScreenCaptureKit
import SwiftUI

@MainActor
final class ScreenIntelligence: ObservableObject {
    static let shared = ScreenIntelligence()

    @AppStorage("notchai.screen.enabled") var isOn = false { willSet { objectWillChange.send() } }
    @AppStorage("notchai.screen.sendImage") var sendImage = false { willSet { objectWillChange.send() } }
    @AppStorage("notchai.screen.exclusions") private var exclusionsJSON = ""

    /// True only while a capture is in progress: the visible "capturing" indicator.
    @Published private(set) var capturing = false
    @Published private(set) var status: String?
    @Published private(set) var lastText: String?
    @Published private(set) var permissionGranted = CGPreflightScreenCaptureAccess()

    private(set) var lastExternalApp: NSRunningApplication?
    private var observer: NSObjectProtocol?

    private init() {
        lastExternalApp = NSWorkspace.shared.frontmostApplication.flatMap { $0.bundleIdentifier == Bundle.main.bundleIdentifier ? nil : $0 }
        observer = NSWorkspace.shared.notificationCenter.addObserver(forName: NSWorkspace.didActivateApplicationNotification, object: nil, queue: .main) { [weak self] n in
            MainActor.assumeIsolated {
                guard let app = n.userInfo?[NSWorkspace.applicationUserInfoKey] as? NSRunningApplication,
                      app.bundleIdentifier != Bundle.main.bundleIdentifier else { return }
                self?.lastExternalApp = app
            }
        }
    }

    var exclusions: [String] {
        get { (try? JSONDecoder().decode([String].self, from: Data(exclusionsJSON.utf8))) ?? ScreenContextLogic.defaultExclusions }
        set { objectWillChange.send(); exclusionsJSON = String(decoding: (try? JSONEncoder().encode(newValue)) ?? Data("[]".utf8), as: UTF8.self) }
    }

    func excludeCurrentApp() {
        guard let id = lastExternalApp?.bundleIdentifier, !exclusions.contains(id) else { return }
        exclusions += [id]
    }

    func refreshPermission() { permissionGranted = CGPreflightScreenCaptureAccess() }

    /// Shows the macOS Screen Recording prompt (only when the user presses the button).
    func requestPermission() {
        permissionGranted = CGRequestScreenCaptureAccess()
        if !permissionGranted, let url = URL(string: "x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture") {
            NSWorkspace.shared.open(url)
        }
    }

    // MARK: Actions

    /// Reads the text on screen on this Mac and shows it. No AI involved.
    func readText(scope: ScreenScope) {
        armedByButton()
        Task { _ = try? await snapshot(scope: scope, showText: true) }
    }

    /// Captures, reads, and asks the conversation `question` about it.
    func ask(_ question: String, label: String? = nil, scope: ScreenScope) {
        armedByButton()
        Task {
            guard let (snap, image) = try? await snapshot(scope: scope, showText: false) else { return }
            let prompt = ScreenContextLogic.prompt(question: question, snapshot: snap)
            let bubble = ScreenContextLogic.bubble(question: label ?? question, snapshot: snap)
            let attach = sendImage ? image : nil
            NotchAIConversation.shared.send(prompt, display: bubble, imageBase64: attach)
            NotchAINav.shared.section = .chat
            status = nil
        }
    }

    /// For an agent that was approved to read the screen: the same checks as the buttons (Pro, switch, permission,
    /// exclusions), then the app, window and text.
    func captureForAgent(scope: ScreenScope = .window) async throws -> ScreenSnapshot {
        try await snapshot(scope: scope, showText: false).0
    }

    /// For teaching mode: the same checks, then the text AND where each piece of text is, so a button can be pointed at.
    func captureBoxes(scope: ScreenScope = .display) async throws -> (app: String, boxes: [OCRBox], text: String) {
        guard NotchAITier.allows(.pro) else { throw TeachingError.refused(NotchAITier.lockedMessage(.pro)) }
        guard isOn else { throw TeachingError.refused("Screen awareness is off. Turn it on first.") }
        refreshPermission()
        guard permissionGranted else { throw TeachingError.refused("Screen Recording permission is needed.") }
        guard let app = lastExternalApp else { throw TeachingError.refused("No app to teach in: click the window you mean first.") }
        if ScreenContextLogic.isExcluded(bundleID: app.bundleIdentifier ?? "", exclusions: exclusions) { throw TeachingError.refused("\(app.localizedName ?? "That app") is on the exclusion list.") }
        capturing = true
        defer { capturing = false }
        let (image, _) = try await ScreenGrab.capture(app: app, scope: scope, excluding: exclusions)
        let lines = try await ScreenOCR.recognize(image)
        return (app.localizedName ?? "the app", lines.map { OCRBox(text: $0.text, box: $0.box) }, ScreenOCR.text(lines))
    }

    // MARK: A drawn area and selected text

    /// Draws the area picker, then reads the text in the chosen area on this Mac (no AI), or asks `question` about it.
    func chooseArea(question: String?, label: String? = nil) {
        status = nil
        armedByButton()
        guard canCaptureNow() else { return }
        ScreenRegionPicker.pick { [weak self] selection in
            guard let self else { return }
            guard let selection else { self.status = "No area chosen."; return }
            Task { @MainActor in
                self.capturing = true
                defer { self.capturing = false }
                do {
                    let image = try await ScreenGrab.captureRegion(selection.rect, on: selection.screen, excluding: self.exclusions)
                    let text = ScreenOCR.text(try await ScreenOCR.recognize(image))
                    let snap = ScreenSnapshot(appName: "the area I chose", bundleID: "", windowTitle: nil, ocrText: text, scope: .region)
                    guard let question else {
                        self.lastText = text.isEmpty ? "No text found." : text
                        self.status = "Read \(text.count.formatted()) characters from the area. Nothing was sent."
                        return
                    }
                    NotchAIConversation.shared.send(ScreenContextLogic.prompt(question: question, snapshot: snap),
                                                    display: ScreenContextLogic.bubble(question: label ?? question, snapshot: snap),
                                                    imageBase64: self.sendImage ? ScreenGrab.jpegBase64(image) : nil)
                    NotchAINav.shared.section = .chat
                    self.status = nil
                } catch { self.status = "Couldn't capture: \(error.localizedDescription)" }
            }
        }
    }

    /// The text selected in the app the user was just using, read through Accessibility (no copying, no key presses).
    /// With a question it goes to the conversation; without one it is only shown.
    func useSelection(question: String?, label: String? = nil) {
        status = nil
        guard NotchAITier.allows(.pro) else { status = NotchAITier.lockedMessage(.pro); return }
        guard isOn else { status = "Screen awareness is off. Turn it on first."; return }
        guard let app = lastExternalApp else { status = "No app to read: select some text in a window first."; return }
        if ScreenContextLogic.isExcluded(bundleID: app.bundleIdentifier ?? "", exclusions: exclusions) {
            status = "\(app.localizedName ?? "That app") is on the exclusion list, so its text is never read."; return
        }
        guard SelectedTextReader.trusted else {
            status = "Accessibility permission is needed to read selected text. macOS is asking; allow Notch Apple, then press the button again."
            SelectedTextReader.requestTrust(); return
        }
        guard let sel = ScreenContextLogic.usableSelection(SelectedTextReader.read(pid: app.processIdentifier)) else {
            status = "No text is selected in \(app.localizedName ?? "that app"), or that app does not share its selection. Select some text and try again."
            return
        }
        let name = app.localizedName ?? "the app"
        guard let question else {
            lastText = sel.text
            status = "Read \(sel.text.count.formatted()) selected characters from \(name). Nothing was sent."
            return
        }
        NotchAIConversation.shared.send(ScreenContextLogic.selectionPrompt(question: question, appName: name, text: sel.text, wasCut: sel.wasCut),
                                        display: ScreenContextLogic.selectionBubble(question: label ?? question, appName: name, characters: sel.text.count))
        NotchAINav.shared.section = .chat
    }

    static let permissionHelp = "Screen Recording is not allowed for Notch Apple yet. Switch it on in System Settings → Privacy & Security → Screen Recording, then quit and reopen Notch Apple (macOS only applies it after a restart)."

    /// Pressing one of the screen buttons is the user's own request to capture, so it switches screen awareness on
    /// (the switch visibly flips) and asks for the Screen Recording permission if it is missing, instead of leaving
    /// the buttons greyed out. It is still one capture per press; nothing runs in the background.
    private func armedByButton() {
        guard NotchAITier.allows(.pro) else { return }
        if !isOn { isOn = true }
        refreshPermission()
        if !permissionGranted { requestPermission() }
    }

    private func canCaptureNow() -> Bool {
        guard NotchAITier.allows(.pro) else { status = NotchAITier.lockedMessage(.pro); return false }
        guard isOn else { status = "Screen awareness is off. Turn it on first."; return false }
        refreshPermission()
        guard permissionGranted else { status = Self.permissionHelp; return false }
        return true
    }

    private func snapshot(scope: ScreenScope, showText: Bool) async throws -> (ScreenSnapshot, String?) {
        status = nil
        guard NotchAITier.allows(.pro) else { status = NotchAITier.lockedMessage(.pro); throw Failure.refused }
        guard isOn else { status = "Screen awareness is off. Turn it on first."; throw Failure.refused }
        refreshPermission()
        guard permissionGranted else { status = Self.permissionHelp; throw Failure.refused }
        guard let app = lastExternalApp else { status = "No app to read: click the window you mean first."; throw Failure.refused }
        let bundle = app.bundleIdentifier ?? ""
        if ScreenContextLogic.isExcluded(bundleID: bundle, exclusions: exclusions) {
            status = "\(app.localizedName ?? bundle) is on the exclusion list, so it is never captured."
            throw Failure.refused
        }
        capturing = true
        defer { capturing = false }
        do {
            let (image, title) = try await ScreenGrab.capture(app: app, scope: scope, excluding: exclusions)
            let lines = try await ScreenOCR.recognize(image)
            let text = ScreenOCR.text(lines)
            let snap = ScreenSnapshot(appName: app.localizedName ?? bundle, bundleID: bundle, windowTitle: title, ocrText: text, scope: scope)
            if showText { lastText = text.isEmpty ? "No text found." : text; status = "Read \(text.count.formatted()) characters from \(snap.appName). Nothing was sent." }
            return (snap, sendImage ? ScreenGrab.jpegBase64(image) : nil)
        } catch {
            status = "Couldn't capture: \(error.localizedDescription)"
            throw error
        }
    }

    private enum Failure: Error { case refused }
}

// MARK: - ScreenCaptureKit

enum ScreenGrab {
    enum GrabError: LocalizedError {
        case noWindow, noDisplay, tooSmall
        var errorDescription: String? {
            switch self {
            case .noWindow: "that app has no visible window"
            case .noDisplay: "no display found"
            case .tooSmall: "that area is too small"
            }
        }
    }

    /// The window (or display) as an image, cropped for region presets, and the window's title.
    static func capture(app: NSRunningApplication, scope: ScreenScope, excluding excluded: [String] = []) async throws -> (CGImage, String?) {
        let content = try await SCShareableContent.excludingDesktopWindows(true, onScreenWindowsOnly: true)
        var title: String?
        let image: CGImage
        let config = SCStreamConfiguration()
        config.showsCursor = false
        if scope == .display || scope.crop != nil {
            guard let display = content.displays.first(where: { $0.displayID == CGMainDisplayID() }) ?? content.displays.first else { throw GrabError.noDisplay }
            let own = content.applications.filter { $0.bundleIdentifier == Bundle.main.bundleIdentifier || ScreenContextLogic.isExcluded(bundleID: $0.bundleIdentifier, exclusions: excluded) }   // a password manager on screen is blanked out, not just refused as the target
            let filter = SCContentFilter(display: display, excludingApplications: own, exceptingWindows: [])
            config.width = display.width * 2; config.height = display.height * 2
            image = try await SCScreenshotManager.captureImage(contentFilter: filter, configuration: config)
            title = content.windows.filter { $0.owningApplication?.processID == app.processIdentifier && $0.windowLayer == 0 }.max { $0.frame.width * $0.frame.height < $1.frame.width * $1.frame.height }?.title
        } else {
            guard let win = content.windows.filter({ $0.owningApplication?.processID == app.processIdentifier && $0.windowLayer == 0 && $0.frame.width > 80 && $0.frame.height > 60 })
                .max(by: { $0.frame.width * $0.frame.height < $1.frame.width * $1.frame.height }) else { throw GrabError.noWindow }
            title = win.title
            config.width = Int(win.frame.width) * 2; config.height = Int(win.frame.height) * 2
            image = try await SCScreenshotManager.captureImage(contentFilter: SCContentFilter(desktopIndependentWindow: win), configuration: config)
        }
        if let r = ScreenContextLogic.cropRect(scope.crop, width: image.width, height: image.height), let cropped = image.cropping(to: r) {
            return (cropped, title)
        }
        return (image, title)
    }

    /// An area the user drew (AppKit screen coordinates) on one display. Notch Apple's own windows and any excluded app's windows are
    /// left out of the picture.
    static func captureRegion(_ selection: CGRect, on screen: NSScreen, excluding excluded: [String]) async throws -> CGImage {
        guard let local = ScreenContextLogic.regionOnDisplay(selection: selection, screenFrame: screen.frame) else { throw GrabError.tooSmall }
        let id = (screen.deviceDescription[NSDeviceDescriptionKey("NSScreenNumber")] as? NSNumber)?.uint32Value ?? CGMainDisplayID()
        let content = try await SCShareableContent.excludingDesktopWindows(true, onScreenWindowsOnly: true)
        guard let display = content.displays.first(where: { $0.displayID == id }) else { throw GrabError.noDisplay }
        let left = content.applications.filter { $0.bundleIdentifier == Bundle.main.bundleIdentifier || ScreenContextLogic.isExcluded(bundleID: $0.bundleIdentifier, exclusions: excluded) }
        let config = SCStreamConfiguration()
        config.showsCursor = false
        config.sourceRect = local
        let px = ScreenContextLogic.pixelSize(of: local, scale: screen.backingScaleFactor)
        config.width = px.width; config.height = px.height
        return try await SCScreenshotManager.captureImage(contentFilter: SCContentFilter(display: display, excludingApplications: left, exceptingWindows: []), configuration: config)
    }

    static func jpegBase64(_ image: CGImage) -> String? {
        let rep = NSBitmapImageRep(cgImage: image)
        return rep.representation(using: .jpeg, properties: [.compressionFactor: 0.7])?.base64EncodedString()
    }
}
