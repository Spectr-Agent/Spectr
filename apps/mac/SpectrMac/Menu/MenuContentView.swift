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

            switch environment.startup {
            case .ready:
                section("Sharing") { SharingSection(capture: environment.capture) }
                section("Control") {
                    StatusRow(title: "Pairing", value: "Not paired", isOK: false)
                    HStack {
                        StatusRow(
                            title: "Accessibility",
                            value: environment.permissions.accessibility ? "Allowed" : "Not allowed",
                            isOK: environment.permissions.accessibility
                        )
                        if !environment.permissions.accessibility {
                            Button("Allow…") { environment.requestAccessibility() }
                                .controlSize(.small)
                        }
                    }
                }
                #if DEBUG
                    section("Action lab (Debug)") { ActionLabSection(lab: environment.lab) }
                #endif
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
        .frame(width: 320)
        .background(Theme.background)
        .onAppear { environment.refreshPermissions() }
    }

    private func section<Content: View>(_ title: String, @ViewBuilder content: () -> Content) -> some View {
        VStack(alignment: .leading, spacing: Theme.spacing) {
            Divider().overlay(Theme.hairline)
            Text(title.uppercased())
                .font(.caption2.weight(.semibold))
                .foregroundStyle(Theme.inkSecondary)
            content()
        }
    }

    private func message(for error: AppConfiguration.ConfigurationError) -> String {
        switch error {
        case .missing(let key): "\(key) is not set. See apps/Config/Local.xcconfig.example."
        case .invalidURL(let key): "\(key) is not a valid URL."
        case .insecureOrigin: "The API origin must use HTTPS outside local development."
        }
    }
}

private struct SharingSection: View {
    let capture: CaptureController

    var body: some View {
        TimelineView(.periodic(from: .now, by: 1)) { context in
            VStack(alignment: .leading, spacing: Theme.spacing) {
                HStack {
                    Circle()
                        .fill(dotColor(at: context.date))
                        .frame(width: 8, height: 8)
                        .accessibilityHidden(true)
                    Text(statusText(at: context.date))
                        .font(.callout.weight(.medium))
                        .foregroundStyle(Theme.ink)
                }
                if let name = capture.sourceName, capture.isSharing {
                    Text(name)
                        .font(.caption)
                        .foregroundStyle(Theme.inkSecondary)
                        .lineLimit(1)
                }
                if let preview = capture.preview, capture.isSharing {
                    Image(decorative: preview, scale: 1)
                        .resizable()
                        .scaledToFit()
                        .frame(maxWidth: .infinity, maxHeight: 170)
                        .clipShape(.rect(cornerRadius: 8))
                        .overlay { RoundedRectangle(cornerRadius: 8).stroke(Theme.hairline) }
                }
                HStack {
                    Button(capture.isSharing ? "Change…" : "Choose window…") { capture.chooseSource() }
                    if capture.isSharing {
                        Button("Stop sharing", role: .destructive) { capture.stopSharing() }
                    }
                }
                .controlSize(.small)
            }
        }
    }

    private func statusText(at now: Date) -> String {
        switch capture.status {
        case .idle: return "Not sharing"
        case .choosing: return "Choose a window in the picker"
        case .starting: return "Starting…"
        case .sharing:
            switch capture.health.state(at: now) {
            case .waitingForFirstFrame: return "Waiting for first frame"
            case .live: return "Sharing · live"
            case .liveStatic: return "Sharing · no changes"
            case .stalled: return "Sharing · stalled"
            }
        case .stopped(.userStopped): return "Not sharing"
        case .stopped(.windowGone): return "The shared window closed. Choose another."
        case .stopped(.permissionDenied): return "Screen sharing was declined."
        case .stopped(.failed(let message)): return message
        }
    }

    private func dotColor(at now: Date) -> Color {
        guard capture.status == .sharing else {
            if case .stopped(let reason) = capture.status, reason != .userStopped { return Theme.critical }
            return Theme.hairline
        }
        return capture.health.state(at: now) == .stalled ? Theme.critical : Theme.accent
    }
}

#if DEBUG
    private struct ActionLabSection: View {
        let lab: ActionLab
        @State private var text = "Hello from Spectr"

        var body: some View {
            VStack(alignment: .leading, spacing: Theme.spacing) {
                HStack {
                    Button("Open Notes") { lab.run(.openApp(bundleId: "com.apple.Notes")) }
                    Button("Observe") { lab.run(.observe) }
                }
                HStack {
                    TextField("Text", text: $text)
                        .textFieldStyle(.roundedBorder)
                    Button("Type") { lab.run(.typeText(text: text, target: nil)) }
                        .disabled(text.isEmpty)
                }
                .controlSize(.small)
                if lab.isRunning {
                    Text("Running…").font(.caption).foregroundStyle(Theme.inkSecondary)
                } else if let result = lab.lastResult {
                    ResultSummary(result: result)
                }
            }
            .controlSize(.small)
        }
    }

    private struct ResultSummary: View {
        let result: DeviceResult

        var body: some View {
            VStack(alignment: .leading, spacing: 2) {
                Text(result.outcome.rawValue.capitalized)
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(result.outcome == .succeeded ? Theme.accent : Theme.critical)
                if let observed = result.observed {
                    Text("Front: \(observed.frontmostAppName ?? "—")")
                    if let value = observed.focusedElement?.value {
                        Text("Field: \(value)").lineLimit(2)
                    }
                    if let elements = observed.elements {
                        Text("\(elements.count) targetable elements")
                    }
                }
                if let error = result.error {
                    Text(error.message).foregroundStyle(Theme.inkSecondary)
                }
            }
            .font(.caption)
            .foregroundStyle(Theme.ink)
        }
    }
#endif

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
