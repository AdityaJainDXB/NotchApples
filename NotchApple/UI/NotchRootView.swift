//
//  NotchRootView.swift
//  Notch Apple
//
//  The SwiftUI shell hosted inside `NotchPanel`. Collapsed, it is a black
//  shape that blends into the hardware notch. On click it springs open into a
//  purple, glassmorphic hub with a tab bar of the enabled modules.
//

import os
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

/// Keeps the Mac awake until you click it again. The same Keep Awake as the Tools tab, with no time limit.
struct CoffeeButton: View {
    @ObservedObject private var awake = KeepAwake.shared

    var body: some View {
        IconButton(systemImage: awake.isOn ? "cup.and.saucer.fill" : "cup.and.saucer",
                   help: awake.isOn ? "Mac is staying awake. Click to let it sleep." : "Keep the Mac awake until I click again") {
            if awake.isOn { awake.stop() } else { awake.start(minutes: nil) }
        }
        .foregroundStyle(awake.isOn ? Color.brown : Theme.textSecondary)
        .accessibilityLabel(awake.isOn ? "Let the Mac sleep" : "Keep the Mac awake")
    }
}

/// Keeps the notch open (clicking elsewhere no longer closes it), e.g. while you drag files in from Finder.
/// It reads the setting itself, so the icon always follows it.
struct PinButton: View {
    @AppStorage("ui.stickyNotch") private var pinned = false

    var body: some View {
        IconButton(systemImage: pinned ? "pin.fill" : "pin",
                   help: pinned ? "Pinned open until you close it. Click to unpin." : "Keep open while I drag files in (until you close it)") {
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
    @ObservedObject private var insights = Insights.shared
    @ObservedObject private var patchLog = PatchLog.shared
    @ObservedObject private var tour = TourModel.shared
    @ObservedObject private var topBar = TopBarPrefs.shared
    @ObservedObject private var greeting = GreetingPrefs.shared
    @ObservedObject private var tabChoices = TabChoices.shared

    @Namespace private var duoSpace
    /// The tab that was showing before this switch, so the new page knows which side to slide in from.
    @State private var previousSelected: Module?
    /// "Suggest a tab for the app you're in": the chip shown for a few seconds after the notch opens.
    @State private var suggestion: AppContext.Suggestion?

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

            if state.isExpanded {
                expandedContent
                    .padding(.top, state.notchSize.height + 4)
                    .transition(Duo.panelTransition)
            }
        }
        .frame(width: size.width, height: size.height, alignment: .top)
        // A file dropped anywhere on the open notch (not just inside a tab's own drop area) goes to the Shelf, or to
        // Convert when that is the tab showing. The tabs' own drop areas still take their drops first.
        .onDrop(of: [.fileURL], isTargeted: nil) { providers in
            guard state.isExpanded else { return false }
            // On the NotchAI tab a dropped file goes to NotchAI's documents (read-only), not the Shelf.
            if state.selected == .notchAI {
                guard NotchAIDocuments.shared.handleDrop(providers) else { return false }
                NotchAINav.shared.section = .documents
                return true
            }
            DragLog.log.notice("root drop: \(providers.count, privacy: .public) item(s), tab \(state.selected.rawValue, privacy: .public)")
            let convert = state.selected == .convert && settings.convertEnabled
            if !convert, !settings.shelfEnabled { return false }
            for provider in providers {
                _ = provider.loadObject(ofClass: URL.self) { url, _ in
                    guard let url else { return }
                    DispatchQueue.main.async {
                        if convert { NotificationCenter.default.post(name: DragLog.convertDrop, object: nil, userInfo: ["url": url]) }
                        else { withAnimation(Theme.spring) { FileShelfStore.shared.add(url) } }
                    }
                }
            }
            if !convert { withAnimation(Theme.spring) { state.selected = settings.shelfTab } }
            return true
        }
        .fontDesign(StylePrefs.fontDesign)
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
        // Opening is handled by the notch trigger window (click, ⌘E or file drag);
        // hover only shows feedback there and never opens the notch.
        .preferredColorScheme(.dark)
        .tint(Theme.accent)
        // A new theme rebuilds the notch so every view picks up the new colours.
        .id(ThemeManager.shared.currentThemeID)
        .onChange(of: state.isExpanded) { _, open in if open { updater.noteNotchOpened(); insights.noteNotchOpened() } }
    }

    /// Radius of the concave shoulders where the notch meets the menu bar.
    static let collapsedShoulder: CGFloat = 6
    static let expandedShoulder: CGFloat = 14

    /// Screens that replace the header (lock, update, tour, patch log) still need a way out with the mouse.
    /// Closing only closes the notch: a compulsory update or the tour comes back the next time it opens.
    private var closeButton: some View {
        IconButton(systemImage: "xmark", help: "Close (Esc)") { state.close() }
            .padding(.trailing, 4 + Self.expandedShoulder)
            .accessibilityLabel("Close the notch")
    }

