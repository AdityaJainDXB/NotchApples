//
//  ScreenContextLogic.swift
//  Notch Apple
//
//  The pure rules of NotchAI's screen awareness: which apps are never captured, how the text read from the screen
//  and the app/window it came from are turned into one question for the model, and how a region preset crops.
//  Nothing here touches the screen; unit tested.
//

import CoreGraphics
import Foundation

struct ScreenSnapshot: Equatable {
    var appName: String
    var bundleID: String
    var windowTitle: String?
    /// Text read from the capture by Apple Vision, on this Mac.
    var ocrText: String
    var scope: ScreenScope
}

enum ScreenScope: String, CaseIterable, Identifiable {
    case window, display
    case top, bottom, left, right, center
    /// An area the user drew with the picker. Not in the preset list.
    case region
    var id: String { rawValue }

    var title: String {
        switch self {
        case .window: "This window"
        case .display: "Whole screen"
        case .top: "Top half"
        case .bottom: "Bottom half"
        case .left: "Left half"
        case .right: "Right half"
        case .center: "Centre"
        case .region: "A chosen area"
        }
    }

    /// The presets offered in the menu (the drawn area has its own button).
    static var presets: [ScreenScope] { allCases.filter { $0 != .region } }

    /// The part of the capture to keep, as fractions (x, y, width, height) with y from the top. Nil = all of it.
    var crop: CGRect? {
        switch self {
        case .window, .display, .region: nil
        case .top: CGRect(x: 0, y: 0, width: 1, height: 0.5)
        case .bottom: CGRect(x: 0, y: 0.5, width: 1, height: 0.5)
        case .left: CGRect(x: 0, y: 0, width: 0.5, height: 1)
        case .right: CGRect(x: 0.5, y: 0, width: 0.5, height: 1)
        case .center: CGRect(x: 0.25, y: 0.25, width: 0.5, height: 0.5)
        }
    }
}

enum ScreenContextLogic {
    /// Apps that are never captured unless the user removes them from the list: password managers and Keychain Access.
    static let defaultExclusions = [
        "com.1password.1password", "com.agilebits.onepassword7", "com.agilebits.onepassword-osx",
        "com.apple.keychainaccess", "com.apple.Passwords", "com.bitwarden.desktop", "com.dashlane.dashlanephonefinal",
        "org.keepassxc.keepassxc", "com.lastpass.LastPass",
    ]

    static func isExcluded(bundleID: String, exclusions: [String]) -> Bool {
        let id = bundleID.lowercased()
        return exclusions.contains { $0.lowercased() == id }
    }

    /// A pixel rectangle for a fractional crop of an image of the given size (y from the top), or nil for "all".
    static func cropRect(_ crop: CGRect?, width: Int, height: Int) -> CGRect? {
        guard let c = crop else { return nil }
        return CGRect(x: c.minX * Double(width), y: c.minY * Double(height), width: c.width * Double(width), height: c.height * Double(height)).integral
    }

    // MARK: Free-form area

    /// The smallest area worth capturing, in points.
    static let minimumRegion: CGFloat = 12

    /// The rectangle between where a drag started and where it is now, whichever way it was dragged.
    static func dragRect(from a: CGPoint, to b: CGPoint) -> CGRect {
        CGRect(x: min(a.x, b.x), y: min(a.y, b.y), width: abs(a.x - b.x), height: abs(a.y - b.y))
    }

    /// A selection in AppKit screen coordinates (origin bottom-left) as a rectangle on that display with its origin at the
    /// display's TOP-left, which is what a capture wants. Clipped to the display; nil if what is left is too small.
    static func regionOnDisplay(selection: CGRect, screenFrame: CGRect) -> CGRect? {
        let clipped = selection.intersection(screenFrame)
        guard !clipped.isNull, clipped.width >= minimumRegion, clipped.height >= minimumRegion else { return nil }
        return CGRect(x: clipped.minX - screenFrame.minX, y: screenFrame.maxY - clipped.maxY, width: clipped.width, height: clipped.height)
    }

    /// The pixel size to capture a region at, for a display's scale (2 on Retina), capped so a huge area stays manageable.
    static func pixelSize(of region: CGRect, scale: CGFloat, maxSide: Int = 4096) -> (width: Int, height: Int) {
        let w = max(1, Int((region.width * scale).rounded())), h = max(1, Int((region.height * scale).rounded()))
        let f = min(1, Double(maxSide) / Double(max(w, h)))
        return (max(1, Int(Double(w) * f)), max(1, Int(Double(h) * f)))
    }

    // MARK: Selected text

    static let maxSelection = 12_000

    /// Selected text worth sending: not blank. Trimmed, and cut (with a note) when very long.
    static func usableSelection(_ raw: String?) -> (text: String, wasCut: Bool)? {
        guard let raw, !raw.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else { return nil }
        let t = raw.trimmingCharacters(in: .whitespacesAndNewlines)
        guard t.count > maxSelection else { return (t, false) }
        return (String(t.prefix(maxSelection)), true)
    }

    static func selectionPrompt(question: String, appName: String, text: String, wasCut: Bool) -> String {
        var lines = [question, "", "The text I have selected in \(appName) (read on my Mac):", "\"\"\"", text, "\"\"\""]
        if wasCut { lines.append("(The selection was very long, so only the start is included.)") }
        return lines.joined(separator: "\n")
    }

    static func selectionBubble(question: String, appName: String, characters: Int) -> String {
        "\(question)  ·  selected text in \(appName), \(characters.formatted()) characters"
    }

    static let selectionExplainQuestion = "Explain this selected text simply, and say if anything in it looks wrong."

    /// Keeps the start and end of long text (the middle is the part least likely to matter) within the limit.
    static func truncated(_ text: String, maxCharacters: Int) -> (text: String, wasCut: Bool) {
        guard text.count > maxCharacters, maxCharacters > 40 else { return (text, false) }
        let head = text.prefix(maxCharacters * 2 / 3)
        let tail = text.suffix(maxCharacters / 3 - 20)
        return (head + "\n[… middle of the screen text left out …]\n" + tail, true)
    }

    /// The question the model receives: what the user asked, then the app, window and text that were on screen.
    static func prompt(question: String, snapshot s: ScreenSnapshot, maxCharacters: Int = 12_000) -> String {
        let cut = truncated(s.ocrText, maxCharacters: maxCharacters)
        var lines = ["\(question)", "", "Context from my screen (\(s.scope.title.lowercased()); read on my Mac, not an image):",
                     "App: \(s.appName)"]
        if let t = s.windowTitle, !t.isEmpty { lines.append("Window: \(t)") }
        lines.append(cut.text.isEmpty ? "No text could be read from the screen." : "Text on screen:\n\(cut.text)")
        if cut.wasCut { lines.append("(The text was long, so part of the middle was left out.)") }
        return lines.joined(separator: "\n")
    }

    /// What the chat bubble shows instead of the long prompt.
    static func bubble(question: String, snapshot s: ScreenSnapshot) -> String {
        let n = s.ocrText.count
        return "\(question)  ·  \(s.appName), \(s.scope.title.lowercased()), \(n.formatted()) characters read"
    }

    static let explainQuestion = "Explain what I'm looking at on my screen. Point out anything that looks like an error and what to do about it."
    static let summariseQuestion = "Summarise what is in this app window in a few short points."
}
