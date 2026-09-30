//
//  BrowserModel.swift
//  Notch apple
//
//  A small web browser for the notch, built on WebKit (the same engine as
//  Safari). One web view lives here so the page you were on is still there
//  when you close and reopen the notch.
//

import AppKit
import WebKit

enum SearchEngine: String, CaseIterable, Identifiable {
    case duckDuckGo, google, bing, brave, ecosia

    var id: String { rawValue }

    var name: String {
        switch self {
        case .duckDuckGo: "DuckDuckGo"
        case .google: "Google"
        case .bing: "Bing"
        case .brave: "Brave Search"
        case .ecosia: "Ecosia"
        }
    }

    fileprivate var base: String {
        switch self {
        case .duckDuckGo: "https://duckduckgo.com/"
        case .google: "https://www.google.com/search"
        case .bing: "https://www.bing.com/search"
        case .brave: "https://search.brave.com/search"
        case .ecosia: "https://www.ecosia.org/search"
        }
    }

    /// The results page for `query`, with the text safely encoded.
    func url(for query: String) -> URL? {
        // Encode everything except letters, digits and - . _ ~ so characters like + and & survive ("2+2" stays "2+2").
        var allowed = CharacterSet.alphanumerics
        allowed.insert(charactersIn: "-._~")
        guard let encoded = query.addingPercentEncoding(withAllowedCharacters: allowed) else { return nil }
        return URL(string: base + "?q=" + encoded)
    }

    static let storageKey = "browser.searchEngine"
    static var current: SearchEngine {
        SearchEngine(rawValue: UserDefaults.standard.string(forKey: storageKey) ?? "") ?? .duckDuckGo
    }
}

@MainActor
final class BrowserModel: NSObject, ObservableObject {
    static let shared = BrowserModel()
    private static let lastURLKey = "browser.lastURL"

    let webView: WKWebView

    @Published var addressText = ""
    /// True while the address field is being edited, so page changes don't overwrite what's typed.
    @Published var isEditingAddress = false
    @Published private(set) var title = ""
    @Published private(set) var canGoBack = false
    @Published private(set) var canGoForward = false
    @Published private(set) var isLoading = false
    @Published private(set) var progress = 0.0
    @Published private(set) var hasPage = false
    @Published private(set) var errorMessage: String?

    private var observations: [NSKeyValueObservation] = []
    private var restored = false

    override init() {
        let configuration = WKWebViewConfiguration()
        configuration.websiteDataStore = .default()
        configuration.preferences.isElementFullscreenEnabled = true
        webView = WKWebView(frame: .zero, configuration: configuration)
        super.init()
        webView.navigationDelegate = self
        webView.uiDelegate = self
        webView.allowsBackForwardNavigationGestures = true
        webView.allowsMagnification = true

        observations = [
            webView.observe(\.canGoBack) { [weak self] v, _ in MainActor.assumeIsolated { self?.canGoBack = v.canGoBack } },
            webView.observe(\.canGoForward) { [weak self] v, _ in MainActor.assumeIsolated { self?.canGoForward = v.canGoForward } },
            webView.observe(\.isLoading) { [weak self] v, _ in MainActor.assumeIsolated { self?.isLoading = v.isLoading } },
            webView.observe(\.estimatedProgress) { [weak self] v, _ in MainActor.assumeIsolated { self?.progress = v.estimatedProgress } },
            webView.observe(\.title) { [weak self] v, _ in MainActor.assumeIsolated { self?.title = v.title ?? "" } },
            webView.observe(\.url) { [weak self] v, _ in MainActor.assumeIsolated { self?.urlChanged(v.url) } },
        ]
    }

    // MARK: Addresses

    /// Turns what was typed into a page to open: a web address stays one, anything else becomes a search.
    nonisolated static func resolve(_ input: String, engine: SearchEngine = .current) -> URL? {
        let text = input.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !text.isEmpty else { return nil }

        if let scheme = text.range(of: "://") {
            let name = text[..<scheme.lowerBound].lowercased()
            // Only web pages: no file:, javascript: or other schemes typed into the bar.
            if name == "http" || name == "https", !text.contains(" "), let url = URL(string: text) { return url }
            return engine.url(for: text)
        }
        if text == "about:blank" { return URL(string: text) }
        guard !text.contains(" ") else { return engine.url(for: text) }

        let host = "[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?"
        let looksLikeSite = text.range(of: "^\(host)(?:\\.\(host))+(?::\\d+)?(?:[/?#].*)?$", options: .regularExpression) != nil
        let isLocal = text.range(of: "^(localhost|\\d{1,3}(?:\\.\\d{1,3}){3})(?::\\d+)?(?:[/?#].*)?$", options: .regularExpression) != nil
        if isLocal { return URL(string: "http://\(text)") }
        if looksLikeSite { return URL(string: "https://\(text)") }
        return engine.url(for: text)
    }

