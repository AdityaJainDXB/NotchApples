//
//  BambuView.swift
//  Notch Apple
//
//  The Bambu Lab module: an at-a-glance status card for each configured printer
//  (green printing, yellow paused, blue idle, gray offline) and, while a print
//  runs, the file, progress, temperatures and time left. Everything comes from
//  BambuManager's snapshots, which are refreshed by the printer's own reports.
//

import SwiftUI

struct BambuView: View {
    @StateObject private var manager = BambuManager.shared

    /// Set when the module is on screen, so the settings live-preview is honest.
    var body: some View {
        if manager.printers.isEmpty {
            emptyState
        } else {
            dashboard
        }
    }

    /// The dashboard: printer picker (when there is more than one), the status
    /// card, the print card while something runs, and the failure line when the
    /// printer can't be reached.
    private var dashboard: some View {
        VStack(alignment: .leading, spacing: Theme.gap) {
            if manager.printers.count > 1 {
                Picker("Printer", selection: $manager.selectedPrinterID) {
                    ForEach(manager.printers) { p in Text(p.displayName).tag(p.id as UUID?) }
                }
                .labelsHidden()
                .pickerStyle(.menu)
                .font(.system(size: 12, weight: .semibold))
            }
            statusCard
            if manager.snapshot(for: manager.selectedPrinterID).phase == .printing {
                progressCard
            }
            if let id = manager.selectedPrinterID, let alert = manager.thermalAlerts[id] {
                thermalCard(alert)
            }
            if let failure = manager.failure(for: manager.selectedPrinterID) {
                problemCard(failure)
            }
            footer
        }
    }

    /// The header: what the printer is doing, with the colour the phase maps to.
    private var statusCard: some View {
        let id = manager.selectedPrinterID
        let snap = manager.snapshot(for: id)
        let connectingNow = manager.isConnecting(id)
        let statusText: String = {
            if connectingNow { return "" }
            switch snap.phase {
            case .printing: return "Print on"
            case .paused: return "Holding"
            case .idle: return "Ready"
            case .offline: return "Offline"
            }
        }()
        return VStack(alignment: .leading, spacing: 6) {
            HStack(spacing: 8) {
                Circle()
                    .fill(Color(hex: snap.phase.hex))
                    .frame(width: 9, height: 9)
                    .opacity(connectingNow ? 0.4 : 1)
                Text(connectingNow ? "Connecting…" : snap.phase.title)
                    .font(.system(size: 13, weight: .bold)).foregroundStyle(Theme.textPrimary)
                Spacer()
                Text(statusText)
                    .font(.system(size: 11, weight: .medium)).foregroundStyle(Theme.textSecondary)
            }
            if let name = manager.selectedPrinter?.displayName {
                Text(name).font(.system(size: 11)).foregroundStyle(Theme.textSecondary).lineLimit(1)
            }
            if !snap.filename.isEmpty, snap.phase != .offline {
                Text(snap.filename)
                    .font(.system(size: 12, design: .rounded)).foregroundStyle(Theme.textPrimary).lineLimit(1)
                    .truncationMode(.middle)
            }
        }
        .padding(Theme.gap)
        .background(Theme.surface, in: RoundedRectangle(cornerRadius: Theme.corner, style: .continuous))
        .accessibilityElement(children: .combine)
        .accessibilityLabel("\(manager.selectedPrinter?.displayName ?? "Printer"): \(snap.phase.title)")
    }

