//
//  AppleScriptSupport.swift
//  Notch apple
//
//  AppleScript (scripting dictionary in NotchApple.sdef):
//    tell application "Notch apple" to toggle notch
//    tell application "Notch apple" to run notch command "timer?minutes=5"
//    tell application "Notch apple" to run notch command "ask?q=What's on today?"   -- Ultimate
//  Every command goes through the same notchapple:// handler (FeatureHub), so the
//  same tier rules apply as for links and the `notch` command-line tool.
//

import AppKit

@objc(NotchScriptCommand)
final class NotchScriptCommand: NSScriptCommand {
    override func performDefaultImplementation() -> Any? {
        guard let raw = directParameter as? String else { return nil }
        let command = raw.hasPrefix("notchapple://") ? String(raw.dropFirst("notchapple://".count)) : raw
        let encoded = command.addingPercentEncoding(withAllowedCharacters: .urlFragmentAllowed) ?? command
        guard let url = URL(string: "notchapple://" + encoded) else { return nil }
        DispatchQueue.main.async { MainActor.assumeIsolated { FeatureHub.handle(url) } }
        return nil
    }
}

@objc(NotchToggleCommand)
final class NotchToggleCommand: NSScriptCommand {
    override func performDefaultImplementation() -> Any? {
        DispatchQueue.main.async { MainActor.assumeIsolated { AppDelegate.current?.toggleNotch() } }
        return nil
    }
}
