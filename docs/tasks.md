# Spectr — Tasks

See [requirements.md](requirements.md) and [design.md](design.md).

## Ownership

Colby doesn't have a Mac, so he can't build or test Swift. Chert is now the main channel: texts arrive through a Chert line, and FaceTime is the main way to talk to and watch the Mac. The iPhone app becomes a fallback.

- **Jared** owns all Swift work. The Mac helper comes first. The iPhone app shrinks to a fallback viewer with Stop and a typed correction; voice moved to the FaceTime call.
- **Colby** owns the FaceTime call agent (TypeScript): LiveKit Agents worker, speech-to-text, the ElevenLabs Spectr voice, and the Mac window as the call's video. He also keeps the LiveKit token endpoint.
- **Poorav** owns the backend and Chert: account and line, the `message.received` webhook, replies, Supabase, the task API, and the mock Mac.
- **Sweeya** owns the agent planner, guardrails and brand, and takes back the parser and utterance tests, now including spoken phrasing.

| Owner | Build area | First handoff |
| --- | --- | --- |
| Jared | Mac helper + fallback iPhone app · Swift/SwiftUI | Selected Keynote window publishes to the Mac room. |
| Poorav | Backend + Chert · TypeScript | One text to the Chert line creates one task and one reply. |
| Colby | Call agent + voice · TypeScript | A FaceTime call is answered in the Spectr voice and shows the Mac window. |
| Sweeya | Agent · guardrails · brand | A spoken correction selects the new target; logo goes to Jared. |

Critical path: Jared's Mac stream and Colby's call agent. Unblock them first: fixtures, tokens and the Chert line come before anything else.

## Team stack

- **Jared:** Swift/SwiftUI, Xcode, ScreenCaptureKit, LiveKit Swift SDK, URLSession/Codable, Keychain, Keynote AppleScript automation.
- **Poorav:** Node.js/TypeScript, Vercel, Chert messaging and calls API, Supabase Auth/Postgres, Zod, Vitest.
- **Colby:** Node.js/TypeScript, LiveKit Agents (Node) and server SDK, Chert CLI (`chert dev`), speech-to-text, ElevenLabs. Can work in a Coder workspace.
- **Sweeya:** TypeScript, structured model outputs, Zod, Vitest, SVG/PNG brand assets.

## Feature owners

| # | Feature | Owners |
| --- | --- | --- |
| **P0** | | |
| 1 | Pair the Mac and bind the owner's phone | Poorav + Jared |
| 2 | FaceTime Spectr and see the Mac's screen | Colby + Jared |
| 3 | Make the Mac do real work: "go to slide five", read back, report | Jared + Sweeya |
| 4 | Start by iMessage through Chert, get the verified result in the thread | Poorav |
| 5 | Change your mind or stop, by voice or text; report a lost connection | All four |
| **Fallback** | | |
| 6 | iPhone app watches the Mac room, with Stop and a typed correction | Jared + Colby (tokens) |
| **P1** | | |
| 7 | Natural conversation with interruption in the Spectr voice | Colby + Sweeya |
| 8 | Call back for a decision over FaceTime | Poorav + Colby |
| 9 | Take over an awake, locked Mac (validate first) | Jared + Poorav |
| **P2** | | |
| 10 | Check a homework deadline | Sweeya + Colby |
| 11 | Prepare a job application | Sweeya + Poorav |
| **Last** | | |
| 12 | Hosted execution / cloud browser | Poorav + Colby |

## Milestones

1. **First integration:** a text to the Chert line creates a task and gets a reply.
2. **Second:** a FaceTime call to the line shows the Mac's actual Keynote window.
3. **Third:** a spoken "slide four" changes the Mac, and Spectr reads back the verified slide.
4. All four rehearse together before adding anything else.

**Demo gate:** three consecutive runs where the judge picks the slide on a real FaceTime call and verifies it.

## Schedule

- **Friday:** freeze contracts, Chert line + one text round trip, stream one real frame to the Mac room, answer one FaceTime call.
- **Saturday:** Mac window on the call, spoken correction and Stop, fallback app; test on venue Wi-Fi and cellular.
- **Sunday:** freeze scope, run failure cases, rehearse, log actual pass counts. Make sure the Chert trial is still active for judging.

---

## Jared — Mac helper and fallback iPhone app (Swift)

Outcome: an awake, paired Mac shares the selected window and proves each command changed it; the iPhone app can take over watching if FaceTime fails.

### Mac helper — first PR · publish the window

