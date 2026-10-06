//
//  ToolsView.swift
//  Notch apple
//
//  Small everyday tools in the notch:
//   • Keep Awake: stops the Mac sleeping (IOKit power assertion, like
//     `caffeinate`) for a while or until you turn it off.
//   • Color Picker: pick any colour on screen and copy it as hex / RGB.
//   • Calculator: type a sum, get the answer; press Return to copy it.
//

import AppKit
import SwiftUI
import IOKit.pwr_mgt
import Vision

// MARK: - Keep Awake

@MainActor
final class KeepAwake: ObservableObject {
    static let shared = KeepAwake()

    @Published private(set) var isOn = false
    /// When it switches itself off; nil means "until I turn it off".
    @Published private(set) var until: Date?

    private var assertion: IOPMAssertionID = 0
    private var timer: Timer?
    private var ticker: Timer?

    /// A cup beside the notch, with the time left when there is a limit.
    var liveActivity: LiveActivity? {
        guard isOn else { return nil }
        guard let until else { return LiveActivity(symbol: "cup.and.saucer.fill", label: "∞", tint: .systemBrown) }
        let left = max(0, until.timeIntervalSinceNow)
        let label = left >= 3600 ? "\(Int(left / 3600))h\(String(format: "%02d", Int(left) % 3600 / 60))" : "\(Int((left / 60).rounded(.up)))m"
        return LiveActivity(symbol: "cup.and.saucer.fill", label: label, tint: .systemBrown)
    }

    /// minutes == nil keeps the Mac awake indefinitely.
    func start(minutes: Int?) {
        stop()
        var id: IOPMAssertionID = 0
        let result = IOPMAssertionCreateWithName(kIOPMAssertionTypePreventUserIdleDisplaySleep as CFString,
                                                 IOPMAssertionLevel(kIOPMAssertionLevelOn),
                                                 "Notch apple Keep Awake" as CFString, &id)
        guard result == kIOReturnSuccess else { return }
        assertion = id
        isOn = true
        if let minutes {
            until = Date().addingTimeInterval(TimeInterval(minutes * 60))
            timer = Timer.scheduledTimer(withTimeInterval: TimeInterval(minutes * 60), repeats: false) { _ in
                MainActor.assumeIsolated { KeepAwake.shared.stop() }
            }
        }
        // Refresh the countdown beside the notch once a minute.
        ticker = Power.timer(20) { LiveActivityCenter.shared.recompute() }
        LiveActivityCenter.shared.recompute()
    }

    func stop() {
        timer?.invalidate()
        timer = nil
        ticker?.invalidate()
        ticker = nil
        defer { LiveActivityCenter.shared.recompute() }
        if isOn { IOPMAssertionRelease(assertion) }
        isOn = false
        until = nil
    }
}

// MARK: - Color picker

@MainActor
final class ColorPickerModel: ObservableObject {
    static let shared = ColorPickerModel()

    @Published private(set) var recent: [String] = UserDefaults.standard.stringArray(forKey: "tools.recentColors") ?? []
    @Published var copied: String?

    /// Shows the system magnifier; the picked colour is copied as hex.
    func pick() {
        NSColorSampler().show { [weak self] color in
            guard let color, let self else { return }
            let hex = Self.hex(color)
            self.recent.removeAll { $0 == hex }
            self.recent.insert(hex, at: 0)
            self.recent = Array(self.recent.prefix(12))
            UserDefaults.standard.set(self.recent, forKey: "tools.recentColors")
            self.copy(hex)
        }
    }

    func copy(_ text: String) {
        NSPasteboard.general.clearContents()
        NSPasteboard.general.setString(text, forType: .string)
        copied = text
        DispatchQueue.main.asyncAfter(deadline: .now() + 1.5) { [weak self] in
            if self?.copied == text { self?.copied = nil }
        }
    }

    func clear() {
        recent = []
        UserDefaults.standard.removeObject(forKey: "tools.recentColors")
    }

