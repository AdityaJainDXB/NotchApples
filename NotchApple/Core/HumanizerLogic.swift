//
//  HumanizerLogic.swift
//  Notch Apple
//
//  The Humanizer rewrites text so it reads like a person wrote it. The checklist it follows is the one from the Humanizer skill
//  (github.com/AdityaJainDXB/humanizer, CC BY-SA 4.0), which describes the patterns on Wikipedia's "Signs of AI writing" guide
//  (WikiProject AI Cleanup, CC BY-SA 4.0), in its own words. This file is the rules around it, with no UI:
//
//    • most words in one go:        Free 500, Pro 1,000, Ultimate no limit
//    • words a month (renews):      Free 3,000, Pro 15,000, Ultimate 40,000
//    • extra words you bought:      never run out with the month; used after the month's words
//
//  Counting is on this Mac. Nothing here is sent anywhere. The same rules are in NotchWindows/src/js/services/humanizerlogic.js.
//

import Foundation

enum HumanizerLogic {
    /// Most words in a single request, nil for no limit.
    static func perRequestLimit(for tier: Tier) -> Int? {
        switch tier {
        case .free: 500
        case .pro: 1_000
        case .ultimate, .admin: nil
        }
    }

    /// Words each month.
    static func monthlyAllowance(for tier: Tier) -> Int {
        switch tier {
        case .free: 3_000
        case .pro: 15_000
        case .ultimate: 40_000
        case .admin: Int.max   // no monthly limit
        }
    }

    /// Extra words: one US dollar buys this many, and they never expire.
    static let wordsPerDollar = 50_000
    /// The Whop page that sells extra words.
    static let topUpURL = URL(string: "https://whop.com/notch-bcc9/humanizer-top-up/")!

    static func wordCount(_ text: String) -> Int {
        text.split(whereSeparator: { $0.isWhitespace || $0.isNewline }).count
    }

    static func monthKey(_ date: Date, calendar: Calendar = .current) -> String {
        let c = calendar.dateComponents([.year, .month], from: date)
        return String(format: "%04d-%02d", c.year ?? 0, c.month ?? 0)
    }

    /// What has been used: words this month, and the extra words still left.
    struct Usage: Codable, Equatable {
        var month: String
        var used: Int
        var credits: Int
    }

    /// Usage as of `now`: a new month starts the monthly count again, and credits carry over.
    static func current(_ stored: Usage?, now: Date, calendar: Calendar = .current) -> Usage {
        let key = monthKey(now, calendar: calendar)
        guard var u = stored else { return Usage(month: key, used: 0, credits: 0) }
        if u.month != key { u.month = key; u.used = 0 }
        return u
    }

    static func monthlyLeft(_ u: Usage, tier: Tier) -> Int { max(0, monthlyAllowance(for: tier) - u.used) }
    static func totalLeft(_ u: Usage, tier: Tier) -> Int { monthlyLeft(u, tier: tier) + u.credits }

    enum Decision: Equatable {
        /// Go ahead: `fromMonth` words come out of this month's allowance and `fromCredits` out of extra credits.
        case allowed(fromMonth: Int, fromCredits: Int)
        /// More words than one request may hold.
        case tooLong(limit: Int, words: Int)
        /// Not enough words left this month and no credits to cover the rest.
        case outOfWords(needed: Int, left: Int)
        case empty
    }

    /// Whether `words` words may be humanized now.
    static func decide(words: Int, tier: Tier, usage: Usage) -> Decision {
        guard words > 0 else { return .empty }
        if let limit = perRequestLimit(for: tier), words > limit { return .tooLong(limit: limit, words: words) }
        let month = monthlyLeft(usage, tier: tier)
        if words <= month { return .allowed(fromMonth: words, fromCredits: 0) }
        let extra = words - month
        if extra <= usage.credits { return .allowed(fromMonth: month, fromCredits: extra) }
        return .outOfWords(needed: words, left: month + usage.credits)
    }

    /// The usage after a successful request.
    static func applying(_ d: Decision, to u: Usage) -> Usage {
        guard case .allowed(let m, let c) = d else { return u }
        var out = u
        out.used += m
        out.credits = max(0, out.credits - c)
        return out
    }

    /// One sentence for the person when a request is stopped.
    static func message(for d: Decision, tier: Tier) -> String? {
        switch d {
        case .allowed: nil
        case .empty: "Paste or type some text first."
        case .tooLong(let limit, let words):
            "That is \(words) words. \(tier == .free ? "Free" : "Pro") humanizes up to \(limit) at a time\(tier == .free ? ", Pro 1,000, Ultimate as many as you like" : ", Ultimate as many as you like"). Try a shorter piece."
        case .outOfWords(let needed, let left):
            "You need \(needed) words but have \(left) left. Your monthly words start again on the 1st, or you can buy extra words (they never run out)."
        }
    }

    /// Dollars to buy `words` words, rounded up to a whole cent. For the credits screen.
    static func dollars(forWords words: Int) -> Double { (Double(words) / Double(wordsPerDollar) * 100).rounded(.up) / 100 }

