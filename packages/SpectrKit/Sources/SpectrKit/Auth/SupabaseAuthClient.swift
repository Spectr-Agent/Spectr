import Foundation

/// The network boundary, so tests can substitute scripted responses and failures.
public protocol HTTPTransport: Sendable {
    func send(_ request: URLRequest) async throws -> (Data, HTTPURLResponse)
}

/// Production transport over `URLSession`. Uses an ephemeral session: no cookies or
/// cached responses are written to disk.
public struct URLSessionTransport: HTTPTransport {
    private let session: URLSession

    public init(session: URLSession = URLSession(configuration: .ephemeral)) {
        self.session = session
    }

    public func send(_ request: URLRequest) async throws -> (Data, HTTPURLResponse) {
        let (data, response) = try await session.data(for: request)
        guard let http = response as? HTTPURLResponse else { throw URLError(.badServerResponse) }
        return (data, http)
    }
}

/// What the app needs from an auth provider.
public protocol AuthClient: Sendable {
    /// Emails a one-time code to `email`.
    func requestCode(email: String) async throws(AuthError)
    /// Exchanges the emailed code for a session.
    func verify(email: String, code: String) async throws(AuthError) -> AuthSession
    func refresh(refreshToken: String) async throws(AuthError) -> AuthSession
    /// Revokes the session server-side. Local sign-out must not depend on this succeeding.
    func signOut(accessToken: String) async throws(AuthError)
}

/// Supabase Auth (GoTrue) over plain HTTPS: email one-time code, refresh, sign-out.
public struct SupabaseAuthClient: AuthClient {
    private let configuration: SupabaseConfiguration
    private let transport: any HTTPTransport
    private let now: @Sendable () -> Date

    public init(
        configuration: SupabaseConfiguration,
        transport: any HTTPTransport = URLSessionTransport(),
        now: @escaping @Sendable () -> Date = { Date() }
    ) {
        self.configuration = configuration
        self.transport = transport
        self.now = now
    }

    public func requestCode(email: String) async throws(AuthError) {
        let address = try Self.normalized(email)
        _ = try await post("otp", body: ["email": .string(address), "create_user": .bool(true)])
    }

    public func verify(email: String, code: String) async throws(AuthError) -> AuthSession {
        let address = try Self.normalized(email)
        let digits = code.filter(\.isNumber)
        guard digits.count == code.count, (6...10).contains(digits.count) else { throw .invalidCode }
        let data = try await post(
            "verify", body: ["type": .string("email"), "email": .string(address), "token": .string(digits)]
        )
        return try decodeSession(data)
    }

    public func refresh(refreshToken: String) async throws(AuthError) -> AuthSession {
        do {
            let data = try await post(
                "token", query: [URLQueryItem(name: "grant_type", value: "refresh_token")],
                body: ["refresh_token": .string(refreshToken)]
            )
            return try decodeSession(data)
        } catch .invalidCode {
            // GoTrue reports a dead refresh token as a 400-class grant error.
            throw .sessionExpired
        }
    }

    public func signOut(accessToken: String) async throws(AuthError) {
        _ = try await post("logout", body: [:], bearer: accessToken)
    }

    // MARK: Plumbing

    private func post(
        _ path: String,
        query: [URLQueryItem] = [],
        body: [String: JSONValue],
        bearer: String? = nil
    ) async throws(AuthError) -> Data {
        var url = configuration.url.appending(path: "auth/v1/\(path)")
        if !query.isEmpty { url.append(queryItems: query) }
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.timeoutInterval = 20
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue(configuration.publishableKey, forHTTPHeaderField: "apikey")
        if let bearer { request.setValue("Bearer \(bearer)", forHTTPHeaderField: "Authorization") }
        request.httpBody = try? WireJSON.encoder().encode(JSONValue.object(body))

        let data: Data
        let response: HTTPURLResponse
        do {
            (data, response) = try await transport.send(request)
        } catch {
            throw .offline
        }
        guard (200..<300).contains(response.statusCode) else {
            throw Self.error(status: response.statusCode, body: data)
        }
        return data
    }

    private func decodeSession(_ data: Data) throws(AuthError) -> AuthSession {
        guard let payload = try? WireJSON.decoder().decode(SessionPayload.self, from: data) else {
            throw .server("The sign-in response could not be read.")
        }
        let expiry =
            payload.expiresAt.map { Date(timeIntervalSince1970: $0) }
            ?? now().addingTimeInterval(payload.expiresIn ?? 3_600)
        return AuthSession(
            accessToken: payload.accessToken,
            refreshToken: payload.refreshToken,
            expiresAt: expiry,
            userId: payload.user.id,
            email: payload.user.email
        )
    }

    static func normalized(_ email: String) throws(AuthError) -> String {
        let address = email.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        let parts = address.split(separator: "@", omittingEmptySubsequences: false)
        guard parts.count == 2, !parts[0].isEmpty, parts[1].contains("."), !parts[1].hasPrefix("."),
            !parts[1].hasSuffix("."), !address.contains(" "), address.count <= 254
        else { throw .invalidEmail }
        return address
    }

    static func error(status: Int, body: Data) -> AuthError {
        let payload = try? JSONDecoder().decode(ErrorPayload.self, from: body)
        let code = payload?.errorCode ?? payload?.error ?? ""
        if status == 429 || code.contains("rate_limit") { return .rateLimited }
        switch code {
        case "otp_expired", "invalid_grant", "refresh_token_not_found", "refresh_token_already_used",
            "session_not_found", "invalid_credentials":
            return .invalidCode
        case "email_address_invalid", "validation_failed", "email_address_not_authorized":
            return .invalidEmail
        default:
            break
        }
        if status == 401 || status == 403 { return .invalidCode }
        return .server(payload?.message ?? "Sign-in failed (HTTP \(status)).")
    }

    private struct SessionPayload: Decodable {
        struct User: Decodable {
            var id: String
            var email: String?
        }

        var accessToken: String
        var refreshToken: String
        var expiresIn: Double?
        var expiresAt: Double?
        var user: User

        enum CodingKeys: String, CodingKey {
            case accessToken = "access_token"
            case refreshToken = "refresh_token"
            case expiresIn = "expires_in"
            case expiresAt = "expires_at"
            case user
        }
    }

    private struct ErrorPayload: Decodable {
        var errorCode: String?
        var error: String?
        var msg: String?
        var errorDescription: String?

        var message: String? { msg ?? errorDescription }

        enum CodingKeys: String, CodingKey {
            case errorCode = "error_code"
            case error
            case msg
            case errorDescription = "error_description"
        }
    }
}
