//
//  DevToolsView.swift
//  Notch apple
//
//  The Dev Tools tab (free, off until you turn it on in Settings → Modules): JSON, Base64 and URL encoding,
//  case changes, a JWT reader, hashes and ids, timestamps, a regex tester, a colour contrast checker and a QR code.
//  Every tool has "Paste" and "Copy", so it works on whatever you just copied. Runs on this Mac only.
//  The rules live in DevToolkitLogic.swift.
//

import AppKit
import CoreImage.CIFilterBuiltins
import SwiftUI

private enum DevTool: String, CaseIterable, Identifiable {
    case json = "JSON", encoding = "Base64 & URL", caseChange = "Case", jwt = "JWT", hashes = "Hashes & IDs", time = "Timestamps", regex = "Regex", contrast = "Contrast", qr = "QR code"
    var id: String { rawValue }
    var symbol: String {
        switch self {
        case .json: "curlybraces"
        case .encoding: "arrow.left.arrow.right"
        case .caseChange: "textformat"
        case .jwt: "key.horizontal"
        case .hashes: "number"
        case .time: "clock"
        case .regex: "asterisk"
        case .contrast: "circle.lefthalf.filled"
        case .qr: "qrcode"
        }
    }
}

struct DevToolsView: View {
    @AppStorage("devtools.tool") private var toolRaw = DevTool.json.rawValue
    @State private var input = ""
    @State private var output = ""
    @State private var note = ""
    @State private var pattern = ""
    @State private var ignoreCase = false
    @State private var colourA = "#777777"
    @State private var colourB = "#ffffff"
    @State private var hashKind = DevToolkit.Hash.sha256
    @State private var loremWords = 50

    private var tool: DevTool { DevTool(rawValue: toolRaw) ?? .json }

    var body: some View {
        HStack(spacing: 12) {
            GlassCard {
                ScrollView {
                    VStack(alignment: .leading, spacing: 2) {
                        ForEach(DevTool.allCases) { t in
                            Button { toolRaw = t.rawValue; output = ""; note = "" } label: {
                                Label(t.rawValue, systemImage: t.symbol)
                                    .font(.system(size: 12, weight: .semibold)).frame(maxWidth: .infinity, alignment: .leading)
                                    .padding(.vertical, 6).padding(.horizontal, 8)
                                    .background(t == tool ? Theme.accent.opacity(0.35) : Color.clear, in: RoundedRectangle(cornerRadius: 8))
                            }
                            .buttonStyle(.plain).foregroundStyle(.white)
                        }
                    }
                }
            }
            .frame(width: 150)
            GlassCard { pane }
        }
    }

    // MARK: Panes

