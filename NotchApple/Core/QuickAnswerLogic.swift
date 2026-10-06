//
//  QuickAnswerLogic.swift
//  Notch apple
//
//  Short answers typed into the command palette or calculator: "12% of 80", "15% off 200", "200 + 15%", "20 is what %
//  of 80", "5 km in mi", "days until 25 Dec" and "time in Tokyo". Nothing is sent anywhere. The Windows app has the same
//  rules in services/answers.js and the same test cases.
//

import Foundation

enum QuickAnswerLogic {
    struct Answer: Equatable { let text: String; let copy: String }

    /// The answer to a typed question, or nil if it isn't one of the forms above.
    static func answer(_ raw: String, now: Date = Date(), calendar: Calendar = .current) -> Answer? {
        let q = raw.trimmingCharacters(in: .whitespaces).lowercased()
            .replacingOccurrences(of: "what is ", with: "").replacingOccurrences(of: "what's ", with: "")
        guard !q.isEmpty else { return nil }
        return percent(q) ?? unitConversion(q) ?? daysUntil(q, now: now, calendar: calendar) ?? timeIn(q, now: now)
    }

    // MARK: Percentages

    static func number(_ v: Double) -> String {
        if v == v.rounded(), abs(v) < 1e12 { return String(Int64(v)) }
        let f = NumberFormatter(); f.maximumFractionDigits = 4; f.minimumFractionDigits = 0; f.usesGroupingSeparator = false
        return f.string(from: NSNumber(value: v)) ?? "\(v)"
    }

    private static let n = #"(-?[0-9]+(?:\.[0-9]+)?)"#

    private static func groups(_ q: String, _ pattern: String) -> [Double]? {
        guard let re = try? NSRegularExpression(pattern: pattern), let m = re.firstMatch(in: q, range: NSRange(q.startIndex..., in: q)) else { return nil }
        let nums = (1..<m.numberOfRanges).compactMap { Range(m.range(at: $0), in: q).flatMap { Double(q[$0]) } }
        return nums.count == m.numberOfRanges - 1 ? nums : nil
    }

    static func percent(_ q: String) -> Answer? {
        func a(_ v: Double, _ suffix: String = "") -> Answer { Answer(text: number(v) + suffix, copy: number(v)) }
        if let g = groups(q, "^\(n)\\s*%\\s*of\\s*\(n)$") { return a(g[0] / 100 * g[1]) }                 // 12% of 80
        if let g = groups(q, "^\(n)\\s*%\\s*off\\s*\(n)$") { return a(g[1] * (1 - g[0] / 100)) }          // 15% off 200
        if let g = groups(q, "^\(n)\\s*\\+\\s*\(n)\\s*%$") { return a(g[0] * (1 + g[1] / 100)) }          // 200 + 15%
        if let g = groups(q, "^\(n)\\s*-\\s*\(n)\\s*%$") { return a(g[0] * (1 - g[1] / 100)) }            // 200 - 15%
        if let g = groups(q, "^\(n)\\s*is\\s*what\\s*%\\s*of\\s*\(n)$"), g[1] != 0 { return a(g[0] / g[1] * 100, "%") }   // 20 is what % of 80
        return nil
    }

    // MARK: Units

    static func unitConversion(_ q: String) -> Answer? {
        guard let query = Converter.parse(q), let r = Converter.convertUnits(query) else { return nil }
        let out = number((r * 1e6).rounded() / 1e6)
        return Answer(text: "\(number(query.amount)) \(query.from) = \(out) \(query.to)", copy: out)
    }

    // MARK: Dates

    private static let months = ["jan": 1, "feb": 2, "mar": 3, "apr": 4, "may": 5, "jun": 6, "jul": 7, "aug": 8, "sep": 9, "oct": 10, "nov": 11, "dec": 12]

