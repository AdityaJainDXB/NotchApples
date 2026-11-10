//
//  StatusPulse.swift
//  Notch Apple
//
//  The status pulse: the closed notch glows green (done or good), amber (needs you soon) or red (failed or urgent) for the things you
//  switched on in Settings → Notch → Status pulse, so you know without opening it. Each source has its own switch; only Battery,
//  Event starting soon and your own scripts start on. A glow fades after about 10 seconds or when you click the notch (red
//  can stay until you look), a source glows at most once every three minutes, and quiet hours and Reduce Motion are respected.
//  Everything it checks is on this Mac; nothing is sent anywhere. The rules are in StatusPulseLogic.swift.
//

import AppKit
import Combine
import CoreAudio
import CoreMediaIO
import EventKit
import SwiftUI

@MainActor
final class StatusPulse: ObservableObject {
    static let shared = StatusPulse()
    typealias L = StatusPulseLogic

    struct Active: Equatable {
        let id = UUID()
        let color: L.Color
        let message: String
        let source: String
    }

    @Published private(set) var current: Active?

    @AppStorage("pulse.enabled") var enabled = true
    @AppStorage("pulse.redStays") var redStays = true
    @AppStorage("pulse.quiet") var quietOn = false
    @AppStorage("pulse.quietFrom") var quietFrom = 22
    @AppStorage("pulse.quietTo") var quietTo = 7

    private var lastFired: [String: Date] = [:]
    private var expiry: Timer?
    private var timer: Timer?
    private var tick = 0
    private var cancellables = Set<AnyCancellable>()

    // State the monitors keep so a glow fires on a change, not on every look.
    private var lastBattery: L.Pulse?
    private var diskWasLow = false
    private var announcedUpdate: String?
    private var announcedEvents = Set<String>()
    private var cameraWasOn = false
    private var micWasOn = false
    private var wrongCodes = 0
    private var workingSeconds = 0.0
    private var shelfAnnouncedOn: Date?
    private var downloadPartials = Set<String>()

    // MARK: Switches

    func isOn(_ id: String) -> Bool {
        UserDefaults.standard.object(forKey: "pulse.src." + id) as? Bool ?? (L.source(id)?.defaultOn ?? false)
    }

    func setOn(_ id: String, _ on: Bool) {
        objectWillChange.send()
        UserDefaults.standard.set(on, forKey: "pulse.src." + id)
    }

    // MARK: Glowing

    /// Makes the notch glow for `source`, if the pulse and that source are on, it isn't quiet time, and the source hasn't just glowed.
    func fire(_ source: String, _ color: L.Color, _ message: String) {
        guard enabled, isOn(source), L.source(source)?.available == true else { return }
        if quietOn, L.isQuiet(hour: Calendar.current.component(.hour, from: .now), from: quietFrom, to: quietTo) { return }
        guard L.allowed(lastFired: lastFired[source], now: .now) else { return }
        lastFired[source] = .now
        show(color, message, source: source)
    }

    /// Settings → "Try it": always glows, so you can see what a colour looks like.
    func preview(_ color: L.Color) {
        show(color, "This is what \(color.rawValue) looks like", source: "preview")
    }

    private func show(_ color: L.Color, _ message: String, source: String) {
        current = Active(color: color, message: message, source: source)
        expiry?.invalidate()
        if let seconds = L.duration(color, redStays: redStays) {
            expiry = Timer.scheduledTimer(withTimeInterval: seconds, repeats: false) { [weak self] _ in MainActor.assumeIsolated { self?.dismiss() } }
        }
    }

    /// Hover, click or open: the glow has done its job.
    func dismiss() {
        expiry?.invalidate()
        if current != nil { current = nil }
    }

    // MARK: Watching

