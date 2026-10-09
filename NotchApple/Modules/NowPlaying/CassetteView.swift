//
//  CassetteView.swift
//  Notch apple
//
//  Cassette mode for the music player: whatever is playing is shown as a tape. The two reels turn while it plays,
//  the tape moves from the left reel to the right as the song goes on, and the label shows the title and artist.
//  Previous, play/pause and next sit on the front like cassette-deck buttons. Reduce Motion stops the turning.
//

import SwiftUI

struct CassetteView: View {
    @ObservedObject var monitor: NowPlayingMonitor
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    private var playing: Bool { monitor.current?.isPlaying == true }

    var body: some View {
        TimelineView(.animation(minimumInterval: 1 / 30, paused: !playing || reduceMotion)) { tl in
            let t = tl.date.timeIntervalSinceReferenceDate
            let pos = monitor.position ?? 0, dur = max(monitor.duration ?? 0, 1)
            let progress = min(max(pos / dur, 0), 1)
            let angle = Angle.degrees(playing && !reduceMotion ? (t * 150).truncatingRemainder(dividingBy: 360) : 0)
            VStack(spacing: 6) {
                GeometryReader { g in
                    let w = g.size.width, h = g.size.height
                    ZStack {
                        RoundedRectangle(cornerRadius: 10).fill(LinearGradient(colors: [Color(white: 0.24), Color(white: 0.09)], startPoint: .topLeading, endPoint: .bottomTrailing))
                        RoundedRectangle(cornerRadius: 10).strokeBorder(.white.opacity(0.14))
                        // Label
                        RoundedRectangle(cornerRadius: 5).fill(Color(red: 0.93, green: 0.9, blue: 0.82))
                            .frame(width: w * 0.86, height: h * 0.52).offset(y: -h * 0.12)
                        VStack(alignment: .leading, spacing: 0) {
                            Text(monitor.current?.title ?? "Nothing playing").font(.system(size: 11, weight: .bold)).lineLimit(1)
                            Text(monitor.current?.artist ?? "Press play").font(.system(size: 9)).lineLimit(1).opacity(0.7)
                        }
                        .foregroundStyle(Color(white: 0.12))
                        .frame(width: w * 0.8, alignment: .leading).offset(y: -h * 0.3)
                        // Reel window
                        Capsule().fill(Color(white: 0.1)).frame(width: w * 0.62, height: h * 0.24).offset(y: -h * 0.04)
                        reel(size: h * 0.2 + h * 0.07 * (1 - progress), angle: angle).offset(x: -w * 0.2, y: -h * 0.04)
                        reel(size: h * 0.2 + h * 0.07 * progress, angle: angle).offset(x: w * 0.2, y: -h * 0.04)
                        // Bottom trapezoid with the deck buttons
                        HStack(spacing: 14) {
                            deckButton("backward.fill", "Previous") { MediaControl.send(.previous) }
                            deckButton(playing ? "pause.fill" : "play.fill", playing ? "Pause" : "Play", big: true) { monitor.playPause() }
                            deckButton("forward.fill", "Next") { MediaControl.send(.next) }
                        }
                        .padding(.horizontal, 18).padding(.vertical, 4)
                        .background(Color.white.opacity(0.08), in: Capsule())
                        .offset(y: h * 0.34)
                    }
                }
                .aspectRatio(1.58, contentMode: .fit)
                .shadow(color: .black.opacity(0.4), radius: 8, y: 4)
            }
        }
        .accessibilityElement(children: .contain)
        .accessibilityLabel("Cassette player: \(monitor.current?.title ?? "nothing playing")")
    }

    private func reel(size: CGFloat, angle: Angle) -> some View {
        ZStack {
            Circle().fill(Color(white: 0.04)).frame(width: size, height: size)
            Circle().fill(.white.opacity(0.9)).frame(width: size * 0.5, height: size * 0.5)
            ForEach(0..<6, id: \.self) { i in
                Capsule().fill(Color(white: 0.1)).frame(width: 2.5, height: size * 0.2).offset(y: -size * 0.2)
                    .rotationEffect(.degrees(Double(i) * 60))
            }
        }
        .rotationEffect(angle)
    }

    private func deckButton(_ symbol: String, _ label: String, big: Bool = false, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Image(systemName: symbol).font(.system(size: big ? 13 : 10, weight: .bold)).foregroundStyle(.white)
                .frame(width: big ? 28 : 22, height: big ? 28 : 22)
                .background(Circle().fill(Color(white: big ? 0.5 : 0.38)))
        }
        .buttonStyle(.plain).help(label).accessibilityLabel(label)
    }
}
