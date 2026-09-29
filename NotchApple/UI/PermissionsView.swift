//
//  PermissionsView.swift
//  Notch apple
//
//  One place to see and grant everything Notch apple can use. Shown
//  automatically on first launch (Settings → Permissions), and any time after.
//  Each row explains why the permission is useful; nothing is required.
//

import SwiftUI
import ServiceManagement
import UserNotifications
import EventKit
import AVFoundation
import CoreLocation

@MainActor
final class PermissionsModel: ObservableObject {
    static let shared = PermissionsModel()

    @Published var loginItem = SMAppService.mainApp.status
    @Published var notifications: UNAuthorizationStatus = .notDetermined
    @Published var calendar = EKEventStore.authorizationStatus(for: .event)
    @Published var camera = AVCaptureDevice.authorizationStatus(for: .video)

    func refresh() {
        loginItem = SMAppService.mainApp.status
        calendar = EKEventStore.authorizationStatus(for: .event)
        camera = AVCaptureDevice.authorizationStatus(for: .video)
        UNUserNotificationCenter.current().getNotificationSettings { s in
            Task { @MainActor in self.notifications = s.authorizationStatus }
        }
    }

    // MARK: Actions

    /// Registers as a login item. macOS may then ask you to approve it
    /// ("Allow in the Background") in System Settings → General → Login Items.
    func enableLoginItem() {
        try? SMAppService.mainApp.register()
        refresh()
        if SMAppService.mainApp.status == .requiresApproval { SMAppService.openSystemSettingsLoginItems() }
    }

    func disableLoginItem() {
        try? SMAppService.mainApp.unregister()
        refresh()
    }

    /// Menu-bar apps must be frontmost for macOS to show a permission prompt.
    private func bringToFront() { NSApp.activate(ignoringOtherApps: true) }

    /// If macOS didn't show a prompt (e.g. it was answered before), open the
    /// right System Settings page so the switch can be turned on there.
    private func fallback(after seconds: Double = 2.5, stillUndecided: @escaping @MainActor () -> Bool, anchor: String) {
        DispatchQueue.main.asyncAfter(deadline: .now() + seconds) {
            MainActor.assumeIsolated {
                self.refresh()
                if stillUndecided() { Self.openPrivacy(anchor) }
            }
        }
    }

    func requestNotifications() {
        bringToFront()
        UNUserNotificationCenter.current().requestAuthorization(options: [.alert, .sound, .badge]) { _, _ in
            Task { @MainActor in self.refresh() }
        }
    }

    func requestCalendar() {
        bringToFront()
        fallback(after: 4, stillUndecided: { EKEventStore.authorizationStatus(for: .event) != .fullAccess }, anchor: "Privacy_Calendars")
        Task {
            _ = try? await EKEventStore().requestFullAccessToEvents()
            refresh()
            TodayModel.shared.refresh()
        }
    }

    func requestCamera() {
        bringToFront()
        fallback(after: 4, stillUndecided: { AVCaptureDevice.authorizationStatus(for: .video) == .notDetermined }, anchor: "Privacy_Camera")
        AVCaptureDevice.requestAccess(for: .video) { _ in Task { @MainActor in self.refresh() } }
    }

    static func openPrivacy(_ anchor: String) {
        NSWorkspace.shared.open(URL(string: "x-apple.systempreferences:com.apple.preference.security?\(anchor)")!)
    }
}

struct PermissionsView: View {
    @StateObject private var model = PermissionsModel.shared
    @StateObject private var location = LocationProvider.shared
    var showsWelcome = false

    private let poll = Timer.publish(every: 2, on: .main, in: .common).autoconnect()

