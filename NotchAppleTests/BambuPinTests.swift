import XCTest

final class BambuPinTests: XCTestCase {
    func testFirstCertificateIsRemembered() {
        XCTAssertEqual(BambuStatusLogic.decidePin(stored: nil, seen: "ab"), .pinFirst)
        XCTAssertEqual(BambuStatusLogic.decidePin(stored: "", seen: "ab"), .pinFirst)
    }
    func testSameCertificateMatchesWhateverTheCase() {
        XCTAssertEqual(BambuStatusLogic.decidePin(stored: "ABCD", seen: "abcd"), .match)
    }
    func testADifferentCertificateIsRefused() {
        XCTAssertEqual(BambuStatusLogic.decidePin(stored: "abcd", seen: "abce"), .mismatch)
    }
    func testFingerprintIsSha256Hex() {
        XCTAssertEqual(BambuStatusLogic.fingerprint(of: Data("abc".utf8)),
                       "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad")
    }
}
