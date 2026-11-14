// Spectr design tokens for SwiftUI. Generated from tokens/tokens.json.
import SwiftUI
import UIKit

private extension UIColor {
    convenience init(hex: UInt32) {
        self.init(red: CGFloat((hex >> 16) & 0xFF) / 255,
                  green: CGFloat((hex >> 8) & 0xFF) / 255,
                  blue: CGFloat(hex & 0xFF) / 255, alpha: 1)
    }
}

private func adaptive(light: UInt32, dark: UInt32) -> Color {
    Color(UIColor { $0.userInterfaceStyle == .dark ? UIColor(hex: dark) : UIColor(hex: light) })
}

enum Spectr {
    enum Colors {
        /// Page background.
        static let surface100 = adaptive(light: 0xFFFFFF, dark: 0x0B0B0E)
        /// Cards and sheets sitting on surface-100.
        static let surface200 = adaptive(light: 0xF4F4F6, dark: 0x17171B)
        /// Sunken areas, inputs and the live viewer well.
        static let surface300 = adaptive(light: 0xE8E8EC, dark: 0x232328)
        /// Primary text on surface-100 and surface-200.
        static let ink = adaptive(light: 0x17171B, dark: 0xF5F5F7)
        /// Secondary text and captions on surface-100 and surface-200.
        static let inkMuted = adaptive(light: 0x55555F, dark: 0xA6A6B0)
        /// Hairlines and card outlines.
        static let border = adaptive(light: 0xDADADF, dark: 0x34343B)
        /// Primary buttons and the push to talk pill. Black in light mode, white in dark mode.
        static let inverse = adaptive(light: 0x17171B, dark: 0xF5F5F7)
        /// Text and icons on inverse.
        static let onInverse = adaptive(light: 0xFFFFFF, dark: 0x17171B)
        /// The mascot body color. Use for large soft fields, never for text.
        static let clay = adaptive(light: 0xDAEAFA, dark: 0xDAEAFA)
        /// The one accent. Selected states, the active chip and small highlights. Use sparingly: most of a screen stays black, white and grey.
        static let sky = adaptive(light: 0x9CCBF0, dark: 0x9CCBF0)
        /// Text and icons on sky and clay.
        static let onFill = adaptive(light: 0x17171B, dark: 0x17171B)
        /// Links and accent colored text on surface-100 and surface-200.
        static let brandText = adaptive(light: 0x2F6FB0, dark: 0x7DB8EE)
        /// Dark identity block in covers and hero art. Lifts to charcoal in dark mode.
        static let slab = adaptive(light: 0x17171B, dark: 0x2B2B33)
        /// Focus ring, 2px, on every interactive element.
        static let focus = adaptive(light: 0x17171B, dark: 0xF5F5F7)
    }
    enum Spacing {
        static let s1: CGFloat = 4
        static let s2: CGFloat = 8
        static let s3: CGFloat = 12
        static let s4: CGFloat = 16
        static let s5: CGFloat = 24
        static let s6: CGFloat = 32
        static let s7: CGFloat = 48
        static let s8: CGFloat = 64
    }
    enum Radius {
        static let sm: CGFloat = 8
        static let md: CGFloat = 14
        static let lg: CGFloat = 24
        static let pill: CGFloat = 999
    }
}
