//
//  NotchAIOAuth.swift
//  Notch Apple
//
//  Browser sign-in for MCP connectors, the way the MCP authorization spec describes it: OAuth 2.1 authorization code with
//  PKCE (S256), the server's metadata found through the standard well-known addresses, and the app registered by dynamic
//  client registration (no client secret, no pre-registered key). The user signs in on the service's own page in their
//  browser; Notch Apple only ever sees the tokens that come back, and keeps them in the app's private secrets store.
//
//  This file is Foundation-only: the maths and the requests (PKCE, URLs, metadata, token requests and responses) are pure
//  and unit tested; `OAuthClient` does the HTTP and was run against a local test server. The part that opens the browser
//  lives with the UI (MCPOAuthFlow.swift).
//

import CryptoKit
import Foundation

enum OAuthError: LocalizedError, Equatable {
    case noMetadata(String), insecure(String), noRegistration, denied(String), stateMismatch, noCode, badResponse(String), cancelled

    var errorDescription: String? {
        switch self {
        case .noMetadata(let w): "Could not find how to sign in to this service (\(w))."
        case .insecure(let w): "Refused: \(w) is not a secure (https) address."
        case .noRegistration: "This service does not let apps register themselves, so browser sign-in is not available. Use a key instead."
        case .denied(let w): "The service said no: \(w)"
        case .stateMismatch: "The sign-in answer did not match the request, so it was ignored."
        case .noCode: "The sign-in finished without a code."
        case .badResponse(let w): "The service sent something unexpected: \(w)"
        case .cancelled: "Sign-in was cancelled."
        }
    }
}

struct OAuthTokens: Codable, Equatable {
    var accessToken: String
    var refreshToken: String?
    var expiresAt: Date?
    var clientID: String
    var tokenEndpoint: String
    var resource: String?

    /// True when the access token is missing, or expires within `skew` seconds.
    func needsRefresh(now: Date = Date(), skew: TimeInterval = 60) -> Bool {
        guard let e = expiresAt else { return false }
        return e.timeIntervalSince(now) <= skew
    }
    var canRefresh: Bool { !(refreshToken ?? "").isEmpty }
}

struct OAuthServerMetadata: Equatable {
    var issuer: String?
    var authorizationEndpoint: URL
    var tokenEndpoint: URL
    var registrationEndpoint: URL?
    var scopes: [String]
    var supportsS256: Bool
}

enum OAuthLogic {
    static let redirectURI = "notchapple://oauth/callback"
    static let callbackScheme = "notchapple"

    // MARK: PKCE (RFC 7636)

    static func base64URL(_ d: Data) -> String {
        d.base64EncodedString().replacingOccurrences(of: "+", with: "-").replacingOccurrences(of: "/", with: "_").replacingOccurrences(of: "=", with: "")
    }

    static func randomToken(bytes: Int = 32) -> String {
        var b = [UInt8](repeating: 0, count: bytes)
        for i in b.indices { b[i] = UInt8.random(in: 0...255) }
        return base64URL(Data(b))
    }

    static func challenge(forVerifier v: String) -> String { base64URL(Data(SHA256.hash(data: Data(v.utf8)))) }

    // MARK: Addresses

    /// Only https (or a local test server) may be signed in to: tokens must not cross plain http.
    static func isSecure(_ u: URL) -> Bool {
        guard let s = u.scheme?.lowercased(), let h = u.host?.lowercased() else { return false }
        return s == "https" || (s == "http" && (h == "localhost" || h == "127.0.0.1" || h == "::1"))
    }

    /// `https://example.com/mcp` → https://example.com/.well-known/<name>/mcp  (RFC 9728 / 8414 path insertion), then the root form.
    static func wellKnown(_ name: String, for u: URL) -> [URL] {
        guard var c = URLComponents(url: u, resolvingAgainstBaseURL: false) else { return [] }
        let path = c.path == "/" ? "" : c.path
        var out: [URL] = []
        c.query = nil; c.fragment = nil
        if !path.isEmpty { c.path = "/.well-known/\(name)\(path)"; if let x = c.url { out.append(x) } }
        c.path = "/.well-known/\(name)"; if let x = c.url { out.append(x) }
        return out
    }

