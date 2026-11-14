import SpectrKit
import SwiftUI

/// First-run setup and permission recovery. The current step is derived from real
/// state, so coming back from System Settings (or relaunching) lands on the same step.
struct SetupView: View {
    let state: HelperState
    let actions: HelperActions

    /// A step the user clicked; nil follows the first incomplete step.
    @State private var selection: SetupStep?

    private var shown: SetupStep? { selection ?? state.currentSetupStep }

    var body: some View {
        HStack(spacing: 0) {
            stepList
                .frame(width: 220)
                .background(.quaternary.opacity(0.4))
            Divider()
            Group {
                if let shown {
                    StepDetail(step: shown, state: state, actions: actions)
                } else {
                    AllSet(state: state)
                }
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        }
        .frame(width: 680, height: 460)
        .onChange(of: state.currentSetupStep) { selection = nil }
    }

    private var stepList: some View {
        VStack(alignment: .leading, spacing: 2) {
            Text("Set up Spectr")
                .font(.title3.weight(.semibold))
                .padding(.horizontal, 10)
                .padding(.bottom, 10)
            ForEach(SetupStep.allCases) { step in
                Button {
                    selection = step
                } label: {
                    HStack(spacing: 8) {
                        Image(systemName: symbol(for: step))
                            .foregroundStyle(tint(for: step))
                            .frame(width: 18)
                        Text(step.title)
                        Spacer(minLength: 0)
                    }
                    .padding(.horizontal, 10)
                    .padding(.vertical, 7)
                    .contentShape(.rect)
                    .background(
                        shown == step ? AnyShapeStyle(.selection.opacity(0.35)) : AnyShapeStyle(.clear),
                        in: .rect(cornerRadius: 6))
                }
                .buttonStyle(.plain)
                .accessibilityLabel("\(step.title), \(statusWord(for: step))")
                .accessibilityAddTraits(shown == step ? .isSelected : [])
            }
            Spacer()
        }
        .padding(.horizontal, 8)
        .padding(.vertical, 18)
    }

    private func symbol(for step: SetupStep) -> String {
        if state.isComplete(step) { return "checkmark.circle.fill" }
        return step == state.currentSetupStep ? "\(step.rawValue + 1).circle.fill" : "\(step.rawValue + 1).circle"
    }

    private func tint(for step: SetupStep) -> Color {
        if state.isComplete(step) { return .green }
        return step == state.currentSetupStep ? Theme.accent : .secondary
    }

    private func statusWord(for step: SetupStep) -> String {
        if state.isComplete(step) { return "done" }
        return step == state.currentSetupStep ? "next" : "not done"
    }
}

extension SetupStep {
    var title: String {
        switch self {
        case .pair: "Pair your iPhone"
        case .screenRecording: "Allow screen recording"
        case .control: "Allow control"
        case .window: "Choose a window"
        }
    }

    fileprivate var artwork: String {
        switch self {
        case .pair: "spectr_pairing"
        case .screenRecording, .window: "spectr_permission_screen"
        case .control: "spectr_permission_control"
        }
    }
}

private struct StepDetail: View {
    let step: SetupStep
    let state: HelperState
    let actions: HelperActions
    @State private var token = ""

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            Image(step.artwork)
                .resizable()
                .scaledToFit()
                .frame(maxWidth: .infinity)
                .frame(height: 110)
                .padding(.vertical, 6)
                // The mascot is white; a fixed deep panel keeps it legible in light mode too.
                .background(Color(red: 0.11, green: 0.15, blue: 0.27), in: .rect(cornerRadius: 10))
                .accessibilityHidden(true)

            Text(title)
                .font(.title2.weight(.semibold))
                .fixedSize(horizontal: false, vertical: true)
                .accessibilityAddTraits(.isHeader)

