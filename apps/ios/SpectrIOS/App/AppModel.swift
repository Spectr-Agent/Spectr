import Foundation
import Observation
import SpectrKit

/// Everything the signed-in app shows, kept fresh from `/api/app/home`.
///
/// Polls every second while a task runs and every few seconds otherwise, so a task
/// started by text, phone call or this app shows up here on its own. Actions update the
/// screen at once from the server's answer instead of waiting for the next poll.
@MainActor
@Observable
final class AppModel {
    enum Load: Equatable {
        case loading
        case loaded
        case failed(String)
    }

    private(set) var load: Load = .loading
    private(set) var home: AppHome?
    /// A short-lived error from the last action, shown as a banner.
    private(set) var notice: String?
    private(set) var isSending = false
    private(set) var isStopping = false
    /// The most recent finished task, kept on screen so its result can be read.
    private(set) var latestResult: AppTask?

    let api: any AppAPI
    var onSignedOut: (() -> Void)?
    private var pollTask: Task<Void, Never>?
    private var noticeTask: Task<Void, Never>?
    private var dismissedResultId: String?

    init(api: any AppAPI) {
        self.api = api
    }

    // MARK: Derived

    var mac: AppMac? { home?.macs.first }
    var activeTask: AppTask? { home?.activeTask }
    var phones: [String] { home?.phones ?? [] }
    var spectrNumber: String { home?.spectrNumber ?? "+14705969455" }
    /// No Mac paired yet: the app leads with setup.
    var needsPairing: Bool { home != nil && (home?.macs.isEmpty ?? true) }
    var recentTasks: [AppTask] { home?.recentTasks.filter { !$0.isActive } ?? [] }
    /// Every chat, newest first, including the one that's running.
    var chats: [ChatSummary] { ChatSummary.group(home?.recentTasks ?? []) }

    // MARK: Polling

    func start() {
        guard pollTask == nil else { return }
        pollTask = Task { [weak self] in
            while !Task.isCancelled {
                guard let self else { return }
                await self.refresh()
                let busy = self.activeTask != nil
                try? await Task.sleep(for: busy ? .seconds(1) : .seconds(4))
            }
        }
    }

    func stop() {
        pollTask?.cancel()
        pollTask = nil
    }

    func refresh() async {
        do {
            apply(try await api.home())
            load = .loaded
        } catch .signedOut {
            onSignedOut?()
        } catch {
            if home == nil { load = .failed(error.message) }
        }
    }

    private func apply(_ fresh: AppHome) {
        let previousActive = home?.activeTask
        home = fresh
        // Keep the task that just finished on screen as the latest result.
        if let previousActive, fresh.activeTask?.taskId != previousActive.taskId,
            let finished = fresh.recentTasks.first(where: { $0.taskId == previousActive.taskId }), !finished.isActive
        {
            latestResult = finished
        } else if let shown = latestResult,
            let updated = fresh.recentTasks.first(where: { $0.taskId == shown.taskId })
        {
            latestResult = updated
        } else if latestResult == nil, let newest = fresh.recentTasks.first, !newest.isActive,
            newest.taskId != dismissedResultId, Date().timeIntervalSince(newest.updatedAt) < 10 * 60
        {
            latestResult = newest
        }
    }

    private func merge(_ task: AppTask?) {
        guard let task, var fresh = home else { return }
        if task.isActive {
            fresh.activeTask = task
        } else if fresh.activeTask?.taskId == task.taskId {
            fresh.activeTask = nil
            latestResult = task
        }
        if let index = fresh.recentTasks.firstIndex(where: { $0.taskId == task.taskId }) {
            fresh.recentTasks[index] = task
        } else {
            fresh.recentTasks.insert(task, at: 0)
        }
        home = fresh
    }

    // MARK: Actions

    /// Starts a task, corrects the running one, or answers its question. With a
    /// `sessionId`, a new task continues that chat instead of starting a new one.
    @discardableResult
    func send(_ raw: String, sessionId: String? = nil) async -> Bool {
        let text = raw.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !text.isEmpty, !isSending else { return false }
        isSending = true
        defer { isSending = false }
        do {
            let result = try await api.send(
                text: text, clientMessageId: Self.messageId(), deviceId: mac?.deviceId, sessionId: sessionId)
            if result.task?.isActive == true { latestResult = nil }
            merge(result.task)
            return true
        } catch {
            show(error)
            return false
        }
    }

    func answer(_ yes: Bool) async {
        await send(yes ? "Yes" : "No")
    }

    func stopTask() async {
        guard let task = activeTask, !isStopping else { return }
        isStopping = true
        defer { isStopping = false }
        do {
            let result = try await api.stop(taskId: task.taskId, clientMessageId: Self.messageId())
            merge(result.task)
        } catch {
            show(error)
        }
    }

    func dismissResult() {
        dismissedResultId = latestResult?.taskId
        latestResult = nil
    }

    func pair(code: String) async throws(AppAPIError) -> PairResult {
        let result = try await api.pair(code: code)
        await refresh()
        return result
    }

    func linkPhone(_ phone: String) async throws(AppAPIError) -> PhoneLinkResult {
        let result = try await api.linkPhone(phone)
        await refresh()
        return result
    }

    func unlinkPhone(_ phone: String) async {
        do {
            try await api.unlinkPhone(phone)
            await refresh()
        } catch {
            show(error)
        }
    }

    func show(_ error: AppAPIError) {
        if error == .signedOut {
            onSignedOut?()
            return
        }
        notice = error.message
        noticeTask?.cancel()
        noticeTask = Task { [weak self] in
            try? await Task.sleep(for: .seconds(4))
            guard !Task.isCancelled else { return }
            self?.notice = nil
        }
    }

    static func messageId() -> String {
        "ios-" + UUID().uuidString.lowercased()
    }
}