    /// The `resource_metadata="…"` address from a 401's WWW-Authenticate header, if it has one.
    static func resourceMetadataURL(fromWWWAuthenticate h: String?) -> URL? {
        guard let h, let r = h.range(of: "resource_metadata=\"") else { return nil }
        let rest = h[r.upperBound...]
        guard let end = rest.firstIndex(of: "\"") else { return nil }
        return URL(string: String(rest[..<end]))
    }

    // MARK: Metadata

    static func authorizationServers(fromResourceMetadata data: Data) -> [URL] {
        guard let j = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any], let list = j["authorization_servers"] as? [String] else { return [] }
        return list.compactMap { URL(string: $0) }
    }

    static func serverMetadata(from data: Data) throws -> OAuthServerMetadata {
        guard let j = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any] else { throw OAuthError.badResponse("metadata is not JSON") }
        guard let a = (j["authorization_endpoint"] as? String).flatMap(URL.init(string:)), let t = (j["token_endpoint"] as? String).flatMap(URL.init(string:)) else {
            throw OAuthError.badResponse("metadata has no authorization or token address")
        }
        guard isSecure(a) else { throw OAuthError.insecure("the sign-in page") }
        guard isSecure(t) else { throw OAuthError.insecure("the token address") }
        let reg = (j["registration_endpoint"] as? String).flatMap(URL.init(string:))
        if let reg, !isSecure(reg) { throw OAuthError.insecure("the registration address") }
        let methods = j["code_challenge_methods_supported"] as? [String] ?? []
        return OAuthServerMetadata(issuer: j["issuer"] as? String, authorizationEndpoint: a, tokenEndpoint: t, registrationEndpoint: reg,
                                   scopes: j["scopes_supported"] as? [String] ?? [], supportsS256: methods.isEmpty || methods.contains("S256"))
    }

    // MARK: Requests

    static func registrationBody(clientName: String) -> Data {
        let j: [String: Any] = ["client_name": clientName, "redirect_uris": [redirectURI], "grant_types": ["authorization_code", "refresh_token"],
                                "response_types": ["code"], "token_endpoint_auth_method": "none"]
        return (try? JSONSerialization.data(withJSONObject: j)) ?? Data()
    }

    static func clientID(fromRegistration data: Data) -> String? {
        ((try? JSONSerialization.jsonObject(with: data)) as? [String: Any])?["client_id"] as? String
    }

    static func authorizationURL(_ m: OAuthServerMetadata, clientID: String, challenge: String, state: String, resource: String?, scope: String?) -> URL? {
        guard var c = URLComponents(url: m.authorizationEndpoint, resolvingAgainstBaseURL: false) else { return nil }
        var items = c.queryItems ?? []
        items += [URLQueryItem(name: "response_type", value: "code"), URLQueryItem(name: "client_id", value: clientID),
                  URLQueryItem(name: "redirect_uri", value: redirectURI), URLQueryItem(name: "code_challenge", value: challenge),
                  URLQueryItem(name: "code_challenge_method", value: "S256"), URLQueryItem(name: "state", value: state)]
        if let resource { items.append(URLQueryItem(name: "resource", value: resource)) }
        if let scope, !scope.isEmpty { items.append(URLQueryItem(name: "scope", value: scope)) }
        c.queryItems = items
        return c.url
    }

    /// Reads the browser's answer. The state must match what was sent; an error from the service is passed on.
    static func callbackCode(_ url: URL, expectedState: String) throws -> String {
        let items = URLComponents(url: url, resolvingAgainstBaseURL: false)?.queryItems ?? []
        func v(_ n: String) -> String? { items.first { $0.name == n }?.value }
        if let e = v("error") { throw OAuthError.denied(v("error_description") ?? e) }
        guard v("state") == expectedState else { throw OAuthError.stateMismatch }
        guard let code = v("code"), !code.isEmpty else { throw OAuthError.noCode }
        return code
    }

    static func formBody(_ pairs: [(String, String)]) -> Data {
        var allowed = CharacterSet.alphanumerics; allowed.insert(charactersIn: "-._~")
        return Data(pairs.map { "\($0.0)=\($0.1.addingPercentEncoding(withAllowedCharacters: allowed) ?? "")" }.joined(separator: "&").utf8)
    }

    static func codeExchangeBody(code: String, verifier: String, clientID: String, resource: String?) -> Data {
        var p = [("grant_type", "authorization_code"), ("code", code), ("redirect_uri", redirectURI), ("client_id", clientID), ("code_verifier", verifier)]
        if let resource { p.append(("resource", resource)) }
        return formBody(p)
    }

    static func refreshBody(refreshToken: String, clientID: String, resource: String?) -> Data {
        var p = [("grant_type", "refresh_token"), ("refresh_token", refreshToken), ("client_id", clientID)]
        if let resource { p.append(("resource", resource)) }
        return formBody(p)
    }

    /// A token response. A refresh that returns no new refresh token keeps the old one.
    static func tokens(from data: Data, clientID: String, tokenEndpoint: URL, resource: String?, keeping old: OAuthTokens? = nil, now: Date = Date()) throws -> OAuthTokens {
        guard let j = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any] else { throw OAuthError.badResponse("token answer is not JSON") }
        if let e = j["error"] as? String { throw OAuthError.denied(j["error_description"] as? String ?? e) }
        guard let access = j["access_token"] as? String, !access.isEmpty else { throw OAuthError.badResponse("no access token") }
        let type = (j["token_type"] as? String ?? "Bearer").lowercased()
        guard type == "bearer" else { throw OAuthError.badResponse("unsupported token type \(type)") }
        let seconds = (j["expires_in"] as? Double) ?? (j["expires_in"] as? Int).map(Double.init) ?? (j["expires_in"] as? String).flatMap(Double.init)
        return OAuthTokens(accessToken: access, refreshToken: (j["refresh_token"] as? String) ?? old?.refreshToken,
                           expiresAt: seconds.map { now.addingTimeInterval($0) }, clientID: clientID, tokenEndpoint: tokenEndpoint.absoluteString, resource: resource)
    }
}