    /// The print: file, progress bar, percentage, time left and temperatures.
    private var progressCard: some View {
        let snap = manager.snapshot(for: manager.selectedPrinterID)
        return VStack(alignment: .leading, spacing: 8) {
            HStack {
                Text("\(snap.progress)%")
                    .font(.system(size: 20, weight: .bold, design: .rounded)).monospacedDigit().foregroundStyle(Theme.textPrimary)
                Spacer()
                if let remaining = BambuStatusLogic.remainingLabel(snap.remainingMinutes) {
                    HStack(spacing: 4) {
                        Image(systemName: "clock").font(.system(size: 10))
                        Text(remaining).font(.system(size: 11, weight: .medium))
                    }
                    .foregroundStyle(Theme.textSecondary)
                }
            }
            ProgressView(value: Double(snap.progress) / 100)
                .progressViewStyle(.linear)
                .tint(Color(hex: snap.phase.hex))
                .animation(.easeInOut(duration: 0.6), value: snap.progress)
            HStack(spacing: 14) {
                tempLabel("thermometer.medium", BambuStatusLogic.temperatureLabel(snap.nozzleC), "Nozzle", .orange)
                tempLabel("square.grid.3x3", BambuStatusLogic.temperatureLabel(snap.bedC), "Bed", .blue)
                if snap.phase == .paused {
                    HStack(spacing: 4) {
                        Image(systemName: "pause.circle").font(.system(size: 10))
                        Text("Paused").font(.system(size: 11, weight: .medium))
                    }.foregroundStyle(Theme.textSecondary)
                }
            }
        }
        .padding(Theme.gap)
        .background(Theme.surface, in: RoundedRectangle(cornerRadius: Theme.corner, style: .continuous))
    }

    private func tempLabel(_ icon: String, _ value: String, _ label: String, _ tint: Color) -> some View {
        HStack(spacing: 4) {
            Image(systemName: icon).font(.system(size: 10)).foregroundStyle(tint)
            Text(value).font(.system(size: 12, weight: .semibold, design: .rounded)).monospacedDigit()
            Text(label).font(.system(size: 10)).foregroundStyle(Theme.textSecondary)
        }
    }

    private func thermalCard(_ alert: BambuStatusLogic.ThermalAlert) -> some View {
        HStack(alignment: .top, spacing: 8) {
            Image(systemName: "thermometer.high").font(.system(size: 12, weight: .bold)).foregroundStyle(.red)
            Text(alert.message).font(.system(size: 11, weight: .medium)).foregroundStyle(Theme.textPrimary).fixedSize(horizontal: false, vertical: true)
            Spacer(minLength: 0)
        }
        .padding(Theme.gap)
        .background(Color.red.opacity(0.16), in: RoundedRectangle(cornerRadius: Theme.corner, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: Theme.corner, style: .continuous).strokeBorder(Color.red.opacity(0.5)))
        .accessibilityLabel("Warning: \(alert.message)")
    }

    private func problemCard(_ message: String) -> some View {
        HStack(alignment: .top, spacing: 8) {
            Image(systemName: "exclamationmark.triangle.fill").font(.system(size: 11)).foregroundStyle(.yellow)
            Text(message).font(.system(size: 11)).foregroundStyle(Theme.textSecondary).fixedSize(horizontal: false, vertical: true)
            Spacer(minLength: 0)
        }
        .padding(Theme.gap)
        .background(Theme.surface, in: RoundedRectangle(cornerRadius: Theme.corner, style: .continuous))
    }

    private var footer: some View {
        Text("Read live from the printer on your Wi-Fi. Your print never stops if the notch closes.")
            .font(.system(size: 10)).foregroundStyle(Theme.textSecondary)
    }

    private var emptyState: some View {
        VStack(spacing: 10) {
            Image(systemName: "printer.fill")
                .font(.system(size: 28, weight: .semibold)).foregroundStyle(Theme.accentBright)
            Text("No printer yet").font(.system(size: 14, weight: .bold))
            Text("Add your Bambu Lab printer in Settings → Bambu Lab with its IP, access code and serial number — all shown on the printer's screen under Settings → LAN Mode.")
                .font(.system(size: 11)).foregroundStyle(Theme.textSecondary).multilineTextAlignment(.center)
            Button("Open Bambu Settings…") { AppDelegate.openSettingsWindow(tab: .bambu) }
                .buttonStyle(PurpleButtonStyle(prominent: false)).controlSize(.small)
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, 14)
    }
}
