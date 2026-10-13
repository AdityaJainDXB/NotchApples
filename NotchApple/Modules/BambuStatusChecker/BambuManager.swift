//
//  BambuManager.swift
//  Notch Apple
//
//  Bambu Lab: one live snapshot per configured printer. Each printer runs its own
//  BambuMQTT client on a private queue (the printer's LAN reports on port 8883);
//  every event hops to the main actor here, so the module can publish and no
//  network work ever happens on the main thread. Failures (bad credentials, the
//  printer being off or on another network) land in `failures` and retry on a
//  timer instead of spinning, and nothing here can crash the notch: a broken
//  printer just shows as Offline with a plain-language line.
//
//  One printer is free; more than one needs Pro (Feature.bambuMulti).
//

import AppKit
import Combine
import Foundation
import SwiftUI

/// A printer as the user typed it. Credentials live in UserDefaults (the access
/// code is not a secret beyond "who is on your Wi-Fi"; the printer's own LAN
/// mode hands it out on its screen).
struct BambuPrinterConfig: Codable, Identifiable, Hashable {
    var id = UUID()
    var name = ""
    var host = ""          // IP or hostname, e.g. 192.168.1.50
    var accessCode = ""
    var serial = ""
    /// SHA-256 of the certificate the printer showed the first time (trust on first use); nil until it connects.
    var certPin: String?

    var displayName: String { name.isEmpty ? (host.isEmpty ? "My Printer" : host) : name }
}

@MainActor
final class BambuManager: ObservableObject {
    static let shared = BambuManager()

    /// How many printers come with the free app; the rest need Pro.
    static let freePrinters = 1

    /// The whole tab stops polling: no printer is contacted.
    @AppStorage("bambu.enabled") var enabled = false
    /// How often a dropped connection is retried. Bambu printers only speak when
    /// something changes, so a steady connection is the telemetry feed.
    private static let retryAfter: TimeInterval = 12

    @Published private(set) var printers: [BambuPrinterConfig] = []
    /// The latest merged report per printer; `.offline` until one arrives.
    @Published private(set) var snapshots: [UUID: BambuSnapshot] = [:]
    /// Why a printer is offline (timeout, refused access code), when known.
    @Published private(set) var failures: [UUID: String] = [:]
    /// Printers mid-connect, so the view can show a spinner instead of a stale phase.
    @Published private(set) var connecting: Set<UUID> = []
    @Published var selectedPrinterID: UUID?
    /// A printer running too hot, by printer: the notch glows red while this is set.
    @Published private(set) var thermalAlerts: [UUID: BambuStatusLogic.ThermalAlert] = [:]

    /// A soft sound and a haptic tap when a print pauses, finishes or fails.
    @AppStorage("bambu.sounds") var soundsEnabled = true
    /// The red glow and notification when a heater is over its limit or the hotend is creeping hot.
    @AppStorage("bambu.thermalAlerts") var thermalAlertsEnabled = true

    private var clients: [UUID: BambuMQTT] = [:]
    private var retryTasks: [UUID: Task<Void, Never>] = [:]
    private let store = UserDefaults.standard

    init() {
        if let data = store.data(forKey: "bambu.printers"),
           let saved = try? JSONDecoder().decode([BambuPrinterConfig].self, from: data), !saved.isEmpty {
            printers = saved
        }
        selectedPrinterID = printers.first?.id
        if enabled && !printers.isEmpty { start() }
    }

    // MARK: - Configuration

    func save() {
        store.set(try? JSONEncoder().encode(printers), forKey: "bambu.printers")
    }

    /// True when another printer can be added (the first one is free, more need Pro).
    var canAddPrinter: Bool {
        printers.count < Self.freePrinters || Entitlements.shared.canUse(.bambuMulti)
    }

    /// Adds a printer and starts watching it. Returns nil on success, or the
    /// reason it wasn't added (missing fields, or the Pro wall for more printers).
    @discardableResult
    func addPrinter(name: String, host: String, accessCode: String, serial: String) -> String? {
        let trimmed = BambuPrinterConfig(name: name.trimmingCharacters(in: .whitespaces),
                                        host: host.trimmingCharacters(in: .whitespaces),
                                        accessCode: accessCode.trimmingCharacters(in: .whitespaces),
                                        serial: serial.trimmingCharacters(in: .whitespaces))
        if let problem = Self.validate(trimmed) { return problem }
        guard canAddPrinter else { return "Another printer needs Notch Apple Pro (\(Feature.bambuMulti.title))." }
        printers.append(trimmed)
        save()
        if selectedPrinterID == nil { selectedPrinterID = trimmed.id }
        connect(trimmed)
        return nil
    }

    /// Saves an edit (IP, code, serial) and reconnects the printer.
    func update(_ config: BambuPrinterConfig) {
        guard let i = printers.firstIndex(where: { $0.id == config.id }) else { return }
        // A different address or serial is a different printer, so the old certificate no longer applies.
        var next = config
        if printers[i].host != config.host || printers[i].serial != config.serial { next.certPin = nil }
        printers[i] = next
        save()
        if selectedPrinterID == nil { selectedPrinterID = config.id }
        connect(config)
    }

