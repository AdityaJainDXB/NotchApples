//
//  SystemStatsReader.swift
//  Shared between the Notch apple app and its WidgetKit extension.
//
//  Reads live Mac performance numbers with low-level system calls, all local:
//   • RAM: `host_statistics64` (active / wired / compressed) against physical memory
//   • Network: `getifaddrs` byte counters on Wi-Fi and Ethernet, turned into speeds
//   • CPU: `host_cpu_load_info` tick counters, turned into a load percentage
//   • Battery: IOKit power sources (charge, charging state, health, time left)
//   • Disk: volume capacity of the startup disk
//
//  CPU load and network speed are differences between two readings, so a
//  `SystemStatsReader` remembers its previous reading. The first `read()` has
//  no earlier reading and reports 0 for those two; the widget reads twice a
//  second apart with `sample()`.
//

import Foundation
import IOKit.ps
import Darwin

public struct SystemStats: Equatable {
    public var ramUsed: UInt64 = 0
    public var ramActive: UInt64 = 0
    public var ramWired: UInt64 = 0
    public var ramCompressed: UInt64 = 0
    public var ramTotal: UInt64 = 0
    /// Bytes per second.
    public var downloadRate: Double = 0
    public var uploadRate: Double = 0
    /// 0...100
    public var cpuPercent: Double = 0
    public var batteryPercent: Int?
    public var batteryCharging = false
    public var batteryPluggedIn = false
    public var batteryHealth: String?
    public var batteryMinutesRemaining: Int?
    public var diskTotal: UInt64 = 0
    public var diskAvailable: UInt64 = 0
    public var date = Date()

    public init() {}

    public var ramFraction: Double { ramTotal == 0 ? 0 : Double(ramUsed) / Double(ramTotal) }
    public var diskUsed: UInt64 { diskTotal > diskAvailable ? diskTotal - diskAvailable : 0 }
    public var diskFraction: Double { diskTotal == 0 ? 0 : Double(diskUsed) / Double(diskTotal) }

    // MARK: Formatting

    public static func bytes(_ value: UInt64) -> String {
        ByteCountFormatter.string(fromByteCount: Int64(value), countStyle: .memory)
    }

    public static func diskBytes(_ value: UInt64) -> String {
        ByteCountFormatter.string(fromByteCount: Int64(value), countStyle: .file)
    }

    /// "512 KB/s" or "3.4 MB/s".
    public static func speed(_ bytesPerSecond: Double) -> String {
        let kb = bytesPerSecond / 1024
        if kb < 1000 { return String(format: "%.0f KB/s", kb) }
        return String(format: "%.1f MB/s", kb / 1024)
    }
}

public final class SystemStatsReader {
    private var lastCPU: (used: UInt64, total: UInt64)?
    private var lastNet: (down: UInt64, up: UInt64, time: Date)?

    public init() {}

    /// One reading. Rates are measured against the previous `read()`.
    public func read() -> SystemStats {
        var stats = SystemStats()
        readMemory(into: &stats)
        readCPU(into: &stats)
        readNetwork(into: &stats)
        readBattery(into: &stats)
        readDisk(into: &stats)
        return stats
    }

    /// A reading with CPU and network rates already filled in, by measuring over `interval` seconds.
    public func sample(interval: TimeInterval = 1) async -> SystemStats {
        _ = read()
        try? await Task.sleep(for: .seconds(interval))
        return read()
    }

    // MARK: RAM

    private func readMemory(into stats: inout SystemStats) {
        stats.ramTotal = ProcessInfo.processInfo.physicalMemory
        var info = vm_statistics64()
        var count = mach_msg_type_number_t(MemoryLayout<vm_statistics64>.stride / MemoryLayout<integer_t>.stride)
        let result = withUnsafeMutablePointer(to: &info) {
            $0.withMemoryRebound(to: integer_t.self, capacity: Int(count)) {
                host_statistics64(mach_host_self(), HOST_VM_INFO64, $0, &count)
            }
        }
        guard result == KERN_SUCCESS else { return }
        let page = UInt64(vm_kernel_page_size)
        stats.ramActive = UInt64(info.active_count) * page
        stats.ramWired = UInt64(info.wire_count) * page
        stats.ramCompressed = UInt64(info.compressor_page_count) * page
        stats.ramUsed = min(stats.ramActive + stats.ramWired + stats.ramCompressed, stats.ramTotal)
    }

    // MARK: CPU

