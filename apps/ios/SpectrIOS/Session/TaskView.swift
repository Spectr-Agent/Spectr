import SpectrKit
import SwiftUI

/// The one screen for watching and steering a task: which Mac, what task, whether the
/// picture is live, and how to correct or stop it.
struct TaskView: View {
    @Bindable var session: TaskSession
    let onClose: () -> Void
    @Environment(\.verticalSizeClass) private var verticalSizeClass

    var body: some View {
        ZStack {
            Theme.background.ignoresSafeArea()
            if verticalSizeClass == .compact {
                HStack(alignment: .top, spacing: Theme.spacing * 2) {
                    ViewerView(phase: session.phase, isTestData: session.isTestData, onReconnect: session.reconnect)
                    VStack(spacing: Theme.spacing * 1.5) {
                        header
                        StepListView(session: session)
                        ComposerView(session: session)
                    }
                    .frame(maxWidth: 360)
                }
                .padding(Theme.spacing * 2)
            } else {
                VStack(spacing: Theme.spacing * 1.5) {
                    header
                    ViewerView(phase: session.phase, isTestData: session.isTestData, onReconnect: session.reconnect)
                    StepListView(session: session)
                    ComposerView(session: session)
                }
                .padding(.horizontal, Theme.spacing * 2)
                .padding(.vertical, Theme.spacing)
            }
        }
        .task { await session.start() }
        .onChange(of: session.phase) { _, phase in
            AccessibilityNotification.Announcement(ViewerView.title(for: phase)).post()
        }
    }

    private var header: some View {
        HStack(alignment: .center, spacing: Theme.spacing) {
            Button {
                session.leave()
                onClose()
            } label: {
                Image(systemName: "chevron.down")
                    .font(.body.weight(.semibold))
                    .frame(width: 44, height: 44)
            }
            .accessibilityLabel("Leave session")
            .foregroundStyle(Theme.ink)

            VStack(alignment: .leading, spacing: 2) {
                HStack(spacing: 6) {
                    Text(session.macName)
                        .font(.headline)
                        .foregroundStyle(Theme.ink)
                    if session.isTestData {
                        Text("TEST DATA")
                            .font(.caption2.weight(.bold))
                            .padding(.horizontal, 6)
                            .padding(.vertical, 2)
                            .foregroundStyle(Theme.accent)
                            .background(Theme.accentSoft, in: .capsule)
                            .accessibilityLabel("Showing test data, not a real Mac")
                    }
                }
                Text(stateText)
                    .font(.subheadline)
                    .foregroundStyle(Theme.inkSecondary)
                    .lineLimit(2)
            }
            .accessibilityElement(children: .combine)

            Spacer(minLength: Theme.spacing)

            StopButton(session: session)
        }
    }

    private var stateText: String {
        guard let snapshot = session.snapshot else {
            return session.loadError ?? "Loading task…"
        }
        let label: String =
            switch snapshot.state {
            case .accepted: "Starting"
            case .running: "Working"
            case .waitingForUser: "Needs your answer"
            case .succeeded: "Done"
            case .failed: "Couldn't finish"
            case .cancelled: "Stopped"
            }
        if session.stopState == .requested, !snapshot.state.isTerminal {
            return "Stop requested · \(snapshot.instruction)"
        }
        return "\(label) · \(snapshot.instruction)"
    }
}

private struct StopButton: View {
    let session: TaskSession

    var body: some View {
        Button {
            Task { await session.stop() }
        } label: {
            Label(title, systemImage: "stop.fill")
                .font(.subheadline.weight(.semibold))
                .padding(.horizontal, 14)
                .frame(minHeight: 44)
        }
        .buttonStyle(.plain)
        .foregroundStyle(session.canStop ? Color.white : Theme.inkSecondary)
        .background(session.canStop ? Theme.critical : Theme.hairline, in: .capsule)
        .disabled(!session.canStop)
        .accessibilityHint("Stops the task on your Mac")
    }

