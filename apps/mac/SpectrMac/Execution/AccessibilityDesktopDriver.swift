import AppKit
import ApplicationServices
import Carbon.HIToolbox
import Foundation
import SpectrKit

/// Operates the Mac through the Accessibility API and synthetic input events.
@MainActor
final class AccessibilityDesktopDriver: DesktopDriver {
    static let maxElements = 150
    private static let maxDepth = 12
    private static let targetableRoles: Set<String> = [
        kAXButtonRole, kAXTextFieldRole, kAXTextAreaRole, kAXCheckBoxRole, kAXRadioButtonRole,
        kAXPopUpButtonRole, kAXMenuButtonRole, kAXMenuItemRole, kAXComboBoxRole, "AXLink",
        kAXCellRole, kAXRowRole, kAXTabGroupRole, kAXSliderRole, kAXIncrementorRole, "AXSearchField",
    ]

    /// Element IDs from the most recent observation. Reset on every `observe(includeElements: true)`.
    private var registry: [String: AXUIElement] = [:]

    var isAccessibilityTrusted: Bool { AXIsProcessTrusted() }

    var isScreenLocked: Bool {
        guard let session = CGSessionCopyCurrentDictionary() as? [String: Any] else { return false }
        return (session["CGSSessionScreenIsLocked"] as? Bool) == true
    }

    var frontmostBundleId: String? { NSWorkspace.shared.frontmostApplication?.bundleIdentifier }

    // MARK: Observation

    func observe(includeElements: Bool) -> ObservedState {
        let app = NSWorkspace.shared.frontmostApplication
        var windowTitle: String?
        var windowOrigin = CGPoint.zero
        var summaries: [ObservedState.ElementSummary]?

        if let pid = app?.processIdentifier {
            let appElement = AXUIElementCreateApplication(pid)
            if let window: AXUIElement = attribute(appElement, kAXFocusedWindowAttribute) {
                windowTitle = attribute(window, kAXTitleAttribute)
                windowOrigin = point(of: window) ?? .zero
                if includeElements {
                    summaries = enumerate(window: window, origin: windowOrigin)
                }
            }
        }

        return ObservedState(
            frontmostBundleId: app?.bundleIdentifier,
            frontmostAppName: app?.localizedName,
            windowTitle: windowTitle,
            focusedElement: focusedElement().map(describe),
            elements: summaries,
            verification: .accessibility
        )
    }

    func isSecureField(_ target: Target?) -> Bool {
        let element: AXUIElement?
        switch target {
        case .element(let id): element = registry[id]
        case .point, nil: element = focusedElement()
        }
        guard let element else { return false }
        return isSecure(element)
    }

    // MARK: Actions

    func openApp(bundleId: String) async throws(DriverError) {
        guard let url = NSWorkspace.shared.urlForApplication(withBundleIdentifier: bundleId) else {
            throw .appNotFound
        }
        let configuration = NSWorkspace.OpenConfiguration()
        configuration.activates = true
        do {
            _ = try await NSWorkspace.shared.openApplication(at: url, configuration: configuration)
        } catch {
            throw .appNotFound
        }
        // Wait (bounded) for the app to come to the front.
        for _ in 0..<30 where frontmostBundleId != bundleId {
            try? await Task.sleep(for: .milliseconds(100))
        }
    }

    func click(_ target: Target) throws(DriverError) {
        switch target {
        case .element(let id):
            guard let element = registry[id] else { throw .elementNotFound }
            guard AXUIElementPerformAction(element, kAXPressAction as CFString) == .success else {
                throw .eventFailed
            }
        case .point(let x, let y):
            let location = try screenPoint(windowX: x, windowY: y)
            try postMouseClick(at: location)
        }
    }

    func typeText(_ text: String, into target: Target?) throws(DriverError) {
        if let target { try focus(target) }
        let source = CGEventSource(stateID: .combinedSessionState)
        // One character per key event. Longer strings fit in a single event, but several
        // apps (Notes among them) keep only the first character of a multi-character event.
        for character in text {
            let units = Array(String(character).utf16)
            for keyDown in [true, false] {
                guard let event = CGEvent(keyboardEventSource: source, virtualKey: 0, keyDown: keyDown) else {
                    throw .eventFailed
                }
                event.keyboardSetUnicodeString(stringLength: units.count, unicodeString: units)
                event.post(tap: .cghidEventTap)
            }
        }
    }

