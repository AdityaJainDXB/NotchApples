//
//  ConvertEngine.swift
//  Notch apple
//
//  Convert (Ultimate): turns a file into another kind of file, with what the Mac already has wherever it can:
//
//  - pictures: Image I/O (PNG, JPEG, HEIC, GIF, BMP, TIFF, ICO, PDF; WebP through FFmpeg when macOS can't write it);
//  - PDF: PDFKit (every page to a picture, the text to Word, RTF, web page, Markdown or plain text);
//  - documents: macOS's own text system reads and writes Word, RTF, OpenDocument, web pages and text, and prints PDFs;
//    Pages, when it's installed, does Pages files and the best-looking PDFs;
//  - presentations: Keynote (PowerPoint and Keynote files to PDF, PowerPoint, Keynote or a picture of every slide);
//  - tables: CSV, TSV, JSON and Excel read and written here; Numbers for Numbers files and PDFs;
//  - audio: afconvert (M4A, WAV, AIFF, CAF, FLAC); video: AVFoundation (MP4, MOV, M4V, the sound alone, GIF);
//  - anything else (MP3, Ogg, WebM, MKV, old Office formats…): FFmpeg or LibreOffice, both free, when installed;
//  - zip and unzip with ditto.
//
//  Results are saved next to the original ("Report.pdf"), never over anything ("Report 2.pdf"), or in Downloads when
//  that folder can't be written to.
//

import AppKit
import AVFoundation
import PDFKit
import UniformTypeIdentifiers

enum ConvertHelp: String {
    case office, ffmpeg, keynote, pages, numbers

    var text: String {
        switch self {
        case .office: "This needs Keynote, Pages or Numbers (free on the App Store), or LibreOffice (free)."
        case .ffmpeg: "This needs FFmpeg (free). Install it with Homebrew, then click ↻."
        case .keynote: "This needs Keynote (free on the App Store)."
        case .pages: "This needs Pages (free on the App Store)."
        case .numbers: "This needs Numbers (free on the App Store)."
        }
    }

    var link: URL? {
        switch self {
        case .office: URL(string: "https://www.libreoffice.org/download/download-libreoffice/")
        case .ffmpeg: URL(string: "https://formulae.brew.sh/formula/ffmpeg")
        case .keynote: URL(string: "macappstore://apps.apple.com/app/id409183694")
        case .pages: URL(string: "macappstore://apps.apple.com/app/id409201541")
        case .numbers: URL(string: "macappstore://apps.apple.com/app/id409203825")
        }
    }

    var button: String {
        switch self {
        case .office: "Get LibreOffice"
        case .ffmpeg: "About FFmpeg"
        default: "Get it"
        }
    }

    /// A Terminal command that installs it, when there is one.
    var command: String? { self == .ffmpeg ? "brew install ffmpeg" : nil }
}

enum ConvertError: LocalizedError {
    case needs(ConvertHelp)
    case failed(String)

    var errorDescription: String? {
        switch self {
        case .needs(let help): help.text
        case .failed(let why): why
        }
    }
}

struct ConvertTools {
    var keynote = false, pages = false, numbers = false
    var libreOffice: String?
    var ffmpeg: String?

    static func find() -> ConvertTools {
        let ws = NSWorkspace.shared
        let fm = FileManager.default
        var t = ConvertTools()
        t.keynote = ws.urlForApplication(withBundleIdentifier: "com.apple.iWork.Keynote") != nil
        t.pages = ws.urlForApplication(withBundleIdentifier: "com.apple.iWork.Pages") != nil
        t.numbers = ws.urlForApplication(withBundleIdentifier: "com.apple.iWork.Numbers") != nil
        var office = ["/Applications/LibreOffice.app/Contents/MacOS/soffice"]
        if let lo = ws.urlForApplication(withBundleIdentifier: "org.libreoffice.script") { office.insert(lo.appendingPathComponent("Contents/MacOS/soffice").path, at: 0) }
        t.libreOffice = office.first { fm.isExecutableFile(atPath: $0) }
        t.ffmpeg = ["/opt/homebrew/bin/ffmpeg", "/usr/local/bin/ffmpeg", "/opt/local/bin/ffmpeg"].first { fm.isExecutableFile(atPath: $0) }
        return t
    }
}

@MainActor
enum ConvertEngine {
    private(set) static var tools = ConvertTools.find()

    static func refreshTools() { tools = ConvertTools.find() }

