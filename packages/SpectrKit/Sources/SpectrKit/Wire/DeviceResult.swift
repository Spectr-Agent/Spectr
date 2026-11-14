import Foundation

/// The Mac's report for one command. Envelope matches the backend `DeviceResultSchema`
/// except for `observed`, which replaces the slide-specific field (PROVISIONAL).
public struct DeviceResult: Codable, Sendable, Equatable {
    public enum Outcome: String, Codable, Sendable {
        /// Readback confirmed the requested state.
        case succeeded
        /// The action ran but readback shows a different state, or execution failed.
        case failed
        /// The command was refused before any side effect.
        case rejected
        /// PROVISIONAL: the action may have run, but nothing could confirm the result.
        case unverified
    }

    public struct ResultError: Codable, Sendable, Equatable {
        public var code: String
        public var message: String

        public init(code: String, message: String) {
            self.code = code
            self.message = message
        }
    }

    public var commandId: String
    public var taskId: String
    public var revision: Int
    public var outcome: Outcome
    public var observed: ObservedState?
    public var error: ResultError?
    public var observedAt: Date

    public init(
        commandId: String,
        taskId: String,
        revision: Int,
        outcome: Outcome,
        observed: ObservedState?,
        error: ResultError?,
        observedAt: Date
    ) {
        self.commandId = commandId
        self.taskId = taskId
        self.revision = revision
        self.outcome = outcome
        self.observed = observed
        self.error = error
        self.observedAt = observedAt
    }
}

/// Server acknowledgement of a device result. Matches the backend `ReceiptSchema`.
public struct Receipt: Codable, Sendable, Equatable {
    public enum Status: String, Codable, Sendable {
        case recorded, duplicate, stale
    }

    public var commandId: String
    public var status: Status
    public var taskState: TaskState
}
