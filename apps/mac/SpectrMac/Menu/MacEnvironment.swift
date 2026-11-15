import AppKit
import ApplicationServices
import CoreGraphics
import Foundation
import Observation
import ScreenCaptureKit
import SpectrKit

/// Composition root for the Mac helper. Owns the live objects and derives the single
/// `HelperState` value both surfaces render.
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
    let pairing: PairingController
    /// The task runner whose activity the popover shows. Only the Debug action lab
    /// provides one until the backend command loop exists.
    private(set) var taskSession: TaskSession?
    /// Runs backend tasks while this Mac is connected with a device token.
    private(set) var agent: MacAgentLoop?
    /// Streams the shared screen to LiveKit while sharing and connected.
    let publisher: ScreenPublisher
    #if DEBUG
        let lab: ActionLab
    #endif
    private(set) var permissions: PermissionSnapshot
    /// No source reports iPhone presence yet, so this stays `unknown`.
    private(set) var phone: PhonePresence = .unknown

    init(startup: Startup, permissions: PermissionSnapshot, credentials: any DeviceCredentialStore) {
        self.startup = startup
        self.permissions = permissions
        self.capture = CaptureController()
        self.publisher = ScreenPublisher(sink: capture.frameSink)
        self.driver = AccessibilityDesktopDriver()
        let client: any PairingClient =
            if case .ready(let configuration) = startup {
                HTTPPairingClient(origin: configuration.apiOrigin)
            } else {
                UnavailablePairingClient()
            }
        self.pairing = PairingController(client: client, credentials: credentials)
        #if DEBUG
            var agent: (any AgentClient)?
            if case .ready(let configuration) = startup, configuration.environment == .development {
                agent = HTTPAgentClient(origin: configuration.apiOrigin)
            }
            let lab = ActionLab(driver: driver, agent: agent)
            self.lab = lab
            self.taskSession = lab.session
        #endif
        pairing.onChange = { [weak self] _ in
            self?.syncAgent()
            self?.syncPublisher()
        }
        // The backend's LiveKit nudge ends the agent loop's idle wait.
        publisher.onWake = { [weak self] in self?.agent?.wake() }
        capture.onStatusChange = { [weak self] status in
            // macOS's own "Stop Sharing" counts as the owner stopping.
            if status == .stopped(.userStopped) { self?.sharingPausedByUser = true }
            self?.syncPublisher()
        }
        syncAgent()
    }

    // MARK: Always-on sharing

    private let keepAwakeAssertion = KeepAwake()
    private var supervisor: Task<Void, Never>?
    /// The owner stopped sharing in this session; don't restart it behind their back.
    private(set) var sharingPausedByUser = false

    /// Share the whole screen automatically whenever possible, so the Mac can be watched
    /// from anywhere without anyone at it.
    var alwaysShareScreen: Bool = UserDefaults.standard.object(forKey: "SpectrAlwaysShareScreen") as? Bool ?? true {
        didSet {
            UserDefaults.standard.set(alwaysShareScreen, forKey: "SpectrAlwaysShareScreen")
            superviseSharing()
        }
    }

    /// Keep the display awake while this Mac is connected.
    var keepAwake: Bool = UserDefaults.standard.object(forKey: "SpectrKeepAwake") as? Bool ?? true {
        didSet {
            UserDefaults.standard.set(keepAwake, forKey: "SpectrKeepAwake")
            superviseSharing()
        }
    }

    /// Starts the background loop that keeps sharing and keep-awake in the wanted state.
    /// Restarts sharing after sleep, a display change, a dropped stream or a newly
    /// granted permission. Not started under tests.
    func startBackgroundWork() {
        guard supervisor == nil else { return }
        let wake = NSWorkspace.shared.notificationCenter
        for name in [
            NSWorkspace.didWakeNotification, NSWorkspace.screensDidWakeNotification,
            NSWorkspace.sessionDidBecomeActiveNotification,
        ] {
            wake.addObserver(forName: name, object: nil, queue: .main) { [weak self] _ in
                MainActor.assumeIsolated { self?.superviseSharing() }
            }
        }
        supervisor = Task { [weak self] in
            while !Task.isCancelled {
                self?.superviseSharing()
                try? await Task.sleep(for: .seconds(4))
            }
        }
    }

    func superviseSharing() {
        keepAwakeAssertion.set(keepAwake && pairing.state.phone != nil)
        guard alwaysShareScreen, !sharingPausedByUser, pairing.state.phone != nil, CGPreflightScreenCaptureAccess()
        else { return }
        switch capture.status {
        case .idle, .stopped(.windowGone), .stopped(.failed), .stopped(.permissionDenied):
            capture.shareEntireScreen()
        case .stopped(.userStopped), .choosing, .starting, .sharing:
            break
        }
    }

    func shareScreen() {
        sharingPausedByUser = false
        capture.shareEntireScreen()
    }

    func chooseWindow() {
        sharingPausedByUser = false
        capture.chooseSource()
    }

    func stopSharingByUser() {
        sharingPausedByUser = true
        capture.stopSharing()
    }

    /// Streams the screen while something is shared and this Mac is connected; stops
    /// otherwise, so nothing is published without both the owner's choice and a token.
    func syncPublisher() {
        guard case .ready(let configuration) = startup, capture.status == .sharing,
            let token = pairing.deviceToken, pairing.state.phone != nil
        else {
            publisher.stop()
            return
        }
        let client = MacAgentClient(origin: configuration.apiOrigin, deviceToken: token)
        publisher.start { () async throws(MacAgentError) -> MacLiveKitGrant in try await client.liveKitGrant() }
    }

    /// Starts the agent loop when this Mac holds a device token and the build has a
    /// server address; stops it otherwise.
    func syncAgent() {
        guard case .ready(let configuration) = startup, let token = pairing.deviceToken,
            pairing.state.phone != nil
        else {
            agent?.stop()
            agent = nil
            return
        }
        guard agent == nil else { return }
        let capture = self.capture
        let loop = MacAgentLoop(
            api: MacAgentClient(origin: configuration.apiOrigin, deviceToken: token),
            frames: { () async throws(AgentFrameError) -> AgentFrame in try await capture.agentFrame() },
            performer: EventActionPerformer(driver: driver),
            store: FileStepLedgerStore.standard() ?? MemoryStepLedgerStore(),
            settle: { max in await capture.waitUntilStable(min: .milliseconds(120), max: max) }
        )
        loop.onUnauthorized = { [weak self] in self?.pairing.tokenRejected() }
        agent = loop
        loop.start()
    }

    static func live(bundle: Bundle = .main) -> MacEnvironment {
        let startup: Startup
        do {
            startup = .ready(try AppConfiguration.load(from: bundle.infoDictionary ?? [:]))
        } catch {
            startup = .misconfigured(error)
        }
        return MacEnvironment(startup: startup, permissions: .current(), credentials: KeychainDeviceCredentialStore())
    }

    /// The whole UI state at `now` (stream health is time-dependent).
    func state(at now: Date = Date()) -> HelperState {
        HelperState(
            configurationError: configurationMessage,
            pairing: pairing.state,
            phone: phone,
            permissions: permissions,
            share: capture.shareState(at: now),
            activity: agent?.activity ?? taskSession?.activity,
            canStopTask: (agent?.activity ?? taskSession?.activity)?.phase == .working,
            agentNotice: agentNotice,
            alwaysShareScreen: alwaysShareScreen,
            keepAwake: keepAwake
        )
    }

    private var agentNotice: String? {
        if case .failed(let message) = publisher.state { return message }
        switch agent?.status {
        case .blocked(let message): return message
        case .unauthorized: return "This Mac's device token was rejected. Connect it again in Setup."
        case .idle, .working, .stopped, nil: return nil
        }
    }

    /// Re-reads permission state without prompting.
    func refreshPermissions() {
        let current = PermissionSnapshot.current()
        if current != permissions { permissions = current }
    }

    /// Asks macOS for Screen Recording and opens the matching Settings pane.
    ///
    /// `CGRequestScreenCaptureAccess` alone does not reliably prompt or list the app, so
    /// this also asks ScreenCaptureKit for shareable content. That call is what makes
    /// macOS show its prompt and add Spectr to the Screen Recording list. Nothing is
    /// captured: the result is discarded.
    func requestScreenRecording() {
        let requested = CGRequestScreenCaptureAccess()
        Self.trace("request: CGRequestScreenCaptureAccess=\(requested) preflight=\(CGPreflightScreenCaptureAccess())")
        Task {
            do {
                let content = try await SCShareableContent.excludingDesktopWindows(false, onScreenWindowsOnly: true)
                Self.trace("shareable content ok: \(content.windows.count) windows")
            } catch {
                Self.trace("shareable content failed: \(error)")
            }
            refreshPermissions()
            Self.trace("after: preflight=\(CGPreflightScreenCaptureAccess()) snapshot=\(permissions.screenCapture)")
            if !permissions.screenCapture { openSettings("Privacy_ScreenCapture") }
        }
    }

    /// Debug builds append permission diagnostics to ~/Library/Logs/Spectr-debug.log.
    private static func trace(_ message: String) {
        #if DEBUG
            let url = FileManager.default.homeDirectoryForCurrentUser.appending(path: "Library/Logs/Spectr-debug.log")
            let line = "\(Date().formatted(.iso8601)) \(message)\n"
            if let handle = try? FileHandle(forWritingTo: url) {
                _ = try? handle.seekToEnd()
                try? handle.write(contentsOf: Data(line.utf8))
                try? handle.close()
            } else {
                try? Data(line.utf8).write(to: url)
            }
        #endif
    }

    /// Shows the system Accessibility prompt once and opens the matching Settings pane.
    func requestAccessibility() {
        // "AXTrustedCheckOptionPrompt" is the documented value of kAXTrustedCheckOptionPrompt.
        let options = ["AXTrustedCheckOptionPrompt": true] as CFDictionary
        if !AXIsProcessTrustedWithOptions(options) {
            openSettings("Privacy_Accessibility")
        }
        refreshPermissions()
    }

    /// Starts a fresh copy of the app and quits this one. macOS applies some privacy
    /// changes only to a newly launched process.
    func relaunch() {
        let configuration = NSWorkspace.OpenConfiguration()
        configuration.createsNewApplicationInstance = true
        NSWorkspace.shared.openApplication(at: Bundle.main.bundleURL, configuration: configuration) { _, _ in
            Task { @MainActor in NSApplication.shared.terminate(nil) }
        }
    }

    func stopTask() {
        if let agent, agent.activity?.phase == .working {
            agent.haltCurrentTask()
            return
        }
        guard let taskSession else { return }
        Task { await taskSession.stopCurrentTask() }
    }

    /// Forgets the pairing. Sharing stops too: nobody is left to share with.
    func unpair() {
        capture.stopSharing()
        taskSession?.clear()
        pairing.unpair()
    }

    private func openSettings(_ anchor: String) {
        if let url = URL(string: "x-apple.systempreferences:com.apple.preference.security?\(anchor)") {
            NSWorkspace.shared.open(url)
        }
    }

    private var configurationMessage: String? {
        guard case .misconfigured(let error) = startup else { return nil }
        switch error {
        case .missing(let key): return "\(key) is not set. See apps/Config/Local.xcconfig.example."
        case .invalidURL(let key): return "\(key) is not a valid URL."
        case .insecureOrigin: return "The API origin must use HTTPS outside local development."
        }
    }
}

extension PermissionSnapshot {
    static func current() -> PermissionSnapshot {
        PermissionSnapshot(
            screenCapture: CGPreflightScreenCaptureAccess() || canReadOtherWindowTitles(),
            accessibility: AXIsProcessTrusted())
    }

    /// A second, non-prompting check. `CGPreflightScreenCaptureAccess` can keep answering
    /// "no" for the life of the process after the user grants access; window titles of
    /// other apps are only readable once Screen Recording is really allowed.
    private static func canReadOtherWindowTitles() -> Bool {
        let own = ProcessInfo.processInfo.processIdentifier
        guard
            let windows = CGWindowListCopyWindowInfo([.optionOnScreenOnly, .excludeDesktopElements], kCGNullWindowID)
                as? [[String: Any]]
        else { return false }
        return windows.contains { window in
            guard let pid = window[kCGWindowOwnerPID as String] as? Int32, pid != own,
                (window[kCGWindowLayer as String] as? Int) == 0,
                // The Dock and Window Server expose titles without any permission.
                let owner = window[kCGWindowOwnerName as String] as? String, owner != "Dock", owner != "Window Server"
            else { return false }
            return window[kCGWindowName as String] is String
        }
    }
}
