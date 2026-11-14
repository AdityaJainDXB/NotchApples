//
//  DesktopWidgetLogic.swift
//  Notch Apple
//
//  Desktop widgets (Ultimate): small panels the user can put on the desktop. The pure rules live here, unit tested:
//  which widgets exist, where a new one first appears, keeping a panel on a screen that still exists, and what the
//  to-do and Now Playing widgets show. No windows, no timers, no files.
//

import CoreGraphics
import Foundation

enum DesktopWidgetKind: String, CaseIterable, Codable, Identifiable {
    case clock, todo, nowPlaying
    var id: String { rawValue }

    var title: String {
        switch self { case .clock: "Clock"; case .todo: "To-do"; case .nowPlaying: "Now Playing" }
    }
    var symbol: String {
        switch self { case .clock: "clock"; case .todo: "checklist"; case .nowPlaying: "music.note" }
    }
    var defaultSize: CGSize {
        switch self { case .clock: CGSize(width: 190, height: 96); case .todo: CGSize(width: 240, height: 170); case .nowPlaying: CGSize(width: 240, height: 84) }
    }
}

enum DesktopWidgetLogic {
    static let margin: CGFloat = 24
    static let spacing: CGFloat = 14

    /// Where the n-th enabled widget first appears: down the right edge of the screen, below the menu bar, one under the other.
    /// `visible` is the screen's visible frame in AppKit coordinates (origin bottom-left).
    static func defaultOrigin(index: Int, sizes: [CGSize], in visible: CGRect) -> CGPoint {
        let above = sizes.prefix(index).reduce(CGFloat(0)) { $0 + $1.height + spacing }
        let size = index < sizes.count ? sizes[index] : CGSize(width: 200, height: 100)
        return CGPoint(x: visible.maxX - size.width - margin, y: visible.maxY - margin - above - size.height)
    }

    /// A saved origin pulled back onto the nearest screen if the screen it was on is gone or smaller now.
    /// `screens` are visible frames; with none, the origin is returned unchanged.
    static func onScreen(origin: CGPoint, size: CGSize, screens: [CGRect]) -> CGPoint {
        guard !screens.isEmpty else { return origin }
        let rect = CGRect(origin: origin, size: size)
        if screens.contains(where: { $0.intersection(rect).width >= min(size.width, 60) && $0.intersection(rect).height >= min(size.height, 40) }) { return origin }
        let target = screens.min { distance(from: rect.center, to: $0) < distance(from: rect.center, to: $1) } ?? screens[0]
        let x = min(max(origin.x, target.minX + margin), max(target.minX + margin, target.maxX - size.width - margin))
        let y = min(max(origin.y, target.minY + margin), max(target.minY + margin, target.maxY - size.height - margin))
        return CGPoint(x: x, y: y)
    }

    private static func distance(from p: CGPoint, to r: CGRect) -> CGFloat {
        let dx = max(r.minX - p.x, 0, p.x - r.maxX), dy = max(r.minY - p.y, 0, p.y - r.maxY)
        return (dx * dx + dy * dy).squareRoot()
    }

    /// The to-do lines to show: open tasks only, in the order given, at most `limit`, plus how many more there are.
    static func todoLines(_ items: [TodoItem], limit: Int = 5) -> (shown: [TodoItem], more: Int) {
        let open = items.filter { !$0.done }
        return (Array(open.prefix(limit)), max(0, open.count - limit))
    }

    /// What the Now Playing widget says. Nothing playing is a calm message, not an empty box.
    static func nowPlayingText(title: String?, artist: String?, isPlaying: Bool) -> (line1: String, line2: String) {
        guard let title, !title.trimmingCharacters(in: .whitespaces).isEmpty else { return ("Nothing playing", "") }
        let a = (artist ?? "").trimmingCharacters(in: .whitespaces)
        return (title, isPlaying ? a : (a.isEmpty ? "Paused" : "\(a) · paused"))
    }

    /// Only widgets the user switched on, in the fixed order of `DesktopWidgetKind.allCases`.
    static func enabled(_ raw: [String]) -> [DesktopWidgetKind] {
        let set = Set(raw)
        return DesktopWidgetKind.allCases.filter { set.contains($0.rawValue) }
    }
}

private extension CGRect { var center: CGPoint { CGPoint(x: midX, y: midY) } }
