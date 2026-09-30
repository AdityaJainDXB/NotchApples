//
//  DownloadWatcher.swift
//  Notch apple
//
//  Shows download and copy progress beside the closed notch. Safari, Chrome,
//  Finder copies, AirDrop and most other apps publish file progress
//  (NSProgress) for files they're writing, the same thing Finder uses for its
//  progress bars; this subscribes to it for Downloads, Desktop and Documents.
//

import AppKit
import SwiftUI

@MainActor
final class DownloadWatcher: ObservableObject {
    static let shared = DownloadWatcher()

    struct Transfer: Identifiable, Equatable {
        let id: ObjectIdentifier
        let name: String
        var fraction: Double
    }

    @Published private(set) var transfers: [Transfer] = []
    private var subscribers: [Any] = []
    private var observations: [ObjectIdentifier: NSKeyValueObservation] = [:]

    var liveActivity: LiveActivity? {
        guard !transfers.isEmpty else { return nil }
        let avg = transfers.map(\.fraction).reduce(0, +) / Double(transfers.count)
        return LiveActivity(symbol: "arrow.down.circle.fill", label: "\(Int(avg * 100))%", tint: .systemBlue,
                            gauge: nil)
    }

    func setEnabled(_ on: Bool) {
        if on, subscribers.isEmpty {
            let fm = FileManager.default
            let folders: [FileManager.SearchPathDirectory] = [.downloadsDirectory, .desktopDirectory, .documentDirectory]
            for dir in folders {
                guard let url = fm.urls(for: dir, in: .userDomainMask).first else { continue }
                let sub = Progress.addSubscriber(forFileURL: url) { [weak self] progress in
                    DispatchQueue.main.async { MainActor.assumeIsolated { self?.track(progress) } }
                    return { [weak self] in
                        DispatchQueue.main.async { MainActor.assumeIsolated { self?.untrack(ObjectIdentifier(progress)) } }
                    }
                }
                subscribers.append(sub)
            }
        } else if !on, !subscribers.isEmpty {
            subscribers.forEach { Progress.removeSubscriber($0) }
            subscribers = []
            observations = [:]
            transfers = []
            LiveActivityCenter.shared.recompute()
        }
    }

    private func track(_ progress: Progress) {
        let id = ObjectIdentifier(progress)
        guard observations[id] == nil else { return }
        let name = (progress.fileURL ?? progress.userInfo[.fileURLKey] as? URL)?.lastPathComponent ?? "Download"
        transfers.append(Transfer(id: id, name: name, fraction: max(0, progress.fractionCompleted)))
        observations[id] = progress.observe(\.fractionCompleted) { [weak self] p, _ in
            let f = p.fractionCompleted
            DispatchQueue.main.async {
                MainActor.assumeIsolated {
                    guard let self, let i = self.transfers.firstIndex(where: { $0.id == id }) else { return }
                    self.transfers[i].fraction = f
                    LiveActivityCenter.shared.recompute()
                    if f >= 1 { self.untrack(id) }
                }
            }
        }
        LiveActivityCenter.shared.recompute()
    }

    private func untrack(_ id: ObjectIdentifier) {
        guard let i = transfers.firstIndex(where: { $0.id == id }) else { return }
        let done = transfers.remove(at: i)
        observations[id] = nil
        if done.fraction >= 0.99 {
            LiveActivityCenter.shared.flash(LiveActivity(symbol: "checkmark.circle.fill", label: "Done", tint: .systemGreen), seconds: 3)
        }
        LiveActivityCenter.shared.recompute()
    }
}
