//
//  NotchWindowController.swift
//  Notch apple
//
//  Owns the notch windows and their geometry.
//
//  Two windows, neither of which is ever resized while visible:
//   • `trigger` — a small AppKit window over the notch. It draws the collapsed
//                 notch, shows hover feedback, opens on click, and opens to
//                 the File Shelf when a file is dragged onto it.
//   • `panel`   — the expanded, fixed-size SwiftUI host, ordered in and out.
//
//  Resizing an NSHostingView's window mid-animation can throw AppKit into an
//  "Update Constraints in Window" loop and crash, so the SwiftUI window keeps
//  a constant frame and the open/close effect is animated inside it.
//

import AppKit
import SwiftUI

/// Borderless, transparent, non-activating panel that can still take keyboard
/// focus (needed for the Claude chat text field).
final class NotchPanel: NSPanel {
    init(contentRect: NSRect) {
        super.init(contentRect: contentRect,
                   styleMask: [.borderless, .nonactivatingPanel, .fullSizeContentView],
                   backing: .buffered, defer: false)
        isOpaque = false
        backgroundColor = .clear
        hasShadow = false
        keepAboveEverything(orderFront: false)   // above the menu bar so it sits "in" the notch, on every Space
        isMovable = false
        hidesOnDeactivate = false
        becomesKeyOnlyIfNeeded = false   // take key status on open so typing works immediately
        ignoresMouseEvents = false       // transparent pixels still receive clicks
    }

    override var canBecomeKey: Bool { true }
    override var canBecomeMain: Bool { false }
}

/// Shared UI state for the notch.
final class NotchState: ObservableObject {
    @Published var isExpanded = false
    @Published var isUnlocked = false
    /// The open tab; remembered so the notch reopens where you left it.
    @Published var selected: Module = Module(rawValue: UserDefaults.standard.string(forKey: "ui.lastTab") ?? "") ?? .today {
        didSet { UserDefaults.standard.set(selected.rawValue, forKey: "ui.lastTab") }
    }
    /// Size of the physical notch (or a synthetic pill on notch-less Macs).
    @Published var notchSize = CGSize(width: 200, height: 32)
    /// Size of the fully expanded panel (Settings → Notch → Size, Pro).
    @Published var expandedSize = NotchPrefs.defaultSize
    /// Tabs hidden on the display the notch is on (Settings → Notch → Displays, Pro).
    @Published var hiddenTabs: Set<String> = []
    /// True while the notch steps aside for a fullscreen app or a screen recording.
    @Published var isAutoHidden = false

    var toggle: () -> Void = {}
    var close: () -> Void = {}
}

extension NotchState {
    /// The tabs shown in the notch right now, in order.
    func visibleTabs(_ settings: SettingsManager) -> [Module] {
        settings.enabledTabs.filter { !hiddenTabs.contains($0.rawValue) }
    }
}

/// Draws the collapsed notch and handles click, hover and drag-over.
///
/// The view is wider and taller than the notch itself so it's easy to hit:
/// Apple's minimum pointer target on macOS is 28 × 28 pt, and the notch's
/// bottom edge is only a few points from where people actually click.
final class NotchTriggerView: NSView {
    /// Extra hit area around the visible notch shape, in points.
    static let hitPadding = NSSize(width: 24, height: 8)

    var onClick: () -> Void = {}
    var onDragEnter: () -> Void = {}
    var onHoverChange: (Bool) -> Void = { _ in }

    private var isHovered = false { didSet { needsDisplay = true } }
    private var tracking: NSTrackingArea?

    override init(frame: NSRect) {
        super.init(frame: frame)
        registerForDraggedTypes([.fileURL])
    }

    required init?(coder: NSCoder) { fatalError() }

    override func updateTrackingAreas() {
        super.updateTrackingAreas()
        if let tracking { removeTrackingArea(tracking) }
        let area = NSTrackingArea(rect: bounds, options: [.mouseEnteredAndExited, .activeAlways, .inVisibleRect],
                                  owner: self, userInfo: nil)
        addTrackingArea(area)
        tracking = area
    }

    /// Physical notch width, set by the controller.
    var notchWidth: CGFloat = 200 { didSet { needsDisplay = true } }
    /// What to show beside the closed notch (charging, focus timer, unread dot, volume/brightness HUD).
    var activity: LiveActivity? {
        didSet {
            if oldValue != activity { startTicker() }
            updateBarsTimer()
        }
    }

    /// Music bars redraw 20 times a second on a light timer (not the display link), only while music shows.
    /// With "Bars follow the music" on, each bar tracks a frequency band of what's playing.
    private var barsTimer: Timer?
    private var barPhase: CGFloat = 0
    private var barLevels: [CGFloat]?

    private func updateBarsTimer() {
        if activity?.musicBars == true {
            guard barsTimer == nil else { return }
            let meter = MusicLevelMeter.shared
            if SettingsManager.shared.musicBarsFollowAudio {
                meter.resetFailure()
                meter.start()
            }
            let t = Timer(timeInterval: 1.0 / 20, repeats: true) { [weak self] _ in
                guard let self else { return }
                self.barPhase += 1.0 / 20
                self.barLevels = meter.isLive ? meter.nextFrame() : nil
                self.needsDisplay = true
            }
            t.tolerance = 0.01
            RunLoop.main.add(t, forMode: .common)
            barsTimer = t
        } else {
            barsTimer?.invalidate()
            barsTimer = nil
            barLevels = nil
            MusicLevelMeter.shared.stop()
        }
    }
    /// True while the screen is being recorded: adds a glowing dot and a tooltip.
    var isRecording = false {
        didSet {
            guard oldValue != isRecording else { return }
            toolTip = isRecording ? "Screen is currently being recorded" : nil
            setAccessibilityLabel(isRecording ? "Screen is currently being recorded" : nil)
            startTicker()
        }
    }
    /// Called when the ear width has finished animating, so the controller can resize the window.
    var onEarSettled: () -> Void = {}

