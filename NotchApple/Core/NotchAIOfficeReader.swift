//
//  NotchAIOfficeReader.swift
//  Notch Apple
//
//  Reads the text of Word (.docx), Excel (.xlsx) and PowerPoint (.pptx) files, read-only, with no outside code. These
//  files are zip archives of XML, so this has a small zip reader (stored and deflated entries, with size limits against
//  zip bombs) and an XML text collector. Pure Foundation + Compression: unit tested against real files made by Word-
//  compatible tools.
//
//  The text comes back with "[page N]" markers (a slide, or a worksheet, counts as a page) so the document index can
//  cite where an answer came from. Not read: macros, comments, tracked-change history, images, charts, formulas'
//  formulas (only their last calculated value), password-protected files. Dates in a spreadsheet appear as the
//  number Excel stores, because the cell format is not applied.
//

import Compression
import Foundation

enum OfficeReadError: LocalizedError, Equatable {
    case notAZip, encrypted, unsupportedZip, tooLarge, corrupt, missing(String), empty
    var errorDescription: String? {
        switch self {
        case .notAZip: "not an Office file (it is not a zip archive)"
        case .encrypted: "the file is password protected"
        case .unsupportedZip: "this archive uses a zip feature that is not supported"
        case .tooLarge: "the file expands to too much data to read safely"
        case .corrupt: "the file is damaged"
        case .missing(let part): "the file has no \(part)"
        case .empty: "no text found in the file"
        }
    }
}

// MARK: - Zip

struct ZipArchive {
    struct Entry { let name: String; let method: Int; let compressedSize: Int; let size: Int; let localOffset: Int }

    static let maxEntries = 5_000
    /// One part may expand to at most this much; the whole read is capped too.
    static let maxEntryBytes = 40 * 1024 * 1024

    let data: Data
    let entries: [String: Entry]

    init(_ data: Data) throws {
        self.data = data
        let bytes = [UInt8](data)
        guard bytes.count >= 22, bytes[0] == 0x50, bytes[1] == 0x4B else { throw OfficeReadError.notAZip }
        func u16(_ o: Int) -> Int { Int(bytes[o]) | Int(bytes[o + 1]) << 8 }
        func u32(_ o: Int) -> Int { u16(o) | u16(o + 2) << 16 }
        // End of central directory: the last 0x06054b50 within the final 64 KB.
        var eocd = -1
        var i = bytes.count - 22
        let stop = max(0, bytes.count - 22 - 65_535)
        while i >= stop {
            if bytes[i] == 0x50, bytes[i + 1] == 0x4B, bytes[i + 2] == 5, bytes[i + 3] == 6 { eocd = i; break }
            i -= 1
        }
        guard eocd >= 0 else { throw OfficeReadError.notAZip }
        let count = u16(eocd + 10), cdSize = u32(eocd + 12), cdOffset = u32(eocd + 16)
        if count == 0xFFFF || cdSize == 0xFFFF_FFFF || cdOffset == 0xFFFF_FFFF { throw OfficeReadError.unsupportedZip }   // zip64
        guard count <= Self.maxEntries, cdOffset >= 0, cdOffset + cdSize <= bytes.count else { throw count > Self.maxEntries ? OfficeReadError.tooLarge : OfficeReadError.corrupt }
        var found: [String: Entry] = [:]
        var p = cdOffset
        for _ in 0..<count {
            guard p + 46 <= bytes.count, u32(p) == 0x0201_4B50 else { throw OfficeReadError.corrupt }
            let flags = u16(p + 8), method = u16(p + 10), csize = u32(p + 20), usize = u32(p + 24)
            let nameLen = u16(p + 28), extraLen = u16(p + 30), commentLen = u16(p + 32), local = u32(p + 42)
            guard p + 46 + nameLen <= bytes.count else { throw OfficeReadError.corrupt }
            if flags & 1 != 0 { throw OfficeReadError.encrypted }
            if csize == 0xFFFF_FFFF || usize == 0xFFFF_FFFF || local == 0xFFFF_FFFF { throw OfficeReadError.unsupportedZip }
            let name = String(decoding: bytes[(p + 46)..<(p + 46 + nameLen)], as: UTF8.self)
            found[name] = Entry(name: name, method: method, compressedSize: csize, size: usize, localOffset: local)
            p += 46 + nameLen + extraLen + commentLen
        }
        entries = found
    }

    func has(_ name: String) -> Bool { entries[name] != nil }

