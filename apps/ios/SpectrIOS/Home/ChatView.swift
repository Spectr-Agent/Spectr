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
                    LazyVStack(alignment: .leading, spacing: 0) {
                        if let session {
                            ForEach(ChatEntry.make(visibleMessages(session))) { entry in
                                ChatBubble(entry: entry).id(entry.id)
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
                                .padding(.top, Theme.spacing * 2)
                                .id("active")
                        }
                    }
                    .padding(.horizontal, Theme.spacing * 1.5)
                    .padding(.vertical, Theme.spacing)
                }
                .scrollDismissesKeyboard(.interactively)
                .onChange(of: session?.messages.last?.id) { _, last in
                    guard let last else { return }
                    withAnimation { proxy.scrollTo(activeHere == nil ? last : "active", anchor: .bottom) }
                }
            }
            .background(Theme.background.ignoresSafeArea())
            .safeAreaInset(edge: .bottom) { composer }
            .navigationTitle(title.lowercased())
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button("done") { dismiss() }
                        .font(.brand(.body, .medium))
                }
            }
        }
        .task { await poll() }
    }

    /// What happened, from the latest task; falls back to what was asked.
    private var title: String {
        if let latest = session?.tasks.last { return latest.summary ?? latest.instruction }
        return model.chats.first { $0.id == sessionId }?.title ?? "chat"
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
        guard let task = activeHere else { return "continue this chat…" }
        return task.state == .waitingForUser ? "answer spectr…" : "change the task…"
    }

    @ViewBuilder private var composer: some View {
        VStack(spacing: Theme.spacing) {
            if busyElsewhere {
                Text("spectr is busy in another chat. stop it or wait to continue here.")
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

/// A message with whether it opens a new stretch of the conversation (time shown above it).
struct ChatEntry: Identifiable, Equatable {
    let message: AppChatMessage
    let showsTime: Bool
    let continuesRun: Bool
    var id: String { message.id }

    /// Groups messages like Messages does: a time stamp after a gap, tight spacing within a run.
    static func make(_ messages: [AppChatMessage]) -> [ChatEntry] {
        var entries: [ChatEntry] = []
        for (index, message) in messages.enumerated() {
            let previous = index > 0 ? messages[index - 1] : nil
            let gap = previous.map { message.at.timeIntervalSince($0.at) } ?? .infinity
            entries.append(
                ChatEntry(
                    message: message, showsTime: gap > 15 * 60,
                    continuesRun: previous?.role == message.role && gap <= 15 * 60))
        }
        return entries
    }
}

/// Messages-style bubbles: yours on the right in ink, Spectr's on the left in gray.
struct ChatBubble: View {
    let entry: ChatEntry

    private var message: AppChatMessage { entry.message }
    private var mine: Bool { message.role == .user }

    var body: some View {
        VStack(spacing: 0) {
            if entry.showsTime {
                Text(message.at.chatStamp())
                    .font(.brand(.caption2, .medium))
                    .foregroundStyle(Theme.inkSecondary)
                    .frame(maxWidth: .infinity)
                    .padding(.top, Theme.spacing * 2)
                    .padding(.bottom, Theme.spacing)
            }
            HStack(alignment: .bottom, spacing: 0) {
                if mine { Spacer(minLength: 64) }
                VStack(alignment: mine ? .trailing : .leading, spacing: 4) {
                    VStack(alignment: .leading, spacing: 8) {
                        Text(message.text)
                            .font(.brand(.body))
                            .fixedSize(horizontal: false, vertical: true)
                            .textSelection(.enabled)
                        if let url = message.screenshotURL {
                            AsyncImage(url: url) { image in
                                image.resizable().scaledToFit()
                            } placeholder: {
                                Rectangle().fill(Theme.hairline).frame(height: 160)
                            }
                            .clipShape(.rect(cornerRadius: 12))
                            .accessibilityLabel("final screenshot")
                        }
                    }
                    .padding(.horizontal, 14)
                    .padding(.vertical, 9)
                    .foregroundStyle(mine ? Theme.background : Theme.ink)
                    .background(mine ? Theme.ink : Theme.surface, in: .rect(cornerRadius: 18))
                    if let state = message.state, !mine {
                        Text(state.label)
                            .font(.brand(.caption2, .medium))
                            .foregroundStyle(state.tint)
                            .padding(.leading, 4)
                    }
                }
                if !mine { Spacer(minLength: 64) }
            }
            .padding(.top, entry.continuesRun ? 2 : Theme.spacing)
        }
    }
}

extension Date {
    /// "today 4:12 pm", "yesterday 9:03 am", or "nov 12 at 9:03 am".
    func chatStamp() -> String {
        let time = formatted(date: .omitted, time: .shortened)
        if Calendar.current.isDateInToday(self) { return "today \(time)" }
        if Calendar.current.isDateInYesterday(self) { return "yesterday \(time)" }
        return "\(formatted(.dateTime.month(.abbreviated).day())) at \(time)"
    }
}
