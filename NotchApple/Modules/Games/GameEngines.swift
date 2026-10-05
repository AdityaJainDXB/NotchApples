//
//  GameEngines.swift
//  Notch apple
//
//  The rules of the mini-games, with no views and no timers, so they're easy to test and fast:
//   • SnakeEngine: a FIFO queue of up to 2 turns per tick, so quick arrow-key taps are kept in order.
//   • BreakoutEngine: ball, paddle and bricks in a fixed 360×220 field, stepped by elapsed time.
//   • MemoryEngine: the Simon-style pattern game: watch the lights, repeat them, one more each round.
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