            VStack(alignment: .leading, spacing: 8) {
                Fact(label: "What to do", text: whatToDo)
                Fact(label: "Why", text: why)
                Fact(label: "How you'll know", text: howYoullKnow)
            }

            control
                .padding(.top, 6)
                .padding(.leading, 114)
            Spacer(minLength: 0)
        }
        .padding(24)
    }

    // MARK: Copy

    private var windowClosed: ShareSource?? {
        if case .ended(.windowClosed(let source)) = state.share { return .some(source) }
        return nil
    }

    private var title: String {
        switch step {
        case .pair: return state.pairing.phone == nil ? "Connect this Mac to your account" : "This Mac is connected"
        case .screenRecording:
            return state.canShareScreen
                ? "Screen recording is allowed" : "Your iPhone can't see this Mac yet"
        case .control:
            return state.permissions.accessibility ? "Control is allowed" : "Let Spectr click and type"
        case .window:
            if case .some(let source) = windowClosed {
                return source.map { "“\($0.title)” closed" } ?? "The shared window closed"
            }
            return "Choose the window to share"
        }
    }

    private var whatToDo: String {
        switch step {
        case .pair:
            "Paste this Mac's device token below. The backend owner issues it with services/api/scripts/issue-device-token.mjs."
        case .screenRecording:
            "Open System Settings › Privacy & Security › Screen & System Audio Recording and turn on Spectr."
        case .control:
            "Open System Settings › Privacy & Security › Accessibility and turn on Spectr."
        case .window:
            "Pick one window in the macOS picker. Choose the app you want your iPhone to operate."
        }
    }

    private var why: String {
        switch step {
        case .pair:
            "The token ties this Mac to your account, so only your tasks run here. It is kept in this Mac's Keychain and can be revoked."
        case .screenRecording:
            "Without it, nothing reaches your iPhone: the live view stays blank. Spectr only ever captures the window you pick."
        case .control:
            "Spectr clicks, types and reads back what happened through Accessibility. Sharing works without it, but instructions can't be carried out."
        case .window:
            if windowClosed != nil {
                "Sharing stopped when the window went away. Spectr never switches to another window or your desktop on its own."
            } else {
                "Your iPhone sees this window and nothing else. You can change it or stop sharing from the menu bar at any time."
            }
        }
    }

    private var howYoullKnow: String {
        switch step {
        case .pair:
            "Spectr checks the token with the backend right away. This step checks itself off when it's accepted."
        case .screenRecording:
            "Come back to this window; Spectr rechecks on its own. If macOS asks you to quit and reopen Spectr, setup resumes right here."
        case .control:
            "Come back to this window; the step checks itself off within a couple of seconds."
        case .window:
            "The window's name appears here and in the menu bar, and the menu bar icon changes while it's shared."
        }
    }

    // MARK: Controls

    @ViewBuilder private var control: some View {
        switch step {
        case .pair: pairingControl
        case .screenRecording:
            if state.canShareScreen {
                DoneRow(text: "Screen recording is on for Spectr.")
            } else {
                VStack(alignment: .leading, spacing: 8) {
                    Button("Open Screen Recording Settings…", action: actions.requestScreenRecording)
                        .buttonStyle(.borderedProminent)
                        .controlSize(.large)
                    Text(
                        "Spectr not in the list? Click + under the list and choose Spectr, then reopen it. Already on but still asked? macOS ties the permission to one copy of the app: turn it off and on again, then reopen."
                    )
                    .font(.callout)
                    .foregroundStyle(.secondary)
                    .fixedSize(horizontal: false, vertical: true)
                    Button("Quit and Reopen Spectr", action: actions.relaunch)
                }
            }
        case .control:
            if state.permissions.accessibility {
                DoneRow(text: "Accessibility is on for Spectr.")
            } else {
                VStack(alignment: .leading, spacing: 8) {
                    if state.share.isCapturing {
                        Label("Sharing still works. Only clicking and typing are blocked.", systemImage: "info.circle")
                            .font(.callout)
                            .foregroundStyle(.secondary)
                    }
                    Button("Open Accessibility Settings…", action: actions.requestAccessibility)
                        .buttonStyle(.borderedProminent)
                        .controlSize(.large)
                }
            }
        case .window:
            if let source = state.share.source {
                DoneRow(text: "Sharing “\(source.title)”\(source.appName.map { " in \($0)" } ?? "").")
            } else {
                VStack(alignment: .leading, spacing: 8) {
                    Button("Choose Window…", action: actions.chooseWindow)
                        .buttonStyle(.borderedProminent)
                        .controlSize(.large)
                        .disabled(!state.canShareScreen || state.share == .choosing)
                    if !state.canShareScreen {
                        Text("Allow screen recording first.")
                            .font(.callout)
                            .foregroundStyle(.secondary)
                    }
                }
            }
        }
    }

    @ViewBuilder private var pairingControl: some View {
        switch state.pairing {
        case .paired:
            DoneRow(text: "Connected. Tasks for your account run on this Mac.")
        case .requesting:
            HStack(spacing: 8) {
                ProgressView().controlSize(.small)
                Text("Checking the token…").foregroundStyle(.secondary)
            }
        case .unpaired, .failed:
            VStack(alignment: .leading, spacing: 8) {
                if case .failed(let failure) = state.pairing {
                    Label(
                        failure == .invalidToken
                            ? "The backend didn't accept that token. It may be mistyped, revoked or for another server."
                            : state.configurationError.map { "This build can't reach a Spectr server. \($0)" }
                                ?? "Couldn't reach the Spectr server. Check the internet connection and the server address.",
                        systemImage: "exclamationmark.triangle.fill"
                    )
                    .foregroundStyle(.orange)
                    .fixedSize(horizontal: false, vertical: true)
                }
                SecureField("Device token (spd_…)", text: $token)
                    .textFieldStyle(.roundedBorder)
                    .frame(maxWidth: 360)
                    .onSubmit { actions.connectDevice(token) }
                    .accessibilityLabel("Device token")
                HStack {
                    Button("Connect") {
                        actions.connectDevice(token)
                        token = ""
                    }
                    .buttonStyle(.borderedProminent)
                    .controlSize(.large)
                    .disabled(token.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                    if let useLabDevice = actions.useLabDevice {
                        Button("Use Local Lab Device (Debug)", action: useLabDevice)
                            .controlSize(.large)
                    }
                }
            }
        }
    }
}

