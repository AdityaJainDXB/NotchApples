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
        }
    }

    /// The part of the capture to keep, as fractions (x, y, width, height) with y from the top. Nil = all of it.
    var crop: CGRect? {
        switch self {
        case .window, .display: nil
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
