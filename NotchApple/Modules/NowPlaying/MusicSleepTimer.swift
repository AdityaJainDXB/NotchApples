//
//  MusicSleepTimer.swift
//  Notch apple
//
//  "Pause the music after N minutes", for falling asleep to a playlist. When time is up it pauses only if something is
//  actually playing (so it never starts music), and says so with a notification. Nothing is sent anywhere.
//

import SwiftUI

@MainActor
final class MusicSleepTimer: ObservableObject {
    static let shared = MusicSleepTimer()
    @Published private(set) var endsAt: Date?
    private var work: DispatchWorkItem?

    func start(minutes: Int) {
        cancel()
        let end = Date().addingTimeInterval(Double(minutes) * 60)
        endsAt = end
        let item = DispatchWorkItem { [weak self] in
            guard let self else { return }
            self.endsAt = nil
            if NowPlayingMonitor.shared.current?.isPlaying == true {
                NowPlayingMonitor.shared.playPause()
                Notifier.post(title: "Music paused", body: "Your sleep timer ended.")
            }
        }
        work = item
        DispatchQueue.main.asyncAfter(deadline: .now() + Double(minutes) * 60, execute: item)
    }

    func cancel() { work?.cancel(); work = nil; endsAt = nil }
}
