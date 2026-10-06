//
//  GameEngines.swift
//  Notch apple
//
//  The rules of the mini-games, with no views and no timers, so they're easy to test and fast:
//   • SnakeEngine: a FIFO queue of up to 2 turns per tick, so quick arrow-key taps are kept in order.
//   • BreakoutEngine: ball, paddle and bricks in a fixed 360×220 field, stepped by elapsed time.
//   • MemoryEngine: the Simon-style pattern game: watch the lights, repeat them, one more each round.
//   • CookieEngine: Cookie Clicker. Click for cookies, buy click multipliers and auto-clicker buildings.
//   • RunnerEngine: an arcade runner. Jump over spikes and blocks at a speed that keeps rising.
//

import CoreGraphics
import Foundation

// MARK: - Snake

struct SnakeEngine {
    static let cols = 22, rows = 12
    /// How many turns may wait for the next tick. A third tap in the same tick is dropped.
    static let queueDepth = 2

    struct Cell: Hashable { var x: Int; var y: Int }

    enum Direction: CaseIterable {
        case up, down, left, right
        var dx: Int { self == .left ? -1 : self == .right ? 1 : 0 }
        var dy: Int { self == .up ? -1 : self == .down ? 1 : 0 }
        var opposite: Direction {
            switch self { case .up: .down; case .down: .up; case .left: .right; case .right: .left }
        }
    }

    enum Event: Equatable { case moved, ate, died, won, idle }

    private(set) var body: [Cell] = [Cell(x: 5, y: 6), Cell(x: 4, y: 6), Cell(x: 3, y: 6)]
    /// The direction the snake moved in on the last tick.
    private(set) var direction: Direction = .right
    private(set) var pending: [Direction] = []
    private(set) var food = Cell(x: 14, y: 6)
    private(set) var alive = true
    private(set) var started = false

    var score: Int { body.count - 3 }

    /// Records a turn. It's judged against the last turn already waiting (or the current direction),
    /// so "up then left" in one tick becomes two moves in that order, while a straight reversal is ignored.
    @discardableResult
    mutating func enqueue(_ d: Direction) -> Bool {
        guard alive else { return false }
        let last = pending.last ?? direction
        guard d != last, d != last.opposite, pending.count < Self.queueDepth else { return false }
        pending.append(d)
        started = true
        return true
    }

    mutating func start() { started = true }

    mutating func step<G: RandomNumberGenerator>(_ rng: inout G) -> Event {
        guard alive, started else { return .idle }
        if !pending.isEmpty { direction = pending.removeFirst() }
        let head = Cell(x: body[0].x + direction.dx, y: body[0].y + direction.dy)
        let ate = head == food
        // The tail moves out of the way this tick unless the snake grows.
        let blocking = ate ? body : Array(body.dropLast())
        if head.x < 0 || head.y < 0 || head.x >= Self.cols || head.y >= Self.rows || blocking.contains(head) {
            alive = false
            return .died
        }
        body.insert(head, at: 0)
        if ate {
            guard let spot = Self.freeCell(avoiding: body, using: &rng) else { alive = false; return .won }
            food = spot
            return .ate
        }
        body.removeLast()
        return .moved
    }

    mutating func step() -> Event {
        var g = SystemRandomNumberGenerator()
        return step(&g)
    }

    static func freeCell<G: RandomNumberGenerator>(avoiding body: [Cell], using rng: inout G) -> Cell? {
        let taken = Set(body)
        var free: [Cell] = []
        for y in 0..<rows { for x in 0..<cols where !taken.contains(Cell(x: x, y: y)) { free.append(Cell(x: x, y: y)) } }
        return free.randomElement(using: &rng)
    }
}

// MARK: - Breakout

struct BreakoutEngine {
    static let width: CGFloat = 360, height: CGFloat = 220
    static let paddleWidth: CGFloat = 60, paddleHeight: CGFloat = 8, paddleY: CGFloat = 200
    static let radius: CGFloat = 5
    static let brickCols = 9, brickRows = 5
    static let brickWidth: CGFloat = 36, brickHeight: CGFloat = 12, brickTop: CGFloat = 24

    enum Event: Equatable { case wall, paddle, brick, lifeLost, levelCleared, gameOver }

    struct Brick: Equatable { var rect: CGRect; var row: Int }

    private(set) var bricks: [Brick] = []
    private(set) var paddleX: CGFloat = width / 2        // centre
    private(set) var ball = CGPoint(x: width / 2, y: paddleY - radius - 1)
    private(set) var velocity = CGVector(dx: 0, dy: 0)
    private(set) var score = 0
    private(set) var lives = 3
    private(set) var level = 1
    private(set) var launched = false
    private(set) var over = false

