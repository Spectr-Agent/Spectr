import Foundation
import SpectrKit

/// The task API as the iPhone sees it. The production HTTP client conforms once the
/// backend routes exist; until then the Debug-only demo service and test fakes do.
protocol TaskService: Sendable {
    func snapshot(taskId: String) async throws(TaskServiceError) -> TaskSnapshot
    /// Long-polls for events after `seq`. May return an empty page on timeout.
    func events(taskId: String, after seq: Int) async throws(TaskServiceError) -> [TaskEvent]
    func postInstruction(
        taskId: String, text: String, expectedRevision: Int, clientMessageId: String
    ) async throws(TaskServiceError) -> InstructionAck
    func stop(taskId: String, expectedRevision: Int, clientMessageId: String) async throws(TaskServiceError)
        -> InstructionAck
}

enum TaskServiceError: Error, Equatable {
    case staleRevision(current: Int)
    case notFound
    case forbidden
    case offline
    case server(String)
}

/// Media facts for one viewing session. The LiveKit subscriber conforms in Phase 3.
@MainActor
protocol LiveViewSource: AnyObject {
    /// Starts joining and streams viewer facts until `disconnect()`.
    func connect() -> AsyncStream<ViewerInputs>
    func disconnect()
}
