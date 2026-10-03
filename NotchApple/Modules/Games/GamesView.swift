//
//  GamesView.swift
//  Notch apple
//
//  Notch Games: tiny games for a short break, right in the panel.
//   • 2048: arrow keys (or WASD) slide the tiles; merge to 2048.
//   • Snake: arrow keys steer; eat to grow, don't hit yourself or the wall.
//   • Reaction: wait for green, then click (or press Space) as fast as you can.
//  Best scores are kept on this Mac. Nothing runs while the tab is closed.
//

import SwiftUI

struct GamesView: View {
    enum Game: String, CaseIterable, Identifiable {
        case g2048 = "2048", snake = "Snake", reaction = "Reaction"
        var id: String { rawValue }
        var symbol: String {
            switch self {
            case .g2048: "square.grid.4x3.fill"
            case .snake: "scribble.variable"
            case .reaction: "bolt.fill"
            }
        }
    }

    @AppStorage("games.last") private var lastRaw = Game.g2048.rawValue
    private var game: Game { Game(rawValue: lastRaw) ?? .g2048 }

    var body: some View {
        HStack(alignment: .top, spacing: 12) {
            VStack(alignment: .leading, spacing: 6) {
                ForEach(Game.allCases) { g in
                    Button { lastRaw = g.rawValue } label: {
                        Label(g.rawValue, systemImage: g.symbol).font(.system(size: 12, weight: .semibold))
                            .frame(maxWidth: .infinity, alignment: .leading)
                    }
                    .buttonStyle(PurpleButtonStyle(prominent: g == game))
                }
                Spacer()
                Text(hint).font(.system(size: 10)).foregroundStyle(Theme.textSecondary).fixedSize(horizontal: false, vertical: true)
            }
            .frame(width: 130)
            GlassCard {
                switch game {
                case .g2048: Game2048View()
                case .snake: SnakeView()
                case .reaction: ReactionView()
                }
            }
            .id(game)
        }
    }

    private var hint: String {
        switch game {
        case .g2048: "Arrow keys or WASD. Same numbers merge."
        case .snake: "Arrow keys steer. Space pauses."
        case .reaction: "Wait for green, then click or press Space."
        }
    }
}

/// Key handling shared by the games: the view grabs focus so arrow keys reach it.
private struct KeyCatcher: ViewModifier {
    let onKey: (KeyPress) -> KeyPress.Result
    @FocusState private var focused: Bool
    func body(content: Content) -> some View {
        content
            .focusable()
            .focusEffectDisabled()
            .focused($focused)
            .onKeyPress { onKey($0) }
            .onAppear { focused = true }
            .onTapGesture { focused = true }
    }
}

private enum Dir { case up, down, left, right
    init?(_ key: KeyPress) {
        switch key.key {
        case .upArrow: self = .up
        case .downArrow: self = .down
        case .leftArrow: self = .left
        case .rightArrow: self = .right
        default:
            switch key.characters.lowercased() {
            case "w": self = .up
            case "s": self = .down
            case "a": self = .left
            case "d": self = .right
            default: return nil
            }
        }
    }
}

// MARK: - 2048

struct Game2048View: View {
    @State private var board = Game2048View.fresh()
    @State private var score = 0
    @AppStorage("games.2048.best") private var best = 0
    @State private var over = false

    static func fresh() -> [[Int]] {
        var b = Array(repeating: Array(repeating: 0, count: 4), count: 4)
        addTile(&b); addTile(&b)
        return b
    }

    static func addTile(_ b: inout [[Int]]) {
        let empty = (0..<16).filter { b[$0 / 4][$0 % 4] == 0 }
        guard let i = empty.randomElement() else { return }
        b[i / 4][i % 4] = Int.random(in: 0..<10) == 0 ? 4 : 2
    }

    /// Slides one row to the left, merging equal neighbours once. Returns the points gained.
    static func slide(_ row: [Int]) -> ([Int], Int) {
        var tiles = row.filter { $0 != 0 }, out: [Int] = [], gained = 0, i = 0
        while i < tiles.count {
            if i + 1 < tiles.count, tiles[i] == tiles[i + 1] { out.append(tiles[i] * 2); gained += tiles[i] * 2; i += 2 }
            else { out.append(tiles[i]); i += 1 }
        }
        tiles = out + Array(repeating: 0, count: 4 - out.count)
        return (tiles, gained)
    }

    private func move(_ d: Dir) {
        guard !over else { return }
        var b = board, gained = 0
        for i in 0..<4 {
            var line: [Int]
            switch d {
            case .left: line = b[i]
            case .right: line = b[i].reversed()
            case .up: line = (0..<4).map { b[$0][i] }
            case .down: line = (0..<4).reversed().map { b[$0][i] }
            }
            let (moved, g) = Self.slide(line); gained += g
            for j in 0..<4 {
                switch d {
                case .left: b[i][j] = moved[j]
                case .right: b[i][3 - j] = moved[j]
                case .up: b[j][i] = moved[j]
                case .down: b[3 - j][i] = moved[j]
                }
            }
        }
        guard b != board else { return }
        Self.addTile(&b)
        withAnimation(.easeOut(duration: 0.12)) { board = b }
        score += gained
        best = max(best, score)
        over = !canMove(b)
    }

