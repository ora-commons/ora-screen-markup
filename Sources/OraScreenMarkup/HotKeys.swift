import AppKit
import Carbon.HIToolbox

/// Global shortcuts registered with Carbon, so they work while another
/// application has the focus. The registration lives until the app quits.
final class HotKeyCenter {
    static let shared = HotKeyCenter()

    private var references: [UInt32: EventHotKeyRef] = [:]
    private var actions: [UInt32: () -> Void] = [:]
    private var handler: EventHandlerRef?
    private var nextIdentifier: UInt32 = 1
    private static let signature: OSType = 0x4F53_4D31

    private init() {}

    func installHandler() {
        guard handler == nil else { return }
        var eventType = EventTypeSpec(
            eventClass: OSType(kEventClassKeyboard),
            eventKind: UInt32(kEventHotKeyPressed)
        )
        let status = InstallEventHandler(
            GetApplicationEventTarget(),
            { _, event, _ in
                HotKeyCenter.shared.handle(event)
            },
            1,
            &eventType,
            nil,
            &handler
        )
        if status != noErr {
            handler = nil
        }
    }

    /// Registers one combination exclusively, so no other application can
    /// receive the same shortcut while this app runs. Returns false when the
    /// combination is already taken by another application.
    func register(keyCode: UInt32, modifiers: UInt32, action: @escaping () -> Void) -> Bool {
        installHandler()
        let identifier = nextIdentifier
        nextIdentifier += 1
        var reference: EventHotKeyRef?
        let hotKeyID = EventHotKeyID(signature: HotKeyCenter.signature, id: identifier)
        let status = RegisterEventHotKey(
            keyCode,
            modifiers,
            hotKeyID,
            GetApplicationEventTarget(),
            UInt32(kEventHotKeyExclusive),
            &reference
        )
        guard status == noErr, let reference else { return false }
        references[identifier] = reference
        actions[identifier] = action
        return true
    }

    func unregisterAll() {
        for (_, reference) in references {
            UnregisterEventHotKey(reference)
        }
        references.removeAll()
        actions.removeAll()
        if let handler {
            RemoveEventHandler(handler)
            self.handler = nil
        }
    }

    private func handle(_ event: EventRef?) -> OSStatus {
        guard let event else { return noErr }
        var hotKeyID = EventHotKeyID()
        let status = GetEventParameter(
            event,
            EventParamName(kEventParamDirectObject),
            EventParamType(typeEventHotKeyID),
            nil,
            MemoryLayout<EventHotKeyID>.size,
            nil,
            &hotKeyID
        )
        guard status == noErr else { return status }
        let action = actions[hotKeyID.id]
        DispatchQueue.main.async { action?() }
        return noErr
    }
}