    /// Converts one file and returns where the result was saved (a file, or a folder of pictures).
    static func convert(_ url: URL, from: String, to: String, step: @escaping (String) -> Void) async throws -> URL {
        let t = tools
        guard FileManager.default.fileExists(atPath: url.path) else { throw ConvertError.failed("That file has moved or been deleted.") }
        guard let kind = ConvertFormats.format(from)?.kind else { throw ConvertError.failed("Choose what this file is first.") }

        if to == "zip" {
            step("Zipping…")
            let out = target(url, ext: "zip")
            try await run("/usr/bin/ditto", ["-c", "-k", "--sequesterRsrc", "--keepParent", url.path, out.path])
            return out
        }
        if from == "zip" {
            step("Unzipping…")
            let out = target(url, ext: "")
            try await run("/usr/bin/ditto", ["-x", "-k", url.path, out.path])
            return out
        }

        switch kind {
        case .image:
            step("Converting…")
            return try await image(url, from: from, to: to, t: t)
        case .pdf:
            if to == "png" || to == "jpg" {
                step("Rendering pages…")
                let out = target(url, ext: "", suffix: " pages")
                try await pdfPages(url, out, jpeg: to == "jpg")
                return out
            }
            if t.libreOffice != nil, ["docx", "doc", "odt"].contains(to) {
                // LibreOffice keeps a PDF's layout far better than its bare text.
                step("Opening in LibreOffice…")
                return try await libreOffice(url, from: from, to: to, t: t)
            }
            step("Converting…")
            return try writeDocument(try readDocument(url, from: from), to: to, near: url)
        case .document:
            return try await document(url, from: from, to: to, t: t, step: step)
        case .presentation:
            return try await presentation(url, from: from, to: to, t: t, step: step)
        case .spreadsheet:
            return try await spreadsheet(url, from: from, to: to, t: t, step: step)
        case .audio, .video:
            return try await media(url, from: from, to: to, kind: kind, t: t, step: step)
        case .archive, .folder:
            throw ConvertError.failed("Can't turn \(from.uppercased()) into \(to.uppercased()).")
        }
    }

    /// Several pictures as the pages of one PDF ("Combined.pdf", next to the first).
    static func combinePDF(_ urls: [URL], step: @escaping (String) -> Void) async throws -> URL {
        guard let first = urls.first else { throw ConvertError.failed("Nothing to combine.") }
        var images: [CGImage] = []
        for (i, u) in urls.enumerated() {
            step("Adding \(i + 1) of \(urls.count)…")
            images.append(try loadImage(u, from: ConvertFormats.detect(u) ?? "png"))
        }
        let out = target(first.deletingLastPathComponent().appendingPathComponent("Combined.pdf"), ext: "pdf")
        try imagesPDF(images, out)
        return out
    }

    // MARK: Where results go

    /// Next to the original, never over anything; in Downloads when the folder can't be written to. `ext` empty
    /// means a folder.
    static func target(_ url: URL, ext: String, suffix: String = "") -> URL {
        let fm = FileManager.default
        let stem = url.deletingPathExtension().lastPathComponent
        var dir = url.deletingLastPathComponent()
        if !fm.isWritableFile(atPath: dir.path) {
            dir = fm.urls(for: .downloadsDirectory, in: .userDomainMask).first ?? fm.temporaryDirectory
        }
        var n = 1
        while true {
            let base = n < 2 ? "\(stem)\(suffix)" : "\(stem)\(suffix) \(n)"
            let candidate = ext.isEmpty ? dir.appendingPathComponent(base, isDirectory: true) : dir.appendingPathComponent(base).appendingPathExtension(ext)
            if !fm.fileExists(atPath: candidate.path), candidate.standardizedFileURL != url.standardizedFileURL { return candidate }
            n += 1
        }
    }

    private static func temp(_ url: URL, ext: String) -> URL {
        let dir = FileManager.default.temporaryDirectory.appendingPathComponent("Notch apple convert", isDirectory: true)
        try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        return dir.appendingPathComponent(String(UUID().uuidString.prefix(8)) + " " + url.deletingPathExtension().lastPathComponent).appendingPathExtension(ext)
    }

    // MARK: Running tools

