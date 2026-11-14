import AppKit
import SwiftUI
import Testing

@testable import SpectrMac

/// Renders both surfaces from sample state to PNG files for review. Set
/// `TEST_RUNNER_SPECTR_SNAPSHOT_DIR` when invoking xcodebuild to choose the folder.
@MainActor
@Suite("Rendered states")
struct SnapshotTests {
    private static let directory: URL = {
        let path = ProcessInfo.processInfo.environment["SPECTR_SNAPSHOT_DIR"]
        let url =
            path.map { URL(fileURLWithPath: $0) }
            ?? FileManager.default.temporaryDirectory.appending(path: "spectr-snapshots")
        try? FileManager.default.createDirectory(at: url, withIntermediateDirectories: true)
        return url
    }()

    private func render(_ view: some View, name: String, dark: Bool) throws {
        let appearance = NSAppearance(named: dark ? .darkAqua : .aqua)
        let host = NSHostingView(
            rootView: view.tint(Theme.accent).background(Color(nsColor: .windowBackgroundColor)))
        host.appearance = appearance
        let window = NSWindow(
            contentRect: NSRect(origin: .zero, size: host.fittingSize), styleMask: [.borderless],
            backing: .buffered, defer: false)
        window.appearance = appearance
        window.contentView = host
        host.layoutSubtreeIfNeeded()
        let rep = try #require(host.bitmapImageRepForCachingDisplay(in: host.bounds))
        host.cacheDisplay(in: host.bounds, to: rep)
        let data = try #require(rep.representation(using: .png, properties: [:]))
        try data.write(to: Self.directory.appending(path: "\(name)-\(dark ? "dark" : "light").png"))
        #expect(host.fittingSize.height > 40)
    }

    @Test(arguments: [false, true])
    func popoverStates(dark: Bool) throws {
        let none = HelperActions()
        try render(PopoverView(state: .firstLaunch, actions: none), name: "popover-1-first-launch", dark: dark)
        try render(PopoverView(state: .idle, actions: none), name: "popover-2-idle", dark: dark)
        try render(PopoverView(state: .active(), actions: none), name: "popover-3-active", dark: dark)
        try render(
            PopoverView(state: .active(.done, observed: "Keynote — EmoryHacks Demo"), actions: none),
            name: "popover-4-done", dark: dark)
        try render(PopoverView(state: .screenDenied, actions: none), name: "popover-5-screen-denied", dark: dark)
        try render(
            PopoverView(state: .controlDeniedWhileSharing, actions: none), name: "popover-6-control-denied", dark: dark)
        try render(PopoverView(state: .windowClosed, actions: none), name: "popover-7-window-closed", dark: dark)
        try render(PopoverView(state: .longNames, actions: none), name: "popover-8-long-names", dark: dark)
    }

    @Test(arguments: [false, true])
    func setupStates(dark: Bool) throws {
        let none = HelperActions()
        try render(SetupView(state: .firstLaunch, actions: none), name: "setup-1-first-launch", dark: dark)
        try render(SetupView(state: .screenDenied, actions: none), name: "setup-2-screen-denied", dark: dark)
        try render(SetupView(state: .controlDeniedWhileSharing, actions: none), name: "setup-3-control", dark: dark)
        try render(SetupView(state: .windowClosed, actions: none), name: "setup-4-window-closed", dark: dark)
        try render(SetupView(state: .active(), actions: none), name: "setup-5-all-set", dark: dark)
    }

    /// The layout must not move when "Working…" becomes "Done".
    @Test func taskSectionHeightIsStableAcrossPhases() {
        let working = NSHostingView(rootView: PopoverView(state: .active(), actions: HelperActions()))
        let done = NSHostingView(
            rootView: PopoverView(
                state: .active(.done, observed: "Keynote — EmoryHacks Demo"), actions: HelperActions()))
        #expect(working.fittingSize == done.fittingSize)
    }
}