    func go(_ input: String) {
        guard let url = Self.resolve(input) else { return }
        errorMessage = nil
        hasPage = true
        isEditingAddress = false
        webView.load(URLRequest(url: url))
    }

    func goHome() {
        webView.stopLoading()
        hasPage = false
        errorMessage = nil
        addressText = ""
        title = ""
        UserDefaults.standard.removeObject(forKey: Self.lastURLKey)
    }

    func reloadOrStop() {
        if isLoading { webView.stopLoading() } else { webView.reload() }
    }
    func back() { webView.goBack() }
    func forward() { webView.goForward() }

    /// Opens the current page in the default browser.
    func openInDefaultBrowser() {
        if let url = webView.url { NSWorkspace.shared.open(url) }
    }

    /// Reopens the last page the first time the tab is shown after launch.
    func restoreIfNeeded() {
        guard !restored else { return }
        restored = true
        if !hasPage, let last = UserDefaults.standard.string(forKey: Self.lastURLKey), let url = URL(string: last) {
            hasPage = true
            webView.load(URLRequest(url: url))
        }
    }

    /// Forgets cookies, cache, history and site data, and returns to the start page.
    func clearBrowsingData() async {
        let store = WKWebsiteDataStore.default()
        await store.removeData(ofTypes: WKWebsiteDataStore.allWebsiteDataTypes(), modifiedSince: .distantPast)
        goHome()
    }

    private func urlChanged(_ url: URL?) {
        guard let url, url.absoluteString != "about:blank" else { return }
        if !isEditingAddress { addressText = url.absoluteString }
        UserDefaults.standard.set(url.absoluteString, forKey: Self.lastURLKey)
    }
}

// MARK: - Navigation and pop-ups

extension BrowserModel: WKNavigationDelegate, WKUIDelegate {
    func webView(_ webView: WKWebView, decidePolicyFor action: WKNavigationAction,
                 decisionHandler: @escaping @MainActor (WKNavigationActionPolicy) -> Void) {
        guard let url = action.request.url, let scheme = url.scheme?.lowercased() else { decisionHandler(.cancel); return }
        if ["http", "https", "about", "blob", "data"].contains(scheme) { decisionHandler(.allow); return }
        // mailto:, tel:, app links and the like belong to other apps.
        NSWorkspace.shared.open(url)
        decisionHandler(.cancel)
    }

    func webView(_ webView: WKWebView, decidePolicyFor response: WKNavigationResponse,
                 decisionHandler: @escaping @MainActor (WKNavigationResponsePolicy) -> Void) {
        // Files the web view can't display (downloads) are handed to the default browser.
        if !response.canShowMIMEType, let url = response.response.url {
            NSWorkspace.shared.open(url)
            decisionHandler(.cancel)
        } else {
            decisionHandler(.allow)
        }
    }

    func webView(_ webView: WKWebView, didStartProvisionalNavigation navigation: WKNavigation!) { errorMessage = nil }

    func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) { fail(error) }
    func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) { fail(error) }

    private func fail(_ error: Error) {
        let e = error as NSError
        guard e.code != NSURLErrorCancelled else { return }   // stopped or replaced by another load
        errorMessage = e.localizedDescription
    }

    // Links that ask for a new window open in the same view.
    func webView(_ webView: WKWebView, createWebViewWith configuration: WKWebViewConfiguration,
                 for action: WKNavigationAction, windowFeatures: WKWindowFeatures) -> WKWebView? {
        if action.targetFrame == nil, let url = action.request.url { webView.load(URLRequest(url: url)) }
        return nil
    }

    func webView(_ webView: WKWebView, runJavaScriptAlertPanelWithMessage message: String, initiatedByFrame frame: WKFrameInfo,
                 completionHandler: @escaping @MainActor () -> Void) {
        let alert = NSAlert()
        alert.messageText = webView.url?.host ?? "Web page"
        alert.informativeText = message
        alert.runModal()
        completionHandler()
    }

    func webView(_ webView: WKWebView, runJavaScriptConfirmPanelWithMessage message: String, initiatedByFrame frame: WKFrameInfo,
                 completionHandler: @escaping @MainActor (Bool) -> Void) {
        let alert = NSAlert()
        alert.messageText = webView.url?.host ?? "Web page"
        alert.informativeText = message
        alert.addButton(withTitle: "OK")
        alert.addButton(withTitle: "Cancel")
        completionHandler(alert.runModal() == .alertFirstButtonReturn)
    }
}
