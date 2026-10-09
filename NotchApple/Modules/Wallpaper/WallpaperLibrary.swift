//
//  WallpaperLibrary.swift
//  Notch apple
//
//  Your wallpaper videos: the ones you add (copied into this app's folder, so the original can move) and the ones you get
//  from the free NASA library. Every video is checked before it is kept: a video, up to 60 seconds, up to 4K and 800 MB
//  (see WallpaperLogic). Each gets a small preview picture. Everything stays on this Mac.
//

import AppKit
import AVFoundation
import SwiftUI

struct WallpaperItem: Codable, Identifiable, Equatable {
    let id: String
    var name: String
    var seconds: Double
    var width: Int
    var height: Int
    var bytes: Int64
    var file: String            // the file name inside the Wallpapers folder
    var credit: String?         // set for free-library clips
}

@MainActor
final class WallpaperLibrary: ObservableObject {
    static let shared = WallpaperLibrary()

    @Published private(set) var items: [WallpaperItem] = []
    @Published private(set) var busy: Set<String> = []          // ids being downloaded, or "import"
    @Published var message: String?

    static var folder: URL {
        FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0].appendingPathComponent("Notch apple/Wallpapers", isDirectory: true)
    }
    private var indexURL: URL { Self.folder.appendingPathComponent("library.json") }
    static func fileURL(_ item: WallpaperItem) -> URL { folder.appendingPathComponent(item.file) }
    static func thumbURL(_ id: String) -> URL { folder.appendingPathComponent("thumbs/\(id).jpg") }
    static func stillURL(_ id: String) -> URL { folder.appendingPathComponent("stills/\(id).jpg") }

    private init() {
        try? FileManager.default.createDirectory(at: Self.folder.appendingPathComponent("thumbs"), withIntermediateDirectories: true)
        try? FileManager.default.createDirectory(at: Self.folder.appendingPathComponent("stills"), withIntermediateDirectories: true)
        items = ((try? JSONDecoder().decode([WallpaperItem].self, from: Data(contentsOf: indexURL))) ?? [])
            .filter { FileManager.default.fileExists(atPath: Self.fileURL($0).path) }
    }

    private func save() { try? JSONEncoder().encode(items).write(to: indexURL, options: .atomic) }

    func item(_ id: String) -> WallpaperItem? { items.first { $0.id == id } }
    func has(curated id: String) -> Bool { items.contains { $0.id == id } }

    // MARK: Checking a video

    /// What the file really is: nil problem means it can be kept.
    nonisolated static func inspect(_ url: URL) async -> (item: (seconds: Double, width: Int, height: Int, bytes: Int64)?, problem: WallpaperLogic.Problem?) {
        let bytes = (try? url.resourceValues(forKeys: [.fileSizeKey]).fileSize).map(Int64.init) ?? 0
        guard WallpaperLogic.isVideoFile(url.lastPathComponent) else { return (nil, .notVideo) }
        let asset = AVURLAsset(url: url)
        guard let track = try? await asset.loadTracks(withMediaType: .video).first else { return (nil, .notVideo) }
        let seconds = (try? await asset.load(.duration))?.seconds
        let size = (try? await track.load(.naturalSize)) ?? .zero
        let transform = (try? await track.load(.preferredTransform)) ?? .identity
        let shown = size.applying(transform)
        let w = Int(abs(shown.width).rounded()), h = Int(abs(shown.height).rounded())
        if let problem = WallpaperLogic.validate(hasVideo: true, seconds: seconds, bytes: bytes, width: w, height: h) { return (nil, problem) }
        return ((seconds ?? 0, w, h, bytes), nil)
    }

    /// A picture from the video: one second in (or the start of a short clip).
    nonisolated static func frame(of url: URL, maxWidth: CGFloat) async -> NSImage? {
        let asset = AVURLAsset(url: url)
        let gen = AVAssetImageGenerator(asset: asset)
        gen.appliesPreferredTrackTransform = true
        gen.maximumSize = CGSize(width: maxWidth, height: maxWidth)
        let seconds = (try? await asset.load(.duration))?.seconds ?? 0
        let at = CMTime(seconds: min(1, max(0, seconds / 3)), preferredTimescale: 600)
        guard let cg = try? await gen.image(at: at).image else { return nil }
        return NSImage(cgImage: cg, size: NSSize(width: cg.width, height: cg.height))
    }

    nonisolated static func writeJPEG(_ image: NSImage, to url: URL, quality: Double) {
        guard let tiff = image.tiffRepresentation, let rep = NSBitmapImageRep(data: tiff),
              let data = rep.representation(using: .jpeg, properties: [.compressionFactor: quality]) else { return }
        try? data.write(to: url, options: .atomic)
    }

    // MARK: Adding

    /// Adds a video you chose: checks it, copies it in, makes its preview. Returns the item, or nil with `message` set.
    @discardableResult
    func add(file source: URL) async -> WallpaperItem? {
        guard !busy.contains("import") else { return nil }
        busy.insert("import"); message = nil
        defer { busy.remove("import") }
        let scoped = source.startAccessingSecurityScopedResource()
        defer { if scoped { source.stopAccessingSecurityScopedResource() } }
        let (info, problem) = await Self.inspect(source)
        guard let info else { message = problem?.message; return nil }
        let id = UUID().uuidString.lowercased()
        let name = WallpaperLogic.cleanName(source.lastPathComponent)
        let ext = source.pathExtension.lowercased()
        let dest = Self.folder.appendingPathComponent("\(id).\(ext)")
        do {
            try await Task.detached { try FileManager.default.copyItem(at: source, to: dest) }.value
        } catch { message = "Couldn't copy the video into Notch apple: \(error.localizedDescription)"; return nil }
        let item = WallpaperItem(id: id, name: name, seconds: info.seconds, width: info.width, height: info.height, bytes: info.bytes, file: dest.lastPathComponent, credit: nil)
        await finish(item, from: dest)
        return item
    }

    /// Gets one of the free-library clips from NASA, checks it and keeps it.
    @discardableResult
    func get(_ c: WallpaperLogic.Curated) async -> WallpaperItem? {
        guard !busy.contains(c.id), !has(curated: c.id), let url = URL(string: c.url), WallpaperLogic.isTrustedDownload(url) else { return nil }
        busy.insert(c.id); message = nil
        defer { busy.remove(c.id) }
        do {
            let (tmp, response) = try await URLSession.shared.download(from: url)
            guard (response as? HTTPURLResponse)?.statusCode == 200 else { message = "NASA didn't answer. Try again in a minute."; return nil }
            let dest = Self.folder.appendingPathComponent("\(c.id).mp4")
            try? FileManager.default.removeItem(at: dest)
            try FileManager.default.moveItem(at: tmp, to: dest)
            let (info, problem) = await Self.inspect(dest)
            guard let info else { try? FileManager.default.removeItem(at: dest); message = problem?.message; return nil }
            let item = WallpaperItem(id: c.id, name: c.title, seconds: info.seconds, width: info.width, height: info.height, bytes: info.bytes, file: dest.lastPathComponent, credit: c.credit)
            await finish(item, from: dest)
            return item
        } catch {
            message = "Couldn't download it. Check your connection and try again."
            return nil
        }
    }

    private func finish(_ item: WallpaperItem, from file: URL) async {
        if let thumb = await Self.frame(of: file, maxWidth: 480) { Self.writeJPEG(thumb, to: Self.thumbURL(item.id), quality: 0.8) }
        items.append(item)
        save()
    }

    func remove(_ item: WallpaperItem) {
        if WallpaperEngine.shared.selectedID == item.id { WallpaperEngine.shared.choose(nil) }
        for url in [Self.fileURL(item), Self.thumbURL(item.id), Self.stillURL(item.id)] { try? FileManager.default.removeItem(at: url) }
        items.removeAll { $0.id == item.id }
        save()
    }
}
