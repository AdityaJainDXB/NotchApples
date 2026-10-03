//
//  AppTheme.swift
//  Notch apple
//
//  Colour themes. `ThemeManager` remembers the chosen theme; the `Theme` tokens
//  (Theme.swift) read from it, so every screen picks it up. The default is
//  "Notch Purple", the app's original look. Chosen in Settings → Appearance.
//

import SwiftUI
import AppKit

// MARK: - Color hex

extension Color {
    init(hex: String, opacity: Double = 1.0) {
        let hex = hex.trimmingCharacters(in: CharacterSet.alphanumerics.inverted)
        var int: UInt64 = 0
        Scanner(string: hex).scanHexInt64(&int)
        let a, r, g, b: UInt64
        switch hex.count {
        case 3: (a, r, g, b) = (255, (int >> 8) * 17, (int >> 4 & 0xF) * 17, (int & 0xF) * 17)
        case 6: (a, r, g, b) = (255, int >> 16, int >> 8 & 0xFF, int & 0xFF)
        case 8: (a, r, g, b) = (int >> 24, int >> 16 & 0xFF, int >> 8 & 0xFF, int & 0xFF)
        default: (a, r, g, b) = (255, 0, 0, 0)
        }
        self.init(.sRGB, red: Double(r) / 255, green: Double(g) / 255, blue: Double(b) / 255,
                  opacity: (Double(a) / 255) * opacity)
    }
}

// MARK: - Categories and ids

enum ThemeCategory: String, CaseIterable, Identifiable, Codable {
    case classic = "Classic"
    case minimal = "Minimal & Premium"
    case cyberpunk = "Cyberpunk & Neon"
    case darkCozy = "Dark & Cozy"
    case nature = "Nature & Earthy"
    case pastel = "Modern Pastel"

    var id: String { rawValue }

    var iconName: String {
        switch self {
        case .classic: "sparkles"
        case .minimal: "apple.logo"
        case .cyberpunk: "bolt.horizontal.fill"
        case .darkCozy: "moon.stars.fill"
        case .nature: "leaf.fill"
        case .pastel: "paintpalette.fill"
        }
    }
}

enum ThemeID: String, CaseIterable, Identifiable, Codable {
    case notchPurple = "notch_purple"
    case oledObsidian = "oled_obsidian", graphiteTitanium = "graphite_titanium"
    case tokyoMidnight = "tokyo_midnight", synthwaveDusk = "synthwave_dusk", matrixGreen = "matrix_green"
    case nordicDusk = "nordic_dusk", draculaVoid = "dracula_void", espressoMocha = "espresso_mocha"
    case deepForest = "deep_forest", sunsetHorizon = "sunset_horizon", oceanicTrench = "oceanic_trench"
    case matchaCream = "matcha_cream", lavenderHaze = "lavender_haze"

    var id: String { rawValue }
}

// MARK: - Palette

struct AppTheme: Identifiable, Hashable {
    let id: ThemeID
    let name: String
    let category: ThemeCategory
    let backgroundColor: Color
    let surfaceColor: Color
    let primaryAccent: Color
    let secondaryAccent: Color
    let textColor: Color
    let borderColor: Color
    let glowColor: Color
    /// The notch's expanded backdrop fades from `backgroundColor` to this (opaque) colour.
    let backdropEnd: Color

    static func == (lhs: AppTheme, rhs: AppTheme) -> Bool { lhs.id == rhs.id }
    func hash(into hasher: inout Hasher) { hasher.combine(id) }

    /// Palette entry; the backdrop's far corner is the background tinted 25% toward the accent.
    fileprivate init(_ id: ThemeID, _ name: String, _ category: ThemeCategory,
                     background: String, surface: Color, primary: String, secondary: String, text: String,
                     border: Color, glow: Color) {
        self.id = id; self.name = name; self.category = category
        backgroundColor = Color(hex: background); surfaceColor = surface
        primaryAccent = Color(hex: primary); secondaryAccent = Color(hex: secondary)
        textColor = Color(hex: text); borderColor = border; glowColor = glow
        let bg = NSColor(Color(hex: background)).usingColorSpace(.sRGB) ?? .black
        let ac = NSColor(Color(hex: primary)).usingColorSpace(.sRGB) ?? .white
        backdropEnd = Color(nsColor: bg.blended(withFraction: 0.25, of: ac) ?? bg)
    }

