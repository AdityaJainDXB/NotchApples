//
//  CursorCompanion.swift
//  Notch Apple
//
//  NotchAI's green dot: a small glowing circle that trails the mouse across every display, in any app.
//  It is plain AppKit and Core Animation and never touches an AI model, so it works with every provider off.
//
//  How it stays cheap: ONE borderless, non-activating panel (not one per display) that moves to wherever the
//  mouse is. A global mouse-moved monitor (needs no permission) only records the target; a 60 Hz timer runs
//  just while the dot is still catching up and is stopped the moment it settles, so an idle dot costs ~0 CPU.
//  The panel ignores the mouse except while the pointer is on the dot itself, so it never blocks a click.
//
//  The dot is a pet, not a shadow: it follows only when the pointer is further than the follow distance and
//  never backs away, so you can walk the pointer onto it and click it (quick ask) or right-click (open NotchAI).
//  Other parts of NotchAI drive its look through `state` (listening, thinking, speaking).
//
//  Pure maths (smoothing, follow rule, trail, spring) lives in CompanionMotion so it is unit tested.
//

import AppKit
import NotchKit
import QuartzCore

enum CompanionState: String, CaseIterable {
    case idle, listening, thinking, speaking
}

@MainActor
final class CursorCompanion: ObservableObject, FeatureModule {
    static let shared = CursorCompanion()

    // MARK: FeatureModule
    let id = "notchai.companion"
    let name = "NotchAI cursor companion"
    let permissions: [ModulePermission] = []
    private(set) var isRunning = false

    // MARK: Settings (UserDefaults; the tab edits these)
    @Published var isOn: Bool { didSet { UserDefaults.standard.set(isOn, forKey: "notchai.dot.on"); isOn ? start() : stop() } }
    /// 8...40 pt radius scale.
    @Published var size: Double { didSet { save(size, "notchai.dot.size"); applyLook() } }
    /// 0...1
    @Published var glow: Double { didSet { save(glow, "notchai.dot.glow"); applyLook() } }
    /// 0.1...1: how quickly the dot catches up (1 = nearly instant).
    @Published var speed: Double { didSet { save(speed, "notchai.dot.speed") } }
    /// How far behind the pointer the dot rests, in points.
    @Published var followDistance: Double { didSet { save(followDistance, "notchai.dot.distance") } }
    @Published var trailOn: Bool { didSet { UserDefaults.standard.set(trailOn, forKey: "notchai.dot.trail") } }
    @Published var breathing: Bool { didSet { UserDefaults.standard.set(breathing, forKey: "notchai.dot.breathing"); applyState() } }
    /// Pause following without turning the dot off (it stays where it is).
    @Published var paused = false { didSet { if !paused { kick() } } }
    @Published private(set) var state: CompanionState = .idle

    static let green = NSColor(srgbRed: 0x22 / 255, green: 0xC5 / 255, blue: 0x5E / 255, alpha: 1)   // #22C55E

    static let defaults: (size: Double, glow: Double, speed: Double, distance: Double) = (14, 0.7, 0.55, 26)

    private func save(_ v: Double, _ key: String) { UserDefaults.standard.set(v, forKey: key) }

    private init() {
        let d = UserDefaults.standard
        func num(_ k: String, _ def: Double) -> Double { d.object(forKey: k) as? Double ?? def }
        isOn = d.bool(forKey: "notchai.dot.on")
        size = num("notchai.dot.size", Self.defaults.size)
        glow = num("notchai.dot.glow", Self.defaults.glow)
        speed = num("notchai.dot.speed", Self.defaults.speed)
        followDistance = num("notchai.dot.distance", Self.defaults.distance)
        trailOn = d.object(forKey: "notchai.dot.trail") as? Bool ?? true
        breathing = d.object(forKey: "notchai.dot.breathing") as? Bool ?? true
    }

    func resetAppearance() {
        size = Self.defaults.size; glow = Self.defaults.glow; speed = Self.defaults.speed
        followDistance = Self.defaults.distance; trailOn = true; breathing = true
    }

    /// Called by the voice / agent code in later milestones; never by the dot itself.
    func setState(_ s: CompanionState) {
        guard s != state else { return }
        state = s
        applyState()
    }

