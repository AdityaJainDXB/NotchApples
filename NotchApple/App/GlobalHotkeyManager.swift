//
//  GlobalHotkeyManager.swift
//  Notch apple
//
//  System-wide ⌘E to toggle the notch, built on Carbon's `RegisterEventHotKey`.
//  Unlike an NSEvent global monitor, a registered hot key needs no
//  Accessibility permission and never sees any other keystrokes.
//
//  Note: while registered, ⌘E is consumed system-wide (so apps won't receive
//  their own ⌘E, e.g. "Use Selection for Find"). It can be turned off in
//  Settings → General.
//

import Carbon.HIToolbox

final class GlobalHotkeyManager {
    static let shared = GlobalHotkeyManager()

    private var hotKeyRef: EventHotKeyRef?
    private var handlerRef: EventHandlerRef?
    private var action: (() -> Void)?

    /// Registers ⌘E. Calling again replaces the previous action.
    func register(action: @escaping () -> Void) {
        self.action = action
        guard hotKeyRef == nil else { return }

        var eventType = EventTypeSpec(eventClass: OSType(kEventClassKeyboard), eventKind: UInt32(kEventHotKeyPressed))
        InstallEventHandler(GetApplicationEventTarget(), { _, _, userData in
            guard let userData else { return noErr }
            let manager = Unmanaged<GlobalHotkeyManager>.fromOpaque(userData).takeUnretainedValue()
            DispatchQueue.main.async { manager.action?() }
            return noErr
        }, 1, &eventType, Unmanaged.passUnretained(self).toOpaque(), &handlerRef)

        let id = EventHotKeyID(signature: OSType(0x4E545348), id: 1)   // 'NTSH'
        RegisterEventHotKey(UInt32(kVK_ANSI_E), UInt32(cmdKey), id, GetApplicationEventTarget(), 0, &hotKeyRef)
    }

    func unregister() {
        if let hotKeyRef { UnregisterEventHotKey(hotKeyRef) }
        if let handlerRef { RemoveEventHandler(handlerRef) }
        hotKeyRef = nil
        handlerRef = nil
    }
}
