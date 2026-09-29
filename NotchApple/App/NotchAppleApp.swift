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

    init() { SettingsManager.registerDefaults() }

    var body: some Scene {
        // Settings live in `SettingsWindowController`; this empty scene only
        // satisfies SwiftUI's requirement that an App declares a Scene.
        Settings { EmptyView() }
    }
}
