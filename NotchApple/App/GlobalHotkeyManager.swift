//
//  GlobalHotkeyManager.swift
//  Notch apple
//
//  System-wide hot keys built on Carbon's `RegisterEventHotKey`. Unlike an
//  NSEvent global monitor, a registered hot key needs no Accessibility
//  permission and never sees any other keystrokes.
//
//  Keys used:
//   • ⌘J — toggles the notch (⌘E and ⌃⌥N before 2.0.24). User-configurable.
//   • ⌃⌥O — hides or reveals the whole notch (invisibility). The combination is user-configurable. (⌘O until 2.0.6.)
//   • ⌃⌥S — captures part of the screen for the AI, even while the notch is hidden. User-configurable.
//   • Esc — closes the notch; registered only while the notch is open, so
//           other apps get their Escape key back the moment it closes.
//

import Carbon.HIToolbox
import AppKit

/// A key combination stored in UserDefaults: Carbon key code + Carbon modifier flags + a label such as "⌘O".
struct HotkeyBinding: Equatable {
    var keyCode: UInt32
    var modifiers: UInt32
    var label: String

    /// The two shortcuts users can change in Settings → Shortcuts & Hotkeys.
    enum Slot {
        case notch, invisibility, capture, palette, lidFold

        fileprivate var prefix: String {
            switch self {
            case .notch: "hotkey.notch"
            case .invisibility: "hotkey.invisibility"
            case .capture: "hotkey.capture"
            case .palette: "hotkey.palette"
            case .lidFold: "hotkey.lidFold"
            }
        }

        /// Notch: ⌘J for everyone from 2.0.24 (⌥Space and other ⌥-only combinations are blocked by macOS for global
        /// hot keys). It was ⌃⌥N on new installs and ⌘E for older ones, see `migrateNotchToCommandJ`.
        var defaultBinding: HotkeyBinding {
            switch self {
            case .notch: HotkeyBinding(keyCode: UInt32(kVK_ANSI_J), modifiers: UInt32(cmdKey), label: "⌘J")
            case .invisibility: HotkeyBinding(keyCode: UInt32(kVK_ANSI_O), modifiers: UInt32(controlKey | optionKey), label: "⌃⌥O")
            case .capture: HotkeyBinding(keyCode: UInt32(kVK_ANSI_S), modifiers: UInt32(controlKey | optionKey), label: "⌃⌥S")
            case .palette: HotkeyBinding(keyCode: UInt32(kVK_ANSI_P), modifiers: UInt32(controlKey | optionKey), label: "⌃⌥P")
            case .lidFold: HotkeyBinding(keyCode: UInt32(kVK_ANSI_F), modifiers: UInt32(controlKey | optionKey), label: "⌃⌥F")
            }
        }
    }

    static let invisibilityDefault = Slot.invisibility.defaultBinding
    static let legacyNotch = HotkeyBinding(keyCode: UInt32(kVK_ANSI_E), modifiers: UInt32(cmdKey), label: "⌘E")
    /// The hide shortcut up to 2.0.5. As a global hot key it took ⌘O (Open…) away from every other app.
    static let legacyInvisibility = HotkeyBinding(keyCode: UInt32(kVK_ANSI_O), modifiers: UInt32(cmdKey), label: "⌘O")

    static let previousNotchDefault = HotkeyBinding(keyCode: UInt32(kVK_ANSI_N), modifiers: UInt32(controlKey | optionKey), label: "⌃⌥N")

    /// 2.0.24: the notch shortcut is ⌘J for everyone. Anyone still on one of the old defaults (⌘E, ⌃⌥N) moves to it,
    /// once; a shortcut someone recorded themselves is left alone, and they can change it back in Settings.
    static func migrateNotchToCommandJ() {
        let d = UserDefaults.standard
        guard !d.bool(forKey: "hotkey.notch.migratedToCmdJ") else { return }
        d.set(true, forKey: "hotkey.notch.migratedToCmdJ")
        let saved = current(.notch)
        let oldDefault = (saved.keyCode == legacyNotch.keyCode && saved.modifiers == legacyNotch.modifiers)
            || (saved.keyCode == previousNotchDefault.keyCode && saved.modifiers == previousNotchDefault.modifiers)
        if oldDefault { reset(.notch) }
    }

    /// 2.0.6: anyone whose hide shortcut is still ⌘O moves to ⌃⌥O, once, so ⌘O opens files again everywhere.
    static func migrateInvisibilityOffCommandO() {
        let d = UserDefaults.standard
        guard !d.bool(forKey: "hotkey.invisibility.migratedOffCmdO") else { return }
        d.set(true, forKey: "hotkey.invisibility.migratedOffCmdO")
        let saved = current(.invisibility)
        if saved.keyCode == legacyInvisibility.keyCode && saved.modifiers == legacyInvisibility.modifiers { reset(.invisibility) }
    }

