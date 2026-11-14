import Foundation
import Testing

@testable import SpectrKit

@Suite("Viewer phase")
struct ViewerPhaseTests {
    @Test func progressesFromJoiningToLive() {
        var inputs = ViewerInputs()
        #expect(inputs.phase == .joining)
        inputs.connection = .connected
        #expect(inputs.phase == .awaitingPublisher)
        inputs.publisherPresent = true
        #expect(inputs.phase == .receivingFirstFrame)
        inputs.health = .live
        #expect(inputs.phase == .live)
        inputs.health = .liveStatic
        #expect(inputs.phase == .liveStatic)
        #expect(inputs.phase.isShowingVideo)
    }

    @Test func stalledTrackIsInterruptedButStaticIsNot() {
        let stalled = ViewerInputs(connection: .connected, publisherPresent: true, health: .stalled)
        #expect(stalled.phase == .interrupted)
        let still = ViewerInputs(connection: .connected, publisherPresent: true, health: .liveStatic)
        #expect(still.phase == .liveStatic)
    }

    @Test func terminalFactsWinOverConnectivity() {
        #expect(ViewerInputs(connection: .reconnecting, accessRevoked: true).phase == .accessRevoked)
        #expect(ViewerInputs(connection: .connected, ended: true).phase == .ended)
        #expect(ViewerInputs(connection: .connected, captureBlocked: true).phase == .blockedByPermission)
    }

    @Test func everyUnhealthyPhaseHasARecovery() {
        let phases: [ViewerPhase] = [
            .joining, .awaitingPublisher, .receivingFirstFrame, .interrupted, .recovering,
            .blockedByPermission, .accessRevoked, .ended, .failed("x"),
        ]
        for phase in phases {
            #expect(phase.recovery != .none)
        }
    }

    @Test func stepFromResultEvent() {
        let event = TaskEvent(
            taskId: "t", seq: 1, type: "resultRecorded",
            data: .object([
                "commandId": .string("c1"), "outcome": .string("unverified"), "summary": .string("Clicked New Note"),
            ]),
            at: Date(timeIntervalSince1970: 0)
        )
        let step = TaskStep(event: event)
        #expect(step?.summary == "Clicked New Note")
        #expect(step?.outcome == .unverified)

        let other = TaskEvent(taskId: "t", seq: 2, type: "stateChanged", data: .object([:]), at: .distantPast)
        #expect(TaskStep(event: other) == nil)
    }
}