    private func canMove(_ b: [[Int]]) -> Bool {
        for r in 0..<4 { for c in 0..<4 {
            if b[r][c] == 0 { return true }
            if c < 3, b[r][c] == b[r][c + 1] { return true }
            if r < 3, b[r][c] == b[r + 1][c] { return true }
        } }
        return false
    }

    var body: some View {
        HStack(alignment: .top, spacing: 16) {
            VStack(spacing: 5) {
                ForEach(0..<4, id: \.self) { r in
                    HStack(spacing: 5) {
                        ForEach(0..<4, id: \.self) { c in tile(board[r][c]) }
                    }
                }
            }
            .padding(6).background(Color.white.opacity(0.05), in: RoundedRectangle(cornerRadius: 10))
            .overlay {
                if over {
                    VStack(spacing: 8) {
                        Text("No moves left").font(.headline).foregroundStyle(.white)
                        Button("Play again", action: restart).buttonStyle(PurpleButtonStyle())
                    }
                    .padding(14).background(.black.opacity(0.75), in: RoundedRectangle(cornerRadius: 10))
                }
            }
            VStack(alignment: .leading, spacing: 8) {
                stat("Score", score)
                stat("Best", best)
                Button("New game", action: restart).buttonStyle(PurpleButtonStyle(prominent: false))
            }
        }
        .modifier(KeyCatcher { key in
            guard let d = Dir(key) else { return .ignored }
            move(d); return .handled
        })
        .accessibilityLabel("2048. Score \(score). Use the arrow keys.")
    }

    private func restart() { board = Self.fresh(); score = 0; over = false }

    private func stat(_ title: String, _ value: Int) -> some View {
        VStack(alignment: .leading, spacing: 0) {
            Text(title).font(.system(size: 10)).foregroundStyle(Theme.textSecondary)
            Text("\(value)").font(.system(size: 20, weight: .bold).monospacedDigit()).foregroundStyle(.white)
        }
    }

    private func tile(_ v: Int) -> some View {
        let level = v == 0 ? 0 : Int(log2(Double(v)))
        return Text(v == 0 ? "" : "\(v)")
            .font(.system(size: v >= 1000 ? 15 : 19, weight: .bold).monospacedDigit())
            .foregroundStyle(level > 2 ? .white : Color(white: 0.15))
            .frame(width: 44, height: 44)
            .background(v == 0 ? Color.white.opacity(0.06)
                        : level <= 2 ? Color(white: 0.92 - Double(level) * 0.06)
                        : Theme.accent.opacity(min(1, 0.35 + Double(level) * 0.07)),
                        in: RoundedRectangle(cornerRadius: 7))
    }
}

// MARK: - Snake

struct SnakeView: View {
    private static let cols = 22, rows = 12
    @State private var snake: [CGPoint] = [CGPoint(x: 5, y: 6), CGPoint(x: 4, y: 6), CGPoint(x: 3, y: 6)]
    @State private var dir = CGPoint(x: 1, y: 0)
    @State private var nextDir = CGPoint(x: 1, y: 0)
    @State private var food = CGPoint(x: 14, y: 6)
    @State private var running = false
    @State private var dead = false
    @AppStorage("games.snake.best") private var best = 0
    private let tick = Timer.publish(every: 0.11, on: .main, in: .common).autoconnect()

