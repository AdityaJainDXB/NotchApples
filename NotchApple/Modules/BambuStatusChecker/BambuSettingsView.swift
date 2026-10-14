//
//  BambuSettingsView.swift
//  Notch Apple
//
//  Settings → Bambu Lab: the printers the notch watches. Each printer needs the
//  three things the LAN mode screen shows (IP, access code, serial); fields are
//  saved as you type and reconnects happen automatically. The settings fields
//  can also be left empty, in which case BAMBU_IP, BAMBU_ACCESS_CODE and
//  BAMBU_SERIAL fill them in.
//

import SwiftUI

struct BambuSettingsView: View {
    @ObservedObject private var manager = BambuManager.shared
    @State private var newName = ""
    @State private var newHost = ""
    @State private var newAccessCode = ""
    @State private var newSerial = ""
    @State private var addProblem: String?

    var body: some View {
        Form {
            Section {
                Toggle("Watch my printers", isOn: Binding(
                    get: { manager.enabled },
                    set: { $0 ? manager.start() : manager.stop() }
                ))
            } footer: {
                Text("Off means Notch Apple never contacts the printers. Nothing is sent anywhere else: every report stays on this Mac.")
            }

            Section {
                Toggle("Sound and haptic tap when a print pauses, finishes or fails", isOn: $manager.soundsEnabled)
                Toggle("Warn when a heater runs too hot or the hotend creeps hot", isOn: $manager.thermalAlertsEnabled)
            } footer: {
                Text("The warning glows red beside the notch and sends a notification. Limits: nozzle 300°, bed 110°, or 15° over target; heat creep is a hotend above 60° that keeps rising with the heater off.")
            }

            Section("Printers") {
                if manager.printers.isEmpty {
                    Text("No printers yet. Add one below.")
                        .foregroundStyle(Theme.textSecondary)
                } else {
                    ForEach(manager.printers) { printer in
                        printerRow(printer)
                    }
                    .onDelete { indexSet in
                        for i in indexSet { manager.remove(id: manager.printers[i].id) }
                    }
                }
            }

            if let selected = manager.selectedPrinter {
                Section("Selected printer") {
                    TextField("Name (optional)", text: binding(selected, \.name))
                    TextField("IP address or hostname", text: binding(selected, \.host))
                    SecureField("Access code", text: binding(selected, \.accessCode))
                    TextField("Serial number", text: binding(selected, \.serial))
                    if let problem = BambuManager.validate(selected) {
                        Label(problem, systemImage: "exclamationmark.triangle")
                            .font(.caption).foregroundStyle(.orange)
                    }
                    HStack {
                        Button("Reconnect") { manager.update(selected) }
                        Button("Trust new certificate") { manager.trustNewCertificate(id: selected.id) }
                            .help("Use after a printer firmware update or reset. Notch Apple remembers the certificate the printer showed the first time and refuses a different one.")
                        Spacer()
                        Button("Remove", role: .destructive) { manager.remove(id: selected.id) }
                    }
                }
            }

            Section {
                TextField("Name (optional)", text: $newName)
                TextField("IP address or hostname", text: $newHost)
                SecureField("Access code", text: $newAccessCode)
                TextField("Serial number", text: $newSerial)
                Button("Add printer") { addPrinter() }
                    .disabled(Self.hasAll(newHost, newAccessCode, newSerial) == false)
                if let problem = addProblem {
                    Label(problem, systemImage: "exclamationmark.triangle")
                        .font(.caption).foregroundStyle(.orange)
                }
                if !manager.canAddPrinter {
                    Text("More than one printer comes with Notch Apple Pro (\(Feature.bambuMulti.title)).")
                        .font(.caption).foregroundStyle(Theme.textSecondary)
                }
            } header: {
                Text("Add a printer")
            } footer: {
                Text("Empty fields fall back to the BAMBU_IP, BAMBU_ACCESS_CODE and BAMBU_SERIAL environment variables.")
            }

            Section {
                Label {
                    Text("LAN Mode switches off the printer's cloud features: the Bambu Handy app, starting or watching prints from outside your home, and print history in Bambu Cloud. Some printers and firmware versions may answer on your network without LAN Mode, so try adding the printer first and switch LAN Mode on only if it cannot connect.")
                } icon: {
                    Image(systemName: "exclamationmark.triangle.fill").foregroundStyle(.orange)
                }
                .font(.callout)
            } header: {
                Text("Please note")
            }

            Section {
                VStack(alignment: .leading, spacing: 8) {
                    setupStep(1, "Put the Mac and the printer on the same Wi-Fi.")
                    setupStep(2, "On the printer's screen open Settings, then Network (or WLAN), and switch LAN Mode on. Wi-Fi and LAN Mode both need to be on.")
                    setupStep(3, "Still on that screen, read the printer's IP address and its Access Code (eight characters).")
                    setupStep(4, "The serial number is under Settings, then Device (it also starts with 0 or 3 and is printed on the back).")
                    setupStep(5, "Type the three above under Add a printer, then press Add printer. The first time it connects, Notch Apple remembers the printer's certificate.")
                }
                .font(.callout)
            } header: {
                Text("How to connect your printer")
            } footer: {
                Text("Works with Bambu printers over your own network, nothing goes to the internet. Notch Apple is not affiliated with Bambu Lab.")
            }

            Section("Preview") {
                BambuView()
                    .frame(maxWidth: .infinity, alignment: .leading)
            }
        }
        .formStyle(.grouped)
    }

