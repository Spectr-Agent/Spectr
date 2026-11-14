import SpectrKit
import SwiftUI

@main
struct SpectrIOSApp: App {
    @State private var environment = AppEnvironment.live()

    var body: some Scene {
        WindowGroup {
            RootView(environment: environment)
                .tint(Theme.accent)
        }
    }
}