    func start() {
        guard timer == nil else { return }
        timer = Timer.scheduledTimer(withTimeInterval: 5, repeats: true) { [weak self] _ in MainActor.assumeIsolated { self?.poll() } }
        timer?.tolerance = 1
        SystemWatch.shared.$state.removeDuplicates().scan((L.stateName(.online), L.stateName(.online))) { ($0.1, L.stateName($1)) }
            .sink { [weak self] pair in
                if let pulse = L.wifi(from: pair.0, to: pair.1) { self?.fire("wifi", pulse.color, pulse.message) }
            }.store(in: &cancellables)
        MessengerNotifier.shared.$unread.removeDuplicates().scan((0, 0)) { ($0.1, $1) }
            .sink { [weak self] pair in if pair.1 > pair.0 { self?.fire("messages", .green, "New message") } }.store(in: &cancellables)
    }

    private func poll() {
        tick += 1
        guard enabled else { return }
        trackWork()
        if tick % 6 == 1 { checkBattery(); checkEvents(); checkUpdate() }
        if tick % 2 == 0 { checkCameraAndMic() }
        if tick % 120 == 1 { checkDisk() }
        if tick % 720 == 3 { checkShelf() }
        if isOn("download.done") || isOn("download.failed") { checkDownloads() }
    }

    private func checkBattery() {
        guard isOn("battery"), let b = LiveActivityCenter.battery() else { return }
        let pulse = L.battery(percent: b.percent, pluggedIn: b.pluggedIn)
        if let pulse, pulse != lastBattery { fire("battery", pulse.color, pulse.message) }
        // Re-arm once the state has changed (plugged in, or charged up past the warning).
        if pulse?.color != lastBattery?.color || pulse == nil { lastBattery = pulse }
    }

    private func checkDisk() {
        guard isOn("disk"), let v = try? URL(fileURLWithPath: "/").resourceValues(forKeys: [.volumeAvailableCapacityForImportantUsageKey, .volumeTotalCapacityKey]),
              let free = v.volumeAvailableCapacityForImportantUsage, let total = v.volumeTotalCapacity else { return }
        let low = SystemWatchLogic.diskLow(freeBytes: free, totalBytes: Int64(total))
        if low, !diskWasLow { fire("disk", .red, "Only \(ByteCountFormatter.string(fromByteCount: free, countStyle: .file)) is free on your Mac") }
        diskWasLow = low
    }

    private func checkUpdate() {
        guard isOn("update"), let release = UpdateChecker.shared.pendingUpdate, announcedUpdate != release.version else { return }
        announcedUpdate = release.version
        fire("update", .amber, "Notch Apple \(release.version) is ready to install")
    }

    /// Uses Calendar access you already gave; it never asks.
    private func checkEvents() {
        guard isOn("event"), EKEventStore.authorizationStatus(for: .event) == .fullAccess else { return }
        let store = EKEventStore()
        let events = store.events(matching: store.predicateForEvents(withStart: .now, end: .now.addingTimeInterval(6 * 60), calendars: nil))
        for e in events where !e.isAllDay {
            let key = (e.eventIdentifier ?? e.title ?? "") + "\(e.startDate.timeIntervalSince1970)"
            guard !announcedEvents.contains(key), L.eventSoon(minutesUntil: e.startDate.timeIntervalSinceNow / 60) else { continue }
            announcedEvents.insert(key)
            fire("event", .amber, "\(e.title ?? "Event") starts in \(max(1, Int((e.startDate.timeIntervalSinceNow / 60).rounded(.up)))) min")
        }
        if announcedEvents.count > 200 { announcedEvents.removeAll() }
    }

    private func checkCameraAndMic() {
        guard isOn("camera") else { cameraWasOn = false; micWasOn = false; return }
        let cam = Self.cameraInUse(), mic = Self.micInUse()
        if cam, !cameraWasOn { fire("camera", .amber, "The camera is on") }
        else if mic, !micWasOn, !cam { fire("camera", .amber, "The microphone is on") }
        cameraWasOn = cam; micWasOn = mic
    }