    /// Width of each "ear" beside the hardware notch for the current activity.
    static func earWidth(for activity: LiveActivity?) -> CGFloat {
        guard let activity else { return 0 }
        if activity.gauge != nil { return 122 }
        if activity.musicBars { return 40 }
        if activity.dotOnly { return 20 }
        // Wider ears for words ("Charging", "85% · 1h 20m to full"): both sides match, so the shape stays centred.
        let font = NSFont.monospacedDigitSystemFont(ofSize: 12.5, weight: .semibold)
        let right = (activity.label.map { NSAttributedString(string: $0, attributes: [.font: font]).size().width } ?? 0)
            + (activity.rightSymbol != nil ? 22 : 0)
        let left = activity.leftText.map { NSAttributedString(string: $0, attributes: [.font: NSFont.systemFont(ofSize: 12.5, weight: .semibold)]).size().width + 30 } ?? 0
        return max(58, ceil(max(left, right) + 14))
    }

    private var targetEar: CGFloat { max(Self.earWidth(for: activity), isRecording ? 24 : 0) }
    /// The ear width currently drawn (it eases toward `targetEar`). The window must be at least this wide.
    private(set) var displayedEar: CGFloat = 0
    private var displayedGauge: CGFloat = 0
    private var pulse: CGFloat = 0
    /// Synced to the display's refresh (up to 120 Hz on ProMotion), so the ears and gauge glide.
    private var ticker: CADisplayLink?
    private var lastTick: CFTimeInterval = 0

