import XCTest

final class EmojiTests: XCTestCase {
    func testDataLoadsAndHasEverydayEmoji() {
        XCTAssertGreaterThan(EmojiLogic.all.count, 1500)
        XCTAssertTrue(EmojiLogic.all.contains { $0.emoji == "🔥" })
    }

    func testExactNamesComeFirst() {
        XCTAssertEqual(EmojiLogic.search("eyes").first?.emoji, "👀")
        XCTAssertEqual(EmojiLogic.search("fire").first?.emoji, "🔥")
        XCTAssertEqual(EmojiLogic.search("red heart").first?.emoji, "❤️")
    }

    func testEverydayWordsAndSymbols() {
        XCTAssertTrue(EmojiLogic.search("lol").contains { $0.emoji == "😂" })
        XCTAssertTrue(EmojiLogic.search("love").contains { $0.emoji == "❤️" })
        XCTAssertTrue(EmojiLogic.search("right arrow").prefix(5).contains { $0.emoji == "→" })
        XCTAssertTrue(EmojiLogic.search("euro").contains { $0.emoji == "€" })
    }

    func testAllWordsMustMatchAndNothingMatchesNonsense() {
        XCTAssertTrue(EmojiLogic.search("zzzzqq").isEmpty)
        XCTAssertTrue(EmojiLogic.search("red heart").allSatisfy { $0.name.contains("heart") || $0.extra.contains("heart") || $0.name.contains("red") })
    }

    func testEmptySearchGivesPopularAndLimitHolds() {
        XCTAssertEqual(EmojiLogic.search("").count, 12)
        XCTAssertEqual(EmojiLogic.search("face", limit: 5).count, 5)
    }

    func testTrigger() {
        XCTAssertEqual(EmojiLogic.trigger("emoji heart"), "heart")
        XCTAssertEqual(EmojiLogic.trigger(":Fire"), "fire")
        XCTAssertEqual(EmojiLogic.trigger("emoji"), "")
        XCTAssertNil(EmojiLogic.trigger("emojiland"))
        XCTAssertNil(EmojiLogic.trigger("hello"))
    }
}
