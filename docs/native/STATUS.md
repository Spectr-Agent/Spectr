# Native status ledger

The durable handoff between sessions. Update it at every phase boundary. No secrets or personal data.

Status values: **done** (verified as stated), **in progress**, **blocked**, **planned**, **deferred**.
Evidence tiers: *local* (this Mac, unit/sim), *live* (real backend), *hardware* (physical devices).

Last updated: 2026-11-13, end of Phase 1.

| Item | Owner | Status | Evidence | Blocker / dependency | Next concrete test |
| --- | --- | --- | --- | --- | --- |
| Native foundation and platform decisions | Jared | done | *local*: `make lint`, `make test-kit` (27 tests), iOS + Mac unit tests, Release builds of both apps (Xcode 26.5, iOS 26.5 sim, macOS 26.5) | CI not yet run on GitHub (macOS 26 runner availability unverified) | First CI run on a pushed branch |
| iPhone sign-in (Supabase + Sign in with Apple), session restore, sign-out | Jared | planned (Phase 2) | — | Paid Apple developer membership (Jared); Apple provider enabled in Supabase (Poorav) | Interrupted sign-in resumes; sign-out clears all user state |
| iPhone pairing, Watch live links, task routing, state restoration | Jared | planned (Phase 2) | Link parser unit-tested (*local*) | Pairing/link/device routes not in contract (Poorav); link domain + association file (Jared/Poorav) | Expired, reused and wrong-owner links rejected through the UI |
| Mac pairing, device credential, revocation | Jared | planned (Phase 2) | — | Pairing routes (Poorav) | Expired/reused code; revoke while connected stops sharing |
| Mac capture permission, window selection, LiveKit publish | Jared | planned (Phase 3) | Menu reads permission state without prompting (*local*) | Room tokens (Jared TS) and LiveKit Cloud project | Picked window publishes; closing it reports `windowGone` |
| LiveKit first-frame hardware test on cellular | Jared | blocked | — | Room tokens + LiveKit project; physical iPhone connected | Mac on Wi-Fi, iPhone on cellular, type in Notes by hand, fresh frame on phone |
| General action execution with Accessibility readback | Jared | planned (Phase 4) | Ledger + validator unit-tested (*local*) | Generic actions not in backend contract (Poorav); step planner (Sweeya) | `typeText` into Notes; readback matches; duplicate and stale commands don't repeat |
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
