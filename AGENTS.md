# Spectr — shared agent context

This file is the base prompt for any coding agent working in this repo. Read it before your individual assignment. It covers what we are building, what matters this weekend (EmoryHacks), who owns what, and how to tell whether a change works. Individual checklists and pitch copy live in the team playbook, not here.

## What Spectr is

Spectr lets you text or FaceTime your Mac, tell it what to do in plain English, and watch its actual screen on the FaceTime call while it works. You can interrupt, correct the instruction, or stop the task. Texts and calls arrive through a Chert line (real iMessage and FaceTime). The native Spectr iPhone app is a fallback viewer.

Requests like "check when my homework is due" or "help me apply to this internship" are **future workflows**. Nothing in this repo implements them yet.

## What we are proving this weekend

The first end-to-end workflow uses Keynote on a real, awake Mac:

1. A user says or texts "go to slide five."
2. The Mac changes slides, and the iPhone shows the change live.
3. The helper reports which slide is actually open.
4. The user says "actually, slide two" and sees the correction take effect.

Keynote is only the first test case. Spectr is a general computer assistant, so pairing, task routing, screen streaming and correction must not depend on which app is being operated.

The voice experience is a continuous, hands-free FaceTime call. VM and general browser automation are last priority.

## Ownership and layout

| Owner | Area | Path (planned) |
| --- | --- | --- |
| Jared | Mac helper (Swift): pairing, permissions, ScreenCaptureKit window capture, Keynote actions, result verification; fallback iPhone viewer (SwiftUI) | `apps/mac/SpectrMac/`, `apps/ios/SpectrIOS/` |
| Colby | FaceTime call agent (TypeScript): LiveKit Agents worker, speech-to-text, ElevenLabs voice, Mac window as call video; LiveKit tokens | `services/call-agent/` |
| Poorav | Backend (TypeScript/Node): Vercel API, Supabase persistence and auth, Chert line and messaging, task routing, shared contracts | `services/api/`, `supabase/migrations/`, `contracts/` |
| Sweeya | Agent (TypeScript): intent interpretation, typed actions, clarification, guardrails, correction handling; Spectr logo and character | `services/api/src/agent/` |

**Current repo state:** `contracts/`, `services/api/` (schemas, inbound dedup, tests) and the first Supabase migration exist. The Swift targets and the call agent are not built yet. Treat them as planned until they exist.

## Architecture

iMessage → Chert webhook → authenticated TypeScript backend → validated agent action → paired Mac helper → app on the Mac.

FaceTime → Chert → LiveKit call room → call agent (speech-to-text → task API; ElevenLabs voice and the Mac window back to the caller).

**LiveKit Cloud** carries all media. Jared's Mac helper publishes the authorized window to the owner's Mac room with the pinned LiveKit Swift SDK (https://github.com/livekit/client-sdk-swift). Colby's call agent subscribes to it and republishes it as its video on the FaceTime call; the fallback iPhone app subscribes to the same room. Tokens are short-lived and room-scoped. Spectr's task API carries commands and verified results, Supabase holds task state, and the backend replies in the original iMessage thread. See `docs/design.md`.

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
