import LiveKit
import SpectrKit
import SwiftUI

/// Full screen: your Mac's screen live, what Spectr is doing, and a hands-free call.
struct LiveView: View {
    let model: AppModel
    let live: LiveSession
    let startWithCall: Bool
    let close: () -> Void

    @State private var draft = ""
    @State private var panelExpanded = true
    @State private var didStartCall = false

    var body: some View {
        ZStack {
            Color.black.ignoresSafeArea()
            screen
                .ignoresSafeArea(edges: .horizontal)
                .onTapGesture { withAnimation(.snappy) { panelExpanded.toggle() } }
        }
        .safeAreaInset(edge: .top) { topBar }
        .safeAreaInset(edge: .bottom) { panel }
        .preferredColorScheme(.dark)
        .statusBarHidden(false)
        .task {
            guard let mac = model.mac else { return }
            if startWithCall, !didStartCall {
                didStartCall = true
                await live.startCall(deviceId: mac.deviceId)
            } else {
                await live.watch(deviceId: mac.deviceId)
            }
        }
        .onChange(of: model.activeTask?.state) { _, state in
            if state == .waitingForUser { Haptics.warning() }
        }
        .overlay(alignment: .top) {
            if let notice = model.notice {
                NoticeBanner(message: notice).padding(.top, 60)
            }
        }
        .animation(.snappy, value: model.notice)
    }

    // MARK: Screen

    @ViewBuilder private var screen: some View {
        switch live.phase {
        case .live, .reconnecting:
            if let track = live.screen {
                SwiftUIVideoView(track, layoutMode: .fit, pinchToZoomOptions: [.zoomIn, .resetOnRelease])
                    .overlay(alignment: .topTrailing) {
                        if live.phase == .reconnecting {
                            Label("Reconnecting…", systemImage: "wifi.exclamationmark")
                                .font(.caption.weight(.semibold))
                                .padding(8)
                                .background(.ultraThinMaterial, in: .capsule)
                                .padding()
                        }
                    }
            } else {
                message(
                    "Reconnecting to your Mac…", detail: nil, symbol: "wifi.exclamationmark", spinning: true)
            }
        case .idle, .connecting:
            message("Connecting to your Mac…", detail: nil, symbol: "laptopcomputer", spinning: true)
        case .waitingForScreen:
            message(
                "Your Mac isn't sharing a window",
                detail:
                    "On your Mac, click ✦ in the menu bar and choose the window Spectr should use. It appears here the moment you do.",
                symbol: "rectangle.dashed.badge.record", spinning: false)
        case .failed(let reason):
            VStack(spacing: Theme.spacing * 2) {
                message(reason, detail: nil, symbol: "exclamationmark.triangle", spinning: false)
                Button("Try Again") { Task { await live.retry() } }
                    .buttonStyle(SolidButtonStyle(tint: .white, foreground: .black))
                    .frame(maxWidth: 220)
            }
        }
    }

    private func message(_ title: String, detail: String?, symbol: String, spinning: Bool) -> some View {
        VStack(spacing: Theme.spacing * 1.5) {
            if spinning {
                ProgressView().tint(.white).controlSize(.large)
            } else {
                Image(systemName: symbol).font(.system(size: 40, weight: .light))
            }
            Text(title).font(.headline).multilineTextAlignment(.center)
            if let detail {
                Text(detail)
                    .font(.subheadline)
                    .foregroundStyle(.white.opacity(0.7))
                    .multilineTextAlignment(.center)
            }
        }
        .foregroundStyle(.white)
        .padding(32)
        .frame(maxWidth: 420)
    }

    // MARK: Bars

    private var topBar: some View {
        HStack(spacing: Theme.spacing) {
            Button {
                Task {
                    await live.endCall()
                    close()
                }
            } label: {
                Image(systemName: "chevron.down")
                    .font(.body.weight(.bold))
                    .frame(width: 40, height: 40)
                    .background(.ultraThinMaterial, in: .circle)
            }
            .accessibilityLabel("Close")
            VStack(alignment: .leading, spacing: 1) {
                Text(model.mac?.name ?? "Your Mac")
                    .font(.subheadline.weight(.semibold))
                HStack(spacing: 5) {
                    StatusDot(color: live.phase == .live ? .red : .gray, pulsing: live.phase == .live)
                    Text(liveLabel).font(.caption).foregroundStyle(.white.opacity(0.7))
                }
            }
            Spacer()
            if live.call != .off {
                CallTimer(start: live.callStartedAt)
            }
        }
        .foregroundStyle(.white)
        .padding(.horizontal)
        .padding(.top, 4)
    }

    private var liveLabel: String {
        switch live.phase {
        case .live: "Live"
        case .reconnecting: "Reconnecting"
        case .waitingForScreen: "Waiting for a shared window"
        case .connecting, .idle: "Connecting"
        case .failed: "Disconnected"
        }
    }

