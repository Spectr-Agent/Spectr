# Spectr — Design

See [requirements.md](requirements.md) for scope and acceptance criteria and [tasks.md](tasks.md) for owners.

## Architecture

```
Messages ──► Sendblue ──► TypeScript API (Vercel) ──► Claude computer-use loop ──► validated actions
                               │    ▲                                       │
                               │    │ result / receipt                      ▼
                               │    └──────────────────────────── Mac helper (Swift) ──► app or website
                               │                                            │
                               ├── room tokens ──► LiveKit Cloud ◄── screen-share track
                               │                       │
                               └── task API ◄──► iPhone app (SwiftUI) ◄─────┘ subscribe
                                       Supabase (Auth, Postgres, RLS)
```

- The **API** authorizes users, stores task state and per-task Claude conversation in Supabase, issues LiveKit room tokens, and texts the final summary and screenshot to the original iMessage thread through Sendblue.
- The **agent** uses Claude through the Anthropic Messages API and computer-use tool. Each short HTTP step resumes the task's stored conversation with the current screenshot and recent action results, then returns an action batch or `done` with a final summary. There is no long-running server process; a task is capped at 40 steps.
- The **Mac helper** captures only the display or window the user authorized, posts screenshots and action results to the API, executes validated actions, and publishes the authorized screen over LiveKit.
- The **iPhone app** joins the authenticated live session, renders the stream, sends corrections and Stop, and plays Spectr's spoken replies.
- **ElevenLabs** turns Spectr's verified status or completion text into speech, called from the API so the key never reaches a device.
- **LiveKit Cloud** handles signaling and media relay. Video never goes through the HTTP API.

## Components

### iPhone app — `apps/ios/SpectrIOS/`

- SwiftUI, URLSession/Codable for task requests, Keychain for the session.
- Universal Links for Watch live (Associated Domains entitlement + `apple-app-site-association` served by the API). Keep an in-app task opener for development.
- LiveKit Swift SDK (pinned) as a subscriber to the task room's screen-share track.
- AVFoundation mic capture and Apple Speech for push-to-talk transcription; typed fallback uses the same endpoint.
- Plays reply audio from the API's speech endpoint (AVFoundation). Stop or a new instruction interrupts playback.
- Screen states: connecting, live, stalled, interrupted, reconnecting, stopped. Connecting until the first decoded frame; Stalled when frames stop arriving.
- Stop takes priority over pending actions. Relaunch restores the right task and the last verified state.

### Mac helper — `apps/mac/SpectrMac/`

- SwiftUI `MenuBarExtra` with Pair, Select window, Start sharing, Stop, and a sharing indicator.
- ScreenCaptureKit screenshots of the shared display or a user-authorized window, published through the pinned LiveKit Swift SDK as a screen-share track.
- General input through CGEvent mouse/keyboard events and NSWorkspace for `openApp(name)` and `openUrl(url)`.
- Screen Recording and Accessibility are required. Keynote AppleScript read-back is optional extra verification; model-generated AppleScript is never executed. Check signing/sandbox configuration early.
- Device credentials in Keychain. Show permission recovery after denial.
- If capture stalls while the process still responds, report the stream as unavailable.
- The agent sees only the display or window the user authorized for capture.

### API — `services/api/src/`

