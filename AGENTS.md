# Spectr — shared agent context

This file is the base prompt for any coding agent working in this repo. Read it before your individual assignment. It covers what we are building, what matters this weekend (EmoryHacks), who owns what, and how to tell whether a change works. Individual checklists and pitch copy live in the team playbook, not here.

## What Spectr is

Spectr lets you text your Mac via Sendblue iMessage, tell it what to do in plain English, and use the native Spectr iPhone app for voice interaction and live viewing of the Mac screen over LiveKit. You can interrupt, correct the instruction, or stop the task.

Spectr is general computer control: it has no slide- or presentation-specific features. Homework deadlines and job applications are later example workflows for the same general agent. The backend computer-use loop (`/api/mac/task`, `/api/mac/step`) and the native Mac client for it are both in the repo.

## What we are proving this weekend

The first end-to-end workflow runs a judge-chosen multi-step task on a real, awake Mac:

1. A user texts a task through Sendblue, such as "open Instagram and show my DMs" or "write a shopping list in Notes."
2. The Mac helper sends the authorized screen and recent action results to the backend, then executes its validated next actions.
3. The user watches the Mac screen live in the iPhone app over LiveKit.
4. The user corrects or stops the task and receives a verified result in the original thread.

Browser and native-app tasks (for example Notes) are examples, not separate workflows. Pairing, task routing, screen streaming and correction must not depend on which app or website is being used.

Voice and live screen viewing happen in the native iPhone app; push-to-talk is the first milestone. VM and hosted cloud browsers are last priority; browser tasks on the real Mac are in scope.

## Ownership and layout

| Owner | Build area | First handoff |
| --- | --- | --- |
| Jared | iPhone + Mac · Swift/SwiftUI; plus Colby's former work: LiveKit room tokens, Apple association file, ElevenLabs voice, mock Mac · TypeScript | The general Mac executor runs a task while the iPhone shows the screen live. |
| Poorav | Backend · TypeScript | One message creates one authenticated task. |
| Sweeya | Agent · guardrails · brand | A correction selects the new target; logo goes to Jared. |

**Current repo state:** `contracts/`, the TypeScript API package (Sendblue and Chert webhooks, Postgres task store, Claude step loop, tests) and the Supabase migrations exist. The iPhone app, Mac helper and shared Swift package are under `apps/` and `packages/SpectrKit` (see "Native apps" below). Colby's former work (room tokens, voice, association file) now belongs to Jared.

## Architecture

Messages → Sendblue → authenticated Vercel TypeScript API (Claude computer-use step loop) → schema-validated actions → paired Mac helper → app or website on the Mac.

For each short HTTP step, the Mac posts its authorized screenshot and recent action results. The backend resumes the task's stored Claude conversation and returns the next action batch or a final summary. The Mac executes the batch and posts a fresh screenshot; the loop is capped at 60 steps and task state is persisted in Supabase. `ANTHROPIC_API_KEY` is a server-side Vercel variable and never goes to either device.

Voice and live screen → native Spectr iPhone app (instructions to task API; Mac screen via LiveKit Cloud).

Chert (iMessage + FaceTime) is the backup channel.

