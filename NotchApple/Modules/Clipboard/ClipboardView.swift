//
//  ClipboardView.swift
//  Notch apple
//
//  The Clipboard tab: search and filter everything you've copied, click an
//  item to copy it again, pin favourites, delete the rest.
//

import SwiftUI

struct ClipboardView: View {
    @StateObject private var history = ClipboardHistory.shared
    @State private var search = ""
    @State private var filter: Filter = .all
    @State private var copiedID: UUID?

    enum Filter: String, CaseIterable {
        case all = "All", pinned = "Pinned", text = "Text", links = "Links", images = "Images", files = "Files"
    }

    private var visible: [ClipItem] {
        let filtered = history.items.filter { item in
            switch filter {
            case .all: true
            case .pinned: item.pinned
            case .text: item.kind == .text
            case .links: item.kind == .link
            case .images: item.kind == .image
            case .files: item.kind == .files
            }
        }
        let searched = search.isEmpty ? filtered
            : filtered.filter { $0.title.localizedCaseInsensitiveContains(search) || ($0.sourceApp ?? "").localizedCaseInsensitiveContains(search) }
        // Pinned first, then newest.
        return searched.sorted { ($0.pinned ? 1 : 0, $0.date) > ($1.pinned ? 1 : 0, $1.date) }
    }

    var body: some View {
        VStack(spacing: 10) {
            HStack(spacing: 8) {
                HStack(spacing: 6) {
                    Image(systemName: "magnifyingglass").foregroundStyle(Theme.textSecondary)
                    TextField("Search clipboard history", text: $search).textFieldStyle(.plain).font(.system(size: 13))
                }
                .padding(.horizontal, 10).frame(height: 30)
                .background(Theme.surface, in: RoundedRectangle(cornerRadius: 8))

                Picker("Filter", selection: $filter) {
                    ForEach(Filter.allCases, id: \.self) { Text($0.rawValue).tag($0) }
                }
                .pickerStyle(.segmented).labelsHidden().fixedSize()

                IconButton(systemImage: "trash", help: "Clear history (keeps pinned items)") {
                    withAnimation(Theme.spring) { history.clearUnpinned() }
                }
            }

            if visible.isEmpty {
                VStack(spacing: 6) {
                    Image(systemName: "doc.on.clipboard").font(.system(size: 28)).foregroundStyle(Theme.accentGradient)
                    Text(history.items.isEmpty ? "Copy anything and it's saved here." : "Nothing matches.")
                        .font(.system(size: 13)).foregroundStyle(Theme.textSecondary)
                    if history.items.isEmpty {
                        Text("Text, links, images and files. Passwords from password managers are never saved.")
                            .font(.system(size: 11)).foregroundStyle(Theme.textSecondary)
                    }
                }
                .frame(maxWidth: .infinity, maxHeight: .infinity)
            } else {
                ScrollView {
                    LazyVStack(spacing: 4) {
                        ForEach(visible) { item in
                            ClipRow(item: item, copied: copiedID == item.id) {
                                history.copy(item)
                                withAnimation { copiedID = item.id }
                                DispatchQueue.main.asyncAfter(deadline: .now() + 1.2) {
                                    withAnimation { if copiedID == item.id { copiedID = nil } }
                                }
                            }
                        }
                    }
                }
            }
        }
    }
}

private struct ClipRow: View {
    let item: ClipItem
    let copied: Bool
    let onCopy: () -> Void
    @ObservedObject private var history = ClipboardHistory.shared
    @State private var hovering = false

    var body: some View {
        HStack(spacing: 10) {
            preview
                .frame(width: 34, height: 34)
                .background(Theme.surface, in: RoundedRectangle(cornerRadius: 8))
                .clipShape(RoundedRectangle(cornerRadius: 8))

            VStack(alignment: .leading, spacing: 2) {
                Text(item.title)
                    .font(.system(size: 13, design: item.kind == .text ? .default : .default))
                    .foregroundStyle(.white).lineLimit(2)
                HStack(spacing: 4) {
                    if item.pinned { Image(systemName: "pin.fill").font(.system(size: 9)).foregroundStyle(Theme.accentBright) }
                    Text([item.sourceApp, item.date.formatted(.relative(presentation: .named))]
                        .compactMap { $0 }.joined(separator: " · "))
                        .font(.system(size: 11)).foregroundStyle(Theme.textSecondary).lineLimit(1)
                }
            }
            Spacer(minLength: 6)

            if copied {
                Label("Copied", systemImage: "checkmark").font(.system(size: 12, weight: .semibold)).foregroundStyle(.green)
            } else if hovering {
                IconButton(systemImage: item.pinned ? "pin.slash" : "pin", help: item.pinned ? "Unpin" : "Pin") {
                    withAnimation(Theme.spring) { history.togglePin(item) }
                }
                IconButton(systemImage: "xmark", help: "Delete") {
                    withAnimation(Theme.spring) { history.delete(item) }
                }
            }
        }
        .padding(.horizontal, 8).padding(.vertical, 5)
        .background(RoundedRectangle(cornerRadius: 10).fill(hovering ? Theme.surface : .clear))
        .contentShape(Rectangle())
        .onTapGesture(perform: onCopy)
        .onHover { hovering = $0 }
        .help("Click to copy")
        .accessibilityAddTraits(.isButton)
        .accessibilityLabel("\(item.title). Click to copy.")
    }

    @ViewBuilder private var preview: some View {
        if item.kind == .image, let image = history.image(for: item) {
            Image(nsImage: image).resizable().scaledToFill()
        } else if item.kind == .files, let path = item.filePaths?.first {
            Image(nsImage: NSWorkspace.shared.icon(forFile: path)).resizable().padding(3)
        } else {
            Image(systemName: item.symbol).font(.system(size: 14)).foregroundStyle(Theme.accentBright)
        }
    }
}