    /// Saves one edited field without reconnecting (the settings fields use this
    /// on every keystroke; Reconnect starts a fresh session once the user asks).
    func setField(_ id: UUID, _ keyPath: WritableKeyPath<BambuPrinterConfig, String>, _ value: String) {
        guard let i = printers.firstIndex(where: { $0.id == id }) else { return }
        printers[i][keyPath: keyPath] = value
        if keyPath == \.host || keyPath == \.serial { printers[i].certPin = nil }
        save()
    }

    func remove(id: UUID) {
        printers.removeAll { $0.id == id }
        snapshots[id] = nil
        failures[id] = nil
        thermalAlerts[id] = nil
        retryTasks.removeValue(forKey: id)?.cancel()
        clients.removeValue(forKey: id)?.stop()
        if selectedPrinterID == id { selectedPrinterID = printers.first?.id }
        save()
    }

    /// The stored field, or the matching environment variable when it's empty
    /// (BAMBU_IP / BAMBU_PRINTER_IP, BAMBU_ACCESS_CODE, BAMBU_SERIAL).
    func resolved(_ p: BambuPrinterConfig) -> BambuPrinterConfig {
        let r = BambuStatusLogic.resolved(ip: p.host, accessCode: p.accessCode, serial: p.serial)
        return BambuPrinterConfig(id: p.id, name: p.name, host: r.ip, accessCode: r.accessCode, serial: r.serial, certPin: p.certPin)
    }

    /// A plain-language problem with the credentials, or nil when they are usable.
    static func validate(_ p: BambuPrinterConfig) -> String? {
        let r = BambuStatusLogic.resolved(ip: p.host, accessCode: p.accessCode, serial: p.serial)
        if BambuStatusLogic.normalizeHost(r.ip) == nil {
            return r.ip.isEmpty ? "Add the printer's IP address or hostname." : "“\(r.ip)” doesn’t look like an IP address or hostname."
        }
        if r.accessCode.isEmpty { return "Add the access code from the printer's screen (Settings → LAN)." }
        if BambuStatusLogic.normalizeSerial(r.serial) == nil {
            return r.serial.isEmpty ? "Add the printer's serial number." : "“\(r.serial)” doesn’t look like a Bambu serial number."
        }
        return nil
    }

    // MARK: - Connections

    /// Monitoring on: connect every printer. Off: nothing is contacted.
    func start() {
        enabled = true
        for p in printers { connect(p) }
    }

    func stop() {
        enabled = false
        for (id, task) in retryTasks { task.cancel(); retryTasks.removeValue(forKey: id) }
        for (id, client) in clients {
            snapshots[id] = BambuStatusLogic.offline(message: nil)
            clients.removeValue(forKey: id)?.stop()
        }
        connecting.removeAll()
    }

    /// Forgets the remembered certificate (after a firmware update or reset) and reconnects, which remembers the new one.
    func trustNewCertificate(id: UUID) {
        guard let i = printers.firstIndex(where: { $0.id == id }) else { return }
        printers[i].certPin = nil
        save()
        connect(printers[i])
    }

    /// Drops the printer's session and starts a fresh one (used after editing it).
    func reconnect(id: UUID) {
        guard let p = printers.first(where: { $0.id == id }) else { return }
        connect(p)
    }

    private func connect(_ stored: BambuPrinterConfig) {
        let p = resolved(stored)
        retryTasks.removeValue(forKey: p.id)?.cancel()
        clients.removeValue(forKey: p.id)?.stop()
        guard enabled else { return }

        // Missing or nonsense credentials must never reach the network layer.
        if let problem = Self.validate(stored) {
            snapshots[p.id] = BambuStatusLogic.offline(message: problem)
            failures[p.id] = problem
            connecting.remove(p.id)
            return
        }
        guard let creds = BambuStatusLogic.credentials(ip: p.host, accessCode: p.accessCode, serial: p.serial) else {
            failures[p.id] = "These printer details can’t be used. Check them in Settings → Bambu Lab."
            return
        }

        connecting.insert(p.id)
        let id = p.id
        let client = BambuMQTT()
        clients[id] = client
        client.start(host: creds.host,
                     password: creds.code,
                     topic: BambuStatusLogic.reportTopic(serial: creds.serial),
                     pin: p.certPin) { [weak self] event in
            Task { @MainActor in self?.handle(event, for: id) }
        }
    }

    private func handle(_ event: BambuMQTT.Event, for id: UUID) {
        switch event {
        case .connected:
            connecting.remove(id)
            failures[id] = nil
            // No report yet: the printer is reachable, so show Idle rather than Offline.
            if snapshots[id] == nil || snapshots[id]?.phase == .offline {
                snapshots[id] = BambuSnapshot(phase: .idle)
            }

        case .pinned(let fingerprint):
            if let i = printers.firstIndex(where: { $0.id == id }), printers[i].certPin == nil {
                printers[i].certPin = fingerprint
                save()
            }

        case .payload(let data):
            connecting.remove(id)
            failures[id] = nil
            let current = snapshots[id] ?? BambuSnapshot(phase: .idle)
            let next = BambuStatusLogic.apply(data, onto: current, connected: true)
            snapshots[id] = next
            react(from: current, to: next, id: id)

        case .failed(let message):
            connecting.remove(id)
            let off = BambuStatusLogic.offline(message: message)
            snapshots[id] = off
            failures[id] = message
            clients[id]?.stop()
            clients[id] = nil
            scheduleRetry(id)

        case .disconnected:
            connecting.remove(id)
            clients[id]?.stop()
            clients[id] = nil
            if snapshots[id] != nil, snapshots[id]?.phase != .offline {
                snapshots[id] = BambuStatusLogic.offline(message: "Lost connection to the printer. Retrying…")
                failures[id] = "Lost connection to the printer. Retrying…"
            }
            scheduleRetry(id)
        }
    }

