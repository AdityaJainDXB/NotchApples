//
//  NotchRootView.swift
//  Notch apple
//
//  The SwiftUI shell hosted inside `NotchPanel`. Collapsed, it is a black
//  shape that blends into the hardware notch. On click it springs open into a
//  purple, glassmorphic hub with a tab bar of the enabled modules.
//

import SwiftUI

/// Notch silhouette, like the MacBook's own notch: concave "shoulders" where
/// it meets the menu bar, straight sides, and continuous rounded bottom corners.
struct NotchShape: Shape {
    var topRadius: CGFloat
    var bottomRadius: CGFloat
    /// When false the flat top edge is omitted (used for the outline stroke,
    /// so no line is drawn along the top of the screen).
    var closed = true

    var animatableData: AnimatablePair<CGFloat, CGFloat> {
        get { AnimatablePair(topRadius, bottomRadius) }
        set { topRadius = newValue.first; bottomRadius = newValue.second }
    }

    func path(in rect: CGRect) -> Path {
        let t = min(topRadius, rect.width / 4, rect.height / 4)
        let b = min(bottomRadius, (rect.width - 2 * t) / 2, rect.height - t)
        let k: CGFloat = 0.55   // cubic approximation of a circular arc
        var p = Path()
        p.move(to: CGPoint(x: rect.minX, y: rect.minY))
        // Left shoulder curves down and in.
        p.addCurve(to: CGPoint(x: rect.minX + t, y: rect.minY + t),
                   control1: CGPoint(x: rect.minX + t * k, y: rect.minY),
                   control2: CGPoint(x: rect.minX + t, y: rect.minY + t * (1 - k)))
        p.addLine(to: CGPoint(x: rect.minX + t, y: rect.maxY - b))
        // Bottom-left corner.
        p.addCurve(to: CGPoint(x: rect.minX + t + b, y: rect.maxY),
                   control1: CGPoint(x: rect.minX + t, y: rect.maxY - b * (1 - k)),
                   control2: CGPoint(x: rect.minX + t + b * (1 - k), y: rect.maxY))
        p.addLine(to: CGPoint(x: rect.maxX - t - b, y: rect.maxY))
        // Bottom-right corner.
        p.addCurve(to: CGPoint(x: rect.maxX - t, y: rect.maxY - b),
                   control1: CGPoint(x: rect.maxX - t - b * (1 - k), y: rect.maxY),
                   control2: CGPoint(x: rect.maxX - t, y: rect.maxY - b * (1 - k)))
        p.addLine(to: CGPoint(x: rect.maxX - t, y: rect.minY + t))
        // Right shoulder curves up and out.
        p.addCurve(to: CGPoint(x: rect.maxX, y: rect.minY),
                   control1: CGPoint(x: rect.maxX - t, y: rect.minY + t * (1 - k)),
                   control2: CGPoint(x: rect.maxX - t * k, y: rect.minY))
        if closed { p.closeSubpath() }
        return p
    }
}

/// Keeps the notch open (clicking elsewhere no longer closes it), e.g. while you drag files in from Finder.
/// It reads the setting itself, so the icon always follows it.
struct PinButton: View {
    @AppStorage("ui.stickyNotch") private var pinned = false

    var body: some View {
        IconButton(systemImage: pinned ? "pin.fill" : "pin",
                   help: pinned ? "Pinned open. Click to let it close again." : "Keep open while I drag files in") {
            pinned.toggle()
        }
        .foregroundStyle(pinned ? Theme.accentBright : Theme.textSecondary)
        .accessibilityLabel(pinned ? "Unpin the notch" : "Pin the notch open")
    }
}

struct NotchRootView: View {
    @EnvironmentObject private var state: NotchState
    @EnvironmentObject private var settings: SettingsManager
    @StateObject private var entitlements = Entitlements.shared
    @ObservedObject private var updater = UpdateChecker.shared
    @ObservedObject private var patchLog = PatchLog.shared

    @Namespace private var duoSpace
    /// The tab that was showing before this switch, so the new page knows which side to slide in from.
    @State private var previousSelected: Module?

    /// +1 when the new tab sits to the right of the old one in the tab bar, -1 when to the left.
    private var slideDirection: CGFloat {
        let tabs = state.visibleTabs(settings)
        guard let old = previousSelected, let a = tabs.firstIndex(of: old), let b = tabs.firstIndex(of: state.selected), a != b else { return 1 }
        return b > a ? 1 : -1
    }

