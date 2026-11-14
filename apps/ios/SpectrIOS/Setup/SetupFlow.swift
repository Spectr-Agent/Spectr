import SwiftUI

/// First-run setup, also reachable later from Settings: pair the Mac, add a phone number,
/// and share a window. Every step checks itself off from live server state, so nothing
/// needs a "done" tap once it has really happened.
struct SetupFlow: View {
    enum Step: Int, CaseIterable {
        case pair
        case phone
        case share
        case done
    }

    let model: AppModel
    let finish: () -> Void
    @State private var step: Step

    init(model: AppModel, start: Step = .pair, finish: @escaping () -> Void) {
        self.model = model
        self.finish = finish
        _step = State(initialValue: start)
    }

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: Theme.spacing * 3) {
                    progress
                    Group {
                        switch step {
                        case .pair: PairStep(model: model) { advance(from: .pair) }
                        case .phone: PhoneStep(model: model) { advance(from: .phone) }
                        case .share: ShareStep(model: model) { advance(from: .share) }
                        case .done: DoneStep(model: model, finish: finish)
                        }
                    }
                    .transition(
                        .asymmetric(insertion: .move(edge: .trailing), removal: .move(edge: .leading)).combined(
                            with: .opacity))
                }
                .padding(Theme.spacing * 2.5)
                .frame(maxWidth: 520)
                .frame(maxWidth: .infinity)
            }
            .scrollDismissesKeyboard(.interactively)
            .background(Theme.background)
            .toolbar {
                if !model.needsPairing {
                    ToolbarItem(placement: .cancellationAction) {
                        Button("Close", action: finish)
                    }
                }
            }
        }
        .onAppear {
            // Skip what's already done, e.g. a Mac that was paired before.
            if step == .pair, !model.needsPairing { step = .phone }
        }
    }

    private func advance(from current: Step) {
        withAnimation(.snappy) {
            step = Step(rawValue: current.rawValue + 1) ?? .done
        }
    }

    private var progress: some View {
        HStack(spacing: 6) {
            ForEach([Step.pair, .phone, .share], id: \.self) { item in
                Capsule()
                    .fill(item.rawValue <= step.rawValue ? Theme.accent : Theme.hairline)
                    .frame(height: 4)
            }
        }
        .accessibilityLabel("Step \(min(step.rawValue + 1, 3)) of 3")
    }
}

// MARK: Steps

private struct StepHeader: View {
    let image: String
    let title: String
    let subtitle: String

    var body: some View {
        VStack(alignment: .leading, spacing: Theme.spacing) {
            Image(image)
                .resizable()
                .scaledToFit()
                .frame(height: 96)
                .accessibilityHidden(true)
            Text(title)
                .font(.title.weight(.bold))
                .foregroundStyle(Theme.ink)
            Text(subtitle)
                .font(.body)
                .foregroundStyle(Theme.inkSecondary)
                .fixedSize(horizontal: false, vertical: true)
        }
    }
}

private struct PairStep: View {
    let model: AppModel
    let next: () -> Void
    @State private var code = ""
    @State private var working = false
    @State private var error: String?
    @State private var paired: String?
    @FocusState private var focused: Bool

    var body: some View {
        VStack(alignment: .leading, spacing: Theme.spacing * 2.5) {
            StepHeader(
                image: "spectr_pairing",
                title: "Pair your Mac",
                subtitle:
                    "On your Mac, open Spectr from the menu bar. Its Setup window shows a six-character code. Enter it here."
            )
            if let paired {
                Label("\(paired) is paired", systemImage: "checkmark.circle.fill")
                    .font(.headline)
                    .foregroundStyle(.green)
            } else {
                CodeField(code: $code)
                    .focused($focused)
                    .onChange(of: code) { _, value in
                        error = nil
                        if value.count == 6 { submit() }
                    }
                if let error {
                    Label(error, systemImage: "exclamationmark.circle")
                        .font(.callout)
                        .foregroundStyle(Theme.critical)
                }
                Button(action: submit) {
                    if working { ProgressView().tint(.white) } else { Text("Pair") }
                }
                .buttonStyle(SolidButtonStyle())
                .disabled(code.count < 6 || working)
                DisclosureGroup("Don't have Spectr on your Mac yet?") {
                    Text(
                        "Install the Spectr Mac app, open it, and allow Screen Recording and Accessibility when it asks. The pairing code appears in its Setup window."
                    )
                    .font(.callout)
                    .foregroundStyle(Theme.inkSecondary)
                    .padding(.top, 4)
                }
                .font(.callout)
                .tint(Theme.ink)
            }
        }
        .onAppear { focused = true }
    }