    init() { buildBricks() }

    private mutating func buildBricks() {
        bricks = (0..<Self.brickRows).flatMap { r in
            (0..<Self.brickCols).map { c in
                Brick(rect: CGRect(x: CGFloat(c) * Self.brickWidth + 18, y: Self.brickTop + CGFloat(r) * (Self.brickHeight + 3),
                                   width: Self.brickWidth - 3, height: Self.brickHeight), row: r)
            }
        }
    }

    private var speed: CGFloat { 190 + CGFloat(level - 1) * 28 }

    mutating func movePaddle(to x: CGFloat) {
        paddleX = min(max(x, Self.paddleWidth / 2), Self.width - Self.paddleWidth / 2)
        if !launched { ball = CGPoint(x: paddleX, y: Self.paddleY - Self.radius - 1) }
    }

    mutating func nudgePaddle(_ dx: CGFloat) { movePaddle(to: paddleX + dx) }

    mutating func launch() {
        guard !launched, !over else { return }
        launched = true
        velocity = CGVector(dx: speed * 0.45, dy: -speed * 0.9)
    }

    mutating func restart() { self = BreakoutEngine() }

    /// Advances by `dt` seconds (clamped, so a stall never makes the ball jump through bricks).
    mutating func step(_ rawDT: Double) -> [Event] {
        guard launched, !over else { return [] }
        let dt = CGFloat(min(max(rawDT, 0), 1.0 / 30.0))
        var events: [Event] = []
        ball.x += velocity.dx * dt
        ball.y += velocity.dy * dt

        if ball.x < Self.radius { ball.x = Self.radius; velocity.dx = abs(velocity.dx); events.append(.wall) }
        if ball.x > Self.width - Self.radius { ball.x = Self.width - Self.radius; velocity.dx = -abs(velocity.dx); events.append(.wall) }
        if ball.y < Self.radius { ball.y = Self.radius; velocity.dy = abs(velocity.dy); events.append(.wall) }

        // Paddle: the further from its centre the ball lands, the sharper it leaves.
        let paddle = CGRect(x: paddleX - Self.paddleWidth / 2, y: Self.paddleY, width: Self.paddleWidth, height: Self.paddleHeight)
        if velocity.dy > 0, ball.y + Self.radius >= paddle.minY, ball.y - Self.radius <= paddle.maxY,
           ball.x >= paddle.minX - Self.radius, ball.x <= paddle.maxX + Self.radius {
            let offset = min(max((ball.x - paddleX) / (Self.paddleWidth / 2), -1), 1)
            let angle = offset * (.pi / 3)               // up to 60° from straight up
            velocity = CGVector(dx: speed * sin(angle), dy: -speed * cos(angle))
            ball.y = paddle.minY - Self.radius
            events.append(.paddle)
        }

        // Bricks: reflect on the axis with the smaller overlap.
        if let i = bricks.firstIndex(where: { circleHits(ball, Self.radius, $0.rect) }) {
            let b = bricks[i].rect
            let overlapX = min(ball.x + Self.radius - b.minX, b.maxX - (ball.x - Self.radius))
            let overlapY = min(ball.y + Self.radius - b.minY, b.maxY - (ball.y - Self.radius))
            if overlapX < overlapY { velocity.dx = -velocity.dx } else { velocity.dy = -velocity.dy }
            score += 10 * (Self.brickRows - bricks[i].row)   // higher rows are worth more
            bricks.remove(at: i)
            events.append(.brick)
            if bricks.isEmpty {
                level += 1
                buildBricks()
                launched = false
                ball = CGPoint(x: paddleX, y: Self.paddleY - Self.radius - 1)
                velocity = .zero
                events.append(.levelCleared)
            }
        }

        if ball.y - Self.radius > Self.height {
            lives -= 1
            launched = false
            velocity = .zero
            ball = CGPoint(x: paddleX, y: Self.paddleY - Self.radius - 1)
            events.append(lives <= 0 ? .gameOver : .lifeLost)
            if lives <= 0 { over = true }
        }
        return events
    }

    private func circleHits(_ c: CGPoint, _ r: CGFloat, _ rect: CGRect) -> Bool {
        let nx = min(max(c.x, rect.minX), rect.maxX), ny = min(max(c.y, rect.minY), rect.maxY)
        let dx = c.x - nx, dy = c.y - ny
        return dx * dx + dy * dy <= r * r
    }
}

// MARK: - Memory (Simon)

struct MemoryEngine {
    static let pads = 4

    enum Result: Equatable { case correct, roundComplete, wrong }