    var body: some View {
        let shoulder = state.isExpanded ? Self.expandedShoulder : Self.collapsedShoulder
        let size = state.isExpanded
            ? state.expandedSize
            : CGSize(width: state.notchSize.width + 2 * shoulder, height: state.notchSize.height)
        let bottom: CGFloat = state.isExpanded ? 32 : 10
        ZStack(alignment: .top) {
            NotchShape(topRadius: shoulder, bottomRadius: bottom)
                .fill(state.isExpanded ? AnyShapeStyle(Theme.backdrop) : AnyShapeStyle(Color.black))
                .overlay {
                    if state.isExpanded {
                        NotchShape(topRadius: shoulder, bottomRadius: bottom).fill(.ultraThinMaterial).opacity(0.25)
                        NotchShape(topRadius: shoulder, bottomRadius: bottom, closed: false)
                            .stroke(Theme.accent.opacity(0.35), lineWidth: 1)
                    }
                }
                .shadow(color: state.isExpanded ? Theme.accent.opacity(0.35) : .clear, radius: 24, y: 8)

            if state.isExpanded {
                expandedContent
                    .padding(.top, state.notchSize.height + 4)
                    .transition(Duo.panelTransition)
            }
        }
        .frame(width: size.width, height: size.height, alignment: .top)
        .fontDesign(StylePrefs.fontDesign)
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
        // Opening is handled by the notch trigger window (click, ⌘E or file drag);
        // hover only shows feedback there and never opens the notch.
        .preferredColorScheme(.dark)
        .tint(Theme.accent)
        // A new theme rebuilds the notch so every view picks up the new colours.
        .id(ThemeManager.shared.currentThemeID)
        .onChange(of: state.isExpanded) { _, open in if open { updater.noteNotchOpened() } }
    }

    /// Radius of the concave shoulders where the notch meets the menu bar.
    static let collapsedShoulder: CGFloat = 6
    static let expandedShoulder: CGFloat = 14

    @ViewBuilder
    private var expandedContent: some View {
        if settings.securityEnabled && !state.isUnlocked {
            LockView()
        } else if let required = updater.requiredUpdate {
            RequiredUpdateView(release: required)
        } else if patchLog.isShowing {
            PatchLogView()
        } else if updater.reminderDue, let release = updater.reminderRelease {
            // Every 4th or 5th time the notch is opened while an update is waiting.
            RequiredUpdateView(release: release, skippable: true)
        } else {
            VStack(spacing: 10) {
                header
                Divider().overlay(Theme.separator)
                // A ZStack so the outgoing and incoming pages overlap while they cross-fade instead of stacking.
                ZStack(alignment: .top) {
                    moduleBody
                        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
                        .id(state.selected)
                        .transition(Duo.pageTransition(direction: slideDirection))
                }
                .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
            }
            .overlay(alignment: .bottom) { UndoToast().padding(.bottom, 4) }
            .padding(.horizontal, 18 + Self.expandedShoulder)
            .padding(.bottom, 18)
            .onAppear(perform: ensureValidSelection)
            .onAppear { previousSelected = state.selected }
            .onAppear { NotchWidgetCenter.shared.update(selected: state.selected, open: true) }
            .onDisappear { NotchWidgetCenter.shared.update(selected: state.selected, open: false) }
            .onChange(of: state.selected) { _, new in
                previousSelected = new
                NotchWidgetCenter.shared.update(selected: new, open: state.isExpanded)
            }
            .onChange(of: state.isExpanded) { _, open in NotchWidgetCenter.shared.update(selected: state.selected, open: open) }
            .onChange(of: state.visibleTabs(settings)) { _, _ in ensureValidSelection() }
        }
    }

    private var header: some View {
        HStack(spacing: 2) {
            // With many tabs, inactive ones collapse to icons; if they still don't
            // fit, the row scrolls sideways instead of pushing the buttons off the notch.
            ScrollViewReader { proxy in
                ScrollView(.horizontal, showsIndicators: false) {
                    HStack(spacing: 2) {
                        ForEach(state.visibleTabs(settings)) { module in
                            TabButton(module: module, active: state.selected == module,
                                      compact: state.visibleTabs(settings).count > 6 && state.selected != module,
                                      pillSpace: settings.useDuoAnimations ? duoSpace : nil) {
                                withAnimation(Duo.animation) { state.selected = module }
                            }
                            .id(module)
                        }
                    }
                }
                .onAppear { proxy.scrollTo(state.selected, anchor: .center) }
                .onChange(of: state.selected) { _, new in withAnimation { proxy.scrollTo(new, anchor: .center) } }
            }
            .layoutPriority(-1)
            Spacer(minLength: 0)
            ClaudeCodeDotView()
            UpdatePill { state.close(); AppDelegate.openSettingsWindow(tab: .updates) }
            PinButton()
            IconButton(systemImage: "gearshape.fill", help: "Settings (⌘,)") {
                state.close(); AppDelegate.openSettingsWindow()
            }
            AppActionsButton { state.close() }
            IconButton(systemImage: "chevron.up", help: "Close (Esc or \(HotkeyBinding.notch.label))") { state.close() }
        }
    }

