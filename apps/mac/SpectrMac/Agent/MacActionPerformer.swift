import AppKit
import Carbon.HIToolbox
import Foundation
import SpectrKit

/// Executes one validated backend action. Production uses `EventActionPerformer`;
/// tests substitute a fake.
@MainActor
protocol MacActionPerformer: AnyObject {
    /// Returns optional output text for the step result, or throws why it was refused
    /// or failed. Never partially retries.
    func perform(_ action: MacAction, in frame: AgentFrame) async throws(ActionRefusal) -> String?
}

enum ActionRefusal: Error, Equatable, Sendable {
    case accessibilityDenied
    case desktopLocked
    case appBlocked(String)
    case secureField
    case sharedWindowNotInFront
    case appNotFound(String)
    case unsupportedKey(String)
    case eventFailed

    var message: String {
        switch self {
        case .accessibilityDenied: "Spectr needs Accessibility permission on this Mac."
        case .desktopLocked: "The Mac is locked. Unlock it to continue."
        case .appBlocked(let name): "Spectr is not allowed to operate \(name)."
        case .secureField: "Spectr never types into password fields. Ask the owner to type it."
        case .sharedWindowNotInFront: "The shared window is not in front. Click it first."
        case .appNotFound(let name): "No app named \(name) is installed."
        case .unsupportedKey(let key): "The key \(key) is not supported."
        case .eventFailed: "macOS did not accept the input event."
        }
    }
}

/// Posts real input events after checking the Mac's own safety rules.
@MainActor
final class EventActionPerformer: MacActionPerformer {
    private let driver: AccessibilityDesktopDriver
    private let policy: AppPolicy

    init(driver: AccessibilityDesktopDriver, policy: AppPolicy = .current) {
        self.driver = driver
        self.policy = policy
    }

    func perform(_ action: MacAction, in frame: AgentFrame) async throws(ActionRefusal) -> String? {
        try preflight(action, frame: frame)
        switch action {
        case .screenshot:
            return nil
        case .wait(let seconds):
            try? await Task.sleep(for: .milliseconds(Int(seconds * 1_000)))
            return nil
        case .click(let x, let y, let button, let clicks, let modifiers):
            try click(at: frame.screenPoint(x: x, y: y), button: button, clicks: clicks, flags: flags(modifiers))
        case .mouseMove(let x, let y):
            try post(mouse: .mouseMoved, at: frame.screenPoint(x: x, y: y), button: .left, flags: [])
        case .drag(let fx, let fy, let tx, let ty, let modifiers):
            try drag(
                from: frame.screenPoint(x: fx, y: fy), to: frame.screenPoint(x: tx, y: ty), flags: flags(modifiers))
        case .scroll(let x, let y, let direction, let amount, let modifiers):
            if let x, let y {
                try post(mouse: .mouseMoved, at: frame.screenPoint(x: x, y: y), button: .left, flags: [])
            }
            try scroll(direction: direction, amount: amount, flags: flags(modifiers))
        case .type(let text):
            do {
                try driver.typeText(text, into: nil)
            } catch {
                throw .eventFailed
            }
        case .key(let keys, let count):
            guard let chord = MacActionPolicy.parseKeys(keys) else { throw .unsupportedKey(keys) }
            for _ in 0..<count { try press(chord) }
        case .openApp(let name):
            try await openApp(named: name)
        case .openUrl(let url):
            guard NSWorkspace.shared.open(url) else { throw .eventFailed }
        case .unsupported(let type):
            throw .unsupportedKey(type)
        }
        return nil
    }

    // MARK: Safety

    private func preflight(_ action: MacAction, frame: AgentFrame) throws(ActionRefusal) {
        if case .screenshot = action { return }
        if case .wait = action { return }
        guard driver.isAccessibilityTrusted else { throw .accessibilityDenied }
        guard !driver.isScreenLocked else { throw .desktopLocked }
        switch action {
        case .openApp, .openUrl:
            return
        default:
            break
        }
        let front = NSWorkspace.shared.frontmostApplication
        if policy.isBlocked(front?.bundleIdentifier) {
            throw .appBlocked(front?.localizedName ?? "this app")
        }
        let isKeyboard: Bool =
            switch action {
            case .type, .key: true
            default: false
            }
        if isKeyboard {
            // With one window shared, keystrokes must land in that window's app.
            if let owner = frame.windowOwnerPID, front?.processIdentifier != owner {
                throw .sharedWindowNotInFront
            }
            if case .type = action, !policy.typesIntoSecureFields, driver.isSecureField(nil) {
                throw .secureField
            }
        }
    }

    // MARK: Input

    private func flags(_ names: [String]) -> CGEventFlags {
        var flags: CGEventFlags = []
        for name in names {
            switch MacActionPolicy.modifierNames[name.lowercased()] {
            case "command": flags.insert(.maskCommand)
            case "control": flags.insert(.maskControl)
            case "option": flags.insert(.maskAlternate)
            case "shift": flags.insert(.maskShift)
            default: break
            }
        }
        return flags
    }