    /// "days until 25 dec", "days until dec 25", "days until 2026-12-25". A date that has passed this year means next year.
    static func daysUntil(_ q: String, now: Date, calendar: Calendar) -> Answer? {
        guard q.hasPrefix("days until ") || q.hasPrefix("days to ") else { return nil }
        let rest = q.replacingOccurrences(of: "days until ", with: "").replacingOccurrences(of: "days to ", with: "").trimmingCharacters(in: .whitespaces)
        let c = calendar.dateComponents([.year, .month, .day], from: now)
        var target: DateComponents?
        if let g = groups(rest, #"^([0-9]{4})-([0-9]{1,2})-([0-9]{1,2})$"#) { target = DateComponents(year: Int(g[0]), month: Int(g[1]), day: Int(g[2])) }
        else if let m = rest.range(of: #"^([0-9]{1,2})\s+([a-z]{3})[a-z]*$"#, options: .regularExpression) {
            let p = rest[m].split(separator: " "); if let d = Int(p[0]), let mo = months[String(p[1].prefix(3))] { target = DateComponents(year: c.year, month: mo, day: d) }
        } else if let m = rest.range(of: #"^([a-z]{3})[a-z]*\s+([0-9]{1,2})$"#, options: .regularExpression) {
            let p = rest[m].split(separator: " "); if let mo = months[String(p[0].prefix(3))], let d = Int(p[1]) { target = DateComponents(year: c.year, month: mo, day: d) }
        }
        guard var t = target, let day = t.day, let month = t.month, (1...31).contains(day), (1...12).contains(month) else { return nil }
        let today = calendar.startOfDay(for: now)
        guard var date = calendar.date(from: t) else { return nil }
        if !rest.contains("-"), date < today { t.year = (t.year ?? 0) + 1; date = calendar.date(from: t) ?? date }   // no year given: next one
        guard calendar.component(.day, from: date) == day else { return nil }                                          // 31 Feb and the like
        let days = calendar.dateComponents([.day], from: today, to: calendar.startOfDay(for: date)).day ?? 0
        return Answer(text: days == 0 ? "Today" : "\(abs(days)) day\(abs(days) == 1 ? "" : "s")" + (days < 0 ? " ago" : ""), copy: String(days))
    }

    // MARK: Time zones

    static let cities: [String: String] = [
        "tokyo": "Asia/Tokyo", "london": "Europe/London", "new york": "America/New_York", "nyc": "America/New_York", "los angeles": "America/Los_Angeles",
        "san francisco": "America/Los_Angeles", "chicago": "America/Chicago", "toronto": "America/Toronto", "mexico city": "America/Mexico_City",
        "sao paulo": "America/Sao_Paulo", "paris": "Europe/Paris", "berlin": "Europe/Berlin", "madrid": "Europe/Madrid", "rome": "Europe/Rome",
        "amsterdam": "Europe/Amsterdam", "moscow": "Europe/Moscow", "istanbul": "Europe/Istanbul", "cairo": "Africa/Cairo", "lagos": "Africa/Lagos",
        "johannesburg": "Africa/Johannesburg", "nairobi": "Africa/Nairobi", "dubai": "Asia/Dubai", "karachi": "Asia/Karachi", "delhi": "Asia/Kolkata",
        "mumbai": "Asia/Kolkata", "dhaka": "Asia/Dhaka", "bangkok": "Asia/Bangkok", "singapore": "Asia/Singapore", "hong kong": "Asia/Hong_Kong",
        "shanghai": "Asia/Shanghai", "beijing": "Asia/Shanghai", "seoul": "Asia/Seoul", "sydney": "Australia/Sydney", "melbourne": "Australia/Melbourne",
        "auckland": "Pacific/Auckland", "honolulu": "Pacific/Honolulu", "utc": "UTC",
    ]

    /// "time in tokyo" → "15:45 in Tokyo (Wed)"
    static func timeIn(_ q: String, now: Date) -> Answer? {
        guard q.hasPrefix("time in ") else { return nil }
        let city = String(q.dropFirst(8)).trimmingCharacters(in: .whitespaces)
        guard let id = cities[city], let zone = TimeZone(identifier: id) else { return nil }
        let f = DateFormatter(); f.timeZone = zone; f.locale = Locale(identifier: "en_US_POSIX"); f.dateFormat = "HH:mm"
        let d = DateFormatter(); d.timeZone = zone; d.locale = Locale(identifier: "en_US_POSIX"); d.dateFormat = "EEE"
        let name = city.split(separator: " ").map { $0.prefix(1).uppercased() + $0.dropFirst() }.joined(separator: " ")
        return Answer(text: "\(f.string(from: now)) in \(name) (\(d.string(from: now)))", copy: f.string(from: now))
    }
}
