//
//  Profiles.swift
//  Notch apple
//
//  Pro customization:
//   • Profiles (Work, Study, Gaming…): which tabs show and which theme, switched
//     by the app in front, the time of day, or by hand.
//   • Per-app rules: hide the notch while an app is in front, or have it open on
//     a chosen tab when an app comes forward.
//   • Animation styles, custom sounds and haptics, fonts and the menu bar icon.
//  Everything is evaluated on this Mac when the front app changes (no polling),
//  plus the 30-second heartbeat for time-based profiles.
//

import AppKit
import SwiftUI

@MainActor
final class Profiles: ObservableObject {
    static let shared = Profiles()

    @Published var profiles: [Profile] { didSet { persist(profiles, "profiles.items"); evaluate() } }
    @Published var rules: [AppRule] { didSet { persist(rules, "profiles.appRules"); evaluate() } }
    /// "auto", or a profile ID chosen by hand.
    @AppStorage("profiles.manual") var manual = "auto" { didSet { evaluate() } }
    @Published private(set) var active: Profile?
    @Published private(set) var ruleHidesNotch = false

    private var observer: NSObjectProtocol?

    private init() {
        profiles = UserDefaults.standard.data(forKey: "profiles.items").flatMap { try? JSONDecoder().decode([Profile].self, from: $0) } ?? []
        rules = UserDefaults.standard.data(forKey: "profiles.appRules").flatMap { try? JSONDecoder().decode([AppRule].self, from: $0) } ?? []
    }

    func start() {
        observer = NSWorkspace.shared.notificationCenter.addObserver(forName: NSWorkspace.didActivateApplicationNotification, object: nil, queue: .main) { note in
            let app = note.userInfo?[NSWorkspace.applicationUserInfoKey] as? NSRunningApplication
            MainActor.assumeIsolated { Profiles.shared.evaluate(front: app?.bundleIdentifier, activated: true) }
        }
        evaluate()
    }

    private func persist<T: Encodable>(_ v: T, _ key: String) { UserDefaults.standard.set(try? JSONEncoder().encode(v), forKey: key) }

    /// Works out the active profile and app rules for the app in front.
    func evaluate(front: String? = NSWorkspace.shared.frontmostApplication?.bundleIdentifier, activated: Bool = false) {
        let pro = Entitlements.shared
        var next: Profile?
        if pro.canUse(.profiles) {
            if manual != "auto" { next = profiles.first { $0.id.uuidString == manual } }
            else if let front, let p = profiles.first(where: { $0.apps.contains(front) }) { next = p }
            else { next = profiles.first { $0.matchesTime() } }
        }
        if next != active {
            active = next
            if let id = next?.theme.flatMap(ThemeID.init(rawValue:)) { ThemeManager.shared.applyTemporarily(id) } else { ThemeManager.shared.revalidate() }
            AppDelegate.current?.notch?.reposition()
        }
        let rule = pro.canUse(.appRules) ? rules.first { $0.bundleID == front } : nil
        let hide = rule?.action == .hideNotch
        if hide != ruleHidesNotch { ruleHidesNotch = hide; AppDelegate.current?.notch?.updateAutoHide() }
        if activated, let rule, rule.action == .openTab, let tab = rule.tab.flatMap(Module.init(rawValue:)) {
            AppDelegate.current?.notch?.state.selected = tab
        }
    }

    /// Tabs the active profile hides.
    var hiddenTabs: Set<String> { active?.hiddenTabs ?? [] }
}

// MARK: - Animation, sound, font prefs (Pro)

enum StylePrefs {
    /// Kept in UserDefaults so non-UI code can read it without touching the entitlement layer.
    static var proAllowed: Bool { UserDefaults.standard.bool(forKey: "style.proAllowed") }

    /// smooth (default), snappy, bouncy, calm.
    static var animation: String { proAllowed ? (UserDefaults.standard.string(forKey: "style.animation") ?? "smooth") : "smooth" }
    static var speed: Double { proAllowed ? max(0.5, min(1.6, UserDefaults.standard.object(forKey: "style.speed") as? Double ?? 1)) : 1 }

    static var spring: Animation {
        let s = 1 / speed
        switch animation {
        case "snappy": return .spring(response: 0.3 * s, dampingFraction: 0.9)
        case "bouncy": return .spring(response: 0.48 * s, dampingFraction: 0.62)
        case "calm": return .easeInOut(duration: 0.45 * s)
        default: return .spring(response: 0.42 * s, dampingFraction: 0.82)
        }
    }