    static func hex(_ color: NSColor) -> String {
        let c = color.usingColorSpace(.sRGB) ?? color
        return String(format: "#%02X%02X%02X", Int(round(c.redComponent * 255)), Int(round(c.greenComponent * 255)), Int(round(c.blueComponent * 255)))
    }

    static func rgb(_ hex: String) -> String {
        let v = Int(hex.dropFirst(), radix: 16) ?? 0
        return "rgb(\(v >> 16 & 255), \(v >> 8 & 255), \(v & 255))"
    }

    static func color(_ hex: String) -> Color {
        let v = Int(hex.dropFirst(), radix: 16) ?? 0
        return Color(red: Double(v >> 16 & 255) / 255, green: Double(v >> 8 & 255) / 255, blue: Double(v & 255) / 255)
    }
}

// MARK: - Calculator

enum QuickMath {
    /// Evaluates + − × ÷ ^ % and brackets with a small recursive-descent
    /// parser (no NSExpression, so bad input can't crash the app).
    static func evaluate(_ input: String) -> Double? {
        let text = input.replacingOccurrences(of: "×", with: "*").replacingOccurrences(of: "÷", with: "/")
            .replacingOccurrences(of: "−", with: "-").replacingOccurrences(of: ",", with: "")
            .replacingOccurrences(of: " ", with: "")
        guard !text.isEmpty else { return nil }
        var parser = Parser(chars: Array(text))
        guard let value = parser.expression(), parser.index == parser.chars.count, value.isFinite else { return nil }
        return value
    }

    static func format(_ value: Double) -> String {
        if value == value.rounded(), abs(value) < 1e15 { return String(Int64(value)) }
        let f = NumberFormatter()
        f.maximumFractionDigits = 8
        f.minimumFractionDigits = 0
        f.numberStyle = .decimal
        f.usesGroupingSeparator = false
        return f.string(from: NSNumber(value: value)) ?? "\(value)"
    }

    private struct Parser {
        let chars: [Character]
        var index = 0

        mutating func expression() -> Double? {
            guard var value = term() else { return nil }
            while index < chars.count, chars[index] == "+" || chars[index] == "-" {
                let op = chars[index]; index += 1
                guard let rhs = term() else { return nil }
                value = op == "+" ? value + rhs : value - rhs
            }
            return value
        }

        mutating func term() -> Double? {
            guard var value = power() else { return nil }
            while index < chars.count, "*/%".contains(chars[index]) {
                let op = chars[index]; index += 1
                guard let rhs = power() else { return nil }
                switch op {
                case "*": value *= rhs
                case "/": value /= rhs
                default: value = value.truncatingRemainder(dividingBy: rhs)
                }
            }
            return value
        }

        mutating func power() -> Double? {
            guard let base = unary() else { return nil }
            if index < chars.count, chars[index] == "^" {
                index += 1
                guard let exp = power() else { return nil }
                return pow(base, exp)
            }
            return base
        }

        mutating func unary() -> Double? {
            if index < chars.count, chars[index] == "-" { index += 1; return unary().map { -$0 } }
            if index < chars.count, chars[index] == "+" { index += 1; return unary() }
            return primary()
        }

        mutating func primary() -> Double? {
            guard index < chars.count else { return nil }
            if chars[index] == "(" {
                index += 1
                let value = expression()
                guard index < chars.count, chars[index] == ")" else { return nil }
                index += 1
                return value
            }
            let start = index
            while index < chars.count, chars[index].isNumber || chars[index] == "." { index += 1 }
            return index > start ? Double(String(chars[start..<index])) : nil
        }
    }
}

// MARK: - Text Grab

/// Select part of the screen; the text in it is recognised on-device (Vision) and copied.
@MainActor
final class TextGrab: ObservableObject {
    static let shared = TextGrab()
    @Published private(set) var lastText: String?
    @Published private(set) var status: String?

