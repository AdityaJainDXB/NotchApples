//
//  BrowserView.swift
//  Notch apple
//
//  The Browser tab: address and search bar, back / forward / reload, and the
//  page itself. With nothing open it shows a start page with a search box and
//  a few quick links.
//

import SwiftUI
import WebKit

private struct WebViewHost: NSViewRepresentable {
    let webView: WKWebView
    func makeNSView(context: Context) -> WKWebView { webView }
    func updateNSView(_ nsView: WKWebView, context: Context) {}
}

struct BrowserView: View {
    @StateObject private var model = BrowserModel.shared
    @AppStorage(SearchEngine.storageKey) private var engineName = SearchEngine.duckDuckGo.rawValue
    @FocusState private var addressFocused: Bool

    private let quickLinks: [(name: String, symbol: String, address: String)] = [
        ("Google", "magnifyingglass", "https://www.google.com"),
        ("YouTube", "play.rectangle.fill", "https://www.youtube.com"),
        ("Wikipedia", "book.fill", "https://www.wikipedia.org"),
        ("GitHub", "chevron.left.forwardslash.chevron.right", "https://github.com"),
        ("News", "newspaper.fill", "https://news.google.com"),
        ("Maps", "map.fill", "https://maps.google.com"),
    ]

    var body: some View {
        VStack(spacing: 8) {
            toolbar
            if model.isLoading {
                ProgressView(value: model.progress).progressViewStyle(.linear).tint(Theme.accent).transition(.opacity)
            }
            ZStack {
                WebViewHost(webView: model.webView)
                    .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
                    .opacity(model.hasPage ? 1 : 0)
                if !model.hasPage { startPage }
                if let error = model.errorMessage { errorCard(error) }
            }
        }
        .animation(.easeOut(duration: 0.15), value: model.isLoading)
        .onAppear {
            model.restoreIfNeeded()
            if !model.hasPage { addressFocused = true }
        }
    }

    // MARK: Toolbar

    private var toolbar: some View {
        HStack(spacing: 4) {
            IconButton(systemImage: "chevron.left", help: "Back") { model.back() }.disabled(!model.canGoBack).opacity(model.canGoBack ? 1 : 0.4)
            IconButton(systemImage: "chevron.right", help: "Forward") { model.forward() }.disabled(!model.canGoForward).opacity(model.canGoForward ? 1 : 0.4)
            IconButton(systemImage: model.isLoading ? "xmark" : "arrow.clockwise", help: model.isLoading ? "Stop" : "Reload") { model.reloadOrStop() }
                .disabled(!model.hasPage).opacity(model.hasPage ? 1 : 0.4)
            IconButton(systemImage: "house.fill", help: "Start page") { model.goHome() }

            HStack(spacing: 6) {
                Image(systemName: model.hasPage && model.addressText.hasPrefix("https") ? "lock.fill" : "magnifyingglass")
                    .font(.system(size: 11)).foregroundStyle(Theme.textSecondary)
                TextField("Search \(SearchEngine(rawValue: engineName)?.name ?? "the web") or enter a website", text: $model.addressText)
                    .textFieldStyle(.plain).font(.system(size: 13)).foregroundStyle(.white)
                    .focused($addressFocused)
                    .onSubmit { model.go(model.addressText) }
                    .onChange(of: addressFocused) { _, focused in
                        model.isEditingAddress = focused
                        if focused { DispatchQueue.main.async { NSApp.sendAction(#selector(NSText.selectAll(_:)), to: nil, from: nil) } }
                    }
                    .accessibilityLabel("Address and search")
                if !model.addressText.isEmpty && addressFocused {
                    Button { model.addressText = "" } label: { Image(systemName: "xmark.circle.fill") }
                        .buttonStyle(.plain).foregroundStyle(Theme.textSecondary).help("Clear")
                }
            }
            .padding(.horizontal, 10).frame(height: 30)
            .background(Theme.surface, in: RoundedRectangle(cornerRadius: 8))
            .overlay(RoundedRectangle(cornerRadius: 8).strokeBorder(addressFocused ? Theme.accent : Theme.separator, lineWidth: addressFocused ? 1.5 : 1))

            IconButton(systemImage: "safari", help: "Open in your default browser") { model.openInDefaultBrowser() }
                .disabled(!model.hasPage).opacity(model.hasPage ? 1 : 0.4)
        }
    }

    // MARK: Start page and errors

    private var startPage: some View {
        VStack(spacing: 14) {
            Image(systemName: "globe").font(.system(size: 34)).foregroundStyle(Theme.accentGradient)
            Text("Search the web or type a website above").font(.system(size: 14)).foregroundStyle(Theme.textSecondary)
            HStack(spacing: 8) {
                ForEach(quickLinks, id: \.name) { link in
                    Button { model.go(link.address) } label: {
                        VStack(spacing: 6) {
                            Image(systemName: link.symbol).font(.system(size: 16)).foregroundStyle(Theme.accentBright)
                            Text(link.name).font(.system(size: 11)).foregroundStyle(.white)
                        }
                        .frame(width: 84, height: 62)
                        .background(Theme.surface, in: RoundedRectangle(cornerRadius: 12))
                    }
                    .buttonStyle(.plain)
                }
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }

    private func errorCard(_ message: String) -> some View {
        VStack(spacing: 8) {
            Image(systemName: "exclamationmark.triangle.fill").font(.system(size: 26)).foregroundStyle(.orange)
            Text("Can't open this page").font(.system(size: 14, weight: .semibold)).foregroundStyle(.white)
            Text(message).font(.system(size: 12)).foregroundStyle(Theme.textSecondary).multilineTextAlignment(.center).lineLimit(3)
            Button("Try again") { model.reloadOrStop() }.buttonStyle(PurpleButtonStyle())
        }
        .padding(20)
        .frame(maxWidth: 380)
        .background(.ultraThinMaterial.opacity(0.6), in: RoundedRectangle(cornerRadius: Theme.corner))
        .background(Theme.backdrop, in: RoundedRectangle(cornerRadius: Theme.corner))
    }
}
