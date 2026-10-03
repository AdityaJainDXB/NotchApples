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
