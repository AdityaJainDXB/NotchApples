//
//  BambuCloudLogic.swift
//  Notch Apple
//
//  Signing in to Bambu Cloud, so a printer can be watched without LAN Mode (which turns the printer's cloud features off).
//
//  How it stays safe:
//   - the password goes only to Bambu (api.bambulab.com, or .cn) over https, from this Mac. It lives in memory for the one
//     sign-in call, is never saved or logged, and the sign-in form clears it straight after;
//   - what is kept is the access token Bambu returns, in the owner-only secrets file (KeychainHelper), and the printer is
//     then reached through Bambu's own MQTT broker, checked against the system's trusted authorities;
//   - only Bambu's two regions are known: no other address can be given to this code.
//
//  Bambu has no official API for this. The calls follow what the community has documented, so any step can stop working
//  when Bambu changes it: every failure becomes a plain message that points back to LAN Mode. Pure parsing and request
//  building live here (tested); the manager does the networking. It mirrors the Windows app's bambucloudlogic.js.
//

import Foundation

enum BambuCloud {
    struct Region {
        let name: String
        let api: String
        let web: String
        let mqttHost: String
    }

    static let regions: [String: Region] = [
        "global": Region(name: "Global (most accounts)", api: "https://api.bambulab.com", web: "https://bambulab.com", mqttHost: "us.mqtt.bambulab.com"),
        "china": Region(name: "China", api: "https://api.bambulab.cn", web: "https://bambulab.cn", mqttHost: "cn.mqtt.bambulab.com"),
    ]
    static let regionOrder = ["global", "china"]

    static let fallback = "Bambu’s sign-in did not work. It may have changed, so use LAN Mode on the printer instead."
    static let offline = "Couldn’t reach Bambu. Check your internet connection."
    static let expired = "Bambu Cloud refused the saved sign-in. It has probably expired: sign in again under Printer Status → Bambu account."

    /// What an answer to a sign-in call means.
    enum SignIn: Equatable {
        case ok(token: String)
        case verify
        case tfa(key: String)
        case error(String)
    }

    /// An answer from Bambu, reduced to what the readers need.
    struct Answer {
        var status: Int
        var body: Data
        var headers: [String: String]   // lower-cased names
        var text: String { String(data: body, encoding: .utf8) ?? "" }
        var json: [String: Any]? { (try? JSONSerialization.jsonObject(with: body)) as? [String: Any] }
        var isHTML: Bool { text.trimmingCharacters(in: .whitespacesAndNewlines).hasPrefix("<") }
    }

    struct Device: Equatable, Identifiable {
        var serial: String
        var name: String
        var model: String
        var online: Bool
        var id: String { serial }
    }

    /// The signed-in account: kept in the owner-only secrets file. Never the password.
    struct Session: Codable, Equatable {
        var region: String
        var uid: String
        var token: String

        var isValid: Bool {
            regions[region] != nil
                && !uid.isEmpty && uid.utf8.count <= 20 && uid.utf8.allSatisfy { $0 >= 48 && $0 <= 57 }
                && BambuCloud.looksLikeToken(token)
        }
        /// The MQTT user name Bambu's broker expects.
        var mqttUser: String { "u_\(uid)" }
    }

    static func looksLikeToken(_ t: String) -> Bool {
        t.utf8.count >= 20 && t.utf8.count <= 8192 && !t.contains(where: { $0.isWhitespace || $0.isNewline })
    }
    static func looksLikeEmail(_ s: String) -> Bool {
        let t = s.trimmingCharacters(in: .whitespacesAndNewlines)
        guard let at = t.firstIndex(of: "@"), at != t.startIndex else { return false }
        let domain = t[t.index(after: at)...]
        return !t.contains(" ") && domain.contains(".") && !domain.hasPrefix(".") && !domain.hasSuffix(".") && t.filter({ $0 == "@" }).count == 1
    }

    // MARK: Reading answers

    static func readSignIn(_ a: Answer) -> SignIn {
        if a.isHTML { return .error("Bambu asked for a browser check before it would sign in. Try again later, or use LAN Mode on the printer.") }
        if a.status == 429 { return .error("Bambu is limiting sign-ins right now. Wait a few minutes and try again.") }
        let j = a.json
        if let token = j?["accessToken"] as? String, looksLikeToken(token) { return .ok(token: token) }
        if let type = j?["loginType"] as? String {
            if type == "verifyCode" { return .verify }
            if type == "tfa", let key = j?["tfaKey"] as? String, !key.isEmpty { return .tfa(key: key) }
        }
        if [400, 401, 403].contains(a.status) || (j?["success"] as? Bool) == false {
            return .error("Bambu did not accept that. Check the email, password or code.")
        }
        return .error(fallback)
    }

