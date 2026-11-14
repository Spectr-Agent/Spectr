import Foundation

/// JSON coding shared by every Spectr wire type.
///
/// Timestamps follow the backend's ISO 8601 format with optional fractional seconds
/// (`2026-11-13T12:00:00.000Z`). Unknown object keys are ignored by `Decodable`, so
/// additive backend fields never break older clients.
public enum WireJSON {
    public static func decoder() -> JSONDecoder {
        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .custom { decoder in
            let container = try decoder.singleValueContainer()
            let raw = try container.decode(String.self)
            if let date = parseTimestamp(raw) {
                return date
            }
            throw DecodingError.dataCorruptedError(
                in: container,
                debugDescription: "Expected an ISO 8601 timestamp."
            )
        }
        return decoder
    }

    public static func encoder() -> JSONEncoder {
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.sortedKeys]
        encoder.dateEncodingStrategy = .custom { date, encoder in
            var container = encoder.singleValueContainer()
            try container.encode(formatTimestamp(date))
        }
        return encoder
    }

    static func parseTimestamp(_ raw: String) -> Date? {
        if let date = try? Date(raw, strategy: fractionalStrategy) {
            return date
        }
        return try? Date(raw, strategy: wholeSecondStrategy)
    }

    static func formatTimestamp(_ date: Date) -> String {
        date.formatted(fractionalStrategy)
    }

    private static let fractionalStrategy = Date.ISO8601FormatStyle(includingFractionalSeconds: true)
    private static let wholeSecondStrategy = Date.ISO8601FormatStyle()
}