    /// Runs a command off the main thread. Throws its last line of output when it fails.
    @discardableResult
    static func run(_ path: String, _ args: [String]) async throws -> String {
        try await Task.detached(priority: .userInitiated) { () throws -> String in
            let p = Process()
            p.executableURL = URL(fileURLWithPath: path)
            p.arguments = args
            let pipe = Pipe()
            p.standardOutput = pipe
            p.standardError = pipe
            p.standardInput = FileHandle.nullDevice
            do { try p.run() } catch { throw ConvertError.failed("Couldn't start \(URL(fileURLWithPath: path).lastPathComponent).") }
            let data = pipe.fileHandleForReading.readDataToEndOfFile()
            p.waitUntilExit()
            let text = String(decoding: data, as: UTF8.self)
            if p.terminationStatus != 0 {
                let last = text.split(separator: "\n").map { $0.trimmingCharacters(in: .whitespaces) }.last { !$0.isEmpty } ?? "It didn't work."
                throw ConvertError.failed(String(last.prefix(300)))
            }
            return text
        }.value
    }

    /// Keynote, Pages or Numbers, told through AppleScript to open a file and export it.
    private static func iWork(_ app: String, _ input: URL, _ output: URL, as format: String) async throws {
        let script = """
        on run argv
          set inFile to POSIX file (item 1 of argv)
          set outFile to POSIX file (item 2 of argv)
          set fmt to item 3 of argv
          tell application "\(app)"
            set d to open inFile
            try
              if fmt is "save" then
                save d in outFile
              else if fmt is "PNG" then
                export d to outFile as slide images with properties {image format:PNG}
              else if fmt is "JPEG" then
                export d to outFile as slide images with properties {image format:JPEG}
              else if fmt is "PDF" then
                export d to outFile as PDF
              else if fmt is "Microsoft PowerPoint" then
                export d to outFile as Microsoft PowerPoint
              else if fmt is "Microsoft Word" then
                export d to outFile as Microsoft Word
              else if fmt is "Microsoft Excel" then
                export d to outFile as Microsoft Excel
              else if fmt is "CSV" then
                export d to outFile as CSV
              else if fmt is "unformatted text" then
                export d to outFile as unformatted text
              else if fmt is "formatted text" then
                export d to outFile as formatted text
              end if
            on error e
              close d saving no
              error e
            end try
            close d saving no
          end tell
        end run
        """
        do { try await run("/usr/bin/osascript", ["-e", script, input.path, output.path, format]) }
        catch ConvertError.failed(let why) {
            if why.contains("-1743") || why.lowercased().contains("not authorized") {
                throw ConvertError.failed("Allow Notch apple to control \(app) in System Settings → Privacy & Security → Automation.")
            }
            throw ConvertError.failed("\(app) couldn't convert it: \(why)")
        }
        guard FileManager.default.fileExists(atPath: output.path) else { throw ConvertError.failed("\(app) didn't save anything.") }
    }

    /// LibreOffice, without its window, with its own profile so an open LibreOffice doesn't swallow the job.
    private static func libreOffice(_ url: URL, from: String, to: String, t: ConvertTools, output: URL? = nil) async throws -> URL {
        guard let soffice = t.libreOffice else { throw ConvertError.needs(.office) }
        let fm = FileManager.default
        let dir = fm.temporaryDirectory.appendingPathComponent("notch-convert-\(UUID().uuidString)", isDirectory: true)
        try fm.createDirectory(at: dir, withIntermediateDirectories: true)
        defer { try? fm.removeItem(at: dir) }
        let profile = fm.temporaryDirectory.appendingPathComponent("notch-convert-lo-profile", isDirectory: true)
        var args = ["--headless", "--norestore", "-env:UserInstallation=\(profile.absoluteString)"]
        if from == "pdf" { args.append("--infilter=writer_pdf_import") }
        args += ["--convert-to", to == "tsv" ? "csv:Text - txt - csv (StarCalc):9,34,76" : to, "--outdir", dir.path, url.path]
        try await run(soffice, args)
        guard let made = try fm.contentsOfDirectory(at: dir, includingPropertiesForKeys: nil).first else {
            throw ConvertError.failed("LibreOffice couldn't convert it.")
        }
        let out = output ?? target(url, ext: to)
        try fm.moveItem(at: made, to: out)
        return out
    }

    // MARK: Pictures

    private static func image(_ url: URL, from: String, to: String, t: ConvertTools) async throws -> URL {
        let img = try loadImage(url, from: from)
        let out = target(url, ext: to)
        if to == "pdf" { try imagesPDF([img], out); return out }
        if to == "webp", !canWrite(UTType.webP) {
            // macOS reads WebP but can't write it: FFmpeg can.
            guard let ffmpeg = t.ffmpeg else { throw ConvertError.needs(.ffmpeg) }
            let png = temp(url, ext: "png")
            defer { try? FileManager.default.removeItem(at: png) }
            try writeImage(img, to: "png", png)
            try await run(ffmpeg, ["-hide_banner", "-nostdin", "-loglevel", "error", "-y", "-i", png.path, "-quality", "90", out.path])
            return out
        }
        try writeImage(img, to: to, out)
        return out
    }

