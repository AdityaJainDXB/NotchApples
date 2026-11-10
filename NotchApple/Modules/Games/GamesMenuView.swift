//
//  GamesMenuView.swift
//  Notch Apple
//
//  The Games menu: a search box, filters, "Jump back in" and a card with a picture for every game. A private game (Flight Economy)
//  shows a lock until an access code unlocks it (PrivateGame.swift). The list and the search are in GamesMenuLogic.swift;
//  this file only draws them. The Windows app has the same menu (modules/gamesmenu.js).
//

import SwiftUI

extension GamesView.Game {
    /// The menu's id for each game (the same ids the Windows app uses).
    static let menuIDs: [(id: String, game: GamesView.Game)] = [
        ("2048", .g2048), ("snake", .snake), ("breakout", .breakout), ("memory", .memory), ("reaction", .reaction), ("cookie", .cookies),
        ("runner", .runner), ("plane", .plane), ("racing", .racing), ("ctf", .ctf), ("rocket", .rocket), ("scribble", .scribble),
        ("chess", .chess), ("tetris", .tetris), ("nightshift", .nightShift), ("fnaf", .fnaf), ("wordle", .dailyWord), ("trivia", .dailyTrivia),
        ("blackjack", .blackjack), ("solitaire", .solitaire), ("poker", .poker),
    ]
    init?(menuID: String) {
        guard let game = Self.menuIDs.first(where: { $0.id == menuID })?.game else { return nil }
        self = game
    }
    var menuID: String { Self.menuIDs.first { $0.game == self }?.id ?? rawValue.lowercased() }
}

struct GamesMenuView: View {
    let open: (GamesView.Game) -> Void
    @ObservedObject private var access = PrivateGames.shared
    @AppStorage(GameSound.key) private var soundOn = true
    @State private var query = ""
    @State private var category = "all"
    @State private var hovered: String?
    @State private var codeFor: GamesCatalog.Entry?
    @State private var notice: String?
    @State private var recents: [GamesCatalog.Entry] = GamesRecents.list.compactMap(GamesCatalog.entry)

