# Native status ledger

The durable handoff between sessions. Update it at every phase boundary. No secrets or personal data.

Status values: **done** (verified as stated), **in progress**, **blocked**, **planned**, **deferred**.
Evidence tiers: *local* (this Mac, unit/sim), *live* (real backend), *hardware* (physical devices).

Last updated: 2026-11-13, Mac helper UI pass (popover, setup window, pairing client).

| Item | Owner | Status | Evidence | Blocker / dependency | Next concrete test |
| --- | --- | --- | --- | --- | --- |
| Native foundation and platform decisions | Jared | done | *local*: `make lint`, `make test-kit` (27 tests), iOS + Mac unit tests, Release builds of both apps (Xcode 26.5, iOS 26.5 sim, macOS 26.5) | CI not yet run on GitHub (macOS 26 runner availability unverified) | First CI run on a pushed branch |
| iPhone sign-in (Supabase + Sign in with Apple), session restore, sign-out | Jared | planned (Phase 2) | — | Paid Apple developer membership (Jared); Apple provider enabled in Supabase (Poorav) | Interrupted sign-in resumes; sign-out clears all user state |
| iPhone pairing, Watch live links, task routing, state restoration | Jared | planned (Phase 2) | Link parser unit-tested (*local*) | Pairing/link/device routes not in contract (Poorav); link domain + association file (Jared/Poorav) | Expired, reused and wrong-owner links rejected through the UI |
| Mac pairing, device credential, revocation | Jared | in progress | `PairingController` + `HTTPPairingClient` follow the proposed routes; credential in Keychain; unpair clears it and stops sharing. 2 tests against a scripted client (*local*). Never run against a server | Pairing routes (Poorav). Exchange response should also return the approving iPhone's name | Expired/reused code; revoke while connected stops sharing |
| Mac helper UI: menu bar popover + setup/recovery window | Jared | in progress | One `HelperState` value drives both surfaces. Popover: idle, sharing, task, Stop Task, Stop Sharing; menu bar glyph changes shape while sharing or when something is wrong. Setup window: pair → screen recording → control → window, step derived from real state. 31 Mac tests incl. correction/late-result, local Stop, and 26 rendered PNGs in light and dark (*local*). Real Debug build launched: setup window opens on first run, popover opens (*local*, misconfigured build only) | No source yet for iPhone presence, or for the instruction text on the Mac (see incompatibilities 7–8). Task section is fed only by the Debug Action Lab until the command loop exists | Physical-Mac checklist below |
| Local agent for the Debug Action Lab (stopgap, not the production planner) | Jared | in progress | `tools/dev-agent` (Node, loopback only, key from gitignored `.env.local`) returns one step per request from the Mac's action vocabulary using `claude-haiku-5-5`; Debug lab loops observe → ask → act with a 15-step cap. 3 Mac tests against a scripted agent; server answered 3 sample requests correctly, ~2,000 input / ~60 output tokens per step (*local*). Never run against a real app by a person | Text-only (Accessibility state, no screenshots). Duplicates part of Sweeya's planner; replace when hers speaks general actions | Lab → "Open Notes and write a note that says milk"; Stop Task mid-run; a correction mid-run |
| Mac capture permission, window selection, LiveKit publish | Jared | in progress | System picker (window or display), ScreenCaptureKit stream, menu preview, closed-window detection, static-vs-stalled health (`StreamHealth`, 4 tests). Builds and launches (*local*); picker flow not yet clicked through by a person | LiveKit Cloud project for publishing | Pick a Notes window, close it, menu says the window closed; leave it still 60 s, stays "no changes" not "stalled" |
| LiveKit first-frame hardware test on cellular | Jared | blocked | — | Room tokens + LiveKit project; physical iPhone connected | Mac on Wi-Fi, iPhone on cellular, type in Notes by hand, fresh frame on phone |
| General action execution with Accessibility readback | Jared | in progress | `ActionExecutor` + `AccessibilityDesktopDriver`: openApp, click, typeText, keyCombo, scroll, observe, stop; readback verdicts; blocklist (terminals, script tools, password managers); never types into password fields; ledger persisted before side effects. 17 Mac tests against a fake desktop (*local*). Not yet run against real Notes by a person | Generic actions not in backend contract (Poorav); step planner (Sweeya) | `typeText` into Notes; readback matches; duplicate and stale commands don't repeat |
| Typed correction, push-to-talk, Stop | Jared | planned (Phase 5) | — | Instruction route lacks `clientMessageId` (Poorav) | Final transcript sent once; Stop wins a race |
| Continuous hands-free call with spoken replies and interruption | Jared | planned (Phase 5) | — | Speech endpoint (Jared TS, ElevenLabs key server-side) | Barge-in stops playback; the app's own reply isn't transcribed |
| Room-token endpoint, association file, speech endpoint, mock Mac (TypeScript) | Jared (from Colby) | planned | — | Poorav's API package on `origin/devin/1794614215-wire-format` not merged to `main` | Second user's token request rejected |
| Live end-to-end Sendblue round trip | Poorav | blocked for native | — | Sendblue verified tester + deployed API | Text → Watch live → verified receipt in the same thread |
| Production backend, auth and contract for general control | Poorav | blocked for native | Frozen contract reviewed; native decodes its envelopes (*local*) | Contract is slide-specific: needs generic `action` types, `observed` state, `unverified` outcome, `clientMessageId`, pairing/device/link/token routes | Native fixtures replaced by `contracts/` and still pass |
| Agent step loop, clarifications, final brand assets | Sweeya | blocked for native | Mascot and icons imported into both asset catalogs | Planner must become observe → act → observe over the generic vocabulary | Correction mid-task produces only the new step |
| Incoming calls/callbacks to a locked iPhone | Jared + backend | deferred | — | Separate notification/calling design, entitlements, backend | Real-device ring while locked |
| Remote unlock / takeover of an awake locked Mac | Jared | deferred | — | Explicit auth design, macOS support validation, secure connectivity | Feasibility spike on cellular; never stores a Mac password |
| Closed-lid behavior | Jared | deferred (optional) | — | Specific hardware experiment | Record exact hardware and conditions if tested |
| Homework lookup, job applications, VM and hosted browser | Sweeya + Poorav | deferred | — | Outside this assignment | — |

