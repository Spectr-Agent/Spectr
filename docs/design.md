# Spectr — Design

See [requirements.md](requirements.md) for scope and acceptance criteria and [tasks.md](tasks.md) for owners.

## Architecture

```
iMessage ──► Chert line ──► message.received webhook ──► TypeScript API (Vercel) ──► Agent planner ──► typed action
                                                            │    ▲                                       │
                                                            │    │ result / receipt                      ▼
                                                            │    └──────────────────────────── Mac helper (Swift) ──► Keynote
                                                            │                                            │ window track
                                                            │                                            ▼
FaceTime ──► Chert line ──► chert dev ──► LiveKit call room ◄──► Call agent (Node) ◄── subscribe ── LiveKit Mac room
             (bridge publishes caller audio,   agent publishes:  │  STT → task API                         ▲
              plays agent audio + video)       ElevenLabs voice  │  ElevenLabs TTS                         │ subscribe (fallback)
                                               + Mac window video                               iPhone app (SwiftUI)
                                     Supabase (Auth, Postgres, RLS) holds owners, devices, tasks, commands, events, results
```

- **Chert** runs the Apple line. Texts arrive as signed `message.received` webhooks; replies go out through Chert's API. FaceTime calls are bridged into a LiveKit room where Spectr's call agent is dispatched.
- The **API** authorizes users, stores task state in Supabase, issues LiveKit tokens, and replies in the original iMessage thread.
- The **agent planner** turns a request (texted, or transcribed from the call) into one schema-validated action.
- The **Mac helper** captures only the selected window, publishes it to the owner's LiveKit Mac room, runs Keynote actions, and reports the observed slide.
- The **call agent** answers FaceTime: it transcribes the caller, sends instructions through the task API, speaks replies in the Spectr voice, and republishes the Mac window as its own video track so the caller sees the Mac on FaceTime.
- The **iPhone app** is the fallback viewer: it subscribes to the same Mac room, with Stop and a typed correction.
- **LiveKit Cloud** carries all media. Video never goes through the HTTP API.

## Components

### Call agent — `services/call-agent/`

- LiveKit Agents (Node/TypeScript) worker registered with a fixed dispatch name, for example `spectr-agent`. Connected to FaceTime with `chert dev --agent spectr-agent`, using a pinned `@trychert/facetime` version.
- Both the worker and `chert dev` are long-running; run them on a laptop or a Coder workspace, not on Vercel.
- **Audio in:** subscribe to the bridge's `facetime-remote-audio` track and transcribe it in realtime with ElevenLabs Scribe.
- **Audio out:** ElevenLabs TTS with one pinned British, JARVIS-like male voice (calm, crisp, slightly formal). Scribe and voice use the same `ELEVENLABS_API_KEY` and share credits; monitor credit usage. `ELEVENLABS_VOICE_ID` is also an environment variable.
- **Video out:** Chert plays the video track published by the agent. The agent joins the owner's Mac room as a subscriber, reads the Mac window frames, and republishes them into the call room as its own video track. The Mac helper never joins the call room, so the agent stays the only audio publisher there (Chert's bridge selects the sole audio publisher).
- **Greeting:** speak within 10 seconds of the room metadata `chert_bridge_ready`, not on room join. Otherwise the call ends.
- **Instructions:** send final transcripts to the task API as instructions or stop, with `taskId` and `expectedRevision`, the same as a text. Speak only status/completion text derived from `observedSlide`.
- **Stalled view:** if Mac frames stop, publish a "view stalled" card instead of repeating the last frame, and say so.
- Interrupting Spectr mid-sentence (barge-in) stops playback; a new instruction supersedes the pending one.
- Calls are capped at 5 minutes on the trial. If a call drops, a new call reattaches to the owner's active task.

### Mac helper — `apps/mac/SpectrMac/`

- SwiftUI `MenuBarExtra` with Pair, Select window, Start sharing, Stop, and a sharing indicator.
- ScreenCaptureKit for selected-window frames, published through the pinned LiveKit Swift SDK to the owner's Mac room (`mac-<deviceId>`). The same track serves the call agent and the iPhone fallback.
- Keynote actions through its AppleScript interface (Apple Events): `openDemoDeck`, `goToSlide(n)`. Read back the current slide after every action.
- Permissions: Screen Recording for capture, Automation for Keynote. Accessibility only if UI scripting is actually required. Check signing/sandbox configuration early.
- Device credentials in Keychain. Show permission recovery after denial.
- If capture stalls while the process still responds, report the stream as unavailable.

### iPhone app (fallback) — `apps/ios/SpectrIOS/`

- SwiftUI, URLSession/Codable for task requests, Keychain for the session.
- An in-app task opener (Universal Links only if time allows).
- LiveKit Swift SDK (pinned) as a subscriber to the owner's Mac room.
- Stop and a typed correction through the task API. No voice in the app; voice lives on the FaceTime call.
- Screen states: connecting, live, stalled, interrupted, reconnecting, stopped.

### API — `services/api/src/`

