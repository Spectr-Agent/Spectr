import CoreGraphics
import Foundation
import SpectrKit
import Testing

@testable import SpectrMac

/// Scripted backend: queued task and step responses; records every step request.
actor FakeAgentAPI: MacAgentAPI {
    var tasks: [Result<MacTaskResponse.Task?, MacAgentError>]
    var steps: [Result<MacStepResponse, MacAgentError>]
    private(set) var stepRequests: [MacStepRequest] = []

    init(tasks: [Result<MacTaskResponse.Task?, MacAgentError>], steps: [Result<MacStepResponse, MacAgentError>]) {
        self.tasks = tasks
        self.steps = steps
    }

    func activeTask() async throws(MacAgentError) -> MacTaskResponse.Task? {
        guard !tasks.isEmpty else { return nil }
        return try tasks.removeFirst().get()
    }

    func step(_ request: MacStepRequest) async throws(MacAgentError) -> MacStepResponse {
        stepRequests.append(request)
        guard !steps.isEmpty else { throw .offline }
        return try steps.removeFirst().get()
    }
}

@MainActor
final class FakePerformer: MacActionPerformer {
    private(set) var performed: [MacAction] = []
    var refusals: [String: ActionRefusal] = [:]
    var onPerform: ((MacAction) -> Void)?

    func perform(_ action: MacAction, in frame: AgentFrame) async throws(ActionRefusal) -> String? {
        if case .type(let text) = action, let refusal = refusals[text] { throw refusal }
        performed.append(action)
        onPerform?(action)
        return nil
    }
}

@MainActor
@Suite("Mac agent loop")
struct MacAgentLoopTests {
    let performer = FakePerformer()
    let store = MemoryStepLedgerStore()

    static let frame = AgentFrame(
        screenshot: MacScreenshot(mediaType: "image/jpeg", data: "AAAA", width: 1280, height: 800),
        region: CGRect(x: 100, y: 50, width: 640, height: 400), windowOwnerPID: nil)

    func task(_ id: String = "tsk_1", revision: Int = 1, state: TaskState = .running, step: Int = 0)
        -> MacTaskResponse.Task
    {
        MacTaskResponse.Task(
            taskId: id, revision: revision, state: state, instruction: "write milk in Notes", step: step)
    }

    func batch(_ step: Int, _ actions: [(String, MacAction)], task: String = "tsk_1", revision: Int = 1)
        -> MacStepResponse
    {
        .actions(
            taskId: task, step: step, revision: revision,
            actions: actions.map { MacStepAction(actionId: $0.0, action: $0.1) })
    }

    func loop(_ api: FakeAgentAPI, frames: Result<AgentFrame, AgentFrameError> = .success(frame)) -> MacAgentLoop {
        MacAgentLoop(
            api: api, frames: { () async throws(AgentFrameError) -> AgentFrame in try frames.get() },
            performer: performer, store: store, pause: { _ in })
    }

