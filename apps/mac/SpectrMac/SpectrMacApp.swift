import AppKit
import SpectrKit
import SwiftUI

@main
struct SpectrMacApp: App {
    @NSApplicationDelegateAdaptor(AppDelegate.self) private var delegate

    var body: some Scene {
        MenuBarExtra {
            LivePopover(environment: delegate.environment, actions: delegate.actions)
                .tint(Theme.accent)
        } label: {
            MenuBarLabel(indicator: delegate.environment.state().indicator)
        }
        .menuBarExtraStyle(.window)
    }
}

/// Binds the popover to live state. Ticks once a second so stream health stays current.
private struct LivePopover: View {
    let environment: MacEnvironment
    let actions: HelperActions

    var body: some View {
        TimelineView(.periodic(from: .now, by: 1)) { context in
            PopoverView(
                state: environment.state(at: context.date),
                preview: environment.capture.preview,
                actions: actions
            )
        }
        .onAppear { environment.refreshPermissions() }
    }
}

/// Binds the setup window to live state and rechecks permissions while it is open,
/// because macOS does not notify apps when a privacy switch changes.
private struct LiveSetup: View {
    let environment: MacEnvironment
    let actions: HelperActions

    var body: some View {
        TimelineView(.periodic(from: .now, by: 1.5)) { context in
            SetupView(state: environment.state(at: context.date), actions: actions)
                .onChange(of: context.date) { environment.refreshPermissions() }
        }
        .tint(Theme.accent)
    }
}

/// Owns the live environment and the helper's ordinary windows.
@MainActor
final class AppDelegate: NSObject, NSApplicationDelegate {
    let environment = MacEnvironment.live()
    private var setupWindow: NSWindow?
    private var labWindow: NSWindow?

    private var isUnderTest: Bool {
        ProcessInfo.processInfo.environment["XCTestConfigurationFilePath"] != nil
    }

    var actions: HelperActions {
        var actions = HelperActions(
            openSetup: { [weak self] in self?.showSetup() },
            chooseWindow: { [environment] in environment.capture.chooseSource() },
            stopSharing: { [environment] in environment.capture.stopSharing() },
            stopTask: { [environment] in environment.stopTask() },
            startPairing: { [environment] in environment.pairing.start() },
            requestScreenRecording: { [environment] in environment.requestScreenRecording() },
            requestAccessibility: { [environment] in environment.requestAccessibility() },
            relaunch: { [environment] in environment.relaunch() },
            unpair: { [environment] in environment.unpair() },
            quit: { NSApplication.shared.terminate(nil) }
        )
        #if DEBUG
            actions.openLab = { [weak self] in self?.showLab() }
            actions.useLabDevice = { [environment] in environment.pairing.useLabDevice() }
        #endif
        return actions
    }

    func applicationDidFinishLaunching(_ notification: Notification) {
        guard !isUnderTest else { return }
        // Stay quiet once set up; only a first run or a broken permission opens a window.
        if !environment.state().isSetUp { showSetup() }
        #if DEBUG
            // `-SpectrRequestScreenRecording YES` on the command line asks straight away.
            if UserDefaults.standard.bool(forKey: "SpectrRequestScreenRecording") {
                environment.requestScreenRecording()
            }
        #endif
    }

    /// Opening Spectr while it is already running brings setup forward instead of
    /// doing nothing.
    func applicationShouldHandleReopen(_ sender: NSApplication, hasVisibleWindows: Bool) -> Bool {
        showSetup()
        return false
    }

    func applicationDidBecomeActive(_ notification: Notification) {
        environment.refreshPermissions()
    }

    func showSetup() {
        if setupWindow == nil {
            setupWindow = makeWindow(
                title: "Spectr Setup", autosaveName: "SpectrSetup",
                content: LiveSetup(environment: environment, actions: actions))
        }
        if environment.pairing.state == .unpaired { environment.pairing.start() }
        present(setupWindow)
    }

    private func showLab() {
        #if DEBUG
            if labWindow == nil {
                labWindow = makeWindow(
                    title: "Action Lab (Debug)", autosaveName: "SpectrLab", content: ActionLabView(lab: environment.lab)
                )
            }
            present(labWindow)
        #endif
    }

    private func makeWindow(title: String, autosaveName: String, content: some View) -> NSWindow {
        let window = NSWindow(contentViewController: NSHostingController(rootView: content))
        window.title = title
        window.styleMask = [.titled, .closable, .miniaturizable]
        window.isReleasedWhenClosed = false
        window.center()
        window.setFrameAutosaveName(autosaveName)
        return window
    }

    private func present(_ window: NSWindow?) {
        NSApplication.shared.activate()
        window?.makeKeyAndOrderFront(nil)
    }
}
