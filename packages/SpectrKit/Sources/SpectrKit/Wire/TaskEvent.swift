import Foundation

/// One entry in a task's ordered event log. Matches the backend `EventSchema`.
/// `data` is kept as raw JSON so new event payloads never break decoding.
public struct TaskEvent: Codable, Sendable, Equatable {
    public var taskId: String
    public var seq: Int
    public var type: String
    public var data: JSONValue
    public var at: Date

    public static let knownTypes: Set<String> = [
        "taskCreated", "stateChanged", "commandIssued", "resultRecorded", "question", "error",
    ]
}

/// Untyped JSON, used where the payload shape is owned by another workstream.
public enum JSONValue: Codable, Sendable, Equatable {
    case null
    case bool(Bool)
    case number(Double)
    case string(String)
    case array([JSONValue])
    case object([String: JSONValue])

    public init(from decoder: any Decoder) throws {
        let container = try decoder.singleValueContainer()
        if container.decodeNil() {
            self = .null
        } else if let value = try? container.decode(Bool.self) {
            self = .bool(value)
        } else if let value = try? container.decode(Double.self) {
            self = .number(value)
        } else if let value = try? container.decode(String.self) {
            self = .string(value)
        } else if let value = try? container.decode([JSONValue].self) {
            self = .array(value)
        } else {
            self = .object(try container.decode([String: JSONValue].self))
        }
    }

    public func encode(to encoder: any Encoder) throws {
        var container = encoder.singleValueContainer()
        switch self {
        case .null: try container.encodeNil()
        case .bool(let value): try container.encode(value)
        case .number(let value): try container.encode(value)
        case .string(let value): try container.encode(value)
        case .array(let value): try container.encode(value)
        case .object(let value): try container.encode(value)
        }
    }

    public subscript(key: String) -> JSONValue? {
        if case .object(let object) = self { return object[key] }
        return nil
    }

    public var stringValue: String? {
        if case .string(let value) = self { return value }
        return nil
    }
}

/// Merges event pages into a gap-free, duplicate-free sequence.
public struct EventCursor: Sendable, Equatable {
    public private(set) var lastSeq: Int

    public init(lastSeq: Int = 0) {
        self.lastSeq = lastSeq
    }

    public enum Outcome: Sendable, Equatable {
        /// Events to apply, in order. May be empty if everything was a duplicate.
        case apply([TaskEvent])
        /// A sequence gap: refetch the task snapshot before applying anything else.
        case gap(expected: Int, received: Int)
    }

    /// Accepts a page of events that may be duplicated or out of order.
    public mutating func ingest(_ events: [TaskEvent]) -> Outcome {
        var fresh: [TaskEvent] = []
        var next = lastSeq + 1
        for event in events.sorted(by: { $0.seq < $1.seq }) where event.seq >= next {
            guard event.seq == next else {
                lastSeq = next - 1
                return fresh.isEmpty ? .gap(expected: next, received: event.seq) : .apply(fresh)
            }
            fresh.append(event)
            next += 1
        }
        lastSeq = next - 1
        return .apply(fresh)
    }

    /// Resets the cursor after a full snapshot refetch.
    public mutating func reset(to seq: Int) {
        lastSeq = seq
    }
}
