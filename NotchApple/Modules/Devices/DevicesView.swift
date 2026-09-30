//
//  DevicesView.swift
//  Notch apple
//
//  The Devices tab:
//   • Battery for Bluetooth accessories: AirPods (left / right / case) from
//     `system_profiler`, and Magic Mouse / Keyboard / Trackpad from IOKit.
//     A low-battery alert shows beside the notch at 15%.
//   • Privacy: which apps are using the microphone (macOS 14.2+) and whether
//     a camera is on, with a one-click mic mute. Also a dot beside the notch.
//   • iPhone: its battery if the Mac can see it over Bluetooth, and a button
//     to ring it through Find My.
//

import AppKit
import CoreAudio
import CoreMediaIO
import IOKit
import SwiftUI

// MARK: - Accessory battery

@MainActor
final class DeviceBatteryModel: ObservableObject {
    static let shared = DeviceBatteryModel()

    struct Device: Identifiable, Equatable {
        var id: String { name + (part ?? "") }
        let name: String
        let part: String?     // "Left", "Right", "Case" for AirPods
        let percent: Int
        let symbol: String
        let isPhone: Bool
    }

    @Published private(set) var devices: [Device] = []
    @Published private(set) var loading = false
    private var lastRefresh = Date.distantPast
    private var alerted: Set<String> = []

    func refreshIfDue(every seconds: TimeInterval) {
        if Date.now.timeIntervalSince(lastRefresh) > seconds { refresh() }
    }

    func refresh() {
        guard !loading else { return }
        loading = true
        lastRefresh = .now
        Task.detached {
            let list = Self.ioKitDevices() + Self.bluetoothProfilerDevices()
            await MainActor.run {
                self.devices = list
                self.loading = false
                self.alertIfLow()
            }
        }
    }

    private func alertIfLow() {
        guard SettingsManager.shared.accessoryBatteryAlert else { return }
        for d in devices {
            if d.percent <= 15, !alerted.contains(d.id) {
                alerted.insert(d.id)
                LiveActivityCenter.shared.flash(LiveActivity(symbol: d.symbol, label: "\(d.percent)%", tint: .systemRed), seconds: 6)
                Notifier.post(title: "\(d.name)\(d.part.map { " (\($0))" } ?? "") battery low", body: "\(d.percent)% left.")
            } else if d.percent > 25 {
                alerted.remove(d.id)
            }
        }
    }

    /// Apple keyboards, mice and trackpads report `BatteryPercent` through IOKit.
    nonisolated private static func ioKitDevices() -> [Device] {
        var result: [Device] = []
        var iterator: io_iterator_t = 0
        guard IOServiceGetMatchingServices(kIOMainPortDefault, IOServiceMatching("AppleDeviceManagementHIDEventService"), &iterator) == KERN_SUCCESS else { return [] }
        defer { IOObjectRelease(iterator) }
        var service = IOIteratorNext(iterator)
        while service != 0 {
            defer { IOObjectRelease(service); service = IOIteratorNext(iterator) }
            guard let percent = IORegistryEntryCreateCFProperty(service, "BatteryPercent" as CFString, kCFAllocatorDefault, 0)?.takeRetainedValue() as? Int,
                  let name = IORegistryEntryCreateCFProperty(service, "Product" as CFString, kCFAllocatorDefault, 0)?.takeRetainedValue() as? String
            else { continue }
            let lower = name.lowercased()
            let symbol = lower.contains("mouse") ? "magicmouse.fill" : lower.contains("trackpad") ? "rectangle.and.hand.point.up.left.fill" : "keyboard.fill"
            if !result.contains(where: { $0.name == name }) {
                result.append(Device(name: name, part: nil, percent: percent, symbol: symbol, isPhone: false))
            }
        }
        return result
    }

