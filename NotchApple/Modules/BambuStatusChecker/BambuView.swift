import SwiftUI
struct BambuView: View {
    @ObservedObject var manager = BambuManager.shared
    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack {
                Circle().fill(manager.currentTelemetry.status.color).frame(width: 8, height: 8)
                Text(manager.currentTelemetry.status.rawValue).font(.system(size: 12, weight: .bold)).foregroundColor(.secondary)
                Spacer()
                Text(manager.currentIsConnected ? "Connected" : "Offline").font(.system(size: 10)).foregroundColor(manager.currentIsConnected ? .green : .gray)
            }
            if manager.currentTelemetry.status == .printing {
                VStack(alignment: .leading, spacing: 4) {
                    HStack {
                        Text(manager.currentTelemetry.fileName).font(.system(size: 11)).lineLimit(1).foregroundColor(.primary)
                        Spacer()
                        Text("\(Int(manager.currentTelemetry.progress))%").font(.system(size: 11, weight: .medium))
                    }
                    ProgressView(value: manager.currentTelemetry.progress / 100.0).progressViewStyle(LinearProgressViewStyle(tint: .blue)).frame(height: 4)
                }
            }
            HStack(spacing: 12) {
                HStack(spacing: 4) { Image(systemName: "thermometer.medium").foregroundColor(.orange); Text("\(Int(manager.currentTelemetry.nozzleTemp))°C").font(.system(size: 11, weight: .medium)) }
                HStack(spacing: 4) { Image(systemName: "square.grid.3x3").foregroundColor(.blue); Text("\(Int(manager.currentTelemetry.bedTemp))°C").font(.system(size: 11, weight: .medium)) }
                if manager.currentTelemetry.status == .printing {
                    HStack(spacing: 4) { Image(systemName: "clock").foregroundColor(.secondary); Text("\(manager.currentTelemetry.remainingTime / 60)m").font(.system(size: 11, weight: .medium)) }
                }
            }.font(.system(size: 11))
            if let error = manager.errorMessage { Text(error).font(.system(size: 10)).foregroundColor(.red).padding(.top, 4) }
            Divider().padding(.vertical, 8)
            HStack {
                Button("Start") { manager.startMonitoring() }.buttonStyle(.borderedProminent).controlSize(.small)
                Button("Stop") { manager.stopMonitoring() }.buttonStyle(.bordered).controlSize(.small)
            }
        }.padding().frame(width: 220).background(Color(NSColor.windowBackgroundColor)).cornerRadius(12)
    }
}