- [ ] Create the SwiftUI `MenuBarExtra` target with Pair, Select window, Start sharing, Stop, and a sharing indicator.
- [ ] Store device credentials in Keychain; show permission recovery after denial.
- [ ] Capture the selected Keynote window with ScreenCaptureKit and publish it to the Mac room (`mac-<deviceId>`) with the pinned LiveKit Swift SDK, using Colby's token.
- [ ] Change slides by hand and confirm Colby's agent (or the LiveKit sandbox viewer) sees fresh frames. Keep frames large enough for slide text to stay readable after FaceTime compression.

### Mac helper — second PR · execute and verify

- [ ] Implement `openDemoDeck` and absolute `goToSlide(n)` through Keynote's AppleScript interface. Reject out-of-range values; read back the observed slide.
- [ ] Replay a command ID, then deliver an older revision after a newer correction. Neither changes the slide again.
- [ ] Handle denied permission, screen lock, disconnect, cancellation and stale commands. Disconnect the helper and confirm the stream is marked stale.
- [ ] Verify the Automation permission and signing/sandbox setup early. Add Accessibility only if needed.

### iPhone — fallback viewer

- [ ] Pin the same LiveKit Swift release as the Mac target.
- [ ] In-app task opener (Universal Links only if time allows). Fetch a subscribe token and render the Mac room's track. Connecting until the first decoded frame; Stalled when frames stop.
- [ ] Stop and a typed correction with `taskId` and expected revision; Stop takes priority over pending actions.
- [ ] Verify a manual slide change with the Mac on Wi-Fi and the iPhone on cellular.

### Rehearsal

- [ ] Rehearse on the exact demo Mac and network. Separately record whether closed-lid capture keeps producing fresh frames (optional experiment, outside the baseline demo).

### Handoff and blockers

Needs: Mac room token from Colby, claim/result path and fixtures from Poorav, action fixtures and the logo from Sweeya. If capture stalls while the process still responds, report stream unavailable. Done when the judge's chosen slide is on the Mac and on the call.

---

## Poorav — Backend and Chert (TypeScript)

Outcome: one inbound iMessage creates one authorized task and one result, even after a retry, and the call agent can drive the same task.

### First PR · freeze the wire format (done)

- [x] Fixtures in `contracts/`, strict Zod schemas, unique provider message ID and command ID, replay test.

### Second PR · Chert line and messaging

- [ ] Start the Chert trial at a time that still covers judging (48 hours from activation). Verify the demo phones. Create the project API key and webhook secret; keep them in server env vars only.
- [ ] Rename the `messaging_identities.provider` default from `sendblue` to `chert` in a new migration.
- [ ] `message.received` webhook: verify the signature over the raw body, map `event_id` → `providerMessageId` and the sender handle → `fromNumber`, then reuse `handleInboundMessage`. Use a recorded webhook fixture in Vitest. If trial projects can't use webhooks, read Chert's event stream instead.
- [ ] Replies through Chert's API with an `Idempotency-Key`: "Spectr is on it. FaceTime this number to watch." and the verified result. Never resend an `unknown` send with a new key.

### Third PR · isolation and recovery

- [ ] Expiring pairing codes, device revocation and tenant-scoped RLS policies. Prove a different owner can't read or drive the task.
- [ ] "Current task for owner" endpoint for the call agent; persist tasks, revisions and events; reject stale results.
- [ ] Mock Mac (moved from Colby): a small script that claims commands and posts receipts with a fake `observedSlide`, with "wrong slide" and disconnect modes. Use it for the duplicate, stale-revision and Stop cases before Jared's helper is ready.
- [ ] Task-ID-only diagnostic trail (no message content, no PII).
- [ ] Restart the worker between claim and result; surface the last known state without replaying a relative slide advance.

### P1 · call back for a decision

- [ ] Outbound FaceTime with `POST /api/v1/calls` (`customer_managed`, our room, a per-call bridge token). Wait for `bridge_ready` before speaking.

### Handoff and blockers

Give Colby the task API and the current-task endpoint, Jared the claim/result path, and Sweeya the action boundary. Done when a duplicate text makes one action and a second user can't drive it.

---

## Colby — FaceTime call agent and voice (TypeScript)

Outcome: a judge FaceTimes Spectr, hears the Spectr voice, sees the Mac window, and changes the slide by speaking.

### LiveKit tokens (kept)