    /// The original purple look, kept exactly as it was.
    fileprivate init(classic id: ThemeID) {
        self.id = id; name = "Notch Purple"; category = .classic
        backgroundColor = Color(red: 0.05, green: 0.02, blue: 0.10)
        surfaceColor = Color.white.opacity(0.07)
        primaryAccent = Color(red: 0.62, green: 0.42, blue: 1.0)
        secondaryAccent = Color(red: 0.78, green: 0.62, blue: 1.0)
        textColor = .white
        borderColor = Color.white.opacity(0.10)
        glowColor = Color(red: 0.62, green: 0.42, blue: 1.0).opacity(0.35)
        backdropEnd = Color(red: 0.22, green: 0.09, blue: 0.42)
    }
}

extension AppTheme {
    /// Frost & Glacier is left out on purpose: the app's text is white, which is unreadable on a light theme.
    static let allThemes: [ThemeID: AppTheme] = {
        let list: [AppTheme] = [
            AppTheme(classic: .notchPurple),
            // Minimal & Premium
            AppTheme(.oledObsidian, "OLED Obsidian", .minimal, background: "#000000", surface: Color.white.opacity(0.06),
                     primary: "#FFFFFF", secondary: "#8E8E93", text: "#FFFFFF",
                     border: Color.white.opacity(0.12), glow: Color.white.opacity(0.15)),
            AppTheme(.graphiteTitanium, "Graphite & Titanium", .minimal, background: "#1E1E24", surface: Color(hex: "#2A2A32"),
                     primary: "#007AFF", secondary: "#5E5CE6", text: "#F2F2F7",
                     border: Color(hex: "#3A3A46"), glow: Color(hex: "#007AFF", opacity: 0.25)),
            // Cyberpunk & Neon
            AppTheme(.tokyoMidnight, "Tokyo Midnight", .cyberpunk, background: "#0B0C10", surface: Color(hex: "#1F2833"),
                     primary: "#66FCF1", secondary: "#45A29E", text: "#C5C6C7",
                     border: Color(hex: "#45A29E", opacity: 0.4), glow: Color(hex: "#FF0055")),
            AppTheme(.synthwaveDusk, "Synthwave Dusk", .cyberpunk, background: "#12092B", surface: Color(hex: "#241442"),
                     primary: "#FF71CE", secondary: "#01CDFE", text: "#F2EBF9",
                     border: Color(hex: "#FF71CE", opacity: 0.35), glow: Color(hex: "#05FFA1")),
            AppTheme(.matrixGreen, "Matrix Green", .cyberpunk, background: "#050B05", surface: Color(hex: "#0D1F0D"),
                     primary: "#00FF66", secondary: "#4CAF50", text: "#E0FFE0",
                     border: Color(hex: "#1B431C"), glow: Color(hex: "#00FF66", opacity: 0.3)),
            // Dark & Cozy
            AppTheme(.nordicDusk, "Nordic Dusk", .darkCozy, background: "#2E3440", surface: Color(hex: "#3B4252"),
                     primary: "#88C0D0", secondary: "#EBCB8B", text: "#ECEFF4",
                     border: Color(hex: "#434C5E"), glow: Color(hex: "#88C0D0", opacity: 0.25)),
            AppTheme(.draculaVoid, "Dracula Void", .darkCozy, background: "#282A36", surface: Color(hex: "#343746"),
                     primary: "#FF79C6", secondary: "#BD93F9", text: "#F8F8F2",
                     border: Color(hex: "#44475A"), glow: Color(hex: "#8BE9FD", opacity: 0.3)),
            AppTheme(.espressoMocha, "Espresso & Mocha", .darkCozy, background: "#1E1E1E", surface: Color(hex: "#2D2A2E"),
                     primary: "#FFD866", secondary: "#FF6188", text: "#FCFCFA",
                     border: Color(hex: "#403E41"), glow: Color(hex: "#FFD866", opacity: 0.25)),
            // Nature & Earthy
            AppTheme(.deepForest, "Deep Forest", .nature, background: "#0D1B1E", surface: Color(hex: "#152A2D"),
                     primary: "#52B788", secondary: "#B7E4C7", text: "#E8F5E9",
                     border: Color(hex: "#2D4A43"), glow: Color(hex: "#E76F51", opacity: 0.3)),
            AppTheme(.sunsetHorizon, "Sunset Horizon", .nature, background: "#1A0A13", surface: Color(hex: "#2D1222"),
                     primary: "#FF7B54", secondary: "#FFB26B", text: "#FFF0E6",
                     border: Color(hex: "#4A1D39"), glow: Color(hex: "#FFD93D", opacity: 0.3)),
            AppTheme(.oceanicTrench, "Oceanic Trench", .nature, background: "#0A192F", surface: Color(hex: "#112240"),
                     primary: "#64FFDA", secondary: "#57CBDE", text: "#CCD6F6",
                     border: Color(hex: "#233554"), glow: Color(hex: "#64FFDA", opacity: 0.25)),
            // Modern Pastel
            AppTheme(.matchaCream, "Matcha & Cream", .pastel, background: "#192019", surface: Color(hex: "#253325"),
                     primary: "#A8DADC", secondary: "#E2F0D9", text: "#F4F9F4",
                     border: Color(hex: "#364A36"), glow: Color(hex: "#F4A261", opacity: 0.3)),
            AppTheme(.lavenderHaze, "Lavender Haze", .pastel, background: "#16131E", surface: Color(hex: "#262035"),
                     primary: "#C77DFF", secondary: "#E0AAFF", text: "#F3EAFF",
                     border: Color(hex: "#3D3054"), glow: Color(hex: "#7B2CBF", opacity: 0.35)),
        ]
        return Dictionary(uniqueKeysWithValues: list.map { ($0.id, $0) })
    }()

