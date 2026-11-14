# Spectr — Design

See [requirements.md](requirements.md) for scope and acceptance criteria and [tasks.md](tasks.md) for owners.

## Architecture

```
Messages ──► Sendblue ──► TypeScript API (Vercel) ──► Agent planner ──► typed action
                               │    ▲                                       │
                               │    │ result / receipt                      ▼
                               │    └──────────────────────────── Mac helper (Swift) ──► Keynote
                               │                                            │
                               ├── room tokens ──► LiveKit Cloud ◄── screen-share track
                               │                       │
                               └── task API ◄──► iPhone app (SwiftUI) ◄─────┘ subscribe
                                       Supabase (Auth, Postgres, RLS)
```

- The **API** authorizes users, stores task state in Supabase, issues LiveKit room tokens, and returns receipts to the original iMessage thread.
- The **agent** turns a natural request into one schema-validated action.
- The **Mac helper** captures only the selected window, publishes it as a LiveKit screen-share track, runs Keynote actions, and reports the observed slide.
- The **iPhone app** joins the authenticated live session, renders the stream, sends corrections and Stop, and plays Spectr's spoken replies.
- **ElevenLabs** turns Spectr's reply text into speech, called from the API so the key never reaches a device.
- **LiveKit Cloud** handles signaling and media relay. Video never goes through the HTTP API.

## Components

### iPhone app — `apps/ios/SpectrIOS/`

- SwiftUI, URLSession/Codable for task requests, Keychain for the session.
- Universal Links for Watch live (Associated Domains entitlement + `apple-app-site-association` served by the API). Keep an in-app task opener for development.
- LiveKit Swift SDK (pinned) as a subscriber to the task room's screen-share track.
- AVFoundation mic capture and Apple Speech for push-to-talk transcription; typed fallback uses the same endpoint.
- Plays reply audio from the API's speech endpoint (AVFoundation). Stop or a new instruction interrupts playback.
- Screen states: connecting, live, stalled, interrupted, reconnecting, stopped. Connecting until the first decoded frame; Stalled when frames stop arriving.
- Stop takes priority over pending actions. Relaunch restores the right task and the last verified slide.

### Mac helper — `apps/mac/SpectrMac/`

- SwiftUI `MenuBarExtra` with Pair, Select window, Start sharing, Stop, and a sharing indicator.
- ScreenCaptureKit for selected-window frames, published through the pinned LiveKit Swift SDK as a screen-share track.
- Keynote actions through its AppleScript interface (Apple Events): `openDemoDeck`, `goToSlide(n)`. Read back the current slide after every action.
- Permissions: Screen Recording for capture, Automation for Keynote. Accessibility only if UI scripting is actually required. Check signing/sandbox configuration early.
- Device credentials in Keychain. Show permission recovery after denial.
- If capture stalls while the process still responds, report the stream as unavailable.

### API — `services/api/src/`