    private static func canWrite(_ type: UTType) -> Bool {
        ((CGImageDestinationCopyTypeIdentifiers() as? [String]) ?? []).contains(type.identifier)
    }

    /// The picture, the right way up (photos store their rotation separately).
    static func loadImage(_ url: URL, from: String) throws -> CGImage {
        if from != "svg", let src = CGImageSourceCreateWithURL(url as CFURL, nil),
           let props = CGImageSourceCopyPropertiesAtIndex(src, 0, nil) as? [CFString: Any] {
            let w = props[kCGImagePropertyPixelWidth] as? Int ?? 0, h = props[kCGImagePropertyPixelHeight] as? Int ?? 0
            let options: [CFString: Any] = [kCGImageSourceCreateThumbnailFromImageAlways: true,
                                            kCGImageSourceCreateThumbnailWithTransform: true,
                                            kCGImageSourceThumbnailMaxPixelSize: max(w, h, 1)]
            if let img = CGImageSourceCreateThumbnailAtIndex(src, 0, options as CFDictionary) ?? CGImageSourceCreateImageAtIndex(src, 0, nil) { return img }
        }
        if let ns = NSImage(contentsOf: url) {
            var rect = CGRect(origin: .zero, size: ns.size == .zero ? CGSize(width: 1024, height: 1024) : ns.size)
            if from == "svg" { rect.size = CGSize(width: rect.width * 2, height: rect.height * 2) }   // sharper
            if let img = ns.cgImage(forProposedRect: &rect, context: nil, hints: nil) { return img }
        }
        throw ConvertError.failed("That picture couldn't be opened.")
    }

    static func writeImage(_ img: CGImage, to: String, _ out: URL) throws {
        let types: [String: UTType] = ["png": .png, "jpg": .jpeg, "heic": .heic, "gif": .gif, "bmp": .bmp, "tiff": .tiff, "ico": .ico, "webp": .webP]
        guard let type = types[to] else { throw ConvertError.failed("Can't make .\(to) pictures.") }
        var image = img
        if to == "jpg" || to == "bmp" { image = flatten(img) ?? img }   // no transparency: put it on white
        if to == "ico" { image = squared(img, side: min(256, max(img.width, img.height))) ?? img }
        guard let dest = CGImageDestinationCreateWithURL(out as CFURL, type.identifier as CFString, 1, nil) else {
            throw ConvertError.failed("This Mac can't write .\(to) pictures.")
        }
        CGImageDestinationAddImage(dest, image, [kCGImageDestinationLossyCompressionQuality: 0.9] as CFDictionary)
        guard CGImageDestinationFinalize(dest) else { throw ConvertError.failed("Couldn't save the picture.") }
    }

    private static func flatten(_ img: CGImage) -> CGImage? {
        guard let ctx = CGContext(data: nil, width: img.width, height: img.height, bitsPerComponent: 8, bytesPerRow: 0,
                                  space: CGColorSpace(name: CGColorSpace.sRGB)!, bitmapInfo: CGImageAlphaInfo.noneSkipLast.rawValue) else { return nil }
        let r = CGRect(x: 0, y: 0, width: img.width, height: img.height)
        ctx.setFillColor(CGColor(red: 1, green: 1, blue: 1, alpha: 1))
        ctx.fill(r)
        ctx.draw(img, in: r)
        return ctx.makeImage()
    }

    /// Centred on a transparent square, at most `side` pixels (icons are square, 256 at most).
    private static func squared(_ img: CGImage, side: Int) -> CGImage? {
        guard let ctx = CGContext(data: nil, width: side, height: side, bitsPerComponent: 8, bytesPerRow: 0,
                                  space: CGColorSpace(name: CGColorSpace.sRGB)!, bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue) else { return nil }
        let k = CGFloat(side) / CGFloat(max(img.width, img.height))
        let w = CGFloat(img.width) * k, h = CGFloat(img.height) * k
        ctx.interpolationQuality = .high
        ctx.draw(img, in: CGRect(x: (CGFloat(side) - w) / 2, y: (CGFloat(side) - h) / 2, width: w, height: h))
        return ctx.makeImage()
    }

