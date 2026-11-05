import XCTest

// Messenger → Friends: the codes, the sealing (against the same vectors the JavaScript client and the server test use),
// and the friendship rules. Logic only; the screen and the network are not exercised here.
final class FriendsTests: XCTestCase {
    private func vectors() throws -> [String: Any] {
        let url = URL(fileURLWithPath: #filePath).deletingLastPathComponent().deletingLastPathComponent()
            .appendingPathComponent("server/room-relay/test/friends-vectors.json")
        return try JSONSerialization.jsonObject(with: Data(contentsOf: url)) as! [String: Any]
    }
    private func identity(_ v: [String: Any], _ i: Int) -> FriendIdentity {
        let d = (v["identities"] as! [[String: String]])[i]
        return FriendIdentity(code: "0123456789", signSeed: Friends.unb64u(d["signSeed"]!)!, dhSeed: Friends.unb64u(d["dhSeed"]!)!)
    }

    func testCodesAreCleanAndNormalise() {
        let c = Friends.newCode()
        XCTAssertEqual(c.count, 10)
        XCTAssertTrue(c.allSatisfy { Friends.codeAlphabet.contains($0) })
        XCTAssertEqual(Friends.normalizedCode(" \(c.prefix(5).lowercased())-\(c.dropFirst(5)) "), c)
        XCTAssertEqual(Friends.normalizedCode("oiL0123456"), "0110123456")
        XCTAssertNil(Friends.normalizedCode("short"))
        XCTAssertNil(Friends.normalizedCode("ABCDEFGHIU"))   // U is not in the alphabet
        XCTAssertEqual(Friends.displayCode("ABCDEFGHJK"), "ABCDE-FGHJK")
        XCTAssertEqual(Set((0..<200).map { _ in Friends.newCode() }).count, 200)
    }

    func testLinkRoundTrip() throws {
        let id = FriendIdentity.generate()
        let parsed = try XCTUnwrap(Friends.parse(id.link))
        XCTAssertEqual(parsed.code, id.code)
        XCTAssertEqual(parsed.fingerprint, id.fingerprint)
        XCTAssertEqual(Friends.parse(Friends.displayCode(id.code))?.code, id.code)
        XCTAssertNil(Friends.parse(Friends.displayCode(id.code))?.fingerprint)
        XCTAssertNil(Friends.parse("notchapple://friend?c=nope"))
        XCTAssertNil(Friends.parse("https://example.com"))
    }

    func testSharedVectors() throws {
        let v = try vectors()
        for c in v["codes"] as! [[String: String]] { XCTAssertEqual(Friends.box(for: c["code"]!), c["box"]!) }
        let a = identity(v, 0), b = identity(v, 1)
        let ids = v["identities"] as! [[String: String]]
        XCTAssertEqual(Friends.b64u(a.signPublic), ids[0]["signPub"]); XCTAssertEqual(Friends.b64u(a.dhPublic), ids[0]["dhPub"])
        XCTAssertEqual(Friends.b64u(b.signPublic), ids[1]["signPub"]); XCTAssertEqual(Friends.b64u(b.dhPublic), ids[1]["dhPub"])
        XCTAssertEqual(Friends.b64u(a.fingerprint), ids[0]["fingerprint"])
        let auth = v["auth"] as! [String: String]
        XCTAssertEqual(FriendCrypto.authMessage(method: auth["method"]!, path: auth["path"]!, ts: auth["ts"]!, body: auth["body"]!), auth["message"])
        // The JavaScript signature must verify here; our own must verify too.
        let sig = String(auth["header"]!.split(separator: ".").last!)
        XCTAssertTrue(FriendCrypto.verify(sign: a.signPublic, text: auth["message"]!, signature: sig))
        let mine = FriendCrypto.authHeader(a, method: auth["method"]!, path: auth["path"]!, ts: Int64(auth["ts"]!)!, body: auth["body"]!)
        XCTAssertTrue(FriendCrypto.verify(sign: a.signPublic, text: auth["message"]!, signature: String(mine.split(separator: ".").last!)))
        let t = v["tokenHash"] as! [String: String]
        XCTAssertEqual(Friends.tokenHash(t["token"]!), t["hash"])
        XCTAssertEqual(FriendCrypto.safetyNumber(signA: a.signPublic, dhA: a.dhPublic, signB: b.signPublic, dhB: b.dhPublic), v["safetyNumber"] as? String)
        XCTAssertEqual(FriendCrypto.safetyNumber(signA: b.signPublic, dhA: b.dhPublic, signB: a.signPublic, dhB: a.dhPublic), v["safetyNumber"] as? String)
    }

    func testSealingMatchesTheJavaScriptBlobAndOpens() throws {
        let v = try vectors()
        let s = v["seal"] as! [String: Any]
        let a = identity(v, 0), b = identity(v, 1), box = s["recipientBox"] as! String, text = s["bodyText"] as! String
        // The JavaScript blob opens here, and its signature checks out.
        let opened = try XCTUnwrap(FriendCrypto.open(blob: s["blob"] as! String, kind: "msg", myBox: box, dhSeed: b.dhSeed))
        XCTAssertEqual(opened.text, text)
        XCTAssertTrue(FriendCrypto.isFrom(signPublic: a.signPublic, myBox: box, kind: "msg", opened: opened))
        XCTAssertFalse(FriendCrypto.isFrom(signPublic: b.signPublic, myBox: box, kind: "msg", opened: opened))
        XCTAssertNil(FriendCrypto.open(blob: s["blob"] as! String, kind: "req", myBox: box, dhSeed: b.dhSeed), "the kind is authenticated")
        XCTAssertNil(FriendCrypto.open(blob: s["blob"] as! String, kind: "msg", myBox: Friends.box(for: "ZZZZZZZZZZ"), dhSeed: b.dhSeed), "so is the box")
        XCTAssertNil(FriendCrypto.open(blob: s["blob"] as! String, kind: "msg", myBox: box, dhSeed: a.dhSeed), "the wrong key can't open it")
        // Our own seal with the same fixed inputs gives the identical bytes (except the signature, which we only require to verify).
        let mine = try FriendCrypto.seal(bodyText: text, kind: "msg", from: a, toBox: box, toDH: b.dhPublic,
                                         ephSeed: Friends.unb64u(s["ephSeed"] as! String), nonce: Friends.unb64u(s["nonce"] as! String))
        let back = try XCTUnwrap(FriendCrypto.open(blob: mine, kind: "msg", myBox: box, dhSeed: b.dhSeed))
        XCTAssertEqual(back.text, text)
        XCTAssertTrue(FriendCrypto.isFrom(signPublic: a.signPublic, myBox: box, kind: "msg", opened: back))
        XCTAssertEqual(String(mine.prefix(57)), String((s["blob"] as! String).prefix(57)), "same ephemeral key and nonce")
        // A flipped bit anywhere is refused.
        var raw = Friends.unb64u(mine)!; raw[raw.count - 3] ^= 1
        XCTAssertNil(FriendCrypto.open(blob: Friends.b64u(raw), kind: "msg", myBox: box, dhSeed: b.dhSeed))
    }

    func testBodiesRoundTripAndNamesAreCleaned() {
        let body = FriendBody(t: "msg", from: "abc", id: "1", text: "hi \"you\" / \\ ✓", ts: 5)
        XCTAssertEqual(FriendBody.decode(body.encoded()), body)
        XCTAssertEqual(FriendsBook.clean("  Ana\u{202E}\n  "), "Ana")
        XCTAssertEqual(FriendsBook.clean(String(repeating: "x", count: 100))?.count, 32)
        XCTAssertNil(FriendsBook.clean("   "))
    }

    // MARK: The rules

    private func request(_ id: FriendIdentity, token: String = "tok", nick: String? = "Ali") -> FriendBody {
        FriendBody(t: "req", box: id.box, sign: Friends.b64u(id.signPublic), dh: Friends.b64u(id.dhPublic), nick: nick, token: token, ts: 1)
    }

    func testRequestAcceptFlowAndMessages() throws {
        let alice = FriendIdentity.generate()
        var bob = FriendsBook()
        guard case .added(let incoming) = bob.receiveRequest(request(alice)) else { return XCTFail("a new request should be added") }
        XCTAssertEqual(incoming.status, .incoming)
        XCTAssertNil(bob.receiveMessage(from: alice.box, id: "m0", text: "too early", ts: nil), "no messages before both sides agree")
        XCTAssertEqual(bob.receiveRequest(request(alice)), .ignored, "a repeated request is not shown twice")
        let mine = Friends.newToken()
        let accepted = try XCTUnwrap(bob.accept(box: alice.box, myTokenHash: mine.hash))
        XCTAssertEqual(accepted.status, .active); XCTAssertEqual(accepted.sendToken, "tok"); XCTAssertEqual(accepted.myTokenHash, mine.hash)
        let m = try XCTUnwrap(bob.receiveMessage(from: alice.box, id: "m1", text: "hello", ts: 1_790_000_000_000))
        XCTAssertEqual(m.text, "hello"); XCTAssertEqual(bob.record(alice.box)?.unread, 1)
        XCTAssertNil(bob.receiveMessage(from: alice.box, id: "m1", text: "hello", ts: nil), "the same id twice is dropped")
        XCTAssertNil(bob.receiveMessage(from: "stranger", id: "m2", text: "hi", ts: nil))
        XCTAssertNil(bob.receiveMessage(from: alice.box, id: "m3", text: String(repeating: "x", count: 2001), ts: nil))
        bob.markRead(box: alice.box); XCTAssertEqual(bob.record(alice.box)?.unread, 0)
    }

    func testOutgoingRequestBecomesActiveOnAcceptance() throws {
        let alice = FriendIdentity.generate(), bob = FriendIdentity.generate()
        var book = FriendsBook()
        book.addOutgoing(box: bob.box, sign: bob.signPublic, dh: bob.dhPublic, alias: nil, myTokenHash: "h")
        XCTAssertNil(book.receiveMessage(from: bob.box, id: "x", text: "hi", ts: nil), "not friends yet")
        var wrong = FriendBody(t: "acc", box: bob.box, sign: Friends.b64u(alice.signPublic), dh: Friends.b64u(bob.dhPublic), token: "t")
        XCTAssertNil(book.receiveAcceptance(wrong), "keys that differ from the ones I pinned are refused")
        wrong.sign = Friends.b64u(bob.signPublic)
        let r = try XCTUnwrap(book.receiveAcceptance(wrong))
        XCTAssertEqual(r.status, .active); XCTAssertEqual(r.sendToken, "t")
        XCTAssertNotNil(book.receiveMessage(from: bob.box, id: "y", text: "hi", ts: nil))
    }

    func testTwoRequestsAtOnceMakeFriends() {
        let alice = FriendIdentity.generate(), bob = FriendIdentity.generate()
        var book = FriendsBook()
        book.addOutgoing(box: bob.box, sign: bob.signPublic, dh: bob.dhPublic, alias: nil, myTokenHash: "h")
        guard case .mutual(let r) = book.receiveRequest(request(bob, token: "theirs")) else { return XCTFail("both asked: that is agreement") }
        XCTAssertEqual(r.status, .active); XCTAssertEqual(r.sendToken, "theirs")
        _ = alice
    }

    func testBlockingAndKeyChanges() throws {
        let alice = FriendIdentity.generate()
        var book = FriendsBook()
        _ = book.receiveRequest(request(alice))
        book.block(box: alice.box)
        XCTAssertNil(book.record(alice.box)); XCTAssertEqual(book.vault.blocked.count, 1)
        XCTAssertEqual(book.receiveRequest(request(alice)), .ignored, "a blocked person is dropped silently")
        // The same address with different keys is never accepted over an existing friend.
        let carol = FriendIdentity.generate()
        _ = book.receiveRequest(request(carol))
        var impostor = request(carol); impostor.sign = Friends.b64u(FriendIdentity.generate().signPublic)
        XCTAssertEqual(book.receiveRequest(impostor), .ignored)
        book.remove(box: carol.box)
        XCTAssertNil(book.record(carol.box))
    }

    func testMessageStatesOnlyMoveForward() {
        var book = FriendsBook()
        book.addMine(to: "b", id: "1", text: "x")
        book.setState(box: "b", id: "1", .sent); book.setState(box: "b", id: "1", .read); book.setState(box: "b", id: "1", .delivered)
        XCTAssertEqual(book.vault.messages["b"]?.first?.state, .read)
        book.setState(box: "b", id: "1", .failed)
        XCTAssertEqual(book.vault.messages["b"]?.first?.state, .read, "a delivered message can't become failed")
        book.addMine(to: "b", id: "2", text: "y"); book.setState(box: "b", id: "2", .failed)
        XCTAssertEqual(book.vault.messages["b"]?.last?.state, .failed)
    }

    func testTheVaultRoundTripsThroughJSON() throws {
        let alice = FriendIdentity.generate()
        var book = FriendsBook()
        _ = book.receiveRequest(request(alice)); _ = book.accept(box: alice.box, myTokenHash: "h")
        _ = book.receiveMessage(from: alice.box, id: "1", text: "hi", ts: nil)
        let data = try JSONEncoder().encode(book.vault)
        XCTAssertEqual(try JSONDecoder().decode(FriendsVault.self, from: data), book.vault)
    }

    // MARK: Groups and files

    private func twoFriends() -> (FriendsBook, FriendIdentity, FriendIdentity) {
        let a = FriendIdentity.generate(), b = FriendIdentity.generate()
        var book = FriendsBook()
        for id in [a, b] { _ = book.receiveRequest(request(id)); _ = book.accept(box: id.box, myTokenHash: "h") }
        return (book, a, b)
    }

    func testAVaultSavedBeforeGroupsStillLoads() throws {
        let (book, _, _) = twoFriends()
        var json = try XCTUnwrap(JSONSerialization.jsonObject(with: JSONEncoder().encode(book.vault)) as? [String: Any])
        json["groups"] = nil
        let old = try JSONSerialization.data(withJSONObject: json)
        let loaded = try JSONDecoder().decode(FriendsVault.self, from: old)
        XCTAssertEqual(loaded.friends.count, 2, "a missing `groups` key must not wipe the friend list")
        XCTAssertTrue(loaded.groups.isEmpty)
    }

    func testMakingAndReceivingAGroup() throws {
        var (book, a, b) = twoFriends()
        XCTAssertNil(book.createGroup(name: "x", members: ["not-a-friend"]), "only friends can be added")
        let g = try XCTUnwrap(book.createGroup(name: "  Study\ngroup ", members: [a.box, b.box]))
        XCTAssertEqual(g.name, "Study group")
        XCTAssertEqual(Set(g.members), [a.box, b.box])

        // The other side: Alice's Mac receives the invite from me.
        let me = FriendIdentity.generate()
        var theirs = FriendsBook()
        _ = theirs.receiveRequest(request(me)); _ = theirs.accept(box: me.box, myTokenHash: "h")
        var invite = FriendBody(t: "grp", from: me.box); invite.g = g.id; invite.gname = "Study"; invite.gm = [me.box, a.box, b.box]
        XCTAssertNil(theirs.receiveGroup(from: me.box, invite, myBox: "someone-else"), "an invite that doesn't list me is ignored")
        let got = try XCTUnwrap(theirs.receiveGroup(from: me.box, invite, myBox: a.box))
        XCTAssertEqual(Set(got.members), [me.box, b.box])
        XCTAssertEqual(got.creator, me.box)
        // Only whoever made it can change it.
        _ = theirs.receiveRequest(request(b)); _ = theirs.accept(box: b.box, myTokenHash: "h")
        var hijack = invite; hijack.gname = "Hijacked"
        XCTAssertNil(theirs.receiveGroup(from: b.box, hijack, myBox: a.box))
        XCTAssertEqual(theirs.group(got.key)?.name, "Study")
    }

    func testGroupMessagesComeOnlyFromMembersAndOnlyOnce() throws {
        var (book, a, b) = twoFriends()
        let g = try XCTUnwrap(book.createGroup(name: "G", members: [a.box]))
        XCTAssertNotNil(book.receiveGroupMessage(from: a.box, group: g.id, id: "m1", text: "hi", ts: nil))
        XCTAssertNil(book.receiveGroupMessage(from: a.box, group: g.id, id: "m1", text: "hi", ts: nil), "a repeat is dropped")
        XCTAssertNil(book.receiveGroupMessage(from: b.box, group: g.id, id: "m2", text: "hi", ts: nil), "b is a friend but not in the group")
        XCTAssertNil(book.receiveGroupMessage(from: a.box, group: "nope", id: "m3", text: "hi", ts: nil))
        XCTAssertEqual(book.group(g.key)?.unread, 1)
        XCTAssertEqual(book.vault.messages[g.key]?.first?.by, a.box)
        book.receiveLeave(from: a.box, group: g.id)
        XCTAssertNil(book.receiveGroupMessage(from: a.box, group: g.id, id: "m4", text: "hi", ts: nil), "after leaving they can't post")
    }

    func testFilesAreCheckedAndKeptApart() throws {
        var (book, a, _) = twoFriends()
        XCTAssertEqual(FriendsBook.cleanFileName("../../etc/passwd"), "passwd")
        XCTAssertEqual(FriendsBook.cleanFileName("C:\\Users\\x\\a.png"), "a.png")
        XCTAssertNil(FriendsBook.cleanFileName(".."))
        XCTAssertNil(FriendsBook.cleanFileName("///"))
        XCTAssertTrue(Friends.isPlainID(UUID().uuidString)); XCTAssertFalse(Friends.isPlainID("../x")); XCTAssertFalse(Friends.isPlainID(""))
        XCTAssertNil(book.receiveFile(from: a.box, group: nil, id: "f1", name: "x", size: Friends.maxFileBytes + 1), "too big")
        XCTAssertNil(book.receiveFile(from: "stranger", group: nil, id: "f1", name: "x", size: 10), "only friends")
        let m = try XCTUnwrap(book.receiveFile(from: a.box, group: nil, id: "f1", name: "a/b.png", size: 10))
        XCTAssertEqual(m.file, FriendFile(name: "b.png", size: 10))
        XCTAssertNil(book.receiveFile(from: a.box, group: nil, id: "f1", name: "b.png", size: 10), "the same file twice is dropped")
        XCTAssertEqual(book.record(a.box)?.unread, 1)
        // A sealed chunk is far below the relay's ~16 KB limit.
        XCTAssertEqual(Friends.maxFileBytes, 2_000_000)
    }

    func testAChunkFitsTheRelayLimit() throws {
        let me = FriendIdentity.generate(), you = FriendIdentity.generate()
        var body = FriendBody(t: "chunk", from: me.box, id: UUID().uuidString, ts: 1)
        body.g = UUID().uuidString; body.fname = String(repeating: "n", count: 80); body.fn = 250; body.fi = 249
        body.fd = Friends.b64u(Data((0..<Friends.chunkSize).map { _ in UInt8.random(in: 0...255) }))
        let blob = try FriendCrypto.seal(bodyText: body.encoded(), kind: "msg", from: me, toBox: you.box, toDH: you.dhPublic)
        XCTAssertLessThan(blob.count, 22000, "the relay refuses blobs over 22000 characters")
        let opened = try XCTUnwrap(FriendCrypto.open(blob: blob, kind: "msg", myBox: you.box, dhSeed: you.dhSeed))
        XCTAssertEqual(FriendBody.decode(opened.text), body)
    }

    func testTicTacToeMovesRideInsideAFriendBody() throws {
        var body = FriendBody(t: "game", from: "a", ts: 1)
        body.ttt = TicTacToe.invite(gid: "abc", mark: .x)
        let back = try XCTUnwrap(FriendBody.decode(body.encoded()))
        XCTAssertEqual(back, body)
        // Two friends run the same rules: the inviter starts the game when the friend accepts.
        var game = TicTacToe.reduce(nil, try XCTUnwrap(back.ttt), from: "a")
        game = TicTacToe.reduce(game, TicTacToe.accept(gid: "abc"), from: "b")
        let g = try XCTUnwrap(game)
        game = TicTacToe.reduce(game, TicTacToe.start(g, acceptor: "b"), from: "a")
        XCTAssertEqual(game?.status, .playing)
        XCTAssertEqual(game?.x, "a"); XCTAssertEqual(game?.o, "b")
    }
}
