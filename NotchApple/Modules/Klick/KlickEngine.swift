//
//  KlickEngine.swift
//  Notch apple
//
//  Klick (Pro): your keyboard sounds like a mechanical one, in any app. Pick a sound (Cream, Holy Panda, Blue, Red,
//  Brown, Topre, Typewriter or Bubble), set its volume, and every key you press plays it: three slightly different
//  key-down sounds so fast typing sounds natural, bigger ones for the space bar and Enter, and a soft key-up.
//
//  Hearing keys in other apps needs Accessibility (the same permission as the text expander). Only the fact that a
//  key went down or up is used, to pick a sound: nothing you type is read, kept or sent anywhere. The sounds are small
//  WAV files shared with the Windows app (made by scripts/klick_sounds.py). Off, it listens to nothing and the audio
//  engine is stopped.
//

import AppKit
import AVFoundation
import SwiftUI

@MainActor
final class KlickEngine: ObservableObject {
    static let shared = KlickEngine()

    struct Pack: Identifiable {
        let id: String
        let name: String
        let blurb: String
        let symbol: String
    }

    static let packs: [Pack] = [
        Pack(id: "cream", name: "Cream", blurb: "Deep, smooth thock. Linear, like NovelKeys Creams.", symbol: "drop.fill"),
        Pack(id: "holypanda", name: "Holy Panda", blurb: "Bassy and tactile, with a bump on the way down.", symbol: "pawprint.fill"),
        Pack(id: "blue", name: "Blue", blurb: "Loud and clicky. Everyone will know you're typing.", symbol: "bolt.fill"),
        Pack(id: "red", name: "Red", blurb: "Light, quick and linear. Higher and softer.", symbol: "flame.fill"),
        Pack(id: "brown", name: "Brown", blurb: "A gentle tactile bump, quieter than Blue.", symbol: "leaf.fill"),
        Pack(id: "topre", name: "Topre", blurb: "Muted, rounded thock of rubber domes.", symbol: "circle.fill"),
        Pack(id: "typewriter", name: "Typewriter", blurb: "Metal clack, and a bell on Enter.", symbol: "doc.text.fill"),
        Pack(id: "bubble", name: "Bubble", blurb: "Playful pops. Not a real switch, just fun.", symbol: "bubbles.and.sparkles.fill"),
    ]

    /// The on / off switch.
    @AppStorage("klick.on") var isOn = false { didSet { apply() } }
    @AppStorage("klick.pack") var packID = "cream" { didSet { loadPack() } }
    /// A key-up sound as well as the key-down one.
    @AppStorage("klick.keyUp") var keyUpSound = true
    /// Volume for each sound, 0…1, as "cream=0.7,blue=0.4".
    @AppStorage("klick.volumes") private var volumesRaw = ""
    /// True while the switch is on but macOS hasn't allowed Accessibility, so only keys typed in Notch apple sound.
    @Published private(set) var needsAccessibility = false
    /// Briefly true on each key, for the little light in the tab.
    @Published private(set) var lastKey = Date.distantPast

    private let engine = AVAudioEngine()
    private var players: [AVAudioPlayerNode] = []
    private var nextPlayer = 0
    private var format: AVAudioFormat?
    private var sounds: [String: [AVAudioPCMBuffer]] = [:]     // "down" (three), "up", "space", "enter"
    private var loadedPack = ""
    private var globalMonitor: Any?
    private var localMonitor: Any?
    private var held = Set<UInt16>()
    private var variant = 0
    private var configObserver: NSObjectProtocol?

    var pack: Pack { Self.packs.first { $0.id == packID } ?? Self.packs[0] }

    // MARK: Volume per sound

    private var volumes: [String: Double] {
        get {
            var out: [String: Double] = [:]
            for pair in volumesRaw.split(separator: ",") {
                let kv = pair.split(separator: "=")
                if kv.count == 2, let v = Double(kv[1]) { out[String(kv[0])] = v }
            }
            return out
        }
        set { volumesRaw = newValue.map { "\($0.key)=\(String(format: "%.2f", $0.value))" }.sorted().joined(separator: ",") }
    }

    func volume(for id: String) -> Double { volumes[id] ?? 0.6 }

    func setVolume(_ value: Double, for id: String) {
        var v = volumes
        v[id] = min(max(value, 0), 1)
        volumes = v
        objectWillChange.send()
    }

    // MARK: On and off

    /// Starts or stops listening to match the switch and the license. Safe to call often.
    func apply() {
        let want = isOn && Entitlements.shared.canUse(Feature.klick)
        if want { start() } else { stop() }
        objectWillChange.send()
    }

    /// Rechecks Accessibility (the heartbeat calls this every 30 s).
    func refreshPermission() {
        let need = isOn && globalMonitor != nil && !AXIsProcessTrusted()
        if need != needsAccessibility { needsAccessibility = need }
    }