    private func startTicker() {
        needsDisplay = true
        guard ticker == nil else { return }
        lastTick = CACurrentMediaTime()
        let link = displayLink(target: self, selector: #selector(frame(_:)))
        link.add(to: .main, forMode: .common)
        ticker = link
    }

    @objc private func frame(_ link: CADisplayLink) {
        let now = CACurrentMediaTime()
        let dt = min(max(now - lastTick, 1.0 / 240), 1.0 / 20)
        lastTick = now
        tick(dt: CGFloat(dt))
    }

    /// Jumps straight to the final ear width. Used as a safety net so the window can never stay oversized
    /// if the animation timer is delayed (e.g. App Nap on a hidden agent app).
    func settle() {
        // Only the ear width matters for sizing the window; leave the gauge to keep gliding.
        guard displayedEar != targetEar else { return }
        displayedEar = targetEar
        needsDisplay = true
    }

    private func tick(dt: CGFloat) {
        let reduceMotion = NSWorkspace.shared.accessibilityDisplayShouldReduceMotion
        // Time-based easing: the same speed at 60 or 120 Hz, and no stutter if a frame is late.
        let earEase: CGFloat = reduceMotion ? 1 : 1 - exp(-dt * 16)
        let gaugeEase: CGFloat = reduceMotion ? 1 : 1 - exp(-dt * 22)
        var moving = false
        if abs(targetEar - displayedEar) > 0.3 { displayedEar += (targetEar - displayedEar) * earEase; moving = true }
        else if displayedEar != targetEar { displayedEar = targetEar; onEarSettled() }
        if let g = activity?.gauge.map({ CGFloat($0) }) {
            // While the ears are still opening, start the bar at the real level instead of sliding up from an old one.
            if displayedEar < targetEar * 0.85 { displayedGauge = g }
            if abs(g - displayedGauge) > 0.001 { displayedGauge += (g - displayedGauge) * gaugeEase; moving = true }
            else { displayedGauge = g }
        }
        if isRecording || activity?.pulse == true { pulse += 3.6 * dt; moving = true }
        needsDisplay = true
        if !moving { ticker?.invalidate(); ticker = nil }
    }

    override func draw(_ dirtyRect: NSRect) {
        let pad = Self.hitPadding
        let shoulder = NotchRootView.collapsedShoulder
        let ear = displayedEar
        // The visible silhouette, centred: notch + shoulders + ears.
        let width = notchWidth + 2 * (shoulder + ear)
        var notch = NSRect(x: bounds.midX - width / 2, y: bounds.minY + pad.height,
                           width: width, height: bounds.height - pad.height)
        if isHovered {
            // Hover feedback only (unless "Open on hover" is on).
            notch = notch.insetBy(dx: -6, dy: 0)
            notch.origin.y -= 3
            notch.size.height += 3
        }

        let path = Self.notchPath(in: notch, shoulder: shoulder, bottom: min(10, notch.height / 2))
        NSColor.black.setFill()
        path.fill()

        // Content appears once the ears have mostly opened, so text is never squashed.
        if let activity, ear >= Self.earWidth(for: activity) * 0.85 {
            let leftEar = NSRect(x: notch.minX + shoulder + 6, y: notch.minY, width: ear - 10, height: notch.height)
            let rightEar = NSRect(x: notch.maxX - shoulder - ear + 4, y: notch.minY, width: ear - 10, height: notch.height)
            if activity.musicBars {
                // Dynamic Island music: the album cover on the left, moving bars on the right.
                let side = min(notch.height - 10, 22)
                let artRect = NSRect(x: leftEar.minX + 1, y: leftEar.midY - side / 2, width: side, height: side)
                if let art = activity.artwork {
                    NSGraphicsContext.saveGraphicsState()
                    NSBezierPath(roundedRect: artRect, xRadius: 5, yRadius: 5).addClip()
                    art.draw(in: artRect, from: .zero, operation: .sourceOver, fraction: 1)
                    NSGraphicsContext.restoreGraphicsState()
                } else if let img = NSImage(systemSymbolName: "music.note", accessibilityDescription: nil)?
                            .withSymbolConfiguration(.init(pointSize: 13, weight: .semibold).applying(.init(paletteColors: [activity.tint]))) {
                    img.draw(in: NSRect(x: artRect.midX - img.size.width / 2, y: artRect.midY - img.size.height / 2,
                                        width: img.size.width, height: img.size.height))
                }
                let barColor = activity.artwork.flatMap(Self.accentColor(of:)) ?? activity.tint
                let count = 4, w: CGFloat = 3, gap: CGFloat = 2.5
                let total = CGFloat(count) * w + CGFloat(count - 1) * gap
                let maxH = min(notch.height - 12, 16)
                barColor.setFill()
                for i in 0..<count {
                    let speed: [CGFloat] = [5.1, 7.3, 6.2, 8.4]
                    let h: CGFloat
                    if let levels = barLevels, i < levels.count {
                        h = maxH * (0.18 + 0.82 * levels[i])
                    } else {
                        h = maxH * (0.3 + 0.7 * abs(sin(barPhase * speed[i] + CGFloat(i) * 1.3)))
                    }
                    let x = rightEar.maxX - total + CGFloat(i) * (w + gap)
                    NSBezierPath(roundedRect: NSRect(x: x, y: rightEar.midY - h / 2, width: w, height: h), xRadius: 1.5, yRadius: 1.5).fill()
                }
            } else if activity.gauge != nil {
                Self.drawGauge(value: displayedGauge, in: rightEar, tint: activity.tint)
                if let name = activity.symbol,
                   let img = NSImage(systemSymbolName: name, accessibilityDescription: nil)?
                        .withSymbolConfiguration(.init(pointSize: 14, weight: .semibold).applying(.init(paletteColors: [activity.tint]))) {
                    img.draw(in: NSRect(x: leftEar.minX + 2, y: leftEar.midY - img.size.height / 2, width: img.size.width, height: img.size.height))
                }
            } else if activity.dotOnly {
                let d: CGFloat = 8
                activity.tint.setFill()
                NSBezierPath(ovalIn: NSRect(x: rightEar.maxX - d, y: rightEar.midY - d / 2, width: d, height: d)).fill()
            } else {
                if let name = activity.symbol,
                   let img = NSImage(systemSymbolName: name, accessibilityDescription: nil)?
                        .withSymbolConfiguration(.init(pointSize: 13, weight: .semibold).applying(.init(paletteColors: [activity.tint]))) {
                    let size = img.size
                    let iconRect = NSRect(x: leftEar.minX + 2, y: leftEar.midY - size.height / 2, width: size.width, height: size.height)
                    if activity.pulse {
                        // Breathing glow: a meeting is about to start.
                        let t = (sin(pulse * 2) + 1) / 2
                        activity.tint.withAlphaComponent(0.18 + 0.3 * t).setFill()
                        NSBezierPath(ovalIn: iconRect.insetBy(dx: -4 - 2 * t, dy: -4 - 2 * t)).fill()
                    }
                    img.draw(in: iconRect)
                }
                if let name = activity.rightSymbol, let label = activity.label,
                   let img = NSImage(systemSymbolName: name, accessibilityDescription: nil)?
                        .withSymbolConfiguration(.init(pointSize: 12, weight: .semibold).applying(.init(paletteColors: [activity.rightTint ?? activity.tint]))) {
                    let w = NSAttributedString(string: label, attributes: [.font: NSFont.monospacedDigitSystemFont(ofSize: 12.5, weight: .semibold)]).size().width
                    img.draw(in: NSRect(x: rightEar.maxX - w - img.size.width - 5, y: rightEar.midY - img.size.height / 2, width: img.size.width, height: img.size.height))
                }
                if let word = activity.leftText {
                    let str = NSAttributedString(string: word, attributes: [.font: NSFont.systemFont(ofSize: 12.5, weight: .semibold),
                                                                            .foregroundColor: activity.tint])
                    str.draw(at: NSPoint(x: leftEar.minX + 30, y: leftEar.midY - str.size().height / 2))
                }
                if let label = activity.label {
                    let attrs: [NSAttributedString.Key: Any] = [
                        .font: NSFont.monospacedDigitSystemFont(ofSize: 12.5, weight: .semibold),
                        .foregroundColor: activity.rightTint ?? activity.tint,
                    ]
                    let str = NSAttributedString(string: label, attributes: attrs)
                    let size = str.size()
                    str.draw(at: NSPoint(x: rightEar.maxX - size.width, y: rightEar.midY - size.height / 2))
                }
            }
        }

        if isRecording, ear >= 20 {
            // Glowing dot that breathes between orange and purple.
            let t = (sin(pulse * 2) + 1) / 2
            let orange = NSColor.systemOrange, purple = NSColor(Theme.accent)
            let color = orange.blended(withFraction: t, of: purple) ?? orange
            let d: CGFloat = 7
            // Left ear when nothing else is drawn there; otherwise tucked in the top-left corner of the ear.
            let hasLeftIcon = activity?.symbol != nil
            let center = hasLeftIcon
                ? NSPoint(x: notch.minX + shoulder + 5, y: notch.maxY - 7)
                : NSPoint(x: notch.minX + shoulder + ear / 2, y: notch.midY)
            NSGraphicsContext.saveGraphicsState()
            let glow = NSShadow()
            glow.shadowColor = color.withAlphaComponent(0.5 + 0.4 * t)
            glow.shadowBlurRadius = 5 + 4 * t
            glow.shadowOffset = .zero
            glow.set()
            color.setFill()
            NSBezierPath(ovalIn: NSRect(x: center.x - d / 2, y: center.y - d / 2, width: d, height: d)).fill()
            NSGraphicsContext.restoreGraphicsState()
        }

        if isHovered {
            NSColor(Theme.accent).withAlphaComponent(0.9).setStroke()
            path.lineWidth = 1.5
            path.stroke()
        }
    }

    /// A bright colour from the album cover for the bars (cached per image).
    private static var colorCache = NSMapTable<NSImage, NSColor>.weakToStrongObjects()

    static func accentColor(of image: NSImage) -> NSColor? {
        if let c = colorCache.object(forKey: image) { return c }
        guard let cg = image.cgImage(forProposedRect: nil, context: nil, hints: nil) else { return nil }
        // Average of a tiny thumbnail, then pushed brighter and more saturated so it reads on black.
        var px = [UInt8](repeating: 0, count: 4)
        guard let ctx = CGContext(data: &px, width: 1, height: 1, bitsPerComponent: 8, bytesPerRow: 4,
                                  space: CGColorSpaceCreateDeviceRGB(), bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue) else { return nil }
        ctx.interpolationQuality = .medium
        ctx.draw(cg, in: CGRect(x: 0, y: 0, width: 1, height: 1))
        let base = NSColor(red: CGFloat(px[0]) / 255, green: CGFloat(px[1]) / 255, blue: CGFloat(px[2]) / 255, alpha: 1)
        var h: CGFloat = 0, sat: CGFloat = 0, b: CGFloat = 0, a: CGFloat = 0
        base.usingColorSpace(.deviceRGB)?.getHue(&h, saturation: &sat, brightness: &b, alpha: &a)
        let color = NSColor(hue: h, saturation: min(1, max(sat, 0.35) * 1.2), brightness: max(b, 0.85), alpha: 1)
        colorCache.setObject(color, forKey: image)
        return color
    }

    /// Rounded volume/brightness bar with a percentage, purple-accented.
    static func drawGauge(value: CGFloat, in rect: NSRect, tint: NSColor) {
        let label = NSAttributedString(string: "\(Int((value * 100).rounded()))", attributes: [
            .font: NSFont.monospacedDigitSystemFont(ofSize: 11.5, weight: .semibold), .foregroundColor: NSColor.white])
        let labelWidth: CGFloat = 26
        let track = NSRect(x: rect.minX + 2, y: rect.midY - 2.5, width: rect.width - labelWidth - 10, height: 5)
        NSColor.white.withAlphaComponent(0.18).setFill()
        NSBezierPath(roundedRect: track, xRadius: 2.5, yRadius: 2.5).fill()
        var fill = track
        fill.size.width = max(track.height, track.width * min(max(value, 0), 1))
        if value <= 0.001 { fill.size.width = 0 }
        if fill.width > 0 {
            NSGradient(colors: [NSColor(Theme.accent), tint])?.draw(in: NSBezierPath(roundedRect: fill, xRadius: 2.5, yRadius: 2.5), angle: 0)
        }
        let size = label.size()
        label.draw(at: NSPoint(x: rect.maxX - size.width, y: rect.midY - size.height / 2))
    }

    /// AppKit twin of `NotchShape` (AppKit's y axis points up, so top = maxY).
    static func notchPath(in r: NSRect, shoulder t: CGFloat, bottom b: CGFloat) -> NSBezierPath {
        let k: CGFloat = 0.55
        let p = NSBezierPath()
        p.move(to: NSPoint(x: r.minX, y: r.maxY))
        p.curve(to: NSPoint(x: r.minX + t, y: r.maxY - t),
                controlPoint1: NSPoint(x: r.minX + t * k, y: r.maxY),
                controlPoint2: NSPoint(x: r.minX + t, y: r.maxY - t * (1 - k)))
        p.line(to: NSPoint(x: r.minX + t, y: r.minY + b))
        p.curve(to: NSPoint(x: r.minX + t + b, y: r.minY),
                controlPoint1: NSPoint(x: r.minX + t, y: r.minY + b * (1 - k)),
                controlPoint2: NSPoint(x: r.minX + t + b * (1 - k), y: r.minY))
        p.line(to: NSPoint(x: r.maxX - t - b, y: r.minY))
        p.curve(to: NSPoint(x: r.maxX - t, y: r.minY + b),
                controlPoint1: NSPoint(x: r.maxX - t - b * (1 - k), y: r.minY),
                controlPoint2: NSPoint(x: r.maxX - t, y: r.minY + b * (1 - k)))
        p.line(to: NSPoint(x: r.maxX - t, y: r.maxY - t))
        p.curve(to: NSPoint(x: r.maxX, y: r.maxY),
                controlPoint1: NSPoint(x: r.maxX - t, y: r.maxY - t * (1 - k)),
                controlPoint2: NSPoint(x: r.maxX - t * k, y: r.maxY))
        p.close()
        return p
    }

    override func acceptsFirstMouse(for event: NSEvent?) -> Bool { true }
    override func scrollWheel(with event: NSEvent) { NotchGestures.shared.handle(event) }
    /// Long-press (½ s) runs the long-press gesture; a normal click opens the notch on release.
    var onLongPress: () -> Void = {}
    private var pressTimer: Timer?
    private var longPressFired = false
    override func mouseDown(with event: NSEvent) {
        longPressFired = false
        pressTimer?.invalidate()
        pressTimer = Timer.scheduledTimer(withTimeInterval: 0.5, repeats: false) { [weak self] _ in
            MainActor.assumeIsolated {
                guard let self else { return }
                self.longPressFired = true
                self.onLongPress()
            }
        }
    }
    override func mouseUp(with event: NSEvent) {
        pressTimer?.invalidate()
        pressTimer = nil
        if !longPressFired { onClick() }
    }
    override func mouseEntered(with event: NSEvent) { isHovered = true; NSCursor.pointingHand.set(); onHoverChange(true) }
    override func mouseExited(with event: NSEvent) { isHovered = false; NSCursor.arrow.set(); onHoverChange(false) }

    // Spring-loading: dragging a file onto the notch opens it on the File Shelf,
    // and the drop itself lands in the shelf's drop zone.
    override func draggingEntered(_ sender: NSDraggingInfo) -> NSDragOperation {
        onDragEnter()
        return .copy
    }
}

/// Hosts the SwiftUI notch and reports when the pointer enters or leaves it
/// (used only by the optional "open on hover" setting).
final class HoverTrackingView: NSView {
    var onHoverChange: (Bool) -> Void = { _ in }
    private var tracking: NSTrackingArea?