    private func checkShelf() {
        guard isOn("shelf") else { return }
        let ages = FileShelfStore.shared.items.compactMap { $0.added }.map { Date.now.timeIntervalSince($0) / 86_400 }
        guard L.shelfIsOld(addedDaysAgo: ages) else { return }
        // Once a week at most, however many old files there are.
        if let last = shelfAnnouncedOn, Date.now.timeIntervalSince(last) < 7 * 86_400 { return }
        shelfAnnouncedOn = .now
        fire("shelf", .amber, "Some files have been on the Shelf for a week")
    }

    /// Counts minutes of work with the keyboard or mouse in use; five idle minutes start the count again.
    private func trackWork() {
        guard isOn("break") else { workingSeconds = 0; return }
        let idle = CGEventSource.secondsSinceLastEventType(.combinedSessionState, eventType: CGEventType(rawValue: ~0)!)
        if idle < 120 { workingSeconds += 5 } else if idle > 300 { workingSeconds = 0 }
        if L.breakDue(minutesWorking: workingSeconds / 60) {
            workingSeconds = 0
            fire("break", .amber, "You've been working for 90 minutes. Take a break")
        }
    }

    /// Watches Downloads for files that finish or stop. macOS asks once to let Notch Apple read that folder, only if you turn this on.
    private func checkDownloads() {
        guard let dir = FileManager.default.urls(for: .downloadsDirectory, in: .userDomainMask).first,
              let names = try? FileManager.default.contentsOfDirectory(atPath: dir.path) else { return }
        let suffixes = [".crdownload", ".download", ".part", ".opdownload"]
        var partials = Set<String>()
        for n in names { if let s = suffixes.first(where: { n.hasSuffix($0) }) { partials.insert(String(n.dropLast(s.count))) } }
        for base in downloadPartials.subtracting(partials) {
            if names.contains(base) { fire("download.done", .green, "\(base) finished downloading") }
            else { fire("download.failed", .red, "The download of \(base) stopped") }
        }
        downloadPartials = partials
    }

    // MARK: Called from elsewhere

    func timerFinished(_ name: String) { fire("timer", .green, "\(name) is done") }
    func secretCopied() { fire("secret", .amber, "A password or code was copied") }

    /// From the lock screen: three wrong codes in a row glow red.
    func unlockAttempt(success: Bool) {
        if success { wrongCodes = 0; return }
        wrongCodes += 1
        if L.unlockFailed(wrongInARow: wrongCodes) { fire("unlock", .red, "Wrong unlock code \(wrongCodes) times") }
    }

    /// A live activity from a script or plugin that carries pulse=green, amber or red.
    func external(id: String, color: L.Color, text: String?) {
        let source = id.hasPrefix("build") || id.hasPrefix("test") ? "build" : "custom"
        fire(source, color, text ?? id)
    }

    // MARK: Camera and microphone

    private static func micInUse() -> Bool {
        var addr = AudioObjectPropertyAddress(mSelector: kAudioHardwarePropertyDefaultInputDevice, mScope: kAudioObjectPropertyScopeGlobal, mElement: kAudioObjectPropertyElementMain)
        var device = AudioDeviceID(0)
        var size = UInt32(MemoryLayout<AudioDeviceID>.size)
        guard AudioObjectGetPropertyData(AudioObjectID(kAudioObjectSystemObject), &addr, 0, nil, &size, &device) == noErr, device != 0 else { return false }
        addr = AudioObjectPropertyAddress(mSelector: kAudioDevicePropertyDeviceIsRunningSomewhere, mScope: kAudioObjectPropertyScopeGlobal, mElement: kAudioObjectPropertyElementMain)
        var running: UInt32 = 0
        size = UInt32(MemoryLayout<UInt32>.size)
        return AudioObjectGetPropertyData(device, &addr, 0, nil, &size, &running) == noErr && running != 0
    }

