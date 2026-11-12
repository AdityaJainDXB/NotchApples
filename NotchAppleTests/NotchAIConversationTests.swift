//
//  NotchAIConversationTests.swift
//  Notch Apple tests
//
//  What Regenerate re-asks, how a long chat is trimmed, and the Ollama diagnostics report.
//

import XCTest

final class NotchAIConversationTests: XCTestCase {
    typealias T = NotchAIConversationLogic.Turn
    private func u(_ s: String) -> T { T(role: "user", text: s) }
    private func a(_ s: String) -> T { T(role: "assistant", text: s) }

    // MARK: Regenerate

    func testRegenerateReasksTheLastQuestionAndDropsTheReply() {
        let plan = NotchAIConversationLogic.regeneration([u("q1"), a("a1"), u("q2"), a("a2")])
        XCTAssertEqual(plan?.question, "q2")
        XCTAssertEqual(plan?.history, [u("q1"), a("a1")])
    }

    func testRegenerateAfterAFailedAttemptReasksThatQuestion() {
        let plan = NotchAIConversationLogic.regeneration([u("q1"), a("a1"), u("q2")])
        XCTAssertEqual(plan?.question, "q2")
        XCTAssertEqual(plan?.history, [u("q1"), a("a1")])
    }

    func testRegenerateNeedsAQuestion() {
        XCTAssertNil(NotchAIConversationLogic.regeneration([]))
        XCTAssertNil(NotchAIConversationLogic.regeneration([a("hi")]))
        XCTAssertNil(NotchAIConversationLogic.regeneration([u("   ")]))
    }

    // MARK: Trimming

    func testShortChatsAreKeptWhole() {
        let turns = [u("a"), a("b"), u("c")]
        XCTAssertEqual(NotchAIConversationLogic.trimmed(turns, maxCharacters: 1000), turns)
    }

    func testLongChatsKeepTheNewestTurnsAndNeverStartOnAReply() {
        let turns = [u(String(repeating: "x", count: 50)), a(String(repeating: "y", count: 50)), u("short"), a("ok"), u("last")]
        let out = NotchAIConversationLogic.trimmed(turns, maxCharacters: 14)
        XCTAssertEqual(out.last, u("last"))
        XCTAssertEqual(out.first?.role, "user")
        XCTAssertLessThanOrEqual(out.map(\.text.count).reduce(0, +), 14)
    }

    func testTheLastTurnIsAlwaysKeptEvenIfHuge() {
        let big = u(String(repeating: "z", count: 500))
        XCTAssertEqual(NotchAIConversationLogic.trimmed([u("a"), a("b"), big], maxCharacters: 10), [big])
    }

    func testContextBudget() {
        XCTAssertEqual(NotchAIConversationLogic.contextBudget(windowTokens: nil), 24_000)
        XCTAssertEqual(NotchAIConversationLogic.contextBudget(windowTokens: 40_960), 122_880)
        XCTAssertEqual(NotchAIConversationLogic.contextBudget(windowTokens: 100), 2_000)
    }

    // MARK: Ollama diagnostics

    private func data(_ obj: Any) -> Data { try! JSONSerialization.data(withJSONObject: obj) }
    private let version = ["version": "0.40.16"]
    private var tags: [String: Any] { ["models": [
        ["name": "qwen3:8b", "model": "qwen3:8b", "size": 5_225_388_164, "digest": "abc",
         "details": ["parameter_size": "8.2B", "quantization_level": "Q4_K_M", "context_length": 40960]],
        ["name": "gpt-oss:120b", "model": "gpt-oss:120b", "size": 0, "digest": "d", "remote_host": "https://ollama.com:443"],
    ]] }

    func testNotRunningGivesAStartHint() {
        let r = OllamaDiagnosticsLogic.report(versionData: nil, tagsData: nil, selectedModel: "qwen3:8b", allowCloud: false)
        XCTAssertFalse(r.running)
        XCTAssertEqual(r.findings.first?.level, .problem)
        XCTAssertTrue(r.findings.first?.text.contains("ollama serve") == true)
    }

    func testSomethingElseOnThePortIsNotOllama() {
        let r = OllamaDiagnosticsLogic.report(versionData: data(version), tagsData: Data("<html>".utf8), selectedModel: nil, allowCloud: false)
        XCTAssertFalse(r.running)
        XCTAssertTrue(r.findings.first?.text.contains("isn't Ollama's model list") == true)
    }

    func testRunningListsModelsWithBadgesAndContext() {
        let r = OllamaDiagnosticsLogic.report(versionData: data(version), tagsData: data(tags), selectedModel: "qwen3:8b", allowCloud: false)
        XCTAssertTrue(r.running)
        XCTAssertEqual(r.version, "0.40.16")
        XCTAssertEqual(r.models.map(\.badge), ["Local", "Cloud"])
        XCTAssertTrue(r.models[0].detail.contains("8.2B"))
        XCTAssertTrue(r.models[0].detail.contains("40k context"))
        XCTAssertEqual(r.selectedContextTokens, 40960)
        XCTAssertTrue(r.findings.contains { $0.level == .ok && $0.text.contains("qwen3:8b is installed and verified") })
    }

    func testSelectedCloudModelIsAProblemWhileLocalFirstIsOn() {
        let on = OllamaDiagnosticsLogic.report(versionData: data(version), tagsData: data(tags), selectedModel: "gpt-oss:120b", allowCloud: false)
        XCTAssertTrue(on.findings.contains { $0.level == .problem && $0.text.contains("refuse") })
        let off = OllamaDiagnosticsLogic.report(versionData: data(version), tagsData: data(tags), selectedModel: "gpt-oss:120b", allowCloud: true)
        XCTAssertTrue(off.findings.contains { $0.level == .warning && $0.text.contains("leave this Mac") })
    }

    func testMissingSelectedModelListsWhatIsInstalled() {
        let r = OllamaDiagnosticsLogic.report(versionData: data(version), tagsData: data(tags), selectedModel: "llama3.2", allowCloud: false)
        XCTAssertTrue(r.findings.contains { $0.level == .problem && $0.text.contains("Installed local models: qwen3:8b") })
    }

    func testNoLocalModelsSuggestsAPull() {
        let none = ["models": [Any]()]
        let r = OllamaDiagnosticsLogic.report(versionData: data(version), tagsData: data(none), selectedModel: nil, allowCloud: false)
        XCTAssertTrue(r.running)
        XCTAssertTrue(r.findings.contains { $0.text.contains("ollama pull qwen3:8b") })
    }
}
