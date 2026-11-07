//
//  MessengerNotifier.swift
//  Notch Apple
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

    /// Everything unread: the nearby and room chats plus Friends. The dot on the notch and on the tab follow this.
    @Published private(set) var unread = 0 {
        didSet { onUnreadChange(unread) }
    }
    private var chatUnread = 0
    private var friendsUnread = 0

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
        chatUnread += 1; unread = chatUnread + friendsUnread
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
        guard chatUnread > 0 else { return }
        chatUnread = 0; unread = friendsUnread
        center.removeAllDeliveredNotifications()
    }

    // MARK: Friends

    /// Friends keeps its own per-friend counts; this is their sum, so the notch's dot and the tab's badge include them.
    func setFriendsUnread(_ n: Int) { friendsUnread = n; unread = chatUnread + friendsUnread }

    /// A message from a friend whose chat isn't open. Quiet while a Focus is on (the unread dot still shows).
    func friendMessage(from name: String, box: String, text: String, id: String) {
        guard notificationsEnabled, !FocusBridge.hushes else { return }
        let content = UNMutableNotificationContent()
        content.title = name
        content.subtitle = "Friends"
        content.body = showPreview ? text : "New message"
        content.sound = .default
        content.threadIdentifier = "messenger.friend.\(box)"
        center.add(UNNotificationRequest(identifier: id, content: content, trigger: nil))
    }

    /// "Clear chat": takes back the banners and Notification Centre entries already shown for one friend chat (a friend's box or a group key).
    func removeFriendNotifications(chat key: String) {
        let thread = "messenger.friend.\(key)"
        UNUserNotificationCenter.current().getDeliveredNotifications { delivered in
            let ids = delivered.filter { $0.request.content.threadIdentifier == thread }.map { $0.request.identifier }
            if !ids.isEmpty { UNUserNotificationCenter.current().removeDeliveredNotifications(withIdentifiers: ids) }
        }
    }

    /// A friend request or an accepted request.
    func friendEvent(title: String, body: String, id: String) {
        guard notificationsEnabled, !FocusBridge.hushes else { return }
        let content = UNMutableNotificationContent()
        content.title = title
        content.subtitle = "Friends"
        content.body = body
        content.sound = .default
        content.threadIdentifier = "messenger.friends"
        center.add(UNNotificationRequest(identifier: id, content: content, trigger: nil))
    }
}

extension MessengerNotifier: UNUserNotificationCenterDelegate {
    /// Show banners even while Notch Apple is the active app.
    nonisolated func userNotificationCenter(_ center: UNUserNotificationCenter, willPresent notification: UNNotification,
                                            withCompletionHandler completionHandler: @escaping (UNNotificationPresentationOptions) -> Void) {
        completionHandler([.banner, .sound, .list])
    }

    /// Clicking a notification opens the notch on Messenger.
    nonisolated func userNotificationCenter(_ center: UNUserNotificationCenter, didReceive response: UNNotificationResponse,
                                            withCompletionHandler completionHandler: @escaping () -> Void) {
        let isUpdate = response.notification.request.content.categoryIdentifier == UpdateChecker.notificationCategory
        Task { @MainActor in
            if isUpdate { AppDelegate.openSettingsWindow(tab: .updates) } else { self.openMessenger() }
            completionHandler()
        }
    }
}
