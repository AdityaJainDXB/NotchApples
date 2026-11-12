//
//  NotchAIOAuthTests.swift
//  Notch Apple tests
//
//  The pure parts of browser sign-in for connectors: PKCE (with the RFC 7636 example), well-known addresses, metadata,
//  the sign-in URL, the browser's answer (state check), token requests and responses, and refresh timing.
//

import XCTest

final class NotchAIOAuthTests: XCTestCase {
    private typealias L = OAuthLogic

    func testPKCEMatchesTheRFCExample() {
        XCTAssertEqual(L.challenge(forVerifier: "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk"), "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM")
    }

    func testRandomTokensAreUrlSafeLongEnoughAndDifferent() {
        let a = L.randomToken(bytes: 48), b = L.randomToken(bytes: 48)
        XCTAssertNotEqual(a, b)
        XCTAssertGreaterThanOrEqual(a.count, 43)
        XCTAssertLessThanOrEqual(a.count, 128)
        XCTAssertNil(a.range(of: "[^A-Za-z0-9_-]", options: .regularExpression))
    }

    func testOnlyHTTPSOrALocalTestServerIsSecure() {
        XCTAssertTrue(L.isSecure(URL(string: "https://mcp.example.com/x")!))
        XCTAssertTrue(L.isSecure(URL(string: "http://localhost:8080")!))
        XCTAssertTrue(L.isSecure(URL(string: "http://127.0.0.1:9")!))
        XCTAssertFalse(L.isSecure(URL(string: "http://mcp.example.com")!))
        XCTAssertFalse(L.isSecure(URL(string: "ftp://x.example")!))
    }

    func testWellKnownAddressesInsertThePathThenTryTheRoot() {
        let u = URL(string: "https://mcp.example.com/api/mcp?x=1")!
        XCTAssertEqual(L.wellKnown("oauth-protected-resource", for: u).map(\.absoluteString),
                       ["https://mcp.example.com/.well-known/oauth-protected-resource/api/mcp", "https://mcp.example.com/.well-known/oauth-protected-resource"])
        XCTAssertEqual(L.wellKnown("oauth-authorization-server", for: URL(string: "https://auth.example.com")!).map(\.absoluteString),
                       ["https://auth.example.com/.well-known/oauth-authorization-server"])
    }

    func testResourceMetadataIsReadFromTheChallengeHeader() {
        XCTAssertEqual(L.resourceMetadataURL(fromWWWAuthenticate: "Bearer realm=\"mcp\", resource_metadata=\"https://x.example/.well-known/oauth-protected-resource\"")?.host, "x.example")
        XCTAssertNil(L.resourceMetadataURL(fromWWWAuthenticate: "Bearer realm=\"mcp\""))
        XCTAssertNil(L.resourceMetadataURL(fromWWWAuthenticate: nil))
        XCTAssertNil(L.resourceMetadataURL(fromWWWAuthenticate: "resource_metadata=\"unterminated"))
    }

