import Foundation
import LiveKit
import Testing

@testable import SpectrMac

@MainActor
@Suite("LiveKit wake")
struct WakeListenerTests {
    @Test func theWakeTopicFromTheServerTriggersAPoll() async throws {
        var wakes = 0
        let listener = WakeListener { wakes += 1 }
        // Server-sent data has no participant; the payload is ignored.
        listener.room(
            Room(), participant: nil, didReceiveData: Data("anything".utf8), forTopic: "spectr.wake",
            encryptionType: .none)
        let deadline = ContinuousClock.now + .seconds(5)
        while wakes == 0, ContinuousClock.now < deadline { try await Task.sleep(for: .milliseconds(5)) }
        #expect(wakes == 1)
    }

    @Test func otherTopicsAreIgnored() async throws {
        var wakes = 0
        let listener = WakeListener { wakes += 1 }
        for topic in ["", "spectr.wake.extra", "Spectr.Wake", "lk-chat"] {
            listener.room(
                Room(), participant: nil, didReceiveData: Data("wake".utf8), forTopic: topic, encryptionType: .none)
        }
        try await Task.sleep(for: .milliseconds(100))
        #expect(wakes == 0)
    }
}
