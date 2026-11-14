# Spectr — Tasks

See [requirements.md](requirements.md) and [design.md](design.md).

## Ownership changes from the build plan

Colby doesn't have a Mac, so he can't build or test Swift.

- **Jared** now owns all Swift work: the iPhone app **and** the Mac menu-bar helper.
- **Colby** moves to TypeScript and takes some of Poorav's and Sweeya's work so they have room to support Jared:
  - From Poorav: the LiveKit room-token endpoint, the `apple-app-site-association` file, the diagnostic trail, and the TypeScript mock Mac executor.
  - From Sweeya: browser and Keynote example-task utterances and their Vitest suite.
  - New: a mock Mac executor that returns fake screenshots and logs actions, so the step loop can be tested without a Mac.
  - New: Spectr's voice with the ElevenLabs API, using a British, JARVIS-like male voice.

| Owner | Build area | First handoff |
| --- | --- | --- |
| Jared | iPhone + Mac · Swift/SwiftUI | General Mac executor runs a task while the iPhone shows the authorized screen live. |
| Poorav | Backend · TypeScript | Claude step endpoint, task conversation persistence, and Sendblue result/confirmation messages. |
| Colby | Backend + agent support + voice · TypeScript | Mock Mac exercises the step loop; first verified result is spoken in the Spectr voice. |
| Sweeya | Agent · guardrails · brand | Claude system prompt, action validation and safety policy; logo goes to Jared. |

Because Jared now carries both native targets, Swift work is on the critical path. Unblock him first: fixtures, tokens and a working link come before anything else on the TypeScript side.

## Team stack

- **Jared:** Swift/SwiftUI, Xcode, AVFoundation + Speech, ScreenCaptureKit, CGEvent, NSWorkspace, Accessibility, LiveKit Swift SDK, URLSession/Codable, Keychain; optional Keynote AppleScript read-back.
- **Poorav:** Node.js/TypeScript, Vercel, Sendblue, Anthropic Messages API, Supabase Auth/Postgres, Zod, Vitest.
- **Colby:** Node.js/TypeScript, LiveKit Node server SDK, ElevenLabs API, fake-screenshot/action-log Mac executor, Zod, Vitest.
- **Sweeya:** TypeScript, Claude system prompts, action schemas and guardrails, Zod, Vitest, SVG/PNG brand assets.

## Feature owners

| # | Feature | Owners |
| --- | --- | --- |
| **P0** | | |
| 1 | Pair iPhone and Mac; only the owner can start a session or send a command | Poorav + Jared |
| 2 | Watch an authorized Mac display live over cellular and give a task from the iPhone (push-to-talk first) | Jared + Colby (tokens) |
| 3 | Run a multi-step task across apps or websites and verify the final screenshot | Jared + Sweeya |
| 4 | Start a task by iMessage and receive its verified result in the thread | Poorav + Jared |
| 5 | Correct or stop a running task; report a lost connection | All four |
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

1. **First integration:** one text task produces a task ID on Jared's iPhone screen.
2. **Second:** the iPhone shows the authorized Mac screen over LiveKit during a browser task and a Keynote example task.
3. **Third:** Claude's validated action batch changes the Mac, and the final screenshot verifies the result.
4. All four rehearse together before adding anything else.

**Demo gate:** three consecutive runs of different judge-chosen tasks, including a browser task and a Keynote example task, verified on both screens.

## Schedule

- **Friday:** freeze contracts, one task round trip, stream one real frame, test a browser task and a Keynote example task.
- **Saturday:** integrate the full path, corrections and Stop; test on venue Wi-Fi and cellular.
- **Sunday:** freeze scope, run failure cases, rehearse, log actual pass counts.

---

## Jared — iPhone and Mac (Swift)

Outcome: a judge starts any multi-step task from Messages or the iPhone app, watches the authorized Mac screen live, corrects or stops it, and sees a screenshot-verified result.

Do the Mac helper's capture and stream first. The second milestone and every live-frame check depend on it.

### Mac helper — first PR · publish a LiveKit screen-share track

- [ ] Create the SwiftUI `MenuBarExtra` target with Pair, Select window, Start sharing, Stop, and a sharing indicator.
- [ ] Store device credentials in Keychain; show permission recovery after denial.
- [ ] Capture the user-authorized display or window with ScreenCaptureKit and publish it as a screen-share track (pinned LiveKit Swift SDK).
- [ ] Make a manual browser change and a manual slide change in the Keynote example; verify fresh frames on the phone.

### iPhone — first PR · join a session

- [ ] Pin the same LiveKit Swift release as the Mac target.
- [ ] Add simulator fixtures for an expired link, an unpaired phone and a paired phone. Route a valid task link to its task screen.
- [ ] Fetch a viewer token, join the task room, render the screen-share track. Show Connecting until the first decoded frame and Stalled when frames stop.
- [ ] Verify browser and Keynote example task screens with the Mac on Wi-Fi and the iPhone on cellular.

### Mac helper — second PR · general executor

