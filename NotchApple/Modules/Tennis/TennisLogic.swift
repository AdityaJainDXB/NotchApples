//
//  TennisLogic.swift
//  Notch apple
//
//  The pure part of the Tennis tab: turning ESPN's tennis scoreboards and rankings into
//  tournaments, matches and players, sorting them into the Men, Women and Mixed draws,
//  merging the ATP and WTA feeds (a Grand Slam is in both), and recognising Grand Slams.
//  Foundation only, so it is tested without the app (NotchAppleTests/TennisLogicTests.swift).
//

import Foundation

enum TennisDraw: String, CaseIterable, Identifiable {
    case men, women, mixed
    var id: String { rawValue }
    var title: String {
        switch self {
        case .men: "Men"
        case .women: "Women"
        case .mixed: "Mixed"
        }
    }
}

struct TennisPlayer: Equatable {
    struct SetScore: Equatable {
        let games: Int
        let tiebreak: Int?
        let won: Bool
    }
    let name: String
    let short: String
    let flagURL: String
    let country: String
    let seed: Int?
    let winner: Bool
    let serving: Bool
    let sets: [SetScore]

    /// Doubles pairs are "A / B".
    var isPair: Bool { name.contains("/") }
}

struct TennisMatch: Identifiable, Equatable {
    enum State: String { case pre, live = "in", post }
    let id: String
    let date: Date?
    let state: State
    let detail: String
    let round: String
    let court: String
    let group: String       // "Men's Singles", "Mixed Doubles"…
    let draw: TennisDraw
    let players: [TennisPlayer]

    var isDoubles: Bool { group.localizedCaseInsensitiveContains("doubles") || players.contains { $0.isPair } }
}

struct TennisEvent: Identifiable, Equatable {
    let id: String
    let name: String
    var tours: [String]
    var slam: Bool
    let start: Date?
    let end: Date?
    let place: String
    var matches: [TennisMatch]

    var liveCount: Int { matches.filter { $0.state == .live }.count }
}

struct TennisRanked: Identifiable, Equatable {
    var id: String { "\(rank)-\(name)" }
    let rank: Int
    let name: String
    let points: Int?
    let flagURL: String
    let country: String     // a country name from ESPN, or a two-letter code from the saved list
    let move: Int           // places gained since the last ranking (negative: lost)
}

enum TennisLogic {
    static let slams = ["Australian Open", "Roland Garros", "French Open", "Wimbledon", "US Open"]

    /// The four Grand Slams and a day in their second week, for "jump to a Grand Slam".
    static let slamDates: [(name: String, month: Int, day: Int)] = [
        ("Australian Open", 1, 25), ("Roland Garros", 6, 4), ("Wimbledon", 7, 9), ("US Open", 9, 3),
    ]

    static func isSlam(_ name: String) -> Bool {
        slams.contains { name.localizedCaseInsensitiveContains($0) }
    }

    /// Shown when ESPN's rankings can't be reached, so the top 20 and the favourites are never empty.
    static let savedTop: [String: [(String, String)]] = [
        "atp": [("Carlos Alcaraz", "ES"), ("Jannik Sinner", "IT"), ("Alexander Zverev", "DE"), ("Novak Djokovic", "RS"), ("Taylor Fritz", "US"),
                ("Felix Auger-Aliassime", "CA"), ("Alex de Minaur", "AU"), ("Lorenzo Musetti", "IT"), ("Ben Shelton", "US"), ("Jack Draper", "GB"),
                ("Daniil Medvedev", "RU"), ("Casper Ruud", "NO"), ("Alexander Bublik", "KZ"), ("Holger Rune", "DK"), ("Andrey Rublev", "RU"),
                ("Jakub Mensik", "CZ"), ("Karen Khachanov", "RU"), ("Tommy Paul", "US"), ("Flavio Cobolli", "IT"), ("Alejandro Davidovich Fokina", "ES")],
        "wta": [("Aryna Sabalenka", "BY"), ("Iga Swiatek", "PL"), ("Coco Gauff", "US"), ("Amanda Anisimova", "US"), ("Elena Rybakina", "KZ"),
                ("Jessica Pegula", "US"), ("Madison Keys", "US"), ("Jasmine Paolini", "IT"), ("Mirra Andreeva", "RU"), ("Ekaterina Alexandrova", "RU"),
                ("Belinda Bencic", "CH"), ("Elina Svitolina", "UA"), ("Clara Tauson", "DK"), ("Karolina Muchova", "CZ"), ("Linda Noskova", "CZ"),
                ("Emma Navarro", "US"), ("Naomi Osaka", "JP"), ("Victoria Mboko", "CA"), ("Liudmila Samsonova", "RU"), ("Diana Shnaider", "RU")],
    ]

