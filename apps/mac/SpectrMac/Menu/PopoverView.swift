import SpectrKit
import SwiftUI

/// The menu bar label. Idle shows the Spectr mark; sharing and "needs attention" swap
/// to different shapes so the state reads without color.
struct MenuBarLabel: View {
    let indicator: MenuBarIndicator

    var body: some View {
        switch indicator {
        case .idle:
            Image("MenuBarIcon").accessibilityLabel("Spectr")
        case .sharing:
            Image(systemName: "inset.filled.rectangle.and.person.filled")
                .accessibilityLabel("Spectr, sharing a window")
        case .attention:
            Image(systemName: "exclamationmark.triangle")
                .accessibilityLabel("Spectr, needs attention")
        }
    }
}

/// Everyday surface: current state at a glance, plus the two stop controls.
struct PopoverView: View {
    let state: HelperState
    var preview: CGImage?
    let actions: HelperActions

    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var confirmingUnpair = false

    private var showsShare: Bool { state.share.source != nil }
    private var showsTask: Bool { state.activity != nil && state.pairing.phone != nil }

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            header
                .padding(.horizontal, 14)
                .padding(.top, 14)
                .padding(.bottom, 12)

            if let source = state.share.source {
                Divider()
                ShareSection(source: source, share: state.share, preview: preview, actions: actions)
                    .padding(14)
                    .transition(.opacity)
            }

            if showsTask, let activity = state.activity {
                Divider()
                TaskSection(activity: activity, canStop: state.canStopTask, stop: actions.stopTask)
                    .padding(14)
                    .transition(.opacity)
            }

            if let notice = state.agentNotice, state.pairing.phone != nil {
                Divider()
                Label(notice, systemImage: "exclamationmark.triangle.fill")
                    .font(.callout)
                    .foregroundStyle(.orange)
                    .fixedSize(horizontal: false, vertical: true)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(14)
            }

            Divider()
            footer
                .padding(.horizontal, 10)
                .padding(.vertical, 8)
        }
        .frame(width: 340)
        .animation(reduceMotion ? nil : .snappy(duration: 0.25), value: showsShare)
        .animation(reduceMotion ? nil : .snappy(duration: 0.25), value: showsTask)
        .confirmationDialog("Unpair this Mac from your iPhone?", isPresented: $confirmingUnpair) {
            Button("Unpair", role: .destructive, action: actions.unpair)
        } message: {
            Text("Sharing stops, and you'll need to pair again before your iPhone can send instructions.")
        }
    }

    // MARK: Header

    private var header: some View {
        HStack(alignment: .top, spacing: 10) {
            Image(systemName: headerSymbol)
                .font(.title2)
                .foregroundStyle(headerTint)
                .frame(width: 28, alignment: .center)
                .accessibilityHidden(true)

            VStack(alignment: .leading, spacing: 3) {
                Text(state.headline)
                    .font(.headline)
                    .fixedSize(horizontal: false, vertical: true)
                if let detail = state.problemDetail {
                    Text(detail)
                        .font(.callout)
                        .foregroundStyle(.secondary)
                        .fixedSize(horizontal: false, vertical: true)
                }
                if let phoneLine = state.phoneLine {
                    Label(phoneLine, systemImage: "iphone")
                        .font(.callout)
                        .foregroundStyle(.secondary)
                        .lineLimit(2)
                }
                if state.pairing.phone != nil, state.share.source == nil, !isShareProblem,
                    state.problem != .screenRecordingOff
                {
                    HStack(spacing: 8) {
                        Text(state.share == .choosing ? "Choosing a window…" : "No window shared")
                            .font(.callout)
                            .foregroundStyle(.secondary)
                        Spacer(minLength: 0)
                        if state.canShareScreen {
                            Button("Choose Window…", action: actions.chooseWindow)
                                .disabled(state.share == .choosing)
                        }
                    }
                    .padding(.top, 5)
                }
                if let action = headerAction {
                    Button(action.title, action: action.run)
                        .buttonStyle(.borderedProminent)
                        .padding(.top, 6)
                }
            }
            Spacer(minLength: 0)
        }
        .accessibilityElement(children: .contain)
    }

    private var isShareProblem: Bool {
        switch state.problem {
        case .windowClosed, .sharingFailed: true
        default: false
        }
    }

    private var headerSymbol: String {
        switch state.problem {
        case .misconfigured, .sharingFailed: return "exclamationmark.triangle.fill"
        case .notPaired: return "iphone.slash"
        case .screenRecordingOff: return "eye.slash.fill"
        case .windowClosed: return "macwindow.badge.plus"
        case .controlOff: return "hand.raised.fill"
        case .none: break
        }
        if state.isWorking { return "cursorarrow.click.2" }
        return state.share.isCapturing ? "inset.filled.rectangle.and.person.filled" : "checkmark.circle.fill"
    }

    private var headerTint: Color {
        switch state.problem {
        case .none: Theme.accent
        case .notPaired: .secondary
        default: .orange
        }
    }

    private var headerAction: (title: String, run: () -> Void)? {
        switch state.problem {
        case .notPaired: ("Continue Setup…", actions.openSetup)
        case .screenRecordingOff: ("Fix in Setup…", actions.openSetup)
        case .controlOff: ("Allow Control…", actions.openSetup)
        case .windowClosed, .sharingFailed: ("Choose Window…", actions.chooseWindow)
        case .misconfigured, .none: nil
        }
    }

    // MARK: Footer

    private var footer: some View {
        HStack {
            Menu {
                Button("Setup & Permissions…", action: actions.openSetup)
                if let openLab = actions.openLab {
                    Button("Action Lab (Debug)…", action: openLab)
                }
                if state.pairing.phone != nil {
                    Divider()
                    Button("Unpair iPhone…", role: .destructive) { confirmingUnpair = true }
                }
            } label: {
                Label("Settings", systemImage: "gearshape")
                    .labelStyle(.iconOnly)
            }
            .menuStyle(.borderlessButton)
            .menuIndicator(.hidden)
            .fixedSize()
            .help("Settings")
            .accessibilityLabel("Settings")

            Spacer()

            Button("Quit Spectr", action: actions.quit)
                .buttonStyle(.borderless)
                .keyboardShortcut("q")
        }
        .foregroundStyle(.secondary)
    }
}