    /// Each picture as one page, the page the picture's size.
    static func imagesPDF(_ images: [CGImage], _ out: URL) throws {
        guard let ctx = CGContext(out as CFURL, mediaBox: nil, nil) else { throw ConvertError.failed("Couldn't make the PDF.") }
        for img in images {
            var box = CGRect(x: 0, y: 0, width: CGFloat(img.width) * 0.75, height: CGFloat(img.height) * 0.75)
            ctx.beginPage(mediaBox: &box)
            ctx.draw(flatten(img) ?? img, in: box)
            ctx.endPage()
        }
        ctx.closePDF()
    }

    // MARK: PDF

    /// Every page as Page 1.png, Page 2.png… in a new folder, at twice the page's size.
    private static func pdfPages(_ url: URL, _ folder: URL, jpeg: Bool) async throws {
        guard let doc = PDFDocument(url: url) else { throw ConvertError.failed("That PDF couldn't be opened (is it locked with a password?).") }
        try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
        for i in 0..<doc.pageCount {
            guard let page = doc.page(at: i) else { continue }
            let b = page.bounds(for: .mediaBox)
            let turned = page.rotation % 180 != 0
            let size = NSSize(width: (turned ? b.height : b.width) * 2, height: (turned ? b.width : b.height) * 2)
            let thumb = page.thumbnail(of: size, for: .mediaBox)
            var rect = CGRect(origin: .zero, size: thumb.size)
            guard let img = thumb.cgImage(forProposedRect: &rect, context: nil, hints: nil) else { continue }
            try writeImage(img, to: jpeg ? "jpg" : "png", folder.appendingPathComponent("Page \(i + 1).\(jpeg ? "jpg" : "png")"))
            await Task.yield()
        }
    }

    // MARK: Documents

    private static func document(_ url: URL, from: String, to: String, t: ConvertTools, step: (String) -> Void) async throws -> URL {
        if from == "pages" || to == "pages" {
            let pagesFormats = ["pdf": "PDF", "docx": "Microsoft Word", "txt": "unformatted text", "rtf": "formatted text", "pages": "save"]
            if t.pages, let f = pagesFormats[to], from != "md", from != "html" {
                step("Opening in Pages…")
                let out = target(url, ext: to)
                try await iWork("Pages", url, out, as: f)
                return out
            }
            if from == "pages", t.libreOffice != nil, to != "pages" {
                step("Opening in LibreOffice…")
                return try await libreOffice(url, from: from, to: to, t: t)
            }
            throw ConvertError.needs(.pages)
        }
        // The best-looking PDFs of Word files come from Pages or LibreOffice; macOS's own reader is the fallback.
        if to == "pdf", ["docx", "doc", "odt", "rtf"].contains(from) {
            if t.pages, from != "odt" {
                step("Opening in Pages…")
                let out = target(url, ext: "pdf")
                if (try? await iWork("Pages", url, out, as: "PDF")) != nil { return out }
            }
            if t.libreOffice != nil {
                step("Opening in LibreOffice…")
                if let out = try? await libreOffice(url, from: from, to: to, t: t) { return out }
            }
        }
        step("Converting…")
        return try writeDocument(try readDocument(url, from: from), to: to, near: url)
    }

    private static let documentTypes: [String: NSAttributedString.DocumentType] = [
        "docx": .officeOpenXML, "doc": .docFormat, "odt": .openDocument, "rtf": .rtf, "html": .html, "txt": .plain,
    ]

