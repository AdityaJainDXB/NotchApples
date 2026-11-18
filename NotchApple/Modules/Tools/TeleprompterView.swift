//
//  TeleprompterView.swift
//  Notch Apple
//
//  Tools → Teleprompter: type or paste a script, press Start, and it scrolls up a reading line at the speed you choose.
//  Speed, text size and mirror are saved. The rules (speed to pace, scroll steps) are in TeleprompterLogic.swift.
//  Everything stays on this Mac; nothing is sent anywhere.
//

import SwiftUI

private struct TextHeightKey: PreferenceKey {
    static var defaultValue: CGFloat = 0
    static func reduce(value: inout CGFloat, nextValue: () -> CGFloat) { value = max(value, nextValue()) }
}

struct TeleprompterView: View {
    @AppStorage("teleprompter.script") private var script = ""
    @AppStorage("teleprompter.speed") private var speed = TeleprompterLogic.defaultSpeed
    @AppStorage("teleprompter.font") private var font = TeleprompterLogic.defaultFont
    @AppStorage("teleprompter.mirror") private var mirror = false

    @State private var running = false
    @State private var finished = false
    @State private var offset: CGFloat = 0
    @State private var textHeight: CGFloat = 0
    @State private var viewHeight: CGFloat = 0
    @State private var lastTick = Date()
    private let ticker = Timer.publish(every: 1.0 / 30.0, on: .main, in: .common).autoconnect()

    private var words: Int { TeleprompterLogic.wordCount(script) }
    private var reading: Bool { running || offset > 0 || finished }
    private var maxOffset: Double { Double(textHeight - viewHeight) }

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            controls
            if reading { reader } else { editor }
        }
        .onReceive(ticker) { now in
            let dt = now.timeIntervalSince(lastTick)
            lastTick = now
            guard running else { return }
            let step = TeleprompterLogic.advance(offset: Double(offset), dt: min(dt, 0.2), speed: speed, fontSize: font, maxOffset: maxOffset)
            offset = CGFloat(step.offset)
            if step.finished { running = false; finished = true }
        }
        .onDisappear { running = false }
    }

    // MARK: Controls

    private var controls: some View {
        HStack(spacing: 10) {
            Button(running ? "Pause" : (offset > 0 && !finished ? "Resume" : "Start")) { toggle() }
                .buttonStyle(PurpleButtonStyle()).disabled(words == 0)
            if reading { Button("Reset") { reset() }.buttonStyle(MetalPlainStyle()) }
            Spacer(minLength: 4)
            slider("Speed", value: Binding(get: { Double(speed) }, set: { speed = TeleprompterLogic.clampSpeed(Int($0.rounded())) }),
                   range: 1...10, step: 1, width: 90, note: "\(TeleprompterLogic.wordsPerMinute(speed: speed)) wpm")
            slider("Size", value: Binding(get: { font }, set: { font = TeleprompterLogic.clampFont($0) }),
                   range: TeleprompterLogic.fontRange, step: 2, width: 80, note: "\(Int(font)) pt")
            Toggle("Mirror", isOn: $mirror).toggleStyle(.switch).controlSize(.mini).font(.system(size: 10, weight: .semibold))
                .help("Flips the text sideways, for a prompter glass")
        }
    }

    private func slider(_ title: String, value: Binding<Double>, range: ClosedRange<Double>, step: Double, width: CGFloat, note: String) -> some View {
        VStack(alignment: .leading, spacing: 1) {
            HStack(spacing: 4) {
                Text(title).font(.system(size: 10, weight: .semibold)).foregroundStyle(Theme.textSecondary)
                Text(note).font(.system(size: 10)).foregroundStyle(Theme.textSecondary.opacity(0.8))
            }
            Slider(value: value, in: range, step: step).controlSize(.mini).frame(width: width)
        }
    }

    // MARK: The script

    private var editor: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text("Your script").font(.system(size: 11, weight: .semibold)).foregroundStyle(Theme.textSecondary)
            ZStack(alignment: .topLeading) {
                TextEditor(text: $script).font(.system(size: 13)).scrollContentBackground(.hidden)
                if script.isEmpty {
                    Text("Type or paste what you want to read…").font(.system(size: 13)).foregroundStyle(Theme.textSecondary.opacity(0.7))
                        .padding(.top, 8).padding(.leading, 5).allowsHitTesting(false)
                }
            }
            HStack {
                Text(words == 0 ? "No words yet" : "\(words) words · about \(TeleprompterLogic.clock(TeleprompterLogic.seconds(words: words, speed: speed))) at this speed")
                    .font(.system(size: 10)).foregroundStyle(Theme.textSecondary)
                Spacer()
                if !script.isEmpty { Button("Clear") { script = "" }.buttonStyle(MetalPlainStyle()).font(.system(size: 10, weight: .semibold)) }
            }
        }
        .padding(10).frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(Theme.surface, in: RoundedRectangle(cornerRadius: 10, style: .continuous))
    }

    // MARK: The reader

    private var reader: some View {
        GeometryReader { geo in
            ZStack(alignment: .top) {
                Text(script)
                    .font(.system(size: font, weight: .semibold))
                    .foregroundStyle(Theme.textPrimary)
                    .multilineTextAlignment(.leading)
                    .frame(width: max(40, geo.size.width - 28), alignment: .leading)
                    .fixedSize(horizontal: false, vertical: true)
                    .padding(.top, geo.size.height * 0.4).padding(.bottom, geo.size.height)
                    .background(GeometryReader { t in Color.clear.preference(key: TextHeightKey.self, value: t.size.height) })
                    .offset(y: -offset)
                // The reading line: read what sits on it.
                Rectangle().fill(Theme.accentBright.opacity(0.45)).frame(height: 2).offset(y: geo.size.height * 0.4 - 1)
                if finished {
                    Text("End of script").font(.system(size: 11, weight: .semibold)).foregroundStyle(Theme.accentBright)
                        .padding(.horizontal, 8).padding(.vertical, 3).background(Theme.surface, in: Capsule()).padding(.top, 6)
                }
            }
            .frame(width: geo.size.width, height: geo.size.height).clipped()
            .scaleEffect(x: mirror ? -1 : 1, y: 1)
            .onPreferenceChange(TextHeightKey.self) { textHeight = $0 }
            .onAppear { viewHeight = geo.size.height }
            .onChange(of: geo.size.height) { _, h in viewHeight = h }
        }
        .frame(minHeight: 96)
        .background(Theme.surface, in: RoundedRectangle(cornerRadius: 10, style: .continuous))
    }

    // MARK: Actions

    private func toggle() {
        if running { running = false; return }
        if finished { offset = 0; finished = false }
        lastTick = Date()
        running = true
    }

    private func reset() {
        running = false
        finished = false
        offset = 0
    }
}
