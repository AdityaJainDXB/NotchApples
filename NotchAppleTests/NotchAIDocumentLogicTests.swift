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
}