    var score: Int { snake.count - 3 }

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack {
                Text("Score \(score)").font(.system(size: 12, weight: .bold).monospacedDigit()).foregroundStyle(.white)
                Text("Best \(best)").font(.system(size: 11).monospacedDigit()).foregroundStyle(Theme.textSecondary)
                Spacer()
                Button(dead ? "Play again" : running ? "Pause" : "Start") { dead ? restart() : running.toggle() }
                    .buttonStyle(PurpleButtonStyle(prominent: !running))
            }
            GeometryReader { geo in
                let cell = min(geo.size.width / CGFloat(Self.cols), geo.size.height / CGFloat(Self.rows))
                ZStack(alignment: .topLeading) {
                    RoundedRectangle(cornerRadius: 8).fill(Color.white.opacity(0.05))
                        .frame(width: cell * CGFloat(Self.cols), height: cell * CGFloat(Self.rows))
                    Circle().fill(Color.red).frame(width: cell * 0.8, height: cell * 0.8)
                        .offset(x: food.x * cell + cell * 0.1, y: food.y * cell + cell * 0.1)
                    ForEach(Array(snake.enumerated()), id: \.offset) { i, p in
                        RoundedRectangle(cornerRadius: cell * 0.25)
                            .fill(i == 0 ? Theme.accentBright : Theme.accent)
                            .frame(width: cell - 1, height: cell - 1)
                            .offset(x: p.x * cell, y: p.y * cell)
                    }
                    if dead || !running {
                        Text(dead ? "Game over · \(score)" : "Press an arrow key or Start")
                            .font(.system(size: 12, weight: .semibold)).foregroundStyle(.white)
                            .padding(8).background(.black.opacity(0.6), in: Capsule())
                            .frame(width: cell * CGFloat(Self.cols), height: cell * CGFloat(Self.rows))
                    }
                }
            }
        }
        .onReceive(tick) { _ in step() }
        .modifier(KeyCatcher { key in
            if key.key == .space { if dead { restart() } else { running.toggle() }; return .handled }
            guard let d = Dir(key) else { return .ignored }
            let v: CGPoint = switch d { case .up: CGPoint(x: 0, y: -1); case .down: CGPoint(x: 0, y: 1)
                                        case .left: CGPoint(x: -1, y: 0); case .right: CGPoint(x: 1, y: 0) }
            if v.x != -dir.x || v.y != -dir.y { nextDir = v }   // no reversing into yourself
            if !running && !dead { running = true }
            if dead { restart() }
            return .handled
        })
        .accessibilityLabel("Snake. Score \(score). Use the arrow keys.")
    }

    private func step() {
        guard running, !dead else { return }
        dir = nextDir
        let head = CGPoint(x: snake[0].x + dir.x, y: snake[0].y + dir.y)
        if head.x < 0 || head.y < 0 || head.x >= CGFloat(Self.cols) || head.y >= CGFloat(Self.rows) || snake.dropLast().contains(head) {
            dead = true; running = false; best = max(best, score); return
        }
        snake.insert(head, at: 0)
        if head == food { placeFood() } else { snake.removeLast() }
    }

    private func placeFood() {
        var p: CGPoint
        repeat { p = CGPoint(x: Int.random(in: 0..<Self.cols), y: Int.random(in: 0..<Self.rows)) } while snake.contains(p)
        food = p
    }

    private func restart() {
        snake = [CGPoint(x: 5, y: 6), CGPoint(x: 4, y: 6), CGPoint(x: 3, y: 6)]
        dir = CGPoint(x: 1, y: 0); nextDir = dir; dead = false; running = true; placeFood()
    }
}

// MARK: - Reaction test

struct ReactionView: View {
    enum Phase: Equatable { case idle, waiting, go(Date), result(Int), early }
    @State private var phase: Phase = .idle
    @State private var pending: DispatchWorkItem?
    @AppStorage("games.reaction.best") private var best = 0
    @State private var last: [Int] = []

    var body: some View {
        VStack(spacing: 8) {
            ZStack {
                RoundedRectangle(cornerRadius: 12).fill(color)
                VStack(spacing: 4) {
                    Text(title).font(.system(size: 20, weight: .bold)).foregroundStyle(.white)
                    Text(subtitle).font(.system(size: 11)).foregroundStyle(.white.opacity(0.85))
                }
            }
            .contentShape(Rectangle())
            .onTapGesture(perform: press)
            HStack {
                Text(best > 0 ? "Best \(best) ms" : "No best yet").font(.system(size: 11).monospacedDigit()).foregroundStyle(Theme.textSecondary)
                Spacer()
                if !last.isEmpty {
                    Text("Average of last \(last.count): \(last.reduce(0, +) / last.count) ms").font(.system(size: 11).monospacedDigit()).foregroundStyle(Theme.textSecondary)
                }
            }
        }
        .modifier(KeyCatcher { key in
            guard key.key == .space || key.key == .return else { return .ignored }
            press(); return .handled
        })
        .onDisappear { pending?.cancel() }
        .accessibilityLabel("Reaction test. \(title). \(subtitle)")
    }

    private var color: Color {
        switch phase {
        case .idle, .result: Theme.accent.opacity(0.55)
        case .waiting: Color(red: 0.75, green: 0.18, blue: 0.25)
        case .go: Color(red: 0.12, green: 0.7, blue: 0.35)
        case .early: Color.orange.opacity(0.8)
        }
    }

    private var title: String {
        switch phase {
        case .idle: "Reaction test"
        case .waiting: "Wait for green…"
        case .go: "Click!"
        case .result(let ms): "\(ms) ms"
        case .early: "Too soon!"
        }
    }

    private var subtitle: String {
        switch phase {
        case .idle: "Click or press Space to start"
        case .waiting: "Don't click yet"
        case .go: "Now!"
        case .result(let ms): ms < 220 ? "Lightning fast. Click to go again" : ms < 300 ? "Nice. Click to go again" : "Click to go again"
        case .early: "Wait for green. Click to try again"
        }
    }

    private func press() {
        switch phase {
        case .idle, .result, .early:
            phase = .waiting
            let work = DispatchWorkItem { phase = .go(.now) }
            pending = work
            DispatchQueue.main.asyncAfter(deadline: .now() + .milliseconds(Int.random(in: 1500...4500)), execute: work)
        case .waiting:
            pending?.cancel(); phase = .early
        case .go(let start):
            let ms = Int(Date().timeIntervalSince(start) * 1000)
            phase = .result(ms)
            last = Array((last + [ms]).suffix(5))
            if best == 0 || ms < best { best = ms }
        }
    }
}
