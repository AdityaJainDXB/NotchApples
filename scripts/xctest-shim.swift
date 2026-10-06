// A tiny stand-in for XCTest so package tests run with only the command line tools.
import Foundation

public var __xctFailures = 0
public var __xctAssertions = 0

open class XCTestCase: NSObject {
    public override required init() { super.init() }
    open func setUp() {}
    open func tearDown() {}
}

private func report(_ what: String, _ message: String, _ file: StaticString, _ line: UInt) {
    __xctFailures += 1
    print("  FAIL \(file):\(line): \(what) \(message)")
}

public func XCTAssertTrue(_ e: @autoclosure () -> Bool, _ m: @autoclosure () -> String = "", file: StaticString = #filePath, line: UInt = #line) {
    __xctAssertions += 1; if !e() { report("XCTAssertTrue failed", m(), file, line) }
}
public func XCTAssertFalse(_ e: @autoclosure () -> Bool, _ m: @autoclosure () -> String = "", file: StaticString = #filePath, line: UInt = #line) {
    __xctAssertions += 1; if e() { report("XCTAssertFalse failed", m(), file, line) }
}
public func XCTAssertEqual<T: Equatable>(_ a: @autoclosure () -> T, _ b: @autoclosure () -> T, _ m: @autoclosure () -> String = "", file: StaticString = #filePath, line: UInt = #line) {
    __xctAssertions += 1; let x = a(), y = b(); if x != y { report("XCTAssertEqual failed: \(x) != \(y)", m(), file, line) }
}
public func XCTAssertEqual<T: FloatingPoint>(_ a: @autoclosure () -> T, _ b: @autoclosure () -> T, accuracy: T, _ m: @autoclosure () -> String = "", file: StaticString = #filePath, line: UInt = #line) {
    __xctAssertions += 1; let x = a(), y = b(); if abs(x - y) > accuracy { report("XCTAssertEqual failed: \(x) !~ \(y)", m(), file, line) }
}
public func XCTAssertNotEqual<T: Equatable>(_ a: @autoclosure () -> T, _ b: @autoclosure () -> T, _ m: @autoclosure () -> String = "", file: StaticString = #filePath, line: UInt = #line) {
    __xctAssertions += 1; let x = a(), y = b(); if x == y { report("XCTAssertNotEqual failed: \(x) == \(y)", m(), file, line) }
}
public func XCTAssertNil(_ e: @autoclosure () -> Any?, _ m: @autoclosure () -> String = "", file: StaticString = #filePath, line: UInt = #line) {
    __xctAssertions += 1; if e() != nil { report("XCTAssertNil failed", m(), file, line) }
}
public func XCTAssertNotNil(_ e: @autoclosure () -> Any?, _ m: @autoclosure () -> String = "", file: StaticString = #filePath, line: UInt = #line) {
    __xctAssertions += 1; if e() == nil { report("XCTAssertNotNil failed", m(), file, line) }
}
public func XCTFail(_ m: String = "", file: StaticString = #filePath, line: UInt = #line) { __xctAssertions += 1; report("XCTFail", m, file, line) }
