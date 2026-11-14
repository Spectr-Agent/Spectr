# Spectr — Tasks

See [requirements.md](requirements.md) and [design.md](design.md).

## Ownership changes from the build plan

Colby doesn't have a Mac, so he can't build or test Swift.

- **Jared** now owns all Swift work: the iPhone app **and** the Mac menu-bar helper.
- **Colby** moves to TypeScript and takes some of Poorav's and Sweeya's work so they have room to support Jared:
  - From Poorav: the LiveKit room-token endpoint, the `apple-app-site-association` file, and the diagnostic trail.
  - From Sweeya: the labeled utterance set, the deterministic fallback parser, and its Vitest suite.
  - New: a TypeScript mock Mac device, so the API and agent can be tested end to end without a Mac.
  - New: Spectr's voice with the ElevenLabs API, using a British, JARVIS-like male voice.

| Owner | Build area | First handoff |
| --- | --- | --- |
| Jared | iPhone + Mac · Swift/SwiftUI | Selected Keynote window streams to the Watch live screen. |
| Poorav | Backend · TypeScript | One message creates one authenticated task. |
| Colby | Backend + agent support + voice · TypeScript | Room token issued for a task; mock Mac returns a receipt; first reply spoken in the Spectr voice. |
| Sweeya | Agent · guardrails · brand | A correction selects the new target; logo goes to Jared. |

Because Jared now carries both native targets, Swift work is on the critical path. Unblock him first: fixtures, tokens and a working link come before anything else on the TypeScript side.

## Team stack

- **Jared:** Swift/SwiftUI, Xcode, AVFoundation + Speech, ScreenCaptureKit, LiveKit Swift SDK (publisher and receiver), URLSession/Codable, Keychain, Keynote AppleScript automation.
- **Poorav:** Node.js/TypeScript, Vercel, Sendblue, Supabase Auth/Postgres, Zod, Vitest.
- **Colby:** Node.js/TypeScript, LiveKit Node server SDK, ElevenLabs API, Zod, Vitest.
- **Sweeya:** TypeScript, structured model outputs, Zod, Vitest, SVG/PNG brand assets.

## Feature owners

| # | Feature | Owners |
| --- | --- | --- |
| **P0** | | |
| 1 | Pair iPhone and Mac; only the owner can start a session or send a command | Poorav + Jared |
| 2 | Call your Mac and see its screen over cellular (push-to-talk first) | Jared + Colby (tokens) |
| 3 | Make the Mac do real work: "go to slide five", read back, report | Jared + Sweeya |
| 4 | Start the same task by iMessage, get the verified result in the thread | Poorav + Jared |
| 5 | Change your mind or stop; report a lost connection | All four |
| **P1** | | |
| 6 | Continuous voice with interruption (ElevenLabs voice) | Jared + Sweeya + Colby |
| 7 | Call back for a decision | Poorav + Jared |
| 8 | Take over an awake, locked Mac (validate first) | Jared + Poorav |
| **P2** | | |
| 9 | Check a homework deadline | Sweeya + Colby |
| 10 | Prepare a job application | Sweeya + Poorav |
| **Last** | | |
| 11 | Hosted execution / cloud browser | Poorav + Colby |

## Milestones

1. **First integration:** one text produces a task ID on Jared's iPhone screen.
2. **Second:** the iPhone shows the Mac's actual Keynote window over LiveKit.
3. **Third:** Sweeya's command changes the Mac, and the backend returns a verified receipt.
4. All four rehearse together before adding anything else.

**Demo gate:** three consecutive runs where the judge picks the slide and verifies it on both screens.

## Schedule

- **Friday:** freeze contracts, one message round trip, stream one real frame, move one slide.
- **Saturday:** integrate the full path, voice correction and Stop; test on venue Wi-Fi and cellular.
- **Sunday:** freeze scope, run failure cases, rehearse, log actual pass counts.

---

## Jared — iPhone and Mac (Swift)

Outcome: a judge goes from Messages to a live Mac window, speaks a correction, and stops the session from one SwiftUI screen; an awake, paired Mac shares the selected window and proves the command changed it.

Do the Mac helper's capture and stream first. The second milestone and every live-frame check depend on it.

### Mac helper — first PR · publish a LiveKit screen-share track

- [ ] Create the SwiftUI `MenuBarExtra` target with Pair, Select window, Start sharing, Stop, and a sharing indicator.
- [ ] Store device credentials in Keychain; show permission recovery after denial.
- [ ] Capture the selected Keynote window with ScreenCaptureKit and publish it as a screen-share track (pinned LiveKit Swift SDK).
- [ ] Open slide one, change to slide two locally, and verify the frame changes on the phone.

