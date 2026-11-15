import SpectrKit
import SwiftUI

struct RootView: View {
    let environment: AppEnvironment

    var body: some View {
        ZStack {
            Theme.background.ignoresSafeArea()
            switch environment.startup {
            case .ready(let configuration, let auth):
                SignedContent(auth: auth, origin: configuration.apiOrigin)
            case .misconfigured(let error):
                ConfigurationProblemView(error: error)
            }
        }
    }
}

/// Routes between restoring, sign-in and the signed-in home.
private struct SignedContent: View {
    let auth: AuthModel
    let origin: URL

    var body: some View {
        Group {
            switch auth.state {
            case .restoring:
                ProgressView()
                    .accessibilityLabel("Restoring your session")
            case .signedOut:
                SignInView(auth: auth)
            case .awaitingCode(let email):
                CodeEntryView(auth: auth, email: email)
            case .signedIn(let userId, let email):
                MainView(auth: auth, email: email, origin: origin)
                    .id(userId)
            }
        }
        .task { await auth.restore() }
        .onOpenURL { url in
            Task {
                await auth.restore()
                await auth.handleCallback(url)
            }
        }
    }
}

/// Shown when the build is missing required configuration. Never falls back silently.
struct ConfigurationProblemView: View {
    let error: AppConfiguration.ConfigurationError

    var body: some View {
        VStack(spacing: Theme.spacing * 2) {
            Image("spectr_error")
                .resizable()
                .scaledToFit()
                .frame(maxWidth: 140)
                .accessibilityHidden(true)
            Text("This build isn't configured")
                .font(.brand(.title2, .semibold))
                .foregroundStyle(Theme.ink)
            Text(message)
                .font(.brand(.callout))
                .foregroundStyle(Theme.inkSecondary)
                .multilineTextAlignment(.center)
        }
        .padding(Theme.spacing * 3)
    }

    private var message: String {
        switch error {
        case .missing(let key):
            "\(key) is not set. Copy apps/Config/Local.xcconfig.example to Local.xcconfig and rebuild."
        case .invalidURL(let key):
            "\(key) is not a valid URL."
        case .insecureOrigin:
            "Server addresses must use HTTPS outside local development."
        }
    }
}
