//
//  RemoteWebGame.swift
//  Notch Apple
//
//  A game that is somebody else's web page, shown in a web view (FNAF 1 from fnaf1.io). It is not part of Notch Apple: the page
//  loads from the internet when you open it, keeps nothing on this Mac afterwards (a throwaway web store), may only move
//  to the sites listed for that game, has its ad and tracking scripts blocked, and is dropped when you leave the game or close the notch.
//

import SwiftUI
import WebKit

struct RemoteWebGameView: View {
    let url: URL
    /// The only hosts the page may navigate to (the game's own site and the one that serves the game files).
    let allowedHosts: [String]
    let title: String

    var body: some View {
        RemoteWebGameWebView(url: url, allowedHosts: allowedHosts)
            .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
            .accessibilityLabel(title)
    }
}

enum RemoteGameRules {
    /// Hosts whose scripts and frames are never loaded: ads and trackers.
    static let blockedHosts = ["pagead2.googlesyndication.com", "googleads.g.doubleclick.net", "doubleclick.net", "googlesyndication.com",
                               "googletagmanager.com", "google-analytics.com", "adservice.google.com", "tpc.googlesyndication.com"]

    static func isAllowed(host: String?, in allowed: [String]) -> Bool {
        guard let host = host?.lowercased() else { return false }
        return allowed.contains { host == $0 || host.hasSuffix("." + $0) }
    }

    /// A WebKit content rule list (JSON) that blocks every host in `blockedHosts`.
    static var ruleListJSON: String {
        let rules = blockedHosts.map { h -> String in
            let escaped = h.replacingOccurrences(of: ".", with: "\\\\.")
            return "{\"trigger\":{\"url-filter\":\"^https?://([^/]+\\\\.)?\(escaped)[/:]?\"},\"action\":{\"type\":\"block\"}}"
        }
        return "[" + rules.joined(separator: ",") + "]"
    }
}

private struct RemoteWebGameWebView: NSViewRepresentable {
    let url: URL
    let allowedHosts: [String]

    final class Coordinator: NSObject, WKNavigationDelegate, WKUIDelegate {
        let allowedHosts: [String]
        init(allowedHosts: [String]) { self.allowedHosts = allowedHosts }

        func webView(_ webView: WKWebView, decidePolicyFor navigationAction: WKNavigationAction, decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
            // Only the game's own pages may load in the main frame; a link out to anywhere else does nothing.
            guard navigationAction.targetFrame?.isMainFrame ?? true else { decisionHandler(.allow); return }
            let ok = RemoteGameRules.isAllowed(host: navigationAction.request.url?.host, in: allowedHosts)
                && navigationAction.request.url?.scheme == "https"
            decisionHandler(ok ? .allow : .cancel)
        }

        /// A page that tries to open a new window (an ad, a "more games" link) gets nothing.
        func webView(_ webView: WKWebView, createWebViewWith configuration: WKWebViewConfiguration, for navigationAction: WKNavigationAction, windowFeatures: WKWindowFeatures) -> WKWebView? { nil }
    }

    func makeCoordinator() -> Coordinator { Coordinator(allowedHosts: allowedHosts) }

    func makeNSView(context: Context) -> CtfWKWebView {
        let config = WKWebViewConfiguration()
        config.websiteDataStore = .nonPersistent()          // nothing is kept after the game closes
        config.mediaTypesRequiringUserActionForPlayback = []
        let view = CtfWKWebView(frame: .zero, configuration: config)   // takes the first click: the notch is a non-activating panel
        view.navigationDelegate = context.coordinator
        view.uiDelegate = context.coordinator
        view.setValue(false, forKey: "drawsBackground")
        // Block the ad and tracking scripts first, then load the game.
        WKContentRuleListStore.default().compileContentRuleList(forIdentifier: "NotchRemoteGameBlock", encodedContentRuleList: RemoteGameRules.ruleListJSON) { list, _ in
            DispatchQueue.main.async {
                if let list { view.configuration.userContentController.add(list) }
                view.load(URLRequest(url: url))
                view.window?.makeFirstResponder(view)
            }
        }
        return view
    }

    func updateNSView(_ nsView: CtfWKWebView, context: Context) {}

    static func dismantleNSView(_ nsView: CtfWKWebView, coordinator: Coordinator) {
        nsView.stopLoading()
        nsView.loadHTMLString("", baseURL: nil)
    }
}

/// FNAF 1, from fnaf1.io.
struct FnafGameView: View {
    var body: some View {
        RemoteWebGameView(url: URL(string: "https://fnaf1.io/fnaf-1.embed")!, allowedHosts: ["fnaf1.io", "play.1gdata.com"], title: "FNAF 1")
    }
}