    private var title: String {
        switch session.stopState {
        case .requesting: "Stopping…"
        case .requested: "Stopping"
        case .idle, .failed: "Stop"
        }
    }
}

/// The video area. Until the LiveKit subscriber lands, it renders state only;
/// it never shows a placeholder image pretending to be the Mac's screen.
struct ViewerView: View {
    let phase: ViewerPhase
    let isTestData: Bool
    let onReconnect: () -> Void

    var body: some View {
        ZStack {
            RoundedRectangle(cornerRadius: Theme.cornerRadius)
                .fill(Color.black)
            VStack(spacing: Theme.spacing) {
                if phase.recovery == .wait {
                    ProgressView().tint(.white)
                } else {
                    Image(systemName: symbol)
                        .font(.title2)
                        .foregroundStyle(phase.isShowingVideo ? Theme.accent : .white.opacity(0.9))
                }
                Text(Self.title(for: phase))
                    .font(.headline)
                    .foregroundStyle(.white)
                Text(detail)
                    .font(.footnote)
                    .foregroundStyle(.white.opacity(0.7))
                    .multilineTextAlignment(.center)
                if phase.recovery == .reconnect {
                    Button("Reconnect", action: onReconnect)
                        .buttonStyle(.borderedProminent)
                        .controlSize(.small)
                }
            }
            .padding(Theme.spacing * 2)

            if phase.isShowingVideo {
                VStack {
                    HStack {
                        LiveBadge(isStatic: phase == .liveStatic)
                        Spacer()
                    }
                    Spacer()
                }
                .padding(Theme.spacing * 1.5)
            }
        }
        .aspectRatio(16 / 10, contentMode: .fit)
        .accessibilityElement(children: .combine)
        .accessibilityLabel("Mac screen: \(Self.title(for: phase))")
    }

    static func title(for phase: ViewerPhase) -> String {
        switch phase {
        case .joining: "Connecting"
        case .awaitingPublisher: "Waiting for your Mac to share"
        case .receivingFirstFrame: "Receiving the first frame"
        case .live: "Live"
        case .liveStatic: "Live · no changes"
        case .interrupted: "Picture interrupted"
        case .recovering: "Reconnecting"
        case .blockedByPermission: "Mac can't share its screen"
        case .accessRevoked: "Access ended"
        case .ended: "Session ended"
        case .failed: "Couldn't connect"
        }
    }

    private var detail: String {
        switch phase {
        case .live, .liveStatic:
            isTestData ? "Test data: no real video is being received." : ""
        case .awaitingPublisher: "On the Mac, choose a window in the Spectr menu."
        case .blockedByPermission: "Screen sharing is off or the shared window closed. Check the Mac."
        case .interrupted: "No frames are arriving from the Mac."
        case .accessRevoked: "Sign in again to keep watching."
        case .ended: "Start a new session to watch again."
        case .failed(let message): message
        case .joining, .receivingFirstFrame, .recovering: ""
        }
    }

    private var symbol: String {
        switch phase {
        case .live, .liveStatic: "display"
        case .awaitingPublisher, .blockedByPermission: "rectangle.dashed"
        case .interrupted, .failed: "wifi.exclamationmark"
        case .accessRevoked: "lock"
        case .ended: "stop.circle"
        case .joining, .receivingFirstFrame, .recovering: "hourglass"
        }
    }
}

private struct LiveBadge: View {
    let isStatic: Bool

    var body: some View {
        HStack(spacing: 5) {
            Circle().fill(isStatic ? Theme.inkSecondary : Theme.accent).frame(width: 7, height: 7)
            Text(isStatic ? "LIVE · STILL" : "LIVE")
                .font(.caption2.weight(.bold))
        }
        .foregroundStyle(.white)
        .padding(.horizontal, 8)
        .padding(.vertical, 4)
        .background(.black.opacity(0.55), in: .capsule)
        .accessibilityHidden(true)
    }
}

struct StepListView: View {
    let session: TaskSession

