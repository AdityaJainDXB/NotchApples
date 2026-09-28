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

struct NotchRootView: View {
    @EnvironmentObject private var state: NotchState
    @EnvironmentObject private var settings: SettingsManager

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
                    .transition(.opacity.combined(with: .scale(scale: 0.96, anchor: .top)))
            }
        }
        .frame(width: size.width, height: size.height, alignment: .top)
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
        // Opening is handled by the notch trigger window (click, ⌘E or file drag);
        // hover only shows feedback there and never opens the notch.
        .preferredColorScheme(.dark)
        .tint(Theme.accent)
    }

    /// Radius of the concave shoulders where the notch meets the menu bar.
    static let collapsedShoulder: CGFloat = 6
    static let expandedShoulder: CGFloat = 14

    @ViewBuilder
    private var expandedContent: some View {
        if settings.securityEnabled && !state.isUnlocked {
            LockView()
        } else {
            VStack(spacing: 10) {
                header
                Divider().overlay(Theme.separator)
                moduleBody
                    .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
                    .id(state.selected)
                    .transition(.asymmetric(insertion: .move(edge: .trailing).combined(with: .opacity),
                                            removal: .opacity))
            }
            .padding(.horizontal, 18 + Self.expandedShoulder)
            .padding(.bottom, 18)
            .onAppear(perform: ensureValidSelection)
            .onChange(of: settings.enabledTabs) { _, _ in ensureValidSelection() }
        }
    }

    private var header: some View {
        HStack(spacing: 2) {
            ForEach(settings.enabledTabs) { module in
                // With many tabs, inactive ones collapse to icons so the header fits.
                TabButton(module: module, active: state.selected == module,
                          compact: settings.enabledTabs.count > 6 && state.selected != module) {
                    withAnimation(Theme.spring) { state.selected = module }
                }
            }
            Spacer(minLength: 0)
            if settings.vpnEnabled { VPNQuickStatus() }
            IconButton(systemImage: "gearshape.fill", help: "Settings (⌘,)") {
                state.close(); AppDelegate.openSettingsWindow()
            }
            IconButton(systemImage: "chevron.up", help: "Close (Esc or ⌘E)") { state.close() }
        }
    }

    @ViewBuilder
    private var moduleBody: some View {
        if settings.enabledTabs.isEmpty {
            VStack(spacing: 8) {
                Image(systemName: "square.dashed").font(.largeTitle).foregroundStyle(Theme.accent)
                Text("All modules are turned off").foregroundStyle(.white)
                Button("Open Settings") { state.close(); AppDelegate.openSettingsWindow() }.buttonStyle(PurpleButtonStyle())
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)
        } else {
            switch state.selected {
            case .claude: ClaudeChatView()
            case .messenger: NotchMessengerView()
            case .clipboard: ClipboardView()
            case .shelf: FileShelfView()
            case .share: ShareView()
            case .audio: AudioView()
            case .vpn: VPNView()
            case .nowPlaying: NowPlayingView()
            case .security: EmptyView()
            }
        }
    }

    private func ensureValidSelection() {
        let tabs = settings.enabledTabs
        if !tabs.contains(state.selected), let first = tabs.first { state.selected = first }
    }
}

/// A notch tab: 28 pt tall, with hover and selected states.
private struct TabButton: View {
    @ObservedObject private var notifier = MessengerNotifier.shared
    let module: Module
    let active: Bool
    var compact = false
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
                        Capsule().fill(Theme.accentGradient).shadow(color: Theme.accent.opacity(0.5), radius: 8)
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