- [ ] Token endpoint with the LiveKit Node server SDK: Mac gets publish on its Mac room; the call agent and iPhone get subscribe-only. Verify ownership; short-lived, room-scoped.
- [ ] Reject a second user's token request (Vitest).

### Call agent — first PR · answer FaceTime

- [ ] `services/call-agent/`: LiveKit Agents (Node) worker with dispatch name `spectr-agent`, from `chert new --video` as a starting point.
- [ ] Connect it with `chert dev --agent spectr-agent` (pinned CLI version). Both processes stay running; use a laptop or Coder workspace.
- [ ] Greet within 10 seconds of `chert_bridge_ready` room metadata, not on room join.
- [ ] Spike first: publish the Mac room's window frames as the agent's video track and check on a real call that slide text is readable. Report the result to the team early Saturday; if unreadable, the iPhone fallback becomes the viewer.

### Call agent — second PR · talk to the Mac

- [ ] Transcribe `facetime-remote-audio` with the chosen speech-to-text provider. Post final transcripts to the task API as instruction or stop, with `taskId` and `expectedRevision`.
- [ ] Spectr voice: pick a British, JARVIS-like male voice (calm, crisp, slightly formal) from the ElevenLabs library, play two or three for the team, lock one, and pin its voice ID, model and settings. `ELEVENLABS_API_KEY` and `ELEVENLABS_VOICE_ID` in `.env.example` (names only).
- [ ] Speak only status/completion text derived from `observedSlide`. If ElevenLabs fails, fall back to a stock voice so the call never goes silent.
- [ ] Barge-in: the judge's speech stops playback; a new instruction supersedes the pending one.
- [ ] Show a "view stalled" card and say so when Mac frames stop. If the call drops, the next call reattaches to the active task.
- [ ] No call recordings or transcripts stored by default.

### Handoff and blockers

Needs: Mac room publishing from Jared, task API and current-task endpoint from Poorav, short spoken status strings from Sweeya, and the speech-to-text provider decision. Done when a real FaceTime call shows the Mac and a spoken correction lands.

---

## Sweeya — Agent, guardrails, brand (TypeScript)

Outcome: Spectr interprets a natural request, spoken or texted, asks when uncertain, and honors a correction without performing the previous action twice.

### First PR · define the action vocabulary

- [ ] Send Jared the Spectr logo and character: an SVG master and transparent PNG that read at small size on light and dark backgrounds. Time-box polish until the live workflow works.
- [ ] Define typed actions with Zod in `services/api/src/agent/`, matching the frozen fixtures.
- [ ] Map "next" to an absolute target using observed slide state. If the current slide is unknown, request state before producing a command.
- [ ] Validate slide bounds, target device, revision and permissions. Ask one short question when the target is unclear. Refuse requests outside the authorized demo app.

### Parser and utterance tests (back from Colby)

- [ ] Label at least eight utterances as JSON pairs: open, absolute slide, relative advance, correction, ambiguous target, out-of-range slide, stop, unsupported app. Include spoken phrasing with fillers and mis-transcriptions ("go to slide for").
- [ ] Deterministic parser for the supported actions (offline fallback if model access fails).
- [ ] Vitest running the pairs against both the parser and the model planner with mocked device state.

### Second PR · prove a correction wins

- [ ] Feed "slide three" then "actually five" before execution; assert the pending old revision is discarded. Repeat after execution and issue a new command.
- [ ] Generate completion text only from `observedSlide`, short enough to speak. If the Mac reports slide three after requesting five, return an actionable failure.
- [ ] Exercise duplicate answers, interruptions and failed execution.
- [ ] Give Colby short spoken status strings and Jared the same strings for the fallback app.

### Handoff and blockers

Coordinate the model provider and server-side key with Poorav, and the speech-to-text provider with Colby. Done when the judge can change their mind mid-call and only the final authorized action wins.

---

## Kickoff decisions

- [ ] Pick the sample deck, demo Mac (Jared's) and demo phone.
- [ ] Decide when to start the Chert trial so the 48 hours cover judging; verify the demo phones.
- [ ] Pick the model provider and the speech-to-text provider.
- [ ] Test the LiveKit stream over cellular; if venue Wi-Fi blocks peer traffic, use the rehearsed hotspot.
- [ ] Select "Best Use of FaceTime (Chert)" on Devpost; the demo must include a live FaceTime call.

## Blockers

Keep blockers on the owner's section, one line each: `blocked on ___ / need ___ from ___ / fallback ___`. Escalate at the next integration check. Blockers affecting the first live frame or first real action take precedence.
