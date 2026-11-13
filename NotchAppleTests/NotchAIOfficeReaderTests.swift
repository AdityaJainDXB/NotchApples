//
//  NotchAIOfficeReaderTests.swift
//  Notch Apple tests
//
//  Reading Word, Excel and PowerPoint files: real files made by textutil (Word format) and openpyxl (Excel), a
//  PowerPoint laid out the way PowerPoint stores it, hand-built archives for tables and notes, and hostile or damaged
//  archives (truncated, password protected, zip64, a part that claims to expand enormously).
//

import XCTest

final class NotchAIOfficeReaderTests: XCTestCase {
    // MARK: Real files

    private let realDocx = "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"
    private let realXlsx = "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"
    private let realPptx = "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"

    private func data(_ b64: String) -> Data { Data(base64Encoded: b64)! }

    func testARealWordFileGivesItsParagraphsInOrder() throws {
        let t = try OfficeReader.text(from: data(realDocx), kind: .docx)
        XCTAssertTrue(t.hasPrefix("Ions Report\nAn ion is an atom with a charge & more."), t)
        XCTAssertTrue(t.contains("café"))                       // entities and accents survive
        XCTAssertTrue(t.contains("Sodium"))
        XCTAssertFalse(t.contains("<w:"))
    }

    func testARealExcelFileGivesEachSheetAsAPageWithRowsAndGaps() throws {
        let t = try OfficeReader.text(from: data(realXlsx), kind: .xlsx)
        XCTAssertTrue(t.contains("[page 1]\nSheet: Ions\nElement\tCharge\tNote\nSodium\t1\tmetal\nChlorine\t-1\n"), t)
        XCTAssertTrue(t.contains("\t\t\tfar cell"), t)         // a cell far from the others keeps its column
        XCTAssertTrue(t.contains("TRUE\t3.5\ttab here"), t)      // booleans, decimals; a tab inside a cell becomes a space
        XCTAssertTrue(t.contains("[page 2]\nSheet: Second\nOnly here\n\t\t42"), t)
    }

    func testAPowerPointFileGivesSlidesInNumericOrderWithNotes() throws {
        let t = try OfficeReader.text(from: data(realPptx), kind: .pptx)
        XCTAssertEqual(t, "[page 1]\nIons & Atoms\nWhat is an ion?\nSpeaker notes: Remember to define charge.\n[page 2]\nSecond slide title\nCharge balance\n[page 3]\nTenth slide")   // slide10 after slide2, not before
    }

    func testPagesFeedTheDocumentIndexSoAnswersCiteASlideOrSheet() throws {
        let t = try OfficeReader.text(from: data(realPptx), kind: .pptx)
        let hit = DocumentIndex(text: t, targetCharacters: 80).search("charge balance").first
        XCTAssertEqual(hit?.passage.page, 2)
    }

    // MARK: Hand-built archives

    private let wNS = "xmlns:w=\"http://schemas.openxmlformats.org/wordprocessingml/2006/main\""

    func testAWordTableKeepsARowOnOneLine() throws {
        let cell = { (t: String) in "<w:tc><w:p><w:r><w:t>\(t)</w:t></w:r></w:p></w:tc>" }
        let xml = "<w:document \(wNS)><w:body><w:p><w:r><w:t>Intro</w:t></w:r></w:p><w:tbl><w:tr>\(cell("Element"))\(cell("Charge"))</w:tr><w:tr>\(cell("Sodium"))\(cell("+1"))</w:tr></w:tbl><w:p><w:r><w:t>After</w:t><w:tab/><w:t>tab</w:t><w:br/><w:t>line</w:t></w:r></w:p></w:body></w:document>"
        let zip = TestZip.make(["word/document.xml": xml])
        XCTAssertEqual(try OfficeReader.text(from: zip, kind: .docx), "Intro\nElement\tCharge\nSodium\t+1\nAfter\ttab\nline")
    }

    func testFootnotesAreReadAndLabelled() throws {
        let body = "<w:document \(wNS)><w:body><w:p><w:r><w:t>Main text</w:t></w:r></w:p></w:body></w:document>"
        let notes = "<w:footnotes \(wNS)><w:footnote><w:p><w:r><w:t>A footnote</w:t></w:r></w:p></w:footnote></w:footnotes>"
        let t = try OfficeReader.text(from: TestZip.make(["word/document.xml": body, "word/footnotes.xml": notes]), kind: .docx)
        XCTAssertEqual(t, "Main text\nNotes:\nA footnote")
    }

