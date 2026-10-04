//
//  LogicTests.swift
//  Notch apple tests
//
//  Pure logic, compiled straight into the test bundle (no app host, so running
//  the tests never opens a second notch): readable math, answer parsing, input
//  suggestions, provider error messages and mode instructions.
//
//  Run: xcodebuild test -project NotchApple.xcodeproj -scheme NotchAppleTests
//

import XCTest

final class MathTextTests: XCTestCase {
    func testFractionsPowersRoots() {
        XCTAssertEqual(MathText.readable(#"\frac{1}{2}"#), "1⁄2")
        XCTAssertEqual(MathText.readable("x^2 + y^{10}"), "x² + y¹⁰")
        XCTAssertEqual(MathText.readable(#"\sqrt{x}"#), "√x")
        XCTAssertEqual(MathText.readable(#"\sqrt{x+1}"#), "√(x+1)")
        XCTAssertEqual(MathText.readable(#"a_{n+1}"#), "aₙ₊₁")
        XCTAssertEqual(MathText.readable(#"\frac{x+1}{2}"#), "(x+1)⁄2")
    }

    func testSymbols() {
        XCTAssertEqual(MathText.readable(#"\alpha \le \pi \times 2"#), "α ≤ π × 2")
        XCTAssertEqual(MathText.readable(#"x \neq 3"#), "x ≠ 3")
        XCTAssertEqual(MathText.readable(#"\text{area} = \pi r^2"#), "area = π r²")
    }

    func testInlineMathButNotMoney() {
        XCTAssertEqual(MathText.inline("So $x^2 = 4$ here"), "So x² = 4 here")
        XCTAssertEqual(MathText.inline("It costs $5 and $10 today"), "It costs $5 and $10 today")
        XCTAssertEqual(MathText.inline(#"Then \(a+b\)"#), "Then a+b")
        XCTAssertEqual(MathText.inline("so $$x^2 = 4$$ has two"), "so x² = 4 has two")
    }

    func testBlocks() {
        let md = """
        # Steps
        First line with $x$.

        $$\\frac{a}{b}$$

        ```swift
        let x = 1
        ```

        | A | B |
        |---|---|
        | 1 | 2 |
        """
        let blocks = RichBlocks.parse(md)
        XCTAssertEqual(blocks.count, 5)
        XCTAssertEqual(blocks[0], .heading("Steps", 1))
        XCTAssertEqual(blocks[1], .text("First line with x."))
        XCTAssertEqual(blocks[2], .math("a⁄b"))
        XCTAssertEqual(blocks[3], .code("let x = 1", "swift"))
        XCTAssertEqual(blocks[4], .table([["A", "B"], ["1", "2"]]))
    }

    func testMultilineDisplayMath() {
        XCTAssertEqual(RichBlocks.parse("\\[\nx = 2\n\\]"), [.math("x = 2")])
    }

    func testPlainCopy() {
        XCTAssertEqual(MathText.plain("Answer: $x = \\frac{1}{2}$"), "Answer: x = 1⁄2")
    }
}

final class ClassifierTests: XCTestCase {
    func testMath() {
        let r = InputClassifier.classify(text: "Solve for x: 2x + 3 = 11")
        XCTAssertEqual(r.label, "Looks like math")
        XCTAssertEqual(r.suggested.first, .solve)
    }

    func testCode() {
        let r = InputClassifier.classify(text: """
        func load() {
            let x = 1;
            return x
        }
        """)
        XCTAssertEqual(r.suggested.first, .code)
    }

    func testError() {
        let r = InputClassifier.classify(text: "Traceback (most recent call last): TypeError: cannot read property 'x' of undefined")
        XCTAssertEqual(r.label, "Looks like an error message")
    }

    func testLongText() {
        let text = Array(repeating: "The quick brown fox jumps over the lazy dog near the river bank.", count: 8).joined(separator: " ")
        XCTAssertEqual(InputClassifier.classify(text: text).suggested.first, .summarize)
    }

    func testChart() {
        let r = InputClassifier.classify(text: "Revenue 2022 2023 2024 120 140 175 0 50 100 150 200 Q1 Q2 Q3 Q4")
        XCTAssertEqual(r.label, "Looks like a chart or table")
        XCTAssertEqual(r.suggested.first, .explain)
    }

    func testEmptyIsNeverCertain() {
        let r = InputClassifier.classify(text: "")
        XCTAssertNil(r.label)
        XCTAssertTrue(r.suggested.contains(.explain))
    }
}

final class ModeAndErrorTests: XCTestCase {
    func testInstructions() {
        XCTAssertTrue(AIMode.solve.instruction(extra: "").contains("step by step"))
        XCTAssertTrue(AIMode.hint.instruction(extra: "").contains("Don't reveal"))
        XCTAssertEqual(AIMode.ask.instruction(extra: "Why?"), "Why?")
        XCTAssertTrue(AIMode.summarize.instruction(extra: "in French").hasSuffix("Also: in French"))
    }

    func testErrorMapping() {
        func text(_ f: AIFailure) -> String { f.errorDescription ?? "" }
        XCTAssertTrue(text(AIFailure.from(status: 401, message: "bad key", provider: .gemini, model: "m")).contains("didn't accept your API key"))
        XCTAssertTrue(text(AIFailure.from(status: 429, message: "slow down", provider: .groq, model: "m")).contains("rate-limiting"))
        XCTAssertTrue(text(AIFailure.from(status: 404, message: "no", provider: .openAI, model: "gpt-x")).contains("gpt-x isn't available"))
        XCTAssertTrue(text(AIFailure.from(status: 400, message: "This model does not support image input", provider: .groq, model: "llama")).contains("can't read images"))
        XCTAssertTrue(text(AIFailure.from(status: 503, message: "overloaded", provider: .gemini, model: "m")).contains("having problems"))
        XCTAssertTrue(AIFailure.from(URLError(.notConnectedToInternet)) is AIFailure)
    }

    func testVisionGuess() {
        XCTAssertTrue(AIProvider.gemini.likelySupportsVision("gemini-2.5-flash"))
        XCTAssertFalse(AIProvider.deepSeek.likelySupportsVision("deepseek-chat"))
        XCTAssertTrue(AIProvider.ollama.likelySupportsVision("gemma3:4b"))
        XCTAssertFalse(AIProvider.ollama.likelySupportsVision("llama3.2"))
    }
}

final class AIExtrasTests: XCTestCase {
    func testSlashCommands() {
        guard case .mode(let m, let text, _)? = SlashCommand.parse("/summarize The quick brown fox") else { return XCTFail() }
        XCTAssertEqual(m, .summarize); XCTAssertEqual(text, "The quick brown fox")
        guard case .mode(.translate, let t2, let note)? = SlashCommand.parse("/translate fr: good morning") else { return XCTFail() }
        XCTAssertEqual(t2, "good morning"); XCTAssertEqual(note, "into fr")
        guard case .mode(.rewrite, _, let fixNote)? = SlashCommand.parse("/fix i has a apple") else { return XCTFail() }
        XCTAssertTrue(fixNote.contains("grammar"))
        guard case .web(let q)? = SlashCommand.parse("/web who won the race") else { return XCTFail() }
        XCTAssertEqual(q, "who won the race")
        guard case .help? = SlashCommand.parse("/help") else { return XCTFail() }
        guard case .mode(.summarize, let empty, _)? = SlashCommand.parse("/tldr") else { return XCTFail() }
        XCTAssertEqual(empty, "")
        XCTAssertNil(SlashCommand.parse("what is 1/2"))
        XCTAssertNil(SlashCommand.parse("/unknowncommand hi"))
    }

    func testWebResultsParsing() {
        let html = """
        <div class="result results_links"><div class="links_main links_deep result__body">
        <h2 class="result__title"><a rel="nofollow" class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fexample.com%2Fpage&amp;rut=abc">Example &amp; Co</a></h2>
        <a class="result__snippet" href="x">A <b>short</b> snippet.</a></div></div>
        <div class="result"><div class="result__body"><a class="result__a" href="https://second.org/">Second</a>
        <a class="result__snippet" href="y">Two</a></div></div>
        """
        let r = WebSearch.parse(html, limit: 5)
        XCTAssertEqual(r.count, 2)
        XCTAssertEqual(r[0].url, "https://example.com/page")
        XCTAssertEqual(r[0].title, "Example & Co")
        XCTAssertEqual(r[0].snippet, "A short snippet.")
        XCTAssertTrue(WebSearch.prompt("q", r).contains("[2] Second — https://second.org/"))
        XCTAssertTrue(WebSearch.sourcesMarkdown(r).contains("1. [Example & Co](https://example.com/page)"))
    }

    func testAutomationSchedule() {
        var a = Automation()
        a.hour = 8; a.minute = 0; a.weekdays = Set(1...7)
        let cal = Calendar.current
        let nineAM = cal.date(bySettingHour: 9, minute: 0, second: 0, of: .now)!
        XCTAssertTrue(a.isDue(now: nineAM))
        a.lastRun = cal.date(bySettingHour: 8, minute: 1, second: 0, of: .now)!
        XCTAssertFalse(a.isDue(now: nineAM), "already ran today")
        a.lastRun = nil
        let twoPM = cal.date(bySettingHour: 14, minute: 30, second: 0, of: .now)!
        XCTAssertFalse(a.isDue(now: twoPM), "missed by more than 6 hours")
        a.weekdays = []
        XCTAssertFalse(a.isDue(now: nineAM))
        a.weekdays = Set(1...7); a.enabled = false
        XCTAssertFalse(a.isDue(now: nineAM))
    }
}
