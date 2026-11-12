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
        Task { _ = try? await snapshot(scope: scope, showText: true) }
    }

    /// Captures, reads, and asks the conversation `question` about it.
    func ask(_ question: String, label: String? = nil, scope: ScreenScope) {
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

    private func snapshot(scope: ScreenScope, showText: Bool) async throws -> (ScreenSnapshot, String?) {
        status = nil
        guard NotchAITier.allows(.pro) else { status = NotchAITier.lockedMessage(.pro); throw Failure.refused }
        guard isOn else { status = "Screen awareness is off. Turn it on first."; throw Failure.refused }
        refreshPermission()
        guard permissionGranted else { status = "Screen Recording permission is needed. Press “Allow screen access”."; throw Failure.refused }
        guard let app = lastExternalApp else { status = "No app to read: click the window you mean first."; throw Failure.refused }
        let bundle = app.bundleIdentifier ?? ""
        if ScreenContextLogic.isExcluded(bundleID: bundle, exclusions: exclusions) {
            status = "\(app.localizedName ?? bundle) is on the exclusion list, so it is never captured."
            throw Failure.refused
        }
        capturing = true
        defer { capturing = false }
        do {
            let (image, title) = try await ScreenGrab.capture(app: app, scope: scope)
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
        case noWindow, noDisplay
        var errorDescription: String? {
            switch self { case .noWindow: "that app has no visible window"; case .noDisplay: "no display found" }
        }
    }

    /// The window (or display) as an image, cropped for region presets, and the window's title.
    static func capture(app: NSRunningApplication, scope: ScreenScope) async throws -> (CGImage, String?) {
        let content = try await SCShareableContent.excludingDesktopWindows(true, onScreenWindowsOnly: true)
        var title: String?
        let image: CGImage
        let config = SCStreamConfiguration()
        config.showsCursor = false
        if scope == .display || scope.crop != nil {
            guard let display = content.displays.first(where: { $0.displayID == CGMainDisplayID() }) ?? content.displays.first else { throw GrabError.noDisplay }
            let own = content.applications.filter { $0.bundleIdentifier == Bundle.main.bundleIdentifier }
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

    static func jpegBase64(_ image: CGImage) -> String? {
        let rep = NSBitmapImageRep(cgImage: image)
        return rep.representation(using: .jpeg, properties: [.compressionFactor: 0.7])?.base64EncodedString()
    }
}