    /// AirPods and other headphones report battery in system_profiler's Bluetooth report.
    nonisolated private static func bluetoothProfilerDevices() -> [Device] {
        let p = Process()
        p.executableURL = URL(fileURLWithPath: "/usr/sbin/system_profiler")
        p.arguments = ["SPBluetoothDataType", "-json", "-detailLevel", "basic"]
        let pipe = Pipe()
        p.standardOutput = pipe
        p.standardError = FileHandle.nullDevice
        guard (try? p.run()) != nil else { return [] }
        let data = pipe.fileHandleForReading.readDataToEndOfFile()
        p.waitUntilExit()
        guard let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let bt = (json["SPBluetoothDataType"] as? [[String: Any]])?.first else { return [] }
        var result: [Device] = []
        // "device_connected" is a list of one-key dictionaries: [{ "AirPods Pro": { ...properties } }]
        for key in ["device_connected", "device_title"] {
            for entry in bt[key] as? [[String: Any]] ?? [] {
                for (name, value) in entry {
                    guard let props = value as? [String: Any] else { continue }
                    let type = (props["device_minorType"] as? String ?? "").lowercased()
                    let isPhone = type.contains("phone")
                    let symbol = isPhone ? "iphone" : name.lowercased().contains("max") ? "airpodsmax" : name.lowercased().contains("pro") ? "airpodspro" : "airpods"
                    let parts: [(String, String?)] = [("device_batteryLevelLeft", "Left"), ("device_batteryLevelRight", "Right"),
                                                      ("device_batteryLevelCase", "Case"), ("device_batteryLevelMain", nil)]
                    for (k, part) in parts {
                        if let s = props[k] as? String, let v = Int(s.replacingOccurrences(of: "%", with: "")) {
                            result.append(Device(name: name, part: part, percent: v, symbol: part == "Case" ? "airpodspro.chargingcase.wireless.fill" : symbol, isPhone: isPhone))
                        }
                    }
                }
            }
        }
        return result
    }
}

// MARK: - Microphone and camera

@MainActor
final class PrivacyMonitor: ObservableObject {
    static let shared = PrivacyMonitor()

    @Published private(set) var micInUse = false
    @Published private(set) var cameraInUse = false
    @Published private(set) var micApps: [String] = []
    @Published private(set) var micMuted = false
    private var timer: Timer?

    var liveActivity: LiveActivity? {
        if cameraInUse { return LiveActivity(symbol: "video.fill", label: nil, tint: .systemGreen, dotOnly: false) }
        if micInUse { return LiveActivity(symbol: micMuted ? "mic.slash.fill" : "mic.fill", label: nil, tint: .systemOrange) }
        return nil
    }

    func setRunning(_ on: Bool) {
        if on, timer == nil {
            let t = Timer(timeInterval: 2, repeats: true) { [weak self] _ in MainActor.assumeIsolated { self?.poll() } }
            RunLoop.main.add(t, forMode: .common)
            timer = t
            poll()
        } else if !on, timer != nil {
            timer?.invalidate()
            timer = nil
            micInUse = false
            cameraInUse = false
        }
    }

    func poll() {
        let mic = Self.defaultInput().map { Self.isRunningSomewhere($0) } ?? false
        let cam = Self.anyCameraRunning()
        micMuted = Self.defaultInput().map(Self.isMuted) ?? false
        micApps = mic ? Self.appsUsingMic() : []
        if mic != micInUse || cam != cameraInUse {
            micInUse = mic
            cameraInUse = cam
            LiveActivityCenter.shared.recompute()
        }
    }

    func toggleMute() {
        guard let device = Self.defaultInput() else { return }
        Self.setMuted(!Self.isMuted(device), device)
        poll()
        LiveActivityCenter.shared.recompute()
    }

    private static func addr(_ sel: AudioObjectPropertySelector, _ scope: AudioObjectPropertyScope = kAudioObjectPropertyScopeGlobal) -> AudioObjectPropertyAddress {
        AudioObjectPropertyAddress(mSelector: sel, mScope: scope, mElement: kAudioObjectPropertyElementMain)
    }

    private static func defaultInput() -> AudioObjectID? {
        var id = AudioObjectID(0), size = UInt32(MemoryLayout<AudioObjectID>.size)
        var a = addr(kAudioHardwarePropertyDefaultInputDevice)
        return AudioObjectGetPropertyData(AudioObjectID(kAudioObjectSystemObject), &a, 0, nil, &size, &id) == noErr && id != 0 ? id : nil
    }

    private static func isRunningSomewhere(_ device: AudioObjectID) -> Bool {
        var v: UInt32 = 0, size = UInt32(MemoryLayout<UInt32>.size)
        var a = addr(kAudioDevicePropertyDeviceIsRunningSomewhere)
        return AudioObjectGetPropertyData(device, &a, 0, nil, &size, &v) == noErr && v != 0
    }

    private static func isMuted(_ device: AudioObjectID) -> Bool {
        var v: UInt32 = 0, size = UInt32(MemoryLayout<UInt32>.size)
        var a = addr(kAudioDevicePropertyMute, kAudioObjectPropertyScopeInput)
        if AudioObjectGetPropertyData(device, &a, 0, nil, &size, &v) == noErr { return v != 0 }
        var vol: Float32 = 1, vsize = UInt32(MemoryLayout<Float32>.size)
        var va = addr(kAudioDevicePropertyVolumeScalar, kAudioObjectPropertyScopeInput)
        return AudioObjectGetPropertyData(device, &va, 0, nil, &vsize, &vol) == noErr && vol < 0.01
    }

