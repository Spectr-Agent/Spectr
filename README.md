Spectr takes a multi-step task by Sendblue text and runs it on your paired Mac across apps and websites. Use voice and watch the authorized screen in the native iPhone app over LiveKit, correct or stop the task, and get a verified result. Examples include opening Instagram DMs or writing a note in Notes.

| Owner | Area |
| --- | --- |
| Jared | iPhone and Mac Swift apps; LiveKit room tokens, voice and Apple association file (taken over from Colby) |
| Poorav | Backend |
| Sweeya | Agent and brand |

Project docs: [requirements](docs/requirements.md), [design](docs/design.md), and [tasks](docs/tasks.md).

## API checks

```sh
cd services/api && npm install && npm run typecheck && npm test
```

## Native apps (iPhone and Mac)

Swift sources live in `apps/ios`, `apps/mac` and `packages/SpectrKit`. Native status: [docs/native/STATUS.md](docs/native/STATUS.md). Native contract notes: [docs/native/CONTRACT.md](docs/native/CONTRACT.md).

### What works today

- **iPhone:** real Supabase sign-in (6-digit email code or the emailed link), session in Keychain. The task screen (live-view states, steps, correction, Stop) runs on labeled test data until the iPhone task API exists.
- **Mac:** menu-bar helper with setup for Screen Recording and Accessibility, sharing of one picked window or display, and connection to the backend with a device token.
- **Mac agent loop:** polls `GET /api/mac/task`, sends screenshots of only the shared content to `POST /api/mac/step`, and executes the returned actions after its own safety checks. Verified against the backend contract files and fakes; **not yet run against a deployed backend**.
- **Not built yet:** LiveKit video to the iPhone, voice. See [STATUS.md](docs/native/STATUS.md).

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
| `SPECTR_API_ORIGIN` | The deployed `services/api` origin (Poorav), or `http://localhost:3000` from `npm run dev:server` in Debug |
| `SPECTR_LINK_HOST` | Jared (hosts the association file) and Poorav (domain) |
| `SPECTR_SUPABASE_URL`, `SPECTR_SUPABASE_PUBLISHABLE_KEY` | Supabase project settings (public values; never the secret key) |

Sendblue is configured by Poorav. LiveKit token issuance and voice are Jared's TypeScript work. Provider secrets never go in either app. Sign-in details and remaining hardening: [docs/native/AUTH.md](docs/native/AUTH.md).

**Connect the Mac:** issue a token with `POSTGRES_URL=... node services/api/scripts/issue-device-token.mjs <deviceId>`, then paste it into Spectr Setup → "Connect this Mac to your account". The token is stored in the Mac Keychain.

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
| Local signed build fails with "resource fork, Finder information, or similar detritus not allowed" | The repo is in an iCloud-synced folder (`~/Documents`), which adds file attributes that codesign rejects | Build with `-derivedDataPath` outside `~/Documents`, or move the repo |
| Package resolution picks a different LiveKit version | Generated project lost its pin | `make bootstrap` restores `apps/Package.resolved` |
| Setup says the device token wasn't accepted | Token mistyped, revoked, or issued by a different backend than `SPECTR_API_ORIGIN` | Issue a new token against the same database the API uses |
| Mac menu says "Can't reach the Spectr server" | Wrong `SPECTR_API_ORIGIN` or the API isn't running | Open `<origin>/api/health` in a browser |
| Mac menu says to choose a window or display | Nothing is shared, so the agent may not see anything | Choose Window… in the menu |
| An action fails with "The shared window is not in front" | A window (not a display) is shared and another app is focused | The agent should click the window first; or share the display |
| Black or frozen video on the iPhone | LiveKit video isn't built yet | See [STATUS.md](docs/native/STATUS.md) |

### Demo rehearsal (target; not yet runnable)

1. Mac awake and unlocked on Wi-Fi with Notes open and shared. iPhone on cellular, signed in, Mac connected with its device token.
2. A judge texts "open Notes and write milk" and taps Watch live. A live frame appears within about 3 s.
3. The phone shows each step and the result the backend verified from the final screenshot.
4. The judge says "actually, eggs". Both screens show "eggs" and the receipt matches.
5. The judge taps Stop, or the Mac's Wi-Fi is turned off. The phone shows an honest stopped or disconnected state with a retry.