private struct Fact: View {
    let label: String
    let text: String

    var body: some View {
        HStack(alignment: .firstTextBaseline, spacing: 10) {
            Text(label)
                .font(.callout.weight(.medium))
                .foregroundStyle(.secondary)
                .frame(width: 104, alignment: .trailing)
            Text(text)
                .font(.callout)
                .fixedSize(horizontal: false, vertical: true)
        }
        .accessibilityElement(children: .combine)
    }
}

private struct DoneRow: View {
    let text: String

    var body: some View {
        Label(text, systemImage: "checkmark.circle.fill")
            .symbolRenderingMode(.multicolor)
            .font(.body.weight(.medium))
    }
}

private struct AllSet: View {
    let state: HelperState

    var body: some View {
        VStack(spacing: 12) {
            Spacer()
            Image("spectr_success")
                .resizable()
                .scaledToFit()
                .frame(height: 130)
                .accessibilityHidden(true)
            Text("Spectr is ready")
                .font(.title2.weight(.semibold))
            Text(
                "Text or call from \(state.pairing.phone?.phoneName ?? "your iPhone"). Spectr stays in the menu bar; you can close this window."
            )
            .foregroundStyle(.secondary)
            .multilineTextAlignment(.center)
            .fixedSize(horizontal: false, vertical: true)
            Spacer()
        }
        .padding(32)
        .frame(maxWidth: .infinity)
    }
}
