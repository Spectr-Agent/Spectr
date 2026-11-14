import SpectrKit
import SwiftUI

@main
struct SpectrMacApp: App {
    @State private var environment = MacEnvironment.live()

    var body: some Scene {
        MenuBarExtra {
            MenuContentView(environment: environment)
                .tint(Theme.accent)
        } label: {
            Image(systemName: "sparkle")
                .accessibilityLabel("Spectr")
        }
        .menuBarExtraStyle(.window)
    }
}