    private static var savedInputVolume: Float32 = 0.75

    private static func setMuted(_ muted: Bool, _ device: AudioObjectID) {
        var v: UInt32 = muted ? 1 : 0
        var a = addr(kAudioDevicePropertyMute, kAudioObjectPropertyScopeInput)
        var settable: DarwinBoolean = false
        if AudioObjectIsPropertySettable(device, &a, &settable) == noErr, settable.boolValue {
            AudioObjectSetPropertyData(device, &a, 0, nil, UInt32(MemoryLayout<UInt32>.size), &v)
            return
        }
        // Built-in mics often have no mute switch: set the input volume to zero instead.
        var va = addr(kAudioDevicePropertyVolumeScalar, kAudioObjectPropertyScopeInput)
        var current: Float32 = 0, size = UInt32(MemoryLayout<Float32>.size)
        if muted, AudioObjectGetPropertyData(device, &va, 0, nil, &size, &current) == noErr, current > 0.01 { savedInputVolume = current }
        var vol: Float32 = muted ? 0 : savedInputVolume
        AudioObjectSetPropertyData(device, &va, 0, nil, size, &vol)
    }

    /// Names of apps currently recording from any input (macOS 14.2+ process objects).
    private static func appsUsingMic() -> [String] {
        guard #available(macOS 14.2, *) else { return [] }
        var a = addr(kAudioHardwarePropertyProcessObjectList)
        var size: UInt32 = 0
        guard AudioObjectGetPropertyDataSize(AudioObjectID(kAudioObjectSystemObject), &a, 0, nil, &size) == noErr, size > 0 else { return [] }
        var ids = [AudioObjectID](repeating: 0, count: Int(size) / MemoryLayout<AudioObjectID>.size)
        guard AudioObjectGetPropertyData(AudioObjectID(kAudioObjectSystemObject), &a, 0, nil, &size, &ids) == noErr else { return [] }
        var names: [String] = []
        for id in ids {
            var running: UInt32 = 0, rsize = UInt32(MemoryLayout<UInt32>.size)
            var ra = addr(kAudioProcessPropertyIsRunningInput)
            guard AudioObjectGetPropertyData(id, &ra, 0, nil, &rsize, &running) == noErr, running != 0 else { continue }
            var pid: pid_t = 0, psize = UInt32(MemoryLayout<pid_t>.size)
            var pa = addr(kAudioProcessPropertyPID)
            guard AudioObjectGetPropertyData(id, &pa, 0, nil, &psize, &pid) == noErr else { continue }
            let name = NSRunningApplication(processIdentifier: pid)?.localizedName ?? "PID \(pid)"
            if !names.contains(name) { names.append(name) }
        }
        return names
    }

    private static func anyCameraRunning() -> Bool {
        var a = CMIOObjectPropertyAddress(mSelector: CMIOObjectPropertySelector(kCMIOHardwarePropertyDevices),
                                          mScope: CMIOObjectPropertyScope(kCMIOObjectPropertyScopeGlobal),
                                          mElement: CMIOObjectPropertyElement(kCMIOObjectPropertyElementMain))
        var size: UInt32 = 0
        guard CMIOObjectGetPropertyDataSize(CMIOObjectID(kCMIOObjectSystemObject), &a, 0, nil, &size) == noErr, size > 0 else { return false }
        var ids = [CMIOObjectID](repeating: 0, count: Int(size) / MemoryLayout<CMIOObjectID>.size)
        var used: UInt32 = 0
        guard CMIOObjectGetPropertyData(CMIOObjectID(kCMIOObjectSystemObject), &a, 0, nil, size, &used, &ids) == noErr else { return false }
        for id in ids {
            var ra = CMIOObjectPropertyAddress(mSelector: CMIOObjectPropertySelector(kCMIODevicePropertyDeviceIsRunningSomewhere),
                                               mScope: CMIOObjectPropertyScope(kCMIOObjectPropertyScopeWildcard),
                                               mElement: CMIOObjectPropertyElement(kCMIOObjectPropertyElementWildcard))
            var running: UInt32 = 0, rused: UInt32 = 0
            if CMIOObjectGetPropertyData(id, &ra, 0, nil, UInt32(MemoryLayout<UInt32>.size), &rused, &running) == noErr, running != 0 { return true }
        }
        return false
    }
}