    @ViewBuilder
    private var expandedContent: some View {
        if settings.securityEnabled && !settings.securityOnlyTabs && !state.isUnlocked {
            LockView().insetInNotch().overlay(alignment: .topTrailing) { closeButton }
        } else if let required = updater.requiredUpdate {
            RequiredUpdateView(release: required).insetInNotch().overlay(alignment: .topTrailing) { closeButton }
        } else if entitlements.emailGate != nil {
            // After a required update (which always comes first), however the notch was opened: a key with no email confirms one first.
            // The form itself lives in a window; the notch only points to it.
            EmailGateNotchView().insetInNotch().overlay(alignment: .topTrailing) { closeButton }
        } else if tour.isShowing {
            // Compulsory after the 2.0 update: no skip, it returns until finished.
            TourView().insetInNotch().overlay(alignment: .topTrailing) { closeButton }
        } else if patchLog.isShowing {
            PatchLogView().insetInNotch().overlay(alignment: .topTrailing) { closeButton }
        } else if !topBar.chosen {
            // Once, after installing or updating: pick which header buttons to keep.
            TopBarChooserView().insetInNotch().overlay(alignment: .topTrailing) { closeButton }
        } else if !greeting.chosen {
            // Once, after installing or updating: pick a hello (or no greeting). It stays until answered, however often the notch is closed and opened.
            GreetingChooserView { chose in
                state.close()
                if chose { DispatchQueue.main.asyncAfter(deadline: .now() + 0.6) { HelloAnimation.show(force: true) } }
            }.insetInNotch().overlay(alignment: .topTrailing) { closeButton }
        } else if !tabChoices.chosen {
            // Once, after an update or install: choose what stays on screen. It returns until answered, however often the notch is closed.
            TabChoicesView().insetInNotch().overlay(alignment: .topTrailing) { closeButton }
        } else if updater.reminderDue, let release = updater.reminderRelease {
            // Every 4th or 5th time the notch is opened while an update is waiting.
            RequiredUpdateView(release: release, skippable: true).insetInNotch().overlay(alignment: .topTrailing) { closeButton }
        } else if insights.surveyDue {
            // Every three to four weeks (and from Settings → Help & Feedback): an idea, a problem or praise. Not now skips it.
            FeedbackView().insetInNotch().overlay(alignment: .topTrailing) { closeButton }
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
            // Below the page, not on top of it: the page gives up that room, so the chip never covers a button or the message bar.
            .safeAreaInset(edge: .bottom, spacing: 6) {
                if let s = suggestion {
                    AppSuggestionChip(suggestion: s, open: {
                        withAnimation(Duo.animation) { state.selected = s.tab }
                        withAnimation(Theme.quick) { suggestion = nil }
                    }, dismiss: { withAnimation(Theme.quick) { suggestion = nil } })
                }
            }
            .onAppear(perform: showSuggestion)
            .padding(.horizontal, 18 + Self.expandedShoulder)
            .padding(.bottom, 18)
            .onAppear(perform: ensureValidSelection)
            .onAppear { previousSelected = state.selected }
            .onAppear { settings.undoAILockFromOffer() }
            .onAppear { settings.undoGamesSearchLockFromOffer() }
            .onAppear { settings.moveWorldClockIntoUtilities() }
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
                    let all = state.visibleTabs(settings)
                    let split = settings.tabBar(visible: all, selected: state.selected)
                    HStack(spacing: 2) {
                        ForEach(split.bar) { module in
                            TabButton(module: module, active: state.selected == module,
                                      compact: split.bar.count > 6 && state.selected != module,
                                      pillSpace: settings.useDuoAnimations ? duoSpace : nil) {
                                withAnimation(Duo.animation) { state.selected = module }
                            }
                            .id(module)
                            .contextMenu {
                                Button(settings.isPinned(module) ? "Unpin from the bar" : "Pin to the bar") { settings.togglePin(module) }
                                Text("Drag a tab to reorder")
                            }
                            .onDrag { NSItemProvider(object: module.rawValue as NSString) }
                            .onDrop(of: [.plainText], isTargeted: nil) { providers in
                                guard let provider = providers.first else { return false }
                                _ = provider.loadObject(ofClass: NSString.self) { text, _ in
                                    DispatchQueue.main.async {
                                        if let raw = text as? String, let dragged = Module(rawValue: raw) { settings.moveTab(dragged, before: module, visible: all) }
                                    }
                                }
                                return true
                            }
                        }
                        if !split.more.isEmpty {
                            MoreTabsMenu(tabs: split.more, select: { module in withAnimation(Duo.animation) { state.selected = module } },
                                         pin: { settings.togglePin($0) })
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
            // The always-there buttons share one bordered capsule so they read as a fixed group.
            HStack(spacing: 2) {
                if topBar.shown("coffee") { CoffeeButton() }
                if topBar.shown("pin") { PinButton() }
                if topBar.shown("settings") {
                    IconButton(systemImage: "gearshape.fill", help: "Settings (⌘,)") {
                        state.close(); AppDelegate.openSettingsWindow()
                    }
                }
                AppActionsButton { state.close() }
                if topBar.shown("close") {
                    IconButton(systemImage: "chevron.up", help: "Close (Esc or \(HotkeyBinding.notch.label))") { state.close() }
                }
            }
            .padding(.horizontal, 6).padding(.vertical, 2)
            .background(Capsule().fill(Color.white.opacity(0.05)))
            .overlay(Capsule().strokeBorder(Theme.accent.opacity(0.45), lineWidth: 1))
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
        } else if settings.securityEnabled && settings.securityOnlyTabs && !state.isUnlocked && settings.isLockedTab(state.selected) {
            // "Only lock some tabs": the header stays so you can move to a tab that is not locked.
            LockView()
        } else if let feature = state.selected.feature, !entitlements.canUse(feature) {
            // Pro tabs show what they do and how to unlock them.
            ActivationModalView(feature: feature)
        } else if state.selected == .messenger, !settings.chatLockOfferDone,
                  !(settings.securityEnabled && (!settings.securityOnlyTabs || settings.isLockedTab(.messenger))) {
            // The first time Messenger opens: offer to lock it (Touch ID, the Mac password, or a code).
            ChatLockOffer()
        } else {
            ModuleContentView(module: state.selected)
        }
    }

    private func showSuggestion() {
        let found = AppContext.shared.suggestion(availableTabs: state.visibleTabs(settings), current: state.selected)
        withAnimation(Theme.spring) { suggestion = found }
        guard let found else { return }
        DispatchQueue.main.asyncAfter(deadline: .now() + 8) {
            if suggestion == found { withAnimation(Theme.quick) { suggestion = nil } }
        }
    }

    private func ensureValidSelection() {
        let tabs = state.visibleTabs(settings)
        // A tab that now lives inside Utilities opens Utilities instead.
        if settings.isInsideUtilities(state.selected), tabs.contains(.utilities) { state.selected = .utilities; return }
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
                            tabFill.matchedGeometryEffect(id: "duoPill", in: pillSpace)
                        } else {
                            tabFill
                        }
                    } else if hovering {
                        if liquidMetal { LiquidMetalCapsule(hover: true).opacity(0.55) } else { Capsule().fill(Theme.surfaceHover) }
                    }
                }
                .contentShape(Capsule())
                .overlay(alignment: .topTrailing) {
                    // Unread messages badge.
                    if module == .messenger && notifier.unread > 0 && !active {
                        Text(notifier.unread > 9 ? "9+" : "\(notifier.unread)")
                            .font(.system(size: 8, weight: .bold)).foregroundStyle(.white)
                            .padding(.horizontal, 3.5).frame(minWidth: 13, minHeight: 13)
                            .background(Capsule().fill(Theme.accentBright))
                            .overlay(Capsule().stroke(Theme.deep, lineWidth: 1.5))
                            .offset(x: -2, y: 2)
                    }
                }
        }
        .buttonStyle(MetalPlainStyle())
        .onHover { hovering = $0 }
        .help(module == .messenger && notifier.unread > 0 ? "Messenger · \(notifier.unread) unread" : module.title)
        .accessibilityLabel(module.title)
        .accessibilityAddTraits(active ? .isSelected : [])
    }

    @AppStorage(LiquidMetalSetting.key) private var liquidMetal = false

    /// The highlight behind the open tab: the theme gradient, or flowing liquid metal when that is switched on.
    @ViewBuilder private var tabFill: some View {
        if liquidMetal {
            LiquidMetalCapsule().shadow(color: Theme.accent.opacity(0.45), radius: 8)
        } else {
            Capsule().fill(Theme.accentGradient).shadow(color: Theme.accent.opacity(0.5), radius: 8)
        }
    }
}