    func grab(closeNotch: @escaping () -> Void) {
        closeNotch()
        let file = FileManager.default.temporaryDirectory.appendingPathComponent("notchapple-grab-\(UUID().uuidString).png")
        let task = Process()
        task.executableURL = URL(fileURLWithPath: "/usr/sbin/screencapture")
        task.arguments = ["-i", "-x", file.path]   // interactive area selection, no sound
        task.terminationHandler = { _ in
            Task { @MainActor in self.recognise(file) }
        }
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.3) { try? task.run() }
    }

    private func recognise(_ file: URL) {
        defer { try? FileManager.default.removeItem(at: file) }
        guard let image = NSImage(contentsOf: file)?.cgImage(forProposedRect: nil, context: nil, hints: nil) else {
            status = "Cancelled."
            return
        }
        let request = VNRecognizeTextRequest()
        request.recognitionLevel = .accurate
        request.usesLanguageCorrection = true
        try? VNImageRequestHandler(cgImage: image).perform([request])
        let text = (request.results ?? []).compactMap { $0.topCandidates(1).first?.string }.joined(separator: "\n")
        if text.isEmpty {
            status = "No text found in that area."
        } else {
            NSPasteboard.general.clearContents()
            NSPasteboard.general.setString(text, forType: .string)
            lastText = text
            status = "Copied \(text.count) characters."
        }
    }
}

// MARK: - View

struct ToolsView: View {
    @StateObject private var awake = KeepAwake.shared
    @StateObject private var colors = ColorPickerModel.shared
    @AppStorage("tools.calcInput") private var input = ""
    @AppStorage("tools.calcHistory") private var historyData = ""

    private var history: [String] { historyData.split(separator: "\n").map(String.init) }
    /// "12% of 80", "200 + 15%"… (QuickMath treats % as a remainder, so these are read first).
    private var percentAnswer: QuickAnswerLogic.Answer? { QuickAnswerLogic.percent(input.trimmingCharacters(in: .whitespaces).lowercased()) }
    private var result: Double? { percentAnswer.flatMap { Double($0.copy) } ?? QuickMath.evaluate(input) }

    var body: some View {
        HStack(alignment: .top, spacing: 12) {
            VStack(spacing: 12) {
                keepAwakeCard
                textGrabCard
            }
            .frame(width: 190)
            colorCard
            calculatorCard
        }
        .padding(4)
    }

    @StateObject private var grab = TextGrab.shared
    @EnvironmentObject private var notchState: NotchState

    private var textGrabCard: some View {
        GlassCard {
            VStack(alignment: .leading, spacing: 8) {
                Label("Text Grab", systemImage: "text.viewfinder")
                    .font(.system(size: 13, weight: .semibold)).foregroundStyle(.white)
                Button("Copy text from screen") { grab.grab { notchState.close() } }
                    .buttonStyle(PurpleButtonStyle())
                Text(grab.status ?? "Drag over any text, even in images or videos.")
                    .font(.system(size: 10)).foregroundStyle(Theme.textSecondary)
                    .fixedSize(horizontal: false, vertical: true)
                HStack(spacing: 6) {
                    Button { notchState.close(); ScreenRuler.show() } label: { Label("Ruler", systemImage: "ruler") }
                        .disabled(!Entitlements.shared.canUse(.ruler))
                        .help(Entitlements.shared.canUse(.ruler) ? "Measure anything on screen" : "Pro: \(Feature.ruler.benefit)")
                    Button { notchState.close(); ScreenMarkup.captureAndMarkUp() } label: { Label("Mark up", systemImage: "pencil.tip.crop.circle") }
                        .disabled(!Entitlements.shared.canUse(.annotate))
                        .help(Entitlements.shared.canUse(.annotate) ? "Select part of the screen and draw on it" : "Pro: \(Feature.annotate.benefit)")
                    if !Entitlements.shared.canUse(.ruler) { TierBadge(tier: .pro) }
                }
                .buttonStyle(.plain).font(.system(size: 11, weight: .semibold)).foregroundStyle(Theme.accentBright)
            }
        }
    }