    static func savedRanking(_ tour: String) -> [TennisRanked] {
        (savedTop[tour] ?? []).enumerated().map { i, p in
            TennisRanked(rank: i + 1, name: p.0, points: nil, flagURL: "", country: p.1, move: 0)
        }
    }

    /// "IT" → 🇮🇹; anything that isn't a two-letter code → "".
    static func flagEmoji(_ code: String) -> String {
        let up = code.uppercased()
        guard up.count == 2, up.unicodeScalars.allSatisfy({ $0.value >= 65 && $0.value <= 90 }) else { return "" }
        return String(String.UnicodeScalarView(up.unicodeScalars.compactMap { Unicode.Scalar(0x1F1A5 + $0.value) }))
    }

    /// Which draw a match is in. ESPN names it ("Women's Singles", "Mixed Doubles"); without a name, the tour decides.
    static func draw(group: String, tour: String) -> TennisDraw {
        let g = group.lowercased()
        if g.contains("mixed") { return .mixed }
        if g.contains("women") || g.contains("ladies") || g.contains("girls") { return .women }
        if g.contains("men") || g.contains("gentlemen") || g.contains("boys") { return .men }
        return tour == "wta" ? .women : .men
    }

    // MARK: Parsing

    private static func date(_ v: Any?) -> Date? {
        guard let s = v as? String else { return nil }
        if let d = ISO8601DateFormatter().date(from: s) { return d }
        // ESPN often leaves out the seconds: "2026-09-03T16:00Z".
        let f = DateFormatter()
        f.locale = Locale(identifier: "en_US_POSIX")
        f.timeZone = TimeZone(identifier: "UTC")
        f.dateFormat = "yyyy-MM-dd'T'HH:mm'Z'"
        return f.date(from: s)
    }

    private static func int(_ v: Any?) -> Int? {
        if let i = v as? Int { return i }
        if let d = v as? Double { return Int(d.rounded()) }
        if let s = v as? String { return Int(s) ?? Double(s).map { Int($0.rounded()) } }
        return nil
    }

    static func player(_ c: [String: Any]) -> TennisPlayer {
        let athlete = c["athlete"] as? [String: Any]
        let roster = c["roster"] as? [String: Any]
        let members = (roster?["athletes"] as? [[String: Any]]) ?? []
        let pairName = members.compactMap { ($0["shortName"] as? String) ?? ($0["displayName"] as? String) }.joined(separator: " / ")
        var name = "TBD"
        if let n = athlete?["displayName"] as? String { name = n }
        else if let n = roster?["displayName"] as? String { name = n }
        else if !pairName.isEmpty { name = pairName }
        else if let n = (c["team"] as? [String: Any])?["displayName"] as? String { name = n }
        let surnames = members.compactMap { ($0["displayName"] as? String)?.split(separator: " ").last.map(String.init) }.joined(separator: " / ")
        let short: String = (athlete?["shortName"] as? String) ?? (surnames.isEmpty ? name : surnames)
        let flag = (athlete?["flag"] as? [String: Any]) ?? (members.first?["flag"] as? [String: Any])
        let sets = ((c["linescores"] as? [[String: Any]]) ?? []).map { s in
            TennisPlayer.SetScore(games: int(s["value"]) ?? 0, tiebreak: int(s["tiebreak"]), won: s["winner"] as? Bool ?? false)
        }
        var seed = int(c["seed"])
        if let r = int((c["curatedRank"] as? [String: Any])?["current"]), r < 99 { seed = r }
        return TennisPlayer(name: name, short: short, flagURL: flag?["href"] as? String ?? "", country: flag?["alt"] as? String ?? "",
                            seed: seed, winner: c["winner"] as? Bool ?? false, serving: c["possession"] as? Bool ?? false, sets: sets)
    }

