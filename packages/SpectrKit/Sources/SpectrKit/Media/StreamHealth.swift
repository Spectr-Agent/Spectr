import Foundation

/// Tells a healthy, unchanging screen apart from a stream that has stopped delivering.
///
/// A still screen is normal: the capture source keeps signalling ("nothing changed")
/// even when no pixels change. Only the absence of any signal means the stream stalled.
public struct StreamHealth: Sendable, Equatable {
    public enum State: Sendable, Equatable {
        /// No content frame has arrived yet and the first-frame deadline has not passed.
        case waitingForFirstFrame
        /// Content changed recently.
        case live
        /// Signals are arriving but the picture has not changed. Healthy.
        case liveStatic
        /// Nothing at all has arrived within the stall threshold.
        case stalled
    }

    public var stallThreshold: TimeInterval
    public var firstFrameDeadline: TimeInterval
    public var staticAfter: TimeInterval

    public private(set) var startedAt: Date?
    public private(set) var lastSignalAt: Date?
    public private(set) var lastContentAt: Date?

    public init(stallThreshold: TimeInterval = 3, firstFrameDeadline: TimeInterval = 10, staticAfter: TimeInterval = 2)
    {
        self.stallThreshold = stallThreshold
        self.firstFrameDeadline = firstFrameDeadline
        self.staticAfter = staticAfter
    }

    public mutating func start(at date: Date) {
        startedAt = date
        lastSignalAt = nil
        lastContentAt = nil
    }

    /// Records any sign of life. `contentChanged` is false for "nothing changed" signals.
    public mutating func recordSignal(contentChanged: Bool, at date: Date) {
        lastSignalAt = date
        if contentChanged { lastContentAt = date }
    }

    public func state(at now: Date) -> State {
        guard let lastContentAt else {
            if let startedAt, now.timeIntervalSince(startedAt) > firstFrameDeadline { return .stalled }
            return .waitingForFirstFrame
        }
        let lastSignal = max(lastSignalAt ?? lastContentAt, lastContentAt)
        if now.timeIntervalSince(lastSignal) > stallThreshold { return .stalled }
        return now.timeIntervalSince(lastContentAt) > staticAfter ? .liveStatic : .live
    }
}
