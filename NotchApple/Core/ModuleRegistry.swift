//
//  ModuleRegistry.swift
//  Notch apple
//
//  Owns the optional feature modules (Lid Fold, Cleaner). Keeps the lifecycle in one place: every running
//  module is stopped before sleep, on a display change and at quit, and the ones that were running are
//  started again afterwards. A module that is off costs nothing: it is not even started.
//

import AppKit
import NotchKit

@MainActor
final class ModuleRegistry: ObservableObject {
    static let shared = ModuleRegistry()

    @Published private(set) var modules: [FeatureModule] = []
    private var runningBeforeSleep: [String] = []
    private var tokens: [NSObjectProtocol] = []

    private init() {
        let ws = NSWorkspace.shared.notificationCenter
        tokens.append(ws.addObserver(forName: NSWorkspace.willSleepNotification, object: nil, queue: .main) { [weak self] _ in
            MainActor.assumeIsolated { self?.suspendAll() }
        })
        tokens.append(ws.addObserver(forName: NSWorkspace.didWakeNotification, object: nil, queue: .main) { [weak self] _ in
            MainActor.assumeIsolated { self?.resumeAll() }
        })
        tokens.append(NotificationCenter.default.addObserver(forName: NSApplication.didChangeScreenParametersNotification, object: nil, queue: .main) { [weak self] _ in
            // Displays came or went: drop everything tied to the old layout and start fresh.
            MainActor.assumeIsolated { self?.suspendAll(); self?.resumeAll() }
        })
        tokens.append(NotificationCenter.default.addObserver(forName: NSApplication.willTerminateNotification, object: nil, queue: .main) { [weak self] _ in
            MainActor.assumeIsolated { self?.stopAll() }
        })
    }

    func register(_ module: FeatureModule) {
        guard !modules.contains(where: { $0.id == module.id }) else { return }
        modules.append(module)
    }

    func module(id: String) -> FeatureModule? { modules.first { $0.id == id } }

    /// Every permission any registered module can use, in a stable order.
    var requestedPermissions: [ModulePermission] {
        ModulePermission.allCases.filter { p in modules.contains { $0.permissions.contains(p) } }
    }

    func stopAll() {
        for m in modules where m.isRunning { m.stop() }
        runningBeforeSleep = []
    }

    private func suspendAll() {
        runningBeforeSleep = modules.filter(\.isRunning).map(\.id)
        for m in modules where m.isRunning { m.stop() }
    }

    private func resumeAll() {
        for id in runningBeforeSleep { module(id: id)?.start() }
        runningBeforeSleep = []
    }
}

/// Live permission state for the modules. Screen Recording reuses the app's existing check.
@MainActor
enum ModulePermissionState {
    static func status(_ p: ModulePermission) -> PermissionStatus {
        switch p {
        case .screenRecording:
            return ScreenPermission.isGranted ? .granted : .denied
        case .fullDiskAccess:
            return hasFullDiskAccess ? .granted : .denied
        }
    }

    /// There is no API for Full Disk Access, so this tries to read a folder only it unlocks.
    /// (Reading a TCC-protected folder is the standard check and prompts nothing.)
    static var hasFullDiskAccess: Bool {
        let probe = NSHomeDirectory() + "/Library/Safari"
        return (try? FileManager.default.contentsOfDirectory(atPath: probe)) != nil
    }

    static func open(_ p: ModulePermission) { NSWorkspace.shared.open(p.settingsURL) }
}
