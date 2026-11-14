import SpectrKit
import SwiftUI

struct MenuContentView: View {
    let environment: MacEnvironment

    var body: some View {
        VStack(alignment: .leading, spacing: Theme.spacing * 1.5) {
            HStack(spacing: Theme.spacing) {
                Image(systemName: "sparkle")
                    .foregroundStyle(Theme.accent)
                    .accessibilityHidden(true)
                Text("Spectr")
                    .font(.headline)
                    .foregroundStyle(Theme.ink)
            }

            Divider().overlay(Theme.hairline)

            switch environment.startup {
            case .ready:
                StatusRow(title: "Pairing", value: "Not paired", isOK: false)
                StatusRow(
                    title: "Screen capture",
                    value: environment.permissions.screenCapture ? "Allowed" : "Not allowed",
                    isOK: environment.permissions.screenCapture
                )
                StatusRow(
                    title: "Accessibility control",
                    value: environment.permissions.accessibility ? "Allowed" : "Not allowed",
                    isOK: environment.permissions.accessibility
                )
            case .misconfigured(let error):
                Text(message(for: error))
                    .font(.callout)
                    .foregroundStyle(Theme.critical)
                    .fixedSize(horizontal: false, vertical: true)
            }

            Divider().overlay(Theme.hairline)

            Button("Quit Spectr") { NSApplication.shared.terminate(nil) }
                .keyboardShortcut("q")
        }
        .padding(Theme.spacing * 2)
        .frame(width: 300)
        .background(Theme.background)
        .onAppear { environment.refreshPermissions() }
    }

    private func message(for error: AppConfiguration.ConfigurationError) -> String {
        switch error {
        case .missing(let key): "\(key) is not set. See apps/Config/Local.xcconfig.example."
        case .invalidURL(let key): "\(key) is not a valid URL."
        case .insecureOrigin: "The API origin must use HTTPS outside local development."
        }
    }
}

private struct StatusRow: View {
    let title: String
    let value: String
    let isOK: Bool

    var body: some View {
        HStack {
            Text(title).foregroundStyle(Theme.ink)
            Spacer()
            Label(value, systemImage: isOK ? "checkmark.circle.fill" : "exclamationmark.circle")
                .labelStyle(.titleAndIcon)
                .foregroundStyle(isOK ? Theme.accent : Theme.inkSecondary)
        }
        .font(.callout)
        .accessibilityElement(children: .combine)
    }
}
