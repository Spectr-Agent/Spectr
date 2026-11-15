/// Decides whether the screen has stopped changing after an action, so the agent's
/// next screenshot shows the result rather than the moment before it.
public enum ScreenStability {
    /// Below this fraction of changed pixels two frames count as the same screen. A
    /// blinking caret or a ticking clock stays under it; a page or window appearing does
    /// not.
    public static let stableThreshold = 0.005

    /// The fraction of pixels in which any channel differs by more than `tolerance`.
    ///
    /// Frames of different sizes, or buffers that are empty or not a whole number of
    /// pixels, return 1 (entirely changed), so a malformed frame never reads as stable.
    public static func changedFraction(
        _ a: [UInt8], _ b: [UInt8], bytesPerPixel: Int = 4, tolerance: UInt8 = 8
    ) -> Double {
        guard a.count == b.count, bytesPerPixel > 0, !a.isEmpty, a.count % bytesPerPixel == 0 else { return 1 }
        let limit = Int(tolerance)
        var changed = 0
        a.withUnsafeBufferPointer { a in
            b.withUnsafeBufferPointer { b in
                var pixel = 0
                while pixel < a.count {
                    let channels = pixel..<(pixel + bytesPerPixel)
                    if channels.contains(where: { abs(Int(a[$0]) - Int(b[$0])) > limit }) { changed += 1 }
                    pixel += bytesPerPixel
                }
            }
        }
        return Double(changed) / Double(a.count / bytesPerPixel)
    }
}
