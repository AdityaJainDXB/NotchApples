//
//  NotchGestures.swift
//  Notch apple
//
//  Trackpad gestures on the closed notch:
//   • two-finger scroll up / down → volume up / down (with the notch gauge)
//   • two-finger swipe left / right → previous / next track
//  Turned on or off in Settings → Notch Extras; with Pro each gesture can be remapped
//  (Settings → Notch → Gestures, see NotchGesture).
//

import AppKit

@MainActor
final class NotchGestures {
    static let shared = NotchGestures()

    private var verticalAccumulator: CGFloat = 0
    private var horizontalAccumulator: CGFloat = 0
    private var swipeFired = false

        func handle(_ event: NSEvent) {
        guard SettingsManager.shared.notchGestures, AppDelegate.current?.notch?.isOpen == false else { return }
        if event.phase == .began || event.phase == .mayBegin {
            verticalAccumulator = 0
            horizontalAccumulator = 0
            swipeFired = false
        }
        // Work in finger directions whatever the natural-scrolling setting: negative = fingers left / up.
        let flip: CGFloat = event.isDirectionInvertedFromDevice ? 1 : -1
        let dx = event.scrollingDeltaX * flip
        let dy = event.scrollingDeltaY * flip
        let precise = event.hasPreciseScrollingDeltas

        if abs(dx) > abs(dy) * 1.5 {
            horizontalAccumulator += dx
            let action = NotchGesture.closedSwipe.action
            if !swipeFired && abs(horizontalAccumulator) > (precise ? 60 : 3) && action == .open {
                swipeFired = true
                AppDelegate.current?.notch?.expand()
            } else if !swipeFired && abs(horizontalAccumulator) > (precise ? 60 : 3) && action == .track {
                swipeFired = true
                MediaControl.send(horizontalAccumulator < 0 ? .next : .previous)
                LiveActivityCenter.shared.flash(LiveActivity(symbol: horizontalAccumulator < 0 ? "forward.fill" : "backward.fill",
                                                             label: nil, tint: .white), seconds: 1.2)
            }
        } else if abs(dy) > 0 {
            let action = NotchGesture.closedScroll.action
            if action == .none { return }
            if action == .open {
                // Swipe down (fingers down) on the closed notch opens it.
                verticalAccumulator += dy
                if !swipeFired && verticalAccumulator > (precise ? 40 : 2) { swipeFired = true; AppDelegate.current?.notch?.expand() }
                return
            }
            verticalAccumulator += dy
            let step: CGFloat = precise ? 14 : 1
            while abs(verticalAccumulator) >= step {
                let up = verticalAccumulator < 0
                MediaKeyInterceptor.shared.nudgeVolume(up ? 1.0 / 32 : -1.0 / 32)
                verticalAccumulator += up ? step : -step
            }
        }
        if event.phase == .ended || event.phase == .cancelled { swipeFired = false }
    }
}
