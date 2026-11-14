import Foundation

/// Task lifecycle states. Matches `TaskStateSchema` in the backend contract.
public enum TaskState: String, Codable, Sendable, CaseIterable {
    case accepted
    case running
    case waitingForUser
    case succeeded
    case failed
    case cancelled

    /// A terminal task accepts no further commands.
    public var isTerminal: Bool {
        switch self {
        case .succeeded, .failed, .cancelled: true
        case .accepted, .running, .waitingForUser: false
        }
    }
}

/// The server's authoritative view of one task.
///
/// `lastObserved` is the native proposal for general (app-independent) observed state.
/// The backend's frozen contract still carries a slide-specific field; that field is
/// ignored here and tracked as a handoff in `docs/native/STATUS.md`.
public struct TaskSnapshot: Codable, Sendable, Equatable {
    public var taskId: String
    public var deviceId: String
    public var state: TaskState
    public var revision: Int
    public var instruction: String
    public var question: String?
    public var lastObserved: ObservedState?
    public var createdAt: Date
    public var updatedAt: Date

    public init(
        taskId: String,
        deviceId: String,
        state: TaskState,
        revision: Int,
        instruction: String,
        question: String? = nil,
        lastObserved: ObservedState? = nil,
        createdAt: Date,
        updatedAt: Date
    ) {
        self.taskId = taskId
        self.deviceId = deviceId
        self.state = state
        self.revision = revision
        self.instruction = instruction
        self.question = question
        self.lastObserved = lastObserved
        self.createdAt = createdAt
        self.updatedAt = updatedAt
    }

    /// Whether `other` should replace this snapshot in the UI.
    /// A higher revision wins; at equal revision the later update wins.
    public func isSuperseded(by other: TaskSnapshot) -> Bool {
        guard other.taskId == taskId else { return false }
        if other.revision != revision { return other.revision > revision }
        return other.updatedAt > updatedAt
    }
}
