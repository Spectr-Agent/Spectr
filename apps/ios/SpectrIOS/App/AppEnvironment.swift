import Foundation
import Observation
import SpectrKit

/// Composition root for the iPhone app. Owns configuration and, in later phases,
/// the authenticated session and task services.
@MainActor
@Observable
final class AppEnvironment {
    enum Startup: Equatable {
        case ready(AppConfiguration)
        case misconfigured(AppConfiguration.ConfigurationError)
    }

    let startup: Startup

    init(startup: Startup) {
        self.startup = startup
    }

    static func live(bundle: Bundle = .main) -> AppEnvironment {
        do {
            let configuration = try AppConfiguration.load(from: bundle.infoDictionary ?? [:])
            return AppEnvironment(startup: .ready(configuration))
        } catch {
            return AppEnvironment(startup: .misconfigured(error))
        }
    }
}
