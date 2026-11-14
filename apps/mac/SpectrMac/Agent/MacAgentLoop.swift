import Foundation
import Observation
import SpectrKit

/// Runs the backend's agent loop on this Mac.
///
/// It polls `GET /api/mac/task`. When a task is active, it repeatedly sends a
/// screenshot of only the shared content to `POST /api/mac/step`, executes the returned
/// actions after its own safety checks, and reports each action's result with the next
/// screenshot. The server decides what to do; the Mac decides what it is willing to do.
///
/// A step batch runs at most once, even if the step request is retried or Spectr
/// restarts mid-batch (`StepLedger`, persisted before each action).
@MainActor
@Observable
final class MacAgentLoop {
    enum Status: Equatable, Sendable {
        case stopped
        /// Connected and waiting for a task.
        case idle
        case working
        /// Something on this Mac or the network prevents progress; says what.
        case blocked(String)
        /// The backend rejected the device token.
        case unauthorized
    }

    private(set) var status: Status = .stopped
    private(set) var activity: TaskActivity?

    private let api: any MacAgentAPI
    private let frames: @MainActor () async throws(AgentFrameError) -> AgentFrame
    private let performer: any MacActionPerformer
    private let store: any StepLedgerStore
    private let pause: @Sendable (Duration) async -> Void
    private var ledger: StepLedger
    private var loopTask: Task<Void, Never>?
    /// The task revision the user stopped from this Mac. Its remaining actions are not
    /// run; a newer revision (a correction) runs normally.
    private var halted: (taskId: String, revision: Int)?

    private func isHalted(_ taskId: String, revision: Int) -> Bool {
        guard let halted else { return false }
        return halted.taskId == taskId && revision <= halted.revision
    }

    var idleInterval: Duration = .seconds(3)
    var retryInterval: Duration = .seconds(5)
    /// Called when the backend rejects the device token.
    var onUnauthorized: (() -> Void)?

    init(
        api: any MacAgentAPI,
        frames: @escaping @MainActor () async throws(AgentFrameError) -> AgentFrame,
        performer: any MacActionPerformer,
        store: any StepLedgerStore,
        pause: @escaping @Sendable (Duration) async -> Void = { try? await Task.sleep(for: $0) }
    ) {
        self.api = api
        self.frames = frames
        self.performer = performer
        self.store = store
        self.pause = pause
        self.ledger = store.load()
    }

    // MARK: Control

    func start() {
        guard loopTask == nil else { return }
        status = .idle
        loopTask = Task { [weak self] in
            while let self, !Task.isCancelled {
                let worked = await self.cycle()
                if self.status == .unauthorized { return }
                if !worked { await self.pause(self.idleInterval) }
            }
        }
    }

    func stop() {
        loopTask?.cancel()
        loopTask = nil
        status = .stopped
    }

    /// Stops running the current task on this Mac. The backend task itself is stopped
    /// from the iPhone or by texting "stop"; this only guarantees the Mac does nothing
    /// more for it.
    func haltCurrentTask() {
        guard let activity else { return }
        halted = (activity.taskId, activity.revision)
        self.activity?.phase = .stopped
    }

    var isRunning: Bool { loopTask != nil }

    // MARK: One poll

    /// Fetches the active task and works on it until it pauses, finishes or goes stale.
    /// Returns false when there was nothing to do.
    @discardableResult
    func cycle() async -> Bool {
        let task: MacTaskResponse.Task?
        do {
            task = try await api.activeTask()
        } catch .unauthorized {
            becomeUnauthorized()
            return false
        } catch {
            status = .blocked(Self.message(for: error))
            return false
        }
        guard let task else {
            status = .idle
            if activity?.phase == .working { activity?.phase = .unconfirmed }
            return false
        }
        if isHalted(task.taskId, revision: task.revision) {
            status = .idle
            return false
        }
        show(task)
        switch task.state {
        case .waitingForUser:
            status = .idle
            return false
        case .succeeded, .failed, .cancelled:
            status = .idle
            return false
        case .accepted, .running:
            await runSteps(task)
            return true
        }
    }

    private func runSteps(_ task: MacTaskResponse.Task) async {
        var afterStep = task.step
        var revision = task.revision
        var results: [MacActionResult] = []
        while !Task.isCancelled, !isHalted(task.taskId, revision: revision) {
            let frame: AgentFrame
            do {
                frame = try await frames()
            } catch {
                status = .blocked(error.message)
                return
            }
            status = .working
            let response: MacStepResponse
            do {
                response = try await api.step(
                    MacStepRequest(
                        taskId: task.taskId, afterStep: afterStep, screenshot: frame.screenshot, results: results))
            } catch .staleStep, .notFound {
                // A correction, Stop or another request moved the task on. Re-read it.
                return
            } catch .unauthorized {
                becomeUnauthorized()
                return
            } catch {
                status = .blocked(Self.message(for: error))
                await pause(retryInterval)
                continue
            }
            guard response.taskId == task.taskId else { return }
            switch response {
            case .actions(_, let step, let newRevision, let actions):
                if newRevision > revision {
                    // A correction arrived; it supersedes a stop of the older revision.
                    revision = newRevision
                    activity?.revision = newRevision
                    activity?.phase = .working
                }
                if isHalted(task.taskId, revision: revision) { return }
                results = await execute(
                    actions, taskId: task.taskId, revision: revision, step: step, frame: frame)
                afterStep = step
            case .waiting(_, _, _):
                activity?.phase = .waitingForUser
                status = .idle
                return
            case .finished(_, _, let state, let summary):
                finish(state: state, summary: summary)
                status = .idle
                return
            }
        }
    }

