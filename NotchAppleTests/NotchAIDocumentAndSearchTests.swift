//
//  NotchAIDocumentAndSearchTests.swift
//  Notch Apple tests
//
//  Whole-document retrieval (passages, pages, BM25) and the Wikipedia search request and response handling.
//

import XCTest

final class NotchAIDocumentAndSearchTests: XCTestCase {
    private let doc = """
    [page 1]
    Introduction. This report describes the battery life of the MacBook Air.

    The test method used a looping video at fixed brightness.

    [page 2]
    Battery results. The MacBook Air lasted 18 hours in the video test and 14 hours of web browsing.

    [page 3]
    Performance. The M5 chip scored 4200 in single core benchmarks, faster than the previous generation.

    Thermals stayed quiet; the fan never turned on.

    [page 4]
    Conclusion. Excellent battery life and good performance for the price.
    """

    func testPassagesKeepTheirPageNumbers() {
        let idx = DocumentIndex(text: doc, targetCharacters: 200)
        XCTAssertGreaterThan(idx.passages.count, 3)
        XCTAssertEqual(idx.passages.first?.page, 1)
        XCTAssertEqual(idx.passages.last?.page, 4)
        XCTAssertFalse(idx.passages.contains { $0.text.contains("[page") })
    }

    func testSearchFindsTheRightPassageAndCitesItsPage() {
        let idx = DocumentIndex(text: doc, targetCharacters: 200)
        let hit = idx.search("how many hours of battery in the video test").first
        XCTAssertEqual(hit?.passage.page, 2)
        let perf = idx.search("single core benchmark score").first
        XCTAssertEqual(perf?.passage.page, 3)
    }

    func testNothingMatchesNothing() {
        let idx = DocumentIndex(text: doc, targetCharacters: 200)
        XCTAssertTrue(idx.search("zebra quantum").isEmpty)
        XCTAssertTrue(idx.search("the and for").isEmpty)         // only stop words
        XCTAssertTrue(DocumentIndex(text: "").search("battery").isEmpty)
    }

    func testExcerptsAreTaggedAndInDocumentOrderWithinABudget() {
        let idx = DocumentIndex(text: doc, targetCharacters: 200)
        let e = idx.excerpts(for: "battery video performance chip", limit: 4, budget: 10_000)
        XCTAssertTrue(e.contains("(p. 2)"))
        XCTAssertTrue(e.contains("(p. 3)"))
        XCTAssertLessThan(e.range(of: "(p. 2)")!.lowerBound, e.range(of: "(p. 3)")!.lowerBound)
        XCTAssertLessThanOrEqual(idx.excerpts(for: "battery", limit: 5, budget: 120).count, 400)
    }

    func testAHugeDocumentIsCutIntoManyPassagesNotOne() {
        let big = String(repeating: "word ", count: 20_000)
        let idx = DocumentIndex(text: big, targetCharacters: 900)
        XCTAssertGreaterThan(idx.passages.count, 50)
        XCTAssertTrue(idx.passages.allSatisfy { $0.text.count <= 2_000 })
    }

    func testRarerTermsOutweighCommonOnes() {
        let text = "alpha beta gamma\n\nalpha alpha alpha common\n\ncommon common rare\n\ncommon words here"
        let hit = DocumentIndex(text: text, targetCharacters: 30).search("common rare").first
        XCTAssertTrue(hit?.passage.text.contains("rare") == true)
    }

    // MARK: Wikipedia

    func testSearchRequestIsAPublicWikipediaURL() {
        let u = WikipediaSearchProvider.searchURL(query: "MacBook Air & M5?", limit: 5)!
        XCTAssertEqual(u.host, "en.wikipedia.org")
        XCTAssertEqual(u.scheme, "https")
        XCTAssertTrue(u.absoluteString.contains("srsearch=MacBook%20Air%20%26%20M5?") || u.absoluteString.contains("srsearch=MacBook%20Air%20%26%20M5%3F"), u.absoluteString)
        XCTAssertTrue(ResearchLogic.isFetchable(u))
        XCTAssertTrue(WikipediaSearchProvider.searchURL(query: "x", limit: 99)!.absoluteString.contains("srlimit=10"))
    }

    func testArticleURLs() {
        XCTAssertEqual(WikipediaSearchProvider.articleURL(title: "MacBook Air (Apple silicon)")?.absoluteString, "https://en.wikipedia.org/wiki/MacBook_Air_(Apple_silicon)")
        XCTAssertEqual(WikipediaSearchProvider.articleURL(title: "What?#x")?.absoluteString.contains("?"), false)
    }

    func testResponseParsing() {
        let json = #"{"query":{"search":[{"title":"MacBook Air","pageid":1,"snippet":"The <span class=\"searchmatch\">MacBook</span> Air is a line of &quot;laptops&quot;"},{"title":"Apple M5","snippet":"A chip"},{"pageid":3}]}}"#
        let r = WikipediaSearchProvider.parse(Data(json.utf8))
        XCTAssertEqual(r.map(\.title), ["MacBook Air", "Apple M5"])           // the one without a title is dropped
        XCTAssertEqual(r[0].snippet, "The MacBook Air is a line of \"laptops\"")
        XCTAssertEqual(r[0].url.absoluteString, "https://en.wikipedia.org/wiki/MacBook_Air")
    }

    func testBadResponsesGiveNoResultsNotACrash() {
        XCTAssertTrue(WikipediaSearchProvider.parse(Data("not json".utf8)).isEmpty)
        XCTAssertTrue(WikipediaSearchProvider.parse(Data(#"{"error":{}}"#.utf8)).isEmpty)
        XCTAssertTrue(WikipediaSearchProvider.parse(Data()).isEmpty)
    }

    func testTheProviderIsHonestAboutLeavingTheDevice() {
        XCTAssertTrue(WikipediaSearchProvider().sendsQueryOffDevice)
        XCTAssertEqual(WikipediaSearchProvider().name, "Wikipedia")
    }
}
