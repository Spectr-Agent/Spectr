import SpectrKit
import SwiftUI

/// The signed-in app: setup until a Mac is paired, then home, with the live screen and
/// settings on top. Owns the data model and the live connection for the session.
struct MainView: View {
    let auth: AuthModel
    let email: String?
    @State private var model: AppModel
    @State private var live: LiveSession
    @State private var liveCover: LiveCover?
    @State private var setupStart: SetupFlow.Step?
    @State private var showSettings = false
    @Environment(\.scenePhase) private var scenePhase

    struct LiveCover: Identifiable {
        let id = UUID()
        let startCall: Bool
    }

    init(auth: AuthModel, email: String?, origin: URL) {
        self.auth = auth
        self.email = email
        let api = HTTPAppAPI(origin: origin) { [auth] in try await auth.accessToken() }
        _model = State(initialValue: AppModel(api: api))
        _live = State(initialValue: LiveSession(api: api))
    }

    var body: some View {
        Group {
            switch model.load {
            case .loading where model.home == nil:
                ProgressView("Connecting to Spectr…")
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
            case .failed(let message) where model.home == nil:
                ContentUnavailableView {
                    Label("Can't reach Spectr", systemImage: "wifi.exclamationmark")
                } description: {
                    Text(message)
                } actions: {
                    Button("Try Again") { Task { await model.refresh() } }
                        .buttonStyle(.borderedProminent)
                }
            default:
                if model.needsPairing || setupStart != nil {
                    SetupFlow(model: model, start: setupStart ?? .pair) {
                        withAnimation { setupStart = nil }
                    }
                    .transition(.opacity)
                } else {
                    home
                }
            }
        }
        .background(Theme.background.ignoresSafeArea())
        .overlay(alignment: .top) {
            if let notice = model.notice, liveCover == nil {
                NoticeBanner(message: notice)
            }
        }
        .animation(.snappy, value: model.notice)
        .onAppear {
            model.onSignedOut = { [auth] in Task { await auth.signOut() } }
            model.start()
        }
        .onDisappear {
            model.stop()
            live.leave()
        }
        .onChange(of: scenePhase) { _, phase in
            switch phase {
            case .active:
                model.start()
                syncPreview()
            case .background:
                model.stop()
                // A call keeps going in the background; a silent preview does not.
                if live.call == .off { live.leave() }
            default:
                break
            }
        }
        .onChange(of: previewKey) { _, _ in syncPreview() }
        .onChange(of: model.needsPairing) { _, needs in
            // Stay in setup after pairing so the phone and window steps follow.
            if needs { setupStart = .pair }
        }
    }

    private var home: some View {
        HomeView(
            model: model,
            live: live,
            email: email,
            openLive: { startCall in liveCover = LiveCover(startCall: startCall) },
            openSettings: { showSettings = true },
            openSetup: { setupStart = .phone }
        )
        .fullScreenCover(item: $liveCover) { cover in
            LiveView(model: model, live: live, startWithCall: cover.startCall) {
                liveCover = nil
                syncPreview()
            }
        }
        .sheet(isPresented: $showSettings) {
            SettingsView(
                model: model,
                email: email,
                addPhone: {
                    showSettings = false
                    setupStart = .phone
                },
                pairAnotherMac: {
                    showSettings = false
                    setupStart = .pair
                },
                signOut: {
                    showSettings = false
                    live.leave()
                    Task { await auth.signOut() }
                }
            )
        }
    }

    /// Keeps a quiet watch connection open while the Mac is sharing, so the home card and
    /// the live screen show the picture instantly.
    private var previewKey: String {
        guard let mac = model.mac else { return "none" }
        return "\(mac.deviceId)-\(mac.isOnline)-\(mac.sharing ?? false)"
    }

    private func syncPreview() {
        guard scenePhase == .active, let mac = model.mac else { return }
        if mac.isOnline, mac.sharing == true {
            Task { await live.watch(deviceId: mac.deviceId) }
        } else if live.call == .off, liveCover == nil {
            live.leave()
        }
    }
}
