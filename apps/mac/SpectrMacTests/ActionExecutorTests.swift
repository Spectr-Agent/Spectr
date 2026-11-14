import Foundation
import SpectrKit
import Testing

@testable import SpectrMac

@MainActor
final class FakeDesktop: DesktopDriver {
    var isAccessibilityTrusted = true
    var isScreenLocked = false
    var frontmostBundleId: String? = "com.apple.finder"
    var fieldValue: String? = ""
    var fieldIsSecure = false
    var installedApps: Set<String> = ["com.apple.Notes", "com.apple.TextEdit", "com.apple.Terminal"]
    /// When set, `openApp` brings this app forward instead of the requested one.
    var openAppLandsOn: String?
    /// When true, typing drops the text (simulates an app that ignored input).
    var dropsTypedText = false
    var exposesFieldValue = true
    private(set) var sideEffects: [String] = []

    func observe(includeElements: Bool) -> ObservedState {
        ObservedState(
            frontmostBundleId: frontmostBundleId,
            frontmostAppName: frontmostBundleId,
            windowTitle: "Window",
            focusedElement: .init(
                role: fieldIsSecure ? "AXSecureTextField" : "AXTextArea",
                value: (fieldIsSecure || !exposesFieldValue) ? nil : fieldValue
            ),
            elements: includeElements ? [] : nil,
            verification: .accessibility
        )
    }

    func isSecureField(_ target: Target?) -> Bool { fieldIsSecure }

    func openApp(bundleId: String) async throws(DriverError) {
        guard installedApps.contains(bundleId) else { throw .appNotFound }
        sideEffects.append("open \(bundleId)")
        frontmostBundleId = openAppLandsOn ?? bundleId
    }

    func click(_ target: Target) throws(DriverError) {
        if case .element(let id) = target, id == "missing" { throw .elementNotFound }
        sideEffects.append("click")
    }

    func typeText(_ text: String, into target: Target?) throws(DriverError) {
        sideEffects.append("type \(text)")
        if !dropsTypedText { fieldValue = (fieldValue ?? "") + text }
    }

    func keyCombo(_ combo: KeyCombo) throws(DriverError) {
        guard KeyCodes.virtualKey(for: combo.key) != nil else { throw .unsupportedKey }
        sideEffects.append("key \(combo.key)")
    }

    func scroll(dx: Int, dy: Int, target: Target?) throws(DriverError) {
        sideEffects.append("scroll")
    }

    func settle() async {}
}

@MainActor
@Suite("Action executor")
struct ActionExecutorTests {
    let desktop = FakeDesktop()
    let store = MemoryLedgerStore()
    static let issued = Date(timeIntervalSince1970: 1_800_000_000)

    func executor() -> ActionExecutor {
        ActionExecutor(deviceId: "dev_1", driver: desktop, store: store)
    }

    func command(_ id: String, _ action: Action, revision: Int = 1, device: String = "dev_1") -> Command {
        Command(
            commandId: id, taskId: "tsk_1", deviceId: device, revision: revision, action: action, issuedAt: Self.issued)
    }

    @Test func openAppSucceedsOnlyWhenTheAppIsInFront() async {
        let exec = executor()
        let ok = await exec.handle(command("c1", .openApp(bundleId: "com.apple.Notes")))
        #expect(ok.outcome == .succeeded)
        #expect(ok.observed?.frontmostBundleId == "com.apple.Notes")

        desktop.openAppLandsOn = "com.apple.finder"
        let wrong = await exec.handle(command("c2", .openApp(bundleId: "com.apple.TextEdit"), revision: 2))
        #expect(wrong.outcome == .failed)
    }

    @Test func typedTextIsVerifiedByReadback() async {
        let exec = executor()
        let ok = await exec.handle(command("c1", .typeText(text: "milk", target: nil)))
        #expect(ok.outcome == .succeeded)

        desktop.dropsTypedText = true
        let dropped = await exec.handle(command("c2", .typeText(text: "eggs", target: nil), revision: 2))
        #expect(dropped.outcome == .failed)

        desktop.exposesFieldValue = false
        let opaque = await exec.handle(command("c3", .typeText(text: "tea", target: nil), revision: 3))
        #expect(opaque.outcome == .unverified)
    }

    @Test func duplicateCommandDoesNotRepeatTheSideEffect() async {
        let exec = executor()
        let first = await exec.handle(command("c1", .typeText(text: "milk", target: nil)))
        let again = await exec.handle(command("c1", .typeText(text: "milk", target: nil)))
        #expect(again == first)
        #expect(desktop.sideEffects == ["type milk"])
    }

    @Test func reusedIdWithDifferentPayloadIsRejected() async {
        let exec = executor()
        _ = await exec.handle(command("c1", .typeText(text: "milk", target: nil)))
        let conflict = await exec.handle(command("c1", .typeText(text: "eggs", target: nil)))
        #expect(conflict.outcome == .rejected)
        #expect(conflict.error?.code == CommandErrorCode.duplicateConflict.rawValue)
        #expect(desktop.sideEffects == ["type milk"])
    }

