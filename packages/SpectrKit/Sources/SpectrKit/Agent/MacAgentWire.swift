import Foundation

// Wire types for the backend's Mac agent loop: `GET /api/mac/task` and
// `POST /api/mac/step`. They mirror `MacTaskResponseSchema`, `MacStepRequestSchema`,
// `MacStepResponseSchema` and `MacActionSchema` in `services/api/src/contracts.ts`
// (owner: Poorav). Canonical examples live in `contracts/mac-*.json`.

/// The paired Mac's active task, or none.
public struct MacTaskResponse: Codable, Sendable, Equatable {
    public struct Task: Codable, Sendable, Equatable {
        public var taskId: String
        public var revision: Int
        public var state: TaskState
        public var instruction: String
        /// Number of agent steps already completed. The next step request sends this
        /// value as `afterStep`.
        public var step: Int

        public init(taskId: String, revision: Int, state: TaskState, instruction: String, step: Int) {
            self.taskId = taskId
            self.revision = revision
            self.state = state
            self.instruction = instruction
            self.step = step
        }
    }

    public var task: Task?

    public init(task: Task?) {
        self.task = task
    }
}

/// One action the backend asks the Mac to perform. Coordinates are pixels in the most
/// recent screenshot the Mac sent.
public enum MacAction: Sendable, Equatable {
    public enum Button: String, Codable, Sendable { case left, right, middle }
    public enum Direction: String, Codable, Sendable { case up, down, left, right }

    case screenshot
    case click(x: Int, y: Int, button: Button, clicks: Int, modifiers: [String])
    case mouseMove(x: Int, y: Int)
    case drag(fromX: Int, fromY: Int, toX: Int, toY: Int, modifiers: [String])
    case scroll(x: Int?, y: Int?, direction: Direction, amount: Int, modifiers: [String])
    case type(text: String)
    /// `keys` is a combination like `cmd+l` or `return`.
    case key(keys: String, repeat: Int)
    case wait(seconds: Double)
    case openApp(name: String)
    case openUrl(URL)
    /// An action type this build does not know. Rejected, never executed.
    case unsupported(type: String)

    public var typeName: String {
        switch self {
        case .screenshot: "screenshot"
        case .click: "click"
        case .mouseMove: "mouseMove"
        case .drag: "drag"
        case .scroll: "scroll"
        case .type: "type"
        case .key: "key"
        case .wait: "wait"
        case .openApp: "openApp"
        case .openUrl: "openUrl"
        case .unsupported(let type): type
        }
    }
}

extension MacAction: Codable {
    private enum CodingKeys: String, CodingKey {
        case type, x, y, button, clicks, modifiers, fromX, fromY, toX, toY, direction, amount, text, keys
        case `repeat`, seconds, name, url
    }

    public init(from decoder: any Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        let type = try c.decode(String.self, forKey: .type)
        func mods() throws -> [String] { try c.decodeIfPresent([String].self, forKey: .modifiers) ?? [] }
        switch type {
        case "screenshot":
            self = .screenshot
        case "click":
            self = .click(
                x: try c.decode(Int.self, forKey: .x), y: try c.decode(Int.self, forKey: .y),
                button: try c.decodeIfPresent(Button.self, forKey: .button) ?? .left,
                clicks: try c.decodeIfPresent(Int.self, forKey: .clicks) ?? 1, modifiers: try mods())
        case "mouseMove":
            self = .mouseMove(x: try c.decode(Int.self, forKey: .x), y: try c.decode(Int.self, forKey: .y))
        case "drag":
            self = .drag(
                fromX: try c.decode(Int.self, forKey: .fromX), fromY: try c.decode(Int.self, forKey: .fromY),
                toX: try c.decode(Int.self, forKey: .toX), toY: try c.decode(Int.self, forKey: .toY),
                modifiers: try mods())
        case "scroll":
            self = .scroll(
                x: try c.decodeIfPresent(Int.self, forKey: .x), y: try c.decodeIfPresent(Int.self, forKey: .y),
                direction: try c.decode(Direction.self, forKey: .direction),
                amount: try c.decode(Int.self, forKey: .amount), modifiers: try mods())
        case "type":
            self = .type(text: try c.decode(String.self, forKey: .text))
        case "key":
            self = .key(
                keys: try c.decode(String.self, forKey: .keys),
                repeat: try c.decodeIfPresent(Int.self, forKey: .repeat) ?? 1)
        case "wait":
            self = .wait(seconds: try c.decode(Double.self, forKey: .seconds))
        case "openApp":
            self = .openApp(name: try c.decode(String.self, forKey: .name))
        case "openUrl":
            let raw = try c.decode(String.self, forKey: .url)
            guard let url = URL(string: raw) else {
                throw DecodingError.dataCorruptedError(forKey: .url, in: c, debugDescription: "Invalid URL")
            }
            self = .openUrl(url)
        default:
            self = .unsupported(type: type)
        }
    }

