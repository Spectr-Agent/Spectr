import SpectrKit
import SwiftUI

struct RootView: View {
    let environment: AppEnvironment

    var body: some View {
        ZStack {
            Theme.background.ignoresSafeArea()
            switch environment.startup {
            case .ready(_, let auth):
                SignedContent(auth: auth)
                    #if DEBUG
                        .safeAreaInset(edge: .bottom) { DemoEntry() }
                    #endif
            case .misconfigured(let error):
                ConfigurationProblemView(error: error)
            }
        }
    }
}

/// Routes between restoring, sign-in and the signed-in home.
private struct SignedContent: View {
    let auth: AuthModel

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
            case .signedIn(_, let email):
                HomeView(auth: auth, email: email)
            }
        }
        .task { await auth.restore() }
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
            "Server addresses must use HTTPS outside local development."
        }
    }
}

#if DEBUG
    /// Debug-only entry to the task screen backed by labeled test data.
    private struct DemoEntry: View {
        @State private var session: TaskSession?

        var body: some View {
            Button {
                let service = DemoTaskService()
                Task { await service.begin() }
                session = TaskSession(
                    taskId: "tsk_demo_001", macName: "Demo Mac", service: service,
                    media: DemoLiveViewSource(), isTestData: true
                )
            } label: {
                Text("Preview task screen with test data")
                    .font(.footnote.weight(.semibold))
                    .frame(maxWidth: .infinity, minHeight: 36)
            }
            .buttonStyle(.bordered)
            .padding(.horizontal, Theme.spacing * 2)
            .padding(.bottom, Theme.spacing)
            .fullScreenCover(item: $session) { session in
                TaskView(session: session) { self.session = nil }
            }
        }
    }

    extension TaskSession: Identifiable {
        nonisolated var id: String { taskId }
    }
#endif