    override func updateTrackingAreas() {
        super.updateTrackingAreas()
        if let tracking { removeTrackingArea(tracking) }
        let area = NSTrackingArea(rect: bounds, options: [.mouseEnteredAndExited, .activeAlways, .inVisibleRect],
                                  owner: self, userInfo: nil)
        addTrackingArea(area)
        tracking = area
    }

    override func mouseEntered(with event: NSEvent) { onHoverChange(true) }
    override func mouseExited(with event: NSEvent) { onHoverChange(false) }
}

@MainActor
final class NotchWindowController {
    private let panel: NotchPanel
    private let trigger: NotchPanel
    private let triggerView = NotchTriggerView()
    let state = NotchState()
    private var levelObservers: [NSObjectProtocol] = []
    private var outsideClickMonitor: Any?
    private var keyMonitor: Any?
    private var clickInsideMonitor: Any?
    private let fullscreen = FullscreenWatcher()
    private var recordingNow = false
    private var edgeMonitors: [Any] = []
    private var gestureMonitor: Any?
    private var swipeAccumulator = CGSize.zero
    private var swipeFired = false

    init() {
        panel = NotchPanel(contentRect: .zero)
        let root = NotchRootView()
            .environmentObject(state)
            .environmentObject(SettingsManager.shared)
        let host = NSHostingView(rootView: root)
        host.sizingOptions = []          // the controller owns the frame, not SwiftUI
        host.wantsLayer = true
        host.layer?.backgroundColor = .clear
        let container = HoverTrackingView()
        host.autoresizingMask = [.width, .height]
        container.addSubview(host)
        panel.contentView = container

        trigger = NotchPanel(contentRect: .zero)
        trigger.contentView = triggerView
        // The expanded panel always sits above the trigger (and its hover outline).
        panel.keepAboveEverything(extraLevels: 1, orderFront: false)

        triggerView.onClick = { [weak self] in
            guard let self else { return }
            // A video call is about to start: open Today, where the Join button is.
            if !self.state.isExpanded, MeetingWatcher.shared.imminent != nil, SettingsManager.shared.todayEnabled { self.state.selected = .today }
            // Music is showing beside the notch: open Now Playing, like tapping the Dynamic Island.
            else if !self.state.isExpanded, self.triggerView.activity?.musicBars == true, SettingsManager.shared.nowPlayingEnabled { self.state.selected = .nowPlaying }
            self.toggle()
        }
        triggerView.onDragEnter = { [weak self] in self?.openForDrop() }
        triggerView.onLongPress = { [weak self] in
            guard let self else { return }
            switch NotchGesture.closedLongPress.action {
            case .quickActions:
                QuickActionsMenu.show(at: NSPoint(x: self.triggerView.bounds.midX - 100, y: 0), in: self.triggerView)
            case .open: self.expand()
            default: break
            }
        }
        fullscreen.screen = { [weak self] in self?.targetScreen }
        fullscreen.onChange = { [weak self] _ in self?.updateAutoHide() }
        fullscreen.start()
        let notifier = MessengerNotifier.shared
        notifier.isMessengerVisible = { [weak self] in
            guard let self else { return false }
            return self.state.isExpanded && self.state.selected == .messenger
        }
        notifier.openMessenger = { [weak self] in
            guard let self else { return }
            self.state.selected = .messenger
            self.expand()
        }
        notifier.onUnreadChange = { _ in LiveActivityCenter.shared.recompute() }
        LiveActivityCenter.shared.onChange = { [weak self] activity in
            guard let self else { return }
            let sizeChanges = NotchTriggerView.earWidth(for: activity) != NotchTriggerView.earWidth(for: self.triggerView.activity)
            self.triggerView.activity = activity
            // A new volume/brightness level only moves the bar: don't resize the window for it.
            if sizeChanges { self.reposition() }
        }
        LiveActivityCenter.shared.onRecordingChange = { [weak self] on in
            guard let self else { return }
            self.triggerView.isRecording = on
            self.reposition()
        }
        ScreenRecordingDetector.shared.onRawChange = { [weak self] on in
            self?.recordingNow = on
            self?.updateAutoHide()
        }
        triggerView.onEarSettled = { [weak self] in self?.reposition() }
        // Safety net: 0.6 s after any change the notch is at its final size, even if the animation timer stalled.
        let settleSoon: () -> Void = { [weak self] in
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.6) {
                self?.triggerView.settle()
                self?.reposition()
            }
        }
        let previousOnChange = LiveActivityCenter.shared.onChange
        LiveActivityCenter.shared.onChange = { activity in previousOnChange(activity); settleSoon() }
        let previousOnRecording = LiveActivityCenter.shared.onRecordingChange
        LiveActivityCenter.shared.onRecordingChange = { on in previousOnRecording(on); settleSoon() }
        // Volume and brightness gauges only appear while the notch is closed and not hidden (⌘O).
        LiveActivityCenter.shared.canShowHUD = { [weak self] in
            guard let self else { return false }
            return !self.state.isExpanded && !SettingsManager.shared.isNotchHidden
        }
        triggerView.onHoverChange = { [weak self] inside in self?.hoverChanged(inside: inside, overPanel: false) }
        container.onHoverChange = { [weak self] inside in self?.hoverChanged(inside: inside, overPanel: true) }
        levelObservers = observeWindowLevelEvents()
        state.toggle = { [weak self] in self?.toggle() }
        state.close = { [weak self] in self?.collapse() }
        applyEdgeTrigger()
    }

