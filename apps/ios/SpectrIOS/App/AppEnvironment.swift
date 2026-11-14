import Foundation
import Observation
import SpectrKit

/// Composition root for the iPhone app. Owns configuration and the signed-in session.
@MainActor
@Observable
final class AppEnvironment {
    enum Startup {
        case ready(AppConfiguration, AuthModel)
        case misconfigured(AppConfiguration.ConfigurationError)
    }

    let startup: Startup

    init(startup: Startup) {
        self.startup = startup
    }

    var configurationError: AppConfiguration.ConfigurationError? {
        if case .misconfigured(let error) = startup { return error }
        return nil
    }

    static func live(bundle: Bundle = .main) -> AppEnvironment {
        let info = bundle.infoDictionary ?? [:]
        do {
            let configuration = try AppConfiguration.load(from: info)
            let supabase = try SupabaseConfiguration.load(from: info)
            let auth = AuthModel(
                client: SupabaseAuthClient(configuration: supabase),
                store: KeychainCredentialStore(
                    service: bundle.bundleIdentifier ?? "spectr.ios", account: "auth-session"
                )
            )
            return AppEnvironment(startup: .ready(configuration, auth))
        } catch {
            return AppEnvironment(startup: .misconfigured(error))
        }
    }
}