    private var keepAwakeCard: some View {
        GlassCard {
            VStack(alignment: .leading, spacing: 10) {
                Label("Keep Awake", systemImage: awake.isOn ? "cup.and.saucer.fill" : "cup.and.saucer")
                    .font(.system(size: 13, weight: .semibold)).foregroundStyle(.white)
                Text(statusText).font(.system(size: 11)).foregroundStyle(Theme.textSecondary)
                    .fixedSize(horizontal: false, vertical: true)
                VStack(spacing: 6) {
                    HStack(spacing: 6) {
                        durationButton("30 min", 30)
                        durationButton("1 hour", 60)
                    }
                    HStack(spacing: 6) {
                        durationButton("2 hours", 120)
                        durationButton("Always", nil)
                    }
                }
                if awake.isOn {
                    Button("Turn off") { awake.stop() }.buttonStyle(PurpleButtonStyle(prominent: false))
                }
                Spacer(minLength: 0)
            }
        }
    }

    private var statusText: String {
        guard awake.isOn else { return "Stop your Mac sleeping or dimming." }
        guard let until = awake.until else { return "Your Mac stays awake until you turn this off." }
        return "Awake until \(until.formatted(date: .omitted, time: .shortened))."
    }

    private func durationButton(_ title: String, _ minutes: Int?) -> some View {
        Button(title) { selectedMinutes = minutes; awake.start(minutes: minutes) }
            .buttonStyle(PurpleButtonStyle(prominent: awake.isOn && selectedMinutes == minutes))
            .frame(maxWidth: .infinity)
    }

    @State private var selectedMinutes: Int?

    private var colorCard: some View {
        GlassCard {
            VStack(alignment: .leading, spacing: 10) {
                HStack {
                    Label("Color Picker", systemImage: "eyedropper.halffull")
                        .font(.system(size: 13, weight: .semibold)).foregroundStyle(.white)
                    Spacer()
                    if !colors.recent.isEmpty {
                        IconButton(systemImage: "trash", help: "Clear colours") { colors.clear() }
                    }
                }
                Button { colors.pick() } label: { Label("Pick a colour on screen", systemImage: "eyedropper") }
                    .buttonStyle(PurpleButtonStyle())
                if let copied = colors.copied {
                    Text("Copied \(copied)").font(.system(size: 11)).foregroundStyle(.green)
                } else {
                    Text("The hex code is copied for you. Click a swatch to copy it again.")
                        .font(.system(size: 11)).foregroundStyle(Theme.textSecondary)
                        .fixedSize(horizontal: false, vertical: true)
                }
                LazyVGrid(columns: Array(repeating: GridItem(.fixed(30), spacing: 6), count: 6), spacing: 6) {
                    ForEach(colors.recent, id: \.self) { hex in
                        Button { colors.copy(hex) } label: {
                            RoundedRectangle(cornerRadius: 7, style: .continuous)
                                .fill(ColorPickerModel.color(hex))
                                .frame(width: 30, height: 30)
                                .overlay(RoundedRectangle(cornerRadius: 7, style: .continuous).strokeBorder(.white.opacity(0.25)))
                        }
                        .buttonStyle(.plain)
                        .help("\(hex) · \(ColorPickerModel.rgb(hex))")
                        .contextMenu {
                            Button("Copy \(hex)") { colors.copy(hex) }
                            Button("Copy \(ColorPickerModel.rgb(hex))") { colors.copy(ColorPickerModel.rgb(hex)) }
                        }
                    }
                }
                Spacer(minLength: 0)
            }
        }
        .frame(width: 236)
    }