    func testExcelSharedStringsWithRichTextAndPhoneticHints() throws {
        let wb = "<workbook xmlns:r=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships\"><sheets><sheet name=\"Data\" sheetId=\"1\" r:id=\"rId5\"/></sheets></workbook>"
        let rels = "<Relationships><Relationship Id=\"rId5\" Type=\"x\" Target=\"worksheets/sheet9.xml\"/></Relationships>"
        let ss = "<sst><si><t>Plain</t></si><si><r><t>Rich </t></r><r><t>text</t></r><rPh sb=\"0\"><t>PHONETIC</t></rPh></si></sst>"
        let sheet = "<worksheet><sheetData><row r=\"1\"><c r=\"A1\" t=\"s\"><v>0</v></c><c r=\"B1\" t=\"s\"><v>1</v></c><c r=\"C1\" t=\"inlineStr\"><is><t>inline</t></is></c><c r=\"D1\" t=\"s\"><v>99</v></c></row><row r=\"3\"><c r=\"AA3\"><v>7</v></c></row></sheetData></worksheet>"
        let zip = TestZip.make(["xl/workbook.xml": wb, "xl/_rels/workbook.xml.rels": rels, "xl/sharedStrings.xml": ss, "xl/worksheets/sheet9.xml": sheet])
        let t = try OfficeReader.text(from: zip, kind: .xlsx)
        XCTAssertTrue(t.contains("Plain\tRich text\tinline\n"), t)    // phonetic text dropped; a bad shared-string index is blank
        XCTAssertFalse(t.contains("PHONETIC"))
        XCTAssertTrue(t.contains("\n" + String(repeating: "\t", count: 26) + "7"), t)   // column AA
    }

    func testBigSheetsAreCutAndSaySo() throws {
        let wb = "<workbook><sheets><sheet name=\"Big\" sheetId=\"1\"/></sheets></workbook>"
        let rows = (1...1_050).map { "<row r=\"\($0)\"><c r=\"A\($0)\"><v>\($0)</v></c></row>" }.joined()
        let zip = TestZip.make(["xl/workbook.xml": wb, "xl/worksheets/sheet1.xml": "<worksheet><sheetData>\(rows)</sheetData></worksheet>"])
        let t = try OfficeReader.text(from: zip, kind: .xlsx)
        XCTAssertTrue(t.contains("1000\n"))
        XCTAssertFalse(t.contains("\n1001\n"))
        XCTAssertTrue(t.contains("1050 rows in all; the first 1000 are shown"), String(t.suffix(80)))
    }

    func testColumnLetters() {
        XCTAssertEqual(OfficeReader.columnIndex("A1"), 0)
        XCTAssertEqual(OfficeReader.columnIndex("Z9"), 25)
        XCTAssertEqual(OfficeReader.columnIndex("AA3"), 26)
        XCTAssertEqual(OfficeReader.columnIndex("AB12"), 27)
        XCTAssertEqual(OfficeReader.columnIndex("12"), 0)
    }

    // MARK: Bad input

    func testNotAZipAndEmptyDocuments() {
        XCTAssertThrowsError(try OfficeReader.text(from: Data("hello".utf8), kind: .docx)) { XCTAssertEqual($0 as? OfficeReadError, .notAZip) }
        XCTAssertThrowsError(try OfficeReader.text(from: Data(), kind: .xlsx))
        let empty = TestZip.make(["word/document.xml": "<w:document \(wNS)><w:body><w:p/></w:body></w:document>"])
        XCTAssertThrowsError(try OfficeReader.text(from: empty, kind: .docx)) { XCTAssertEqual($0 as? OfficeReadError, .empty) }
    }

    func testAnArchiveThatIsTheWrongKindSaysWhatIsMissing() {
        let zip = TestZip.make(["word/document.xml": "<x/>"])
        XCTAssertThrowsError(try OfficeReader.text(from: zip, kind: .xlsx)) { XCTAssertEqual($0 as? OfficeReadError, .missing("xl/workbook.xml")) }
        XCTAssertThrowsError(try OfficeReader.text(from: zip, kind: .pptx)) { XCTAssertEqual($0 as? OfficeReadError, .missing("slides")) }
    }

    func testTruncatedFilesAreDamagedNotACrash() {
        let d = data(realDocx)
        for cut in [10, 100, d.count / 2, d.count - 5] {
            XCTAssertThrowsError(try OfficeReader.text(from: d.prefix(cut), kind: .docx), "cut at \(cut)")
        }
    }

