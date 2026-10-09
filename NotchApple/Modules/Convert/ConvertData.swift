//
//  ConvertData.swift
//  Notch apple
//
//  Convert's tables (CSV, TSV, JSON and Excel, read and written here, no Excel needed) and text (Markdown to a web
//  page and back from formatted text). Excel files are zips of XML: unzip reads them, ditto writes them.
//

import AppKit

@MainActor
enum ConvertTable {
    static func read(_ url: URL, from: String) async throws -> [[String]] {
        switch from {
        case "csv", "tsv":
            let data = try Data(contentsOf: url)
            let text = String(data: data, encoding: .utf8) ?? String(decoding: data, as: UTF8.self)
            let sep: Character = from == "tsv" ? "\t" : sniff(text)
            return parseDelimited(text, sep)
        case "json":
            let any = try JSONSerialization.jsonObject(with: Data(contentsOf: url), options: [.fragmentsAllowed])
            return jsonRows(any)
        case "xlsx":
            return try await xlsxRows(url)
        default:
            throw ConvertError.failed("Can't read \(from.uppercased()) here.")
        }
    }

    private static func sniff(_ s: String) -> Character {
        let head = s.prefix { !$0.isNewline }
        return head.filter { $0 == ";" }.count > head.filter { $0 == "," }.count ? ";" : ","
    }

    static func parseDelimited(_ s: String, _ sep: Character) -> [[String]] {
        var rows: [[String]] = [], row: [String] = [], field = "", quoted = false
        var chars = Array(s)
        if chars.first == "\u{FEFF}" { chars.removeFirst() }
        var i = 0
        while i < chars.count {
            let c = chars[i]
            if quoted {
                if c == "\"" && i + 1 < chars.count && chars[i + 1] == "\"" { field.append("\""); i += 1 }
                else if c == "\"" { quoted = false }
                else { field.append(c) }
            } else if c == "\"" && field.isEmpty {
                quoted = true
            } else if c == sep {
                row.append(field); field = ""
            } else if c.isNewline {   // "\r\n" is one Character in Swift
                row.append(field); rows.append(row); row = []; field = ""
            } else {
                field.append(c)
            }
            i += 1
        }
        if !field.isEmpty || !row.isEmpty { row.append(field); rows.append(row) }
        return rows
    }

    static func jsonRows(_ v: Any) -> [[String]] {
        if let list = v as? [Any] {
            if list.allSatisfy({ $0 is [Any] }) { return list.map { ($0 as? [Any] ?? []).map(cell) } }
            var keys: [String] = []
            for item in list {
                for k in ((item as? [String: Any])?.keys.sorted() ?? ["value"]) where !keys.contains(k) { keys.append(k) }
            }
            return [keys] + list.map { item in
                if let obj = item as? [String: Any] { return keys.map { cell(obj[$0] ?? "") } }
                return [cell(item)]
            }
        }
        if let obj = v as? [String: Any] { return [["key", "value"]] + obj.keys.sorted().map { [$0, cell(obj[$0]!)] } }
        return [[cell(v)]]
    }

    private static func cell(_ x: Any) -> String {
        switch x {
        case is NSNull: return ""
        case let s as String: return s
        case let n as NSNumber:
            if CFGetTypeID(n) == CFBooleanGetTypeID() { return n.boolValue ? "TRUE" : "FALSE" }
            return n.stringValue
        default:
            if let data = try? JSONSerialization.data(withJSONObject: x, options: [.fragmentsAllowed]) { return String(decoding: data, as: UTF8.self) }
            return "\(x)"
        }
    }

    // MARK: Excel

    private static func unzipped(_ url: URL, _ member: String) async -> XMLDocument? {
        guard let text = try? await ConvertEngine.run("/usr/bin/unzip", ["-p", url.path, member]), !text.isEmpty else { return nil }
        return try? XMLDocument(data: Data(text.utf8), options: [])
    }

