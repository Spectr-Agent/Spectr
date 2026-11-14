import SwiftUI

/// First run: what Spectr is, and the shortest path to signing in.
struct SignInView: View {
    let auth: AuthModel
    @State private var email = ""
    @FocusState private var focused: Bool

    var body: some View {
        AuthScaffold(
            title: "Spectr",
            subtitle: "Tell your Mac what to do, then watch it work from here."
        ) {
            TextField("Email address", text: $email)
                .keyboardType(.emailAddress)
                .textContentType(.emailAddress)
                .textInputAutocapitalization(.never)
                .autocorrectionDisabled()
                .submitLabel(.continue)
                .focused($focused)
                .onSubmit(submit)
                .authField()

            if let message = auth.errorMessage {
                ErrorText(message)
            }

            PrimaryButton(
                title: "Email me a code", isWorking: auth.isWorking, isEnabled: !email.isEmpty, action: submit)

            Text("We'll email you a 6-digit code. No password needed.")
                .font(.footnote)
                .foregroundStyle(Theme.inkSecondary)

            Button("I already have a code") { auth.enterCode(for: email) }
                .font(.footnote)
                .disabled(email.isEmpty || auth.isWorking)
        }
    }

    private func submit() {
        focused = false
        Task { await auth.requestCode(email: email) }
    }
}

/// Second step: enter the emailed code. Reached again after relaunch if sign-in was interrupted.
struct CodeEntryView: View {
    let auth: AuthModel
    let email: String
    @State private var code = ""
    @FocusState private var focused: Bool

    var body: some View {
        AuthScaffold(
            title: "Check your email",
            subtitle: "Enter the 6-digit code we sent to \(email), or tap the link in that email on this iPhone."
        ) {
            TextField("6-digit code", text: $code)
                .keyboardType(.numberPad)
                .textContentType(.oneTimeCode)
                .font(.body.monospacedDigit())
                .focused($focused)
                .onChange(of: code) { _, value in
                    let digits = String(value.filter(\.isNumber).prefix(10))
                    if digits != value { code = digits }
                }
                .authField()
                .accessibilityLabel("Sign-in code")

            if let message = auth.errorMessage {
                ErrorText(message)
            }

            PrimaryButton(title: "Sign in", isWorking: auth.isWorking, isEnabled: code.count >= 6) {
                focused = false
                Task { await auth.verify(code: code) }
            }

            HStack {
                Button("Send a new email") {
                    code = ""
                    Task { await auth.requestCode(email: email) }
                }
                Spacer()
                Button("Use a different email") { auth.changeEmail() }
            }
            .font(.footnote)
            .disabled(auth.isWorking)
        }
    }
}

/// Signed in. Until pairing exists on the backend, this states that honestly.
// MARK: Shared pieces

private struct AuthScaffold<Content: View>: View {
    let title: String
    let subtitle: String
    @ViewBuilder var content: Content

    var body: some View {
        ScrollView {
            VStack(spacing: Theme.spacing * 2) {
                Image("spectr_welcome")
                    .resizable()
                    .scaledToFit()
                    .frame(maxWidth: 120)
                    .accessibilityHidden(true)
                VStack(spacing: Theme.spacing * 0.75) {
                    Text(title)
                        .font(.largeTitle.weight(.semibold))
                        .foregroundStyle(Theme.ink)
                    Text(subtitle)
                        .font(.body)
                        .foregroundStyle(Theme.inkSecondary)
                        .multilineTextAlignment(.center)
                        .fixedSize(horizontal: false, vertical: true)
                }
                .padding(.bottom, Theme.spacing)
                content
            }
            .padding(.horizontal, Theme.spacing * 2.5)
            .padding(.top, Theme.spacing * 5)
            .frame(maxWidth: 480)
            .frame(maxWidth: .infinity)
        }
        .scrollDismissesKeyboard(.interactively)
    }
}

private struct PrimaryButton: View {
    let title: String
    let isWorking: Bool
    let isEnabled: Bool
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            Group {
                if isWorking {
                    ProgressView().tint(.white)
                } else {
                    Text(title).font(.body.weight(.semibold))
                }
            }
            .frame(maxWidth: .infinity, minHeight: 50)
            .foregroundStyle(.white)
            .background(
                isEnabled && !isWorking ? Theme.ink : Theme.inkSecondary.opacity(0.5), in: .rect(cornerRadius: 14))
        }
        .buttonStyle(.plain)
        .disabled(!isEnabled || isWorking)
    }
}

private struct ErrorText: View {
    let message: String

    init(_ message: String) {
        self.message = message
    }

    var body: some View {
        Label(message, systemImage: "exclamationmark.circle")
            .font(.footnote)
            .foregroundStyle(Theme.critical)
            .frame(maxWidth: .infinity, alignment: .leading)
    }
}

extension View {
    fileprivate func authField() -> some View {
        self
            .padding(.horizontal, 14)
            .frame(minHeight: 50)
            .background(Theme.surface, in: .rect(cornerRadius: 14))
            .overlay { RoundedRectangle(cornerRadius: 14).stroke(Theme.hairline) }
    }
}
