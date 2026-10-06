//
//  DevToolkitTests.swift
//  Notch apple tests
//
//  The developer tools, checked against well-known reference values (SHA of "abc", the standard JWT sample,
//  WCAG contrast examples). The Windows app runs the same cases against services/devkit.js.
//

import XCTest

final class DevToolkitTests: XCTestCase {
    func testFormatJSONKeepsKeyOrderAndCommasInStrings() {
        let out = DevToolkit.formatJSON(#"{"b":1,"a":[1,2,{"c":"x,y"}],"e":{},"f":[]}"#)
        XCTAssertEqual(out, "{\n  \"b\": 1,\n  \"a\": [\n    1,\n    2,\n    {\n      \"c\": \"x,y\"\n    }\n  ],\n  \"e\": {},\n  \"f\": []\n}")
    }

    func testMinifyIsTheInverseAndKeepsSpacesInsideStrings() {
        let original = #"{"b":1,"a":[1,2,{"c":"x, y"}]}"#
        XCTAssertEqual(DevToolkit.minifyJSON(DevToolkit.formatJSON(original)!), original)
    }

    func testInvalidJSONIsRefused() {
        XCTAssertNil(DevToolkit.formatJSON("{nope"))
        XCTAssertNil(DevToolkit.minifyJSON(""))
        XCTAssertTrue(DevToolkit.isJSON("[1,2]"))
    }

    func testBase64BothWays() {
        XCTAssertEqual(DevToolkit.base64Encode("hello"), "aGVsbG8=")
        XCTAssertEqual(DevToolkit.base64Decode("aGVsbG8="), "hello")
        XCTAssertEqual(DevToolkit.base64Decode("aGVsbG8"), "hello", "padding is optional")
        XCTAssertEqual(DevToolkit.base64Decode("Pz8_Pz8-"), "?????>", "URL-safe letters work")
        XCTAssertNil(DevToolkit.base64Decode("not base64 !!"))
    }

    func testURLEncoding() {
        XCTAssertEqual(DevToolkit.urlEncode("a b&c=d/é~-._"), "a%20b%26c%3Dd%2F%C3%A9~-._")
        XCTAssertEqual(DevToolkit.urlDecode("a%20b%26c%3Dd%2F%C3%A9"), "a b&c=d/é")
        XCTAssertEqual(DevToolkit.urlDecode("100%+1"), nil)
    }

    func testCaseChanges() {
        let s = "helloWorld foo-bar2"
        XCTAssertEqual(DevToolkit.words(s), ["hello", "World", "foo", "bar", "2"])
        XCTAssertEqual(DevToolkit.convert(s, to: .snake), "hello_world_foo_bar_2")
        XCTAssertEqual(DevToolkit.convert(s, to: .kebab), "hello-world-foo-bar-2")
        XCTAssertEqual(DevToolkit.convert(s, to: .camel), "helloWorldFooBar2")
        XCTAssertEqual(DevToolkit.convert(s, to: .pascal), "HelloWorldFooBar2")
        XCTAssertEqual(DevToolkit.convert(s, to: .title), "Hello World Foo Bar 2")
        XCTAssertEqual(DevToolkit.convert("MixedCase", to: .upper), "MIXEDCASE")
    }

    func testTheStandardJWTSample() throws {
        let token = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkpvaG4gRG9lIiwiaWF0IjoxNTE2MjM5MDIyfQ.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c"
        let jwt = try XCTUnwrap(DevToolkit.decodeJWT(token))
        XCTAssertEqual(jwt.header, "{\n  \"alg\": \"HS256\",\n  \"typ\": \"JWT\"\n}")
        XCTAssertTrue(jwt.payload.contains("\"name\": \"John Doe\""))
        XCTAssertEqual(jwt.issued, Date(timeIntervalSince1970: 1516239022))
        XCTAssertNil(jwt.expires)
        XCTAssertFalse(jwt.isExpired())
        XCTAssertTrue(jwt.hasSignature)
        XCTAssertNil(DevToolkit.decodeJWT("not.a.token"))
        XCTAssertNil(DevToolkit.decodeJWT("only.two"))
    }

    func testHashesOfAbc() {
        XCTAssertEqual(DevToolkit.hash("abc", .sha1), "a9993e364706816aba3e25717850c26c9cd0d89d")
        XCTAssertEqual(DevToolkit.hash("abc", .sha256), "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad")
        XCTAssertTrue(DevToolkit.hash("abc", .sha512).hasPrefix("ddaf35a193617abacc417349ae204131"))
    }

    func testUUIDAndLorem() {
        XCTAssertNotNil(UUID(uuidString: DevToolkit.uuid()))
        XCTAssertNotEqual(DevToolkit.uuid(), DevToolkit.uuid())
        let l = DevToolkit.loremIpsum(words: 5)
        XCTAssertEqual(l, "Lorem ipsum dolor sit amet.")
        XCTAssertEqual(DevToolkit.loremIpsum(words: 400).split(separator: " ").count, 400)
    }

    func testTimestamps() throws {
        let s = try XCTUnwrap(DevToolkit.parseStamp("1516239022"))
        XCTAssertEqual(s.isoUTC, "2018-01-18T01:30:22Z")
        XCTAssertEqual(DevToolkit.parseStamp("1516239022000")?.isoUTC, "2018-01-18T01:30:22Z", "13 digits are milliseconds")
        XCTAssertEqual(DevToolkit.parseStamp("2018-01-18T01:30:22Z")?.seconds, 1516239022)
        XCTAssertEqual(DevToolkit.parseStamp("2018-01-18T01:30:22.500Z")?.seconds, 1516239022.5)
        XCTAssertNil(DevToolkit.parseStamp("tomorrow"))
        XCTAssertNil(DevToolkit.parseStamp(""))
    }

    func testRegexTester() {
        XCTAssertEqual(DevToolkit.regexTest(pattern: #"(\w+)@(\w+)\.com"#, text: "ann@site.com, bob@mail.com"),
                       .matches([.init(text: "ann@site.com", groups: ["ann", "site"]), .init(text: "bob@mail.com", groups: ["bob", "mail"])]))
        XCTAssertEqual(DevToolkit.regexTest(pattern: "HELLO", text: "hello", ignoreCase: true), .matches([.init(text: "hello", groups: [])]))
        XCTAssertEqual(DevToolkit.regexTest(pattern: "zzz", text: "abc"), .matches([]))
        XCTAssertEqual(DevToolkit.regexTest(pattern: "(", text: "abc"), .invalid("That pattern isn't valid."))
    }

    func testWCAGContrastReferenceValues() throws {
        let bw = try XCTUnwrap(DevToolkit.contrast("#000", "#ffffff"))
        XCTAssertEqual(bw.ratio, 21, accuracy: 0.001)
        XCTAssertTrue(bw.aaaNormal)
        let grey = try XCTUnwrap(DevToolkit.contrast("#777777", "#ffffff"))
        XCTAssertEqual(grey.ratio, 4.478, accuracy: 0.01, "the classic just-fails-AA grey")
        XCTAssertFalse(grey.aaNormal)
        XCTAssertTrue(grey.aaLarge)
        XCTAssertEqual(DevToolkit.contrast("#fff", "ffffff")?.ratio ?? 0, 1, accuracy: 0.001)
        XCTAssertNil(DevToolkit.contrast("nope", "#fff"))
    }
}