    func testPasswordProtectedAndZip64AreRefusedPlainly() {
        XCTAssertThrowsError(try ZipArchive(TestZip.make(["a.xml": "x"], flags: 1))) { XCTAssertEqual($0 as? OfficeReadError, .encrypted) }
        XCTAssertThrowsError(try ZipArchive(TestZip.make(["a.xml": "x"], claimedSize: 0xFFFF_FFFF))) { XCTAssertEqual($0 as? OfficeReadError, .unsupportedZip) }
    }

    func testAPartThatClaimsToExpandHugelyIsRefusedBeforeAnythingIsAllocated() throws {
        let z = try ZipArchive(TestZip.make(["word/document.xml": "x"], claimedSize: 500 * 1024 * 1024))
        XCTAssertThrowsError(try z.read("word/document.xml")) { XCTAssertEqual($0 as? OfficeReadError, .tooLarge) }
    }

    func testAnEntrySizeThatLiesIsCorruptNotAMemoryError() throws {
        let z = try ZipArchive(TestZip.make(["a.xml": "short"], claimedSize: 4_000))   // stored entry whose directory size is wrong
        XCTAssertThrowsError(try z.read("a.xml")) { XCTAssertEqual($0 as? OfficeReadError, .corrupt) }
    }

    func testExtensions() {
        XCTAssertEqual(OfficeReader.kind(forExtension: "DOCX"), .docx)
        XCTAssertEqual(OfficeReader.kind(forExtension: "xlsx"), .xlsx)
        XCTAssertEqual(OfficeReader.kind(forExtension: "pptx"), .pptx)
        XCTAssertNil(OfficeReader.kind(forExtension: "doc"))
        XCTAssertNil(OfficeReader.kind(forExtension: "xls"))
    }

    func testTheFileKindTableKnowsOfficeFiles() {
        XCTAssertEqual(ResearchLogic.kind(forExtension: "docx"), .office)
        XCTAssertEqual(ResearchLogic.kind(forExtension: "XLSX"), .office)
        XCTAssertEqual(ResearchLogic.kind(forExtension: "pptx"), .office)
        XCTAssertEqual(ResearchLogic.kind(forExtension: "doc"), .text)           // old Word files are read by macOS itself
        XCTAssertEqual(ResearchLogic.kind(forExtension: "ppt"), .unsupported)    // old PowerPoint and Excel files are not read
    }
}

/// A tiny zip writer for tests: stored (uncompressed) entries, with optional lies in the directory.
enum TestZip {
    private static func crc32(_ d: [UInt8]) -> UInt32 {
        var c: UInt32 = 0xFFFF_FFFF
        for b in d { c ^= UInt32(b); for _ in 0..<8 { c = (c >> 1) ^ (0xEDB8_8320 & (0 &- (c & 1))) } }
        return ~c
    }
    private static func le(_ v: Int, _ n: Int) -> [UInt8] { (0..<n).map { UInt8((v >> (8 * $0)) & 0xFF) } }

    static func make(_ files: [String: String], flags: Int = 0, claimedSize: Int? = nil) -> Data {
        var out: [UInt8] = [], central: [UInt8] = []
        for (name, content) in files.sorted(by: { $0.key < $1.key }) {
            let body = Array(content.utf8), nm = Array(name.utf8), crc = Int(crc32(body))
            let offset = out.count
            out += le(0x0403_4B50, 4) + le(20, 2) + le(flags, 2) + le(0, 2) + le(0, 2) + le(0, 2) + le(crc, 4) + le(body.count, 4) + le(body.count, 4) + le(nm.count, 2) + le(0, 2) + nm + body
            central += le(0x0201_4B50, 4) + le(20, 2) + le(20, 2) + le(flags, 2) + le(0, 2) + le(0, 2) + le(0, 2) + le(crc, 4) + le(body.count, 4) + le(claimedSize ?? body.count, 4)
                + le(nm.count, 2) + le(0, 2) + le(0, 2) + le(0, 2) + le(0, 2) + le(0, 4) + le(offset, 4) + nm
        }
        let cdOffset = out.count
        out += central
        out += le(0x0605_4B50, 4) + le(0, 2) + le(0, 2) + le(files.count, 2) + le(files.count, 2) + le(central.count, 4) + le(cdOffset, 4) + le(0, 2)
        return Data(out)
    }
}
