//
//  HotCornerTests.swift
//  Notch apple tests
//
//  Which corner a point is in (and that corners between two displays are ignored),
//  and how a typed website becomes a URL.
//

import XCTest

final class HotCornerTests: XCTestCase {
    private let one = [CGRect(x: 0, y: 0, width: 1440, height: 900)]

    func testFourCorners() {
        XCTAssertEqual(HotCornerGeometry.corner(at: CGPoint(x: 0, y: 899.5), screens: one), .topLeft)
        XCTAssertEqual(HotCornerGeometry.corner(at: CGPoint(x: 1439.5, y: 899.5), screens: one), .topRight)
        XCTAssertEqual(HotCornerGeometry.corner(at: CGPoint(x: 0.5, y: 0.5), screens: one), .bottomLeft)
        XCTAssertEqual(HotCornerGeometry.corner(at: CGPoint(x: 1439, y: 1), screens: one), .bottomRight)
    }

    func testEdgesAndMiddleAreNotCorners() {
        XCTAssertNil(HotCornerGeometry.corner(at: CGPoint(x: 720, y: 899.5), screens: one))   // top edge, middle
        XCTAssertNil(HotCornerGeometry.corner(at: CGPoint(x: 0, y: 450), screens: one))        // left edge, middle
        XCTAssertNil(HotCornerGeometry.corner(at: CGPoint(x: 100, y: 100), screens: one))
        XCTAssertNil(HotCornerGeometry.corner(at: CGPoint(x: 10, y: 890), screens: one))       // 10 pt in: not the corner
    }

    func testCornerWhereTwoDisplaysMeetIsIgnored() {
        let two = [CGRect(x: 0, y: 0, width: 1440, height: 900), CGRect(x: 1440, y: 0, width: 1920, height: 1080)]
        XCTAssertNil(HotCornerGeometry.corner(at: CGPoint(x: 1439.5, y: 0.5), screens: two))   // bottom-right of the first, touching the second
        XCTAssertEqual(HotCornerGeometry.corner(at: CGPoint(x: 3359.5, y: 1079.5), screens: two), .topRight) // far corner of the second
        XCTAssertEqual(HotCornerGeometry.corner(at: CGPoint(x: 0.5, y: 899.5), screens: two), .topLeft)
    }

    func testWebsiteText() {
        XCTAssertEqual(HotCornerURL.url(from: "youtube.com")?.absoluteString, "https://youtube.com")
        XCTAssertEqual(HotCornerURL.url(from: " https://apple.com/mac ")?.absoluteString, "https://apple.com/mac")
        XCTAssertEqual(HotCornerURL.url(from: "http://localhost:3000")?.host, "localhost")
        XCTAssertNil(HotCornerURL.url(from: ""))
        XCTAssertNil(HotCornerURL.url(from: "not a url"))
        XCTAssertNil(HotCornerURL.url(from: "file:///etc/passwd"))
        XCTAssertNil(HotCornerURL.url(from: "javascript:alert(1)"))
    }
}