    @ViewBuilder private var pane: some View {
        switch tool {
        case .json:
            tools(placeholder: "Paste JSON", buttons: [
                ("Format", { run(DevToolkit.formatJSON(input), bad: "That isn't valid JSON.") }),
                ("Minify", { run(DevToolkit.minifyJSON(input), bad: "That isn't valid JSON.") })])
        case .encoding:
            tools(placeholder: "Text to encode or decode", buttons: [
                ("Base64 encode", { run(DevToolkit.base64Encode(input)) }),
                ("Base64 decode", { run(DevToolkit.base64Decode(input), bad: "That isn't valid Base64 text.") }),
                ("URL encode", { run(DevToolkit.urlEncode(input)) }),
                ("URL decode", { run(DevToolkit.urlDecode(input), bad: "That isn't valid URL encoding.") })])
        case .caseChange:
            tools(placeholder: "Text to change", buttons: DevToolkit.CaseStyle.allCases.map { s in (s.rawValue, { run(DevToolkit.convert(input, to: s)) }) })
        case .jwt:
            tools(placeholder: "Paste a JWT", buttons: [("Decode", { decodeJWT() })], footer: "Shows what's inside. It can't check the signature, because that needs the secret.")
        case .hashes:
            VStack(alignment: .leading, spacing: 8) {
                header
                inputField("Text to hash")
                HStack {
                    Picker("", selection: $hashKind) { ForEach(DevToolkit.Hash.allCases, id: \.self) { Text($0.rawValue).tag($0) } }.labelsHidden().frame(width: 110)
                    Button("Hash") { output = DevToolkit.hash(input, hashKind) }.buttonStyle(PurpleButtonStyle())
                    Button("New UUID") { output = DevToolkit.uuid() }.buttonStyle(PurpleButtonStyle(prominent: false))
                    Stepper("\(loremWords) words", value: $loremWords, in: 5...500, step: 5).font(.system(size: 11)).foregroundStyle(.white)
                    Button("Lorem ipsum") { output = DevToolkit.loremIpsum(words: loremWords) }.buttonStyle(PurpleButtonStyle(prominent: false))
                }
                outputBox
            }
        case .time:
            tools(placeholder: "A timestamp (1516239022) or a date (2018-01-18T01:30:22Z)", buttons: [("Convert", { convertTime() }), ("Now", { input = String(Int(Date().timeIntervalSince1970)); convertTime() })])
        case .regex:
            VStack(alignment: .leading, spacing: 8) {
                header
                TextField("Pattern, e.g. (\\w+)@(\\w+)\\.com", text: $pattern).textFieldStyle(.roundedBorder).font(.system(size: 12, design: .monospaced))
                inputField("Text to search")
                HStack {
                    Toggle("Ignore case", isOn: $ignoreCase).toggleStyle(.checkbox).font(.system(size: 11)).foregroundStyle(.white)
                    Button("Test") { testRegex() }.buttonStyle(PurpleButtonStyle())
                    pasteButton
                }
                outputBox
            }
        case .contrast:
            VStack(alignment: .leading, spacing: 8) {
                header
                HStack(spacing: 8) {
                    TextField("Text colour", text: $colourA).textFieldStyle(.roundedBorder)
                    TextField("Background", text: $colourB).textFieldStyle(.roundedBorder)
                    Button("Check") { checkContrast() }.buttonStyle(PurpleButtonStyle())
                }
                if let a = DevToolkit.rgb(hex: colourA), let b = DevToolkit.rgb(hex: colourB) {
                    Text("Sample text 14pt and large 18pt")
                        .font(.system(size: 15, weight: .semibold)).padding(10).frame(maxWidth: .infinity)
                        .foregroundStyle(Color(red: a.r, green: a.g, blue: a.b)).background(Color(red: b.r, green: b.g, blue: b.b), in: RoundedRectangle(cornerRadius: 8))
                }
                outputBox
            }
            .onAppear { checkContrast() }
        case .qr:
            VStack(alignment: .leading, spacing: 8) {
                header
                inputField("A link or some text")
                HStack { Button("Make QR code") { note = "" }.buttonStyle(PurpleButtonStyle()); pasteButton }
                if let img = Self.qr(input) {
                    Image(nsImage: img).interpolation(.none).resizable().frame(width: 130, height: 130).background(.white).clipShape(RoundedRectangle(cornerRadius: 6))
                    Text("Scan it with your phone's camera.").font(.system(size: 11)).foregroundStyle(Theme.textSecondary)
                } else { Text("Type or paste something above.").font(.system(size: 11)).foregroundStyle(Theme.textSecondary) }
                Spacer(minLength: 0)
            }
        }
    }

    // MARK: Pieces

    private var header: some View { Label(tool.rawValue, systemImage: tool.symbol).sectionTitle() }

    private func inputField(_ placeholder: String) -> some View {
        TextEditor(text: $input).font(.system(size: 12, design: .monospaced)).scrollContentBackground(.hidden)
            .padding(6).background(Theme.surface, in: RoundedRectangle(cornerRadius: 8)).frame(minHeight: 60)
            .overlay(alignment: .topLeading) { if input.isEmpty { Text(placeholder).font(.system(size: 12)).foregroundStyle(Theme.textSecondary).padding(11).allowsHitTesting(false) } }
    }

    private var pasteButton: some View {
        Button("Paste") { input = NSPasteboard.general.string(forType: .string) ?? "" }.buttonStyle(PurpleButtonStyle(prominent: false))
    }