    private(set) var sequence: [Int] = []
    private(set) var position = 0
    var round: Int { sequence.count }

    /// Adds one more light to the pattern and starts the player's turn from the beginning.
    mutating func nextRound<G: RandomNumberGenerator>(_ rng: inout G) {
        sequence.append(Int.random(in: 0..<Self.pads, using: &rng))
        position = 0
    }

    mutating func nextRound() { var g = SystemRandomNumberGenerator(); nextRound(&g) }

    mutating func press(_ pad: Int) -> Result {
        guard position < sequence.count, sequence[position] == pad else { return .wrong }
        position += 1
        return position == sequence.count ? .roundComplete : .correct
    }

    /// A finished game's score: the rounds you fully repeated.
    var score: Int { max(0, round - 1) }

    mutating func reset() { sequence = []; position = 0 }
}


// MARK: - Cookie Clicker

struct CookieEngine: Codable, Equatable {
    enum Building: String, CaseIterable, Codable, Identifiable {
        case cursor, grandma, farm, mine, factory
        var id: String { rawValue }
        var name: String {
            switch self {
            case .cursor: "Auto-clicker"
            case .grandma: "Grandma"
            case .farm: "Cookie farm"
            case .mine: "Cookie mine"
            case .factory: "Factory"
            }
        }
        var symbol: String {
            switch self {
            case .cursor: "cursorarrow.click.2"
            case .grandma: "figure.stand.dress"
            case .farm: "leaf.fill"
            case .mine: "mountain.2.fill"
            case .factory: "building.2.fill"
            }
        }
        var baseCost: Double {
            switch self {
            case .cursor: 15
            case .grandma: 100
            case .farm: 1_100
            case .mine: 12_000
            case .factory: 130_000
            }
        }
        /// Cookies per second each one makes.
        var cps: Double {
            switch self {
            case .cursor: 0.2
            case .grandma: 1
            case .farm: 8
            case .mine: 47
            case .factory: 260
            }
        }
    }

    /// Each upgrade doubles what one click is worth. They are bought in order.
    static let clickUpgradeCosts: [Double] = [100, 500, 5_000, 50_000, 500_000, 5_000_000]

    var cookies: Double = 0
    var baked: Double = 0                    // every cookie ever made
    var clicks: Int = 0
    var owned: [Building: Int] = [:]
    var clickLevel = 0                       // click upgrades bought
    var savedAt: Date?

    static let costGrowth = 1.15

    func count(_ b: Building) -> Int { owned[b] ?? 0 }

    /// A building is unlocked once you own one, or have baked 60% of its first price in total (so it shows up as a goal).
    func isUnlocked(_ b: Building) -> Bool { count(b) > 0 || baked >= b.baseCost * 0.6 }
    func cost(_ b: Building) -> Double { (b.baseCost * pow(Self.costGrowth, Double(count(b)))).rounded() }
    var clickValue: Double { pow(2, Double(clickLevel)) }
    var cps: Double { Building.allCases.reduce(0) { $0 + Double(count($1)) * $1.cps } }
    var nextClickUpgradeCost: Double? { clickLevel < Self.clickUpgradeCosts.count ? Self.clickUpgradeCosts[clickLevel] : nil }

    /// One click. Returns how many cookies it made.
    @discardableResult
    mutating func click() -> Double {
        let gain = clickValue
        cookies += gain; baked += gain; clicks += 1
        return gain
    }

    mutating func tick(_ dt: Double) {
        guard dt > 0, dt.isFinite else { return }
        let gain = cps * min(dt, 3600)
        cookies += gain; baked += gain
    }

    @discardableResult
    mutating func buy(_ b: Building) -> Bool {
        let price = cost(b)
        guard isUnlocked(b), cookies >= price else { return false }
        cookies -= price
        owned[b, default: 0] += 1
        return true
    }

    @discardableResult
    mutating func buyClickUpgrade() -> Bool {
        guard let price = nextClickUpgradeCost, cookies >= price else { return false }
        cookies -= price
        clickLevel += 1
        return true
    }

    /// Cookies made while the game was closed: at most an hour's worth, at half speed.
    mutating func applyOffline(now: Date = .now) {
        guard let saved = savedAt else { return }
        let away = min(max(now.timeIntervalSince(saved), 0), 3600)
        let gain = cps * away * 0.5
        cookies += gain; baked += gain
        savedAt = now
    }

