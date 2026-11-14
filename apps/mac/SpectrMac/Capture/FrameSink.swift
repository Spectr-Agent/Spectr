import CoreVideo
import Foundation

/// Hands captured frames to the LiveKit publisher from the capture queue.
///
/// When the screen doesn't change, ScreenCaptureKit sends only "idle" signals. The sink
/// re-sends the last frame about once a second, so someone who joins a call mid-way
/// (or a FaceTime relay) still gets a picture of a static screen.
final class FrameSink: @unchecked Sendable {
    private let lock = NSLock()
    private var target: ((CVPixelBuffer) -> Void)?
    private var last: CVPixelBuffer?
    private var lastSent = Date.distantPast
    private let refresh: TimeInterval

    init(refresh: TimeInterval = 1) {
        self.refresh = refresh
    }

    /// Starts or stops delivery. Clearing the target drops the held frame, so a new
    /// session never shows an old picture.
    func setTarget(_ target: ((CVPixelBuffer) -> Void)?) {
        lock.withLock {
            self.target = target
            if target == nil { last = nil }
        }
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
