//
//  MCPOAuthFlow.swift
//  Notch Apple
//
//  The browser step of connector sign-in: the service's own sign-in page opens in the system's secure web authentication
//  sheet (ASWebAuthenticationSession), the person signs in there, and only the one-time code comes back to this app. The
//  password is never typed into Notch Apple. Started only by the "Sign in with your browser" button.
//

import AuthenticationServices
import AppKit

@MainActor
final class MCPOAuthFlow: NSObject, ASWebAuthenticationPresentationContextProviding {
    private var session: ASWebAuthenticationSession?
    private static var running: MCPOAuthFlow?

    /// Signs in to the connector at `server`. `knownClientID` reuses an earlier registration with the same service.
    static func signIn(server: URL, clientName: String, knownClientID: String?) async throws -> OAuthTokens {
        guard running == nil else { throw OAuthError.badResponse("a sign-in is already open") }
        let flow = MCPOAuthFlow()
        running = flow
        defer { running = nil }
        let client = OAuthClient()
        // A server that wants sign-in answers an unauthenticated request with 401 and says where its metadata is.
        let challenge = await probeChallenge(server)
        let pending = try await client.begin(server: server, clientName: clientName, knownClientID: knownClientID, wwwAuthenticate: challenge)
        let callback = try await flow.openBrowser(pending.authorizationURL)
        return try await client.finish(pending, callback: callback)
    }

    private static func probeChallenge(_ server: URL) async -> String? {
        var r = URLRequest(url: server); r.httpMethod = "POST"; r.timeoutInterval = 10
        r.setValue("application/json", forHTTPHeaderField: "Content-Type"); r.setValue("application/json, text/event-stream", forHTTPHeaderField: "Accept")
        r.httpBody = Data(#"{"jsonrpc":"2.0","id":0,"method":"ping"}"#.utf8)
        guard let (_, resp) = try? await URLSession.shared.data(for: r), let h = resp as? HTTPURLResponse, h.statusCode == 401 else { return nil }
        return h.value(forHTTPHeaderField: "WWW-Authenticate")
    }

    private func openBrowser(_ url: URL) async throws -> URL {
        try await withCheckedThrowingContinuation { cont in
            let s = ASWebAuthenticationSession(url: url, callbackURLScheme: OAuthLogic.callbackScheme) { callback, error in
                if let callback { cont.resume(returning: callback) }
                else if let e = error as? ASWebAuthenticationSessionError, e.code == .canceledLogin { cont.resume(throwing: OAuthError.cancelled) }
                else { cont.resume(throwing: error ?? OAuthError.noCode) }
            }
            s.presentationContextProvider = self
            s.prefersEphemeralWebBrowserSession = false      // the person may already be signed in to the service in their browser
            session = s
            if !s.start() { cont.resume(throwing: OAuthError.badResponse("the sign-in sheet could not open")) }
        }
    }

    func presentationAnchor(for session: ASWebAuthenticationSession) -> ASPresentationAnchor {
        NSApp.keyWindow ?? NSApp.windows.first ?? ASPresentationAnchor()
    }
}
