import SpectrKit
import SwiftUI

// Small building blocks shared by every screen. White and near-black with a restrained
// blue accent, generous touch targets, and nothing that only color explains.

extension View {
    /// A rounded surface with a hairline border.
    func card(padding: CGFloat = Theme.spacing * 2) -> some View {
        self
            .padding(padding)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(Theme.surface, in: .rect(cornerRadius: Theme.cornerRadius))
            .overlay { RoundedRectangle(cornerRadius: Theme.cornerRadius).stroke(Theme.hairline) }
    }
}

/// Filled, full-width action.
struct SolidButtonStyle: ButtonStyle {
    var tint: Color = Theme.ink
    var foreground: Color = .white

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(.body.weight(.semibold))
            .frame(maxWidth: .infinity, minHeight: 50)
            .foregroundStyle(foreground)
            .background(tint.opacity(configuration.isPressed ? 0.8 : 1), in: .rect(cornerRadius: 14))
            .scaleEffect(configuration.isPressed ? 0.98 : 1)
            .animation(.snappy(duration: 0.15), value: configuration.isPressed)
    }
}

/// Bordered secondary action.
struct OutlineButtonStyle: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(.body.weight(.semibold))
            .frame(maxWidth: .infinity, minHeight: 50)
            .foregroundStyle(Theme.ink)
            .background(Theme.surface.opacity(configuration.isPressed ? 0.6 : 1), in: .rect(cornerRadius: 14))
            .overlay { RoundedRectangle(cornerRadius: 14).stroke(Theme.hairline) }
    }
}

/// A square tile with an icon and a short label, used for the main actions.
struct ActionTile: View {
    let title: String
    let systemImage: String
    var prominent = false
    var isEnabled = true
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            VStack(spacing: 6) {
                Image(systemName: systemImage)
                    .font(.title3.weight(.semibold))
                    .frame(height: 24)
                Text(title)
                    .font(.footnote.weight(.semibold))
                    .lineLimit(1)
                    .minimumScaleFactor(0.8)
            }
            .frame(maxWidth: .infinity, minHeight: 72)
            .foregroundStyle(prominent ? .white : Theme.ink)
            .background(prominent ? Theme.accent : Theme.surface, in: .rect(cornerRadius: 14))
            .overlay {
                if !prominent { RoundedRectangle(cornerRadius: 14).stroke(Theme.hairline) }
            }
            .opacity(isEnabled ? 1 : 0.45)
        }
        .buttonStyle(.plain)
        .disabled(!isEnabled)
        .accessibilityLabel(title)
    }
}

struct StatusDot: View {
    let color: Color
    var pulsing = false
    @State private var pulse = false

    var body: some View {
        Circle()
            .fill(color)
            .frame(width: 9, height: 9)
            .overlay {
                if pulsing {
                    Circle()
                        .stroke(color.opacity(0.5), lineWidth: 2)
                        .scaleEffect(pulse ? 2.2 : 1)
                        .opacity(pulse ? 0 : 1)
                }
            }
            .onAppear {
                guard pulsing else { return }
                withAnimation(.easeOut(duration: 1.4).repeatForever(autoreverses: false)) { pulse = true }
            }
            .accessibilityHidden(true)
    }
}

extension TaskState {
    var label: String {
        switch self {
        case .accepted: "Starting"
        case .running: "Working"
        case .waitingForUser: "Needs you"
        case .succeeded: "Done"
        case .failed: "Couldn't finish"
        case .cancelled: "Stopped"
        }
    }

    var symbol: String {
        switch self {
        case .accepted, .running: "circle.dotted"
        case .waitingForUser: "questionmark.bubble.fill"
        case .succeeded: "checkmark.circle.fill"
        case .failed: "exclamationmark.triangle.fill"
        case .cancelled: "stop.circle.fill"
        }
    }

    var tint: Color {
        switch self {
        case .accepted, .running: Theme.accent
        case .waitingForUser: .orange
        case .succeeded: .green
        case .failed: Theme.critical
        case .cancelled: Theme.inkSecondary
        }
    }
}

struct StateChip: View {
    let state: TaskState

