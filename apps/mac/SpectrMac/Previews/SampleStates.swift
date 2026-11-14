#if DEBUG
    import SpectrKit
    import SwiftUI

    /// Sample data for previews and rendering tests only. Nothing here reaches Release,
    /// and none of these names or events come from a real session.
    extension HelperState {
        static let allowed = PermissionSnapshot(screenCapture: true, accessibility: true)
        static let samplePhone = PairingState.paired(PairedPhone(deviceId: "dev_sample", phoneName: "Jared’s iPhone"))
        static let sampleWindow = ShareSource(kind: .window, appName: "Keynote", title: "EmoryHacks Demo")

        static let firstLaunch = HelperState(
            pairing: .unpaired,
            permissions: PermissionSnapshot(screenCapture: false, accessibility: false))

        static let idle = HelperState(pairing: samplePhone, phone: .connected, permissions: allowed)

        static let idlePresenceUnknown = HelperState(
            pairing: .paired(PairedPhone(deviceId: "dev_sample", phoneName: nil)), permissions: allowed)

        static func active(_ phase: TaskActivity.Phase = .working, observed: String? = nil) -> HelperState {
            HelperState(
                pairing: samplePhone, phone: .connected, permissions: allowed,
                share: .live(sampleWindow, .live),
                activity: TaskActivity(
                    taskId: "tsk_sample", revision: 2, instruction: "Go to slide five", phase: phase,
                    observed: observed),
                canStopTask: phase == .working)
        }

        static let screenDenied = HelperState(
            pairing: samplePhone, phone: .connected,
            permissions: PermissionSnapshot(screenCapture: false, accessibility: true))

        static let controlDeniedWhileSharing = HelperState(
            pairing: samplePhone, phone: .connected,
            permissions: PermissionSnapshot(screenCapture: true, accessibility: false),
            share: .live(sampleWindow, .live))

        static let windowClosed = HelperState(
            pairing: samplePhone, phone: .connected, permissions: allowed,
            share: .ended(.windowClosed(sampleWindow)))

        static let longNames = HelperState(
            pairing: .paired(
                PairedPhone(deviceId: "dev_sample", phoneName: "Jared Beresford’s iPhone 17 Pro Max (Work)")),
            phone: .away, permissions: allowed,
            share: .live(
                ShareSource(
                    kind: .window, appName: "Google Chrome",
                    title: "EmoryHacks 2026 — Final Judging Schedule and Demo Table Assignments - Google Sheets"),
                .liveStatic))
    }

    #Preview("Popover · idle") { PopoverView(state: .idle, actions: HelperActions()) }
    #Preview("Popover · idle, presence unknown") {
        PopoverView(state: .idlePresenceUnknown, actions: HelperActions())
    }
    #Preview("Popover · active") { PopoverView(state: .active(), actions: HelperActions()) }
    #Preview("Popover · done") {
        PopoverView(state: .active(.done, observed: "Keynote — EmoryHacks Demo"), actions: HelperActions())
    }
    #Preview("Popover · screen recording off") { PopoverView(state: .screenDenied, actions: HelperActions()) }
    #Preview("Popover · control off, sharing") {
        PopoverView(state: .controlDeniedWhileSharing, actions: HelperActions())
    }
    #Preview("Popover · window closed") { PopoverView(state: .windowClosed, actions: HelperActions()) }
    #Preview("Popover · long names") { PopoverView(state: .longNames, actions: HelperActions()) }
    #Preview("Popover · not paired") { PopoverView(state: .firstLaunch, actions: HelperActions()) }

    #Preview("Setup · first launch") { SetupView(state: .firstLaunch, actions: HelperActions()) }
    #Preview("Setup · screen recording off") { SetupView(state: .screenDenied, actions: HelperActions()) }
    #Preview("Setup · control off") { SetupView(state: .controlDeniedWhileSharing, actions: HelperActions()) }
    #Preview("Setup · window closed") { SetupView(state: .windowClosed, actions: HelperActions()) }
    #Preview("Setup · all set") { SetupView(state: .active(), actions: HelperActions()) }
#endif
