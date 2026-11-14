import Foundation
import SpectrKit
import Testing

@testable import SpectrMac

@MainActor
@Suite("Helper state")
struct HelperStateTests {
    @Test func idleSaysReadyAndClaimsConnectionOnlyWithEvidence() {
        #expect(HelperState.idle.headline == "Ready for instructions")
        #expect(HelperState.idle.phoneLine == "Jared’s iPhone · Connected")
        #expect(HelperState.idle.indicator == .idle)

        var unknown = HelperState.idle
        unknown.phone = .unknown
        #expect(unknown.phoneLine == "Jared’s iPhone")
        #expect(HelperState.idlePresenceUnknown.phoneLine == "iPhone paired")
    }

    @Test func sharingChangesTheIndicatorAndStoppingRestoresIt() {
        var state = HelperState.active()
        #expect(state.indicator == .sharing)
        #expect(state.headline == "Working for Jared’s iPhone")
        state.share = .none
        #expect(state.indicator == .idle)
    }

    @Test func screenRecordingOffOutranksEverythingButPairing() {
        #expect(HelperState.screenDenied.problem == .screenRecordingOff)
        #expect(HelperState.screenDenied.headline == "Your iPhone can't see this Mac")
        #expect(HelperState.screenDenied.indicator == .attention)
        #expect(HelperState.screenDenied.currentSetupStep == .screenRecording)
        #expect(HelperState.firstLaunch.problem == .notPaired)
        #expect(HelperState.firstLaunch.currentSetupStep == .pair)
    }

    @Test func liveCaptureCountsAsScreenRecordingAllowed() {
        var state = HelperState.screenDenied
        state.share = .live(HelperState.sampleWindow, .live)
        #expect(state.problem == nil)
        #expect(state.isComplete(.screenRecording))
        #expect(state.currentSetupStep == nil)
    }

    @Test func controlOffKeepsSharingDistinct() {
        let state = HelperState.controlDeniedWhileSharing
        #expect(state.problem == .controlOff)
        #expect(state.share.isCapturing)
        #expect(state.indicator == .sharing)
        #expect(state.headline == "Sharing, but can't control")
        #expect(state.currentSetupStep == .control)
    }

    @Test func closedWindowIsNotPresentedAsLive() {
        let state = HelperState.windowClosed
        #expect(!state.share.isCapturing)
        #expect(state.share.source == nil)
        #expect(state.indicator == .attention)
        #expect(state.headline == "The shared window closed")
        #expect(state.problemDetail?.contains("EmoryHacks Demo") == true)
        #expect(state.currentSetupStep == .window)
    }
}

@Suite("Activity tracker")
struct ActivityTrackerTests {
    private func result(revision: Int, _ outcome: DeviceResult.Outcome, window: String = "EmoryHacks Demo")
        -> DeviceResult
    {
        DeviceResult(
            commandId: "cmd_\(revision)", taskId: "tsk_1", revision: revision, outcome: outcome,
            observed: ObservedState(
                frontmostBundleId: "com.apple.Keynote", frontmostAppName: "Keynote", windowTitle: window,
                focusedElement: nil, verification: .accessibility),
            error: nil, observedAt: Date())
    }

    /// The walkthrough: slide three, corrected to slide five, then the old result lands late.
    @Test func correctionKeepsNewestInstructionAndIgnoresLateResult() {
        var tracker = ActivityTracker()
        tracker.begin(taskId: "tsk_1", revision: 1, instruction: "Go to slide three")
        tracker.begin(taskId: "tsk_1", revision: 2, instruction: "Go to slide five")

        tracker.record(result(revision: 1, .succeeded))
        tracker.finish(taskId: "tsk_1", revision: 1, state: .succeeded)
        #expect(tracker.current?.instruction == "Go to slide five")
        #expect(tracker.current?.phase == .working)
        #expect(tracker.current?.observed == nil)

        let reopened = tracker.begin(taskId: "tsk_1", revision: 1, instruction: "Go to slide three")
        #expect(!reopened)
        #expect(tracker.current?.instruction == "Go to slide five")

        tracker.record(result(revision: 2, .succeeded))
        #expect(tracker.current?.phase == .working, "a step result alone is not completion")
        tracker.finish(taskId: "tsk_1", revision: 2, state: .succeeded)
        #expect(tracker.current?.phase == .done)
        #expect(tracker.current?.detailText == "Confirmed in Keynote — EmoryHacks Demo")
    }

    @Test func succeededWithoutReadbackIsNotReportedAsDone() {
        var tracker = ActivityTracker()
        tracker.begin(taskId: "tsk_1", revision: 1, instruction: "Go to slide five")
        tracker.finish(taskId: "tsk_1", revision: 1, state: .succeeded)
        #expect(tracker.current?.phase == .unconfirmed)

        tracker.begin(taskId: "tsk_1", revision: 2, instruction: "Go to slide five")
        tracker.record(result(revision: 2, .unverified))
        tracker.finish(taskId: "tsk_1", revision: 2, state: .succeeded)
        #expect(tracker.current?.phase == .unconfirmed)
    }

