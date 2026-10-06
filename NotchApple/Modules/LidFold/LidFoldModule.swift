//
//  LidFoldModule.swift
//  Notch apple, Lid Fold
//
//  Original to Notch apple. Runs one fold at a time and makes sure it always ends:
//
//    triggers   Preview button, timed demo, hotkey (fold and hold), and (optional) the real lid angle
//    safety     OFF by default; nothing is captured until you turn it on AND Screen Recording is allowed;
//               a click on the overlay, Esc, or the hotkey removes it at once; every trigger except the
//               lid has a maximum duration; any failure removes the overlay and frees the snapshot;
//               sleep, lock, a display change and quit all tear it down
//    notch      the fold claims the notch through NotchArbiter (highest priority); its panels sit below
//               the notch window, so the notch stays in front
//
//  Pure rules (fail-safe, curves, lid following) live in FoldCore and are unit-tested there.
//

import AppKit
import Carbon.HIToolbox
import FoldCore
import NotchKit
import OSLog

@MainActor
final class LidFoldModule: ObservableObject, FeatureModule, NotchClaimant {
    static let shared = LidFoldModule()
    private let log = Logger(subsystem: "com.notchapple.app", category: "lidfold")

    // MARK: FeatureModule

    let id = "lidfold"
    let name = "Lid Fold"
    let permissions: [ModulePermission] = [.screenRecording]
    private(set) var isRunning = false

    // MARK: Settings (all off by default)

    @Published var enabled: Bool = UserDefaults.standard.bool(forKey: "lidfold.enabled") {
        didSet {
            UserDefaults.standard.set(enabled, forKey: "lidfold.enabled")
            enabled ? start() : stop()
        }
    }
    @Published var followLid: Bool = UserDefaults.standard.bool(forKey: "lidfold.followLid") {
        didSet {
            UserDefaults.standard.set(followLid, forKey: "lidfold.followLid")
            applySensor()
        }
    }

    // MARK: Live state for the settings screen

    @Published private(set) var status = "Off. Nothing is captured until you turn Lid Fold on."
    @Published private(set) var isShowing = false
    @Published private(set) var sensorAngle: Double?
    @Published private(set) var sensorMessage = ""

    // MARK: Internals

    private struct Session {
        let id = UUID()
        let trigger: FoldTrigger
        let claim: NotchArbiter.Claim
        let begunAt = Date.timeIntervalSinceReferenceDate
        var shownAt: TimeInterval?
    }

    private var tuning = FoldTuning()
    private let overlay = FoldOverlay()
    private var session: Session?
    private var captureTask: Task<Void, Never>?
    private var driver: Timer?
    private var watchdog: Timer?
    private var follower = LidFollower()
    private var lastReadingAt: TimeInterval?
    private var sensorEverReadable = false
    private var observers: [(NotificationCenter, NSObjectProtocol)] = []
    private var provider: LidAngleProviding?
    /// Swappable so a mock sensor can stand in for the real one.
    var makeProvider: () -> LidAngleProviding = { IOKitLidAngleProvider() }

    private static let captureTimeout: TimeInterval = 5

    private init() { overlay.onDismiss = { [weak self] in self?.teardown(.userDismissed) } }

    // MARK: Lifecycle

    func start() {
        guard enabled, !isRunning else { return }
        isRunning = true
        status = ScreenPermission.isGranted
            ? "On. Preview, or press \(HotkeyBinding.lidFold.label) to fold the desktop."
            : "On, in limited mode: Screen Recording is off, so folds use a plain backdrop instead of your desktop."
        GlobalHotkeyManager.shared.register(.foldToggle) { [weak self] in self?.toggleHold() }
        let ws = NSWorkspace.shared.notificationCenter
        for name in [NSWorkspace.screensDidSleepNotification, NSWorkspace.sessionDidResignActiveNotification] {
            observe(ws, name) { [weak self] in self?.teardown(.sleep) }
        }
        observe(.default, NSApplication.didChangeScreenParametersNotification) { [weak self] in self?.teardown(.displayChange) }
        observe(DistributedNotificationCenter.default(), Notification.Name("com.apple.screenIsLocked")) { [weak self] in self?.teardown(.sleep) }
        applySensor()
    }

