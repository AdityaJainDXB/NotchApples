//
//  ConvertFormats.swift
//  Notch apple
//
//  Convert (Ultimate): every format it knows, what each can become, and how to tell a file's format from its name.
//  The Windows app has the same table (NotchWindows/src/js/services/convert.js), less the Apple-only formats.
//

import Foundation

enum ConvertKind: String, CaseIterable {
    case image, pdf, document, presentation, spreadsheet, audio, video, archive, folder

    var title: String {
        switch self {
        case .image: "Pictures"
        case .pdf: "PDF"
        case .document: "Documents"
        case .presentation: "Presentations"
        case .spreadsheet: "Tables"
        case .audio: "Audio"
        case .video: "Video"
        case .archive: "Archives"
        case .folder: "Folders"
        }
    }

    var symbol: String {
        switch self {
        case .image: "photo"
        case .pdf: "doc.richtext"
        case .document: "doc.text"
        case .presentation: "rectangle.on.rectangle"
        case .spreadsheet: "tablecells"
        case .audio: "waveform"
        case .video: "film"
        case .archive: "doc.zipper"
        case .folder: "folder"
        }
    }

    /// What files of this kind can become, best first.
    var targets: [String] {
        switch self {
        case .image: ["png", "jpg", "heic", "webp", "gif", "bmp", "tiff", "ico", "pdf"]
        case .pdf: ["docx", "txt", "png", "jpg", "rtf", "html", "md", "odt", "doc"]
        case .document: ["pdf", "docx", "txt", "md", "html", "rtf", "pages", "odt", "doc"]
        case .presentation: ["pdf", "pptx", "key", "png", "jpg", "ppt", "odp"]
        case .spreadsheet: ["xlsx", "csv", "json", "tsv", "html", "pdf", "numbers", "xls", "ods"]
        case .audio: ["mp3", "m4a", "wav", "flac", "aiff", "caf", "ogg", "opus"]
        case .video: ["mp4", "mov", "m4v", "gif", "mkv", "webm", "avi", "m4a", "mp3", "wav"]
        case .archive: ["folder"]
        case .folder: ["zip"]
        }
    }
}

struct ConvertFormat {
    let id: String
    let kind: ConvertKind
    let name: String
}

enum ConvertFormats {
    static let all: [ConvertFormat] = [
        .init(id: "png", kind: .image, name: "PNG picture"), .init(id: "jpg", kind: .image, name: "JPEG picture"),
        .init(id: "heic", kind: .image, name: "HEIC photo"), .init(id: "webp", kind: .image, name: "WebP picture"),
        .init(id: "gif", kind: .image, name: "GIF picture"), .init(id: "bmp", kind: .image, name: "Bitmap picture"),
        .init(id: "tiff", kind: .image, name: "TIFF picture"), .init(id: "ico", kind: .image, name: "Icon"),
        .init(id: "svg", kind: .image, name: "SVG drawing"), .init(id: "avif", kind: .image, name: "AVIF picture"),
        .init(id: "pdf", kind: .pdf, name: "PDF"),
        .init(id: "docx", kind: .document, name: "Word document"), .init(id: "doc", kind: .document, name: "Word 97–2003 document"),
        .init(id: "pages", kind: .document, name: "Pages document"), .init(id: "rtf", kind: .document, name: "Rich text"),
        .init(id: "odt", kind: .document, name: "OpenDocument text"), .init(id: "txt", kind: .document, name: "Plain text"),
        .init(id: "md", kind: .document, name: "Markdown"), .init(id: "html", kind: .document, name: "Web page"),
        .init(id: "pptx", kind: .presentation, name: "PowerPoint"), .init(id: "ppt", kind: .presentation, name: "PowerPoint 97–2003"),
        .init(id: "key", kind: .presentation, name: "Keynote"), .init(id: "odp", kind: .presentation, name: "OpenDocument slides"),
        .init(id: "xlsx", kind: .spreadsheet, name: "Excel workbook"), .init(id: "xls", kind: .spreadsheet, name: "Excel 97–2003"),
        .init(id: "numbers", kind: .spreadsheet, name: "Numbers"), .init(id: "ods", kind: .spreadsheet, name: "OpenDocument sheet"),
        .init(id: "csv", kind: .spreadsheet, name: "CSV table"), .init(id: "tsv", kind: .spreadsheet, name: "Tab-separated table"),
        .init(id: "json", kind: .spreadsheet, name: "JSON"),
        .init(id: "mp3", kind: .audio, name: "MP3 audio"), .init(id: "m4a", kind: .audio, name: "M4A (AAC) audio"),
        .init(id: "wav", kind: .audio, name: "WAV audio"), .init(id: "flac", kind: .audio, name: "FLAC audio"),
        .init(id: "aiff", kind: .audio, name: "AIFF audio"), .init(id: "caf", kind: .audio, name: "Core Audio file"),
        .init(id: "aac", kind: .audio, name: "AAC audio"), .init(id: "ogg", kind: .audio, name: "Ogg Vorbis audio"),
        .init(id: "opus", kind: .audio, name: "Opus audio"), .init(id: "wma", kind: .audio, name: "Windows Media audio"),
        .init(id: "mp4", kind: .video, name: "MP4 video"), .init(id: "mov", kind: .video, name: "QuickTime movie"),
        .init(id: "m4v", kind: .video, name: "M4V video"), .init(id: "mkv", kind: .video, name: "Matroska video"),
        .init(id: "webm", kind: .video, name: "WebM video"), .init(id: "avi", kind: .video, name: "AVI video"),
        .init(id: "wmv", kind: .video, name: "Windows Media video"), .init(id: "flv", kind: .video, name: "Flash video"),
        .init(id: "zip", kind: .archive, name: "Zip archive"), .init(id: "folder", kind: .folder, name: "Folder"),
    ]

    static let aliases = ["jpeg": "jpg", "jfif": "jpg", "tif": "tiff", "heif": "heic", "htm": "html", "xhtml": "html",
                          "markdown": "md", "text": "txt", "log": "txt", "aif": "aiff", "oga": "ogg", "3gp": "mp4",
                          "mpeg": "mp4", "mpg": "mp4", "jsonl": "json", "rtfd": "rtf"]

    private static let byID = Dictionary(uniqueKeysWithValues: all.map { ($0.id, $0) })

    static func format(_ id: String) -> ConvertFormat? { byID[id] }

    /// The format of a file from its extension ("folder" for a folder), or nil when it isn't one Convert knows.
    static func detect(_ url: URL) -> String? {
        var isDir: ObjCBool = false
        if FileManager.default.fileExists(atPath: url.path, isDirectory: &isDir), isDir.boolValue,
           !["rtfd", "pages", "key", "numbers"].contains(url.pathExtension.lowercased()) {   // packages that look like folders
            return "folder"
        }
        let ext = url.pathExtension.lowercased()
        let id = aliases[ext] ?? ext
        return byID[id] == nil ? nil : id
    }

    /// What a format can become. Any file can also be zipped.
    static func targets(_ from: String) -> [String] {
        guard let kind = byID[from]?.kind else { return [] }
        let list = kind.targets.filter { $0 != from }
        return kind == .folder || kind == .archive ? list : list + ["zip"]
    }

    static func label(_ id: String) -> String {
        id == "folder" ? "Folder" : "\(id.uppercased()) · \(byID[id]?.name ?? "")"
    }
}