    /// 1,234 · 12.3K · 4.56M · 7.8B · 9.1T
    static func format(_ value: Double) -> String {
        let v = max(0, value)
        switch v {
        case ..<10_000: return Int(v).formatted()
        case ..<1_000_000: return String(format: "%.1fK", v / 1_000)
        case ..<1_000_000_000: return String(format: "%.2fM", v / 1_000_000)
        case ..<1_000_000_000_000: return String(format: "%.2fB", v / 1_000_000_000)
        default: return String(format: "%.2fT", v / 1_000_000_000_000)
        }
    }
}

// MARK: - Arcade runner

struct RunnerEngine {
    enum Kind: Equatable { case spike, block, doubleSpike }

    struct Obstacle: Equatable {
        var x: CGFloat
        var kind: Kind
        var width: CGFloat {
            switch kind { case .spike: 18; case .block: 26; case .doubleSpike: 38 }
        }
        var height: CGFloat {
            switch kind { case .spike, .doubleSpike: 20; case .block: 28 }
        }
    }

    enum Event: Equatable { case none, jumped, died }

    static let width: CGFloat = 360, height: CGFloat = 180
    static let groundY: CGFloat = 150           // the top of the floor
    static let playerX: CGFloat = 60
    static let playerSize: CGFloat = 22
    static let gravity: CGFloat = 1_900
    static let jumpSpeed: CGFloat = 640

    private(set) var obstacles: [Obstacle] = []
    private(set) var playerY: CGFloat = RunnerEngine.groundY - RunnerEngine.playerSize   // top of the cube
    private(set) var velocity: CGFloat = 0
    private(set) var rotation: CGFloat = 0          // degrees, spins while in the air
    private(set) var distance: CGFloat = 0
    private(set) var over = false
    private(set) var started = false
    private var untilNext: CGFloat = 220            // distance until the next obstacle

    var onGround: Bool { playerY >= Self.groundY - Self.playerSize - 0.01 }
    var score: Int { Int(distance / 10) }
    /// Pixels per second; creeps up the longer you survive, up to a ceiling.
    var speed: CGFloat { min(150 + distance * 0.035, 330) }

    mutating func start() { started = true }
    mutating func restart() { self = RunnerEngine(); started = true }

    @discardableResult
    mutating func jump() -> Event {
        guard !over, onGround else { return .none }
        started = true
        velocity = -Self.jumpSpeed
        return .jumped
    }

    mutating func step<G: RandomNumberGenerator>(_ rawDT: Double, _ rng: inout G) -> Event {
        guard started, !over else { return .none }
        let dt = CGFloat(min(max(rawDT, 0), 1.0 / 30))
        let dx = speed * dt
        distance += dx
        // Physics.
        velocity += Self.gravity * dt
        playerY += velocity * dt
        let floor = Self.groundY - Self.playerSize
        if playerY >= floor { playerY = floor; velocity = 0; rotation = (rotation / 90).rounded() * 90 }
        else { rotation += 360 * dt }                // roughly one turn per jump
        // World.
        for i in obstacles.indices { obstacles[i].x -= dx }
        obstacles.removeAll { $0.x + $0.width < -10 }
        untilNext -= dx
        if untilNext <= 0 {
            let kind: Kind = [.spike, .spike, .block, .doubleSpike].randomElement(using: &rng) ?? .spike
            obstacles.append(Obstacle(x: Self.width + 10, kind: kind))
            // Always leaves room to land and jump again: the faster it goes, the wider the minimum gap.
            untilNext = Self.minimumGap(speed: speed) + CGFloat.random(in: 40...150, using: &rng)
        }
        if collides() { over = true; return .died }
        return .none
    }

    mutating func step(_ dt: Double) -> Event { var g = SystemRandomNumberGenerator(); return step(dt, &g) }

    /// The shortest distance between two obstacles that still lets a jump clear the first and land before the next.
    static func minimumGap(speed: CGFloat) -> CGFloat {
        let airTime = 2 * jumpSpeed / gravity       // seconds in the air
        return speed * airTime * 0.9 + 40
    }

    /// The cube against each obstacle, with a couple of pixels of forgiveness (the cube is a square, spikes are triangles).
    func collides() -> Bool {
        let p = CGRect(x: Self.playerX + 2, y: playerY + 2, width: Self.playerSize - 4, height: Self.playerSize - 4)
        for o in obstacles {
            let r = CGRect(x: o.x + (o.kind == .block ? 0 : 3), y: Self.groundY - o.height + (o.kind == .block ? 0 : 5),
                           width: o.width - (o.kind == .block ? 0 : 6), height: o.height - (o.kind == .block ? 0 : 5))
            if p.intersects(r) { return true }
        }
        return false
    }

    /// Test hook: put an obstacle at a position.
    mutating func place(_ kind: Kind, at x: CGFloat) { obstacles.append(Obstacle(x: x, kind: kind)) }
}
