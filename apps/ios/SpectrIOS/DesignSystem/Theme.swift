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

/// Helvetica Neue in every text style, still scaling with Dynamic Type.
enum Typeface {
    static func name(for weight: Font.Weight) -> String {
        switch weight {
        case .ultraLight, .thin, .light: "HelveticaNeue-Light"
        case .medium, .semibold: "HelveticaNeue-Medium"
        case .bold, .heavy, .black: "HelveticaNeue-Bold"
        default: "HelveticaNeue"
        }
    }

    static func size(for style: Font.TextStyle) -> CGFloat {
        switch style {
        case .largeTitle: 34
        case .title: 28
        case .title2: 22
        case .title3: 20
        case .headline, .body: 17
        case .callout: 16
        case .subheadline: 15
        case .footnote: 13
        case .caption: 12
        case .caption2: 11
        default: 17
        }
    }

    /// Navigation bar titles in Helvetica too.
    @MainActor static func applyToNavigationBars() {
        let appearance = UINavigationBar.appearance()
        if let large = UIFont(name: name(for: .bold), size: 34) {
            appearance.largeTitleTextAttributes = [
                .font: UIFontMetrics(forTextStyle: .largeTitle).scaledFont(for: large)
            ]
        }
        if let inline = UIFont(name: name(for: .medium), size: 17) {
            appearance.titleTextAttributes = [.font: UIFontMetrics(forTextStyle: .headline).scaledFont(for: inline)]
        }
    }
}

extension Font {
    /// The app's typeface for a text style; headlines default to medium weight.
    static func brand(_ style: Font.TextStyle, _ weight: Font.Weight? = nil) -> Font {
        let weight = weight ?? (style == .headline ? .medium : .regular)
        return .custom(Typeface.name(for: weight), size: Typeface.size(for: style), relativeTo: style)
    }
}