    func testMetadataParsingAndRefusalOfInsecureEndpoints() throws {
        let ok = #"{"issuer":"https://a.example","authorization_endpoint":"https://a.example/authorize","token_endpoint":"https://a.example/token","registration_endpoint":"https://a.example/register","code_challenge_methods_supported":["S256"],"scopes_supported":["read","write"]}"#
        let m = try L.serverMetadata(from: Data(ok.utf8))
        XCTAssertEqual(m.tokenEndpoint.path, "/token")
        XCTAssertEqual(m.registrationEndpoint?.path, "/register")
        XCTAssertEqual(m.scopes, ["read", "write"])
        XCTAssertTrue(m.supportsS256)
        XCTAssertFalse(try L.serverMetadata(from: Data(#"{"authorization_endpoint":"https://a.example/a","token_endpoint":"https://a.example/t","code_challenge_methods_supported":["plain"]}"#.utf8)).supportsS256)
        XCTAssertThrowsError(try L.serverMetadata(from: Data(#"{"authorization_endpoint":"http://a.example/a","token_endpoint":"https://a.example/t"}"#.utf8))) { XCTAssertEqual($0 as? OAuthError, .insecure("the sign-in page")) }
        XCTAssertThrowsError(try L.serverMetadata(from: Data(#"{"authorization_endpoint":"https://a.example/a","token_endpoint":"http://a.example/t"}"#.utf8)))
        XCTAssertThrowsError(try L.serverMetadata(from: Data(#"{"authorization_endpoint":"https://a.example/a"}"#.utf8)))
        XCTAssertThrowsError(try L.serverMetadata(from: Data("nope".utf8)))
    }

    func testResourceMetadataListsTheSignInServers() {
        XCTAssertEqual(L.authorizationServers(fromResourceMetadata: Data(#"{"resource":"https://x","authorization_servers":["https://auth.example.com"]}"#.utf8)).map(\.host), ["auth.example.com"])
        XCTAssertTrue(L.authorizationServers(fromResourceMetadata: Data("{}".utf8)).isEmpty)
    }

    func testRegistrationAsksForAPublicClientWithOurRedirect() throws {
        let j = try JSONSerialization.jsonObject(with: L.registrationBody(clientName: "Notch Apple")) as! [String: Any]
        XCTAssertEqual(j["token_endpoint_auth_method"] as? String, "none")          // no client secret
        XCTAssertEqual(j["redirect_uris"] as? [String], ["notchapple://oauth/callback"])
        XCTAssertEqual(j["grant_types"] as? [String], ["authorization_code", "refresh_token"])
        XCTAssertEqual(L.clientID(fromRegistration: Data(#"{"client_id":"abc123"}"#.utf8)), "abc123")
        XCTAssertNil(L.clientID(fromRegistration: Data("{}".utf8)))
    }

    func testTheSignInURLCarriesPKCEStateAndTheResource() throws {
        let m = try L.serverMetadata(from: Data(#"{"authorization_endpoint":"https://a.example/authorize?tenant=1","token_endpoint":"https://a.example/token"}"#.utf8))
        let u = L.authorizationURL(m, clientID: "cid", challenge: "CH", state: "ST", resource: "https://mcp.example.com/mcp", scope: "read write")!
        let q = Dictionary(uniqueKeysWithValues: URLComponents(url: u, resolvingAgainstBaseURL: false)!.queryItems!.map { ($0.name, $0.value ?? "") })
        XCTAssertEqual(q["tenant"], "1")                                              // the server's own query is kept
        XCTAssertEqual(q["response_type"], "code")
        XCTAssertEqual(q["client_id"], "cid")
        XCTAssertEqual(q["code_challenge"], "CH")
        XCTAssertEqual(q["code_challenge_method"], "S256")
        XCTAssertEqual(q["state"], "ST")
        XCTAssertEqual(q["redirect_uri"], "notchapple://oauth/callback")
        XCTAssertEqual(q["resource"], "https://mcp.example.com/mcp")
        XCTAssertEqual(q["scope"], "read write")
    }

    func testTheBrowsersAnswerMustCarryOurStateAndACode() throws {
        XCTAssertEqual(try L.callbackCode(URL(string: "notchapple://oauth/callback?code=XYZ&state=ST")!, expectedState: "ST"), "XYZ")
        XCTAssertThrowsError(try L.callbackCode(URL(string: "notchapple://oauth/callback?code=XYZ&state=OTHER")!, expectedState: "ST")) { XCTAssertEqual($0 as? OAuthError, .stateMismatch) }
        XCTAssertThrowsError(try L.callbackCode(URL(string: "notchapple://oauth/callback?code=XYZ")!, expectedState: "ST")) { XCTAssertEqual($0 as? OAuthError, .stateMismatch) }
        XCTAssertThrowsError(try L.callbackCode(URL(string: "notchapple://oauth/callback?state=ST")!, expectedState: "ST")) { XCTAssertEqual($0 as? OAuthError, .noCode) }
        XCTAssertThrowsError(try L.callbackCode(URL(string: "notchapple://oauth/callback?error=access_denied&error_description=No%20thanks&state=ST")!, expectedState: "ST")) { XCTAssertEqual($0 as? OAuthError, .denied("No thanks")) }
    }

    func testTokenRequestsAreFormEncodedAndEscaped() {
        let body = String(decoding: L.codeExchangeBody(code: "a b&c=d", verifier: "V", clientID: "cid", resource: "https://x/mcp"), as: UTF8.self)
        XCTAssertTrue(body.contains("grant_type=authorization_code"))
        XCTAssertTrue(body.contains("code=a%20b%26c%3Dd"), body)
        XCTAssertTrue(body.contains("code_verifier=V"))
        XCTAssertTrue(body.contains("redirect_uri=notchapple%3A%2F%2Foauth%2Fcallback"), body)
        XCTAssertTrue(body.contains("resource=https%3A%2F%2Fx%2Fmcp"))
        let r = String(decoding: L.refreshBody(refreshToken: "RT", clientID: "cid", resource: nil), as: UTF8.self)
        XCTAssertEqual(r, "grant_type=refresh_token&refresh_token=RT&client_id=cid")
    }

    func testTokenResponses() throws {
        let t0 = Date(timeIntervalSince1970: 1_000)
        let ep = URL(string: "https://a.example/token")!
        let t = try L.tokens(from: Data(#"{"access_token":"AT","refresh_token":"RT","expires_in":3600,"token_type":"Bearer"}"#.utf8), clientID: "cid", tokenEndpoint: ep, resource: nil, now: t0)
        XCTAssertEqual(t.accessToken, "AT"); XCTAssertEqual(t.refreshToken, "RT")
        XCTAssertEqual(t.expiresAt, t0.addingTimeInterval(3600))
        // A refresh that sends no new refresh token keeps the old one.
        let r = try L.tokens(from: Data(#"{"access_token":"AT2","expires_in":"60"}"#.utf8), clientID: "cid", tokenEndpoint: ep, resource: nil, keeping: t, now: t0)
        XCTAssertEqual(r.refreshToken, "RT"); XCTAssertEqual(r.expiresAt, t0.addingTimeInterval(60))
        XCTAssertThrowsError(try L.tokens(from: Data(#"{"error":"invalid_grant","error_description":"expired"}"#.utf8), clientID: "c", tokenEndpoint: ep, resource: nil)) { XCTAssertEqual($0 as? OAuthError, .denied("expired")) }
        XCTAssertThrowsError(try L.tokens(from: Data(#"{"access_token":"x","token_type":"mac"}"#.utf8), clientID: "c", tokenEndpoint: ep, resource: nil))
        XCTAssertThrowsError(try L.tokens(from: Data("{}".utf8), clientID: "c", tokenEndpoint: ep, resource: nil))
        XCTAssertNil(try L.tokens(from: Data(#"{"access_token":"x"}"#.utf8), clientID: "c", tokenEndpoint: ep, resource: nil).expiresAt)
    }

    func testRefreshTimingAndStorage() throws {
        let now = Date(timeIntervalSince1970: 5_000)
        var t = OAuthTokens(accessToken: "a", refreshToken: "r", expiresAt: now.addingTimeInterval(300), clientID: "c", tokenEndpoint: "https://a/t", resource: nil)
        XCTAssertFalse(t.needsRefresh(now: now))
        XCTAssertTrue(t.needsRefresh(now: now.addingTimeInterval(250)))             // within a minute of expiring
        t.expiresAt = nil; XCTAssertFalse(t.needsRefresh(now: now))                 // no expiry given: use until refused
        XCTAssertTrue(t.canRefresh)
        t.refreshToken = ""; XCTAssertFalse(t.canRefresh)
        let back = try JSONDecoder().decode(OAuthTokens.self, from: try JSONEncoder().encode(t))
        XCTAssertEqual(back, t)
    }

    func testErrorsAreHumanReadable() {
        for e in [OAuthError.noMetadata("x"), .insecure("y"), .noRegistration, .denied("z"), .stateMismatch, .noCode, .badResponse("b"), .cancelled] { XCTAssertFalse((e.errorDescription ?? "").isEmpty) }
    }
}

final class NotchAIConnectorCatalogTests: XCTestCase {
    func testEveryPresetIsASecureAddressWithAUniqueID() {
        XCTAssertEqual(Set(ConnectorCatalog.presets.map(\.id)).count, ConnectorCatalog.presets.count)
        for p in ConnectorCatalog.presets {
            let u = URL(string: p.address)
            XCTAssertEqual(u?.scheme, "https", p.name)
            XCTAssertNotNil(u?.host, p.name)
            XCTAssertTrue(MCPNaming.isValidServerID(MCPNaming.slug(from: p.name)), p.name)
            XCTAssertFalse(p.about.isEmpty)
        }
        XCTAssertFalse(ConnectorCatalog.presets.contains { $0.name.lowercased().contains("gmail") }, "there is no public Gmail server to point at")
    }

    func testASecondAccountGetsItsOwnName() {
        XCTAssertEqual(ConnectorCatalog.freeName("Notion", taken: []), "Notion")
        XCTAssertEqual(ConnectorCatalog.freeName("Notion", taken: ["notion"]), "Notion 2")
        XCTAssertEqual(ConnectorCatalog.freeName("Notion", taken: ["Notion", "Notion 2", "Linear"]), "Notion 3")
        XCTAssertNotEqual(MCPNaming.slug(from: "Notion"), MCPNaming.slug(from: "Notion 2"))
    }

    func testAccountsAreCountedByAddress() {
        let notion = ConnectorCatalog.presets.first { $0.id == "notion" }!
        XCTAssertEqual(ConnectorCatalog.accounts(of: notion, in: []), 0)
        XCTAssertEqual(ConnectorCatalog.accounts(of: notion, in: ["https://mcp.notion.com/mcp/", "HTTPS://MCP.NOTION.COM/mcp", "https://mcp.linear.app/mcp"]), 2)
    }

    func testGitHubAsksForATokenAndTheOthersUseTheBrowser() {
        for p in ConnectorCatalog.presets {
            if p.id == "github" { if case .token(let hint) = p.signIn { XCTAssertTrue(hint.contains("token")) } else { XCTFail() } }
            else { XCTAssertEqual(p.signIn, .browser, p.name) }
        }
    }
}