    var body: some View {
        ScrollViewReader { proxy in
            ScrollView {
                LazyVStack(alignment: .leading, spacing: Theme.spacing) {
                    if session.steps.isEmpty {
                        Text("Steps the Mac takes will appear here, each with what Spectr could confirm.")
                            .font(.footnote)
                            .foregroundStyle(Theme.inkSecondary)
                            .padding(.vertical, Theme.spacing)
                    }
                    ForEach(session.steps) { step in
                        StepRow(step: step).id(step.id)
                    }
                }
                .frame(maxWidth: .infinity, alignment: .leading)
            }
            .onChange(of: session.steps.count) {
                if let last = session.steps.last {
                    withAnimation { proxy.scrollTo(last.id, anchor: .bottom) }
                }
            }
        }
    }
}

private struct StepRow: View {
    let step: TaskStep

    var body: some View {
        HStack(alignment: .firstTextBaseline, spacing: Theme.spacing * 1.25) {
            Image(systemName: symbol)
                .foregroundStyle(color)
                .accessibilityHidden(true)
            VStack(alignment: .leading, spacing: 2) {
                Text(step.summary)
                    .font(.body)
                    .foregroundStyle(Theme.ink)
                Text(outcomeText + (step.detail.map { " · \($0)" } ?? ""))
                    .font(.caption)
                    .foregroundStyle(Theme.inkSecondary)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
        .padding(Theme.spacing * 1.5)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Theme.surface, in: .rect(cornerRadius: 12))
        .overlay { RoundedRectangle(cornerRadius: 12).stroke(Theme.hairline) }
        .accessibilityElement(children: .combine)
    }

    private var outcomeText: String {
        switch step.outcome {
        case .succeeded: "Confirmed"
        case .unverified: "Not confirmed"
        case .failed: "Failed"
        case .rejected: "Refused"
        }
    }

    private var symbol: String {
        switch step.outcome {
        case .succeeded: "checkmark.circle.fill"
        case .unverified: "questionmark.circle"
        case .failed: "xmark.circle.fill"
        case .rejected: "hand.raised.circle"
        }
    }

    private var color: Color {
        switch step.outcome {
        case .succeeded: Theme.accent
        case .unverified: Theme.inkSecondary
        case .failed, .rejected: Theme.critical
        }
    }
}

struct ComposerView: View {
    @Bindable var session: TaskSession
    @FocusState private var focused: Bool

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            if case .failed(let message) = session.sendState {
                Text(message)
                    .font(.footnote)
                    .foregroundStyle(Theme.critical)
            }
            if case .failed(let message) = session.stopState {
                Text("Stop not sent: \(message)")
                    .font(.footnote)
                    .foregroundStyle(Theme.critical)
            }
            HStack(alignment: .bottom, spacing: Theme.spacing) {
                TextField("Tell your Mac what to do instead…", text: $session.draft, axis: .vertical)
                    .lineLimit(1...4)
                    .focused($focused)
                    .submitLabel(.send)
                    .onSubmit { Task { await session.send() } }
                    .padding(.horizontal, 14)
                    .padding(.vertical, 10)
                    .background(Theme.surface, in: .rect(cornerRadius: 20))
                    .overlay { RoundedRectangle(cornerRadius: 20).stroke(Theme.hairline) }
                    .disabled(session.isTerminal)

                Button {
                    Task { await session.send() }
                } label: {
                    Group {
                        if session.sendState == .sending {
                            ProgressView()
                        } else {
                            Image(systemName: "arrow.up")
                                .font(.body.weight(.bold))
                        }
                    }
                    .frame(width: 44, height: 44)
                    .foregroundStyle(.white)
                    .background(session.canSend ? Theme.accent : Theme.hairline, in: .circle)
                }
                .disabled(!session.canSend)
                .accessibilityLabel(session.sendState == .sending ? "Sending" : "Send instruction")
            }
            if session.isTerminal {
                Text("This task has ended.")
                    .font(.footnote)
                    .foregroundStyle(Theme.inkSecondary)
            }
        }
    }
}
