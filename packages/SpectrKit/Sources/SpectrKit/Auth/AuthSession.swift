import Foundation

/// A signed-in user's session. The tokens are credentials: they live in Keychain and
/// are never logged.
public struct AuthSession: Codable, Sendable, Equatable {
    public var accessToken: String
    public var refreshToken: String
    public var expiresAt: Date
    public var userId: String
    public var email: String?

    public init(accessToken: String, refreshToken: String, expiresAt: Date, userId: String, email: String?) {
        self.accessToken = accessToken
        self.refreshToken = refreshToken
        self.expiresAt = expiresAt
        self.userId = userId
        self.email = email
    }

    /// True when the access token expires within `leeway` and should be refreshed first.
    public func needsRefresh(at now: Date, leeway: TimeInterval = 60) -> Bool {
        expiresAt.timeIntervalSince(now) <= leeway
    }
}

public enum AuthError: Error, Sendable, Equatable {
    /// The email address was rejected before or by the server.
    case invalidEmail
    /// The code is wrong or has expired.
    case invalidCode
    /// Too many attempts; try again later.
    case rateLimited
    /// The refresh token is no longer valid. The user must sign in again.
    case sessionExpired
    case offline
    case server(String)
}

/// Public Supabase client settings read from Info.plist. The publishable key is
/// designed to ship in apps; the secret key never does.
public struct SupabaseConfiguration: Sendable, Equatable {
    public var url: URL
    public var publishableKey: String

    public static let urlKey = "SpectrSupabaseURL"
    public static let publishableKeyKey = "SpectrSupabasePublishableKey"

    public init(url: URL, publishableKey: String) {
        self.url = url
        self.publishableKey = publishableKey
    }

    public static func load(
        from info: [String: Any]
    ) throws(AppConfiguration.ConfigurationError) -> SupabaseConfiguration {
        guard let rawURL = clean(info[urlKey]) else { throw .missing(key: urlKey) }
        guard let url = URL(string: rawURL), url.host() != nil else { throw .invalidURL(key: urlKey) }
        guard url.scheme == "https" else { throw .insecureOrigin }
        guard let key = clean(info[publishableKeyKey]) else { throw .missing(key: publishableKeyKey) }
        // A secret key must never be configured into a client.
        guard !key.hasPrefix("sb_secret_") else { throw .missing(key: publishableKeyKey) }
        return SupabaseConfiguration(url: url, publishableKey: key)
    }

    private static func clean(_ value: Any?) -> String? {
        guard let string = (value as? String)?.trimmingCharacters(in: .whitespaces),
            !string.isEmpty, !string.hasPrefix("$(")
        else { return nil }
        return string
    }
}
