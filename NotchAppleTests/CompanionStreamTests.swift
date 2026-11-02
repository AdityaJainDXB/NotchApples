import CryptoKit
import XCTest

// Remote view: who may connect, and the sealed, counted packets a stream is made of.
final class CompanionStreamTests: XCTestCase {
    private let token = Companion.newToken()

    func testOnlyPrivateAndTailscalePeersMayConnect() {
        for ok in ["192.168.1.20", "10.0.0.5", "172.16.0.1", "172.31.255.255", "169.254.3.4", "100.64.0.1", "100.101.102.103", "100.127.255.254",
                   "127.0.0.1", "::1", "fe80::1%en0", "fd7a:115c:a1e0::1", "fc00::5", "::ffff:192.168.0.9", "::ffff:100.100.1.1"] {
            XCTAssertTrue(Companion.isPrivatePeer(ok), ok)
        }
        for bad in ["8.8.8.8", "1.1.1.1", "172.32.0.1", "172.15.0.1", "100.63.255.255", "100.128.0.1", "192.169.0.1", "11.0.0.1", "2001:4860:4860::8888",
                    "2606:4700::1111", "::ffff:8.8.8.8", "", "not an address", "300.1.1.1", "10.0.0"] {
            XCTAssertFalse(Companion.isPrivatePeer(bad), bad)
        }
    }

    private func pair() -> (mac: Companion.StreamCipher, phone: Companion.StreamCipher, macIn: Companion.StreamCipher, phoneIn: Companion.StreamCipher) {
        let mn = Companion.newNonce(), pn = Companion.newNonce()
        let m2p = Companion.streamKey(token: token, macNonce: mn, phoneNonce: pn, .macToPhone)
        let p2m = Companion.streamKey(token: token, macNonce: mn, phoneNonce: pn, .phoneToMac)
        return (.init(key: m2p), .init(key: m2p), .init(key: p2m), .init(key: p2m))
    }

    func testPacketsRoundTripInOrderAndSurviveSplitReads() throws {
        var (mac, phone, _, _) = pair()
        let a = try mac.seal(.video, Companion.videoPayload(frame: 7, jpeg: Data(repeating: 0xAB, count: 5000)))
        let b = try mac.seal(.info, Companion.encodeNote(.init(kind: "layout", width: 800, height: 600)))
        var buffer = Data()
        buffer.append((a + b).prefix(10))                        // a read that stops inside the first packet
        XCTAssertNil(try phone.open(from: &buffer))
        buffer.append((a + b).dropFirst(10))
        let first = try XCTUnwrap(phone.open(from: &buffer)), second = try XCTUnwrap(phone.open(from: &buffer))
        XCTAssertEqual(first.0, .video)
        let video = try XCTUnwrap(Companion.splitVideo(first.1))
        XCTAssertEqual(video.frame, 7); XCTAssertEqual(video.jpeg.count, 5000)
        XCTAssertEqual(second.0, .info); XCTAssertEqual(Companion.decodeNote(second.1)?.width, 800)
        XCTAssertTrue(buffer.isEmpty); XCTAssertNil(try phone.open(from: &buffer))
    }

    func testReplayReorderAndTamperingAreRefused() throws {
        var (mac, phone, _, _) = pair()
        let one = try mac.seal(.info, Data("one".utf8)), two = try mac.seal(.info, Data("two".utf8)), three = try mac.seal(.info, Data("three".utf8))
        var skip = two                                           // arriving before the first
        XCTAssertThrowsError(try phone.open(from: &skip))
        var good = one; XCTAssertNotNil(try phone.open(from: &good))
        var again = one                                          // the same packet twice
        XCTAssertThrowsError(try phone.open(from: &again))
        var gap = three                                          // one went missing
        XCTAssertThrowsError(try phone.open(from: &gap))
        var next = two; XCTAssertNotNil(try phone.open(from: &next))
        var flipped = three; flipped[flipped.count - 5] ^= 1     // a changed ciphertext
        XCTAssertThrowsError(try phone.open(from: &flipped))
        var retyped = three; retyped[4] = Companion.PacketType.input.rawValue   // an info packet dressed up as input
        XCTAssertThrowsError(try phone.open(from: &retyped))
        var huge = Data([0x7F, 0xFF, 0xFF, 0xFF]); XCTAssertThrowsError(try phone.open(from: &huge))
    }

