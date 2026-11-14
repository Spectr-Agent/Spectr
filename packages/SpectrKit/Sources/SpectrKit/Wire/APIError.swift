import Foundation

/// Error body returned by the Spectr API. Matches the backend `ApiErrorSchema`.
public struct APIErrorBody: Codable, Sendable, Equatable {
    public struct Detail: Codable, Sendable, Equatable {
        public var code: String
        public var message: String
        public var currentRevision: Int?
    }

    public var error: Detail

    /// Known codes. Unknown codes decode as a plain string and are shown generically.
    public enum Code: String, Sendable {
        case staleRevision, notFound, forbidden, invalidRequest, deviceOffline, duplicate
    }

    public var code: Code? { Code(rawValue: error.code) }
}
