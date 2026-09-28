//
//  NotchAppleApp.swift
//  Notch apple
//
//  App entry point. Notch apple is an agent app (LSUIElement = YES): no Dock
//  icon, no main window. The notch panel and status item are owned by
//  `AppDelegate`; SwiftUI only provides the Settings scene.
//

import SwiftUI

@main
struct NotchAppleApp: App {
    @NSApplicationDelegateAdaptor(AppDelegate.self) private var appDelegate

    var body: some Scene {
        Settings {
            SettingsView()
                .environmentObject(SettingsManager.shared)
        }
    }
}
