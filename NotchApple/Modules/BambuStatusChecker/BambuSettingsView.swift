import SwiftUI
struct BambuSettingsView: View {
    @ObservedObject var manager = BambuManager.shared
    @State private var newPrinterName = "My Printer", newPrinterIP = "", newPrinterAccess = "", newPrinterSerial = ""
    var body: some View {
        Form {
            Section {
                Toggle("Enable Bambu Lab Status", isOn: Binding(
                    get: { manager.isConnected.values.contains(true) || !manager.printers.isEmpty },
                    set: { enabled in enabled ? manager.startMonitoring() : manager.stopMonitoring() }
                ))
            }
            Section {
                Picker("Selected Printer", selection: $manager.selectedPrinterID) {
                    ForEach(manager.printers) { p in Text(p.name).tag(p.id) }
                }.pickerStyle(.menu)
            } header: { Text("Manage Printers") }
            if let selectedID = manager.selectedPrinterID, let printer = manager.printers.first(where: { $0.id == selectedID }) {
                Section {
                    TextField("Name", text: Binding(get: { printer.name }, set: { v in if let idx = manager.printers.firstIndex(where: { $0.id == selectedID }) { manager.printers[idx].name = v; manager.saveConfigs() } }))
                    TextField("IP Address", text: Binding(get: { printer.ip }, set: { v in if let idx = manager.printers.firstIndex(where: { $0.id == selectedID }) { manager.printers[idx].ip = v; manager.saveConfigs() } }))
                    SecureField("Access Code", text: Binding(get: { printer.accessCode }, set: { v in if let idx = manager.printers.firstIndex(where: { $0.id == selectedID }) { manager.printers[idx].accessCode = v; manager.saveConfigs() } }))
                    TextField("Serial Number", text: Binding(get: { printer.serialNumber }, set: { v in if let idx = manager.printers.firstIndex(where: { $0.id == selectedID }) { manager.printers[idx].serialNumber = v; manager.saveConfigs() } }))
                    Button(role: .destructive) { manager.removePrinter(id: selectedID) } label: { Label("Remove Printer", systemImage: "trash") }
                } header: { Text("Printer Configuration") }
            }
            Section {
                TextField("Printer Name", text: $newPrinterName)
                TextField("IP Address", text: $newPrinterIP)
                SecureField("Access Code", text: $newPrinterAccess)
                TextField("Serial Number", text: $newPrinterSerial)
                Button("Add Printer") {
                    manager.addPrinter(BambuPrinterConfig(name: newPrinterName, ip: newPrinterIP, accessCode: newPrinterAccess, serialNumber: newPrinterSerial))
                    newPrinterName = "My Printer"; newPrinterIP = ""; newPrinterAccess = ""; newPrinterSerial = ""
                }.disabled(newPrinterIP == "" || newPrinterAccess == "" || newPrinterSerial == "")
            } header: { Text("Add New Printer") } footer: { Text("Multi-printer support requires Notch apple Pro.") }
            Section { BambuView().frame(maxWidth: .infinity).padding(.vertical) } header: { Text("Preview") }
        }.formStyle(.grouped)
    }
}
