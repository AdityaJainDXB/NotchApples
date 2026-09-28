//
//  FaceUnlock.swift
//  Notch apple
//
//  Webcam face unlock for Notch apple's own lock, built on AVFoundation and
//  Apple's Vision framework. Everything runs on-device.
//
//  Enrolment
//   • The camera takes several photos while you look at it from slightly
//     different angles. For each one, Vision finds your face, the face is
//     cropped, and Vision computes a "feature print": a list of numbers that
//     describes the image.
//   • Only those feature prints (plus a match threshold calibrated from how
//     much your own photos differ) are saved, in the macOS Keychain
//     (this device only, readable only while the Mac is unlocked). The photos
//     themselves are never written to disk.
//
//  Unlocking
//   • Live frames are compared with the saved feature prints. Several frames
//     must match, AND you must blink: a basic liveness check that stops a
//     printed photo from working.
//
//  Limits (shown in the UI too): a 2D webcam isn't Apple's Face ID, which uses
//  a 3D depth camera. Treat this as a convenience; Touch ID / your password
//  always remain available. Third-party apps can't unlock macOS itself.
//

@preconcurrency import AVFoundation
import Vision
import CoreImage
import SwiftUI

// MARK: - Stored template

// MARK: - Pluggable face embedder

/// Turns a cropped face into a vector of numbers. Two photos of the same person
/// should give vectors that are close together (small Euclidean distance).
///
/// To use a dedicated Core ML face-recognition model (for example an ArcFace
/// model), implement this protocol with `VNCoreMLRequest` and set
/// `FaceUnlockEngine.embedder`. Templates remember which embedder made them,
/// so switching embedders simply asks the user to enrol again.
protocol FaceEmbedder: Sendable {
    /// Stable ID saved with each template, e.g. "vision-featureprint-v1".
    var identifier: String { get }
    func embedding(forFace face: CGImage) -> [Float]?
}

/// Default embedder: Apple's built-in Vision feature print. No extra model to ship.
struct VisionFeaturePrintEmbedder: FaceEmbedder {
    let identifier = "vision-featureprint-v1"

    func embedding(forFace face: CGImage) -> [Float]? {
        let request = VNGenerateImageFeaturePrintRequest()
        try? VNImageRequestHandler(cgImage: face).perform([request])
        guard let print = request.results?.first else { return nil }
        let data = print.data
        switch print.elementType {
        case .float:
            return data.withUnsafeBytes { Array($0.bindMemory(to: Float.self)) }
        case .double:
            return data.withUnsafeBytes { $0.bindMemory(to: Double.self).map(Float.init) }
        default:
            return nil
        }
    }
}

enum FaceMath {
    static func distance(_ a: [Float], _ b: [Float]) -> Float {
        guard a.count == b.count else { return .infinity }
        var sum: Float = 0
        for i in a.indices { let d = a[i] - b[i]; sum += d * d }
        return sum.squareRoot()
    }
}

// MARK: - Stored template

private struct FaceTemplate: Codable {
    /// One embedding per enrolment photo.
    var embeddings: [[Float]]
    /// Largest distance still counted as "same face".
    var threshold: Float
    /// Which `FaceEmbedder` produced these.
    var embedder: String
    var created: Date
}

enum FaceTemplateStore {
    static var isEnrolled: Bool { load() != nil }

    fileprivate static func load() -> (embeddings: [[Float]], threshold: Float)? {
        guard let data = KeychainHelper.getData(.faceTemplate),
              let template = try? JSONDecoder().decode(FaceTemplate.self, from: data),
              template.embedder == FaceUnlockEngine.embedder.identifier,
              !template.embeddings.isEmpty else { return nil }
        return (template.embeddings, template.threshold)
    }

    fileprivate static func save(_ embeddings: [[Float]]) -> Bool {
        // Calibrate: how different are the user's own enrolment photos?
        var distances: [Float] = []
        for i in embeddings.indices {
            for j in embeddings.indices where j > i { distances.append(FaceMath.distance(embeddings[i], embeddings[j])) }
        }
        let spread = distances.max() ?? 0.5
        // Allow some slack for lighting, but never accept anything wildly different.
        let threshold = max(0.25, min(spread * 1.2, 0.75))
        let template = FaceTemplate(embeddings: embeddings, threshold: threshold,
                                    embedder: FaceUnlockEngine.embedder.identifier, created: .now)
        guard let data = try? JSONEncoder().encode(template) else { return false }
        return KeychainHelper.setData(data, for: .faceTemplate)
    }

    static func delete() { KeychainHelper.delete(.faceTemplate) }
}

// MARK: - Camera + Vision engine

@MainActor
final class FaceUnlockEngine: NSObject, ObservableObject {
    enum Mode { case idle, enrolling, verifying }

    /// Swap for a Core ML-backed embedder to upgrade recognition.
    nonisolated static let embedder: any FaceEmbedder = VisionFeaturePrintEmbedder()

