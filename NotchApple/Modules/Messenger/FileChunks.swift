//
//  FileChunks.swift
//  Notch Apple
//
//  Big files in an anonymous room. The room relay forwards one frame of at most 16 KB, so a file bigger than one piece is cut
//  into 8,000-byte pieces, each sealed and sent as its own envelope (`Kind.chunk`), and put back together by whoever receives
//  them. This is only the cutting and the putting back together, with no network, so tests can run it.
//

import Foundation

enum RoomFiles {
    /// Bytes per piece. A sealed envelope for one piece is about 14,700 characters, under the relay's 16,384-byte frame.
    static let chunkSize = 8000
    static let maxBytes = 2_000_000
    static var maxChunks: Int { (maxBytes + chunkSize - 1) / chunkSize }

    static func split(_ data: Data) -> [Data] {
        stride(from: 0, to: data.count, by: chunkSize).map { data.subdata(in: $0..<min($0 + chunkSize, data.count)) }
    }

    /// A file name that is safe to show and to save: no folders, no control characters, at most 100 characters.
    static func cleanName(_ raw: String?) -> String? {
        let last = ((raw ?? "") as NSString).lastPathComponent.unicodeScalars.filter { !CharacterSet.controlCharacters.contains($0) }
        let name = String(String.UnicodeScalarView(last)).trimmingCharacters(in: .whitespaces)
        return name.isEmpty || name == "." || name == ".." ? nil : String(name.prefix(100))
    }
}

/// Files arriving in pieces, from several senders at once.
struct FileAssembly {
    struct Part: Equatable { var name: String; var n: Int; var chunks: [Int: Data] = [:]; var started: Date }
    private(set) var parts: [String: Part] = [:]
    static let maxParts = 6                 // files in flight at once
    static let patience: TimeInterval = 180 // give up on a file that stops arriving

    /// Adds one piece of file `key`. Returns the whole file once every piece is in; nil while waiting or when the piece is not acceptable.
    mutating func add(key: String, name: String, n: Int, i: Int, bytes: Data, now: Date = Date()) -> (name: String, data: Data)? {
        guard n >= 2, n <= RoomFiles.maxChunks, i >= 0, i < n, !bytes.isEmpty, bytes.count <= RoomFiles.chunkSize else { return nil }
        // Only the last piece may be short.
        if i < n - 1, bytes.count != RoomFiles.chunkSize { return nil }
        if parts[key] == nil {
            guard parts.count < Self.maxParts else { return nil }
            parts[key] = Part(name: name, n: n, started: now)
        }
        guard parts[key]?.n == n else { return nil }
        parts[key]?.chunks[i] = bytes
        guard let part = parts[key], part.chunks.count == n else { return nil }
        parts[key] = nil
        var data = Data()
        for k in 0..<n { guard let c = part.chunks[k] else { return nil }; data.append(c) }
        return data.count <= RoomFiles.maxBytes ? (part.name, data) : nil
    }

    /// Forgets files that stopped arriving; returns their names so the screen can say so.
    mutating func expire(now: Date = Date()) -> [String] {
        let stale = parts.filter { now.timeIntervalSince($0.value.started) > Self.patience }
        for key in stale.keys { parts[key] = nil }
        return stale.values.map(\.name)
    }

    mutating func reset() { parts = [:] }
}