    func read(_ name: String) throws -> Data {
        guard let e = entries[name] else { throw OfficeReadError.missing(name) }
        guard e.size <= Self.maxEntryBytes else { throw OfficeReadError.tooLarge }
        let bytes = data
        let o = data.startIndex + e.localOffset
        guard e.localOffset >= 0, o + 30 <= bytes.endIndex, bytes[o] == 0x50, bytes[o + 1] == 0x4B, bytes[o + 2] == 3, bytes[o + 3] == 4 else { throw OfficeReadError.corrupt }
        let nameLen = Int(bytes[o + 26]) | Int(bytes[o + 27]) << 8, extraLen = Int(bytes[o + 28]) | Int(bytes[o + 29]) << 8
        let start = o + 30 + nameLen + extraLen
        guard start + e.compressedSize <= bytes.endIndex else { throw OfficeReadError.corrupt }
        let payload = bytes[start..<(start + e.compressedSize)]
        switch e.method {
        case 0:
            guard e.compressedSize == e.size else { throw OfficeReadError.corrupt }
            return Data(payload)
        case 8:
            if e.size == 0 { return Data() }
            var out = [UInt8](repeating: 0, count: e.size)
            let written = payload.withUnsafeBytes { src -> Int in
                out.withUnsafeMutableBytes { dst -> Int in
                    compression_decode_buffer(dst.bindMemory(to: UInt8.self).baseAddress!, e.size, src.bindMemory(to: UInt8.self).baseAddress!, e.compressedSize, nil, COMPRESSION_ZLIB)
                }
            }
            guard written == e.size else { throw OfficeReadError.corrupt }
            return Data(out)
        default:
            throw OfficeReadError.unsupportedZip
        }
    }
}

// MARK: - XML

/// Collects text from OOXML. Matches element names by their local part (`w:t`, `a:t` and `t` are all "t").
final class OfficeTextCollector: NSObject, XMLParserDelegate {
    /// Elements whose text is content.
    private let textElements: Set<String>
    /// Elements after which a line break is added.
    private let lineBreakAfter: Set<String>
    /// Elements that contribute a tab (a table cell ends, a tab character).
    private let tabAfter: Set<String>
    /// Subtrees to ignore completely.
    private let skip: Set<String>
    /// A table cell: a paragraph break inside one is a space, so a row stays on one line.
    private let cell: String?
    private var cellDepth = 0
    private(set) var text = ""
    private var inText = 0
    private var skipDepth = 0
    private var skipName = ""

    init(textElements: Set<String>, lineBreakAfter: Set<String>, tabAfter: Set<String> = [], skip: Set<String> = [], cell: String? = nil) {
        self.textElements = textElements; self.lineBreakAfter = lineBreakAfter; self.tabAfter = tabAfter; self.skip = skip; self.cell = cell
    }

    static func local(_ name: String) -> String { name.split(separator: ":").last.map(String.init) ?? name }

    func parser(_ parser: XMLParser, didStartElement elementName: String, namespaceURI: String?, qualifiedName qName: String?, attributes attributeDict: [String: String] = [:]) {
        let n = Self.local(elementName)
        if skipDepth > 0 { skipDepth += 1; return }
        if skip.contains(n) { skipDepth = 1; skipName = n; return }
        if textElements.contains(n) { inText += 1 }
        if n == cell { cellDepth += 1 }
        if n == "br" || n == "cr" { text += "\n" }
        if n == "tab" { text += "\t" }
    }

    func parser(_ parser: XMLParser, foundCharacters string: String) {
        if skipDepth == 0, inText > 0 { text += string }
    }

    func parser(_ parser: XMLParser, didEndElement elementName: String, namespaceURI: String?, qualifiedName qName: String?) {
        let n = Self.local(elementName)
        if skipDepth > 0 { skipDepth -= 1; return }
        if textElements.contains(n) { inText = max(0, inText - 1) }
        if n == cell { cellDepth = max(0, cellDepth - 1) }
        if lineBreakAfter.contains(n) {
            if n == "p", cellDepth > 0 { if !text.hasSuffix(" ") && !text.hasSuffix("\t") && !text.isEmpty { text += " " } }
            else if !text.hasSuffix("\n") { text += "\n" }
        }
        if tabAfter.contains(n) {
            while text.hasSuffix(" ") { text.removeLast() }       // a cell's paragraph break left a space before the tab
            text += "\t"
        }
    }

    static func extract(_ data: Data, textElements: Set<String>, lineBreakAfter: Set<String>, tabAfter: Set<String> = [], skip: Set<String> = [], cell: String? = nil) -> String {
        let c = OfficeTextCollector(textElements: textElements, lineBreakAfter: lineBreakAfter, tabAfter: tabAfter, skip: skip, cell: cell)
        let p = XMLParser(data: data)
        p.shouldResolveExternalEntities = false
        p.delegate = c
        p.parse()
        return c.text
    }
}

/// Reads attributes and chosen text out of simple XML lists (workbook sheets, relationships, shared strings).
final class OfficeXMLScanner: NSObject, XMLParserDelegate {
    var onStart: ((String, [String: String]) -> Void)?
    var onEnd: ((String) -> Void)?
    var onText: ((String) -> Void)?

