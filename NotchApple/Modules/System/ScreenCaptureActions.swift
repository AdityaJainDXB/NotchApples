//
//  ScreenCaptureActions.swift
//  Notch apple
//
//  The Today tab's "Take Screenshot" and "Start Recording" buttons. Both use
//  the system `screencapture` tool. Before a screenshot the notch is taken off
//  screen so it never appears in the picture, then put back afterwards.
//  Files go to the Desktop; screenshots are also copied to the clipboard.
//

import AppKit
import CoreGraphics

@MainActor
final class ScreenCaptureActions: ObservableObject {
    static let shared = ScreenCaptureActions()

    @Published private(set) var isRecording = false
    @Published private(set) var recordingStart: Date?
    @Published private(set) var message: String?

    private var recorder: Process?
    private var recordingURL: URL?
    private var messageWork: DispatchWorkItem?

    private static let screencapture = URL(fileURLWithPath: "/usr/sbin/screencapture")

    // MARK: Screenshot

    func takeScreenshot() {
        guard ensurePermission() else { return }
        let notch = AppDelegate.current?.notch
        // 1. Hide the notch right now. 2. Give the screen a moment to redraw. 3. Capture. 4. Restore.
        notch?.hideForCapture()
        Task {
            try? await Task.sleep(for: .milliseconds(100))
            let url = Self.desktopURL(prefix: "Screenshot", ext: "png")
            let ok = await Self.run(["-x", "-m", url.path])
            notch?.restoreAfterCapture()
            if ok, let image = NSImage(contentsOf: url) {
                NSPasteboard.general.clearContents()
                NSPasteboard.general.writeObjects([image])
                flash("Screenshot saved to Desktop and copied")
            } else {
                flash("Couldn't take the screenshot. Check Screen Recording access in System Settings.")
            }
        }
    }

    // MARK: Recording

    func toggleRecording() { isRecording ? stopRecording() : startRecording() }

    private func startRecording() {
        guard ensurePermission() else { return }
        let url = Self.desktopURL(prefix: "Screen Recording", ext: "mov")
        let process = Process()
        process.executableURL = Self.screencapture
        process.arguments = ["-v", "-x", url.path]
        process.terminationHandler = { [weak self] _ in
            Task { @MainActor in self?.recordingEnded() }
        }
        do { try process.run() } catch {
            flash("Couldn't start recording")
            return
        }
        recorder = process
        recordingURL = url
        recordingStart = .now
        isRecording = true
        ScreenRecordingDetector.shared.ownRecordingActive = true
        // Close the notch so it isn't sitting over what's being recorded.
        if AppDelegate.current?.notch?.isOpen == true { AppDelegate.current?.notch?.closeNotch() }
    }

    private func stopRecording() {
        recorder?.interrupt()   // SIGINT: screencapture finishes and saves the file
    }

    private func recordingEnded() {
        isRecording = false
        recordingStart = nil
        recorder = nil
        ScreenRecordingDetector.shared.ownRecordingActive = false
        if let url = recordingURL, FileManager.default.fileExists(atPath: url.path) {
            flash("Recording saved to Desktop")
            NSWorkspace.shared.activateFileViewerSelecting([url])
        } else {
            flash("Recording stopped")
        }
        recordingURL = nil
    }

    // MARK: Helpers

    /// Screen Recording permission is required for screenshots and recordings; ask once, then point to System Settings.
    private func ensurePermission() -> Bool {
        if CGPreflightScreenCaptureAccess() { return true }
        _ = CGRequestScreenCaptureAccess()
        flash("Allow Screen Recording for Notch apple in System Settings, then try again.", seconds: 8)
        return false
    }

    private static func desktopURL(prefix: String, ext: String) -> URL {
        let stamp = Date.now.formatted(.dateTime.year().month(.twoDigits).day(.twoDigits).hour().minute().second())
            .replacingOccurrences(of: "/", with: "-").replacingOccurrences(of: ":", with: ".")
        let desktop = FileManager.default.urls(for: .desktopDirectory, in: .userDomainMask)[0]
        return desktop.appendingPathComponent("\(prefix) \(stamp).\(ext)")
    }

    private static func run(_ arguments: [String]) async -> Bool {
        await withCheckedContinuation { continuation in
            let process = Process()
            process.executableURL = screencapture
            process.arguments = arguments
            process.terminationHandler = { continuation.resume(returning: $0.terminationStatus == 0) }
            do { try process.run() } catch { continuation.resume(returning: false) }
        }
    }

    private func flash(_ text: String, seconds: Double = 4) {
        message = text
        messageWork?.cancel()
        let work = DispatchWorkItem { [weak self] in self?.message = nil }
        messageWork = work
        DispatchQueue.main.asyncAfter(deadline: .now() + seconds, execute: work)
    }
}