## Contract incompatibilities to raise with Poorav

Reviewed against `origin/devin/1794614215-wire-format` (commit `6d33fbb`):

1. `Action` only has `openDemoDeck`, `goToSlide` and `stop`. Native needs `observe`, `openApp`, `click`, `typeText`, `keyCombo` and `scroll` (see [CONTRACT.md](CONTRACT.md)).
2. `observedSlide` / `lastObservedSlide` should become a general `observed` / `lastObserved` object.
3. `DeviceResult.outcome` needs `unverified` for actions whose result can't be read back.
4. `PostInstructionRequest` has no client idempotency key, so a retried POST after a timeout can create two revisions. Add `clientMessageId`.
5. There are no schemas for pairing, the device list/presence, watch-link redemption or room tokens.
6. Schemas are `.strict()`, so the server rejects any field the native side adds. Every addition has to be agreed first.
7. `Command` carries no instruction text, and the task routes are user-authenticated. The Mac popover needs the user's words for the current revision: add `instruction` to the command, or give the device a task read.
8. Nothing tells the Mac whether the paired iPhone is reachable, or its name. The popover shows "Connected" only with evidence, so today it shows neither.

## Mac helper: physical-Mac checklist

Rendered states and unit tests cover layout and logic. These need a person at a real Mac (Debug build, `apps/Config/Local.xcconfig` set):

1. First launch opens Spectr Setup. Close it halfway; reopen it from the gear menu in the popover, and by opening Spectr again from Finder.
2. Screen recording: click the button, grant in System Settings, return. The step checks itself off (or resumes at the same step after macOS's quit-and-reopen).
3. Accessibility: with a window already shared, turn Accessibility off. Popover says "Sharing, but can't control"; sharing continues.
4. Choose a window: the title in the popover matches the window; the menu bar glyph changes. Stop Sharing flips the glyph back at once.
5. Close the shared window: within ~2 s the popover says the window closed, offers Choose Window, and nothing else is captured.
6. Gear menu → Action Lab → "Open Notes and write this": popover shows the instruction and "Working…"; Stop Task (⌘.) halts typing; run it again mid-task and only the newer text continues.
7. Light and dark appearance over a busy wallpaper; Increase Contrast; Reduce Motion; VoiceOver reads headline, shared window and both stop buttons; Tab reaches every control.
8. With a real backend: pairing code approved from the iPhone checks off step 1; expired code offers a new one.