    // MARK: Runtime
    private var panel: NSPanel?
    private var dotView: DotView?
    private var monitors: [Any] = []
    private var timer: Timer?
    private var pos = CGPoint.zero          // where the dot is (screen coordinates, y up)
    private var target = CGPoint.zero       // where the pointer is
    private var history: [CGPoint] = []     // recent positions for the trail
    private var lastTick = CACurrentMediaTime()
    private var hovering = false

    /// The panel is bigger than the dot so the glow and trail are not clipped.
    private let canvas: CGFloat = 160

    func start() {
        guard isOn, !isRunning else { return }
        #if DEBUG
        if let q = UserDefaults.standard.string(forKey: "notchai.selftest"), !q.isEmpty {
            DispatchQueue.main.asyncAfter(deadline: .now() + 2) { [weak self] in
                guard let self else { return }
                QuickAskPanel.show(near: CGPoint(x: self.pos.x, y: self.pos.y))
            }
        }
        #endif
        isRunning = true
        let p = NSPanel(contentRect: NSRect(x: 0, y: 0, width: canvas, height: canvas),
                        styleMask: [.borderless, .nonactivatingPanel], backing: .buffered, defer: false)
        p.isOpaque = false; p.backgroundColor = .clear; p.hasShadow = false
        p.level = .screenSaver                      // above full-screen apps' menu bars and normal windows
        p.collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary, .stationary, .ignoresCycle]
        p.ignoresMouseEvents = true
        p.isReleasedWhenClosed = false
        p.hidesOnDeactivate = false
        let v = DotView(frame: NSRect(x: 0, y: 0, width: canvas, height: canvas))
        v.onClick = { [weak self] in self?.dotClicked() }
        v.onRightClick = { [weak self] in self?.openNotchAI() }
        p.contentView = v
        panel = p; dotView = v

        let mouse = NSEvent.mouseLocation
        pos = mouse; target = mouse; history = []
        place()
        p.orderFrontRegardless()
        applyLook(); applyState()

        let mask: NSEvent.EventTypeMask = [.mouseMoved, .leftMouseDragged, .rightMouseDragged, .otherMouseDragged]
        if let g = NSEvent.addGlobalMonitorForEvents(matching: mask, handler: { [weak self] _ in
            MainActor.assumeIsolated { self?.pointerMoved() }
        }) { monitors.append(g) }
        if let l = NSEvent.addLocalMonitorForEvents(matching: mask, handler: { [weak self] e in
            MainActor.assumeIsolated { self?.pointerMoved() }; return e
        }) { monitors.append(l) }
        // Displays added/removed: the panel is just a window in global coordinates, nothing to rebuild.
        kick()
    }

    func stop() {
        guard isRunning else { return }
        isRunning = false
        monitors.forEach { NSEvent.removeMonitor($0) }
        monitors.removeAll()
        timer?.invalidate(); timer = nil
        panel?.orderOut(nil); panel?.contentView = nil; panel = nil; dotView = nil
        QuickAskPanel.close()
    }

    // MARK: Following
    private func pointerMoved() {
        guard isRunning else { return }
        target = NSEvent.mouseLocation
        updateHover()
        if !paused { kick() }
    }

    /// The dot can be clicked only while the pointer is on it; otherwise the panel is click-through.
    private func updateHover() {
        let over = CompanionMotion.isOver(pointer: target, dot: pos, radius: CGFloat(size) / 2 + 6)
        if over != hovering {
            hovering = over
            panel?.ignoresMouseEvents = !over
            dotView?.setHover(over)
        }
    }

    private func kick() {
        guard timer == nil, isRunning, !paused else { return }
        lastTick = CACurrentMediaTime()
        let t = Timer(timeInterval: 1.0 / 60.0, repeats: true) { [weak self] _ in
            MainActor.assumeIsolated { self?.tick() }
        }
        RunLoop.main.add(t, forMode: .common)
        timer = t
    }

    private func tick() {
        let now = CACurrentMediaTime()
        let dt = min(now - lastTick, 0.1)
        lastTick = now
        let goal = CompanionMotion.goal(pointer: target, dot: pos, followDistance: CGFloat(followDistance))
        let next = CompanionMotion.step(from: pos, to: goal, speed: speed, dt: dt)
        let moved = hypot(next.x - pos.x, next.y - pos.y)
        pos = next
        let velocity = CGFloat(moved / max(dt, 0.001))
        history.append(pos)
        if history.count > 12 { history.removeFirst(history.count - 12) }
        place()
        dotView?.updateTrail(history: history, origin: panel?.frame.origin ?? .zero, canvas: canvas,
                             visible: trailOn && CompanionMotion.trailStrength(velocity: velocity) > 0,
                             strength: CompanionMotion.trailStrength(velocity: velocity))
        updateHover()
        // Settled: stop the timer so an idle dot uses no CPU. A mouse move restarts it.
        if CompanionMotion.isSettled(pos: pos, goal: goal) {
            pos = goal
            place()
            dotView?.updateTrail(history: [], origin: .zero, canvas: canvas, visible: false, strength: 0)
            history.removeAll()
            timer?.invalidate(); timer = nil
        }
    }

    private func place() {
        panel?.setFrameOrigin(CGPoint(x: pos.x - canvas / 2, y: pos.y - canvas / 2))
    }

    // MARK: Look
    private func applyLook() { dotView?.configure(radius: CGFloat(size) / 2, glow: glow) }
    private func applyState() { dotView?.apply(state: state, breathing: breathing) }

    // MARK: Interaction
    private func dotClicked() {
        QuickAskPanel.toggle(near: pos)
    }

    func openNotchAI() {
        NotificationCenter.default.post(name: .notchAIOpen, object: nil)
    }
}

