//
//  RemoteScreenView.swift
//  Notch Apple companion (iPhone)
//
//  The Mac's screen on the phone, with pinch-to-zoom and pan, a choice of display, and clear states (connecting, live, and why
//  it stopped). Control is a separate step: tap the hand to ask the Mac; only if its "Allow remote control" switch, this
//  phone's permission and Accessibility are all on does it say yes. While controlling: tap = click, double tap = double click,
//  long press = right click, drag = drag, two fingers = scroll, and a keyboard bar types and sends shortcuts.
//

import SwiftUI
import UIKit

struct RemoteScreenView: View {
    @StateObject private var viewer = RemoteViewClient()
    @Environment(\.dismiss) private var dismiss
    @State private var typed = " "
    @State private var mods = Set<String>()
    @FocusState private var typing: Bool

    var body: some View {
        ZStack {
            Color.black.ignoresSafeArea()
            ZoomableImage(image: viewer.image, imageSize: viewer.size, controlling: viewer.controlOn) { viewer.sendInput($0) }.ignoresSafeArea(edges: .bottom)
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
            if let note = viewer.notice {
                VStack { Spacer(); Text(note).font(.footnote).foregroundStyle(.white).padding(10).background(.red.opacity(0.85), in: RoundedRectangle(cornerRadius: 10)).padding()
                    .onTapGesture { viewer.notice = nil } }
            }
            TextField("", text: $typed).focused($typing).opacity(0.01).frame(width: 1, height: 1).autocorrectionDisabled().textInputAutocapitalization(.never)
                .onChange(of: typed) { old, new in send(typedDiff: old, new) }
        }
        .navigationTitle(CompanionClient.shared.pairing?.macName ?? "Mac")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .primaryAction) {
                HStack {
                    if viewer.state == .live {
                        Button { viewer.setControl(!viewer.controlOn) } label: {
                            Image(systemName: viewer.controlOn ? "hand.point.up.left.fill" : "hand.point.up.left").foregroundStyle(viewer.controlOn ? .red : .accentColor)
                        }.accessibilityLabel(viewer.controlOn ? "Stop controlling" : "Control this Mac")
                    }
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
            }
            ToolbarItem(placement: .bottomBar) {
                if viewer.controlOn { keyBar }
                else if viewer.state == .live { Text("\(viewer.framesPerSecond) fps · pinch to zoom, drag to move").font(.caption).foregroundStyle(.secondary) }
            }
        }
        .onAppear { viewer.start() }
        .onDisappear { viewer.stop(quiet: true) }
        .persistentSystemOverlays(.hidden)
    }

    // MARK: Keyboard

    private var keyBar: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 8) {
                Button { typing.toggle() } label: { Image(systemName: "keyboard") }.accessibilityLabel("Keyboard")
                ForEach(["⌘", "⌃", "⌥", "⇧"], id: \.self) { m in
                    let name = ["⌘": "cmd", "⌃": "ctrl", "⌥": "alt", "⇧": "shift"][m]!
                    Button(m) { if mods.contains(name) { mods.remove(name) } else { mods.insert(name) } }
                        .padding(.horizontal, 8).background(mods.contains(name) ? Color.accentColor.opacity(0.4) : Color.clear, in: Capsule())
                }
                ForEach([("esc", "escape"), ("tab", "tab"), ("⌫", "delete"), ("↩", "return"), ("←", "left"), ("→", "right"), ("↑", "up"), ("↓", "down")], id: \.1) { label, name in
                    Button(label) { self.key(name) }
                }
                ForEach([("⌘C", "c"), ("⌘V", "v"), ("⌘A", "a"), ("⌘Z", "z"), ("⌘Tab", "tab"), ("⌘Space", "space")], id: \.0) { label, name in
                    Button(label) { viewer.sendInput(.init(kind: "shortcut", text: name, mods: ["cmd"])) }
                }
            }
            .font(.callout)
        }
    }

    /// A named key, with whichever modifiers are switched on (they switch off afterwards).
    private func key(_ name: String) {
        viewer.sendInput(.init(kind: mods.isEmpty ? "key" : "shortcut", text: name, mods: mods.isEmpty ? nil : Array(mods)))
        mods.removeAll()
    }

    /// The hidden field always holds a space, so deleting is noticed; what is added is typed on the Mac, what is removed is Delete.
    private func send(typedDiff old: String, _ new: String) {
        guard viewer.controlOn else { typed = " "; return }
        if new.count > old.count {
            let added = String(new.dropFirst(old.count))
            if mods.isEmpty { viewer.sendInput(.init(kind: "text", text: added)) }
            else if let c = added.first { viewer.sendInput(.init(kind: "shortcut", text: String(c).lowercased(), mods: Array(mods))); mods.removeAll() }
        } else if new.count < old.count { for _ in 0..<(old.count - new.count) { viewer.sendInput(.init(kind: "key", text: "delete")) } }
        if new != " " { typed = " " }
    }
}