    static var openSound: String { proAllowed ? (UserDefaults.standard.string(forKey: "style.openSound") ?? "Pop") : "Pop" }
    static var closeSound: String { proAllowed ? (UserDefaults.standard.string(forKey: "style.closeSound") ?? "Tink") : "Tink" }
    static var haptic: NSHapticFeedbackManager.FeedbackPattern {
        guard proAllowed else { return .levelChange }
        switch UserDefaults.standard.string(forKey: "style.haptic") { case "alignment": return .alignment; case "generic": return .generic; default: return .levelChange }
    }

    static var fontDesign: Font.Design {
        guard proAllowed else { return .default }
        switch UserDefaults.standard.string(forKey: "style.font") { case "rounded": return .rounded; case "serif": return .serif; case "mono": return .monospaced; default: return .default }
    }

    static var statusSymbol: String {
        proAllowed ? (UserDefaults.standard.string(forKey: "style.statusSymbol") ?? "rectangle.topthird.inset.filled") : "rectangle.topthird.inset.filled"
    }

    static let systemSounds = ["Pop", "Tink", "Glass", "Purr", "Bottle", "Frog", "Funk", "Hero", "Morse", "Ping", "Submarine", "Blow", "Basso", "Sosumi"]
    static let statusSymbols = ["rectangle.topthird.inset.filled", "capsule.tophalf.filled", "sparkles", "apple.logo", "circle.hexagongrid.fill", "moon.stars.fill", "bolt.fill", "leaf.fill", "star.fill", "music.note"]

    @MainActor static func sync() { UserDefaults.standard.set(Entitlements.shared.canUse(.animationStyles), forKey: "style.proAllowed") }
}

// MARK: - Settings UI

struct StyleSettingsSection: View {
    @ObservedObject private var entitlements = Entitlements.shared
    @AppStorage("style.animation") private var animation = "smooth"
    @AppStorage("style.speed") private var speed = 1.0
    @AppStorage("style.openSound") private var openSound = "Pop"
    @AppStorage("style.closeSound") private var closeSound = "Tink"
    @AppStorage("style.haptic") private var haptic = "levelChange"
    @AppStorage("style.font") private var font = "default"
    @AppStorage("style.statusSymbol") private var statusSymbol = "rectangle.topthird.inset.filled"

    var body: some View {
        Section {
            Picker("Animation", selection: $animation) {
                Text("Smooth").tag("smooth"); Text("Snappy").tag("snappy"); Text("Bouncy").tag("bouncy"); Text("Calm").tag("calm")
            }
            LabeledContent("Speed") { Slider(value: $speed, in: 0.5...1.6, step: 0.1).frame(width: 200) }
            Picker("Text in the notch", selection: $font) {
                Text("System").tag("default"); Text("Rounded").tag("rounded"); Text("Serif").tag("serif"); Text("Monospaced").tag("mono")
            }
            Picker("Opening sound", selection: $openSound) { ForEach(StylePrefs.systemSounds, id: \.self) { Text($0).tag($0) } }
                .onChange(of: openSound) { _, s in NSSound(named: s)?.play() }
            Picker("Closing sound", selection: $closeSound) { ForEach(StylePrefs.systemSounds, id: \.self) { Text($0).tag($0) } }
                .onChange(of: closeSound) { _, s in NSSound(named: s)?.play() }
            Picker("Haptic feel", selection: $haptic) { Text("Firm").tag("levelChange"); Text("Light").tag("alignment"); Text("Soft").tag("generic") }
            Picker("Menu bar icon", selection: $statusSymbol) {
                ForEach(StylePrefs.statusSymbols, id: \.self) { Label($0, systemImage: $0).labelStyle(.iconOnly).tag($0) }
            }
            .onChange(of: statusSymbol) { _, _ in AppDelegate.current?.refreshStatusIcon() }
        } header: {
            HStack(spacing: 6) {
                Text("Style")
                if !entitlements.canUse(.animationStyles) { TierBadge(tier: .pro) }
            }
        } footer: {
            Text("Sounds and haptics play only if they're turned on in Settings → Notch → Feedback. Reduce Motion always wins over animation styles.")
        }
        .disabled(!entitlements.canUse(.animationStyles))
    }
}

struct ProfilesSettings: View {
    @ObservedObject private var store = Profiles.shared
    @ObservedObject private var entitlements = Entitlements.shared
    @ObservedObject private var settings = SettingsManager.shared

