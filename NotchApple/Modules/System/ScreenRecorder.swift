//
//  ScreenRecorder.swift
//  Notch apple
//
//  Screen recording with pause / resume, a live timer beside the notch and a
//  trim step afterwards. Built on ScreenCaptureKit + AVAssetWriter, and the
//  notch itself is left out of the video (no need to hide it).
//
//  Pausing drops frames and shifts later timestamps back, so the saved movie
//  has no gap. When recording stops, a trim window opens (AVKit's own trim
//  bar); Save keeps the trimmed range, Cancel keeps the whole recording.
//

import AppKit
import AVFoundation
import AVKit
import ScreenCaptureKit

@MainActor
final class ScreenRecorder: NSObject, ObservableObject {
    static let shared = ScreenRecorder()

    @Published private(set) var isRecording = false
    @Published private(set) var isPaused = false
    /// Recorded time so far, not counting pauses.
    @Published private(set) var elapsed: TimeInterval = 0
    @Published private(set) var message: String?

    private var stream: SCStream?
    private var sink: RecordingSink?
    private var url: URL?
    private var ticker: Timer?
    private var segmentStart: Date?
    private var accumulated: TimeInterval = 0
    private var trimWindow: TrimWindowController?

    var liveActivity: LiveActivity? {
        guard isRecording else { return nil }
        return LiveActivity(symbol: isPaused ? "pause.circle.fill" : "record.circle", label: CountdownTimer.short(elapsed),
                            tint: isPaused ? .systemYellow : .systemRed)
    }

    func toggle() { isRecording ? stop() : start() }

    func start() {
        guard !isRecording else { return }
        guard CGPreflightScreenCaptureAccess() else {
            _ = CGRequestScreenCaptureAccess()
            flash("Allow Screen Recording for Notch apple in System Settings, then try again.")
            return
        }
        Task {
            do {
                let content = try await SCShareableContent.excludingDesktopWindows(false, onScreenWindowsOnly: true)
                let screen = NSScreen.screens.first { $0.frame.contains(NSEvent.mouseLocation) } ?? NSScreen.main
                let screenID = screen?.deviceDescription[NSDeviceDescriptionKey("NSScreenNumber")] as? CGDirectDisplayID
                guard let display = content.displays.first(where: { $0.displayID == screenID }) ?? content.displays.first else { throw RecorderError.noDisplay }
                // Leave the notch out of the recording.
                let me = content.applications.filter { $0.bundleIdentifier == Bundle.main.bundleIdentifier }
                let filter = SCContentFilter(display: display, excludingApplications: me, exceptingWindows: [])
                let scale = screen?.backingScaleFactor ?? 2
                var width = Int(CGFloat(display.width) * scale), height = Int(CGFloat(display.height) * scale)
                if width > 3840 { height = height * 3840 / width; width = 3840 }
                width -= width % 2; height -= height % 2
                let config = SCStreamConfiguration()
                config.width = width
                config.height = height
                config.minimumFrameInterval = CMTime(value: 1, timescale: 60)
                config.pixelFormat = kCVPixelFormatType_32BGRA
                config.showsCursor = true
                config.queueDepth = 6

                let url = Self.desktopURL()
                let sink = try RecordingSink(url: url, width: width, height: height)
                let stream = SCStream(filter: filter, configuration: config, delegate: nil)
                try stream.addStreamOutput(sink, type: .screen, sampleHandlerQueue: sink.queue)
                try await stream.startCapture()
                self.stream = stream
                self.sink = sink
                self.url = url
                isRecording = true
                isPaused = false
                accumulated = 0
                elapsed = 0
                segmentStart = .now
                ScreenRecordingDetector.shared.ownRecordingActive = true
                startTicker()
                if AppDelegate.current?.notch?.isOpen == true { AppDelegate.current?.notch?.closeNotch() }
            } catch {
                flash("Couldn't start recording: \(error.localizedDescription)")
            }
        }
    }

