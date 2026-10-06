//
//  FeatureModule.swift
//  Notch apple
//
//  What every optional feature module (Lid Fold, Cleaner) exposes to the app. Modules are separate
//  packages with no dependency on each other; the app owns the registry and the notch arbiter.
//

import Foundation

/// Permissions a module may want. Each one is optional: a module must still work, in a limited way, without it.
public enum ModulePermission: String, CaseIterable, Codable, Sendable {
    case screenRecording
    case fullDiskAccess

    public var title: String {
        switch self {
        case .screenRecording: return "Screen Recording"
        case .fullDiskAccess: return "Full Disk Access"
        }
    }

    /// Plain-English reason, shown next to the switch.
    public var explanation: String {
        switch self {
        case .screenRecording:
            return "Lets Lid Fold take one snapshot of your desktop to fold. It never records video or audio and nothing leaves your Mac. Without it, previews still work using a plain backdrop."
        case .fullDiskAccess:
            return "Lets the Cleaner look inside protected folders such as Mail and Safari caches. Without it, the Cleaner only sees folders your account can already open, and says what it could not check."
        }
    }

    /// The System Settings pane where the switch lives.
    public var settingsURL: URL {
        let anchor = self == .screenRecording ? "Privacy_ScreenCapture" : "Privacy_AllFiles"
        return URL(string: "x-apple.systempreferences:com.apple.preference.security?\(anchor)")!
    }
}

public enum PermissionStatus: String, Codable, Sendable {
    case granted, denied, notDetermined

    /// "Limited mode" is whatever a module does while its permission is not granted.
    public var isLimited: Bool { self != .granted }
}

/// A feature the app can turn on and off. `start()` must be cheap and `stop()` must release everything
/// (timers, capture sessions, windows) so a disabled module costs nothing.
@MainActor
public protocol FeatureModule: AnyObject {
    var id: String { get }
    var name: String { get }
    /// Permissions this module can use. The hub shows exactly these, nothing more.
    var permissions: [ModulePermission] { get }
    var isRunning: Bool { get }

    func start()
    /// Idempotent. Also called on sleep, display change and quit.
    func stop()
}
