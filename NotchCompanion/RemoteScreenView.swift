//
//  RemoteScreenView.swift
//  Notch Apple companion (iPhone)
//
//  The Mac's screen on the phone, with pinch-to-zoom and pan, a choice of display, and clear states (connecting, live, and why
//  it stopped). Watching only; controlling the Mac comes in a later version.
//

import SwiftUI
import UIKit

struct RemoteScreenView: View {
    @StateObject private var viewer = RemoteViewClient()
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        ZStack {
            Color.black.ignoresSafeArea()
            ZoomableImage(image: viewer.image).ignoresSafeArea(edges: .bottom)
            switch viewer.state {
            case .connecting, .idle:
                VStack(spacing: 10) { ProgressView().tint(.white); Text("Connecting to your Mac…").foregroundStyle(.white) }
            case .failed(let message):
                VStack(spacing: 12) {
                    Image(systemName: "exclamationmark.triangle.fill").font(.largeTitle).foregroundStyle(.orange)
                    Text(message).multilineTextAlignment(.center).foregroundStyle(.white).padding(.horizontal, 24)
                    Button("Try again") { viewer.start(display: viewer.currentDisplay) }.buttonStyle(.borderedProminent)
                }
                .padding().background(.black.opacity(0.75), in: RoundedRectangle(cornerRadius: 16))
            case .live:
                if viewer.image == nil { ProgressView().tint(.white) }
            }
        }
        .navigationTitle(CompanionClient.shared.pairing?.macName ?? "Mac")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .primaryAction) {
                Menu {
                    if viewer.displays.count > 1 {
                        Section("Display") {
                            ForEach(viewer.displays, id: \.id) { d in
                                Button { viewer.choose(display: d.id) } label: {
                                    Label("\(d.name)  \(d.width)×\(d.height)", systemImage: viewer.currentDisplay == d.id ? "checkmark" : "display")
                                }
                            }
                        }
                    }
                    Button("Reconnect") { viewer.start(display: viewer.currentDisplay) }
                    Button("Stop watching", role: .destructive) { viewer.stop(); dismiss() }
                } label: { Image(systemName: "ellipsis.circle") }
            }
            ToolbarItem(placement: .bottomBar) {
                if viewer.state == .live { Text("\(viewer.framesPerSecond) fps · pinch to zoom, drag to move").font(.caption).foregroundStyle(.secondary) }
            }
        }
        .onAppear { viewer.start() }
        .onDisappear { viewer.stop(quiet: true) }
        .persistentSystemOverlays(.hidden)
    }
}

/// An image you can pinch and drag. Updating the picture keeps the zoom and position.
struct ZoomableImage: UIViewRepresentable {
    var image: UIImage?

    func makeCoordinator() -> Coordinator { Coordinator() }

    func makeUIView(context: Context) -> UIScrollView {
        let scroll = UIScrollView()
        scroll.minimumZoomScale = 1; scroll.maximumZoomScale = 6
        scroll.delegate = context.coordinator
        scroll.showsHorizontalScrollIndicator = false; scroll.showsVerticalScrollIndicator = false
        scroll.bouncesZoom = true; scroll.backgroundColor = .black
        let view = UIImageView()
        view.contentMode = .scaleAspectFit
        view.frame = scroll.bounds
        view.autoresizingMask = [.flexibleWidth, .flexibleHeight]
        scroll.addSubview(view)
        context.coordinator.imageView = view
        let double = UITapGestureRecognizer(target: context.coordinator, action: #selector(Coordinator.doubleTap(_:)))
        double.numberOfTapsRequired = 2
        scroll.addGestureRecognizer(double)
        return scroll
    }

    func updateUIView(_ scroll: UIScrollView, context: Context) {
        if let image { context.coordinator.imageView?.image = image }
    }

    final class Coordinator: NSObject, UIScrollViewDelegate {
        weak var imageView: UIImageView?
        func viewForZooming(in scrollView: UIScrollView) -> UIView? { imageView }
        @objc func doubleTap(_ g: UITapGestureRecognizer) {
            guard let scroll = g.view as? UIScrollView else { return }
            if scroll.zoomScale > 1.01 { scroll.setZoomScale(1, animated: true) }
            else {
                let p = g.location(in: imageView), w = scroll.bounds.width / 3, h = scroll.bounds.height / 3
                scroll.zoom(to: CGRect(x: p.x - w / 2, y: p.y - h / 2, width: w, height: h), animated: true)
            }
        }
    }
}
