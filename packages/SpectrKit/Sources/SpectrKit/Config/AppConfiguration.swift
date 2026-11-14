import Foundation

/// Non-secret client settings read from the app's Info.plist (populated by xcconfig).
///
/// Missing or unsafe values are explicit errors: a Release build must never fall back to
/// a development server or fixture transport.
public struct AppConfiguration: Sendable, Equatable {
    public enum Environment: String, Sendable {
        case development
        case production
    }

    public enum ConfigurationError: Error, Sendable, Equatable {
        case missing(key: String)
        case invalidURL(key: String)
        case insecureOrigin
    }

    public var environment: Environment
    public var apiOrigin: URL
    public var linkHost: String

    public static let environmentKey = "SpectrEnvironment"
    public static let apiOriginKey = "SpectrAPIOrigin"
    public static let linkHostKey = "SpectrLinkHost"

    /// Loads configuration from an Info.plist dictionary.
    /// Production requires an HTTPS origin; development also allows `http://localhost`.
    public static func load(from info: [String: Any]) throws(ConfigurationError) -> AppConfiguration {
        let environment =
            Environment(
                rawValue: (info[environmentKey] as? String) ?? ""
            ) ?? .production

        guard let originString = nonEmpty(info[apiOriginKey]) else {
            throw .missing(key: apiOriginKey)
        }
        guard let origin = URL(string: originString), let scheme = origin.scheme, origin.host() != nil
        else { throw .invalidURL(key: apiOriginKey) }

        let isLocal = origin.host() == "localhost" || origin.host() == "127.0.0.1"
        switch (scheme, environment) {
        case ("https", _):
            break
        case ("http", .development) where isLocal:
            break
        default:
            throw .insecureOrigin
        }

        guard let linkHost = nonEmpty(info[linkHostKey]) else {
            throw .missing(key: linkHostKey)
        }
        return AppConfiguration(environment: environment, apiOrigin: origin, linkHost: linkHost)
    }

    private static func nonEmpty(_ value: Any?) -> String? {
        guard let string = (value as? String)?.trimmingCharacters(in: .whitespaces),
            !string.isEmpty, !string.hasPrefix("$(")
        else { return nil }
        return string
    }
}
