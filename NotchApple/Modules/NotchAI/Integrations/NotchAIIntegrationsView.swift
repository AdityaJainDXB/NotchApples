//
//  NotchAIIntegrationsView.swift
//  Notch Apple
//
//  The Integrations section (Pro): connect MCP servers (a remote address with an optional key, or a local command),
//  see their state (connecting, connected, expired, failed), what each can reach, and set each tool to ask each time,
//  read-only or blocked. Disconnect or remove at any time; removing deletes the saved key.
//

import SwiftUI

struct NotchAIIntegrationsView: View {
    @ObservedObject private var store = MCPStore.shared
    @State private var adding = false
    @State private var tokenHint: String?
    @State private var remote = true
    @State private var name = ""
    @State private var address = ""
    @State private var key = ""
    @State private var command = ""
    @State private var args = ""
    private var unlocked: Bool { NotchAITier.allows(.pro) }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 10) {
                if !unlocked { Label(NotchAITier.lockedMessage(.pro), systemImage: "lock.fill").font(.system(size: 11)).foregroundStyle(.orange) }
                HStack {
                    Text("MCP connectors").font(.system(size: 12, weight: .semibold)).foregroundStyle(.white)
                    Spacer()
                    Button(adding ? "Close" : "Add a connector") { adding.toggle() }.disabled(!unlocked).controlSize(.small)
                }
                presets
                if adding { form }
                if let p = store.problem { Text(p).font(.system(size: 11)).foregroundStyle(.orange) }
                if store.servers.isEmpty {
                    Text("No connectors yet. A connector gives NotchAI tools from another service (an MCP server). Every tool asks before it runs unless you mark it read-only, and you can block any tool. Notion, Linear, Sentry and GitHub have a button above. Google does not offer a Gmail connector of this kind yet, so Gmail needs a server you add by address.")
                        .font(.system(size: 11)).foregroundStyle(Theme.textSecondary)
                }
                ForEach(store.servers) { s in card(s) }
            }
        }
    }

    /// One-press connectors for services that run their own MCP server.
    private var presets: some View {
        VStack(alignment: .leading, spacing: 4) {
            HStack(spacing: 6) {
                ForEach(ConnectorCatalog.presets) { p in
                    let count = ConnectorCatalog.accounts(of: p, in: store.servers.map(\.url))
                    Button(count == 0 ? p.name : "\(p.name) (add another account)") { add(p) }
                        .controlSize(.small).disabled(!unlocked).help(p.about)
                }
            }
            Text("These sign in on the service's own site in your browser; NotchAI never sees your password. Nothing connects until you press one.")
                .font(.system(size: 10)).foregroundStyle(Theme.textSecondary)
        }
    }

    private func add(_ p: ConnectorPreset) {
        let free = ConnectorCatalog.freeName(p.name, taken: store.servers.map(\.name))
        switch p.signIn {
        case .browser:
            store.addRemoteWithBrowserSignIn(name: free, address: p.address)
        case .token(let hint):
            // A token has to be pasted, so open the form filled in and say where the token comes from.
            adding = true; remote = true; name = free; address = p.address; key = ""
            tokenHint = hint
        }
    }

    private var form: some View {
        VStack(alignment: .leading, spacing: 6) {
            Picker("", selection: $remote) { Text("Remote address").tag(true); Text("Local command").tag(false) }.pickerStyle(.segmented).labelsHidden().frame(width: 260)
            TextField("Name", text: $name).textFieldStyle(.roundedBorder)
            if remote {
                TextField("Address (https://…)", text: $address).textFieldStyle(.roundedBorder)
                SecureField("Key (optional, kept in the app's private store)", text: $key).textFieldStyle(.roundedBorder)
                if let h = tokenHint { Text(h).font(.system(size: 10)).foregroundStyle(.orange) }
                Text("Requests go to this address and nowhere else. Nothing connects until you press Connect.").font(.system(size: 10)).foregroundStyle(Theme.textSecondary)
            } else {
                TextField("Command (e.g. npx)", text: $command).textFieldStyle(.roundedBorder)
                TextField("Arguments (e.g. -y some-mcp-server)", text: $args).textFieldStyle(.roundedBorder)
                Label("This runs a program on your Mac while connected. Only add commands you trust.", systemImage: "exclamationmark.triangle.fill")
                    .font(.system(size: 10)).foregroundStyle(.orange)
            }
            if remote {
                Button("Sign in with your browser") {
                    if store.addRemoteWithBrowserSignIn(name: name, address: address) { adding = false; name = ""; address = ""; key = ""; command = ""; args = "" }
                }
                .disabled(name.trimmingCharacters(in: .whitespaces).isEmpty || address.isEmpty)
                .help("For services whose MCP server offers sign-in. No key to paste.")
            }
            Button("Add") {
                let ok = remote ? store.addRemote(name: name, address: address, key: key) : store.addLocal(name: name, command: command, arguments: args)
                if ok { adding = false; name = ""; address = ""; key = ""; command = ""; args = ""; tokenHint = nil }
            }.disabled(name.trimmingCharacters(in: .whitespaces).isEmpty)
        }
        .padding(8).background(Theme.surface, in: RoundedRectangle(cornerRadius: 8))
    }

    private func card(_ s: MCPServerConfig) -> some View {
        let state = store.states[s.id] ?? .disconnected
        let tools = store.tools[s.id] ?? []
        return VStack(alignment: .leading, spacing: 5) {
            HStack {
                Circle().fill(color(state)).frame(width: 8, height: 8)
                VStack(alignment: .leading, spacing: 1) {
                    Text(s.name).font(.system(size: 12, weight: .semibold)).foregroundStyle(.white)
                    Text(s.kind == .remote ? s.url : "\(s.command) \(s.arguments.joined(separator: " "))")
                        .font(.system(size: 9, design: .monospaced)).foregroundStyle(Theme.textSecondary).lineLimit(1)
                }
                Spacer()
                Text(state.title).font(.system(size: 10)).foregroundStyle(Theme.textSecondary)
                if state == .connected {
                    Button("Refresh tools") { store.refresh(s.id) }.controlSize(.small)
                    Button("Disconnect") { store.disconnect(s.id) }.controlSize(.small)
                } else {
                    Button(s.oauth == true ? (state == .expired ? "Sign in again" : "Sign in") : (state == .expired ? "Reconnect" : "Connect")) {
                        if s.oauth == true && state != .disconnected && state != .connecting { store.signIn(s.id) } else if s.oauth == true { store.connect(s.id) } else { store.connect(s.id) }
                    }.controlSize(.small).disabled(state == .connecting || !unlocked)
                }
                Button { store.remove(s.id) } label: { Image(systemName: "trash") }.buttonStyle(.plain).foregroundStyle(.red.opacity(0.8))
            }
            if case .failed(let why) = state { Text(why).font(.system(size: 10)).foregroundStyle(.red) }
            if state == .expired { Text(s.oauth == true ? "Your sign-in ended. Press Sign in again." : "The service refused the key. Remove the connector and add it again with a new key.").font(.system(size: 10)).foregroundStyle(.orange) }
            if state == .connected {
                Text(MCPNaming.accessSummary(tools)).font(.system(size: 10)).foregroundStyle(Theme.textSecondary)
                ForEach(tools, id: \.name) { t in
                    HStack {
                        VStack(alignment: .leading, spacing: 0) {
                            Text(t.name).font(.system(size: 10, weight: .medium, design: .monospaced)).foregroundStyle(.white)
                            if !t.description.isEmpty { Text(t.description).font(.system(size: 9)).foregroundStyle(Theme.textSecondary).lineLimit(1) }
                        }
                        Spacer()
                        Picker("", selection: Binding(get: { s.permissions[t.name] ?? .ask }, set: { store.setPermission(s.id, tool: t.name, $0) })) {
                            ForEach(MCPToolPermission.allCases) { Text($0.title).tag($0) }
                        }.labelsHidden().frame(width: 210)
                    }
                }
            }
        }
        .padding(8).background(Theme.surface, in: RoundedRectangle(cornerRadius: 9))
    }

    private func color(_ s: MCPConnectionState) -> Color {
        switch s { case .connected: NotchAIView.green; case .connecting: .yellow; case .expired: .orange; case .failed: .red; case .disconnected: .gray }
    }
}
