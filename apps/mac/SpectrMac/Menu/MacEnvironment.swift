import AppKit
import ApplicationServices
import CoreGraphics
import Foundation
import Observation
import SpectrKit

/// Composition root for the Mac helper.
@MainActor
@Observable
final class MacEnvironment {
    enum Startup: Equatable {
        case ready(AppConfiguration)
        case misconfigured(AppConfiguration.ConfigurationError)
    }

    let startup: Startup
    private(set) var permissions: PermissionSnapshot

    init(startup: Startup, permissions: PermissionSnapshot) {
        self.startup = startup
        self.permissions = permissions
    }

    static func live(bundle: Bundle = .main) -> MacEnvironment {
        let startup: Startup
        do {
            startup = .ready(try AppConfiguration.load(from: bundle.infoDictionary ?? [:]))
        } catch {
            startup = .misconfigured(error)
        }
        return MacEnvironment(startup: startup, permissions: .current())
    }

    /// Re-reads permission state without prompting. Called whenever the menu opens.
    func refreshPermissions() {
        permissions = .current()
    }
}

/// macOS privacy permissions Spectr depends on. Reading them never shows a prompt.
struct PermissionSnapshot: Equatable {
    var screenCapture: Bool
    var accessibility: Bool

    static func current() -> PermissionSnapshot {
        PermissionSnapshot(
            screenCapture: CGPreflightScreenCaptureAccess(),
            accessibility: AXIsProcessTrusted()
        )
    }
}