    @Published private(set) var mode: Mode = .idle
    @Published private(set) var prompt = ""
    @Published private(set) var progress: Double = 0
    @Published private(set) var faceVisible = false
    @Published private(set) var error: String?

    let session = AVCaptureSession()
    private let output = AVCaptureVideoDataOutput()
    private let videoQueue = DispatchQueue(label: "notchapple.face.video")
    private var lastProcessed = Date.distantPast

    // Enrolment state
    private var samples: [[Float]] = []
    private static let samplesNeeded = 6
    private static let enrolPrompts = ["Look straight at the camera", "Turn your head slightly left",
                                       "Turn your head slightly right", "Tilt your chin up a little",
                                       "Tilt your chin down a little", "Look straight again"]
    private var onEnrolled: ((Bool) -> Void)?

    // Verification state
    private var template: (embeddings: [[Float]], threshold: Float)?
    private var matches = 0
    private var eyesWereOpen = false
    private var blinked = false
    private var deadline = Date.distantFuture
    private var onVerified: ((Bool) -> Void)?

    // MARK: Public API

    /// Takes several photos and saves the face template to the Keychain.
    func enrol(completion: @escaping (Bool) -> Void) {
        samples = []
        progress = 0
        onEnrolled = completion
        prompt = Self.enrolPrompts[0]
        start(.enrolling)
    }

    /// Looks for a matching, blinking face for up to `timeout` seconds.
    func verify(timeout: TimeInterval = 8, completion: @escaping (Bool) -> Void) {
        guard let template = FaceTemplateStore.load() else { completion(false); return }
        self.template = template
        matches = 0; eyesWereOpen = false; blinked = false
        progress = 0
        deadline = Date.now.addingTimeInterval(timeout)
        onVerified = completion
        prompt = "Look at the camera and blink"
        start(.verifying)
    }

    func stop() {
        mode = .idle
        let session = self.session
        videoQueue.async { if session.isRunning { session.stopRunning() } }
    }

    // MARK: Camera

    private func start(_ newMode: Mode) {
        error = nil
        mode = newMode
        switch AVCaptureDevice.authorizationStatus(for: .video) {
        case .authorized:
            configureAndRun()
        case .notDetermined:
            AVCaptureDevice.requestAccess(for: .video) { granted in
                Task { @MainActor in granted ? self.configureAndRun() : self.fail("Camera access was denied.") }
            }
        default:
            fail("Allow camera access for Notch apple in System Settings → Privacy & Security → Camera.")
        }
    }

    private func configureAndRun() {
        if session.inputs.isEmpty {
            session.beginConfiguration()
            session.sessionPreset = .high
            guard let device = AVCaptureDevice.default(for: .video),
                  let input = try? AVCaptureDeviceInput(device: device), session.canAddInput(input) else {
                session.commitConfiguration()
                fail("No camera found.")
                return
            }
            session.addInput(input)
            output.alwaysDiscardsLateVideoFrames = true
            output.setSampleBufferDelegate(self, queue: videoQueue)
            if session.canAddOutput(output) { session.addOutput(output) }
            session.commitConfiguration()
        }
        let session = self.session
        videoQueue.async { if !session.isRunning { session.startRunning() } }
    }

    private func fail(_ message: String) {
        error = message
        let enrolled = onEnrolled, verified = onVerified
        onEnrolled = nil; onVerified = nil
        stop()
        enrolled?(false); verified?(false)
    }

    // MARK: Frame handling (main actor)

    fileprivate func handle(_ result: FrameResult) {
        faceVisible = result.faceFound
        switch mode {
        case .enrolling:
            guard let print = result.embedding, result.eyesOpen else { return }
            // Space samples out so each pose is a little different.
            samples.append(print)
            progress = Double(samples.count) / Double(Self.samplesNeeded)
            if samples.count >= Self.samplesNeeded {
                let ok = FaceTemplateStore.save(samples)
                let done = onEnrolled
                onEnrolled = nil
                prompt = ok ? "Face saved" : "Couldn't save to the Keychain"
                stop()
                done?(ok)
            } else {
                prompt = Self.enrolPrompts[samples.count]
            }
        case .verifying:
            if Date.now > deadline {
                prompt = blinked ? "Face not recognised" : "No blink detected"
                let done = onVerified
                onVerified = nil
                stop()
                done?(false)
                return
            }
            if result.eyesOpen { eyesWereOpen = true }
            if eyesWereOpen && result.eyesClosed { blinked = true }
            if let embedding = result.embedding, let template, Self.matchesTemplate(embedding, template) { matches += 1 }
            progress = min(1, Double(min(matches, 3)) / 3 * 0.7 + (blinked ? 0.3 : 0))
            prompt = matches < 3 ? "Look at the camera" : (blinked ? "Recognised" : "Now blink")
            if matches >= 3 && blinked {
                let done = onVerified
                onVerified = nil
                stop()
                done?(true)
            }
        case .idle:
            break
        }
    }