    /// Everything off and released. Safe to call at any time, any number of times.
    func stop() {
        teardown(.disabled)
        GlobalHotkeyManager.shared.unregister(.foldToggle)
        for (center, token) in observers { center.removeObserver(token) }
        observers.removeAll()
        provider?.stop()
        provider = nil
        follower.reset()
        sensorAngle = nil
        lastReadingAt = nil
        isRunning = false
        if !enabled { status = "Off. Nothing is captured until you turn Lid Fold on." }
    }

    private func observe(_ center: NotificationCenter, _ name: Notification.Name, _ action: @escaping @MainActor () -> Void) {
        let token = center.addObserver(forName: name, object: nil, queue: .main) { _ in MainActor.assumeIsolated { action() } }
        observers.append((center, token))
    }

    // MARK: Triggers

    var canTrigger: Bool { enabled && isRunning && session == nil }

    func preview() { begin(.preview) }
    func runDemo() { begin(.demo) }
    func toggleHold() {
        if session != nil { teardown(.userDismissed) } else { begin(.hotkey) }
    }

    /// Removes the fold now (also used by the settings screen).
    func dismiss() { teardown(.userDismissed) }

    // MARK: A session

    private func begin(_ trigger: FoldTrigger) {
        guard enabled, isRunning, session == nil else {
            if trigger == .lid { perform(follower.captureFailed()) }
            return
        }
        guard let claim = NotchArbiter.shared.request(.lidFold, owner: self) else {
            status = "The notch is busy with another fold."
            if trigger == .lid { perform(follower.captureFailed()) }
            return
        }
        let limited = !ScreenPermission.isGranted
        let s = Session(trigger: trigger, claim: claim)
        session = s
        if limited && trigger == .lid {
            teardown(.captureFailed, message: "Following the lid needs Screen Recording. Allow it in Permissions.")
            perform(follower.captureFailed())
            return
        }
        status = limited ? "Folding with a plain backdrop (Screen Recording is off)…" : "Folding your desktop…"
        startWatchdog()
        captureTask = Task { [weak self] in
            do {
                let source: FoldOverlay.Source = limited ? .backdrop : .desktop(try await FoldCapture.snapshotAll())
                self?.present(source, sessionID: s.id)
            } catch {
                self?.failed(sessionID: s.id, "Capture failed: \(error.localizedDescription)")
            }
        }
    }

    private func present(_ source: FoldOverlay.Source, sessionID: UUID) {
        guard var s = session, s.id == sessionID else { return }     // torn down while capturing: drop the snapshot
        do {
            try overlay.start(source: source, tuning: tuning)
        } catch {
            failed(sessionID: sessionID, "Could not show the fold: \(error.localizedDescription)")
            return
        }
        let now = Date.timeIntervalSinceReferenceDate
        s.shownAt = now
        session = s
        isShowing = true
        captureTask = nil
        // Esc removes it. (If the notch is open it already owns Esc; the click and the hotkey still work.)
        GlobalHotkeyManager.shared.register(.foldDismiss) { [weak self] in self?.teardown(.userDismissed) }
        status = "Folded. Click anywhere, press Esc or \(HotkeyBinding.lidFold.label) to bring your desktop back."

        switch s.trigger {
        case .preview:
            overlay.preview(duration: 4) { [weak self] in self?.teardown(.finished) }
        case .demo, .hotkey:
            let resting = max(tuning.validated.fadeAngle + 6, 30)
            driver = timer(1.0 / 60) { [weak self] in
                guard let self, let shown = self.session?.shownAt else { return }
                let angle = FoldCurves.heldAngle(elapsed: Date.timeIntervalSinceReferenceDate - shown,
                                                 working: self.tuning.validated.workingAngle, resting: resting)
                self.overlay.setAngle(angle)
            }
        case .lid:
            perform(follower.captureSucceeded(now: now, tuning: tuning))
            driver = timer(1.0 / 60) { [weak self] in
                guard let self else { return }
                self.perform(self.follower.tick(now: Date.timeIntervalSinceReferenceDate, tuning: self.tuning))
            }
        }
    }

    private func failed(sessionID: UUID, _ message: String) {
        guard session?.id == sessionID else { return }
        let wasLid = session?.trigger == .lid
        teardown(.captureFailed, message: message)
        if wasLid { perform(follower.captureFailed()) }
    }

