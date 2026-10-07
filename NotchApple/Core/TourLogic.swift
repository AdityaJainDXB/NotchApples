//
//  TourLogic.swift
//  Notch apple
//
//  Who sees the walkthrough and how its steps move, with no screens in it so it can be tested. The tour is
//  compulsory for people updating to this version: it keeps coming back (and remembers its step) until the last
//  step is finished. A brand-new install already gets the first-run setup, so it is marked done.
//

import Foundation

enum TourLogic {
    static let stepCount = 9

    /// Shown to anyone who has not finished it, except a fresh install.
    static func needed(done: Bool, freshInstall: Bool) -> Bool { !done && !freshInstall }

    static func next(_ step: Int) -> Int { min(step + 1, stepCount - 1) }
    static func back(_ step: Int) -> Int { max(step - 1, 0) }
    static func isLast(_ step: Int) -> Bool { step >= stepCount - 1 }

    /// A saved step from an older build or a damaged value never points off the end.
    static func clamp(_ step: Int) -> Int { min(max(step, 0), stepCount - 1) }
}
