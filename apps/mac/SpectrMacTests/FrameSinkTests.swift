import CoreVideo
import Foundation
import Testing

@testable import SpectrMac

@Suite("Frame sink")
struct FrameSinkTests {
    func buffer() throws -> CVPixelBuffer {
        var pixelBuffer: CVPixelBuffer?
        CVPixelBufferCreate(nil, 4, 4, kCVPixelFormatType_32BGRA, nil, &pixelBuffer)
        return try #require(pixelBuffer)
    }

    final class Received: @unchecked Sendable {
        private let lock = NSLock()
        private var count = 0
        func add() { lock.withLock { count += 1 } }
        var value: Int { lock.withLock { count } }
    }

    @Test func sendsNothingWithoutATarget() throws {
        let sink = FrameSink()
        sink.deliver(try buffer())
        sink.idle()
    }

    @Test func forwardsNewFramesAndRefreshesAStaticScreenAboutOncePerSecond() throws {
        let sink = FrameSink(refresh: 1)
        let received = Received()
        sink.setTarget { _ in received.add() }
        let t0 = Date(timeIntervalSince1970: 1_000)
        sink.deliver(try buffer(), now: t0)
        #expect(received.value == 1)
        sink.idle(now: t0.addingTimeInterval(0.5))
        #expect(received.value == 1)
        sink.idle(now: t0.addingTimeInterval(1.1))
        #expect(received.value == 2)
        sink.idle(now: t0.addingTimeInterval(1.5))
        #expect(received.value == 2)
    }

    @Test func aNewTargetGetsTheCurrentPictureAtOnce() throws {
        let sink = FrameSink(refresh: 60)
        sink.deliver(try buffer())
        let received = Received()
        sink.setTarget { _ in received.add() }
        #expect(received.value == 1)
    }

    @Test func stoppingCaptureDropsTheHeldFrame() throws {
        let sink = FrameSink(refresh: 0)
        let received = Received()
        sink.deliver(try buffer())
        sink.clear()
        sink.setTarget { _ in received.add() }
        sink.idle()
        #expect(received.value == 0)
    }
}
