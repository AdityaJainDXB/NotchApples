//
//  TourView.swift
//  Notch apple
//
//  The compulsory walkthrough after the 1.34 update, shown inside the notch (no pop-up, no separate window). One
//  step per big change, each with a drawn picture and, where it makes sense, a live control to try. The last step
//  asks where each reorganised feature should live. There is no Skip: the notch returns here until it is finished.
//

import SwiftUI

@MainActor
final class TourModel: ObservableObject {
    static let shared = TourModel()
    private static let doneKey = "tour.v2.done"
    private static let stepKey = "tour.v2.step"

    @Published var step = TourLogic.clamp(UserDefaults.standard.integer(forKey: TourModel.stepKey)) {
        didSet { UserDefaults.standard.set(step, forKey: Self.stepKey) }
    }

    var done: Bool { UserDefaults.standard.bool(forKey: Self.doneKey) }

    /// True while the walkthrough still has to be finished.
    var isShowing: Bool {
        TourLogic.needed(done: done, freshInstall: UserDefaults.standard.bool(forKey: "v2.freshInstall"))
    }

    /// Called once at launch: a brand-new install skips it; everyone else sees it and the notch opens on it.
    func startIfNeeded() {
        // A brand-new install gets the first-run welcome instead.
        if UserDefaults.standard.bool(forKey: "v2.freshInstall") { UserDefaults.standard.set(true, forKey: Self.doneKey) }
        objectWillChange.send()
        if !done { AppDelegate.current?.openNotch() }
    }

    func finish() {
        UserDefaults.standard.set(true, forKey: Self.doneKey)
        ModuleLayout.shared.chooserDone = true
        WhatsNew.markSeen(); WhatsNew.markOffered()     // the tour covered what the patch log would say
        objectWillChange.send()
    }

    /// Settings → About can replay it.
    func replay() {
        UserDefaults.standard.set(false, forKey: Self.doneKey)
        step = 0
        objectWillChange.send()
        AppDelegate.current?.openNotch()
    }
}

struct TourView: View {
    @ObservedObject private var tour = TourModel.shared
    @EnvironmentObject private var state: NotchState
    @State private var draft: [Module: LayoutChoice] = [:]
    @State private var homeStyle: ModuleLayoutLogic.HomeStyle = ModuleLayout.shared.savedHomeStyle ?? ModuleLayout.shared.defaultHomeStyle

    var body: some View {
        VStack(spacing: 10) {
            HStack(spacing: 5) {
                ForEach(0..<TourLogic.stepCount, id: \.self) { i in
                    Capsule().fill(i <= tour.step ? Theme.accentBright : Theme.surface).frame(height: 4)
                }
            }
            // Steps scroll when the notch is small, so nothing is ever cut off. The last step scrolls its own list.
            GeometryReader { geo in
                if TourLogic.isLast(tour.step) {
                    content.frame(width: geo.size.width, height: geo.size.height)
                } else {
                    ScrollView(.vertical) {
                        content.frame(width: geo.size.width, height: geo.size.height > 260 ? geo.size.height : nil)
                    }
                    .scrollIndicators(.hidden)
                }
            }
            .id(tour.step)
            .transition(.opacity)
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            HStack {
                if tour.step > 0 { Button("Back") { withAnimation(.snappy) { tour.step = TourLogic.back(tour.step) } }.buttonStyle(PurpleButtonStyle(prominent: false)) }
                Spacer()
                Text("\(tour.step + 1) of \(TourLogic.stepCount)").font(.system(size: 11)).foregroundStyle(Theme.textSecondary)
                if TourLogic.isLast(tour.step) {
                    Button("Finish") { applyDraft(); tour.finish() }.buttonStyle(PurpleButtonStyle())
                } else {
                    Button("Next") { withAnimation(.snappy) { tour.step = TourLogic.next(tour.step) } }.buttonStyle(PurpleButtonStyle())
                }
            }
        }
        .onAppear { if draft.isEmpty { for m in ModuleLayout.managedModules { draft[m] = ModuleLayout.shared.choice(m) } } }
    }