    /// The saved combination for `slot`, or its default when none has been chosen.
    static func current(_ slot: Slot) -> HotkeyBinding {
        let d = UserDefaults.standard
        guard d.object(forKey: slot.prefix + ".keyCode") != nil else { return slot.defaultBinding }
        return HotkeyBinding(keyCode: UInt32(d.integer(forKey: slot.prefix + ".keyCode")),
                             modifiers: UInt32(d.integer(forKey: slot.prefix + ".modifiers")),
                             label: d.string(forKey: slot.prefix + ".label") ?? slot.defaultBinding.label)
    }

    static func save(_ binding: HotkeyBinding, for slot: Slot) {
        let d = UserDefaults.standard
        d.set(Int(binding.keyCode), forKey: slot.prefix + ".keyCode")
        d.set(Int(binding.modifiers), forKey: slot.prefix + ".modifiers")
        d.set(binding.label, forKey: slot.prefix + ".label")
    }

    static func reset(_ slot: Slot) {
        let d = UserDefaults.standard
        ["keyCode", "modifiers", "label"].forEach { d.removeObject(forKey: slot.prefix + "." + $0) }
    }

    static var invisibility: HotkeyBinding { current(.invisibility) }

    static var notch: HotkeyBinding { current(.notch) }

    static var capture: HotkeyBinding { current(.capture) }

    static var palette: HotkeyBinding { current(.palette) }

    static var lidFold: HotkeyBinding { current(.lidFold) }

    /// Builds a binding from a key press, or nil if it can't work as a global shortcut
    /// (needs ⌘ or ⌃; ⌥ or ⇧ alone are ignored by macOS for global hot keys).
    init?(event: NSEvent) {
        let flags = event.modifierFlags.intersection(.deviceIndependentFlagsMask)
        guard flags.contains(.command) || flags.contains(.control) else { return nil }
        var mods: UInt32 = 0
        var text = ""
        if flags.contains(.control) { mods |= UInt32(controlKey); text += "⌃" }
        if flags.contains(.option) { mods |= UInt32(optionKey); text += "⌥" }
        if flags.contains(.shift) { mods |= UInt32(shiftKey); text += "⇧" }
        if flags.contains(.command) { mods |= UInt32(cmdKey); text += "⌘" }
        let named: [Int: String] = [kVK_Space: "Space", kVK_Return: "↩", kVK_Tab: "⇥", kVK_Delete: "⌫",
                                    kVK_LeftArrow: "←", kVK_RightArrow: "→", kVK_UpArrow: "↑", kVK_DownArrow: "↓"]
        let key = named[Int(event.keyCode)] ?? (event.charactersIgnoringModifiers ?? "").uppercased()
        guard !key.isEmpty else { return nil }
        self.init(keyCode: UInt32(event.keyCode), modifiers: mods, label: text + key)
    }

    init(keyCode: UInt32, modifiers: UInt32, label: String) {
        self.keyCode = keyCode; self.modifiers = modifiers; self.label = label
    }
}

final class GlobalHotkeyManager {
    static let shared = GlobalHotkeyManager()

    enum Key: UInt32 {
        case toggleNotch = 1
        case closeNotch = 2
        case toggleInvisible = 3
        case capture = 4
        case palette = 5
        case foldToggle = 6, foldDismiss = 7   // Lid Fold: fold-and-hold, and Esc while a fold is showing
        case panic = 8                         // Panic hide, ⌃⌥⇧P
        case quickCapture = 9                  // Quick note from anywhere, ⌃⌥J
        // Window snapping, ⌃⌥ + key.
        case snapLeft = 10, snapRight, snapTop, snapBottom, snapMaximize, snapCenter, snapRestore

        static let windowKeys: [Key] = [.snapLeft, .snapRight, .snapTop, .snapBottom, .snapMaximize, .snapCenter, .snapRestore]

