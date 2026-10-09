//
//  ModuleContentView.swift
//  Notch apple
//
//  The screen for a module. The notch uses it for the selected tab; Home uses it inside an accordion and
//  Non-Necessities inside its pages, so a feature looks and works the same wherever it lives.
//

import SwiftUI

struct ModuleContentView: View {
    let module: Module
    @ObservedObject private var entitlements = Entitlements.shared

    var body: some View {
        if let feature = module.feature, !entitlements.canUse(feature) {
            // Paid features show what they do and how to unlock them.
            ActivationModalView(feature: feature)
        } else {
            content
        }
    }

    @ViewBuilder private var content: some View {
        switch module {
        case .claude: ClaudeChatView()
        case .messenger: NotchMessengerView()
        case .today: HomeRouterView()
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
        case .tennis: TennisView()
        case .radar: RadarView()
        case .klick: KlickView()
        case .convert: ConvertView()
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
        case .nonNecessities: NonNecessitiesView()
        case .todo: TodoView()
        case .security: EmptyView()
        }
    }
}

/// Home: the classic page or the widget page, whichever Settings → Modules & Layout picked.
struct HomeRouterView: View {
    @ObservedObject private var layout = ModuleLayout.shared

    var body: some View {
        if layout.homeStyle == .widgets { HomeScreenView() } else { TodayView() }
    }
}