    // MARK: Executing a batch

    private func execute(
        _ actions: [MacStepAction], taskId: String, revision: Int, step: Int, frame: AgentFrame
    ) async -> [MacActionResult] {
        switch ledger.decide(taskId: taskId, step: step) {
        case .replay(let stored):
            return stored
        case .interrupted(let partial):
            let done = Set(partial.map(\.actionId))
            return partial
                + actions.filter { !done.contains($0.actionId) }.map {
                    MacActionResult(
                        actionId: $0.actionId, ok: false, error: "Not run: Spectr restarted during this step.")
                }
        case .execute:
            break
        }

        ledger.begin(taskId: taskId, step: step)
        persist()
        var results: [MacActionResult] = []
        var failed = false
        for item in actions {
            let result: MacActionResult
            if isHalted(taskId, revision: revision) || Task.isCancelled {
                result = MacActionResult(actionId: item.actionId, ok: false, error: "Stopped on the Mac.")
            } else if failed {
                result = MacActionResult(
                    actionId: item.actionId, ok: false, error: "Skipped because an earlier action failed.")
            } else if let rejection = MacActionPolicy.validate(
                item.action, screenshotWidth: frame.screenshot.width, screenshotHeight: frame.screenshot.height)
            {
                failed = true
                result = MacActionResult(
                    actionId: item.actionId, ok: false, error: MacActionPolicy.message(for: rejection))
            } else {
                do {
                    let output = try await performer.perform(item.action, in: frame)
                    result = MacActionResult(actionId: item.actionId, ok: true, output: output)
                } catch {
                    failed = true
                    result = MacActionResult(actionId: item.actionId, ok: false, error: error.message)
                }
            }
            results.append(result)
            ledger.record(result, taskId: taskId, step: step)
            persist()
        }
        ledger.complete(taskId: taskId, step: step)
        persist()
        return results
    }

    // MARK: State

    private func show(_ task: MacTaskResponse.Task) {
        if let activity, activity.taskId == task.taskId, activity.revision == task.revision {
            if task.state == .waitingForUser { self.activity?.phase = .waitingForUser }
            return
        }
        let phase: TaskActivity.Phase =
            switch task.state {
            case .waitingForUser: .waitingForUser
            case .succeeded: .done
            case .failed: .failed("Couldn't finish this")
            case .cancelled: .stopped
            case .accepted, .running: .working
            }
        activity = TaskActivity(
            taskId: task.taskId, revision: task.revision, instruction: task.instruction, phase: phase)
    }

    /// The backend reports success only after the model's final screenshot check.
    private func finish(state: TaskState, summary: String) {
        switch state {
        case .succeeded: activity?.phase = .done
        case .cancelled: activity?.phase = .stopped
        default: activity?.phase = .failed(summary.isEmpty ? "Couldn't finish this" : summary)
        }
        activity?.observed = summary.isEmpty ? nil : summary
    }

    private func becomeUnauthorized() {
        status = .unauthorized
        loopTask?.cancel()
        loopTask = nil
        onUnauthorized?()
    }

    private func persist() {
        try? store.save(ledger)
    }

    static func message(for error: MacAgentError) -> String {
        switch error {
        case .offline: "Can't reach the Spectr server. Check this Mac's internet connection."
        case .unavailable(let detail): "The Spectr server isn't ready: \(detail)"
        case .invalidRequest(let detail): "The server rejected a request: \(detail)"
        case .unauthorized: "This Mac's device token was rejected. Connect it again."
        case .staleStep, .notFound: "The task changed. Checking again."
        }
    }
}

/// Persists the step ledger so a relaunch never repeats a batch.
protocol StepLedgerStore: Sendable {
    func load() -> StepLedger
    func save(_ ledger: StepLedger) throws
}

struct FileStepLedgerStore: StepLedgerStore {
    let url: URL

    static func standard() -> FileStepLedgerStore? {
        guard
            let base = try? FileManager.default.url(
                for: .applicationSupportDirectory, in: .userDomainMask, appropriateFor: nil, create: true)
        else { return nil }
        let directory = base.appending(path: "Spectr", directoryHint: .isDirectory)
        try? FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        return FileStepLedgerStore(url: directory.appending(path: "step-ledger.json"))
    }

    func load() -> StepLedger {
        guard let data = try? Data(contentsOf: url),
            let ledger = try? WireJSON.decoder().decode(StepLedger.self, from: data)
        else { return StepLedger() }
        return ledger
    }

    func save(_ ledger: StepLedger) throws {
        try WireJSON.encoder().encode(ledger).write(to: url, options: [.atomic, .completeFileProtection])
    }
}

final class MemoryStepLedgerStore: StepLedgerStore, @unchecked Sendable {
    private let lock = NSLock()
    private var ledger = StepLedger()

    init(_ ledger: StepLedger = StepLedger()) {
        self.ledger = ledger
    }

    func load() -> StepLedger { lock.withLock { ledger } }
    func save(_ ledger: StepLedger) throws { lock.withLock { self.ledger = ledger } }
}
