import Foundation

/// A single typed step the Mac may execute.
///
/// PROVISIONAL native proposal for general control. The planner (Sweeya) decides which
/// action to send; the Mac only validates and executes this closed vocabulary. There is
/// deliberately no shell, script or free-form command case.
public enum Action: Sendable, Equatable {
    case observe
    case openApp(bundleId: String)
    case click(target: Target)
    case typeText(text: String, target: Target?)
    case keyCombo(KeyCombo)
    case scroll(dx: Int, dy: Int, target: Target?)
    case stop
    /// An action type this build does not know. Decoded so the Mac can reject it with a
    /// typed error instead of failing to parse the whole command.
    case unsupported(type: String)

    public var typeName: String {
        switch self {
        case .observe: "observe"
        case .openApp: "openApp"
        case .click: "click"
        case .typeText: "typeText"
        case .keyCombo: "keyCombo"
        case .scroll: "scroll"
        case .stop: "stop"
        case .unsupported(let type): type
        }
    }
}

/// Where an action lands. Element IDs come from the Mac's most recent observation.
public enum Target: Sendable, Equatable, Codable {
    case element(id: String)
    /// A point in the shared window's coordinate space, in points from the top-left.
    case point(x: Double, y: Double)

    private enum CodingKeys: String, CodingKey { case elementId, x, y }

    public init(from decoder: any Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        if let id = try container.decodeIfPresent(String.self, forKey: .elementId) {
            self = .element(id: id)
        } else {
            self = .point(
                x: try container.decode(Double.self, forKey: .x),
                y: try container.decode(Double.self, forKey: .y)
            )
        }
    }

    public func encode(to encoder: any Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        switch self {
        case .element(let id):
            try container.encode(id, forKey: .elementId)
        case .point(let x, let y):
            try container.encode(x, forKey: .x)
            try container.encode(y, forKey: .y)
        }
    }
}

/// A keyboard shortcut: zero or more modifiers plus exactly one key.
public struct KeyCombo: Sendable, Equatable, Codable {
    public enum Modifier: String, Sendable, Codable, CaseIterable {
        case command, shift, option, control
    }

    public var modifiers: [Modifier]
    /// A single printable character or a named key from `KeyCombo.namedKeys`.
    public var key: String

    public init(modifiers: [Modifier], key: String) {
        self.modifiers = modifiers
        self.key = key
    }

    public static let namedKeys: Set<String> = [
        "return", "tab", "space", "delete", "escape",
        "left", "right", "up", "down", "home", "end", "pageUp", "pageDown",
    ]
}

extension Action: Codable {
    private enum CodingKeys: String, CodingKey {
        case type, bundleId, target, text, combo, dx, dy
    }

    public init(from decoder: any Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        let type = try container.decode(String.self, forKey: .type)
        switch type {
        case "observe":
            self = .observe
        case "openApp":
            self = .openApp(bundleId: try container.decode(String.self, forKey: .bundleId))
        case "click":
            self = .click(target: try container.decode(Target.self, forKey: .target))
        case "typeText":
            self = .typeText(
                text: try container.decode(String.self, forKey: .text),
                target: try container.decodeIfPresent(Target.self, forKey: .target)
            )
        case "keyCombo":
            self = .keyCombo(try container.decode(KeyCombo.self, forKey: .combo))
        case "scroll":
            self = .scroll(
                dx: try container.decode(Int.self, forKey: .dx),
                dy: try container.decode(Int.self, forKey: .dy),
                target: try container.decodeIfPresent(Target.self, forKey: .target)
            )
        case "stop":
            self = .stop
        default:
            self = .unsupported(type: type)
        }
    }

    public func encode(to encoder: any Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(typeName, forKey: .type)
        switch self {
        case .observe, .stop, .unsupported:
            break
        case .openApp(let bundleId):
            try container.encode(bundleId, forKey: .bundleId)
        case .click(let target):
            try container.encode(target, forKey: .target)
        case .typeText(let text, let target):
            try container.encode(text, forKey: .text)
            try container.encodeIfPresent(target, forKey: .target)
        case .keyCombo(let combo):
            try container.encode(combo, forKey: .combo)
        case .scroll(let dx, let dy, let target):
            try container.encode(dx, forKey: .dx)
            try container.encode(dy, forKey: .dy)
            try container.encodeIfPresent(target, forKey: .target)
        }
    }
}
