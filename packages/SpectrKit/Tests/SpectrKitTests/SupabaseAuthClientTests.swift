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
        try await client(transport).requestCode(email: "  Sam@Example.test ", codeChallenge: nil)
        let request = try #require(transport.requests.first)
        #expect(request.url?.absoluteString == "https://project.example.test/auth/v1/otp")
        #expect(request.value(forHTTPHeaderField: "apikey") == "sb_publishable_test")
        #expect(request.value(forHTTPHeaderField: "Authorization") == nil)
        #expect(try body(request)["email"]?.stringValue == "sam@example.test")
    }

    @Test(arguments: ["", "sam", "sam@", "@example.test", "sam@example", "sam @example.test"])
    func rejectsInvalidEmailWithoutANetworkCall(email: String) async throws {
        let transport = ScriptedTransport([])
        await #expect(throws: AuthError.invalidEmail) {
            try await client(transport).requestCode(email: email, codeChallenge: nil)
        }
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
            try await client(limited).requestCode(email: "sam@example.test", codeChallenge: nil)
        }

        let offline = ScriptedTransport([.fail])
        await #expect(throws: AuthError.offline) {
            try await client(offline).requestCode(email: "sam@example.test", codeChallenge: nil)
        }

        let broken = ScriptedTransport([.respond(status: 500, body: "oops")])
        await #expect(throws: AuthError.server("Sign-in failed (HTTP 500).")) {
            try await client(broken).requestCode(email: "sam@example.test", codeChallenge: nil)
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

    @Test func linkSignInSendsChallengeAndRedirect() async throws {
        let transport = ScriptedTransport([.respond(status: 200, body: "{}")])
        let url = try #require(URL(string: "https://project.example.test"))
        let callback = try #require(URL(string: "spectr://auth-callback"))
        let client = SupabaseAuthClient(
            configuration: SupabaseConfiguration(url: url, publishableKey: "sb_publishable_test"),
            redirectURL: callback, transport: transport
        )
        try await client.requestCode(email: "sam@example.test", codeChallenge: "challenge_value")
        let request = try #require(transport.requests.first)
        let items = URLComponents(url: try #require(request.url), resolvingAgainstBaseURL: false)?.queryItems
        #expect(items?.first { $0.name == "redirect_to" }?.value == "spectr://auth-callback")
        let sent = try body(request)
        #expect(sent["code_challenge"]?.stringValue == "challenge_value")
        #expect(sent["code_challenge_method"]?.stringValue == "s256")
    }

    @Test func exchangeTradesAuthCodeAndVerifierForASession() async throws {
        let transport = ScriptedTransport([.respond(status: 200, body: Self.sessionBody)])
        let session = try await client(transport).exchange(authCode: "code_abc12345", codeVerifier: "verifier_xyz")
        #expect(session.userId == "user_1")
        let request = try #require(transport.requests.first)
        #expect(request.url?.query() == "grant_type=pkce")
        let sent = try body(request)
        #expect(sent["auth_code"]?.stringValue == "code_abc12345")
        #expect(sent["code_verifier"]?.stringValue == "verifier_xyz")
    }

    @Test func exchangeWithAWrongVerifierIsRejected() async throws {
        let transport = ScriptedTransport([
            .respond(status: 400, body: #"{"error_code":"bad_code_verifier","msg":"code challenge does not match"}"#)
        ])
        await #expect(throws: AuthError.invalidCode) {
            try await client(transport).exchange(authCode: "code_abc12345", codeVerifier: "wrong")
        }
    }
}

@Suite("Sign-in link")
struct AuthLinkTests {
    let expected = URL(string: "spectr://auth-callback") ?? URL(filePath: "/")

    @Test func pkceMatchesTheRFC7636Example() {
        let pkce = PKCE(verifier: "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk")
        #expect(pkce.challenge == "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM")
    }

    @Test func generatedVerifiersAreUniqueAndURLSafe() {
        let first = PKCE.generate()
        let second = PKCE.generate()
        #expect(first.verifier != second.verifier)
        #expect(first.verifier.count == 43)
        #expect(!first.verifier.contains("+") && !first.verifier.contains("/") && !first.verifier.contains("="))
    }

    @Test func parsesAuthCode() throws {
        let url = try #require(URL(string: "spectr://auth-callback?code=6f1c2a34-aaaa-bbbb-cccc-1234567890ab"))
        #expect(AuthCallback.parse(url, expected: expected) == .code("6f1c2a34-aaaa-bbbb-cccc-1234567890ab"))
    }

    @Test func expiredLinkIsReportedFromQueryOrFragment() throws {
        let query = try #require(
            URL(
                string:
                    "spectr://auth-callback?error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid"
            )
        )
        #expect(AuthCallback.parse(query, expected: expected) == .failure(.invalidCode))
        let fragment = try #require(URL(string: "spectr://auth-callback#error=access_denied&error_code=otp_expired"))
        #expect(AuthCallback.parse(fragment, expected: expected) == .failure(.invalidCode))
    }

    @Test(arguments: [
        "https://auth-callback/?code=abcdefgh12345678",
        "spectr://other-host?code=abcdefgh12345678",
        "other://auth-callback?code=abcdefgh12345678",
        "https://links.example.test/w/abcDEF0123456789_-xyz",
    ])
    func ignoresURLsThatAreNotTheCallback(raw: String) throws {
        let url = try #require(URL(string: raw))
        #expect(AuthCallback.parse(url, expected: expected) == nil)
    }

    @Test(arguments: [
        "spectr://auth-callback",
        "spectr://auth-callback?code=short",
        "spectr://auth-callback?code=has%20space%20in%20code",
        "spectr://auth-callback?access_token=stolen",
    ])
    func malformedCallbackNeverYieldsACode(raw: String) throws {
        let url = try #require(URL(string: raw))
        #expect(AuthCallback.parse(url, expected: expected) == .failure(.invalidCode))
    }
}
