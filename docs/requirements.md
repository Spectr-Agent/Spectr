# Spectr — Requirements

EmoryHacks weekend build. Source: the team build plan (Google Doc).

## Goal

A judge texts their paired Mac, watches a real app respond, changes the instruction from their iPhone, and sees the corrected result. One iPhone, one awake Mac.

**Success:** three consecutive runs in which a judge chooses a different target and the Mac visibly reaches it, verified on both screens.

## Background

- A two-week diary study (24 people) found over 70% of captured phone-task suspensions were expected to finish on a PC. Validate with students: ask five attendees about the last task they postponed until they reached a computer, and record the task and what blocked it.
- A follow-up study of 73 AI-agent users found more severe failures were perceived as harder to notice. This motivates live viewing and interruption.
- Building blocks: Apple Screen Sharing (remote control), Sendblue (iMessage to webhook), LiveKit Cloud (signaling and media relay), Apple ScreenCaptureKit (window capture), ElevenLabs (text-to-speech for Spectr's spoken replies). Spectr combines a text instruction, a live view, and user correction in one task.

## Scope

| Priority | In scope |
| --- | --- |
| Ship | Pair one Mac; receive a blue-bubble request; stream one authorized window to the native iPhone app; run a small set of Keynote presentation actions; accept a spoken or typed correction; stop; return a verified result. Demo app: Keynote with a fictional five-slide deck. |
| Next | Private remote-unlock feasibility, background callbacks, cellular hardening, more native-app actions. Chert is the backup for texting if Sendblue fails; its FaceTime channel is an optional stretch (see Backup: Chert). |
| Last | VM, hosted browser, browser automation (Browserbase, Playwright). |
| Out | Cloud file sync. |

## Functional requirements

### P0 — Prove the core experience

| ID | Requirement | Acceptance |
| --- | --- | --- |
| R1 | **Pairing.** Pair an iPhone and a Mac to one signed-in owner with a single-use code. Only the owner can start a session or send a command. | A second account cannot open the session or send a command. Revoking a device while connected takes effect. |
| R2 | **Live view.** Open a Spectr session on the iPhone and watch a fresh frame of the selected Keynote window over cellular. Push-to-talk ships first. | Mac on Wi-Fi, iPhone on cellular: a manual slide change shows up on the phone. Phone shows Connecting until the first decoded frame and Stalled when frames stop. |
| R3 | **Real work on the Mac.** "Go to slide five" moves Keynote, reads back the slide number, and reports the result. | The Mac result includes `observedSlide`; success is reported only when it matches the target. Out-of-range slides are rejected. |
| R4 | **Start by iMessage.** A blue-bubble request creates a task; the reply has a Watch live link; the verified result is returned in the original thread. | One inbound message creates one task and one reply, even when the webhook is retried. |
| R5 | **Correct or stop.** "Actually, slide two" or tapping Stop supersedes pending commands, shows what actually happened, and reports a lost connection. | A newer revision invalidates older pending commands; a replayed command ID or stale revision never changes the slide again. |

**Demo gate:** three consecutive runs where the judge chooses the slide and verifies the result on both screens.

### P1 — Make delegation feel natural

| ID | Requirement |
| --- | --- |
| R6 | Continuous voice: speak, hear Spectr answer, interrupt it, and give a second instruction hands-free. Spectr's voice is an ElevenLabs British, JARVIS-like male voice. |
| R7 | Call back for a decision: persist the question, ring the paired phone, accept one answer by voice or text. |
| R8 | Take over an awake, locked Mac: validate owner-authenticated remote unlock on cellular before promising it in the demo. |

### P2 — Extend to more tasks

| ID | Requirement |
| --- | --- |
| R9 | Check a homework deadline on one supported course portal; return assignment name, exact deadline, time zone and source link. |
| R10 | Prepare a job application on a team-owned form: attach the chosen résumé, ask for missing answers, show the completed form, and require confirmation before submitting. |

### Backup: Chert

Chert is the backup for texting if Sendblue fails; its FaceTime channel is an optional stretch after the P0 demo works. Trial onboarding stalled at phone verification on 2026-11-13. Chert webhook code is kept on branch `devin/1794623817-chert-inbound`.

| ID | Requirement |
| --- | --- |
| R12 | A judge FaceTimes a Chert line, speaks an instruction, and sees the authorized Mac window as the call's outgoing video. Spectr can also FaceTime the user back when it needs a decision. Qualifies for "Best Use of FaceTime (Chert)" only if a real FaceTime call happens in the demo. |

### Last — VM and general browser automation

| ID | Requirement |
| --- | --- |
| R11 | Hosted execution after the real-Mac path works: one supported cloud workflow with synced inputs, with the screen labeled "Cloud browser". |

## User journeys

- **First use:** sign in → pair Mac with a single-use code → select window and grant permissions → verify the first live frame.
- **Returning user:** text "open the demo deck" → tap Watch live → say "slide four" → see slide four on both devices → receive the result in Messages.
- **Recovery:**
  - Missing permission → a specific setup action.
  - Disconnected Mac → last seen time and a retry control.
  - Awake, locked Mac → may need user intervention for UI actions.
  - A heartbeat never proves an interactive desktop.

## Non-functional requirements

### Security and privacy

- Bind the messaging sender to a signed-in owner via one-time pairing. Verify provider webhook authentication.
- Check ownership on every task and live session. Viewer access is short-lived and scoped to the task room.
- Service keys stay server-side. Device credentials live in Keychain.
- Capture only the user-selected window. Request Mac Automation/Accessibility only when the chosen action needs it.
- No arbitrary shell, no stored Mac passwords, no screen recordings, and no raw voice logs by default. Never request a Mac password in chat or turn model output into shell commands.

### Reliability

- Persist the task before acknowledging the webhook.
- Deduplicate inbound message handles and command IDs.
- Prefer absolute commands (`goToSlide(4)`) over relative ones; never replay a relative advance after a restart.
- Treat lock, sleep, disconnect and denied permission as distinct states.
- Events carry a sequence number; clients replay after the last `seq` on reconnect.

### Platform

- iPhone app and Mac helper in Swift/SwiftUI. Agent and backend in TypeScript.
- Spoken replies use the ElevenLabs API with one fixed British, JARVIS-like male voice. The ElevenLabs key stays server-side.
- Both Xcode targets pin the same stable LiveKit Swift SDK release.
- Internet access is required (LiveKit Cloud). Plan a rehearsed hotspot if venue Wi-Fi blocks peer traffic.

## Constraints and early decisions

- **Colby has no Mac**, so all Swift work (iPhone app and Mac helper) is owned by Jared. Colby takes TypeScript work from Poorav and Sweeya. See [tasks.md](tasks.md).
- Pick the sample deck and demo phone at kickoff, and test the LiveKit stream over cellular.
- Sendblue's free shared line requires a verified tester.
- Treat closed-lid capture and lock-screen control as device tests; rehearse the core path on an awake Mac.

## Failure cases to demo and test

- Disconnect the Mac mid-demo and show honest recovery.
- Duplicate webhook delivery.
- Expired watch link.
- Denied screen capture permission.
- A second account trying to open the session.
