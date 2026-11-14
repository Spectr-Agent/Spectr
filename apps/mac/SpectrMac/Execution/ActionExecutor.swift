import Foundation
import SpectrKit

/// Runs commands one at a time and returns a result grounded in read-back state.
///
/// Order of checks: validate → dedupe/revision → preflight (permission, lock, blocked
/// app, secure field) → persist "started" → act → read back → persist result.
actor ActionExecutor {
    private let deviceId: String
    private let driver: any DesktopDriver
    private let store: any LedgerStore
    private let policy: AppPolicy
    private let now: @Sendable () -> Date
    private var ledger: CommandLedger
    private var tail: Task<Void, Never>?
    /// Per task, the newest revision the user stopped from this Mac.
    private var haltedThrough: [String: Int] = [:]

    init(
        deviceId: String,
        driver: any DesktopDriver,
        store: any LedgerStore,
        policy: AppPolicy = .standard,
        now: @escaping @Sendable () -> Date = { Date() }
    ) {
        self.deviceId = deviceId
        self.driver = driver
        self.store = store
        self.policy = policy
        self.now = now
        self.ledger = store.load()
    }

    /// Commands that started before a crash and have no result yet.
    var unfinishedCommands: [Command] { ledger.unfinished }

    /// Stops a task from the Mac: every command at or below `revision` that has not run
    /// yet is refused. A later correction (a higher revision) still runs.
    func halt(taskId: String, through revision: Int) {
        haltedThrough[taskId] = max(haltedThrough[taskId] ?? 0, revision)
    }

    /// Executes `command` after every previously submitted command has finished.
    /// A valid Stop takes effect immediately for anything still queued.
    func handle(_ command: Command) async -> DeviceResult {
        if command.action == .stop, CommandValidator.validate(command, forDevice: deviceId) == nil {
            ledger.noteRevision(command.revision, for: command.taskId)
        }
        let previous = tail
        let work = Task { () -> DeviceResult in
            await previous?.value
            return await self.run(command)
        }
        tail = Task { _ = await work.value }
        return await work.value
    }

    private func run(_ command: Command) async -> DeviceResult {
        if let code = CommandValidator.validate(command, forDevice: deviceId) {
            return result(command, .rejected, code, "The command failed validation.")
        }

        if command.action != .stop, let halted = haltedThrough[command.taskId], command.revision <= halted {
            return result(command, .rejected, .stopped, "Stopped on the Mac.")
        }

        switch ledger.decide(command) {
        case .replay(let stored):
            return stored
        case .conflict:
            return result(
                command, .rejected, .duplicateConflict, "This command ID was already used for a different action.")
        case .stale(let current):
            return result(command, .rejected, .staleRevision, "Superseded by revision \(current).")
        case .reconcile:
            let observed = await driver.observe(includeElements: false)
            return finish(
                command, .unverified, observed: observed, .readbackFailed,
                "Spectr restarted during this action. This is the current state; the action was not repeated."
            )
        case .execute:
            break
        }

        if command.action == .stop {
            ledger.markStarted(command, at: now())
            let observed = await driver.observe(includeElements: false)
            return finish(command, .succeeded, observed: observed)
        }

        if let rejection = await preflight(command) {
            return result(command, .rejected, rejection.0, rejection.1)
        }

        ledger.markStarted(command, at: now())
        do {
            try store.save(ledger)
        } catch {
            ledger.removeEntry(command.commandId)
            return result(command, .rejected, .readbackFailed, "Could not record the command before running it.")
        }

        do {
            try await perform(command.action)
        } catch {
            let observed = await driver.observe(includeElements: false)
            return finish(command, .failed, observed: observed, error.code, "The action could not be completed.")
        }

        await driver.settle()
        return await verify(command)
    }

    private func preflight(_ command: Command) async -> (CommandErrorCode, String)? {
        guard await driver.isAccessibilityTrusted else {
            return (.accessibilityDenied, "Spectr needs Accessibility permission on this Mac.")
        }
        guard await !driver.isScreenLocked else {
            return (.desktopLocked, "The Mac is locked. Unlock it to continue.")
        }
        switch command.action {
        case .openApp(let bundleId):
            if policy.isBlocked(bundleId) { return (.appBlocked, "Spectr is not allowed to operate this app.") }
        case .observe:
            break
        default:
            if policy.isBlocked(await driver.frontmostBundleId) {
                return (.appBlocked, "Spectr is not allowed to operate the app in front.")
            }
        }
        if case .typeText(_, let target) = command.action, await driver.isSecureField(target) {
            return (.secureField, "Spectr never types into password fields.")
        }
        return nil
    }

    private func perform(_ action: Action) async throws(DriverError) {
        switch action {
        case .observe, .stop, .unsupported:
            return
        case .openApp(let bundleId):
            try await driver.openApp(bundleId: bundleId)
        case .click(let target):
            try await driver.click(target)
        case .typeText(let text, let target):
            try await driver.typeText(text, into: target)
        case .keyCombo(let combo):
            try await driver.keyCombo(combo)
        case .scroll(let dx, let dy, let target):
            try await driver.scroll(dx: dx, dy: dy, target: target)
        }
    }

    /// Decides the outcome from independently read state, never from the action itself.
    private func verify(_ command: Command) async -> DeviceResult {
        switch command.action {
        case .observe:
            let observed = await driver.observe(includeElements: true)
            return finish(command, .succeeded, observed: observed)
        case .openApp(let bundleId):
            let observed = await driver.observe(includeElements: false)
            if observed.frontmostBundleId == bundleId {
                return finish(command, .succeeded, observed: observed)
            }
            return finish(command, .failed, observed: observed, .readbackFailed, "A different app is in front.")
        case .typeText(let text, _):
            let observed = await driver.observe(includeElements: false)
            guard let value = observed.focusedElement?.value else {
                return finish(
                    command, .unverified, observed: observed, .readbackFailed,
                    "The focused element does not expose its text."
                )
            }
            if value.contains(text) {
                return finish(command, .succeeded, observed: observed)
            }
            return finish(command, .failed, observed: observed, .readbackFailed, "The text did not appear.")
        case .click, .keyCombo, .scroll:
            // No requested end state exists for these; report what is now on screen.
            let observed = await driver.observe(includeElements: false)
            return finish(command, .unverified, observed: observed)
        case .stop, .unsupported:
            return result(command, .rejected, .unsupportedAction, "Unexpected action at verification.")
        }
    }

    private func finish(
        _ command: Command,
        _ outcome: DeviceResult.Outcome,
        observed: ObservedState,
        _ code: CommandErrorCode? = nil,
        _ message: String? = nil
    ) -> DeviceResult {
        let value = DeviceResult(
            commandId: command.commandId,
            taskId: command.taskId,
            revision: command.revision,
            outcome: outcome,
            observed: observed,
            error: code.map { DeviceResult.ResultError(code: $0.rawValue, message: message ?? "") },
            observedAt: now()
        )
        ledger.markFinished(value, at: now())
        try? store.save(ledger)
        return value
    }

    /// A result that is not recorded in the ledger (nothing ran).
    private func result(
        _ command: Command, _ outcome: DeviceResult.Outcome, _ code: CommandErrorCode, _ message: String
    ) -> DeviceResult {
        DeviceResult(
            commandId: command.commandId,
            taskId: command.taskId,
            revision: command.revision,
            outcome: outcome,
            observed: nil,
            error: DeviceResult.ResultError(code: code.rawValue, message: message),
            observedAt: now()
        )
    }
}
