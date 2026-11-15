import SpectrKit
import SwiftUI

@main
struct SpectrIOSApp: App {
    @State private var environment = AppEnvironment.live()

    init() {
        Typeface.applyToNavigationBars()
    }

    var body: some Scene {
        WindowGroup {
            RootView(environment: environment)
                .tint(Theme.accent)
                .font(.brand(.body))
        }
    }
}
