//
//  OnboardingView.swift
//  Notch apple
//
//  First run, in four short pages: permissions, pick your tabs, pick a theme,
//  and a quick tour. Every step can be skipped and changed later in Settings.
//  Shown once on a new install; Settings → General can show it again.
//

import SwiftUI

@MainActor
enum Onboarding {
    private static var window: NSWindow?

    static func show() {
        if let window { window.makeKeyAndOrderFront(nil); NSApp.activate(ignoringOtherApps: true); return }
        let hosting = NSHostingController(rootView: OnboardingView { close() }
            .environmentObject(SettingsManager.shared))
        let w = NSWindow(contentViewController: hosting)
        w.title = "Welcome to Notch apple"
        w.styleMask = [.titled, .closable, .fullSizeContentView]
        w.titlebarAppearsTransparent = true
        w.isReleasedWhenClosed = false
        w.setContentSize(NSSize(width: 640, height: 560))
        w.appearance = NSAppearance(named: .darkAqua)
        w.center()
        window = w
        NSApp.activate(ignoringOtherApps: true)
        w.makeKeyAndOrderFront(nil)
    }

    static func close() {
        UserDefaults.standard.set(true, forKey: "onboarding.welcomeDismissed")
        window?.close()
        window = nil
    }
}

struct OnboardingView: View {
    let done: () -> Void
    /// The screenshot build can start on a later page (-demoOnboarding 2).
    @State private var page = DemoHooks.isDemo ? min(max(UserDefaults.standard.integer(forKey: "demoOnboarding") - 1, 0), 3) : 0
    private let pages = ["Permissions", "Your tabs", "Your look", "Quick tour"]

    var body: some View {
        VStack(spacing: 0) {
            HStack(spacing: 8) {
                ForEach(pages.indices, id: \.self) { i in
                    Capsule().fill(i <= page ? AnyShapeStyle(Theme.accentGradient) : AnyShapeStyle(Color.white.opacity(0.15)))
                        .frame(height: 4)
                        .accessibilityHidden(true)
                }
            }
            .padding(.horizontal, 28).padding(.top, 36)
            Text("Step \(page + 1) of 4 · \(pages[page])").font(.caption).foregroundStyle(.secondary).padding(.top, 8)

            Group {
                switch page {
                case 0: OnboardingPermissions()
                case 1: OnboardingTabs()
                case 2: OnboardingTheme()
                default: OnboardingTour()
                }
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            .transition(.opacity)

            HStack {
                if page > 0 { Button("Back") { withAnimation(Theme.spring) { page -= 1 } } }
                Spacer()
                Button("Skip") { done() }.buttonStyle(.plain).foregroundStyle(.secondary)
                Button(page == 3 ? "Start using Notch apple" : "Continue") {
                    if page == 3 { done(); AppDelegate.current?.notch?.expand() }
                    else { withAnimation(Theme.spring) { page += 1 } }
                }
                .buttonStyle(PurpleButtonStyle())
                .keyboardShortcut(.defaultAction)
            }
            .padding(20)
        }
        .background(Theme.backdrop.ignoresSafeArea())
        .preferredColorScheme(.dark)
    }
}

private struct OnboardingPermissions: View {
    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack(spacing: 14) {
                Image(nsImage: NSApp.applicationIconImage).resizable().frame(width: 56, height: 56)
                VStack(alignment: .leading, spacing: 4) {
                    Text("Welcome to Notch apple").font(.title.bold())
                    Text("Your MacBook's notch, made useful. Nothing below is required; allow only what you'd like.")
                        .foregroundStyle(.secondary)
                }
            }
            .padding(.horizontal, 28).padding(.top, 16)
            PermissionsView()
        }
    }
}

