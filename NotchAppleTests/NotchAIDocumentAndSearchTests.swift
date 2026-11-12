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

final class NotchAIWebSearchEngineTests: XCTestCase {
    private let ddgPage = """
    <div class="result results_links results_links_deep web-result">
      <h2 class="result__title"><a rel="nofollow" class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fexample.org%2Fions%3Fa%3D1%26b%3D2&amp;rut=abc">Ions &amp; <b>atoms</b> explained</a></h2>
      <a class="result__snippet" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fexample.org%2Fions">An ion is an atom with a <b>charge</b>.</a>
    </div>
    <div class="result"><h2 class="result__title"><a class="result__a" href="https://direct.example.com/page">Direct link</a></h2>
      <a class="result__snippet">Second snippet</a></div>
    <div class="result result--ad"><h2><a class="result__a" href="//duckduckgo.com/y.js?ad_provider=x&amp;u3=zzz">Ad title</a></h2></div>
    <div class="result"><h2><a class="result__a" href="https://192.168.0.5/admin">Router</a></h2></div>
    """

    func testDuckDuckGoRequestIsAPlainPublicHTTPSQuery() {
        let u = DuckDuckGoSearchProvider.searchURL(query: "ions & atoms?")!
        XCTAssertEqual(u.host, "html.duckduckgo.com")
        XCTAssertEqual(u.scheme, "https")
        XCTAssertTrue(ResearchLogic.isFetchable(u))
        XCTAssertFalse(u.absoluteString.contains("& atoms"), u.absoluteString)
    }

    func testDuckDuckGoRedirectsAreUnwrappedAndAdsAndLocalLinksDropped() {
        let r = DuckDuckGoSearchProvider.parse(ddgPage)
        XCTAssertEqual(r.map(\.title), ["Ions & atoms explained", "Direct link"])
        XCTAssertEqual(r[0].url.absoluteString, "https://example.org/ions?a=1&b=2")
        XCTAssertEqual(r[0].snippet, "An ion is an atom with a charge.")
        XCTAssertEqual(r[1].url.host, "direct.example.com")
        XCTAssertEqual(r[1].snippet, "Second snippet")
    }

    func testDuckDuckGoLimitAndGarbage() {
        XCTAssertEqual(DuckDuckGoSearchProvider.parse(ddgPage, limit: 1).count, 1)
        XCTAssertTrue(DuckDuckGoSearchProvider.parse("<html>nothing here</html>").isEmpty)
        XCTAssertTrue(DuckDuckGoSearchProvider.parse("").isEmpty)
    }

    func testChallengePageIsRecognisedNotMistakenForNoResults() {
        XCTAssertTrue(DuckDuckGoSearchProvider.isChallenge("<div>Unfortunately, bots use DuckDuckGo too. anomaly-modal</div>"))
        XCTAssertFalse(DuckDuckGoSearchProvider.isChallenge(ddgPage))
    }

    func testSearXNGAddressNormalising() {
        XCTAssertEqual(SearXNGSearchProvider.normalizedBase("searx.example.org")?.absoluteString, "https://searx.example.org")
        XCTAssertEqual(SearXNGSearchProvider.normalizedBase(" http://192.168.1.9:8888/ ")?.absoluteString, "http://192.168.1.9:8888")
        XCTAssertEqual(SearXNGSearchProvider.normalizedBase("https://h.example/sub/")?.absoluteString, "https://h.example/sub")
        XCTAssertNil(SearXNGSearchProvider.normalizedBase(""))
        XCTAssertNil(SearXNGSearchProvider.normalizedBase("ftp://x.example"))
        XCTAssertNil(SearXNGSearchProvider.normalizedBase("https://user:pw@x.example"))
    }