- Node.js + TypeScript on Vercel. Zod for runtime validation.
- **Chert inbound:** `message.received` webhook. Verify the subscription signature over the raw body, normalize to `InboundMessage` (`providerMessageId` = Chert `event_id`, `fromNumber` = sender handle, text from the `text` parts), persist, then reply. If trial projects can't use webhooks, read Chert's event stream instead; everything after normalization stays the same.
- **Chert outbound:** replies through Chert's messaging API with an `Idempotency-Key` per send. A send whose state is `unknown` is read again, never resent with a new key.
- **Callbacks (P1):** `POST /api/v1/calls` with `mode: customer_managed`, our LiveKit room, a call-scoped bridge token and `remote_participant_identity`.
- Supabase Auth + Postgres with row-level security; migrations in `supabase/migrations/`.
- LiveKit Node server SDK for tokens: the Mac publishes to its Mac room; the call agent and iPhone subscribe. Tokens are short-lived and room-scoped.
- `CHERT_API_KEY`, the Chert project ID and the webhook secret are server environment variables.

### Agent planner — `services/api/src/agent/`

- The team's configured model SDK with structured output; Zod parses the allowed action types.
- A deterministic parser for supported actions is the offline/test fallback if model access fails. It must handle spoken phrasing ("uh, go to slide four").
- Relative requests ("next slide") resolve to an absolute target from observed slide state. If the current slide is unknown, request state before producing a command.
- Ask one short question when the target is unclear. Reject unsupported apps and out-of-range slides.
- Completion text is generated only from `observedSlide`, short enough to speak.

## Interface contracts

Poorav owns the shared JSON fixtures in `contracts/`. Jared decodes them in both Swift targets; the agent produces schema-validated actions; the call agent posts the same instruction requests as a text. **Freeze these before styling.**

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
| Chert inbound webhook | 2xx after the task is persisted |
| Create task | `taskId` |
| Current task for owner | The owner's active task (used when a call connects) |
| Post instruction or stop | New `revision` |
| Device claim | Next typed command |
| Device result | Receipt |
| Room token | LiveKit token scoped to the owner's Mac room (Mac: publish; call agent and iPhone: subscribe) |

Fixtures: create, command, event, correction, result, error; task examples for `accepted`, `waitingForUser`, `succeeded`, `cancelled`; a stale-revision error; an `observedSlide` receipt; a normalized inbound message.

## Data model (Supabase)

| Table | Purpose |
| --- | --- |
| owners | Signed-in users |
| devices | Paired Macs and iPhones, revocation state, last seen |
| messaging_identities | Chert phone handle bound to an owner via one-time pairing |
| tasks | Task state and current revision |
| commands | Command IDs (unique), revision, status |
| events | Ordered per-task event log (`seq`) |
| results | Mac receipts with `observedSlide` |
| decisions | Questions waiting for the user and their answers |

- Unique constraints on provider message ID (Chert `event_id`) and command ID.
- RLS: every row is tenant-scoped to its owner.

## Correctness rules

1. Persist the task before acknowledging the webhook.
2. Deduplicate webhook retries (provider message ID) and commands (`commandId`).
3. Reject results for stale revisions.
4. Stop and newer corrections supersede pending older actions, whether they arrive by text or on the call.
5. Only observed Mac state marks an action successful.
6. After a worker restart between claim and result, surface the last known state; never replay a relative slide advance.

## Security

- Verify Chert webhook signatures. Bind the sender handle to a paired owner.
- On a call, act only for the owner bound to the line for the demo; confirm what caller identity Chert exposes before relying on it.
- Check ownership on every task, device and room token request.
- Bridge tokens are per call, room-scoped, `exp - nbf ≤ 7200` seconds, with an identity distinct from the agent's. Never log them.
- Expiring pairing codes and room tokens; device revocation.
- Provider secrets (Chert, LiveKit, ElevenLabs Scribe/voice, model) in server environment variables; device credentials in Keychain.
- Capture only the user-selected window. No arbitrary shell, stored Mac passwords, screen recordings, call recordings or raw voice logs by default.

## Recovery states

| Condition | User sees or hears |
| --- | --- |
| Missing permission | A specific setup action |
| Mac disconnected | Last seen time and a retry offer |
| Mac locked (awake) | Needs user intervention for UI actions |
| Frames stopped | "View stalled" card on the call; Stalled in the iPhone app |
| Mac reports a different slide | Actionable failure, not success |
| Call dropped | Call again; Spectr reattaches to the active task |

## Repository layout

```
spectr/
  apps/mac/SpectrMac/            Menu-bar helper target
  apps/ios/SpectrIOS/            SwiftUI iPhone fallback target
  services/api/src/              TypeScript API package (Vercel)
    agent/plan.ts                Typed intent boundary
    chert/                       Webhook verification, normalization, replies
  services/call-agent/           LiveKit Agents worker for FaceTime (voice + Mac video)
  contracts/                     Shared fixtures
  supabase/migrations/
  docs/                          requirements, design, tasks
  AGENTS.md · README.md · .gitignore · .env.example
```

## Testing

- **Mac:** XCTest for revision handling; a real Mac for frames and slide readback.
- **Call agent:** a real FaceTime call from a verified phone: greeting within 10 seconds, readable slides, a spoken correction lands, and the call survives a Mac disconnect. Unit-test transcript → instruction mapping with Vitest.
- **API:** Vitest for webhook signature checks, replay and authorization, using a recorded `message.received` fixture; Supabase CLI for local migrations.
- **Agent:** Vitest with JSON utterance/expected-action pairs, including spoken phrasing; mock device state, then validate against a real `observedSlide` receipt.
- **iPhone fallback:** a physical iPhone for the stream and Stop.
- **Integration gate:** change a Keynote slide by hand and see it on a FaceTime call before adding agent commands.
