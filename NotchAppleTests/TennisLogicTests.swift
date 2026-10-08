//
//  TennisLogicTests.swift
//  Notch apple tests
//
//  How the Tennis tab reads ESPN's scoreboards and rankings.
//

import XCTest

final class TennisLogicTests: XCTestCase {
    private func competitor(_ name: String, order: Int, sets: [Int], winner: Bool = false, serving: Bool = false) -> [String: Any] {
        ["order": order, "winner": winner, "possession": serving,
         "athlete": ["displayName": name, "shortName": name, "flag": ["href": "https://a.espncdn.com/flag.png", "alt": "Italy"]],
         "linescores": sets.map { ["value": Double($0)] }]
    }

    private var slamJSON: [String: Any] {
        ["events": [[
            "id": "1", "name": "US Open", "date": "2026-08-30T15:00Z", "endDate": "2026-09-13T23:00Z",
            "venue": ["displayName": "New York"],
            "groupings": [
                ["grouping": ["displayName": "Men's Singles"], "competitions": [[
                    "id": "m1", "date": "2026-09-03T16:00Z", "round": ["displayName": "Quarterfinal"],
                    "status": ["type": ["state": "in", "shortDetail": "Set 3"]],
                    "competitors": [competitor("Ben Shelton", order: 2, sets: [4, 7, 2]),
                                    competitor("Jannik Sinner", order: 1, sets: [6, 6, 3], serving: true)],
                ]]],
                ["grouping": ["displayName": "Mixed Doubles"], "competitions": [[
                    "id": "x1", "status": ["type": ["state": "post"]],
                    "competitors": [["order": 1, "winner": true, "roster": ["displayName": "Errani / Vavassori"], "linescores": [["value": 6]]],
                                    ["order": 2, "roster": ["displayName": "Swiatek / Ruud"], "linescores": [["value": 3]]]],
                ]]],
            ],
        ]]]
    }

    func testAScoreboardBecomesATournamentWithDraws() {
        let events = TennisLogic.events(slamJSON, tour: "atp")
        XCTAssertEqual(events.count, 1)
        let e = events[0]
        XCTAssertTrue(e.slam)
        XCTAssertEqual(e.place, "New York")
        XCTAssertNotNil(e.start)
        XCTAssertEqual(e.matches.count, 2)
        let men = e.matches[0]
        XCTAssertEqual(men.draw, .men)
        XCTAssertEqual(men.state, .live)
        XCTAssertEqual(men.round, "Quarterfinal")
        XCTAssertEqual(men.players.map(\.name), ["Jannik Sinner", "Ben Shelton"])   // in ESPN's order
        XCTAssertTrue(men.players[0].serving)
        XCTAssertEqual(TennisLogic.score(men, side: 0), "6-4 6-7 3-2")
        let mixed = e.matches[1]
        XCTAssertEqual(mixed.draw, .mixed)
        XCTAssertTrue(mixed.isDoubles)
        XCTAssertTrue(mixed.players[0].winner)
    }

    func testTheDrawComesFromTheGroupOrTheTour() {
        XCTAssertEqual(TennisLogic.draw(group: "Women's Singles", tour: "atp"), .women)
        XCTAssertEqual(TennisLogic.draw(group: "Men's Doubles", tour: "wta"), .men)
        XCTAssertEqual(TennisLogic.draw(group: "Mixed Doubles", tour: "wta"), .mixed)
        XCTAssertEqual(TennisLogic.draw(group: "", tour: "wta"), .women)
        XCTAssertEqual(TennisLogic.draw(group: "", tour: "atp"), .men)
    }

    func testAGrandSlamInBothFeedsShowsOnceAndFirst() {
        let atp = TennisLogic.events(slamJSON, tour: "atp")
        let other = TennisEvent(id: "9", name: "Chengdu Open", tours: ["atp"], slam: false, start: nil, end: nil, place: "", matches: [])
        let women = TennisEvent(id: "2", name: "US Open", tours: ["wta"], slam: true, start: nil, end: nil, place: "",
                                matches: [TennisMatch(id: "w1", date: nil, state: .pre, detail: "", round: "", court: "", group: "Women's Singles", draw: .women, players: [])])
        let merged = TennisLogic.merge([[other] + atp, [women]])
        XCTAssertEqual(merged.map(\.name), ["US Open", "Chengdu Open"])
        XCTAssertEqual(merged[0].matches.count, 3)
        XCTAssertEqual(merged[0].tours, ["atp", "wta"])
    }

    func testGrandSlamsAreRecognised() {
        XCTAssertTrue(TennisLogic.isSlam("Wimbledon"))
        XCTAssertTrue(TennisLogic.isSlam("Roland Garros"))
        XCTAssertTrue(TennisLogic.isSlam("Australian Open"))
        XCTAssertFalse(TennisLogic.isSlam("Miami Open"))
    }

    func testRankingsTakeTheSinglesTop20() {
        let ranks: [[String: Any]] = (1...25).map { ["current": $0, "previous": $0 == 1 ? 2 : $0, "points": 1000.0 * Double(26 - $0),
                                                      "athlete": ["displayName": "Player \($0)"]] }
        let json: [String: Any] = ["rankings": [["name": "Doubles", "ranks": []], ["name": "Singles", "ranks": ranks]]]
        let r = TennisLogic.rankings(json)
        XCTAssertEqual(r.count, 20)
        XCTAssertEqual(r[0].name, "Player 1")
        XCTAssertEqual(r[0].move, 1)
        XCTAssertEqual(r[0].points, 25000)
    }

    func testTheSavedListHasTwentyEach() {
        XCTAssertEqual(TennisLogic.savedRanking("atp").count, 20)
        XCTAssertEqual(TennisLogic.savedRanking("wta").count, 20)
        XCTAssertEqual(TennisLogic.flagEmoji("IT"), "🇮🇹")
        XCTAssertEqual(TennisLogic.flagEmoji("Italy"), "")
    }

    func testLiveComesFirstThenUpcomingThenResults() {
        func m(_ id: String, _ s: TennisMatch.State, _ t: TimeInterval) -> TennisMatch {
            TennisMatch(id: id, date: Date(timeIntervalSince1970: t), state: s, detail: "", round: "", court: "", group: "", draw: .men, players: [])
        }
        let sorted = TennisLogic.sorted([m("old", .post, 1), m("later", .pre, 9), m("live", .live, 5), m("new", .post, 3), m("soon", .pre, 7)])
        XCTAssertEqual(sorted.map(\.id), ["live", "soon", "later", "new", "old"])
    }

    func testPlayersMatchHoweverTheyAreWritten() {
        XCTAssertTrue(TennisLogic.samePlayer("Iga Świątek", "iga swiatek"))
        XCTAssertTrue(TennisLogic.samePlayer("Carlos Alcaraz", "C. Alcaraz"))
        XCTAssertFalse(TennisLogic.samePlayer("Carlos Alcaraz", "Jannik Sinner"))
        XCTAssertFalse(TennisLogic.samePlayer("", "Jannik Sinner"))
    }
}
