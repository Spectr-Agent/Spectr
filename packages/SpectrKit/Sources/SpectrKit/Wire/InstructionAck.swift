import Foundation

/// Server acknowledgement of an instruction or Stop. Matches the backend
/// `PostInstructionResponseSchema`: the request was accepted at `revision`.
/// It is not evidence that anything happened on the Mac.
public struct InstructionAck: Codable, Sendable, Equatable {
    public var taskId: String
    public var revision: Int
    public var state: TaskState

    public init(taskId: String, revision: Int, state: TaskState) {
        self.taskId = taskId
        self.revision = revision
        self.state = state
    }
}

/// One step shown in the task timeline, built from `resultRecorded` events.
public struct TaskStep: Sendable, Equatable, Identifiable {
    public var id: String
    public var summary: String
    public var outcome: DeviceResult.Outcome
    public var detail: String?

    public init(id: String, summary: String, outcome: DeviceResult.Outcome, detail: String?) {
        self.id = id
        self.summary = summary
        self.outcome = outcome
        self.detail = detail
    }

    /// Builds a step from an event, or nil when the event is not a recognisable result.
    /// `summary` is the planner's short description (PROVISIONAL field); the action type
    /// is the fallback so a step is never blank.
    public init?(event: TaskEvent) {
        guard event.type == "resultRecorded",
            let commandId = event.data["commandId"]?.stringValue,
            let rawOutcome = event.data["outcome"]?.stringValue,
            let outcome = DeviceResult.Outcome(rawValue: rawOutcome)
        else { return nil }
        self.id = commandId
        self.outcome = outcome
        self.summary = event.data["summary"]?.stringValue ?? event.data["action"]?.stringValue ?? "Step"
        self.detail = event.data["detail"]?.stringValue
    }
}