    // MARK: Auto-hide (fullscreen apps, screen recordings)

    /// Steps the closed notch aside while a fullscreen app or a recording is on its screen.
    /// Separate from ⌘O hiding: it comes back by itself, and opening with the hotkey still works.
    func updateAutoHide() {
        let hide = (fullscreen.isFullscreen && NotchPrefs.autoHideFullscreen) || (recordingNow && NotchPrefs.autoHideRecording)
        guard hide != state.isAutoHidden else { return }
        state.isAutoHidden = hide
        if hide && !state.isExpanded { /* stays closed */ }
        trigger.ignoresMouseEvents = hide || SettingsManager.shared.isNotchHidden
        NSAnimationContext.runAnimationGroup { context in
            context.duration = NSWorkspace.shared.accessibilityDisplayShouldReduceMotion ? 0.1 : 0.25
            trigger.animator().alphaValue = (hide || SettingsManager.shared.isNotchHidden) ? 0 : 1
        }
    }

    func recheckFullscreen() { fullscreen.check() }

    // MARK: Edge trigger zones (Pro)

    /// Watches the pointer only while an edge zone is on: resting at the very top of the
    /// screen inside the zone opens the notch. Clicks on the menu bar are never blocked.
    func applyEdgeTrigger() {
        edgeMonitors.forEach(NSEvent.removeMonitor)
        edgeMonitors = []
        guard NotchPrefs.edgeTrigger != "off", Entitlements.shared.canUse(.edgeTrigger) else { return }
        let handler: (NSEvent) -> Void = { [weak self] _ in self?.edgeMoved() }
        if let g = NSEvent.addGlobalMonitorForEvents(matching: .mouseMoved, handler: handler) { edgeMonitors.append(g) }
        if let l = NSEvent.addLocalMonitorForEvents(matching: .mouseMoved, handler: { handler($0); return $0 }) { edgeMonitors.append(l) }
    }

