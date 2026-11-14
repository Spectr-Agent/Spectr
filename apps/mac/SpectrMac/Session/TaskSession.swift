import Foundation
import Observation
import SpectrKit

/// Runs commands for the current task and tracks what the popover shows about it.
///
/// Whatever delivers commands (the Debug action lab today, the backend command loop
/// later) goes through here, so "Stop task" always acts on the real executor.
@MainActor
@Observable
final class TaskSession {
    private(set) var tracker = ActivityTracker()
    private let executor: ActionExecutor

    init(executor: ActionExecutor) {
        self.executor = executor
    }

    var activity: TaskActivity? { tracker.current }

    func begin(taskId: String, revision: Int, instruction: String) {
        tracker.begin(taskId: taskId, revision: revision, instruction: instruction)
    }

    @discardableResult
    func run(_ command: Command) async -> DeviceResult {
        let result = await executor.handle(command)
        tracker.record(result)
        return result
    }

    func finish(taskId: String, revision: Int, state: TaskState) {
        tracker.finish(taskId: taskId, revision: revision, state: state)
    }

    func fail(taskId: String, revision: Int, message: String) {
        tracker.fail(taskId: taskId, revision: revision, message: message)
    }

    /// Refuses every remaining step of the running task, then shows it as stopped.
    func stopCurrentTask() async {
        guard let activity, activity.phase == .working else { return }
        await executor.halt(taskId: activity.taskId, through: activity.revision)
        tracker.stop(taskId: activity.taskId, revision: activity.revision)
    }

    func clear() {
        tracker.clear()
    }
}
