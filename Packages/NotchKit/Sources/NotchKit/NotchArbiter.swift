//
//  NotchArbiter.swift
//  Notch apple
//
//  Decides who may use the notch right now, so Lid Fold and the Cleaner never fight over it.
//
//    lidFold  >  cleaning  >  badge
//
//  A higher priority takes the notch from a lower one at once; the lower one is told to pause and,
//  when the higher one lets go, to resume. A lower priority asking while a higher one holds the
//  notch is queued (cleaning) or dropped (badge): passive badges are never worth waiting for.
//

import Foundation

public enum NotchPriority: Int, Comparable, Sendable {
    case badge = 0       // passive hints (recoverable-space ring)
    case cleaning = 1    // cleaning feedback
    case lidFold = 2     // the lid-fold animation always wins

    public static func < (a: Self, b: Self) -> Bool { a.rawValue < b.rawValue }
}

/// Something that can take over the notch and be told to give it up.
@MainActor
public protocol NotchClaimant: AnyObject {
    /// A higher-priority claimant took the notch. Pause cleanly (never mid-item) and keep your place.
    func notchPreempted(by priority: NotchPriority)
    /// The notch is free again. Resume, or cancel if you can no longer continue.
    func notchAvailable()
}

@MainActor
public final class NotchArbiter {
    public static let shared = NotchArbiter()

    public struct Claim: Equatable {
        public let id: UUID
        public let priority: NotchPriority
    }

    private struct Entry {
        let id: UUID
        let priority: NotchPriority
        weak var owner: NotchClaimant?
    }

    private var holder: Entry?
    /// Preempted claimants waiting to resume, highest priority first.
    private var waiting: [Entry] = []

    public init() {}

    public var current: NotchPriority? { holder?.priority }

    /// Asks for the notch. Returns a claim if granted, or nil if a higher priority holds it and this
    /// request is a badge (dropped) . A cleaning request that cannot be granted is queued and will get
    /// `notchAvailable()` later.
    @discardableResult
    public func request(_ priority: NotchPriority, owner: NotchClaimant) -> Claim? {
        let entry = Entry(id: UUID(), priority: priority, owner: owner)
        guard let held = holder else {
            holder = entry
            return Claim(id: entry.id, priority: priority)
        }
        if priority > held.priority {
            held.owner?.notchPreempted(by: priority)
            enqueue(held)
            holder = entry
            return Claim(id: entry.id, priority: priority)
        }
        // Passive badges are dropped, and a second lid fold while one is showing is refused (the first
        // one owns the overlay). Only cleaning waits its turn.
        if priority == .badge || priority == .lidFold { return nil }
        enqueue(entry)
        return nil
    }

    /// Lets go of the notch. The best waiting claimant, if any, is handed it and told to resume.
    public func release(_ claim: Claim) {
        if holder?.id == claim.id {
            holder = nil
            promote()
        } else {
            waiting.removeAll { $0.id == claim.id }
        }
    }

    /// True when `claim` still owns the notch (false once preempted).
    public func holds(_ claim: Claim) -> Bool { holder?.id == claim.id }

    private func enqueue(_ entry: Entry) {
        waiting.append(entry)
        waiting.sort { $0.priority > $1.priority }
    }

    private func promote() {
        waiting.removeAll { $0.owner == nil }
        guard !waiting.isEmpty else { return }
        let next = waiting.removeFirst()
        holder = next
        next.owner?.notchAvailable()
    }
}
