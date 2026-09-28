//
//  NotchRootView.swift
//  Notch apple
//
//  The SwiftUI shell hosted inside `NotchPanel`. Collapsed, it is a black
//  shape that blends into the hardware notch. On click it springs open into a
//  purple, glassmorphic hub with a tab bar of the enabled modules.
//

import SwiftUI

/// Notch silhouette: flat top edge, softly rounded bottom corners.
struct NotchShape: Shape {
    var bottomRadius: CGFloat
    var animatableData: CGFloat {
        get { bottomRadius }
        set { bottomRadius = newValue }
    }

    func path(in rect: CGRect) -> Path {
        let r = min(bottomRadius, rect.height / 2, rect.width / 2)
        var p = Path()
        p.move(to: CGPoint(x: rect.minX, y: rect.minY))
        p.addLine(to: CGPoint(x: rect.maxX, y: rect.minY))
        p.addLine(to: CGPoint(x: rect.maxX, y: rect.maxY - r))
        p.addQuadCurve(to: CGPoint(x: rect.maxX - r, y: rect.maxY), control: CGPoint(x: rect.maxX, y: rect.maxY))
        p.addLine(to: CGPoint(x: rect.minX + r, y: rect.maxY))
        p.addQuadCurve(to: CGPoint(x: rect.minX, y: rect.maxY - r), control: CGPoint(x: rect.minX, y: rect.maxY))
        p.closeSubpath()
        return p
    }
}

struct NotchRootView: View {
    @EnvironmentObject private var state: NotchState
    @EnvironmentObject private var settings: SettingsManager

    var body: some View {
        let size = state.isExpanded ? state.expandedSize : state.notchSize
        ZStack(alignment: .top) {
            NotchShape(bottomRadius: state.isExpanded ? 28 : 10)
                .fill(state.isExpanded ? AnyShapeStyle(Theme.backdrop) : AnyShapeStyle(Color.black))
                .overlay {
                    if state.isExpanded {
                        NotchShape(bottomRadius: 28).fill(.ultraThinMaterial).opacity(0.25)
                        NotchShape(bottomRadius: 28).stroke(Theme.accent.opacity(0.35), lineWidth: 1)
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
            .padding(.horizontal, 18)
            .padding(.bottom, 16)
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
        }
        .buttonStyle(.plain)
        .onHover { hovering = $0 }
        .help(module.title)
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
