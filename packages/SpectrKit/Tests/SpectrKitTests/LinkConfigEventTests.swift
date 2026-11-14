import Foundation
import Testing

@testable import SpectrKit

@Suite("Watch links")
struct WatchLinkTests {
    let host = "links.example.test"
    let token = "abcDEF0123456789_-xyz"

    @Test func parsesValidLink() throws {
        let url = try #require(URL(string: "https://\(host)/w/\(token)"))
        #expect(try WatchLink.parse(url, expectedHost: host).token == token)
    }

    @Test(arguments: [
        ("http://links.example.test/w/abcDEF0123456789_-xyz", WatchLink.ParseError.wrongScheme),
        ("spectr://links.example.test/w/abcDEF0123456789_-xyz", .wrongScheme),
        ("https://evil.example.test/w/abcDEF0123456789_-xyz", .wrongHost),
        ("https://links.example.test.evil.test/w/abcDEF0123456789_-xyz", .wrongHost),
        ("https://user@links.example.test/w/abcDEF0123456789_-xyz", .wrongHost),
        ("https://links.example.test:8443/w/abcDEF0123456789_-xyz", .wrongHost),
        ("https://links.example.test/t/abcDEF0123456789_-xyz", .wrongPath),
        ("https://links.example.test/w/abcDEF0123456789_-xyz/extra", .wrongPath),
        ("https://links.example.test/w/short", .malformedToken),
        ("https://links.example.test/w/abcDEF0123456789%20xyz", .malformedToken),
    ])
    func rejectsUntrustedLinks(raw: String, expected: WatchLink.ParseError) throws {
        let url = try #require(URL(string: raw))
        #expect(throws: expected) { try WatchLink.parse(url, expectedHost: host) }
    }
}

@Suite("App configuration")
struct AppConfigurationTests {
    @Test func productionRequiresHTTPS() {
        let info: [String: Any] = [
            "SpectrEnvironment": "production",
            "SpectrAPIOrigin": "http://localhost:3000",
            "SpectrLinkHost": "links.example.test",
        ]
        #expect(throws: AppConfiguration.ConfigurationError.insecureOrigin) {
            try AppConfiguration.load(from: info)
        }
    }

    @Test func developmentAllowsLocalhost() throws {
        let info: [String: Any] = [
            "SpectrEnvironment": "development",
            "SpectrAPIOrigin": "http://localhost:3000",
            "SpectrLinkHost": "links.example.test",
        ]
        #expect(try AppConfiguration.load(from: info).environment == .development)
    }

    @Test func unexpandedBuildSettingIsMissing() {
        let info: [String: Any] = [
            "SpectrAPIOrigin": "$(SPECTR_API_ORIGIN)",
            "SpectrLinkHost": "links.example.test",
        ]
        #expect(throws: AppConfiguration.ConfigurationError.missing(key: "SpectrAPIOrigin")) {
            try AppConfiguration.load(from: info)
        }
    }

    @Test func unknownEnvironmentIsTreatedAsProduction() {
        let info: [String: Any] = [
            "SpectrEnvironment": "fixture",
            "SpectrAPIOrigin": "http://localhost:3000",
            "SpectrLinkHost": "links.example.test",
        ]
        #expect(throws: AppConfiguration.ConfigurationError.insecureOrigin) {
            try AppConfiguration.load(from: info)
        }
    }
}

@Suite("Event cursor")
struct EventCursorTests {
    func event(_ seq: Int) -> TaskEvent {
        TaskEvent(taskId: "t", seq: seq, type: "stateChanged", data: .object([:]), at: Date(timeIntervalSince1970: 0))
    }

    @Test func appliesInOrderAndDropsDuplicates() {
        var cursor = EventCursor(lastSeq: 2)
        let outcome = cursor.ingest([event(4), event(2), event(3), event(3)])
        #expect(outcome == .apply([event(3), event(4)]))
        #expect(cursor.lastSeq == 4)
    }

    @Test func reportsGap() {
        var cursor = EventCursor(lastSeq: 2)
        #expect(cursor.ingest([event(5)]) == .gap(expected: 3, received: 5))
        #expect(cursor.lastSeq == 2)
    }

    @Test func snapshotSupersession() {
        let base = TaskSnapshot(
            taskId: "t", deviceId: "d", state: .running, revision: 2, instruction: "x",
            createdAt: .distantPast, updatedAt: Date(timeIntervalSince1970: 10)
        )
        var newer = base
        newer.revision = 3
        var older = base
        older.revision = 1
        older.updatedAt = Date(timeIntervalSince1970: 99)
        #expect(base.isSuperseded(by: newer))
        #expect(!base.isSuperseded(by: older))
    }
}