    @Test func staleRevisionAfterCorrectionNeverRuns() async {
        let exec = executor()
        _ = await exec.handle(command("c2", .typeText(text: "eggs", target: nil), revision: 2))
        let stale = await exec.handle(command("c1", .typeText(text: "milk", target: nil), revision: 1))
        #expect(stale.outcome == .rejected)
        #expect(stale.error?.code == CommandErrorCode.staleRevision.rawValue)
        #expect(desktop.sideEffects == ["type eggs"])
    }

    @Test func stopSupersedesQueuedOlderCommands() async {
        let exec = executor()
        let stop = await exec.handle(command("s1", .stop, revision: 5))
        #expect(stop.outcome == .succeeded)
        let late = await exec.handle(command("c1", .typeText(text: "milk", target: nil), revision: 4))
        #expect(late.outcome == .rejected)
        #expect(desktop.sideEffects.isEmpty)
    }

    @Test func blockedAppsAreNeverOperated() async {
        let exec = executor()
        let open = await exec.handle(command("c1", .openApp(bundleId: "com.apple.Terminal")))
        #expect(open.error?.code == CommandErrorCode.appBlocked.rawValue)

        desktop.frontmostBundleId = "com.apple.Terminal"
        let type = await exec.handle(command("c2", .typeText(text: "ls", target: nil), revision: 2))
        #expect(type.error?.code == CommandErrorCode.appBlocked.rawValue)
        #expect(desktop.sideEffects.isEmpty)
    }

    @Test func neverTypesIntoPasswordFields() async {
        desktop.fieldIsSecure = true
        let result = await executor().handle(command("c1", .typeText(text: "secret", target: nil)))
        #expect(result.error?.code == CommandErrorCode.secureField.rawValue)
        #expect(desktop.sideEffects.isEmpty)
    }

    @Test func lockedDesktopAndMissingPermissionAreDistinct() async {
        let exec = executor()
        desktop.isScreenLocked = true
        let locked = await exec.handle(command("c1", .observe))
        #expect(locked.error?.code == CommandErrorCode.desktopLocked.rawValue)

        desktop.isScreenLocked = false
        desktop.isAccessibilityTrusted = false
        let denied = await exec.handle(command("c2", .observe, revision: 2))
        #expect(denied.error?.code == CommandErrorCode.accessibilityDenied.rawValue)
    }

    @Test func wrongDeviceAndUnknownActionAreRejectedBeforeAnySideEffect() async {
        let exec = executor()
        let wrong = await exec.handle(command("c1", .observe, device: "dev_other"))
        #expect(wrong.error?.code == CommandErrorCode.wrongDevice.rawValue)
        let unknown = await exec.handle(command("c2", .unsupported(type: "runShell")))
        #expect(unknown.error?.code == CommandErrorCode.unsupportedAction.rawValue)
    }

    @Test func clicksAndKeysAreReportedUnverified() async {
        let exec = executor()
        let click = await exec.handle(command("c1", .click(target: .point(x: 5, y: 5))))
        #expect(click.outcome == .unverified)
        let key = await exec.handle(command("c2", .keyCombo(KeyCombo(modifiers: [.command], key: "n")), revision: 2))
        #expect(key.outcome == .unverified)
        let missing = await exec.handle(command("c3", .click(target: .element(id: "missing")), revision: 3))
        #expect(missing.outcome == .failed)
        #expect(missing.error?.code == CommandErrorCode.elementNotFound.rawValue)
    }

    @Test func relaunchMidActionReconcilesInsteadOfRepeating() async throws {
        var ledger = CommandLedger()
        let pending = command("c1", .typeText(text: "milk", target: nil))
        ledger.markStarted(pending, at: .now)
        try store.save(ledger)

        let exec = executor()
        #expect(await exec.unfinishedCommands == [pending])
        let result = await exec.handle(pending)
        #expect(result.outcome == .unverified)
        #expect(desktop.sideEffects.isEmpty)
    }

    @Test func startedMarkIsPersistedBeforeTheSideEffect() async {
        let exec = executor()
        _ = await exec.handle(command("c1", .typeText(text: "milk", target: nil)))
        #expect(store.saveCount >= 2)
    }
}

@Suite("App policy")
struct AppPolicyTests {
    @Test(arguments: ["com.apple.Terminal", "com.1password.1password", "com.apple.ScriptEditor2"])
    func blocks(bundleId: String) {
        #expect(AppPolicy.standard.isBlocked(bundleId))
    }

    @Test(arguments: ["com.apple.Notes", "com.apple.TextEdit", "com.apple.Safari"])
    func allows(bundleId: String) {
        #expect(!AppPolicy.standard.isBlocked(bundleId))
    }
}
