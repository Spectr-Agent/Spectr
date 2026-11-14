# Spectr — Requirements

EmoryHacks weekend build. Source: the team build plan (Google Doc), updated for Chert.

## Goal

A judge texts or FaceTimes Spectr, watches their Mac's actual screen on the FaceTime call, says a correction, and sees the corrected result. One iPhone, one awake Mac.

**Success:** three consecutive runs in which a judge picks a different slide over FaceTime and the Mac visibly reaches it, verified on the call and on the Mac.

## Background

- A two-week diary study (24 people) found over 70% of captured phone-task suspensions were expected to finish on a PC. Validate with students: ask five attendees about the last task they postponed until they reached a computer, and record the task and what blocked it.
- A follow-up study of 73 AI-agent users found more severe failures were perceived as harder to notice. This motivates live viewing and interruption.
- Building blocks: [Chert](https://www.trychert.com/emory) (a real Apple line for iMessage and FaceTime, bridged to LiveKit), LiveKit Cloud (media), Apple ScreenCaptureKit (window capture), ElevenLabs (Spectr's voice), Supabase (state). Spectr combines an instruction, a live view, and user correction in one task.
- Chert's agents can see the caller's camera and send video back, but can't share or control a screen. Spectr's Mac helper is what adds that, which is the angle for the "Best Use of FaceTime (Chert)" track.

## Scope

| Priority | In scope |
| --- | --- |
| Ship | Pair one Mac; receive an iMessage through Chert; take a FaceTime call through Chert and show one authorized Mac window as the call's video; run a small set of Keynote actions; accept a spoken or texted correction; stop; return a verified result. Demo app: Keynote with a fictional five-slide deck. |
| Fallback | Native iPhone app that watches the same Mac window over LiveKit, with Stop and a typed correction. Used if FaceTime video is unreadable or Chert is down. |
| Next | Call back for a decision over FaceTime, private remote-unlock feasibility, cellular hardening, more native-app actions. |
| Last | VM, hosted browser, browser automation (Browserbase, Playwright). |
| Out | Cloud file sync. |

## Functional requirements

### P0 — Prove the core experience

| ID | Requirement | Acceptance |
| --- | --- | --- |
| R1 | **Pairing.** Pair a Mac to one owner with a single-use code, and bind the owner's phone number (a Chert-verified handle) to that owner. Only the owner's phone can start a task or send a command. | A text from an unbound number creates no task. Revoking the Mac while connected takes effect. |
| R2 | **Watch over FaceTime.** The judge FaceTimes Spectr's Chert line (video) and sees the selected Keynote window as Spectr's video. | Spectr greets within 10 seconds of the bridge being ready. A manual slide change shows up on the call. If Mac frames stop, Spectr says the view is stalled instead of showing a frozen frame as live. |
| R3 | **Real work on the Mac.** "Go to slide five" moves Keynote, reads back the slide number, and reports the result. | The Mac result includes `observedSlide`; success is reported only when it matches the target. Out-of-range slides are rejected. |
| R4 | **Start by iMessage.** A text to the Chert line creates a task; the reply tells the judge to FaceTime the same number to watch; the verified result is returned in the same thread. | One inbound message creates one task and one reply, even when Chert retries the webhook (dedupe on `event_id`). |
| R5 | **Correct or stop.** "Actually, slide two" or "stop", said on the call or texted, supersedes pending commands, says what actually happened, and reports a lost connection. | A newer revision invalidates older pending commands; a replayed command ID or stale revision never changes the slide again. |

**Demo gate:** three consecutive runs where the judge chooses the slide on a real FaceTime call and verifies the result.

### P0 fallback

| ID | Requirement | Acceptance |
| --- | --- | --- |
| R6 | **iPhone fallback viewer.** The Spectr iPhone app opens the current task, watches the Mac window over LiveKit, and offers Stop and a typed correction. | Mac on Wi-Fi, iPhone on cellular: a manual slide change shows up. Connecting until the first decoded frame; Stalled when frames stop. |

### P1 — Make delegation feel natural

| ID | Requirement |
| --- | --- |
| R7 | Natural conversation on the call: Spectr answers in an ElevenLabs British, JARVIS-like male voice, and the judge can interrupt it mid-sentence with a new instruction. |
| R8 | Call back for a decision: persist the question, FaceTime the owner through Chert's outbound call API, accept one answer by voice or text. |
| R9 | Take over an awake, locked Mac: validate owner-authenticated remote unlock on cellular before promising it in the demo. |

### P2 — Extend to more tasks

| ID | Requirement |
| --- | --- |
| R10 | Check a homework deadline on one supported course portal; return assignment name, exact deadline, time zone and source link. |
| R11 | Prepare a job application on a team-owned form: attach the chosen résumé, ask for missing answers, show the completed form, and require confirmation before submitting. |

### Last — VM and general browser automation

| ID | Requirement |
| --- | --- |
| R12 | Hosted execution after the real-Mac path works: one supported cloud workflow with synced inputs, with the screen labeled "Cloud browser". |

## User journeys

- **First use:** sign in → pair Mac with a single-use code → select window and grant permissions → verify the owner's phone with Chert → FaceTime Spectr and see the first live frame.
- **Returning user:** text "open the demo deck" → reply says "FaceTime me to watch" → FaceTime the same number → see the deck → say "slide four" → see slide four on the call → receive the result in Messages.
- **Fallback:** if FaceTime video is unreadable, open the iPhone app on the same task and continue there.
- **Recovery:**
  - Missing permission → a specific setup action.
  - Disconnected Mac → Spectr says when it was last seen and offers a retry.
  - Awake, locked Mac → may need user intervention for UI actions.
  - A heartbeat never proves an interactive desktop.

## Non-functional requirements

### Security and privacy

- Bind the messaging handle to a signed-in owner via one-time pairing. Verify Chert webhook signatures.
- Check ownership on every task, call and live session. Room tokens are short-lived and scoped to one room; the Chert bridge gets its own token, distinct from the agent's.
- Service keys (Chert, LiveKit, ElevenLabs Scribe/voice, model) stay server-side. Device credentials live in Keychain. Never paste keys into chat.
- Capture only the user-selected window. Request Mac Automation/Accessibility only when the chosen action needs it.
- No arbitrary shell, no stored Mac passwords, no screen recordings, and no raw voice logs or call transcripts by default. Never request a Mac password in chat or turn model output into shell commands.

### Reliability

- Persist the task before acknowledging the webhook.
- Deduplicate inbound messages (Chert `event_id`) and command IDs.
- Prefer absolute commands (`goToSlide(4)`) over relative ones; never replay a relative advance after a restart.
- Treat lock, sleep, disconnect and denied permission as distinct states.
- Events carry a sequence number; clients replay after the last `seq` on reconnect.
- The call agent and `chert dev` are long-running processes; both must stay up for calls to connect.

### Platform

- Mac helper and fallback iPhone app in Swift/SwiftUI. Backend, agent and call agent in TypeScript.
- The call agent is a LiveKit Agents (Node) worker connected to FaceTime with the Chert CLI.
- Spectr's voice is one fixed ElevenLabs British, JARVIS-like male voice.
- Realtime call transcription uses ElevenLabs Scribe with the same `ELEVENLABS_API_KEY` and shared credit pool as voice; monitor credit usage.
- Both Xcode targets pin the same stable LiveKit Swift SDK release.
- Internet access is required. Plan a rehearsed hotspot if venue Wi-Fi blocks peer traffic.

## Constraints and early decisions

- **Colby has no Mac**, so all Swift work (Mac helper and iPhone app) is owned by Jared. Colby owns the TypeScript call agent and voice. See [tasks.md](tasks.md).
- **Chert free trial:** 50 FaceTime minutes, calls up to 5 minutes, one call at a time on the shared line, up to 50 inbound texts an hour, and Spectr can only reply to texts (within 24 hours of the phone's last message). It lasts 48 hours from activation (for trials started by Nov 18), so start it at a time that still covers judging.
- **Verified phones only:** every phone that texts or calls Spectr must first be verified on the Chert project by texting a 6-digit code. Demo from a team phone, or verify a judge's phone before their run.
- **Unverified until the spike:** whether Keynote text stays readable over FaceTime video, and whether trial projects can use the `message.received` webhook (fallback: Chert's event stream).
- The Chert CLI and SDK are betas. Rehearse the exact versions we pin.
- Treat closed-lid capture and lock-screen control as device tests; rehearse the core path on an awake Mac.

## Failure cases to demo and test

- Disconnect the Mac mid-call and show honest recovery.
- Duplicate webhook delivery.
- A text from an unverified or unbound number.
- Denied screen capture permission.
- The FaceTime call drops; call again and continue the same task.
