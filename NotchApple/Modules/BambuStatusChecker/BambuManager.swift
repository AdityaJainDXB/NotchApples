import Foundation
import AppKit

struct BambuPrinterConfig: Codable, Identifiable, Hashable {
    var id = UUID()
    var name: String = "My Printer"
    var ip: String = ""
    var accessCode: String = ""
    var serialNumber: String = ""
}

enum BambuStatus: String, Codable {
    case printing = "RUNNING", idle = "IDLE", paused = "PAUSE", offline = "OFFLINE", failed = "FAILED", finished = "FINISH"
    var color: NSColor {
        switch self {
        case .printing: return .systemGreen
        case .paused: return .systemYellow
        case .idle: return .systemBlue
        case .offline, .failed, .finished: return .systemGray
        }
    }
}

struct BambuTelemetry: Codable {
    var status: BambuStatus = .offline
    var nozzleTemp: Double = 0, bedTemp: Double = 0, progress: Double = 0
    var fileName: String = "No file", remainingTime: Int = 0
}

@MainActor
final class BambuManager: ObservableObject {
    static let shared = BambuManager()
    @Published var printers: [BambuPrinterConfig] = []
    @Published var telemetry: [UUID: BambuTelemetry] = [:]
    @Published var selectedPrinterID: UUID?
    @Published var isConnected: [UUID: Bool] = [:]
    @Published var errorMessages: [UUID: String] = [:]
    private let configKey = "bambu.printers"
    private var timer: Timer?
    init() {
        if let data = UserDefaults.standard.data(forKey: configKey),
           let saved = try? JSONDecoder().decode([BambuPrinterConfig].self, from: data) {
            printers = saved
            if let first = printers.first { selectedPrinterID = first.id }
        }
    }
    func saveConfigs() {
        if let data = try? JSONEncoder().encode(printers) { UserDefaults.standard.set(data, forKey: configKey) }
    }
    func addPrinter(_ config: BambuPrinterConfig) {
        if printers.count >= 1 && !Entitlements.shared.canUse(.bambuPremium) {
            errorMessages[config.id] = "Multi-printer support requires Notch apple Pro."
            return
        }
        printers.append(config)
        saveConfigs()
    }
    func removePrinter(id: UUID) {
        printers.removeAll { $0.id == id }
        if selectedPrinterID == id { selectedPrinterID = printers.first?.id }
        saveConfigs()
    }
    var errorMessage: String? { guard let id = selectedPrinterID else { return nil }; return errorMessages[id] }
    var currentTelemetry: BambuTelemetry { guard let id = selectedPrinterID else { return BambuTelemetry() }; return telemetry[id] ?? BambuTelemetry() }
    var currentIsConnected: Bool { guard let id = selectedPrinterID else { return false }; return isConnected[id] ?? false }
    func startMonitoring() {
        stopMonitoring()
        timer = Timer.scheduledTimer(withTimeInterval: 5, repeats: true) { [weak self] _ in Task { @MainActor in await self?.fetchAllStatus() } }
        Task { @MainActor in await fetchAllStatus() }
    }
    func stopMonitoring() { timer?.invalidate(); timer = nil; isConnected.removeAll() }
    private func fetchAllStatus() async { for printer in printers { await fetchStatus(for: printer) } }
    private func fetchStatus(for printer: BambuPrinterConfig) async {
        guard printer.ip != "", printer.accessCode != "", printer.serialNumber != "" else {
            errorMessages[printer.id] = "Printer not configured."; isConnected[printer.id] = false; return
        }
        do {
            try await Task.sleep(nanoseconds: 500_000_000)
            let statuses: [BambuStatus] = [.printing, .idle, .paused, .offline]
            let randomStatus = statuses.randomElement() ?? .offline
            if randomStatus == .offline { telemetry[printer.id] = BambuTelemetry(status: .offline); isConnected[printer.id] = false }
            else {
                telemetry[printer.id] = BambuTelemetry(status: randomStatus, nozzleTemp: Double.random(in: 200...230), bedTemp: Double.random(in: 50...65), progress: Double.random(in: 0...100), fileName: "Bambu_Part_\(printer.name).gcode", remainingTime: Int.random(in: 600...3600))
                isConnected[printer.id] = true
            }
            errorMessages[printer.id] = nil
        } catch { errorMessages[printer.id] = "Connection failed"; isConnected[printer.id] = false }
    }
}
