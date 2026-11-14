import Foundation
import Testing

@testable import SpectrKit

@Suite("Stream health")
struct StreamHealthTests {
    let t0 = Date(timeIntervalSince1970: 1_000)

    func at(_ seconds: Double) -> Date { t0.addingTimeInterval(seconds) }

    @Test func waitsForFirstFrameThenStallsAfterDeadline() {
        var health = StreamHealth()
        health.start(at: t0)
        #expect(health.state(at: at(5)) == .waitingForFirstFrame)
        #expect(health.state(at: at(11)) == .stalled)
    }

    @Test func idleSignalsKeepAStaticScreenHealthy() {
        var health = StreamHealth()
        health.start(at: t0)
        health.recordSignal(contentChanged: true, at: at(1))
        for second in 2...60 {
            health.recordSignal(contentChanged: false, at: at(Double(second)))
        }
        #expect(health.state(at: at(60.5)) == .liveStatic)
    }

    @Test func silenceIsAStall() {
        var health = StreamHealth()
        health.start(at: t0)
        health.recordSignal(contentChanged: true, at: at(1))
        #expect(health.state(at: at(1.5)) == .live)
        #expect(health.state(at: at(4.5)) == .stalled)
    }

    @Test func recoversWhenFramesResume() {
        var health = StreamHealth()
        health.start(at: t0)
        health.recordSignal(contentChanged: true, at: at(1))
        #expect(health.state(at: at(10)) == .stalled)
        health.recordSignal(contentChanged: true, at: at(10))
        #expect(health.state(at: at(10.2)) == .live)
    }
}