    private var outputBox: some View {
        VStack(alignment: .leading, spacing: 4) {
            ScrollView {
                Text(output.isEmpty ? " " : output).font(.system(size: 12, design: .monospaced)).foregroundStyle(.white)
                    .textSelection(.enabled).frame(maxWidth: .infinity, alignment: .leading)
            }
            .padding(6).background(Theme.surface, in: RoundedRectangle(cornerRadius: 8)).frame(minHeight: 56)
            HStack {
                if !note.isEmpty { Text(note).font(.system(size: 11)).foregroundStyle(.orange) }
                Spacer()
                Button("Copy") { NSPasteboard.general.clearContents(); NSPasteboard.general.setString(output, forType: .string) }
                    .buttonStyle(PurpleButtonStyle(prominent: false)).disabled(output.isEmpty)
            }
        }
    }

    private func tools(placeholder: String, buttons: [(String, () -> Void)], footer: String? = nil) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            header
            inputField(placeholder)
            HStack(spacing: 6) {
                pasteButton
                ForEach(Array(buttons.enumerated()), id: \.offset) { _, b in Button(b.0, action: b.1).buttonStyle(PurpleButtonStyle()) }
                Spacer(minLength: 0)
            }
            .font(.system(size: 11))
            outputBox
            if let footer { Text(footer).font(.system(size: 10)).foregroundStyle(Theme.textSecondary) }
        }
    }

    // MARK: Actions

    private func run(_ result: String?, bad: String = "") { if let result { output = result; note = "" } else { output = ""; note = bad } }

    private func decodeJWT() {
        guard let j = DevToolkit.decodeJWT(input) else { output = ""; note = "That doesn't look like a JWT (three parts separated by dots)."; return }
        func when(_ d: Date?) -> String { d.map { $0.formatted(date: .abbreviated, time: .standard) } ?? "not set" }
        output = "HEADER\n\(j.header)\n\nPAYLOAD\n\(j.payload)\n\nIssued: \(when(j.issued))\nExpires: \(when(j.expires))\(j.isExpired() ? "  (expired)" : "")\nNot before: \(when(j.notBefore))\nSignature: \(j.hasSignature ? "present, not checked" : "none")"
        note = ""
    }

    private func convertTime() {
        guard let s = DevToolkit.parseStamp(input) else { output = ""; note = "Enter seconds, milliseconds or an ISO date."; return }
        let d = Date(timeIntervalSince1970: s.seconds)
        output = "UTC: \(s.isoUTC)\nLocal: \(d.formatted(date: .complete, time: .standard))\nSeconds: \(Int(s.seconds))\nMilliseconds: \(Int(s.seconds * 1000))\n\(d.formatted(.relative(presentation: .named)))"
        note = ""
    }

    private func testRegex() {
        switch DevToolkit.regexTest(pattern: pattern, text: input, ignoreCase: ignoreCase, multiline: true) {
        case .invalid(let why): output = ""; note = why
        case .matches(let m):
            note = ""
            output = m.isEmpty ? "No matches." : "\(m.count) match\(m.count == 1 ? "" : "es")\n" + m.enumerated().map { i, x in
                "\(i + 1). \(x.text)" + (x.groups.isEmpty ? "" : "\n   groups: " + x.groups.map { "“\($0)”" }.joined(separator: ", "))
            }.joined(separator: "\n")
        }
    }

    private func checkContrast() {
        guard let c = DevToolkit.contrast(colourA, colourB) else { output = ""; note = "Enter two colours like #333 and #ffffff."; return }
        func v(_ ok: Bool) -> String { ok ? "pass" : "fail" }
        note = ""
        output = String(format: "Contrast ratio %.2f : 1\n", c.ratio) + "AA normal text (4.5): \(v(c.aaNormal))\nAA large text (3): \(v(c.aaLarge))\nAAA normal text (7): \(v(c.aaaNormal))\nAAA large text (4.5): \(v(c.aaaLarge))"
    }

    static func qr(_ text: String) -> NSImage? {
        guard !text.isEmpty else { return nil }
        let f = CIFilter.qrCodeGenerator()
        f.message = Data(text.utf8); f.correctionLevel = "M"
        guard let out = f.outputImage?.transformed(by: CGAffineTransform(scaleX: 8, y: 8)) else { return nil }
        let rep = NSCIImageRep(ciImage: out)
        let img = NSImage(size: rep.size); img.addRepresentation(rep)
        return img
    }
}
