import Foundation

/// Mac-side validation of backend actions, applied before any side effect. The backend
/// validates too; this is the device's own independent check.
public enum MacActionPolicy {
    public enum Rejection: Error, Sendable, Equatable {
        case unsupported(String)
        case outOfBounds
        case invalidText
        case invalidKeys
        case invalidURL
        case invalidAppName
        case invalidAmount
    }

    public static let modifierNames: [String: String] = [
        "cmd": "command", "command": "command", "meta": "command", "super": "command",
        "ctrl": "control", "control": "control",
        "alt": "option", "option": "option", "opt": "option",
        "shift": "shift",
    ]

    public static let namedKeys: Set<String> = [
        "return", "enter", "tab", "space", "escape", "esc", "backspace", "delete", "forwardDelete",
        "up", "down", "left", "right", "home", "end", "pageUp", "pageDown",
        "f1", "f2", "f3", "f4", "f5", "f6", "f7", "f8", "f9", "f10", "f11", "f12",
    ]

    /// A parsed key combination: normalized modifiers plus exactly one key.
    public struct KeyChord: Sendable, Equatable {
        public var modifiers: [String]
        public var key: String
    }

    public static func parseKeys(_ keys: String) -> KeyChord? {
        let parts = keys.split(separator: "+", omittingEmptySubsequences: false).map(String.init)
        // "cmd++" means command and the plus key.
        var tokens = parts
        if keys.hasSuffix("++") {
            tokens = Array(parts.dropLast(2)) + ["+"]
        }
        guard let rawKey = tokens.last, !rawKey.isEmpty else { return nil }
        var modifiers: [String] = []
        for token in tokens.dropLast() {
            guard let name = modifierNames[token.lowercased()], !modifiers.contains(name) else { return nil }
            modifiers.append(name)
        }
        let key: String
        if let named = namedKeys.first(where: { $0.lowercased() == rawKey.lowercased() }) {
            key = named
        } else if rawKey.count == 1, let scalar = rawKey.unicodeScalars.first,
            !CharacterSet.controlCharacters.contains(scalar)
        {
            key = rawKey.lowercased()
        } else {
            return nil
        }
        return KeyChord(modifiers: modifiers, key: key)
    }

    /// Checks one action against the screenshot it refers to.
    public static func validate(
        _ action: MacAction, screenshotWidth: Int, screenshotHeight: Int
    ) -> Rejection? {
        func inBounds(_ x: Int, _ y: Int) -> Bool {
            x >= 0 && y >= 0 && x < screenshotWidth && y < screenshotHeight
        }
        func validModifiers(_ mods: [String]) -> Bool {
            mods.allSatisfy { modifierNames[$0.lowercased()] != nil }
        }
        switch action {
        case .screenshot:
            return nil
        case .click(let x, let y, _, let clicks, let mods):
            guard (1...3).contains(clicks), validModifiers(mods) else { return .invalidAmount }
            return inBounds(x, y) ? nil : .outOfBounds
        case .mouseMove(let x, let y):
            return inBounds(x, y) ? nil : .outOfBounds
        case .drag(let fx, let fy, let tx, let ty, let mods):
            guard validModifiers(mods) else { return .invalidKeys }
            return inBounds(fx, fy) && inBounds(tx, ty) ? nil : .outOfBounds
        case .scroll(let x, let y, _, let amount, let mods):
            guard (1...50).contains(amount), validModifiers(mods) else { return .invalidAmount }
            if let x, let y, !inBounds(x, y) { return .outOfBounds }
            if (x == nil) != (y == nil) { return .outOfBounds }
            return nil
        case .type(let text):
            guard (1...2_000).contains(text.count) else { return .invalidText }
            let forbidden = text.unicodeScalars.contains { scalar in
                (scalar.value < 0x20 && scalar != "\n" && scalar != "\t") || scalar.value == 0x7F
            }
            return forbidden ? .invalidText : nil
        case .key(let keys, let count):
            guard (1...100).contains(count) else { return .invalidAmount }
            return parseKeys(keys) == nil ? .invalidKeys : nil
        case .wait(let seconds):
            return seconds >= 0 && seconds <= 10 ? nil : .invalidAmount
        case .openApp(let name):
            let allowed = CharacterSet.letters.union(.decimalDigits).union(CharacterSet(charactersIn: " .&'()+-"))
            guard (1...80).contains(name.count), name.unicodeScalars.allSatisfy(allowed.contains),
                !name.contains("..")
            else { return .invalidAppName }
            return nil
        case .openUrl(let url):
            guard let scheme = url.scheme?.lowercased(), scheme == "http" || scheme == "https",
                let host = url.host(), !host.isEmpty, url.absoluteString.count <= 2_048
            else { return .invalidURL }
            return nil
        case .unsupported(let type):
            return .unsupported(type)
        }
    }

    public static func message(for rejection: Rejection) -> String {
        switch rejection {
        case .unsupported(let type): "Spectr does not support the action \"\(type)\"."
        case .outOfBounds: "The target is outside the shared screen."
        case .invalidText: "The text to type is empty, too long or has control characters."
        case .invalidKeys: "The key combination is not recognized."
        case .invalidURL: "Only http and https links can be opened."
        case .invalidAppName: "The app name is not valid."
        case .invalidAmount: "The action's count or amount is out of range."
        }
    }
}

/// Remembers which step batches this Mac already executed, so a retried step request
/// that returns the same batch never repeats its side effects. Persist it across
/// relaunches.
public struct StepLedger: Codable, Sendable, Equatable {
    public struct Entry: Codable, Sendable, Equatable {
        public var results: [MacActionResult]
        public var completed: Bool
    }

    /// Keyed by "taskId#step".
    public private(set) var entries: [String: Entry] = [:]
    public let capacity: Int

    public init(capacity: Int = 100) {
        self.capacity = capacity
    }

    private static func key(_ taskId: String, _ step: Int) -> String { "\(taskId)#\(step)" }

    public enum Decision: Sendable, Equatable {
        /// Never seen: run it.
        case execute
        /// Already fully run: send these results again, do nothing else.
        case replay([MacActionResult])
        /// Started but interrupted (crash): do not run again; report what finished.
        case interrupted([MacActionResult])
    }

    public func decide(taskId: String, step: Int) -> Decision {
        guard let entry = entries[Self.key(taskId, step)] else { return .execute }
        return entry.completed ? .replay(entry.results) : .interrupted(entry.results)
    }

    public mutating func begin(taskId: String, step: Int) {
        entries[Self.key(taskId, step)] = Entry(results: [], completed: false)
        prune(keeping: Self.key(taskId, step))
    }

    public mutating func record(_ result: MacActionResult, taskId: String, step: Int) {
        entries[Self.key(taskId, step)]?.results.append(result)
    }

    public mutating func complete(taskId: String, step: Int) {
        entries[Self.key(taskId, step)]?.completed = true
    }

    public mutating func removeAll() {
        entries.removeAll()
    }

    private mutating func prune(keeping key: String) {
        guard entries.count > capacity else { return }
        for old in entries.keys.sorted().filter({ $0 != key }).prefix(entries.count - capacity) {
            entries.removeValue(forKey: old)
        }
    }
}