        var keyCode: UInt32 {
            switch self {
            case .toggleNotch: HotkeyBinding.notch.keyCode
            case .closeNotch: UInt32(kVK_Escape)
            case .toggleInvisible: HotkeyBinding.invisibility.keyCode
            case .capture: HotkeyBinding.capture.keyCode
            case .palette: HotkeyBinding.palette.keyCode
            case .foldToggle: HotkeyBinding.lidFold.keyCode
            case .foldDismiss: UInt32(kVK_Escape)
            case .panic: UInt32(kVK_ANSI_P)
            case .quickCapture: UInt32(kVK_ANSI_J)
            case .snapLeft: UInt32(kVK_LeftArrow)
            case .snapRight: UInt32(kVK_RightArrow)
            case .snapTop: UInt32(kVK_UpArrow)
            case .snapBottom: UInt32(kVK_DownArrow)
            case .snapMaximize: UInt32(kVK_Return)
            case .snapCenter: UInt32(kVK_ANSI_C)
            case .snapRestore: UInt32(kVK_Delete)
            }
        }

        var modifiers: UInt32 {
            switch self {
            case .toggleNotch: HotkeyBinding.notch.modifiers
            case .toggleInvisible: HotkeyBinding.invisibility.modifiers
            case .capture: HotkeyBinding.capture.modifiers
            case .palette: HotkeyBinding.palette.modifiers
            case .foldToggle: HotkeyBinding.lidFold.modifiers
            case .closeNotch, .foldDismiss: 0
            case .panic: UInt32(controlKey | optionKey | shiftKey)
            case .quickCapture: UInt32(controlKey | optionKey)
            default: UInt32(controlKey | optionKey)
            }
        }
    }

    private var refs: [Key: EventHotKeyRef] = [:]
    private var combos: [Key: [UInt32]] = [:]
    private var actions: [Key: () -> Void] = [:]
    private var handlerRef: EventHandlerRef?
    /// Result of the last registration attempt per key (noErr = working).
    private(set) var statuses: [Key: OSStatus] = [:]

    /// While a required update is waiting only opening and closing the notch (which shows the update) still work.
    static func blockedByRequiredUpdate(_ key: Key) -> Bool {
        UpdateChecker.isLocked && key != .toggleNotch && key != .closeNotch
    }

    /// Registers `key`. Calling again replaces the action, and re-registers if the key combination has changed.
    @discardableResult
    func register(_ key: Key, action: @escaping () -> Void) -> Bool {
        if Self.blockedByRequiredUpdate(key) { return false }
        actions[key] = action
        installHandlerIfNeeded()
        let combo = [key.keyCode, key.modifiers]
        if refs[key] != nil {
            if combos[key] == combo { return true }
            UnregisterEventHotKey(refs.removeValue(forKey: key)!)   // the combination was changed in Settings
        }
        var ref: EventHotKeyRef?
        let id = EventHotKeyID(signature: OSType(0x4E545348), id: key.rawValue)   // 'NTSH'
        let status = RegisterEventHotKey(key.keyCode, key.modifiers, id, GetApplicationEventTarget(), 0, &ref)
        statuses[key] = status
        guard status == noErr, let ref else { return false }
        refs[key] = ref
        combos[key] = combo
        return true
    }

    func unregister(_ key: Key) {
        if let ref = refs.removeValue(forKey: key) { UnregisterEventHotKey(ref) }
        combos[key] = nil
        statuses[key] = nil
        actions[key] = nil
    }

    /// Drops and re-creates every registered hot key. Used after wake or unlock, when a
    /// registration could have been lost, so shortcuts keep working in every app.
    func reregisterAll() {
        for (key, action) in actions {
            if let ref = refs.removeValue(forKey: key) { UnregisterEventHotKey(ref) }
            combos[key] = nil
            register(key, action: action)
        }
    }

    /// True when the last attempt to register `key` failed, e.g. another app already owns the combination.
    func isBlocked(_ key: Key) -> Bool { (statuses[key] ?? noErr) != noErr }

    private func installHandlerIfNeeded() {
        guard handlerRef == nil else { return }
        var eventType = EventTypeSpec(eventClass: OSType(kEventClassKeyboard), eventKind: UInt32(kEventHotKeyPressed))
        InstallEventHandler(GetApplicationEventTarget(), { _, event, userData in
            guard let event, let userData else { return noErr }
            var hotKeyID = EventHotKeyID()
            GetEventParameter(event, EventParamName(kEventParamDirectObject), EventParamType(typeEventHotKeyID),
                              nil, MemoryLayout<EventHotKeyID>.size, nil, &hotKeyID)
            let manager = Unmanaged<GlobalHotkeyManager>.fromOpaque(userData).takeUnretainedValue()
            if let key = Key(rawValue: hotKeyID.id) {
                DispatchQueue.main.async { if !GlobalHotkeyManager.blockedByRequiredUpdate(key) { manager.actions[key]?() } }
            }
            return noErr
        }, 1, &eventType, Unmanaged.passUnretained(self).toOpaque(), &handlerRef)
    }
}
