//
//  VPNTunnel.swift
//  Notch apple
//
//  Is a VPN connected? Apps like Proton VPN, NordVPN, Mullvad, WireGuard or Tunnelblick all create a tunnel network
//  interface (utunN) with an IPv4 address while they are connected. The pure rule is here so it can be unit-tested;
//  `current()` reads the real interfaces.
//

import Foundation

enum VPNTunnel {
    struct Interface: Equatable {
        var name: String
        var isUp: Bool
        var ipv4: String?
    }

    /// True when some utun interface is up and has a usable IPv4 address. macOS's own utun interfaces (iCloud
    /// Private Relay and friends) only have IPv6 link-local addresses, and a link-local 169.254.x.x address is not a tunnel.
    static func isActive(_ interfaces: [Interface]) -> Bool {
        interfaces.contains { i in
            guard i.name.hasPrefix("utun"), i.isUp, let ip = i.ipv4, !ip.isEmpty else { return false }
            return !ip.hasPrefix("169.254.") && ip != "0.0.0.0"
        }
    }

    /// The Mac's real network interfaces right now.
    static func current() -> [Interface] {
        var head: UnsafeMutablePointer<ifaddrs>?
        guard getifaddrs(&head) == 0, let first = head else { return [] }
        defer { freeifaddrs(head) }
        var byName: [String: Interface] = [:]
        for ptr in sequence(first: first, next: { $0.pointee.ifa_next }) {
            let ifa = ptr.pointee
            let name = String(cString: ifa.ifa_name)
            var entry = byName[name] ?? Interface(name: name, isUp: false, ipv4: nil)
            entry.isUp = (ifa.ifa_flags & UInt32(IFF_UP)) != 0 && (ifa.ifa_flags & UInt32(IFF_RUNNING)) != 0
            if let addr = ifa.ifa_addr, addr.pointee.sa_family == UInt8(AF_INET) {
                var host = [CChar](repeating: 0, count: Int(NI_MAXHOST))
                if getnameinfo(addr, socklen_t(addr.pointee.sa_len), &host, socklen_t(host.count), nil, 0, NI_NUMERICHOST) == 0 {
                    entry.ipv4 = String(cString: host)
                }
            }
            byName[name] = entry
        }
        return Array(byName.values)
    }

    static var isConnected: Bool { isActive(current()) }
}

/// VPN apps Notch apple recognises, so adding one is a single click.
enum KnownVPNApps {
    static let all: [(name: String, bundleID: String)] = [
        ("Proton VPN", "ch.protonvpn.mac"),
        ("NordVPN", "com.nordvpn.macos"),
        ("ExpressVPN", "com.expressvpn.ExpressVPN"),
        ("Mullvad VPN", "net.mullvad.vpn"),
        ("Surfshark", "com.surfshark.vpnclient.macos"),
        ("WireGuard", "com.wireguard.macos"),
        ("Tunnelblick", "net.tunnelblick.tunnelblick"),
        ("OpenVPN Connect", "org.openvpn.client.app"),
        ("Cloudflare WARP", "com.cloudflare.1dot1dot1dot1.macos"),
        ("Tailscale", "io.tailscale.ipn.macos"),
        ("Windscribe", "com.windscribe.desktop.macos"),
        ("Private Internet Access", "com.privateinternetaccess.vpn"),
        ("CyberGhost VPN", "de.cyberghostvpn.CyberGhost"),
        ("IPVanish", "com.ipvanish.IPVanish"),
        ("Hotspot Shield", "com.anchorfree.hss.mac"),
    ]
}