    private func setupStep(_ n: Int, _ text: String) -> some View {
        HStack(alignment: .firstTextBaseline, spacing: 10) {
            Text("\(n)").font(.caption.bold()).frame(width: 20, height: 20)
                .background(Circle().fill(Theme.accent.opacity(0.25)))
            Text(text).fixedSize(horizontal: false, vertical: true)
        }
    }

    // MARK: - Rows and bindings

    private func printerRow(_ printer: BambuPrinterConfig) -> some View {
        let snap = manager.snapshot(for: printer.id)
        return HStack(spacing: 10) {
            Circle().fill(Color(hex: snap.phase.hex)).frame(width: 9, height: 9)
                .opacity(manager.isConnecting(printer.id) ? 0.4 : 1)
            VStack(alignment: .leading, spacing: 2) {
                Text(printer.displayName).font(.system(size: 13, weight: .semibold))
                Text(subtitle(printer)).font(.system(size: 11)).foregroundStyle(Theme.textSecondary).lineLimit(1)
            }
            Spacer()
            if manager.selectedPrinterID == printer.id {
                Image(systemName: "checkmark.circle.fill").foregroundStyle(Theme.accentBright)
            }
        }
        .contentShape(Rectangle())
        .onTapGesture { manager.selectedPrinterID = printer.id }
    }

    private func subtitle(_ printer: BambuPrinterConfig) -> String {
        let snap = manager.snapshot(for: printer.id)
        var text = snap.phase.title
        let host = manager.resolved(printer).host
        if !host.isEmpty { text += " · \(host)" }
        if let failure = manager.failure(for: printer.id), snap.phase == .offline { text = failure }
        return text
    }

    /// A binding into a stored printer: every keystroke is saved (and never
    /// reconnects on its own; Reconnect does that).
    private func binding(_ printer: BambuPrinterConfig, _ keyPath: WritableKeyPath<BambuPrinterConfig, String>) -> Binding<String> {
        Binding(
            get: { printer[keyPath: keyPath] },
            set: { newValue in manager.setField(printer.id, keyPath, newValue) }
        )
    }

    private func addPrinter() {
        addProblem = manager.addPrinter(name: newName, host: newHost, accessCode: newAccessCode, serial: newSerial)
        if addProblem == nil {
            newName = ""; newHost = ""; newAccessCode = ""; newSerial = ""
        }
    }

    private static func hasAll(_ host: String, _ code: String, _ serial: String) -> Bool {
        !host.trimmingCharacters(in: .whitespaces).isEmpty &&
        !code.trimmingCharacters(in: .whitespaces).isEmpty &&
        !serial.trimmingCharacters(in: .whitespaces).isEmpty
    }
}