extension Notification.Name {
    /// Asks the notch window to open on the NotchAI tab.
    static let notchAIOpen = Notification.Name("notch.notchai.open")
}

// MARK: - The dot's view

private final class DotView: NSView {
    var onClick: (() -> Void)?
    var onRightClick: (() -> Void)?

    private let glowLayer = CAGradientLayer()
    private let coreLayer = CALayer()
    private let ringLayer = CAShapeLayer()
    private var trailLayers: [CALayer] = []
    private var radius: CGFloat = 7
    private var glow: Double = 0.7
    private var current: CompanionState = .idle

    override init(frame: NSRect) {
        super.init(frame: frame)
        wantsLayer = true
        layer?.masksToBounds = false
        let green = CursorCompanion.green
        for i in 0..<4 {
            let l = CALayer()
            l.backgroundColor = green.cgColor
            l.opacity = 0
            trailLayers.append(l)
            layer?.addSublayer(l)
            _ = i
        }
        glowLayer.type = .radial
        glowLayer.colors = [green.withAlphaComponent(0.55).cgColor, green.withAlphaComponent(0).cgColor]
        glowLayer.startPoint = CGPoint(x: 0.5, y: 0.5)
        glowLayer.endPoint = CGPoint(x: 1, y: 1)
        coreLayer.backgroundColor = green.withAlphaComponent(0.92).cgColor
        coreLayer.borderColor = NSColor.white.withAlphaComponent(0.35).cgColor
        coreLayer.borderWidth = 0.75
        ringLayer.fillColor = nil
        ringLayer.strokeColor = green.cgColor
        ringLayer.lineWidth = 2
        ringLayer.lineCap = .round
        ringLayer.opacity = 0
        layer?.addSublayer(glowLayer)
        layer?.addSublayer(coreLayer)
        layer?.addSublayer(ringLayer)
    }
    required init?(coder: NSCoder) { fatalError() }

    override var acceptsFirstResponder: Bool { false }
    override func acceptsFirstMouse(for event: NSEvent?) -> Bool { true }

    private var center: CGPoint { CGPoint(x: bounds.midX, y: bounds.midY) }