    var body: some View {
        Label(state.label, systemImage: state.symbol)
            .font(.caption.weight(.semibold))
            .foregroundStyle(state.tint)
            .padding(.horizontal, 8)
            .padding(.vertical, 4)
            .background(state.tint.opacity(0.12), in: .capsule)
            .symbolEffect(.pulse, isActive: state == .running || state == .accepted)
    }
}

/// Three dots that breathe while Spectr works.
struct WorkingDots: View {
    @State private var phase = 0.0

    var body: some View {
        HStack(spacing: 3) {
            ForEach(0..<3) { index in
                Circle()
                    .frame(width: 5, height: 5)
                    .opacity(0.3 + 0.7 * max(0, sin(phase + Double(index) * 0.9)))
            }
        }
        .foregroundStyle(Theme.accent)
        .onAppear {
            withAnimation(.linear(duration: 1.2).repeatForever(autoreverses: false)) { phase = .pi * 2 }
        }
        .accessibilityHidden(true)
    }
}

/// The text box for telling the Mac what to do, correcting it or answering it.
struct Composer: View {
    @Binding var text: String
    let placeholder: String
    let isSending: Bool
    var dark = false
    let send: () -> Void
    @FocusState private var focused: Bool

    var body: some View {
        HStack(alignment: .bottom, spacing: Theme.spacing) {
            TextField(placeholder, text: $text, axis: .vertical)
                .lineLimit(1...4)
                .focused($focused)
                .submitLabel(.send)
                .onSubmit(send)
                .padding(.horizontal, 14)
                .padding(.vertical, 11)
                .foregroundStyle(dark ? .white : Theme.ink)
                .background(dark ? Color.white.opacity(0.12) : Theme.surface, in: .rect(cornerRadius: 22))
                .overlay {
                    RoundedRectangle(cornerRadius: 22).stroke(dark ? Color.white.opacity(0.15) : Theme.hairline)
                }
            Button(action: send) {
                Group {
                    if isSending {
                        ProgressView().tint(.white)
                    } else {
                        Image(systemName: "arrow.up").font(.body.weight(.bold))
                    }
                }
                .frame(width: 44, height: 44)
                .foregroundStyle(.white)
                .background(canSend ? Theme.accent : Theme.inkSecondary.opacity(0.4), in: .circle)
            }
            .buttonStyle(.plain)
            .disabled(!canSend)
            .accessibilityLabel("Send")
        }
    }

    private var canSend: Bool {
        !isSending && !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
    }
}

/// A transient message pinned to the top of a screen.
struct NoticeBanner: View {
    let message: String

    var body: some View {
        Label(message, systemImage: "exclamationmark.circle.fill")
            .font(.subheadline.weight(.medium))
            .foregroundStyle(.white)
            .padding(.horizontal, 14)
            .padding(.vertical, 10)
            .background(Theme.critical, in: .capsule)
            .shadow(color: .black.opacity(0.15), radius: 8, y: 4)
            .padding(.horizontal)
            .transition(.move(edge: .top).combined(with: .opacity))
    }
}

enum Haptics {
    @MainActor static func success() { UINotificationFeedbackGenerator().notificationOccurred(.success) }
    @MainActor static func warning() { UINotificationFeedbackGenerator().notificationOccurred(.warning) }
    @MainActor static func tap() { UIImpactFeedbackGenerator(style: .medium).impactOccurred() }
}

enum PhoneFormat {
    /// "+14706211642" shown as "(470) 621-1642"; other numbers as given.
    static func display(_ e164: String) -> String {
        let digits = e164.filter(\.isNumber)
        guard e164.hasPrefix("+1"), digits.count == 11 else { return e164 }
        let d = Array(digits.dropFirst())
        return "(\(String(d[0..<3]))) \(String(d[3..<6]))-\(String(d[6..<10]))"
    }

    static func telURL(_ e164: String) -> URL? {
        URL(string: "tel:\(e164.filter { $0.isNumber || $0 == "+" })")
    }

    static func smsURL(_ e164: String) -> URL? {
        URL(string: "sms:\(e164.filter { $0.isNumber || $0 == "+" })")
    }
}

extension Date {
    func relative(to now: Date = Date()) -> String {
        if now.timeIntervalSince(self) < 45 { return "just now" }
        return formatted(.relative(presentation: .named, unitsStyle: .abbreviated))
    }
}