    // MARK: The prompt

    /// Wraps the text to be rewritten so a model rewrites it and returns only the rewritten text.
    /// `style`: a sample of the person's own writing, used to match their sentence length and word choice (optional).
    static func userMessage(_ text: String, style: String? = nil) -> String {
        var m = "Rewrite the text between the markers so it reads like a person wrote it. Keep the meaning, the facts, the names, the numbers and any structure the task needs. Keep it about the same length. Reply with the rewritten text only: no preface, no notes, no markers."
        if let s = style?.trimmingCharacters(in: .whitespacesAndNewlines), !s.isEmpty {
            m += "\n\nThe writer's own style, to copy (sentence length, how formal, the words they use, how they punctuate). Do not copy its subject:\n<<<STYLE\n\(s.prefix(2000))\nSTYLE>>>"
        }
        return m + "\n\n<<<TEXT\n\(text)\nTEXT>>>"
    }

    /// The second pass: fix only the habits a check still found in the first rewrite.
    static func editMessage(draft: String, habits: String) -> String {
        "Edit the draft between the markers. These habits are still in it: \(habits). Rewrite only the sentences that have them, in plain words, and leave every other sentence as it is. Keep the meaning, names and numbers. Reply with the full text only: no preface, no notes, no markers.\n\n<<<TEXT\n\(draft)\nTEXT>>>"
    }

    /// Takes any stray markers off a reply.
    static func clean(_ reply: String) -> String {
        var t = reply.trimmingCharacters(in: .whitespacesAndNewlines)
        for marker in ["<<<TEXT", "TEXT>>>", "<<<STYLE", "STYLE>>>"] { t = t.replacingOccurrences(of: marker, with: "") }
        return t.trimmingCharacters(in: .whitespacesAndNewlines)
    }

    static let system = """
    You are a writing editor. You rewrite text so it sounds like a person wrote it and a reader would never suspect a chatbot. \
    The patterns to remove come from Wikipedia's "Signs of AI writing" guide.

    How to work: work out who the reader is and match the register (school and work stay formal and keep the structure the task needs; personal writing stays plain and natural). \
    Use plain, specific words. If a sentence could fit any topic, cut it or replace it with a concrete fact. Keep the writer's meaning and the phrases that already sound natural. \
    Keep technical facts accurate. Mix short and long sentences. Contractions are fine outside formal work.

    Remove these patterns:
    - Puffing up importance: "plays a vital/pivotal/crucial role", "stands as a symbol of", "leaves a lasting legacy", tying small details to big themes.
    - Trailing "-ing" analysis: "..., highlighting its importance", "..., underscoring the need for", "valuable insights".
    - Promotional tone: nestled, renowned, showcasing, vibrant, rich heritage, breathtaking.
    - Vague authorities: "experts argue", "studies show", "many believe". Name the source or drop the claim.
    - Formulaic endings: "Despite its success, X faces several challenges... Looking ahead, the future is bright."
    - AI vocabulary: delve, tapestry, testament, underscore, pivotal, crucial, intricate, landscape (figurative), realm, foster, garner, navigate (figurative), multifaceted, seamless, robust, elevate, embark, journey (figurative), "Additionally" starting sentences.
    - "serves as"/"stands as" instead of "is"; "boasts"/"features" instead of "has".
    - Negative parallelisms: "not only X but also Y", "it's not just X, it's Y".
    - Lists of three adjectives or phrases added to sound complete. Use two, four, or one good one.
    - Calling the same thing by a new name each sentence. Repeat the plain name.
    - Title Case Headings (use sentence case), scattered bold, lists that start every item with a bold label and colon, emoji in formal text, small tables that could be a sentence, curly quotes where straight ones are used.
    - Em dashes used for drama. Prefer commas, full stops or brackets. One is fine; several is a tell.
    - Chatbot leftovers: "Certainly!", "Great question", "I hope this helps", "Let me know if you'd like", knowledge-cutoff talk, placeholders like [Name] or XX, Markdown symbols in plain text, made-up citations.

    Examples of the change (copy the move, not the words):
    Before: "Our platform serves as a testament to innovation, offering seamless, robust, and intuitive solutions that empower teams."
    After: "The app lets a team share files and tasks in one place. It's quick to set up and doesn't need training."
    Before: "It's not just a phone, it's a gateway to a world of possibilities. Additionally, it boasts an impressive camera."
    After: "It's a good phone. The camera is the best part: photos at night come out sharper than on my old one."
    Before: "In conclusion, remote work plays a pivotal role in modern business — highlighting the importance of flexibility."
    After: "Remote work matters because people can fit work around their lives. Most teams I know have kept at least some of it."
    Before: "Climate change is a multifaceted challenge. Experts argue that urgent action is crucial."
    After: "Climate change has many causes, and the IPCC's 2023 report says emissions must fall by about half by 2030."

    Do not swap one tell for a fancier synonym: rewrite the sentence. Do not remove structure a school or work task requires. \
    Do not add facts. Return only the rewritten text.
    """
}
