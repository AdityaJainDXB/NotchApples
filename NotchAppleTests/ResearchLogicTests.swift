//
//  ResearchLogicTests.swift
//  Notch Apple tests
//
//  HTML to readable text, URL finding and the public-web-only rule, the cited prompt, and file kinds.
//

import XCTest

final class ResearchLogicTests: XCTestCase {
    typealias L = ResearchLogic

    private let html = """
    <html><head><title>Battery &amp; Speed &#8211; Review</title><style>body{color:red}</style><script>var secret = 1;</script></head>
    <body><nav>Home | About</nav><header>Site header</header>
    <article><h1>MacBook Air review</h1><p>Battery lasts 18&nbsp;hours.</p><p>Performance is <b>fast</b>.</p>
    <ul><li>Pro: quiet</li><li>Con: ports</li></ul></article>
    <footer>Copyright</footer><!-- hidden comment --></body></html>
    """

    func testReadablePageKeepsTheArticleAndDropsTheChrome() {
        let p = L.readablePage(fromHTML: html)
        XCTAssertEqual(p.title, "Battery & Speed – Review")
        XCTAssertTrue(p.text.contains("MacBook Air review"))
        XCTAssertTrue(p.text.contains("Battery lasts 18 hours."))
        XCTAssertTrue(p.text.contains("Performance is fast."))
        XCTAssertTrue(p.text.contains("- Pro: quiet"))
        for junk in ["secret", "color:red", "Home | About", "Site header", "Copyright", "hidden comment", "<"] {
            XCTAssertFalse(p.text.contains(junk), junk)
        }
    }

    func testEntitiesAreDecoded() {
        XCTAssertEqual(L.decode("Tom &amp; Jerry &lt;3 &#x2019;s &#169;"), "Tom & Jerry <3 ’s ©")
    }

    func testPageWithoutATitle() {
        XCTAssertEqual(L.readablePage(fromHTML: "<p>hi</p>").title, "(untitled page)")
    }

    func testURLsAreFoundWithoutTrailingPunctuationAndDeduplicated() {
        let t = "See https://example.com/a, and (https://example.org/b?x=1). Again https://example.com/a! Not mailto:a@b.c"
        XCTAssertEqual(L.urls(in: t).map(\.absoluteString), ["https://example.com/a", "https://example.org/b?x=1"])
    }

    func testOnlyThePublicWebIsFetchable() {
        for ok in ["https://example.com", "http://example.org/x", "https://8.8.8.8/"] { XCTAssertTrue(L.isFetchable(URL(string: ok)!), ok) }
        for bad in ["file:///etc/passwd", "ftp://example.com", "http://localhost:11434/api/tags", "http://127.0.0.1/", "http://192.168.1.5/",
                    "http://10.0.0.2/", "http://172.20.1.1/", "http://169.254.169.254/latest", "http://printer.local/", "http://[::1]/"] {
            XCTAssertFalse(L.isFetchable(URL(string: bad)!), bad)
        }
    }

    func testPromptNumbersSourcesAndDemandsCitations() {
        let s = [ResearchSource(title: "Review A", location: "https://a.com", text: "Battery 18h", truncated: false),
                 ResearchSource(title: "Review B", location: "https://b.com", text: "", truncated: true)]
        let p = L.prompt(question: "How is the battery?", sources: s)
        XCTAssertTrue(p.hasPrefix("Question: How is the battery?"))
        XCTAssertTrue(p.contains("[1] Review A — https://a.com"))
        XCTAssertTrue(p.contains("[2] Review B — https://b.com"))
        XCTAssertTrue(p.contains("(no readable text)"))
        XCTAssertTrue(p.contains("ONLY the sources above"))
        XCTAssertTrue(p.contains("say so plainly"))
        XCTAssertTrue(p.contains("label the conclusions as yours"))
    }

    func testLongSourcesAreCutAndSaySo() {
        let s = [ResearchSource(title: "T", location: "l", text: String(repeating: "x", count: 100), truncated: false)]
        let p = L.prompt(question: "q", sources: s, perSourceLimit: 40)
        XCTAssertTrue(p.contains("(this source was cut short)"))
        XCTAssertFalse(p.contains(String(repeating: "x", count: 41)))
    }

    func testSourceListIsExactlyWhatWasGiven() {
        let s = [ResearchSource(title: "A", location: "u1", text: "", truncated: false), ResearchSource(title: "B", location: "u2", text: "", truncated: false)]
        XCTAssertEqual(L.sourceList(s), "[1] A — u1\n[2] B — u2")
        XCTAssertEqual(L.sourceList([]), "")
    }

    func testFileKinds() {
        XCTAssertEqual(L.kind(forExtension: "PDF"), .pdf)
        XCTAssertEqual(L.kind(forExtension: "md"), .markdown)
        XCTAssertEqual(L.kind(forExtension: "csv"), .csv)
        XCTAssertEqual(L.kind(forExtension: "swift"), .code)
        XCTAssertEqual(L.kind(forExtension: "jpeg"), .image)
        XCTAssertEqual(L.kind(forExtension: "exe"), .unsupported)
        XCTAssertEqual(L.kind(forExtension: ""), .unsupported)
    }

    func testCSVPreview() {
        let csv = (["a,b"] + (1...100).map { "\($0),x" }).joined(separator: "\n")
        let p = L.csvPreview(csv, maxRows: 5)
        XCTAssertTrue(p.contains("a,b"))
        XCTAssertTrue(p.contains("100 data rows"))
        XCTAssertLessThan(p.split(separator: "\n").count, 10)
        XCTAssertEqual(L.csvPreview("a,b\n1,2"), "a,b\n1,2")
    }
}
