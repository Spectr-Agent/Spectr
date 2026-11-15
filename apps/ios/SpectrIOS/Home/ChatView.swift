import SpectrKit
import SwiftUI

/// A chat reopened from the list: the whole conversation, and a composer that continues it.
struct ChatView: View {
    let sessionId: String
    let model: AppModel
    let openLive: () -> Void

    @State private var session: AppSession?
    @State private var failure: String?
    @State private var draft = ""
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            ScrollViewReader { proxy in
                ScrollView {
                    LazyVStack(alignment: .leading, spacing: Theme.spacing * 1.5) {
                        if let session {
                            ForEach(visibleMessages(session)) { message in
                                ChatBubble(message: message).id(message.id)
                            }
                        } else if let failure {
                            Text(failure)
                                .font(.brand(.subheadline))
                                .foregroundStyle(Theme.inkSecondary)
                                .frame(maxWidth: .infinity)
                                .padding(.top, Theme.spacing * 6)
                        } else {
                            ProgressView().frame(maxWidth: .infinity).padding(.top, Theme.spacing * 6)
                        }
                        if let task = activeHere {
                            ActiveTaskCard(task: task, model: model, openLive: openLive)
                                .id("active")
                        }
                    }
                    .padding(.horizontal, Theme.spacing * 2)
                    .padding(.vertical, Theme.spacing * 2)
                }
                .scrollDismissesKeyboard(.interactively)
                .onChange(of: session?.messages.last?.id) { _, last in
                    guard let last else { return }
                    withAnimation { proxy.scrollTo(activeHere == nil ? last : "active", anchor: .bottom) }
                }
            }
            .background(Theme.background.ignoresSafeArea())
            .safeAreaInset(edge: .bottom) { composer }
            .navigationTitle(title)
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button("Done") { dismiss() }
                        .font(.brand(.body, .medium))
                }
            }
        }
        .task { await poll() }
    }

    private var title: String {
        session?.tasks.first?.instruction ?? model.chats.first { $0.id == sessionId }?.title ?? "Chat"
    }

    /// The running task, when it belongs to this chat.
    private var activeHere: AppTask? {
        guard let task = model.activeTask, task.chatId == sessionId else { return nil }
        return task
    }

    /// Another chat is running; a message here would change that task instead.
    private var busyElsewhere: Bool {
        guard let task = model.activeTask else { return false }
        return task.chatId != sessionId
    }

    /// The running task's question is shown on its card, not twice.
    private func visibleMessages(_ session: AppSession) -> [AppChatMessage] {
        session.messages.filter { !($0.role == .spectr && $0.taskId == activeHere?.taskId) }
    }

    private var placeholder: String {
        guard let task = activeHere else { return "Continue this chat…" }
        return task.state == .waitingForUser ? "Answer Spectr…" : "Change the task…"
    }

    @ViewBuilder private var composer: some View {
        VStack(spacing: Theme.spacing) {
            if busyElsewhere {
                Text("Spectr is busy in another chat. Stop it or wait to continue here.")
                    .font(.brand(.footnote))
                    .foregroundStyle(Theme.inkSecondary)
                    .frame(maxWidth: .infinity, alignment: .leading)
            }
            Composer(text: $draft, placeholder: placeholder, isSending: model.isSending) {
                let text = draft
                Task {
                    if await model.send(text, sessionId: sessionId) {
                        draft = ""
                        Haptics.tap()
                        await load()
                    }
                }
            }
            .disabled(busyElsewhere)
            .opacity(busyElsewhere ? 0.5 : 1)
        }
        .padding(.horizontal, Theme.spacing * 2)
        .padding(.vertical, Theme.spacing)
        .background(.bar)
    }

    private func poll() async {
        while !Task.isCancelled {
            await load()
            try? await Task.sleep(for: activeHere == nil ? .seconds(4) : .seconds(1.5))
        }
    }

    private func load() async {
        do {
            let fresh = try await model.api.session(id: sessionId)
            if fresh != session { session = fresh }
            failure = nil
        } catch {
            if session == nil { failure = error.message }
        }
    }
}

/// Your messages on the right in ink; Spectr's replies on the left as plain text.
struct ChatBubble: View {
    let message: AppChatMessage

    var body: some View {
        switch message.role {
        case .user:
            HStack {
                Spacer(minLength: Theme.spacing * 6)
                Text(message.text)
                    .font(.brand(.body))
                    .foregroundStyle(Theme.background)
                    .padding(.horizontal, 14)
                    .padding(.vertical, 10)
                    .background(Theme.ink, in: .rect(cornerRadius: 20))
                    .textSelection(.enabled)
            }
        case .spectr:
            VStack(alignment: .leading, spacing: Theme.spacing) {
                HStack(spacing: 6) {
                    Image(systemName: "sparkle").font(.brand(.caption, .bold))
                    Text(message.state?.label ?? "Spectr").font(.brand(.caption, .medium))
                }
                .foregroundStyle(message.state?.tint ?? Theme.inkSecondary)
                Text(message.text)
                    .font(.brand(.body))
                    .foregroundStyle(Theme.ink)
                    .fixedSize(horizontal: false, vertical: true)
                    .textSelection(.enabled)
                if let url = message.screenshotURL {
                    AsyncImage(url: url) { image in
                        image.resizable().scaledToFit()
                    } placeholder: {
                        Rectangle().fill(Theme.hairline).frame(height: 160)
                    }
                    .clipShape(.rect(cornerRadius: 12))
                    .accessibilityLabel("Final screenshot")
                }
            }
            .padding(.trailing, Theme.spacing * 4)
        }
    }
}
