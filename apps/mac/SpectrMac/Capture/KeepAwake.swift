import Foundation
import IOKit.pwr_mgt

/// Keeps the display awake while Spectr is reachable from the iPhone, so the screen
/// can be watched and operated from away: a sleeping display streams nothing, and an
/// idle display sleep is also what locks the Mac. Uses a standard power assertion
/// (the same mechanism as `caffeinate -d`); releasing it restores normal behavior.
@MainActor
final class KeepAwake {
    private var assertion: IOPMAssertionID = 0
    private(set) var isHeld = false

    func set(_ hold: Bool) {
        if hold, !isHeld {
            let reason = "Spectr: your Mac stays available to your iPhone" as CFString
            isHeld =
                IOPMAssertionCreateWithName(
                    kIOPMAssertionTypePreventUserIdleDisplaySleep as CFString,
                    IOPMAssertionLevel(kIOPMAssertionLevelOn), reason, &assertion) == kIOReturnSuccess
        } else if !hold, isHeld {
            IOPMAssertionRelease(assertion)
            isHeld = false
        }
    }
}
