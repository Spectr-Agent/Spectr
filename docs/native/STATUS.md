# Native status ledger

The durable handoff between sessions. Update it at every phase boundary. No secrets or personal data.

Status values: **done** (verified as stated), **in progress**, **blocked**, **planned**, **deferred**.
Evidence tiers: *local* (this Mac, unit/sim), *live* (real backend), *hardware* (physical devices).

Last updated: 2026-11-14, iPhone app: Mac card, live screen, hands-free calls, approvals, setup (pairing codes, phone linking). Production: Vercel API on the `spectr` database, call agent on LiveKit Cloud.

| Item | Owner | Status | Evidence | Blocker / dependency | Next concrete test |
| --- | --- | --- | --- | --- | --- |
| Native foundation and platform decisions | Jared | done | *local*: lint, shared package, iOS and Mac tests, Release check (Xcode 26.5, iOS 26.5 sim, macOS 26.5) | First GitHub CI run in progress on PR #9 | CI green on PR #9 |
| iPhone sign-in (Supabase email code or link) | Jared | done | *live*: Jared signed in on the Simulator against the real project; *local*: `AuthModelTests`, `SupabaseAuthClientTests`, real-Keychain test | Hardening list in [AUTH.md](AUTH.md) (verified mail domain, Sign in with Apple, revocation, CAPTCHA) | Sign in on a physical iPhone |
| iPhone app: home, Mac card, tasks, Stop, approvals | Jared | done (*live* API, *sim* UI) | `/api/app/*` verified end to end in production with a temporary account (pair, message, duplicate, correction, stop, phone link, cleanup). The simulator shows the real account's Mac and history. `AppModelTests`, `routes.test.ts` | Physical iPhone run | Run on the iPhone: start a task, approve, Stop |
| Mac pairing by code | Jared | done (*live*) | The Mac shows a code (`/api/mac/pair`), the iPhone approves it, the Mac collects its token once (`/api/mac/pair-status`). Token paste remains as a fallback. `PairingControllerTests` | — | Pair a second Mac from the iPhone |
| Mac agent loop (`/api/mac/task`, `/api/mac/step`) | Jared | done (*local*), live blocked | `MacAgentLoop`, `EventActionPerformer`, `MacActionPolicy`, `StepLedger`. Decodes the canonical `contracts/mac-*.json` directly. Tests: batches run once across retries and restarts, invalid and refused actions reported, stale step refetches, Mac-side stop scoped to one revision, nothing shared means no screenshot | A running API with `POSTGRES_URL`, `ANTHROPIC_API_KEY`, `SPECTR_LINK_SECRET`, Sendblue keys; the deployed origin | Text "open Notes and write milk"; watch the Mac do it; Sendblue reply arrives |
| Mac helper UI: menu bar popover + setup window | Jared | in progress | One `HelperState` drives both surfaces; shows agent problems (not sharing, server unreachable, token rejected) | Physical-Mac checklist below | Run the checklist |
| Debug action lab + `tools/dev-agent` | Jared | Debug only | Local planner over the older Accessibility-element actions; not used by the real loop | — | Remove once the real loop is verified live |
| Mac capture permission, window selection | Jared | in progress | System picker (window or display), stream, preview, closed-window detection; agent screenshots use exactly the picked content | — | Pick a Notes window, close it, popover says it closed |
| Phone calls (LiveKit number +1 470 596 9455) | Jared | done (*hardware*) | A real call from a linked number created a task and the Mac acted (Instagram in Chrome). Agent hosted on LiveKit Cloud (`CA_MqsA9odeGLc5`); see `services/call-agent/README.md` | The number's dispatch rule is not attached explicitly (CLI refused); calls route through the rule's catch-all | Colby: attach the rule in the dashboard; run the call test matrix |
| FaceTime calls with the Mac's screen (Chert) | Jared | in progress | Agent waits for `chert_bridge_ready`, greets within 10 s, relays the Mac's screen as its own video (Chert shows video only from the speaking participant) | `chert login` + a line set to "customer decides"; Chert doesn't pass caller identity yet, so a line is bound to `SPECTR_FACETIME_OWNER_PHONE` | `chert dev --agent spectr-call`; FaceTime Video the line; see the shared Notes window |
| Mac screen publishing to LiveKit | Jared | done (*live*) | `ScreenPublisher` publishes the shared window into `spectr-mac-<deviceId>`; production `GET /api/mac/livekit` issues the screen-share-only grant (verified against spectr-api.vercel.app). `FrameSinkTests`, `mac-token.test.ts` | — | Join `spectr-mac-…` from the LiveKit dashboard and see the shared window |
| iPhone live screen and hands-free call | Jared | done (*live* agent path) | `LiveSession` watches `spectr-mac-<deviceId>`; a call reconnects with a mic grant and the API dispatches `spectr-call` into the same room. A simulated app caller was recognised by the hosted agent | Physical iPhone run | Talk from the app while watching Notes |
| Typed correction and Stop from iPhone | Jared | done (*live* API) | Composer and Stop go through `routeInbound` (provider `app`), same as texts and calls | — | Correct mid-task from the app |
| Continuous hands-free voice with spoken replies | Jared | planned | — | Speech endpoint (Jared, TypeScript), ElevenLabs key server-side | Barge-in stops playback; the app's own reply isn't transcribed |
| Room tokens, association file, speech endpoint (TypeScript) | Jared (from Colby) | room tokens done | Mac grant and app watch/call grants issued server-side after ownership checks | `apple-app-site-association` not served yet | — |
| Live end-to-end Sendblue round trip | Poorav | in progress | Production API now uses the `spectr` database (the old Vercel-integration database was disconnected, not deleted); the Mac app polls production | The texting number must be a verified Sendblue contact; Poorav's Mac and number must be re-registered in the `spectr` database | Text from a linked number → Mac does it → reply in the same thread |
| Supabase auth settings | Jared | done | Changed 2026-11-14, see [AUTH.md](AUTH.md) | Tell Poorav (shared project) | — |
| Incoming calls/callbacks to a locked iPhone | Jared + backend | deferred | — | Separate notification/calling design, entitlements, backend | Real-device ring while locked |
| Remote unlock / takeover of an awake locked Mac | Jared | deferred | — | Explicit auth design, macOS support validation, secure connectivity | Feasibility spike; never stores a Mac password |
| Closed-lid behavior | Jared | deferred (optional) | — | Specific hardware experiment | Record exact hardware and conditions if tested |
| Homework lookup, job applications, VM and hosted browser | Sweeya + Poorav | deferred | — | Outside this assignment | — |

