import Foundation

/// A parsed "Watch live" Universal Link.
///
/// The link carries only an opaque, single-use token. It never carries a room grant,
/// task ID or user ID; the app redeems the token over an authenticated request.
/// PROVISIONAL path shape: `https://<link host>/w/<token>`.
public struct WatchLink: Sendable, Equatable {
    public var token: String

    public enum ParseError: Error, Sendable, Equatable {
        case wrongScheme
        case wrongHost
        case wrongPath
        case malformedToken
    }

    public static let tokenAlphabet = CharacterSet(
        charactersIn: "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-_"
    )

    /// Parses `url`, accepting only HTTPS links on `expectedHost`.
    public static func parse(_ url: URL, expectedHost: String) throws(ParseError) -> WatchLink {
        guard url.scheme?.lowercased() == "https" else { throw .wrongScheme }
        guard let host = url.host()?.lowercased(), host == expectedHost.lowercased(),
            url.port == nil, url.user() == nil
        else { throw .wrongHost }
        let parts = url.pathComponents.filter { $0 != "/" }
        guard parts.count == 2, parts[0] == "w" else { throw .wrongPath }
        let token = parts[1]
        guard (16...128).contains(token.count),
            token.unicodeScalars.allSatisfy(tokenAlphabet.contains)
        else { throw .malformedToken }
        return WatchLink(token: token)
    }
}
