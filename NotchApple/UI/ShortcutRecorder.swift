//
//  ShortcutRecorder.swift
//  Notch apple
//
//  A "click, then press the keys you want" shortcut field for Settings.
//  It records with a local key monitor (no Accessibility permission) and saves
//  the result to UserDefaults through `HotkeyBinding`.
//

import SwiftUI
import Carbon.HIToolbox

struct ShortcutRecorder: View {
    let slot: HotkeyBinding.Slot
    @Binding var binding: HotkeyBinding
    /// Combinations that can't be used (already taken inside the app).
    var reserved: [HotkeyBinding] = []
    var onChange: () -> Void = {}

    @State private var recording = false
    @State private var monitor: Any?
    @State private var message: String?

    var body: some View {
        VStack(alignment: .trailing, spacing: 4) {
            HStack(spacing: 8) {
                Button(action: toggle) {
                    Text(recording ? "Press the new shortcut…" : binding.label)
                        .font(.system(size: 13, weight: .semibold, design: .rounded))
                        .frame(minWidth: 130)
                }
                .buttonStyle(.bordered)
                .tint(recording ? Theme.accent : nil)
                .accessibilityLabel("Shortcut: \(binding.label). Click to change.")

                Button("Reset to \(slot.defaultBinding.label)") {
                    stop()
                    HotkeyBinding.reset(slot)
                    binding = slot.defaultBinding
                    message = nil
                    onChange()
                }
                .disabled(binding == slot.defaultBinding)
            }
            if let message {
                Text(message).font(.caption).foregroundStyle(.orange)
            }
        }
        .onDisappear(perform: stop)
    }

    private func toggle() { recording ? stop() : start() }

    private func start() {
        message = nil
        recording = true
        monitor = NSEvent.addLocalMonitorForEvents(matching: .keyDown) { event in
            if event.keyCode == UInt16(kVK_Escape) { stop(); return nil }
            guard let new = HotkeyBinding(event: event) else {
                message = "Include ⌘ or ⌃ so the shortcut works in every app."
                return nil
            }
            if reserved.contains(new) {
                message = "\(new.label) is already used by Notch apple. Try another."
                return nil
            }
            HotkeyBinding.save(new, for: slot)
            binding = new
            stop()
            onChange()
            return nil
        }
    }

    private func stop() {
        recording = false
        if let monitor { NSEvent.removeMonitor(monitor) }
        monitor = nil
    }
}