    func testSearXNGRequestAndResponse() {
        let base = SearXNGSearchProvider.normalizedBase("https://h.example/sub")!
        let u = SearXNGSearchProvider.searchURL(base: base, query: "ions & atoms")!
        XCTAssertEqual(u.path, "/sub/search")
        XCTAssertTrue(u.absoluteString.contains("format=json"))
        let json = #"{"results":[{"title":"Ions &amp; more","url":"https://example.org/i","content":"A <b>thing</b>"},{"title":"","url":"https://x.example"},{"title":"Local","url":"http://localhost:8080/x"},{"title":"Two","url":"https://two.example"}]}"#
        let r = SearXNGSearchProvider.parse(Data(json.utf8))
        XCTAssertEqual(r.map(\.title), ["Ions & more", "Two"])
        XCTAssertTrue(SearXNGSearchProvider.parse(Data("nope".utf8)).isEmpty)
        XCTAssertEqual(SearXNGSearchProvider.parse(Data(json.utf8), limit: 1).count, 1)
    }

    func testEveryEngineSaysItSendsTheQueryOffTheDevice() {
        XCTAssertTrue(DuckDuckGoSearchProvider().sendsQueryOffDevice)
        XCTAssertTrue(SearXNGSearchProvider(base: URL(string: "https://h.example")!).sendsQueryOffDevice)
        XCTAssertEqual(DuckDuckGoSearchProvider().name, "DuckDuckGo")
        XCTAssertTrue(SearXNGSearchProvider(base: URL(string: "https://h.example")!).name.contains("h.example"))
    }

    func testChoiceMapsToProviderAndNeverSilentlySwitches() {
        XCTAssertEqual(SearchEngineChoice.provider(for: .duckDuckGo, searxngURL: "")?.name, "DuckDuckGo")
        XCTAssertEqual(SearchEngineChoice.provider(for: .wikipedia, searxngURL: "")?.name, "Wikipedia")
        XCTAssertNil(SearchEngineChoice.provider(for: .searxng, searxngURL: ""))          // no address → no provider, not Wikipedia
        XCTAssertNil(SearchEngineChoice.provider(for: .searxng, searxngURL: "ftp://x"))
        XCTAssertNotNil(SearchEngineChoice.provider(for: .searxng, searxngURL: "searx.example.org"))
    }

    func testDefaultIsTheWebEngineAndBadValuesFallBackToIt() {
        let d = UserDefaults(suiteName: "notchai.search.test.\(UUID().uuidString)")!
        XCTAssertEqual(SearchEngineChoice.current(d), .duckDuckGo)
        d.set("wikipedia", forKey: SearchEngineChoice.defaultsKey)
        XCTAssertEqual(SearchEngineChoice.current(d), .wikipedia)
        d.set("garbage", forKey: SearchEngineChoice.defaultsKey)
        XCTAssertEqual(SearchEngineChoice.current(d), .duckDuckGo)
    }
}

final class NotchAISearchOutputTests: XCTestCase {
    func testHitsAreReadBackInOrderFromTheSearchText() {
        let out = "DuckDuckGo results for “ions” (the query was sent to DuckDuckGo):\n1. Ion — https://en.wikipedia.org/wiki/Ion\n   Electron transfer — see https://x.example\n2. What is an ion? — https://sciencenotes.org/what-is-an-ion/\n   An ion is…\n3. Local — http://192.168.1.2/x"
        XCTAssertEqual(SearchOutput.urls(in: out).map(\.absoluteString), ["https://en.wikipedia.org/wiki/Ion", "https://sciencenotes.org/what-is-an-ion/"])
        XCTAssertTrue(SearchOutput.urls(in: "").isEmpty)
        XCTAssertTrue(SearchOutput.urls(in: "no results here").isEmpty)
    }

    func testNthHitIsOneBasedAndMissingOnesAreNil() {
        let out = "1. A — https://a.example\n2. B — https://b.example"
        XCTAssertEqual(SearchOutput.hit(1, in: out)?.host, "a.example")
        XCTAssertEqual(SearchOutput.hit(2, in: out)?.host, "b.example")
        XCTAssertNil(SearchOutput.hit(3, in: out))
        XCTAssertNil(SearchOutput.hit(0, in: out))
        XCTAssertNil(SearchOutput.hit(1, in: ""))
    }
}