    /// The one way a fold ends. Idempotent, and it frees everything: overlay, snapshot, timers, hotkey, notch claim.
    func teardown(_ reason: FoldTeardownReason, message: String? = nil) {
        captureTask?.cancel()
        captureTask = nil
        driver?.invalidate(); driver = nil
        watchdog?.invalidate(); watchdog = nil
        overlay.stop()
        GlobalHotkeyManager.shared.unregister(.foldDismiss)
        guard let s = session else { isShowing = false; return }
        session = nil
        isShowing = false
        NotchArbiter.shared.release(s.claim)
        log.notice("fold ended: \(reason.rawValue, privacy: .public)")
        if let message { status = message; return }
        switch reason {
        case .maxDuration: status = "The fold ended by itself (time limit)."
        case .sensorStale, .sensorInvalid: status = "The lid sensor stopped answering, so the fold was removed."
        case .captureFailed, .renderFailed: status = "Something went wrong, so the fold was removed."
        case .lidReopened: status = "Lid reopened. Your desktop is back."
        case .disabled: break
        default: status = isRunning ? "Your desktop is back." : status
        }
    }

    /// Checks the fail-safe rules four times a second for as long as a session exists.
    private func startWatchdog() {
        watchdog = timer(0.25) { [weak self] in
            guard let self, let s = self.session else { return }
            let now = Date.timeIntervalSinceReferenceDate
            guard let shown = s.shownAt else {
                if now - s.begunAt > Self.captureTimeout { self.failed(sessionID: s.id, "The snapshot took too long, so the fold was cancelled.") }
                return
            }
            let age = self.lastReadingAt.map { now - $0 }
            if let reason = FoldFailSafe.check(trigger: s.trigger, elapsed: now - shown, sensorAge: age, angle: self.sensorAngle) {
                self.teardown(reason)
            }
        }
    }

    private func timer(_ interval: TimeInterval, _ body: @escaping @MainActor () -> Void) -> Timer {
        let t = Timer(timeInterval: interval, repeats: true) { _ in MainActor.assumeIsolated { body() } }
        RunLoop.main.add(t, forMode: .common)
        return t
    }

    // MARK: Lid angle (optional trigger)

    private func applySensor() {
        guard isRunning, followLid else {
            provider?.stop()
            provider = nil
            follower.reset()
            sensorAngle = nil
            sensorMessage = ""
            sensorEverReadable = false
            return
        }
        guard provider == nil else { return }
        let p = makeProvider()
        provider = p
        sensorMessage = "Looking for the lid sensor…"
        p.start { [weak self] reading in
            DispatchQueue.main.async { MainActor.assumeIsolated { self?.receive(reading) } }
        }
    }

    private func receive(_ reading: LidReading) {
        guard provider != nil else { return }
        sensorMessage = reading.message
        guard let angle = reading.angle else {
            sensorAngle = nil
            if !sensorEverReadable {
                // This Mac has no readable sensor: say so and switch the option off. Preview, demo and
                // the hotkey all still work.
                followLid = false
                status = "This Mac has no readable lid sensor, so Follow the lid is off. Preview, demo and the hotkey still work."
                sensorMessage = reading.message
                return
            }
            perform(follower.ingest(angle: nil, now: Date.timeIntervalSinceReferenceDate, tuning: tuning))
            return
        }
        let now = Date.timeIntervalSinceReferenceDate
        if !sensorEverReadable {
            sensorEverReadable = true
            // Adopt where the lid rests as "open", so closing it a little starts the fold.
            if (75...135).contains(angle), abs(angle - tuning.workingAngle) > 6 {
                tuning.workingAngle = angle
                status = "Following the lid, with \(Int(angle))° as open. Close it slowly."
            }
        }
        sensorAngle = angle
        lastReadingAt = now
        perform(follower.ingest(angle: angle, now: now, tuning: tuning))
    }

    private func perform(_ actions: [LidFollower.Action]) {
        for action in actions {
            switch action {
            case .requestCapture: begin(.lid)
            case .update(let angle): overlay.setAngle(angle)
            case .teardown(let reason): if session?.trigger == .lid { teardown(reason) }
            }
        }
    }

    // MARK: NotchClaimant (the fold is the top priority, so nothing ever preempts it)

    func notchPreempted(by priority: NotchPriority) {}
    func notchAvailable() {}
}