- [ ] Execute only schema-validated actions: screenshot, click/double-click/right-click, move, drag, scroll, type text, key/hotkey, wait, `openApp(name)` and `openUrl(url)`. Use CGEvent for input and NSWorkspace for opening apps and URLs.
- [ ] Capture and post the current screenshot plus recent action results after each batch. Run the browser and Keynote example tasks through the same executor.
- [ ] Require Screen Recording and Accessibility permissions. Capture only the display or window the user authorized.
- [ ] Keep Keynote AppleScript read-back as optional extra verification; never execute model-generated AppleScript.
- [ ] Deliver an older revision after a correction, then Stop during a batch. Neither may execute superseded actions.
- [ ] Handle denied permission, screen lock, disconnect, cancellation and stale commands. Disconnect the helper and confirm the stream is marked stale.
- [ ] Verify required permission prompts and signing/sandbox setup early.

### iPhone — second PR · steer the Mac

- [ ] Pair the iPhone; redeem a Watch live link only after authentication (Universal Links + Associated Domains; keep an in-app task opener for development).
- [ ] Build connecting, live, interrupted, stopped and reconnecting states from the shared fixtures.
- [ ] Push-to-talk (AVFoundation + Apple Speech), visible transcript and typed fallback. Send the final transcript once with `taskId` and expected revision; disable repeat sends while awaiting acknowledgement; keep the typed correction on network failure.
- [ ] Play Spectr's spoken replies from Colby's speech endpoint; Stop or a new instruction interrupts playback.
- [ ] Stop takes priority over pending actions. Tap Stop mid-task, reconnect, relaunch: show the last verified screenshot and cancelled state.
- [ ] Test touch targets, orientation and bad-network recovery on the real phone. Record a short on-device test for the team.

### Rehearsal

- [ ] Rehearse on the exact demo Mac and network. Separately record whether closed-lid capture keeps producing fresh frames (optional experiment, outside the baseline demo).

### Handoff and blockers

Needs: session token/link fixture from Poorav, room URL, publisher/viewer tokens and the speech endpoint from Colby, action fixtures and safety-policy examples from Sweeya. If mic permission fails, a typed correction keeps the same task. If capture stalls while the process still responds, report stream unavailable. Done when both screens show the screenshot-verified result of the judge's task.

---

## Poorav — Backend (TypeScript)

Outcome: one inbound iMessage creates one authorized multi-step task; the final summary and screenshot return to the original thread.

### First PR · freeze the task and step format

- [ ] Commit fixtures in `contracts/` for task creation, action batches, step results, correction, final result and error: `accepted`, `waitingForUser`, `succeeded`, `cancelled`, and a stale-revision error. Keep `observedSlide` as an optional Keynote example.
- [ ] Add unique constraints on provider message ID and command ID. Replay one inbound event twice and assert one task and one outbound reply.

### Second PR · implement the step endpoint and recovery

- [ ] Wire Sendblue inbound and outbound on a verified demo phone; verify webhook auth and bind the sender to the paired owner.
- [ ] Implement the Claude computer-use step endpoint with the Anthropic Messages API. `ANTHROPIC_API_KEY` is a Vercel environment variable and never reaches a device.
- [ ] Persist each task's conversation and current state in Supabase. For each short request, accept the current screenshot and recent action results, then return a validated action batch or `done` with a summary. Cap tasks at 60 steps; do not run a long-lived server process.
- [ ] Text the final summary and screenshot to the original iMessage thread. Send a text confirmation request and wait for "yes" before outward-facing or irreversible actions.
- [ ] Implement expiring pairing codes and viewer links, device revocation, and tenant-scoped RLS policies. Expire a watch link and prove a different owner cannot redeem it. Test revoke while the device is connected.
- [ ] Persist tasks, revisions and events; reject stale results. Persist the task before acknowledging the webhook.
- [ ] Restart between steps; resume from persisted conversation and a fresh screenshot without replaying an unverified action.

### Handoff and blockers

Give Jared a working link and authenticated step/result path for the Mac helper; give Sweeya the action boundary. If provider access is delayed, use a labeled local webhook fixture and keep the real-device gate open. Done when a duplicate request makes one task, the final screenshot verifies the result, and a second user can't open it.

---

## Colby — Backend and agent support (TypeScript)

Outcome: the voice path works, and the Claude step loop can be tested without a Mac using a TypeScript mock executor.

### From Poorav · LiveKit tokens and app links

- [ ] Room-token endpoint with the LiveKit Node server SDK. Verify task and paired-device ownership; issue short-lived tokens scoped to the task room. Mac: screen-share publish. iPhone: subscribe-only.
- [ ] Reject a second user's request for the room (Vitest).
- [ ] Serve `apple-app-site-association` over HTTPS for Jared's Universal Links.
- [ ] Task-ID-only diagnostic trail (no message content, no PII).

### From Sweeya · general task tests

- [ ] Label browser and Keynote tasks as JSON examples with expected safe action sequences, confirmations, corrections and outcomes.
- [ ] Run the task examples through the mocked Claude step endpoint with fake screenshots and action results.
- [ ] Vitest suite for browser navigation, Keynote example slide changes, correction, Stop, confirmation and failed or stuck runs.

