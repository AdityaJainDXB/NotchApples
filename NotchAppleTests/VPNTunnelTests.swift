//
//  VPNTunnelTests.swift
//  Notch apple tests
//
//  "Is a VPN connected?": a utun interface that is up and has a real IPv4 address, and nothing else.
//

import XCTest

final class VPNTunnelTests: XCTestCase {
    private func i(_ name: String, up: Bool = true, ip: String? = nil) -> VPNTunnel.Interface {
        VPNTunnel.Interface(name: name, isUp: up, ipv4: ip)
    }

    func testAnUpTunnelWithAnIPv4AddressMeansConnected() {
        XCTAssertTrue(VPNTunnel.isActive([i("en0", ip: "192.168.1.5"), i("utun4", ip: "10.8.0.2")]))
    }

    func testNoTunnelMeansNotConnected() {
        XCTAssertFalse(VPNTunnel.isActive([]))
        XCTAssertFalse(VPNTunnel.isActive([i("en0", ip: "192.168.1.5"), i("lo0", ip: "127.0.0.1")]))
    }

    func testMacOSOwnTunnelsWithoutIPv4AreNotAVPN() {
        XCTAssertFalse(VPNTunnel.isActive([i("utun0"), i("utun1"), i("utun2")]), "iCloud Private Relay and friends are IPv6 only")
    }

    func testADownTunnelIsNotConnected() {
        XCTAssertFalse(VPNTunnel.isActive([i("utun4", up: false, ip: "10.8.0.2")]))
    }

    func testLinkLocalAndEmptyAddressesAreIgnored() {
        XCTAssertFalse(VPNTunnel.isActive([i("utun3", ip: "169.254.10.2")]))
        XCTAssertFalse(VPNTunnel.isActive([i("utun3", ip: "0.0.0.0")]))
        XCTAssertFalse(VPNTunnel.isActive([i("utun3", ip: "")]))
    }

    func testTheKnownAppListHasNoDuplicatesAndRealBundleIDs() {
        let ids = KnownVPNApps.all.map(\.bundleID)
        XCTAssertEqual(Set(ids).count, ids.count)
        XCTAssertTrue(ids.allSatisfy { $0.contains(".") })
    }

    func testReadingTheRealInterfacesDoesNotCrash() {
        _ = VPNTunnel.current()
        _ = VPNTunnel.isConnected
    }
}