    func togglePause() {
        guard isRecording, let sink else { return }
        if isPaused {
            sink.resume()
            segmentStart = .now
            isPaused = false
        } else {
            sink.pause()
            if let s = segmentStart { accumulated += Date.now.timeIntervalSince(s) }
            segmentStart = nil
            isPaused = true
        }
        tick()
    }

    func stop() {
        guard isRecording, let stream, let sink, let url else { return }
        isRecording = false
        isPaused = false
        ticker?.invalidate()
        ticker = nil
        ScreenRecordingDetector.shared.ownRecordingActive = false
        LiveActivityCenter.shared.recompute()
        Task {
            try? await stream.stopCapture()
            let ok = await sink.finish()
            self.stream = nil
            self.sink = nil
            guard ok else { flash("Recording failed to save."); return }
            if SettingsManager.shared.trimAfterRecording {
                trimWindow = TrimWindowController(url: url) { [weak self] final in
                    self?.trimWindow = nil
                    self?.flash("Recording saved to Desktop")
                    NSWorkspace.shared.activateFileViewerSelecting([final])
                }
                trimWindow?.show()
            } else {
                flash("Recording saved to Desktop")
                NSWorkspace.shared.activateFileViewerSelecting([url])
            }
        }
    }

    private func startTicker() {
        let t = Timer(timeInterval: 0.5, repeats: true) { [weak self] _ in MainActor.assumeIsolated { self?.tick() } }
        RunLoop.main.add(t, forMode: .common)
        ticker = t
        tick()
    }

    private func tick() {
        elapsed = accumulated + (segmentStart.map { Date.now.timeIntervalSince($0) } ?? 0)
        LiveActivityCenter.shared.recompute()
    }

    private func flash(_ text: String) {
        message = text
        DispatchQueue.main.asyncAfter(deadline: .now() + 5) { [weak self] in if self?.message == text { self?.message = nil } }
    }

    private static func desktopURL() -> URL {
        let f = DateFormatter()
        f.dateFormat = "yyyy-MM-dd 'at' HH.mm.ss"
        let desktop = FileManager.default.urls(for: .desktopDirectory, in: .userDomainMask)[0]
        return desktop.appendingPathComponent("Screen Recording \(f.string(from: .now)).mov")
    }

    enum RecorderError: LocalizedError {
        case noDisplay
        var errorDescription: String? { "No display to record" }
    }
}

/// Receives frames on its own queue and writes them, skipping paused stretches.
final class RecordingSink: NSObject, SCStreamOutput {
    let queue = DispatchQueue(label: "notchapple.recorder")
    private let writer: AVAssetWriter
    private let input: AVAssetWriterInput
    private var started = false
    private var paused = false
    private var resumePending = false
    private var offset = CMTime.zero
    private var lastPTS = CMTime.invalid

    init(url: URL, width: Int, height: Int) throws {
        writer = try AVAssetWriter(outputURL: url, fileType: .mov)
        input = AVAssetWriterInput(mediaType: .video, outputSettings: [
            AVVideoCodecKey: AVVideoCodecType.h264,
            AVVideoWidthKey: width,
            AVVideoHeightKey: height,
            AVVideoCompressionPropertiesKey: [AVVideoAverageBitRateKey: width * height * 6],
        ])
        input.expectsMediaDataInRealTime = true
        writer.add(input)
        super.init()
    }

    func pause() { queue.async { self.paused = true } }
    func resume() { queue.async { self.paused = false; self.resumePending = true } }

