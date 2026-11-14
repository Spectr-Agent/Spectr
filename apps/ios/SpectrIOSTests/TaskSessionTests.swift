import Foundation
import SpectrKit
import Testing

@testable import SpectrIOS

actor FakeTaskService: TaskService {
    var task: TaskSnapshot
    var queuedEvents: [[TaskEvent]] = []
    var postResults: [Result<InstructionAck, TaskServiceError>] = []
    var stopResults: [Result<InstructionAck, TaskServiceError>] = []
    private(set) var postedMessageIds: [String] = []
    private(set) var stopIds: [String] = []
    private(set) var snapshotCalls = 0

    init(revision: Int = 1, state: TaskState = .running) {
        task = TaskSnapshot(
            taskId: "tsk_1", deviceId: "dev_1", state: state, revision: revision, instruction: "write milk",
            createdAt: Date(timeIntervalSince1970: 0), updatedAt: Date(timeIntervalSince1970: 0)
        )
    }

    func setTask(_ task: TaskSnapshot) { self.task = task }
    func queue(post: Result<InstructionAck, TaskServiceError>) { postResults.append(post) }
    func queue(stop: Result<InstructionAck, TaskServiceError>) { stopResults.append(stop) }
    func queue(events: [TaskEvent]) { queuedEvents.append(events) }

    func snapshot(taskId: String) async throws(TaskServiceError) -> TaskSnapshot {
        snapshotCalls += 1
        return task
    }

    func events(taskId: String, after seq: Int) async throws(TaskServiceError) -> [TaskEvent] {
        if queuedEvents.isEmpty {
            try? await Task.sleep(for: .milliseconds(20))
            return []
        }
        return queuedEvents.removeFirst()
    }

    func postInstruction(
        taskId: String, text: String, expectedRevision: Int, clientMessageId: String
    ) async throws(TaskServiceError) -> InstructionAck {
        postedMessageIds.append(clientMessageId)
        guard !postResults.isEmpty else { throw .server("unexpected post") }
        return try postResults.removeFirst().get()
    }

    func stop(taskId: String, expectedRevision: Int, clientMessageId: String) async throws(TaskServiceError)
        -> InstructionAck
    {
        stopIds.append(clientMessageId)
        guard !stopResults.isEmpty else { throw .server("unexpected stop") }
        return try stopResults.removeFirst().get()
    }
}

@MainActor
final class FakeLiveView: LiveViewSource {
    private(set) var connectCount = 0
    private(set) var disconnectCount = 0
    private var continuation: AsyncStream<ViewerInputs>.Continuation?

    func connect() -> AsyncStream<ViewerInputs> {
        connectCount += 1
        let (stream, continuation) = AsyncStream.makeStream(of: ViewerInputs.self)
        self.continuation = continuation
        return stream
    }

    func emit(_ inputs: ViewerInputs) { continuation?.yield(inputs) }

    func disconnect() {
        disconnectCount += 1
        continuation?.finish()
    }
}

@MainActor
@Suite("Task session")
struct TaskSessionTests {
    let service = FakeTaskService()
    let media = FakeLiveView()

    func makeSession() async -> TaskSession {
        let session = TaskSession(taskId: "tsk_1", macName: "Mac", service: service, media: media, isTestData: false)
        await session.start()
        return session
    }

    func ack(_ revision: Int, _ state: TaskState = .running) -> InstructionAck {
        InstructionAck(taskId: "tsk_1", revision: revision, state: state)
    }

    @Test func sendsOnceAndClearsDraft() async {
        let session = await makeSession()
        await service.queue(post: .success(ack(2)))
        session.draft = "actually write eggs"
        await session.send()
        #expect(session.draft.isEmpty)
        #expect(session.snapshot?.revision == 2)
        #expect(await service.postedMessageIds.count == 1)
        // A second tap with an empty draft sends nothing.
        await session.send()
        #expect(await service.postedMessageIds.count == 1)
        session.leave()
    }

