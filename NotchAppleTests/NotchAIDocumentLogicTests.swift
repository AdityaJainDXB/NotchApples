//
//  NotchAIDocumentLogicTests.swift
//  Notch Apple tests
//
//  What may be added to the documents list, the size limits per kind, duplicates and the cap.
//

import XCTest

final class NotchAIDocumentLogicTests: XCTestCase {
    private typealias L = DocumentLogic

    private func doc(_ path: String, source: NotchAIDocument.Source = .dropped) -> NotchAIDocument {
        NotchAIDocument(path: path, name: (path as NSString).lastPathComponent, kind: "text", size: 10, source: source)
    }

    func testOnlyRealSupportedFilesWithinTheLimitAreAccepted() {
        XCTAssertNil(L.check(exists: true, isRegularFile: true, size: 1_000, ext: "txt"))
        XCTAssertNil(L.check(exists: true, isRegularFile: true, size: 20_000_000, ext: "DOCX"))
        XCTAssertNil(L.check(exists: true, isRegularFile: true, size: 150_000_000, ext: "pdf"))
        XCTAssertEqual(L.check(exists: false, isRegularFile: false, size: 0, ext: "txt"), .missing)
        XCTAssertEqual(L.check(exists: true, isRegularFile: false, size: 0, ext: ""), .notAFile)            // a folder
        XCTAssertEqual(L.check(exists: true, isRegularFile: true, size: 10, ext: "exe"), .unsupported("exe"))
        XCTAssertEqual(L.check(exists: true, isRegularFile: true, size: 5_000_000, ext: "txt"), .tooBig(limitMB: 4))
        XCTAssertEqual(L.check(exists: true, isRegularFile: true, size: 30_000_000, ext: "xlsx"), .tooBig(limitMB: 25))
    }

    func testEveryRefusalHasAHumanReason() {
        for r in [DocumentRejection.notAFile, .unsupported("exe"), .tooBig(limitMB: 4), .missing] { XCTAssertFalse((r.errorDescription ?? "").isEmpty) }
        XCTAssertTrue(DocumentRejection.unsupported("exe").errorDescription!.contains(".exe"))
        XCTAssertTrue(DocumentRejection.unsupported("").errorDescription!.hasPrefix("That kind of"))
    }

    func testTheSameFileIsListedOnceAndMovesToTheTop() {
        var list = L.adding(doc("/a.txt"), to: [])
        list = L.adding(doc("/b.txt"), to: list)
        list = L.adding(doc("/a.txt", source: .read), to: list)
        XCTAssertEqual(list.map(\.path), ["/a.txt", "/b.txt"])
        XCTAssertEqual(list.first?.source, .read)
    }

    func testTheListIsCappedKeepingTheNewest() {
        var list: [NotchAIDocument] = []
        for i in 0..<(L.maxDocuments + 10) { list = L.adding(doc("/f\(i).txt"), to: list) }
        XCTAssertEqual(list.count, L.maxDocuments)
        XCTAssertEqual(list.first?.path, "/f\(L.maxDocuments + 9).txt")
        XCTAssertFalse(list.contains { $0.path == "/f0.txt" })
    }

    func testRemovingAndPruningMissingFiles() {
        let a = doc("/a.txt"), b = doc("/b.txt")
        XCTAssertEqual(L.removing(id: a.id, from: [a, b]), [b])
        XCTAssertEqual(L.pruned([a, b]) { $0 == "/b.txt" }, [b])
    }

    func testSizesReadNaturally() {
        XCTAssertEqual(L.describe(size: 512), "512 B")
        XCTAssertEqual(L.describe(size: 2_400), "2 KB")
        XCTAssertEqual(L.describe(size: 3_500_000), "3.5 MB")
    }

    func testLabelsAndStorage() throws {
        XCTAssertEqual(doc("/a", source: .read).sourceLabel, "Read by an agent")
        let back = try JSONDecoder().decode([NotchAIDocument].self, from: try JSONEncoder().encode([doc("/a.txt")]))
        XCTAssertEqual(back.first?.path, "/a.txt")
    }

    // MARK: Folders

