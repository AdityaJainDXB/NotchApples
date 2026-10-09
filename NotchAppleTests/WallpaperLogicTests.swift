//
//  WallpaperLogicTests.swift
//  Notch apple tests
//
//  What video a wallpaper accepts, when it plays, and the free library's list.
//

import XCTest

final class WallpaperLogicTests: XCTestCase {
    func testAGoodVideoPasses() {
        XCTAssertNil(WallpaperLogic.validate(hasVideo: true, seconds: 59.9, bytes: 300 * 1_048_576, width: 3840, height: 2160))
        XCTAssertNil(WallpaperLogic.validate(hasVideo: true, seconds: 60.4, bytes: 10, width: 1920, height: 1080))
        XCTAssertNil(WallpaperLogic.validate(hasVideo: true, seconds: 5, bytes: 10, width: 4096, height: 2160), "cinema 4K")
        XCTAssertNil(WallpaperLogic.validate(hasVideo: true, seconds: 5, bytes: 10, width: 2160, height: 3840), "a rotated phone video")
    }

    func testTooLongTooBigTooLargeAndNotVideoAreRefused() {
        XCTAssertEqual(WallpaperLogic.validate(hasVideo: true, seconds: 61, bytes: 10, width: 1920, height: 1080), .tooLong(61))
        XCTAssertEqual(WallpaperLogic.validate(hasVideo: true, seconds: 300, bytes: 10, width: 1920, height: 1080), .tooLong(300))
        XCTAssertEqual(WallpaperLogic.validate(hasVideo: true, seconds: 30, bytes: 900 * 1_048_576, width: 1920, height: 1080), .tooBig(900))
        XCTAssertEqual(WallpaperLogic.validate(hasVideo: true, seconds: 30, bytes: 10, width: 7680, height: 4320), .tooLarge(7680, 4320))
        XCTAssertEqual(WallpaperLogic.validate(hasVideo: false, seconds: nil, bytes: 10, width: 0, height: 0), .notVideo)
        XCTAssertEqual(WallpaperLogic.validate(hasVideo: true, seconds: nil, bytes: 10, width: 1920, height: 1080), .unreadable)
        XCTAssertEqual(WallpaperLogic.validate(hasVideo: true, seconds: .nan, bytes: 10, width: 1920, height: 1080), .unreadable)
        XCTAssertEqual(WallpaperLogic.validate(hasVideo: true, seconds: 0, bytes: 10, width: 1920, height: 1080), .unreadable)
    }

    func testEveryProblemHasPlainWords() {
        for p in [WallpaperLogic.Problem.notVideo, .unreadable, .tooLong(90), .tooBig(900), .tooLarge(7680, 4320)] { XCTAssertFalse(p.message.isEmpty) }
        XCTAssertTrue(WallpaperLogic.Problem.tooLong(90).message.contains("90"))
    }

    func testVideoFilesByExtension() {
        XCTAssertTrue(WallpaperLogic.isVideoFile("Holiday.MOV")); XCTAssertTrue(WallpaperLogic.isVideoFile("a.mp4")); XCTAssertTrue(WallpaperLogic.isVideoFile("a.m4v"))
        XCTAssertFalse(WallpaperLogic.isVideoFile("a.png")); XCTAssertFalse(WallpaperLogic.isVideoFile("mp4"))
    }

    func testNamesAreCleaned() {
        XCTAssertEqual(WallpaperLogic.cleanName("My Cool Clip.mp4"), "My Cool Clip")
        XCTAssertEqual(WallpaperLogic.cleanName("../../etc/passwd.mov"), "etc passwd")
        XCTAssertEqual(WallpaperLogic.cleanName("emoji 🎬 clip!!.mp4"), "emoji clip")
        XCTAssertEqual(WallpaperLogic.cleanName(".mp4"), "My wallpaper")
        XCTAssertEqual(WallpaperLogic.cleanName(String(repeating: "a", count: 200) + ".mp4").count, 60)
    }

    func testPlaybackFollowsPowerSleepAndVisibility() {
        var c = WallpaperLogic.Conditions()
        XCTAssertTrue(WallpaperLogic.shouldPlay(c))
        c.onBattery = true
        XCTAssertFalse(WallpaperLogic.shouldPlay(c), "pauses on battery by default")
        c.pauseOnBattery = false
        XCTAssertTrue(WallpaperLogic.shouldPlay(c), "unless you said keep playing")
        c.lowPowerMode = true
        XCTAssertFalse(WallpaperLogic.shouldPlay(c), "Low Power Mode always pauses")
        c = WallpaperLogic.Conditions(screensAsleep: true); XCTAssertFalse(WallpaperLogic.shouldPlay(c))
        c = WallpaperLogic.Conditions(screenLocked: true); XCTAssertFalse(WallpaperLogic.shouldPlay(c))
        c = WallpaperLogic.Conditions(covered: true); XCTAssertFalse(WallpaperLogic.shouldPlay(c), "covered by windows: nobody sees it")
    }

    func testTheFreeLibraryIsNASAOnlyAndWithinTheLimits() throws {
        XCTAssertGreaterThanOrEqual(WallpaperLogic.curated.count, 5)
        XCTAssertEqual(Set(WallpaperLogic.curated.map(\.id)).count, WallpaperLogic.curated.count, "unique ids")
        for c in WallpaperLogic.curated {
            let url = try XCTUnwrap(URL(string: c.url))
            XCTAssertTrue(WallpaperLogic.isTrustedDownload(url), c.id)
            XCTAssertLessThanOrEqual(Double(c.seconds), WallpaperLogic.maxSeconds, c.id)
            XCTAssertLessThan(Int64(c.megabytes) * 1_048_576, WallpaperLogic.maxBytes, c.id)
            XCTAssertTrue(c.credit.hasPrefix("NASA"), c.id)
        }
        XCTAssertFalse(WallpaperLogic.isTrustedDownload(URL(string: "http://images-assets.nasa.gov/x.mp4")!), "https only")
        XCTAssertFalse(WallpaperLogic.isTrustedDownload(URL(string: "https://evil.example/images-assets.nasa.gov/x.mp4")!))
    }
}
