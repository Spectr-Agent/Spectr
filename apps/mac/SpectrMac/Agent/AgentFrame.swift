import CoreGraphics
import Foundation
import SpectrKit

/// One screenshot of the shared content and where that content is on screen.
struct AgentFrame: Sendable, Equatable {
    var screenshot: MacScreenshot
    /// The shared window or display in global screen points (top-left origin, the
    /// coordinate space `CGEvent` uses).
    var region: CGRect
    /// Owning process of the shared window; nil when a whole display is shared.
    var windowOwnerPID: pid_t?

    /// Maps a screenshot pixel to a global screen point at the pixel's center.
    func screenPoint(x: Int, y: Int) -> CGPoint {
        let sx = region.width / Double(max(screenshot.width, 1))
        let sy = region.height / Double(max(screenshot.height, 1))
        return CGPoint(x: region.minX + (Double(x) + 0.5) * sx, y: region.minY + (Double(y) + 0.5) * sy)
    }
}

enum AgentFrameError: Error, Equatable, Sendable {
    /// Nothing is shared, so the agent has nothing it is allowed to see.
    case notSharing
    /// The shared window is minimized, on another Space or closed.
    case windowNotVisible
    case captureFailed

    var message: String {
        switch self {
        case .notSharing: "Choose a window or display to share before Spectr can work."
        case .windowNotVisible: "The shared window isn't visible. Bring it back on screen."
        case .captureFailed: "Couldn't capture the shared screen."
        }
    }
}