    private var list: [GamesCatalog.Entry] { GamesCatalog.filter(GamesCatalog.games, query: query, category: category) }
    private var showRecents: Bool { query.isEmpty && category == "all" && !recents.isEmpty }

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(spacing: 10) {
                HStack(spacing: 6) {
                    Image(systemName: "magnifyingglass").font(.system(size: 11)).foregroundStyle(Theme.textSecondary)
                    TextField("Search games", text: $query).textFieldStyle(.plain).font(.system(size: 12))
                }
                .padding(.horizontal, 9).padding(.vertical, 6)
                .background(RoundedRectangle(cornerRadius: 10, style: .continuous).fill(Color.white.opacity(0.07)))
                .frame(width: 170)
                ScrollView(.horizontal, showsIndicators: false) {
                    HStack(spacing: 6) { ForEach(GamesCatalog.categories) { chip($0) } }
                }
                Button { soundOn.toggle() } label: {
                    Image(systemName: soundOn ? "speaker.wave.2.fill" : "speaker.slash.fill").font(.system(size: 12)).foregroundStyle(Theme.textSecondary)
                }
                .buttonStyle(.plain).help("Game sound")
            }
            if let notice { Text(notice).font(.system(size: 11)).foregroundStyle(Color(hex: "#ff8a9a")) }
            ScrollView(.vertical, showsIndicators: false) {
                VStack(alignment: .leading, spacing: 8) {
                    if showRecents {
                        header("Jump back in")
                        LazyVGrid(columns: Array(repeating: GridItem(.flexible(), spacing: 8), count: 3), spacing: 8) { ForEach(recents) { recentCard($0) } }
                            .padding(.bottom, 4)
                    }
                    header(query.isEmpty && category == "all" ? "All games" : "\(list.count) game\(list.count == 1 ? "" : "s")")
                    LazyVGrid(columns: [GridItem(.adaptive(minimum: 138), spacing: 10)], spacing: 10) { ForEach(list) { card($0) } }
                    if list.isEmpty { Text("No games match. Try another word.").font(.system(size: 12)).foregroundStyle(Theme.textSecondary).frame(maxWidth: .infinity).padding(30) }
                }
                .padding(.bottom, 10)
            }
        }
        .overlay {
            if let g = codeFor {
                GameCodeDialog(entry: g, close: { codeFor = nil }, unlocked: { codeFor = nil; launchPrivate() })
                    .transition(.opacity)
            }
        }
        .animation(Theme.quick, value: codeFor?.id)
    }

    // MARK: Pieces

    private func header(_ text: String) -> some View {
        Text(text.uppercased()).font(.system(size: 10.5, weight: .bold)).tracking(0.6).foregroundStyle(Theme.textSecondary.opacity(0.8))
    }

    private func chip(_ c: GamesCatalog.Category) -> some View {
        let on = c.id == category
        let n = GamesCatalog.counts(GamesCatalog.games)[c.id] ?? 0
        return Button { category = c.id } label: {
            HStack(spacing: 4) {
                Text(c.name).font(.system(size: 12, weight: .semibold))
                Text("\(n)").font(.system(size: 10.5)).opacity(0.55)
            }
            .foregroundStyle(on ? Color(hex: "#14121c") : Color.white.opacity(0.78))
            .padding(.horizontal, 11).padding(.vertical, 5)
            .background(Capsule().fill(on ? Color.white : Color.white.opacity(0.07)))
        }
        .buttonStyle(.plain)
    }

    private func recentCard(_ g: GamesCatalog.Entry) -> some View {
        Button { launch(g) } label: {
            HStack(spacing: 9) {
                art(g).frame(width: 34, height: 34).overlay(Text(g.icon).font(.system(size: 18))).clipShape(RoundedRectangle(cornerRadius: 9, style: .continuous))
                VStack(alignment: .leading, spacing: 1) {
                    Text(g.name).font(.system(size: 12, weight: .semibold)).foregroundStyle(.white).lineLimit(1)
                    Text(g.locked ? "Private" : "Played recently").font(.system(size: 11)).foregroundStyle(Theme.textSecondary)
                }
                Spacer(minLength: 0)
            }
            .padding(.horizontal, 10).padding(.vertical, 8)
            .background(RoundedRectangle(cornerRadius: 12, style: .continuous).fill(Color.white.opacity(0.06)))
        }
        .buttonStyle(.plain)
    }

    private func art(_ g: GamesCatalog.Entry) -> some View {
        LinearGradient(colors: g.art.map { Color(hex: $0) }, startPoint: .topLeading, endPoint: .bottomTrailing)
    }

    private func card(_ g: GamesCatalog.Entry) -> some View {
        let locked = g.locked && !access.isUnlocked()
        let hover = hovered == g.id
        return Button { launch(g) } label: {
            VStack(spacing: 0) {
                ZStack {
                    art(g)
                    Text(g.icon).font(.system(size: 30))
                    if locked {
                        Text("🔒 Code").font(.system(size: 10, weight: .bold)).foregroundStyle(Color(hex: "#ffd28a"))
                            .padding(.horizontal, 6).padding(.vertical, 2).background(Capsule().fill(Color.black.opacity(0.7)))
                            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topTrailing).padding(6)
                    }
                    if hover {
                        Color.black.opacity(0.5)
                        Text(locked ? "Enter code" : "Play").font(.system(size: 12, weight: .bold)).foregroundStyle(Color(hex: "#14121c"))
                            .padding(.horizontal, 14).padding(.vertical, 4).background(Capsule().fill(locked ? Color(hex: "#cdbfff") : Color.white))
                    }
                }
                .frame(height: 64).saturation(locked ? 0.55 : 1).clipped()
                VStack(alignment: .leading, spacing: 3) {
                    Text(g.name).font(.system(size: 12.5, weight: .semibold)).foregroundStyle(.white).lineLimit(1)
                    HStack(spacing: 4) { ForEach(g.tags, id: \.self) { tag($0, unlocked: g.locked && !locked) } }.frame(minHeight: 14, alignment: .leading)
                }
                .padding(.horizontal, 10).padding(.vertical, 7).frame(maxWidth: .infinity, alignment: .leading)
            }
            .background(RoundedRectangle(cornerRadius: 14, style: .continuous).fill(Color.white.opacity(0.05)))
            .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: 14, style: .continuous).stroke(Color.white.opacity(0.06)))
            .offset(y: hover ? -3 : 0)
            .shadow(color: .black.opacity(hover ? 0.5 : 0), radius: 10, y: 6)
        }
        .buttonStyle(.plain)
        .onHover { inside in
            if inside { hovered = g.id } else if hovered == g.id { hovered = nil }
        }
        .animation(.spring(response: 0.25, dampingFraction: 0.8), value: hover)
    }

    private func tagColors(_ t: String) -> (fg: Color, bg: Color) {
        switch t {
        case "Online": return (Color(hex: "#6ee7a8"), Color(hex: "#6ee7a8").opacity(0.18))
        case "New": return (Color(hex: "#3a0a1c"), Color(hex: "#ff8aa8"))
        case "Daily": return (Color(hex: "#ffd28a"), Color(hex: "#ffd28a").opacity(0.2))
        case "Private": return (Color(hex: "#cdbfff"), Color(hex: "#cdbfff").opacity(0.2))
        default: return (Color.white.opacity(0.85), Color.white.opacity(0.1))
        }
    }

    private func tag(_ t: String, unlocked: Bool) -> some View {
        let colors = tagColors(t)
        return Text(t == "Private" && unlocked ? "Private · unlocked" : t)
            .font(.system(size: 9.5, weight: .bold)).foregroundStyle(colors.fg)
            .padding(.horizontal, 6).padding(.vertical, 1)
            .background(Capsule().fill(colors.bg))
    }

    // MARK: Actions

    private func launch(_ g: GamesCatalog.Entry) {
        notice = nil
        if g.locked {
            if access.isUnlocked() { launchPrivate() } else { codeFor = g }
        } else if let game = GamesView.Game(menuID: g.id) {
            open(game)
        }
    }

    private func launchPrivate() {
        Task {
            do { try await PrivateGames.shared.open() } catch { notice = error.localizedDescription }
        }
    }
}

