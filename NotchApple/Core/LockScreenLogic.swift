//
//  LockScreenLogic.swift
//  Notch Apple
//
//  The one rule behind the music card on the lock screen, kept free of AppKit so it is unit-tested.
//

import Foundation

enum LockScreenLogic {
    /// The card shows when it is switched on, the Mac is locked and there is a song playing.
    static func shouldShow(enabled: Bool, locked: Bool, hasTrack: Bool) -> Bool {
        enabled && locked && hasTrack
    }
}