    var body: some View {
        Form {
            if showsWelcome {
                Section {
                    HStack(spacing: 14) {
                        Image(nsImage: NSApp.applicationIconImage).resizable().frame(width: 56, height: 56)
                        VStack(alignment: .leading, spacing: 4) {
                            Text("Welcome to Notch apple").font(.title2.bold())
                            Text("Click the notch or press ⌘E to open it. Turn on what you'd like below; everything is optional and can be changed later.")
                                .font(.callout).foregroundStyle(.secondary)
                        }
                    }
                    .padding(.vertical, 6)
                }
            }

            Section {
                row("Open at login", "power", .green,
                    detail: "Starts Notch apple when you log in and lets it run in the background, so the notch, clipboard and messages are always ready.",
                    state: loginState) {
                    switch model.loginItem {
                    case .enabled: Button("Turn off", action: model.disableLoginItem)
                    case .requiresApproval: Button("Approve in Login Items…") { SMAppService.openSystemSettingsLoginItems() }
                    default: Button("Turn on", action: model.enableLoginItem).buttonStyle(.borderedProminent)
                    }
                }
            } header: { Text("Background") }

            Section {
                row("Notifications", "bell.badge.fill", .red,
                    detail: "Messages and focus timer alerts.", state: grantState(model.notifications == .authorized,
                                                                                   denied: model.notifications == .denied)) {
                    switch model.notifications {
                    case .notDetermined: Button("Allow", action: model.requestNotifications).buttonStyle(.borderedProminent)
                    case .denied: Button("Open Settings…") { NSWorkspace.shared.open(URL(string: "x-apple.systempreferences:com.apple.Notifications-Settings.extension")!) }
                    default: EmptyView()
                    }
                }
                row("Location", "location.fill", .blue,
                    detail: "Local weather in Today and the widget. Approximate location only.",
                    state: grantState(location.isAuthorized, denied: location.status == .denied || location.status == .restricted)) {
                    switch location.status {
                    case .notDetermined: Button("Allow") { location.useCurrentLocation = true; location.requestLocation() }.buttonStyle(.borderedProminent)
                    case .denied, .restricted: Button("Open Settings…", action: location.openSystemSettings)
                    default: EmptyView()
                    }
                }
                row("Calendars", "calendar", .orange,
                    detail: "Your next events in Today and the widget.",
                    state: grantState(model.calendar == .fullAccess, denied: model.calendar == .denied || model.calendar == .restricted)) {
                    switch model.calendar {
                    case .notDetermined: Button("Allow", action: model.requestCalendar).buttonStyle(.borderedProminent)
                    case .fullAccess: EmptyView()
                    default: Button("Open Settings…") { PermissionsModel.openPrivacy("Privacy_Calendars") }
                    }
                }
                row("Camera", "camera.fill", .gray,
                    detail: "Only for face unlock. Optional.",
                    state: grantState(model.camera == .authorized, denied: model.camera == .denied || model.camera == .restricted)) {
                    switch model.camera {
                    case .notDetermined: Button("Allow", action: model.requestCamera)
                    case .denied, .restricted: Button("Open Settings…") { PermissionsModel.openPrivacy("Privacy_Camera") }
                    default: EmptyView()
                    }
                }
            } header: {
                Text("Features")
            } footer: {
                Text("Screen recording (Claude → Share Screen), local network (PairDrop, Messenger) and system audio (per-app volume) are asked for the first time you use those features.")
            }
        }
        .formStyle(.grouped)
        .onReceive(poll) { _ in model.refresh(); location.refreshStatus() }
        .onReceive(NotificationCenter.default.publisher(for: NSApplication.didBecomeActiveNotification)) { _ in
            model.refresh(); location.refreshStatus()
        }
        .onAppear(perform: model.refresh)
        // Pick up changes made in System Settings when the user comes back.
        .onReceive(NotificationCenter.default.publisher(for: NSApplication.didBecomeActiveNotification)) { _ in model.refresh() }
    }

    // MARK: Row helpers

    private enum RowState { case granted, denied, notSet, pending }

    private var loginState: RowState {
        switch model.loginItem {
        case .enabled: .granted
        case .requiresApproval: .pending
        default: .notSet
        }
    }

    private func grantState(_ granted: Bool, denied: Bool) -> RowState {
        granted ? .granted : (denied ? .denied : .notSet)
    }

    private func row<Action: View>(_ title: String, _ symbol: String, _ tint: Color, detail: String, state: RowState,
                                   @ViewBuilder action: () -> Action) -> some View {
        HStack(spacing: 12) {
            Image(systemName: symbol)
                .font(.system(size: 13, weight: .semibold)).foregroundStyle(.white)
                .frame(width: 28, height: 28)
                .background(tint.gradient, in: RoundedRectangle(cornerRadius: 7, style: .continuous))
            VStack(alignment: .leading, spacing: 2) {
                HStack(spacing: 6) {
                    Text(title)
                    switch state {
                    case .granted: Image(systemName: "checkmark.circle.fill").foregroundStyle(.green).accessibilityLabel("On")
                    case .denied: Image(systemName: "xmark.circle.fill").foregroundStyle(.red).accessibilityLabel("Denied")
                    case .pending: Text("Needs approval").font(.caption).foregroundStyle(.orange)
                    case .notSet: EmptyView()
                    }
                }
                Text(detail).font(.callout).foregroundStyle(.secondary)
            }
            Spacer()
            action()
        }
    }
}