    private static func cameraInUse() -> Bool {
        var addr = CMIOObjectPropertyAddress(mSelector: CMIOObjectPropertySelector(kCMIOHardwarePropertyDevices),
                                             mScope: CMIOObjectPropertyScope(kCMIOObjectPropertyScopeGlobal),
                                             mElement: CMIOObjectPropertyElement(kCMIOObjectPropertyElementMain))
        var size: UInt32 = 0
        guard CMIOObjectGetPropertyDataSize(CMIOObjectID(kCMIOObjectSystemObject), &addr, 0, nil, &size) == 0, size > 0 else { return false }
        var devices = [CMIODeviceID](repeating: 0, count: Int(size) / MemoryLayout<CMIODeviceID>.size)
        var used: UInt32 = 0
        guard CMIOObjectGetPropertyData(CMIOObjectID(kCMIOObjectSystemObject), &addr, 0, nil, size, &used, &devices) == 0 else { return false }
        for device in devices {
            var a = CMIOObjectPropertyAddress(mSelector: CMIOObjectPropertySelector(kCMIODevicePropertyDeviceIsRunningSomewhere),
                                              mScope: CMIOObjectPropertyScope(kCMIOObjectPropertyScopeGlobal),
                                              mElement: CMIOObjectPropertyElement(kCMIOObjectPropertyElementMain))
            var running: UInt32 = 0
            var got: UInt32 = 0
            if CMIOObjectGetPropertyData(device, &a, 0, nil, UInt32(MemoryLayout<UInt32>.size), &got, &running) == 0, running != 0 { return true }
        }
        return false
    }
}

extension StatusPulseLogic {
    static func stateName(_ s: SystemWatchLogic.LinkState) -> String {
        switch s { case .online: "online"; case .slow: "slow"; case .down: "down" }
    }
}

// MARK: - Settings

/// Settings → Notch → Status pulse.
struct StatusPulseSettings: View {
    @ObservedObject private var pulse = StatusPulse.shared
    @State private var expanded: Set<String> = []
    typealias L = StatusPulseLogic

    var body: some View {
        Section {
            Toggle(isOn: $pulse.enabled) {
                Text("Glow the closed notch for things that matter")
                Text("Green is done or good, amber needs you soon, red failed or urgent. Click the notch and it goes away; hover it to read what happened. Everything is checked on this Mac.")
            }
            Toggle(isOn: $pulse.redStays) {
                Text("Keep red lit until I look")
                Text("Failures stay on instead of fading after 10 seconds.")
            }
            Toggle("Quiet hours", isOn: $pulse.quietOn)
            if pulse.quietOn {
                Stepper("From \(hourText(pulse.quietFrom))", value: $pulse.quietFrom, in: 0...23)
                Stepper("To \(hourText(pulse.quietTo))", value: $pulse.quietTo, in: 0...23)
            }
            HStack {
                Text("Try it")
                Spacer()
                Button("Green") { pulse.preview(.green) }
                Button("Amber") { pulse.preview(.amber) }
                Button("Red") { pulse.preview(.red) }
            }
            ForEach(L.sections) { section in
                DisclosureGroup(isExpanded: Binding(get: { expanded.contains(section.id) }, set: { on in
                    if on { expanded.insert(section.id) } else { expanded.remove(section.id) }
                })) {
                    if let note = section.note { Text(note).font(.callout).foregroundStyle(.secondary) }
                    ForEach(L.sources(in: section.id)) { source in
                        Toggle(isOn: Binding(get: { pulse.isOn(source.id) }, set: { pulse.setOn(source.id, $0) })) {
                            Text(source.name)
                            Text(source.available ? source.detail : "Not available yet")
                        }
                        .disabled(!source.available || !pulse.enabled)
                    }
                } label: {
                    Text(section.name)
                    Text("\(L.sources(in: section.id).filter { pulse.isOn($0.id) && $0.available }.count) on")
                }
            }
        } header: {
            Text("Status pulse")
        }
    }

    private func hourText(_ h: Int) -> String {
        let d = Calendar.current.date(bySettingHour: h, minute: 0, second: 0, of: .now) ?? .now
        return d.formatted(date: .omitted, time: .shortened)
    }
}
