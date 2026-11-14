import Foundation
import Observation
import SpectrKit

/// State for one task being watched and steered from the iPhone.
///
/// Rules it enforces: an instruction is sent once per user intent (retries reuse the
/// same client message ID), typed text survives failures, Stop can be sent at any time
/// and is never blocked by a pending instruction, and nothing claims success unless a
/// Mac result says so.
@MainActor
@Observable
final class TaskSession {
    enum SendState: Equatable {
        case idle
        case sending
        case failed(String)
    }

    enum StopState: Equatable {
        case idle
        case requesting
        case requested
        case failed(String)
    }

    let taskId: String
    let macName: String
    let isTestData: Bool

    private(set) var snapshot: TaskSnapshot?
    private(set) var steps: [TaskStep] = []
    private(set) var viewer = ViewerInputs()
    private(set) var sendState: SendState = .idle
    private(set) var stopState: StopState = .idle
    private(set) var loadError: String?
    var draft = ""

    private let service: any TaskService
    private let media: any LiveViewSource
    private var cursor = EventCursor()
    private var pendingMessage: (id: String, text: String)?
    private var pendingStopId: String?
    private var eventsTask: Task<Void, Never>?
    private var mediaTask: Task<Void, Never>?

    init(taskId: String, macName: String, service: any TaskService, media: any LiveViewSource, isTestData: Bool) {
        self.taskId = taskId
        self.macName = macName
        self.service = service
        self.media = media
        self.isTestData = isTestData
    }

    var phase: ViewerPhase { viewer.phase }
    var isTerminal: Bool { snapshot?.state.isTerminal ?? false }
    var canSend: Bool {
        !draft.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty && sendState != .sending
            && snapshot != nil && !isTerminal
    }
    var canStop: Bool { snapshot != nil && !isTerminal && stopState != .requesting }

    // MARK: Lifecycle

    func start() async {
        guard eventsTask == nil else { return }
        let stream = media.connect()
        mediaTask = Task { [weak self] in
            for await inputs in stream {
                self?.viewer = inputs
            }
        }
        await reload()
        eventsTask = Task { [weak self] in await self?.pollEvents() }
    }

    /// Tears down everything tied to this session. A new session starts clean.
    func leave() {
        eventsTask?.cancel()
        mediaTask?.cancel()
        eventsTask = nil
        mediaTask = nil
        media.disconnect()
        viewer = ViewerInputs(connection: .disconnected, ended: true)
    }

    func reconnect() {
        mediaTask?.cancel()
        media.disconnect()
        let stream = media.connect()
        mediaTask = Task { [weak self] in
            for await inputs in stream {
                self?.viewer = inputs
            }
        }
    }

    // MARK: Steering

    func send() async {
        let text = draft.trimmingCharacters(in: .whitespacesAndNewlines)
        guard canSend, let revision = snapshot?.revision else { return }
        // Retry of the same text keeps its ID so the server can deduplicate.
        if pendingMessage?.text != text {
            pendingMessage = (UUID().uuidString, text)
        }
        guard let message = pendingMessage else { return }
        sendState = .sending
        do {
            let ack = try await service.postInstruction(
                taskId: taskId, text: text, expectedRevision: revision, clientMessageId: message.id
            )
            apply(ack)
            pendingMessage = nil
            if draft.trimmingCharacters(in: .whitespacesAndNewlines) == text { draft = "" }
            sendState = .idle
        } catch .staleRevision {
            pendingMessage = nil
            await reload()
            sendState = .failed("The task changed while you were typing. Check it, then send again.")
        } catch .offline {
            sendState = .failed("Not sent. Check your connection and try again.")
        } catch {
            sendState = .failed(Self.message(for: error))
        }
    }

    func stop() async {
        guard canStop, let revision = snapshot?.revision else { return }
        let id = pendingStopId ?? UUID().uuidString
        pendingStopId = id
        stopState = .requesting
        do {
            let ack = try await service.stop(taskId: taskId, expectedRevision: revision, clientMessageId: id)
            apply(ack)
            pendingStopId = nil
            stopState = .requested
        } catch .staleRevision {
            // A newer revision exists; Stop still applies to the task as it is now.
            await reload()
            pendingStopId = nil
            stopState = .idle
            await stop()
        } catch {
            stopState = .failed(Self.message(for: error))
        }
    }

    // MARK: Sync

    private func reload() async {
        do {
            let fresh = try await service.snapshot(taskId: taskId)
            if let current = snapshot, !current.isSuperseded(by: fresh), current.taskId == fresh.taskId {
                return
            }
            snapshot = fresh
            loadError = nil
        } catch {
            loadError = Self.message(for: error)
        }
    }

    private func pollEvents() async {
        var backoff: Duration = .seconds(1)
        while !Task.isCancelled {
            do {
                let page = try await service.events(taskId: taskId, after: cursor.lastSeq)
                backoff = .seconds(1)
                switch cursor.ingest(page) {
                case .apply(let events):
                    for event in events { await handle(event) }
                case .gap:
                    await resync()
                }
            } catch {
                try? await Task.sleep(for: backoff)
                backoff = min(backoff * 2, .seconds(15))
            }
        }
    }

    /// Rebuilds from the beginning after a sequence gap.
    private func resync() async {
        cursor.reset(to: 0)
        steps.removeAll()
        await reload()
    }

    private func handle(_ event: TaskEvent) async {
        if let step = TaskStep(event: event) {
            if let index = steps.firstIndex(where: { $0.id == step.id }) {
                steps[index] = step
            } else {
                steps.append(step)
            }
        }
        if event.type == "stateChanged" || event.type == "question" || event.type == "taskCreated" {
            await reload()
        }
    }

    private func apply(_ ack: InstructionAck) {
        guard var current = snapshot, ack.taskId == current.taskId, ack.revision >= current.revision else { return }
        current.revision = ack.revision
        current.state = ack.state
        snapshot = current
    }

    private static func message(for error: TaskServiceError) -> String {
        switch error {
        case .staleRevision: "The task changed. Check it and try again."
        case .notFound: "This task no longer exists."
        case .forbidden: "This task belongs to a different account."
        case .offline: "You're offline. Check your connection."
        case .server(let message): message
        }
    }
}
