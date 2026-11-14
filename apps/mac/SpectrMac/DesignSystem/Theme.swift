import SwiftUI

/// Spectr's visual language: white and near-black with a restrained blue accent.
/// Colors live in the asset catalog so light and dark appearance stay in sync.
enum Theme {
    static let background = Color("SpectrBackground")
    static let surface = Color("SpectrSurface")
    static let ink = Color("SpectrInk")
    static let inkSecondary = Color("SpectrInkSecondary")
    static let hairline = Color("SpectrHairline")
    static let accent = Color("SpectrAccent")
    static let accentSoft = Color("SpectrAccentSoft")
    static let critical = Color("SpectrCritical")

    static let spacing: CGFloat = 8
    static let cornerRadius: CGFloat = 16
}
