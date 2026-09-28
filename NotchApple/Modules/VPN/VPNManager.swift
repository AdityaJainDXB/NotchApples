//
//  VPNManager.swift
//  Notch apple
//
//  Zero-cost VPN client scaffolding.
//
//  There are no Notch apple servers. Users bring free tunnels:
//   • Import a local WireGuard `.conf` or OpenVPN `.ovpn` file, or
//   • Pick from the free .ovpn library (github.com/Zoult/.ovpn), fetched live
//     so it stays current and nothing third-party is redistributed in the app, or
//   • Browse the free, volunteer-run VPN Gate relay list (vpngate.net).
//
//  How a profile connects depends on what the build is signed with:
//   • IKEv2 profiles use `NEVPNManager` (needs the Personal VPN entitlement).
//   • WireGuard / OpenVPN use `NETunnelProviderManager`, which needs a Packet
//     Tunnel Provider extension (e.g. wireguard-apple / OpenVPNAdapter) and the
//     Network Extension entitlement — both require a paid Apple Developer team.
//   • In the free, ad-hoc-signed build, we hand the profile to the official
//     WireGuard / Tunnelblick / OpenVPN Connect app instead, so it still works.
//

import Foundation
import NetworkExtension
import AppKit

struct VPNProfile: Identifiable, Codable, Hashable {
    enum Kind: String, Codable { case wireGuard = "WireGuard", openVPN = "OpenVPN", ikev2 = "IKEv2" }
    var id = UUID()
    var name: String
    var kind: Kind
    var server: String
    var config: String          // raw profile text (empty until downloaded for library entries)
    var country: String?
    /// Where to download `config` from, for library entries that are fetched on demand.
    var remoteURL: URL?
    /// Page that shows this server's current username / password, if it needs one.
    var credentialsURL: URL?
    /// Free-text login hint, e.g. "vpn / vpn" for VPN Gate.
    var credentialsHint: String?
}

@MainActor
final class VPNManager: ObservableObject {
    static let shared = VPNManager()

    /// Bundle ID of the Packet Tunnel Provider, once you add one (see README).
    static let tunnelProviderBundleID = "com.notchapple.app.tunnel"

    @Published private(set) var profiles: [VPNProfile] = []
    @Published private(set) var status: NEVPNStatus = .invalid
    @Published var message: String?
    @Published private(set) var vpnGate: [VPNProfile] = []
    @Published private(set) var loadingGate = false
    /// Free .ovpn library entries, grouped for display.
    @Published private(set) var library: [VPNProfile] = []
    @Published private(set) var loadingLibrary = false

    private let key = "vpn.profiles"
    private var observer: NSObjectProtocol?

    init() {
        if let data = UserDefaults.standard.data(forKey: key),
           let saved = try? JSONDecoder().decode([VPNProfile].self, from: data) { profiles = saved }
        observer = NotificationCenter.default.addObserver(forName: .NEVPNStatusDidChange, object: nil, queue: .main) { [weak self] n in
            let status = (n.object as? NEVPNConnection)?.status
            Task { @MainActor in if let status { self?.status = status } }
        }
    }

    // MARK: Library

    /// Parses and stores a WireGuard or OpenVPN config file.
    func importProfile(from url: URL) {
        let access = url.startAccessingSecurityScopedResource()
        defer { if access { url.stopAccessingSecurityScopedResource() } }
        guard let text = try? String(contentsOf: url, encoding: .utf8) else { message = "Couldn't read file"; return }
        let isWG = text.contains("[Interface]") && text.contains("[Peer]")
        let server = Self.parseServer(text, wireGuard: isWG) ?? "unknown"
        add(VPNProfile(name: url.deletingPathExtension().lastPathComponent,
                       kind: isWG ? .wireGuard : .openVPN, server: server, config: text))
    }

    func add(_ profile: VPNProfile) {
        profiles.append(profile)
        persist()
    }

    func remove(_ profile: VPNProfile) {
        profiles.removeAll { $0.id == profile.id }
        persist()
    }

    private func persist() {
        if let data = try? JSONEncoder().encode(profiles) { UserDefaults.standard.set(data, forKey: key) }
    }

    static func parseServer(_ text: String, wireGuard: Bool) -> String? {
        for line in text.split(whereSeparator: \.isNewline) {
            let l = line.trimmingCharacters(in: .whitespaces)
            if wireGuard, l.lowercased().hasPrefix("endpoint") {
                return l.split(separator: "=", maxSplits: 1).last?.trimmingCharacters(in: .whitespaces)
            }
            if !wireGuard, l.hasPrefix("remote ") {
                return l.split(separator: " ").dropFirst().first.map(String.init)
            }
        }
        return nil
    }

