# Native contract notes

The canonical contract is `contracts/` and `services/api/src/contracts.ts` (owner: Poorav). This file records how the native apps use it and what they still need.

## Mac ↔ backend (implemented)

| Call | Native code | Notes |
| --- | --- | --- |
| `GET /api/mac/task` with `Authorization: Bearer <device token>` | `MacAgentClient.activeTask()` | Polled about every 3 s while idle. 401 forgets the token and asks the user to connect again. |
| `POST /api/mac/step` | `MacAgentClient.step(_:)` | Sends a JPEG of only the shared window or display (long edge 1280 px, within the backend's 2576 px and 4784-tile limits), `afterStep`, and the previous batch's results. 409 `staleStep` means a correction or Stop moved the task: the Mac re-reads it. |

Types: `SpectrKit/Agent/MacAgentWire.swift`. Tests decode the real `contracts/mac-*.json` files, not copies, so a contract change that breaks the Mac fails `make test-kit`.

### What the Mac checks itself before acting

The backend validates actions; the Mac checks again, independently (`MacActionPolicy`, `EventActionPerformer`):

- Coordinates must be inside the screenshot it sent; they map back into the shared window or display only.
- `openUrl`: http and https only. `openApp`: installed apps found by name in the standard application folders; never a path.
- Never operates terminals, script editors, Automator, Shortcuts, Keychain Access or password managers (`AppPolicy`), and never types into a password field.
- With a window shared, keystrokes are sent only when that window's app is in front.
- Unknown action types are reported as failed, never executed.
- Locked screen and missing Accessibility permission are reported as distinct failures.

### Exactly-once execution

`StepLedger` records each step batch by `(taskId, step)` before and during execution and is saved to Application Support after every action. If the step request is retried and returns the same batch, the stored results are re-sent. If Spectr restarted mid-batch, nothing in it runs again; unfinished actions are reported as not run.

## iPhone ↔ backend (needed, not on `main`)

The iPhone signs in with Supabase directly. It still needs routes for a signed-in user:

| Need | Why |
| --- | --- |
| List my tasks; get one task with ordered events after a cursor | Task screen and restore after relaunch |
| Post an instruction or Stop with `expectedRevision` and a client message ID | Correction and Stop; the ID makes a retry safe |
| LiveKit viewer token for my Mac's room | Live video (subscribe-only for the phone; publish for the Mac) |
| Redeem a Watch live link | Opening a task from iMessage |

The iPhone's current wire models for these (`TaskSnapshot`, `TaskEvent`, `InstructionAck`) follow the frozen task envelopes in `contracts/` and are exercised only with test data until the routes exist.

## Superseded

The earlier native proposal for an Accessibility-element action set (`observe`, `click(elementId)`, `typeText`, `keyCombo`, `scroll`) and `/v1/pairing/*` routes is superseded by the backend's screenshot-and-coordinates loop and device tokens. The older action set remains only in the Debug action lab.
