import LiveKit
import SpectrKit
import SwiftUI

/// The signed-in home: your Mac, what it's doing, and every way to reach it.
struct HomeView: View {
    let model: AppModel
    let live: LiveSession
    let email: String?
    let openLive: (_ startCall: Bool) -> Void
    let openSettings: () -> Void
    let openSetup: () -> Void

    @State private var draft = ""
    @State private var detail: AppTask?
    @Environment(\.openURL) private var openURL

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: Theme.spacing * 2) {
                header
                if let mac = model.mac {
                    MacCard(mac: mac, live: live) { openLive(false) }
                    actions(mac)
                }
                if let task = model.activeTask {
                    ActiveTaskCard(task: task, model: model, openLive: { openLive(false) })
                        .transition(.asymmetric(insertion: .push(from: .bottom), removal: .opacity))
                } else if let result = model.latestResult {
                    ResultCard(task: result, dismiss: { withAnimation { model.dismissResult() } }) { detail = result }
                        .transition(.opacity)
                }
                if model.phones.isEmpty, model.home?.pendingPhone == nil {
                    linkPhonePrompt
                }
                if !model.recentTasks.isEmpty {
                    history
                }
            }
            .padding(.horizontal, Theme.spacing * 2)
            .padding(.top, Theme.spacing)
            .padding(.bottom, Theme.spacing * 3)
            .animation(.snappy, value: model.activeTask?.taskId)
            .animation(.snappy, value: model.activeTask?.state)
        }
        .scrollDismissesKeyboard(.interactively)
        .refreshable { await model.refresh() }
        .safeAreaInset(edge: .bottom) {
            Composer(
                text: $draft,
                placeholder: composerPlaceholder,
                isSending: model.isSending
            ) {
                let text = draft
                Task {
                    if await model.send(text) {
                        draft = ""
                        Haptics.tap()
                    }
                }
            }
            .padding(.horizontal, Theme.spacing * 2)
            .padding(.vertical, Theme.spacing)
            .background(.bar)
        }
        .sheet(item: $detail) { task in
            TaskDetailView(task: task)
                .presentationDetents([.medium, .large])
        }
    }

    private var composerPlaceholder: String {
        guard let task = model.activeTask else { return "Tell your Mac what to do…" }
        return task.state == .waitingForUser ? "Answer Spectr…" : "Change the task…"
    }

    // MARK: Sections

    private var header: some View {
        HStack(alignment: .center) {
            VStack(alignment: .leading, spacing: 2) {
                Text("Spectr")
                    .font(.largeTitle.weight(.bold))
                    .foregroundStyle(Theme.ink)
                Text(greeting)
                    .font(.subheadline)
                    .foregroundStyle(Theme.inkSecondary)
            }
            Spacer()
            Button(action: openSettings) {
                Image(systemName: "gearshape")
                    .font(.title3)
                    .foregroundStyle(Theme.ink)
                    .frame(width: 44, height: 44)
            }
            .accessibilityLabel("Settings")
        }
    }

    private var greeting: String {
        guard let mac = model.mac else { return email ?? "" }
        if model.activeTask != nil { return "Working on \(mac.name)" }
        return mac.isOnline ? "\(mac.name) is ready" : "\(mac.name) is offline"
    }

    private func actions(_ mac: AppMac) -> some View {
        HStack(spacing: Theme.spacing) {
            ActionTile(title: "Watch", systemImage: "play.rectangle.fill", isEnabled: mac.isOnline) {
                openLive(false)
            }
            ActionTile(title: "Talk", systemImage: "waveform", prominent: true, isEnabled: mac.isOnline) {
                Haptics.tap()
                openLive(true)
            }
            ActionTile(title: "Call", systemImage: "phone.fill") {
                if let url = PhoneFormat.telURL(model.spectrNumber) { openURL(url) }
            }
            ActionTile(title: "Text", systemImage: "message.fill") {
                if let url = PhoneFormat.smsURL(model.spectrNumber) { openURL(url) }
            }
        }
    }

    private var linkPhonePrompt: some View {
        Button(action: openSetup) {
            HStack(spacing: Theme.spacing * 1.5) {
                Image(systemName: "phone.badge.plus")
                    .font(.title2)
                    .foregroundStyle(Theme.accent)
                VStack(alignment: .leading, spacing: 2) {
                    Text("Add your phone number")
                        .font(.headline)
                        .foregroundStyle(Theme.ink)
                    Text("Then call or text Spectr from anywhere, even without the app.")
                        .font(.subheadline)
                        .foregroundStyle(Theme.inkSecondary)
                        .multilineTextAlignment(.leading)
                }
                Spacer(minLength: 0)
                Image(systemName: "chevron.right").foregroundStyle(Theme.inkSecondary)
            }
            .card()
        }
        .buttonStyle(.plain)
    }

    private var history: some View {
        VStack(alignment: .leading, spacing: Theme.spacing) {
            Text("Recent")
                .font(.headline)
                .foregroundStyle(Theme.ink)
                .padding(.top, Theme.spacing)
            VStack(spacing: 0) {
                ForEach(model.recentTasks.prefix(8)) { task in
                    Button {
                        detail = task
                    } label: {
                        TaskRow(task: task)
                    }
                    .buttonStyle(.plain)
                    if task.id != model.recentTasks.prefix(8).last?.id {
                        Divider().padding(.leading, 44)
                    }
                }
            }
            .background(Theme.surface, in: .rect(cornerRadius: Theme.cornerRadius))
            .overlay { RoundedRectangle(cornerRadius: Theme.cornerRadius).stroke(Theme.hairline) }
        }
    }
}