    func parser(_ parser: XMLParser, didStartElement elementName: String, namespaceURI: String?, qualifiedName qName: String?, attributes attributeDict: [String: String] = [:]) {
        var attrs: [String: String] = [:]
        for (k, v) in attributeDict { attrs[OfficeTextCollector.local(k)] = v }
        onStart?(OfficeTextCollector.local(elementName), attrs)
    }
    func parser(_ parser: XMLParser, foundCharacters string: String) { onText?(string) }
    func parser(_ parser: XMLParser, didEndElement elementName: String, namespaceURI: String?, qualifiedName qName: String?) { onEnd?(OfficeTextCollector.local(elementName)) }

    static func scan(_ data: Data, _ configure: (OfficeXMLScanner) -> Void) {
        let s = OfficeXMLScanner(); configure(s)
        let p = XMLParser(data: data); p.shouldResolveExternalEntities = false; p.delegate = s; p.parse()
    }
}

// MARK: - Reader

enum OfficeReader {
    enum Kind: String { case docx, xlsx, pptx }

    static func kind(forExtension ext: String) -> Kind? { Kind(rawValue: ext.lowercased()) }

    static let maxSheetRows = 1_000
    static let maxSheetColumns = 40
    static let maxSlides = 200

    /// The document's text with "[page N]" markers (slides and worksheets count as pages; a Word file has none).
    static func text(from data: Data, kind: Kind) throws -> String {
        let zip = try ZipArchive(data)
        let out: String
        switch kind {
        case .docx: out = try docx(zip)
        case .xlsx: out = try xlsx(zip)
        case .pptx: out = try pptx(zip)
        }
        if out.replacingOccurrences(of: #"\[page \d+\]"#, with: "", options: .regularExpression).trimmingCharacters(in: .whitespacesAndNewlines).isEmpty { throw OfficeReadError.empty }
        return out
    }

    // MARK: Word

    static func docx(_ zip: ZipArchive) throws -> String {
        guard zip.has("word/document.xml") else { throw OfficeReadError.missing("word/document.xml") }
        var parts = [try zip.read("word/document.xml")]
        // Footnotes and endnotes are part of the content a reader would expect to be searchable.
        for extra in ["word/footnotes.xml", "word/endnotes.xml"] where zip.has(extra) { if let d = try? zip.read(extra) { parts.append(d) } }
        let text = parts.enumerated().map { i, d in
            let t = OfficeTextCollector.extract(d, textElements: ["t"], lineBreakAfter: ["p", "tr"], tabAfter: ["tc"], cell: "tc").replacingOccurrences(of: "\t\n", with: "\n")
            let trimmed = t.trimmingCharacters(in: .whitespacesAndNewlines)
            return i == 0 ? trimmed : (trimmed.isEmpty ? "" : "\nNotes:\n" + trimmed)
        }.joined()
        return tidy(text)
    }

    // MARK: PowerPoint

    static func pptx(_ zip: ZipArchive) throws -> String {
        let slides = zip.entries.keys.compactMap { name -> (Int, String)? in
            guard name.hasPrefix("ppt/slides/slide"), name.hasSuffix(".xml"),
                  let n = Int(name.dropFirst("ppt/slides/slide".count).dropLast(4)) else { return nil }
            return (n, name)
        }.sorted { $0.0 < $1.0 }
        guard !slides.isEmpty else { throw OfficeReadError.missing("slides") }
        var out: [String] = []
        for (idx, slide) in slides.prefix(maxSlides).enumerated() {
            var t = tidy(OfficeTextCollector.extract(try zip.read(slide.1), textElements: ["t"], lineBreakAfter: ["p"], cell: "tc"))
            let notesName = "ppt/notesSlides/notesSlide\(slide.0).xml"
            if zip.has(notesName), let nd = try? zip.read(notesName) {
                let notes = tidy(OfficeTextCollector.extract(nd, textElements: ["t"], lineBreakAfter: ["p"]))
                if !notes.isEmpty { t += "\nSpeaker notes: " + notes.replacingOccurrences(of: "\n", with: " ") }
            }
            out.append("[page \(idx + 1)]\n" + tidy(t))
        }
        if slides.count > maxSlides { out.append("… (\(slides.count) slides in all; the first \(maxSlides) are shown)") }
        return out.joined(separator: "\n")
    }

    // MARK: Excel

    static func xlsx(_ zip: ZipArchive) throws -> String {
        guard zip.has("xl/workbook.xml") else { throw OfficeReadError.missing("xl/workbook.xml") }
        // Shared strings: one <si> per entry, its <t> pieces joined, phonetic hints ignored.
        var shared: [String] = []
        if zip.has("xl/sharedStrings.xml"), let d = try? zip.read("xl/sharedStrings.xml") {
            var cur = "", inSI = false, inT = 0, skip = 0
            OfficeXMLScanner.scan(d) { s in
                s.onStart = { n, _ in
                    if skip > 0 { skip += 1; return }
                    if n == "rPh" { skip = 1; return }
                    if n == "si" { inSI = true; cur = "" }
                    if n == "t", inSI { inT += 1 }
                }
                s.onText = { t in if inT > 0, skip == 0 { cur += t } }
                s.onEnd = { n in
                    if skip > 0 { skip -= 1; return }
                    if n == "t" { inT = max(0, inT - 1) }
                    if n == "si" { shared.append(cur); inSI = false }
                }
            }
        }
        // Sheets in workbook order, with their names, resolved through the relationships file.
        var sheets: [(name: String, rid: String)] = []
        OfficeXMLScanner.scan(try zip.read("xl/workbook.xml")) { s in
            s.onStart = { n, a in if n == "sheet", let name = a["name"] { sheets.append((name, a["id"] ?? "")) } }
        }
        var targets: [String: String] = [:]
        if zip.has("xl/_rels/workbook.xml.rels"), let d = try? zip.read("xl/_rels/workbook.xml.rels") {
            OfficeXMLScanner.scan(d) { s in
                s.onStart = { n, a in if n == "Relationship", let id = a["Id"], let t = a["Target"] { targets[id] = t } }
            }
        }
        var out: [String] = []
        for (i, sheet) in sheets.enumerated() {
            let part: String = {
                if let t = targets[sheet.rid] { return t.hasPrefix("/") ? String(t.dropFirst()) : "xl/" + t }
                return "xl/worksheets/sheet\(i + 1).xml"
            }()
            guard zip.has(part), let d = try? zip.read(part) else { continue }
            out.append("[page \(out.count + 1)]\nSheet: \(sheet.name)\n" + sheetText(d, shared: shared))
        }
        guard !out.isEmpty else { throw OfficeReadError.missing("worksheets") }
        return out.joined(separator: "\n")
    }

    /// "AB12" → zero-based column 27.
    static func columnIndex(_ ref: String) -> Int {
        var n = 0
        for u in ref.uppercased().unicodeScalars {
            guard u.value >= 65, u.value <= 90 else { break }
            n = n * 26 + Int(u.value - 64)
        }
        return max(0, n - 1)
    }

    static func sheetText(_ data: Data, shared: [String]) -> String {
        var rows: [[Int: String]] = []
        var cur: [Int: String] = [:]
        var col = 0, type = "", inV = false, inIS = false, value = "", rowCount = 0, truncatedRows = false
        OfficeXMLScanner.scan(data) { s in
            s.onStart = { n, a in
                switch n {
                case "row": cur = [:]
                case "c": col = columnIndex(a["r"] ?? ""); type = a["t"] ?? ""; value = ""
                case "v": inV = true
                case "is": inIS = true
                default: break
                }
            }
            s.onText = { t in if inV || inIS { value += t } }
            s.onEnd = { n in
                switch n {
                case "v": inV = false
                case "is": inIS = false
                case "c":
                    var shown = value
                    switch type {
                    case "s": shown = Int(value.trimmingCharacters(in: .whitespaces)).flatMap { $0 >= 0 && $0 < shared.count ? shared[$0] : nil } ?? ""
                    case "b": shown = value == "1" ? "TRUE" : "FALSE"
                    default: break
                    }
                    if !shown.isEmpty, col < maxSheetColumns { cur[col] = shown.replacingOccurrences(of: "\t", with: " ").replacingOccurrences(of: "\n", with: " ") }
                case "row":
                    if !cur.isEmpty {
                        rowCount += 1
                        if rows.count < maxSheetRows { rows.append(cur) } else { truncatedRows = true }
                    }
                default: break
                }
            }
        }
        var lines = rows.map { row -> String in
            let width = (row.keys.max() ?? 0) + 1
            return (0..<width).map { row[$0] ?? "" }.joined(separator: "\t")
        }
        if truncatedRows { lines.append("… (\(rowCount) rows in all; the first \(maxSheetRows) are shown)") }
        return lines.joined(separator: "\n")
    }

    // MARK: Shared

    /// Trims trailing spaces on each line and collapses runs of blank lines.
    static func tidy(_ s: String) -> String {
        let lines = s.components(separatedBy: "\n").map { $0.replacingOccurrences(of: "[ \\t]+$", with: "", options: .regularExpression) }
        var out: [String] = []
        for l in lines { if l.isEmpty, out.last?.isEmpty ?? true { continue }; out.append(l) }
        return out.joined(separator: "\n").trimmingCharacters(in: .whitespacesAndNewlines)
    }
}