### New · mock Mac device

- [ ] Small TypeScript executor that pairs as a device, accepts validated action batches, returns fake screenshots and logs actions. Support a wrong-result mode, correction/Stop and disconnect.
- [ ] Use it to run the duplicate-webhook, stale-revision and Stop cases before Jared's helper is ready.

### New · Spectr voice (ElevenLabs)

- [ ] Pick a British, JARVIS-like male voice (calm, crisp, slightly formal) from the ElevenLabs voice library. Play two or three candidates for the team and lock one. Pin its voice ID, model and voice settings in config.
- [ ] Add `ELEVENLABS_API_KEY` and `ELEVENLABS_VOICE_ID` to `.env.example` (names only). The key stays server-side.
- [ ] Speech endpoint in `services/api/src/voice/`: takes a reply on a task the caller owns and streams back ElevenLabs audio. Reject other owners' tasks.
- [ ] Only speak the agent's status/completion text after screenshot verification. A Keynote task may additionally use `observedSlide`. Don't store audio or transcripts by default.
- [ ] Fallback: if ElevenLabs errors or times out, return quickly so the iPhone shows the reply as text.
- [ ] Vitest with a mocked ElevenLabs client: ownership check, timeout fallback, and that the pinned voice ID is always used.
- [ ] Give Jared the endpoint, audio format and a sample clip for playback.

### Handoff and blockers

Agree on token and receipt payloads with Poorav and Jared. Give Jared room URLs and tokens as early as Friday; LiveKit tokens block the first live frame. Done when a second user's token request is rejected, the mock Mac passes the correction and Stop cases, and a reply plays on the iPhone in the Spectr voice.

---

## Sweeya — Agent, guardrails, brand (TypeScript)

Outcome: Spectr interprets general multi-step tasks, follows safety policy, asks when needed, and honors a correction without performing superseded actions.

### First PR · define the prompt, actions and guardrails

- [ ] Send Jared the Spectr logo and character: an SVG master and transparent PNG that read at small size on light and dark backgrounds. Time-box polish until the live workflow works.
- [ ] Write the Claude system prompt and define the allowed action schema with Zod in `services/api/src/agent/`; share the fixtures with Colby.
- [ ] Validate screenshot, click/double-click/right-click at `(x,y)`, move, drag, scroll, type, key/hotkey, wait, `openApp(name)` and `openUrl(url)` actions before execution. Reject shell commands and generated AppleScript.
- [ ] Require text confirmation for sending messages/DMs, posting, purchasing, submitting forms or deleting. Never type passwords or 2FA codes; pause for the user to log in.
- [ ] Enforce one active task per device. Stop and a new instruction cancel pending steps; a non-stop text during a running task is a correction.
- [ ] Test browser and Keynote example-task utterances, including ambiguous requests, confirmation, correction, stop and a final screenshot that does not show the requested state.

### Second PR · prove a correction wins and results are verified

- [ ] Correct a browser task and a Keynote example task before execution; assert pending old revisions are discarded. Repeat after execution and issue a new task step.
- [ ] Report success only when Claude's final check of the screenshot shows the target state. A Keynote task may additionally compare `observedSlide`; a mismatch is an actionable failure.
- [ ] Exercise duplicate speech/text answers, interruptions and failed execution.
- [ ] Give Jared short status strings, action fixtures and confirmation/password guardrail cases.

### Handoff and blockers

Agree on the Claude system prompt, action schema and server-side key with Poorav. Agree on tool and error payloads with Poorav and Jared. Done when browser and Keynote example tasks work, confirmations and login pauses are honored, and only the latest authorized steps execute.

---

## Kickoff decisions

- [ ] Pick one browser task, one Keynote example task, demo Mac (Jared's) and demo phone.
- [ ] Get a verified Sendblue tester on the free shared line.
- [ ] Test the LiveKit stream over cellular; if venue Wi-Fi blocks peer traffic, use the rehearsed hotspot.

## Backup: Chert (optional FaceTime stretch, after P0 works)

Chert is the backup for texting if Sendblue fails; FaceTime is an optional stretch. Trial onboarding stalled at phone verification on 2026-11-13; Chert webhook code is kept on branch `devin/1794623817-chert-inbound`.

- [ ] Use Chert for texting only if Sendblue fails and phone verification is completed.
- [ ] Spike: publish the Mac window as the agent's video track on a FaceTime call and check that the Keynote demo example's slide text is readable.
- [ ] Route the transcribed call instruction into the existing task API; reply with the ElevenLabs voice.
- [ ] Optional: FaceTime the user back when the agent needs a decision.
- [ ] Select "Best Use of FaceTime (Chert)" on Devpost and include a live FaceTime call in the demo.

## Blockers

Keep blockers on the owner's section, one line each: `blocked on ___ / need ___ from ___ / fallback ___`. Escalate at the next integration check. Blockers affecting the first live frame or first real action take precedence.