### iPhone — first PR · join a session

- [ ] Pin the same LiveKit Swift release as the Mac target.
- [ ] Add simulator fixtures for an expired link, an unpaired phone and a paired phone. Route a valid task link to a single task screen.
- [ ] Fetch a viewer token, join the task room, render the screen-share track. Show Connecting until the first decoded frame and Stalled when frames stop.
- [ ] Verify a manual slide change with the Mac on Wi-Fi and the iPhone on cellular.

### Mac helper — second PR · execute and verify

- [ ] Implement `openDemoDeck` and absolute `goToSlide(n)` through Keynote's AppleScript interface. Reject out-of-range values; read back the observed slide.
- [ ] Replay a command ID, then deliver an older revision after a newer correction. Neither changes the slide again.
- [ ] Handle denied permission, screen lock, disconnect, cancellation and stale commands. Disconnect the helper and confirm the stream is marked stale.
- [ ] Verify the Automation permission and signing/sandbox setup early. Add Accessibility only if needed.

### iPhone — second PR · steer the Mac

- [ ] Pair the iPhone; redeem a Watch live link only after authentication (Universal Links + Associated Domains; keep an in-app task opener for development).
- [ ] Build connecting, live, interrupted, stopped and reconnecting states from the shared fixtures.
- [ ] Push-to-talk (AVFoundation + Apple Speech), visible transcript and typed fallback. Send the final transcript once with `taskId` and expected revision; disable repeat sends while awaiting acknowledgement; keep the typed correction on network failure.
- [ ] Play Spectr's spoken replies from Colby's speech endpoint; Stop or a new instruction interrupts playback.
- [ ] Stop takes priority over pending actions. Tap Stop mid-action, reconnect, relaunch: show the last verified slide and the cancelled state.
- [ ] Test touch targets, orientation and bad-network recovery on the real phone. Record a short on-device test for the team.

### Rehearsal

- [ ] Rehearse on the exact demo Mac and network. Separately record whether closed-lid capture keeps producing fresh frames (optional experiment, outside the baseline demo).

### Handoff and blockers

Needs: session token/link fixture from Poorav, room URL, publisher/viewer tokens and the speech endpoint from Colby, action fixtures, transcript examples and the logo from Sweeya. If mic permission fails, a typed correction keeps the same task. If capture stalls while the process still responds, report stream unavailable. Done when both screens show the judge's chosen slide.

---

## Poorav — Backend (TypeScript)

Outcome: one inbound iMessage creates one authorized task and one result, even after a retry.

### First PR · freeze the wire format

- [ ] Commit fixtures in `contracts/` for create, command, event, correction, result and error: `accepted`, `waitingForUser`, `succeeded`, `cancelled`, a stale-revision error, and an `observedSlide` receipt.
- [ ] Add unique constraints on provider message ID and command ID. Replay one inbound event twice and assert one task and one outbound reply.

### Second PR · prove isolation and recovery

- [ ] Wire Sendblue inbound and outbound on a verified demo phone; verify webhook auth and bind the sender to the paired owner.
- [ ] Implement expiring pairing codes and viewer links, device revocation, and tenant-scoped RLS policies. Expire a watch link and prove a different owner cannot redeem it. Test revoke while the device is connected.
- [ ] Persist tasks, revisions and events; reject stale results. Persist the task before acknowledging the webhook.
- [ ] Restart the worker between claim and result; surface the last known state without replaying a relative slide advance.

### Handoff and blockers

Give Jared a working link and an authenticated claim/result path for the Mac helper; give Sweeya the action boundary. If provider access is delayed, use a labeled local webhook fixture and keep the real-device gate open. Done when a duplicate request makes one action and a second user can't open it.

---

## Colby — Backend and agent support (TypeScript)

Outcome: the live session is authorized end to end, and the API and agent can be tested without a Mac.

### From Poorav · LiveKit tokens and app links

- [ ] Room-token endpoint with the LiveKit Node server SDK. Verify task and paired-device ownership; issue short-lived tokens scoped to the task room. Mac: screen-share publish. iPhone: subscribe-only.
- [ ] Reject a second user's request for the room (Vitest).
- [ ] Serve `apple-app-site-association` over HTTPS for Jared's Universal Links.
- [ ] Task-ID-only diagnostic trail (no message content, no PII).

### From Sweeya · deterministic parser and utterance tests