    func testEachDirectionAndEachStreamHasItsOwnKey() throws {
        var a = pair(), b = pair()
        let packet = try a.mac.seal(.info, Data("hi".utf8))
        var wrongStream = packet; XCTAssertThrowsError(try b.phone.open(from: &wrongStream), "another stream's keys can't open it")
        var wrongWay = packet; XCTAssertThrowsError(try a.macIn.open(from: &wrongWay), "nor can the other direction's key")
        var right = packet; XCTAssertNotNil(try a.phone.open(from: &right))
        var back = try a.phoneIn.seal(.input, Data("tap".utf8))
        XCTAssertEqual(try a.macIn.open(from: &back)?.0, .input)
    }

    func testTheAdapterBacksOffWhenSlowAndRecovers() {
        var a = StreamAdapter()
        XCTAssertTrue(a.shouldSend)
        a.sent(); a.sent(); a.sent(); XCTAssertFalse(a.shouldSend, "three frames waiting: stop sending")
        a.acknowledged(rtt: 0.9, outstanding: 2)
        XCTAssertLessThan(a.quality, 0.6); XCTAssertLessThan(a.scale, 1)
        let slowQuality = a.quality
        for _ in 0..<20 { a.acknowledged(rtt: 0.05, outstanding: 0) }
        XCTAssertGreaterThan(a.quality, slowQuality)
        for _ in 0..<50 { a.acknowledged(rtt: 2, outstanding: 2) }
        XCTAssertGreaterThanOrEqual(a.quality, 0.25); XCTAssertGreaterThanOrEqual(a.scale, 0.4); XCTAssertLessThanOrEqual(a.interval, 0.25)
    }

    func testStreamMessagesRoundTripAndOldPhonesStillDecode() throws {
        let note = Companion.StreamNote(kind: "display", display: 3, edge: 1280)
        XCTAssertEqual(Companion.decodeNote(Companion.encodeNote(note)), note)
        let old = Data(#"{"type":"status","version":1}"#.utf8)   // a message from before streams existed
        XCTAssertEqual(try JSONDecoder().decode(Companion.Message.self, from: old).type, .status)
    }

    func testInputEventsKeyNamesAndTheRateLimit() throws {
        let e = Companion.InputEvent(kind: "down", x: 0.25, y: 0.75, count: 2)
        XCTAssertEqual(Companion.decodeInput(Companion.encodeInput(e)), e)
        XCTAssertNil(Companion.decodeInput(Data("{\"nope\":1}".utf8)))
        XCTAssertEqual(Companion.keyCode("return"), 36); XCTAssertEqual(Companion.keyCode("C"), 8); XCTAssertEqual(Companion.keyCode("left"), 123)
        XCTAssertNil(Companion.keyCode("f13")); XCTAssertNil(Companion.keyCode("ab"))
        var limiter = Companion.InputLimiter(perSecond: 100, burst: 10, now: 0)
        let first = (0..<30).filter { _ in limiter.allow(now: 0) }.count
        XCTAssertEqual(first, 10, "a burst is capped")
        XCTAssertTrue(limiter.allow(now: 0.05), "and it refills over time")
        let later = (0..<1000).filter { i in limiter.allow(now: 1 + Double(i) * 0.001) }.count
        XCTAssertGreaterThanOrEqual(later, 100); XCTAssertLessThanOrEqual(later, 112)   // about 100 a second, plus what the burst allows
    }

    func testStatusWithPhoneContentRoundTripsAndOldStatusStillDecodes() throws {
        var s = Companion.Status(macName: "Mac", battery: 50, charging: false, playing: false, title: nil, artist: nil, timer: nil, notchOpen: false, tier: "Ultimate")
        s.clipboard = "hello"; s.notes = ["a"]; s.todos = [.init(text: "t", done: false)]; s.alerts = ["Timer 3:00"]
        XCTAssertEqual(try JSONDecoder().decode(Companion.Status.self, from: JSONEncoder().encode(s)), s)
        let old = Data(#"{"macName":"M","charging":false,"playing":false,"notchOpen":false,"tier":"Pro"}"#.utf8)
        XCTAssertNil(try JSONDecoder().decode(Companion.Status.self, from: old).clipboard)
    }
}
