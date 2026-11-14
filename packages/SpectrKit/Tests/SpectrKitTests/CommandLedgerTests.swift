import Foundation
import Testing

@testable import SpectrKit

@Suite("Command ledger")
struct CommandLedgerTests {
    let now = Date(timeIntervalSince1970: 1_800_000_000)

    func command(_ id: String, revision: Int, action: Action = .observe, task: String = "tsk_1") -> Command {
        Command(commandId: id, taskId: task, deviceId: "dev_1", revision: revision, action: action, issuedAt: now)
    }

    func result(for command: Command, outcome: DeviceResult.Outcome = .succeeded) -> DeviceResult {
        DeviceResult(
            commandId: command.commandId, taskId: command.taskId, revision: command.revision,
            outcome: outcome, observed: nil, error: nil, observedAt: now
        )
    }

    @Test func newCommandExecutes() {
        #expect(CommandLedger().decide(command("c1", revision: 1)) == .execute)
    }

    @Test func duplicateWithSamePayloadReplaysStoredResult() {
        var ledger = CommandLedger()
        let first = command("c1", revision: 1)
        ledger.markStarted(first, at: now)
        ledger.markFinished(result(for: first), at: now)
        #expect(ledger.decide(first) == .replay(result(for: first)))
    }

    @Test func duplicateWithDifferentPayloadConflicts() {
        var ledger = CommandLedger()
        ledger.markStarted(command("c1", revision: 1, action: .observe), at: now)
        #expect(ledger.decide(command("c1", revision: 1, action: .stop)) == .conflict)
    }

    @Test func startedButUnfinishedReconcilesInsteadOfReexecuting() {
        var ledger = CommandLedger()
        let first = command("c1", revision: 1, action: .typeText(text: "a", target: nil))
        ledger.markStarted(first, at: now)
        #expect(ledger.decide(first) == .reconcile)
        #expect(ledger.unfinished == [first])
    }

    @Test func olderRevisionIsStaleAfterCorrection() {
        var ledger = CommandLedger()
        ledger.markStarted(command("c2", revision: 3), at: now)
        #expect(ledger.decide(command("c1", revision: 2)) == .stale(currentRevision: 3))
    }

    @Test func revisionNotedFromStopSupersedesPendingCommand() {
        var ledger = CommandLedger()
        ledger.noteRevision(5, for: "tsk_1")
        #expect(ledger.decide(command("c1", revision: 4)) == .stale(currentRevision: 5))
        #expect(ledger.decide(command("c1", revision: 4, task: "tsk_other")) == .execute)
    }

    @Test func pruningKeepsUnfinishedCommands() {
        var ledger = CommandLedger(capacity: 2)
        let pending = command("pending", revision: 1)
        ledger.markStarted(pending, at: now)
        for index in 0..<5 {
            let done = command("done\(index)", revision: 1)
            ledger.markStarted(done, at: now.addingTimeInterval(Double(index + 1)))
            ledger.markFinished(result(for: done), at: now.addingTimeInterval(Double(index + 1)))
        }
        #expect(ledger.entries.count <= 3)
        #expect(ledger.decide(pending) == .reconcile)
    }

    @Test func ledgerSurvivesPersistenceRoundTrip() throws {
        var ledger = CommandLedger()
        let first = command("c1", revision: 2)
        ledger.markStarted(first, at: now)
        ledger.markFinished(result(for: first), at: now)
        let data = try WireJSON.encoder().encode(ledger)
        let restored = try WireJSON.decoder().decode(CommandLedger.self, from: data)
        #expect(restored.decide(first) == .replay(result(for: first)))
        #expect(restored.decide(command("c0", revision: 1)) == .stale(currentRevision: 2))
    }
}

@Suite("Command validation")
struct CommandValidatorTests {
    func make(_ action: Action, device: String = "dev_1") -> Command {
        Command(commandId: "c", taskId: "t", deviceId: device, revision: 1, action: action, issuedAt: .now)
    }

    @Test func rejectsWrongDevice() {
        #expect(CommandValidator.validate(make(.observe, device: "dev_2"), forDevice: "dev_1") == .wrongDevice)
    }

    @Test(arguments: [
        Action.openApp(bundleId: "not a bundle"),
        .openApp(bundleId: "com..apple"),
        .typeText(text: "", target: nil),
        .typeText(text: String(repeating: "a", count: 2_001), target: nil),
        .keyCombo(KeyCombo(modifiers: [.command, .command], key: "q")),
        .keyCombo(KeyCombo(modifiers: [], key: "rm -rf")),
        .click(target: .point(x: -1, y: 5)),
        .click(target: .point(x: .nan, y: 5)),
        .scroll(dx: 0, dy: 0, target: nil),
        .scroll(dx: 0, dy: 500, target: nil),
    ])
    func rejectsInvalidActions(action: Action) {
        #expect(CommandValidator.validate(make(action), forDevice: "dev_1") == .invalidAction)
    }

    @Test(arguments: [
        Action.observe,
        .stop,
        .openApp(bundleId: "com.apple.Notes"),
        .typeText(text: "hello", target: .element(id: "ax_3")),
        .keyCombo(KeyCombo(modifiers: [.command, .shift], key: "n")),
        .keyCombo(KeyCombo(modifiers: [], key: "return")),
        .click(target: .element(id: "ax_9")),
        .scroll(dx: 0, dy: -5, target: nil),
    ])
    func acceptsValidActions(action: Action) {
        #expect(CommandValidator.validate(make(action), forDevice: "dev_1") == nil)
    }
}
