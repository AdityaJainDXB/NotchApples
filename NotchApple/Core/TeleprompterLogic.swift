//
//  TeleprompterLogic.swift
//  Notch Apple
//
//  Tools → Teleprompter: the rules, with no UI so they are tested without the app. A speed is a level from 1 to 10, which
//  means a reading pace in words a minute; the text moves up that fast for the chosen text size. Windows has the same
//  rules in NotchWindows/src/js/services/teleprompterlogic.js (these Swift tests are the specification).
//

import Foundation

enum TeleprompterLogic {
    static let speedRange = 1...10
    static let defaultSpeed = 4
    static let fontRange: ClosedRange<Double> = 14...44
    static let defaultFont: Double = 24
    /// How many words fit on one line of the reader, used to turn a reading pace into a scroll speed.
    static let wordsPerLine = 6.0
    /// A line is this many times as tall as its text.
    static let lineHeightFactor = 1.4

    static func clampSpeed(_ s: Int) -> Int { min(speedRange.upperBound, max(speedRange.lowerBound, s)) }
    static func clampFont(_ f: Double) -> Double { min(fontRange.upperBound, max(fontRange.lowerBound, f)) }

    /// The reading pace a speed level stands for: 60 words a minute at level 1, 240 at level 10.
    static func wordsPerMinute(speed: Int) -> Int { 60 + (clampSpeed(speed) - 1) * 20 }

    static func wordCount(_ text: String) -> Int { text.split(whereSeparator: { $0.isWhitespace }).count }

    /// How far the text moves up each second, in points, for a speed and a text size.
    static func pointsPerSecond(speed: Int, fontSize: Double) -> Double {
        let linesPerSecond = Double(wordsPerMinute(speed: speed)) / 60.0 / wordsPerLine
        return linesPerSecond * clampFont(fontSize) * lineHeightFactor
    }

    /// How long the script takes to read at a speed, in whole seconds.
    static func seconds(words: Int, speed: Int) -> Int {
        Int((Double(max(0, words)) / Double(wordsPerMinute(speed: speed)) * 60).rounded())
    }

    /// m:ss
    static func clock(_ seconds: Int) -> String {
        let s = max(0, seconds)
        return "\(s / 60):" + String(format: "%02d", s % 60)
    }

    /// One tick of the scroll: the new offset after `dt` seconds, never past `maxOffset`, and whether the end was reached.
    static func advance(offset: Double, dt: Double, speed: Int, fontSize: Double, maxOffset: Double) -> (offset: Double, finished: Bool) {
        let limit = max(0, maxOffset)
        let next = offset + pointsPerSecond(speed: speed, fontSize: fontSize) * max(0, dt)
        return next >= limit ? (limit, true) : (next, false)
    }
}
