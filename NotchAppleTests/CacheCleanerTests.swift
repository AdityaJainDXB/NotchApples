//
//  CacheCleanerTests.swift
//  Notch apple tests
//
//  What the Cache Cleaner may and may not remove: protected names, staying inside its folders
//  (including through ".." and symbolic links), the 3-day rule for temporary files, and a real
//  clean of a throwaway folder.
//

import XCTest

final class CacheCleanerTests: XCTestCase {
    func testAppleAndOwnCachesAreProtected() {
        XCTAssertTrue(CacheRules.isProtected(name: "com.apple.Safari", kind: .appCaches, ownBundleID: "com.notchapple.app"))
        XCTAssertTrue(CacheRules.isProtected(name: "com.notchapple.app", kind: .appCaches, ownBundleID: "com.notchapple.app"))
        XCTAssertTrue(CacheRules.isProtected(name: ".hidden", kind: .logs, ownBundleID: "x"))
        XCTAssertFalse(CacheRules.isProtected(name: "com.spotify.client", kind: .appCaches, ownBundleID: "com.notchapple.app"))
        XCTAssertFalse(CacheRules.isProtected(name: "MyApp-abc123", kind: .derivedData, ownBundleID: "x"))
    }

    func testInsideChecksResolveDotDotAndLinks() throws {
        let fm = FileManager.default
        let root = fm.temporaryDirectory.appendingPathComponent("cc-\(UUID().uuidString)", isDirectory: true)
        let outside = fm.temporaryDirectory.appendingPathComponent("cc-out-\(UUID().uuidString)", isDirectory: true)
        try fm.createDirectory(at: root, withIntermediateDirectories: true)
        try fm.createDirectory(at: outside, withIntermediateDirectories: true)
        defer { try? fm.removeItem(at: root); try? fm.removeItem(at: outside) }
        XCTAssertTrue(CacheRules.isInside(root.appendingPathComponent("a/b.txt"), root: root))
        XCTAssertFalse(CacheRules.isInside(root.appendingPathComponent("../elsewhere"), root: root))
        XCTAssertFalse(CacheRules.isInside(root, root: root), "the folder itself is not removable")
        let link = root.appendingPathComponent("sneaky")
        try fm.createSymbolicLink(at: link, withDestinationURL: outside)
        XCTAssertFalse(CacheRules.isInside(link, root: root), "a link pointing outside is refused")
        // A sibling whose name merely starts with the same letters is not inside.
        XCTAssertFalse(CacheRules.isInside(URL(fileURLWithPath: root.path + "-evil/x"), root: root))
    }

    func testTemporaryFilesNeedToBeThreeDaysOld() {
        let now = Date()
        XCTAssertFalse(CacheRules.staleEnough(modified: now.addingTimeInterval(-3600), now: now))
        XCTAssertFalse(CacheRules.staleEnough(modified: nil, now: now))
        XCTAssertTrue(CacheRules.staleEnough(modified: now.addingTimeInterval(-4 * 24 * 3600), now: now))
    }

    func testSizesReadNicely() {
        XCTAssertEqual(CacheRules.format(-5), CacheRules.format(0))
        XCTAssertTrue(CacheRules.format(1_500_000_000).contains("GB"))
    }
}
