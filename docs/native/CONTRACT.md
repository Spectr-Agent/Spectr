# Native contract proposal (PROVISIONAL)

What the Swift apps need from the backend. Nothing here is implemented server-side. Envelopes follow Poorav's frozen contract (`origin/devin/1794614215-wire-format`). Everything marked **new** needs his agreement. Fixtures: `packages/SpectrKit/Tests/SpectrKitTests/Fixtures/`.

## Action vocabulary (new)

The Mac executes only these steps. Unknown types are decoded and rejected with `unsupportedAction`. There is no shell, script or free-form case.

| `type` | Fields | Mac-side validation |
| --- | --- | --- |
| `observe` | — | — |
| `openApp` | `bundleId` | Reverse-DNS shape. The app must not be on the user's blocklist. |
| `click` | `target` | `{elementId}` from the latest observation, or `{x, y}` ≥ 0 in shared-window points |
| `typeText` | `text`, `target?` | 1–2000 characters. Never types into a secure (password) field. |
| `keyCombo` | `combo: {modifiers[], key}` | Unique modifiers. `key` is one character or a named key. |
| `scroll` | `dx`, `dy`, `target?` | Each within ±50 lines, not both zero |
| `stop` | — | — |

## Observed state (new)

Results carry `observed: {frontmostBundleId, frontmostAppName, windowTitle, focusedElement: {role, title, value}, verification}`. `verification` is `accessibility` (read back) or `screenshotOnly` (not verifiable). `value` is always null for secure fields.

Outcomes: `succeeded` (readback matches), `failed`, `rejected` (refused before any side effect), and **new** `unverified` (may have run, can't be confirmed).

## Mac command rules (implemented in `CommandLedger`)

| Situation | Behavior |
| --- | --- |
| Same `commandId`, same payload, already finished | Re-send the stored result. No second side effect. |
| Same `commandId`, different payload | Reject as a protocol conflict. |
| Same `commandId`, started but no result (crash/restart) | Read current state and report it. Do not execute again. |
| `revision` older than the newest seen for the task (including via Stop or a correction) | Discard before execution. Report `stale`. |

## Operations needed (new routes; names are proposals)

| Operation | Caller → auth | Notes |
| --- | --- | --- |
| Sign in / refresh / sign out | iPhone → Supabase Auth (Sign in with Apple ID token) | The Apple provider must be enabled in Supabase |
| `POST /v1/pairing/challenges` | Mac → none | Returns `{challengeId, code, pollSecret, expiresAt}`. The code is single-use and lasts 5 minutes. |
| `POST /v1/pairing/approve` | iPhone → user | `{code, deviceName}`. Reuse returns 409. |
| `POST /v1/pairing/exchange` | Mac → `pollSecret` | Returns `{deviceId, deviceCredential}` or 202 pending. A wrong secret returns 403. |
| `GET /v1/devices` | iPhone → user | Last seen, interactive/locked/asleep, capture and accessibility permission, revoked. Each is a separate fact. |
| `POST /v1/devices/me/heartbeat` | Mac → device | Capability snapshot |
| `POST /v1/tasks` | iPhone → user | Create a task from the app (`source: "app"`) |
| `POST /v1/links/redeem` | iPhone → user | `{linkToken}` → `{taskId, deviceId}`. Expired → 410. Another owner → 403. |
| `POST /v1/tasks/{id}/room-token` | iPhone (viewer: subscribe-only) or Mac (publisher: screen share + data) | Short TTL. Issued only after an ownership check. Owner: Jared (TypeScript). |
| `GET /v1/tasks/{id}` and `/events?after=seq&wait=25` | iPhone → user | A sequence gap triggers a snapshot refetch |
| `POST /v1/tasks/{id}/instructions` | iPhone → user | Add `clientMessageId`. `kind: instruction \| stop`. |
| `GET /v1/devices/me/commands?wait=25` | Mac → device | Long-poll claim. Re-delivery keeps the same `commandId`. |
| `POST /v1/commands/{commandId}/result` | Mac → device | `DeviceResult`. Returns a `Receipt`. |
| `POST /v1/tasks/{id}/speech` | iPhone → user | Streams ElevenLabs audio for a verified reply event. Owner: Jared (TypeScript). |
