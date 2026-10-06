//
//  SmartHomeView.swift
//  Notch apple
//
//  The Smart Home tab (Ultimate): your Home Assistant lights, switches, fans, covers, scenes and scripts, one tap
//  each, with a slider for dimmable lights. Your server address is kept in settings and your access token in the
//  private secrets file (never in plain preferences). Calls go straight from this Mac to your server.
//  The rules live in SmartHomeLogic.swift.
//

import AppKit
import SwiftUI

@MainActor
final class SmartHomeStore: ObservableObject {
    static let shared = SmartHomeStore()

    @Published private(set) var entities: [HAEntity] = []
    @Published private(set) var status = "Not connected"
    @Published private(set) var loading = false
    @Published private(set) var failed = false
    @AppStorage("smartHome.url") var address = ""
    @Published var token: String
    @AppStorage("smartHome.favourites") private var favouritesRaw = ""

    private init() { token = KeychainHelper.get(.homeAssistantToken) ?? "" }

    var configured: Bool { SmartHomeLogic.normalize(address) != nil && !token.isEmpty }
    var favourites: Set<String> { Set(favouritesRaw.split(separator: ",").map(String.init)) }

    func toggleFavourite(_ id: String) {
        var f = favourites
        if f.contains(id) { f.remove(id) } else { f.insert(id) }
        favouritesRaw = f.sorted().joined(separator: ",")
        objectWillChange.send()
    }

    func save(address: String, token: String) async {
        self.address = SmartHomeLogic.normalize(address)?.absoluteString ?? address
        self.token = token.trimmingCharacters(in: .whitespacesAndNewlines)
        KeychainHelper.set(self.token, for: .homeAssistantToken)
        await refresh()
    }

    func disconnect() {
        token = ""; entities = []; status = "Not connected"
        KeychainHelper.delete(.homeAssistantToken)
    }

    private func request(_ path: String, method: String = "GET", body: [String: Any]? = nil) async throws -> Data {
        guard let base = SmartHomeLogic.normalize(address), let url = URL(string: path, relativeTo: base) else { throw URLError(.badURL) }
        var r = URLRequest(url: url, timeoutInterval: 8)
        r.httpMethod = method
        r.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        if let body { r.setValue("application/json", forHTTPHeaderField: "Content-Type"); r.httpBody = try JSONSerialization.data(withJSONObject: body) }
        let (data, response) = try await URLSession.shared.data(for: r)
        if let code = (response as? HTTPURLResponse)?.statusCode, code >= 400 {
            throw NSError(domain: "HA", code: code, userInfo: [NSLocalizedDescriptionKey: code == 401 ? "Home Assistant didn't accept that token." : "Home Assistant answered \(code)."])
        }
        return data
    }

    func refresh() async {
        guard configured else { return }
        loading = true
        defer { loading = false }
        do {
            let data = try await request("/api/states")
            entities = SmartHomeLogic.parse(data)
            status = SmartHomeLogic.summary(entities)
            failed = false
        } catch {
            failed = true
            let ns = error as NSError
            status = ns.domain == "HA" ? ns.localizedDescription : "Can't reach \(address). Is it on this network?"
        }
    }

    func press(_ e: HAEntity) async {
        let s = SmartHomeLogic.service(for: e)
        _ = try? await request("/api/services/\(s.domain)/\(s.service)", method: "POST", body: ["entity_id": e.id])
        try? await Task.sleep(for: .milliseconds(350))
        await refresh()
    }

    func dim(_ e: HAEntity, to percent: Int) async {
        _ = try? await request("/api/services/light/turn_on", method: "POST", body: SmartHomeLogic.brightnessBody(entity: e.id, percent: percent))
        await refresh()
    }
}

struct SmartHomeView: View {
    @StateObject private var store = SmartHomeStore.shared
    @State private var addressField = ""
    @State private var tokenField = ""
    @State private var editing = false

    var body: some View {
        GlassCard {
            if !store.configured || editing { connectForm } else { deviceList }
        }
        .task {
            addressField = store.address; tokenField = store.token
            while !Task.isCancelled {
                await store.refresh()
                try? await Task.sleep(for: .seconds(6))
            }
        }
    }

    // MARK: Connect

