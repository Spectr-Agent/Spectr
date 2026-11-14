Spectr takes a multi-step task by Sendblue text and runs it on your paired Mac across apps and websites. Use voice and watch the authorized screen in the native iPhone app over LiveKit, correct or stop the task, and get a verified result. Examples include opening Instagram DMs or moving a Keynote slide.

| Owner | Area |
| --- | --- |
| Jared | iPhone and Mac Swift apps |
| Poorav | Backend |
| Colby | Backend and agent support, including ElevenLabs voice |
| Sweeya | Agent and brand |

Project docs: [requirements](docs/requirements.md), [design](docs/design.md), and [tasks](docs/tasks.md).

## API checks

```sh
cd services/api && npm install && npm run typecheck && npm test
```

## Native apps (iPhone and Mac)

Swift sources live in `apps/ios`, `apps/mac` and `packages/SpectrKit`. Native status: [docs/native/STATUS.md](docs/native/STATUS.md). Native contract notes: [docs/native/CONTRACT.md](docs/native/CONTRACT.md).

### What works today

Native foundation only (Phase 1):

- Both apps build from a clean checkout and run their unit tests.
- The shared Swift package decodes task, command, result, receipt, event and error payloads, including the provisional general-control actions.
- The command ledger rejects duplicate, conflicting and stale commands (unit-tested).
- Each app refuses to start against missing or insecure configuration and says why.

Sign-in, pairing, live video, Mac actions and voice are **not implemented yet**. See [STATUS.md](docs/native/STATUS.md) for what is next and who it depends on.

### Prerequisites

- macOS 26 and Xcode 26 (tested with Xcode 26.5 / Swift 6.3.2 on an M4 MacBook Air).
- XcodeGen 2.46.0: `brew install xcodegen`.
- The iOS 26 simulator. A physical iPhone on iOS 26 is needed for the microphone, Universal Links and cellular video.
- For live mode, values from the backend owners: API origin and Universal Link host. Signing needs your own Apple developer team.

### Setup

```sh
cp apps/Config/Local.xcconfig.example apps/Config/Local.xcconfig   # fill in; never put secrets here
make bootstrap        # generates apps/Spectr.xcodeproj from apps/project.yml and restores pinned packages
open apps/Spectr.xcodeproj
```

Select the **SpectrIOS** or **SpectrMac** scheme. Every native setting comes from `apps/project.yml` and `apps/Config/*.xcconfig`. Re-run `make bootstrap` after changing either one. Don't edit the generated project.

Which values come from whom (all go in `apps/Config/Local.xcconfig`):

| Setting | Supplied by |
| --- | --- |
| `SPECTR_BUNDLE_PREFIX`, `DEVELOPMENT_TEAM` | Jared |
| `SPECTR_API_ORIGIN` | Poorav (deployed API) |
| `SPECTR_LINK_HOST` | Jared (hosts the association file) and Poorav (domain) |

Supabase project settings and Sendblue are configured by Poorav. LiveKit token issuance is Jared's TypeScript work. Provider secrets never go in either app.

### Commands

| Command | What it checks |
| --- | --- |
| `make lint` | `swift-format` (bundled with Xcode) in strict mode, applied to Swift files only. Beyond formatting it rejects force unwraps, `try!`, implicitly unwrapped optionals and unordered imports. |
| `make format` | Rewrites Swift files in place. It never touches TypeScript or SQL. |
| `make test-kit` | Shared package tests (`swift test`, no simulator). |
| `make test-ios` | iOS unit tests on the first available iPhone simulator. Override with `IOS_SIM=<udid>`. |
| `make test-mac` | macOS unit tests. |
| `make check-release` | Builds Release and asserts that both bundles declare `production` and ship no fixture JSON. |
| `make test` | All of the above. CI (`.github/workflows/apple.yml`) runs it on native changes only. |

API checks live with the backend: `cd services/api && npm install && npm run typecheck && npm test`.

### Fixture mode vs live mode

Fixtures exist only in test targets (`packages/SpectrKit/Tests/SpectrKitTests/Fixtures`, labeled PROVISIONAL). Neither app contains a fixture transport. Debug builds run as `development`, which allows an `http://localhost` API. Release builds always run as `production`, which requires HTTPS.

### Troubleshooting

| Symptom | Likely cause | Next check |
| --- | --- | --- |
| App shows "This build isn't configured" | `Local.xcconfig` missing or incomplete | Copy the example, fill in the values, run `make bootstrap`, rebuild |
| Mac menu shows Screen capture "Not allowed" | Screen Recording permission not granted | System Settings → Privacy & Security → Screen & System Audio Recording |
| Mac menu shows Accessibility control "Not allowed" | Accessibility permission not granted | System Settings → Privacy & Security → Accessibility |
| Package resolution picks a different LiveKit version | Generated project lost its pin | `make bootstrap` restores `apps/Package.resolved` |
| Black or frozen video, a room that joins without a track, an expired link, or an action reported without readback | These paths ship in Phases 2–5 | See [STATUS.md](docs/native/STATUS.md) |

### Demo rehearsal (target; not yet runnable)

1. Mac awake and unlocked on Wi-Fi with Notes open. iPhone on cellular, signed in, Mac paired.
2. A judge texts "open Notes and write milk" and taps Watch live. A live frame appears within about 3 s.
3. The phone shows each step and the verified result: Notes is in front and the note reads "milk".
4. The judge says "actually, eggs". Both screens show "eggs" and the receipt matches.
5. The judge taps Stop, or the Mac's Wi-Fi is turned off. The phone shows an honest stopped or disconnected state with a retry.
