import Foundation

/// Decides whether a delivered command may cause a side effect.
///
/// The ledger is a value type so the Mac can persist it (it is `Codable`) and so every
/// race is unit-testable without a Mac. It enforces: a command ID executes at most once,
/// a reused ID with a different payload is a protocol error, and a revision older than
/// the newest one seen for the task never executes.
public struct CommandLedger: Codable, Sendable, Equatable {
    public enum Decision: Sendable, Equatable {
        /// New, current command: mark it started, then execute.
        case execute
        /// Already finished: re-send this stored result, do not execute again.
        case replay(DeviceResult)
        /// Started before (e.g. the app crashed mid-action) but no result was stored:
        /// read the current state and report it. Do not execute again.
        case reconcile
        /// Same command ID with a different payload.
        case conflict
        /// Superseded by a newer revision of the same task.
        case stale(currentRevision: Int)
    }

    public struct Entry: Codable, Sendable, Equatable {
        public var command: Command
        public var result: DeviceResult?
        public var recordedAt: Date
    }

    public private(set) var entries: [String: Entry] = [:]
    public private(set) var newestRevision: [String: Int] = [:]
    public let capacity: Int

    public init(capacity: Int = 200) {
        self.capacity = capacity
    }

    public func decide(_ command: Command) -> Decision {
        if let entry = entries[command.commandId] {
            guard entry.command == command else { return .conflict }
            if let result = entry.result { return .replay(result) }
            return .reconcile
        }
        if let newest = newestRevision[command.taskId], command.revision < newest {
            return .stale(currentRevision: newest)
        }
        return .execute
    }

    /// Records that execution is about to start. Persist the ledger before the side effect.
    public mutating func markStarted(_ command: Command, at date: Date) {
        entries[command.commandId] = Entry(command: command, result: nil, recordedAt: date)
        noteRevision(command.revision, for: command.taskId)
        prune()
    }

    /// Records the final result for a started command.
    public mutating func markFinished(_ result: DeviceResult, at date: Date) {
        guard var entry = entries[result.commandId] else { return }
        entry.result = result
        entry.recordedAt = date
        entries[result.commandId] = entry
    }

    /// Records a revision seen through any channel (e.g. a correction or Stop), so older
    /// commands that arrive later are discarded before execution.
    public mutating func noteRevision(_ revision: Int, for taskId: String) {
        newestRevision[taskId] = max(newestRevision[taskId] ?? 0, revision)
    }

    /// Commands that started but never finished, oldest first.
    public var unfinished: [Command] {
        entries.values
            .filter { $0.result == nil }
            .sorted { $0.recordedAt < $1.recordedAt }
            .map(\.command)
    }

    /// Drops all state, e.g. after the device is revoked.
    public mutating func removeAll() {
        entries.removeAll()
        newestRevision.removeAll()
    }

    private mutating func prune() {
        guard entries.count > capacity else { return }
        let finished =
            entries
            .filter { $0.value.result != nil }
            .sorted { $0.value.recordedAt < $1.value.recordedAt }
        for (id, _) in finished.prefix(entries.count - capacity) {
            entries.removeValue(forKey: id)
        }
    }
}