    var body: some View {
        Form {
            Section {
                Picker("Active profile", selection: $store.manual) {
                    Text("Automatic").tag("auto")
                    ForEach(store.profiles) { Text($0.name).tag($0.id.uuidString) }
                }
                if let a = store.active { LabeledContent("Now using", value: a.name) }
                ForEach($store.profiles) { $p in
                    DisclosureGroup {
                        TextField("Name", text: $p.name)
                        Picker("Theme", selection: Binding(get: { p.theme ?? "" }, set: { p.theme = $0.isEmpty ? nil : $0 })) {
                            Text("Keep my theme").tag("")
                            ForEach(ThemeID.allCases.filter { $0 != .custom }, id: \.self) { Text(AppTheme.theme(for: $0).name).tag($0.rawValue) }
                        }
                        Text("Tabs").font(.caption).foregroundStyle(.secondary)
                        LazyVGrid(columns: [GridItem(.adaptive(minimum: 140))], alignment: .leading) {
                            ForEach(settings.enabledTabs) { m in
                                Toggle(m.title, isOn: Binding(get: { !p.hiddenTabs.contains(m.rawValue) },
                                                              set: { on in if on { p.hiddenTabs.remove(m.rawValue) } else { p.hiddenTabs.insert(m.rawValue) } }))
                                    .toggleStyle(.checkbox)
                            }
                        }
                        HStack {
                            Text("Switch when these apps are in front: \(p.apps.isEmpty ? "none" : p.apps.map(Self.appName).joined(separator: ", "))").font(.caption)
                            Spacer()
                            Button("Add app…") { if let id = Self.pickApp() { p.apps.append(id) } }
                            if !p.apps.isEmpty { Button("Clear") { p.apps = [] } }
                        }
                        Toggle("Switch by time of day", isOn: Binding(get: { p.from != nil }, set: { on in p.from = on ? 9 * 60 : nil; p.to = on ? 17 * 60 : nil }))
                        if p.from != nil {
                            HStack {
                                timePicker("From", Binding(get: { p.from ?? 540 }, set: { p.from = $0 }))
                                timePicker("To", Binding(get: { p.to ?? 1020 }, set: { p.to = $0 }))
                            }
                        }
                        Button("Delete profile", role: .destructive) { store.profiles.removeAll { $0.id == p.id } }
                    } label: { Text(p.name).font(.headline) }
                }
                HStack {
                    ForEach(["Work", "Study", "Gaming"], id: \.self) { name in
                        Button("Add \(name)") { store.profiles.append(Profile(name: name)) }
                    }
                }
            } header: {
                HStack(spacing: 6) { Text("Profiles"); if !entitlements.canUse(.profiles) { TierBadge(tier: .pro) } }
            } footer: {
                Text("A profile picks which tabs show and the theme. Automatic switches by the app in front first, then by time of day; otherwise your normal setup is used.")
            }
            .disabled(!entitlements.canUse(.profiles))

            Section {
                ForEach($store.rules) { $r in
                    HStack {
                        Text(r.appName).frame(width: 140, alignment: .leading)
                        Picker("", selection: $r.action) { ForEach(AppRule.Action.allCases, id: \.self) { Text($0.title).tag($0) } }.labelsHidden().fixedSize()
                        if r.action == .openTab {
                            Picker("", selection: Binding(get: { r.tab ?? "" }, set: { r.tab = $0 })) {
                                ForEach(settings.enabledTabs) { Text($0.title).tag($0.rawValue) }
                            }.labelsHidden().fixedSize()
                        }
                        Spacer()
                        Button(role: .destructive) { store.rules.removeAll { $0.id == r.id } } label: { Image(systemName: "minus.circle") }.buttonStyle(.borderless)
                    }
                }
                Button("Add an app…") {
                    if let id = Self.pickApp() { store.rules.append(AppRule(bundleID: id, appName: Self.appName(id))) }
                }
            } header: {
                HStack(spacing: 6) { Text("Per-app rules"); if !entitlements.canUse(.appRules) { TierBadge(tier: .pro) } }
            } footer: {
                Text("For example: hide the notch in Xcode or Keynote, or open Now Playing when Safari comes forward.")
            }
            .disabled(!entitlements.canUse(.appRules))
        }
        .formStyle(.grouped)
    }

    private func timePicker(_ label: String, _ minutes: Binding<Int>) -> some View {
        DatePicker(label, selection: Binding(
            get: { Calendar.current.date(bySettingHour: minutes.wrappedValue / 60, minute: minutes.wrappedValue % 60, second: 0, of: .now) ?? .now },
            set: { minutes.wrappedValue = Calendar.current.component(.hour, from: $0) * 60 + Calendar.current.component(.minute, from: $0) }),
                   displayedComponents: .hourAndMinute).fixedSize()
    }

    static func pickApp() -> String? {
        let panel = NSOpenPanel()
        panel.directoryURL = URL(fileURLWithPath: "/Applications")
        panel.allowedContentTypes = [.application]
        guard panel.runModal() == .OK, let url = panel.url else { return nil }
        return Bundle(url: url)?.bundleIdentifier
    }

    static func appName(_ id: String) -> String {
        NSWorkspace.shared.urlForApplication(withBundleIdentifier: id).map { FileManager.default.displayName(atPath: $0.path).replacingOccurrences(of: ".app", with: "") } ?? id
    }
}