- [ ] Label at least eight utterances as JSON pairs: open, absolute slide, relative advance, correction, ambiguous target, out-of-range slide, stop, unsupported app.
- [ ] Deterministic parser for the supported actions (offline fallback if model access fails), validated with Sweeya's Zod schemas.
- [ ] Vitest suite running the utterance pairs against both the parser and the model planner with mocked device state.

### New · mock Mac device

- [ ] Small TypeScript script that pairs as a device, claims commands, and posts receipts with a fake `observedSlide`. Support a "wrong slide" mode and a disconnect mode.
- [ ] Use it to run the duplicate-webhook, stale-revision and Stop cases before Jared's helper is ready.

### New · Spectr voice (ElevenLabs)

- [ ] Pick a British, JARVIS-like male voice (calm, crisp, slightly formal) from the ElevenLabs voice library. Play two or three candidates for the team and lock one. Pin its voice ID, model and voice settings in config.
- [ ] Add `ELEVENLABS_API_KEY` and `ELEVENLABS_VOICE_ID` to `.env.example` (names only). The key stays server-side.
- [ ] Speech endpoint in `services/api/src/voice/`: takes a reply on a task the caller owns and streams back ElevenLabs audio. Reject other owners' tasks.
- [ ] Only speak the agent's status/completion text (already derived from `observedSlide`). Don't store audio or transcripts by default.
- [ ] Fallback: if ElevenLabs errors or times out, return quickly so the iPhone shows the reply as text.
- [ ] Vitest with a mocked ElevenLabs client: ownership check, timeout fallback, and that the pinned voice ID is always used.
- [ ] Give Jared the endpoint, audio format and a sample clip for playback.

### Handoff and blockers

Agree on token and receipt payloads with Poorav and Jared. Give Jared room URLs and tokens as early as Friday; LiveKit tokens block the first live frame. Done when a second user's token request is rejected, the mock Mac passes the correction and Stop cases, and a reply plays on the iPhone in the Spectr voice.

---

## Sweeya — Agent, guardrails, brand (TypeScript)

Outcome: Spectr interprets a natural request, asks when uncertain, and honors a correction without performing the previous action twice.

### First PR · define the action vocabulary

- [ ] Send Jared the Spectr logo and character: an SVG master and transparent PNG that read at small size on light and dark backgrounds. Time-box polish until the live workflow works.
- [ ] Define typed actions with Zod in `services/api/src/agent/` and share them with Colby for the parser.
- [ ] Map "next" to an absolute target using observed slide state. If the current slide is unknown, request state before producing a command.
- [ ] Validate slide bounds, target device, revision and permissions. Ask one short question when the target is unclear. Refuse requests outside the authorized demo app.

### Second PR · prove a correction wins

- [ ] Feed "slide three" then "actually five" before execution; assert the pending old revision is discarded. Repeat after execution and issue a new command.
- [ ] Generate completion text only from `observedSlide`. If the Mac reports slide three after requesting five, return an actionable failure.
- [ ] Exercise duplicate speech/text answers, interruptions and failed execution.
- [ ] Give Jared short status strings and fixtures.

### Handoff and blockers

Coordinate the model provider and server-side key with Poorav. Agree on tool and error payloads with Poorav and Jared. Done when the judge can change their mind mid-task and only the final authorized action wins.

---

## Kickoff decisions

- [ ] Pick the sample deck, demo Mac (Jared's) and demo phone.
- [ ] Get a verified Sendblue tester on the free shared line.
- [ ] Test the LiveKit stream over cellular; if venue Wi-Fi blocks peer traffic, use the rehearsed hotspot.

## Backup: Chert (optional FaceTime stretch, after P0 works)

Chert is the backup for texting if Sendblue fails; FaceTime is an optional stretch. Trial onboarding stalled at phone verification on 2026-11-13; Chert webhook code is kept on branch `devin/1794623817-chert-inbound`.

- [ ] Use Chert for texting only if Sendblue fails and phone verification is completed.
- [ ] Spike: publish the Mac window as the agent's video track on a FaceTime call and check that slide text is readable.
- [ ] Route the transcribed call instruction into the existing task API; reply with the ElevenLabs voice.
- [ ] Optional: FaceTime the user back when the agent needs a decision.
- [ ] Select "Best Use of FaceTime (Chert)" on Devpost and include a live FaceTime call in the demo.

## Blockers

Keep blockers on the owner's section, one line each: `blocked on ___ / need ___ from ___ / fallback ___`. Escalate at the next integration check. Blockers affecting the first live frame or first real action take precedence.
