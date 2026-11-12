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

    // MARK: Game challenges (issue #58)

    func testAGameChallengeShowsInTheChatLikeAMessageAndRaisesUnread() throws {
        var (book, a, _) = twoFriends()
        let m = try XCTUnwrap(book.receiveChallenge(from: a.box, gid: "gid42", game: "Connect Four"))
        XCTAssertFalse(m.mine)
        XCTAssertTrue(m.text.hasPrefix(FriendsBook.challengeLine(name: try XCTUnwrap(book.record(a.box)).displayName, game: "Connect Four")))
        XCTAssertTrue(m.text.contains("Accept"))
        XCTAssertEqual(book.record(a.box)?.unread, 1)
        XCTAssertEqual(book.vault.messages[a.box]?.count, 1)
        XCTAssertNil(book.receiveChallenge(from: a.box, gid: "gid42", game: "Connect Four"), "the same invite twice is one line")
        XCTAssertEqual(book.record(a.box)?.unread, 1)
        XCTAssertNotNil(book.receiveChallenge(from: a.box, gid: "gid43", game: "Chess"))
        XCTAssertEqual(book.record(a.box)?.unread, 2)
        XCTAssertNil(book.receiveChallenge(from: "nobody", gid: "g", game: "Chess"))
        book.markRead(box: a.box)
        XCTAssertEqual(book.record(a.box)?.unread, 0)
    }

    // MARK: Clear chat

    private func clr(_ epoch: Int, g: String? = nil, ts: Int64? = nil) -> FriendBody {
        var b = FriendBody(t: "clr", from: "x", ts: ts ?? Int64(Date().timeIntervalSince1970 * 1000)); b.ce = epoch; b.g = g; return b
    }

    func testClearingLocallyWipesEverythingButKeepsTheFriend() throws {
        var (book, a, _) = twoFriends()
        _ = book.receiveMessage(from: a.box, id: "m1", text: "secret", ts: nil)
        book.addMine(to: a.box, id: "m2", text: "my private words")
        _ = book.receiveFile(from: a.box, group: nil, id: "f1", name: "x.png", size: 10)
        book.addMineFile(to: a.box, id: "f2", file: FriendFile(name: "y.png", size: 5))
        XCTAssertEqual(book.record(a.box)?.unread, 2)
        let out = try XCTUnwrap(book.clearChat(a.box))
        XCTAssertEqual(Set(out.files), ["f1", "f2"], "the caller must delete these saved files")
        XCTAssertEqual(out.epoch, 1)
        let left = book.vault.messages[a.box] ?? []
        XCTAssertEqual(left.count, 1, "only the line that says it was cleared is left")
        XCTAssertEqual(left.first?.text, "You cleared this chat")
        XCTAssertEqual(book.record(a.box)?.unread, 0)
        XCTAssertEqual(book.record(a.box)?.status, .active, "clearing never unfriends")
        XCTAssertNil(book.clearChat("g:nothing"), "an unknown chat can't be cleared")
        let json = String(decoding: try JSONEncoder().encode(book.vault), as: UTF8.self)
        XCTAssertFalse(json.contains("secret") || json.contains("private words") || json.contains("x.png") || json.contains("y.png"), "no text of the old chat is left anywhere in the vault")
    }

    func testAClearArrivingOnlineWipesTheOldChatAndLeavesOneLine() throws {
        var (book, a, _) = twoFriends()
        _ = book.receiveMessage(from: a.box, id: "m1", text: "old", ts: nil)
        book.addMine(to: a.box, id: "m2", text: "old mine")
        _ = book.receiveFile(from: a.box, group: nil, id: "f1", name: "x.png", size: 10)
        let out = try XCTUnwrap(book.receiveClear(from: a.box, clr(1)))
        XCTAssertEqual(out.files, ["f1"])
        let left = book.vault.messages[a.box] ?? []
        XCTAssertEqual(left.map(\.text), ["\(book.record(a.box)!.displayName) cleared this chat"])
        XCTAssertEqual(book.record(a.box)?.unread, 0)
        XCTAssertNil(book.receiveClear(from: a.box, clr(1)), "the same clear twice does nothing more")
        XCTAssertEqual(book.vault.messages[a.box]?.count, 1)
    }

    func testAClearThatWaitedOfflineStillKeepsWhatCameAfterIt() throws {
        // I was offline. The friend sent two messages, cleared, then sent one more (epoch 1). The relay hands them over in order.
        var (book, a, _) = twoFriends()
        _ = book.receiveMessage(from: a.box, id: "m1", text: "before 1", ts: nil, ce: 0)
        _ = book.receiveMessage(from: a.box, id: "m2", text: "before 2", ts: nil, ce: 0)
        XCTAssertNotNil(book.receiveClear(from: a.box, clr(1)))
        XCTAssertNotNil(book.receiveMessage(from: a.box, id: "m3", text: "after", ts: nil, ce: 1))
        XCTAssertEqual((book.vault.messages[a.box] ?? []).filter { !$0.isNotice }.map(\.text), ["after"])
        XCTAssertEqual(book.record(a.box)?.unread, 1)
    }

    func testAMessageThatOvertakesTheClearSurvivesIt() throws {
        // The message sent after the clear (epoch 1) reaches me before the clear does. Old messages still go when the clear arrives.
        var (book, a, _) = twoFriends()
        _ = book.receiveMessage(from: a.box, id: "old", text: "old", ts: nil, ce: 0)
        XCTAssertNotNil(book.receiveMessage(from: a.box, id: "new", text: "new", ts: nil, ce: 1))
        XCTAssertNotNil(book.receiveClear(from: a.box, clr(1)))
        XCTAssertEqual((book.vault.messages[a.box] ?? []).filter { !$0.isNotice }.map(\.text), ["new"])
    }

    func testAMessageFromBeforeTheClearCannotComeBack() throws {
        var (book, a, _) = twoFriends()
        _ = book.receiveMessage(from: a.box, id: "m1", text: "old", ts: nil, ce: 0)
        _ = try XCTUnwrap(book.clearChat(a.box))                     // I clear: epoch 1
        // A late copy of the old message (a relay retry, the friend's retry button) and a pre-clear message of theirs arrive.
        XCTAssertNil(book.receiveMessage(from: a.box, id: "m1", text: "old", ts: nil, ce: 0))
        XCTAssertNil(book.receiveMessage(from: a.box, id: "m9", text: "sent before they heard", ts: nil, ce: 0))
        XCTAssertNil(book.receiveFile(from: a.box, group: nil, id: "f9", name: "x.png", size: 4, ce: 0))
        XCTAssertNotNil(book.receiveMessage(from: a.box, id: "m10", text: "after", ts: nil, ce: 1), "a message from after the clear is kept")
        // And what I send now carries the new epoch, so they keep it.
        book.addMine(to: a.box, id: "mine2", text: "new")
        XCTAssertEqual(book.vault.messages[a.box]?.last?.ce, 1)
        // An older clear arriving late does nothing.
        XCTAssertNil(book.receiveClear(from: a.box, clr(1)))
    }

    func testTwoPeopleClearingAtTheSameTimeEndUpClean() throws {
        var (book, a, _) = twoFriends()
        book.addMine(to: a.box, id: "m1", text: "x")
        let mine = try XCTUnwrap(book.clearChat(a.box))
        XCTAssertNil(book.receiveClear(from: a.box, clr(mine.epoch)), "their clear has the same epoch: already applied")
        XCTAssertEqual(book.vault.messages[a.box]?.count, 1)
        // Their later clear (epoch 2) still works.
        XCTAssertNotNil(book.receiveClear(from: a.box, clr(2)))
        XCTAssertEqual(book.epoch(a.box), 2)
    }

    func testClearsAreCheckedLikeEverythingElse() throws {
        var (book, a, b) = twoFriends()
        _ = book.receiveMessage(from: a.box, id: "m1", text: "keep me", ts: nil)
        XCTAssertNil(book.receiveClear(from: "stranger", clr(1)), "only a friend can clear")
        XCTAssertNil(book.receiveClear(from: a.box, clr(0)))
        XCTAssertNil(book.receiveClear(from: a.box, clr(-4)))
        XCTAssertNil(book.receiveClear(from: a.box, clr(FriendsBook.maxEpoch + 1)))
        var wrongType = clr(1); wrongType.t = "msg"
        XCTAssertNil(book.receiveClear(from: a.box, wrongType))
        var noEpoch = clr(1); noEpoch.ce = nil
        XCTAssertNil(book.receiveClear(from: a.box, noEpoch))
        XCTAssertNil(book.receiveClear(from: a.box, clr(1, g: "nope")), "a group that doesn't exist")
        XCTAssertEqual(book.vault.messages[a.box]?.count, 1, "nothing was wiped by any of those")
        // A friend can only clear their own chat with me, never someone else's.
        _ = book.receiveMessage(from: b.box, id: "b1", text: "b", ts: nil)
        XCTAssertNotNil(book.receiveClear(from: a.box, clr(1)))
        XCTAssertEqual(book.vault.messages[b.box]?.count, 1)
    }

    func testClearingAGroupWipesItForEveryoneAndKeepsTheGroup() throws {
        var (book, a, b) = twoFriends()
        let g = try XCTUnwrap(book.createGroup(name: "G", members: [a.box, b.box]))
        _ = book.receiveGroupMessage(from: a.box, group: g.id, id: "g1", text: "hello", ts: nil)
        book.addMineToGroup(g.key, id: "g2", text: "mine")
        _ = book.receiveFile(from: b.box, group: g.id, id: "gf", name: "x.png", size: 3)
        // Any member can clear it; a friend who is not in the group cannot.
        var c = FriendsBook()
        let outsider = FriendIdentity.generate()
        _ = book.receiveRequest(request(outsider)); _ = book.accept(box: outsider.box, myTokenHash: "h")
        XCTAssertNil(book.receiveClear(from: outsider.box, clr(1, g: g.id)))
        let out = try XCTUnwrap(book.receiveClear(from: b.box, clr(1, g: g.id)))
        XCTAssertEqual(out.files, ["gf"])
        XCTAssertNotNil(book.group(g.key), "the group stays")
        XCTAssertEqual(book.group(g.key)?.unread, 0)
        XCTAssertEqual(book.vault.messages[g.key]?.count, 1)
        // Messages from the clearing round still drop out; a group message from after it is kept.
        XCTAssertNil(book.receiveGroupMessage(from: a.box, group: g.id, id: "g3", text: "late old", ts: nil, ce: 0))
        XCTAssertNotNil(book.receiveGroupMessage(from: a.box, group: g.id, id: "g4", text: "new", ts: nil, ce: 1))
        // My own clear of a group.
        let mine = try XCTUnwrap(book.clearChat(g.key))
        XCTAssertEqual(mine.epoch, 2)
        XCTAssertEqual(book.vault.messages[g.key]?.count, 1)
        c.vault = book.vault
    }

    func testMessagesFromAnAppThatKnowsNothingAboutClearingAreJudgedByTime() throws {
        var (book, a, _) = twoFriends()
        let clearedAt = Date(timeIntervalSince1970: 1_800_000_000)
        _ = try XCTUnwrap(book.clearChat(a.box, now: clearedAt))
        let before = Int64(clearedAt.timeIntervalSince1970 * 1000) - 5_000, after = Int64(clearedAt.timeIntervalSince1970 * 1000) + 5_000
        let later = clearedAt.addingTimeInterval(60)
        XCTAssertNil(book.receiveMessage(from: a.box, id: "o1", text: "sent before", ts: before, now: later), "no epoch, older than the clear")
        XCTAssertNotNil(book.receiveMessage(from: a.box, id: "o2", text: "sent after", ts: after, now: later))
    }

    func testAnAppThatDoesNotKnowTheClearTypeIgnoresItSafely() throws {
        // The body of a clear is ordinary JSON with a `t` older apps have no case for, so their switch falls through to "ignore".
        let wire = clr(3, g: "G1").encoded()
        let known = ["req", "acc", "msg", "rcpt", "typing", "gone", "grp", "gmsg", "gleave", "chunk", "game", "play"]   // what 2.2.42 understands
        let decoded = try XCTUnwrap(FriendBody.decode(wire))
        XCTAssertFalse(known.contains(decoded.t))
        // And an old app's own decoder (which has no `ce` field) still reads the body: unknown keys are skipped.
        struct Old: Codable { var t: String; var from: String?; var ts: Int64?; var g: String? }
        let old = try JSONDecoder().decode(Old.self, from: Data(wire.utf8))
        XCTAssertEqual(old.t, "clr")
        // New messages carry the epoch in a key old apps skip, and old apps' messages (no key) are still accepted by us.
        var m = FriendBody(t: "msg", from: "x", id: "i", text: "hi", ts: 1); m.ce = 2
        XCTAssertEqual(try JSONDecoder().decode(Old.self, from: Data(m.encoded().utf8)).t, "msg")
        XCTAssertNil(FriendBody.decode(#"{"t":"msg","id":"i","text":"hi"}"#)?.ce)
    }

    func testAVaultSavedBeforeClearingStillLoadsAndAClearSurvivesRestart() throws {
        var (book, a, _) = twoFriends()
        _ = book.receiveMessage(from: a.box, id: "m1", text: "x", ts: nil)
        var json = try XCTUnwrap(JSONSerialization.jsonObject(with: JSONEncoder().encode(book.vault)) as? [String: Any])
        json["clears"] = nil; json["pendingClears"] = nil
        let loaded = try JSONDecoder().decode(FriendsVault.self, from: JSONSerialization.data(withJSONObject: json))
        XCTAssertEqual(loaded.friends.count, 2); XCTAssertTrue(loaded.clears.isEmpty)
        // Clear, "quit the app", reopen: the epoch and the clear still waiting to be delivered are both remembered.
        let out = try XCTUnwrap(book.clearChat(a.box))
        book.queueClear(a.box, epoch: out.epoch, at: out.at, to: [a.box])
        let reopened = try JSONDecoder().decode(FriendsVault.self, from: JSONEncoder().encode(book.vault))
        var again = FriendsBook(); again.vault = reopened
        XCTAssertEqual(again.epoch(a.box), 1)
        XCTAssertEqual(again.vault.pendingClears[a.box]?.to, [a.box])
        XCTAssertNil(again.receiveMessage(from: a.box, id: "late", text: "old", ts: nil, ce: 0))
        again.clearDelivered(a.box, epoch: out.epoch, to: a.box)
        XCTAssertNil(again.vault.pendingClears[a.box], "once everyone has it nothing is left to send")
    }

    func testPendingClearsMergeAndNewerWins() {
        var book = FriendsBook()
        book.queueClear("k", epoch: 1, at: 10, to: ["a", "b"])
        book.queueClear("k", epoch: 1, at: 10, to: ["b", "c"])
        XCTAssertEqual(book.vault.pendingClears["k"]?.to, ["a", "b", "c"])
        book.queueClear("k", epoch: 2, at: 20, to: ["a"])
        XCTAssertEqual(book.vault.pendingClears["k"], PendingClear(epoch: 2, at: 20, to: ["a"]), "a newer clear replaces the older one")
        book.queueClear("k", epoch: 1, at: 10, to: ["z"])
        XCTAssertEqual(book.vault.pendingClears["k"]?.epoch, 2, "an older one never overrides")
        book.clearDelivered("k", epoch: 1, to: "a")
        XCTAssertEqual(book.vault.pendingClears["k"]?.to, ["a"], "delivering the older epoch changes nothing")
    }

    func testRelayTagsAreOpaqueAndDifferPerLinkAndPerChat() {
        let t1 = FriendsBook.chatTag(token: "tokenA", key: "chat1")
        XCTAssertEqual(t1.count, 32)
        XCTAssertEqual(t1, FriendsBook.chatTag(token: "tokenA", key: "chat1"))
        XCTAssertNotEqual(t1, FriendsBook.chatTag(token: "tokenB", key: "chat1"), "two mailboxes can't tell a group's messages belong together")
        XCTAssertNotEqual(t1, FriendsBook.chatTag(token: "tokenA", key: "chat2"))
        XCTAssertFalse(t1.contains("chat1"))
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

    // MARK: Unblocking one person

    func testABlockedPersonCanBeUnblockedOnTheirOwnAndReachesYouAgain() {
        let alice = FriendIdentity.generate(), bob = FriendIdentity.generate()
        var book = FriendsBook()
        _ = book.receiveRequest(request(alice)); _ = book.receiveRequest(request(bob))
        book.setAlias(box: alice.box, "Alice from school")
        book.block(box: alice.box); book.block(box: bob.box)
        XCTAssertEqual(book.blockedPeople.count, 2)
        XCTAssertEqual(book.blockedPeople.first?.name, "Alice from school")
        let aliceFP = book.blockedPeople[0].fingerprint
        book.unblock(fingerprint: aliceFP)
        XCTAssertEqual(book.blockedPeople.count, 1, "only Alice is unblocked")
        XCTAssertNil(book.vault.blockedNames[aliceFP])
        XCTAssertEqual(book.receiveRequest(request(bob)), .ignored, "Bob is still blocked")
        XCTAssertNotEqual(book.receiveRequest(request(alice)), .ignored, "Alice can send a request again")
        book.unblock(fingerprint: "not-in-the-list")
        XCTAssertEqual(book.blockedPeople.count, 1, "an unknown fingerprint changes nothing")
        book.unblockAll()
        XCTAssertTrue(book.blockedPeople.isEmpty); XCTAssertTrue(book.vault.blockedNames.isEmpty)
    }

    func testAVaultSavedBeforeBlockedNamesStillLoadsAndShowsAShortCode() throws {
        let old = Data(#"{"friends":[],"blocked":["abcd1234"]}"#.utf8)
        let v = try JSONDecoder().decode(FriendsVault.self, from: old)
        XCTAssertEqual(v.blocked, ["abcd1234"])
        let book = FriendsBook(vault: v)
        XCTAssertEqual(book.blockedPeople.first?.name, "Someone you blocked (ABCD)")
        let withNames = Data(#"{"blocked":["f1"],"blockedNames":{"f1":"Sam","other":"Not blocked"}}"#.utf8)
        XCTAssertEqual(try JSONDecoder().decode(FriendsVault.self, from: withNames).blockedNames, ["f1": "Sam"])
    }

    func testBlockedNamesSurviveEncoding() throws {
        let alice = FriendIdentity.generate()
        var book = FriendsBook()
        _ = book.receiveRequest(request(alice)); book.block(box: alice.box)
        let back = try JSONDecoder().decode(FriendsVault.self, from: JSONEncoder().encode(book.vault))
        XCTAssertEqual(back, book.vault)
        XCTAssertEqual(FriendsBook(vault: back).blockedPeople.count, 1)
    }
}