## Open questions for the backend

1. **iPhone task API.** The iPhone needs, for a signed-in user: their tasks, one task's state and events, posting an instruction or Stop (with a client message ID so a retry can't create two revisions), and a LiveKit viewer token.
2. **Pairing.** Device tokens come from a script today. A user-facing pairing flow (Mac shows a code, signed-in iPhone approves) needs routes and a migration.
3. **Mac-side stop.** Stopping on the Mac only stops this Mac from acting; the backend task keeps its state until the user stops it by text or from the iPhone. A device "stop" route would let the Mac cancel the task too.

## Mac helper: physical-Mac checklist

Run on a real Mac; record results here with the date and macOS version.

1. First launch opens Spectr Setup. Close it halfway; reopen it from the gear menu in the popover, and by opening Spectr again from Finder.
2. Connect: paste a device token. A wrong token says it wasn't accepted; a right one checks off step 1.
3. Screen recording: click the button, grant in System Settings, return. The step checks itself off (or resumes at the same step after macOS's quit-and-reopen).
4. Accessibility: with a window already shared, turn Accessibility off. Sharing continues; actions are refused with a clear message.
5. Choose a window: the title in the popover matches the window; the menu bar glyph changes. Stop Sharing flips the glyph back at once.
6. Close the shared window: within about 2 s the popover says the window closed, and the agent stops sending screenshots.
7. With a running API: text a task; the popover shows the instruction and "Working…"; Stop Task halts it on the Mac; a corrected instruction runs.
8. Light and dark appearance; Increase Contrast; Reduce Motion; VoiceOver reads headline, shared window and both stop buttons; Tab reaches every control.