// MARK: - View

struct DevicesView: View {
    @StateObject private var battery = DeviceBatteryModel.shared
    @StateObject private var privacy = PrivacyMonitor.shared

    var body: some View {
        HStack(alignment: .top, spacing: 12) {
            GlassCard {
                VStack(alignment: .leading, spacing: 8) {
                    HStack {
                        Text("Accessories").sectionTitle()
                        Spacer()
                        if battery.loading { ProgressView().controlSize(.small) }
                        IconButton(systemImage: "arrow.clockwise", help: "Refresh") { battery.refresh() }
                    }
                    let accessories = battery.devices.filter { !$0.isPhone }
                    if accessories.isEmpty && !battery.loading {
                        Text("No Bluetooth accessories reporting battery. Connect AirPods, a Magic Mouse, Keyboard or Trackpad.")
                            .font(.system(size: 12)).foregroundStyle(Theme.textSecondary).fixedSize(horizontal: false, vertical: true)
                    }
                    ScrollView {
                        VStack(spacing: 8) {
                            ForEach(accessories) { row($0) }
                        }
                    }
                }
            }

            VStack(spacing: 12) {
                GlassCard {
                    VStack(alignment: .leading, spacing: 6) {
                        Text("Microphone & camera").sectionTitle()
                        Label(privacy.cameraInUse ? "Camera is on" : "Camera is off", systemImage: privacy.cameraInUse ? "video.fill" : "video.slash")
                            .foregroundStyle(privacy.cameraInUse ? .green : Theme.textSecondary)
                        Label(privacy.micInUse ? "Mic in use\(privacy.micApps.isEmpty ? "" : ": " + privacy.micApps.joined(separator: ", "))" : "Mic not in use",
                              systemImage: privacy.micInUse ? "mic.fill" : "mic")
                            .foregroundStyle(privacy.micInUse ? .orange : Theme.textSecondary).lineLimit(2)
                        Button { privacy.toggleMute() } label: {
                            Label(privacy.micMuted ? "Unmute mic" : "Mute mic", systemImage: privacy.micMuted ? "mic.fill" : "mic.slash.fill")
                        }
                        .buttonStyle(PurpleButtonStyle(prominent: privacy.micMuted))
                    }
                    .font(.system(size: 12))
                }
                GlassCard {
                    VStack(alignment: .leading, spacing: 6) {
                        Text("iPhone").sectionTitle()
                        if let phone = battery.devices.first(where: \.isPhone) {
                            Label("\(phone.name): \(phone.percent)%", systemImage: "iphone").font(.system(size: 12)).foregroundStyle(.white)
                        } else {
                            Text("Battery shows here when your iPhone is connected over Bluetooth.")
                                .font(.system(size: 11)).foregroundStyle(Theme.textSecondary).fixedSize(horizontal: false, vertical: true)
                        }
                        Button { openFindMy() } label: { Label("Ring my iPhone…", systemImage: "speaker.wave.3.fill") }
                            .buttonStyle(PurpleButtonStyle(prominent: false))
                            .help("Opens Find My, where you can play a sound on your iPhone")
                    }
                }
            }
            .frame(width: 270)
        }
        .onAppear {
            battery.refreshIfDue(every: 20)
            privacy.setRunning(true)
        }
    }

    private func row(_ d: DeviceBatteryModel.Device) -> some View {
        HStack(spacing: 10) {
            Image(systemName: d.symbol).font(.system(size: 18)).foregroundStyle(Theme.accentBright).frame(width: 26)
            VStack(alignment: .leading, spacing: 3) {
                Text(d.part.map { "\(d.name) · \($0)" } ?? d.name).font(.system(size: 12, weight: .medium)).foregroundStyle(.white).lineLimit(1)
                ProgressView(value: Double(d.percent), total: 100).tint(d.percent <= 20 ? .red : .green)
            }
            Text("\(d.percent)%").font(.system(size: 13, weight: .semibold, design: .rounded)).monospacedDigit().foregroundStyle(.white)
        }
    }

    private func openFindMy() {
        if let url = NSWorkspace.shared.urlForApplication(withBundleIdentifier: "com.apple.findmy") {
            NSWorkspace.shared.openApplication(at: url, configuration: .init())
        } else if let url = URL(string: "https://www.icloud.com/find") {
            NSWorkspace.shared.open(url)
        }
        AppDelegate.current?.notch?.closeNotch()
    }
}