    private var edgeWork: DispatchWorkItem?
    private func edgeMoved() {
        guard let screen = targetScreen, !state.isExpanded, !state.isAutoHidden, !SettingsManager.shared.isNotchHidden else { return }
        let p = NSEvent.mouseLocation
        let halfWidth = NotchPrefs.edgeTrigger == "edge" ? screen.frame.width / 2 : state.notchSize.width + 100
        let inZone = p.y >= screen.frame.maxY - 2 && abs(p.x - screen.frame.midX) <= halfWidth && screen.frame.contains(CGPoint(x: p.x, y: p.y - 1))
        if inZone {
            guard edgeWork == nil else { return }
            let work = DispatchWorkItem { [weak self] in
                guard let self else { return }
                self.edgeWork = nil
                let q = NSEvent.mouseLocation
                guard q.y >= screen.frame.maxY - 2, !self.state.isExpanded else { return }
                self.expand()
                self.openedByHover = true
            }
            edgeWork = work
            DispatchQueue.main.asyncAfter(deadline: .now() + max(NotchPrefs.hoverDelay, 0.2), execute: work)
        } else {
            edgeWork?.cancel()
            edgeWork = nil
        }
    }

    // MARK: Gestures in the open notch

    /// Swipes on the tab bar (top 56 pt): sideways switches tabs, up closes. Pinch resizes (Pro).
    private func installGestureMonitor() {
        gestureMonitor = NSEvent.addLocalMonitorForEvents(matching: [.scrollWheel, .magnify]) { [weak self] event in
            guard let self, event.window === self.panel else { return event }
            if event.type == .magnify { self.pinch(event.magnification); return event }
            let p = event.locationInWindow
            guard p.y > self.panel.frame.height - 56, event.hasPreciseScrollingDeltas, event.momentumPhase == [] else { return event }
            if event.phase == .began { self.swipeAccumulator = .zero; self.swipeFired = false }
            let flip: CGFloat = event.isDirectionInvertedFromDevice ? 1 : -1
            self.swipeAccumulator.width += event.scrollingDeltaX * flip
            self.swipeAccumulator.height += event.scrollingDeltaY * flip
            if !self.swipeFired {
                let a = self.swipeAccumulator
                if abs(a.width) > 70, abs(a.width) > abs(a.height) * 1.5 {
                    self.swipeFired = true
                    switch NotchGesture.openSwipe.action {
                    case .switchTab: self.stepTab(a.width < 0 ? 1 : -1)
                    case .track: MediaControl.send(a.width < 0 ? .next : .previous)
                    default: break
                    }
                } else if a.height < -70, abs(a.height) > abs(a.width) * 1.5, NotchGesture.openSwipeUp.action == .close {
                    self.swipeFired = true
                    self.collapse()
                }
            }
            return event
        }
    }

    /// Moves to the next or previous visible tab.
    func stepTab(_ step: Int) {
        let tabs = state.visibleTabs(SettingsManager.shared)
        guard !tabs.isEmpty else { return }
        let i = tabs.firstIndex(of: state.selected) ?? 0
        let next = tabs[(i + step + tabs.count) % tabs.count]
        withAnimation(Theme.spring) { state.selected = next }
        NotchFeedback.tick()
    }

    private func pinch(_ amount: CGFloat) {
        guard Entitlements.shared.canUse(.notchResize) else { return }
        NotchPrefs.panelWidth = (NotchPrefs.panelWidth * (1 + amount)).clamped(to: NotchPrefs.widthRange)
        NotchPrefs.panelHeight = (NotchPrefs.panelHeight * (1 + amount)).clamped(to: NotchPrefs.heightRange)
        reposition()
    }