    static func theme(for id: ThemeID) -> AppTheme { allThemes[id] ?? allThemes[.notchPurple]! }
}

// MARK: - Manager

@Observable
final class ThemeManager {
    static let shared = ThemeManager()
    private static let storageKey = "selected_theme_id"

    private(set) var currentThemeID: ThemeID
    private(set) var currentTheme: AppTheme

    init() {
        let raw = UserDefaults.standard.string(forKey: Self.storageKey) ?? ThemeID.notchPurple.rawValue
        let id = ThemeID(rawValue: raw).flatMap { AppTheme.allThemes[$0] != nil ? $0 : nil } ?? .notchPurple
        currentThemeID = id
        currentTheme = AppTheme.theme(for: id)
    }

    func setTheme(_ id: ThemeID) {
        guard id != currentThemeID else { return }
        UserDefaults.standard.set(id.rawValue, forKey: Self.storageKey)
        currentThemeID = id
        currentTheme = AppTheme.theme(for: id)
    }

    func themes(for category: ThemeCategory) -> [AppTheme] {
        ThemeID.allCases.compactMap { AppTheme.allThemes[$0] }.filter { $0.category == category }
    }
}

// MARK: - Settings UI

/// Settings → Appearance: a live preview and swatches for every theme, grouped by category.
struct AppearanceSettings: View {
    private let manager = ThemeManager.shared
    @AppStorage("appearance.settingsWindow") private var windowMode = "system"

    var body: some View {
        let current = manager.currentTheme
        Form {
            Section {
                Picker("Settings window", selection: $windowMode) {
                    Text("System").tag("system"); Text("Light").tag("light"); Text("Dark").tag("dark")
                }
                .pickerStyle(.segmented)
                .onChange(of: windowMode) { _, _ in SettingsWindowController.applyAppearance() }
            } footer: {
                Text("The notch itself is always dark, so it blends with the real notch.")
            }
            TabOrderSection()
            Section {
                ThemePreview(theme: current)
                    .listRowInsets(EdgeInsets(top: 10, leading: 10, bottom: 10, trailing: 10))
            } footer: {
                Text("Themes change the colours of the whole notch and Settings. Your choice is remembered.")
            }
            ForEach(ThemeCategory.allCases) { category in
                let themes = manager.themes(for: category)
                if !themes.isEmpty {
                    Section {
                        LazyVGrid(columns: [GridItem(.adaptive(minimum: 124), spacing: 10)], alignment: .leading, spacing: 10) {
                            ForEach(themes) { theme in
                                ThemeSwatchCard(theme: theme, isSelected: current.id == theme.id) {
                                    withAnimation(.snappy) { manager.setTheme(theme.id) }
                                }
                            }
                        }
                        .padding(.vertical, 4)
                    } header: {
                        Label(category.rawValue, systemImage: category.iconName)
                    }
                }
            }
        }
        .formStyle(.grouped)
    }
}

/// Drag the notch's tabs (including add-ons) into the order you want.
private struct TabOrderSection: View {
    @ObservedObject private var settings = SettingsManager.shared