    @Test func offlineKeepsDraftAndRetryReusesTheSameMessageId() async {
        let session = await makeSession()
        await service.queue(post: .failure(.offline))
        await service.queue(post: .success(ack(2)))
        session.draft = "write eggs"
        await session.send()
        #expect(session.draft == "write eggs")
        #expect(session.sendState == .failed("Not sent. Check your connection and try again."))
        await session.send()
        let ids = await service.postedMessageIds
        #expect(ids.count == 2)
        #expect(ids[0] == ids[1])
        #expect(session.draft.isEmpty)
        session.leave()
    }

    @Test func editedTextAfterFailureGetsANewMessageId() async {
        let session = await makeSession()
        await service.queue(post: .failure(.offline))
        await service.queue(post: .success(ack(2)))
        session.draft = "write eggs"
        await session.send()
        session.draft = "write bread"
        await session.send()
        let ids = await service.postedMessageIds
        #expect(ids[0] != ids[1])
        session.leave()
    }

    @Test func staleRevisionRefreshesAndKeepsTheDraft() async {
        let session = await makeSession()
        var newer = await service.task
        newer.revision = 4
        await service.setTask(newer)
        await service.queue(post: .failure(.staleRevision(current: 4)))
        session.draft = "write eggs"
        await session.send()
        #expect(session.draft == "write eggs")
        #expect(session.snapshot?.revision == 4)
        session.leave()
    }

    @Test func stopRetriesWithTheSameIdAfterAFailure() async {
        let session = await makeSession()
        await service.queue(stop: .failure(.offline))
        await service.queue(stop: .success(ack(2, .cancelled)))
        await session.stop()
        #expect(session.stopState == .failed("You're offline. Check your connection."))
        await session.stop()
        let ids = await service.stopIds
        #expect(ids.count == 2 && ids[0] == ids[1])
        #expect(session.stopState == .requested)
        #expect(session.isTerminal)
        session.leave()
    }

    @Test func cannotSendOrStopAnEndedTask() async {
        await service.setTask(
            TaskSnapshot(
                taskId: "tsk_1", deviceId: "dev_1", state: .succeeded, revision: 3, instruction: "x",
                createdAt: .distantPast, updatedAt: .distantPast
            )
        )
        let session = await makeSession()
        session.draft = "more"
        #expect(!session.canSend)
        #expect(!session.canStop)
        session.leave()
    }

    @Test func eventsBecomeStepsAndDuplicatesAreIgnored() async throws {
        let result = TaskEvent(
            taskId: "tsk_1", seq: 1, type: "resultRecorded",
            data: .object(["commandId": .string("c1"), "outcome": .string("succeeded"), "summary": .string("Typed")]),
            at: .distantPast
        )
        await service.queue(events: [result, result])
        await service.queue(events: [result])
        let session = await makeSession()
        try await Task.sleep(for: .milliseconds(150))
        #expect(session.steps.map(\.id) == ["c1"])
        session.leave()
    }

    @Test func sequenceGapTriggersAResync() async throws {
        let late = TaskEvent(taskId: "tsk_1", seq: 5, type: "stateChanged", data: .object([:]), at: .distantPast)
        await service.queue(events: [late])
        let session = await makeSession()
        let before = await service.snapshotCalls
        try await Task.sleep(for: .milliseconds(150))
        #expect(await service.snapshotCalls > before)
        session.leave()
    }

    @Test func viewerFollowsMediaAndLeaveTearsDown() async throws {
        let session = await makeSession()
        media.emit(ViewerInputs(connection: .connected, publisherPresent: true, health: .liveStatic))
        try await Task.sleep(for: .milliseconds(50))
        #expect(session.phase == .liveStatic)
        session.leave()
        #expect(media.disconnectCount == 1)
        #expect(session.phase == .ended)
    }
}
