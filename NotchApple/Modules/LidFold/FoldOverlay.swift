//
//  FoldOverlay.swift
//  Notch apple, Lid Fold
//
//  Origin:  Still, native/Sources/Still/DesktopOverlay.swift
//           (MIT, Copyright (c) 2026 Akshay Sharma and Kavish Shah; LICENSES/Still-MIT.txt)
//  Changes: MODIFIED REWRITE. Public API is start(source:) / stop() / setProgress(_:) / preview(duration:).
//           Differences that matter for safety:
//             - panels sit BELOW the notch window (statusBar level), never at or above it;
//             - a click anywhere on the overlay (or the dismiss key the module registers) removes it;
//             - panels never become key or main, never activate the app, never take focus;
//             - nothing exists while idle: panels are created in start() and closed in stop();
//             - the snapshot texture is dropped as soon as the panels close.
//

import AppKit
import FoldCore

/// A full-screen panel that ignores focus but turns any click into a dismissal.
private final class FoldPanel: NSPanel {
    var onDismiss: (@MainActor () -> Void)?
    /// Clicks only count after this moment, so the double-click that pressed "Preview" cannot close it.
    var armedAt = Date.distantFuture

    override var canBecomeKey: Bool { false }
    override var canBecomeMain: Bool { false }

    private func dismiss() {
        guard Date() >= armedAt else { return }
        MainActor.assumeIsolated { onDismiss?() }
    }
    override func mouseDown(with event: NSEvent) { dismiss() }
    override func rightMouseDown(with event: NSEvent) { dismiss() }
    override func otherMouseDown(with event: NSEvent) { dismiss() }
    override func scrollWheel(with event: NSEvent) { dismiss() }
}

@MainActor
final class FoldOverlay {
    enum Source {
        case desktop([FoldShot])     // a real snapshot (needs Screen Recording)
        case backdrop                // a generated picture (limited mode, nothing captured)
    }

    private struct Layer {
        let panel: FoldPanel
        let surface: FoldSurface
        let image: CGImage
    }

    private var layers: [Layer] = []
    private var tuning = FoldTuning()
    private var previewTimer: Timer?
    private static let clickGuard: TimeInterval = 0.25

    /// Set by the module: the user clicked the overlay.
    var onDismiss: (@MainActor () -> Void)?
    var isVisible: Bool { !layers.isEmpty }

    /// Puts the overlay up on every display. Throws (leaving nothing on screen) if Metal or a panel fails.
    func start(source: Source, tuning: FoldTuning, progress: Double = 0) throws {
        stop()
        self.tuning = tuning.validated
        let shots: [FoldShot]
        switch source {
        case .desktop(let s): shots = s
        case .backdrop: shots = FoldCapture.backdrops()
        }
        guard !shots.isEmpty else { throw FoldCaptureIssue.noDisplay }

        var built: [Layer] = []
        do {
            for shot in shots {
                let surface = FoldSurface()
                if let problem = surface.setupError { throw FoldSurfaceError(problem) }
                let panel = FoldPanel(contentRect: shot.screen.frame,
                                      styleMask: [.borderless, .nonactivatingPanel],
                                      backing: .buffered, defer: false, screen: shot.screen)
                // Below the notch (statusBar + 1 or screen saver), above ordinary windows and the menu bar.
                panel.level = .statusBar
                panel.collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary, .stationary, .ignoresCycle]
                panel.isOpaque = false
                panel.backgroundColor = .black
                panel.hasShadow = false
                panel.hidesOnDeactivate = false
                panel.isReleasedWhenClosed = false
                panel.becomesKeyOnlyIfNeeded = true
                panel.sharingType = .none            // never part of a screenshot or screen share
                panel.ignoresMouseEvents = false     // so a click can dismiss it
                panel.acceptsMouseMovedEvents = false
                panel.onDismiss = { [weak self] in self?.onDismiss?() }
                panel.contentView = surface
                panel.setFrame(shot.screen.frame, display: false)
                surface.update(image: shot.image, angle: FoldCurves.angle(forProgress: progress, tuning: self.tuning), tuning: self.tuning)
                if let problem = surface.setupError { throw FoldSurfaceError(problem) }
                built.append(Layer(panel: panel, surface: surface, image: shot.image))
            }
        } catch {
            for layer in built { close(layer) }
            throw error
        }
        layers = built
        let armed = Date().addingTimeInterval(Self.clickGuard)
        for layer in layers {
            layer.panel.armedAt = armed
            layer.panel.alphaValue = 0
            layer.panel.orderFrontRegardless()      // never makeKey: the overlay must not take focus
            layer.surface.beginContinuousDisplay()
        }
        let target = self.tuning.opacity
        NSAnimationContext.runAnimationGroup { context in
            context.duration = 0.12
            for layer in layers { layer.panel.animator().alphaValue = target }
        }
    }

    /// 0 = untouched desktop, 1 = fully folded.
    func setProgress(_ progress: Double) {
        setAngle(FoldCurves.angle(forProgress: progress, tuning: tuning))
    }

    /// The same thing in lid degrees (used when following the real lid).
    func setAngle(_ angle: Double) {
        for layer in layers { layer.surface.update(image: layer.image, angle: angle, tuning: tuning) }
    }

    /// Folds down and back up once, then calls `finished`. Stops itself; `stop()` cancels it.
    func preview(duration: TimeInterval = 4, finished: @escaping @MainActor () -> Void) {
        previewTimer?.invalidate()
        let began = Date.timeIntervalSinceReferenceDate
        let working = tuning.workingAngle
        let timer = Timer(timeInterval: 1.0 / 60, repeats: true) { [weak self] _ in
            MainActor.assumeIsolated {
                guard let self else { return }
                let elapsed = Date.timeIntervalSinceReferenceDate - began
                if let angle = FoldCurves.previewAngle(elapsed: elapsed, duration: duration, working: working) {
                    self.setAngle(angle)
                } else {
                    self.previewTimer?.invalidate()
                    self.previewTimer = nil
                    finished()
                }
            }
        }
        RunLoop.main.add(timer, forMode: .common)
        previewTimer = timer
    }

    /// Removes everything at once and frees the snapshot.
    func stop() {
        previewTimer?.invalidate()
        previewTimer = nil
        for layer in layers { close(layer) }
        layers = []
    }

    private func close(_ layer: Layer) {
        layer.panel.onDismiss = nil
        layer.panel.armedAt = .distantFuture
        layer.surface.endContinuousDisplay()
        layer.panel.orderOut(nil)
        layer.surface.clearSnapshot()
        layer.panel.contentView = nil
        layer.panel.close()
    }
}