    @ViewBuilder
    private var moduleBody: some View {
        if state.visibleTabs(settings).isEmpty {
            VStack(spacing: 8) {
                Image(systemName: "square.dashed").font(.largeTitle).foregroundStyle(Theme.accent)
                Text("All modules are turned off").foregroundStyle(.white)
                Button("Open Settings") { state.close(); AppDelegate.openSettingsWindow() }.buttonStyle(PurpleButtonStyle())
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)
        } else if let feature = state.selected.feature, !entitlements.canUse(feature) {
            // Pro tabs show what they do and how to unlock them.
            ActivationModalView(feature: feature)
        } else {
            switch state.selected {
            case .claude: ClaudeChatView()
            case .messenger: NotchMessengerView()
            case .today: TodayView()
            case .focus: FocusView()
            case .notes: NotesView()
            case .windows: WindowsView()
            case .tools: ToolsView()
            case .mirror: MirrorView()
            case .worldClock: WorldClockView()
            case .clipboard: ClipboardView()
            case .shelf: FileShelfView()
            case .share: ShareView()
            case .audio: AudioView()
            case .vpn: VPNView()
            case .nowPlaying: NowPlayingView()
            case .search: FileSearchView()
            case .browser: BrowserView()
            case .launcher: AppLauncherView()
            case .translator: NotchTranslatorView()
            case .stats: NotchStatsView()
            case .timer: TimerView()
            case .f1: F1View()
            case .games: GamesView()
            case .sports: SportsView()
            case .snippets: SnippetsView()
            case .shortcuts: ShortcutsView()
            case .devices: DevicesView()
            case .live: LiveView()
            case .alerts: NotificationsView()
            case .plugins: PluginsView()
            case .voiceNotes: VoiceNotesView()
            case .screenTime: ScreenTimeView()
            case .quickAdd: QuickAddView()
            case .markets: MarketsView()
            case .home: HomeView()
            case .cacheCleaner: PurgeView()
            case .claudeUsage: ClaudeUsageView()
            case .smartHome: SmartHomeView()
            case .devTools: DevToolsView()
            case .wellbeing: WellbeingView()
            case .security: EmptyView()
            }
        }
    }

    private func ensureValidSelection() {
        let tabs = state.visibleTabs(settings)
        if !tabs.contains(state.selected), let first = tabs.first { state.selected = first }
    }
}

/// A notch tab: 28 pt tall, with hover and selected states.
private struct TabButton: View {
    @ObservedObject private var notifier = MessengerNotifier.shared
    let module: Module
    let active: Bool
    var compact = false
    /// When set (Duo animations), the highlight is one shape that slides between tabs.
    var pillSpace: Namespace.ID? = nil
    let action: () -> Void
    @State private var hovering = false

    var body: some View {
        Button(action: action) {
            Label(module.title, systemImage: module.symbol)
                .labelStyle(TabLabelStyle(compact: compact))
                .lineLimit(1)
                .fixedSize()
                .font(.system(size: 13, weight: .semibold))
                .foregroundStyle(active || hovering ? .white : Theme.textSecondary)
                .padding(.horizontal, 11)
                .frame(height: Theme.minTarget + 2)
                .background {
                    if active {
                        if let pillSpace {
                            Capsule().fill(Theme.accentGradient).shadow(color: Theme.accent.opacity(0.5), radius: 8)
                                .matchedGeometryEffect(id: "duoPill", in: pillSpace)
                        } else {
                            Capsule().fill(Theme.accentGradient).shadow(color: Theme.accent.opacity(0.5), radius: 8)
                        }
                    } else if hovering {
                        Capsule().fill(Theme.surfaceHover)
                    }
                }
                .contentShape(Capsule())
                .overlay(alignment: .topTrailing) {
                    // Unread messages badge.
                    if module == .messenger && notifier.unread > 0 && !active {
                        Circle().fill(Theme.accentBright).frame(width: 9, height: 9)
                            .overlay(Circle().stroke(Theme.deep, lineWidth: 2))
                            .offset(x: -2, y: 2)
                    }
                }
        }
        .buttonStyle(.plain)
        .onHover { hovering = $0 }
        .help(module == .messenger && notifier.unread > 0 ? "Messenger · \(notifier.unread) unread" : module.title)
        .accessibilityLabel(module.title)
        .accessibilityAddTraits(active ? .isSelected : [])
    }
}

private struct TabLabelStyle: LabelStyle {
    let compact: Bool
    func makeBody(configuration: Configuration) -> some View {
        HStack(spacing: 6) {
            configuration.icon
            if !compact { configuration.title }
        }
    }
}
