# Spectr — shared agent context

This file is the base prompt for any coding agent working in this repo. Read it before your individual assignment. It covers what we are building, what matters this weekend (EmoryHacks), who owns what, and how to tell whether a change works. Individual checklists and pitch copy live in the team playbook, not here.

## What Spectr is

Spectr lets you call or text your Mac, tell it what to do in plain English, and watch its actual screen from your iPhone while it works. You can interrupt, correct the instruction, or stop the task. Text requests arrive through real iMessage. Voice and live screen viewing happen in the native Spectr iPhone app.

Requests like "check when my homework is due" or "help me apply to this internship" are **future workflows**. Nothing in this repo implements them yet.

## What we are proving this weekend

The first end-to-end workflow uses Keynote on a real, awake Mac:

1. A user says or texts "go to slide five."
2. The Mac changes slides, and the iPhone shows the change live.
3. The helper reports which slide is actually open.
4. The user says "actually, slide two" and sees the correction take effect.

Keynote is only the first test case. Spectr is a general computer assistant, so pairing, task routing, screen streaming and correction must not depend on which app is being operated.

The intended voice experience is a continuous, hands-free call. Push-to-talk is the first milestone. VM and general browser automation are last priority.

## Ownership and layout

| Owner | Area | Path (planned) |
| --- | --- | --- |
| Jared | iPhone app (Swift/SwiftUI): task links, live viewer, voice input, corrections, Stop | `apps/ios/SpectrIOS/` |
| Colby | macOS companion (Swift): pairing, permissions, ScreenCaptureKit window capture, local actions, result verification | `apps/mac/SpectrMac/` |
| Poorav | Backend (TypeScript/Node): Vercel API, Supabase persistence and auth, Sendblue iMessage, task routing, LiveKit room tokens, shared contracts | `services/api/`, `supabase/migrations/`, `contracts/` |
| Sweeya | Agent (TypeScript): intent interpretation, typed actions, clarification, guardrails, correction handling; Spectr logo and character | `services/api/src/agent/` |

**Current repo state:** these paths are an empty scaffold. There are no Xcode projects, no package dependencies, no fixtures and no working commands yet. Treat everything above as planned until it exists.

## Architecture

Messages → Sendblue → authenticated TypeScript backend → validated agent action → paired Mac helper → app on the Mac.

**LiveKit Cloud** is the selected WebRTC transport. Jared and Colby pin the same release of the official LiveKit Swift SDK (https://github.com/livekit/client-sdk-swift). Colby publishes the authorized Mac window, and Jared subscribes from the iPhone. Poorav issues short-lived, room-scoped tokens after checking ownership. LiveKit carries media. Spectr's task API carries agent commands and verified results. Supabase holds task state, and the backend returns a receipt to the original iMessage thread.

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