    private func submit() {
        guard code.count == 6, !working else { return }
        working = true
        Task {
            defer { working = false }
            do {
                let result = try await model.pair(code: code)
                Haptics.success()
                withAnimation { paired = result.name }
                try? await Task.sleep(for: .seconds(1.2))
                next()
            } catch {
                Haptics.warning()
                self.error = (error as? AppAPIError)?.message ?? "Something went wrong. Try again."
                code = ""
            }
        }
    }
}

/// Six boxes; accepts letters and digits, ignores spaces and dashes.
private struct CodeField: View {
    @Binding var code: String

    var body: some View {
        ZStack {
            TextField("", text: Binding(get: { code }, set: { code = Self.clean($0) }))
                .textInputAutocapitalization(.characters)
                .autocorrectionDisabled()
                .keyboardType(.asciiCapable)
                .textContentType(.oneTimeCode)
                .foregroundStyle(.clear)
                .tint(.clear)
                .accessibilityLabel("Pairing code")
            HStack(spacing: 8) {
                ForEach(0..<6, id: \.self) { index in
                    let character = index < code.count ? String(Array(code)[index]) : ""
                    Text(character)
                        .font(.system(size: 28, weight: .semibold, design: .monospaced))
                        .frame(maxWidth: .infinity, minHeight: 58)
                        .background(Theme.surface, in: .rect(cornerRadius: 12))
                        .overlay {
                            RoundedRectangle(cornerRadius: 12)
                                .stroke(
                                    index == code.count ? Theme.accent : Theme.hairline,
                                    lineWidth: index == code.count ? 2 : 1)
                        }
                    if index == 2 {
                        Text("–").foregroundStyle(Theme.inkSecondary)
                    }
                }
            }
            .allowsHitTesting(false)
        }
    }

    static func clean(_ raw: String) -> String {
        String(raw.uppercased().filter { $0.isLetter || $0.isNumber }.prefix(6))
    }
}

private struct PhoneStep: View {
    let model: AppModel
    let next: () -> Void
    @State private var number = ""
    @State private var working = false
    @State private var error: String?
    @State private var pending: PhoneLinkResult?
    @State private var addingAnother = false
    @Environment(\.openURL) private var openURL

    private var linked: Bool {
        guard let pending else { return false }
        return model.phones.contains(pending.phone)
    }

    var body: some View {
        VStack(alignment: .leading, spacing: Theme.spacing * 2.5) {
            StepHeader(
                image: "spectr_working",
                title: "Add your phone",
                subtitle:
                    "Then you can call or text Spectr from anywhere, without opening the app. We confirm the number by having it call Spectr once."
            )
            if !model.phones.isEmpty, pending == nil, !addingAnother {
                ForEach(model.phones, id: \.self) { phone in
                    Label(PhoneFormat.display(phone), systemImage: "checkmark.circle.fill")
                        .font(.headline)
                        .foregroundStyle(.green)
                }
                Button("Continue", action: next).buttonStyle(SolidButtonStyle())
                Button("Add another number") {
                    number = ""
                    addingAnother = true
                }
                .font(.callout)
            } else if let pending {
                verify(pending)
            } else {
                entry
            }
            if model.phones.isEmpty {
                Button("Skip for now", action: next)
                    .font(.callout)
                    .foregroundStyle(Theme.inkSecondary)
                    .frame(maxWidth: .infinity)
            }
        }
        .onChange(of: linked) { _, isLinked in
            guard isLinked else { return }
            Haptics.success()
            Task {
                try? await Task.sleep(for: .seconds(1.5))
                next()
            }
        }
    }

    private var entry: some View {
        VStack(alignment: .leading, spacing: Theme.spacing * 1.5) {
            TextField("Your phone number", text: $number)
                .keyboardType(.phonePad)
                .textContentType(.telephoneNumber)
                .font(.title3)
                .padding(14)
                .background(Theme.surface, in: .rect(cornerRadius: 12))
                .overlay { RoundedRectangle(cornerRadius: 12).stroke(Theme.hairline) }
            if let error {
                Label(error, systemImage: "exclamationmark.circle")
                    .font(.callout)
                    .foregroundStyle(Theme.critical)
            }
            Button {
                submit()
            } label: {
                if working { ProgressView().tint(.white) } else { Text("Continue") }
            }
            .buttonStyle(SolidButtonStyle())
            .disabled(number.filter(\.isNumber).count < 10 || working)
        }
    }