    private var calculatorCard: some View {
        GlassCard {
            VStack(alignment: .leading, spacing: 8) {
                Label("Calculator", systemImage: "plusminus")
                    .font(.system(size: 13, weight: .semibold)).foregroundStyle(.white)
                TextField("e.g. (12.5 + 7) × 3", text: $input)
                    .textFieldStyle(.plain)
                    .font(.system(size: 14, design: .monospaced))
                    .padding(8)
                    .background(Theme.surface, in: RoundedRectangle(cornerRadius: 8, style: .continuous))
                    .onSubmit(commit)
                if let q = Converter.parse(input) {
                    ConversionLine(query: q)
                }
                Text(percentAnswer.map { "= " + $0.text } ?? result.map { "= " + QuickMath.format($0) } ?? (input.isEmpty || Converter.parse(input) != nil ? " " : "…"))
                    .font(.system(size: 22, weight: .semibold, design: .rounded))
                    .foregroundStyle(result == nil ? Theme.textSecondary : .white)
                    .lineLimit(1).minimumScaleFactor(0.5)
                    .textSelection(.enabled)
                Text("Return copies the answer.").font(.system(size: 10)).foregroundStyle(Theme.textSecondary)
                ScrollView {
                    VStack(alignment: .leading, spacing: 3) {
                        ForEach(history, id: \.self) { line in
                            Button { input = String(line.split(separator: "=").first ?? "").trimmingCharacters(in: .whitespaces) } label: {
                                Text(line).font(.system(size: 11, design: .monospaced)).foregroundStyle(Theme.textSecondary)
                                    .frame(maxWidth: .infinity, alignment: .leading)
                            }
                            .buttonStyle(.plain)
                        }
                    }
                }
            }
        }
    }

    private func commit() {
        guard let result else { return }
        let answer = percentAnswer?.text ?? QuickMath.format(result)
        ColorPickerModel.shared.copy(answer)
        let line = "\(input) = \(answer)"
        historyData = ([line] + history.filter { $0 != line }).prefix(8).joined(separator: "\n")
    }
}

/// "5 km to mi" / "100 usd to eur" under the calculator (Pro).
private struct ConversionLine: View {
    let query: Converter.Query
    @ObservedObject private var rates = CurrencyRates.shared
    @ObservedObject private var entitlements = Entitlements.shared

    var body: some View {
        Group {
            if !entitlements.canUse(.currency) {
                HStack(spacing: 6) { TierBadge(tier: .pro); Text("Unit and currency conversion").font(.system(size: 11)).foregroundStyle(Theme.textSecondary) }
            } else if let v = Converter.convertUnits(query) {
                Text("= \(QuickMath.format(v)) \(query.to)").font(.system(size: 18, weight: .semibold, design: .rounded)).foregroundStyle(Theme.accentBright)
            } else if let v = Converter.convertCurrency(query, rates: rates.rates) {
                VStack(alignment: .leading, spacing: 1) {
                    Text("= \(String(format: "%.2f", v)) \(Converter.currencyCode(query.to) ?? "")").font(.system(size: 18, weight: .semibold, design: .rounded)).foregroundStyle(Theme.accentBright)
                    if let u = rates.updated { Text("Rates from open.er-api.com, \(u.formatted(.relative(presentation: .named)))").font(.system(size: 9)).foregroundStyle(Theme.textSecondary) }
                }
            } else if Converter.currencyCode(query.from) != nil {
                Text("Getting today's rates…").font(.system(size: 11)).foregroundStyle(Theme.textSecondary)
            } else {
                Text("Unknown units").font(.system(size: 11)).foregroundStyle(Theme.textSecondary)
            }
        }
        .onAppear { if Converter.convertUnits(query) == nil { rates.loadIfNeeded() } }
    }
}

/// Today's exchange rates for the converter (Pro), from open.er-api.com (free, no key), cached 12 hours.
@MainActor
final class CurrencyRates: ObservableObject {
    static let shared = CurrencyRates()
    @Published private(set) var rates: [String: Double] = [:]
    @Published private(set) var updated: Date?
    private var loading = false

    func loadIfNeeded() {
        if let updated, Date.now.timeIntervalSince(updated) < 12 * 3600 { return }
        guard !loading, Entitlements.shared.canUse(.currency) else { return }
        loading = true
        Task {
            defer { loading = false }
            guard let url = URL(string: "https://open.er-api.com/v6/latest/USD"),
                  let (data, _) = try? await URLSession.shared.data(from: url),
                  let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
                  let r = json["rates"] as? [String: Double] else { return }
            rates = r
            updated = .now
        }
    }
}