/// The HTTP side. No UI; the caller opens the browser between `begin` and `finish`.
struct OAuthClient {
    var session: URLSession = .shared

    struct Pending {
        let metadata: OAuthServerMetadata
        let clientID: String
        let verifier: String
        let state: String
        let resource: String
        let authorizationURL: URL
    }

    private func get(_ u: URL) async -> (Data, HTTPURLResponse)? {
        var r = URLRequest(url: u); r.timeoutInterval = 15; r.setValue("application/json", forHTTPHeaderField: "Accept")
        guard let (d, resp) = try? await session.data(for: r), let h = resp as? HTTPURLResponse, h.statusCode == 200 else { return nil }
        return (d, h)
    }

    /// Finds the service's sign-in server and how to talk to it.
    func discover(server: URL, wwwAuthenticate: String? = nil) async throws -> OAuthServerMetadata {
        guard OAuthLogic.isSecure(server) else { throw OAuthError.insecure("this connector's address") }
        var resourceURLs: [URL] = []
        if let u = OAuthLogic.resourceMetadataURL(fromWWWAuthenticate: wwwAuthenticate) { resourceURLs.append(u) }
        resourceURLs += OAuthLogic.wellKnown("oauth-protected-resource", for: server)
        var issuers: [URL] = []
        for u in resourceURLs {
            if let (d, _) = await get(u) { issuers = OAuthLogic.authorizationServers(fromResourceMetadata: d); if !issuers.isEmpty { break } }
        }
        if issuers.isEmpty { issuers = [server] }           // older servers: the server is its own sign-in server
        for issuer in issuers {
            for name in ["oauth-authorization-server", "openid-configuration"] {
                for u in OAuthLogic.wellKnown(name, for: issuer) {
                    if let (d, _) = await get(u), let m = try? OAuthLogic.serverMetadata(from: d) {
                        guard m.supportsS256 else { throw OAuthError.badResponse("the service does not support PKCE") }
                        return m
                    }
                }
            }
        }
        throw OAuthError.noMetadata(server.host ?? "the address")
    }