    func keyCombo(_ combo: KeyCombo) throws(DriverError) {
        guard let code = KeyCodes.virtualKey(for: combo.key) else { throw .unsupportedKey }
        var flags: CGEventFlags = []
        for modifier in combo.modifiers {
            switch modifier {
            case .command: flags.insert(.maskCommand)
            case .shift: flags.insert(.maskShift)
            case .option: flags.insert(.maskAlternate)
            case .control: flags.insert(.maskControl)
            }
        }
        let source = CGEventSource(stateID: .combinedSessionState)
        for keyDown in [true, false] {
            guard let event = CGEvent(keyboardEventSource: source, virtualKey: code, keyDown: keyDown) else {
                throw .eventFailed
            }
            event.flags = flags
            event.post(tap: .cghidEventTap)
        }
    }

    func scroll(dx: Int, dy: Int, target: Target?) throws(DriverError) {
        if let target {
            let location: CGPoint
            switch target {
            case .element(let id):
                guard let element = registry[id], let frame = frame(of: element) else { throw .elementNotFound }
                location = CGPoint(x: frame.midX, y: frame.midY)
            case .point(let x, let y):
                location = try screenPoint(windowX: x, windowY: y)
            }
            CGEvent(mouseEventSource: nil, mouseType: .mouseMoved, mouseCursorPosition: location, mouseButton: .left)?
                .post(tap: .cghidEventTap)
        }
        guard
            let event = CGEvent(
                scrollWheelEvent2Source: nil, units: .line, wheelCount: 2,
                wheel1: Int32(dy), wheel2: Int32(dx), wheel3: 0
            )
        else { throw .eventFailed }
        event.post(tap: .cghidEventTap)
    }

    func settle() async {
        try? await Task.sleep(for: .milliseconds(200))
    }

    // MARK: Helpers

    private func focusedElement() -> AXUIElement? {
        attribute(AXUIElementCreateSystemWide(), kAXFocusedUIElementAttribute)
    }

    private func describe(_ element: AXUIElement) -> ObservedState.Element {
        let role: String = attribute(element, kAXRoleAttribute) ?? "unknown"
        let secure = isSecure(element)
        return ObservedState.Element(
            role: role,
            title: attribute(element, kAXTitleAttribute) ?? attribute(element, kAXDescriptionAttribute),
            value: secure ? nil : attribute(element, kAXValueAttribute)
        )
    }

    private func isSecure(_ element: AXUIElement) -> Bool {
        let subrole: String? = attribute(element, kAXSubroleAttribute)
        let role: String? = attribute(element, kAXRoleAttribute)
        return subrole == kAXSecureTextFieldSubrole || role == "AXSecureTextField"
    }

    private func focus(_ target: Target) throws(DriverError) {
        switch target {
        case .element(let id):
            guard let element = registry[id] else { throw .elementNotFound }
            if AXUIElementSetAttributeValue(element, kAXFocusedAttribute as CFString, kCFBooleanTrue) != .success {
                // Some controls only take focus from a press.
                guard AXUIElementPerformAction(element, kAXPressAction as CFString) == .success else {
                    throw .eventFailed
                }
            }
        case .point(let x, let y):
            try postMouseClick(at: try screenPoint(windowX: x, windowY: y))
        }
    }

    private func enumerate(window: AXUIElement, origin: CGPoint) -> [ObservedState.ElementSummary] {
        registry.removeAll()
        var results: [ObservedState.ElementSummary] = []
        var queue: [(AXUIElement, Int)] = [(window, 0)]
        while !queue.isEmpty, results.count < Self.maxElements {
            let (element, depth) = queue.removeFirst()
            if let role: String = attribute(element, kAXRoleAttribute),
                Self.targetableRoles.contains(role),
                let frame = frame(of: element),
                frame.width > 0, frame.height > 0
            {
                let id = "ax_\(results.count + 1)"
                registry[id] = element
                let title: String? =
                    attribute(element, kAXTitleAttribute) ?? attribute(element, kAXDescriptionAttribute)
                results.append(
                    .init(
                        id: id, role: role, title: title,
                        x: frame.minX - origin.x, y: frame.minY - origin.y,
                        width: frame.width, height: frame.height
                    )
                )
            }
            if depth < Self.maxDepth, let children: [AXUIElement] = attribute(element, kAXChildrenAttribute) {
                queue.append(contentsOf: children.map { ($0, depth + 1) })
            }
        }
        return results
    }

