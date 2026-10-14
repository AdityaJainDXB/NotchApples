import XCTest

final class BambuCameraTests: XCTestCase {
    func testTheAddressIsReadFromTheLittleEndianNumber() {
        XCTAssertEqual(BambuCameraLogic.ipString(1677830336), "192.168.1.100")
        XCTAssertNil(BambuCameraLogic.ipString(0))
        XCTAssertNil(BambuCameraLogic.ipString(-5))
        XCTAssertNil(BambuCameraLogic.ipString(Int(UInt32.max) + 1))
    }
    func testTheLoginIs80BytesWithTheNameAndCodeInPlace() {
        let p = BambuCameraLogic.authPacket(user: "bblp", code: "12345678")!
        XCTAssertEqual(p.count, 80)
        XCTAssertEqual(Array(p.prefix(8)), [0x40, 0, 0, 0, 0, 0x30, 0, 0])
        XCTAssertEqual(String(data: p.subdata(in: 16..<20), encoding: .utf8), "bblp")
        XCTAssertEqual(p[20], 0)
        XCTAssertEqual(String(data: p.subdata(in: 48..<56), encoding: .utf8), "12345678")
        XCTAssertNil(BambuCameraLogic.authPacket(user: "bblp", code: ""))
        XCTAssertNil(BambuCameraLogic.authPacket(user: "bblp", code: String(repeating: "x", count: 33)))
    }
    private func frame(_ jpeg: [UInt8]) -> Data {
        var d = Data([UInt8(jpeg.count & 0xFF), UInt8((jpeg.count >> 8) & 0xFF), UInt8((jpeg.count >> 16) & 0xFF), 0] + [UInt8](repeating: 0, count: 12))
        d.append(contentsOf: jpeg); return d
    }
    func testPicturesAreTakenWholeAndTheRestWaitsForMoreBytes() {
        let a: [UInt8] = [0xFF, 0xD8, 1, 2, 3, 0xFF, 0xD9], b: [UInt8] = [0xFF, 0xD8, 9, 0xFF, 0xD9]
        var buf = frame(a) + frame(b).prefix(10)
        XCTAssertEqual(BambuCameraLogic.takeFrames(&buf)!, [Data(a)])
        buf.append(frame(b).dropFirst(10))
        XCTAssertEqual(BambuCameraLogic.takeFrames(&buf)!, [Data(b)])
        XCTAssertTrue(buf.isEmpty)
    }
    func testAStreamThatIsNotPicturesIsRefused() {
        var junk = Data([0xFF, 0xFF, 0xFF, 0x7F] + [UInt8](repeating: 0, count: 20))
        XCTAssertNil(BambuCameraLogic.takeFrames(&junk))
        var notJpeg = frame([1, 2, 3, 4, 5, 6, 7])
        XCTAssertNil(BambuCameraLogic.takeFrames(&notJpeg))
    }
    func testTheVideoAddressForTheOtherPrinters() {
        XCTAssertEqual(BambuCameraLogic.rtspsAddress(ip: "192.168.1.100", code: "ab12cd34"), "rtsps://bblp:ab12cd34@192.168.1.100:322/streaming/live/1")
        XCTAssertNil(BambuCameraLogic.rtspsAddress(ip: "evil.example.com", code: "x"))
        XCTAssertNil(BambuCameraLogic.rtspsAddress(ip: "", code: "x"))
        XCTAssertEqual(BambuCameraLogic.rtspsAddress(ip: "10.0.0.2", code: "a@b/c"), "rtsps://bblp:a%40b%2Fc@10.0.0.2:322/streaming/live/1")
    }
}
