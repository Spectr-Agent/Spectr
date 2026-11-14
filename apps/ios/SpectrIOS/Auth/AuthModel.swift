import Foundation
import Observation
import SpectrKit

/// Sign-in state for the iPhone app.
///
/// The session lives in Keychain through `CredentialStore`. Signing out always clears
/// local state, even when the server cannot be reached. An interrupted sign-in (email
/// requested, app closed) resumes at the "check your email" step.
///
/// Sign-in finishes one of two ways: the emailed link reopens the app
/// (`handleCallback`), or the user types the emailed code (`verify`).
@MainActor
@Observable
final class AuthModel {
    enum State: Equatable {
        case restoring
        case signedOut
        case awaitingCode(email: String)
        case signedIn(userId: String, email: String?)
    }

    private(set) var state: State = .restoring
    private(set) var isWorking = false
    private(set) var errorMessage: String?

    private let client: any AuthClient
    private let store: any CredentialStore
    private let pendingStore: any CredentialStore
    private let callbackURL: URL
    private let now: @Sendable () -> Date
    private var session: AuthSession?
    private var refreshTask: Task<AuthSession, any Error>?
    /// Called after local state is cleared, so user-bound screens can tear down.
    var onSignedOut: (() -> Void)?

    init(
        client: any AuthClient,
        store: any CredentialStore,
        pendingStore: any CredentialStore,
        callbackURL: URL,
        now: @escaping @Sendable () -> Date = { Date() }
    ) {
        self.client = client
        self.store = store
        self.pendingStore = pendingStore
        self.callbackURL = callbackURL
        self.now = now
    }

    /// The email a sign-in message was sent to, plus the PKCE verifier that binds the
    /// emailed link to this device. Held in Keychain until sign-in finishes.
    private struct PendingSignIn: Codable {
        var email: String
        var verifier: String
    }

    private var pending: PendingSignIn? {
        get {
            pendingStore.load().flatMap { try? JSONDecoder().decode(PendingSignIn.self, from: $0) }
        }
        set {
            if let newValue, let data = try? JSONEncoder().encode(newValue) {
                try? pendingStore.save(data)
            } else {
                pendingStore.clear()
            }
        }
    }

    // MARK: Launch

    /// Restores a stored session, refreshing it if it is about to expire.
    func restore() async {
        guard state == .restoring else { return }
        guard let data = store.load(),
            let stored = try? WireJSON.decoder().decode(AuthSession.self, from: data)
        else {
            store.clear()
            state = pending.map { .awaitingCode(email: $0.email) } ?? .signedOut
            return
        }
        session = stored
        if stored.needsRefresh(at: now()) {
            do {
                _ = try await refreshed()
            } catch AuthError.sessionExpired {
                clearLocal(message: "Your session ended. Sign in again.")
                return
            } catch {
                // Offline at launch: keep the session and retry on the next request.
            }
        }
        state = .signedIn(userId: stored.userId, email: stored.email)
    }

    // MARK: Sign-in

    func requestCode(email: String) async {
        await run {
            let pkce = PKCE.generate()
            try await self.client.requestCode(email: email, codeChallenge: pkce.challenge)
            let address = email.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
            self.pending = PendingSignIn(email: address, verifier: pkce.verifier)
            self.state = .awaitingCode(email: address)
        }
    }

    /// Goes to the code step without sending another email, for someone who already
    /// has a code for this address. A link cannot finish this attempt; only a code can.
    func enterCode(for email: String) {
        let address = email.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        guard address.contains("@"), !isWorking else {
            errorMessage = Self.message(for: .invalidEmail)
            return
        }
        errorMessage = nil
        pending = PendingSignIn(email: address, verifier: PKCE.generate().verifier)
        state = .awaitingCode(email: address)
    }

