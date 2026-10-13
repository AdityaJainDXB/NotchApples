import XCTest

final class UpdateFeedTests: XCTestCase {
    private let good = """
    {"version":"2.0.50","title":"Notch Apple 2.0.50","notes":"New things","published":"2026-10-13T17:00:00Z",
     "dmg":"https://github.com/AdityaJainDXB/NotchApples/releases/download/v2.0.50/NotchApple-2.0.50.dmg",
     "page":"https://github.com/AdityaJainDXB/NotchApples/releases/tag/v2.0.50"}
    """

    func testLatestJSONIsRead() throws {
        let e = try XCTUnwrap(UpdateFeed.parseLatestJSON(Data(good.utf8)))
        XCTAssertEqual(e.version, "2.0.50")
        XCTAssertEqual(e.dmgURL.lastPathComponent, "NotchApple-2.0.50.dmg")
        XCTAssertNotNil(e.published)
    }

    func testADownloadFromAnotherPlaceIsRefused() {
        for bad in ["https://evil.example/releases/download/v2.0.50/NotchApple-2.0.50.dmg",
                    "http://github.com/AdityaJainDXB/NotchApples/releases/download/v2.0.50/NotchApple-2.0.50.dmg",
                    "https://github.com/someone-else/NotchApples/releases/download/v2.0.50/NotchApple-2.0.50.dmg",
                    "https://github.com/AdityaJainDXB/NotchApples/releases/download/v2.0.50/NotchApple-2.0.50.zip"] {
            let json = good.replacingOccurrences(of: "https://github.com/AdityaJainDXB/NotchApples/releases/download/v2.0.50/NotchApple-2.0.50.dmg", with: bad)
            XCTAssertNil(UpdateFeed.parseLatestJSON(Data(json.utf8)), bad)
        }
    }

    func testGarbageIsNotARelease() {
        XCTAssertNil(UpdateFeed.parseLatestJSON(Data("not json".utf8)))
        XCTAssertNil(UpdateFeed.parseLatestJSON(Data(good.replacingOccurrences(of: "2.0.50\",\"title", with: "latest\",\"title").utf8)))
    }

    private let atom = """
    <?xml version="1.0" encoding="UTF-8"?>
    <feed xmlns="http://www.w3.org/2005/Atom">
      <entry><id>x1</id><updated>2026-10-13T17:05:00Z</updated>
        <link rel="alternate" type="text/html" href="https://github.com/AdityaJainDXB/NotchApples/releases/tag/win-v1.53.0"/>
        <title>Notch Apple for Windows win-v1.53.0</title><content type="html">&lt;p&gt;Windows&lt;/p&gt;</content></entry>
      <entry><id>x2</id><updated>2026-10-13T16:59:00Z</updated>
        <link rel="alternate" type="text/html" href="https://github.com/AdityaJainDXB/NotchApples/releases/tag/v2.0.50"/>
        <title>Notch Apple 2.0.50 · Bambu</title><content type="html">&lt;p&gt;&lt;strong&gt;New&lt;/strong&gt;&lt;/p&gt;&lt;ul&gt;&lt;li&gt;Bambu &amp;amp; helicopters&lt;/li&gt;&lt;/ul&gt;</content></entry>
      <entry><id>x3</id><updated>2026-10-10T07:00:00Z</updated>
        <link rel="alternate" type="text/html" href="https://github.com/AdityaJainDXB/NotchApples/releases/tag/v2.0.49"/>
        <title>Notch Apple 2.0.49</title><content type="html">&lt;p&gt;old&lt;/p&gt;</content></entry>
    </feed>
    """

    func testAtomKeepsMacReleasesAndSkipsWindows() throws {
        let entries = UpdateFeed.parseAtom(Data(atom.utf8))
        XCTAssertEqual(entries.map(\.version), ["2.0.50", "2.0.49"])
        let newest = try XCTUnwrap(UpdateFeed.newest(entries))
        XCTAssertEqual(newest.version, "2.0.50")
        XCTAssertEqual(newest.dmgURL.absoluteString, "https://github.com/AdityaJainDXB/NotchApples/releases/download/v2.0.50/NotchApple-2.0.50.dmg")
        XCTAssertTrue(newest.notes.contains("Bambu & helicopters"), newest.notes)
    }

    func testVersionOrderIsNumeric() {
        XCTAssertEqual(UpdateFeed.compare("2.0.9", "2.0.10"), -1)
        XCTAssertEqual(UpdateFeed.compare("2.1", "2.0.99"), 1)
        XCTAssertEqual(UpdateFeed.compare("2.0", "2.0.0"), 0)
    }
}