    /// Retry after a pause, but only while monitoring is on: a printer that is off
    /// for the evening shouldn't be hammered in a loop.
    private func scheduleRetry(_ id: UUID) {
        retryTasks[id]?.cancel()
        guard enabled, printers.contains(where: { $0.id == id }) else { return }
        retryTasks[id] = Task { @MainActor [weak self] in
            try? await Task.sleep(nanoseconds: UInt64(Self.retryAfter * 1_000_000_000))
            guard !Task.isCancelled, let self, self.enabled,
                  let p = self.printers.first(where: { $0.id == id }) else { return }
            self.connect(p)
        }
    }

    // MARK: - Alerts

    private func react(from old: BambuSnapshot, to new: BambuSnapshot, id: UUID) {
        let name = printers.first(where: { $0.id == id })?.displayName ?? "Printer"

        let alert = thermalAlertsEnabled ? BambuStatusLogic.thermalAlert(previous: old, current: new) : nil
        if alert != thermalAlerts[id] {
            thermalAlerts[id] = alert
            if let alert {
                Notifier.post(title: "\(name) is running hot", body: alert.message)
                feedback(sound: "Basso")
            }
            LiveActivityCenter.shared.recompute()
        }

        guard let event = BambuStatusLogic.event(from: old, to: new) else {
            if old.phase != new.phase || old.progress != new.progress { LiveActivityCenter.shared.recompute() }
            return
        }
        switch event {
        case .paused:
            feedback(sound: "Tink")
            LiveActivityCenter.shared.flash(LiveActivity(symbol: "pause.circle.fill", label: "Paused", tint: .systemYellow), seconds: 6)
        case .finished:
            feedback(sound: "Glass")
            Notifier.post(title: "\(name): print finished", body: new.filename.isEmpty ? "Your print is done." : "\(new.filename) is done.")
            LiveActivityCenter.shared.flash(LiveActivity(symbol: "checkmark.circle.fill", label: "Print done", tint: .systemGreen), seconds: 8)
        case .failed:
            feedback(sound: "Basso")
            Notifier.post(title: "\(name): print failed", body: new.filename.isEmpty ? "The print stopped with an error." : "\(new.filename) stopped with an error.")
            LiveActivityCenter.shared.flash(LiveActivity(symbol: "exclamationmark.triangle.fill", label: "Print failed", tint: .systemRed), seconds: 8)
        }
    }

    private func feedback(sound: String) {
        guard soundsEnabled else { return }
        NSSound(named: NSSound.Name(sound))?.play()
        NSHapticFeedbackManager.defaultPerformer.perform(.levelChange, performanceTime: .now)
    }

    /// What the closed notch shows while a print is running: the colour of its state and the progress, or a red
    /// breathing glow when something is running too hot. Nothing while every printer is idle or offline.
    var liveActivity: LiveActivity? {
        guard enabled else { return nil }
        if let (_, alert) = thermalAlerts.first {
            return LiveActivity(symbol: "thermometer.high", label: {
                switch alert { case .nozzleHot(let t), .bedHot(let t), .heatCreep(let t): return "\(t)°"
                               case .nozzleOvershoot(let t), .bedOvershoot(let t): return "+\(t)°" }
            }(), tint: .systemRed, pulse: true)
        }
        let live = printers.compactMap { p in snapshots[p.id].map { (p, $0) } }.filter { $0.1.isActive }
        guard let (_, snap) = live.first(where: { $0.1.phase == .printing }) ?? live.first else { return nil }
        let tint = NSColor(Color(hex: snap.phase.hex))
        return LiveActivity(symbol: "printer.fill", label: snap.phase == .paused ? "Paused" : BambuStatusLogic.liveLabel(snap), tint: tint)
    }

    // MARK: - Reading

    var selectedPrinter: BambuPrinterConfig? {
        printers.first(where: { $0.id == selectedPrinterID }) ?? printers.first
    }

    func snapshot(for id: UUID?) -> BambuSnapshot {
        guard let id, let s = snapshots[id] else {
            return selectedPrinter == nil ? BambuStatusLogic.offline(message: nil) : BambuSnapshot(phase: .idle)
        }
        return s
    }

    func failure(for id: UUID?) -> String? {
        guard let id else { return nil }
        return failures[id]
    }

    func isConnecting(_ id: UUID?) -> Bool {
        guard let id else { return false }
        return connecting.contains(id)
    }
}
