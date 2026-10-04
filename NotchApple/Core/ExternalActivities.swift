//
//  ExternalActivities.swift
//  Notch apple
//
//  Live Activities API (Ultimate): your own apps and scripts can show a live
//  activity beside the closed notch, the way the timer or a download does.
//
//  From a script or Shortcuts (or the `notch-activity` command in scripts/):
//    open -g "notchapple://activity?id=build&title=Build&text=42%25&symbol=hammer.fill&progress=0.42&color=34C759&seconds=600"
//    open -g "notchapple://activity/end?id=build"
//  From an app (Swift):
//    DistributedNotificationCenter.default().postNotificationName(.init("com.notchapple.activity"),
//        object: nil, userInfo: ["id": "build", "text": "42%", "symbol": "hammer.fill", "progress": 0.42], deliverImmediately: true)
//    (send "end": true to remove it)
//
//  Keys: id (required), title (≤ 14 chars, left ear), text (≤ 16 chars, right ear),
//  symbol (an SF Symbol), progress (0…1, draws a bar), color (RRGGBB), seconds (how long
//  it stays, default 10 minutes, at most 12 hours). Up to 5 at once; the newest shows.
//  Nothing is sent anywhere: activities only exist on this Mac, in memory.
//

import AppKit

@MainActor
final class ExternalActivities {
    static let shared = ExternalActivities()

    struct Item {
        let id: String
        var title: String?
        var text: String?
        var symbol: String?
        var progress: Double?
        var color: NSColor
        var expires: Date
        var updated: Date
    }

    private(set) var items: [String: Item] = [:]
    private var expiryTimer: Timer?

    func start() {
        DistributedNotificationCenter.default().addObserver(forName: Notification.Name("com.notchapple.activity"), object: nil, queue: .main) { note in
            let info = (note.userInfo ?? [:]).reduce(into: [String: String]()) { out, kv in
                if let k = kv.key as? String { out[k] = "\(kv.value)" }
            }
            MainActor.assumeIsolated { ExternalActivities.shared.handle(info, end: info["end"] == "1" || info["end"] == "true") }
        }
    }

    /// From notchapple://activity?… or a distributed notification.
    func handle(_ q: [String: String], end: Bool) {
        guard Entitlements.shared.canUse(.liveActivityAPI) else { return }
        guard let id = q["id"]?.prefix(40), !id.isEmpty else { return }
        let key = String(id)
        if end { items[key] = nil; changed(); return }
        let seconds = min(max(Double(q["seconds"] ?? "") ?? 600, 5), 12 * 3600)
        var item = items[key] ?? Item(id: key, color: .systemPurple, expires: .now, updated: .now)
        if let t = q["title"] { item.title = String(t.prefix(14)) }
        if let t = q["text"] { item.text = String(t.prefix(16)) }
        if let s = q["symbol"], NSImage(systemSymbolName: s, accessibilityDescription: nil) != nil { item.symbol = s }
        if let p = q["progress"].flatMap(Double.init) { item.progress = min(max(p, 0), 1) }
        if let c = q["color"].flatMap(Self.color) { item.color = c }
        item.expires = .now.addingTimeInterval(seconds)
        item.updated = .now
        items[key] = item
        if items.count > 5, let oldest = items.values.min(by: { $0.updated < $1.updated }) { items[oldest.id] = nil }
        changed()
    }

    private func changed() {
        expiryTimer?.invalidate()
        if let next = items.values.map(\.expires).min() {
            expiryTimer = Timer.scheduledTimer(withTimeInterval: max(next.timeIntervalSinceNow, 1), repeats: false) { _ in
                MainActor.assumeIsolated {
                    let shared = ExternalActivities.shared
                    shared.items = shared.items.filter { $0.value.expires > .now }
                    shared.changed()
                }
            }
        }
        LiveActivityCenter.shared.recompute()
    }

    /// The newest activity, drawn like the built-in ones.
    var liveActivity: LiveActivity? {
        guard Entitlements.shared.canUse(.liveActivityAPI),
              let item = items.values.filter({ $0.expires > .now }).max(by: { $0.updated < $1.updated }) else { return nil }
        if let p = item.progress, item.text == nil {
            return LiveActivity(symbol: item.symbol ?? "bolt.fill", label: nil, tint: item.color, gauge: p)
        }
        return LiveActivity(symbol: item.symbol ?? "bolt.fill", label: item.text ?? item.progress.map { "\(Int($0 * 100))%" },
                            tint: item.color, leftText: item.title)
    }

    static func color(_ hex: String) -> NSColor? {
        let h = hex.trimmingCharacters(in: CharacterSet(charactersIn: "#"))
        guard h.count == 6, let v = Int(h, radix: 16) else { return nil }
        return NSColor(red: CGFloat(v >> 16 & 255) / 255, green: CGFloat(v >> 8 & 255) / 255, blue: CGFloat(v & 255) / 255, alpha: 1)
    }
}
