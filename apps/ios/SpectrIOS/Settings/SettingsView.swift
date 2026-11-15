import SwiftUI

struct SettingsView: View {
    let model: AppModel
    let email: String?
    let addPhone: () -> Void
    let pairAnotherMac: () -> Void
    let signOut: () -> Void
    @Environment(\.dismiss) private var dismiss
    @Environment(\.openURL) private var openURL

    var body: some View {
        NavigationStack {
            List {
                Section("Account") {
                    LabeledContent("Signed in as", value: email ?? "—")
                }

                Section {
                    ForEach(model.home?.macs ?? []) { mac in
                        HStack {
                            StatusDot(color: mac.isOnline ? .green : Theme.inkSecondary)
                            VStack(alignment: .leading, spacing: 2) {
                                Text(mac.name)
                                Text(
                                    mac.isOnline
                                        ? "Online" : mac.lastSeenAt.map { "Seen \($0.relative())" } ?? "Offline"
                                )
                                .font(.brand(.footnote))
                                .foregroundStyle(Theme.inkSecondary)
                            }
                        }
                    }
                    Button("Pair Another Mac", action: pairAnotherMac)
                } header: {
                    Text("Mac")
                } footer: {
                    Text("Spectr works on the Mac that checked in most recently.")
                }

                Section {
                    ForEach(model.phones, id: \.self) { phone in
                        Text(PhoneFormat.display(phone))
                            .swipeActions {
                                Button("Remove", role: .destructive) {
                                    Task { await model.unlinkPhone(phone) }
                                }
                            }
                    }
                    if let pending = model.home?.pendingPhone {
                        LabeledContent(PhoneFormat.display(pending.phone), value: "Call to confirm")
                    }
                    Button("Add Phone Number", action: addPhone)
                } header: {
                    Text("Your numbers")
                } footer: {
                    Text("Calls and texts to Spectr from these numbers control your Mac. Swipe to remove one.")
                }

                Section("Reach Spectr") {
                    Button {
                        if let url = PhoneFormat.telURL(model.spectrNumber) { openURL(url) }
                    } label: {
                        Label("Call \(PhoneFormat.display(model.spectrNumber))", systemImage: "phone.fill")
                    }
                    Button {
                        if let url = PhoneFormat.smsURL(model.spectrNumber) { openURL(url) }
                    } label: {
                        Label("Text Spectr", systemImage: "message.fill")
                    }
                }

                Section {
                    Button("Sign Out", role: .destructive, action: signOut)
                }
            }
            .navigationTitle("settings")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .confirmationAction) {
                    Button("done") { dismiss() }
                }
            }
        }
    }
}