    private func post(
        mouse type: CGEventType, at point: CGPoint, button: CGMouseButton, flags: CGEventFlags, clickState: Int64 = 1
    )
        throws(ActionRefusal)
    {
        guard
            let event = CGEvent(mouseEventSource: nil, mouseType: type, mouseCursorPosition: point, mouseButton: button)
        else { throw .eventFailed }
        event.flags = flags
        event.setIntegerValueField(.mouseEventClickState, value: clickState)
        event.post(tap: .cghidEventTap)
    }

    private func click(at point: CGPoint, button: MacAction.Button, clicks: Int, flags: CGEventFlags)
        throws(ActionRefusal)
    {
        let (down, up, cgButton): (CGEventType, CGEventType, CGMouseButton) =
            switch button {
            case .left: (.leftMouseDown, .leftMouseUp, .left)
            case .right: (.rightMouseDown, .rightMouseUp, .right)
            case .middle: (.otherMouseDown, .otherMouseUp, .center)
            }
        try post(mouse: .mouseMoved, at: point, button: cgButton, flags: [])
        for index in 1...max(1, clicks) {
            try post(mouse: down, at: point, button: cgButton, flags: flags, clickState: Int64(index))
            try post(mouse: up, at: point, button: cgButton, flags: flags, clickState: Int64(index))
        }
    }

    private func drag(from start: CGPoint, to end: CGPoint, flags: CGEventFlags) throws(ActionRefusal) {
        try post(mouse: .mouseMoved, at: start, button: .left, flags: [])
        try post(mouse: .leftMouseDown, at: start, button: .left, flags: flags)
        let steps = 12
        for index in 1...steps {
            let t = Double(index) / Double(steps)
            let point = CGPoint(x: start.x + (end.x - start.x) * t, y: start.y + (end.y - start.y) * t)
            try post(mouse: .leftMouseDragged, at: point, button: .left, flags: flags)
        }
        try post(mouse: .leftMouseUp, at: end, button: .left, flags: flags)
    }

    private func scroll(direction: MacAction.Direction, amount: Int, flags: CGEventFlags) throws(ActionRefusal) {
        // Positive wheel1 scrolls content down toward the top (line units).
        let (vertical, horizontal): (Int32, Int32) =
            switch direction {
            case .up: (Int32(amount), 0)
            case .down: (-Int32(amount), 0)
            case .left: (0, Int32(amount))
            case .right: (0, -Int32(amount))
            }
        guard
            let event = CGEvent(
                scrollWheelEvent2Source: nil, units: .line, wheelCount: 2, wheel1: vertical, wheel2: horizontal,
                wheel3: 0)
        else { throw .eventFailed }
        event.flags = flags
        event.post(tap: .cghidEventTap)
    }

    private func press(_ chord: MacActionPolicy.KeyChord) throws(ActionRefusal) {
        guard let code = Self.virtualKey(chord.key) else { throw .unsupportedKey(chord.key) }
        let source = CGEventSource(stateID: .combinedSessionState)
        let flags = flags(chord.modifiers)
        for keyDown in [true, false] {
            guard let event = CGEvent(keyboardEventSource: source, virtualKey: code, keyDown: keyDown) else {
                throw .eventFailed
            }
            event.flags = flags
            event.post(tap: .cghidEventTap)
        }
    }

    static func virtualKey(_ key: String) -> CGKeyCode? {
        let extra: [String: Int] = [
            "enter": kVK_Return, "esc": kVK_Escape, "backspace": kVK_Delete, "forwardDelete": kVK_ForwardDelete,
            "f1": kVK_F1, "f2": kVK_F2, "f3": kVK_F3, "f4": kVK_F4, "f5": kVK_F5, "f6": kVK_F6,
            "f7": kVK_F7, "f8": kVK_F8, "f9": kVK_F9, "f10": kVK_F10, "f11": kVK_F11, "f12": kVK_F12,
        ]
        if let code = extra[key] { return CGKeyCode(code) }
        return KeyCodes.virtualKey(for: key)
    }

    // MARK: Apps

    private func openApp(named name: String) async throws(ActionRefusal) {
        guard let url = Self.applicationURL(named: name) else { throw .appNotFound(name) }
        let bundleId = Bundle(url: url)?.bundleIdentifier
        if policy.isBlocked(bundleId) { throw .appBlocked(name) }
        let configuration = NSWorkspace.OpenConfiguration()
        configuration.activates = true
        do {
            _ = try await NSWorkspace.shared.openApplication(at: url, configuration: configuration)
        } catch {
            throw .eventFailed
        }
    }

    /// Finds an installed app by its display name in the standard application folders.
    /// Never resolves arbitrary paths.
    static func applicationURL(named name: String) -> URL? {
        let wanted = name.lowercased().hasSuffix(".app") ? String(name.dropLast(4)) : name
        let folders = [
            "/Applications", "/System/Applications", "/System/Applications/Utilities",
            "/Applications/Utilities", NSHomeDirectory() + "/Applications",
        ]
        for folder in folders {
            guard let items = try? FileManager.default.contentsOfDirectory(atPath: folder) else { continue }
            if let match = items.first(where: { $0.lowercased() == wanted.lowercased() + ".app" }) {
                return URL(filePath: folder).appending(path: match)
            }
        }
        return nil
    }
}
