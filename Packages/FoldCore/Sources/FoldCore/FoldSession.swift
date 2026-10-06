//
//  FoldSession.swift
//  Notch apple, Lid Fold
//
//  Original to Notch apple. The rules that keep the fold from ever trapping you behind a frosted
//  desktop: how long each trigger may last, when a session must be torn down, and the angle curves
//  used by Preview, the timed demo and the hotkey hold. Pure functions, so they are unit-tested.
//  (The eased-hold curve follows the idea of Still's screen-saver mode; the code is new.)
//

import Foundation

/// What started a fold.
public enum FoldTrigger: String, CaseIterable, Codable, Sendable {
    case preview   // the Preview button
    case demo      // timed demo
    case hotkey    // press to fold and hold, press again (or Esc, or click) to clear
    case lid       // follows the real lid angle
}

public enum FoldTeardownReason: String, Equatable, Sendable {
    case maxDuration, sensorStale, sensorInvalid, captureFailed, renderFailed
    case lidReopened, sleep, displayChange, userDismissed, disabled, finished, unknown
}

public enum FoldFailSafe {
    /// Every trigger except the lid has a hard ceiling, so a forgotten fold ends by itself.
    public static func maxDuration(_ trigger: FoldTrigger) -> TimeInterval? {
        switch trigger {
        case .preview: return 6
        case .demo: return 12
        case .hotkey: return 30
        case .lid: return nil      // ends when the lid reopens or the sensor goes quiet
        }
    }

    /// A lid reading older than this is treated as lost.
    public static let sensorStaleAfter: TimeInterval = 0.5

    /// Nil means "carry on". Anything else means: remove the overlay and release capture now.
    public static func check(trigger: FoldTrigger, elapsed: TimeInterval,
                             sensorAge: TimeInterval?, angle: Double?) -> FoldTeardownReason? {
        guard elapsed.isFinite, elapsed >= 0 else { return .unknown }
        if let limit = maxDuration(trigger), elapsed >= limit { return .maxDuration }
        if trigger == .lid {
            guard let angle, angle.isFinite, (0...200).contains(angle) else { return .sensorInvalid }
            guard let sensorAge, sensorAge.isFinite, sensorAge <= sensorStaleAfter else { return .sensorStale }
        }
        return nil
    }
}

public enum FoldCurves {
    /// 0 = lid at its working angle (no fold) ... 1 = fully folded, for a given tuning.
    public static func angle(forProgress progress: Double, tuning: FoldTuning) -> Double {
        let t = tuning.validated
        let p = finiteClamp(progress, 0, 1, fallback: 0)
        return t.workingAngle - p * (t.workingAngle - t.fadeAngle)
    }

    /// Preview: folds down and back up over `duration`. Nil once it has finished.
    public static func previewAngle(elapsed: TimeInterval, duration: TimeInterval = 4,
                                    working: Double, lowest: Double = 30) -> Double? {
        guard elapsed.isFinite, duration > 0, elapsed >= 0, elapsed < duration else { return nil }
        let fold = 0.5 - 0.5 * cos(elapsed / duration * 2 * .pi)
        return working - (working - lowest) * fold
    }

    /// Demo and hotkey: eases down to a resting angle, then holds there (until torn down).
    public static func heldAngle(elapsed: TimeInterval, settle: TimeInterval = 2.5,
                                 working: Double, resting: Double) -> Double {
        guard elapsed.isFinite, elapsed > 0, settle > 0 else { return working }
        if elapsed >= settle { return resting }
        let t = elapsed / settle
        let eased = 1 - pow(1 - t, 3)
        return working - (working - resting) * eased
    }
}
