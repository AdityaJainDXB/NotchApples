import XCTest

final class BambuCloudTests: XCTestCase {
    private let token = "eyJhbGciOiJSUzI1NiJ9." + String(repeating: "a", count: 40)
    private func answer(_ status: Int, _ json: Any? = nil, text: String? = nil, headers: [String: String] = [:]) -> BambuCloud.Answer {
        let data = text.map { Data($0.utf8) } ?? (json.flatMap { try? JSONSerialization.data(withJSONObject: $0) } ?? Data())
        return BambuCloud.Answer(status: status, body: data, headers: headers)
    }

    func testAGoodSignInGivesTheToken() {
        XCTAssertEqual(BambuCloud.readSignIn(answer(200, ["accessToken": token, "loginType": ""])), .ok(token: token))
    }
    func testBambuAskingForACodeIsUnderstood() {
        XCTAssertEqual(BambuCloud.readSignIn(answer(200, ["success": false, "loginType": "verifyCode"])), .verify)
        XCTAssertEqual(BambuCloud.readSignIn(answer(200, ["success": false, "loginType": "tfa", "tfaKey": "k1"])), .tfa(key: "k1"))
    }
    func testFailuresGetPlainMessages() {
        func msg(_ a: BambuCloud.Answer) -> String { if case .error(let m) = BambuCloud.readSignIn(a) { return m }; return "" }
        XCTAssertTrue(msg(answer(401, ["success": false])).contains("Check the email, password"))
        XCTAssertTrue(msg(answer(429, [:])).contains("limiting"))
        XCTAssertTrue(msg(answer(403, text: "<html>Just a moment...</html>")).contains("browser check"))
        XCTAssertTrue(msg(answer(200, ["weird": true])).contains("LAN Mode"))
    }
    func testTheTokenCanComeBackAsACookie() {
        XCTAssertEqual(BambuCloud.readTfa(answer(200, ["success": true], headers: ["set-cookie": "token=\(token); Path=/; HttpOnly"])), .ok(token: token))
    }
    func testThePasswordGoesOnlyToBambuOverHTTPS() {
        let g = BambuCloud.loginRequest(region: "global", account: "me@example.com", password: "hunter2")
        XCTAssertEqual(g?.url?.absoluteString, "https://api.bambulab.com/v1/user-service/user/login")
        XCTAssertEqual(BambuCloud.loginRequest(region: "china", account: "me@example.com", password: "x")?.url?.host, "api.bambulab.cn")
        XCTAssertNil(BambuCloud.loginRequest(region: "evil.example.com", account: "me@example.com", password: "x"))
        XCTAssertNil(BambuCloud.loginRequest(region: "global", account: "not-an-email", password: "x"))
        XCTAssertNil(BambuCloud.loginRequest(region: "global", account: "me@example.com", password: ""))
        XCTAssertEqual(g?.httpShouldHandleCookies, false)
    }
    func testCodesMustBeDigits() {
        XCTAssertNil(BambuCloud.codeLoginRequest(region: "global", account: "me@example.com", code: "abc"))
        XCTAssertNotNil(BambuCloud.codeLoginRequest(region: "global", account: "me@example.com", code: "123456"))
        XCTAssertNil(BambuCloud.tfaRequest(region: "global", key: "k", code: "12", csrf: nil))
        let csrf = answer(200, ["csrfToken": "tok"], headers: ["set-cookie": "csrf=abc; Path=/"])
        let t = BambuCloud.tfaRequest(region: "global", key: "k", code: "654321", csrf: csrf)
        XCTAssertEqual(t?.value(forHTTPHeaderField: "x-csrf-token"), "tok")
        XCTAssertEqual(t?.value(forHTTPHeaderField: "Cookie"), "csrf=abc")
    }
    func testTheAccountIdMustBeDigits() {
        XCTAssertEqual(BambuCloud.readUid(["uid": 1234567890]), "1234567890")
        XCTAssertEqual(BambuCloud.readUid(["uid": "42"]), "42")
        XCTAssertNil(BambuCloud.readUid(["uid": "12a"]))
        XCTAssertNil(BambuCloud.readUid(["uid": "u_5"]))
        XCTAssertNil(BambuCloud.readUid(nil))
    }
    func testThePrintersOnTheAccountAreReadAndCleaned() {
        let d = BambuCloud.readDevices(["devices": [
            ["dev_id": "01P00A123456789", "name": "Office <b>X1</b>", "dev_product_name": "X1 Carbon", "online": true],
            ["dev_id": "short", "name": "bad"], ["name": "no id"],
            ["dev_id": "03W00X987654321", "name": "", "dev_product_name": "P1S", "online": false]]])
        XCTAssertEqual(d.count, 2)
        XCTAssertEqual(d[0].name, "Office bX1/b")
        XCTAssertEqual(d[1].name, "P1S")
        XCTAssertTrue(d[0].online); XCTAssertFalse(d[1].online)
    }
    func testASessionIsCheckedBeforeItIsKept() {
        XCTAssertTrue(BambuCloud.Session(region: "global", uid: "123", token: token).isValid)
        XCTAssertFalse(BambuCloud.Session(region: "global", uid: "12a", token: token).isValid)
        XCTAssertFalse(BambuCloud.Session(region: "global", uid: "", token: token).isValid)
        XCTAssertFalse(BambuCloud.Session(region: "global", uid: "1", token: "short").isValid)
        XCTAssertFalse(BambuCloud.Session(region: "mars", uid: "1", token: token).isValid)
        XCTAssertEqual(BambuCloud.Session(region: "global", uid: "77", token: token).mqttUser, "u_77")
        XCTAssertEqual(BambuCloud.regions["global"]?.mqttHost, "us.mqtt.bambulab.com")
    }
}
