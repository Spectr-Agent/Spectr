# Spectr — shared agent context

This file is the base prompt for any coding agent working in this repo. Read it before your individual assignment. It covers what we are building, what matters this weekend (EmoryHacks), who owns what, and how to tell whether a change works. Individual checklists and pitch copy live in the team playbook, not here.

## What Spectr is

Spectr lets you text your Mac via Sendblue iMessage, tell it what to do in plain English, and use the native Spectr iPhone app for voice interaction and live viewing of the Mac screen over LiveKit. You can interrupt, correct the instruction, or stop the task.

Requests like "check when my homework is due" or "help me apply to this internship" are **future workflows**. Nothing in this repo implements them yet.

## What we are proving this weekend

The first end-to-end workflow uses Keynote on a real, awake Mac:

1. A user says "go to slide five" in the iPhone app or texts it via Sendblue.
2. The Mac changes slides, and the iPhone app shows the change live over LiveKit.
3. The helper reports which slide is actually open.
4. The user says "actually, slide two" in the iPhone app or by text and sees the correction take effect.

Keynote is only the first test case. Spectr is a general computer assistant, so pairing, task routing, screen streaming and correction must not depend on which app is being operated.

Voice and live screen viewing happen in the native iPhone app; push-to-talk is the first milestone. VM and general browser automation are last priority.

## Ownership and layout

| Owner | Build area | First handoff |
| --- | --- | --- |
| Jared | iPhone + Mac · Swift/SwiftUI | Selected Keynote window streams to the Watch live screen. |
| Poorav | Backend · TypeScript | One message creates one authenticated task. |
| Colby | Backend + agent support + voice · TypeScript | Room token issued for a task; mock Mac returns a receipt; first reply spoken in the Spectr voice. |
| Sweeya | Agent · guardrails · brand | A correction selects the new target; logo goes to Jared. |

**Current repo state:** `contracts/`, `services/api/`, and Supabase migrations exist. The Swift targets are not built yet. Treat them as planned until they exist.

## Architecture

Messages → Sendblue → authenticated TypeScript backend → validated agent action → paired Mac helper → app on the Mac.

Voice and live screen → native Spectr iPhone app (instructions to task API; Mac screen via LiveKit Cloud).

Chert (iMessage + FaceTime) is the backup channel.

**LiveKit Cloud** carries the live screen from Jared's Mac helper to the native iPhone app. The Mac publishes the authorized window to the owner's Mac room with the pinned LiveKit Swift SDK (https://github.com/livekit/client-sdk-swift), and the iPhone app subscribes to it. Voice input stays in the iPhone app; the task API carries commands and verified results, Supabase holds task state, and the backend replies in the original iMessage thread. See `docs/design.md`.

## How agents should work together

- Use the task in your current prompt to determine your assignment. Ask who you are supporting if it is ambiguous.
- Keep changes inside your workstream where practical, and preserve teammates' edits.
- If a change affects a shared contract (`contracts/task.example.json`, owned by Poorav), identify the affected owners and update the fixture and its consumers together.
- Describe repo conventions as they actually exist, and clearly label planned components.
- Coordinate with `taskId`, `deviceId`, `commandId` and `revision`. Prefer absolute commands such as `goToSlide(4)`.

## Behaviors every implementation must preserve

- A task belongs to an authenticated user and a paired device.
- A repeated message or command must not execute the same action twice.
- Stop and newer corrections supersede older pending actions.
- Report success only after observing the requested state on the Mac.
- Make denied permissions, stale video, disconnection and unsupported requests visible and recoverable. Treat lock, sleep, disconnect and denied permission as distinct states.
- Keep secrets server-side or in device Keychain as appropriate. Never ask for a Mac password in chat.
- Screen sharing uses only a window the user authorized. The agent executes only supported, validated actions, and never turns model output into arbitrary shell commands.

## First integration test

1. Put the Mac on Wi-Fi and the iPhone on cellular.
2. Change one Keynote slide manually and verify that the iPhone receives a fresh frame.
3. Issue the same action through Spectr, correct it mid-task, and compare the final slide on both devices.

## Handoffs

When you hand off work, include the changed paths, the verification command, the observed result, and one remaining blocker with its owner. Separate what passed on real hardware from simulator checks, fixtures and untested assumptions.