    func stream(_ stream: SCStream, didOutputSampleBuffer buffer: CMSampleBuffer, of type: SCStreamOutputType) {
        guard type == .screen, buffer.isValid, !paused else { return }
        // Only complete frames carry an image.
        if let attachments = CMSampleBufferGetSampleAttachmentsArray(buffer, createIfNecessary: false) as? [[SCStreamFrameInfo: Any]],
           let raw = attachments.first?[.status] as? Int, SCFrameStatus(rawValue: raw) != .complete { return }
        let pts = buffer.presentationTimeStamp
        if resumePending, lastPTS.isValid {
            offset = offset + (pts - lastPTS) - CMTime(value: 1, timescale: 60)
            resumePending = false
        }
        let adjusted = pts - offset
        if !started {
            guard writer.startWriting() else { return }
            writer.startSession(atSourceTime: adjusted)
            started = true
        }
        lastPTS = pts
        guard input.isReadyForMoreMediaData else { return }
        var timing = CMSampleTimingInfo(duration: buffer.duration, presentationTimeStamp: adjusted, decodeTimeStamp: .invalid)
        var copy: CMSampleBuffer?
        CMSampleBufferCreateCopyWithNewTiming(allocator: nil, sampleBuffer: buffer, sampleTimingEntryCount: 1, sampleTimingArray: &timing, sampleBufferOut: &copy)
        if let copy { input.append(copy) }
    }

    func finish() async -> Bool {
        await withCheckedContinuation { continuation in
            queue.async {
                guard self.started else { continuation.resume(returning: false); return }
                self.input.markAsFinished()
                self.writer.finishWriting { continuation.resume(returning: self.writer.status == .completed) }
            }
        }
    }
}

/// A small window with AVKit's trim bar. Save exports the chosen range over the original file.
@MainActor
final class TrimWindowController: NSObject, NSWindowDelegate {
    private let url: URL
    private let done: (URL) -> Void
    private var window: NSWindow?
    private let playerView = AVPlayerView()

    init(url: URL, done: @escaping (URL) -> Void) {
        self.url = url
        self.done = done
    }

    func show() {
        let player = AVPlayer(url: url)
        playerView.player = player
        playerView.controlsStyle = .inline
        let window = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 820, height: 520),
                              styleMask: [.titled, .closable, .resizable], backing: .buffered, defer: false)
        window.title = "Trim recording: drag the yellow handles, then Trim"
        window.contentView = playerView
        window.isReleasedWhenClosed = false
        window.delegate = self
        window.center()
        self.window = window
        NSApp.activate(ignoringOtherApps: true)
        window.makeKeyAndOrderFront(nil)
        // The trim bar needs the item to be ready.
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.4) { [weak self] in self?.beginTrim() }
    }

    private func beginTrim() {
        guard playerView.canBeginTrimming else { finish(url); return }
        playerView.beginTrimming { [weak self] result in
            guard let self else { return }
            MainActor.assumeIsolated {
                if result == .okButton, let item = self.playerView.player?.currentItem {
                    self.export(item: item)
                } else {
                    self.finish(self.url)
                }
            }
        }
    }

    private func export(item: AVPlayerItem) {
        let start = item.reversePlaybackEndTime.isValid ? item.reversePlaybackEndTime : .zero
        let end = item.forwardPlaybackEndTime.isValid ? item.forwardPlaybackEndTime : item.duration
        let out = url.deletingLastPathComponent().appendingPathComponent(url.deletingPathExtension().lastPathComponent + " (trimmed).mov")
        try? FileManager.default.removeItem(at: out)
        guard let session = AVAssetExportSession(asset: item.asset, presetName: AVAssetExportPresetPassthrough) else { finish(url); return }
        session.outputURL = out
        session.outputFileType = .mov
        session.timeRange = CMTimeRange(start: start, end: end)
        window?.title = "Saving…"
        session.exportAsynchronously { [weak self] in
            let ok = session.status == .completed
            DispatchQueue.main.async {
                guard let self else { return }
                if ok {
                    // Replace the original with the trimmed copy.
                    _ = try? FileManager.default.replaceItemAt(self.url, withItemAt: out)
                }
                self.finish(self.url)
            }
        }
    }

    private func finish(_ final: URL) {
        playerView.player?.pause()
        window?.delegate = nil
        window?.close()
        window = nil
        done(final)
    }

    func windowWillClose(_ notification: Notification) {
        playerView.player?.pause()
        window = nil
        done(url)
    }
}
