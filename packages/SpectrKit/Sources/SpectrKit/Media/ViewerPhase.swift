import Foundation

/// What the iPhone viewer shows, derived from independent facts about the session.
///
/// Every phase that is not healthy names a recovery action, so the UI never shows a
/// spinner without a way out.
public enum ViewerPhase: Sendable, Equatable {
    case joining
    case awaitingPublisher
    case receivingFirstFrame
    case live
    /// Healthy, but the Mac's screen has not changed recently.
    case liveStatic
    case interrupted
    case recovering
    case blockedByPermission
    case accessRevoked
    case ended
    case failed(String)

    public enum Recovery: Sendable, Equatable {
        case none
        case wait
        case reconnect
        case askOwnerToShare
        case signInAgain
        case startNewSession
    }

    public var recovery: Recovery {
        switch self {
        case .live, .liveStatic: .none
        case .joining, .receivingFirstFrame, .recovering: .wait
        case .awaitingPublisher, .blockedByPermission: .askOwnerToShare
        case .interrupted, .failed: .reconnect
        case .accessRevoked: .signInAgain
        case .ended: .startNewSession
        }
    }

    public var isShowingVideo: Bool {
        self == .live || self == .liveStatic
    }
}

/// Facts reported by the media layer and the task API.
public struct ViewerInputs: Sendable, Equatable {
    public enum Connection: Sendable, Equatable {
        case connecting
        case connected
        case reconnecting
        case disconnected
    }

    public var connection: Connection
    /// The expected Mac participant is publishing a screen-share track.
    public var publisherPresent: Bool
    public var health: StreamHealth.State
    /// The Mac reported it cannot capture (permission denied or window closed).
    public var captureBlocked: Bool
    public var accessRevoked: Bool
    public var ended: Bool
    public var failure: String?

    public init(
        connection: Connection = .connecting,
        publisherPresent: Bool = false,
        health: StreamHealth.State = .waitingForFirstFrame,
        captureBlocked: Bool = false,
        accessRevoked: Bool = false,
        ended: Bool = false,
        failure: String? = nil
    ) {
        self.connection = connection
        self.publisherPresent = publisherPresent
        self.health = health
        self.captureBlocked = captureBlocked
        self.accessRevoked = accessRevoked
        self.ended = ended
        self.failure = failure
    }

    /// Precedence: terminal facts first, then connectivity, then the track itself.
    public var phase: ViewerPhase {
        if accessRevoked { return .accessRevoked }
        if ended { return .ended }
        if let failure { return .failed(failure) }
        switch connection {
        case .connecting: return .joining
        case .reconnecting: return .recovering
        case .disconnected: return .interrupted
        case .connected: break
        }
        if captureBlocked { return .blockedByPermission }
        guard publisherPresent else { return .awaitingPublisher }
        switch health {
        case .waitingForFirstFrame: return .receivingFirstFrame
        case .live: return .live
        case .liveStatic: return .liveStatic
        case .stalled: return .interrupted
        }
    }
}