    private func verify(_ pending: PhoneLinkResult) -> some View {
        VStack(alignment: .leading, spacing: Theme.spacing * 1.5) {
            if linked {
                Label("\(PhoneFormat.display(pending.phone)) is linked", systemImage: "checkmark.circle.fill")
                    .font(.headline)
                    .foregroundStyle(.green)
            } else {
                Text("Call Spectr from \(PhoneFormat.display(pending.phone))")
                    .font(.headline)
                    .foregroundStyle(Theme.ink)
                Text(
                    "Spectr recognises the number, links it, and says so. You can hang up after that or give it a task right away."
                )
                .font(.callout)
                .foregroundStyle(Theme.inkSecondary)
                .fixedSize(horizontal: false, vertical: true)
                Button {
                    if let url = PhoneFormat.telURL(pending.callNumber) { openURL(url) }
                } label: {
                    Label("Call \(PhoneFormat.display(pending.callNumber))", systemImage: "phone.fill")
                }
                .buttonStyle(SolidButtonStyle(tint: Theme.accent))
                HStack(spacing: Theme.spacing) {
                    ProgressView()
                    Text("Waiting for the call…").font(.callout).foregroundStyle(Theme.inkSecondary)
                }
                Button("Use a different number") { self.pending = nil }
                    .font(.callout)
            }
        }
    }

    private func submit() {
        working = true
        error = nil
        Task {
            defer { working = false }
            do {
                let result = try await model.linkPhone(number)
                if result.status == "linked" {
                    Haptics.success()
                    next()
                } else {
                    withAnimation { pending = result }
                }
            } catch {
                self.error = (error as? AppAPIError)?.message ?? "Something went wrong. Try again."
            }
        }
    }
}

private struct ShareStep: View {
    let model: AppModel
    let next: () -> Void

    private var sharing: Bool { model.mac?.isOnline == true && model.mac?.sharing == true }

    var body: some View {
        VStack(alignment: .leading, spacing: Theme.spacing * 2.5) {
            StepHeader(
                image: "spectr_welcome",
                title: "Share a window",
                subtitle:
                    "Spectr only sees and controls the window you choose. On your Mac, click ✦ in the menu bar, then Choose Window, and pick the app Spectr should use, like Notes or Chrome."
            )
            VStack(alignment: .leading, spacing: Theme.spacing) {
                row("Spectr is running on your Mac", done: model.mac?.isOnline == true)
                row("A window is shared", done: sharing)
            }
            .card()
            Button(sharing ? "Continue" : "I'll do this later", action: next)
                .buttonStyle(sharing ? AnyButtonStyle(SolidButtonStyle()) : AnyButtonStyle(OutlineButtonStyle()))
        }
        .onChange(of: sharing) { _, isSharing in
            if isSharing { Haptics.success() }
        }
    }

    private func row(_ text: String, done: Bool) -> some View {
        HStack(spacing: Theme.spacing) {
            if done {
                Image(systemName: "checkmark.circle.fill").foregroundStyle(.green)
            } else {
                ProgressView().controlSize(.small)
            }
            Text(text).foregroundStyle(Theme.ink)
        }
        .font(.body)
        .animation(.snappy, value: done)
    }
}

private struct DoneStep: View {
    let model: AppModel
    let finish: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: Theme.spacing * 2.5) {
            StepHeader(
                image: "spectr_success",
                title: "You're set",
                subtitle: "Tell Spectr what to do here, tap Talk for a hands-free call, or reach it from anywhere:"
            )
            VStack(alignment: .leading, spacing: Theme.spacing) {
                Label("Call \(PhoneFormat.display(model.spectrNumber))", systemImage: "phone.fill")
                Label("Text the same number", systemImage: "message.fill")
                Label("Say “stop” at any time", systemImage: "stop.circle")
            }
            .font(.body)
            .foregroundStyle(Theme.ink)
            .card()
            Button("Start", action: finish).buttonStyle(SolidButtonStyle(tint: Theme.accent))
        }
    }
}

/// Lets one control switch between two button styles.
struct AnyButtonStyle: ButtonStyle {
    private let make: (Configuration) -> AnyView

    init<S: ButtonStyle>(_ style: S) {
        make = { AnyView(style.makeBody(configuration: $0)) }
    }

    func makeBody(configuration: Configuration) -> some View {
        make(configuration)
    }
}
