#if DEBUG
    import SpectrKit
    import SwiftUI

    /// Debug-only window for driving real actions on this Mac without a backend.
    struct ActionLabView: View {
        let lab: ActionLab
        @State private var text = "milk eggs bread coffee apples"
        @State private var instruction = "Open Notes and write a note that says milk"

        var body: some View {
            Form {
                Section("Ask the agent") {
                    TextField("Instruction", text: $instruction, axis: .vertical)
                        .lineLimit(1...3)
                        .onSubmit { lab.runAgent(instruction) }
                    Button("Run with Agent") { lab.runAgent(instruction) }
                        .disabled(instruction.trimmingCharacters(in: .whitespaces).isEmpty)
                        .keyboardShortcut(.defaultAction)
                    if let message = lab.lastMessage {
                        Text(message).font(.callout).textSelection(.enabled)
                    }
                    Text("Needs the local agent: cd tools/dev-agent && npm start. Send again mid-task to correct it.")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
                Section("Scripted task (no agent)") {
                    TextField("Words to write", text: $text)
                    Button("Open Notes and write this") { lab.writeNote(text) }
                        .disabled(text.isEmpty)
                    Text("Run it again mid-task to send a correction. Stop it from the menu bar popover.")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
                Section("Single steps") {
                    HStack {
                        Button("Open Notes") {
                            lab.run(.openApp(bundleId: "com.apple.Notes"), instruction: "Open Notes")
                        }
                        Button("Observe") { lab.run(.observe, instruction: "Look at the screen") }
                    }
                }
                Section("Last result") {
                    if let result = lab.lastResult {
                        LabeledContent("Outcome", value: result.outcome.rawValue)
                        LabeledContent("Front app", value: result.observed?.frontmostAppName ?? "—")
                        if let value = result.observed?.focusedElement?.value {
                            LabeledContent("Focused text", value: value)
                        }
                        if let error = result.error {
                            LabeledContent("Error", value: "\(error.code): \(error.message)")
                        }
                    } else {
                        Text("Nothing has run yet.").foregroundStyle(.secondary)
                    }
                }
            }
            .formStyle(.grouped)
            .frame(width: 440, height: 600)
        }
    }
#endif