/// An image you can pinch and drag. Updating the picture keeps the zoom and position. While `controlling`, the touches go to
/// the Mac instead (tap, double tap, long press, drag, two-finger scroll), positioned as fractions of the picture.
struct ZoomableImage: UIViewRepresentable {
    var image: UIImage?
    var imageSize: CGSize = .zero
    var controlling = false
    var onInput: (Companion.InputEvent) -> Void = { _ in }

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
        let c = context.coordinator
        c.imageView = view; c.scroll = scroll
        func add(_ g: UIGestureRecognizer) { scroll.addGestureRecognizer(g); c.control.append(g) }
        let zoomTap = UITapGestureRecognizer(target: c, action: #selector(Coordinator.zoomTap(_:))); zoomTap.numberOfTapsRequired = 2
        scroll.addGestureRecognizer(zoomTap); c.zoomTap = zoomTap
        let tap = UITapGestureRecognizer(target: c, action: #selector(Coordinator.tap(_:)))
        let double = UITapGestureRecognizer(target: c, action: #selector(Coordinator.doubleTap(_:))); double.numberOfTapsRequired = 2
        tap.require(toFail: double)
        let press = UILongPressGestureRecognizer(target: c, action: #selector(Coordinator.longPress(_:))); press.minimumPressDuration = 0.6
        let drag = UIPanGestureRecognizer(target: c, action: #selector(Coordinator.drag(_:))); drag.minimumNumberOfTouches = 1; drag.maximumNumberOfTouches = 1
        let scrollPan = UIPanGestureRecognizer(target: c, action: #selector(Coordinator.twoFinger(_:))); scrollPan.minimumNumberOfTouches = 2; scrollPan.maximumNumberOfTouches = 2
        [tap, double, press, drag, scrollPan].forEach(add)
        c.control.forEach { $0.isEnabled = false }
        return scroll
    }

    func updateUIView(_ scroll: UIScrollView, context: Context) {
        let c = context.coordinator
        if let image { c.imageView?.image = image }
        c.onInput = onInput; c.imageSize = imageSize
        if c.wasControlling != controlling {
            c.wasControlling = controlling
            c.control.forEach { $0.isEnabled = controlling }
            c.zoomTap?.isEnabled = !controlling
            scroll.panGestureRecognizer.isEnabled = !controlling
        }
    }

    final class Coordinator: NSObject, UIScrollViewDelegate {
        weak var imageView: UIImageView?
        weak var scroll: UIScrollView?
        var control: [UIGestureRecognizer] = []
        var zoomTap: UITapGestureRecognizer?
        var wasControlling = false
        var onInput: (Companion.InputEvent) -> Void = { _ in }
        var imageSize = CGSize.zero
        private var lastTranslation = CGPoint.zero

        func viewForZooming(in scrollView: UIScrollView) -> UIView? { imageView }

        /// Where a touch is on the picture, as fractions (0...1), allowing for the bars around a picture that doesn't fill the view.
        private func fraction(_ g: UIGestureRecognizer) -> (Double, Double)? {
            guard let view = imageView, let image = view.image else { return nil }
            let p = g.location(in: view), box = view.bounds.size, s = image.size
            let scale = min(box.width / s.width, box.height / s.height)
            let w = s.width * scale, h = s.height * scale
            let x = (p.x - (box.width - w) / 2) / w, y = (p.y - (box.height - h) / 2) / h
            return (min(max(Double(x), 0), 1), min(max(Double(y), 0), 1))
        }

        @objc func zoomTap(_ g: UITapGestureRecognizer) {
            guard let scroll = g.view as? UIScrollView else { return }
            if scroll.zoomScale > 1.01 { scroll.setZoomScale(1, animated: true) }
            else {
                let p = g.location(in: imageView), w = scroll.bounds.width / 3, h = scroll.bounds.height / 3
                scroll.zoom(to: CGRect(x: p.x - w / 2, y: p.y - h / 2, width: w, height: h), animated: true)
            }
        }
        @objc func tap(_ g: UITapGestureRecognizer) {
            guard let (x, y) = fraction(g) else { return }
            onInput(.init(kind: "down", x: x, y: y, count: 1)); onInput(.init(kind: "up", x: x, y: y, count: 1))
        }
        @objc func doubleTap(_ g: UITapGestureRecognizer) {
            guard let (x, y) = fraction(g) else { return }
            for n in 1...2 { onInput(.init(kind: "down", x: x, y: y, count: n)); onInput(.init(kind: "up", x: x, y: y, count: n)) }
        }
        @objc func longPress(_ g: UILongPressGestureRecognizer) {
            guard g.state == .began, let (x, y) = fraction(g) else { return }
            onInput(.init(kind: "rdown", x: x, y: y)); onInput(.init(kind: "rup", x: x, y: y))
        }
        @objc func drag(_ g: UIPanGestureRecognizer) {
            guard let (x, y) = fraction(g) else { return }
            switch g.state {
            case .began: onInput(.init(kind: "down", x: x, y: y, count: 1))
            case .changed: onInput(.init(kind: "drag", x: x, y: y))
            case .ended, .cancelled, .failed: onInput(.init(kind: "up", x: x, y: y, count: 1))
            default: break
            }
        }
        @objc func twoFinger(_ g: UIPanGestureRecognizer) {
            let t = g.translation(in: g.view)
            if g.state == .began { lastTranslation = .zero }
            let dx = Double(t.x - lastTranslation.x), dy = Double(t.y - lastTranslation.y)
            lastTranslation = t
            if g.state == .changed, dx != 0 || dy != 0 { onInput(.init(kind: "scroll", dx: dx * 2, dy: dy * 2)) }
        }
    }
}
