import Foundation
import SpectrKit

/// The only way Spectr touches the desktop. One production implementation
/// (`AccessibilityDesktopDriver`); tests substitute a fake.
@MainActor
protocol DesktopDriver: Sendable {
    var isAccessibilityTrusted: Bool { get }
    var isScreenLocked: Bool { get }
    var frontmostBundleId: String? { get }

    /// Reads current state. With `includeElements`, also enumerates targetable elements
    /// and resets the element IDs used by `Target.element`.
    func observe(includeElements: Bool) -> ObservedState
    /// Whether the target (or the focused element when nil) is a secure text field.
    func isSecureField(_ target: Target?) -> Bool

    func openApp(bundleId: String) async throws(DriverError)
    func click(_ target: Target) throws(DriverError)
    func typeText(_ text: String, into target: Target?) throws(DriverError)
    func keyCombo(_ combo: KeyCombo) throws(DriverError)
    func scroll(dx: Int, dy: Int, target: Target?) throws(DriverError)
    /// Lets the UI settle before readback.
    func settle() async
}

enum DriverError: Error, Equatable {
    case appNotFound
    case elementNotFound
    case unsupportedKey
    case eventFailed

    var code: CommandErrorCode {
        switch self {
        case .appNotFound: .appNotFound
        case .elementNotFound: .elementNotFound
        case .unsupportedKey: .invalidAction
        case .eventFailed: .readbackFailed
        }
    }
}

/// Apps Spectr must never operate. Typing into a terminal or script editor would be
/// arbitrary code execution; password managers and Keychain hold credentials.
struct AppPolicy: Sendable {
    var blockedBundleIds: Set<String>
    var blockedPrefixes: [String]

    static let standard = AppPolicy(
        blockedBundleIds: [
            "com.apple.Terminal",
            "com.googlecode.iterm2",
            "dev.warp.Warp-Stable",
            "com.mitchellh.ghostty",
            "net.kovidgoyal.kitty",
            "io.alacritty",
            "com.apple.ScriptEditor2",
            "com.apple.Automator",
            "com.apple.shortcuts",
            "com.apple.keychainaccess",
            "com.apple.Passwords",
            "com.bitwarden.desktop",
        ],
        blockedPrefixes: ["com.1password.", "com.agilebits.", "com.lastpass."]
    )

    func isBlocked(_ bundleId: String?) -> Bool {
        guard let bundleId else { return false }
        return blockedBundleIds.contains(bundleId) || blockedPrefixes.contains { bundleId.hasPrefix($0) }
    }
}