/// The window being shared. Its title is the largest text in the popover so a wrong
/// pick is obvious before anything else is exposed.
private struct ShareSection: View {
    let source: ShareSource
    let share: ShareState
    let preview: CGImage?
    let actions: HelperActions

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            SectionLabel(source.kind == .display ? "Sharing your whole display" : "Shared window")
            HStack(alignment: .top, spacing: 10) {
                thumbnail
                VStack(alignment: .leading, spacing: 2) {
                    Text(source.title)
                        .font(.title3.weight(.semibold))
                        .lineLimit(2)
                        .truncationMode(.middle)
                        .fixedSize(horizontal: false, vertical: true)
                    Text(subtitle)
                        .font(.callout)
                        .foregroundStyle(isStalled ? AnyShapeStyle(.orange) : AnyShapeStyle(.secondary))
                        .lineLimit(1)
                }
                Spacer(minLength: 0)
            }
            .accessibilityElement(children: .combine)
            .accessibilityLabel("Sharing \(source.summary). \(healthText)")

            HStack {
                Spacer()
                Button("Change…", action: actions.chooseWindow)
                Button("Stop Sharing", systemImage: "eye.slash", action: actions.stopSharing)
                    .help("Your iPhone stops seeing this Mac. The task is not stopped.")
            }
        }
    }

    private var thumbnail: some View {
        ZStack {
            RoundedRectangle(cornerRadius: 5).fill(.quaternary)
            if let preview {
                Image(decorative: preview, scale: 1)
                    .resizable()
                    .scaledToFit()
                    .clipShape(.rect(cornerRadius: 4))
            } else {
                Image(systemName: source.kind == .display ? "display" : "macwindow")
                    .font(.title2)
                    .foregroundStyle(.secondary)
            }
        }
        .frame(width: 76, height: 50)
        .overlay { RoundedRectangle(cornerRadius: 5).strokeBorder(Theme.accent, lineWidth: 1.5) }
        .accessibilityHidden(true)
    }

    private var isStalled: Bool {
        if case .live(_, .stalled) = share { return true }
        return false
    }

    private var healthText: String {
        switch share {
        case .starting, .live(_, .waitingForFirstFrame): "Starting…"
        case .live(_, .live): "Live"
        case .live(_, .liveStatic): "Live · no changes"
        case .live(_, .stalled): "Not updating"
        case .none, .choosing, .ended: ""
        }
    }

    private var subtitle: String {
        [source.appName, healthText].compactMap { $0 }.filter { !$0.isEmpty }.joined(separator: " · ")
    }
}

/// The instruction in progress. Heights are reserved so the popover does not jump when
/// "Working…" becomes "Done".
private struct TaskSection: View {
    let activity: TaskActivity
    let canStop: Bool
    let stop: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            SectionLabel(activity.phase == .working ? "Current instruction" : "Last instruction")
            Text("“\(activity.instruction)”")
                .font(.body.weight(.medium))
                .lineLimit(3)
                .fixedSize(horizontal: false, vertical: true)
                .textSelection(.enabled)

            HStack(alignment: .center, spacing: 8) {
                statusIcon
                    .frame(width: 16, height: 16)
                    .accessibilityHidden(true)
                Text(activity.statusText)
                    .font(.callout)
                    .lineLimit(1)
                Spacer(minLength: 0)
                Button("Stop Task", systemImage: "stop.fill", role: .destructive, action: stop)
                    .keyboardShortcut(".")
                    .disabled(!canStop)
                    .opacity(activity.phase == .working ? 1 : 0)
                    .accessibilityHidden(activity.phase != .working)
                    .help("Stops this instruction on the Mac. Sharing continues.")
            }
            .frame(minHeight: 28)
            .accessibilityElement(children: .contain)

            Text(activity.detailText ?? " ")
                .font(.caption)
                .foregroundStyle(.secondary)
                .lineLimit(1)
                .truncationMode(.middle)
                .accessibilityHidden(activity.detailText == nil)
        }
    }

    @ViewBuilder private var statusIcon: some View {
        switch activity.phase {
        case .working:
            ProgressView().controlSize(.small)
        case .waitingForUser:
            Image(systemName: "questionmark.bubble").foregroundStyle(.secondary)
        case .done:
            Image(systemName: "checkmark.circle.fill").foregroundStyle(Theme.accent)
        case .unconfirmed:
            Image(systemName: "questionmark.circle").foregroundStyle(.orange)
        case .failed:
            Image(systemName: "xmark.octagon.fill").foregroundStyle(.orange)
        case .stopped:
            Image(systemName: "stop.circle").foregroundStyle(.secondary)
        }
    }
}

private struct SectionLabel: View {
    let title: String

    init(_ title: String) {
        self.title = title
    }

    var body: some View {
        Text(title)
            .font(.caption.weight(.semibold))
            .foregroundStyle(.secondary)
            .accessibilityAddTraits(.isHeader)
    }
}