    // MARK: VPN Gate (free public relays)

    /// Downloads the public VPN Gate list (CSV; OpenVPN configs are base64 in the last column).
    func loadVPNGate() async {
        loadingGate = true
        defer { loadingGate = false }
        do {
            let (data, _) = try await URLSession.shared.data(from: URL(string: "https://www.vpngate.net/api/iphone/")!)
            let csv = String(decoding: data, as: UTF8.self)
            vpnGate = csv.split(whereSeparator: \.isNewline)
                .filter { !$0.hasPrefix("*") && !$0.hasPrefix("#") }
                .compactMap { line -> VPNProfile? in
                    let cols = line.split(separator: ",", omittingEmptySubsequences: false).map(String.init)
                    guard cols.count >= 15,
                          let cfgData = Data(base64Encoded: cols[14]),
                          let cfg = String(data: cfgData, encoding: .utf8) else { return nil }
                    return VPNProfile(name: "\(cols[6]) · \(cols[0])", kind: .openVPN, server: cols[1], config: cfg,
                                      country: cols[6], credentialsHint: "vpn / vpn")
                }
                .prefix(40).map { $0 }
            if vpnGate.isEmpty { message = "VPN Gate returned no servers." }
        } catch {
            message = "VPN Gate unavailable: \(error.localizedDescription)"
        }
    }

    // MARK: Free .ovpn library (github.com/Zoult/.ovpn)

    private static let libraryRepo = "Zoult/.ovpn"

    /// Lists every .ovpn in the library. Configs themselves download on Connect.
    func loadLibrary() async {
        loadingLibrary = true
        defer { loadingLibrary = false }
        struct Tree: Decodable { struct Item: Decodable { let path: String; let type: String }; let tree: [Item] }
        do {
            let api = URL(string: "https://api.github.com/repos/\(Self.libraryRepo)/git/trees/HEAD?recursive=1")!
            let (data, _) = try await URLSession.shared.data(from: api)
            let items = try JSONDecoder().decode(Tree.self, from: data).tree
            library = items.filter { $0.type == "blob" && $0.path.hasSuffix(".ovpn") }
                .compactMap { Self.libraryProfile(path: $0.path) }
                .sorted { ($0.country ?? "", $0.name) < ($1.country ?? "", $1.name) }
            if library.isEmpty { message = "The free VPN library is empty right now." }
        } catch {
            message = "Couldn't load the free VPN library: \(error.localizedDescription)"
        }
    }