    func testAFolderAddsOnlyReadableFilesInNameOrder() {
        let pick = L.pick(from: [
            .init(relativePath: "notes/b.md", size: 100), .init(relativePath: "a.txt", size: 10), .init(relativePath: ".secret.txt", size: 10),
            .init(relativePath: ".git/config.txt", size: 10), .init(relativePath: "node_modules/x/readme.md", size: 10),
            .init(relativePath: "app.exe", size: 10), .init(relativePath: "empty.txt", size: 0), .init(relativePath: "big.txt", size: 9_000_000),
            .init(relativePath: "a/b/c/d/deep.txt", size: 10), .init(relativePath: "a/b/c/ok.txt", size: 10), .init(relativePath: "Makefile", size: 10),
            .init(relativePath: "report 10.pdf", size: 10), .init(relativePath: "report 2.pdf", size: 10),
        ])
        XCTAssertEqual(pick.files, ["a.txt", "a/b/c/ok.txt", "notes/b.md", "report 2.pdf", "report 10.pdf"])
        XCTAssertEqual(pick.skipped, 8)
        XCTAssertFalse(pick.cut)
        XCTAssertTrue(L.describe(pick, folder: "Work").contains("Added 5 files"))
        XCTAssertTrue(L.describe(pick, folder: "Work").contains("8 skipped"))
    }

    func testABigFolderIsCutAndAnEmptyOneSaysSo() {
        let many = (0..<(L.maxFromFolder + 30)).map { L.FolderEntry(relativePath: "f\($0).txt", size: 5) }
        let pick = L.pick(from: many)
        XCTAssertEqual(pick.files.count, L.maxFromFolder)
        XCTAssertTrue(pick.cut)
        XCTAssertTrue(L.describe(pick, folder: "X").contains("only the first"))
        XCTAssertTrue(L.describe(L.pick(from: []), folder: "X").contains("No files"))
    }

    // MARK: Search

    func testNamesMatchEveryWordInAnyOrder() {
        let list = [doc("/a/Budget 2026 final.xlsx"), doc("/a/budget draft.txt"), doc("/a/notes.md")]
        XCTAssertEqual(L.matchingNames("2026 budget", in: list).map(\.name), ["Budget 2026 final.xlsx"])
        XCTAssertEqual(L.matchingNames("BUDGET", in: list).count, 2)
        XCTAssertEqual(L.matchingNames("   ", in: list).count, 3)
        XCTAssertTrue(L.matchingNames("zebra", in: list).isEmpty)
    }

    func testSearchInsideGivesLineNumbersAndSnippets() {
        let text = "Intro\nThe total budget is 40.\nNothing here\nBudget notes: total again\n"
        let hits = L.hits(in: text, query: "total budget")
        XCTAssertEqual(hits.map(\.line), [2, 4])
        XCTAssertEqual(hits[0].snippet, "The total budget is 40.")
        XCTAssertTrue(L.hits(in: text, query: "").isEmpty)
        XCTAssertTrue(L.hits(in: text, query: "absent").isEmpty)
        XCTAssertEqual(L.hits(in: String(repeating: "x match\n", count: 20), query: "match", limit: 3).count, 3)
    }

    func testALongLineIsCutAroundTheWord() {
        let line = String(repeating: "a ", count: 200) + "needle " + String(repeating: "b ", count: 200)
        let hit = L.hits(in: line, query: "needle", snippetLength: 60)[0]
        XCTAssertTrue(hit.snippet.contains("needle"))
        XCTAssertTrue(hit.snippet.hasPrefix("…") && hit.snippet.hasSuffix("…"))
        XCTAssertLessThanOrEqual(hit.snippet.count, 62)
        XCTAssertFalse(L.searchableInside(kind: "image"))
        XCTAssertTrue(L.searchableInside(kind: "pdf"))
    }

    func testOldWordAndRichTextUseTheSystemReader() {
        XCTAssertTrue(ResearchLogic.needsRichReader("DOC"))
        XCTAssertTrue(ResearchLogic.needsRichReader("rtf"))
        XCTAssertFalse(ResearchLogic.needsRichReader("docx"))
        XCTAssertEqual(ResearchLogic.kind(forExtension: "doc"), .text)
        XCTAssertEqual(ResearchLogic.kind(forExtension: "xls"), .unsupported)
    }
}