// MARK: Mac card

/// Your Mac at a glance, with a live picture of its shared screen when there is one.
struct MacCard: View {
    let mac: AppMac
    let live: LiveSession
    let open: () -> Void

    var body: some View {
        Button(action: open) {
            VStack(alignment: .leading, spacing: 0) {
                preview
                    .frame(height: 190)
                    .frame(maxWidth: .infinity)
                    .background(Color.black)
                    .clipped()
                HStack(spacing: Theme.spacing) {
                    StatusDot(color: statusColor, pulsing: mac.isOnline && mac.sharing == true)
                    VStack(alignment: .leading, spacing: 1) {
                        Text(mac.name)
                            .font(.headline)
                            .foregroundStyle(Theme.ink)
                        Text(statusText)
                            .font(.footnote)
                            .foregroundStyle(Theme.inkSecondary)
                    }
                    Spacer()
                    if mac.isOnline, mac.sharing == true {
                        Label("Live", systemImage: "dot.radiowaves.left.and.right")
                            .font(.caption.weight(.bold))
                            .foregroundStyle(Theme.accent)
                    }
                }
                .padding(Theme.spacing * 1.5)
            }
            .background(Theme.surface, in: .rect(cornerRadius: Theme.cornerRadius))
            .clipShape(.rect(cornerRadius: Theme.cornerRadius))
            .overlay { RoundedRectangle(cornerRadius: Theme.cornerRadius).stroke(Theme.hairline) }
        }
        .buttonStyle(.plain)
        .disabled(!mac.isOnline)
        .accessibilityLabel("\(mac.name), \(statusText). Opens the live screen.")
    }

    @ViewBuilder private var preview: some View {
        if mac.isOnline, let track = live.screen {
            SwiftUIVideoView(track, layoutMode: .fit)
                .allowsHitTesting(false)
        } else {
            VStack(spacing: Theme.spacing) {
                Image(systemName: mac.isOnline ? "rectangle.dashed" : "laptopcomputer.slash")
                    .font(.system(size: 34, weight: .light))
                Text(placeholderText)
                    .font(.footnote)
                    .multilineTextAlignment(.center)
                    .padding(.horizontal)
            }
            .foregroundStyle(.white.opacity(0.7))
        }
    }

    private var placeholderText: String {
        if !mac.isOnline { return "Your Mac is asleep or Spectr isn't running on it." }
        if mac.sharing == false {
            return "Nothing shared yet. On your Mac, click ✦ in the menu bar and choose a window."
        }
        return "Connecting to your Mac's screen…"
    }

    private var statusColor: Color {
        mac.isOnline ? (mac.sharing == false ? .orange : .green) : Theme.inkSecondary
    }

    private var statusText: String {
        guard mac.isOnline else {
            return mac.lastSeenAt.map { "Offline · seen \($0.relative())" } ?? "Offline"
        }
        switch mac.sharing {
        case .some(true): return "Online · sharing its screen"
        case .some(false): return "Online · not sharing a window"
        case .none: return "Online"
        }
    }
}

// MARK: Task cards

/// The running task: what it's doing now, with Stop and any approval Spectr needs.
struct ActiveTaskCard: View {
    let task: AppTask
    let model: AppModel
    var dark = false
    var openLive: (() -> Void)?

    var body: some View {
        VStack(alignment: .leading, spacing: Theme.spacing * 1.5) {
            HStack {
                StateChip(state: task.state)
                Spacer()
                if let openLive {
                    Button("Watch", systemImage: "play.rectangle", action: openLive)
                        .font(.footnote.weight(.semibold))
                        .labelStyle(.titleAndIcon)
                }
            }
            Text(task.instruction)
                .font(.title3.weight(.semibold))
                .foregroundStyle(dark ? .white : Theme.ink)
                .fixedSize(horizontal: false, vertical: true)

            if task.state == .waitingForUser, let question = task.question {
                QuestionPrompt(question: question, needsApproval: task.needsApproval, dark: dark, model: model)
            } else if let activity = task.activity {
                HStack(spacing: Theme.spacing) {
                    WorkingDots()
                    Text(activity)
                        .font(.subheadline)
                        .foregroundStyle(dark ? .white.opacity(0.75) : Theme.inkSecondary)
                        .contentTransition(.opacity)
                        .animation(.easeInOut, value: activity)
                }
            }

            Button(role: .destructive) {
                Haptics.warning()
                Task { await model.stopTask() }
            } label: {
                Label(model.isStopping ? "Stopping…" : "Stop", systemImage: "stop.fill")
            }
            .buttonStyle(SolidButtonStyle(tint: Theme.critical))
            .disabled(model.isStopping)
        }
        .padding(Theme.spacing * 2)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(dark ? Color.white.opacity(0.08) : Theme.surface, in: .rect(cornerRadius: Theme.cornerRadius))
        .overlay {
            RoundedRectangle(cornerRadius: Theme.cornerRadius)
                .stroke(
                    task.state == .waitingForUser
                        ? Color.orange.opacity(0.6) : (dark ? .white.opacity(0.12) : Theme.hairline))
        }
    }
}