    var body: some View {
        let enabled = settings.enabledTabs
        Section {
            List {
                ForEach(enabled) { module in
                    HStack(spacing: 10) {
                        Image(systemName: "line.3.horizontal").foregroundStyle(.secondary)
                        Image(systemName: module.symbol)
                            .font(.system(size: 11, weight: .semibold)).foregroundStyle(.white)
                            .frame(width: 22, height: 22)
                            .background(Theme.accentGradient, in: RoundedRectangle(cornerRadius: 6, style: .continuous))
                        Text(module.title)
                        Spacer()
                        Button { move(module, by: -1) } label: { Image(systemName: "chevron.up") }
                            .buttonStyle(.borderless).disabled(module == enabled.first).help("Move up")
                        Button { move(module, by: 1) } label: { Image(systemName: "chevron.down") }
                            .buttonStyle(.borderless).disabled(module == enabled.last).help("Move down")
                    }
                    .padding(.vertical, 2)
                }
                .onMove { from, to in
                    var list = enabled
                    list.move(fromOffsets: from, toOffset: to)
                    save(list)
                }
            }
            .frame(height: CGFloat(max(enabled.count, 1)) * 34 + 8)
            .scrollDisabled(true)
            HStack {
                Spacer()
                Button("Reset to default order") { settings.resetTabOrder() }
            }
        } header: {
            Text("Notch tab order")
        } footer: {
            Text("Drag tabs up or down (or use the arrows) to choose their order in the notch. Add-ons you turn on in Settings → Modules appear here too.")
        }
    }

    private func move(_ module: Module, by step: Int) {
        var list = settings.enabledTabs
        guard let i = list.firstIndex(of: module), list.indices.contains(i + step) else { return }
        list.swapAt(i, i + step)
        save(list)
    }

    /// Keeps turned-off modules in their old relative places.
    private func save(_ enabledOrder: [Module]) {
        var queue = enabledOrder
        let full = settings.orderedTabs.map { settings.isEnabled($0) ? queue.removeFirst() : $0 }
        settings.setTabOrder(full)
    }
}

/// A miniature expanded notch in the theme's colours.
private struct ThemePreview: View {
    let theme: AppTheme

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack {
                ForEach(["Today", "AI", "Notes"], id: \.self) { tab in
                    Text(tab).font(.system(size: 12, weight: .semibold))
                        .padding(.horizontal, 10).padding(.vertical, 5)
                        .foregroundStyle(tab == "Today" ? Color.black : theme.textColor.opacity(0.75))
                        .background(tab == "Today" ? theme.primaryAccent : Color.clear, in: Capsule())
                }
                Spacer()
                Circle().fill(theme.secondaryAccent).frame(width: 10, height: 10)
            }
            HStack(spacing: 10) {
                RoundedRectangle(cornerRadius: 10).fill(Color.white.opacity(0.07)).frame(height: 44)
                    .overlay(alignment: .leading) {
                        VStack(alignment: .leading, spacing: 3) {
                            Text(theme.name).font(.system(size: 13, weight: .bold)).foregroundStyle(theme.textColor)
                            Text("Preview").font(.system(size: 11)).foregroundStyle(theme.textColor.opacity(0.74))
                        }.padding(.horizontal, 12)
                    }
                Capsule().fill(LinearGradient(colors: [theme.secondaryAccent, theme.primaryAccent],
                                              startPoint: .leading, endPoint: .trailing))
                    .frame(width: 90, height: 8)
            }
        }
        .padding(14)
        .background(LinearGradient(colors: [theme.backgroundColor, theme.backgroundColor, theme.backdropEnd],
                                   startPoint: .top, endPoint: .bottomTrailing),
                    in: RoundedRectangle(cornerRadius: 16, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 16, style: .continuous).strokeBorder(theme.borderColor))
        .shadow(color: theme.glowColor, radius: 10)
    }
}

private struct ThemeSwatchCard: View {
    let theme: AppTheme
    let isSelected: Bool
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            VStack(spacing: 6) {
                ZStack {
                    Circle().fill(theme.backgroundColor).frame(width: 38, height: 38)
                        .shadow(color: theme.glowColor, radius: isSelected ? 6 : 1)
                    Circle().fill(theme.surfaceColor).frame(width: 26, height: 26)
                    HStack(spacing: 2) {
                        Circle().fill(theme.primaryAccent).frame(width: 8, height: 8)
                        Circle().fill(theme.secondaryAccent).frame(width: 8, height: 8)
                    }
                }
                .overlay(Circle().stroke(isSelected ? theme.primaryAccent : theme.borderColor, lineWidth: isSelected ? 2 : 1))
                Text(theme.name).font(.system(size: 11, weight: isSelected ? .bold : .medium))
                    .lineLimit(1).frame(maxWidth: .infinity)
                    .foregroundStyle(.primary)
            }
            .padding(.vertical, 6).padding(.horizontal, 4)
            .background(RoundedRectangle(cornerRadius: 10, style: .continuous)
                .fill(isSelected ? theme.primaryAccent.opacity(0.18) : Color.clear))
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityLabel(theme.name)
        .accessibilityAddTraits(isSelected ? [.isButton, .isSelected] : .isButton)
    }
}