- Node.js + TypeScript on Vercel. Project `spectr-api` (https://spectr-api.vercel.app), root `services/api`. Zod for runtime validation.
- Sendblue inbound webhook (verified) and outbound replies.
- Supabase Auth + Postgres with row-level security; migrations in `supabase/migrations/`.
- LiveKit Node server SDK for room tokens: the Mac gets screen-share publish rights, the iPhone gets subscribe-only for the first test. Tokens are short-lived and scoped to the task room.
- A worker that must stay alive needs an independent host or durable delivery (Vercel functions are not long-lived).

### Voice — `services/api/src/voice/`

- ElevenLabs text-to-speech, called server-side. `ELEVENLABS_API_KEY` and `ELEVENLABS_VOICE_ID` are server environment variables.
- Voice: a British, JARVIS-like male voice (calm, crisp, slightly formal). Pick it from the ElevenLabs voice library at kickoff and pin its voice ID and voice settings so every reply sounds the same.
- Use the streaming endpoint so playback starts before the whole clip is generated.
- Input is only the agent's short status/completion text, which is already derived from `observedSlide`. No raw voice logs or stored audio by default.
- If ElevenLabs fails or times out, the reply is still shown as text; the task never waits on audio.

### Agent — `services/api/src/agent/`

- The team's configured model SDK with structured output; Zod parses the allowed action types.
- A deterministic parser for supported actions is the offline/test fallback if model access fails.
- Relative requests ("next slide") resolve to an absolute target from observed slide state. If the current slide is unknown, request state before producing a command.
- Ask one short question when the target is unclear. Reject unsupported apps and out-of-range slides.
- Completion text is generated only from `observedSlide`.

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

### Commands

| Command | Payload |
| --- | --- |
| `openDemoDeck` | — |
| `goToSlide` | `{ "number": 1..5 }` |
| `stop` | — |

Every command carries `commandId`, `taskId` and `revision`. A newer correction invalidates older pending commands.

### Mac result

```json
{
  "commandId": "cmd_demo_004",
  "revision": 2,
  "outcome": "succeeded",
  "observedSlide": 4
}
```

Success is reported only when `observedSlide` matches the target.

### Event

```json
{ "taskId": "tsk_demo_001", "seq": 7, "type": "result", "data": { } }
```

Clients replay events after the last `seq` they saw on reconnect.

### API surface

| Operation | Returns |
| --- | --- |
| Create task | `taskId` |
| Redeem watch link | Authenticated, short-lived session |
| Post instruction or stop | New `revision` |
| Device claim | Next typed command |
| Device result | Receipt |
| Room token | LiveKit token scoped to the task room |
| Speak reply | Streamed ElevenLabs audio for a reply on a task the caller owns |

Fixtures to publish: create, command, event, correction, result, error; task examples for `accepted`, `waitingForUser`, `succeeded`, `cancelled`; a stale-revision error; an `observedSlide` receipt.

## Data model (Supabase)

| Table | Purpose |
| --- | --- |
| owners | Signed-in users |
| devices | Paired Macs and iPhones, revocation state, last seen |
| messaging_identities | Sendblue sender bound to an owner via one-time pairing |
| tasks | Task state and current revision |
| commands | Command IDs (unique), revision, status |
| events | Ordered per-task event log (`seq`) |
| results | Mac receipts with `observedSlide` |
| decisions | Questions waiting for the user and their answers |

- Unique constraints on provider message ID and command ID.
- RLS: every row is tenant-scoped to its owner.

## Correctness rules

1. Persist the task before acknowledging the webhook.
2. Deduplicate webhook retries (provider message ID) and commands (`commandId`).
3. Reject results for stale revisions.
4. Stop and newer corrections supersede pending older actions.
5. Only observed Mac state marks an action successful.
6. After a worker restart between claim and result, surface the last known state; never replay a relative slide advance.

## Backup: Chert

Chert is the backup for texting if Sendblue fails; its FaceTime channel is an optional stretch after the P0 build. [Chert](https://www.trychert.com/emory) bridges a real FaceTime call to a LiveKit room. Spectr's agent would join that room as the speaking participant, publish the authorized Mac window frames as its video track, and send transcribed instructions through the existing task API, so commands, revisions and verified results are unchanged. Chert can't share or control a screen itself; the Mac helper still does that. Outbound calls (`POST /api/v1/calls`) could cover the "call back for a decision" case.

Constraints to check before committing to it:
- Trial onboarding stalled at phone verification on 2026-11-13. Chert webhook code is kept on branch `devin/1794623817-chert-inbound`.
- The agent must speak within 10 seconds of the call connecting.
- The CLI is a beta (`@trychert/facetime`).
- Unverified: whether Keynote frames stay readable over FaceTime video. Spike this first.
- `CHERT_API_KEY` stays server-side, like the other provider keys.

## Security

- Verify Sendblue webhook authentication. Bind the sender to a paired owner.
- Check ownership on every task, device and live session request.
- Expiring pairing codes and viewer tokens; device revocation.
- Provider secrets (Sendblue, LiveKit, ElevenLabs, model) in server environment variables; device credentials in Keychain.
- Capture only the user-selected window. No arbitrary shell, stored Mac passwords, screen recordings or raw voice logs by default.

## Recovery states

| Condition | User sees |
| --- | --- |
| Missing permission | A specific setup action |
| Mac disconnected | Last seen time and a retry control |
| Mac locked (awake) | Needs user intervention for UI actions |
| Frames stopped | Stalled |
| Mac reports a different slide | Actionable failure, not success |

## Repository layout

```
spectr/
  apps/ios/SpectrIOS/            SwiftUI iPhone target
    SpectrIOSApp.swift
  apps/mac/SpectrMac/            Menu-bar helper target
    SpectrMacApp.swift
  services/api/src/              TypeScript API package
    index.ts
    agent/plan.ts                Typed intent boundary
    voice/                       ElevenLabs text-to-speech
  contracts/task.example.json    Shared fixtures
  supabase/migrations/
  docs/                          requirements, design, tasks
  AGENTS.md · README.md · .gitignore · .env.example
```

## Testing

- **iPhone:** XCTest and simulator fixtures for navigation and state; a physical iPhone for permission prompts, mic input, incoming links and stream latency.
- **Mac:** XCTest for revision handling; a real Mac for frames and slide readback.
- **API:** Vitest for webhook replay and authorization; Supabase CLI for local migrations.
- **Agent:** Vitest with JSON utterance/expected-action pairs; mock device state, then validate against a real `observedSlide` receipt.
- **Integration gate:** Mac on Wi-Fi, iPhone on cellular, manual slide change, verify a fresh frame arrives before adding agent commands.