    private func readCPU(into stats: inout SystemStats) {
        var info = host_cpu_load_info()
        var count = mach_msg_type_number_t(MemoryLayout<host_cpu_load_info>.stride / MemoryLayout<integer_t>.stride)
        let result = withUnsafeMutablePointer(to: &info) {
            $0.withMemoryRebound(to: integer_t.self, capacity: Int(count)) {
                host_statistics(mach_host_self(), HOST_CPU_LOAD_INFO, $0, &count)
            }
        }
        guard result == KERN_SUCCESS else { return }
        let user = UInt64(info.cpu_ticks.0), system = UInt64(info.cpu_ticks.1)
        let idle = UInt64(info.cpu_ticks.2), nice = UInt64(info.cpu_ticks.3)
        let used = user + system + nice
        let total = used + idle
        defer { lastCPU = (used, total) }
        guard let last = lastCPU, total > last.total else { return }
        stats.cpuPercent = min(100, Double(used - last.used) / Double(total - last.total) * 100)
    }

    // MARK: Network

    /// Total bytes received and sent on Wi-Fi and Ethernet (en*) interfaces.
    private static func networkCounters() -> (down: UInt64, up: UInt64)? {
        var list: UnsafeMutablePointer<ifaddrs>?
        guard getifaddrs(&list) == 0, let first = list else { return nil }
        defer { freeifaddrs(list) }
        var down: UInt64 = 0, up: UInt64 = 0
        var cursor: UnsafeMutablePointer<ifaddrs>? = first
        while let entry = cursor {
            defer { cursor = entry.pointee.ifa_next }
            guard let address = entry.pointee.ifa_addr, address.pointee.sa_family == UInt8(AF_LINK),
                  entry.pointee.ifa_flags & UInt32(IFF_UP) != 0, entry.pointee.ifa_flags & UInt32(IFF_LOOPBACK) == 0,
                  let data = entry.pointee.ifa_data else { continue }
            let name = String(cString: entry.pointee.ifa_name)
            guard name.hasPrefix("en") else { continue }
            let counters = data.assumingMemoryBound(to: if_data.self).pointee
            down += UInt64(counters.ifi_ibytes)
            up += UInt64(counters.ifi_obytes)
        }
        return (down, up)
    }

    private func readNetwork(into stats: inout SystemStats) {
        guard let now = Self.networkCounters() else { return }
        let time = Date()
        defer { lastNet = (now.down, now.up, time) }
        guard let last = lastNet else { return }
        let seconds = time.timeIntervalSince(last.time)
        guard seconds > 0.05 else { return }
        // The kernel's 32-bit counters wrap around at 4 GB.
        func delta(_ new: UInt64, _ old: UInt64) -> UInt64 { new >= old ? new - old : new + (1 << 32) - old }
        stats.downloadRate = Double(delta(now.down, last.down)) / seconds
        stats.uploadRate = Double(delta(now.up, last.up)) / seconds
    }

    // MARK: Battery

    private func readBattery(into stats: inout SystemStats) {
        guard let blob = IOPSCopyPowerSourcesInfo()?.takeRetainedValue(),
              let list = IOPSCopyPowerSourcesList(blob)?.takeRetainedValue() as? [CFTypeRef] else { return }
        for source in list {
            guard let d = IOPSGetPowerSourceDescription(blob, source)?.takeUnretainedValue() as? [String: Any],
                  (d[kIOPSTypeKey] as? String) == kIOPSInternalBatteryType,
                  let current = d[kIOPSCurrentCapacityKey] as? Int, let max = d[kIOPSMaxCapacityKey] as? Int, max > 0 else { continue }
            stats.batteryPercent = Int((Double(current) / Double(max) * 100).rounded())
            stats.batteryCharging = (d[kIOPSIsChargingKey] as? Bool) ?? false
            stats.batteryPluggedIn = (d[kIOPSPowerSourceStateKey] as? String) == kIOPSACPowerValue
            stats.batteryHealth = d["BatteryHealth"] as? String
            let minutes = (stats.batteryCharging ? d[kIOPSTimeToFullChargeKey] : d[kIOPSTimeToEmptyKey]) as? Int
            stats.batteryMinutesRemaining = (minutes ?? -1) > 0 ? minutes : nil
            return
        }
    }

    // MARK: Disk

    private func readDisk(into stats: inout SystemStats) {
        let keys: Set<URLResourceKey> = [.volumeTotalCapacityKey, .volumeAvailableCapacityForImportantUsageKey]
        guard let values = try? URL(fileURLWithPath: "/").resourceValues(forKeys: keys) else { return }
        stats.diskTotal = UInt64(values.volumeTotalCapacity ?? 0)
        stats.diskAvailable = UInt64(values.volumeAvailableCapacityForImportantUsage ?? 0)
    }
}