    /// Turns a path like `Japan/IPS_1.66.34.131_tcp_1194.ovpn` into a profile.
    private static func libraryProfile(path: String) -> VPNProfile? {
        let parts = path.split(separator: "/")
        guard parts.count == 2 else { return nil }
        let country = String(parts[0])
        let file = String(parts[1].dropLast(5))           // drop ".ovpn"
        let prefix = file.split(separator: "_").first.map(String.init) ?? ""
        let lower = file.lowercased()
        let proto = lower.contains("tcp") ? "TCP" : lower.contains("udp") ? "UDP" : ""

        // Providers the library collects from; some rotate their passwords.
        let provider: String
        var credentials: URL?
        switch prefix {
        case "VBK":
            provider = "VPNBook"; credentials = URL(string: "https://www.vpnbook.com/freevpn")
        case "FV4Y", "FN4Y":
            provider = "FreeVPN4You"; credentials = URL(string: "https://freevpn4you.net/locations/\(country.lowercased()).php")
        case "FOV":
            provider = "FreeOpenVPN"; credentials = URL(string: "https://www.freeopenvpn.org/premium.php?cntid=\(country)")
        case "IPS":
            provider = "IPSpeed"
        default:
            provider = prefix
        }
        let encoded = path.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed) ?? path
        return VPNProfile(
            name: "\(country) · \(provider)\(proto.isEmpty ? "" : " · \(proto)")",
            kind: .openVPN,
            server: file.replacingOccurrences(of: "\(prefix)_", with: ""),
            config: "",
            country: country,
            remoteURL: URL(string: "https://raw.githubusercontent.com/\(libraryRepo)/HEAD/\(encoded)"),
            credentialsURL: credentials,
            credentialsHint: credentials == nil ? "No login needed" : nil)
    }

    /// Downloads the config for a library entry if it hasn't been fetched yet.
    private func resolved(_ profile: VPNProfile) async throws -> VPNProfile {
        guard profile.config.isEmpty, let url = profile.remoteURL else { return profile }
        let (data, _) = try await URLSession.shared.data(from: url)
        var p = profile
        p.config = String(decoding: data, as: UTF8.self)
        if let server = Self.parseServer(p.config, wireGuard: false) { p.server = server }
        return p
    }

    // MARK: Connect

    func connect(_ profileArg: VPNProfile) async {
        message = nil
        let profile: VPNProfile
        do { profile = try await resolved(profileArg) } catch {
            message = "Couldn't download that server's profile: \(error.localizedDescription)"
            return
        }
        switch profile.kind {
        case .ikev2:
            await connectIKEv2(profile)
        case .wireGuard, .openVPN:
            if await connectTunnelProvider(profile) { return }
            handOff(profile)
        }
    }

    func disconnect() {
        NEVPNManager.shared().connection.stopVPNTunnel()
        NETunnelProviderManager.loadAllFromPreferences { managers, _ in
            managers?.forEach { $0.connection.stopVPNTunnel() }
        }
    }

    private func connectIKEv2(_ profile: VPNProfile) async {
        let manager = NEVPNManager.shared()
        do {
            try await manager.loadFromPreferences()
            let proto = NEVPNProtocolIKEv2()
            proto.serverAddress = profile.server
            proto.remoteIdentifier = profile.server
            proto.useExtendedAuthentication = true
            manager.protocolConfiguration = proto
            manager.localizedDescription = "Notch apple · \(profile.name)"
            manager.isEnabled = true
            try await manager.saveToPreferences()
            try manager.connection.startVPNTunnel()
        } catch {
            message = "IKEv2 needs a build signed with the Personal VPN entitlement. (\(error.localizedDescription))"
        }
    }

    /// Uses a Packet Tunnel Provider if this build ships one. Returns false if unavailable.
    private func connectTunnelProvider(_ profile: VPNProfile) async -> Bool {
        guard Bundle.main.builtInPlugInsURL.map({ FileManager.default.fileExists(atPath: $0.appendingPathComponent("NotchTunnel.appex").path) }) == true
        else { return false }
        do {
            let managers = try await NETunnelProviderManager.loadAllFromPreferences()
            let manager = managers.first ?? NETunnelProviderManager()
            let proto = NETunnelProviderProtocol()
            proto.providerBundleIdentifier = Self.tunnelProviderBundleID
            proto.serverAddress = profile.server
            proto.providerConfiguration = ["kind": profile.kind.rawValue, "config": profile.config]
            manager.protocolConfiguration = proto
            manager.localizedDescription = "Notch apple · \(profile.name)"
            manager.isEnabled = true
            try await manager.saveToPreferences()
            try await manager.loadFromPreferences()
            try manager.connection.startVPNTunnel()
            return true
        } catch {
            message = error.localizedDescription
            return false
        }
    }

    /// Free-build fallback: write the profile to Downloads and open it with the
    /// official client (WireGuard, Tunnelblick, or OpenVPN Connect).
    private func handOff(_ profile: VPNProfile) {
        let ext = profile.kind == .wireGuard ? "conf" : "ovpn"
        let safe = profile.name.replacingOccurrences(of: "/", with: "-")
        let url = FileManager.default.urls(for: .downloadsDirectory, in: .userDomainMask)[0]
            .appendingPathComponent("\(safe).\(ext)")
        do {
            try profile.config.write(to: url, atomically: true, encoding: .utf8)
            let candidates = profile.kind == .wireGuard
                ? ["com.wireguard.macos"]
                : ["net.tunnelblick.tunnelblick", "org.openvpn.client.app"]
            if let app = candidates.lazy.compactMap({ NSWorkspace.shared.urlForApplication(withBundleIdentifier: $0) }).first {
                NSWorkspace.shared.open([url], withApplicationAt: app, configuration: NSWorkspace.OpenConfiguration())
                message = "Opened in \(app.deletingPathExtension().lastPathComponent). Approve the import there, then click Connect."
                    + (profile.credentialsHint.map { " Login: \($0)." } ?? "")
                if let page = profile.credentialsURL {
                    NSWorkspace.shared.open(page)
                    message = (message ?? "") + " The username and password are on the page that just opened in your browser."
                }
            } else {
                NSWorkspace.shared.activateFileViewerSelecting([url])
                message = "Saved \(url.lastPathComponent) to Downloads. Install the free \(profile.kind == .wireGuard ? "WireGuard" : "Tunnelblick") app to connect."
            }
        } catch {
            message = "Couldn't export profile: \(error.localizedDescription)"
        }
    }
}

extension NEVPNStatus {
    var label: String {
        switch self {
        case .connected: "Connected"
        case .connecting: "Connecting…"
        case .disconnecting: "Disconnecting…"
        case .reasserting: "Reconnecting…"
        case .disconnected: "Disconnected"
        default: "Not configured"
        }
    }
}
