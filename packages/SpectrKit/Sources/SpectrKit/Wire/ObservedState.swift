import Foundation

/// What the Mac actually saw after an action, read independently of the action itself.
///
/// PROVISIONAL native proposal: the backend contract has not yet adopted general
/// observed state. Values come from the macOS Accessibility API, never from the
/// action's own success flag.
public struct ObservedState: Codable, Sendable, Equatable {
    /// How the state was established.
    public enum Verification: String, Codable, Sendable {
        /// Read back through the Accessibility API.
        case accessibility
        /// Only a screenshot exists; a model judged the result. Never reported as verified.
        case screenshotOnly
    }

    public struct Element: Codable, Sendable, Equatable {
        public var role: String
        public var title: String?
        /// Text value of the element. Always nil for secure (password) fields.
        public var value: String?

        public init(role: String, title: String? = nil, value: String? = nil) {
            self.role = role
            self.title = title
            self.value = value
        }
    }

    /// An element the planner may target, valid until the next observation.
    public struct ElementSummary: Codable, Sendable, Equatable {
        public var id: String
        public var role: String
        public var title: String?
        /// Frame in the focused window's coordinate space (points, top-left origin).
        public var x: Double
        public var y: Double
        public var width: Double
        public var height: Double

        public init(
            id: String, role: String, title: String?, x: Double, y: Double, width: Double, height: Double
        ) {
            self.id = id
            self.role = role
            self.title = title
            self.x = x
            self.y = y
            self.width = width
            self.height = height
        }
    }

    public var frontmostBundleId: String?
    public var frontmostAppName: String?
    public var windowTitle: String?
    public var focusedElement: Element?
    /// Present only on explicit `observe` results, capped in size.
    public var elements: [ElementSummary]?
    public var verification: Verification

    public init(
        frontmostBundleId: String?,
        frontmostAppName: String?,
        windowTitle: String?,
        focusedElement: Element?,
        elements: [ElementSummary]? = nil,
        verification: Verification
    ) {
        self.frontmostBundleId = frontmostBundleId
        self.frontmostAppName = frontmostAppName
        self.windowTitle = windowTitle
        self.focusedElement = focusedElement
        self.elements = elements
        self.verification = verification
    }
}
