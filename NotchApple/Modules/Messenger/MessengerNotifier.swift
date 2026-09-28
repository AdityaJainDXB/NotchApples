//
//  MessengerNotifier.swift
//  Notch apple
//
//  Lets you know when someone messages you:
//   • a macOS notification (sender, text, and where it came from), unless
//     you're already looking at Messenger,
//   • an unread count, shown as a purple dot on the closed notch and on the
//     Messenger tab,
//   • clicking the notification opens the notch straight to Messenger.
//

import Foundation
import UserNotifications
import SwiftUI

@MainActor
final class MessengerNotifier: NSObject, ObservableObject {
    static let shared = MessengerNotifier()

    @AppStorage("messenger.notify") var notificationsEnabled = true
    @AppStorage("messenger.notifyPreview") var showPreview = true

    @Published private(set) var unread = 0 {
        didSet { onUnreadChange(unread) }
    }

    /// Wired up by the notch window controller.
    var isMessengerVisible: () -> Bool = { false }
    var openMessenger: () -> Void = {}
    var onUnreadChange: (Int) -> Void = { _ in }

    private var center: UNUserNotificationCenter { .current() }

    func start() {
        center.delegate = self
    }

    /// Asks for notification permission the first time it's needed.
    func requestAuthorizationIfNeeded() {
        guard notificationsEnabled else { return }
        center.getNotificationSettings { settings in
            guard settings.authorizationStatus == .notDetermined else { return }
            UNUserNotificationCenter.current().requestAuthorization(options: [.alert, .sound, .badge]) { _, _ in }
        }
    }

    /// Called by both chat engines for every message from someone else.
    func incoming(_ message: MessengerMessage, source: String) {
        guard !message.isMine, !message.isNotice else { return }
        if isMessengerVisible() { return }
        unread += 1
        guard notificationsEnabled else { return }

        let content = UNMutableNotificationContent()
        content.title = message.sender
        content.subtitle = source
        content.body = showPreview ? message.text : "New message"
        content.sound = .default
        content.threadIdentifier = "messenger.\(source)"
        let request = UNNotificationRequest(identifier: message.id.uuidString, content: content, trigger: nil)
        center.add(request)
    }

    /// Called when Messenger becomes visible.
    func markAllRead() {
        guard unread > 0 else { return }
        unread = 0
        center.removeAllDeliveredNotifications()
    }
}

extension MessengerNotifier: UNUserNotificationCenterDelegate {
    /// Show banners even while Notch apple is the active app.
    nonisolated func userNotificationCenter(_ center: UNUserNotificationCenter, willPresent notification: UNNotification,
                                            withCompletionHandler completionHandler: @escaping (UNNotificationPresentationOptions) -> Void) {
        completionHandler([.banner, .sound, .list])
    }

    /// Clicking a notification opens the notch on Messenger.
    nonisolated func userNotificationCenter(_ center: UNUserNotificationCenter, didReceive response: UNNotificationResponse,
                                            withCompletionHandler completionHandler: @escaping () -> Void) {
        Task { @MainActor in
            self.openMessenger()
            completionHandler()
        }
    }
}