    /// The numeric account id from the preference answer (it becomes the MQTT user name, so only digits are accepted).
    static func readUid(_ j: [String: Any]?) -> String? {
        guard let j else { return nil }
        let v = j["uid"] ?? j["uId"] ?? j["userId"]
        let s: String
        if let n = v as? Int { s = String(n) } else if let n = v as? NSNumber, !(v is Bool) { s = n.stringValue } else if let t = v as? String { s = t.trimmingCharacters(in: .whitespaces) } else { return nil }
        return !s.isEmpty && s.utf8.count <= 20 && s.utf8.allSatisfy({ $0 >= 48 && $0 <= 57 }) ? s : nil
    }

    /// The printers on the account: odd entries are dropped and names are cleaned.
    static func readDevices(_ j: [String: Any]?) -> [Device] {
        guard let list = j?["devices"] as? [[String: Any]] else { return [] }
        func clean(_ v: Any?) -> String {
            let t = (v as? String ?? "").unicodeScalars.filter { $0.value >= 32 && $0 != "<" && $0 != ">" }
            return String(String.UnicodeScalarView(t)).trimmingCharacters(in: .whitespaces).prefix(40).description
        }
        return list.compactMap { d in
            guard let serial = BambuStatusLogic.normalizeSerial(d["dev_id"] as? String ?? "") else { return nil }
            let model = clean(d["dev_product_name"])
            let name = clean(d["name"])
            return Device(serial: serial, name: name.isEmpty ? (model.isEmpty ? "Bambu printer" : model) : name, model: model, online: (d["online"] as? Bool) ?? false)
        }
    }

    // MARK: Building requests (only Bambu's own addresses)

    private static func post(_ url: String, _ body: [String: Any], headers: [String: String] = [:]) -> URLRequest? {
        guard let u = URL(string: url), u.scheme == "https", let data = try? JSONSerialization.data(withJSONObject: body) else { return nil }
        var r = URLRequest(url: u, timeoutInterval: 20)
        r.httpMethod = "POST"; r.httpBody = data; r.httpShouldHandleCookies = false
        r.setValue("application/json", forHTTPHeaderField: "Content-Type")
        r.setValue("Notch Apple", forHTTPHeaderField: "User-Agent")
        for (k, v) in headers { r.setValue(v, forHTTPHeaderField: k) }
        return r
    }
    private static func get(_ url: String, headers: [String: String] = [:]) -> URLRequest? {
        guard let u = URL(string: url), u.scheme == "https" else { return nil }
        var r = URLRequest(url: u, timeoutInterval: 20)
        r.httpMethod = "GET"; r.httpShouldHandleCookies = false
        r.setValue("Notch Apple", forHTTPHeaderField: "User-Agent")
        for (k, v) in headers { r.setValue(v, forHTTPHeaderField: k) }
        return r
    }

    static func loginRequest(region: String, account: String, password: String) -> URLRequest? {
        guard let reg = regions[region], looksLikeEmail(account), !password.isEmpty else { return nil }
        return post("\(reg.api)/v1/user-service/user/login", ["account": account.trimmingCharacters(in: .whitespaces), "password": password, "apiError": ""])
    }
    static func sendCodeRequest(region: String, account: String) -> URLRequest? {
        guard let reg = regions[region], looksLikeEmail(account) else { return nil }
        return post("\(reg.api)/v1/user-service/user/sendemail/code", ["email": account.trimmingCharacters(in: .whitespaces), "type": "codeLogin"])
    }
    static func codeLoginRequest(region: String, account: String, code: String) -> URLRequest? {
        let c = code.trimmingCharacters(in: .whitespaces)
        guard let reg = regions[region], looksLikeEmail(account), (4...8).contains(c.count), c.allSatisfy({ $0.isNumber }) else { return nil }
        return post("\(reg.api)/v1/user-service/user/login", ["account": account.trimmingCharacters(in: .whitespaces), "code": c])
    }
    static func csrfRequest(region: String) -> URLRequest? {
        guard let reg = regions[region] else { return nil }
        return get("\(reg.web)/api/csrf")
    }
    static func tfaRequest(region: String, key: String, code: String, csrf: Answer?) -> URLRequest? {
        let c = code.trimmingCharacters(in: .whitespaces)
        guard let reg = regions[region], c.count == 6, c.allSatisfy({ $0.isNumber }) else { return nil }
        var headers: [String: String] = [:]
        if let j = csrf?.json, let t = (j["csrfToken"] ?? j["token"] ?? j["csrf"]) as? String { headers["x-csrf-token"] = t }
        if let cookie = csrf?.headers["set-cookie"]?.split(separator: ";").first { headers["Cookie"] = String(cookie) }
        return post("\(reg.web)/api/sign-in/tfa", ["tfaKey": key, "tfaCode": c], headers: headers)
    }
    static func preferenceRequest(region: String, token: String) -> URLRequest? {
        guard let reg = regions[region], looksLikeToken(token) else { return nil }
        return get("\(reg.api)/v1/design-user-service/my/preference", headers: ["Authorization": "Bearer \(token)"])
    }
    static func devicesRequest(region: String, token: String) -> URLRequest? {
        guard let reg = regions[region], looksLikeToken(token) else { return nil }
        return get("\(reg.api)/v1/iot-service/api/user/bind", headers: ["Authorization": "Bearer \(token)"])
    }

