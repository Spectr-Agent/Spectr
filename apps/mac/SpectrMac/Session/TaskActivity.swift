import Foundation
import SpectrKit

/// The instruction the Mac is carrying out, as shown in the popover.
struct TaskActivity: Equatable, Sendable {
    enum Phase: Equatable, Sendable {
        case working
        case waitingForUser
        /// The task finished and the Mac's last readback confirmed the result.
        case done
        /// The task finished but nothing on the Mac could confirm the result.
        case unconfirmed
        case failed(String)
        case stopped
    }

    var taskId: String
    var revision: Int
    /// The user's words, verbatim.
    var instruction: String
    var phase: Phase
    /// Where the Mac last observed itself, e.g. "Notes — Shopping".
    var observed: String?

    var statusText: String {
        switch phase {
        case .working: "Working…"
        case .waitingForUser: "Waiting for an answer on iPhone"
        case .done: "Done"
        case .unconfirmed: "Finished, but couldn't confirm"
        case .failed(let message): message
        case .stopped: "Stopped"
        }
    }

    var detailText: String? {
        guard let observed else { return nil }
        switch phase {
        case .done: return "Confirmed in \(observed)"
        case .working, .waitingForUser, .unconfirmed, .failed, .stopped: return "Last seen: \(observed)"
        }
    }
}

/// Keeps the newest instruction on screen and only calls it done after readback.
///
/// A pure value so every race (correction, late result, Stop) is unit-testable.
struct ActivityTracker: Equatable, Sendable {
    private(set) var current: TaskActivity?
    private var lastOutcome: DeviceResult.Outcome?
    private var lastError: String?

    /// Shows a new instruction. An older revision of the same task is ignored.
    @discardableResult
    mutating func begin(taskId: String, revision: Int, instruction: String) -> Bool {
        if let current, current.taskId == taskId, revision <= current.revision { return false }
        current = TaskActivity(taskId: taskId, revision: revision, instruction: instruction, phase: .working)
        lastOutcome = nil
        lastError = nil
        return true
    }

    /// Records one step's result. Results for anything but the newest revision are dropped.
    mutating func record(_ result: DeviceResult) {
        guard isCurrent(taskId: result.taskId, revision: result.revision), current?.phase == .working else { return }
        lastOutcome = result.outcome
        lastError = result.error?.message
        if let observed = result.observed, let description = Self.describe(observed) {
            current?.observed = description
        }
    }

    /// Applies the server's task state for a revision. `succeeded` becomes "Done" only
    /// when the Mac's own last readback for that revision succeeded.
    mutating func finish(taskId: String, revision: Int, state: TaskState) {
        guard isCurrent(taskId: taskId, revision: revision), current?.phase != .stopped else { return }
        switch state {
        case .accepted, .running: current?.phase = .working
        case .waitingForUser: current?.phase = .waitingForUser
        case .succeeded: current?.phase = lastOutcome == .succeeded ? .done : .unconfirmed
        case .failed: current?.phase = .failed(lastError.flatMap { $0.isEmpty ? nil : $0 } ?? "Couldn't finish this")
        case .cancelled: current?.phase = .stopped
        }
    }

    /// Ends the newest revision with a specific reason (e.g. the planner refused).
    mutating func fail(taskId: String, revision: Int, message: String) {
        guard isCurrent(taskId: taskId, revision: revision), current?.phase != .stopped else { return }
        current?.phase = .failed(message)
    }

    mutating func stop(taskId: String, revision: Int) {
        guard isCurrent(taskId: taskId, revision: revision) else { return }
        current?.phase = .stopped
    }

    mutating func clear() {
        self = ActivityTracker()
    }

    private func isCurrent(taskId: String, revision: Int) -> Bool {
        current?.taskId == taskId && current?.revision == revision
    }

    static func describe(_ observed: ObservedState) -> String? {
        guard let app = observed.frontmostAppName, !app.isEmpty else { return nil }
        if let title = observed.windowTitle, !title.isEmpty, title != app { return "\(app) — \(title)" }
        return app
    }
}
