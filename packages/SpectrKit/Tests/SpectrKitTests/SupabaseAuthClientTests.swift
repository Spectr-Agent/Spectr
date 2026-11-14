import Foundation
import Testing

@testable import SpectrKit

/// Scripted transport: returns queued responses and records every request.
final class ScriptedTransport: HTTPTransport, @unchecked Sendable {
    enum Step {
        case respond(status: Int, body: String)
        case fail
    }

    private let lock = NSLock()
    private var steps: [Step]
    private var recorded: [URLRequest] = []

    init(_ steps: [Step]) {
        self.steps = steps
    }

    var requests: [URLRequest] { lock.withLock { recorded } }

    func send(_ request: URLRequest) async throws -> (Data, HTTPURLResponse) {
        let step: Step? = lock.withLock {
            recorded.append(request)
            return steps.isEmpty ? nil : steps.removeFirst()
        }
        guard let step, case .respond(let status, let body) = step, let url = request.url,
            let response = HTTPURLResponse(url: url, statusCode: status, httpVersion: nil, headerFields: nil)
        else { throw URLError(.notConnectedToInternet) }
        return (Data(body.utf8), response)
    }
}

@Suite("Supabase auth client")
struct SupabaseAuthClientTests {
    static let sessionBody = """
        {"access_token":"at_test","refresh_token":"rt_test","expires_in":3600,"expires_at":1800003600,
         "token_type":"bearer","user":{"id":"user_1","email":"sam@example.test","extra":true}}
        """

    func client(_ transport: ScriptedTransport) throws -> SupabaseAuthClient {
        let url = try #require(URL(string: "https://project.example.test"))
        return SupabaseAuthClient(
            configuration: SupabaseConfiguration(url: url, publishableKey: "sb_publishable_test"),
            transport: transport,
            now: { Date(timeIntervalSince1970: 1_800_000_000) }
        )
    }

    func body(_ request: URLRequest) throws -> JSONValue {
        try JSONDecoder().decode(JSONValue.self, from: try #require(request.httpBody))
    }

    @Test func requestCodePostsNormalizedEmailWithPublishableKey() async throws {
        let transport = ScriptedTransport([.respond(status: 200, body: "{}")])
        try await client(transport).requestCode(email: "  Sam@Example.test ")
        let request = try #require(transport.requests.first)
        #expect(request.url?.absoluteString == "https://project.example.test/auth/v1/otp")
        #expect(request.value(forHTTPHeaderField: "apikey") == "sb_publishable_test")
        #expect(request.value(forHTTPHeaderField: "Authorization") == nil)
        #expect(try body(request)["email"]?.stringValue == "sam@example.test")
    }

    @Test(arguments: ["", "sam", "sam@", "@example.test", "sam@example", "sam @example.test"])
    func rejectsInvalidEmailWithoutANetworkCall(email: String) async throws {
        let transport = ScriptedTransport([])
        await #expect(throws: AuthError.invalidEmail) { try await client(transport).requestCode(email: email) }
        #expect(transport.requests.isEmpty)
    }

    @Test func verifyReturnsSession() async throws {
        let transport = ScriptedTransport([.respond(status: 200, body: Self.sessionBody)])
        let session = try await client(transport).verify(email: "sam@example.test", code: "123456")
        #expect(session.accessToken == "at_test")
        #expect(session.userId == "user_1")
        #expect(session.expiresAt == Date(timeIntervalSince1970: 1_800_003_600))
        let sent = try body(try #require(transport.requests.first))
        #expect(sent["type"]?.stringValue == "email")
        #expect(sent["token"]?.stringValue == "123456")
    }

    @Test(arguments: ["12345", "abcdef", "12 3456", ""])
    func malformedCodeNeverReachesTheServer(code: String) async throws {
        let transport = ScriptedTransport([])
        await #expect(throws: AuthError.invalidCode) {
            try await client(transport).verify(email: "sam@example.test", code: code)
        }
        #expect(transport.requests.isEmpty)
    }

    @Test func mapsServerErrors() async throws {
        let expired = ScriptedTransport([
            .respond(status: 403, body: #"{"code":403,"error_code":"otp_expired","msg":"Token has expired"}"#)
        ])
        await #expect(throws: AuthError.invalidCode) {
            try await client(expired).verify(email: "sam@example.test", code: "123456")
        }

        let limited = ScriptedTransport([
            .respond(status: 429, body: #"{"error_code":"over_email_send_rate_limit","msg":"slow down"}"#)
        ])
        await #expect(throws: AuthError.rateLimited) {
            try await client(limited).requestCode(email: "sam@example.test")
        }

        let offline = ScriptedTransport([.fail])
        await #expect(throws: AuthError.offline) {
            try await client(offline).requestCode(email: "sam@example.test")
        }

        let broken = ScriptedTransport([.respond(status: 500, body: "oops")])
        await #expect(throws: AuthError.server("Sign-in failed (HTTP 500).")) {
            try await client(broken).requestCode(email: "sam@example.test")
        }
    }

    @Test func deadRefreshTokenMeansSessionExpired() async throws {
        let transport = ScriptedTransport([
            .respond(status: 400, body: #"{"error_code":"refresh_token_not_found","msg":"Invalid Refresh Token"}"#)
        ])
        await #expect(throws: AuthError.sessionExpired) {
            try await client(transport).refresh(refreshToken: "rt_dead")
        }
        let request = try #require(transport.requests.first)
        #expect(request.url?.query() == "grant_type=refresh_token")
    }

    @Test func signOutSendsBearerToken() async throws {
        let transport = ScriptedTransport([.respond(status: 204, body: "")])
        try await client(transport).signOut(accessToken: "at_test")
        #expect(transport.requests.first?.value(forHTTPHeaderField: "Authorization") == "Bearer at_test")
    }

    @Test func configurationRejectsSecretKeysAndInsecureURLs() {
        #expect(throws: AppConfiguration.ConfigurationError.missing(key: "SpectrSupabasePublishableKey")) {
            try SupabaseConfiguration.load(from: [
                "SpectrSupabaseURL": "https://project.example.test",
                "SpectrSupabasePublishableKey": "sb_secret_never_in_a_client",
            ])
        }
        #expect(throws: AppConfiguration.ConfigurationError.insecureOrigin) {
            try SupabaseConfiguration.load(from: [
                "SpectrSupabaseURL": "http://project.example.test",
                "SpectrSupabasePublishableKey": "sb_publishable_test",
            ])
        }
    }
}