    func register(_ m: OAuthServerMetadata, clientName: String) async throws -> String {
        guard let reg = m.registrationEndpoint else { throw OAuthError.noRegistration }
        var r = URLRequest(url: reg); r.httpMethod = "POST"; r.timeoutInterval = 15
        r.setValue("application/json", forHTTPHeaderField: "Content-Type"); r.setValue("application/json", forHTTPHeaderField: "Accept")
        r.httpBody = OAuthLogic.registrationBody(clientName: clientName)
        let (d, resp) = try await session.data(for: r)
        guard let h = resp as? HTTPURLResponse, (200..<300).contains(h.statusCode), let id = OAuthLogic.clientID(fromRegistration: d) else { throw OAuthError.noRegistration }
        return id
    }

    /// Everything needed to open the browser, with a fresh verifier and state.
    func begin(server: URL, clientName: String, knownClientID: String?, wwwAuthenticate: String? = nil) async throws -> Pending {
        let m = try await discover(server: server, wwwAuthenticate: wwwAuthenticate)
        let id: String
        if let known = knownClientID { id = known } else { id = try await register(m, clientName: clientName) }
        let verifier = OAuthLogic.randomToken(bytes: 48), state = OAuthLogic.randomToken()
        let resource = server.absoluteString
        guard let url = OAuthLogic.authorizationURL(m, clientID: id, challenge: OAuthLogic.challenge(forVerifier: verifier), state: state, resource: resource,
                                                    scope: m.scopes.isEmpty ? nil : m.scopes.joined(separator: " ")) else { throw OAuthError.badResponse("could not build the sign-in address") }
        return Pending(metadata: m, clientID: id, verifier: verifier, state: state, resource: resource, authorizationURL: url)
    }

    func finish(_ p: Pending, callback: URL) async throws -> OAuthTokens {
        let code = try OAuthLogic.callbackCode(callback, expectedState: p.state)
        return try await post(p.metadata.tokenEndpoint, body: OAuthLogic.codeExchangeBody(code: code, verifier: p.verifier, clientID: p.clientID, resource: p.resource),
                              clientID: p.clientID, resource: p.resource, keeping: nil)
    }

    func refresh(_ t: OAuthTokens) async throws -> OAuthTokens {
        guard t.canRefresh, let rt = t.refreshToken, let endpoint = URL(string: t.tokenEndpoint), OAuthLogic.isSecure(endpoint) else { throw OAuthError.denied("sign in again") }
        return try await post(endpoint, body: OAuthLogic.refreshBody(refreshToken: rt, clientID: t.clientID, resource: t.resource), clientID: t.clientID, resource: t.resource, keeping: t)
    }

    private func post(_ endpoint: URL, body: Data, clientID: String, resource: String?, keeping: OAuthTokens?) async throws -> OAuthTokens {
        var r = URLRequest(url: endpoint); r.httpMethod = "POST"; r.timeoutInterval = 20
        r.setValue("application/x-www-form-urlencoded", forHTTPHeaderField: "Content-Type"); r.setValue("application/json", forHTTPHeaderField: "Accept")
        r.httpBody = body
        let (d, _) = try await session.data(for: r)
        return try OAuthLogic.tokens(from: d, clientID: clientID, tokenEndpoint: endpoint, resource: resource, keeping: keeping)
    }
}
