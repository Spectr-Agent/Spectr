import Foundation
import SpectrKit
import Testing

/// Exercises the real Keychain inside the test host app. This fails when the app is
/// built without code signing (no entitlements), which is exactly the failure that
/// in-memory stores cannot catch.
@Suite("Keychain credential store")
struct KeychainCredentialStoreTests {
    @Test func savesLoadsOverwritesAndClears() throws {
        let store = KeychainCredentialStore(service: "spectr.tests.\(UUID().uuidString)", account: "session")
        defer { store.clear() }
        #expect(store.load() == nil)

        try store.save(Data("first".utf8))
        #expect(store.load() == Data("first".utf8))

        try store.save(Data("second".utf8))
        #expect(store.load() == Data("second".utf8))

        store.clear()
        #expect(store.load() == nil)
    }

    @Test func separateAccountsDoNotShareData() throws {
        let service = "spectr.tests.\(UUID().uuidString)"
        let session = KeychainCredentialStore(service: service, account: "auth-session")
        let pending = KeychainCredentialStore(service: service, account: "pending-sign-in")
        defer {
            session.clear()
            pending.clear()
        }
        try session.save(Data("session".utf8))
        #expect(pending.load() == nil)
    }
}