    func configure(radius: CGFloat, glow: Double) {
        self.radius = radius; self.glow = glow
        CATransaction.begin(); CATransaction.setDisableActions(true)
        let c = center
        let glowR = radius * (2.2 + 2.2 * CGFloat(glow))
        glowLayer.frame = CGRect(x: c.x - glowR, y: c.y - glowR, width: glowR * 2, height: glowR * 2)
        glowLayer.opacity = Float(0.25 + 0.75 * glow)
        coreLayer.frame = CGRect(x: c.x - radius, y: c.y - radius, width: radius * 2, height: radius * 2)
        coreLayer.cornerRadius = radius
        let rr = radius * 1.9
        ringLayer.frame = CGRect(x: c.x - rr, y: c.y - rr, width: rr * 2, height: rr * 2)
        ringLayer.path = CGPath(ellipseIn: ringLayer.bounds.insetBy(dx: 1, dy: 1), transform: nil)
        ringLayer.strokeStart = 0; ringLayer.strokeEnd = 0.28
        for t in trailLayers { t.bounds = CGRect(x: 0, y: 0, width: radius * 2, height: radius * 2); t.cornerRadius = radius }
        CATransaction.commit()
        apply(state: current, breathing: breathing)
    }

    private var breathing = true

    func apply(state: CompanionState, breathing: Bool) {
        current = state; self.breathing = breathing
        for l in [glowLayer, coreLayer, ringLayer] { l.removeAllAnimations() }
        ringLayer.opacity = 0
        switch state {
        case .idle:
            if breathing { pulse(glowLayer, from: 0.9, to: 1.12, duration: 2.6) }
        case .listening:
            pulse(glowLayer, from: 0.95, to: 1.35, duration: 0.9)
            pulse(coreLayer, from: 1.0, to: 1.12, duration: 0.9)
        case .thinking:
            ringLayer.opacity = 1
            let spin = CABasicAnimation(keyPath: "transform.rotation.z")
            spin.fromValue = 0; spin.toValue = -2 * Double.pi
            spin.duration = 1.0; spin.repeatCount = .infinity
            ringLayer.add(spin, forKey: "spin")
            if breathing { pulse(glowLayer, from: 0.95, to: 1.2, duration: 1.2) }
        case .speaking:
            pulse(glowLayer, from: 0.9, to: 1.5, duration: 0.42)
            pulse(coreLayer, from: 0.92, to: 1.14, duration: 0.42)
        }
    }

    private func pulse(_ l: CALayer, from: CGFloat, to: CGFloat, duration: CFTimeInterval) {
        let a = CABasicAnimation(keyPath: "transform.scale")
        a.fromValue = from; a.toValue = to
        a.duration = duration; a.autoreverses = true; a.repeatCount = .infinity
        a.timingFunction = CAMediaTimingFunction(name: .easeInEaseOut)
        l.add(a, forKey: "pulse")
    }

    /// A brief swell when the pointer arrives on the dot (it is now clickable).
    func setHover(_ on: Bool) {
        let a = CABasicAnimation(keyPath: "transform.scale")
        a.fromValue = coreLayer.presentation()?.value(forKeyPath: "transform.scale") ?? 1
        a.toValue = on ? 1.25 : 1
        a.duration = 0.16
        a.fillMode = .forwards; a.isRemovedOnCompletion = false
        coreLayer.add(a, forKey: "hover")
    }

    func updateTrail(history: [CGPoint], origin: CGPoint, canvas: CGFloat, visible: Bool, strength: CGFloat) {
        CATransaction.begin(); CATransaction.setDisableActions(true)
        for (i, l) in trailLayers.enumerated() {
            let back = (i + 1) * 2                       // 2, 4, 6, 8 frames behind
            guard visible, history.count > back else { l.opacity = 0; continue }
            let p = history[history.count - 1 - back]
            l.position = CGPoint(x: p.x - origin.x, y: p.y - origin.y)
            let fade = Float(strength) * (0.32 - 0.07 * Float(i))
            l.opacity = max(fade, 0)
            l.setAffineTransform(CGAffineTransform(scaleX: 1 - 0.14 * CGFloat(i + 1), y: 1 - 0.14 * CGFloat(i + 1)))
        }
        CATransaction.commit()
    }

    override func mouseDown(with event: NSEvent) {
        if event.modifierFlags.contains(.command) { onRightClick?() } else { onClick?() }
    }
    override func rightMouseDown(with event: NSEvent) { onRightClick?() }
}
