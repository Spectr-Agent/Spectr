import Foundation
import Testing

@testable import SpectrKit

enum Fixture {
    static func data(_ name: String) throws -> Data {
        let url = try #require(
            Bundle.module.url(forResource: name, withExtension: "json", subdirectory: "Fixtures")
        )
        return try Data(contentsOf: url)
    }

    static func decode<T: Decodable>(_ type: T.Type, _ name: String) throws -> T {
        try WireJSON.decoder().decode(type, from: data(name))
    }
}

@Suite("Wire decoding")
struct WireDecodingTests {
    @Test func decodesRunningTaskWithObservedState() throws {
        let task = try Fixture.decode(TaskSnapshot.self, "task.running")
        #expect(task.state == .running)
        #expect(task.revision == 3)
        #expect(task.lastObserved?.frontmostBundleId == "com.apple.Notes")
        #expect(task.lastObserved?.verification == .accessibility)
    }

    @Test func toleratesBackendFrozenTaskShape() throws {
        let task = try Fixture.decode(TaskSnapshot.self, "task.backendFrozen")
        #expect(task.state == .accepted)
        #expect(task.lastObserved == nil)
    }

    @Test func decodesGeneralActions() throws {
        let open = try Fixture.decode(Command.self, "command.openApp")
        #expect(open.action == .openApp(bundleId: "com.apple.Notes"))

        let type = try Fixture.decode(Command.self, "command.typeText")
        #expect(type.action == .typeText(text: "milk", target: .element(id: "ax_7")))

        let stop = try Fixture.decode(Command.self, "command.stop")
        #expect(stop.action == .stop)
    }

    @Test func unknownActionDecodesAsUnsupportedAndIgnoresExtraFields() throws {
        let command = try Fixture.decode(Command.self, "command.unknownAction")
        #expect(command.action == .unsupported(type: "runShell"))
        #expect(CommandValidator.validate(command, forDevice: "dev_demo_mac") == .unsupportedAction)
    }

    @Test func decodesResultsAndReceipt() throws {
        let succeeded = try Fixture.decode(DeviceResult.self, "result.succeeded")
        #expect(succeeded.outcome == .succeeded)
        #expect(succeeded.observed?.focusedElement?.value == "milk")

        let unverified = try Fixture.decode(DeviceResult.self, "result.unverified")
        #expect(unverified.outcome == .unverified)
        #expect(unverified.observed?.verification == .screenshotOnly)

        let receipt = try Fixture.decode(Receipt.self, "receipt.recorded")
        #expect(receipt.status == .recorded)
    }

    @Test func decodesEventAndError() throws {
        let event = try Fixture.decode(TaskEvent.self, "event.resultRecorded")
        #expect(event.seq == 7)
        #expect(event.data["commandId"]?.stringValue == "cmd_demo_002")

        let error = try Fixture.decode(APIErrorBody.self, "error.staleRevision")
        #expect(error.code == .staleRevision)
        #expect(error.error.currentRevision == 2)
    }

    @Test func actionRoundTrips() throws {
        let actions: [Action] = [
            .observe,
            .openApp(bundleId: "com.apple.TextEdit"),
            .click(target: .point(x: 10, y: 20)),
            .typeText(text: "hello", target: nil),
            .keyCombo(KeyCombo(modifiers: [.command], key: "n")),
            .scroll(dx: 0, dy: -3, target: .element(id: "ax_1")),
            .stop,
        ]
        for action in actions {
            let data = try WireJSON.encoder().encode(action)
            #expect(try WireJSON.decoder().decode(Action.self, from: data) == action)
        }
    }
}