    private func screenPoint(windowX: Double, windowY: Double) throws(DriverError) -> CGPoint {
        guard let pid = NSWorkspace.shared.frontmostApplication?.processIdentifier,
            let window: AXUIElement = attribute(AXUIElementCreateApplication(pid), kAXFocusedWindowAttribute),
            let origin = point(of: window),
            let frame = frame(of: window)
        else { throw .elementNotFound }
        guard windowX <= frame.width, windowY <= frame.height else { throw .elementNotFound }
        return CGPoint(x: origin.x + windowX, y: origin.y + windowY)
    }

    private func postMouseClick(at location: CGPoint) throws(DriverError) {
        for type in [CGEventType.leftMouseDown, .leftMouseUp] {
            guard
                let event = CGEvent(
                    mouseEventSource: nil, mouseType: type, mouseCursorPosition: location, mouseButton: .left
                )
            else { throw .eventFailed }
            event.post(tap: .cghidEventTap)
        }
    }

    private func point(of element: AXUIElement) -> CGPoint? {
        guard let value: AXValue = attribute(element, kAXPositionAttribute) else { return nil }
        var point = CGPoint.zero
        return AXValueGetValue(value, .cgPoint, &point) ? point : nil
    }

    private func frame(of element: AXUIElement) -> CGRect? {
        guard let origin = point(of: element), let value: AXValue = attribute(element, kAXSizeAttribute) else {
            return nil
        }
        var size = CGSize.zero
        guard AXValueGetValue(value, .cgSize, &size) else { return nil }
        return CGRect(origin: origin, size: size)
    }

    private func attribute<T>(_ element: AXUIElement, _ name: String) -> T? {
        var value: CFTypeRef?
        guard AXUIElementCopyAttributeValue(element, name as CFString, &value) == .success else { return nil }
        return value as? T
    }
}

/// US-layout virtual key codes for the keys `KeyCombo` allows.
enum KeyCodes {
    static func virtualKey(for key: String) -> CGKeyCode? {
        if let named = named[key] { return CGKeyCode(named) }
        guard key.count == 1, let character = key.lowercased().first, let code = characters[character] else {
            return nil
        }
        return CGKeyCode(code)
    }

    private static let named: [String: Int] = [
        "return": kVK_Return, "tab": kVK_Tab, "space": kVK_Space, "delete": kVK_Delete,
        "escape": kVK_Escape, "left": kVK_LeftArrow, "right": kVK_RightArrow, "up": kVK_UpArrow,
        "down": kVK_DownArrow, "home": kVK_Home, "end": kVK_End, "pageUp": kVK_PageUp, "pageDown": kVK_PageDown,
    ]

    private static let characters: [Character: Int] = [
        "a": kVK_ANSI_A, "b": kVK_ANSI_B, "c": kVK_ANSI_C, "d": kVK_ANSI_D, "e": kVK_ANSI_E,
        "f": kVK_ANSI_F, "g": kVK_ANSI_G, "h": kVK_ANSI_H, "i": kVK_ANSI_I, "j": kVK_ANSI_J,
        "k": kVK_ANSI_K, "l": kVK_ANSI_L, "m": kVK_ANSI_M, "n": kVK_ANSI_N, "o": kVK_ANSI_O,
        "p": kVK_ANSI_P, "q": kVK_ANSI_Q, "r": kVK_ANSI_R, "s": kVK_ANSI_S, "t": kVK_ANSI_T,
        "u": kVK_ANSI_U, "v": kVK_ANSI_V, "w": kVK_ANSI_W, "x": kVK_ANSI_X, "y": kVK_ANSI_Y,
        "z": kVK_ANSI_Z, "0": kVK_ANSI_0, "1": kVK_ANSI_1, "2": kVK_ANSI_2, "3": kVK_ANSI_3,
        "4": kVK_ANSI_4, "5": kVK_ANSI_5, "6": kVK_ANSI_6, "7": kVK_ANSI_7, "8": kVK_ANSI_8,
        "9": kVK_ANSI_9, ",": kVK_ANSI_Comma, ".": kVK_ANSI_Period, "/": kVK_ANSI_Slash,
        ";": kVK_ANSI_Semicolon, "'": kVK_ANSI_Quote, "[": kVK_ANSI_LeftBracket,
        "]": kVK_ANSI_RightBracket, "-": kVK_ANSI_Minus, "=": kVK_ANSI_Equal, "`": kVK_ANSI_Grave,
        "\\": kVK_ANSI_Backslash,
    ]
}
