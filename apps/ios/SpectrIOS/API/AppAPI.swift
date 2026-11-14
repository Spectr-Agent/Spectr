import Foundation
import SpectrKit

// The iPhone's view of Spectr's `/api/app/*` routes. Every request carries the signed-in
// user's Supabase access token; the server only ever returns that user's own data.

struct AppHome: Decodable, Equatable, Sendable {
    struct User: Decodable, Equatable, Sendable {
        var userId: String
        var email: String?
    }

    var user: User
    var macs: [AppMac]
    var phones: [String]
    var pendingPhone: PendingPhone?
    var spectrNumber: String
    var activeTask: AppTask?
    var recentTasks: [AppTask]
}

struct PendingPhone: Decodable, Equatable, Sendable {
    var phone: String
    var expiresAt: Date
}

struct AppMac: Decodable, Equatable, Sendable, Identifiable {
    enum Status: String, Decodable, Sendable {
        case online
        case offline
    }

    var deviceId: String
    var name: String
    var status: Status
    /// nil when the server couldn't tell.
    var sharing: Bool?
    var lastSeenAt: Date?

    var id: String { deviceId }
    var isOnline: Bool { status == .online }
}

struct AppTask: Decodable, Equatable, Sendable, Identifiable {
    var taskId: String
    var deviceId: String
    var state: TaskState
    var revision: Int
    var instruction: String
    var question: String?
    var needsApproval: Bool
    var summary: String?
    var activity: String?
    var stepCount: Int
    var source: String?
    var createdAt: Date
    var updatedAt: Date
    var screenshotURL: URL?

    var id: String { taskId }
    var isActive: Bool { !state.isTerminal }

    enum CodingKeys: String, CodingKey {
        case taskId, deviceId, state, revision, instruction, question, needsApproval, summary, activity
        case stepCount, source, createdAt, updatedAt
        case screenshotURL = "screenshotUrl"
    }
}

struct LiveGrant: Decodable, Equatable, Sendable {
    enum Mode: String, Codable, Sendable {
        case watch
        case call
    }

    var url: String
    var token: String
    var room: String
    var identity: String
    var mode: Mode
    var expiresAt: Date
    var deviceId: String
}

struct MessageResult: Decodable, Equatable, Sendable {
    /// task, correction, answer or stop.
    var kind: String
    var created: Bool
    var task: AppTask?
}

struct PhoneLinkResult: Decodable, Equatable, Sendable {
    /// "pending" until the number calls Spectr; "linked" when it already is.
    var status: String
    var phone: String
    var callNumber: String
    var expiresAt: Date?
}

struct PairResult: Decodable, Equatable, Sendable {
    var deviceId: String
    var name: String
}

enum AppAPIError: Error, Equatable, Sendable {
    case signedOut
    case offline
    case noMac
    case phoneTaken(String)
    case notFound(String)
    case invalid(String)
    case server(String)

    var message: String {
        switch self {
        case .signedOut: "Your sign-in expired. Sign in again."
        case .offline: "You're offline. Check your connection."
        case .noMac: "Pair a Mac first."
        case .phoneTaken(let message), .notFound(let message), .invalid(let message), .server(let message): message
        }
    }
}

protocol AppAPI: Sendable {
    func home() async throws(AppAPIError) -> AppHome
    func task(id: String) async throws(AppAPIError) -> AppTask
    func send(text: String, clientMessageId: String, deviceId: String?) async throws(AppAPIError) -> MessageResult
    func stop(taskId: String, clientMessageId: String) async throws(AppAPIError) -> MessageResult
    func live(mode: LiveGrant.Mode, deviceId: String?) async throws(AppAPIError) -> LiveGrant
    func pair(code: String) async throws(AppAPIError) -> PairResult
    func linkPhone(_ phone: String) async throws(AppAPIError) -> PhoneLinkResult
    func unlinkPhone(_ phone: String) async throws(AppAPIError)
}

/// Production client over HTTPS.
struct HTTPAppAPI: AppAPI {
    let origin: URL
    /// Returns a fresh access token, refreshing it when needed.
    let accessToken: @Sendable () async throws -> String
    var transport: any HTTPTransport = URLSessionTransport()