    @Test func stopWinsOverALateSuccess() {
        var tracker = ActivityTracker()
        tracker.begin(taskId: "tsk_1", revision: 1, instruction: "Go to slide five")
        tracker.stop(taskId: "tsk_1", revision: 1)
        tracker.record(result(revision: 1, .succeeded))
        tracker.finish(taskId: "tsk_1", revision: 1, state: .succeeded)
        #expect(tracker.current?.phase == .stopped)
    }
}

@MainActor
@Suite("Task session")
struct TaskSessionTests {
    private func command(_ id: String, revision: Int, _ action: Action) -> Command {
        Command(commandId: id, taskId: "tsk_1", deviceId: "dev_1", revision: revision, action: action, issuedAt: Date())
    }

    @Test func stopTaskRefusesRemainingStepsButAllowsACorrection() async {
        let desktop = FakeDesktop()
        let session = TaskSession(
            executor: ActionExecutor(deviceId: "dev_1", driver: desktop, store: MemoryLedgerStore()))
        session.begin(taskId: "tsk_1", revision: 1, instruction: "Write milk")
        await session.run(command("c1", revision: 1, .typeText(text: "mi", target: nil)))

        await session.stopCurrentTask()
        #expect(session.activity?.phase == .stopped)

        let refused = await session.run(command("c2", revision: 1, .typeText(text: "lk", target: nil)))
        #expect(refused.outcome == .rejected)
        #expect(refused.error?.code == CommandErrorCode.stopped.rawValue)
        #expect(desktop.fieldValue == "mi")

        session.begin(taskId: "tsk_1", revision: 2, instruction: "Write eggs")
        let corrected = await session.run(command("c3", revision: 2, .typeText(text: "eggs", target: nil)))
        #expect(corrected.outcome == .succeeded)
        #expect(session.activity?.instruction == "Write eggs")
    }
}

private final class ScriptedAgent: AgentClient, @unchecked Sendable {
    private let lock = NSLock()
    private var decisions: [AgentDecision]
    private(set) var seenHistory: [[AgentStep]] = []

    init(_ decisions: [AgentDecision]) {
        self.decisions = decisions
    }

    func nextStep(instruction: String, observed: ObservedState?, history: [AgentStep]) async -> AgentDecision {
        lock.withLock {
            seenHistory.append(history)
            return decisions.isEmpty ? .action(.observe) : decisions.removeFirst()
        }
    }
}

@MainActor
@Suite("Agent loop")
struct AgentLoopTests {
    @Test func carriesOutStepsThenFinishesAfterAFreshObservation() async {
        let desktop = FakeDesktop()
        let agent = ScriptedAgent([
            .action(.openApp(bundleId: "com.apple.Notes")),
            .action(.typeText(text: "milk", target: nil)),
            .finish("Notes shows a note that says milk."),
        ])
        let lab = ActionLab(driver: desktop, agent: agent)
        lab.runAgent("Open Notes and write milk")
        await lab.waitUntilIdle()

        #expect(desktop.fieldValue == "milk")
        #expect(lab.session.activity?.phase == .done)
        #expect(lab.lastMessage == "Notes shows a note that says milk.")
        #expect(agent.seenHistory.last?.map(\.outcome) == ["succeeded", "succeeded"])
    }

    @Test func refusalAndRunawayLoopsEndAsFailures() async {
        let refused = ActionLab(driver: FakeDesktop(), agent: ScriptedAgent([.refuse("Not allowed.")]))
        refused.runAgent("Open Terminal")
        await refused.waitUntilIdle()
        #expect(refused.session.activity?.phase == .failed("Not allowed."))

        let desktop = FakeDesktop()
        let looping = ActionLab(driver: desktop, agent: ScriptedAgent([]))
        looping.runAgent("Do something forever")
        await looping.waitUntilIdle()
        #expect(looping.session.activity?.phase == .failed("Stopped after 15 steps without finishing."))
    }

    @Test func blockedFrontAppIsReportedBackToTheAgentNotTypedInto() async {
        let desktop = FakeDesktop()
        desktop.frontmostBundleId = "com.microsoft.VSCode"
        let agent = ScriptedAgent([.action(.typeText(text: "rm -rf", target: nil)), .refuse("Can't type there.")])
        let lab = ActionLab(driver: desktop, agent: agent)
        lab.runAgent("Type in the editor")
        await lab.waitUntilIdle()
        #expect(desktop.fieldValue == "")
        #expect(agent.seenHistory.last?.first?.outcome == "rejected")
    }
}

private struct ScriptedPairing: PairingClient {
    var result: Result<Void, PairingError>
    func validate(token: String) async throws(PairingError) { try result.get() }
    func startPairing(name: String) async throws(PairingError) -> PairingTicket { throw .unreachable }
    func pollPairing(_ ticket: PairingTicket) async throws(PairingError) -> PairingPoll { .pending }
}

