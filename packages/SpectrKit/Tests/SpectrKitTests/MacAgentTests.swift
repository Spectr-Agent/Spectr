import Foundation
import Testing

@testable import SpectrKit

/// Reads the backend's canonical examples from the repo's `contracts/` folder, so the
/// Swift types are checked against the real files rather than copies.
enum Contracts {
    static let directory = URL(filePath: #filePath)
        .deletingLastPathComponent()  // SpectrKitTests
        .deletingLastPathComponent()  // Tests
        .deletingLastPathComponent()  // SpectrKit
        .deletingLastPathComponent()  // packages
        .deletingLastPathComponent()  // repo root
        .appending(path: "contracts")

    static func decode<T: Decodable>(_ type: T.Type, _ name: String) throws -> T {
        let data = try Data(contentsOf: directory.appending(path: "\(name).json"))
        return try WireJSON.decoder().decode(type, from: data)
    }
}

@Suite("Mac agent contract")
struct MacAgentContractTests {
    @Test func decodesActiveTask() throws {
        let response = try Contracts.decode(MacTaskResponse.self, "mac-task.response")
        let task = try #require(response.task)
        #expect(task.state == .running)
        #expect(task.step >= 0)
        #expect(task.revision >= 1)
    }

    @Test func decodesActionBatchWithEveryActionKnown() throws {
        let response = try Contracts.decode(MacStepResponse.self, "mac-step.response.actions")
        guard case .actions(_, _, _, let actions) = response else {
            Issue.record("expected an action batch")
            return
        }
        #expect(!actions.isEmpty)
        for item in actions {
            if case .unsupported(let type) = item.action { Issue.record("unknown action type \(type)") }
        }
    }

    @Test func decodesWaitingAndFinished() throws {
        let waiting = try Contracts.decode(MacStepResponse.self, "mac-step.response.waiting")
        guard case .waiting(_, _, let question) = waiting else {
            Issue.record("expected waiting")
            return
        }
        #expect(!question.isEmpty)

        let finished = try Contracts.decode(MacStepResponse.self, "mac-step.response.finished")
        guard case .finished(_, _, let state, _) = finished else {
            Issue.record("expected finished")
            return
        }
        #expect(state.isTerminal)
    }

    @Test func stepRequestRoundTripsTheContractShape() throws {
        let request = try Contracts.decode(MacStepRequest.self, "mac-step.request")
        let encoded = try JSONEncoder().encode(request)
        let original = try Data(contentsOf: Contracts.directory.appending(path: "mac-step.request.json"))
        let a = try JSONSerialization.jsonObject(with: encoded) as? NSDictionary
        let b = try JSONSerialization.jsonObject(with: original) as? NSDictionary
        #expect(a == b)
    }