/// The box that asks for an access code (shown over the menu, inside the notch).
private struct GameCodeDialog: View {
    let entry: GamesCatalog.Entry
    let close: () -> Void
    let unlocked: () -> Void
    @State private var code = ""
    @State private var message = ""
    @State private var good = false
    @State private var busy = false
    @FocusState private var focused: Bool

    var body: some View {
        ZStack {
            Color.black.opacity(0.65).onTapGesture { close() }
            VStack(spacing: 10) {
                LinearGradient(colors: entry.art.map { Color(hex: $0) }, startPoint: .topLeading, endPoint: .bottomTrailing)
                    .frame(height: 70).overlay(Text(entry.icon).font(.system(size: 38)))
                    .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
                Text(entry.name).font(.system(size: 16, weight: .bold)).foregroundStyle(.white)
                Text("A private game. Enter the access code you were given to unlock it on this Mac. It stays unlocked.")
                    .font(.system(size: 12)).foregroundStyle(Theme.textSecondary).multilineTextAlignment(.center)
                TextField("XXXX-XXXX-XXXX", text: $code)
                    .textFieldStyle(.plain).font(.system(size: 15, weight: .semibold, design: .monospaced)).multilineTextAlignment(.center)
                    .padding(9).background(RoundedRectangle(cornerRadius: 10, style: .continuous).fill(Color.black.opacity(0.4)))
                    .focused($focused).onSubmit(go)
                    .onChange(of: code) { _, v in let p = GameCode.pretty(v); if p != v { code = p } }
                Text(message).font(.system(size: 12)).foregroundStyle(good ? Color(hex: "#6ee7a8") : Color(hex: "#ff8a9a")).frame(minHeight: 16).multilineTextAlignment(.center)
                HStack {
                    Button("Cancel") { close() }.buttonStyle(.plain).foregroundStyle(Theme.textSecondary).font(.system(size: 12))
                    Spacer()
                    Button(busy ? "Checking…" : "Unlock") { go() }.buttonStyle(PurpleButtonStyle()).disabled(busy)
                }
            }
            .padding(16).frame(width: 340)
            .background(RoundedRectangle(cornerRadius: 18, style: .continuous).fill(Color(hex: "#17151f")))
            .overlay(RoundedRectangle(cornerRadius: 18, style: .continuous).stroke(Color.white.opacity(0.1)))
        }
        .onAppear { focused = true }
    }

    private func go() {
        guard !busy else { return }
        busy = true; good = true; message = "Checking…"
        Task {
            do {
                try await PrivateGames.shared.unlock(code: code)
                message = "Unlocked. Opening the game…"
                try? await Task.sleep(nanoseconds: 500_000_000)
                unlocked()
            } catch {
                good = false; message = error.localizedDescription; busy = false
            }
        }
    }
}
