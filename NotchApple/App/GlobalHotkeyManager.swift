//
//  GlobalHotkeyManager.swift
//  Notch apple
//
//  System-wide hot keys built on Carbon's `RegisterEventHotKey`. Unlike an
//  NSEvent global monitor, a registered hot key needs no Accessibility
//  permission and never sees any other keystrokes.
//
//  Two keys are used:
//   • ⌘E  — toggles the notch (always registered while the preference is on).
//   • Esc — closes the notch; registered only while the notch is open, so
//           other apps get their Escape key back the moment it closes.
//

import Carbon.HIToolbox

final class GlobalHotkeyManager {
    static let shared = GlobalHotkeyManager()

    enum Key: UInt32 {
        case toggleNotch = 1
        case closeNotch = 2

        var keyCode: UInt32 {
            switch self {
            case .toggleNotch: UInt32(kVK_ANSI_E)
            case .closeNotch: UInt32(kVK_Escape)
            }
        }

        var modifiers: UInt32 {
            switch self {
            case .toggleNotch: UInt32(cmdKey)
            case .closeNotch: 0
            }
        }
    }

    private var refs: [Key: EventHotKeyRef] = [:]
    private var actions: [Key: () -> Void] = [:]
    private var handlerRef: EventHandlerRef?

    /// Registers `key`. Calling again just replaces the action.
    func register(_ key: Key, action: @escaping () -> Void) {
        actions[key] = action
        installHandlerIfNeeded()
        guard refs[key] == nil else { return }
        var ref: EventHotKeyRef?
        let id = EventHotKeyID(signature: OSType(0x4E545348), id: key.rawValue)   // 'NTSH'
        if RegisterEventHotKey(key.keyCode, key.modifiers, id, GetApplicationEventTarget(), 0, &ref) == noErr, let ref {
            refs[key] = ref
        }
    }

    func unregister(_ key: Key) {
        if let ref = refs.removeValue(forKey: key) { UnregisterEventHotKey(ref) }
        actions[key] = nil
    }

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
                DispatchQueue.main.async { manager.actions[key]?() }
            }
            return noErr
        }, 1, &eventType, Unmanaged.passUnretained(self).toOpaque(), &handlerRef)
    }
}