    static func readDocument(_ url: URL, from: String) throws -> NSAttributedString {
        switch from {
        case "pdf":
            guard let doc = PDFDocument(url: url) else { throw ConvertError.failed("That PDF couldn't be opened (is it locked with a password?).") }
            let all = NSMutableAttributedString()
            for i in 0..<doc.pageCount {
                if let page = doc.page(at: i)?.attributedString {
                    all.append(page)
                    all.append(NSAttributedString(string: "\n"))
                }
            }
            if all.string.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                throw ConvertError.failed("This PDF has no text in it (it may be scanned pictures). Try PNG or JPG instead.")
            }
            return all
        case "md":
            let md = try String(contentsOf: url, encoding: .utf8)
            return try NSAttributedString(data: Data(ConvertText.html(markdown: md, title: url.deletingPathExtension().lastPathComponent).utf8),
                                          options: [.documentType: NSAttributedString.DocumentType.html, .characterEncoding: String.Encoding.utf8.rawValue],
                                          documentAttributes: nil)
        case "txt":
            let text = try (try? String(contentsOf: url, encoding: .utf8)) ?? String(contentsOf: url, encoding: .isoLatin1)
            return NSAttributedString(string: text, attributes: [.font: NSFont.systemFont(ofSize: 12), .foregroundColor: NSColor.black])
        default:
            var options: [NSAttributedString.DocumentReadingOptionKey: Any] = [:]
            if let type = documentTypes[from] { options[.documentType] = type }
            if from == "html" { options[.characterEncoding] = String.Encoding.utf8.rawValue }
            do { return try NSAttributedString(url: url, options: options, documentAttributes: nil) }
            catch { throw ConvertError.failed("That \(from.uppercased()) file couldn't be read.") }
        }
    }

    static func writeDocument(_ s: NSAttributedString, to: String, near url: URL) throws -> URL {
        let out = target(url, ext: to)
        switch to {
        case "pdf": try printPDF(s, out)
        case "md": try ConvertText.markdown(from: s).write(to: out, atomically: true, encoding: .utf8)
        case "txt": try s.string.write(to: out, atomically: true, encoding: .utf8)
        default:
            guard let type = documentTypes[to] else { throw ConvertError.failed("Can't write \(to.uppercased()) files.") }
            var attrs: [NSAttributedString.DocumentAttributeKey: Any] = [.documentType: type]
            if to == "html" { attrs[.characterEncoding] = String.Encoding.utf8.rawValue }
            let data = try s.data(from: NSRange(location: 0, length: s.length), documentAttributes: attrs)
            try data.write(to: out)
        }
        return out
    }

    /// Prints the text to a PDF on A4 pages, without showing anything.
    static func printPDF(_ s: NSAttributedString, _ out: URL) throws {
        let info = NSPrintInfo(dictionary: [.jobSavingURL: out])
        info.jobDisposition = .save
        info.paperSize = NSSize(width: 595, height: 842)
        info.topMargin = 56; info.bottomMargin = 56; info.leftMargin = 56; info.rightMargin = 56
        info.horizontalPagination = .fit
        info.verticalPagination = .automatic
        info.isHorizontallyCentered = false
        info.isVerticallyCentered = false
        let width = info.paperSize.width - info.leftMargin - info.rightMargin
        let view = NSTextView(frame: NSRect(x: 0, y: 0, width: width, height: 100))
        view.textStorage?.setAttributedString(s)
        view.backgroundColor = .white
        view.drawsBackground = true
        if let lm = view.layoutManager, let tc = view.textContainer {
            lm.ensureLayout(for: tc)
            view.frame.size.height = max(100, lm.usedRect(for: tc).height + 20)
        }
        let op = NSPrintOperation(view: view, printInfo: info)
        op.showsPrintPanel = false
        op.showsProgressPanel = false
        guard op.run(), FileManager.default.fileExists(atPath: out.path) else { throw ConvertError.failed("Couldn't make the PDF.") }
    }

    // MARK: Presentations

    private static func presentation(_ url: URL, from: String, to: String, t: ConvertTools, step: (String) -> Void) async throws -> URL {
        let keynoteFormats = ["pdf": "PDF", "pptx": "Microsoft PowerPoint", "png": "PNG", "jpg": "JPEG", "key": "save"]
        let pictures = to == "png" || to == "jpg"
        if t.keynote, let f = keynoteFormats[to], from != "odp" {
            step("Opening in Keynote…")
            let out = pictures ? target(url, ext: "", suffix: " slides") : target(url, ext: to)
            try await iWork("Keynote", url, out, as: f)
            return out
        }
        if to == "key" { throw ConvertError.needs(.keynote) }
        guard t.libreOffice != nil else { throw ConvertError.needs(from == "key" ? .keynote : .office) }
        step("Opening in LibreOffice…")
        if pictures {
            // LibreOffice only draws the first slide as a picture: make a PDF, then picture every page of it.
            let pdf = temp(url, ext: "pdf")
            defer { try? FileManager.default.removeItem(at: pdf) }
            _ = try await libreOffice(url, from: from, to: "pdf", t: t, output: pdf)
            step("Rendering slides…")
            let out = target(url, ext: "", suffix: " slides")
            try await pdfPages(pdf, out, jpeg: to == "jpg")
            return out
        }
        return try await libreOffice(url, from: from, to: to, t: t)
    }

    // MARK: Tables

    private static let tableFormats: Set<String> = ["csv", "tsv", "json", "xlsx"]

    private static func spreadsheet(_ url: URL, from: String, to: String, t: ConvertTools, step: (String) -> Void) async throws -> URL {
        if tableFormats.contains(from), ["csv", "tsv", "json", "xlsx", "html"].contains(to) {
            step("Converting…")
            let out = target(url, ext: to)
            try await ConvertTable.write(try await ConvertTable.read(url, from: from), to: to, out, title: url.deletingPathExtension().lastPathComponent)
            return out
        }
        let numbersFormats = ["pdf": "PDF", "xlsx": "Microsoft Excel", "csv": "CSV", "numbers": "save"]
        if t.numbers, let f = numbersFormats[to], from != "json", from != "tsv" {
            step("Opening in Numbers…")
            let out = target(url, ext: to)
            try await iWork("Numbers", url, out, as: f)
            return out
        }
        if to == "numbers" { throw ConvertError.needs(.numbers) }
        if !tableFormats.contains(from) || to == "pdf" || to == "xls" || to == "ods" {
            // Numbers, xls and ods files: through Numbers or LibreOffice as CSV, then on from here.
            if ["json", "tsv", "html"].contains(to) {
                let csv = temp(url, ext: "csv")
                defer { try? FileManager.default.removeItem(at: csv) }
                if t.numbers, from != "ods" { step("Opening in Numbers…"); try await iWork("Numbers", url, csv, as: "CSV") }
                else if t.libreOffice != nil { step("Opening in LibreOffice…"); _ = try await libreOffice(url, from: from, to: "csv", t: t, output: csv) }
                else { throw ConvertError.needs(from == "numbers" ? .numbers : .office) }
                let out = target(url, ext: to)
                try await ConvertTable.write(try await ConvertTable.read(csv, from: "csv"), to: to, out, title: url.deletingPathExtension().lastPathComponent)
                return out
            }
            if t.libreOffice != nil, from != "numbers" {
                step("Opening in LibreOffice…")
                return try await libreOffice(url, from: from, to: to, t: t)
            }
            if to == "pdf", tableFormats.contains(from) {
                step("Converting…")
                let rows = try await ConvertTable.read(url, from: from)
                let out = target(url, ext: "pdf")
                try printPDF(ConvertTable.attributed(rows), out)
                return out
            }
            throw ConvertError.needs(from == "numbers" ? .numbers : .office)
        }
        throw ConvertError.failed("Can't turn \(from.uppercased()) into \(to.uppercased()).")
    }

    // MARK: Audio and video

    private static let coreAudioReads: Set<String> = ["mp3", "m4a", "aac", "wav", "aiff", "caf", "flac"]
    private static let afconvertFormats: [String: [String]] = [
        "m4a": ["-f", "m4af", "-d", "aac", "-b", "256000"],
        "wav": ["-f", "WAVE", "-d", "LEI16"],
        "aiff": ["-f", "AIFF", "-d", "BEI16"],
        "caf": ["-f", "caff", "-d", "aac", "-b", "256000"],
        "flac": ["-f", "flac", "-d", "flac"],
    ]
    private static let avReads: Set<String> = ["mp4", "mov", "m4v"]

    private static func media(_ url: URL, from: String, to: String, kind: ConvertKind, t: ConvertTools, step: (String) -> Void) async throws -> URL {
        let out = target(url, ext: to)
        // macOS's own tools first.
        if kind == .audio, coreAudioReads.contains(from), let args = afconvertFormats[to] {
            step("Converting…")
            try await run("/usr/bin/afconvert", args + [url.path, out.path])
            return out
        }
        if kind == .video, avReads.contains(from) {
            switch to {
            case "mp4", "mov", "m4v":
                step("Converting the video…")
                try await export(url, out, preset: AVAssetExportPresetHighestQuality, type: to == "mov" ? .mov : to == "m4v" ? .m4v : .mp4)
                return out
            case "m4a":
                step("Taking out the sound…")
                try await export(url, out, preset: AVAssetExportPresetAppleM4A, type: .m4a)
                return out
            case "wav" where t.ffmpeg == nil:
                step("Taking out the sound…")
                let m4a = temp(url, ext: "m4a")
                defer { try? FileManager.default.removeItem(at: m4a) }
                try await export(url, m4a, preset: AVAssetExportPresetAppleM4A, type: .m4a)
                try await run("/usr/bin/afconvert", afconvertFormats["wav"]! + [m4a.path, out.path])
                return out
            case "gif" where t.ffmpeg == nil:
                step("Making the GIF…")
                try await gif(url, out)
                return out
            default: break
            }
        }
        guard let ffmpeg = t.ffmpeg else { throw ConvertError.needs(.ffmpeg) }
        step(kind == .video ? "Converting the video (this can take a while)…" : "Converting…")
        try await run(ffmpeg, ["-hide_banner", "-nostdin", "-loglevel", "error", "-y", "-i", url.path] + ffmpegArgs(to) + [out.path])
        return out
    }

    /// FFmpeg settings for each target: plain, widely playable choices (the same as the Windows app's).
    static func ffmpegArgs(_ to: String) -> [String] {
        switch to {
        case "mp3": ["-vn", "-c:a", "libmp3lame", "-q:a", "2"]
        case "m4a", "aac": ["-vn", "-c:a", "aac", "-b:a", "192k"]
        case "wav": ["-vn", "-c:a", "pcm_s16le"]
        case "aiff": ["-vn", "-c:a", "pcm_s16be"]
        case "caf": ["-vn", "-c:a", "aac", "-b:a", "192k"]
        case "flac": ["-vn", "-c:a", "flac"]
        case "ogg": ["-vn", "-c:a", "libvorbis", "-q:a", "5"]
        case "opus": ["-vn", "-c:a", "libopus", "-b:a", "128k"]
        case "mp4", "m4v", "mov": ["-c:v", "libx264", "-preset", "veryfast", "-crf", "23", "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", "160k", "-movflags", "+faststart"]
        case "mkv": ["-c:v", "libx264", "-preset", "veryfast", "-crf", "23", "-c:a", "aac", "-b:a", "160k"]
        case "webm": ["-c:v", "libvpx-vp9", "-b:v", "0", "-crf", "33", "-row-mt", "1", "-c:a", "libopus", "-b:a", "128k"]
        case "avi": ["-c:v", "mpeg4", "-q:v", "3", "-c:a", "libmp3lame", "-q:a", "3"]
        case "gif": ["-vf", "fps=12,scale='min(480,iw)':-2:flags=lanczos,split[a][b];[a]palettegen[p];[b][p]paletteuse", "-loop", "0"]
        default: []
        }
    }

    private static func export(_ url: URL, _ out: URL, preset: String, type: AVFileType) async throws {
        let asset = AVURLAsset(url: url)
        guard let session = AVAssetExportSession(asset: asset, presetName: preset) else {
            throw ConvertError.failed("macOS can't convert this video.")
        }
        session.outputURL = out
        session.outputFileType = type
        session.shouldOptimizeForNetworkUse = true
        await session.export()
        if session.status != .completed {
            throw ConvertError.failed(session.error?.localizedDescription ?? "The video couldn't be converted.")
        }
    }

    /// A GIF of the video: 12 frames a second, up to 480 pixels wide, up to 60 seconds.
    private static func gif(_ url: URL, _ out: URL) async throws {
        let asset = AVURLAsset(url: url)
        let seconds = min(60, CMTimeGetSeconds(try await asset.load(.duration)))
        guard seconds > 0 else { throw ConvertError.failed("That video has no frames.") }
        let gen = AVAssetImageGenerator(asset: asset)
        gen.appliesPreferredTrackTransform = true
        gen.maximumSize = CGSize(width: 480, height: 480)
        gen.requestedTimeToleranceBefore = CMTime(value: 1, timescale: 24)
        gen.requestedTimeToleranceAfter = CMTime(value: 1, timescale: 24)
        let fps = 12.0
        let count = max(1, Int(seconds * fps))
        guard let dest = CGImageDestinationCreateWithURL(out as CFURL, UTType.gif.identifier as CFString, count, nil) else {
            throw ConvertError.failed("Couldn't make the GIF.")
        }
        CGImageDestinationSetProperties(dest, [kCGImagePropertyGIFDictionary: [kCGImagePropertyGIFLoopCount: 0]] as CFDictionary)
        let frame = [kCGImagePropertyGIFDictionary: [kCGImagePropertyGIFDelayTime: 1 / fps]] as CFDictionary
        for i in 0..<count {
            let time = CMTime(seconds: Double(i) / fps, preferredTimescale: 600)
            if let img = try? await gen.image(at: time).image { CGImageDestinationAddImage(dest, img, frame) }
        }
        guard CGImageDestinationFinalize(dest) else { throw ConvertError.failed("Couldn't make the GIF.") }
    }
}
