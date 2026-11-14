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
    let capture: CaptureController
    let driver: AccessibilityDesktopDriver
    #if DEBUG
        let lab: ActionLab
    #endif
    private(set) var permissions: PermissionSnapshot

    init(startup: Startup, permissions: PermissionSnapshot) {
        self.startup = startup
        self.permissions = permissions
        self.capture = CaptureController()
        self.driver = AccessibilityDesktopDriver()
        #if DEBUG
            self.lab = ActionLab(driver: driver)
        #endif
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

    /// Shows the system Accessibility prompt once and opens the matching Settings pane.
    func requestAccessibility() {
        // "AXTrustedCheckOptionPrompt" is the documented value of kAXTrustedCheckOptionPrompt.
        let options = ["AXTrustedCheckOptionPrompt": true] as CFDictionary
        if !AXIsProcessTrustedWithOptions(options),
            let url = URL(string: "x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility")
        {
            NSWorkspace.shared.open(url)
        }
    }
}

/// macOS privacy permissions Spectr depends on. Reading them never shows a prompt.
struct PermissionSnapshot: Equatable {
    var accessibility: Bool

    static func current() -> PermissionSnapshot {
        PermissionSnapshot(accessibility: AXIsProcessTrusted())
    }
}

#if DEBUG
    /// Debug-only bench for running typed actions locally against real apps.
    /// Uses an in-memory ledger and a local device ID; never compiled into Release.
    @MainActor
    @Observable
    final class ActionLab {
        private let executor: ActionExecutor
        private var revision = 0
        private(set) var lastResult: DeviceResult?
        private(set) var isRunning = false

        init(driver: AccessibilityDesktopDriver) {
            executor = ActionExecutor(deviceId: "dev_local_lab", driver: driver, store: MemoryLedgerStore())
        }

        func run(_ action: Action) {
            revision += 1
            let command = Command(
                commandId: "lab_\(UUID().uuidString.prefix(8))",
                taskId: "tsk_local_lab",
                deviceId: "dev_local_lab",
                revision: revision,
                action: action,
                issuedAt: Date()
            )
            isRunning = true
            Task {
                let result = await executor.handle(command)
                lastResult = result
                isRunning = false
            }
        }
    }
#endif
