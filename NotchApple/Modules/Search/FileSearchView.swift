//
//  FileSearchView.swift
//  Notch apple
//
//  The Search tab: type to find files, apps and folders through Spotlight.
//  ↑/↓ move the highlight, Return opens, ⌘R (or ⌥-click) reveals in Finder,
//  and rows can be dragged out, e.g. into the notch's File shelf.
//

import SwiftUI

struct FileSearchView: View {
    @StateObject private var manager = FileSearchManager.shared
    @EnvironmentObject private var settings: SettingsManager
    @State private var text = ""
    @State private var selection: URL?
    @FocusState private var focused: Bool

    private var results: [SearchResult] { manager.results }

    var body: some View {
        VStack(spacing: 10) {
            searchBar
            if manager.needsFullDiskAccess { permissionBanner }
            content
        }
        .onAppear { focused = true; manager.checkPermissions() }
        .onDisappear { manager.cancel() }
        .onChange(of: text) { _, new in manager.search(new) }
        .onChange(of: results) { _, new in selection = new.first?.url }
        // Hidden button carries the ⌘R shortcut.
        .background(Button("") { if let r = selected { FileSearchManager.reveal(r) } }
            .keyboardShortcut("r", modifiers: .command).opacity(0).allowsHitTesting(false))
    }

    private var selected: SearchResult? { results.first { $0.url == selection } }

    // MARK: Pieces

    private var searchBar: some View {
        HStack(spacing: 8) {
            Image(systemName: "magnifyingglass").foregroundStyle(Theme.textSecondary)
            TextField("Search files, apps and folders", text: $text)
                .textFieldStyle(.plain).font(.system(size: 14)).foregroundStyle(.white)
                .focused($focused)
                .onSubmit { if let r = selected { FileSearchManager.open(r) } }
                .onKeyPress(.downArrow) { move(1); return .handled }
                .onKeyPress(.upArrow) { move(-1); return .handled }
                .accessibilityLabel("Search files")
            if manager.isSearching { ProgressView().controlSize(.small).scaleEffect(0.7) }
            if !text.isEmpty {
                Button { text = ""; focused = true } label: {
                    Image(systemName: "xmark.circle.fill").foregroundStyle(Theme.textSecondary)
                }
                .buttonStyle(.plain).help("Clear").accessibilityLabel("Clear search")
            }
        }
        .padding(.horizontal, 12).frame(height: 36)
        .background(Theme.surface, in: RoundedRectangle(cornerRadius: 10))
        .overlay(RoundedRectangle(cornerRadius: 10).strokeBorder(focused ? Theme.accent : Theme.separator, lineWidth: focused ? 1.5 : 1))
    }

    private var permissionBanner: some View {
        HStack(spacing: 8) {
            Image(systemName: "exclamationmark.triangle.fill").foregroundStyle(.yellow)
            Text("Some folders can't be searched yet.").font(.system(size: 11)).foregroundStyle(Theme.textSecondary)
            Spacer()
            Button("Grant Full Disk Access in System Settings") { FileSearchManager.openFullDiskAccessSettings() }
                .buttonStyle(PurpleButtonStyle(prominent: false))
        }
    }

    @ViewBuilder private var content: some View {
        if results.isEmpty {
            VStack(spacing: 6) {
                Image(systemName: "magnifyingglass.circle").font(.system(size: 28)).foregroundStyle(Theme.accentGradient)
                Text(text.isEmpty ? "Type to search your Mac." : manager.isSearching ? "Searching…" : "No files match.")
                    .font(.system(size: 13)).foregroundStyle(Theme.textSecondary)
                if text.isEmpty {
                    Text("↑ ↓ to choose · Return to open · ⌘R to reveal in Finder")
                        .font(.system(size: 11)).foregroundStyle(Theme.textSecondary)
                }
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)
        } else {
            ScrollViewReader { proxy in
                ScrollView {
                    LazyVStack(spacing: 2) {
                        ForEach(results) { result in
                            SearchRow(result: result, highlighted: result.url == selection)
                                .id(result.url)
                                .onHover { if $0 { selection = result.url } }
                        }
                    }
                }
                .onChange(of: selection) { _, url in if let url { withAnimation(.easeOut(duration: 0.1)) { proxy.scrollTo(url) } } }
            }
        }
    }

    private func move(_ delta: Int) {
        guard !results.isEmpty else { return }
        let current = results.firstIndex { $0.url == selection } ?? (delta > 0 ? -1 : results.count)
        selection = results[min(max(current + delta, 0), results.count - 1)].url
    }
}

private struct SearchRow: View {
    let result: SearchResult
    let highlighted: Bool
    @State private var icon: NSImage?

    var body: some View {
        HStack(spacing: 10) {
            Image(nsImage: icon ?? NSWorkspace.shared.icon(forFile: result.url.path))
                .resizable().interpolation(.high).frame(width: 32, height: 32)
            VStack(alignment: .leading, spacing: 2) {
                Text(result.name).font(.system(size: 13, weight: .medium)).foregroundStyle(.white).lineLimit(1)
                Text(result.detail).font(.system(size: 11)).foregroundStyle(Theme.textSecondary).lineLimit(1)
                Text(result.folder).font(.system(size: 10)).foregroundStyle(Theme.textSecondary.opacity(0.8))
                    .lineLimit(1).truncationMode(.head)
            }
            Spacer(minLength: 6)
            if highlighted {
                if FileShelfStore.shared.isShelfAvailable {
                    IconButton(systemImage: "tray.and.arrow.down", help: "Add to File shelf") {
                        withAnimation(Theme.spring) { FileShelfStore.shared.add(result.url) }
                    }
                }
                IconButton(systemImage: "folder", help: "Reveal in Finder (⌘R)") { FileSearchManager.reveal(result) }
            }
        }
        .padding(.horizontal, 8).padding(.vertical, 4)
        .background(RoundedRectangle(cornerRadius: 10).fill(highlighted ? Theme.accent.opacity(0.35) : .clear))
        .contentShape(Rectangle())
        .onTapGesture {
            if NSEvent.modifierFlags.contains(.option) { FileSearchManager.reveal(result) }
            else { FileSearchManager.open(result) }
        }
        .onDrag { NSItemProvider(contentsOf: result.url) ?? NSItemProvider() }
        .contextMenu {
            Button("Open") { FileSearchManager.open(result) }
            Button("Reveal in Finder") { FileSearchManager.reveal(result) }
            Button("Add to File shelf") { FileShelfStore.shared.add(result.url) }
        }
        .help("Click to open · ⌥-click to reveal in Finder · drag to the File shelf")
        .accessibilityElement(children: .combine)
        .accessibilityAddTraits(.isButton)
    }
}
