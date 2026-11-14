import Foundation

public enum MacAgentError: Error, Sendable, Equatable {
    /// The device token is missing, wrong or revoked (HTTP 401).
    case unauthorized
    /// The step does not match the server's task state: a correction, Stop or another
    /// request moved it on. Fetch the task again before doing anything else.
    case staleStep(currentRevision: Int?)
    case notFound
    case invalidRequest(String)
    /// The backend is missing configuration or its model call failed. Retry later.
    case unavailable(String)
    case offline
}

/// The Mac's side of the backend agent loop.
public protocol MacAgentAPI: Sendable {
    func activeTask() async throws(MacAgentError) -> MacTaskResponse.Task?
    func step(_ request: MacStepRequest) async throws(MacAgentError) -> MacStepResponse
}

/// `GET /api/mac/task` and `POST /api/mac/step`, authenticated with the Mac's device
/// token. The token is a credential: it is sent only in the Authorization header and
/// never logged.
public struct MacAgentClient: MacAgentAPI {
    private let origin: URL
    private let deviceToken: String
    private let transport: any HTTPTransport

    public init(origin: URL, deviceToken: String, transport: any HTTPTransport = URLSessionTransport()) {
        self.origin = origin
        self.deviceToken = deviceToken
        self.transport = transport
    }

    public func activeTask() async throws(MacAgentError) -> MacTaskResponse.Task? {
        var request = URLRequest(url: origin.appending(path: "api/mac/task"))
        request.httpMethod = "GET"
        request.timeoutInterval = 20
        let data = try await send(request)
        guard let response = try? WireJSON.decoder().decode(MacTaskResponse.self, from: data) else {
            throw .unavailable("The task response could not be read.")
        }
        return response.task
    }

    public func step(_ body: MacStepRequest) async throws(MacAgentError) -> MacStepResponse {
        var request = URLRequest(url: origin.appending(path: "api/mac/step"))
        request.httpMethod = "POST"
        // The backend allows the step route up to 300 s for model calls.
        request.timeoutInterval = 310
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        guard let encoded = try? JSONEncoder().encode(body) else {
            throw .invalidRequest("The step request could not be encoded.")
        }
        request.httpBody = encoded
        let data = try await send(request)
        guard let response = try? WireJSON.decoder().decode(MacStepResponse.self, from: data) else {
            throw .unavailable("The step response could not be read.")
        }
        return response
    }

    private func send(_ original: URLRequest) async throws(MacAgentError) -> Data {
        var request = original
        request.setValue("Bearer \(deviceToken)", forHTTPHeaderField: "Authorization")
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        let data: Data
        let response: HTTPURLResponse
        do {
            (data, response) = try await transport.send(request)
        } catch {
            throw .offline
        }
        guard (200..<300).contains(response.statusCode) else {
            throw Self.error(status: response.statusCode, body: data)
        }
        return data
    }

    static func error(status: Int, body: Data) -> MacAgentError {
        let detail = (try? JSONDecoder().decode(APIErrorBody.self, from: body))?.error
        switch (status, detail?.code) {
        case (401, _), (403, _), (_, "forbidden"):
            return .unauthorized
        case (_, "staleStep"), (_, "staleRevision"), (409, _):
            return .staleStep(currentRevision: detail?.currentRevision)
        case (404, _), (_, "notFound"):
            return .notFound
        case (400, _), (_, "invalidRequest"):
            return .invalidRequest(detail?.message ?? "The backend rejected the request.")
        default:
            return .unavailable(detail?.message ?? "The backend is unavailable (HTTP \(status)).")
        }
    }
}