    /// After the authenticator step the token can come back in the body or as a `token` cookie.
    static func readTfa(_ a: Answer) -> SignIn {
        let fromBody = readSignIn(a)
        if case .ok = fromBody { return fromBody }
        if let cookie = a.headers["set-cookie"], let r = cookie.range(of: #"(?:^|[;,\s])token=([^;,\s]+)"#, options: .regularExpression) {
            let piece = String(cookie[r]).trimmingCharacters(in: CharacterSet(charactersIn: ";, \t"))
            let token = String(piece.dropFirst("token=".count))
            if looksLikeToken(token) { return .ok(token: token) }
        }
        if case .error = fromBody { return fromBody }
        return .error(fallback)
    }

    // MARK: Doing it (one URLSession with no cookie jar and no cache: nothing about the sign-in is written to disk)

    static let session: URLSession = {
        let c = URLSessionConfiguration.ephemeral
        c.httpCookieStorage = nil; c.httpShouldSetCookies = false; c.urlCache = nil; c.requestCachePolicy = .reloadIgnoringLocalCacheData
        return URLSession(configuration: c)
    }()

    static func send(_ request: URLRequest?) async -> Answer? {
        guard let request, request.url?.scheme == "https" else { return nil }
        do {
            let (data, resp) = try await session.data(for: request)
            guard let http = resp as? HTTPURLResponse else { return nil }
            var headers: [String: String] = [:]
            for (k, v) in http.allHeaderFields { if let k = k as? String, let v = v as? String { headers[k.lowercased()] = v } }
            return Answer(status: http.statusCode, body: data, headers: headers)
        } catch { return nil }
    }

    static func signIn(region: String, account: String, password: String) async -> SignIn {
        guard regions[region] != nil else { return .error("Unknown Bambu account region.") }
        guard let req = loginRequest(region: region, account: account, password: password) else { return .error("Enter the email and password of your Bambu account.") }
        guard let a = await send(req) else { return .error(offline) }
        return readSignIn(a)
    }
    static func sendCode(region: String, account: String) async -> String? {
        guard let a = await send(sendCodeRequest(region: region, account: account)) else { return offline }
        if (200..<300).contains(a.status) { return nil }
        return a.status == 429 ? "Bambu is limiting codes right now. Wait a few minutes." : "Bambu would not send a code. Try again in a moment."
    }
    static func signIn(region: String, account: String, code: String) async -> SignIn {
        guard let req = codeLoginRequest(region: region, account: account, code: code) else { return .error("The code is the six digits Bambu emailed you.") }
        guard let a = await send(req) else { return .error(offline) }
        return readSignIn(a)
    }
    static func signIn(region: String, tfaKey: String, code: String) async -> SignIn {
        let csrf = await send(csrfRequest(region: region))
        guard let req = tfaRequest(region: region, key: tfaKey, code: code, csrf: csrf) else { return .error("The code is the six digits from your authenticator app.") }
        guard let a = await send(req) else { return .error(offline) }
        return readTfa(a)
    }
    /// The account id and printers for a token, or a plain message.
    struct AccountInfo { var uid: String; var devices: [Device] }
    static func account(region: String, token: String) async -> (info: AccountInfo?, message: String?) {
        guard let pref = await send(preferenceRequest(region: region, token: token)) else { return (nil, offline) }
        guard (200..<300).contains(pref.status), !pref.isHTML else { return (nil, pref.status == 401 ? "Bambu refused the sign-in. Try again." : fallback) }
        guard let uid = readUid(pref.json) else { return (nil, fallback) }
        guard let bind = await send(devicesRequest(region: region, token: token)), (200..<300).contains(bind.status), !bind.isHTML else { return (nil, fallback) }
        return (AccountInfo(uid: uid, devices: readDevices(bind.json)), nil)
    }
}
