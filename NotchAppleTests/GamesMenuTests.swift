//
//  GamesMenuTests.swift
//  Notch Apple tests
//
//  The Games menu's list, search and filters, the "Jump back in" list and how access codes are cleaned.
//

import XCTest

final class GamesMenuTests: XCTestCase {
    func testTheCatalogHasUniqueIdsAndOneLockedPrivateGame() {
        let ids = GamesCatalog.games.map(\.id)
        XCTAssertEqual(Set(ids).count, ids.count)
        let known = Set(GamesCatalog.categories.map(\.id))
        for g in GamesCatalog.games {
            XCTAssertFalse(g.cats.isEmpty, g.name)
            XCTAssertTrue(g.cats.allSatisfy { known.contains($0) && $0 != "all" }, g.name)
            XCTAssertEqual(g.art.count, 2, g.name)
        }
        XCTAssertEqual(GamesCatalog.games.filter { $0.cats.contains("private") }.map(\.id), ["fe"])
        XCTAssertEqual(GamesCatalog.games.filter(\.locked).map(\.id), ["fe"])
    }

    func testSearchAndFiltersNarrowTheGamesDown() {
        let all = GamesCatalog.games
        XCTAssertEqual(GamesCatalog.filter(all, query: "", category: "all").count, all.count)
        XCTAssertEqual(GamesCatalog.filter(all, query: "tet", category: "all").map(\.id), ["tetris"])
        XCTAssertEqual(GamesCatalog.filter(all, query: "  DAILY ", category: "all").map(\.id), ["wordle", "trivia"])
        XCTAssertEqual(GamesCatalog.filter(all, query: "", category: "private").map(\.id), ["fe"])
        XCTAssertEqual(GamesCatalog.filter(all, query: "chess", category: "online").map(\.id), ["chess"])
        XCTAssertTrue(GamesCatalog.filter(all, query: "chess", category: "arcade").isEmpty)
        let n = GamesCatalog.counts(all)
        XCTAssertEqual(n["all"], all.count)
        XCTAssertEqual(n["online"], GamesCatalog.filter(all, query: "", category: "online").count)
        XCTAssertEqual(n["daily"], 2)
    }

    func testJumpBackInKeepsTheNewestFirstWithNoRepeatsAndAtMostThree() {
        XCTAssertEqual(GamesCatalog.recordRecent([], "snake"), ["snake"])
        XCTAssertEqual(GamesCatalog.recordRecent(["snake", "tetris"], "tetris"), ["tetris", "snake"])
        XCTAssertEqual(GamesCatalog.recordRecent(["a", "snake", "tetris", "plane"], "chess"), ["chess", "snake", "tetris"])
    }

    func testAccessCodesAreCleanedAndShownInBlocksOfFour() {
        XCTAssertEqual(GameCode.clean("abcd-efgh-jkmn"), "ABCDEFGHJKMN")
        XCTAssertEqual(GameCode.clean(" abcd efgh jkmn "), "ABCDEFGHJKMN")
        XCTAssertNil(GameCode.clean("too-short"))
        XCTAssertNil(GameCode.clean("abcdefghjkmnp"))
        XCTAssertEqual(GameCode.pretty("abcdefghjkmn"), "ABCD-EFGH-JKMN")
        XCTAssertEqual(GameCode.pretty("abcdefg"), "ABCD-EFG")
        XCTAssertEqual(GameCode.pretty("abcdefghjkmnqqq"), "ABCD-EFGH-JKMN")
    }
}
