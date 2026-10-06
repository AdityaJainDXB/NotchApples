// A tiny stand-in for XCTest so package and app-logic tests run with only the command line tools.
// Real XCTest (in CI, under Xcode) is the source of truth; this exists for quick local runs.
@_exported import Foundation   // real XCTest re-exports Foundation too

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

/// Runs an assertion body, treating anything it throws as a failure (as real XCTest does).
private func check(_ file: StaticString, _ line: UInt, _ body: () throws -> Void) {
    __xctAssertions += 1
    do { try body() } catch { report("threw", "\(error)", file, line) }
}

public func XCTAssertTrue(_ e: @autoclosure () throws -> Bool, _ m: @autoclosure () -> String = "", file: StaticString = #filePath, line: UInt = #line) {
    check(file, line) { if !(try e()) { report("XCTAssertTrue failed", m(), file, line) } }
}
public func XCTAssertFalse(_ e: @autoclosure () throws -> Bool, _ m: @autoclosure () -> String = "", file: StaticString = #filePath, line: UInt = #line) {
    check(file, line) { if try e() { report("XCTAssertFalse failed", m(), file, line) } }
}
public func XCTAssertEqual<T: Equatable>(_ a: @autoclosure () throws -> T, _ b: @autoclosure () throws -> T, _ m: @autoclosure () -> String = "", file: StaticString = #filePath, line: UInt = #line) {
    check(file, line) { let x = try a(), y = try b(); if x != y { report("XCTAssertEqual failed: \(x) != \(y)", m(), file, line) } }
}
public func XCTAssertEqual<T: FloatingPoint>(_ a: @autoclosure () throws -> T, _ b: @autoclosure () throws -> T, accuracy: T, _ m: @autoclosure () -> String = "", file: StaticString = #filePath, line: UInt = #line) {
    check(file, line) { let x = try a(), y = try b(); if abs(x - y) > accuracy { report("XCTAssertEqual failed: \(x) !~ \(y)", m(), file, line) } }
}
public func XCTAssertNotEqual<T: Equatable>(_ a: @autoclosure () throws -> T, _ b: @autoclosure () throws -> T, _ m: @autoclosure () -> String = "", file: StaticString = #filePath, line: UInt = #line) {
    check(file, line) { let x = try a(), y = try b(); if x == y { report("XCTAssertNotEqual failed: \(x) == \(y)", m(), file, line) } }
}
public func XCTAssertNil(_ e: @autoclosure () throws -> Any?, _ m: @autoclosure () -> String = "", file: StaticString = #filePath, line: UInt = #line) {
    check(file, line) { if try e() != nil { report("XCTAssertNil failed", m(), file, line) } }
}
public func XCTAssertNotNil(_ e: @autoclosure () throws -> Any?, _ m: @autoclosure () -> String = "", file: StaticString = #filePath, line: UInt = #line) {
    check(file, line) { if try e() == nil { report("XCTAssertNotNil failed", m(), file, line) } }
}
public func XCTFail(_ m: String = "", file: StaticString = #filePath, line: UInt = #line) { __xctAssertions += 1; report("XCTFail", m, file, line) }
public func XCTAssertLessThan<T: Comparable>(_ a: @autoclosure () throws -> T, _ b: @autoclosure () throws -> T, _ m: @autoclosure () -> String = "", file: StaticString = #filePath, line: UInt = #line) {
    check(file, line) { let x = try a(), y = try b(); if !(x < y) { report("XCTAssertLessThan failed: \(x) !< \(y)", m(), file, line) } }
}
public func XCTAssertGreaterThan<T: Comparable>(_ a: @autoclosure () throws -> T, _ b: @autoclosure () throws -> T, _ m: @autoclosure () -> String = "", file: StaticString = #filePath, line: UInt = #line) {
    check(file, line) { let x = try a(), y = try b(); if !(x > y) { report("XCTAssertGreaterThan failed: \(x) !> \(y)", m(), file, line) } }
}
public func XCTAssertLessThanOrEqual<T: Comparable>(_ a: @autoclosure () throws -> T, _ b: @autoclosure () throws -> T, _ m: @autoclosure () -> String = "", file: StaticString = #filePath, line: UInt = #line) {
    check(file, line) { let x = try a(), y = try b(); if !(x <= y) { report("XCTAssertLessThanOrEqual failed: \(x) !<= \(y)", m(), file, line) } }
}
public func XCTAssertGreaterThanOrEqual<T: Comparable>(_ a: @autoclosure () throws -> T, _ b: @autoclosure () throws -> T, _ m: @autoclosure () -> String = "", file: StaticString = #filePath, line: UInt = #line) {
    check(file, line) { let x = try a(), y = try b(); if !(x >= y) { report("XCTAssertGreaterThanOrEqual failed: \(x) !>= \(y)", m(), file, line) } }
}

public struct XCTSkip: Error { public init(_ m: String = "") {} }
struct XCTUnwrapFailure: Error {}
public func XCTUnwrap<T>(_ e: @autoclosure () throws -> T?, _ m: @autoclosure () -> String = "", file: StaticString = #filePath, line: UInt = #line) throws -> T {
    __xctAssertions += 1
    if let v = try e() { return v }
    report("XCTUnwrap failed: expected non-nil", m(), file, line)
    throw XCTUnwrapFailure()
}