/// Spectr's question, with one-tap Yes / No for approvals.
struct QuestionPrompt: View {
    let question: String
    let needsApproval: Bool
    var dark = false
    let model: AppModel

    var body: some View {
        VStack(alignment: .leading, spacing: Theme.spacing * 1.25) {
            Label(question, systemImage: "bubble.left.fill")
                .font(.body)
                .foregroundStyle(dark ? .white : Theme.ink)
                .fixedSize(horizontal: false, vertical: true)
            if needsApproval {
                HStack(spacing: Theme.spacing) {
                    Button {
                        Haptics.success()
                        Task { await model.answer(true) }
                    } label: {
                        Label("Yes, go ahead", systemImage: "checkmark")
                    }
                    .buttonStyle(SolidButtonStyle(tint: Theme.accent))
                    Button {
                        Task { await model.answer(false) }
                    } label: {
                        Label("No", systemImage: "xmark")
                    }
                    .buttonStyle(OutlineButtonStyle())
                    .frame(maxWidth: 110)
                }
                .disabled(model.isSending)
            } else {
                Text("Answer below.")
                    .font(.footnote)
                    .foregroundStyle(dark ? .white.opacity(0.6) : Theme.inkSecondary)
            }
        }
    }
}

/// The last finished task and what Spectr verified.
struct ResultCard: View {
    let task: AppTask
    let dismiss: () -> Void
    let open: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: Theme.spacing * 1.25) {
            HStack {
                StateChip(state: task.state)
                Spacer()
                Button(action: dismiss) {
                    Image(systemName: "xmark").font(.footnote.weight(.bold)).foregroundStyle(Theme.inkSecondary)
                        .frame(width: 32, height: 32)
                }
                .accessibilityLabel("Dismiss result")
            }
            Text(task.instruction)
                .font(.headline)
                .foregroundStyle(Theme.ink)
            if let summary = task.summary {
                Text(summary)
                    .font(.body)
                    .foregroundStyle(Theme.ink.opacity(0.85))
                    .fixedSize(horizontal: false, vertical: true)
            }
            if let url = task.screenshotURL {
                Button(action: open) {
                    AsyncImage(url: url) { image in
                        image.resizable().scaledToFit()
                    } placeholder: {
                        Rectangle().fill(Theme.hairline).frame(height: 140)
                    }
                    .clipShape(.rect(cornerRadius: 10))
                }
                .buttonStyle(.plain)
                .accessibilityLabel("Final screenshot")
            }
        }
        .card()
        .onAppear { if task.state == .succeeded { Haptics.success() } }
    }
}

struct TaskRow: View {
    let task: AppTask

    var body: some View {
        HStack(alignment: .top, spacing: Theme.spacing * 1.5) {
            Image(systemName: task.state.symbol)
                .foregroundStyle(task.state.tint)
                .frame(width: 22)
                .padding(.top, 2)
            VStack(alignment: .leading, spacing: 3) {
                Text(task.instruction)
                    .font(.subheadline.weight(.semibold))
                    .foregroundStyle(Theme.ink)
                    .lineLimit(2)
                if let summary = task.summary {
                    Text(summary)
                        .font(.footnote)
                        .foregroundStyle(Theme.inkSecondary)
                        .lineLimit(2)
                }
            }
            Spacer(minLength: 0)
            Text(task.updatedAt.relative())
                .font(.caption)
                .foregroundStyle(Theme.inkSecondary)
        }
        .padding(Theme.spacing * 1.5)
        .contentShape(.rect)
    }
}

struct TaskDetailView: View {
    let task: AppTask

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: Theme.spacing * 1.5) {
                StateChip(state: task.state)
                Text(task.instruction)
                    .font(.title2.weight(.semibold))
                    .foregroundStyle(Theme.ink)
                if let summary = task.summary {
                    Text(summary).font(.body).foregroundStyle(Theme.ink)
                }
                if let url = task.screenshotURL {
                    AsyncImage(url: url) { image in
                        image.resizable().scaledToFit()
                    } placeholder: {
                        ProgressView().frame(maxWidth: .infinity, minHeight: 200)
                    }
                    .clipShape(.rect(cornerRadius: 12))
                }
                Text(meta)
                    .font(.footnote)
                    .foregroundStyle(Theme.inkSecondary)
            }
            .padding(Theme.spacing * 2.5)
        }
    }

    private var meta: String {
        let via =
            switch task.source {
            case "call": "a phone call"
            case "sendblue", "chert": "a text"
            case "app": "this app"
            default: "Spectr"
            }
        return
            "Started \(task.createdAt.formatted(date: .abbreviated, time: .shortened)) from \(via) · \(task.stepCount) steps"
    }
}
