import XCTest

final class LinkShelfTests: XCTestCase {
    func testAddsHTTPSAndCleansTheHost() {
        XCTAssertEqual(LinkShelfLogic.normalize("example.com/a"), "https://example.com/a")
        XCTAssertEqual(LinkShelfLogic.normalize("  https://Example.com/X?y=1 "), "https://example.com/X?y=1")
        XCTAssertEqual(LinkShelfLogic.normalize("www.apple.com"), "https://www.apple.com")
        XCTAssertEqual(LinkShelfLogic.normalize("HTTP://news.site.co.uk:8080/p#frag"), "http://news.site.co.uk:8080/p#frag")
    }

    func testLocalAddressesNeedAScheme() {
        XCTAssertEqual(LinkShelfLogic.normalize("http://localhost:3000"), "http://localhost:3000")
        XCTAssertEqual(LinkShelfLogic.normalize("http://192.168.1.5/admin"), "http://192.168.1.5/admin")
        XCTAssertNil(LinkShelfLogic.normalize("localhost:3000"))
    }

    func testRefusesAnythingThatIsNotAWebLink() {
        for bad in ["javascript:alert(1)", "hello world", "ftp://x.com", "file:///etc/passwd", "a@b.com", "", "   ", "data:text/html,hi", "example", "https://"] {
            XCTAssertNil(LinkShelfLogic.normalize(bad), bad)
        }
    }

    func testLabel() {
        XCTAssertEqual(LinkShelfLogic.label("https://www.example.com/"), "example.com")
        XCTAssertEqual(LinkShelfLogic.label("http://example.com/a/b"), "example.com/a/b")
        XCTAssertEqual(LinkShelfLogic.label("https://example.com/" + String(repeating: "a", count: 60)).count, 40)
    }
}