    /// Puts both windows back on top after a Space change, wake or display change.
    func reassertWindowLevels() {
        trigger.keepAboveEverything(orderFront: !SettingsManager.shared.isNotchHidden)
        panel.keepAboveEverything(extraLevels: 1)
        reposition()
    }

    func show() {
        reposition()
        trigger.orderFrontRegardless()
        // Keep the expanded panel on screen but invisible and click-through while
        // closed. Opening then only has to fade it in and animate — no window has
        // to be created or drawn from scratch mid-animation, so it's as smooth as closing.
        panel.alphaValue = 0
        panel.ignoresMouseEvents = true
        panel.orderFrontRegardless()
    }

    /// The screen that shows the notch (Settings → Notch Extras): the built-in display by default,
    /// or the display with the pointer, or the main display. Screens without a notch get a virtual one.
    private var targetScreen: NSScreen? {
        switch SettingsManager.shared.notchDisplayMode {
        case "pointer":
            if let pinned = pointerScreen, NSScreen.screens.contains(pinned) { return pinned }
            return NSScreen.screens.first { $0.frame.contains(NSEvent.mouseLocation) } ?? NSScreen.main
        case "main":
            return NSScreen.screens.first ?? NSScreen.main
        default:
            return NSScreen.screens.first { $0.safeAreaInsets.top > 0 } ?? NSScreen.main
        }
    }

    /// In "follow the pointer" mode, the screen the notch is currently on.
    private var pointerScreen: NSScreen?
    private var pointerTimer: Timer?

    /// Moves the (closed) notch to whichever display the pointer is on.
    func applyDisplayMode() {
        if SettingsManager.shared.notchDisplayMode == "pointer" {
            if pointerTimer == nil {
                pointerTimer = Power.timer(0.5) { [weak self] in
                    guard let self, !self.state.isExpanded else { return }
                    let screen = NSScreen.screens.first { $0.frame.contains(NSEvent.mouseLocation) }
                    if let screen, screen != self.pointerScreen {
                        self.pointerScreen = screen
                        self.reposition()
                    }
                }
            }
        } else {
            pointerTimer?.invalidate()
            pointerTimer = nil
            pointerScreen = nil
        }
        reposition()
    }

    /// Recomputes the notch size and positions both windows.
    func reposition() {
        guard let screen = targetScreen else { return }
        if screen.safeAreaInsets.top > 0,
           let left = screen.auxiliaryTopLeftArea, let right = screen.auxiliaryTopRightArea {
            // Real notch: the gap between the two auxiliary menu-bar areas.
            state.notchSize = CGSize(width: screen.frame.width - left.width - right.width,
                                     height: screen.safeAreaInsets.top)
        } else {
            // No notch: a slim pill centred in the menu bar.
            let barHeight = screen.frame.maxY - screen.visibleFrame.maxY
            state.notchSize = CGSize(width: 190, height: max(barHeight, 24))
        }
        let pad = NotchTriggerView.hitPadding
        // Widen the trigger window while a live activity needs room for its ears.
        let ear = max(NotchTriggerView.earWidth(for: triggerView.activity), triggerView.isRecording ? 24 : 0, triggerView.displayedEar)
        let side = max(pad.width, NotchRootView.collapsedShoulder + ear + 8)
        let hit = CGSize(width: state.notchSize.width + side * 2, height: state.notchSize.height + pad.height)
        triggerView.notchWidth = state.notchSize.width
        trigger.setFrame(frame(size: hit, on: screen), display: true)
        let size = NotchPrefs.panelSize
        if state.expandedSize != size { state.expandedSize = size }
        DisplayLayouts.currentScreen = screen
        let hidden = Entitlements.shared.canUse(.displayLayouts) ? DisplayLayouts.hidden(on: screen) : []
        if state.hiddenTabs != hidden { state.hiddenTabs = hidden }
        panel.setFrame(frame(size: state.expandedSize, on: screen), display: false)
    }

    private func frame(size: CGSize, on screen: NSScreen) -> NSRect {
        NSRect(x: screen.frame.midX - size.width / 2, y: screen.frame.maxY - size.height,
               width: size.width, height: size.height)
    }

    func toggle() { state.isExpanded ? collapse() : expand() }

    // MARK: Invisibility (⌘O by default)

    /// Fades the whole notch out (or back in). Nothing is torn down while hidden,
    /// so Now Playing, Messenger connections and timers keep running.
    func setInvisible(_ hidden: Bool) {
        let settings = SettingsManager.shared
        guard settings.isNotchHidden != hidden else { return }
        settings.isNotchHidden = hidden
        if hidden { collapse() }
        trigger.ignoresMouseEvents = hidden || state.isAutoHidden
        NSAnimationContext.runAnimationGroup { context in
            context.duration = NSWorkspace.shared.accessibilityDisplayShouldReduceMotion ? 0.1 : 0.3
            context.timingFunction = CAMediaTimingFunction(controlPoints: 0.2, 0.9, 0.3, 1)
            trigger.animator().alphaValue = (hidden || state.isAutoHidden) ? 0 : 1
            if hidden { panel.animator().alphaValue = 0 }
        }
    }

    func toggleInvisible() { setInvisible(!SettingsManager.shared.isNotchHidden) }

    // MARK: Screenshots and recordings

    /// Takes the notch (panel and closed-notch shape) off screen instantly, so a capture doesn't include it.
    func hideForCapture() {
        panel.alphaValue = 0
        trigger.alphaValue = 0
    }