    public func encode(to encoder: any Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        try c.encode(typeName, forKey: .type)
        switch self {
        case .screenshot, .unsupported:
            break
        case .click(let x, let y, let button, let clicks, let modifiers):
            try c.encode(x, forKey: .x)
            try c.encode(y, forKey: .y)
            try c.encode(button, forKey: .button)
            try c.encode(clicks, forKey: .clicks)
            try c.encode(modifiers, forKey: .modifiers)
        case .mouseMove(let x, let y):
            try c.encode(x, forKey: .x)
            try c.encode(y, forKey: .y)
        case .drag(let fromX, let fromY, let toX, let toY, let modifiers):
            try c.encode(fromX, forKey: .fromX)
            try c.encode(fromY, forKey: .fromY)
            try c.encode(toX, forKey: .toX)
            try c.encode(toY, forKey: .toY)
            try c.encode(modifiers, forKey: .modifiers)
        case .scroll(let x, let y, let direction, let amount, let modifiers):
            try c.encode(x, forKey: .x)
            try c.encode(y, forKey: .y)
            try c.encode(direction, forKey: .direction)
            try c.encode(amount, forKey: .amount)
            try c.encode(modifiers, forKey: .modifiers)
        case .type(let text):
            try c.encode(text, forKey: .text)
        case .key(let keys, let count):
            try c.encode(keys, forKey: .keys)
            try c.encode(count, forKey: .repeat)
        case .wait(let seconds):
            try c.encode(seconds, forKey: .seconds)
        case .openApp(let name):
            try c.encode(name, forKey: .name)
        case .openUrl(let url):
            try c.encode(url.absoluteString, forKey: .url)
        }
    }
}

/// The screenshot sent with every step.
public struct MacScreenshot: Codable, Sendable, Equatable {
    public var mediaType: String
    /// Base64 image bytes.
    public var data: String
    public var width: Int
    public var height: Int

    public init(mediaType: String, data: String, width: Int, height: Int) {
        self.mediaType = mediaType
        self.data = data
        self.width = width
        self.height = height
    }

    /// The backend's limits: long edge at most 2576 px and at most 4784 28-px tiles.
    public static func fitsBackendLimits(width: Int, height: Int) -> Bool {
        guard width > 0, height > 0, max(width, height) <= 2576 else { return false }
        return ((width + 27) / 28) * ((height + 27) / 28) <= 4784
    }

    /// Pixel size to capture `pointSize` at, scaled so the long edge is at most
    /// `longEdge` and the backend limits hold.
    public static func targetSize(for pointSize: CGSize, longEdge: Int = 1280) -> (width: Int, height: Int) {
        let w = max(pointSize.width, 1)
        let h = max(pointSize.height, 1)
        var scale = Double(longEdge) / Double(max(w, h))
        var size = (width: max(1, Int((w * scale).rounded())), height: max(1, Int((h * scale).rounded())))
        while !fitsBackendLimits(width: size.width, height: size.height) && scale > 0.05 {
            scale *= 0.95
            size = (max(1, Int((w * scale).rounded())), max(1, Int((h * scale).rounded())))
        }
        return size
    }
}

public struct MacActionResult: Codable, Sendable, Equatable {
    public var actionId: String
    public var ok: Bool
    public var error: String?
    public var output: String?

    public init(actionId: String, ok: Bool, error: String? = nil, output: String? = nil) {
        self.actionId = actionId
        self.ok = ok
        self.error = error.map { String($0.prefix(500)) }
        self.output = output.map { String($0.prefix(1000)) }
    }
}

public struct MacStepRequest: Codable, Sendable, Equatable {
    public var taskId: String
    public var afterStep: Int
    public var screenshot: MacScreenshot
    public var results: [MacActionResult]

    public init(taskId: String, afterStep: Int, screenshot: MacScreenshot, results: [MacActionResult]) {
        self.taskId = taskId
        self.afterStep = afterStep
        self.screenshot = screenshot
        self.results = Array(results.prefix(50))
    }
}

public struct MacStepAction: Codable, Sendable, Equatable {
    public var actionId: String
    public var action: MacAction

    public init(actionId: String, action: MacAction) {
        self.actionId = actionId
        self.action = action
    }
}

public enum MacStepResponse: Sendable, Equatable {
    case actions(taskId: String, step: Int, revision: Int, actions: [MacStepAction])
    case waiting(taskId: String, step: Int, question: String)
    case finished(taskId: String, step: Int, state: TaskState, summary: String)

    public var taskId: String {
        switch self {
        case .actions(let id, _, _, _), .waiting(let id, _, _), .finished(let id, _, _, _): id
        }
    }

    public var step: Int {
        switch self {
        case .actions(_, let step, _, _), .waiting(_, let step, _), .finished(_, let step, _, _): step
        }
    }
}

extension MacStepResponse: Codable {
    private enum CodingKeys: String, CodingKey {
        case kind, taskId, step, revision, actions, question, state, summary
    }

    public init(from decoder: any Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        let taskId = try c.decode(String.self, forKey: .taskId)
        let step = try c.decode(Int.self, forKey: .step)
        switch try c.decode(String.self, forKey: .kind) {
        case "actions":
            self = .actions(
                taskId: taskId, step: step, revision: try c.decode(Int.self, forKey: .revision),
                actions: try c.decode([MacStepAction].self, forKey: .actions))
        case "waiting":
            self = .waiting(taskId: taskId, step: step, question: try c.decode(String.self, forKey: .question))
        case "finished":
            self = .finished(
                taskId: taskId, step: step, state: try c.decode(TaskState.self, forKey: .state),
                summary: try c.decode(String.self, forKey: .summary))
        case let other:
            throw DecodingError.dataCorruptedError(
                forKey: .kind, in: c, debugDescription: "Unknown step response kind \(other)")
        }
    }

    public func encode(to encoder: any Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        try c.encode(taskId, forKey: .taskId)
        try c.encode(step, forKey: .step)
        switch self {
        case .actions(_, _, let revision, let actions):
            try c.encode("actions", forKey: .kind)
            try c.encode(revision, forKey: .revision)
            try c.encode(actions, forKey: .actions)
        case .waiting(_, _, let question):
            try c.encode("waiting", forKey: .kind)
            try c.encode(question, forKey: .question)
        case .finished(_, _, let state, let summary):
            try c.encode("finished", forKey: .kind)
            try c.encode(state, forKey: .state)
            try c.encode(summary, forKey: .summary)
        }
    }
}