/// The "More" button at the end of the bar: every tab that is not pinned. Choosing one opens it; Pin keeps it on the bar.
private struct MoreTabsMenu: View {
    let tabs: [Module]
    let select: (Module) -> Void
    let pin: (Module) -> Void

    var body: some View {
        Menu {
            ForEach(tabs) { module in
                Button { select(module) } label: { Label(module.title, systemImage: module.symbol) }
            }
            Divider()
            Menu("Pin to the bar") {
                ForEach(tabs) { module in Button(module.title) { pin(module) } }
            }
        } label: {
            Label("More", systemImage: "ellipsis")
                .labelStyle(.titleAndIcon)
                .font(.system(size: 13, weight: .semibold))
                .foregroundStyle(Theme.textSecondary)
                .padding(.horizontal, 11)
                .frame(height: Theme.minTarget + 2)
                .contentShape(Capsule())
        }
        .menuStyle(.borderlessButton).menuIndicator(.hidden).fixedSize()
        .help("More tabs (\(tabs.count))")
        .accessibilityLabel("More tabs")
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


extension View {
    /// Keeps a full-panel screen (tour, What's New, update, lock) inside the notch's rounded corners and bottom edge,
    /// with the same margins as the tab pages, so nothing runs out of the shape.
    func insetInNotch() -> some View {
        padding(.horizontal, 18 + NotchRootView.expandedShoulder).padding(.bottom, 18)
    }
}