    @Test func runsBatchesReportsResultsAndFinishes() async {
        let api = FakeAgentAPI(
            tasks: [.success(task())],
            steps: [
                .success(batch(1, [("a1", .openApp(name: "Notes")), ("a2", .type(text: "milk"))])),
                .success(.finished(taskId: "tsk_1", step: 2, state: .succeeded, summary: "Notes shows milk.")),
            ])
        let agent = loop(api)
        #expect(await agent.cycle())
        #expect(performer.performed == [.openApp(name: "Notes"), .type(text: "milk")])
        let requests = await api.stepRequests
        #expect(requests.map(\.afterStep) == [0, 1])
        #expect(requests[0].results.isEmpty)
        #expect(
            requests[1].results == [
                MacActionResult(actionId: "a1", ok: true), MacActionResult(actionId: "a2", ok: true),
            ])
        #expect(agent.activity?.phase == .done)
        #expect(agent.activity?.observed == "Notes shows milk.")
    }

    @Test func aRetriedStepThatReturnsTheSameBatchDoesNotRunItAgain() async {
        let same = batch(1, [("a1", .type(text: "milk"))])
        let api = FakeAgentAPI(
            tasks: [.success(task())],
            steps: [
                .success(same),
                // The next request fails, so the loop retries with the same afterStep.
                .failure(.offline),
                .success(same),
                .success(.finished(taskId: "tsk_1", step: 1, state: .succeeded, summary: "")),
            ])
        let agent = loop(api)
        await agent.cycle()
        #expect(performer.performed == [.type(text: "milk")])
    }

    @Test func aRestartMidBatchNeverRepeatsFinishedOrUnfinishedActions() async {
        var ledger = StepLedger()
        ledger.begin(taskId: "tsk_1", step: 1)
        ledger.record(MacActionResult(actionId: "a1", ok: true), taskId: "tsk_1", step: 1)
        let restarted = MemoryStepLedgerStore(ledger)
        let api = FakeAgentAPI(
            tasks: [.success(task(step: 0))],
            steps: [
                .success(batch(1, [("a1", .type(text: "milk")), ("a2", .key(keys: "return", repeat: 1))])),
                .success(.finished(taskId: "tsk_1", step: 1, state: .failed, summary: "Interrupted")),
            ])
        let agent = MacAgentLoop(
            api: api, frames: { () async throws(AgentFrameError) -> AgentFrame in Self.frame },
            performer: performer, store: restarted, pause: { _ in })
        await agent.cycle()
        #expect(performer.performed.isEmpty)
        let results = await api.stepRequests[1].results
        #expect(results.first == MacActionResult(actionId: "a1", ok: true))
        #expect(results.last?.ok == false)
    }

    @Test func invalidAndRefusedActionsAreReportedAndTheRestOfTheBatchIsSkipped() async {
        performer.refusals["secret"] = .secureField
        let api = FakeAgentAPI(
            tasks: [.success(task())],
            steps: [
                .success(
                    batch(
                        1,
                        [
                            ("a1", .click(x: 5000, y: 10, button: .left, clicks: 1, modifiers: [])),
                            ("a2", .type(text: "never runs")),
                        ])),
                .success(batch(2, [("b1", .type(text: "secret")), ("b2", .key(keys: "return", repeat: 1))])),
                .success(.finished(taskId: "tsk_1", step: 3, state: .failed, summary: "Couldn't log in.")),
            ])
        let agent = loop(api)
        await agent.cycle()
        #expect(performer.performed.isEmpty)
        let requests = await api.stepRequests
        #expect(requests[1].results[0].ok == false)
        #expect(requests[1].results[0].error == MacActionPolicy.message(for: .outOfBounds))
        #expect(requests[1].results[1].error == "Skipped because an earlier action failed.")
        #expect(requests[2].results[0].error == ActionRefusal.secureField.message)
        #expect(agent.activity?.phase == .failed("Couldn't log in."))
    }

    @Test func unknownActionTypesAreRejectedNotExecuted() async {
        let api = FakeAgentAPI(
            tasks: [.success(task())],
            steps: [
                .success(batch(1, [("a1", .unsupported(type: "runShell"))])),
                .success(.finished(taskId: "tsk_1", step: 1, state: .failed, summary: "")),
            ])
        await loop(api).cycle()
        #expect(performer.performed.isEmpty)
        #expect(await api.stepRequests[1].results[0].ok == false)
    }

    @Test func aStaleStepStopsTheBatchAndRefetchesTheTask() async {
        let api = FakeAgentAPI(
            tasks: [.success(task()), .success(task(revision: 2, step: 1))],
            steps: [
                .failure(.staleStep(currentRevision: 2)),
                .success(batch(2, [("c1", .type(text: "eggs"))], revision: 2)),
                .success(.finished(taskId: "tsk_1", step: 2, state: .succeeded, summary: "")),
            ])
        let agent = loop(api)
        await agent.cycle()
        #expect(performer.performed.isEmpty)
        await agent.cycle()
        #expect(performer.performed == [.type(text: "eggs")])
        #expect(agent.activity?.revision == 2)
        #expect(await api.stepRequests.last?.afterStep == 2)
    }

    @Test func stoppingOnTheMacSkipsTheRemainingActions() async {
        let api = FakeAgentAPI(
            tasks: [.success(task())],
            steps: [
                .success(batch(1, [("a1", .type(text: "milk")), ("a2", .type(text: "eggs"))])),
                .success(.finished(taskId: "tsk_1", step: 1, state: .cancelled, summary: "")),
            ])
        let agent = loop(api)
        performer.onPerform = { _ in agent.haltCurrentTask() }
        await agent.cycle()
        #expect(performer.performed == [.type(text: "milk")])
        #expect(agent.activity?.phase == .stopped)
    }

    @Test func aStoppedRevisionIsNotResumedButACorrectionRuns() async {
        let api = FakeAgentAPI(
            tasks: [.success(task()), .success(task()), .success(task(revision: 2, step: 1))],
            steps: [
                .success(batch(1, [("a1", .type(text: "milk"))])),
                .success(batch(2, [("c1", .type(text: "eggs"))], revision: 2)),
                .success(.finished(taskId: "tsk_1", step: 2, state: .succeeded, summary: "")),
            ])
        let agent = loop(api)
        performer.onPerform = { _ in agent.haltCurrentTask() }
        await agent.cycle()
        #expect(performer.performed == [.type(text: "milk")])

        // Same revision on the next poll: still stopped, nothing sent.
        #expect(await agent.cycle() == false)
        #expect(await api.stepRequests.count == 1)

        // The owner corrects the task: revision 2 runs.
        performer.onPerform = nil
        await agent.cycle()
        #expect(performer.performed == [.type(text: "milk"), .type(text: "eggs")])
        #expect(agent.activity?.phase == .done)
    }

    @Test func nothingSharedMeansNoScreenshotAndNoActions() async {
        let api = FakeAgentAPI(tasks: [.success(task())], steps: [])
        let agent = loop(api, frames: .failure(.notSharing))
        await agent.cycle()
        #expect(await api.stepRequests.isEmpty)
        #expect(agent.status == .blocked(AgentFrameError.notSharing.message))
    }

    @Test func waitingForTheUserPausesWithoutActing() async {
        let api = FakeAgentAPI(
            tasks: [.success(task())],
            steps: [.success(.waiting(taskId: "tsk_1", step: 1, question: "Send this message?"))])
        let agent = loop(api)
        await agent.cycle()
        #expect(agent.activity?.phase == .waitingForUser)
        #expect(performer.performed.isEmpty)
    }

    @Test func aRejectedTokenStopsTheLoopAndReportsIt() async {
        let api = FakeAgentAPI(tasks: [.failure(.unauthorized)], steps: [])
        let agent = loop(api)
        var rejected = false
        agent.onUnauthorized = { rejected = true }
        await agent.cycle()
        #expect(agent.status == .unauthorized)
        #expect(rejected)
    }

    @Test func noTaskIsIdleAndOfflineIsBlocked() async {
        let idle = loop(FakeAgentAPI(tasks: [.success(nil)], steps: []))
        #expect(await idle.cycle() == false)
        #expect(idle.status == .idle)

        let offline = loop(FakeAgentAPI(tasks: [.failure(.offline)], steps: []))
        await offline.cycle()
        #expect(offline.status == .blocked(MacAgentLoop.message(for: .offline)))
    }

    @Test func screenshotCoordinatesMapIntoTheSharedRegion() {
        // 1280x800 screenshot of a 640x400-point region at (100, 50).
        #expect(Self.frame.screenPoint(x: 0, y: 0) == CGPoint(x: 100.25, y: 50.25))
        #expect(Self.frame.screenPoint(x: 1279, y: 799) == CGPoint(x: 739.75, y: 449.75))
    }

    @Test func appLookupNeverResolvesPaths() {
        #expect(EventActionPerformer.applicationURL(named: "../../../bin/sh") == nil)
        #expect(EventActionPerformer.applicationURL(named: "Definitely Not Installed 123") == nil)
    }
}