    private static func nodes(_ node: XMLNode?, _ name: String, deep: Bool = true) -> [XMLElement] {
        ((try? node?.nodes(forXPath: "\(deep ? ".//" : "")*[local-name()='\(name)']")) ?? []).compactMap { $0 as? XMLElement }
    }

    private static func xlsxRows(_ url: URL) async throws -> [[String]] {
        let strings = nodes(await unzipped(url, "xl/sharedStrings.xml"), "si").map { si in nodes(si, "t").map { $0.stringValue ?? "" }.joined() }
        // The first sheet, through the workbook's own list.
        var sheet = "xl/worksheets/sheet1.xml"
        if let first = nodes(await unzipped(url, "xl/workbook.xml"), "sheet").first,
           let rid = first.attribute(forName: "r:id")?.stringValue,
           let rel = nodes(await unzipped(url, "xl/_rels/workbook.xml.rels"), "Relationship").first(where: { $0.attribute(forName: "Id")?.stringValue == rid }),
           let t = rel.attribute(forName: "Target")?.stringValue {
            sheet = t.hasPrefix("/") ? String(t.dropFirst()) : "xl/" + t
        }
        guard let doc = await unzipped(url, sheet) else { throw ConvertError.failed("That workbook's first sheet couldn't be read.") }
        var grid: [Int: [Int: String]] = [:]
        var width = 0, height = 0
        for (ri, row) in nodes(doc, "row").enumerated() {
            let y = (Int(row.attribute(forName: "r")?.stringValue ?? "") ?? ri + 1) - 1
            var auto = 0
            for c in nodes(row, "c", deep: false) {
                let ref = c.attribute(forName: "r")?.stringValue ?? ""
                let letters = ref.prefix { $0.isLetter }
                let x = letters.isEmpty ? auto : colIndex(String(letters))
                auto = x + 1
                let type = c.attribute(forName: "t")?.stringValue
                let v = nodes(c, "v", deep: false).first?.stringValue ?? ""
                let value: String
                switch type {
                case "s": value = Int(v).flatMap { $0 < strings.count ? strings[$0] : nil } ?? ""
                case "inlineStr": value = nodes(c, "t").map { $0.stringValue ?? "" }.joined()
                case "b": value = v == "1" ? "TRUE" : "FALSE"
                default: value = v
                }
                grid[y, default: [:]][x] = value
                width = max(width, x + 1)
                height = max(height, y + 1)
            }
        }
        return (0..<height).map { y in (0..<width).map { grid[y]?[$0] ?? "" } }
    }

    private static func colIndex(_ letters: String) -> Int {
        letters.uppercased().unicodeScalars.reduce(0) { $0 * 26 + Int($1.value) - 64 } - 1
    }

    private static func colName(_ index: Int) -> String {
        var i = index + 1, s = ""
        while i > 0 { s = String(Character(UnicodeScalar(UInt8(65 + (i - 1) % 26)))) + s; i = (i - 1) / 26 }
        return s
    }

    private static func isNumber(_ c: String) -> Bool {
        guard !c.isEmpty, c.count < 16, Double(c) != nil, !(c.hasPrefix("0") && c.count > 1 && !c.hasPrefix("0.")) else { return false }
        return c.allSatisfy { "0123456789.-+eE".contains($0) }
    }

    // MARK: Writing

    static func write(_ rows: [[String]], to: String, _ out: URL, title: String) async throws {
        switch to {
        case "csv":
            let q: (String) -> String = { c in c.contains(where: { ",\"\n\r".contains($0) }) ? "\"" + c.replacingOccurrences(of: "\"", with: "\"\"") + "\"" : c }
            try (rows.map { $0.map(q).joined(separator: ",") }.joined(separator: "\r\n") + "\r\n").write(to: out, atomically: true, encoding: .utf8)
        case "tsv":
            let clean: (String) -> String = { $0.replacingOccurrences(of: "\t", with: " ").replacingOccurrences(of: "\n", with: " ").replacingOccurrences(of: "\r", with: " ") }
            try (rows.map { $0.map(clean).joined(separator: "\t") }.joined(separator: "\r\n") + "\r\n").write(to: out, atomically: true, encoding: .utf8)
        case "json":
            try json(rows).write(to: out, atomically: true, encoding: .utf8)
        case "html":
            let head = rows.first ?? []
            let body = rows.dropFirst().map { "<tr>" + $0.map { "<td>\(ConvertText.escape($0))</td>" }.joined() + "</tr>" }.joined(separator: "\n")
            let html = """
            <!doctype html>
            <html><head><meta charset="utf-8"><title>\(ConvertText.escape(title))</title><style>body{font:14px system-ui,sans-serif;margin:2em}table{border-collapse:collapse}td,th{border:1px solid #ccc;padding:4px 8px;text-align:left}th{background:#f4f4f4}</style></head><body>
            <table>
            <tr>\(head.map { "<th>\(ConvertText.escape($0))</th>" }.joined())</tr>
            \(body)
            </table>
            </body></html>

            """
            try html.write(to: out, atomically: true, encoding: .utf8)
        case "xlsx":
            try await xlsx(rows, out)
        default:
            throw ConvertError.failed("Can't write \(to.uppercased()) here.")
        }
    }

    /// An array of objects when the first row is a header, otherwise an array of arrays. Numbers stay numbers.
    private static func json(_ rows: [[String]]) -> String {
        func str(_ s: String) -> String {
            var out = "\""
            for u in s.unicodeScalars {
                switch u {
                case "\"": out += "\\\""
                case "\\": out += "\\\\"
                case "\n": out += "\\n"
                case "\r": out += "\\r"
                case "\t": out += "\\t"
                default:
                    if u.value < 0x20 { out += String(format: "\\u%04x", u.value) } else { out.unicodeScalars.append(u) }
                }
            }
            return out + "\""
        }
        func val(_ c: String) -> String { c == "TRUE" ? "true" : c == "FALSE" ? "false" : isNumber(c) ? c : str(c) }
        let head = rows.first ?? []
        let keyed = rows.count > 1 && !head.isEmpty && head.allSatisfy { !$0.isEmpty } && Set(head).count == head.count
        if keyed {
            let objects = rows.dropFirst().map { r in
                "  {\n" + head.enumerated().map { i, k in "    \(str(k)): \(val(i < r.count ? r[i] : ""))" }.joined(separator: ",\n") + "\n  }"
            }
            return "[\n" + objects.joined(separator: ",\n") + "\n]\n"
        }
        return "[\n" + rows.map { "  [" + $0.map(val).joined(separator: ", ") + "]" }.joined(separator: ",\n") + "\n]\n"
    }

    private static func xlsx(_ rows: [[String]], _ out: URL) async throws {
        let fm = FileManager.default
        let dir = fm.temporaryDirectory.appendingPathComponent("notch-xlsx-\(UUID().uuidString)", isDirectory: true)
        defer { try? fm.removeItem(at: dir) }
        let sheet = rows.enumerated().map { y, r in
            "<row r=\"\(y + 1)\">" + r.enumerated().map { x, c -> String in
                if c.isEmpty { return "" }
                let ref = "\(colName(x))\(y + 1)"
                return isNumber(c) ? "<c r=\"\(ref)\"><v>\(c)</v></c>" : "<c r=\"\(ref)\" t=\"inlineStr\"><is><t xml:space=\"preserve\">\(ConvertText.escape(c))</t></is></c>"
            }.joined() + "</row>"
        }.joined()
        let head = "<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?>"
        let files: [String: String] = [
            "[Content_Types].xml": head + "<Types xmlns=\"http://schemas.openxmlformats.org/package/2006/content-types\"><Default Extension=\"rels\" ContentType=\"application/vnd.openxmlformats-package.relationships+xml\"/><Default Extension=\"xml\" ContentType=\"application/xml\"/><Override PartName=\"/xl/workbook.xml\" ContentType=\"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml\"/><Override PartName=\"/xl/worksheets/sheet1.xml\" ContentType=\"application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml\"/></Types>",
            "_rels/.rels": head + "<Relationships xmlns=\"http://schemas.openxmlformats.org/package/2006/relationships\"><Relationship Id=\"rId1\" Type=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument\" Target=\"xl/workbook.xml\"/></Relationships>",
            "xl/workbook.xml": head + "<workbook xmlns=\"http://schemas.openxmlformats.org/spreadsheetml/2006/main\" xmlns:r=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships\"><sheets><sheet name=\"Sheet1\" sheetId=\"1\" r:id=\"rId1\"/></sheets></workbook>",
            "xl/_rels/workbook.xml.rels": head + "<Relationships xmlns=\"http://schemas.openxmlformats.org/package/2006/relationships\"><Relationship Id=\"rId1\" Type=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet\" Target=\"worksheets/sheet1.xml\"/></Relationships>",
            "xl/worksheets/sheet1.xml": head + "<worksheet xmlns=\"http://schemas.openxmlformats.org/spreadsheetml/2006/main\"><sheetData>\(sheet)</sheetData></worksheet>",
        ]
        for (name, content) in files {
            let file = dir.appendingPathComponent(name)
            try fm.createDirectory(at: file.deletingLastPathComponent(), withIntermediateDirectories: true)
            try content.write(to: file, atomically: false, encoding: .utf8)
        }
        // No resource forks or extended attributes in the zip: Excel would call those "unreadable content".
        try await ConvertEngine.run("/usr/bin/ditto", ["-c", "-k", "--norsrc", "--noextattr", "--noqtn", "--noacl", dir.path, out.path])
    }

    /// The table as monospaced text, for a PDF.
    static func attributed(_ rows: [[String]]) -> NSAttributedString {
        var widths: [Int] = []
        for r in rows { for (i, c) in r.enumerated() { if i >= widths.count { widths.append(0) }; widths[i] = min(40, max(widths[i], c.count)) } }
        let lines = rows.map { r in r.enumerated().map { i, c in String(c.prefix(40)).padding(toLength: widths[i], withPad: " ", startingAt: 0) }.joined(separator: "  ") }
        return NSAttributedString(string: lines.joined(separator: "\n"), attributes: [.font: NSFont.monospacedSystemFont(ofSize: 8, weight: .regular), .foregroundColor: NSColor.black])
    }
}

@MainActor
enum ConvertText {
    static func escape(_ s: String) -> String {
        s.replacingOccurrences(of: "&", with: "&amp;").replacingOccurrences(of: "<", with: "&lt;")
            .replacingOccurrences(of: ">", with: "&gt;").replacingOccurrences(of: "\"", with: "&quot;")
    }

    private static func inline(_ s: String) -> String {
        var h = escape(s)
        let rules: [(String, String)] = [
            ("`([^`]+)`", "<code>$1</code>"),
            ("\\*\\*(.+?)\\*\\*", "<strong>$1</strong>"),
            ("__(.+?)__", "<strong>$1</strong>"),
            ("(?<![*\\w])\\*(?!\\s)(.+?)\\*", "<em>$1</em>"),
            ("(?<![_\\w])_(?!\\s)(.+?)_(?!\\w)", "<em>$1</em>"),
            ("\\[([^\\]]+)\\]\\(([^)\\s]+)\\)", "<a href=\"$2\">$1</a>"),
        ]
        for (pattern, template) in rules {
            guard let re = try? NSRegularExpression(pattern: pattern) else { continue }
            h = re.stringByReplacingMatches(in: h, range: NSRange(h.startIndex..., in: h), withTemplate: template)
        }
        return h
    }

    /// Markdown as a whole web page: headings, paragraphs, lists, quotes, code, bold, italics and links.
    static func html(markdown md: String, title: String) -> String {
        let lines = md.replacingOccurrences(of: "\r", with: "").components(separatedBy: "\n")
        var out: [String] = []
        var list: String? = nil
        var i = 0
        func closeList() { if let l = list { out.append("</\(l)>"); list = nil } }
        while i < lines.count {
            let line = lines[i]
            let trimmed = line.trimmingCharacters(in: .whitespaces)
            if trimmed.hasPrefix("```") {
                closeList()
                var code: [String] = []
                i += 1
                while i < lines.count, !lines[i].trimmingCharacters(in: .whitespaces).hasPrefix("```") { code.append(lines[i]); i += 1 }
                out.append("<pre><code>\(escape(code.joined(separator: "\n")))</code></pre>")
            } else if let m = line.range(of: "^#{1,6}\\s+", options: .regularExpression) {
                closeList()
                let level = line[m].filter { $0 == "#" }.count
                out.append("<h\(level)>\(inline(String(line[m.upperBound...])))</h\(level)>")
            } else if let m = line.range(of: "^\\s*([-*+]|\\d+[.)])\\s+", options: .regularExpression) {
                let ordered = line[m].contains { $0.isNumber }
                let tag = ordered ? "ol" : "ul"
                if list != tag { closeList(); out.append("<\(tag)>"); list = tag }
                out.append("<li>\(inline(String(line[m.upperBound...])))</li>")
            } else if trimmed.hasPrefix(">") {
                closeList()
                out.append("<blockquote>\(inline(String(trimmed.dropFirst()).trimmingCharacters(in: .whitespaces)))</blockquote>")
            } else if trimmed.range(of: "^(-{3,}|\\*{3,})$", options: .regularExpression) != nil {
                closeList()
                out.append("<hr>")
            } else if !trimmed.isEmpty {
                closeList()
                var para = [trimmed]
                while i + 1 < lines.count {
                    let next = lines[i + 1].trimmingCharacters(in: .whitespaces)
                    if next.isEmpty || next.hasPrefix("```") || next.hasPrefix("#") || next.hasPrefix(">")
                        || lines[i + 1].range(of: "^\\s*([-*+]|\\d+[.)])\\s+", options: .regularExpression) != nil { break }
                    para.append(next); i += 1
                }
                out.append("<p>\(inline(para.joined(separator: " ")))</p>")
            } else {
                closeList()
            }
            i += 1
        }
        closeList()
        return """
        <!doctype html>
        <html><head><meta charset="utf-8"><title>\(escape(title))</title>
        <style>body{font:16px/1.55 -apple-system,system-ui,sans-serif;max-width:46em;margin:2em auto;padding:0 1em;color:#111}pre{background:#f4f4f4;padding:1em;overflow:auto}code{font-family:Menlo,monospace}</style></head>
        <body>
        \(out.joined(separator: "\n"))
        </body></html>

        """
    }

    /// Formatted text back to Markdown: big bold lines become headings, bold and italics are kept, lists become "- ".
    static func markdown(from s: NSAttributedString) -> String {
        let ns = s.string as NSString
        var out: [String] = []
        ns.enumerateSubstrings(in: NSRange(location: 0, length: ns.length), options: .byParagraphs) { _, range, _, _ in
            var line = "", plain = ""
            var biggest: CGFloat = 0
            var allBold = true, any = false, listed = false
            s.enumerateAttributes(in: range) { attrs, r, _ in
                let text = ns.substring(with: r)
                plain += text
                let font = attrs[.font] as? NSFont
                let traits = font.map { NSFontManager.shared.traits(of: $0) } ?? []
                let bold = traits.contains(.boldFontMask), italic = traits.contains(.italicFontMask)
                if let p = attrs[.paragraphStyle] as? NSParagraphStyle, !p.textLists.isEmpty { listed = true }
                let core = text.trimmingCharacters(in: .whitespaces)
                guard !core.isEmpty else { line += text; return }
                any = true
                biggest = max(biggest, font?.pointSize ?? 12)
                if !bold { allBold = false }
                let mark = bold && italic ? "***" : bold ? "**" : italic ? "*" : ""
                let lead = String(text.prefix { $0 == " " }), trail = String(text.reversed().prefix { $0 == " " })
                line += lead + mark + core + mark + trail
            }
            guard any else { out.append(""); return }
            let bare = plain.trimmingCharacters(in: .whitespaces)
            if allBold && biggest >= 15 {
                out.append(String(repeating: "#", count: biggest >= 22 ? 1 : biggest >= 17 ? 2 : 3) + " " + bare)
            } else if listed || bare.hasPrefix("•") || bare.hasPrefix("◦") {
                let item = line.trimmingCharacters(in: .whitespaces).replacingOccurrences(of: "^[\\t •◦▪︎-]+", with: "", options: .regularExpression)
                out.append("- " + item)
            } else {
                out.append(line.trimmingCharacters(in: .whitespaces))
            }
        }
        // Blank lines between paragraphs, but list items together.
        var md = ""
        for (i, l) in out.enumerated() where !l.isEmpty {
            let prevList = i > 0 && out[i - 1].hasPrefix("- ")
            if !md.isEmpty { md += l.hasPrefix("- ") && prevList ? "\n" : "\n\n" }
            md += l
        }
        return md + "\n"
    }
}
