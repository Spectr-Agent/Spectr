#if DEBUG
    import Foundation
    import SpectrKit

    /// What the local planner decided for one step.
    enum AgentDecision: Equatable, Sendable {
        case action(Action)
        case finish(String)
        case ask(String)
        case refuse(String)
        case failed(String)
    }

    /// One finished step, sent back so the planner knows what already happened.
    struct AgentStep: Encodable, Equatable, Sendable {
        var action: Action
        var outcome: String
        var error: String?
    }

    protocol AgentClient: Sendable {
        func nextStep(instruction: String, observed: ObservedState?, history: [AgentStep]) async -> AgentDecision
    }

    /// Talks to `tools/dev-agent` on this machine. Debug only: the model API key lives
    /// in that process, never in the app.
    struct HTTPAgentClient: AgentClient {
        let origin: URL
        var session: URLSession = .shared

        private struct Request: Encodable {
            var instruction: String
            var observed: ObservedState?
            var history: [AgentStep]
        }

        private struct Response: Decodable {
            var kind: String
            var action: Action?
            var message: String?
        }

        func nextStep(instruction: String, observed: ObservedState?, history: [AgentStep]) async -> AgentDecision {
            var request = URLRequest(url: origin.appending(path: "v1/dev/next-step"))
            request.httpMethod = "POST"
            request.setValue("application/json", forHTTPHeaderField: "Content-Type")
            request.timeoutInterval = 30
            request.httpBody = try? WireJSON.encoder().encode(
                Request(instruction: instruction, observed: observed, history: history))
            guard let (data, _) = try? await session.data(for: request) else {
                return .failed("The local agent isn't running. Start it with: cd tools/dev-agent && npm start")
            }
            guard let response = try? WireJSON.decoder().decode(Response.self, from: data) else {
                return .failed("The local agent sent a reply Spectr couldn't read.")
            }
            let message = response.message ?? ""
            switch response.kind {
            case "action": return response.action.map { .action($0) } ?? .failed("The agent sent no action.")
            case "finish": return .finish(message)
            case "ask": return .ask(message)
            case "refuse": return .refuse(message)
            default: return .failed(message.isEmpty ? "The agent couldn't choose a step." : message)
            }
        }
    }
#endif