    private var connectForm: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text("Connect Home Assistant").sectionTitle()
            Text("Controls your lights, switches, scenes and more. Home Assistant also connects Philips Hue, IKEA, Zigbee and Matter devices, so this covers them too.")
                .font(.system(size: 12)).foregroundStyle(Theme.textSecondary)
            TextField("Address, e.g. homeassistant.local:8123", text: $addressField).textFieldStyle(.roundedBorder)
            SecureField("Long-lived access token", text: $tokenField).textFieldStyle(.roundedBorder)
            Text("In Home Assistant: your profile, then Security, then Long-lived access tokens, then Create token. It stays on this Mac.")
                .font(.system(size: 11)).foregroundStyle(Theme.textSecondary)
            HStack {
                Button("Connect") {
                    Task { await store.save(address: addressField, token: tokenField); editing = store.failed }
                }
                .buttonStyle(PurpleButtonStyle())
                .disabled(SmartHomeLogic.normalize(addressField) == nil || tokenField.trimmingCharacters(in: .whitespaces).isEmpty)
                if editing { Button("Cancel") { editing = false }.buttonStyle(PurpleButtonStyle(prominent: false)) }
                if store.failed { Text(store.status).font(.system(size: 12)).foregroundStyle(.orange) }
            }
            Spacer(minLength: 0)
        }
    }

    // MARK: Devices

    private var deviceList: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack {
                Text("Smart Home").sectionTitle()
                Text(store.status).font(.system(size: 12)).foregroundStyle(store.failed ? Color.orange : Theme.textSecondary)
                Spacer()
                Button { Task { await store.refresh() } } label: { Image(systemName: "arrow.clockwise") }
                    .buttonStyle(.plain).foregroundStyle(Theme.textSecondary).help("Refresh")
                Button { editing = true } label: { Image(systemName: "gearshape") }
                    .buttonStyle(.plain).foregroundStyle(Theme.textSecondary).help("Connection")
            }
            if store.entities.isEmpty {
                Text(store.failed ? "" : "No lights, switches or scenes found.").foregroundStyle(Theme.textSecondary)
            }
            ScrollView {
                VStack(alignment: .leading, spacing: 10) {
                    let favs = store.entities.filter { store.favourites.contains($0.id) }
                    if !favs.isEmpty { section("Favourites", favs) }
                    ForEach(SmartHomeLogic.domains, id: \.self) { d in
                        let items = store.entities.filter { $0.domain == d }
                        if !items.isEmpty { section(SmartHomeLogic.title(for: d), items) }
                    }
                }
            }
        }
    }

    private func section(_ title: String, _ items: [HAEntity]) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(title).font(.system(size: 12, weight: .semibold)).foregroundStyle(Theme.textSecondary)
            LazyVGrid(columns: [GridItem(.adaptive(minimum: 150), spacing: 8)], spacing: 8) {
                ForEach(items) { tile($0) }
            }
        }
    }

    private func tile(_ e: HAEntity) -> some View {
        let on = e.isOn && !e.isButton
        return VStack(alignment: .leading, spacing: 4) {
            HStack(spacing: 6) {
                Image(systemName: symbol(e)).foregroundStyle(on ? Color.yellow : Theme.textSecondary)
                Text(e.name).font(.system(size: 12, weight: .semibold)).foregroundStyle(.white).lineLimit(1)
                Spacer(minLength: 0)
                Button { store.toggleFavourite(e.id) } label: { Image(systemName: store.favourites.contains(e.id) ? "star.fill" : "star") }
                    .buttonStyle(.plain).foregroundStyle(store.favourites.contains(e.id) ? Color.yellow : Theme.textSecondary).font(.system(size: 10))
            }
            Text(e.isButton ? "Tap to run" : e.state.capitalized).font(.system(size: 11)).foregroundStyle(Theme.textSecondary)
            if on, let pct = SmartHomeLogic.brightnessPercent(e) {
                Slider(value: Binding(get: { Double(pct) }, set: { v in Task { await store.dim(e, to: Int(v)) } }), in: 1...100)
                    .controlSize(.mini)
            }
        }
        .padding(9)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(on ? Theme.accent.opacity(0.28) : Theme.surface, in: RoundedRectangle(cornerRadius: 11))
        .opacity(e.isAvailable ? 1 : 0.4)
        .contentShape(RoundedRectangle(cornerRadius: 11))
        .onTapGesture { if e.isAvailable { Task { await store.press(e) } } }
    }

    private func symbol(_ e: HAEntity) -> String {
        switch e.domain {
        case "light": e.isOn ? "lightbulb.fill" : "lightbulb"
        case "switch", "input_boolean": e.isOn ? "power.circle.fill" : "power.circle"
        case "fan": "fan.fill"
        case "cover": e.isOn ? "door.garage.open" : "door.garage.closed"
        case "scene": "sparkles"
        case "script": "play.circle"
        default: "circle"
        }
    }
}