private struct OnboardingTabs: View {
    @EnvironmentObject private var settings: SettingsManager
    @ObservedObject private var entitlements = Entitlements.shared
    private let picks: [Module] = [.today, .claude, .nowPlaying, .clipboard, .shelf, .timer, .worldClock, .sports, .f1, .notes, .windows, .games, .launcher, .focus, .messenger, .snippets, .translator, .stats, .cacheCleaner]

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("Pick your tabs").font(.title.bold())
            Text("These appear in the open notch. You can add, remove and reorder them any time in Settings → Modules and Appearance.")
                .foregroundStyle(.secondary)
            ScrollView {
                LazyVGrid(columns: [GridItem(.adaptive(minimum: 250), spacing: 10)], spacing: 10) {
                    ForEach(picks) { m in
                        let on = settings.binding(for: m)
                        Button { on.wrappedValue.toggle() } label: {
                            HStack(spacing: 10) {
                                Image(systemName: m.symbol).font(.system(size: 13, weight: .semibold)).foregroundStyle(.white)
                                    .frame(width: 28, height: 28)
                                    .background(Theme.accentGradient, in: RoundedRectangle(cornerRadius: 7, style: .continuous))
                                Text(m.title).foregroundStyle(.white)
                                Spacer()
                                if let f = m.feature, !entitlements.canUse(f) { TierBadge(tier: f.tier) }
                                Image(systemName: on.wrappedValue ? "checkmark.circle.fill" : "circle")
                                    .foregroundStyle(on.wrappedValue ? Theme.accent : .secondary)
                            }
                            .padding(10)
                            .background(RoundedRectangle(cornerRadius: 10).fill(Color.white.opacity(on.wrappedValue ? 0.1 : 0.04)))
                            .contentShape(Rectangle())
                        }
                        .buttonStyle(.plain)
                        .accessibilityLabel(m.title)
                        .accessibilityValue(on.wrappedValue ? "On" : "Off")
                    }
                }
            }
        }
        .padding(28)
    }
}

private struct OnboardingTheme: View {
    private let manager = ThemeManager.shared
    @ObservedObject private var entitlements = Entitlements.shared
    private let free: [ThemeID] = [.notchPurple, .oledObsidian, .graphiteTitanium, .tokyoMidnight, .nordicDusk, .draculaVoid, .deepForest, .oceanicTrench, .lavenderHaze]

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("Pick a look").font(.title.bold())
            Text("The notch stays black so it blends with the real one; the theme colours everything inside. More in Settings → Appearance.")
                .foregroundStyle(.secondary)
            LazyVGrid(columns: [GridItem(.adaptive(minimum: 170), spacing: 10)], spacing: 10) {
                ForEach(free, id: \.self) { id in
                    let t = AppTheme.theme(for: id)
                    let selected = manager.currentThemeID == id
                    Button { withAnimation(.snappy) { manager.setTheme(id) } } label: {
                        HStack(spacing: 10) {
                            Circle().fill(LinearGradient(colors: [t.secondaryAccent, t.primaryAccent], startPoint: .topLeading, endPoint: .bottomTrailing))
                                .frame(width: 26, height: 26)
                                .overlay(Circle().stroke(t.backgroundColor, lineWidth: 3))
                            Text(t.name).foregroundStyle(.white)
                            Spacer()
                            if selected { Image(systemName: "checkmark.circle.fill").foregroundStyle(t.primaryAccent) }
                        }
                        .padding(10)
                        .background(RoundedRectangle(cornerRadius: 10).fill(t.backgroundColor))
                        .overlay(RoundedRectangle(cornerRadius: 10).stroke(selected ? t.primaryAccent : t.borderColor, lineWidth: selected ? 2 : 1))
                        .contentShape(Rectangle())
                    }
                    .buttonStyle(.plain)
                    .accessibilityLabel(t.name)
                    .accessibilityAddTraits(selected ? .isSelected : [])
                }
            }
            if !entitlements.canUse(.proThemes) {
                HStack(spacing: 6) {
                    TierBadge(tier: .pro)
                    Text("Eight more themes and your own colours come with Pro.").font(.caption).foregroundStyle(.secondary)
                }
            }
        }
        .padding(28)
    }
}

private struct OnboardingTour: View {
    private let tips: [(String, String, String)] = [
        ("cursorarrow.click", "Open the notch", "Click it, or press \(HotkeyBinding.notch.label) in any app. Esc or a click outside closes it."),
        ("sparkles", "Ask AI", "Use the AI tab with a free Gemini key or Ollama on your Mac. With Pro, \(HotkeyBinding.capture.label) asks about any part of the screen."),
        ("hand.draw", "Gestures", "Scroll on the closed notch for volume, swipe for tracks, long-press for quick actions. Swipe on the tab bar to scroll through your tabs."),
        ("keyboard", "Keyboard", "⌘1–⌘9 jump to a tab, ⌘[ and ⌘] step through them."),
        ("tray.and.arrow.down", "Drop files", "Drag a file onto the notch to keep it on the shelf for later."),
        ("magnifyingglass", "Settings", "Everything is in Settings, with a search field. Right-click the menu bar icon for quick options."),
    ]

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            Text("Quick tour").font(.title.bold())
            ForEach(tips, id: \.1) { tip in
                HStack(alignment: .top, spacing: 12) {
                    Image(systemName: tip.0).font(.system(size: 15, weight: .semibold)).foregroundStyle(Theme.accent).frame(width: 26)
                    VStack(alignment: .leading, spacing: 2) {
                        Text(tip.1).font(.headline)
                        Text(tip.2).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true)
                    }
                }
            }
        }
        .padding(28)
    }
}
