import Foundation
import SpectrKit

/// What the user picked in the system sharing picker.
struct ShareSource: Equatable, Sendable {
    enum Kind: Equatable, Sendable {
        case window
        case display
    }

    var kind: Kind
    /// Owning app, when the source is a window.
    var appName: String?
    /// Window title, or a description when the window has none.
    var title: String

    /// One-line description for VoiceOver and compact rows.
    var summary: String {
        if let appName, appName != title { return "\(title), \(appName)" }
        return title
    }
}

/// Capture state as the UI presents it. Derived from `CaptureController`.
enum ShareState: Equatable, Sendable {
    enum EndReason: Equatable, Sendable {
        case windowClosed(ShareSource?)
        case denied
        case failed(String)
    }

    case none
    case choosing
    case starting(ShareSource)
    case live(ShareSource, StreamHealth.State)
    case ended(EndReason)

    /// True only while a capture stream exists.
    var isCapturing: Bool {
        switch self {
        case .starting, .live: true
        case .none, .choosing, .ended: false
        }
    }

    var source: ShareSource? {
        switch self {
        case .starting(let source), .live(let source, _): source
        case .none, .choosing, .ended: nil
        }
    }
}

/// Whether the paired iPhone is reachable right now. `unknown` until something proves
/// it either way; pairing alone is not evidence of a connection.
enum PhonePresence: Equatable, Sendable {
    case unknown
    case connected
    case away
}

struct PairedPhone: Equatable, Sendable {
    var deviceId: String
    /// The iPhone's own name, when the backend supplies it.
    var phoneName: String?
}

enum PairingFailure: Equatable, Sendable {
    case unreachable
    /// The backend did not accept the device token.
    case invalidToken
}

enum PairingState: Equatable, Sendable {
    case unpaired
    /// Checking a device token, or asking the backend for a pairing code.
    case requesting
    /// Showing a code for the owner to enter in the Spectr iPhone app.
    case showingCode(PairingTicket)
    case paired(PairedPhone)
    case failed(PairingFailure)

    var phone: PairedPhone? {
        if case .paired(let phone) = self { return phone }
        return nil
    }
}

/// macOS privacy permissions Spectr depends on. Reading them never shows a prompt.
struct PermissionSnapshot: Equatable, Sendable {
    /// Screen Recording: lets the iPhone see the chosen window.
    var screenCapture: Bool
    /// Accessibility: lets Spectr click, type and read the result back.
    var accessibility: Bool
}

enum SetupStep: Int, CaseIterable, Identifiable, Sendable {
    case pair
    case screenRecording
    case control
    case window

    var id: Int { rawValue }
}

/// Menu bar glyph state. Each case has its own shape, so the meaning does not
/// depend on color.
enum MenuBarIndicator: Equatable, Sendable {
    case idle
    case sharing
    case attention
}

/// Everything both surfaces render, as one value. The live app derives it from real
/// capture, permission, pairing and task state; previews and tests construct it.
struct HelperState: Equatable, Sendable {
    var configurationError: String?
    var pairing: PairingState
    var phone: PhonePresence = .unknown
    var permissions: PermissionSnapshot
    var share: ShareState = .none
    var activity: TaskActivity?
    /// Whether something that can actually halt the running task is attached.
    var canStopTask = false
    /// Why the backend agent loop can't make progress right now, if it can't.
    var agentNotice: String?
    /// Share the whole screen automatically so the Mac can be watched from away.
    var alwaysShareScreen = true
    /// Keep the display awake while connected.
    var keepAwake = true

    enum Problem: Equatable, Sendable {
        case misconfigured(String)
        case notPaired
        case screenRecordingOff
        case windowClosed(ShareSource?)
        case sharingFailed(String)
        case controlOff
    }

