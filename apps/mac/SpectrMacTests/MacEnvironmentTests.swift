import Foundation
import SpectrKit
import Testing

@testable import SpectrMac

@MainActor
@Suite("Mac composition")
struct MacEnvironmentTests {
    @Test func missingConfigurationIsSurfacedNotIgnored() {
        let environment = MacEnvironment.live(bundle: Bundle(for: BundleMarker.self))
        #expect(environment.startup == .misconfigured(.missing(key: AppConfiguration.apiOriginKey)))
    }

    @Test func debugHostAppDeclaresDevelopmentEnvironment() {
        #expect(Bundle.main.infoDictionary?[AppConfiguration.environmentKey] as? String == "development")
    }
}

private final class BundleMarker {}
