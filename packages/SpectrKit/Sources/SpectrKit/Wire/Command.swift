import Foundation

/// A command delivered to one paired Mac. Envelope matches the backend `CommandSchema`.
public struct Command: Codable, Sendable, Equatable {
    public var commandId: String
    public var taskId: String
    public var deviceId: String
    public var revision: Int
    public var action: Action
    public var issuedAt: Date

    public init(
        commandId: String,
        taskId: String,
        deviceId: String,
        revision: Int,
        action: Action,
        issuedAt: Date
    ) {
        self.commandId = commandId
        self.taskId = taskId
        self.deviceId = deviceId
        self.revision = revision
        self.action = action
        self.issuedAt = issuedAt
    }
}

/// Why the Mac refused or could not complete a command.
public enum CommandErrorCode: String, Codable, Sendable {
    case unsupportedAction
    case invalidAction
    case wrongDevice
    case staleRevision
    case duplicateConflict
    case accessibilityDenied
    case screenCaptureDenied
    case desktopLocked
    case appNotFound
    case appBlocked
    case elementNotFound
    case secureField
    case windowGone
    case deviceRevoked
    case stopped
    case readbackFailed
}

/// Checks that a command is well-formed for this device before any side effect.
public enum CommandValidator {
    public static let maxTextLength = 2_000
    public static let maxScrollLines = 50

    public static func validate(_ command: Command, forDevice deviceId: String) -> CommandErrorCode? {
        guard command.deviceId == deviceId else { return .wrongDevice }
        guard command.revision >= 1 else { return .invalidAction }
        switch command.action {
        case .observe, .stop:
            return nil
        case .unsupported:
            return .unsupportedAction
        case .openApp(let bundleId):
            return isPlausibleBundleId(bundleId) ? nil : .invalidAction
        case .click(let target):
            return isValid(target) ? nil : .invalidAction
        case .typeText(let text, let target):
            guard !text.isEmpty, text.count <= maxTextLength else { return .invalidAction }
            if let target, !isValid(target) { return .invalidAction }
            return nil
        case .keyCombo(let combo):
            return isValid(combo) ? nil : .invalidAction
        case .scroll(let dx, let dy, let target):
            guard abs(dx) <= maxScrollLines, abs(dy) <= maxScrollLines, dx != 0 || dy != 0 else {
                return .invalidAction
            }
            if let target, !isValid(target) { return .invalidAction }
            return nil
        }
    }

    static func isPlausibleBundleId(_ value: String) -> Bool {
        let parts = value.split(separator: ".", omittingEmptySubsequences: false)
        guard parts.count >= 2, value.count <= 255 else { return false }
        return parts.allSatisfy { part in
            !part.isEmpty && part.allSatisfy { $0.isLetter || $0.isNumber || $0 == "-" }
        }
    }

    static func isValid(_ target: Target) -> Bool {
        switch target {
        case .element(let id):
            !id.isEmpty && id.count <= 128
        case .point(let x, let y):
            x.isFinite && y.isFinite && x >= 0 && y >= 0
        }
    }

    static func isValid(_ combo: KeyCombo) -> Bool {
        guard Set(combo.modifiers).count == combo.modifiers.count else { return false }
        if KeyCombo.namedKeys.contains(combo.key) { return true }
        return combo.key.count == 1
    }
}
