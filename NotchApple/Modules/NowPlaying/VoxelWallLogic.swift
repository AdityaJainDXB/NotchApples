//
//  VoxelWallLogic.swift
//  Notch Apple
//
//  The math behind the Music Wall (issue #119), with no UI: an isometric floor of cubes, each cube's height from the music's
//  four bands (bass in the middle, highs at the edges) plus a slow travelling wave, and gentle made-up levels when the real
//  sound can't be heard.
//

import Foundation

enum VoxelWallLogic {
    /// Cubes per side of the floor.
    static let grid = 18

    /// Back to front, so nearer cubes are drawn over farther ones.
    static let drawOrder: [(Int, Int)] = {
        var cells: [(Int, Int)] = []
        for i in 0..<grid { for j in 0..<grid { cells.append((i, j)) } }
        return cells.sorted { ($0.0 + $0.1, $0.0) < ($1.0 + $1.1, $1.0) }
    }()

    /// Width of one cube's top for a screen of `size`, so the floor fills about 70% of the width.
    static func tileWidth(for size: CGSize) -> Double { max(18, min(size.width * 0.7 / Double(grid), size.height * 1.1 / Double(grid))) }

    /// Where the bottom-centre of cube (i, j) sits on screen.
    static func project(i: Int, j: Int, tile: Double, size: CGSize) -> CGPoint {
        let x = Double(i - j) * tile / 2 + size.width / 2
        let floorHeight = Double(2 * grid) * tile / 4
        let y = Double(i + j) * tile / 4 + (size.height - floorHeight) / 2 + size.height * 0.12
        return CGPoint(x: x, y: y)
    }

    /// Distance of cube (i, j) from the middle of the floor, 0 (centre) to 1 (corner).
    static func distance(_ i: Int, _ j: Int) -> Double {
        let c = Double(grid - 1) / 2
        let d = ((Double(i) - c) * (Double(i) - c) + (Double(j) - c) * (Double(j) - c)).squareRoot()
        return min(1, d / (c * 2.0.squareRoot()))
    }

    /// The band (0 bass … 3 highs) a cube follows: bass in the middle, highs at the edges, blended between neighbours.
    static func level(at distance: Double, levels: [Double]) -> Double {
        guard !levels.isEmpty else { return 0 }
        let x = distance * Double(levels.count - 1)
        let a = min(levels.count - 1, Int(x)), b = min(levels.count - 1, a + 1)
        let f = x - Double(a)
        return levels[a] * (1 - f) + levels[b] * f
    }

    /// Every cube's height, 0…1.3, row by row (index i * grid + j).
    static func heights(levels: [Double], time: Double) -> [Double] {
        var out = [Double](repeating: 0, count: grid * grid)
        for i in 0..<grid {
            for j in 0..<grid {
                let d = distance(i, j)
                let wave = 0.5 + 0.5 * sin(time * 1.6 - d * 7)
                let music = level(at: d, levels: levels)
                out[i * grid + j] = min(1.3, 0.04 + music * (0.55 + 0.45 * wave) * (1.15 - d * 0.5) + wave * 0.06)
            }
        }
        return out
    }

    /// Moves `current` a third of the way toward `target` (or jumps when the sizes differ).
    static func ease(_ current: [Double], toward target: [Double], rate: Double = 0.35) -> [Double] {
        guard current.count == target.count else { return target }
        return zip(current, target).map { $0 + ($1 - $0) * rate }
    }

    /// Levels to use when the real sound can't be heard: a beat while music plays, almost still when paused.
    static func simulatedLevels(time: Double, playing: Bool) -> [Double] {
        guard playing else { return [0.04, 0.03, 0.02, 0.02] }
        let beat = pow(max(0, sin(time * 2 * .pi * 2.0)), 6)          // 120 bpm kick
        return [0.35 + 0.6 * beat,
                0.3 + 0.25 * (0.5 + 0.5 * sin(time * 3.1)),
                0.25 + 0.25 * (0.5 + 0.5 * sin(time * 5.3 + 1)),
                0.15 + 0.2 * (0.5 + 0.5 * sin(time * 8.7 + 2))]
    }

    // MARK: Verse (word-by-word lyrics)

    /// How many words of a lyric line are showing, from the playback position: words appear one by one across the line's
    /// time (until the next line starts), at least one as soon as the line begins.
    static func wordsShown(lineStart: TimeInterval, nextStart: TimeInterval?, position: TimeInterval, wordCount: Int) -> Int {
        guard wordCount > 0 else { return 0 }
        let length = max(0.6, min(8, (nextStart ?? lineStart + 4) - lineStart))
        let progress = (position - lineStart) / (length * 0.85)
        return max(1, min(wordCount, Int((progress * Double(wordCount)).rounded(.down)) + 1))
    }

    /// The last `keep` words shown, newest last (the stack on screen).
    static func stack(_ words: [String], shown: Int, keep: Int = 3) -> [String] {
        Array(words.prefix(shown).suffix(keep))
    }

    /// Eases four band levels (fast up, slower down), so the scene jumps with a hit and settles smoothly.
    static func easeBands(_ current: [Double], toward target: [Double]) -> [Double] {
        guard current.count == target.count else { return target }
        return zip(current, target).map { c, t in t > c ? c + (t - c) * 0.6 : c + (t - c) * 0.12 }
    }
}