- Node.js + TypeScript on Vercel. Project `spectr-api` (https://spectr-api.vercel.app), root `services/api`. Zod for runtime validation.
- Sendblue inbound webhook (verified) and outbound replies.
- A short-request Claude computer-use endpoint; `ANTHROPIC_API_KEY` is a Vercel environment variable, never sent to the Mac or iPhone.
- Supabase Auth + Postgres with row-level security; migrations in `supabase/migrations/`.
- LiveKit Node server SDK for room tokens: the Mac gets screen-share publish rights, the iPhone gets subscribe-only for the first test. Tokens are short-lived and scoped to the task room.
- Persist each task's Claude conversation and current state in Supabase. The Mac posts its next screenshot after each action batch; no long-lived worker is required.

### Voice — `services/api/src/voice/`

- ElevenLabs text-to-speech, called server-side. `ELEVENLABS_API_KEY` and `ELEVENLABS_VOICE_ID` are server environment variables.
- Voice: a British, JARVIS-like male voice (calm, crisp, slightly formal). Pick it from the ElevenLabs voice library at kickoff and pin its voice ID and voice settings so every reply sounds the same.
- Use the streaming endpoint so playback starts before the whole clip is generated.
- Input is only the agent's short verified status/completion text. A Keynote task may additionally use `observedSlide`. No raw voice logs or stored audio by default.
- If ElevenLabs fails or times out, the reply is still shown as text; the task never waits on audio.

### Agent — `services/api/src/agent/`

- Claude computer use through the Anthropic Messages API runs in the TypeScript API on Vercel. `ANTHROPIC_API_KEY` stays server-side.
- Persist the per-task conversation in Supabase. On each short request, send the current screenshot and recent action results; return the next batch or `done` with a final summary. Cap each task at 40 steps.
- Validate every action before the Mac executes it. Allowed actions: screenshot, click/double-click/right-click at `(x,y)`, move, drag, scroll, type text, key/hotkey, wait, `openApp(name)` and `openUrl(url)`. No shell commands or model-generated AppleScript.
- Allow one active task per device. Stop and a newer instruction cancel the running task and supersede pending actions; a new non-stop text is a correction.
- Ask by text and wait for "yes" before sending a message or DM, posting, purchasing, submitting a form or deleting. Never type passwords or 2FA codes; ask the user to log in themselves while watching live.
- Report success only after Claude's final check confirms the screenshot shows the requested state. If the task reaches 40 steps or gets stuck, fail with what was observed.

## Interface contracts

Poorav owns the shared JSON fixtures in `contracts/`. Jared decodes them in both Swift targets; the agent produces schema-validated actions. **Freeze these before styling.**

### Task

```json
{
  "taskId": "tsk_demo_001",
  "deviceId": "dev_demo_mac",
  "state": "accepted",
  "revision": 1
}
```

States:

```
accepted ──► running ──► succeeded
                │  ├───► failed
                │  └───► cancelled
                └──────► waitingForUser ──► running
```

### Mac actions

The API validates every action batch against the shared schema before the Mac executes it. Allowed actions are screenshot, click/double-click/right-click at `(x,y)`, move, drag, scroll, type text, key/hotkey, wait, `openApp(name)` and `openUrl(url)`. Stop and corrections are task controls, not model-generated computer-use actions.

Action batches are scoped to `taskId` and `revision`. Stop and a newer instruction invalidate pending actions from older revisions.

### Mac result

Success requires Claude's final check to confirm the final screenshot shows the requested state. A Keynote task may also return this optional read-back:

```json
{
  "commandId": "cmd_demo_004",
  "revision": 2,
  "outcome": "succeeded",
  "observedSlide": 4
}
```

When present, `observedSlide` must match the requested slide.

### Event

```json
{ "taskId": "tsk_demo_001", "seq": 7, "type": "result", "data": { } }
```

Clients replay events after the last `seq` they saw on reconnect.

### API surface

| Operation | Returns |
| --- | --- |
| Create task | `taskId` |
| `GET /api/mac/task` | Active task and current step for the authenticated Mac |
| `POST /api/mac/step` | Validated actions, a waiting question, or a finished result |
| `GET /api/tasks/screenshot` | Final screenshot for a task with a valid signature |
| Redeem watch link | Authenticated, short-lived session |
| Post instruction or stop | New `revision` |
| Mac step | Validated action batch or `done` with final summary |
| Mac step result | Recent action results and fresh screenshot |
| Room token | LiveKit token scoped to the task room |
| Speak reply | Streamed ElevenLabs audio for a reply on a task the caller owns |

Fixtures to publish: create, action batch, event, correction, result, error; task examples for `accepted`, `waitingForUser`, `succeeded`, `cancelled`; a stale-revision error; browser and Keynote examples, with `observedSlide` only for the Keynote example.

## Data model (Supabase)

| Table | Purpose |
| --- | --- |
| owners | Signed-in users |
| devices | Paired Macs and iPhones, revocation state, last seen |
| messaging_identities | Sendblue sender bound to an owner via one-time pairing |
| tasks | Task state, current revision, and per-task agent conversation/state |
| commands | Command IDs (unique), revision, status |
| events | Ordered per-task event log (`seq`) |
| results | Mac step results and final screenshot reference; optional `observedSlide` for Keynote |
| decisions | Questions waiting for the user and their answers |

- Unique constraints on provider message ID and command ID.
- RLS: every row is tenant-scoped to its owner.

## Correctness rules

1. Persist the task before acknowledging the webhook.
2. Deduplicate webhook retries (provider message ID) and commands (`commandId`).
3. Reject results for stale revisions.
4. Stop and newer corrections supersede pending older actions.
5. Only a final screenshot showing the requested state marks the task successful. A Keynote task may also check `observedSlide`.
6. After a restart, resume from persisted task state and a fresh screenshot; never replay an unverified action.

## Backup: Chert

Chert is the backup for texting if Sendblue fails; its FaceTime channel is an optional stretch after the P0 build. [Chert](https://www.trychert.com/emory) bridges a real FaceTime call to a LiveKit room. Spectr's agent would join that room as the speaking participant, publish the authorized Mac window frames as its video track, and send transcribed instructions through the existing task API, so commands, revisions and verified results are unchanged. Chert can't share or control a screen itself; the Mac helper still does that. Outbound calls (`POST /api/v1/calls`) could cover the "call back for a decision" case.

Constraints to check before committing to it:
- Trial onboarding stalled at phone verification on 2026-11-13. Chert webhook code is kept on branch `devin/1794623817-chert-inbound`.
- The agent must speak within 10 seconds of the call connecting.
- The CLI is a beta (`@trychert/facetime`).
- Unverified: whether a Keynote demo frame stays readable over FaceTime video. Spike this first.
- `CHERT_API_KEY` stays server-side, like the other provider keys.

## Security

- Verify Sendblue webhook authentication. Bind the sender to a paired owner.
- Check ownership on every task, device and live session request.
- Expiring pairing codes and viewer tokens; device revocation.
- Provider secrets (Sendblue, LiveKit, ElevenLabs, Anthropic) in server environment variables. `ANTHROPIC_API_KEY` never reaches the Mac or iPhone; device credentials stay in Keychain.
- Capture only the display or window the user authorized. No arbitrary shell or model-generated AppleScript, stored Mac passwords, screen recordings or raw voice logs by default.
- Ask for "yes" before outward-facing or irreversible actions. Never type passwords or 2FA codes; pause for the user to log in.

## Recovery states

| Condition | User sees |
| --- | --- |
| Missing permission | A specific setup action |
| Mac disconnected | Last seen time and a retry control |
| Mac locked (awake) | Needs user intervention for UI actions |
| Frames stopped | Stalled |
| Final screenshot does not show the requested state | Actionable failure, not success; a Keynote mismatch may also include `observedSlide` |

## Repository layout

```
spectr/
  apps/ios/SpectrIOS/            SwiftUI iPhone target
    SpectrIOSApp.swift
  apps/mac/SpectrMac/            Menu-bar helper target
    SpectrMacApp.swift
  services/api/src/              TypeScript API package
    index.ts
    agent/plan.ts                Claude computer-use step endpoint and action validation
    voice/                       ElevenLabs text-to-speech
  contracts/task.example.json    Shared fixtures
  supabase/migrations/
  docs/                          requirements, design, tasks
  AGENTS.md · README.md · .gitignore · .env.example
```

## Testing

- **iPhone:** XCTest and simulator fixtures for navigation and state; a physical iPhone for permission prompts, mic input, incoming links and stream latency.
- **Mac:** XCTest for action and revision handling; a real Mac for authorized screenshots and inputs, with optional Keynote slide read-back.
- **API:** Vitest for webhook replay and authorization; Supabase CLI for local migrations.
- **Agent:** Vitest with browser and Keynote tasks, fake screenshots and action results; verify the final screenshot, with optional `observedSlide` for Keynote.
- **Integration gate:** Mac on Wi-Fi, iPhone on cellular; complete a browser task and a Keynote example task, verify fresh frames and final results on both screens.
