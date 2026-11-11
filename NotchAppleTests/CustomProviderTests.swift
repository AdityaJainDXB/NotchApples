//
//  CustomProviderTests.swift
//  Notch Apple tests
//
//  The custom OpenAI-compatible AI provider (Settings -> AI): base URL handling and "no key needed".
//

import XCTest

final class CustomProviderTests: XCTestCase {
    // MARK: Custom provider

    func testCustomProviderNeedsNoKeyButHasAURL() {
        let old = UserDefaults.standard.string(forKey: "ai.custom.baseURL")
        defer { UserDefaults.standard.set(old, forKey: "ai.custom.baseURL") }
        XCTAssertFalse(AIProvider.custom.needsKey)
        AIProvider.customBaseURL = "http://localhost:11434/v1/ "
        XCTAssertEqual(AIProvider.customBaseURL, "http://localhost:11434/v1")
        XCTAssertTrue(AIProvider.custom.isConfigured)
        XCTAssertTrue(AIProvider.custom.isFree)
        XCTAssertEqual(AIProvider.custom.fallbackModel, "qwen3:8b")
    }

    // MARK: Local vs cloud

    func testOllamaCloudNamesAreDetected() {
        XCTAssertTrue(ModelLocality.isOllamaCloudName("gpt-oss:120b-cloud"))
        XCTAssertTrue(ModelLocality.isOllamaCloudName("qwen3-coder:480b-cloud"))
        XCTAssertTrue(ModelLocality.isOllamaCloudName("deepseek-v3.1:671b:cloud"))
        XCTAssertFalse(ModelLocality.isOllamaCloudName("qwen3:8b"))
        XCTAssertFalse(ModelLocality.isOllamaCloudName("qwen3:8b-64k"))
    }

    func testLocalHosts() {
        for u in ["http://localhost:11434/v1", "http://127.0.0.1:11434/v1", "http://[::1]:11434/v1", "http://192.168.1.20:1234/v1", "http://10.0.0.5/v1", "http://studio.local:11434/v1"] {
            XCTAssertTrue(ModelLocality.isLocalHost(u), u)
        }
        for u in ["https://ollama.com/v1", "https://api.openai.com/v1", "http://8.8.8.8/v1", "http://172.32.0.1/v1"] {
            XCTAssertFalse(ModelLocality.isLocalHost(u), u)
        }
    }

    func testLocality() {
        XCTAssertEqual(ModelLocality.of(provider: .ollama, model: "qwen3:8b"), .local)
        XCTAssertEqual(ModelLocality.of(provider: .ollama, model: "gpt-oss:120b-cloud"), .cloud)
        XCTAssertEqual(ModelLocality.of(provider: .custom, model: "qwen3:8b", customBaseURL: "http://localhost:11434/v1"), .local)
        XCTAssertEqual(ModelLocality.of(provider: .custom, model: "qwen3:8b", customBaseURL: "https://example.com/v1"), .cloud)
        XCTAssertEqual(ModelLocality.of(provider: .custom, model: "x-cloud", customBaseURL: "http://localhost:11434/v1"), .cloud)
        XCTAssertEqual(ModelLocality.of(provider: .gemini, model: "gemini-3.5-flash"), .cloud)
        XCTAssertEqual(ModelLocality.of(provider: .apple, model: "on-device"), .local)
    }

    func testCloudModelsAreBlockedUntilAllowed() {
        XCTAssertTrue(ModelLocality.isBlocked(provider: .ollama, model: "gpt-oss:120b-cloud", allowCloud: false))
        XCTAssertFalse(ModelLocality.isBlocked(provider: .ollama, model: "gpt-oss:120b-cloud", allowCloud: true))
        XCTAssertFalse(ModelLocality.isBlocked(provider: .ollama, model: "qwen3:8b", allowCloud: false))
        XCTAssertTrue(ModelLocality.isBlocked(provider: .custom, model: "x:cloud", allowCloud: false))
    }

    // MARK: Verified from server metadata (fail closed)

    private let installed: [[String: Any]] = [
        ["name": "qwen3:8b", "model": "qwen3:8b", "size": 5225388164, "digest": "500a1f06"],
        ["name": "gpt-oss:120b", "model": "gpt-oss:120b", "size": 0, "digest": "ab", "remote_host": "https://ollama.com:443", "remote_model": "gpt-oss:120b"],
        ["name": "mystery:1b", "model": "mystery:1b", "size": 100, "digest": ""],
        ["name": "tiny:latest", "model": "tiny:latest", "size": 100, "digest": "cd"],
    ]

    func testInstalledModelWithWeightsIsLocal() {
        XCTAssertEqual(ModelLocality.verdict(tags: installed, model: "qwen3:8b"), .local)
        XCTAssertEqual(ModelLocality.verdict(tags: installed, model: "tiny"), .local)   // :latest is implied
    }

    func testRemoteMetadataMeansCloudEvenWithoutCloudInTheName() {
        if case .cloud = ModelLocality.verdict(tags: installed, model: "gpt-oss:120b") {} else { XCTFail("remote_host must mean cloud") }
    }

    func testUnknownOrIncompleteModelsFailClosed() {
        if case .unverified = ModelLocality.verdict(tags: installed, model: "not-installed:7b") {} else { XCTFail("unknown must be unverified") }
        if case .unverified = ModelLocality.verdict(tags: installed, model: "mystery:1b") {} else { XCTFail("no digest must be unverified") }
        if case .unverified = ModelLocality.verdict(tags: [], model: "qwen3:8b") {} else { XCTFail("empty list must be unverified") }
    }

    func testCloudNameWinsOverMetadata() {
        let tags: [[String: Any]] = [["name": "x-cloud", "model": "x-cloud", "size": 99, "digest": "ee"]]
        if case .cloud = ModelLocality.verdict(tags: tags, model: "x-cloud") {} else { XCTFail() }
    }

    func testModelListURLs() {
        XCTAssertEqual(ModelLocality.tagsURL(provider: .ollama)?.absoluteString, "http://localhost:11434/api/tags")
        XCTAssertEqual(ModelLocality.tagsURL(provider: .custom, customBaseURL: "http://192.168.1.5:11434/v1")?.absoluteString, "http://192.168.1.5:11434/api/tags")
        XCTAssertNil(ModelLocality.tagsURL(provider: .custom, customBaseURL: "https://example.com/v1"))
        XCTAssertNil(ModelLocality.tagsURL(provider: .gemini))
    }
}