    static func match(_ comp: [String: Any], tour: String, group: String) -> TennisMatch {
        let type = ((comp["status"] as? [String: Any])?["type"] as? [String: Any]) ?? [:]
        let competitors = ((comp["competitors"] as? [[String: Any]]) ?? []).sorted { (int($0["order"]) ?? 0) < (int($1["order"]) ?? 0) }
        let players = competitors.prefix(2).map { player($0) }
        let groupName = group.isEmpty ? ((comp["type"] as? [String: Any])?["text"] as? String ?? "") : group
        let fallback = tour == "wta" ? "Women's Singles" : "Men's Singles"
        var id = "\(tour)-\(comp["date"] as? String ?? "")-\(players.map(\.name).joined(separator: "-"))"
        if let s = comp["id"] as? String { id = s } else if let i = int(comp["id"]) { id = String(i) }
        let venue = comp["venue"] as? [String: Any]
        var round = ((comp["notes"] as? [[String: Any]])?.first?["headline"] as? String) ?? ""
        if let r = (comp["round"] as? [String: Any])?["displayName"] as? String { round = r }
        let court: String = (venue?["court"] as? String) ?? (venue?["fullName"] as? String) ?? ""
        let state = TennisMatch.State(rawValue: type["state"] as? String ?? "pre") ?? .pre
        let detail: String = (type["shortDetail"] as? String) ?? (type["detail"] as? String) ?? ""
        return TennisMatch(id: id, date: date(comp["date"]), state: state, detail: detail, round: round, court: court,
                           group: groupName.isEmpty ? fallback : groupName,
                           draw: draw(group: groupName, tour: tour),
                           players: Array(players))
    }

    /// One ESPN event (a tournament) from the `tour` ("atp" or "wta") scoreboard.
    static func event(_ e: [String: Any], tour: String) -> TennisEvent {
        var matches: [TennisMatch] = []
        for g in (e["groupings"] as? [[String: Any]]) ?? [] {
            let grouping = g["grouping"] as? [String: Any]
            let name = (grouping?["displayName"] as? String) ?? (grouping?["slug"] as? String) ?? ""
            for c in (g["competitions"] as? [[String: Any]]) ?? [] { matches.append(match(c, tour: tour, group: name)) }
        }
        for c in (e["competitions"] as? [[String: Any]]) ?? [] { matches.append(match(c, tour: tour, group: "")) }
        let name = (e["name"] as? String) ?? (e["shortName"] as? String) ?? "Tournament"
        let venue = e["venue"] as? [String: Any]
        let address = venue?["address"] as? [String: Any]
        let cityCountry = [address?["city"] as? String, address?["country"] as? String].compactMap { $0 }.joined(separator: ", ")
        let place: String = (venue?["displayName"] as? String) ?? cityCountry
        var id = name
        if let s = e["id"] as? String { id = s } else if let i = int(e["id"]) { id = String(i) }
        return TennisEvent(id: id, name: name, tours: [tour],
                           slam: (e["major"] as? Bool ?? false) || isSlam(name),
                           start: date(e["date"]), end: date(e["endDate"]), place: place, matches: matches)
    }

    static func events(_ json: [String: Any], tour: String) -> [TennisEvent] {
        ((json["events"] as? [[String: Any]]) ?? []).map { event($0, tour: tour) }
    }

