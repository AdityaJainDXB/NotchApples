//
//  PlayController.swift
//  Notch Apple
//
//  Runs one two-player game (Connect Four, Rock Paper Scissors, Battleship) for a Messenger room or one friend chat: it keeps the
//  session (rules in TwoPlayerGames.swift), the secrets that must not leave this Mac until the right moment (the Rock Paper
//  Scissors pick, the Battleship fleet) and answers the opponent automatically (starting the game, revealing, answering shots).
//  The room or the friend chat only has to pass messages in (`receive`) and carry the ones it sends (`transport`).
//

import Foundation

@MainActor
final class PlayController: ObservableObject {
    @Published private(set) var session: PlaySession?
    /// Battleship: my own fleet (100 characters, see Battleship.randomFleet) and whether I have pressed Ready.
    @Published private(set) var fleet: String?
    /// Rock Paper Scissors: my pick for the game in play, shown to me only.
    @Published private(set) var myPick: Int?

    let myID: String
    /// How to show a player: "You", their name, "Someone".
    var name: (String?) -> String = { _ in "Someone" }
    /// Carries a message to the opponent (and anyone else in the room).
    var transport: (PlayMessage) -> Void = { _ in }
    /// Told when a game starts, ends or is offered, for a notice in the chat or a notification.
    var onEvent: (String) -> Void = { _ in }

    private var salt = ""                 // for the pick or fleet in play
    private var sentReveal = false
    private var shotsAtMe = Set<Int>()    // cells the opponent has fired at (for answering)

    init(myID: String) { self.myID = myID }

    var isActive: Bool { session.map { !$0.isFinished } ?? false }
    var myIndex: Int? { session?.index(of: myID) }
    var iCommittedFleet: Bool { session.flatMap { s in myIndex.flatMap { s.bs.commit[$0] } } != nil }

    // MARK: Coming in

    /// A message from `from` (not from me). Returns true when it changed the game.
    @discardableResult
    func receive(_ msg: PlayMessage, from: String) -> Bool { apply(msg, from: from) }

    @discardableResult
    private func apply(_ msg: PlayMessage, from: String) -> Bool {
        let before = session
        let next = PlayRules.reduce(before, msg, from: from)
        guard next != before else { return false }
        session = next
        guard let s = next else { return true }
        if msg.op == "invite" && from != myID { onEvent("\(name(from)) invited you to play \(s.kind.title).") }
        react(to: msg, before: before, after: s)
        return true
    }

    /// Everything that happens automatically after a change.
    private func react(to msg: PlayMessage, before: PlaySession?, after s: PlaySession) {
        // The inviter starts the game when someone accepts.
        if msg.op == "accept", s.status == .invited, s.inviter == myID, let acc = s.accepted { send(PlayRules.start(s, acceptor: acc)) }
        // A new game (or rematch): forget the last one's secrets and set up my side.
        if s.status == .playing, s.isPlayer(myID), (before?.status != .playing || s.round != before?.round) { newGame(s) }
        guard let me = s.index(of: myID) else { return }
        switch s.kind {
        case .connect4, .chess, .checkers, .rocket: break
        case .rps:
            // Once both picks are committed, show mine (the reveal), unless I am still waiting to pick.
            if s.status == .playing, let pick = myPick, s.rps.commit[me] != nil, s.rps.commit[1 - me] != nil, s.rps.reveal[me] == nil, !sentReveal {
                sentReveal = true
                send(PlayRules.reveal(s, pick: pick, salt: salt))
            }
            if s.rps.n != before?.rps.n || s.round != before?.round { myPick = nil; sentReveal = false }
        case .battleship:
            // Answer a shot at me from my own fleet.
            if s.status == .playing, let cell = s.bs.pendingCell, s.bs.moves % 2 == 1 - me, let board = fleet, !shotsAtMe.contains(cell) {
                shotsAtMe.insert(cell)
                send(PlayRules.result(s, cell: cell, answer: Battleship.answer(board: board, shot: shotsAtMe, cell: cell)))
            }
            // The game is over: show my fleet so the opponent can check my answers.
            if s.status == .finished, let board = fleet, !sentReveal, s.bs.revealed[me] == nil {
                sentReveal = true
                send(PlayRules.revealFleet(s, board: board, salt: salt))
            }
        }
        if before?.status != s.status {
            switch s.status {
            case .finished: onEvent(s.winner == nil ? "\(s.kind.title): a draw." : "\(s.kind.title): \(name(s.winner)) won.")
            case .ended: onEvent("\(s.kind.title) ended: \(name(s.leaver)) left the game.")
            default: break
            }
        }
    }

    private func newGame(_ s: PlaySession) {
        myPick = nil; sentReveal = false; shotsAtMe = []
        salt = String((0..<16).map { _ in "abcdefghjkmnpqrstuvwxyz23456789".randomElement()! })
        fleet = s.kind == .battleship ? Battleship.randomFleet() : nil
    }

    // MARK: Going out

    /// Checks a message of mine against my own state first, so an illegal move is never sent, then applies and sends it.
    @discardableResult
    private func send(_ msg: PlayMessage) -> Bool {
        guard apply(msg, from: myID) else { return false }
        transport(msg)
        return true
    }

    func invite(_ kind: PlayKind) { if !isActive { send(PlayRules.invite(kind, gid: PlayRules.newGameID())) } }
    func accept() { if let s = session, s.status == .invited { send(PlayRules.accept(s)) } }
    func cancelInvite() { if let s = session, s.status == .invited { send(PlayRules.cancel(s)) } }
    func leave() { if let s = session, s.status == .playing { send(PlayRules.quit(s)) } }
    func rematch() { if let s = session, s.status == .finished { send(PlayRules.rematch(s)) } }
    /// Forgets any game (leaving or joining a room).
    func reset() { session = nil; fleet = nil; myPick = nil; sentReveal = false; shotsAtMe = [] }
    /// Closes a finished game's board (nothing is sent).
    func close() { if let s = session, s.isFinished { session = nil; fleet = nil; myPick = nil } }
    /// The opponent left the room or the app: their game is over.
    func playerGone(_ id: String) { if let s = session, s.status == .playing { apply(PlayRules.quit(s), from: id) } }

    /// Chess and Checkers: move the piece on `from` to `to` (an illegal move is never sent).
    func move(from: Int, to: Int, promotion: String? = nil) { if let s = session { send(PlayRules.boardMove(s, from: from, to: to, promotion: promotion)) } }

    func drop(column: Int) { if let s = session { send(PlayRules.move(s, column: column)) } }

    /// Rock Paper Scissors: lock in a pick. Only the hash leaves this Mac until both picks are in.
    func pick(_ choice: Int) {
        guard let s = session, s.kind == .rps, s.status == .playing, let me = s.index(of: myID), s.rps.commit[me] == nil, myPick == nil else { return }
        myPick = choice
        send(PlayRules.commit(s, pick: choice, salt: salt))
    }

    /// Battleship: new random placement (before pressing Ready).
    func shuffleFleet() { if let s = session, s.kind == .battleship, s.status == .playing, !iCommittedFleet { fleet = Battleship.randomFleet() } }
    func readyFleet() {
        guard let s = session, s.kind == .battleship, s.status == .playing, let board = fleet, !iCommittedFleet else { return }
        send(PlayRules.ready(s, board: board, salt: salt))
    }
    func fire(_ cell: Int) { if let s = session { send(PlayRules.shoot(s, cell: cell)) } }
}