    private var panel: some View {
        VStack(spacing: Theme.spacing * 1.5) {
            if panelExpanded {
                if let task = model.activeTask {
                    ActiveTaskCard(task: task, model: model, dark: true)
                } else if let result = model.latestResult {
                    compactResult(result)
                }
            }
            callStrip
            Composer(
                text: $draft,
                placeholder: model.activeTask == nil ? "Tell your Mac what to do…" : "Change the task…",
                isSending: model.isSending,
                dark: true
            ) {
                let text = draft
                Task {
                    if await model.send(text) {
                        draft = ""
                        Haptics.tap()
                    }
                }
            }
        }
        .padding(Theme.spacing * 1.5)
        .background(.ultraThinMaterial.opacity(0.95), in: .rect(cornerRadius: 24))
        .padding(.horizontal, Theme.spacing)
        .padding(.bottom, 4)
        .animation(.snappy, value: model.activeTask)
        .animation(.snappy, value: panelExpanded)
    }

    private func compactResult(_ task: AppTask) -> some View {
        HStack(alignment: .top, spacing: Theme.spacing) {
            Image(systemName: task.state.symbol).foregroundStyle(task.state.tint)
            VStack(alignment: .leading, spacing: 2) {
                Text(task.state.label).font(.subheadline.weight(.semibold))
                if let summary = task.summary {
                    Text(summary).font(.footnote).foregroundStyle(.white.opacity(0.75)).lineLimit(3)
                }
            }
            Spacer(minLength: 0)
        }
        .foregroundStyle(.white)
        .padding(Theme.spacing * 1.5)
        .background(Color.white.opacity(0.08), in: .rect(cornerRadius: 14))
    }

    // MARK: Call

    @ViewBuilder private var callStrip: some View {
        switch live.call {
        case .off:
            Button {
                Haptics.tap()
                guard let mac = model.mac else { return }
                Task { await live.startCall(deviceId: mac.deviceId) }
            } label: {
                Label("Talk to Spectr", systemImage: "waveform")
            }
            .buttonStyle(SolidButtonStyle(tint: Theme.accent))
            .disabled(model.mac?.isOnline != true)
        case .starting:
            HStack(spacing: Theme.spacing) {
                ProgressView().tint(.white)
                Text("Calling Spectr…").foregroundStyle(.white)
            }
            .frame(maxWidth: .infinity, minHeight: 50)
        case .active:
            HStack(spacing: Theme.spacing * 1.5) {
                Button {
                    Task { await live.toggleMute() }
                } label: {
                    Image(systemName: live.isMuted ? "mic.slash.fill" : "mic.fill")
                        .font(.title3)
                        .frame(width: 52, height: 52)
                        .foregroundStyle(live.isMuted ? .black : .white)
                        .background(live.isMuted ? Color.white : Color.white.opacity(0.15), in: .circle)
                }
                .accessibilityLabel(live.isMuted ? "Unmute" : "Mute")
                VoiceIndicator(live: live)
                    .frame(maxWidth: .infinity)
                Button {
                    Haptics.tap()
                    Task { await live.endCall() }
                } label: {
                    Image(systemName: "phone.down.fill")
                        .font(.title3)
                        .frame(width: 52, height: 52)
                        .foregroundStyle(.white)
                        .background(Theme.critical, in: .circle)
                }
                .accessibilityLabel("End call")
            }
        }
    }
}

/// Shows who is talking: Spectr, you, or that Spectr is listening.
private struct VoiceIndicator: View {
    let live: LiveSession

    var body: some View {
        HStack(spacing: Theme.spacing) {
            Bars(active: live.agentSpeaking || live.userSpeaking)
                .foregroundStyle(live.agentSpeaking ? Theme.accent : .white)
            Text(text)
                .font(.subheadline.weight(.medium))
                .foregroundStyle(.white)
                .lineLimit(1)
                .contentTransition(.opacity)
        }
        .animation(.easeInOut(duration: 0.2), value: text)
        .accessibilityElement(children: .combine)
    }

    private var text: String {
        if !live.agentJoined { return "Connecting Spectr…" }
        if live.isMuted { return "Muted" }
        if live.agentSpeaking { return "Spectr is speaking" }
        if live.userSpeaking { return "Listening…" }
        return "Say what to do"
    }
}

private struct Bars: View {
    let active: Bool

    var body: some View {
        TimelineView(.animation(minimumInterval: 0.08, paused: !active)) { context in
            let t = context.date.timeIntervalSinceReferenceDate
            HStack(spacing: 3) {
                ForEach(0..<5) { index in
                    Capsule()
                        .frame(width: 3, height: active ? 6 + 14 * abs(sin(t * 6 + Double(index))) : 6)
                }
            }
            .frame(height: 22)
        }
        .accessibilityHidden(true)
    }
}

private struct CallTimer: View {
    let start: Date?

    var body: some View {
        TimelineView(.periodic(from: .now, by: 1)) { context in
            Label(elapsed(at: context.date), systemImage: "phone.fill")
                .font(.caption.monospacedDigit().weight(.semibold))
                .foregroundStyle(.white)
                .padding(.horizontal, 10)
                .padding(.vertical, 6)
                .background(Color.green.opacity(0.8), in: .capsule)
        }
    }

    private func elapsed(at now: Date) -> String {
        let seconds = Int(now.timeIntervalSince(start ?? now))
        return String(format: "%d:%02d", seconds / 60, seconds % 60)
    }
}