    /// Both tours' tournaments as one list: a Grand Slam (in both feeds) once, with every match.
    /// Grand Slams first, then tournaments with live matches, then the bigger draws.
    static func merge(_ lists: [[TennisEvent]]) -> [TennisEvent] {
        func key(_ n: String) -> String {
            var k = n.lowercased()
            for cut in [" presented by", " powered by"] { if let r = k.range(of: cut) { k = String(k[..<r.lowerBound]) } }
            return k.trimmingCharacters(in: .whitespaces)
        }
        var out: [TennisEvent] = []
        for ev in lists.joined() {
            if let i = out.firstIndex(where: { key($0.name) == key(ev.name) }) {
                let seen = Set(out[i].matches.map(\.id))
                out[i].matches += ev.matches.filter { !seen.contains($0.id) }
                out[i].tours += ev.tours.filter { !out[i].tours.contains($0) }
                out[i].slam = out[i].slam || ev.slam
            } else {
                out.append(ev)
            }
        }
        return out.enumerated().sorted { a, b in
            let (x, y) = (a.element, b.element)
            if x.slam != y.slam { return x.slam }
            if (x.liveCount > 0) != (y.liveCount > 0) { return x.liveCount > 0 }
            if x.matches.count != y.matches.count { return x.matches.count > y.matches.count }
            return a.offset < b.offset
        }.map(\.element)
    }

    /// ESPN's rankings: the singles list's top 20.
    static func rankings(_ json: [String: Any]) -> [TennisRanked] {
        let lists = (json["rankings"] as? [[String: Any]]) ?? []
        let singles = lists.first { l in
            !"\(l["name"] as? String ?? "") \(l["type"] as? String ?? "")".localizedCaseInsensitiveContains("doubles")
        } ?? lists.first
        return ((singles?["ranks"] as? [[String: Any]]) ?? []).prefix(20).compactMap { r in
            let a = r["athlete"] as? [String: Any]
            guard let name = (a?["displayName"] as? String) ?? (a?["name"] as? String), !name.isEmpty, let rank = int(r["current"]) else { return nil }
            let flag = a?["flag"] as? [String: Any]
            let previous = int(r["previous"]) ?? 0
            return TennisRanked(rank: rank, name: name, points: int(r["points"]), flagURL: flag?["href"] as? String ?? "",
                                country: flag?["alt"] as? String ?? "", move: previous > 0 ? previous - rank : 0)
        }
    }

    // MARK: Helpers

    /// Live first, then upcoming (soonest first), then results (latest first).
    static func sorted(_ ms: [TennisMatch]) -> [TennisMatch] {
        func rank(_ s: TennisMatch.State) -> Int { s == .live ? 0 : s == .pre ? 1 : 2 }
        return ms.sorted { a, b in
            if a.state != b.state { return rank(a.state) < rank(b.state) }
            let (x, y) = (a.date ?? .distantPast, b.date ?? .distantPast)
            return a.state == .post ? x > y : x < y
        }
    }

    /// "6-4 3-6 7-6" from one side's point of view.
    static func score(_ m: TennisMatch, side: Int) -> String {
        guard m.players.count == 2 else { return "" }
        let (a, b) = (m.players[side], m.players[1 - side])
        return a.sets.enumerated().map { k, s in "\(s.games)-\(k < b.sets.count ? b.sets[k].games : 0)" }.joined(separator: " ")
    }

    /// The same player, written however ESPN or the person wrote it ("Iga Świątek" = "iga swiatek" = "I. Swiatek").
    static func samePlayer(_ a: String, _ b: String) -> Bool {
        func n(_ s: String) -> String {
            s.folding(options: [.diacriticInsensitive, .caseInsensitive], locale: nil)
                .filter { $0.isLetter || $0 == " " }.trimmingCharacters(in: .whitespaces)
        }
        let (x, y) = (n(a), n(b))
        guard !x.isEmpty, !y.isEmpty else { return false }
        if x == y { return true }
        return x.split(separator: " ").last == y.split(separator: " ").last && x.first == y.first
    }
}
