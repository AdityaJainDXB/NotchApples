//
//  WallpaperView.swift
//  Notch apple
//
//  The Wallpaper tab (Pro): your videos and a small free library as picture cards (click one to use it), a button and a
//  drop target to add your own (up to 60 seconds, up to 4K), and the switches that keep it from using too much power.
//  See WallpaperEngine for how it plays and WallpaperLibrary for what is checked.
//

import SwiftUI
import UniformTypeIdentifiers

struct WallpaperView: View {
    @StateObject private var engine = WallpaperEngine.shared
    @StateObject private var library = WallpaperLibrary.shared
    @State private var dropping = false

    private let columns = [GridItem(.adaptive(minimum: 150, maximum: 200), spacing: 8)]

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            header
            ScrollView {
                VStack(alignment: .leading, spacing: 10) {
                    LazyVGrid(columns: columns, spacing: 8) {
                        addTile
                        ForEach(library.items) { card($0) }
                    }
                    let free = WallpaperLogic.curated.filter { !library.has(curated: $0.id) }
                    if !free.isEmpty {
                        VStack(alignment: .leading, spacing: 6) {
                            Text("Free library · NASA, public domain").sectionTitle()
                            LazyVGrid(columns: columns, spacing: 8) { ForEach(free) { freeCard($0) } }
                        }
                    }
                }
            }
            .scrollIndicators(.hidden)
            footer
        }
        .overlay { if dropping { RoundedRectangle(cornerRadius: 12).strokeBorder(Theme.accentBright, style: StrokeStyle(lineWidth: 2, dash: [6])).background(Theme.accent.opacity(0.1)).allowsHitTesting(false) } }
        .onDrop(of: [.fileURL], isTargeted: $dropping) { providers in
            guard let p = providers.first else { return false }
            _ = p.loadObject(ofClass: URL.self) { url, _ in
                guard let url else { return }
                Task { @MainActor in if let item = await library.add(file: url) { engine.choose(item.id); engine.isOn = true } }
            }
            return true
        }
    }

    // MARK: Pieces

    private var header: some View {
        HStack(spacing: 10) {
            Image(systemName: "photo.tv").font(.system(size: 18)).foregroundStyle(Theme.accentBright)
            VStack(alignment: .leading, spacing: 0) {
                Text("Live wallpaper").font(.system(size: 14, weight: .bold)).foregroundStyle(.white)
                Text(statusText).font(.system(size: 10)).foregroundStyle(engine.note == nil ? Theme.textSecondary : .orange).lineLimit(1)
            }
            Spacer()
            Toggle("", isOn: $engine.isOn).toggleStyle(.switch).labelsHidden()
                .disabled(library.items.isEmpty).help(library.items.isEmpty ? "Add a video or get one from the free library first" : "Play the wallpaper")
        }
    }

    private var statusText: String {
        if let note = engine.note { return note }
        if let m = library.message { return m }
        if engine.running, let c = engine.current { return "Playing “\(c.name)” on every display" }
        return library.items.isEmpty ? "Add a video (up to 60 seconds, up to 4K) or get one from the free library" : "Pick a video, then switch it on"
    }

    private var addTile: some View {
        Button { chooseFile() } label: {
            VStack(spacing: 6) {
                if library.busy.contains("import") { ProgressView().controlSize(.small) } else { Image(systemName: "plus.circle.fill").font(.system(size: 24)).foregroundStyle(Theme.accentBright) }
                Text("Add your video").font(.system(size: 12, weight: .semibold)).foregroundStyle(.white)
                Text("or drop one here · up to 60 s, 4K").font(.system(size: 9)).foregroundStyle(Theme.textSecondary)
            }
            .frame(maxWidth: .infinity).frame(height: 96)
            .background(RoundedRectangle(cornerRadius: 10).fill(Theme.surface))
            .overlay(RoundedRectangle(cornerRadius: 10).strokeBorder(Theme.accent.opacity(0.5), style: StrokeStyle(lineWidth: 1, dash: [5])))
        }
        .buttonStyle(.plain)
    }

    private func card(_ item: WallpaperItem) -> some View {
        let chosen = engine.selectedID == item.id
        return Button { engine.choose(item.id); engine.isOn = true } label: {
            VStack(alignment: .leading, spacing: 4) {
                ZStack(alignment: .topTrailing) {
                    thumbnail(item.id).frame(height: 70).frame(maxWidth: .infinity).clipShape(RoundedRectangle(cornerRadius: 7))
                    if chosen { Image(systemName: "checkmark.circle.fill").foregroundStyle(.white, Theme.accent).padding(4) }
                }
                Text(item.name).font(.system(size: 11, weight: .semibold)).foregroundStyle(.white).lineLimit(1)
                Text("\(clock(item.seconds)) · \(quality(item))\(item.credit.map { " · \($0)" } ?? "")").font(.system(size: 9)).foregroundStyle(Theme.textSecondary).lineLimit(1)
            }
            .padding(6)
            .background(RoundedRectangle(cornerRadius: 10).fill(chosen ? Theme.accent.opacity(0.25) : Theme.surface))
            .overlay(RoundedRectangle(cornerRadius: 10).strokeBorder(chosen ? Theme.accent : .clear, lineWidth: 1.2))
        }
        .buttonStyle(.plain)
        .contextMenu { Button("Remove", role: .destructive) { library.remove(item) } }
        .help("Use “\(item.name)”. Right-click to remove it.")
    }

    private func freeCard(_ c: WallpaperLogic.Curated) -> some View {
        let loading = library.busy.contains(c.id)
        return VStack(alignment: .leading, spacing: 4) {
            Text(c.title).font(.system(size: 11, weight: .semibold)).foregroundStyle(.white).lineLimit(1)
            Text(c.blurb).font(.system(size: 9)).foregroundStyle(Theme.textSecondary).lineLimit(2).fixedSize(horizontal: false, vertical: true)
            HStack {
                Text("\(c.seconds) s · \(c.megabytes) MB · \(c.credit)").font(.system(size: 9)).foregroundStyle(Theme.textSecondary).lineLimit(1)
                Spacer(minLength: 2)
                Button { Task { if let item = await library.get(c) { engine.choose(item.id); engine.isOn = true } } } label: {
                    if loading { ProgressView().controlSize(.mini) } else { Text("Get") }
                }
                .buttonStyle(PurpleButtonStyle(prominent: false)).disabled(loading)
            }
        }
        .padding(8)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(RoundedRectangle(cornerRadius: 10).fill(Theme.surface))
    }

    private var footer: some View {
        HStack(spacing: 14) {
            Toggle("Pause on battery", isOn: $engine.pauseOnBattery).toggleStyle(.switch).controlSize(.mini)
                .help("A 4K video all day is a lot of power. It also pauses in Low Power Mode, when the screen sleeps or locks, and when windows cover it.")
            Toggle("Still picture on the lock screen", isOn: $engine.lockStill).toggleStyle(.switch).controlSize(.mini)
                .help("macOS can't play video on the lock screen, so a still from the video becomes your wallpaper there. Turning the live wallpaper off puts your old wallpaper back.")
            Spacer()
            if engine.running { Button("Turn off and restore my wallpaper") { engine.isOn = false }.buttonStyle(.plain).font(.system(size: 10)).foregroundStyle(Theme.accentBright) }
        }
        .font(.system(size: 10)).foregroundStyle(Theme.textSecondary)
    }

    @ViewBuilder private func thumbnail(_ id: String) -> some View {
        if let img = NSImage(contentsOf: WallpaperLibrary.thumbURL(id)) {
            Image(nsImage: img).resizable().aspectRatio(contentMode: .fill)
        } else {
            Rectangle().fill(Theme.surface).overlay(Image(systemName: "film").foregroundStyle(Theme.textSecondary))
        }
    }

    private func clock(_ s: Double) -> String { String(format: "%d:%02d", Int(s) / 60, Int(s) % 60) }
    private func quality(_ i: WallpaperItem) -> String {
        let long = max(i.width, i.height)
        return long >= 3800 ? "4K" : long >= 2500 ? "1440p" : long >= 1900 ? "1080p" : long >= 1200 ? "720p" : "\(i.width)×\(i.height)"
    }

    private func chooseFile() {
        let panel = NSOpenPanel()
        panel.allowedContentTypes = [.movie, .mpeg4Movie, .quickTimeMovie]
        panel.allowsMultipleSelection = false
        panel.message = "Choose a video (up to 60 seconds, up to 4K)"
        NSApp.activate(ignoringOtherApps: true)
        guard panel.runModal() == .OK, let url = panel.url else { return }
        Task { if let item = await library.add(file: url) { engine.choose(item.id); engine.isOn = true } }
    }
}