    private func start() {
        if globalMonitor == nil {
            if !AXIsProcessTrusted() {
                AXIsProcessTrustedWithOptions([kAXTrustedCheckOptionPrompt.takeUnretainedValue() as String: true] as CFDictionary)
            }
            globalMonitor = NSEvent.addGlobalMonitorForEvents(matching: [.keyDown, .keyUp]) { event in
                MainActor.assumeIsolated { KlickEngine.shared.handle(event) }
            }
            // Keys typed in Notch apple itself (Settings, the notch) never reach the global monitor.
            localMonitor = NSEvent.addLocalMonitorForEvents(matching: [.keyDown, .keyUp]) { event in
                MainActor.assumeIsolated { KlickEngine.shared.handle(event) }
                return event
            }
        }
        needsAccessibility = !AXIsProcessTrusted()
        startAudio()
    }

    private func stop() {
        if let m = globalMonitor { NSEvent.removeMonitor(m) }
        if let m = localMonitor { NSEvent.removeMonitor(m) }
        globalMonitor = nil
        localMonitor = nil
        held.removeAll()
        needsAccessibility = false
        if engine.isRunning { engine.stop() }
    }

    // MARK: Keys

    private func handle(_ event: NSEvent) {
        switch event.type {
        case .keyDown:
            guard !event.isARepeat else { return }      // holding a key down repeats it; a real switch only clicks once
            held.insert(event.keyCode)
            switch event.keyCode {
            case 49: play("space")
            case 36, 76: play("enter")
            default: play("down")
            }
        case .keyUp:
            guard held.remove(event.keyCode) != nil, keyUpSound else { return }
            play("up")
        default:
            break
        }
    }

    /// Plays one of the current pack's sounds ("down", "up", "space" or "enter").
    func play(_ kind: String, pack id: String? = nil) {
        if let id, id != loadedPack { packID = id }
        startAudio()
        guard let list = sounds[kind] ?? sounds["down"], !list.isEmpty, !players.isEmpty else { return }
        let buffer: AVAudioPCMBuffer
        if kind == "down" { variant = (variant + 1 + Int.random(in: 0...1)) % list.count; buffer = list[variant] } else { buffer = list[0] }
        let player = players[nextPlayer]
        nextPlayer = (nextPlayer + 1) % players.count
        player.volume = Float(volume(for: packID))
        player.scheduleBuffer(buffer, at: nil, options: .interrupts)
        if !player.isPlaying { player.play() }
        if kind != "up" { lastKey = .now }
    }

    /// The sound of a few keys, to hear a pack before you choose it.
    func preview(_ id: String) {
        packID = id
        for (i, kind) in ["down", "down", "up", "down", "space"].enumerated() {
            DispatchQueue.main.asyncAfter(deadline: .now() + Double(i) * 0.11) { [weak self] in self?.play(kind) }
        }
    }

    // MARK: Audio

    private func startAudio() {
        if loadedPack != packID { loadPack() }
        guard let format else { return }
        if players.isEmpty {
            for _ in 0..<10 {
                let p = AVAudioPlayerNode()
                engine.attach(p)
                engine.connect(p, to: engine.mainMixerNode, format: format)
                players.append(p)
            }
            // A new output (headphones plugged in) stops the engine; start it again.
            configObserver = NotificationCenter.default.addObserver(forName: .AVAudioEngineConfigurationChange, object: engine, queue: .main) { _ in
                MainActor.assumeIsolated {
                    let k = KlickEngine.shared
                    if k.isOn, !k.engine.isRunning { try? k.engine.start() }
                }
            }
        }
        if !engine.isRunning {
            engine.prepare()
            try? engine.start()
        }
    }

    private func loadPack() {
        guard let folder = Bundle.main.url(forResource: "klick", withExtension: nil)?.appendingPathComponent(packID) else { return }
        func load(_ name: String) -> AVAudioPCMBuffer? {
            guard let file = try? AVAudioFile(forReading: folder.appendingPathComponent("\(name).wav")),
                  let buffer = AVAudioPCMBuffer(pcmFormat: file.processingFormat, frameCapacity: AVAudioFrameCount(file.length)) else { return nil }
            do { try file.read(into: buffer) } catch { return nil }
            return buffer
        }
        var out: [String: [AVAudioPCMBuffer]] = [:]
        out["down"] = ["down1", "down2", "down3"].compactMap(load)
        for kind in ["up", "space", "enter"] { if let b = load(kind) { out[kind] = [b] } }
        guard let first = out["down"]?.first else { return }
        // Every pack is made at the same rate and channel count, so the players never need reconnecting.
        if format == nil { format = first.format }
        sounds = out
        loadedPack = packID
        objectWillChange.send()
    }
}