    /// Handles the app being opened from the emailed link. Returns false when the URL
    /// is not a sign-in callback, so the caller can route it elsewhere.
    @discardableResult
    func handleCallback(_ url: URL) async -> Bool {
        guard let callback = AuthCallback.parse(url, expected: callbackURL) else { return false }
        if case .signedIn = state { return true }
        switch callback {
        case .failure(.invalidCode):
            errorMessage = "That link has expired or was already used. Send a new one."
        case .failure(let error):
            errorMessage = Self.message(for: error)
        case .code(let code):
            guard let waiting = pending else {
                errorMessage = "Start sign-in on this iPhone, then open the link from the new email."
                return true
            }
            await run {
                let fresh = try await self.client.exchange(authCode: code, codeVerifier: waiting.verifier)
                try self.persist(fresh)
                self.pending = nil
                self.state = .signedIn(userId: fresh.userId, email: fresh.email)
            }
        }
        return true
    }

    func verify(code: String) async {
        guard case .awaitingCode(let email) = state else { return }
        await run {
            let fresh = try await self.client.verify(email: email, code: code)
            try self.persist(fresh)
            self.pending = nil
            self.state = .signedIn(userId: fresh.userId, email: fresh.email)
        }
    }

    /// Returns to the email step, e.g. to fix a typo.
    func changeEmail() {
        pending = nil
        errorMessage = nil
        state = .signedOut
    }

    // MARK: Session use

    /// A valid access token for API calls, refreshing first when needed.
    /// Concurrent callers share one refresh.
    func accessToken() async throws(AuthError) -> String {
        guard let current = session else { throw .sessionExpired }
        guard current.needsRefresh(at: now()) else { return current.accessToken }
        do {
            return try await refreshed().accessToken
        } catch .sessionExpired {
            clearLocal(message: "Your session ended. Sign in again.")
            throw .sessionExpired
        }
    }

    func signOut() async {
        let token = session?.accessToken
        clearLocal(message: nil)
        if let token {
            // Best effort: local sign-out has already happened.
            try? await client.signOut(accessToken: token)
        }
    }

    // MARK: Internals

    private func refreshed() async throws(AuthError) -> AuthSession {
        if let refreshTask {
            return try await Self.value(of: refreshTask)
        }
        guard let current = session else { throw .sessionExpired }
        let client = self.client
        let task = Task { try await client.refresh(refreshToken: current.refreshToken) }
        refreshTask = task
        defer { refreshTask = nil }
        let fresh = try await Self.value(of: task)
        // Ignore the result if the user signed out while the refresh was in flight.
        guard session?.userId == fresh.userId else { throw .sessionExpired }
        do {
            try persist(fresh)
        } catch {
            throw .server("Could not save the session on this device.")
        }
        return fresh
    }

    private static func value(of task: Task<AuthSession, any Error>) async throws(AuthError) -> AuthSession {
        do {
            return try await task.value
        } catch let error as AuthError {
            throw error
        } catch {
            throw .offline
        }
    }

    private func persist(_ fresh: AuthSession) throws {
        try store.save(try WireJSON.encoder().encode(fresh))
        session = fresh
    }

    private func clearLocal(message: String?) {
        refreshTask?.cancel()
        refreshTask = nil
        session = nil
        store.clear()
        pending = nil
        errorMessage = message
        state = .signedOut
        onSignedOut?()
    }

    private func run(_ work: @escaping () async throws -> Void) async {
        guard !isWorking else { return }
        isWorking = true
        errorMessage = nil
        defer { isWorking = false }
        do {
            try await work()
        } catch let error as AuthError {
            errorMessage = Self.message(for: error)
        } catch {
            errorMessage = "Could not save the session on this device."
        }
    }

    static func message(for error: AuthError) -> String {
        switch error {
        case .invalidEmail: "Enter a valid email address."
        case .invalidCode: "That code is wrong or has expired. Check it or send a new email."
        case .rateLimited: "Too many attempts. Wait a minute and try again."
        case .sessionExpired: "Your session ended. Sign in again."
        case .offline: "You're offline. Check your connection and try again."
        case .server(let message): message
        }
    }
}