    @ViewBuilder private var content: some View {
        switch tour.step {
        case 0: Welcome()
        case 1: HomeStep()
        case 2: UsageStep()
        case 3: ToolsStep()
        case 4: NonNecessitiesStep()
        case 5: SharingStep()
        case 6: FullScreenStep()
        case 7: LidFoldStep()
        default: LayoutStep(draft: $draft, homeStyle: $homeStyle)
        }
    }

    private func applyDraft() {
        for (m, c) in draft { ModuleLayout.shared.set(c, for: m) }
        ModuleLayout.shared.setHomeStyle(homeStyle)
    }
}

// MARK: - Steps

/// The picture on the left, the words and any live control on the right.
private struct StepLayout<Art: View, Live: View>: View {
    let title: String
    let text: String
    @ViewBuilder var art: Art
    @ViewBuilder var live: Live

    var body: some View {
        HStack(spacing: 18) {
            art.frame(width: 250, height: 210)
                .background(Theme.surface.opacity(0.6), in: RoundedRectangle(cornerRadius: 16))
            VStack(alignment: .leading, spacing: 10) {
                Text(title).font(.system(size: 20, weight: .bold)).foregroundStyle(.white)
                Text(text).font(.system(size: 12)).foregroundStyle(Theme.textSecondary).fixedSize(horizontal: false, vertical: true)
                live
                Spacer(minLength: 0)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .padding(.top, 4)
    }
}

private struct Bar: View {
    var width: CGFloat; var height: CGFloat = 8; var colour: Color = .white.opacity(0.18)
    var body: some View { Capsule().fill(colour).frame(width: width, height: height) }
}

private struct Welcome: View {
    var body: some View {
        VStack(spacing: 10) {
            Spacer(minLength: 0)
            Image(systemName: "sparkles").font(.system(size: 38)).foregroundStyle(Theme.accentGradient)
            Text("What's new in this update").font(.system(size: 26, weight: .bold)).foregroundStyle(.white)
            Text("A huge update for efficiency and a more modular notch").font(.system(size: 14, weight: .semibold)).foregroundStyle(Theme.accentBright)
            Text("A new Home page, a smarter Claude usage tracker, an algebra calculator, fewer tabs, and a PairDrop that works. This short tour shows each change, lets you try the ones you can, and ends by asking where you want things to live.")
                .font(.system(size: 12)).foregroundStyle(Theme.textSecondary).multilineTextAlignment(.center).frame(maxWidth: 520)
            Spacer(minLength: 0)
        }
    }
}

private struct HomeStep: View {
    var body: some View {
        StepLayout(title: "Home replaces Today", text: "One page you can glance at: devices, notifications and a quick-add bar are always there. Clipboard, Now Playing and Quick Notes stay tucked away until you click them, so the page stays calm.") {
            VStack(spacing: 6) {
                RoundedRectangle(cornerRadius: 8).fill(.white.opacity(0.12)).frame(height: 30)
                HStack(spacing: 6) {
                    ForEach(["airpods", "bell.badge", "calendar.badge.plus"], id: \.self) { s in
                        RoundedRectangle(cornerRadius: 8).fill(Theme.accent.opacity(0.35)).frame(height: 54).overlay(Image(systemName: s).foregroundStyle(.white))
                    }
                }
                ForEach(["doc.on.clipboard", "music.note", "note.text"], id: \.self) { s in
                    HStack { Image(systemName: s).foregroundStyle(Theme.accentBright); Bar(width: 70); Spacer(); Image(systemName: "chevron.right").font(.system(size: 9)).foregroundStyle(Theme.textSecondary) }
                        .padding(.horizontal, 8).frame(height: 28).background(.white.opacity(0.08), in: RoundedRectangle(cornerRadius: 8))
                }
            }.padding(14)
        } live: { EmptyView() }
    }
}

private struct UsageStep: View {
    @EnvironmentObject private var state: NotchState
    var body: some View {
        StepLayout(title: "Claude usage, at a glance", text: "Your 5-hour window and your week, each as a light: green means well within pace, yellow means nearing the limit, red means it is reached or you are burning fast. An arrow opens the detail, and a 5-second badge appears in the closed notch whenever the colour changes, usage jumps or a limit resets.") {
            VStack(spacing: 14) {
                ForEach([("5h", Color.green, "34%"), ("Week", Color.yellow, "78%")], id: \.0) { row in
                    HStack(spacing: 10) {
                        Circle().fill(row.1).frame(width: 16, height: 16).shadow(color: row.1.opacity(0.6), radius: 5)
                        Text(row.0).font(.system(size: 13, weight: .semibold)).foregroundStyle(.white)
                        Spacer()
                        Text(row.2).font(.system(size: 20, weight: .bold, design: .rounded)).foregroundStyle(row.1)
                    }
                }
                Image(systemName: "chevron.right.circle.fill").font(.system(size: 22)).foregroundStyle(Theme.accentBright)
            }.padding(22)
        } live: {
            Button("Preview the notch badge") {
                state.close()
                DispatchQueue.main.asyncAfter(deadline: .now() + 0.6) {
                    LiveActivityCenter.shared.flash(LiveActivity(symbol: "gauge.with.dots.needle.67percent", label: "78%", tint: .systemYellow, leftText: "5h"), seconds: 5)
                }
            }
            .buttonStyle(PurpleButtonStyle(prominent: false))
            Text("Closes the notch and shows the badge for 5 seconds. Open the notch again to carry on. Needs Ultimate to track your own usage.")
                .font(.system(size: 10)).foregroundStyle(Theme.textSecondary)
        }
    }
}

private struct ToolsStep: View {
    @State private var text = "2x + 3 = 11"
    private var answer: String {
        var s = MathSession()
        return s.run(text).flatMap(\.output).joined(separator: "  ·  ")
    }
    var body: some View {
        StepLayout(title: "Tools: algebra and the Translator", text: "The calculator now solves for letters, handles equations and systems, factors, differentiates and remembers values between lines. The seven-language Translator moved inside Tools, and the page spacing is tidied.") {
            VStack(spacing: 10) {
                Image(systemName: "x.squareroot").font(.system(size: 40)).foregroundStyle(Theme.accentGradient)
                Text("x² − 5x + 6 = 0").font(.system(size: 14, design: .monospaced)).foregroundStyle(.white)
                Text("x = 2 · x = 3").font(.system(size: 16, weight: .bold, design: .rounded)).foregroundStyle(Theme.accentBright)
            }
        } live: {
            TextField("Try an equation", text: $text).textFieldStyle(.roundedBorder).font(.system(size: 13, design: .monospaced))
            Text(answer.isEmpty ? " " : answer).font(.system(size: 18, weight: .semibold, design: .rounded)).foregroundStyle(.white).lineLimit(2)
        }
    }
}

private struct NonNecessitiesStep: View {
    var body: some View {
        StepLayout(title: "One tab for the rest", text: "Focus, World Clock, Audio, Snippets, Shortcuts, Timers, Plugins, Voice Notes, Screen Time and Smart Home now share a single “Non-Necessities” tab, so the tab bar has room to breathe. Any of them can still be its own tab, live on Home, or be turned off. The last step lets you choose.") {
            LazyVGrid(columns: [GridItem(.flexible()), GridItem(.flexible())], spacing: 8) {
                ForEach(["timer", "globe", "speaker.wave.2", "text.badge.plus", "square.stack.3d.up", "stopwatch", "puzzlepiece.extension", "waveform", "hourglass", "lightbulb"], id: \.self) { s in
                    Image(systemName: s).frame(maxWidth: .infinity).frame(height: 28).foregroundStyle(.white)
                        .background(Theme.accent.opacity(0.3), in: RoundedRectangle(cornerRadius: 7))
                }
            }.padding(16)
        } live: { EmptyView() }
    }
}

private struct SharingStep: View {
    @ObservedObject private var pairDrop = PairDropService.shared
    @State private var name = ""
    var body: some View {
        StepLayout(title: "PairDrop works, and chats", text: "File transfer was rebuilt: any file size, folders, a progress bar, wrong codes limited, and “Sent” only when the other device has saved it. New: a private Chat between two devices on the same Wi-Fi, and a name you choose.") {
            VStack(spacing: 10) {
                HStack { Image(systemName: "doc.fill").foregroundStyle(.white); Image(systemName: "arrow.right").foregroundStyle(Theme.accentBright); Image(systemName: "laptopcomputer").foregroundStyle(.white) }.font(.system(size: 26))
                HStack(spacing: 6) {
                    Capsule().fill(Theme.accent.opacity(0.5)).frame(width: 90, height: 22)
                    Capsule().fill(.white.opacity(0.15)).frame(width: 60, height: 22)
                }
                Image(systemName: "bubble.left.and.bubble.right.fill").font(.system(size: 26)).foregroundStyle(Theme.accentGradient)
            }
        } live: {
            Text("The name others see:").font(.system(size: 11)).foregroundStyle(Theme.textSecondary)
            HStack {
                TextField(pairDrop.deviceName, text: $name).textFieldStyle(.roundedBorder).frame(width: 190)
                    .onSubmit { pairDrop.setUsername(name) }
                Button("Save") { pairDrop.setUsername(name) }.buttonStyle(PurpleButtonStyle(prominent: false))
            }
            Text("Now shown as: \(pairDrop.deviceName)").font(.system(size: 10)).foregroundStyle(Theme.textSecondary)
        }
        .onAppear { name = pairDrop.username }
    }
}

private struct FullScreenStep: View {
    @AppStorage("notch.keepInFullscreen") private var keep = true
    @EnvironmentObject private var state: NotchState
    var body: some View {
        StepLayout(title: "The notch stays on screen", text: "On every Mac, including ones without a hardware notch, the notch can stay visible when an app goes full screen. Turn it on or off here and try it: the test re-applies the setting right now.") {
            ZStack {
                RoundedRectangle(cornerRadius: 10).fill(.black.opacity(0.5)).padding(20)
                VStack { Capsule().fill(.black).overlay(Capsule().strokeBorder(Theme.accentBright)).frame(width: 90, height: 18); Spacer() }.padding(.top, 20)
                Image(systemName: "arrow.up.left.and.arrow.down.right").foregroundStyle(.white.opacity(0.5)).font(.system(size: 26))
            }
        } live: {
            Toggle("Keep the notch visible in full-screen apps", isOn: $keep).toggleStyle(.switch).font(.system(size: 12)).foregroundStyle(.white)
                .onChange(of: keep) { _, _ in reapply() }
            Button("Test it now") {
                reapply()
                state.close()
                DispatchQueue.main.asyncAfter(deadline: .now() + 0.6) {
                    LiveActivityCenter.shared.flash(LiveActivity(symbol: keep ? "checkmark.circle.fill" : "xmark.circle", label: keep ? "On top" : "Off", tint: keep ? .systemGreen : .systemGray, leftText: "Full screen"), seconds: 4)
                }
            }
            .buttonStyle(PurpleButtonStyle(prominent: false))
            Text("To check it for real, put any app in full screen and look at the top of the screen.").font(.system(size: 10)).foregroundStyle(Theme.textSecondary)
        }
    }

    private func reapply() {
        let n = AppDelegate.current?.notch
        n?.reassertWindowLevels(); n?.recheckFullscreen(); n?.updateAutoHide()
    }
}

private struct LidFoldStep: View {
    @ObservedObject private var fold = LidFoldModule.shared
    @EnvironmentObject private var state: NotchState

    var body: some View {
        StepLayout(title: "Lid Fold", text: "Close the lid a little and your desktop folds away like a book, then opens again. It is off until you switch it on, it can always be dismissed with Esc or a click, and it never takes focus. Turn it on and press Preview to see it now.") {
            ZStack {
                RoundedRectangle(cornerRadius: 8).fill(.white.opacity(0.14)).frame(width: 150, height: 90).offset(y: -22)
                RoundedRectangle(cornerRadius: 8).fill(Theme.accent.opacity(0.45)).frame(width: 150, height: 90)
                    .rotation3DEffect(.degrees(58), axis: (x: 1, y: 0, z: 0), anchor: .bottom).offset(y: 24)
                Image(systemName: "laptopcomputer").font(.system(size: 22)).foregroundStyle(.white.opacity(0.7)).offset(y: 70)
            }
        } live: {
            Toggle("Turn on Lid Fold", isOn: $fold.enabled).toggleStyle(.switch).font(.system(size: 12)).foregroundStyle(.white)
            Button("Preview it now") {
                state.close()
                DispatchQueue.main.asyncAfter(deadline: .now() + 0.5) { LidFoldModule.shared.preview() }
            }
            .buttonStyle(PurpleButtonStyle(prominent: false)).disabled(!fold.enabled)
            Text(fold.enabled ? fold.status : "Switch it on to preview. The preview closes the notch for a few seconds; open it again to carry on.")
                .font(.system(size: 10)).foregroundStyle(Theme.textSecondary).fixedSize(horizontal: false, vertical: true)
        }
    }
}

private struct LayoutStep: View {
    @Binding var draft: [Module: LayoutChoice]
    @Binding var homeStyle: ModuleLayoutLogic.HomeStyle

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("Where should everything live?").font(.system(size: 18, weight: .bold)).foregroundStyle(.white)
            HStack(spacing: 10) {
                Text("Home screen").font(.system(size: 12, weight: .semibold)).foregroundStyle(.white)
                Picker("", selection: $homeStyle) {
                    ForEach(ModuleLayoutLogic.HomeStyle.allCases) { Text($0.title).tag($0) }
                }
                .pickerStyle(.segmented).labelsHidden().frame(width: 190)
                Text(homeStyle == .classic ? "Weather, battery and your next events, as before." : "Cards you pick below. Nothing picked shows Classic.")
                    .font(.system(size: 11)).foregroundStyle(Theme.textSecondary).lineLimit(2).fixedSize(horizontal: false, vertical: true)
            }
            Text("Pick a place for each reorganised feature. Change any of this later in Settings → Modules & Layout.")
                .font(.system(size: 11)).foregroundStyle(Theme.textSecondary).fixedSize(horizontal: false, vertical: true)
            ScrollView {
                LazyVGrid(columns: [GridItem(.adaptive(minimum: 230), spacing: 12)], spacing: 6) {
                    ForEach(ModuleLayout.managedModules) { m in
                        HStack(spacing: 8) {
                            Image(systemName: m.symbol).frame(width: 18).foregroundStyle(Theme.accentBright)
                            Text(m.title).font(.system(size: 12, weight: .medium)).foregroundStyle(.white).lineLimit(1)
                            Spacer(minLength: 4)
                            LayoutPicker(module: m, draft: Binding(get: { draft[m] ?? .disabled }, set: { draft[m] = $0 }), compact: true)
                        }
                        .padding(.horizontal, 10).frame(height: 32)
                        .background(Theme.surface, in: RoundedRectangle(cornerRadius: 9))
                    }
                }
                .padding(.bottom, 10)
            }
            .scrollIndicators(.hidden)
            .mask(LinearGradient(stops: [.init(color: .black, location: 0), .init(color: .black, location: 0.92), .init(color: .clear, location: 1)], startPoint: .top, endPoint: .bottom))
        }
    }
}
