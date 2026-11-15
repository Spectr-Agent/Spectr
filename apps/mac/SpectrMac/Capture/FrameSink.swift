import CoreVideo
import Foundation

/// Hands captured frames to the LiveKit publisher from the capture queue.
///
/// When the screen doesn't change, ScreenCaptureKit sends only "idle" signals. The sink
/// re-sends the last frame twice a second, so a viewer who joins, or one that lost
/// packets, gets a picture within half a second instead of a gray frame. Not faster:
/// the FaceTime relay decodes every frame next to the call's voice.
final class FrameSink: @unchecked Sendable {
    private let lock = NSLock()
    private var target: ((CVPixelBuffer) -> Void)?
    private var last: CVPixelBuffer?
    private var lastSent = Date.distantPast
    private let refresh: TimeInterval

    init(refresh: TimeInterval = 0.5) {
        self.refresh = refresh
    }

    /// Starts or stops delivery. A new target gets the current picture at once: LiveKit
    /// needs a first frame to finish publishing, and a still screen sends no new ones.
    func setTarget(_ target: ((CVPixelBuffer) -> Void)?) {
        let current: CVPixelBuffer? = lock.withLock {
            self.target = target
            guard target != nil, let last else { return nil }
            lastSent = Date()
            return last
        }
        if let target, let current { target(current) }
    }

    /// Drops the held frame when capture stops, so nothing old is ever shown again.
    func clear() {
        lock.withLock { last = nil }
    }

    func deliver(_ buffer: CVPixelBuffer, now: Date = Date()) {
        let send: ((CVPixelBuffer) -> Void)? = lock.withLock {
            last = buffer
            lastSent = now
            return target
        }
        send?(buffer)
    }

    func idle(now: Date = Date()) {
        let pending: (((CVPixelBuffer) -> Void), CVPixelBuffer)? = lock.withLock {
            guard let target, let last, now.timeIntervalSince(lastSent) >= refresh else { return nil }
            lastSent = now
            return (target, last)
        }
        if let (send, buffer) = pending { send(buffer) }
    }
}
