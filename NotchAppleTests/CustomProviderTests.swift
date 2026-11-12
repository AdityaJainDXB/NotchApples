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

    // MARK: Rejected before any network request

    func testCloudNamedModelIsRejectedWithoutAnyRequest() async {
        // No server is needed (or contacted): the name alone decides, so this returns at once even offline.
        for provider in [AIProvider.ollama, .custom] {
            do {
                try await ModelLocality.requireVerifiedLocal(provider: provider, model: "gpt-oss:120b-cloud")
                XCTFail("a cloud model must be rejected")
            } catch let e as AIError {
                if case .notVerifiedLocal = e {} else { XCTFail("wrong error \(e)") }
            } catch { XCTFail("wrong error \(error)") }
        }
    }

    func testCloudProvidersAreRejectedWithoutAnyRequest() async {
        do { try await ModelLocality.requireVerifiedLocal(provider: .gemini, model: "gemini-3.5-flash"); XCTFail("must reject") }
        catch let e as AIError { if case .notVerifiedLocal = e {} else { XCTFail("wrong error") } }
        catch { XCTFail("wrong error") }
    }

    // MARK: Default semantics

    func testLocalFirstIsOnByDefaultSoCloudAndUnverifiedAreBlocked() {
        let key = ModelLocality.allowCloudKey
        let saved = UserDefaults.standard.object(forKey: key)
        defer { if let saved { UserDefaults.standard.set(saved, forKey: key) } else { UserDefaults.standard.removeObject(forKey: key) } }
        UserDefaults.standard.removeObject(forKey: key)          // a first launch: nothing saved
        XCTAssertFalse(ModelLocality.allowCloud, "'Allow cloud and unverified models' must be OFF until the user turns it on")
        XCTAssertTrue(ModelLocality.isBlocked(provider: .ollama, model: "gpt-oss:120b-cloud", allowCloud: ModelLocality.allowCloud))
    }

    // MARK: Remembered verification (fast, still fail closed)

    private final class Box<T>: @unchecked Sendable { var value: Result<T, Error>? }
    private final class Server: @unchecked Sendable {
        var requests = 0
        var body: Data
        var fails = false
        init(_ body: Data) { self.body = body }
        func fetch() -> ModelLocality.TagsFetch {
            { [self] _ in
                requests += 1
                if fails { throw URLError(.timedOut) }
                return body
            }
        }
    }
    private final class Clock: @unchecked Sendable { var t: TimeInterval = 1_000; func now() -> Date { Date(timeIntervalSince1970: t) } }

    private func tags(_ models: [[String: Any]]) -> Data { try! JSONSerialization.data(withJSONObject: ["models": models]) }
    private var goodTags: Data {
        tags([["name": "qwen3:8b-64k", "size": 5_200_000_000, "digest": "a1"],
              ["name": "plain-but-remote:7b", "size": 0, "digest": "b2", "remote_host": "https://ollama.com:443"]])
    }

    /// Runs an async check from a synchronous test (the test runner has no async tests).
    private func run(_ op: @escaping @Sendable () async throws -> Void) -> Error? {
        let box = Box<Void>(); let sem = DispatchSemaphore(value: 0)
        Task.detached { do { try await op(); box.value = .success(()) } catch { box.value = .failure(error) }; sem.signal() }
        sem.wait()
        if case .failure(let e)? = box.value { return e }
        return nil
    }
    private func verify(_ model: String, provider: AIProvider = .ollama, cache: ModelLocality.TagsCache, clock: Clock, server: Server) -> Error? {
        run { try await ModelLocality.requireVerifiedLocal(provider: provider, model: model, cache: cache, now: { clock.now() }, fetch: server.fetch()) }
    }

    func testSecondMessageReusesTheRememberedAnswer() {
        let cache = ModelLocality.TagsCache(), clock = Clock(), server = Server(goodTags)
        XCTAssertNil(verify("qwen3:8b-64k", cache: cache, clock: clock, server: server))
        XCTAssertNil(verify("qwen3:8b-64k", cache: cache, clock: clock, server: server))
        XCTAssertEqual(server.requests, 1)
    }

    func testRememberedAnswerExpires() {
        let cache = ModelLocality.TagsCache(), clock = Clock(), server = Server(goodTags)
        XCTAssertNil(verify("qwen3:8b-64k", cache: cache, clock: clock, server: server))
        clock.t += ModelLocality.TagsCache.ttl - 1
        XCTAssertNil(verify("qwen3:8b-64k", cache: cache, clock: clock, server: server))
        XCTAssertEqual(server.requests, 1)
        clock.t += 2
        XCTAssertNil(verify("qwen3:8b-64k", cache: cache, clock: clock, server: server))
        XCTAssertEqual(server.requests, 2)
    }

    func testClockGoingBackwardsDoesNotStretchTheMemory() {
        let cache = ModelLocality.TagsCache(), clock = Clock(), server = Server(goodTags)
        XCTAssertNil(verify("qwen3:8b-64k", cache: cache, clock: clock, server: server))
        clock.t -= 500
        XCTAssertNil(verify("qwen3:8b-64k", cache: cache, clock: clock, server: server))
        XCTAssertEqual(server.requests, 2)
    }

    func testCloudNamedModelNeverReachesTheNetworkOrTheMemory() {
        let cache = ModelLocality.TagsCache(), clock = Clock(), server = Server(goodTags)
        XCTAssertNil(verify("qwen3:8b-64k", cache: cache, clock: clock, server: server))
        XCTAssertNotNil(verify("gpt-oss:120b-cloud", cache: cache, clock: clock, server: server))
        XCTAssertEqual(server.requests, 1)      // only the first, local model's check
    }

    func testCloudProvidersAndRemoteCustomURLsNeverReachTheNetwork() {
        let cache = ModelLocality.TagsCache(), clock = Clock(), server = Server(goodTags)
        XCTAssertNotNil(verify("gemini-3.5-flash", provider: .gemini, cache: cache, clock: clock, server: server))
        XCTAssertNotNil(verify("x", provider: .claude, cache: cache, clock: clock, server: server))
        XCTAssertNotNil(verify("notch-fast", provider: .hosted, cache: cache, clock: clock, server: server))
        let old = UserDefaults.standard.string(forKey: "ai.custom.baseURL")
        defer { UserDefaults.standard.set(old, forKey: "ai.custom.baseURL") }
        AIProvider.customBaseURL = "https://example.com/v1"
        XCTAssertNotNil(verify("qwen3:8b-64k", provider: .custom, cache: cache, clock: clock, server: server))
        XCTAssertEqual(server.requests, 0)
    }

    func testUnlistedModelAsksAgainAndIsRefused() {
        let cache = ModelLocality.TagsCache(), clock = Clock(), server = Server(goodTags)
        XCTAssertNil(verify("qwen3:8b-64k", cache: cache, clock: clock, server: server))
        XCTAssertNotNil(verify("ghost:1b", cache: cache, clock: clock, server: server))
        XCTAssertEqual(server.requests, 2)
    }

    func testAModelThatIsNotLocalIsNeverLetThroughFromMemory() {
        let cache = ModelLocality.TagsCache(), clock = Clock(), server = Server(goodTags)
        XCTAssertNotNil(verify("plain-but-remote:7b", cache: cache, clock: clock, server: server))
        XCTAssertNotNil(verify("plain-but-remote:7b", cache: cache, clock: clock, server: server))
        XCTAssertEqual(server.requests, 2)      // refused models always ask the server again
    }

    func testAnUnreachableServerFailsClosedAndForgetsTheMemory() {
        let cache = ModelLocality.TagsCache(), clock = Clock(), server = Server(goodTags)
        XCTAssertNil(verify("qwen3:8b-64k", cache: cache, clock: clock, server: server))
        XCTAssertEqual(cache.count, 1)
        clock.t += ModelLocality.TagsCache.ttl + 1
        server.fails = true
        XCTAssertNotNil(verify("qwen3:8b-64k", cache: cache, clock: clock, server: server))
        XCTAssertEqual(cache.count, 0)
        server.fails = false
        XCTAssertNil(verify("qwen3:8b-64k", cache: cache, clock: clock, server: server))
    }

    func testAServerThatIsNotOllamaFailsClosedAndForgetsTheMemory() {
        let cache = ModelLocality.TagsCache(), clock = Clock(), server = Server(goodTags)
        XCTAssertNil(verify("qwen3:8b-64k", cache: cache, clock: clock, server: server))
        clock.t += ModelLocality.TagsCache.ttl + 1
        server.body = Data("<html>hi</html>".utf8)
        XCTAssertNotNil(verify("qwen3:8b-64k", cache: cache, clock: clock, server: server))
        XCTAssertEqual(cache.count, 0)
    }

    func testChangingTheCustomAddressForgetsTheSharedMemory() {
        let old = UserDefaults.standard.string(forKey: "ai.custom.baseURL")
        defer { UserDefaults.standard.set(old, forKey: "ai.custom.baseURL") }
        ModelLocality.TagsCache.shared.store([["name": "qwen3:8b"]], for: URL(string: "http://localhost:11434/api/tags")!, now: Date())
        XCTAssertEqual(ModelLocality.TagsCache.shared.count, 1)
        AIProvider.customBaseURL = "http://192.168.1.20:1234/v1"
        XCTAssertEqual(ModelLocality.TagsCache.shared.count, 0)
    }

    // MARK: Picker labels

    func testBadgesNameWhereAModelRuns() {
        typealias B = ModelLocality.Badge
        XCTAssertEqual(ModelLocality.badge(provider: .apple, model: "on-device", verdict: nil), B.local)
        XCTAssertEqual(ModelLocality.badge(provider: .ollama, model: "qwen3:8b", verdict: .local), B.local)
        XCTAssertEqual(ModelLocality.badge(provider: .ollama, model: "qwen3:8b", verdict: nil), B.unverified)
        XCTAssertEqual(ModelLocality.badge(provider: .ollama, model: "qwen3:8b", verdict: .unverified("x")), B.unverified)
        XCTAssertEqual(ModelLocality.badge(provider: .ollama, model: "x", verdict: .cloud("remote")), B.cloud)
        XCTAssertEqual(ModelLocality.badge(provider: .ollama, model: "gpt-oss:120b-cloud", verdict: .local), B.cloud)
        XCTAssertEqual(ModelLocality.badge(provider: .custom, model: "qwen3:8b", customBaseURL: "http://localhost:11434/v1", verdict: .local), B.local)
        XCTAssertEqual(ModelLocality.badge(provider: .custom, model: "qwen3:8b", customBaseURL: "http://127.0.0.1:11434/v1", verdict: .local), B.local)
        XCTAssertEqual(ModelLocality.badge(provider: .custom, model: "qwen3:8b", customBaseURL: "http://192.168.1.20:11434/v1", verdict: .local), B.localNetwork)
        XCTAssertEqual(ModelLocality.badge(provider: .custom, model: "qwen3:8b", customBaseURL: "http://studio.local:11434/v1", verdict: .local), B.localNetwork)
        XCTAssertEqual(ModelLocality.badge(provider: .custom, model: "qwen3:8b", customBaseURL: "http://192.168.1.20:11434/v1", verdict: nil), B.unverified)
        XCTAssertEqual(ModelLocality.badge(provider: .custom, model: "qwen3:8b", customBaseURL: "https://example.com/v1", verdict: .local), B.cloud)
        XCTAssertEqual(ModelLocality.badge(provider: .gemini, model: "gemini-3.5-flash", verdict: nil), B.cloud)
        XCTAssertEqual(B.local.label, "Local")
        XCTAssertEqual(B.localNetwork.label, "Local network")
        XCTAssertEqual(B.cloud.label, "Cloud")
        XCTAssertEqual(B.unverified.label, "Unverified")
    }

    func testLoopbackIsOnlyThisMac() {
        for u in ["http://localhost:1/v1", "http://127.0.0.1:1/v1", "http://[::1]:1/v1"] { XCTAssertTrue(ModelLocality.isLoopbackHost(u), u) }
        for u in ["http://192.168.1.2/v1", "http://10.0.0.5/v1", "http://studio.local/v1", "https://example.com/v1"] { XCTAssertFalse(ModelLocality.isLoopbackHost(u), u) }
    }

    func testLabelsDoNotChangeWhatIsBlocked() {
        // The label logic is display only: the classification and the block rules are exactly as before.
        XCTAssertEqual(ModelLocality.of(provider: .custom, model: "qwen3:8b", customBaseURL: "http://192.168.1.20:1234/v1"), .local)
        XCTAssertTrue(ModelLocality.isBlocked(provider: .ollama, model: "x:cloud", allowCloud: false))
    }

    func testPickerVerdictsUseOneRequestAndFailClosedLabels() {
        let cache = ModelLocality.TagsCache(), clock = Clock(), server = Server(goodTags)
        let box = Box<[String: ModelLocality.Verdict]>(); let sem = DispatchSemaphore(value: 0)
        Task.detached {
            let v = await ModelLocality.verdicts(provider: .ollama, models: ["qwen3:8b-64k", "plain-but-remote:7b", "ghost:1b"], cache: cache, now: { clock.now() }, fetch: server.fetch())
            box.value = .success(v); sem.signal()
        }
        sem.wait()
        guard case .success(let v)? = box.value else { return XCTFail("no result") }
        XCTAssertEqual(server.requests, 1)
        XCTAssertEqual(v["qwen3:8b-64k"], .local)
        if case .cloud? = v["plain-but-remote:7b"] {} else { XCTFail("remote model should be cloud") }
        if case .unverified? = v["ghost:1b"] {} else { XCTFail("unlisted model should be unverified") }

        let down = Server(goodTags); down.fails = true
        let box2 = Box<[String: ModelLocality.Verdict]>(); let sem2 = DispatchSemaphore(value: 0)
        Task.detached {
            let v = await ModelLocality.verdicts(provider: .ollama, models: ["qwen3:8b-64k"], cache: ModelLocality.TagsCache(), now: { clock.now() }, fetch: down.fetch())
            box2.value = .success(v); sem2.signal()
        }
        sem2.wait()
        guard case .success(let v2)? = box2.value else { return XCTFail("no result") }
        if case .unverified? = v2["qwen3:8b-64k"] {} else { XCTFail("an unreachable server must leave models unverified") }
    }

    // MARK: Local first, up front

    func testLocalFirstRefusesCloudProvidersUpFront() {
        let key = ModelLocality.allowCloudKey
        let saved = UserDefaults.standard.object(forKey: key)
        defer { if let saved { UserDefaults.standard.set(saved, forKey: key) } else { UserDefaults.standard.removeObject(forKey: key) } }
        UserDefaults.standard.set(false, forKey: key)
        XCTAssertTrue(NotchAIGuard.refusesProvider(.gemini))
        XCTAssertTrue(NotchAIGuard.refusesProvider(.openAI))
        XCTAssertFalse(NotchAIGuard.refusesProvider(.ollama))   // decided later, from the server's model list
        XCTAssertFalse(NotchAIGuard.refusesProvider(.custom))
        XCTAssertFalse(NotchAIGuard.refusesProvider(.apple))
        UserDefaults.standard.set(true, forKey: key)
        XCTAssertFalse(NotchAIGuard.refusesProvider(.gemini))
    }
}
