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
                title: "Email me a sign-in link", isWorking: auth.isWorking, isEnabled: !email.isEmpty, action: submit)

            Text("We'll email you a link that signs you in. No password needed.")
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
            subtitle: "We sent a sign-in email to \(email). Open it on this iPhone and tap the link."
        ) {
            TextField("Code from the email, if it has one", text: $code)
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

            PrimaryButton(title: "Sign in with code", isWorking: auth.isWorking, isEnabled: code.count >= 6) {
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
struct HomeView: View {
    let auth: AuthModel
    let email: String?

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: Theme.spacing * 2.5) {
                VStack(alignment: .leading, spacing: 4) {
                    Text("Your Mac")
                        .font(.largeTitle.weight(.semibold))
                        .foregroundStyle(Theme.ink)
                    Text(email.map { "Signed in as \($0)" } ?? "Signed in")
                        .font(.subheadline)
                        .foregroundStyle(Theme.inkSecondary)
                }

                VStack(alignment: .leading, spacing: Theme.spacing * 1.5) {
                    Label("No Mac paired", systemImage: "laptopcomputer.slash")
                        .font(.headline)
                        .foregroundStyle(Theme.ink)
                    Text(
                        "Spectr needs a Mac that is awake, unlocked and running the Spectr menu-bar app. "
                            + "Pairing isn't available yet in this build."
                    )
                    .font(.callout)
                    .foregroundStyle(Theme.inkSecondary)
                    .fixedSize(horizontal: false, vertical: true)
                }
                .padding(Theme.spacing * 2)
                .frame(maxWidth: .infinity, alignment: .leading)
                .background(Theme.surface, in: .rect(cornerRadius: Theme.cornerRadius))
                .overlay { RoundedRectangle(cornerRadius: Theme.cornerRadius).stroke(Theme.hairline) }

                Button("Sign out", role: .destructive) {
                    Task { await auth.signOut() }
                }
                .frame(minHeight: 44)
            }
            .padding(Theme.spacing * 2.5)
            .frame(maxWidth: 520, alignment: .leading)
            .frame(maxWidth: .infinity)
        }
    }
}

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