    @Test func actionsRoundTrip() throws {
        let actions: [MacAction] = [
            .screenshot,
            .click(x: 1, y: 2, button: .right, clicks: 2, modifiers: ["cmd"]),
            .mouseMove(x: 3, y: 4),
            .drag(fromX: 1, fromY: 1, toX: 9, toY: 9, modifiers: []),
            .scroll(x: nil, y: nil, direction: .down, amount: 3, modifiers: []),
            .type(text: "milk"),
            .key(keys: "cmd+l", repeat: 1),
            .wait(seconds: 0.5),
            .openApp(name: "Notes"),
            .openUrl(try #require(URL(string: "https://example.com/path"))),
        ]
        for action in actions {
            let data = try JSONEncoder().encode(action)
            #expect(try JSONDecoder().decode(MacAction.self, from: data) == action)
        }
    }

    @Test func unknownActionTypeDecodesAsUnsupported() throws {
        let data = Data(#"{"type":"runShell","command":"ls"}"#.utf8)
        #expect(try JSONDecoder().decode(MacAction.self, from: data) == .unsupported(type: "runShell"))
    }
}

@Suite("Mac action policy")
struct MacActionPolicyTests {
    func check(_ action: MacAction) -> MacActionPolicy.Rejection? {
        MacActionPolicy.validate(action, screenshotWidth: 1280, screenshotHeight: 800)
    }

    @Test func acceptsWellFormedActions() throws {
        #expect(check(.click(x: 0, y: 0, button: .left, clicks: 1, modifiers: [])) == nil)
        #expect(check(.click(x: 1279, y: 799, button: .left, clicks: 3, modifiers: ["shift", "cmd"])) == nil)
        #expect(check(.scroll(x: 10, y: 10, direction: .up, amount: 50, modifiers: [])) == nil)
        #expect(check(.key(keys: "cmd+shift+n", repeat: 1)) == nil)
        #expect(check(.key(keys: "Return", repeat: 3)) == nil)
        #expect(check(.openApp(name: "Notes")) == nil)
        #expect(check(.openUrl(try #require(URL(string: "https://instagram.com")))) == nil)
        #expect(check(.type(text: "line one\nline two")) == nil)
    }

    @Test func rejectsOutOfBoundsTargets() {
        #expect(check(.click(x: 1280, y: 10, button: .left, clicks: 1, modifiers: [])) == .outOfBounds)
        #expect(check(.click(x: -1, y: 10, button: .left, clicks: 1, modifiers: [])) == .outOfBounds)
        #expect(check(.drag(fromX: 1, fromY: 1, toX: 5000, toY: 1, modifiers: [])) == .outOfBounds)
        #expect(check(.scroll(x: 10, y: nil, direction: .down, amount: 1, modifiers: [])) == .outOfBounds)
    }

    @Test func rejectsUnsafeOrMalformedInput() throws {
        #expect(check(.openUrl(try #require(URL(string: "file:///etc/passwd")))) == .invalidURL)
        #expect(check(.openUrl(try #require(URL(string: "javascript:alert(1)")))) == .invalidURL)
        #expect(check(.openUrl(try #require(URL(string: "x-apple.systempreferences:com.apple")))) == .invalidURL)
        #expect(check(.openApp(name: "../../bin/sh")) == .invalidAppName)
        #expect(check(.openApp(name: "Terminal; rm")) == .invalidAppName)
        #expect(check(.type(text: "")) == .invalidText)
        #expect(check(.type(text: "bell\u{07}")) == .invalidText)
        #expect(check(.key(keys: "cmd+hyper+x", repeat: 1)) == .invalidKeys)
        #expect(check(.key(keys: "cmd+cmd+x", repeat: 1)) == .invalidKeys)
        #expect(check(.key(keys: "x", repeat: 101)) == .invalidAmount)
        #expect(check(.wait(seconds: 11)) == .invalidAmount)
        #expect(check(.unsupported(type: "runShell")) == .unsupported("runShell"))
    }

    @Test func parsesKeyChords() {
        #expect(MacActionPolicy.parseKeys("cmd+l") == .init(modifiers: ["command"], key: "l"))
        #expect(MacActionPolicy.parseKeys("ctrl+alt+Delete") == .init(modifiers: ["control", "option"], key: "delete"))
        #expect(MacActionPolicy.parseKeys("cmd++") == .init(modifiers: ["command"], key: "+"))
        #expect(MacActionPolicy.parseKeys("") == nil)
        #expect(MacActionPolicy.parseKeys("cmd+") == nil)
    }

    @Test func screenshotSizingRespectsBackendLimits() {
        let retina = MacScreenshot.targetSize(for: CGSize(width: 1512, height: 982))
        #expect(max(retina.width, retina.height) == 1280)
        #expect(MacScreenshot.fitsBackendLimits(width: retina.width, height: retina.height))
        let ultrawide = MacScreenshot.targetSize(for: CGSize(width: 5120, height: 1440), longEdge: 2576)
        #expect(MacScreenshot.fitsBackendLimits(width: ultrawide.width, height: ultrawide.height))
        #expect(!MacScreenshot.fitsBackendLimits(width: 2577, height: 10))
        #expect(!MacScreenshot.fitsBackendLimits(width: 2576, height: 2576))
    }
}

@Suite("Step ledger")
struct StepLedgerTests {
    @Test func aBatchRunsOnceAndReplaysAfterwards() {
        var ledger = StepLedger()
        #expect(ledger.decide(taskId: "t", step: 3) == .execute)
        ledger.begin(taskId: "t", step: 3)
        let result = MacActionResult(actionId: "a1", ok: true)
        ledger.record(result, taskId: "t", step: 3)
        ledger.complete(taskId: "t", step: 3)
        #expect(ledger.decide(taskId: "t", step: 3) == .replay([result]))
        #expect(ledger.decide(taskId: "t", step: 4) == .execute)
        #expect(ledger.decide(taskId: "other", step: 3) == .execute)
    }

    @Test func anInterruptedBatchIsNotRunAgain() throws {
        var ledger = StepLedger()
        ledger.begin(taskId: "t", step: 1)
        ledger.record(MacActionResult(actionId: "a1", ok: true), taskId: "t", step: 1)
        let restored = try WireJSON.decoder().decode(StepLedger.self, from: WireJSON.encoder().encode(ledger))
        #expect(restored.decide(taskId: "t", step: 1) == .interrupted([MacActionResult(actionId: "a1", ok: true)]))
    }

    @Test func resultTextIsTruncatedToBackendLimits() {
        let result = MacActionResult(
            actionId: "a", ok: false, error: String(repeating: "e", count: 900),
            output: String(repeating: "o", count: 2000))
        #expect(result.error?.count == 500)
        #expect(result.output?.count == 1000)
    }
}

@Suite("Mac agent client")
struct MacAgentClientTests {
    func client(_ transport: ScriptedTransport) throws -> MacAgentClient {
        MacAgentClient(
            origin: try #require(URL(string: "https://api.example.test")), deviceToken: "spd_test_token",
            transport: transport)
    }

    @Test func fetchesTaskWithDeviceToken() async throws {
        let body = try String(
            contentsOf: Contracts.directory.appending(path: "mac-task.response.json"), encoding: .utf8)
        let transport = ScriptedTransport([.respond(status: 200, body: body)])
        let task = try await client(transport).activeTask()
        #expect(task != nil)
        let request = try #require(transport.requests.first)
        #expect(request.url?.absoluteString == "https://api.example.test/api/mac/task")
        #expect(request.value(forHTTPHeaderField: "Authorization") == "Bearer spd_test_token")
    }

    @Test func noActiveTaskIsNil() async throws {
        let transport = ScriptedTransport([.respond(status: 200, body: #"{"task":null}"#)])
        #expect(try await client(transport).activeTask() == nil)
    }

    @Test func mapsBackendErrors() async throws {
        let unauthorized = ScriptedTransport([
            .respond(
                status: 401,
                body:
                    #"{"error":{"code":"forbidden","message":"A valid Mac device token is required.","currentRevision":null}}"#
            )
        ])
        await #expect(throws: MacAgentError.unauthorized) { try await client(unauthorized).activeTask() }

        let stale = ScriptedTransport([
            .respond(
                status: 409, body: #"{"error":{"code":"staleStep","message":"Expected step 2","currentRevision":3}}"#)
        ])
        let request = try Contracts.decode(MacStepRequest.self, "mac-step.request")
        await #expect(throws: MacAgentError.staleStep(currentRevision: 3)) { try await client(stale).step(request) }

        let misconfigured = ScriptedTransport([
            .respond(
                status: 500,
                body:
                    #"{"error":{"code":"misconfigured","message":"Missing environment variables: X","currentRevision":null}}"#
            )
        ])
        await #expect(throws: MacAgentError.unavailable("Missing environment variables: X")) {
            try await client(misconfigured).activeTask()
        }

        let offline = ScriptedTransport([.fail])
        await #expect(throws: MacAgentError.offline) { try await client(offline).activeTask() }
    }

    @Test func stepPostsTheRequestBody() async throws {
        let body = try String(
            contentsOf: Contracts.directory.appending(path: "mac-step.response.finished.json"), encoding: .utf8)
        let transport = ScriptedTransport([.respond(status: 200, body: body)])
        let request = try Contracts.decode(MacStepRequest.self, "mac-step.request")
        _ = try await client(transport).step(request)
        let sent = try #require(transport.requests.first)
        #expect(sent.httpMethod == "POST")
        #expect(sent.url?.path() == "/api/mac/step")
        let decoded = try JSONDecoder().decode(MacStepRequest.self, from: try #require(sent.httpBody))
        #expect(decoded == request)
    }
}

@Suite("Mac LiveKit grant")
struct MacLiveKitGrantTests {
    func client(_ transport: ScriptedTransport) throws -> MacAgentClient {
        MacAgentClient(
            origin: try #require(URL(string: "https://api.example.test")), deviceToken: "spd_test_token",
            transport: transport)
    }

    @Test func fetchesTheGrantWithTheDeviceToken() async throws {
        let body = """
            {"url":"wss://project.example.test","token":"eyJ.test.jwt","room":"spectr-mac-dev_1",
             "identity":"mac-dev_1","expiresAt":"2026-11-14T01:00:00.000Z"}
            """
        let transport = ScriptedTransport([.respond(status: 200, body: body)])
        let grant = try await client(transport).liveKitGrant()
        #expect(grant.room == "spectr-mac-dev_1")
        #expect(grant.identity == "mac-dev_1")
        let request = try #require(transport.requests.first)
        #expect(request.url?.path() == "/api/mac/livekit")
        #expect(request.value(forHTTPHeaderField: "Authorization") == "Bearer spd_test_token")
    }

    @Test func rejectsAGrantThatIsNotALiveKitURL() async throws {
        let body = """
            {"url":"https://evil.example.test","token":"t","room":"r","identity":"i","expiresAt":"2026-11-14T01:00:00Z"}
            """
        let transport = ScriptedTransport([.respond(status: 200, body: body)])
        await #expect(throws: MacAgentError.unavailable("The LiveKit grant could not be read.")) {
            try await client(transport).liveKitGrant()
        }
    }

    @Test func aRejectedDeviceTokenIsUnauthorized() async throws {
        let transport = ScriptedTransport([
            .respond(status: 401, body: #"{"error":{"code":"forbidden","message":"x","currentRevision":null}}"#)
        ])
        await #expect(throws: MacAgentError.unauthorized) { try await client(transport).liveKitGrant() }
    }
}