    private static func matchesTemplate(_ embedding: [Float],
                                        _ template: (embeddings: [[Float]], threshold: Float)) -> Bool {
        let best = template.embeddings.map { FaceMath.distance(embedding, $0) }.min() ?? .infinity
        return best <= template.threshold
    }
}

// MARK: - Vision (video queue)

fileprivate struct FrameResult: @unchecked Sendable {
    var faceFound = false
    var embedding: [Float]?
    var eyesOpen = false
    var eyesClosed = false
}

extension FaceUnlockEngine: AVCaptureVideoDataOutputSampleBufferDelegate {
    nonisolated func captureOutput(_ output: AVCaptureOutput, didOutput sampleBuffer: CMSampleBuffer, from connection: AVCaptureConnection) {
        guard let pixels = CMSampleBufferGetImageBuffer(sampleBuffer) else { return }
        let result = Self.analyse(pixels)
        Task { @MainActor in
            // ~6 frames per second is plenty and keeps CPU use low.
            guard Date.now.timeIntervalSince(self.lastProcessed) > (self.mode == .enrolling ? 0.6 : 0.15) else { return }
            self.lastProcessed = .now
            self.handle(result)
        }
    }

    nonisolated private static func analyse(_ pixels: CVPixelBuffer) -> FrameResult {
        var result = FrameResult()
        let landmarks = VNDetectFaceLandmarksRequest()
        let handler = VNImageRequestHandler(cvPixelBuffer: pixels, orientation: .up)
        try? handler.perform([landmarks])
        // Exactly one reasonably large face.
        guard let faces = landmarks.results, faces.count == 1, let face = faces.first,
              face.boundingBox.width > 0.15 else { return result }
        result.faceFound = true

        // Eye openness from landmark aspect ratio (height / width).
        if let l = face.landmarks?.leftEye, let r = face.landmarks?.rightEye {
            let ratio = (aspect(l.normalizedPoints) + aspect(r.normalizedPoints)) / 2
            result.eyesOpen = ratio > 0.22
            result.eyesClosed = ratio < 0.14
        }

        // Crop the face (with a margin) and compute its feature print.
        let image = CIImage(cvPixelBuffer: pixels)
        let w = image.extent.width, h = image.extent.height
        let box = face.boundingBox
        let rect = CGRect(x: box.minX * w, y: box.minY * h, width: box.width * w, height: box.height * h)
            .insetBy(dx: -box.width * w * 0.15, dy: -box.height * h * 0.15)
            .intersection(image.extent)
        let context = CIContext()
        guard let crop = context.createCGImage(image.cropped(to: rect), from: rect) else { return result }
        result.embedding = FaceUnlockEngine.embedder.embedding(forFace: crop)
        return result
    }

    nonisolated private static func aspect(_ points: [CGPoint]) -> CGFloat {
        guard let minX = points.map(\.x).min(), let maxX = points.map(\.x).max(),
              let minY = points.map(\.y).min(), let maxY = points.map(\.y).max(), maxX > minX else { return 0 }
        return (maxY - minY) / (maxX - minX)
    }
}

// MARK: - Camera preview

struct CameraPreview: NSViewRepresentable {
    let session: AVCaptureSession

    func makeNSView(context: Context) -> NSView {
        let view = NSView()
        let layer = AVCaptureVideoPreviewLayer(session: session)
        layer.videoGravity = .resizeAspectFill
        // Mirror like a mirror / FaceTime.
        layer.connection?.automaticallyAdjustsVideoMirroring = false
        layer.connection?.isVideoMirrored = true
        view.layer = layer
        view.wantsLayer = true
        return view
    }

    func updateNSView(_ nsView: NSView, context: Context) {}
}

/// Round camera view with a progress ring, used for both enrolment and unlock.
struct FaceScanView: View {
    @ObservedObject var engine: FaceUnlockEngine
    var size: CGFloat = 150

    var body: some View {
        VStack(spacing: 10) {
            ZStack {
                CameraPreview(session: engine.session)
                    .frame(width: size, height: size)
                    .clipShape(Circle())
                    .overlay(Circle().stroke(Color.white.opacity(0.15), lineWidth: 6))
                Circle()
                    .trim(from: 0, to: engine.progress)
                    .stroke(engine.faceVisible ? Color.green : Theme.accent, style: StrokeStyle(lineWidth: 6, lineCap: .round))
                    .rotationEffect(.degrees(-90))
                    .animation(.easeOut(duration: 0.25), value: engine.progress)
            }
            .frame(width: size + 6, height: size + 6)
            Text(engine.error ?? engine.prompt)
                .font(.system(size: 13, weight: .medium))
                .foregroundStyle(engine.error == nil ? .primary : Color.red)
                .multilineTextAlignment(.center)
        }
    }
}
