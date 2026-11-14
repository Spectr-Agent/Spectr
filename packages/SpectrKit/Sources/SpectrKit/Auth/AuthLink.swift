import CryptoKit
import Foundation

/// A PKCE pair. The verifier stays on this device; only the challenge is sent when
/// requesting the email. A link opened by any other app or device cannot finish
/// sign-in because it lacks the verifier.
public struct PKCE: Codable, Sendable, Equatable {
    public var verifier: String
    public var challenge: String

    public init(verifier: String) {
        self.verifier = verifier
        self.challenge = Self.base64URL(Data(SHA256.hash(data: Data(verifier.utf8))))
    }

    /// A fresh pair from 32 cryptographically random bytes.
    public static func generate() -> PKCE {
        var generator = SystemRandomNumberGenerator()
        let bytes = (0..<32).map { _ in UInt8.random(in: .min ... .max, using: &generator) }
        return PKCE(verifier: base64URL(Data(bytes)))
    }

    static func base64URL(_ data: Data) -> String {
        data.base64EncodedString()
            .replacingOccurrences(of: "+", with: "-")
            .replacingOccurrences(of: "/", with: "_")
            .replacingOccurrences(of: "=", with: "")
    }
}

/// The result of opening the app from an emailed sign-in link.
public enum AuthCallback: Sendable, Equatable {
    /// The link was verified; exchange this code (with the stored verifier) for a session.
    case code(String)
    /// Supabase rejected the link, e.g. it expired or was already used.
    case failure(AuthError)

    /// Parses an incoming URL. Returns nil when the URL is not this app's auth callback,
    /// so unrelated links are never treated as sign-in attempts.
    public static func parse(_ url: URL, expected: URL) -> AuthCallback? {
        guard let scheme = url.scheme?.lowercased(), scheme == expected.scheme?.lowercased(),
            url.host()?.lowercased() == expected.host()?.lowercased(),
            url.user() == nil, url.port == nil
        else { return nil }

        // Supabase reports errors in the query or, for some flows, the fragment.
        var items = URLComponents(url: url, resolvingAgainstBaseURL: false)?.queryItems ?? []
        if let fragment = url.fragment(), var parsed = URLComponents(string: "") {
            parsed.percentEncodedQuery = fragment
            items += parsed.queryItems ?? []
        }
        func value(_ name: String) -> String? { items.first { $0.name == name }?.value }

        if value("error") != nil || value("error_code") != nil {
            let code = value("error_code") ?? ""
            if code == "otp_expired" || code == "flow_state_expired" || code == "flow_state_not_found" {
                return .failure(.invalidCode)
            }
            return .failure(
                .server(
                    value("error_description")?.replacingOccurrences(of: "+", with: " ") ?? "Sign-in was not completed."
                ))
        }

        guard let code = value("code"), (8...256).contains(code.count),
            code.unicodeScalars.allSatisfy(allowedCodeCharacters.contains)
        else { return .failure(.invalidCode) }
        return .code(code)
    }

    private static let allowedCodeCharacters = CharacterSet(
        charactersIn: "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-_."
    )
}
