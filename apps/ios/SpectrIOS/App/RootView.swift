import SpectrKit
import SwiftUI

struct RootView: View {
    let environment: AppEnvironment

    var body: some View {
        ZStack {
            Theme.background.ignoresSafeArea()
            switch environment.startup {
            case .ready:
                WelcomeView()
            case .misconfigured(let error):
                ConfigurationProblemView(error: error)
            }
        }
    }
}

/// First-run explanation of what Spectr needs. Sign-in and pairing attach here in Phase 2.
struct WelcomeView: View {
    var body: some View {
        ScrollView {
            VStack(spacing: Theme.spacing * 3) {
                Image("spectr_welcome")
                    .resizable()
                    .scaledToFit()
                    .frame(maxWidth: 180)
                    .accessibilityHidden(true)

                VStack(spacing: Theme.spacing) {
                    Text("Spectr")
                        .font(.largeTitle.weight(.semibold))
                        .foregroundStyle(Theme.ink)
                    Text("Tell your Mac what to do, then watch it work from here.")
                        .font(.body)
                        .foregroundStyle(Theme.inkSecondary)
                        .multilineTextAlignment(.center)
                }

                VStack(alignment: .leading, spacing: Theme.spacing * 1.5) {
                    RequirementRow(
                        symbol: "laptopcomputer", text: "A Mac that is awake and running the Spectr menu-bar app.")
                    RequirementRow(symbol: "wifi", text: "An internet connection on both devices.")
                    RequirementRow(symbol: "lock.open", text: "The Mac unlocked while Spectr works on it.")
                }
                .padding(Theme.spacing * 2)
                .background(Theme.surface, in: .rect(cornerRadius: Theme.cornerRadius))
                .overlay {
                    RoundedRectangle(cornerRadius: Theme.cornerRadius).stroke(Theme.hairline)
                }
            }
            .padding(.horizontal, Theme.spacing * 2)
            .padding(.vertical, Theme.spacing * 4)
            .frame(maxWidth: 520)
            .frame(maxWidth: .infinity)
        }
    }
}

private struct RequirementRow: View {
    let symbol: String
    let text: String

    var body: some View {
        HStack(alignment: .firstTextBaseline, spacing: Theme.spacing * 1.5) {
            Image(systemName: symbol)
                .foregroundStyle(Theme.accent)
                .frame(width: 24)
                .accessibilityHidden(true)
            Text(text)
                .foregroundStyle(Theme.ink)
                .fixedSize(horizontal: false, vertical: true)
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
                .font(.title2.weight(.semibold))
                .foregroundStyle(Theme.ink)
            Text(message)
                .font(.callout)
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
            "The API origin must use HTTPS outside local development."
        }
    }
}
