#if DEBUG
    import Foundation
    import SpectrKit

    /// TEST DATA ONLY. A scripted, in-process stand-in for the task API so the iPhone
    /// screens can be exercised before the backend exists. Not compiled into Release.
    actor DemoTaskService: TaskService {
        private var task: TaskSnapshot
        private var events: [TaskEvent] = []
        private var seenMessageIds: [String: InstructionAck] = [:]
        private var scriptTask: Task<Void, Never>?

        init(taskId: String = "tsk_demo_001") {
            let now = Date()
            task = TaskSnapshot(
                taskId: taskId, deviceId: "dev_demo_mac", state: .accepted, revision: 1,
                instruction: "Open Notes and start a shopping list", createdAt: now, updatedAt: now
            )
        }

        func begin() {
            runScript(for: task.instruction, revision: task.revision)
        }

        func snapshot(taskId: String) async throws(TaskServiceError) -> TaskSnapshot {
            guard taskId == task.taskId else { throw .notFound }
            return task
        }

        func events(taskId: String, after seq: Int) async throws(TaskServiceError) -> [TaskEvent] {
            guard taskId == task.taskId else { throw .notFound }
            for _ in 0..<50 {
                let fresh = events.filter { $0.seq > seq }
                if !fresh.isEmpty { return fresh }
                try? await Task.sleep(for: .milliseconds(200))
                if Task.isCancelled { return [] }
            }
            return []
        }

        func postInstruction(
            taskId: String, text: String, expectedRevision: Int, clientMessageId: String
        ) async throws(TaskServiceError) -> InstructionAck {
            if let earlier = seenMessageIds[clientMessageId] { return earlier }
            guard taskId == task.taskId else { throw .notFound }
            guard expectedRevision == task.revision else { throw .staleRevision(current: task.revision) }
            try? await Task.sleep(for: .milliseconds(350))
            task.revision += 1
            task.instruction = text
            task.state = .running
            task.updatedAt = Date()
            let ack = InstructionAck(taskId: taskId, revision: task.revision, state: task.state)
            seenMessageIds[clientMessageId] = ack
            append("stateChanged", ["state": .string("running")])
            runScript(for: text, revision: task.revision)
            return ack
        }

        func stop(taskId: String, expectedRevision: Int, clientMessageId: String) async throws(TaskServiceError)
            -> InstructionAck
        {
            if let earlier = seenMessageIds[clientMessageId] { return earlier }
            guard taskId == task.taskId else { throw .notFound }
            guard expectedRevision == task.revision else { throw .staleRevision(current: task.revision) }
            scriptTask?.cancel()
            task.revision += 1
            task.state = .cancelled
            task.updatedAt = Date()
            let ack = InstructionAck(taskId: taskId, revision: task.revision, state: .cancelled)
            seenMessageIds[clientMessageId] = ack
            append("stateChanged", ["state": .string("cancelled")])
            return ack
        }

        // MARK: Script

        private func runScript(for instruction: String, revision: Int) {
            scriptTask?.cancel()
            let phrase = Self.phrase(in: instruction)
            let steps: [(String, DeviceResult.Outcome, String?)] = [
                ("Opened Notes", .succeeded, "Notes is in front."),
                ("Clicked New Note", .unverified, "Clicks can't be read back; Spectr checked what's on screen."),
                ("Typed “\(phrase)”", .succeeded, "The note now contains “\(phrase)”."),
            ]
            scriptTask = Task {
                try? await Task.sleep(for: .milliseconds(600))
                self.setState(.running, ifRevision: revision)
                for (index, step) in steps.enumerated() {
                    try? await Task.sleep(for: .milliseconds(1_400))
                    guard !Task.isCancelled else { return }
                    self.recordStep(step, index: index, revision: revision)
                }
                try? await Task.sleep(for: .milliseconds(500))
                guard !Task.isCancelled else { return }
                self.setState(.succeeded, ifRevision: revision)
            }
        }

        private func recordStep(_ step: (String, DeviceResult.Outcome, String?), index: Int, revision: Int) {
            guard task.revision == revision else { return }
            var data: [String: JSONValue] = [
                "commandId": .string("cmd_r\(revision)_\(index)"),
                "outcome": .string(step.1.rawValue),
                "summary": .string(step.0),
            ]
            if let detail = step.2 { data["detail"] = .string(detail) }
            append("resultRecorded", data)
        }

        private func setState(_ state: TaskState, ifRevision revision: Int) {
            guard task.revision == revision, !task.state.isTerminal || state == .running else { return }
            task.state = state
            task.updatedAt = Date()
            append("stateChanged", ["state": .string(state.rawValue)])
        }

        private func append(_ type: String, _ data: [String: JSONValue]) {
            events.append(
                TaskEvent(taskId: task.taskId, seq: events.count + 1, type: type, data: .object(data), at: Date())
            )
        }

        /// Pulls the quoted or trailing phrase out of an instruction for the scripted typing step.
        private static func phrase(in instruction: String) -> String {
            if let start = instruction.firstIndex(where: { "\"“'".contains($0) }) {
                let rest = instruction[instruction.index(after: start)...]
                if let end = rest.firstIndex(where: { "\"”'".contains($0) }) { return String(rest[..<end]) }
            }
            let words = instruction.split(separator: " ")
            return words.suffix(2).joined(separator: " ")
        }
    }

    /// TEST DATA ONLY. Walks the viewer through joining → live without any real media.
    @MainActor
    final class DemoLiveViewSource: LiveViewSource {
        private var task: Task<Void, Never>?

        func connect() -> AsyncStream<ViewerInputs> {
            task?.cancel()
            let (stream, continuation) = AsyncStream.makeStream(of: ViewerInputs.self)
            task = Task {
                var inputs = ViewerInputs()
                continuation.yield(inputs)
                let script: [(Int, (inout ViewerInputs) -> Void)] = [
                    (700, { $0.connection = .connected }),
                    (800, { $0.publisherPresent = true }),
                    (900, { $0.health = .live }),
                    (4_000, { $0.health = .liveStatic }),
                ]
                for (delay, change) in script {
                    try? await Task.sleep(for: .milliseconds(delay))
                    guard !Task.isCancelled else { break }
                    change(&inputs)
                    continuation.yield(inputs)
                }
                if Task.isCancelled { continuation.finish() }
            }
            continuation.onTermination = { [weak self] _ in
                Task { @MainActor in self?.task?.cancel() }
            }
            return stream
        }

        func disconnect() {
            task?.cancel()
            task = nil
        }
    }
#endif
