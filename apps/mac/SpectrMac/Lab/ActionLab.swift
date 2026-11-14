#if DEBUG
    import Foundation
    import Observation
    import SpectrKit

    /// Debug-only bench that plays the planner's part locally: it turns one instruction
    /// into typed steps and feeds them through the real executor, so the popover's live
    /// state, corrections and Stop can be exercised before the backend exists.
    /// Uses an in-memory ledger and a local device ID; never compiled into Release.
    @MainActor
    @Observable
    final class ActionLab {
        static let deviceId = "dev_local_lab"
        static let taskId = "tsk_local_lab"

        let session: TaskSession
        private var revision = 0
        private var script: Task<Void, Never>?
        private(set) var lastResult: DeviceResult?
        /// What the agent last said: its summary, question, refusal or error.
        private(set) var lastMessage: String?
        private let agent: (any AgentClient)?
        static let maxAgentSteps = 15

        init(driver: any DesktopDriver, agent: (any AgentClient)? = nil) {
            let executor = ActionExecutor(deviceId: Self.deviceId, driver: driver, store: MemoryLedgerStore())
            session = TaskSession(executor: executor)
            self.agent = agent
        }

        /// Waits for the running script to end. For tests.
        func waitUntilIdle() async {
            await script?.value
        }

        /// Hands `instruction` to the local planner and carries out one step at a time:
        /// observe, ask for the next step, run it, repeat. Calling it again mid-task is a
        /// correction; Stop Task ends it at the next step.
        func runAgent(_ instruction: String) {
            script?.cancel()
            revision += 1
            let revision = revision
            lastMessage = nil
            session.begin(taskId: Self.taskId, revision: revision, instruction: instruction)
            guard let agent else {
                finish(revision, .failed, "No agent is configured for this build.")
                return
            }
            script = Task {
                var history: [AgentStep] = []
                for _ in 0..<Self.maxAgentSteps {
                    let look = await step(.observe, revision: revision)
                    guard !Task.isCancelled, !wasStopped(look) else { return }
                    guard look.outcome == .succeeded else {
                        finish(revision, .failed, look.error?.message ?? "Couldn't read the screen.")
                        return
                    }
                    let decision = await agent.nextStep(
                        instruction: instruction, observed: look.observed, history: history)
                    guard !Task.isCancelled, session.activity?.phase == .working else { return }
                    switch decision {
                    case .action(let action):
                        let result = await step(action, revision: revision)
                        guard !Task.isCancelled, !wasStopped(result) else { return }
                        history.append(
                            AgentStep(action: action, outcome: result.outcome.rawValue, error: result.error?.message))
                    case .finish(let summary):
                        finish(revision, .succeeded, summary)
                        return
                    case .ask(let question):
                        finish(revision, .waitingForUser, question)
                        return
                    case .refuse(let reason), .failed(let reason):
                        finish(revision, .failed, reason)
                        return
                    }
                }
                finish(revision, .failed, "Stopped after \(Self.maxAgentSteps) steps without finishing.")
            }
        }

        private func step(_ action: Action, revision: Int) async -> DeviceResult {
            let command = Command(
                commandId: "lab_\(UUID().uuidString.prefix(8))", taskId: Self.taskId, deviceId: Self.deviceId,
                revision: revision, action: action, issuedAt: Date())
            let result = await session.run(command)
            lastResult = result
            return result
        }

        private func wasStopped(_ result: DeviceResult) -> Bool {
            result.error?.code == CommandErrorCode.stopped.rawValue
                || result.error?.code == CommandErrorCode.staleRevision.rawValue
        }

        private func finish(_ revision: Int, _ state: TaskState, _ message: String) {
            lastMessage = message
            if state == .failed {
                session.fail(taskId: Self.taskId, revision: revision, message: message)
            } else {
                session.finish(taskId: Self.taskId, revision: revision, state: state)
            }
        }

        /// One instruction, one step.
        func run(_ action: Action, instruction: String) {
            start(instruction: instruction, steps: [action], pause: .zero)
        }

        /// Opens Notes, starts a note and types `text` a word at a time. Calling it
        /// again while it runs is a correction: the older revision stops producing steps.
        func writeNote(_ text: String) {
            let words = text.split(separator: " ").map { Action.typeText(text: "\($0) ", target: nil) }
            let steps: [Action] =
                [.openApp(bundleId: "com.apple.Notes"), .keyCombo(KeyCombo(modifiers: [.command], key: "n"))] + words
            start(instruction: "Open Notes and write “\(text)”", steps: steps, pause: .seconds(1))
        }

        private func start(instruction: String, steps: [Action], pause: Duration) {
            script?.cancel()
            revision += 1
            let revision = revision
            session.begin(taskId: Self.taskId, revision: revision, instruction: instruction)
            script = Task {
                var state = TaskState.succeeded
                for (index, action) in steps.enumerated() {
                    if index > 0 { try? await Task.sleep(for: pause) }
                    guard !Task.isCancelled else { return }
                    let command = Command(
                        commandId: "lab_\(UUID().uuidString.prefix(8))",
                        taskId: Self.taskId,
                        deviceId: Self.deviceId,
                        revision: revision,
                        action: action,
                        issuedAt: Date()
                    )
                    let result = await session.run(command)
                    lastResult = result
                    if result.outcome == .failed || result.outcome == .rejected {
                        state = .failed
                        break
                    }
                }
                session.finish(taskId: Self.taskId, revision: revision, state: state)
            }
        }
    }
#endif
