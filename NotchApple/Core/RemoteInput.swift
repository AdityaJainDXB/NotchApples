//
//  RemoteInput.swift
//  Notch Apple
//
//  Replays what the paired iPhone does (taps, drags, scrolling, typing, shortcuts) on this Mac with CGEvent. Only reached
//  while a remote control session is on (RemoteViewHub): the Mac's "Allow remote control" switch, the phone's own permission,
//  and Accessibility must all be on. Positions are fractions of the picture, clamped to the display being shown.
//

import AppKit
import ApplicationServices

enum RemoteInput {
    static var trusted: Bool { AXIsProcessTrusted() }

    private static func flags(_ mods: [String]?) -> CGEventFlags {
        var f = CGEventFlags()
        for m in mods ?? [] {
            switch m.lowercased() {
            case "cmd", "command": f.insert(.maskCommand)
            case "shift": f.insert(.maskShift)
            case "alt", "option": f.insert(.maskAlternate)
            case "ctrl", "control": f.insert(.maskControl)
            default: break
            }
        }
        return f
    }

    private static func point(_ e: Companion.InputEvent, in bounds: CGRect) -> CGPoint {
        let x = min(max(e.x ?? 0.5, 0), 1), y = min(max(e.y ?? 0.5, 0), 1)
        // One point inside the edge, so a click at the very corner doesn't land on another display.
        return CGPoint(x: bounds.minX + min(x * bounds.width, bounds.width - 1), y: bounds.minY + min(y * bounds.height, bounds.height - 1))
    }

    private static func post(_ event: CGEvent?, _ flags: CGEventFlags = []) {
        guard let event else { return }
        if !flags.isEmpty { event.flags = flags }
        event.post(tap: .cghidEventTap)
    }

    /// Does one event on the display whose frame (in global coordinates, top-left origin) is `bounds`. False if it isn't understood.
    @discardableResult
    static func perform(_ e: Companion.InputEvent, in bounds: CGRect) -> Bool {
        let f = flags(e.mods)
        switch e.kind {
        case "move":
            post(CGEvent(mouseEventSource: nil, mouseType: .mouseMoved, mouseCursorPosition: point(e, in: bounds), mouseButton: .left), f)
        case "down", "drag", "up":
            let type: CGEventType = e.kind == "down" ? .leftMouseDown : e.kind == "drag" ? .leftMouseDragged : .leftMouseUp
            let ev = CGEvent(mouseEventSource: nil, mouseType: type, mouseCursorPosition: point(e, in: bounds), mouseButton: .left)
            ev?.setIntegerValueField(.mouseEventClickState, value: Int64(min(max(e.count ?? 1, 1), 3)))
            post(ev, f)
        case "rdown", "rup":
            post(CGEvent(mouseEventSource: nil, mouseType: e.kind == "rdown" ? .rightMouseDown : .rightMouseUp, mouseCursorPosition: point(e, in: bounds), mouseButton: .right), f)
        case "scroll":
            let dy = Int32(max(-400, min(400, e.dy ?? 0))), dx = Int32(max(-400, min(400, e.dx ?? 0)))
            post(CGEvent(scrollWheelEvent2Source: nil, units: .pixel, wheelCount: 2, wheel1: dy, wheel2: dx, wheel3: 0), f)
        case "text":
            for ch in (e.text ?? "").prefix(Companion.maxTypedText) {
                if ch == "\n" { key(36, []); continue }
                let units = Array(String(ch).utf16)
                for down in [true, false] {
                    let ev = CGEvent(keyboardEventSource: nil, virtualKey: 0, keyDown: down)
                    ev?.keyboardSetUnicodeString(stringLength: units.count, unicodeString: units)
                    post(ev, [])
                }
            }
        case "key", "shortcut":
            guard let name = e.text, let code = Companion.keyCode(name) else { return false }
            key(code, f)
        default:
            return false
        }
        return true
    }

    private static func key(_ code: UInt16, _ flags: CGEventFlags) {
        post(CGEvent(keyboardEventSource: nil, virtualKey: CGKeyCode(code), keyDown: true), flags)
        post(CGEvent(keyboardEventSource: nil, virtualKey: CGKeyCode(code), keyDown: false), flags)
    }
}
