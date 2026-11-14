# Spectr — shared agent context

This file is the base prompt for any coding agent working in this repo. Read it before your individual assignment. It covers what we are building, what matters this weekend (EmoryHacks), who owns what, and how to tell whether a change works. Individual checklists and pitch copy live in the team playbook, not here.

## What Spectr is

Spectr lets you text your Mac via Sendblue iMessage, tell it what to do in plain English, and use the native Spectr iPhone app for voice interaction and live viewing of the Mac screen over LiveKit. You can interrupt, correct the instruction, or stop the task.

Homework deadlines and job applications are later example workflows for the same general agent. The current repo does not yet implement the Mac computer-use loop.

## What we are proving this weekend

The first end-to-end workflow runs a judge-chosen multi-step task on a real, awake Mac:

1. A user texts a task through Sendblue, such as "open Instagram and show my DMs" or "go to slide five."
2. The Mac helper sends the authorized screen and recent action results to the backend, then executes its validated next actions.
3. The user watches the Mac screen live in the iPhone app over LiveKit.
4. The user corrects or stops the task and receives a verified result in the original thread.

Browser and Keynote tasks are examples, not separate workflows. Pairing, task routing, screen streaming and correction must not depend on which app or website is being used.

Voice and live screen viewing happen in the native iPhone app; push-to-talk is the first milestone. VM and hosted cloud browsers are last priority; browser tasks on the real Mac are in scope.

## Ownership and layout

| Owner | Build area | First handoff |
| --- | --- | --- |
| Jared | iPhone + Mac · Swift/SwiftUI | The general Mac executor runs a task while the iPhone shows the screen live. |
| Poorav | Backend · TypeScript | One message creates one authenticated task. |
| Colby | Backend + agent support + voice · TypeScript | Room token issued for a task; mock Mac returns a receipt; first reply spoken in the Spectr voice. |
| Sweeya | Agent · guardrails · brand | A correction selects the new target; logo goes to Jared. |

**Current repo state:** `contracts/`, the TypeScript API package (contracts, inbound deduplication and tests), and the initial Supabase migration exist. The Sendblue webhook is on branch `devin/1794627061-sendblue-inbound`, not on main. The Swift targets are not built yet.

## Architecture

Messages → Sendblue → authenticated Vercel TypeScript API (Claude computer-use step loop) → schema-validated actions → paired Mac helper → app or website on the Mac.

For each short HTTP step, the Mac posts its authorized screenshot and recent action results. The backend resumes the task's stored Claude conversation and returns the next action batch or a final summary. The Mac executes the batch and posts a fresh screenshot; the loop is capped at 40 steps and task state is persisted in Supabase. `ANTHROPIC_API_KEY` is a server-side Vercel variable and never goes to either device.

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
- Report success only when Claude's final screenshot check shows the requested state. A Keynote task may also report `observedSlide`.
- Make denied permissions, stale video, disconnection and unsupported requests visible and recoverable. Treat lock, sleep, disconnect and denied permission as distinct states.
- Keep secrets server-side or in device Keychain as appropriate. Keep `ANTHROPIC_API_KEY` on Vercel, never on the Mac or iPhone.
- Screen sharing uses only a display or window the user authorized. Validate actions before execution; allow only screenshot, click, double-click, right-click, move, drag, scroll, type, key/hotkey, wait, `openApp(name)` and `openUrl(url)`. Never execute shell commands or model-generated AppleScript.
- Ask by text and wait for "yes" before sending messages, posting, purchasing, submitting forms or deleting. Never type passwords or 2FA codes; pause and ask the user to log in while watching live.
- Stop at 40 steps or when stuck; fail with what was observed.

## First integration test

1. Put the Mac on Wi-Fi and the iPhone on cellular.
2. Text a browser task such as "open Instagram and show my DMs"; verify the authorized screen is fresh on the iPhone.
3. Correct or stop the task while it runs, then verify the final screenshot and result on both screens.
4. Repeat with a Keynote task such as "go to slide five"; `observedSlide` may provide an additional check.

**Demo gate:** three consecutive runs of different judge-chosen tasks, e.g. a browser task and a Keynote example task, verified on both screens.

## Handoffs

When you hand off work, include the changed paths, the verification command, the observed result, and one remaining blocker with its owner. Separate what passed on real hardware from simulator checks, fixtures and untested assumptions.