    /// The most important thing wrong, if anything. Order is priority.
    var problem: Problem? {
        if let configurationError { return .misconfigured(configurationError) }
        if pairing.phone == nil { return .notPaired }
        if !canShareScreen { return .screenRecordingOff }
        if case .ended(let reason) = share {
            switch reason {
            case .denied: return .screenRecordingOff
            case .windowClosed(let source): return .windowClosed(source)
            case .failed(let message): return .sharingFailed(message)
            }
        }
        if !permissions.accessibility { return .controlOff }
        return nil
    }

    /// Screen Recording is allowed, or a window is being captured right now, which
    /// proves it works whatever the permission check says.
    var canShareScreen: Bool { permissions.screenCapture || share.isCapturing }

    var isWorking: Bool { activity?.phase == .working }

    /// "Jared's iPhone", or a generic name when the backend has not supplied one.
    var phoneName: String {
        pairing.phone?.phoneName ?? "Your iPhone"
    }

    /// The line under the headline. Says "Connected" only with evidence.
    var phoneLine: String? {
        guard let phone = pairing.phone else { return nil }
        let name = phone.phoneName ?? "iPhone paired"
        switch self.phone {
        case .unknown: return name
        case .connected: return "\(name) · Connected"
        case .away: return "\(name) · Away"
        }
    }

    var headline: String {
        switch problem {
        case .misconfigured: return "Spectr isn't configured"
        case .notPaired: return "Finish setting up Spectr"
        case .screenRecordingOff: return "Your iPhone can't see this Mac"
        case .windowClosed: return "The shared window closed"
        case .sharingFailed: return "Sharing stopped"
        case .controlOff, .none: break
        }
        if isWorking { return "Working for \(phoneName)" }
        if problem == .controlOff {
            return share.isCapturing ? "Sharing, but can't control" : "Can't control this Mac yet"
        }
        return share.isCapturing ? "Sharing with \(phoneName)" : "Ready for instructions"
    }

    var problemDetail: String? {
        switch problem {
        case .misconfigured(let message): message
        case .notPaired: "Pair your iPhone to start sending instructions."
        case .screenRecordingOff: "Screen Recording is off for Spectr, so nothing is being shared."
        case .windowClosed(let source):
            if let source { "“\(source.title)” is gone. Nothing is being shared." } else { "Nothing is being shared." }
        case .sharingFailed(let message): message
        case .controlOff: "Spectr can show a window, but it can't click or type until you allow Accessibility."
        case .none: nil
        }
    }

    var indicator: MenuBarIndicator {
        if share.isCapturing { return .sharing }
        switch problem {
        case .none, .controlOff: return .idle
        default: return .attention
        }
    }

    /// The first setup step that is not done, or nil when a window is live.
    var currentSetupStep: SetupStep? {
        SetupStep.allCases.first { !isComplete($0) }
    }

    func isComplete(_ step: SetupStep) -> Bool {
        switch step {
        case .pair: pairing.phone != nil
        case .screenRecording: canShareScreen
        case .control: permissions.accessibility
        case .window: share.isCapturing
        }
    }

    /// Pairing and both permissions: what must hold before Spectr is useful day to day.
    var isSetUp: Bool {
        isComplete(.pair) && isComplete(.screenRecording) && isComplete(.control)
    }
}

/// User intents shared by both surfaces. Each maps to one real capability.
@MainActor
struct HelperActions {
    var openSetup: () -> Void = {}
    var chooseWindow: () -> Void = {}
    var shareScreen: () -> Void = {}
    var setAlwaysShareScreen: (Bool) -> Void = { _ in }
    var setKeepAwake: (Bool) -> Void = { _ in }
    var stopSharing: () -> Void = {}
    var stopTask: () -> Void = {}
    var connectDevice: (String) -> Void = { _ in }
    var startPairing: () -> Void = {}
    var requestScreenRecording: () -> Void = {}
    var requestAccessibility: () -> Void = {}
    var relaunch: () -> Void = {}
    var unpair: () -> Void = {}
    var quit: () -> Void = {}
    /// Debug builds only; nil hides the entry.
    var openLab: (() -> Void)?
    var useLabDevice: (() -> Void)?
}