**LiveKit Cloud** carries the live screen from Jared's Mac helper to the native iPhone app. The Mac publishes the authorized window to the owner's Mac room with the pinned LiveKit Swift SDK (https://github.com/livekit/client-sdk-swift), and the iPhone app subscribes to it. Voice input stays in the iPhone app; the task API carries commands and verified results, Supabase holds task state, and the backend replies in the original iMessage thread. See `docs/design.md`.

## How agents should work together

- Use the task in your current prompt to determine your assignment. Ask who you are supporting if it is ambiguous.
- Keep changes inside your workstream where practical, and preserve teammates' edits.
- If a change affects a shared contract (`contracts/task.example.json`, owned by Poorav), identify the affected owners and update the fixture and its consumers together.
- Describe repo conventions as they actually exist, and clearly label planned components.
- Coordinate with `taskId`, `deviceId`, `commandId` and `revision`. Base each action on the current screenshot and recent results.

## Behaviors every implementation must preserve

- A task belongs to an authenticated user and a paired device.
- A repeated message or command must not execute the same action twice.
- Stop and newer corrections supersede older pending actions.
- Allow one active task per device. Stop and a newer instruction cancel the running task and supersede pending steps; a new non-stop text is a correction.
- Report success only when Claude's final screenshot check shows the requested state.
- Make denied permissions, stale video, disconnection and unsupported requests visible and recoverable. Treat lock, sleep, disconnect and denied permission as distinct states.
- Keep secrets server-side or in device Keychain as appropriate. Keep `ANTHROPIC_API_KEY` on Vercel, never on the Mac or iPhone.
- Screen sharing uses only a display or window the user authorized. Validate actions before execution; allow only screenshot, click, double-click, right-click, move, drag, scroll, type, key/hotkey, wait, `openApp(name)` and `openUrl(url)`. Never execute shell commands or model-generated AppleScript.
- Ask by text and wait for "yes" before sending messages, posting, purchasing, submitting forms or deleting. Never type passwords or 2FA codes; pause and ask the user to log in while watching live.
- Stop at 60 steps or when stuck; fail with what was observed.

## First integration test

1. Put the Mac on Wi-Fi and the iPhone on cellular.
2. Text a browser task such as "open Instagram and show my DMs"; verify the authorized screen is fresh on the iPhone.
3. Correct or stop the task while it runs, then verify the final screenshot and result on both screens.
4. Repeat with a native-app task such as "write milk in a new note in Notes".

**Demo gate:** three consecutive runs of different judge-chosen tasks, e.g. a browser task and a native-app task, verified on both screens.

## Handoffs

When you hand off work, include the changed paths, the verification command, the observed result, and one remaining blocker with its owner. Separate what passed on real hardware from simulator checks, fixtures and untested assumptions.

## If you are Jared's agent

Applies only when you are working for Jared (iPhone app, Mac helper, shared Swift package, or his TypeScript in `services/api`). Other teammates' agents can skip this section.

- **Work only in `~/Developer/Spectr`.** Never edit `~/Documents/GitHub/Spectr`: it is an old backup in an iCloud-synced folder, where git hangs, code signing fails and iCloud corrupts `.git`. If you find yourself there, stop and switch.
- **Commits and PRs carry no attribution lines:** no `Co-Authored-By`, no "Generated with" footer.
- **Secrets live in `~/.config/spectr/dev.env`** (Supabase secret key, LiveKit key and secret, Resend key). Read them from there in scripts; never copy them into the repo, an app bundle, a log or chat. Public client values go in gitignored `apps/Config/Local.xcconfig`.
- **Spectr has no slide features.** Do not build anything Keynote- or presentation-specific; tasks are general computer control.
- **Another agent may be editing at the same time.** Check `git status` first, commit only your own paths (`git commit -- <paths>`), and use your own build folder.
- **Build outside the repo when signing.** Simulator and Mac builds that need code signing use a derived-data folder outside any cloud-synced folder (`make test-ios` already does this).
- **Keep `docs/native/STATUS.md` current** at the end of each piece of work, and separate what was verified live or on hardware from fixtures and simulator runs.

## Native apps (Swift) — layout, tooling and rules

This section covers Jared's native workstream and follows the team architecture above.

| Path | What it is |
| --- | --- |
| `apps/project.yml` | XcodeGen spec, the single source of truth for the Xcode project (`make bootstrap` generates `apps/Spectr.xcodeproj`, which is not checked in) |
| `apps/Config/` | Base/Debug/Release xcconfigs; per-developer values go in gitignored `apps/Config/Local.xcconfig` |
| `apps/ios/` | SwiftUI iPhone app and tests |
| `apps/mac/` | SwiftUI menu-bar Mac helper and tests |
| `packages/SpectrKit/` | Shared Swift package: wire models, auth client, command ledger, stream health |
| `docs/native/` | Native status ledger, contract notes, auth hardening list |
| `apps/mac/SpectrMac/Agent/` | Mac client for `/api/mac/task` and `/api/mac/step`: screenshots only the shared window or display, validates and executes returned actions, never runs a step batch twice |
| `tools/dev-agent/` | Debug-only local planner for the Mac action lab; not used by the real task loop |
| `services/call-agent/` | LiveKit voice agent for calling your Mac by phone (+1 470 596 9455), FaceTime (Chert) or the app. Routes speech through the iMessage inbound pipeline and speaks in the pinned ElevenLabs voice. Owner: Jared |
| `services/api/src/livekit/` | `GET /api/mac/livekit`: a one-hour, screen-share-only LiveKit grant for the Mac's own room. Owner: Jared |
| `Makefile`, `.swift-format`, `.github/workflows/apple.yml` | Native build, lint and CI; they never touch TypeScript or SQL |

- Commands: `make bootstrap`, `make lint`, `make test-kit`, `make test-ios`, `make test-mac`, `make check-release`.
- Native code never holds provider secrets. The Supabase publishable key is a public client value; the secret key, LiveKit secret, Resend key and `ANTHROPIC_API_KEY` stay server-side or in a developer's local env file.
- The Mac connects with a device token issued by `services/api/scripts/issue-device-token.mjs` (stored in the Mac Keychain). There is no code-based pairing route yet.
- The Mac executes only the backend's validated action set and checks each action itself: inside the shared area, http(s) links only, installed apps only. It refuses terminals, script editors and password managers, never types into password fields, and with a window shared, sends keystrokes only when that window's app is in front.
- Release builds must not contain test data, Debug tools or development servers; `make check-release` enforces this.

## Tests

`cd tests && npm ci && npm run coverage` runs every TypeScript package's tests (services/api, services/call-agent, apps/web) plus `tests/unit` under one harness, gated at 99% lines/statements, 100% functions and 90% branches.
Prerequisite: `npm ci` in each of those packages (and `tools/dev-agent`) first.
Swift tests stay under `make test-*`; they are not part of this harness.