    func home() async throws(AppAPIError) -> AppHome {
        try await request("GET", "api/app/home")
    }

    func task(id: String) async throws(AppAPIError) -> AppTask {
        struct Body: Decodable { var task: AppTask }
        let body: Body = try await request("GET", "api/app/task", query: ["id": id])
        return body.task
    }

    func send(text: String, clientMessageId: String, deviceId: String?) async throws(AppAPIError) -> MessageResult {
        var body = ["text": text, "clientMessageId": clientMessageId]
        if let deviceId { body["deviceId"] = deviceId }
        return try await request("POST", "api/app/message", body: body)
    }

    func stop(taskId: String, clientMessageId: String) async throws(AppAPIError) -> MessageResult {
        try await request("POST", "api/app/stop", body: ["taskId": taskId, "clientMessageId": clientMessageId])
    }

    func live(mode: LiveGrant.Mode, deviceId: String?) async throws(AppAPIError) -> LiveGrant {
        var body = ["mode": mode.rawValue]
        if let deviceId { body["deviceId"] = deviceId }
        return try await request("POST", "api/app/live", body: body)
    }

    func pair(code: String) async throws(AppAPIError) -> PairResult {
        try await request("POST", "api/app/pair", body: ["code": code])
    }

    func linkPhone(_ phone: String) async throws(AppAPIError) -> PhoneLinkResult {
        try await request("POST", "api/app/phone", body: ["phone": phone])
    }

    func unlinkPhone(_ phone: String) async throws(AppAPIError) {
        struct Ignored: Decodable {}
        let _: Ignored = try await request("DELETE", "api/app/phone", query: ["phone": phone])
    }

    // MARK: Transport

    private func request<T: Decodable>(
        _ method: String, _ path: String, query: [String: String] = [:], body: [String: String]? = nil
    ) async throws(AppAPIError) -> T {
        let token: String
        do {
            token = try await accessToken()
        } catch {
            throw .signedOut
        }
        var components = URLComponents(url: origin.appending(path: path), resolvingAgainstBaseURL: false)
        if !query.isEmpty {
            components?.queryItems = query.map { URLQueryItem(name: $0.key, value: $0.value) }
        }
        guard let url = components?.url else { throw .invalid("Bad request.") }
        var request = URLRequest(url: url)
        request.httpMethod = method
        request.timeoutInterval = 20
        request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        if let body {
            request.setValue("application/json", forHTTPHeaderField: "Content-Type")
            request.httpBody = try? JSONEncoder().encode(body)
        }
        let data: Data
        let response: HTTPURLResponse
        do {
            (data, response) = try await transport.send(request)
        } catch {
            throw .offline
        }
        guard (200..<300).contains(response.statusCode) else {
            throw Self.error(status: response.statusCode, data: data)
        }
        do {
            return try Self.decoder.decode(T.self, from: data)
        } catch {
            throw .server("Spectr sent something this version of the app doesn't understand.")
        }
    }

    static func error(status: Int, data: Data) -> AppAPIError {
        struct Envelope: Decodable {
            struct Detail: Decodable {
                var code: String
                var message: String
            }
            var error: Detail
        }
        let detail = (try? JSONDecoder().decode(Envelope.self, from: data))?.error
        let message = detail?.message ?? "Something went wrong on Spectr's side. Try again."
        switch (status, detail?.code) {
        case (401, _): return .signedOut
        case (_, "noMac"): return .noMac
        case (_, "phoneTaken"): return .phoneTaken(message)
        case (404, _): return .notFound(message)
        case (400, _), (410, _): return .invalid(message)
        default: return .server(message)
        }
    }

    static let decoder: JSONDecoder = {
        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .custom { decoder in
            let text = try decoder.singleValueContainer().decode(String.self)
            let fractional = ISO8601DateFormatter()
            fractional.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
            if let date = fractional.date(from: text) ?? ISO8601DateFormatter().date(from: text) { return date }
            throw DecodingError.dataCorrupted(
                .init(codingPath: decoder.codingPath, debugDescription: "Bad date \(text)"))
        }
        return decoder
    }()
}
