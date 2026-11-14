import Foundation
import SpectrKit
import Testing

@testable import SpectrIOS

actor FakeAuthClient: AuthClient {
    var requestResults: [Result<Void, AuthError>] = []
    var verifyResults: [Result<AuthSession, AuthError>] = []
    var refreshResults: [Result<AuthSession, AuthError>] = []
    var signOutResult: Result<Void, AuthError> = .success(())
    private(set) var refreshCalls = 0
    private(set) var signOutCalls = 0
    private(set) var requestedEmails: [String] = []

    func queue(request: Result<Void, AuthError>) { requestResults.append(request) }
    func queue(verify: Result<AuthSession, AuthError>) { verifyResults.append(verify) }
    func queue(refresh: Result<AuthSession, AuthError>) { refreshResults.append(refresh) }
    func setSignOut(_ result: Result<Void, AuthError>) { signOutResult = result }

    func requestCode(email: String) async throws(AuthError) {
        requestedEmails.append(email)
        guard !requestResults.isEmpty else { return }
        try requestResults.removeFirst().get()
    }

    func verify(email: String, code: String) async throws(AuthError) -> AuthSession {
        guard !verifyResults.isEmpty else { throw .server("unexpected verify") }
        return try verifyResults.removeFirst().get()
    }

    func refresh(refreshToken: String) async throws(AuthError) -> AuthSession {
        refreshCalls += 1
        try? await Task.sleep(for: .milliseconds(30))
        guard !refreshResults.isEmpty else { throw .server("unexpected refresh") }
        return try refreshResults.removeFirst().get()
    }

    func signOut(accessToken: String) async throws(AuthError) {
        signOutCalls += 1
        try signOutResult.get()
    }
}

@MainActor
@Suite("Auth model")
struct AuthModelTests {
    nonisolated static let t0 = Date(timeIntervalSince1970: 1_800_000_000)
    let client = FakeAuthClient()
    let store = MemoryCredentialStore()
    let pending: PendingEmailStore

    init() throws {
        let defaults = try #require(UserDefaults(suiteName: "auth-tests-\(UUID().uuidString)"))
        pending = PendingEmailStore(defaults: defaults)
    }

    func session(user: String = "user_1", token: String = "at_1", expiresIn: TimeInterval = 3_600) -> AuthSession {
        AuthSession(
            accessToken: token, refreshToken: "rt_\(token)", expiresAt: Self.t0.addingTimeInterval(expiresIn),
            userId: user, email: "sam@example.test"
        )
    }

    func model() -> AuthModel {
        AuthModel(client: client, store: store, pending: pending, now: { Self.t0 })
    }

    func seedStore(_ session: AuthSession) throws {
        try store.save(try WireJSON.encoder().encode(session))
    }

    @Test func freshInstallStartsSignedOut() async {
        let auth = model()
        await auth.restore()
        #expect(auth.state == .signedOut)
    }

    @Test func fullSignInPersistsTheSession() async throws {
        let auth = model()
        await auth.restore()
        await auth.requestCode(email: " Sam@Example.test ")
        #expect(auth.state == .awaitingCode(email: "sam@example.test"))
        await client.queue(verify: .success(session()))
        await auth.verify(code: "123456")
        #expect(auth.state == .signedIn(userId: "user_1", email: "sam@example.test"))
        #expect(store.load() != nil)
        #expect(pending.email == nil)
        #expect(try await auth.accessToken() == "at_1")
    }

    @Test func wrongCodeKeepsTheUserOnTheCodeStep() async {
        let auth = model()
        await auth.restore()
        await auth.requestCode(email: "sam@example.test")
        await client.queue(verify: .failure(.invalidCode))
        await auth.verify(code: "000000")
        #expect(auth.state == .awaitingCode(email: "sam@example.test"))
        #expect(auth.errorMessage == AuthModel.message(for: .invalidCode))
        #expect(store.load() == nil)
    }

    @Test func interruptedSignInResumesAtTheCodeStep() async {
        let first = model()
        await first.restore()
        await first.requestCode(email: "sam@example.test")
        // App is killed and relaunched before the code is entered.
        let relaunched = model()
        await relaunched.restore()
        #expect(relaunched.state == .awaitingCode(email: "sam@example.test"))
    }

    @Test func failedCodeRequestStaysOnEmailStep() async {
        let auth = model()
        await auth.restore()
        await client.queue(request: .failure(.rateLimited))
        await auth.requestCode(email: "sam@example.test")
        #expect(auth.state == .signedOut)
        #expect(auth.errorMessage == AuthModel.message(for: .rateLimited))
    }

    @Test func restoresAValidSessionWithoutNetwork() async throws {
        try seedStore(session())
        let auth = model()
        await auth.restore()
        #expect(auth.state == .signedIn(userId: "user_1", email: "sam@example.test"))
        #expect(await client.refreshCalls == 0)
    }

    @Test func expiredSessionIsRefreshedOnRestore() async throws {
        try seedStore(session(token: "at_old", expiresIn: -10))
        await client.queue(refresh: .success(session(token: "at_new")))
        let auth = model()
        await auth.restore()
        #expect(try await auth.accessToken() == "at_new")
        #expect(await client.refreshCalls == 1)
    }

    @Test func deadRefreshTokenSignsOutAndClearsTheStore() async throws {
        try seedStore(session(expiresIn: -10))
        await client.queue(refresh: .failure(.sessionExpired))
        let auth = model()
        await auth.restore()
        #expect(auth.state == .signedOut)
        #expect(store.load() == nil)
    }

    @Test func offlineAtLaunchKeepsTheSession() async throws {
        try seedStore(session(expiresIn: -10))
        await client.queue(refresh: .failure(.offline))
        let auth = model()
        await auth.restore()
        #expect(auth.state == .signedIn(userId: "user_1", email: "sam@example.test"))
        #expect(store.load() != nil)
    }

    @Test func concurrentCallersShareOneRefresh() async throws {
        try seedStore(session(token: "at_old", expiresIn: 3_600))
        let auth = AuthModel(
            client: client, store: store, pending: pending, now: { Self.t0.addingTimeInterval(3_590) }
        )
        // Restore sees an expiring token and refreshes once; queue a second in case of a duplicate.
        await client.queue(refresh: .success(session(token: "at_new", expiresIn: 7_200)))
        async let restore: Void = auth.restore()
        async let token = try? auth.accessToken()
        _ = await (restore, token)
        #expect(await client.refreshCalls == 1)
    }

    @Test func signOutClearsEverythingEvenWhenTheServerIsUnreachable() async throws {
        try seedStore(session())
        await client.setSignOut(.failure(.offline))
        let auth = model()
        await auth.restore()
        var notified = false
        auth.onSignedOut = { notified = true }
        await auth.signOut()
        #expect(auth.state == .signedOut)
        #expect(store.load() == nil)
        #expect(notified)
        #expect(await client.signOutCalls == 1)
        await #expect(throws: AuthError.sessionExpired) { try await auth.accessToken() }
    }

    @Test func aSecondUserNeverInheritsTheFirstUsersSession() async throws {
        let auth = model()
        await auth.restore()
        await auth.requestCode(email: "sam@example.test")
        await client.queue(verify: .success(session(user: "user_1", token: "at_1")))
        await auth.verify(code: "123456")
        await auth.signOut()

        await auth.requestCode(email: "alex@example.test")
        await client.queue(verify: .success(session(user: "user_2", token: "at_2")))
        await auth.verify(code: "654321")
        #expect(auth.state == .signedIn(userId: "user_2", email: "sam@example.test"))
        #expect(try await auth.accessToken() == "at_2")
    }
}