    /// Puts the notch back the way it was: open panel visible, closed notch shape visible unless hidden with the shortcut.
    func restoreAfterCapture() {
        panel.alphaValue = state.isExpanded ? 1 : 0
        trigger.alphaValue = (SettingsManager.shared.isNotchHidden || state.isAutoHidden) ? 0 : 1
    }

    var isOpen: Bool { state.isExpanded }
    func closeNotch() { collapse() }

    func expand() {
        guard !state.isExpanded else { return }
        // Opening (⌘E, the menu-bar icon) always brings a hidden notch back.
        if SettingsManager.shared.isNotchHidden { setInvisible(false) }
        openedByHover = false   // the hover path sets this back to true right after
        pinnedByClick = false
        panel.ignoresMouseEvents = false
        panel.alphaValue = 1
        panel.orderFrontRegardless()
        panel.makeKey()
        // The collapsed shape is already drawn, so spring open straight away,
        // with the same curve that closing uses.
        withAnimation(Theme.spring) { state.isExpanded = true }
        NotchFeedback.opened()
        installMonitors()
    }

    /// Opens straight to the File Shelf while a file is being dragged.
    private func openForDrop() {
        if SettingsManager.shared.shelfEnabled { state.selected = .shelf }
        expand()
    }

    // MARK: Hover to open (optional, off by default)

    /// True when the current open was caused by hovering rather than a click or ⌘E.
    private var openedByHover = false
    /// Set once the user clicks inside a hover-opened notch, so moving out no longer closes it.
    private var pinnedByClick = false
    private var hoverWork: DispatchWorkItem?

    private func hoverChanged(inside: Bool, overPanel: Bool) {
        guard SettingsManager.shared.hoverToOpen else { return }
        hoverWork?.cancel()
        let work: DispatchWorkItem
        if inside {
            // A short delay so just passing the pointer across the menu bar doesn't open it.
            guard !state.isExpanded, !overPanel else { return }
            work = DispatchWorkItem { [weak self] in
                guard let self, !self.state.isExpanded else { return }
                self.expand()
                self.openedByHover = true
            }
            DispatchQueue.main.asyncAfter(deadline: .now() + NotchPrefs.hoverDelay, execute: work)
        } else {
            // Leaving the trigger while the panel is opening lands on the panel, so only the
            // panel's own exit closes it; a small grace period allows brief overshoots.
            guard overPanel, state.isExpanded, openedByHover, !pinnedByClick else { return }
            work = DispatchWorkItem { [weak self] in
                guard let self, self.openedByHover, !self.pinnedByClick else { return }
                self.collapse()
            }
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.35, execute: work)
        }
        hoverWork = work
    }

    func collapse() {
        guard state.isExpanded else { return }
        hoverWork?.cancel()
        openedByHover = false
        pinnedByClick = false
        withAnimation(Theme.spring) { state.isExpanded = false }
        NotchFeedback.closed()
        // Re-lock biometric gate every time the notch closes.
        state.isUnlocked = false
        removeMonitors()
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.35) { [weak self] in
            guard let self, !self.state.isExpanded else { return }
            // Stay ordered in (see show()), just invisible and click-through.
            self.panel.alphaValue = 0
            self.panel.ignoresMouseEvents = true
        }
    }

    /// Click-outside and Escape close the notch. These are click/key handlers
    /// only — never mouse-moved or hover tracking.
    private func installMonitors() {
        outsideClickMonitor = NSEvent.addGlobalMonitorForEvents(matching: [.leftMouseDown, .rightMouseDown]) { [weak self] _ in
            guard let self, !SettingsManager.shared.stickyNotch else { return }
            self.collapse()
        }
        // Esc works even when another app is frontmost (Carbon hot key, active only while open)…
        GlobalHotkeyManager.shared.register(.closeNotch) { [weak self] in self?.collapse() }
        // …and as a local fallback when the panel itself has focus.
        clickInsideMonitor = NSEvent.addLocalMonitorForEvents(matching: [.leftMouseDown, .rightMouseDown]) { [weak self] event in
            if let self, event.window === self.panel { self.pinnedByClick = true }
            return event
        }
        keyMonitor = NSEvent.addLocalMonitorForEvents(matching: .keyDown) { [weak self] event in
            guard let self else { return event }
            if event.keyCode == 53 { self.collapse(); return nil }
            // Keyboard control: ⌘1–⌘9 jump to a tab, ⌘[ and ⌘] (or ⌃Tab / ⌃⇧Tab) step through them.
            let mods = event.modifierFlags.intersection(.deviceIndependentFlagsMask)
            if mods == .command, let c = event.charactersIgnoringModifiers, let n = Int(c), (1...9).contains(n) {
                let tabs = self.state.visibleTabs(SettingsManager.shared)
                if n <= tabs.count { withAnimation(Theme.spring) { self.state.selected = tabs[n - 1] }; return nil }
            }
            if mods == .command, event.charactersIgnoringModifiers == "]" { self.stepTab(1); return nil }
            if mods == .command, event.charactersIgnoringModifiers == "[" { self.stepTab(-1); return nil }
            if event.keyCode == 48, mods.contains(.control) { self.stepTab(mods.contains(.shift) ? -1 : 1); return nil }
            return event
        }
        installGestureMonitor()
    }

    private func removeMonitors() {
        if let m = outsideClickMonitor { NSEvent.removeMonitor(m) }
        if let m = keyMonitor { NSEvent.removeMonitor(m) }
        if let m = clickInsideMonitor { NSEvent.removeMonitor(m) }
        if let m = gestureMonitor { NSEvent.removeMonitor(m) }
        gestureMonitor = nil
        clickInsideMonitor = nil
        outsideClickMonitor = nil
        keyMonitor = nil
        GlobalHotkeyManager.shared.unregister(.closeNotch)
    }
}
