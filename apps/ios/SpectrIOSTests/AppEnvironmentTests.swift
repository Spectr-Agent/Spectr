import Foundation
import SpectrKit
import Testing

@testable import SpectrIOS

@MainActor
@Suite("iOS composition")
struct AppEnvironmentTests {
    @Test func missingConfigurationIsSurfacedNotIgnored() {
        let bundleWithoutKeys = AppEnvironment.live(bundle: Bundle(for: BundleMarker.self))
        #expect(bundleWithoutKeys.startup == .misconfigured(.missing(key: AppConfiguration.apiOriginKey)))
    }

    @Test func debugHostAppDeclaresDevelopmentEnvironment() {
        #expect(Bundle.main.infoDictionary?[AppConfiguration.environmentKey] as? String == "development")
    }
}

private final class BundleMarker {}
