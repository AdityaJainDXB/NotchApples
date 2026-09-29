//
//  MirrorView.swift
//  Notch apple
//
//  A mirror in the notch: a live preview of your Mac's camera, to check your
//  hair before a call. Add-on, off by default (Settings → Modules).
//
//  The camera only runs while the Mirror tab is showing and stops the moment
//  you switch tabs or close the notch. Nothing is recorded or saved.
//

import AVFoundation
import AppKit
import SwiftUI

@MainActor
final class MirrorCamera: ObservableObject {
    static let shared = MirrorCamera()

    @Published private(set) var status = AVCaptureDevice.authorizationStatus(for: .video)
    @Published private(set) var isRunning = false
    @Published private(set) var cameras: [AVCaptureDevice] = []
    @AppStorage("mirror.cameraID") var cameraID = ""

    let session = AVCaptureSession()
    private let queue = DispatchQueue(label: "notchapple.mirror")

    func start() {
        status = AVCaptureDevice.authorizationStatus(for: .video)
        switch status {
        case .authorized: configureAndRun()
        case .notDetermined:
            NSApp.activate(ignoringOtherApps: true)
            AVCaptureDevice.requestAccess(for: .video) { _ in
                Task { @MainActor in
                    self.status = AVCaptureDevice.authorizationStatus(for: .video)
                    if self.status == .authorized { self.configureAndRun() }
                }
            }
        default: break
        }
    }

    func stop() {
        let session = session
        queue.async { if session.isRunning { session.stopRunning() } }
        isRunning = false
    }

    func select(_ device: AVCaptureDevice) {
        cameraID = device.uniqueID
        configureAndRun()
    }

    private func configureAndRun() {
        cameras = AVCaptureDevice.DiscoverySession(deviceTypes: [.builtInWideAngleCamera, .external, .continuityCamera],
                                                   mediaType: .video, position: .unspecified).devices
        guard let device = cameras.first(where: { $0.uniqueID == cameraID }) ?? AVCaptureDevice.default(for: .video) ?? cameras.first,
              let input = try? AVCaptureDeviceInput(device: device) else { return }
        let session = session
        queue.async {
            session.beginConfiguration()
            session.inputs.forEach { session.removeInput($0) }
            session.sessionPreset = .high
            if session.canAddInput(input) { session.addInput(input) }
            session.commitConfiguration()
            if !session.isRunning { session.startRunning() }
        }
        isRunning = true
    }
}

/// AVCaptureVideoPreviewLayer in a view, mirrored like a real mirror.
private struct MirrorPreview: NSViewRepresentable {
    let session: AVCaptureSession
    var mirrored: Bool
    var zoom: CGFloat

    func makeNSView(context: Context) -> NSView {
        let view = NSView()
        view.wantsLayer = true
        let layer = AVCaptureVideoPreviewLayer(session: session)
        layer.videoGravity = .resizeAspectFill
        view.layer = layer
        return view
    }

    func updateNSView(_ view: NSView, context: Context) {
        guard let layer = view.layer as? AVCaptureVideoPreviewLayer else { return }
        if let connection = layer.connection, connection.isVideoMirroringSupported {
            connection.automaticallyAdjustsVideoMirroring = false
            connection.isVideoMirrored = mirrored
        }
        layer.setAffineTransform(CGAffineTransform(scaleX: zoom, y: zoom))
    }
}

struct MirrorView: View {
    @StateObject private var camera = MirrorCamera.shared
    @AppStorage("mirror.flip") private var mirrored = true
    @AppStorage("mirror.light") private var ringLight = false
    @State private var zoom: CGFloat = 1

    var body: some View {
        HStack(spacing: 12) {
            ZStack {
                if camera.status == .authorized {
                    MirrorPreview(session: camera.session, mirrored: mirrored, zoom: zoom)
                        .clipShape(RoundedRectangle(cornerRadius: 18, style: .continuous))
                } else {
                    permission
                }
            }
            .padding(ringLight ? 14 : 0)
            .background(RoundedRectangle(cornerRadius: 26, style: .continuous).fill(ringLight ? Color.white : .clear))
            .animation(.easeOut(duration: 0.2), value: ringLight)

            VStack(alignment: .leading, spacing: 12) {
                Label("Mirror", systemImage: "person.crop.square").font(.system(size: 13, weight: .semibold)).foregroundStyle(.white)
                Toggle("Flip like a mirror", isOn: $mirrored).toggleStyle(.switch).controlSize(.small)
                Toggle("Ring light", isOn: $ringLight).toggleStyle(.switch).controlSize(.small)
                    .help("A white frame that lights up your face in a dark room")
                VStack(alignment: .leading, spacing: 4) {
                    Text("Zoom").font(.system(size: 11)).foregroundStyle(Theme.textSecondary)
                    Slider(value: $zoom, in: 1...2.5)
                }
                if camera.cameras.count > 1 {
                    Menu("Camera") {
                        ForEach(camera.cameras, id: \.uniqueID) { device in
                            Button(device.localizedName) { camera.select(device) }
                        }
                    }
                }
                Spacer(minLength: 0)
                Text("Nothing is recorded. The camera turns off when you leave this tab.")
                    .font(.system(size: 10)).foregroundStyle(Theme.textSecondary)
                    .fixedSize(horizontal: false, vertical: true)
            }
            .frame(width: 170)
        }
        .padding(4)
        .onAppear { camera.start() }
        .onDisappear { camera.stop() }
    }

    private var permission: some View {
        VStack(spacing: 10) {
            Image(systemName: "camera.fill").font(.system(size: 28)).foregroundStyle(Theme.accent)
            Text(camera.status == .notDetermined ? "Allow the camera to use the mirror." : "Camera access is off for Notch apple.")
                .foregroundStyle(.white)
            if camera.status == .notDetermined {
                Button("Allow camera") { camera.start() }.buttonStyle(PurpleButtonStyle())
            } else {
                Button("Open Camera settings…") { PermissionsModel.openPrivacy("Privacy_Camera") }.buttonStyle(PurpleButtonStyle())
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(Theme.surface, in: RoundedRectangle(cornerRadius: 18, style: .continuous))
    }
}