/// Hands out codes in order and answers polls from a script, per code.
private final class CodePairing: PairingClient, @unchecked Sendable {
    private let lock = NSLock()
    private var codes: [String]
    private var polls: [String: [PairingPoll]]
    private(set) var issued: [String] = []

    init(codes: [String], polls: [String: [PairingPoll]]) {
        self.codes = codes
        self.polls = polls
    }

    func validate(token: String) async throws(PairingError) {}

    func startPairing(name: String) async throws(PairingError) -> PairingTicket {
        let code: String? = lock.withLock {
            guard !codes.isEmpty else { return nil }
            let next = codes.removeFirst()
            issued.append(next)
            return next
        }
        guard let code else { throw .unreachable }
        return PairingTicket(pairingId: "pair_\(code)", code: code, pollSecret: "secret", expiresAt: .distantFuture)
    }

    func pollPairing(_ ticket: PairingTicket) async throws(PairingError) -> PairingPoll {
        lock.withLock {
            guard var queue = polls[ticket.code], !queue.isEmpty else { return .pending }
            let next = queue.removeFirst()
            polls[ticket.code] = queue
            return next
        }
    }
}

@MainActor
@Suite("Device connection")
struct PairingControllerTests {
    @Test func anAcceptedTokenIsStoredAndSurvivesRelaunch() async {
        let store = MemoryDeviceCredentialStore()
        let controller = PairingController(client: ScriptedPairing(result: .success(())), credentials: store)
        controller.connect(token: "  spd_valid  ")
        await controller.waitUntilSettled()
        #expect(controller.state.phone != nil)
        #expect(store.load()?.deviceCredential == "spd_valid")
        #expect(controller.deviceToken == "spd_valid")

        let relaunched = PairingController(client: UnavailablePairingClient(), credentials: store)
        #expect(relaunched.state.phone != nil)
        relaunched.unpair()
        #expect(store.load() == nil)
        #expect(relaunched.state == .unpaired)
    }

    @Test func aRejectedTokenAndAnUnreachableServerAreDistinctAndNothingIsStored() async {
        let store = MemoryDeviceCredentialStore()
        let rejected = PairingController(client: ScriptedPairing(result: .failure(.invalidToken)), credentials: store)
        rejected.connect(token: "spd_wrong")
        await rejected.waitUntilSettled()
        #expect(rejected.state == .failed(.invalidToken))

        let offline = PairingController(client: UnavailablePairingClient(), credentials: store)
        offline.connect(token: "spd_any")
        await offline.waitUntilSettled()
        #expect(offline.state == .failed(.unreachable))
        #expect(store.load() == nil)
    }

    @Test func anEmptyTokenDoesNothing() async {
        let controller = PairingController(
            client: ScriptedPairing(result: .success(())), credentials: MemoryDeviceCredentialStore())
        controller.connect(token: "   ")
        #expect(controller.state == .unpaired)
    }

    @Test func aPairingCodeEnteredOnTheIPhoneStoresTheIssuedDevice() async {
        let store = MemoryDeviceCredentialStore()
        let client = CodePairing(
            codes: ["K7P4QX"], polls: ["K7P4QX": [.pending, .paired(deviceId: "mac-abc", token: "spd_new")]])
        let controller = PairingController(client: client, credentials: store)
        controller.pollInterval = .milliseconds(1)
        controller.startCodePairing(name: "Test Mac")
        await controller.waitUntilSettled()
        #expect(controller.state == .paired(PairedPhone(deviceId: "mac-abc", phoneName: nil)))
        #expect(store.load() == StoredDevice(deviceId: "mac-abc", deviceCredential: "spd_new", phoneName: nil))
    }

    @Test func anExpiredCodeIsReplacedWithoutTheOwnerDoingAnything() async {
        let client = CodePairing(
            codes: ["AAAAAA", "BBBBBB"],
            polls: ["AAAAAA": [.expired], "BBBBBB": [.paired(deviceId: "mac-b", token: "spd_b")]])
        let controller = PairingController(client: client, credentials: MemoryDeviceCredentialStore())
        controller.pollInterval = .milliseconds(1)
        controller.startCodePairing(name: "Test Mac")
        await controller.waitUntilSettled()
        #expect(client.issued == ["AAAAAA", "BBBBBB"])
        #expect(controller.state.phone?.deviceId == "mac-b")
    }

    @Test func pairingCodesAreShownInTwoGroups() {
        let ticket = PairingTicket(pairingId: "p", code: "K7P4QX", pollSecret: "s", expiresAt: .distantFuture)
        #expect(ticket.displayCode == "K7P 4QX")
    }

    @Test func aRevokedTokenForgetsTheDevice() async {
        let store = MemoryDeviceCredentialStore()
        let controller = PairingController(client: ScriptedPairing(result: .success(())), credentials: store)
        controller.connect(token: "spd_valid")
        await controller.waitUntilSettled()
        controller.tokenRejected()
        #expect(store.load() == nil)
        #expect(controller.state == .failed(.invalidToken))
    }
}
