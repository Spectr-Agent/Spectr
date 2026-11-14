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

    /// Where the emailed sign-in link returns. The `spectr` scheme is registered in
    /// Info.plist and this exact URL is in the Supabase project's allowed redirects.
    /// A link opened by another app cannot sign in: it lacks this device's PKCE verifier.
    static let authCallbackURL = URL(string: "spectr://auth-callback") ?? URL(filePath: "/")

    static func live(bundle: Bundle = .main) -> AppEnvironment {
        let info = bundle.infoDictionary ?? [:]
        do {
            let configuration = try AppConfiguration.load(from: info)
            let supabase = try SupabaseConfiguration.load(from: info)
            let service = bundle.bundleIdentifier ?? "spectr.ios"
            let auth = AuthModel(
                client: SupabaseAuthClient(configuration: supabase, redirectURL: authCallbackURL),
                store: KeychainCredentialStore(service: service, account: "auth-session"),
                pendingStore: KeychainCredentialStore(service: service, account: "pending-sign-in"),
                callbackURL: authCallbackURL
            )
            return AppEnvironment(startup: .ready(configuration, auth))
        } catch {
            return AppEnvironment(startup: .misconfigured(error))
        }
    }
}
