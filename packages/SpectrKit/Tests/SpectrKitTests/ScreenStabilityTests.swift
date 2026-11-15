import Testing

@testable import SpectrKit

@Suite("Screen stability")
struct ScreenStabilityTests {
    /// A 256x160 RGBA frame filled with one grey.
    static func frame(_ value: UInt8 = 200) -> [UInt8] {
        [UInt8](repeating: value, count: 256 * 160 * 4)
    }

    /// Sets the pixels in a rectangle of a 256-wide RGBA frame to black.
    static func paint(_ frame: inout [UInt8], x: Range<Int>, y: Range<Int>) {
        for row in y {
            for column in x {
                let start = (row * 256 + column) * 4
                frame.replaceSubrange(start..<(start + 3), with: [0, 0, 0])
            }
        }
    }

    @Test func identicalFramesHaveNotChanged() {
        #expect(ScreenStability.changedFraction(Self.frame(), Self.frame()) == 0)
    }

    @Test func noiseWithinToleranceIsIgnored() {
        #expect(ScreenStability.changedFraction(Self.frame(200), Self.frame(206)) == 0)
        #expect(ScreenStability.changedFraction(Self.frame(200), Self.frame(209)) == 1)
    }

    @Test func aBlinkingCaretCountsAsStable() {
        var caret = Self.frame()
        Self.paint(&caret, x: 40..<42, y: 20..<36)
        let fraction = ScreenStability.changedFraction(Self.frame(), caret)
        #expect(fraction > 0)
        #expect(fraction < ScreenStability.stableThreshold)
    }

    @Test func aNewWindowCountsAsChanged() {
        var window = Self.frame()
        Self.paint(&window, x: 0..<200, y: 0..<120)
        #expect(ScreenStability.changedFraction(Self.frame(), window) > 0.5)
    }

    @Test func framesOfDifferentSizesAreEntirelyChanged() {
        #expect(ScreenStability.changedFraction(Self.frame(), Array(Self.frame().dropLast(4))) == 1)
        #expect(ScreenStability.changedFraction([], []) == 1)
        #expect(ScreenStability.changedFraction([1, 2, 3], [1, 2, 3]) == 1)
    }
}
