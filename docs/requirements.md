# Spectr — Requirements

EmoryHacks weekend build. Source: the team build plan (Google Doc).

## Goal

A judge texts a multi-step task to their paired Mac, watches the authorized screen on the iPhone, corrects or stops the task, and gets a verified result. One iPhone, one awake Mac. Tasks can span any app or website, such as opening Instagram DMs or moving a Keynote slide.

**Success:** three consecutive runs of different judge-chosen tasks, including examples such as a browser task and a Keynote task, visibly completed and verified on both screens.

## Background

- A two-week diary study (24 people) found over 70% of captured phone-task suspensions were expected to finish on a PC. Validate with students: ask five attendees about the last task they postponed until they reached a computer, and record the task and what blocked it.
- A follow-up study of 73 AI-agent users found more severe failures were perceived as harder to notice. This motivates live viewing and interruption.
- Building blocks: Sendblue (iMessage to webhook), LiveKit Cloud (signaling and media relay), Apple ScreenCaptureKit (authorized screen capture), ElevenLabs (text-to-speech for Spectr's spoken replies). Spectr combines a text instruction, a live view, and user correction in one task.

## Scope

| Priority | In scope |
| --- | --- |
| Ship | Pair one Mac; receive a blue-bubble task; run multi-step work across apps and websites with validated actions; stream the authorized display or window to the native iPhone app; accept a correction; stop; return a screenshot-verified result. Browser tasks and a fictional Keynote deck are demo examples. |
| Next | Private remote-unlock feasibility, background callbacks, cellular hardening. Chert is the backup for texting if Sendblue fails; its FaceTime channel is an optional stretch (see Backup: Chert). |
| Last | VM and hosted cloud browser (Browserbase, Playwright). Browser tasks on the real Mac are in scope. |
| Out | Cloud file sync. |

## Functional requirements

### P0 — Prove the core experience

| ID | Requirement | Acceptance |
| --- | --- | --- |
| R1 | **Pairing.** Pair an iPhone and a Mac to one signed-in owner with a single-use code. Only the owner can start a session or send a command. | A second account cannot open the session or send a command. Revoking a device while connected takes effect. |
| R2 | **Live view.** Open a Spectr session on the iPhone and watch a fresh frame of the authorized display or window over cellular. Push-to-talk ships first. | Mac on Wi-Fi, iPhone on cellular: a manual browser change or Keynote example slide change shows up on the phone. Phone shows Connecting until the first decoded frame and Stalled when frames stop. |
| R3 | **General work on the Mac.** Run a multi-step task in any app or website using schema-validated actions. | Claude's final check confirms the screenshot shows the requested state before success is reported. Keynote tasks may also include `observedSlide`; it must match the requested slide. |
| R4 | **Start by iMessage.** A blue-bubble request creates a task; the reply has a Watch live link; the final summary and screenshot are returned in the original thread via Sendblue. | One inbound message creates one task and one result, even when the webhook is retried. |
| R5 | **Correct or stop.** A newer instruction or tapping Stop cancels the running task and supersedes pending steps. | A correction starts from the latest screenshot and revision; stale or replayed steps do not execute. A disconnected Mac reports its last observed state. |

**Demo gate:** three consecutive runs of different judge-chosen tasks, including a browser task and a Keynote example task, verified on both screens.

### Agent loop and guardrails

The Vercel TypeScript backend calls Claude through the Anthropic Messages API and computer-use tool. Each short HTTP step sends the task's current screenshot and recent action results; the backend resumes the conversation persisted in Supabase and returns the next actions or `done` with a final summary. The Mac executes the actions, posts a fresh screenshot, and repeats. There is no long-running server process; each task is capped at 60 steps.

Actions are validated before the Mac executes them. The allowed actions are screenshot, click/double-click/right-click at `(x,y)`, move, drag, scroll, type text, key/hotkey, wait, `openApp(name)` and `openUrl(url)`. No shell commands or model-generated AppleScript.

Only one task runs per device. Stop and a newer instruction cancel the task and supersede pending steps; a new non-stop text while a task runs is a correction. Ask by text and wait for "yes" before sending a message or DM, posting, purchasing, submitting a form or deleting. Never type passwords or 2FA codes: pause and ask the user to log in themselves while watching live. Reaching 60 steps or getting stuck ends the task as failed with what was observed.

### P1 — Make delegation feel natural

| ID | Requirement |
| --- | --- |
| R6 | Continuous voice: speak, hear Spectr answer, interrupt it, and give a second instruction hands-free. Spectr's voice is an ElevenLabs British, JARVIS-like male voice. |
| R7 | Call back for a decision: persist the question, ring the paired phone, accept one answer by voice or text. |
| R8 | Take over an awake, locked Mac: validate owner-authenticated remote unlock on cellular before promising it in the demo. |

### P2 — Extend to more tasks

| ID | Requirement |
| --- | --- |
| R9 | Use the general agent to check a homework deadline on a supported course portal; return assignment name, exact deadline, time zone and source link. |
| R10 | Use the general agent to prepare a job application on a team-owned form: attach the chosen résumé, ask for missing answers, show the completed form, and require confirmation before submitting. |

### Backup: Chert

Chert is the backup for texting if Sendblue fails; its FaceTime channel is an optional stretch after the P0 demo works. Trial onboarding stalled at phone verification on 2026-11-13. Chert webhook code is kept on branch `devin/1794623817-chert-inbound`.

| ID | Requirement |
| --- | --- |
| R12 | A judge FaceTimes a Chert line, speaks an instruction, and sees the authorized Mac window as the call's outgoing video. Spectr can also FaceTime the user back when it needs a decision. Qualifies for "Best Use of FaceTime (Chert)" only if a real FaceTime call happens in the demo. |

### Last — VM and hosted cloud browser

| ID | Requirement |
| --- | --- |
| R11 | Hosted execution after the real-Mac path works: one supported cloud workflow with synced inputs, with the screen labeled "Cloud browser". |

## User journeys

- **First use:** sign in → pair Mac with a single-use code → select window and grant permissions → verify the first live frame.
- **Returning user:** text a task such as "open Instagram and show my DMs" → tap Watch live → correct or stop from the iPhone → receive the screenshot-verified summary in Messages. A Keynote task such as "go to slide four" is another example.
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
- Capture only the display or window the user authorized. Screen Recording and Accessibility are required for the Mac executor. Keynote AppleScript read-back is optional; never execute model-generated AppleScript.
- `ANTHROPIC_API_KEY` is a Vercel environment variable and never goes to the Mac or iPhone. No arbitrary shell, stored Mac passwords, screen recordings or raw voice logs by default. Never type passwords or 2FA codes; ask the user to log in themselves.

### Reliability

- Persist the task before acknowledging the webhook.
- Deduplicate inbound message handles and command IDs.
- Every step uses the latest screenshot and action results; never replay an unverified action after a restart.
- Treat lock, sleep, disconnect and denied permission as distinct states.
- Events carry a sequence number; clients replay after the last `seq` on reconnect.

### Platform

- iPhone app and Mac helper in Swift/SwiftUI. Agent and backend in TypeScript.
- Claude computer-use runs through the Anthropic Messages API on Vercel; `ANTHROPIC_API_KEY` stays server-side.
- Spoken replies use the ElevenLabs API with one fixed British, JARVIS-like male voice. The ElevenLabs key stays server-side.
- Both Xcode targets pin the same stable LiveKit Swift SDK release.
- Internet access is required (LiveKit Cloud). Plan a rehearsed hotspot if venue Wi-Fi blocks peer traffic.

## Constraints and early decisions

- **Colby has no Mac**, so all Swift work (iPhone app and Mac helper) is owned by Jared. Colby takes TypeScript work from Poorav and Sweeya. See [tasks.md](tasks.md).
- Pick a browser task, a Keynote example task and a demo phone at kickoff, and test the LiveKit stream over cellular.
- Sendblue's free shared line requires a verified tester.
- Treat closed-lid capture and lock-screen control as device tests; rehearse the core path on an awake Mac.

## Failure cases to demo and test

- Disconnect the Mac mid-demo and show honest recovery.
- Duplicate webhook delivery.
- Expired watch link.
- Denied screen capture permission.
- A second account trying to open the session.
