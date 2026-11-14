import Foundation
import SpectrKit

/// Persists the command ledger so a relaunch never repeats a side effect.
protocol LedgerStore: Sendable {
    func load() -> CommandLedger
    func save(_ ledger: CommandLedger) throws
}

/// Stores the ledger as JSON in Application Support. Holds only IDs, revisions and
/// results; typed text inside stored commands is bounded by the ledger's capacity.
struct FileLedgerStore: LedgerStore {
    let url: URL

    static func standard() throws -> FileLedgerStore {
        let base = try FileManager.default.url(
            for: .applicationSupportDirectory, in: .userDomainMask, appropriateFor: nil, create: true
        )
        let directory = base.appending(path: "Spectr", directoryHint: .isDirectory)
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        return FileLedgerStore(url: directory.appending(path: "command-ledger.json"))
    }

    func load() -> CommandLedger {
        guard let data = try? Data(contentsOf: url),
            let ledger = try? WireJSON.decoder().decode(CommandLedger.self, from: data)
        else { return CommandLedger() }
        return ledger
    }

    func save(_ ledger: CommandLedger) throws {
        let data = try WireJSON.encoder().encode(ledger)
        try data.write(to: url, options: [.atomic, .completeFileProtection])
    }
}

/// Non-persistent store for tests and for sessions where disk is unavailable.
final class MemoryLedgerStore: LedgerStore, @unchecked Sendable {
    private let lock = NSLock()
    private var ledger = CommandLedger()
    private(set) var saveCount = 0

    func load() -> CommandLedger {
        lock.withLock { ledger }
    }

    func save(_ ledger: CommandLedger) throws {
        lock.withLock {
            self.ledger = ledger
            saveCount += 1
        }
    }
}
